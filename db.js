import Dexie from 'dexie';

const DB_NAME = 'ComplianceMatrixDB';

export function getDexie() {
  return Dexie;
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

  db.on('populate', tx => {
    const now = new Date().toISOString();
    const seed = (name, days = null, color = '#fef3c7') => ({
      id: generateId(),
      name,
      defaultExpiryDays: days,
      color,
      createdAt: now,
      updatedAt: now
    });

    tx.table('requirements').bulkAdd([
      seed('Resume', null, '#e0e7ff'),
      seed('References', null, '#f0f9ff'),
      seed('First Aid', 1095, '#fef3c7'),
      seed('CPR', 365, '#dcfce7'),
      seed('FoodSafe', 1825, '#fce7f3'),
      seed('Violence Prevention', 365, '#f3e8ff'),
      seed('Background Check', 1095, '#fef2f2'),
      seed('Drug Test', 365, '#fffbeb'),
      seed('TB Test', 365, '#f0fdf4'),
      seed('Immunization', 365, '#ecfdf5')
    ]);

    tx.table('settings').put({ id: 'app', darkMode: false });
    tx.table('settings').put({ id: 'hasSeenTour', value: false });
    tx.table('settings').put({ id: 'roleRequirementProfiles', value: [] });
  });
}

export function createDatabase() {
  const DexieRef = getDexie();
  const db = new DexieRef(DB_NAME);
  defineSchema(db);
  return db;
}

export async function openDatabase() {
  const db = createDatabase();
  await db.open();
  return db;
}

