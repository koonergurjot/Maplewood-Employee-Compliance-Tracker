// Command implementations used by the activity log.

export class EditEmployee {
  constructor(db, employeeId, newData) {
    this.db = db;
    this.employeeId = employeeId;
    this.newData = newData;
  }

  async execute() {
    const prev = await this.db.employees.get(this.employeeId);
    await this.db.employees.update(this.employeeId, this.newData);
    return { prev }; // payload for undo
  }

  async undo({ prev }) {
    await this.db.employees.put(prev);
  }
}

export class ImportEmployees {
  constructor(db, rows) {
    this.db = db;
    this.rows = rows;
  }

  async execute() {
    const ids = [];
    const records = this.rows.map(row => {
      const id = crypto.randomUUID();
      ids.push(id);
      return { id, ...row };
    });
    await this.db.employees.bulkAdd(records);
    return { ids };
  }

  async undo({ ids }) {
    await this.db.employees.bulkDelete(ids);
  }
}

export class BulkUpdateStatus {
  constructor(db, employeeIds, requirementId, status) {
    this.db = db;
    this.employeeIds = employeeIds;
    this.requirementId = requirementId;
    this.status = status;
  }

  async execute() {
    const prev = [];
    for (const employeeId of this.employeeIds) {
      const key = [employeeId, this.requirementId];
      const existing = await this.db.employeeRequirements.get(key);
      prev.push({ employeeId, record: existing });
      await this.db.employeeRequirements.put({
        employeeId,
        requirementId: this.requirementId,
        status: this.status
      });
    }
    return { prev };
  }

  async undo({ prev }) {
    for (const { employeeId, record } of prev) {
      if (record) {
        await this.db.employeeRequirements.put(record);
      } else {
        await this.db.employeeRequirements.delete([employeeId, this.requirementId]);
      }
    }
  }
}
