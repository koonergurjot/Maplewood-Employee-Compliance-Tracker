import Papa from 'papaparse';

import { openDatabase, mapPositionStatus } from '../../db.js';
import { ImportEmployees } from '../../commands.js';
import {
  buildHeaderMap,
  detectHeaderRow,
  isBlankRow,
  normalizeCellValue,
  normalizeHeaderLabel
} from '../logic/mapping-helpers.js';

const MAX_HEADER_SCAN = 10;

const SENIORITY_PREVIEW_COLUMNS = [
  'First Name',
  'Last Name',
  'Job Class',
  'Job Title',
  'Position Status',
  'Seniority Hours',
  'Employee ID',
  'Ranking'
];

let cachedXlsx = null;
let xlsxLoadPromise = null;
let lastImportContext = null;

const normalizeString = value => {
  if (value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  return String(value).trim();
};

const normalizeKeyPart = value => normalizeString(value).toLocaleLowerCase();

const normalizeId = value => normalizeString(value).replace(/[^a-z0-9]/gi, '').toLocaleLowerCase();

const buildCompositeKey = (firstName, lastName, role) => {
  const first = normalizeKeyPart(firstName);
  const last = normalizeKeyPart(lastName);
  const rolePart = normalizeKeyPart(role);

  if (!first && !last) {
    return '';
  }

  return [last, first, rolePart].join('|');
};

const parseFloatValue = value => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const normalized = normalizeString(value).replace(/,/g, '');
  if (!normalized) {
    return 0;
  }

  const numeric = Number.parseFloat(normalized);
  return Number.isFinite(numeric) ? numeric : 0;
};

const parseIntegerValue = value => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  const normalized = normalizeString(value).replace(/[^0-9-]/g, '');
  if (!normalized) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const splitName = (value, meta = {}) => {
  const normalized = normalizeString(value);
  if (!normalized) {
    return { firstName: '', lastName: '' };
  }

  if (meta?.nameFormat === 'lastFirst') {
    const [last, ...rest] = normalized.split(',');
    const first = rest.join(',');
    return {
      firstName: normalizeString(first),
      lastName: normalizeString(last)
    };
  }

  if (normalized.includes(',')) {
    const [last, ...rest] = normalized.split(',');
    return {
      firstName: normalizeString(rest.join(',')),
      lastName: normalizeString(last)
    };
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }

  const [first, ...remaining] = parts;
  return {
    firstName: normalizeString(first),
    lastName: normalizeString(remaining.join(' '))
  };
};

const extractName = (row, mapping) => {
  const { columns, meta } = mapping;
  const nameIndex = columns.name;

  if (typeof nameIndex === 'number' && nameIndex >= 0) {
    const { firstName, lastName } = splitName(row[nameIndex], meta);
    return { firstName, lastName };
  }

  const firstName = meta.firstName >= 0 ? normalizeString(row[meta.firstName]) : '';
  const lastName = meta.lastName >= 0 ? normalizeString(row[meta.lastName]) : '';

  return { firstName, lastName };
};

const determineRole = (record, match) => {
  const fallback = record.jobClass || record.jobTitle || record.positionStatus || 'Other';
  if (match?.role) {
    return match.role;
  }
  if (match?.jobClass) {
    return match.jobClass;
  }
  return fallback || 'Other';
};

const determineEmploymentType = (record, match) => {
  if (match?.employmentType) {
    return match.employmentType;
  }

  if (record.positionStatus) {
    return record.positionStatus;
  }

  if (match?.positionStatus) {
    return match.positionStatus;
  }

  return 'FT';
};

const resolveStore = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    if (typeof window.AppStore === 'function') {
      return window.AppStore();
    }
  } catch (error) {
    console.warn('Failed to resolve legacy AppStore', error);
  }

  return null;
};

const rememberXlsxModule = module => {
  if (!module) {
    return null;
  }

  const resolved = module?.default ?? module;
  cachedXlsx = resolved;
  if (typeof window !== 'undefined') {
    window.__xlsxModule = resolved;
  }
  return resolved;
};

const resolveXlsxFromGlobals = () => {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.__xlsxModule || window.XLSX || null;
};

const loadXlsx = async () => {
  if (cachedXlsx) {
    return cachedXlsx;
  }

  const existing = resolveXlsxFromGlobals();
  if (existing) {
    return rememberXlsxModule(existing);
  }

  if (!xlsxLoadPromise) {
    xlsxLoadPromise = (async () => {
      try {
        const mod = await import('xlsx');
        const resolved = rememberXlsxModule(mod);
        if (resolved) {
          return resolved;
        }
      } catch (error) {
        console.error('Dynamic XLSX import failed', error);
      }

      const fallback = rememberXlsxModule(resolveXlsxFromGlobals());
      if (fallback) {
        return fallback;
      }

      throw new Error('Excel import support could not be loaded.');
    })().finally(() => {
      if (!cachedXlsx) {
        xlsxLoadPromise = null;
      }
    });
  }

  return xlsxLoadPromise;
};

const parseCsvFile = file =>
  new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: false,
      skipEmptyLines: false,
      complete: results => resolve(Array.isArray(results?.data) ? results.data : []),
      error: error => reject(error)
    });
  });

const parseXlsxFile = async file => {
  const xlsx = await loadXlsx();
  const buffer = await file.arrayBuffer();
  const workbook = xlsx.read(buffer, { type: 'array' });
  const [firstSheetName] = workbook.SheetNames || [];
  if (!firstSheetName) {
    return [];
  }

  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) {
    return [];
  }

  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
  return Array.isArray(rows) ? rows : [];
};

const parseFileToRows = async file => {
  if (!file) {
    throw new Error('A file is required for import.');
  }

  const name = typeof file.name === 'string' ? file.name.toLowerCase() : '';

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return parseXlsxFile(file);
  }

  if (name.endsWith('.json')) {
    const text = await file.text();
    const payload = JSON.parse(text);
    if (Array.isArray(payload)) {
      return payload;
    }
    if (Array.isArray(payload?.rows)) {
      return payload.rows;
    }
    throw new Error('JSON imports must provide an array of rows.');
  }

  return parseCsvFile(file);
};

const sanitizeRows = rows => {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .filter(row => Array.isArray(row))
    .map(row => row.map(cell => normalizeCellValue(cell)));
};

const collectRawRecords = (rows, headerInfo, mapping) => {
  const records = [];
  const skipped = [];

  const dataRows = rows.slice(headerInfo.index + 1);

  dataRows.forEach((row, offset) => {
    if (!Array.isArray(row) || isBlankRow(row)) {
      return;
    }

    const rowNumber = headerInfo.index + offset + 2;
    const { firstName, lastName } = extractName(row, mapping);

    if (!firstName && !lastName) {
      skipped.push({ row: rowNumber, reason: 'Missing employee name' });
      return;
    }

    const seniorityIndex = mapping.columns.seniorityHours;
    const jobClassIndex = mapping.columns.jobClass;
    const jobTitleIndex = mapping.columns.jobTitle;
    const rankingIndex = mapping.columns.ranking;
    const positionStatusIndex = mapping.columns.positionStatus;
    const employeeIdIndex = mapping.columns.employeeId;

    const seniorityHours = seniorityIndex >= 0 ? parseFloatValue(row[seniorityIndex]) : 0;
    const jobClass = jobClassIndex >= 0 ? normalizeString(row[jobClassIndex]) : '';
    const jobTitle = jobTitleIndex >= 0 ? normalizeString(row[jobTitleIndex]) : '';
    const ranking = rankingIndex >= 0 ? parseIntegerValue(row[rankingIndex]) : null;
    const rawStatus = positionStatusIndex >= 0 ? normalizeString(row[positionStatusIndex]) : '';
    const normalizedStatus = mapPositionStatus(rawStatus, rawStatus) || '';
    const employeeId = employeeIdIndex >= 0 ? normalizeString(row[employeeIdIndex]) : '';

    records.push({
      row: rowNumber,
      firstName,
      lastName,
      jobClass,
      jobTitle,
      ranking,
      seniorityHours,
      positionStatus: normalizedStatus,
      employeeId
    });
  });

  return { records, skipped };
};

const buildExistingIndexes = employees => {
  const byId = new Map();
  const byComposite = new Map();

  for (const employee of employees) {
    if (!employee) {
      continue;
    }

    const idKey = normalizeId(employee.employeeId);
    if (idKey) {
      byId.set(idKey, employee);
    }

    const composite = buildCompositeKey(
      employee.firstName,
      employee.lastName,
      employee.role || employee.jobClass || employee.jobTitle
    );
    if (composite) {
      byComposite.set(composite, employee);
    }
  }

  return { byId, byComposite };
};

const mergeWithExisting = (records, existingIndexes) => {
  const employees = [];
  let added = 0;
  let updated = 0;

  const { byId, byComposite } = existingIndexes;

  for (const record of records) {
    const idKey = normalizeId(record.employeeId);
    let match = idKey ? byId.get(idKey) : null;

    if (!match) {
      const compositeKey = buildCompositeKey(
        record.firstName,
        record.lastName,
        record.jobClass || record.jobTitle
      );
      if (compositeKey) {
        match = byComposite.get(compositeKey) || null;
      }
    }

    const role = determineRole(record, match);
    const employmentType = determineEmploymentType(record, match);

    const payload = {
      firstName: record.firstName,
      lastName: record.lastName,
      role,
      employmentType,
      status: match?.status || 'Active',
      employeeId: record.employeeId || match?.employeeId || '',
      seniorityHours: record.seniorityHours,
      jobClass: record.jobClass || match?.jobClass || '',
      jobTitle: record.jobTitle || match?.jobTitle || '',
      ranking: record.ranking != null ? record.ranking : match?.ranking ?? null,
      positionStatus: record.positionStatus || match?.positionStatus || ''
    };

    employees.push(payload);

    if (match) {
      updated += 1;
    } else {
      added += 1;
      if (payload.employeeId) {
        byId.set(idKey, payload);
      }
      const compositeKey = buildCompositeKey(record.firstName, record.lastName, role);
      if (compositeKey) {
        byComposite.set(compositeKey, payload);
      }
    }
  }

  return { employees, added, updated };
};

const buildMappingLabels = (headerRow, mapping) => {
  const labels = {};
  for (const [key, index] of Object.entries(mapping.columns)) {
    if (index >= 0) {
      labels[key] = normalizeHeaderLabel(headerRow[index]);
    }
  }
  return labels;
};

const buildPreview = employees => {
  const rows = employees.slice(0, 10).map(employee => ({
    'First Name': employee.firstName,
    'Last Name': employee.lastName,
    'Job Class': employee.jobClass,
    'Job Title': employee.jobTitle,
    'Position Status': employee.positionStatus,
    'Seniority Hours': employee.seniorityHours,
    'Employee ID': employee.employeeId,
    Ranking: employee.ranking ?? ''
  }));

  return {
    columns: SENIORITY_PREVIEW_COLUMNS,
    rows,
    total: employees.length
  };
};

const ensureRequiredColumns = mapping => {
  const required = ['seniorityHours', 'jobClass', 'jobTitle', 'positionStatus'];
  const missing = required.filter(key => !(key in mapping.columns) || mapping.columns[key] < 0);
  if (missing.length) {
    throw new Error('Required columns are missing from the detected header row.');
  }
};

export async function runSeniorityDryRun(file) {
  const parsedRows = await parseFileToRows(file);
  const rows = sanitizeRows(parsedRows);

  if (!rows.length) {
    throw new Error('The selected file did not contain any rows.');
  }

  const headerInfo = detectHeaderRow(rows, MAX_HEADER_SCAN);
  if (!headerInfo) {
    throw new Error('Unable to detect a header row. Ensure the file includes Total Seniority Hours, Job Class, and Ranking columns.');
  }

  const mapping = buildHeaderMap(headerInfo.row || []);
  ensureRequiredColumns(mapping);

  const { records, skipped } = collectRawRecords(rows, headerInfo, mapping);
  if (!records.length) {
    throw new Error('No employee data rows were detected after the header row.');
  }

  const db = await openDatabase();
  const existingEmployees = await db.employees.toArray();
  const indexes = buildExistingIndexes(existingEmployees);
  const { employees, added, updated } = mergeWithExisting(records, indexes);

  const summary = { added, updated, skipped: skipped.length };
  const mappingLabels = buildMappingLabels(headerInfo.row, mapping);
  const preview = buildPreview(employees);

  lastImportContext = {
    mode: 'seniority',
    employees,
    summary,
    mapping: mappingLabels,
    skipped,
    headerRow: headerInfo.row
  };

  return {
    summary,
    mapping: mappingLabels,
    preview,
    skipped
  };
}

export async function commitSeniorityImport() {
  if (!lastImportContext || !Array.isArray(lastImportContext.employees)) {
    throw new Error('Run a dry-run before committing the import.');
  }

  const { employees, summary } = lastImportContext;
  const db = await openDatabase();
  const command = new ImportEmployees(db, { employees });
  const result = await command.execute();

  const added = result?.addedEmployees?.length || 0;
  const updated = result?.updatedSnapshots?.length || 0;
  const skipped = summary?.skipped || 0;

  const store = resolveStore();
  if (store && typeof store.loadData === 'function') {
    try {
      await store.loadData();
    } catch (error) {
      console.warn('Failed to refresh data after import', error);
    }
  }

  if (store && typeof store.recordActivity === 'function') {
    try {
      await store.recordActivity('ImportEmployeesSeniority', [], { added, updated, skipped }, null, {
        supportsUndo: false
      });
    } catch (error) {
      console.warn('Failed to record seniority import activity', error);
    }
  }

  lastImportContext = null;

  return { added, updated, skipped };
}

if (typeof window !== 'undefined') {
  window.importEmployeesDryRun = runSeniorityDryRun;
  window.importEmployeesCommit = commitSeniorityImport;
}

