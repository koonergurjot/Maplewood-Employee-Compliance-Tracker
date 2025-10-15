import { indexedDB, IDBKeyRange } from 'fake-indexeddb';

// Provide IndexedDB globals expected by Dexie before importing the db module.
if (!globalThis.indexedDB) {
  globalThis.indexedDB = indexedDB;
}
if (!globalThis.IDBKeyRange) {
  globalThis.IDBKeyRange = IDBKeyRange;
}

const dbModule = await import('../db.js');
const { openDatabase, listLookups, addLookup } = dbModule;

const db = await openDatabase();

try {
  await db.table('lookups').clear();

  const now = new Date().toISOString();
  await db.table('lookups').add({
    type: 'Role',
    value: 'Nurse',
    valueLower: 'nurse',
    createdAt: now,
  });

  const values = await listLookups('role');
  if (!values.includes('Nurse')) {
    throw new Error('listLookups should find legacy entries regardless of type casing');
  }

  await addLookup('ROLE', 'Nurse');
  const nurseCount = await db.table('lookups').where('valueLower').equals('nurse').count();
  if (nurseCount !== 1) {
    throw new Error(`Expected a single canonical Nurse entry, found ${nurseCount}`);
  }

  const doctorRecord = await addLookup('ROLE', 'Doctor');
  if (!doctorRecord || doctorRecord.type !== 'role') {
    throw new Error('New lookup entries should persist a canonical lowercase type');
  }

  const finalValues = await listLookups('ROLE');
  if (!finalValues.includes('Doctor') || !finalValues.includes('Nurse')) {
    throw new Error('listLookups should return all values for the requested type');
  }

  console.log('lookup lookup case-sensitivity tests passed');
} finally {
  await db.close();
}
