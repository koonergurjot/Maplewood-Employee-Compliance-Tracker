const MS_PER_DAY = 1000 * 60 * 60 * 24;

export const ANALYTICS_AT_RISK_WINDOW_DAYS = 30;
export const ANALYTICS_EXPIRING_WINDOW_DAYS = 7;

function normalizeString(value) {
  return (value ?? '').toString().trim();
}

function parseDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeDate(date) {
  if (!(date instanceof Date)) {
    return null;
  }
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

export function normalizeStatus(status) {
  const lowered = normalizeString(status).toLowerCase();
  if (lowered === 'completed' || lowered === 'complete') return 'Completed';
  if (lowered === 'exempt' || lowered === 'not required') return 'Exempt';
  if (lowered === 'pending' || lowered === 'incomplete') return 'Pending';
  return status ? normalizeString(status) : 'Pending';
}

export function evaluateRequirementState(record, options = {}) {
  const {
    today = new Date(),
    atRiskWindowDays = ANALYTICS_AT_RISK_WINDOW_DAYS,
    expiringSoonDays = ANALYTICS_EXPIRING_WINDOW_DAYS
  } = options;

  const status = normalizeStatus(record?.status || 'Pending');
  let compliant = status === 'Completed' || status === 'Exempt';
  const expiresOn = record?.expiresOn ? parseDate(record.expiresOn) : null;
  const todayNormalized = normalizeDate(today);
  const expiresNormalized = expiresOn ? normalizeDate(expiresOn) : null;

  let daysUntilExpiry = null;
  let expired = false;
  if (expiresNormalized && todayNormalized) {
    const diff = expiresNormalized.getTime() - todayNormalized.getTime();
    daysUntilExpiry = Math.round(diff / MS_PER_DAY);
    expired = diff < 0;
    if (expired && status === 'Completed') {
      compliant = false;
    }
  }

  const overdue = !compliant && expired;
  const withinAtRiskWindow =
    !compliant &&
    daysUntilExpiry !== null &&
    daysUntilExpiry >= 0 &&
    daysUntilExpiry <= atRiskWindowDays;
  const expiringSoon =
    !compliant &&
    daysUntilExpiry !== null &&
    daysUntilExpiry >= 0 &&
    daysUntilExpiry <= expiringSoonDays;
  const expiringThisWeek =
    !compliant &&
    daysUntilExpiry !== null &&
    daysUntilExpiry >= 0 &&
    daysUntilExpiry <= expiringSoonDays;

  return {
    status,
    compliant,
    expiresOn,
    daysUntilExpiry,
    expired,
    overdue,
    expiringSoon,
    expiringThisWeek,
    atRisk: overdue || withinAtRiskWindow
  };
}

function requirementStatsFactory(requirement) {
  return {
    requirementId: requirement?.id ?? null,
    name: normalizeString(requirement?.name) || 'Untitled requirement',
    atRiskCount: 0,
    overdueCount: 0,
    expiringSoonCount: 0,
    expiringThisWeekCount: 0
  };
}

export function computeAnalyticsSummary(context) {
  const {
    employees = [],
    requirements = [],
    employeeRequirements = [],
    options = {}
  } = context || {};

  const atRiskWindowDays = Number.isFinite(options.atRiskWindowDays)
    ? options.atRiskWindowDays
    : ANALYTICS_AT_RISK_WINDOW_DAYS;
  const expiringSoonDays = Number.isFinite(options.expiringSoonDays)
    ? options.expiringSoonDays
    : ANALYTICS_EXPIRING_WINDOW_DAYS;
  const today = options.today instanceof Date && !Number.isNaN(options.today.getTime())
    ? new Date(options.today)
    : new Date();

  const requirementIndex = new Map();
  (Array.isArray(requirements) ? requirements : []).forEach(requirement => {
    if (!requirement || !requirement.id) {
      return;
    }
    requirementIndex.set(requirement.id, requirementStatsFactory(requirement));
  });

  const recordIndex = new Map();
  for (const record of Array.isArray(employeeRequirements) ? employeeRequirements : []) {
    if (!record || !record.employeeId || !record.requirementId) {
      continue;
    }
    const key = `${record.employeeId}::${record.requirementId}`;
    recordIndex.set(key, record);
  }

  const requirementList = Array.isArray(requirements) ? requirements : [];
  const requirementCount = requirementList.length;
  const roleStats = new Map();

  for (const employee of Array.isArray(employees) ? employees : []) {
    if (!employee) continue;
    const role = normalizeString(employee.role) || 'Unassigned';
    let completed = 0;

    for (const requirement of requirementList) {
      if (!requirement || !requirement.id) continue;
      const key = `${employee.id ?? ''}::${requirement.id}`;
      const record = recordIndex.get(key) || null;
      const stats = requirementIndex.get(requirement.id);
      if (!stats) continue;

      const state = evaluateRequirementState(record, {
        today,
        atRiskWindowDays,
        expiringSoonDays
      });

      if (state.compliant) {
        completed += 1;
      }
      if (state.overdue) {
        stats.overdueCount += 1;
      }
      if (state.expiringSoon) {
        stats.expiringSoonCount += 1;
      }
      if (state.atRisk) {
        stats.atRiskCount += 1;
      }
      if (state.expiringThisWeek) {
        stats.expiringThisWeekCount += 1;
      }
    }

    const entry = roleStats.get(role) || { role, employeeCount: 0, complianceTotal: 0 };
    entry.employeeCount += 1;
    if (requirementCount > 0) {
      entry.complianceTotal += Math.round((completed / requirementCount) * 100);
    }
    roleStats.set(role, entry);
  }

  const atRisk = Array.from(requirementIndex.values())
    .filter(item => item.atRiskCount > 0)
    .sort((a, b) => {
      if (b.atRiskCount !== a.atRiskCount) return b.atRiskCount - a.atRiskCount;
      if (b.overdueCount !== a.overdueCount) return b.overdueCount - a.overdueCount;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 4);

  const complianceByRole = Array.from(roleStats.values())
    .map(item => ({
      role: item.role,
      employeeCount: item.employeeCount,
      averageCompliance: item.employeeCount
        ? Math.round(item.complianceTotal / item.employeeCount)
        : 0
    }))
    .sort((a, b) => {
      if (a.averageCompliance !== b.averageCompliance) {
        return a.averageCompliance - b.averageCompliance;
      }
      return a.role.localeCompare(b.role);
    })
    .slice(0, 4);

  const expiringThisWeek = Array.from(requirementIndex.values())
    .filter(item => item.expiringThisWeekCount > 0)
    .sort((a, b) => {
      if (b.expiringThisWeekCount !== a.expiringThisWeekCount) {
        return b.expiringThisWeekCount - a.expiringThisWeekCount;
      }
      return a.name.localeCompare(b.name);
    })
    .slice(0, 4)
    .map(item => ({
      requirementId: item.requirementId,
      name: item.name,
      count: item.expiringThisWeekCount
    }));

  const totals = Array.from(requirementIndex.values()).reduce(
    (acc, item) => {
      acc.atRiskAssignments += item.atRiskCount;
      acc.overdueAssignments += item.overdueCount;
      acc.expiringThisWeek += item.expiringThisWeekCount;
      return acc;
    },
    { atRiskAssignments: 0, overdueAssignments: 0, expiringThisWeek: 0 }
  );

  return {
    generatedAt: today.toISOString(),
    atRisk,
    complianceByRole,
    expiringThisWeek,
    totals
  };
}
