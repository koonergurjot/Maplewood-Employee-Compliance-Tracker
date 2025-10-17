import { indexedDB, IDBKeyRange } from 'fake-indexeddb';

if (!globalThis.indexedDB) {
  globalThis.indexedDB = indexedDB;
}
if (!globalThis.IDBKeyRange) {
  globalThis.IDBKeyRange = IDBKeyRange;
}

const dbModule = await import('../db.js');
const commandsModule = await import('../commands.js');
const db = await dbModule.openDatabase();

try {
  await db.employees.clear();
  await db.employeeRequirements.clear();

  await db.employees.bulkPut([
    { id: 'emp1', firstName: 'Ada', lastName: 'Lovelace', role: 'Engineer', status: 'Active' },
    { id: 'emp2', firstName: 'Grace', lastName: 'Hopper', role: 'Engineer', status: 'Active' }
  ]);

  await db.employeeRequirements.bulkPut([
    { id: 'er1', employeeId: 'emp1', requirementId: 'req1' },
    { id: 'er2', employeeId: 'emp1', requirementId: 'req2' },
    { id: 'er3', employeeId: 'emp2', requirementId: 'req1' }
  ]);

  await commandsModule.deleteEmployee({ db, employeeId: 'emp1', activityLog: [] });

  const remainingEmployees = await db.employees.toArray();
  const remainingLinks = await db.employeeRequirements.toArray();

  if (remainingEmployees.find(emp => emp.id === 'emp1')) {
    throw new Error('Employee record should be deleted');
  }

  if (remainingLinks.some(link => link.employeeId === 'emp1')) {
    throw new Error('Related employee requirements should be deleted');
  }

  if (!remainingLinks.find(link => link.employeeId === 'emp2')) {
    throw new Error('Employee requirements for other employees should remain');
  }

  console.log('DeleteEmployee helper tests passed');
} finally {
  await db.close();
}
