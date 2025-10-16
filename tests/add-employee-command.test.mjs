import { indexedDB, IDBKeyRange } from 'fake-indexeddb';

if (!globalThis.indexedDB) {
  globalThis.indexedDB = indexedDB;
}
if (!globalThis.IDBKeyRange) {
  globalThis.IDBKeyRange = IDBKeyRange;
}

const dbModule = await import('../db.js');
const { openDatabase } = dbModule;
const commandsModule = await import('../commands.js');
const { AddEmployee } = commandsModule;

const db = await openDatabase();

try {
  await db.employees.clear();
  await db.employeeRequirements.clear();

  const command = new AddEmployee(db, {
    employee: {
      firstName: 'Test',
      lastName: 'User',
      role: 'Nurse',
      status: 'Active'
    }
  });

  const result = await command.execute();
  const stored = await db.employees.get(result.employee.id);

  if (!result.employee.id) {
    throw new Error('AddEmployee should generate an id when one is not provided');
  }

  if (!stored) {
    throw new Error('Employee record should be persisted in the database');
  }

  if (stored.firstName !== 'Test' || stored.lastName !== 'User') {
    throw new Error('Employee data should be stored correctly');
  }

  console.log('AddEmployee command tests passed');
} finally {
  await db.close();
}
