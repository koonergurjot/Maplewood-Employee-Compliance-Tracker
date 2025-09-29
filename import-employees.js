
/**
 * Client-side importer for Employees.
 * - Supports CSV or JSON files via <input type="file">.
 * - Auto-detects columns (Name, Employee ID, Seniority Hours, Status, Role, Employment Type, Wing/Unit, Start/Hire Date).
 * - Sorts by seniority hours (desc) before writing to IndexedDB (Dexie).
 * - Requires Dexie and PapaParse to be available globally.
 */
(function(){
  const DexieRef = window.Dexie;
  if (!DexieRef) {
    console.warn("Dexie not found; import will fail until Dexie loads.");
  }

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

        modal.querySelectorAll('[\@click="showImportModal=false"]').forEach((el) => {
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

  function ensureDb(){
    const db = new DexieRef('ComplianceMatrixDB');
    db.version(8).stores({
      employees:'id, lastName, firstName, role, employmentType, status, employeeId, seniorityHours',
      requirements:'id, name, defaultExpiryDays, color',
      employeeRequirements:'id, [employeeId+requirementId], status, completedOn, expiresOn, notes',
      settings:'id',
      activityLog:'id,timestamp,actionType'
    });
    return db;
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

    const employees = rows.map((r, idx) => {
      const nameVal = nameCol ? r[nameCol] : (r['Name'] ?? r['Employee'] ?? '');
      const { firstName, lastName } = splitName(nameVal);
      const sh = seniorityCol ? parseSeniority(r[seniorityCol]) : null;

      const idVal = empidCol ? r[empidCol] : null;
      const id = (idVal != null && String(idVal).trim() !== '') ? String(idVal) : `emp-${idx+1}`;

      return {
        id,
        employeeId: idVal != null ? String(idVal) : null,
        firstName,
        lastName,
        role: roleCol ? (r[roleCol] ?? null) : null,
        employmentType: etypeCol ? String(r[etypeCol] ?? '').toUpperCase() || null : null,
        status: String(statusCol ? (r[statusCol] ?? 'ACTIVE') : 'ACTIVE').toUpperCase(),
        seniorityHours: sh,
        meta: {
          sourceName: nameVal ?? null,
          wing: wingCol ? (r[wingCol] ?? null) : null,
          startDate: startCol ? (r[startCol] ?? null) : null
        }
      };
    });

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
    const db = ensureDb();
    await db.open();
    await db.transaction('readwrite', db.employees, async () => {
      for (const emp of employees){
        await db.employees.put(emp);
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
    if (!window.Papa){
      throw new Error('PapaParse not loaded; CSV import unavailable.');
    }
    return new Promise((resolve, reject)=>{
      window.Papa.parse(file, {
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
