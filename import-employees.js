import Papa from 'papaparse';

import { createDatabase, ensureDexieLoaded, generateId, BULK_OPERATION_CHUNK_SIZE, chunkArray } from './db.js';

/**
 * Client-side importer for Employees.
 * - Supports CSV or JSON files via <input type="file">.
 * - Auto-detects columns (Name, Employee ID, Seniority Hours, Status, Role, Employment Type, Wing/Unit, Start/Hire Date).
 * - Sorts by seniority hours (desc) before writing to IndexedDB (Dexie).
 * - Uses Dexie and PapaParse modules provided via the bundled build.
*/
(function(){
  function getAppStore(){
    if (!window.Alpine || typeof window.Alpine.store !== 'function'){
      return null;
    }
    try {
      return Alpine.store('app');
    } catch (error) {
      return null;
    }
  }

  function isAlpineReady(){
    return Boolean(getAppStore());
  }

  function toggleImportModal(open){
    const store = getAppStore();
    if (store){
      store.showImportModal = Boolean(open);
      return true;
    }
    return false;
  }

  let legacySpinnerCache = null;
  function getLegacySpinnerElements(){
    if (legacySpinnerCache) return legacySpinnerCache;
    if (typeof document === 'undefined') {
      return { container: null, text: null };
    }

    const input = document.getElementById('file-upload');
    if (!input) {
      return { container: null, text: null };
    }

    const container = input.closest('.space-y-1')?.querySelector('.flex.items-center.justify-center');
    if (!container) {
      return { container: null, text: null };
    }

    const text = container.querySelector('[data-import-spinner-text]') || container.querySelector('span');

    if (container) {
      container.dataset.importSpinner = 'true';
    }
    if (text) {
      if (!text.dataset.originalText) {
        const base = text.textContent?.trim() || 'Processing file...';
        text.dataset.originalText = base;
      }
      text.dataset.importSpinnerText = 'true';
    }

    legacySpinnerCache = { container, text };
    return legacySpinnerCache;
  }

  function setLegacySpinnerVisible(visible){
    const { container } = getLegacySpinnerElements();
    if (!container) return;
    container.style.display = visible ? 'flex' : 'none';
  }

  function updateLegacySpinnerText(percent){
    const { text } = getLegacySpinnerElements();
    if (!text) return;
    const base = text.dataset.originalText || text.textContent?.trim() || 'Processing file...';
    text.dataset.originalText = base;

    if (typeof percent === 'number' && Number.isFinite(percent)) {
      const clamped = Math.max(0, Math.min(100, Math.round(percent)));
      text.textContent = `${base} ${clamped}%`;
    } else {
      text.textContent = base;
    }
  }

  function createLegacyProgressReporter(){
    return {
      idle(){
        setLegacySpinnerVisible(true);
        updateLegacySpinnerText(null);
      },
      start(){
        setLegacySpinnerVisible(true);
        updateLegacySpinnerText(0);
      },
      update(percent){
        updateLegacySpinnerText(percent);
      },
      finish(){
        updateLegacySpinnerText(null);
        setLegacySpinnerVisible(false);
      }
    };
  }

  async function ensureDb(){
    await ensureDexieLoaded();
    return await createDatabase();
  }

  function normalizeSeniorityHours(val){
    if (typeof val === 'number' && Number.isFinite(val)) {
      return val;
    }
    if (val == null) return 0;
    const s = String(val).trim();
    if (!s) return 0;

    // HH:MM format
    const hhmmMatch = s.match(/^(\d+)\s*:\s*([0-5]?\d)$/);
    if (hhmmMatch) {
      const hours = Number(hhmmMatch[1]);
      const minutes = Number(hhmmMatch[2]);
      if (!Number.isNaN(hours) && !Number.isNaN(minutes)) {
        return hours + minutes / 60;
      }
    }

    const stripped = s.replace(/,/g, '').replace(/\s+/g, '');
    let numericCandidate = Number(stripped);
    if (!Number.isNaN(numericCandidate)) {
      return numericCandidate;
    }

    const leadingNumeric = stripped.match(/^-?\d+(?:\.\d+)?/);
    if (leadingNumeric) {
      numericCandidate = Number(leadingNumeric[0]);
      if (!Number.isNaN(numericCandidate)) {
        return numericCandidate;
      }
    }

    return 0;
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

  function normalizeHeader(value){
    if (value == null) return '';
    let normalized = String(value).toLowerCase();
    normalized = normalized.replace(/[#]+/g, ' number ');
    normalized = normalized.replace(/&/g, ' and ');
    normalized = normalized.replace(/hrs?\b/g, 'hours');
    normalized = normalized.replace(/senor/gi, 'senior');
    normalized = normalized.replace(/senority/gi, 'seniority');
    normalized = normalized.replace(/emp\b/g, 'employee');
    normalized = normalized.replace(/[^a-z0-9\s]+/g, ' ');
    normalized = normalized.replace(/\s+/g, ' ').trim();
    return normalized;
  }

  function tokenize(normalized){
    if (!normalized) return [];
    return normalized.split(' ').filter(Boolean);
  }

  function levenshtein(a, b){
    if (a === b) return 0;
    const aLen = a.length;
    const bLen = b.length;
    if (!aLen) return bLen;
    if (!bLen) return aLen;
    const matrix = new Array(aLen + 1);
    for (let i = 0; i <= aLen; i++){
      matrix[i] = new Array(bLen + 1);
      matrix[i][0] = i;
    }
    for (let j = 0; j <= bLen; j++){
      matrix[0][j] = j;
    }
    for (let i = 1; i <= aLen; i++){
      const aChar = a.charCodeAt(i - 1);
      for (let j = 1; j <= bLen; j++){
        const cost = aChar === b.charCodeAt(j - 1) ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
    return matrix[aLen][bLen];
  }

  const missingColumnEventName = 'employee-import:missing-columns';

  function updateMissingColumnsBanner(columns){
    try {
      const event = new CustomEvent(missingColumnEventName, { detail: { columns } });
      window.dispatchEvent(event);
    } catch (err) {
      console.warn('Failed to dispatch missing column event', err);
    }

    const banner = document.querySelector('[data-import-missing-columns]');
    if (!banner) return;
    if (banner.dataset && banner.dataset.managedBy === 'alpine') return;

    if (!columns.length){
      banner.style.display = 'none';
      banner.textContent = '';
      return;
    }

    banner.style.display = 'block';
    const label = columns.join(', ');
    banner.textContent = `Missing required columns: ${label}. Please review the field mapping.`;
  }

  function detectColumn(cols, { variants = [], preferredTokens = [], minScore = 80 } = {}){
    if (!Array.isArray(cols) || !cols.length) return null;

    const processed = cols.map((orig) => {
      const normalized = normalizeHeader(orig);
      return {
        orig,
        normalized,
        tokens: tokenize(normalized)
      };
    });

    const normalizedVariants = variants.map((value) => {
      const normalized = normalizeHeader(value);
      return {
        value,
        normalized,
        tokens: tokenize(normalized)
      };
    });

    let bestMatch = null;
    let bestScore = -Infinity;

    for (const col of processed){
      if (!col.normalized) continue;
      let scoreForColumn = 0;

      for (const variant of normalizedVariants){
        if (!variant.normalized) continue;

        if (col.normalized === variant.normalized){
          scoreForColumn = Math.max(scoreForColumn, 100);
          continue;
        }

        if (
          variant.tokens.length > 1 &&
          variant.tokens.every((token) => col.tokens.includes(token))
        ){
          scoreForColumn = Math.max(scoreForColumn, 92);
          continue;
        }

        if (
          variant.normalized.length >= 4 &&
          col.normalized.includes(variant.normalized)
        ){
          scoreForColumn = Math.max(scoreForColumn, 88);
          continue;
        }

        if (
          variant.tokens.length &&
          variant.tokens.every((token) => col.tokens.some((ct) => ct.startsWith(token) || ct.endsWith(token)))
        ){
          scoreForColumn = Math.max(scoreForColumn, 85);
          continue;
        }

        const threshold = Math.min(2, Math.ceil(Math.max(col.normalized.length, variant.normalized.length) * 0.25));
        const distance = levenshtein(col.normalized, variant.normalized);
        if (distance && distance <= threshold){
          scoreForColumn = Math.max(scoreForColumn, 75 - distance);
        }
      }

      if (scoreForColumn > 0 && preferredTokens.length){
        const tokenBonus = preferredTokens.reduce((acc, token) => (
          col.tokens.some((ct) => ct === token || ct.startsWith(token)) ? acc + 3 : acc
        ), 0);
        scoreForColumn += tokenBonus;
      }

      if (scoreForColumn > bestScore){
        bestScore = scoreForColumn;
        bestMatch = col.orig;
      }
    }

    if (bestScore >= minScore){
      return bestMatch;
    }
    return null;
  }

  const localGenerateId = generateId;

  function normalizeEmployeeId(value){
    if (value == null) return '';
    return String(value).trim();
  }

  function normalizeComposite(lastName, firstName){
    const normalizePart = value => (value == null ? '' : String(value).trim().toLowerCase());
    const last = normalizePart(lastName);
    const first = normalizePart(firstName);
    if (!last && !first) {
      return '';
    }
    return `${last}|${first}`;
  }

  function buildEmployeeKey(employeeIdValue, lastName, firstName) {
    const normalizedId = normalizeEmployeeId(employeeIdValue);
    if (normalizedId) {
      return `id:${normalizedId.toLowerCase()}`;
    }

    const composite = normalizeComposite(lastName, firstName);
    if (composite) {
      return `name:${composite}`;
    }

    return '';
  }

  async function importFromRows(rows, { onProgress } = {}){
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('No rows detected.');

    const header = Object.keys(rows[0]);
    const nameCol = detectColumn(header, {
      variants: [
        'employee name',
        'emp name',
        'employee',
        'staff name',
        'team member name',
        'associate name',
        'payroll name',
        'full name',
        'name'
      ],
      preferredTokens: ['employee', 'name']
    });
    const seniorityCol = detectColumn(header, {
      variants: [
        'seniority hours',
        'total seniority hours',
        'seniority hrs',
        'seniority hour',
        'sen hours',
        'seniority total',
        'seniority time',
        'seniority',
        'hours'
      ],
      preferredTokens: ['seniority', 'senior', 'hours'],
      minScore: 82
    });
    const empidCol = detectColumn(header, {
      variants: [
        'employee id',
        'employee number',
        'employee #',
        'employee code',
        'employee identifier',
        'position id',
        'position number',
        'personnel id',
        'emp id',
        'id number',
        'id'
      ],
      preferredTokens: ['employee', 'id', 'number'],
      minScore: 82
    });
    const statusCol    = detectColumn(header, ['status']);
    const roleCol      = detectColumn(header, ['role','position','title']);
    const etypeCol     = detectColumn(header, ['employment type','type','ft','pt','casual']);
    const wingCol      = detectColumn(header, ['wing','unit','department','dept']);
    const startCol     = detectColumn(header, ['start date','hire date','seniority date']);

    updateMissingColumnsBanner([]);

    const missingRequired = [];
    if (!nameCol) missingRequired.push('Name');
    if (!empidCol) missingRequired.push('Employee ID');
    if (!seniorityCol) missingRequired.push('Seniority Hours');

    if (missingRequired.length){
      updateMissingColumnsBanner(missingRequired);
    }

    const db = await ensureDb();
    await db.open();

    const existingEmployees = await db.employees.toArray();
    const existingByEmployeeId = new Map();
    const existingByName = new Map();

    for (const existing of existingEmployees){
      const employeeIdKey = normalizeEmployeeId(existing.employeeId);
      if (employeeIdKey) {
        const key = employeeIdKey.toLowerCase();
        if (!existingByEmployeeId.has(key)) {
          existingByEmployeeId.set(key, existing);
        }
      }
      const compositeKey = normalizeComposite(existing.lastName, existing.firstName);
      if (compositeKey && !existingByName.has(compositeKey)) {
        existingByName.set(compositeKey, existing);
      }
    }

    const timestamp = new Date().toISOString();
    const employees = [];
    const newEmployeeIds = new Set();
    const seenImportKeys = new Set();

    for (const r of rows){
      const nameVal = nameCol ? r[nameCol] : (r['Name'] ?? r['Employee'] ?? '');
      const { firstName, lastName } = splitName(nameVal);

      const idVal = empidCol ? r[empidCol] : null;
      const employeeIdValue = normalizeEmployeeId(idVal);
      const employeeIdKey = employeeIdValue ? employeeIdValue.toLowerCase() : '';
      const roleRaw = roleCol ? (r[roleCol] ?? null) : null;
      const compositeKey = normalizeComposite(lastName, firstName);

      const importKey = buildEmployeeKey(employeeIdValue, lastName, firstName);
      if (importKey) {
        if (seenImportKeys.has(importKey)) {
          continue;
        }
        seenImportKeys.add(importKey);
      }

      let existingMatch = null;
      if (employeeIdKey && existingByEmployeeId.has(employeeIdKey)) {
        existingMatch = existingByEmployeeId.get(employeeIdKey);
      } else if (compositeKey && existingByName.has(compositeKey)) {
        existingMatch = existingByName.get(compositeKey);
      }

      const shSource = seniorityCol ? r[seniorityCol] : existingMatch?.seniorityHours;
      const sh = normalizeSeniorityHours(shSource);

      const isExisting = Boolean(existingMatch);
      const id = isExisting ? existingMatch.id : (employeeIdValue || localGenerateId());
      const roleValue = roleRaw;
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
      if (compositeKey && !existingByName.has(compositeKey)) {
        existingByName.set(compositeKey, employee);
      }
    }

    // Sort by seniority desc
    employees.sort((a,b)=>{
      const aa = normalizeSeniorityHours(a.seniorityHours);
      const bb = normalizeSeniorityHours(b.seniorityHours);
      if (bb !== aa) return bb - aa;
      return (a.lastName||'').localeCompare(b.lastName||'') || (a.firstName||'').localeCompare(b.firstName||'');
    });

    // Write to DB
    const newlyCreatedEmployees = employees.filter(emp => newEmployeeIds.has(emp.id));

    const progressCallback = typeof onProgress === 'function' ? onProgress : null;
    const progressState = {
      processed: 0,
      total: Math.max(employees.length, 1)
    };
    const reportProgress = () => {
      if (!progressCallback) return;
      const ratio = progressState.total ? Math.min(1, progressState.processed / progressState.total) : 1;
      progressCallback(Math.round(ratio * 100));
    };
    const addProcessed = amount => {
      if (!Number.isFinite(amount) || amount <= 0) return;
      progressState.processed += amount;
      reportProgress();
    };

    reportProgress();

    await db.transaction('rw', db.employees, db.employeeRequirements, db.requirements, db.roleRequirementProfiles, async () => {
      let requirements = [];

      if (newlyCreatedEmployees.length) {
        requirements = await db.requirements.toArray();
        if (requirements.length) {
          progressState.total = Math.max(progressState.total, employees.length + newlyCreatedEmployees.length * requirements.length);
          reportProgress();
        }
      }

      if (typeof db.employees.bulkPut === 'function') {
        for (const chunk of chunkArray(employees, BULK_OPERATION_CHUNK_SIZE)) {
          if (!chunk?.length) continue;
          await db.employees.bulkPut(chunk);
          addProcessed(chunk.length);
        }
      } else {
        for (const emp of employees) {
          await db.employees.put(emp);
          addProcessed(1);
        }
      }

      if (!newlyCreatedEmployees.length || !requirements.length) {
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

      if (!employeeRequirementRows.length) {
        return;
      }

      if (typeof db.employeeRequirements.bulkAdd === 'function') {
        for (const chunk of chunkArray(employeeRequirementRows, BULK_OPERATION_CHUNK_SIZE)) {
          if (!chunk?.length) continue;
          await db.employeeRequirements.bulkAdd(chunk);
          addProcessed(chunk.length);
        }
      } else {
        for (const row of employeeRequirementRows) {
          await db.employeeRequirements.add(row);
          addProcessed(1);
        }
      }
    });

    progressCallback?.(100);
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
    const progressReporter = !isAlpineReady() ? createLegacyProgressReporter() : null;
    let progressFinished = false;
    try {
      if (progressReporter){
        progressReporter.idle();
      }
      const rows = await parseFile(file);
      if (progressReporter){
        progressReporter.start();
      }
      const count = await importFromRows(rows, {
        onProgress: progressReporter ? (value => progressReporter.update(value)) : undefined
      });
      if (progressReporter){
        progressReporter.finish();
        progressFinished = true;
      }
      alert(`Imported ${count} employees.`);
      toggleImportModal(false);
    } catch (e) {
      console.error('Import failed:', e);
      alert(`Import failed: ${e.message || e}`);
    } finally {
      if (progressReporter && !progressFinished){
        progressReporter.finish();
      }
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
      if (!isAlpineReady()){
        setLegacySpinnerVisible(false);
      }
    }
  };
})();
