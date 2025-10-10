import Papa from 'papaparse';

import { createDatabase, ensureDexieLoaded, generateId } from './db.js';

/**
 * Client-side importer for Employees.
 * - Supports CSV or JSON files via <input type="file">.
 * - Auto-detects columns (Name, Employee ID, Seniority Hours, Status, Role, Employment Type, Wing/Unit, Start/Hire Date).
 * - Sorts by seniority hours (desc) before writing to IndexedDB (Dexie).
 * - Uses Dexie and PapaParse modules provided via the bundled build.
*/
(function(){
  function getAlpineRoot(){
    const root = document.querySelector('[x-data="app"]');
    return root && root.__x ? root.__x : null;
  }

  function isAlpineReady(){
    return Boolean(getAlpineRoot());
  }

  let fallbackModalCleanup = null;

  function toggleImportModal(open){
    const alpine = getAlpineRoot();
    if (alpine){
      alpine.$data.showImportModal = Boolean(open);
      return true;
    }

    const modal = document.querySelector('[x-show="showImportModal"]');
    if (modal){
      if (open){
        if (modal.dataset.fallbackOpen === 'true'){
          modal.style.display = 'block';
          return true;
        }
        modal.dataset.fallbackOpen = 'true';
        modal.style.display = 'block';

        const cleanupFns = [];
        const closeHandler = (event) => {
          event.preventDefault();
          toggleImportModal(false);
        };

        modal.querySelectorAll('[data-close-import-modal], [x-on\\:click="showImportModal=false"]').forEach((el) => {
          el.addEventListener('click', closeHandler);
          cleanupFns.push(() => el.removeEventListener('click', closeHandler));
        });

        const escapeHandler = (event) => {
          if (event.key === 'Escape' || event.key === 'Esc'){
            toggleImportModal(false);
          }
        };
        document.addEventListener('keydown', escapeHandler);
        cleanupFns.push(() => document.removeEventListener('keydown', escapeHandler));

        fallbackModalCleanup = () => {
          cleanupFns.forEach(fn => fn());
          fallbackModalCleanup = null;
        };
      } else {
        if (typeof fallbackModalCleanup === 'function'){
          const cleanup = fallbackModalCleanup;
          fallbackModalCleanup = null;
          cleanup();
        }
        delete modal.dataset.fallbackOpen;
        modal.style.display = 'none';
      }
      return true;
    }
    return false;
  }

  async function ensureDb(){
    await ensureDexieLoaded();
    return await createDatabase();
  }

  function parseSeniority(val){
    if (val == null) return null;
    const s = String(val).trim();
    // HH:MM
    const m = s.match(/^\s*(\d+)\s*:\s*([0-5]?\d)\s*$/);
    if (m) return Number(m[1]) + Number(m[2])/60;
    const s2 = s.replace(/,/g,'');
    const num = parseFloat(s2);
    if (!isNaN(num)) return num;
    const m2 = s2.match(/^\s*([\d\.]+)/);
    if (m2) {
      const n = parseFloat(m2[1]);
      return isNaN(n) ? null : n;
    }
    return null;
  }

  function splitName(n){
    if (!n) return {firstName:'', lastName:''};
    const s = String(n).trim();
    if (s.includes(',')){
      const [last, first] = s.split(',',1).concat(s.split(',').slice(1).join(',')).map(x=>x.trim());
      return { firstName: first || '', lastName: last || '' };
    }
    const parts = s.split(/\s+/);
    if (parts.length === 1) return { firstName: parts[0], lastName: '' };
    return { firstName: parts.slice(0,-1).join(' '), lastName: parts.slice(-1)[0] };
  }

  function detectColumn(cols, variants){
    const lower = cols.map(c => c.toLowerCase());
    for (const v of variants){
      const i = lower.findIndex(c => c.includes(v));
      if (i !== -1) return cols[i];
    }
    return null;
  }

  const localGenerateId = generateId;

  function normalizeEmployeeId(value){
    if (value == null) return '';
    return String(value).trim();
  }

  function normalizeComposite(lastName, firstName, role){
    const parts = [lastName, firstName, role].map(part => (part == null ? '' : String(part).trim().toLowerCase()));
    return parts.join('|');
  }

  async function importFromRows(rows){
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('No rows detected.');

    const header = Object.keys(rows[0]);
    const nameCol      = detectColumn(header, ['name','employee name','emp name','employee']);
    const seniorityCol = detectColumn(header, ['seniority hours','seniority','hours']);
    const empidCol     = detectColumn(header, ['employee id','emp id','id']);
    const statusCol    = detectColumn(header, ['status']);
    const roleCol      = detectColumn(header, ['role','position','title']);
    const etypeCol     = detectColumn(header, ['employment type','type','ft','pt','casual']);
    const wingCol      = detectColumn(header, ['wing','unit','department','dept']);
    const startCol     = detectColumn(header, ['start date','hire date','seniority date']);

    const db = await ensureDb();
    await db.open();

    const existingEmployees = await db.employees.toArray();
    const existingByEmployeeId = new Map();
    const existingByComposite = new Map();

    for (const existing of existingEmployees){
      const employeeIdKey = normalizeEmployeeId(existing.employeeId);
      if (employeeIdKey) {
        const key = employeeIdKey.toLowerCase();
        if (!existingByEmployeeId.has(key)) {
          existingByEmployeeId.set(key, existing);
        }
      }
      const compositeKey = normalizeComposite(existing.lastName, existing.firstName, existing.role);
      if (compositeKey && !existingByComposite.has(compositeKey)) {
        existingByComposite.set(compositeKey, existing);
      }
    }

    const timestamp = new Date().toISOString();
    const employees = [];
    const newEmployeeIds = new Set();

    for (const r of rows){
      const nameVal = nameCol ? r[nameCol] : (r['Name'] ?? r['Employee'] ?? '');
      const { firstName, lastName } = splitName(nameVal);
      const sh = seniorityCol ? parseSeniority(r[seniorityCol]) : null;

      const idVal = empidCol ? r[empidCol] : null;
      const employeeIdValue = normalizeEmployeeId(idVal);
      const employeeIdKey = employeeIdValue ? employeeIdValue.toLowerCase() : '';
      const compositeKey = normalizeComposite(lastName, firstName, roleCol ? (r[roleCol] ?? null) : null);

      let existingMatch = null;
      if (employeeIdKey && existingByEmployeeId.has(employeeIdKey)) {
        existingMatch = existingByEmployeeId.get(employeeIdKey);
      } else if (compositeKey && existingByComposite.has(compositeKey)) {
        existingMatch = existingByComposite.get(compositeKey);
      }

      const isExisting = Boolean(existingMatch);
      const id = isExisting ? existingMatch.id : (employeeIdValue || localGenerateId());
      const roleValue = roleCol ? (r[roleCol] ?? null) : null;
      const rawEmploymentType = etypeCol ? r[etypeCol] : undefined;
      const employmentTypeValue = rawEmploymentType == null ? null : String(rawEmploymentType).trim().toUpperCase();
      const statusValue = String(statusCol ? (r[statusCol] ?? 'ACTIVE') : 'ACTIVE').toUpperCase();

      const meta = { ...(existingMatch?.meta || {}) };
      meta.sourceName = nameVal ?? null;
      if (wingCol) {
        meta.wing = r[wingCol] ?? null;
      }
      if (startCol) {
        meta.startDate = r[startCol] ?? null;
      }

      const employee = {
        ...(existingMatch || {}),
        id,
        employeeId: employeeIdValue || null,
        firstName,
        lastName,
        role: roleValue,
        employmentType: employmentTypeValue,
        status: statusValue,
        seniorityHours: sh,
        meta,
        updatedAt: timestamp
      };

      if (!employee.createdAt) {
        employee.createdAt = timestamp;
      }

      employees.push(employee);

      if (!isExisting) {
        newEmployeeIds.add(id);
      }

      if (employeeIdKey && !existingByEmployeeId.has(employeeIdKey)) {
        existingByEmployeeId.set(employeeIdKey, employee);
      }
      if (compositeKey && !existingByComposite.has(compositeKey)) {
        existingByComposite.set(compositeKey, employee);
      }
    }

    // Sort by seniority desc
    employees.sort((a,b)=>{
      const aa = a.seniorityHours; const bb = b.seniorityHours;
      if (aa == null && bb == null) return (a.lastName||'').localeCompare(b.lastName||'') || (a.firstName||'').localeCompare(b.firstName||'');
      if (aa == null) return 1;
      if (bb == null) return -1;
      if (bb !== aa) return bb - aa;
      return (a.lastName||'').localeCompare(b.lastName||'') || (a.firstName||'').localeCompare(b.firstName||'');
    });

    // Write to DB
    const newlyCreatedEmployees = employees.filter(emp => newEmployeeIds.has(emp.id));

    await db.transaction('readwrite', db.employees, db.employeeRequirements, db.requirements, db.roleRequirementProfiles, async () => {
      if (typeof db.employees.bulkPut === 'function') {
        await db.employees.bulkPut(employees);
      } else {
        for (const emp of employees) {
          await db.employees.put(emp);
        }
      }

      if (!newlyCreatedEmployees.length) {
        return;
      }

      const requirements = await db.requirements.toArray();
      if (!requirements.length) {
        return;
      }

      const {
        fetchTemplateIndex,
        resolveTemplateForRole,
        determineStatusForTemplate,
        generateId
      } = await import('./commands.js');
      const { roleIndex } = await fetchTemplateIndex(db);

      const employeeRequirementRows = [];
      for (const employee of newlyCreatedEmployees) {
        const template = resolveTemplateForRole(employee.role, roleIndex);
        for (const requirement of requirements) {
          employeeRequirementRows.push({
            id: generateId(),
            employeeId: employee.id,
            requirementId: requirement.id,
            status: determineStatusForTemplate(template, requirement.id),
            completedOn: null,
            expiresOn: null,
            notes: null,
            updatedAt: timestamp
          });
        }
      }

      if (employeeRequirementRows.length) {
        await db.employeeRequirements.bulkAdd(employeeRequirementRows);
      }
    });
    return employees.length;
  }

  async function parseFile(file){
    const name = file.name.toLowerCase();
    if (name.endsWith('.json')){
      const text = await file.text();
      const payload = JSON.parse(text);
      if (Array.isArray(payload.employees)) {
        // Already in our shape
        return payload.employees;
      }
      if (Array.isArray(payload)){
        return payload;
      }
      throw new Error('JSON file must contain an array or {employees: []}');
    }
    // CSV path
    if (!Papa){
      throw new Error('PapaParse not loaded; CSV import unavailable.');
    }
    return new Promise((resolve, reject)=>{
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res)=> resolve(res.data),
        error: (err)=> reject(err)
      });
    });
  }

  async function handleImport(input){
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const rows = await parseFile(file);
      const count = await importFromRows(rows);
      alert(`Imported ${count} employees.`);
      toggleImportModal(false);
    } catch (e) {
      console.error('Import failed:', e);
      alert(`Import failed: ${e.message || e}`);
    } finally {
      input.value = '';
    }
  }

  // Wire button and modal
  window.__initImportUI = function(){
    const btn = document.getElementById('import-btn');
    const fileInput = document.getElementById('file-upload');

    if (btn && !btn.dataset.importHelperBound){
      btn.dataset.importHelperBound = 'true';
      btn.addEventListener('click', ()=>{
        if (!toggleImportModal(true)){
          console.warn('Import modal could not be opened — element not found.');
        }
      });
    }

    if (fileInput && !fileInput.dataset.importHelperBound){
      fileInput.dataset.importHelperBound = 'true';
      fileInput.addEventListener('change', ()=>{
        if (!isAlpineReady()){
          handleImport(fileInput);
        }
      });
    }
  };
})();
