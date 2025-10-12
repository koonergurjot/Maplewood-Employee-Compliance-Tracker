// ActivityLog – simple audit trail with undo capability.
import { generateId } from './db.js';

export default class ActivityLog {
  static async init(db) {
    db.table('activityLog');

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
  async record({ actionType, actor, targets = [], metadata = {}, undoPayload, supportsUndo = true }) {
    // Use the shared generator to ensure consistent IDs even when crypto.randomUUID
    // is unavailable (e.g., in some workers or legacy browsers).
    const entry = {
      id: generateId(),
      timestamp: Date.now(),
      actor,
      actionType,
      targets,
      metadata,
      undoPayload,
      supportsUndo,
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
