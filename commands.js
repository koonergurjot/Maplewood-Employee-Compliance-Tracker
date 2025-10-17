// Command implementations used by the activity log.

import { generateId as sharedGenerateId } from './db.js';

const clone = (value) => {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
};

export const generateId = sharedGenerateId;

const nowISO = () => new Date().toISOString();

const normalizeRole = (role) => (role || '').trim().toLowerCase();

const prepareTemplateIndex = (templates = []) => {
  const roleIndex = new Map();
  const prepared = templates.map(template => {
    const roles = Array.isArray(template.roles) ? template.roles : [];
    const excluded = Array.isArray(template.excludedRequirementIds)
      ? template.excludedRequirementIds
      : [];
    const cleanedRoles = roles
      .map(role => (role == null ? '' : String(role).trim()))
      .filter(Boolean);
    const cleanedExcluded = excluded
      .map(id => (id == null ? '' : String(id).trim()))
      .filter(Boolean);
    const preparedTemplate = {
      ...template,
      roles: cleanedRoles,
      excludedRequirementIds: cleanedExcluded,
      _excludedSet: new Set(cleanedExcluded)
    };
    for (const role of cleanedRoles) {
      const key = normalizeRole(role);
      if (!key || roleIndex.has(key)) continue;
      roleIndex.set(key, preparedTemplate);
    }
    return preparedTemplate;
  });
  return { prepared, roleIndex };
};

export const fetchTemplateIndex = async (db) => {
  if (!db?.roleRequirementProfiles) {
    return { prepared: [], roleIndex: new Map() };
  }
  try {
    const templates = await db.roleRequirementProfiles.toArray();
    return prepareTemplateIndex(templates || []);
  } catch (error) {
    console.warn('Failed to load role requirement templates', error);
    return { prepared: [], roleIndex: new Map() };
  }
};

export const resolveTemplateForRole = (role, roleIndex) => {
  const key = normalizeRole(role);
  return roleIndex.get(key) || null;
};

const templateExcludesRequirement = (template, requirementId) => {
  if (!template) return false;
  const normalisedId = requirementId == null ? '' : String(requirementId).trim();
  if (!normalisedId) return false;
  if (template._excludedSet instanceof Set) {
    return template._excludedSet.has(normalisedId);
  }
  const excluded = Array.isArray(template.excludedRequirementIds)
    ? template.excludedRequirementIds.map(id => (id == null ? '' : String(id).trim()))
    : [];
  return excluded.includes(normalisedId);
};

export const determineStatusForTemplate = (template, requirementId, fallback = 'NotCompleted') => {
  return templateExcludesRequirement(template, requirementId) ? 'NotRequired' : fallback;
};

export async function deleteEmployee({ db, employeeId, activityLog }) {
  if (!db || !employeeId) {
    return;
  }

  const employeesTable = db.employees;
  if (!employeesTable?.get) {
    return;
  }

  const employee = await employeesTable.get(employeeId);
  if (!employee) {
    return;
  }

  const employeeRequirementsTable = db.employeeRequirements;

  await db.transaction('rw', db.employees, db.employeeRequirements, async () => {
    if (employeeRequirementsTable?.where) {
      await employeeRequirementsTable.where({ employeeId }).delete();
    }
    await db.employees.delete(employeeId);
  });

  const fullName = `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || employee.name || 'Employee';
  const summary = `Deleted employee ${fullName} (${employee.role || 'Unknown Role'})`;
  const entry = {
    type: 'employee:delete',
    summary,
    createdAt: new Date().toISOString()
  };

  if (db.activities?.add) {
    await db.activities.add(entry);
  }

  activityLog?.unshift?.({ ...entry });
}

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
    employee.id = employee.id || generateId();
    const timestamp = nowISO();
    employee.createdAt = employee.createdAt || timestamp;
    employee.updatedAt = timestamp;
    const { roleIndex } = await fetchTemplateIndex(this.db);

    return this.db.transaction('rw', this.db.employees, this.db.requirements, this.db.employeeRequirements, async tx => {
      const employeesTable = tx.table('employees');
      const requirementsTable = tx.table('requirements');
      const employeeRequirementsTable = tx.table('employeeRequirements');

      await employeesTable.add(employee);
      const requirements = await requirementsTable.toArray();
      const template = resolveTemplateForRole(employee.role, roleIndex);
      const employeeRequirements = requirements.map(req => ({
        id: generateId(),
        employeeId: employee.id,
        requirementId: req.id,
        status: determineStatusForTemplate(template, req.id),
        completedOn: null,
        expiresOn: null,
        notes: null,
        updatedAt: timestamp
      }));
      if (employeeRequirements.length) {
        await employeeRequirementsTable.bulkAdd(employeeRequirements);
      }
      return {
        employee,
        employeeRequirements
      };
    });
  }

  async undo({ employee, employeeRequirements }) {
    if (!employee) return;
    await this.db.transaction('rw', this.db.employees, this.db.employeeRequirements, async tx => {
      const employeesTable = tx.table('employees');
      const employeeRequirementsTable = tx.table('employeeRequirements');

      if (employeeRequirements?.length) {
        await employeeRequirementsTable.bulkDelete(employeeRequirements.map(er => er.id));
      }
      await employeesTable.delete(employee.id);
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

export class DeleteEmployee {
  constructor(db, { employeeId } = {}) {
    this.db = db;
    this.employeeId = employeeId;
  }

  async execute() {
    if (!this.employeeId) {
      throw new Error('Missing employeeId for DeleteEmployee command');
    }

    return this.db.transaction('rw', this.db.employees, this.db.employeeRequirements, async tx => {
      const employeesTable = tx.table('employees');
      const employeeRequirementsTable = tx.table('employeeRequirements');

      const employee = await employeesTable.get(this.employeeId);
      if (!employee) {
        return { employee: null, employeeRequirements: [] };
      }

      const employeeRequirements = await employeeRequirementsTable
        .where('employeeId')
        .equals(this.employeeId)
        .toArray();

      await employeesTable.delete(this.employeeId);
      if (employeeRequirements.length) {
        await employeeRequirementsTable.bulkDelete(employeeRequirements.map(er => er.id));
      }

      return {
        employee: clone(employee),
        employeeRequirements: employeeRequirements.map(clone)
      };
    });
  }

  async undo({ employee, employeeRequirements }) {
    if (!employee) return;
    await this.db.transaction('rw', this.db.employees, this.db.employeeRequirements, async tx => {
      const employeesTable = tx.table('employees');
      const employeeRequirementsTable = tx.table('employeeRequirements');

      await employeesTable.put(employee);
      if (employeeRequirements?.length) {
        await employeeRequirementsTable.bulkPut(employeeRequirements);
      }
    });
  }
}

export class AddRequirement {
  constructor(db, { requirement, initialStatus = 'NotCompleted', respectTemplates = true } = {}) {
    this.db = db;
    this.requirement = requirement;
    this.initialStatus = typeof initialStatus === 'string' && initialStatus.trim()
      ? initialStatus.trim()
      : 'NotCompleted';
    this.respectTemplates = respectTemplates !== false;
  }

  async execute() {
    if (!this.requirement) {
      throw new Error('Missing requirement data for AddRequirement command');
    }

    const requirement = clone(this.requirement);
    requirement.id = requirement.id || generateId();
    const timestamp = nowISO();
    requirement.createdAt = requirement.createdAt || timestamp;
    requirement.updatedAt = timestamp;

    const { roleIndex } = this.respectTemplates ? await fetchTemplateIndex(this.db) : { roleIndex: new Map() };

    return this.db.transaction('rw', this.db.requirements, this.db.employees, this.db.employeeRequirements, async tx => {
      const requirementsTable = tx.table('requirements');
      const employeesTable = tx.table('employees');
      const employeeRequirementsTable = tx.table('employeeRequirements');

      await requirementsTable.add(requirement);
      const employees = await employeesTable.toArray();
      const employeeRequirements = employees.map(emp => {
        const template = this.respectTemplates ? resolveTemplateForRole(emp.role, roleIndex) : null;
        const status = this.respectTemplates
          ? determineStatusForTemplate(template, requirement.id, this.initialStatus)
          : this.initialStatus;
        return {
          id: generateId(),
          employeeId: emp.id,
          requirementId: requirement.id,
          status,
          completedOn: null,
          expiresOn: null,
          notes: null,
          updatedAt: timestamp
        };
      });
      if (employeeRequirements.length) {
        await employeeRequirementsTable.bulkAdd(employeeRequirements);
      }
      return {
        requirement,
        employeeRequirements
      };
    });
  }

  async undo({ requirement, employeeRequirements }) {
    if (!requirement) return;
    await this.db.transaction('rw', this.db.requirements, this.db.employeeRequirements, async tx => {
      const requirementsTable = tx.table('requirements');
      const employeeRequirementsTable = tx.table('employeeRequirements');

      await requirementsTable.delete(requirement.id);
      if (employeeRequirements?.length) {
        const ids = employeeRequirements.map(er => er.id);
        await employeeRequirementsTable.bulkDelete(ids);
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
    const { roleIndex } = await fetchTemplateIndex(this.db);
    const employees = await this.db.employees.bulkGet(this.employeeIds);
    const employeeMap = new Map();
    this.employeeIds.forEach((id, idx) => {
      const employee = employees[idx];
      if (employee) {
        employeeMap.set(id, employee);
      }
    });
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
        const employee = employeeMap.get(employeeId) || null;
        const template = resolveTemplateForRole(employee?.role, roleIndex);
        for (const requirementId of this.requirementIds) {
          if (templateExcludesRequirement(template, requirementId)) {
            continue;
          }
          const existing = await this.db.employeeRequirements
            .where('[employeeId+requirementId]')
            .equals([employeeId, requirementId])
            .first();

          if (existing?.status === 'NotRequired') {
            continue;
          }

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

export class ApplyTemplateToEmployees {
  constructor(db, { template, employeeIds = [], requirements = [] } = {}) {
    this.db = db;
    this.template = template || null;
    this.employeeIds = Array.isArray(employeeIds) ? employeeIds : [];
    this.requirements = Array.isArray(requirements) ? requirements : [];
  }

  async execute() {
    if (!this.template) {
      throw new Error('Missing template data for ApplyTemplateToEmployees command');
    }
    if (!this.employeeIds.length) {
      return { changes: [] };
    }

    const excludedSet = new Set(
      (this.template.excludedRequirementIds || [])
        .map(id => (id == null ? '' : String(id).trim()))
        .filter(Boolean)
    );
    const requirementIds = this.requirements.map(req => req.id).filter(id => id != null);
    if (!requirementIds.length) {
      return { changes: [] };
    }

    const changes = [];
    const timestamp = nowISO();

    await this.db.transaction('rw', this.db.employeeRequirements, async () => {
      const existingRecords = await this.db.employeeRequirements
        .where('employeeId')
        .anyOf(this.employeeIds)
        .toArray();
      const existingMap = new Map(
        existingRecords.map(record => [`${record.employeeId}|${record.requirementId}`, record])
      );

      for (const employeeId of this.employeeIds) {
        for (const requirementId of requirementIds) {
          const key = `${employeeId}|${requirementId}`;
          const existing = existingMap.get(key) || null;
          const isExcluded = excludedSet.has((requirementId ?? '').toString().trim());

          if (existing) {
            if (isExcluded) {
              if (
                existing.status !== 'NotRequired' ||
                existing.completedOn !== null ||
                existing.expiresOn !== null
              ) {
                changes.push({ type: 'update', previous: clone(existing) });
                await this.db.employeeRequirements.update(existing.id, {
                  status: 'NotRequired',
                  completedOn: null,
                  expiresOn: null,
                  updatedAt: timestamp
                });
              }
            } else if (existing.status === 'NotRequired') {
              changes.push({ type: 'update', previous: clone(existing) });
              await this.db.employeeRequirements.update(existing.id, {
                status: 'NotCompleted',
                completedOn: null,
                expiresOn: null,
                updatedAt: timestamp
              });
            }
          } else {
            const record = {
              id: generateId(),
              employeeId,
              requirementId,
              status: isExcluded ? 'NotRequired' : 'NotCompleted',
              completedOn: null,
              expiresOn: null,
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

  async undo({ changes = [] } = {}) {
    if (!Array.isArray(changes) || !changes.length) {
      return;
    }

    await this.db.transaction('rw', this.db.employeeRequirements, async () => {
      for (const change of [...changes].reverse()) {
        if (change.type === 'create' && change.record) {
          await this.db.employeeRequirements.delete(change.record.id);
        } else if (change.type === 'update' && change.previous) {
          await this.db.employeeRequirements.put(change.previous);
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
      const { roleIndex } = await fetchTemplateIndex(this.db);

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
          const template = resolveTemplateForRole(employee.role, roleIndex);
          if (requirements.length) {
            const rows = requirements.map(req => ({
              id: generateId(),
              employeeId: employee.id,
              requirementId: req.id,
              status: determineStatusForTemplate(template, req.id),
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
    const { roleIndex } = await fetchTemplateIndex(this.db);
    const employees = await this.db.employees.toArray();
    const employeeMap = new Map(employees.map(emp => [emp.id, emp]));
    await this.db.transaction('rw', this.db.employeeRequirements, async () => {
      for (const update of this.updates) {
        const { employeeId, requirementId, status, completedOn, expiresOn, notes = null } = update;
        const employee = employeeMap.get(employeeId) || null;
        const template = resolveTemplateForRole(employee?.role, roleIndex);
        if (templateExcludesRequirement(template, requirementId)) {
          continue;
        }
        const existing = await this.db.employeeRequirements
          .where('[employeeId+requirementId]')
          .equals([employeeId, requirementId])
          .first();

        if (existing?.status === 'NotRequired') {
          continue;
        }

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
