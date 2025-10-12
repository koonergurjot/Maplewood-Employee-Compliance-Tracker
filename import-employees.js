import Papa from 'papaparse';

import { createDatabase, ensureDexieLoaded, generateId, BULK_OPERATION_CHUNK_SIZE, chunkArray } from './db.js';
import { trapFocusWithin, getFocusableElements } from './a11y-utils.js';

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

  function extractHeaders(rows){
    if (!Array.isArray(rows) || !rows.length) return [];
    const headerSet = new Set();
    for (const row of rows){
      if (row && typeof row === 'object'){
        for (const key of Object.keys(row)){
          headerSet.add(key);
        }
      }
    }
    return Array.from(headerSet);
  }

  function buildDefaultMapping(headers){
    const mapping = {};
    mapping.fullName = detectColumn(headers, {
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
    mapping.firstName = detectColumn(headers, {
      variants: ['first name', 'first', 'given name', 'fname'],
      preferredTokens: ['first', 'given'],
      minScore: 84
    });
    mapping.lastName = detectColumn(headers, {
      variants: ['last name', 'surname', 'family name', 'lname'],
      preferredTokens: ['last', 'surname', 'family'],
      minScore: 84
    });
    mapping.employeeId = detectColumn(headers, {
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
    mapping.status = detectColumn(headers, ['status']);
    mapping.role = detectColumn(headers, ['role', 'position', 'title']);
    mapping.employmentType = detectColumn(headers, ['employment type', 'type', 'ft', 'pt', 'casual']);
    mapping.wing = detectColumn(headers, ['wing', 'unit', 'department', 'dept']);
    mapping.startDate = detectColumn(headers, ['start date', 'hire date', 'seniority date']);
    mapping.seniorityHours = detectColumn(headers, {
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
    return mapping;
  }

  function validateMappingSelection(mapping, headers){
    const errors = [];
    const headerSet = new Set(headers);
    const hasEmployeeId = Boolean(mapping.employeeId);
    const hasNamePair = Boolean(mapping.firstName && mapping.lastName);

    if (!hasEmployeeId && !hasNamePair){
      errors.push('Map Employee ID or both First Name and Last Name.');
    }

    if (!mapping.status){
      errors.push('Map a Status column.');
    }

    for (const [key, value] of Object.entries(mapping)){
      if (!value) continue;
      if (!headerSet.has(value)){
        errors.push(`Column "${value}" is not present in the uploaded file.`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  function renderMappingModal(headers, defaultMapping){
    return new Promise((resolve) => {
      const previouslyFocused = typeof document !== 'undefined' ? document.activeElement : null;
      let releaseFocusTrap = null;
      let cleaned = false;

      const overlay = document.createElement('div');
      overlay.className = 'import-mapping-overlay';
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.background = 'rgba(17, 24, 39, 0.6)';
      overlay.style.zIndex = '9999';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';

      const modal = document.createElement('div');
      modal.className = 'import-mapping-modal card';
      modal.style.background = 'var(--card, #fff)';
      modal.style.color = 'inherit';
      modal.style.maxWidth = '640px';
      modal.style.width = '100%';
      modal.style.margin = '1.5rem';
      modal.style.borderRadius = '0.75rem';
      modal.style.boxShadow = '0 20px 50px rgba(15,23,42,0.25)';
      modal.style.padding = '1.5rem';
      modal.style.maxHeight = '90vh';
      modal.style.overflowY = 'auto';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'import-mapping-title');
      modal.setAttribute('aria-describedby', 'import-mapping-description');

      const mapping = { ...defaultMapping };

      const fields = [
        { key: 'employeeId', label: 'Employee ID', helper: 'Required unless First & Last Name are mapped.' },
        { key: 'firstName', label: 'First Name', helper: 'Required when Last Name is mapped and Employee ID is missing.' },
        { key: 'lastName', label: 'Last Name' },
        { key: 'fullName', label: 'Full Name', helper: 'Used to split into First/Last when available.' },
        { key: 'status', label: 'Status', helper: 'Required' },
        { key: 'seniorityHours', label: 'Seniority Hours' },
        { key: 'role', label: 'Role / Position' },
        { key: 'employmentType', label: 'Employment Type' },
        { key: 'wing', label: 'Wing / Unit' },
        { key: 'startDate', label: 'Start / Hire Date' }
      ];

      const title = document.createElement('h2');
      title.textContent = 'Step 1: Map Columns';
      title.style.fontSize = '1.25rem';
      title.style.fontWeight = '600';
      title.style.marginBottom = '1rem';
      title.id = 'import-mapping-title';
      title.tabIndex = -1;
      title.setAttribute('data-modal-initial-focus', 'true');

      const description = document.createElement('p');
      description.textContent = 'Review detected fields and adjust the mapping before importing.';
      description.style.fontSize = '0.95rem';
      description.style.marginBottom = '1.25rem';
      description.style.color = 'var(--muted, #6b7280)';
      description.id = 'import-mapping-description';

      const table = document.createElement('div');
      table.style.display = 'grid';
      table.style.gridTemplateColumns = '1fr 1fr';
      table.style.gap = '0.75rem 1rem';
      table.style.marginBottom = '1.5rem';

      for (const field of fields){
        const label = document.createElement('div');
        label.style.display = 'flex';
        label.style.flexDirection = 'column';

        const nameEl = document.createElement('span');
        nameEl.textContent = field.label;
        nameEl.style.fontWeight = '600';
        nameEl.style.fontSize = '0.95rem';
        label.appendChild(nameEl);

        if (field.helper){
          const helper = document.createElement('span');
          helper.textContent = field.helper;
          helper.style.fontSize = '0.75rem';
          helper.style.color = 'var(--muted, #6b7280)';
          label.appendChild(helper);
        }

        const selectWrapper = document.createElement('div');
        selectWrapper.style.display = 'flex';
        selectWrapper.style.alignItems = 'center';

        const select = document.createElement('select');
        select.setAttribute('data-field-key', field.key);
        select.style.width = '100%';
        select.style.padding = '0.5rem';
        select.style.borderRadius = '0.5rem';
        select.style.border = '1px solid var(--line, #d1d5db)';
        select.style.background = 'var(--card, #fff)';
        select.style.color = 'inherit';

        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = '— Unmapped —';
        select.appendChild(blank);

        for (const header of headers){
          const option = document.createElement('option');
          option.value = header;
          option.textContent = header;
          select.appendChild(option);
        }

        if (mapping[field.key]){
          select.value = mapping[field.key];
        }

        select.addEventListener('change', (event) => {
          const key = event.target.getAttribute('data-field-key');
          mapping[key] = event.target.value || '';
        });

        table.appendChild(label);
        table.appendChild(selectWrapper);
        selectWrapper.appendChild(select);
      }

      const errorsPanel = document.createElement('div');
      errorsPanel.style.marginBottom = '1rem';
      errorsPanel.style.padding = '0.75rem';
      errorsPanel.style.borderRadius = '0.5rem';
      errorsPanel.style.display = 'none';
      errorsPanel.style.border = '1px solid var(--danger, #f87171)';
      errorsPanel.style.background = 'rgba(248,113,113,0.12)';
      errorsPanel.style.color = 'var(--danger, #b91c1c)';

      const errorsList = document.createElement('ul');
      errorsList.style.listStyle = 'disc';
      errorsList.style.marginLeft = '1.5rem';
      errorsList.style.fontSize = '0.85rem';
      errorsPanel.appendChild(errorsList);

      const successPanel = document.createElement('div');
      successPanel.style.marginBottom = '1rem';
      successPanel.style.padding = '0.75rem';
      successPanel.style.borderRadius = '0.5rem';
      successPanel.style.display = 'none';
      successPanel.style.border = '1px solid var(--success, #34d399)';
      successPanel.style.background = 'rgba(16,185,129,0.12)';
      successPanel.style.color = 'var(--success, #047857)';
      successPanel.textContent = 'All required fields are mapped. You can continue.';

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.justifyContent = 'flex-end';
      actions.style.gap = '0.75rem';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.className = 'btn';
      cancelBtn.addEventListener('click', () => {
        cleanup();
        resolve(null);
      });

      const validateBtn = document.createElement('button');
      validateBtn.type = 'button';
      validateBtn.textContent = 'Validate';
      validateBtn.className = 'btn';

      const continueBtn = document.createElement('button');
      continueBtn.type = 'button';
      continueBtn.textContent = 'Continue';
      continueBtn.className = 'btn btn-accent';
      continueBtn.disabled = true;

      function updatePanels(result){
        if (!result){
          errorsPanel.style.display = 'none';
          successPanel.style.display = 'none';
          continueBtn.disabled = true;
          return;
        }

        if (result.valid){
          errorsPanel.style.display = 'none';
          successPanel.style.display = 'block';
          continueBtn.disabled = false;
        } else {
          successPanel.style.display = 'none';
          errorsPanel.style.display = 'block';
          continueBtn.disabled = true;
          errorsList.innerHTML = '';
          for (const err of result.errors){
            const li = document.createElement('li');
            li.textContent = err;
            errorsList.appendChild(li);
          }
        }
      }

      const handleKeydown = (event) => {
        if(event.key === 'Escape'){
          event.preventDefault();
          cleanup();
          resolve(null);
        }
      };

      function restoreFocus(){
        if(!previouslyFocused || typeof previouslyFocused.focus !== 'function'){
          return;
        }
        if(typeof document !== 'undefined' && typeof document.contains === 'function' && !document.contains(previouslyFocused)){
          return;
        }
        requestAnimationFrame(() => {
          try {
            previouslyFocused.focus({ preventScroll: true });
          } catch (error) {
            previouslyFocused.focus();
          }
        });
      }

      function cleanup(){
        if(cleaned) return;
        cleaned = true;
        if(releaseFocusTrap){
          releaseFocusTrap();
          releaseFocusTrap = null;
        }
        document.removeEventListener('keydown', handleKeydown);
        overlay.remove();
        document.body.style.overflow = '';
        restoreFocus();
      }

      validateBtn.addEventListener('click', () => {
        const result = validateMappingSelection(mapping, headers);
        updatePanels(result);
        updateMissingColumnsBanner(result && !result.valid ? result.errors : []);
      });

      continueBtn.addEventListener('click', () => {
        const result = validateMappingSelection(mapping, headers);
        if (!result.valid){
          updatePanels(result);
          return;
        }
        cleanup();
        resolve({ ...mapping });
      });

      actions.appendChild(cancelBtn);
      actions.appendChild(validateBtn);
      actions.appendChild(continueBtn);

      modal.appendChild(title);
      modal.appendChild(description);
      modal.appendChild(table);
      modal.appendChild(errorsPanel);
      modal.appendChild(successPanel);
      modal.appendChild(actions);

      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', handleKeydown);

      releaseFocusTrap = trapFocusWithin(modal);
      const initialFocus = modal.querySelector('[data-modal-initial-focus]') || getFocusableElements(modal)[0] || modal;
      if(initialFocus && typeof initialFocus.focus === 'function'){
        try {
          initialFocus.focus({ preventScroll: true });
        } catch (error) {
          initialFocus.focus();
        }
      }
    });
  }

  async function importFromRows(rows, mapping, headers){
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('No rows detected.');

    const validation = validateMappingSelection(mapping, headers);
    if (!validation.valid){
      throw new Error(validation.errors.join('\n'));
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
    const skippedRows = [];

    const getValue = (row, column) => {
      if (!column) return '';
      return row[column];
    };

    for (let index = 0; index < rows.length; index++){
      const r = rows[index];
      const rowNumber = index + 2; // approximate row number (header row + data)

      let firstName = String(getValue(r, mapping.firstName) ?? '').trim();
      let lastName = String(getValue(r, mapping.lastName) ?? '').trim();
      const fullName = String(getValue(r, mapping.fullName) ?? '').trim();

      if ((!firstName || !lastName) && fullName){
        const split = splitName(fullName);
        if (!firstName){
          firstName = split.firstName;
        }
        if (!lastName){
          lastName = split.lastName;
        }
      }

      const idVal = getValue(r, mapping.employeeId);
      const employeeIdValue = normalizeEmployeeId(idVal);
      const employeeIdKey = employeeIdValue ? employeeIdValue.toLowerCase() : '';
      const roleRaw = getValue(r, mapping.role) ?? null;
      const compositeKey = normalizeComposite(lastName, firstName);

      const importKey = buildEmployeeKey(employeeIdValue, lastName, firstName);
      if (importKey) {
        if (seenImportKeys.has(importKey)) {
          skippedRows.push({ row: rowNumber, reasons: ['Duplicate employee detected in file'] });
          continue;
        }
        seenImportKeys.add(importKey);
      }

      const statusRaw = String(getValue(r, mapping.status) ?? '').trim();
      if (!statusRaw){
        skippedRows.push({ row: rowNumber, reasons: ['Missing status'] });
        continue;
      }

      if (!employeeIdValue && (!firstName || !lastName)){
        skippedRows.push({ row: rowNumber, reasons: ['Missing employee ID and name'] });
        continue;
      }

      let existingMatch = null;
      if (employeeIdKey && existingByEmployeeId.has(employeeIdKey)) {
        existingMatch = existingByEmployeeId.get(employeeIdKey);
      } else if (compositeKey && existingByName.has(compositeKey)) {
        existingMatch = existingByName.get(compositeKey);
      }

      const shSource = mapping.seniorityHours ? r[mapping.seniorityHours] : existingMatch?.seniorityHours;
      const sh = normalizeSeniorityHours(shSource);

      const isExisting = Boolean(existingMatch);
      const id = isExisting ? existingMatch.id : (employeeIdValue || localGenerateId());
      const roleValue = roleRaw;
      const rawEmploymentType = getValue(r, mapping.employmentType);
      const employmentTypeValue = rawEmploymentType == null ? null : String(rawEmploymentType).trim().toUpperCase();
      const statusValue = statusRaw.toUpperCase();

      const meta = { ...(existingMatch?.meta || {}) };
      meta.sourceName = fullName || `${firstName} ${lastName}`.trim() || null;
      if (mapping.wing) {
        meta.wing = r[mapping.wing] ?? null;
      }
      if (mapping.startDate) {
        meta.startDate = r[mapping.startDate] ?? null;
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
    return { importedCount: employees.length, skippedRows };
  }

  async function parseFile(file){
    const name = file.name.toLowerCase();
    if (name.endsWith('.json')){
      const text = await file.text();
      const payload = JSON.parse(text);
      if (Array.isArray(payload.employees)) {
        // Already in our shape
        return { rows: payload.employees, headers: extractHeaders(payload.employees) };
      }
      if (Array.isArray(payload)){
        return { rows: payload, headers: extractHeaders(payload) };
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
        complete: (res)=> {
          const headers = Array.isArray(res.meta?.fields) ? res.meta.fields : extractHeaders(res.data);
          resolve({ rows: res.data, headers });
        },
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
      const { rows, headers } = await parseFile(file);
      const defaultMapping = buildDefaultMapping(headers);
      const mapping = await renderMappingModal(headers, defaultMapping);
      if (!mapping){
        return;
      }

      updateMissingColumnsBanner([]);

      const result = await importFromRows(rows, mapping, headers);
      const store = getAppStore();
      const baseMessage = `Imported ${result.importedCount} employee${result.importedCount === 1 ? '' : 's'}.`;
      const skippedCount = result.skippedRows.length;
      let message = baseMessage;
      if (skippedCount){
        const details = result.skippedRows.slice(0, 5)
          .map((entry) => `Row ${entry.row}: ${entry.reasons.join(', ')}`)
          .join(' • ');
        message += ` Skipped ${skippedCount} row${skippedCount === 1 ? '' : 's'} (${details}).`;
      }

      if (store && typeof store.notify === 'function'){
        store.notify(message, skippedCount ? 'var(--warning, #f59e0b)' : 'var(--success)');
      } else {
        alert(message);
      }
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
