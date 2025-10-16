import { AddEmployee, ImportEmployees } from '../../commands.js';

function assertDb(db) {
  if (!db || typeof db.table !== 'function') {
    throw new Error('A Dexie database instance is required.');
  }
  return db;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

async function recordActivity(activityLog, entry) {
  if (!activityLog || typeof activityLog.record !== 'function') {
    return null;
  }
  try {
    return await activityLog.record(entry);
  } catch (error) {
    console.error('Compat activity record failed', error);
    return null;
  }
}

export async function addEmployee({
  db,
  activityLog,
  employee,
  actor = 'user',
  metadata = {},
  supportsUndo = true
} = {}) {
  const database = assertDb(db);
  if (!employee || typeof employee !== 'object') {
    throw new Error('Employee payload is required.');
  }

  const command = new AddEmployee(database, { employee });
  const undoPayload = await command.execute();

  await recordActivity(activityLog, {
    actionType: 'AddEmployee',
    actor,
    targets: [employee.id],
    metadata: { ...metadata, employee },
    undoPayload,
    supportsUndo
  });

  return { undoPayload, employee };
}

export async function importEmployees({
  db,
  activityLog,
  employees,
  actor = 'user',
  metadata = {},
  skipped = 0,
  supportsUndo = true
} = {}) {
  const database = assertDb(db);
  const normalizedEmployees = toArray(employees);
  if (!normalizedEmployees.length) {
    return { added: 0, updated: 0, skipped };
  }

  const command = new ImportEmployees(database, { employees: normalizedEmployees });
  const undoPayload = await command.execute();
  const added = undoPayload.addedEmployees?.length || 0;
  const updated = undoPayload.updatedSnapshots?.length || 0;
  const targets = new Set();
  toArray(undoPayload.addedEmployees).forEach(emp => targets.add(emp.id));
  toArray(undoPayload.updatedSnapshots).forEach(emp => targets.add(emp.id));

  if (added || updated) {
    await recordActivity(activityLog, {
      actionType: 'ImportEmployees',
      actor,
      targets: Array.from(targets),
      metadata: { ...metadata, added, updated, skipped },
      undoPayload,
      supportsUndo
    });
  }

  return { added, updated, skipped };
}
