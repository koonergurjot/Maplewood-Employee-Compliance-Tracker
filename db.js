import Dexie from 'dexie';

const DB_NAME = 'ComplianceMatrixDB';

export const POSITION_STATUS_VALUES = ['FT', 'PT', 'Casual'];

const POSITION_STATUS_ALIAS_MAP = new Map([
  ['FT', 'FT'],
  ['FTE', 'FT'],
  ['FULLTIME', 'FT'],
  ['FULLTIMEEMPLOYEE', 'FT'],
  ['FULLTIMEEQUIVALENT', 'FT'],
  ['PARTTIME', 'PT'],
  ['PARTTIMEEMPLOYEE', 'PT'],
  ['PT', 'PT'],
  ['PTE', 'PT'],
  ['PARTTIMEEQUIVALENT', 'PT'],
  ['CASUAL', 'Casual'],
  ['CASUALEMPLOYEE', 'Casual']
]);

function normalizeStatusKey(value) {
  if (value == null) {
    return '';
  }
  const stringValue = typeof value === 'string' ? value.trim() : String(value).trim();
  if (!stringValue) {
    return '';
  }
  return stringValue.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

export function normalizePositionStatus(value) {
  const key = normalizeStatusKey(value);
  if (!key) {
    return '';
  }
  const mapped = POSITION_STATUS_ALIAS_MAP.get(key);
  if (mapped) {
    return mapped;
  }
  if (key === 'CASUAL') {
    return 'Casual';
  }
  return '';
}

export function mapPositionStatus(value, fallback = '') {
  const normalized = normalizePositionStatus(value);
  if (normalized) {
    return normalized;
  }
  if (fallback) {
    return normalizePositionStatus(fallback);
  }
  return '';
}

export const BULK_OPERATION_CHUNK_SIZE = 300;

let DexieRef = Dexie ?? null;
let dexieLoaderPromise = null;

function setDexie(module) {
  if (!module) {
    DexieRef = null;
    return DexieRef;
  }

  DexieRef = module?.default ?? module;
  return DexieRef;
}

setDexie(Dexie);

export function getDexie() {
  return DexieRef;
}

async function loadDexie() {
  if (getDexie()) {
    return getDexie();
  }

  if (!dexieLoaderPromise) {
    dexieLoaderPromise = (async () => {
      const module = await import('dexie');
      return setDexie(module);
    })().finally(() => {
      if (!getDexie()) {
        dexieLoaderPromise = null;
      }
    });
  }

  return dexieLoaderPromise;
}

export async function ensureDexieLoaded() {
  if (getDexie()) {
    return getDexie();
  }

  try {
    const DexieInstance = await loadDexie();
    if (!DexieInstance) {
      throw new Error('Dexie resolved to a falsy value');
    }
    return DexieInstance;
  } catch (error) {
    const loadError = new Error('Dexie not bundled. Install dexie and rebuild (npm i dexie && npm run build).');
    loadError.cause = error;
    throw loadError;
  }
}

export function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const DexieRef = getDexie();
  if (DexieRef && typeof DexieRef.uuid === 'function') {
    return DexieRef.uuid();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function* chunkArray(items, chunkSize = BULK_OPERATION_CHUNK_SIZE) {
  if (!Array.isArray(items) || items.length === 0) {
    return;
  }

  const size = Number.isFinite(chunkSize) ? Math.floor(chunkSize) : BULK_OPERATION_CHUNK_SIZE;
  const normalizedSize = Math.min(500, Math.max(200, size || BULK_OPERATION_CHUNK_SIZE));

  for (let i = 0; i < items.length; i += normalizedSize) {
    yield items.slice(i, i + normalizedSize);
  }
}

const DEFAULT_REQUIREMENTS = [
  { name: 'Resume', defaultExpiryDays: null, color: '#e0e7ff' },
  { name: 'References', defaultExpiryDays: null, color: '#f0f9ff' },
  { name: 'First Aid', defaultExpiryDays: 1095, color: '#fef3c7' },
  { name: 'CPR', defaultExpiryDays: 365, color: '#dcfce7' },
  { name: 'FoodSafe', defaultExpiryDays: 1825, color: '#fce7f3' },
  { name: 'Violence Prevention', defaultExpiryDays: 365, color: '#f3e8ff' },
  { name: 'Background Check', defaultExpiryDays: 1095, color: '#fef2f2' },
  { name: 'Drug Test', defaultExpiryDays: 365, color: '#fffbeb' },
  { name: 'TB Test', defaultExpiryDays: 365, color: '#f0fdf4' },
  { name: 'Immunization', defaultExpiryDays: 365, color: '#ecfdf5' }
];

function getDefaultRequirementSeeds() {
  const now = new Date().toISOString();
  return DEFAULT_REQUIREMENTS.map(({ name, defaultExpiryDays, color }) => ({
    id: generateId(),
    name,
    defaultExpiryDays,
    color,
    createdAt: now,
    updatedAt: now
  }));
}

async function seedInitialDataIfNeeded(db) {
  if (!db) {
    return;
  }

  const requirementsTable = db.table('requirements');
  const requirementCount = await requirementsTable.count();

  if (requirementCount === 0) {
    try {
      await requirementsTable.bulkAdd(getDefaultRequirementSeeds());
    } catch (error) {
      console.warn('Failed to seed default requirements', error);
    }
  }

  const settingsTable = db.table('settings');

  const ensureSetting = async (id, value) => {
    try {
      const existing = await settingsTable.get(id);
      if (!existing) {
        await settingsTable.put({ id, ...value });
      }
    } catch (error) {
      console.warn(`Failed to ensure default setting: ${id}`, error);
    }
  };

  await Promise.all([
    ensureSetting('app', { darkMode: false }),
    ensureSetting('hasSeenTour', { value: false }),
    ensureSetting('roleRequirementProfiles', { value: [] })
  ]);
}

function defineSchema(db) {
  const v8Stores = {
    employees: 'id, lastName, firstName, role, employmentType, status, employeeId, seniorityHours',
    requirements: 'id, name, defaultExpiryDays, color',
    employeeRequirements: 'id, [employeeId+requirementId], status, completedOn, expiresOn, notes',
    settings: 'id',
    activityLog: 'id,timestamp,actionType'
  };

  const v9Stores = {
    ...v8Stores,
    complianceSnapshots: 'date'
  };

  const v10Stores = {
    ...v9Stores,
    roleRequirementProfiles: 'id, name'
  };

  const v11Stores = {
    ...v10Stores,
    lookups: '++id,&[type+valueLower],type,value,valueLower,createdAt'
  };

  const v12Stores = {
    ...v11Stores,
    employees: 'id, employeeId, lastName, firstName, role, employmentType, status, seniorityHours, [employeeId+lastName+firstName]'
  };

  const v13Stores = {
    ...v12Stores,
    employees:
      'id, employeeId, lastName, firstName, role, employmentType, status, seniorityHours, jobClass, jobTitle, ranking, positionStatus, [employeeId+lastName+firstName]'
  };

  const v14Stores = {
    ...v13Stores,
    activities: '++id, type, createdAt'
  };

  db.version(8).stores(v8Stores);
  db.version(9).stores(v9Stores);
  db.version(10).stores(v10Stores).upgrade(async tx => {
    try {
      const settingsTable = tx.table('settings');
      const existingSetting = await settingsTable.get('roleRequirementProfiles');
      if (!existingSetting) {
        await settingsTable.put({ id: 'roleRequirementProfiles', value: [] });
      }
    } catch (error) {
      console.warn('Failed to seed role requirement profile settings', error);
    }
  });

  db.version(11).stores(v11Stores).upgrade(async tx => {
    const lookupsTable = tx.table('lookups');
    const employeesTable = tx.table('employees');

    const ensureTypeSet = type => {
      if (!typeSets.has(type)) {
        typeSets.set(type, new Set());
      }
      return typeSets.get(type);
    };

    const normalizeValue = value => {
      if (value == null) {
        return { value: '', lower: '' };
      }
      const stringValue = typeof value === 'string' ? value.trim() : String(value).trim();
      return {
        value: stringValue,
        lower: stringValue.toLocaleLowerCase()
      };
    };

    const typeSets = new Map();
    try {
      const existingLookups = await lookupsTable.toArray();
      existingLookups.forEach(lookup => {
        const type = lookup?.type;
        if (!type) {
          return;
        }
        const lower = (lookup?.valueLower || '').toString();
        if (!lower) {
          return;
        }
        ensureTypeSet(type).add(lower);
      });
    } catch (error) {
      console.warn('Failed to read existing lookup values during upgrade', error);
    }

    const valuesToInsert = [];
    const typeMappings = [
      { field: 'position', type: 'role' },
      { field: 'role', type: 'role' },
      { field: 'status', type: 'status' },
      { field: 'rank', type: 'employmentType' },
      { field: 'employmentType', type: 'employmentType' }
    ];

    await employeesTable.each(employee => {
      typeMappings.forEach(({ field, type }) => {
        const normalized = normalizeValue(employee?.[field]);
        if (!normalized.value) {
          return;
        }
        const set = ensureTypeSet(type);
        if (set.has(normalized.lower)) {
          return;
        }
        set.add(normalized.lower);
        valuesToInsert.push({
          type,
          value: normalized.value,
          valueLower: normalized.lower,
          createdAt: new Date().toISOString()
        });
      });
    });

    if (!valuesToInsert.length) {
      return;
    }

    try {
      await lookupsTable.bulkAdd(valuesToInsert);
    } catch (error) {
      if (error?.name !== 'BulkError') {
        throw error;
      }

      for (const entry of valuesToInsert) {
        try {
          await lookupsTable.add(entry);
        } catch (addError) {
          if (addError?.name !== 'ConstraintError') {
            console.warn('Failed to add lookup entry during upgrade', addError);
          }
        }
      }
    }
  });

  db.version(12).stores(v12Stores);

  db.version(13)
    .stores(v13Stores)
    .upgrade(async tx => {
      const employeesTable = tx.table('employees');
      if (!employeesTable || typeof employeesTable.toCollection !== 'function') {
        return;
      }

      const hasOwn = (target, key) => Object.prototype.hasOwnProperty.call(target, key);

      try {
        await employeesTable.toCollection().modify(employee => {
          if (!hasOwn(employee, 'seniorityHours')) {
            employee.seniorityHours = null;
          } else if (employee.seniorityHours == null || employee.seniorityHours === '') {
            employee.seniorityHours = null;
          } else if (typeof employee.seniorityHours !== 'number') {
            const parsedHours = Number.parseFloat(employee.seniorityHours);
            employee.seniorityHours = Number.isFinite(parsedHours) ? parsedHours : null;
          }

          if (!hasOwn(employee, 'jobClass')) {
            employee.jobClass = '';
          } else if (typeof employee.jobClass !== 'string') {
            employee.jobClass = employee.jobClass == null ? '' : String(employee.jobClass).trim();
          }

          if (!hasOwn(employee, 'jobTitle')) {
            employee.jobTitle = '';
          } else if (typeof employee.jobTitle !== 'string') {
            employee.jobTitle = employee.jobTitle == null ? '' : String(employee.jobTitle).trim();
          }

          if (!hasOwn(employee, 'ranking')) {
            employee.ranking = null;
          } else if (employee.ranking == null || employee.ranking === '') {
            employee.ranking = null;
          } else if (typeof employee.ranking !== 'number') {
            const parsedRanking = Number.parseFloat(employee.ranking);
            employee.ranking = Number.isFinite(parsedRanking) ? parsedRanking : null;
          }

          const normalizedStatus = mapPositionStatus(employee.positionStatus);
          if (normalizedStatus) {
            employee.positionStatus = normalizedStatus;
          } else if (!hasOwn(employee, 'positionStatus')) {
            employee.positionStatus =
              mapPositionStatus(employee.employmentType ?? employee.rank ?? '') || '';
          } else {
            employee.positionStatus = '';
          }
        });
      } catch (error) {
        console.warn('Failed to backfill employee seniority fields', error);
      }
    });

  db.version(14).stores(v14Stores);

  db.on('populate', tx => {
    tx.table('requirements').bulkAdd(getDefaultRequirementSeeds());

    tx.table('settings').put({ id: 'app', darkMode: false });
    tx.table('settings').put({ id: 'hasSeenTour', value: false });
    tx.table('settings').put({ id: 'roleRequirementProfiles', value: [] });
  });
}

export async function createDatabase() {
  let DexieInstance = getDexie();
  if (!DexieInstance) {
    DexieInstance = await ensureDexieLoaded();
  }

  if (!DexieInstance) {
    throw new Error('Dexie failed to load');
  }

  const db = new DexieInstance(DB_NAME);
  defineSchema(db);
  return db;
}

export async function openDatabase() {
  const db = await createDatabase();
  await db.open();
  await seedInitialDataIfNeeded(db);
  return db;
}

function normalizeLookupType(type) {
  if (type == null) {
    return '';
  }
  const stringValue = typeof type === 'string' ? type.trim() : String(type).trim();
  if (!stringValue) {
    return '';
  }
  return stringValue.toLocaleLowerCase();
}

function normalizeLookupValue(value) {
  if (value == null) {
    return { value: '', lower: '' };
  }
  const stringValue = typeof value === 'string' ? value.trim() : String(value).trim();
  return {
    value: stringValue,
    lower: stringValue.toLocaleLowerCase()
  };
}

export async function listLookups(type) {
  const normalizedType = normalizeLookupType(type);
  if (!normalizedType) {
    return [];
  }

  const db = await openDatabase();
  const table = db.table('lookups');

  const canonicalRecords = await table.where('type').equals(normalizedType).sortBy('valueLower');
  const legacyRecords = await table
    .filter(record => normalizeLookupType(record?.type) === normalizedType && record?.type !== normalizedType)
    .toArray();

  if (legacyRecords.length) {
    legacyRecords.sort((a, b) => {
      const aKey = (a?.valueLower || '').toString();
      const bKey = (b?.valueLower || '').toString();
      return aKey.localeCompare(bKey);
    });
  }

  const combined = [...canonicalRecords, ...legacyRecords];
  const seen = new Set();
  const values = [];

  for (const record of combined) {
    if (!record) {
      continue;
    }
    const normalizedValue = normalizeLookupValue(record.value);
    if (!normalizedValue.value) {
      continue;
    }
    if (seen.has(normalizedValue.lower)) {
      continue;
    }
    seen.add(normalizedValue.lower);
    values.push(normalizedValue.value);
  }

  return values;
}

export async function addLookup(type, value) {
  const normalizedType = normalizeLookupType(type);
  const normalizedValue = normalizeLookupValue(value);

  if (!normalizedType || !normalizedValue.value) {
    return null;
  }

  const db = await openDatabase();
  const table = db.table('lookups');
  const compositeKey = [normalizedType, normalizedValue.lower];

  const findExisting = async () => {
    const canonical = await table
      .where('[type+valueLower]')
      .equals(compositeKey)
      .first();
    if (canonical) {
      return canonical;
    }

    return table
      .where('valueLower')
      .equals(normalizedValue.lower)
      .and(record => normalizeLookupType(record?.type) === normalizedType)
      .first();
  };

  let existing = await findExisting();

  if (existing) {
    if (existing.type !== normalizedType && existing.id != null) {
      try {
        await table.update(existing.id, { type: normalizedType });
        existing = { ...existing, type: normalizedType };
      } catch (updateError) {
        if (updateError?.name === 'ConstraintError') {
          const canonical = await table
            .where('[type+valueLower]')
            .equals(compositeKey)
            .first();
          if (canonical) {
            existing = canonical;
          }
        } else {
          console.warn('Failed to normalize lookup type casing', updateError);
        }
      }
    }

    return existing;
  }

  const createdAt = new Date().toISOString();

  try {
    const id = await table.add({
      type: normalizedType,
      value: normalizedValue.value,
      valueLower: normalizedValue.lower,
      createdAt
    });

    return table.get(id);
  } catch (error) {
    if (error?.name === 'ConstraintError') {
      const fallback = await findExisting();
      if (fallback) {
        return fallback;
      }
    }

    throw error;
  }
}

export async function putEmployeeRecord(dbOrRecord, maybeRecord) {
  let db = dbOrRecord;
  let record = maybeRecord;

  if (record == null) {
    record = db;
    db = null;
  }

  if (!record || !record.id) {
    throw new Error('putEmployeeRecord requires an employee object with an id');
  }

  const targetDb = db && typeof db.table === 'function'
    ? db
    : await openDatabase();

  await targetDb.employees.put(record);
  return record;
}

