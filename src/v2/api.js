import { AddEmployee, ImportEmployees } from '../../commands.js';
import ActivityLog from '../../activity-log.js';
import { generateId } from '../../db.js';

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

function toPositiveInteger(value, fallback = 0) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, numeric);
}

function normalizeSource(value) {
  if (typeof value !== 'string') {
    return 'CSV';
  }
  const trimmed = value.trim();
  return trimmed || 'CSV';
}

function resolveActivitiesTable(db) {
  if (!db) {
    return null;
  }
  if (typeof db.table === 'function') {
    try {
      const table = db.table('activities');
      if (table) {
        return table;
      }
    } catch (error) {
      console.warn('Failed to access activities table via table()', error);
    }
  }
  return db.activities || null;
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
  const result = await command.execute();
  const undoPayload = result;
  const createdEmployee = result?.employee || employee;
  const targetId = createdEmployee?.id || employee.id;

  await recordActivity(activityLog, {
    actionType: 'AddEmployee',
    actor,
    targets: targetId ? [targetId] : [],
    metadata: { ...metadata, employee: createdEmployee },
    undoPayload,
    supportsUndo
  });

  return { undoPayload, employee: createdEmployee };
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

export async function recordImportActivity({
  db,
  activityLog = null,
  actor = 'Admin',
  added = 0,
  updated = 0,
  skipped = 0,
  total,
  source = 'CSV',
  metadata = {}
} = {}) {
  const database = assertDb(db);
  const addedCount = toPositiveInteger(added, 0);
  const updatedCount = toPositiveInteger(updated, 0);
  const skippedCount = toPositiveInteger(skipped, 0);
  const resolvedTotal = Number.isFinite(Number(total))
    ? Math.max(0, Math.trunc(Number(total)))
    : addedCount + updatedCount;
  const normalizedSource = normalizeSource(source);
  const normalizedActor = typeof actor === 'string' && actor.trim() ? actor.trim() : 'Admin';
  const safeMetadata = metadata && typeof metadata === 'object' ? { ...metadata } : {};
  const timestampIso = new Date().toISOString();
  const summary = `Imported ${resolvedTotal} employees (${normalizedSource}). ${addedCount} added, ${updatedCount} updated.`;
  const details = {
    added: addedCount,
    updated: updatedCount,
    skipped: skippedCount,
    total: resolvedTotal,
    source: normalizedSource,
    approval: {
      by: normalizedActor,
      at: timestampIso
    },
    ...safeMetadata
  };

  const entry = {
    type: 'import',
    summary,
    details,
    createdAt: timestampIso
  };

  const activitiesTable = resolveActivitiesTable(database);
  if (activitiesTable && typeof activitiesTable.add === 'function') {
    try {
      entry.id = await activitiesTable.add(entry);
    } catch (error) {
      console.warn('Failed to persist import activity in activities table', error);
    }
  }

  if (entry.id == null) {
    entry.id = generateId();
  }

  try {
    const logInstance = activityLog
      || (ActivityLog && typeof ActivityLog.init === 'function' ? await ActivityLog.init(database) : null);
    if (logInstance) {
      await recordActivity(logInstance, {
        actionType: 'ImportEmployees',
        actor: normalizedActor,
        targets: [],
        metadata: {
          added: addedCount,
          updated: updatedCount,
          skipped: skippedCount,
          total: resolvedTotal,
          source: normalizedSource,
          ...safeMetadata
        },
        undoPayload: null,
        supportsUndo: false
      });
    }
  } catch (error) {
    console.warn('Failed to record legacy import activity', error);
  }

  return entry;
}
