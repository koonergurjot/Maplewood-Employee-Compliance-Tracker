import Dexie from 'dexie';

const DB_NAME = 'ComplianceMatrixDB';

let DexieRef = Dexie ?? null;
let dexieLoaderPromise = null;
let cdnLoaderPromise = null;

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

async function loadDexieFromDynamicImport() {
  const module = await import('dexie');
  return setDexie(module);
}

async function loadDexieFromCdn() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }

  if (window.Dexie) {
    return setDexie(window.Dexie);
  }

  if (!cdnLoaderPromise) {
    cdnLoaderPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-dexie-cdn]');

      if (existing) {
        const handleLoad = () => {
          existing.removeEventListener('load', handleLoad);
          existing.removeEventListener('error', handleError);
          if (window.Dexie) {
            resolve(setDexie(window.Dexie));
          } else {
            reject(new Error('Dexie CDN script loaded without exposing Dexie'));
          }
        };

        const handleError = event => {
          existing.removeEventListener('load', handleLoad);
          existing.removeEventListener('error', handleError);
          reject(event?.error || new Error('Failed to load Dexie from CDN'));
        };

        existing.addEventListener('load', handleLoad, { once: true });
        existing.addEventListener('error', handleError, { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/dexie@3.2.4/dist/dexie.min.js';
      script.async = true;
      script.dataset.dexieCdn = 'true';

      const handleLoad = () => {
        script.removeEventListener('load', handleLoad);
        script.removeEventListener('error', handleError);
        if (window.Dexie) {
          resolve(setDexie(window.Dexie));
        } else {
          reject(new Error('Dexie CDN script loaded without exposing Dexie'));
        }
      };

      const handleError = event => {
        script.removeEventListener('load', handleLoad);
        script.removeEventListener('error', handleError);
        reject(event?.error || new Error('Failed to load Dexie from CDN'));
      };

      script.addEventListener('load', handleLoad);
      script.addEventListener('error', handleError);
      document.head.appendChild(script);
    }).finally(() => {
      if (!getDexie()) {
        cdnLoaderPromise = null;
      }
    });
  }

  return cdnLoaderPromise;
}

async function loadDexie() {
  if (getDexie()) {
    return getDexie();
  }

  if (!dexieLoaderPromise) {
    dexieLoaderPromise = (async () => {
      try {
        return await loadDexieFromDynamicImport();
      } catch (dynamicError) {
        if (typeof window === 'undefined') {
          throw dynamicError;
        }

        try {
          const cdnDexie = await loadDexieFromCdn();
          if (cdnDexie) {
            return cdnDexie;
          }
        } catch (cdnError) {
          const aggregate = new Error('Dexie failed to load');
          aggregate.cause = { dynamicError, cdnError };
          throw aggregate;
        }

        throw dynamicError;
      }
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
    const loadError = new Error('Dexie failed to load');
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
  return db;
}

