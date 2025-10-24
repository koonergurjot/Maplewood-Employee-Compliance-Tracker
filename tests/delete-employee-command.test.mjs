import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';

if (!globalThis.indexedDB) {
  globalThis.indexedDB = indexedDB;
}
if (!globalThis.IDBKeyRange) {
  globalThis.IDBKeyRange = IDBKeyRange;
}

const dbModule = await import('../db.js');
const commandsModule = await import('../commands.js');
class FakeActivityLog {
  constructor() {
    this.entries = [];
  }

  unshift(entry) {
    this.entries.unshift(entry);
  }
}

const db = await dbModule.openDatabase();

test('deleteEmployee removes records and logs activity', async () => {
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

    const activityLog = new FakeActivityLog();
    await commandsModule.deleteEmployee({ db, employeeId: 'emp1', activityLog });

    const remainingEmployees = await db.employees.toArray();
    const remainingLinks = await db.employeeRequirements.toArray();

    assert.ok(
      !remainingEmployees.find(emp => emp.id === 'emp1'),
      'Employee record should be deleted'
    );

    assert.ok(
      !remainingLinks.some(link => link.employeeId === 'emp1'),
      'Related employee requirements should be deleted'
    );

    assert.ok(
      remainingLinks.find(link => link.employeeId === 'emp2'),
      'Employee requirements for other employees should remain'
    );

    assert.equal(activityLog.entries.length, 1, 'Activity log should record one entry');
    const [entry] = activityLog.entries;
    assert.equal(entry.type, 'employee:delete');
    assert.equal(entry.summary, 'Deleted employee Ada Lovelace (Engineer)');
    assert.equal(typeof entry.createdAt, 'string');
    assert.ok(!Number.isNaN(Date.parse(entry.createdAt)), 'createdAt should be an ISO date string');
  } finally {
    await db.close();
  }
});
