// ActivityLog – simple audit trail with undo capability.
export default class ActivityLog {
  static async init(db) {
    // Ensure the table exists before opening.
    if (!db.tables.some(t => t.name === 'activityLog')) {
      try {
  db.version(db.verno + 1).stores({
    activityLog: 'id,timestamp,actionType'
  });
} catch (e) {
  // If version bump fails (e.g., another tab holds the DB), proceed to open and hope table exists.
  console.warn('ActivityLog schema ensure failed (non-fatal):', e);
}
try {
  await db.open();
} catch (e) {
  console.error('Failed to open DB for ActivityLog:', e);
}
    return new ActivityLog(db);
  }

  constructor(db) {
    this.db = db;
    this.table = db.table('activityLog');
  }

  // Record a completed command.
  async record({ actionType, actor, targets = [], metadata = {}, undoPayload }) {
    const entry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      actor,
      actionType,
      targets,
      metadata,
      undoPayload,
      status: 'completed'
    };
    await this.table.add(entry);
    return entry;
  }

  // Undo a previous action.
  async undo(id, commandFactory) {
    return this.db.transaction('rw', this.table, async () => {
      const entry = await this.table.get(id);
      if (!entry || entry.status !== 'completed') return;
      const command = commandFactory(entry);
      await command.undo(entry.undoPayload);
      entry.status = 'undone';
      await this.table.put(entry);
    });
  }

  // Fetch most‑recent log entries.
  async recent(limit = 20) {
    return this.table
      .orderBy('timestamp')
      .reverse()
      .limit(limit)
      .toArray();
  }
}
