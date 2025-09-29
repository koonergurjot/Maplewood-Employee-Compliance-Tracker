// Command implementations used by the activity log.

const clone = (value) => {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
};

function generateId(){
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof Dexie !== 'undefined' && typeof Dexie.uuid === 'function') {
    return Dexie.uuid();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

const nowISO = () => new Date().toISOString();

export class AddEmployee {
  constructor(db, { employee } = {}) {
    this.db = db;
    this.employee = employee;
  }

  async execute() {
    if (!this.employee) {
      throw new Error('Missing employee data for AddEmployee command');
    }

    const employee = clone(this.employee);
    const timestamp = nowISO();
    employee.createdAt = employee.createdAt || timestamp;
    employee.updatedAt = timestamp;

    return this.db.transaction('rw', this.db.employees, this.db.requirements, this.db.employeeRequirements, async () => {
      await this.db.employees.add(employee);
      const requirements = await this.db.requirements.toArray();
      const employeeRequirements = requirements.map(req => ({
        id: generateId(),
        employeeId: employee.id,
        requirementId: req.id,
        status: 'NotCompleted',
        completedOn: null,
        expiresOn: null,
        notes: null,
        updatedAt: timestamp
      }));
      if (employeeRequirements.length) {
        await this.db.employeeRequirements.bulkAdd(employeeRequirements);
      }
      return {
        employee,
        employeeRequirements
      };
    });
  }

  async undo({ employee, employeeRequirements }) {
    if (!employee) return;
    await this.db.transaction('rw', this.db.employees, this.db.employeeRequirements, async () => {
      if (employeeRequirements?.length) {
        await this.db.employeeRequirements.bulkDelete(employeeRequirements.map(er => er.id));
      }
      await this.db.employees.delete(employee.id);
    });
  }
}

export class UpdateEmployee {
  constructor(db, { employeeId, newData } = {}) {
    this.db = db;
    this.employeeId = employeeId;
    this.newData = newData;
  }

  async execute() {
    if (!this.employeeId || !this.newData) {
      throw new Error('Missing data for UpdateEmployee command');
    }
    const prev = await this.db.employees.get(this.employeeId);
    await this.db.employees.update(this.employeeId, this.newData);
    return { previous: clone(prev) };
  }

  async undo({ previous }) {
    if (!previous) return;
    await this.db.employees.put(previous);
  }
}

export class AddRequirement {
  constructor(db, { requirement } = {}) {
    this.db = db;
    this.requirement = requirement;
  }

  async execute() {
    if (!this.requirement) {
      throw new Error('Missing requirement data for AddRequirement command');
    }

    const requirement = clone(this.requirement);
    const timestamp = nowISO();
    requirement.createdAt = requirement.createdAt || timestamp;
    requirement.updatedAt = timestamp;

    return this.db.transaction('rw', this.db.requirements, this.db.employees, this.db.employeeRequirements, async () => {
      await this.db.requirements.add(requirement);
      const employees = await this.db.employees.toArray();
      const employeeRequirements = employees.map(emp => ({
        id: generateId(),
        employeeId: emp.id,
        requirementId: requirement.id,
        status: 'NotCompleted',
        completedOn: null,
        expiresOn: null,
        notes: null,
        updatedAt: timestamp
      }));
      if (employeeRequirements.length) {
        await this.db.employeeRequirements.bulkAdd(employeeRequirements);
      }
      return {
        requirement,
        employeeRequirements
      };
    });
  }

  async undo({ requirement, employeeRequirements }) {
    if (!requirement) return;
    await this.db.transaction('rw', this.db.requirements, this.db.employeeRequirements, async () => {
      await this.db.requirements.delete(requirement.id);
      if (employeeRequirements?.length) {
        await this.db.employeeRequirements.bulkDelete(employeeRequirements.map(er => er.id));
      }
    });
  }
}

export class UpdateRequirement {
  constructor(db, { requirementId, newData } = {}) {
    this.db = db;
    this.requirementId = requirementId;
    this.newData = newData;
  }

  async execute() {
    if (!this.requirementId || !this.newData) {
      throw new Error('Missing data for UpdateRequirement command');
    }
    const prev = await this.db.requirements.get(this.requirementId);
    await this.db.requirements.update(this.requirementId, this.newData);
    return { previous: clone(prev) };
  }

  async undo({ previous }) {
    if (!previous) return;
    await this.db.requirements.put(previous);
  }
}

export class DeleteRequirement {
  constructor(db, { requirementId } = {}) {
    this.db = db;
    this.requirementId = requirementId;
  }

  async execute() {
    if (!this.requirementId) {
      throw new Error('Missing requirementId for DeleteRequirement command');
    }

    return this.db.transaction('rw', this.db.requirements, this.db.employeeRequirements, async () => {
      const requirement = await this.db.requirements.get(this.requirementId);
      const employeeRequirements = await this.db.employeeRequirements.where('requirementId').equals(this.requirementId).toArray();
      await this.db.requirements.delete(this.requirementId);
      await this.db.employeeRequirements.where('requirementId').equals(this.requirementId).delete();
      return {
        requirement: clone(requirement),
        employeeRequirements: employeeRequirements.map(clone)
      };
    });
  }

  async undo({ requirement, employeeRequirements }) {
    if (!requirement) return;
    await this.db.transaction('rw', this.db.requirements, this.db.employeeRequirements, async () => {
      await this.db.requirements.put(requirement);
      if (employeeRequirements?.length) {
        await this.db.employeeRequirements.bulkAdd(employeeRequirements);
      }
    });
  }
}

export class BulkUpdateStatus {
  constructor(db, { employeeIds = [], requirementIds = [], status, completedOn = null, expiresOn = null } = {}) {
    this.db = db;
    this.employeeIds = employeeIds;
    this.requirementIds = requirementIds;
    this.status = status;
    this.completedOn = completedOn;
    this.expiresOn = expiresOn;
  }

  async execute() {
    if (!this.employeeIds.length || !this.requirementIds.length || !this.status) {
      return { changes: [] };
    }

    const changes = [];
    const timestamp = nowISO();
    const resolveExpiresOn = (requirementId, fallback = null) => {
      if (this.status !== 'Completed' || this.expiresOn == null) {
        return this.status === 'Completed' ? fallback : null;
      }
      if (this.expiresOn instanceof Map) {
        return this.expiresOn.has(requirementId)
          ? (this.expiresOn.get(requirementId) ?? null)
          : fallback;
      }
      if (typeof this.expiresOn === 'object' && !Array.isArray(this.expiresOn)) {
        if (Object.prototype.hasOwnProperty.call(this.expiresOn, requirementId)) {
          return this.expiresOn[requirementId] ?? null;
        }
        return fallback;
      }
      if (typeof this.expiresOn === 'string') {
        return this.expiresOn;
      }
      return fallback;
    };

    await this.db.transaction('rw', this.db.employeeRequirements, async () => {
      for (const employeeId of this.employeeIds) {
        for (const requirementId of this.requirementIds) {
          const existing = await this.db.employeeRequirements
            .where('[employeeId+requirementId]')
            .equals([employeeId, requirementId])
            .first();

          if (existing) {
            changes.push({ type: 'update', record: clone(existing) });
            const expiresOnValue = resolveExpiresOn(requirementId, existing.expiresOn ?? null);
            await this.db.employeeRequirements.update(existing.id, {
              status: this.status,
              completedOn: this.status === 'Completed' ? this.completedOn : null,
              expiresOn: this.status === 'Completed' ? expiresOnValue : null,
              updatedAt: timestamp
            });
          } else {
            const record = {
              id: generateId(),
              employeeId,
              requirementId,
              status: this.status,
              completedOn: this.status === 'Completed' ? this.completedOn : null,
              expiresOn: this.status === 'Completed' ? resolveExpiresOn(requirementId, null) : null,
              notes: null,
              updatedAt: timestamp
            };
            await this.db.employeeRequirements.add(record);
            changes.push({ type: 'create', record: clone(record) });
          }
        }
      }
    });

    return { changes };
  }

  async undo({ changes }) {
    if (!changes?.length) return;
    await this.db.transaction('rw', this.db.employeeRequirements, async () => {
      for (const change of changes.reverse()) {
        if (change.type === 'update' && change.record) {
          await this.db.employeeRequirements.put(change.record);
        } else if (change.type === 'create' && change.record) {
          await this.db.employeeRequirements.delete(change.record.id);
        }
      }
    });
  }
}

export class BulkDeleteEmployees {
  constructor(db, { employeeIds = [] } = {}) {
    this.db = db;
    this.employeeIds = employeeIds;
  }

  async execute() {
    if (!this.employeeIds.length) {
      return { employees: [], employeeRequirements: [] };
    }

    return this.db.transaction('rw', this.db.employees, this.db.employeeRequirements, async () => {
      const employees = (await this.db.employees.bulkGet(this.employeeIds))
        .filter(Boolean)
        .map(clone);
      const employeeRequirements = await this.db.employeeRequirements
        .where('employeeId')
        .anyOf(this.employeeIds)
        .toArray();
      const requirementSnapshots = employeeRequirements.map(clone);
      if (this.employeeIds.length) {
        await this.db.employees.bulkDelete(this.employeeIds);
      }
      if (employeeRequirements.length) {
        await this.db.employeeRequirements.bulkDelete(employeeRequirements.map(er => er.id));
      }
      return {
        employees,
        employeeRequirements: requirementSnapshots
      };
    });
  }

  async undo({ employees, employeeRequirements }) {
    await this.db.transaction('rw', this.db.employees, this.db.employeeRequirements, async () => {
      if (employees?.length) {
        await this.db.employees.bulkPut(employees);
      }
      if (employeeRequirements?.length) {
        await this.db.employeeRequirements.bulkPut(employeeRequirements);
      }
    });
  }
}

const compositeKey = (record) => [
  (record.lastName || '').trim().toLowerCase(),
  (record.firstName || '').trim().toLowerCase(),
  (record.role || '').trim().toLowerCase()
].join('|');

export class ImportEmployees {
  constructor(db, { employees = [] } = {}) {
    this.db = db;
    this.employees = employees;
  }

  async execute() {
    if (!this.employees.length) {
      return { addedEmployees: [], addedEmployeeRequirements: [], updatedSnapshots: [] };
    }

    return this.db.transaction('rw', this.db.employees, this.db.employeeRequirements, this.db.requirements, async () => {
      const addedEmployees = [];
      const addedEmployeeRequirements = [];
      const updatedSnapshots = [];
      const existing = await this.db.employees.toArray();
      const byEmpId = new Map(existing.filter(e => e.employeeId).map(e => [String(e.employeeId), e]));
      const byComposite = new Map(existing.map(e => [compositeKey(e), e]));
      const requirements = await this.db.requirements.toArray();

      for (const incoming of this.employees) {
        const normalizedId = incoming.employeeId ? String(incoming.employeeId) : '';
        const key = compositeKey(incoming);
        let match = normalizedId ? byEmpId.get(normalizedId) : null;
        if (!match && key) {
          match = byComposite.get(key) || null;
        }

        if (match) {
          const prev = clone(match);
          const updatedRecord = {
            ...match,
            ...incoming,
            id: match.id,
            createdAt: match.createdAt,
            updatedAt: nowISO()
          };
          await this.db.employees.put(updatedRecord);
          updatedSnapshots.push(prev);
          if (normalizedId) byEmpId.set(normalizedId, updatedRecord);
          if (key) byComposite.set(key, updatedRecord);
        } else {
          const employee = clone(incoming);
          employee.id = employee.id || generateId();
          const timestamp = nowISO();
          employee.createdAt = employee.createdAt || timestamp;
          employee.updatedAt = timestamp;
          await this.db.employees.add(employee);
          addedEmployees.push(clone(employee));
          if (requirements.length) {
            const rows = requirements.map(req => ({
              id: generateId(),
              employeeId: employee.id,
              requirementId: req.id,
              status: 'NotCompleted',
              completedOn: null,
              expiresOn: null,
              notes: null,
              updatedAt: timestamp
            }));
            await this.db.employeeRequirements.bulkAdd(rows);
            addedEmployeeRequirements.push(...rows.map(clone));
          }
          if (normalizedId) byEmpId.set(normalizedId, employee);
          if (key) byComposite.set(key, employee);
          existing.push(employee);
        }
      }

      return {
        addedEmployees,
        addedEmployeeRequirements,
        updatedSnapshots
      };
    });
  }

  async undo({ addedEmployees, addedEmployeeRequirements, updatedSnapshots }) {
    await this.db.transaction('rw', this.db.employees, this.db.employeeRequirements, async () => {
      if (addedEmployeeRequirements?.length) {
        await this.db.employeeRequirements.bulkDelete(addedEmployeeRequirements.map(er => er.id));
      }
      if (addedEmployees?.length) {
        await this.db.employees.bulkDelete(addedEmployees.map(emp => emp.id));
      }
      if (updatedSnapshots?.length) {
        await this.db.employees.bulkPut(updatedSnapshots);
      }
    });
  }
}

export class ImportCompletions {
  constructor(db, { updates = [] } = {}) {
    this.db = db;
    this.updates = updates;
  }

  async execute() {
    if (!this.updates.length) {
      return { changes: [] };
    }

    const changes = [];
    await this.db.transaction('rw', this.db.employeeRequirements, async () => {
      for (const update of this.updates) {
        const { employeeId, requirementId, status, completedOn, expiresOn, notes = null } = update;
        const existing = await this.db.employeeRequirements
          .where('[employeeId+requirementId]')
          .equals([employeeId, requirementId])
          .first();

        if (existing) {
          changes.push({ type: 'update', record: clone(existing) });
          await this.db.employeeRequirements.update(existing.id, {
            status,
            completedOn,
            expiresOn,
            notes: notes ?? existing.notes ?? null,
            updatedAt: nowISO()
          });
        } else {
          const record = {
            id: generateId(),
            employeeId,
            requirementId,
            status,
            completedOn,
            expiresOn,
            notes,
            updatedAt: nowISO()
          };
          await this.db.employeeRequirements.add(record);
          changes.push({ type: 'create', record: clone(record) });
        }
      }
    });

    return { changes };
  }

  async undo({ changes }) {
    if (!changes?.length) return;
    await this.db.transaction('rw', this.db.employeeRequirements, async () => {
      for (const change of changes.reverse()) {
        if (change.type === 'update' && change.record) {
          await this.db.employeeRequirements.put(change.record);
        } else if (change.type === 'create' && change.record) {
          await this.db.employeeRequirements.delete(change.record.id);
        }
      }
    });
  }
}
