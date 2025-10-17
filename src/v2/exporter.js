const DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

const DEFAULT_INFO_ORDER = ['name', 'seniorityHours', 'jobClass', 'jobTitle', 'ranking', 'positionStatus'];

const INFO_LABELS = {
  name: 'Name',
  seniorityHours: 'Seniority Hours',
  jobClass: 'Job Class',
  jobTitle: 'Job Title',
  ranking: 'Ranking',
  positionStatus: 'Position Status'
};

const CORE_EXPORT_FIELDS = [
  {
    key: 'employeeId',
    label: 'Employee ID',
    csvValue: row => {
      const value = row?.employeeId;
      if (typeof value === 'number' || typeof value === 'string') {
        return String(value).trim();
      }
      return '';
    },
    jsonValue: row => {
      if (typeof row?.employeeId === 'number' || typeof row?.employeeId === 'string') {
        return row.employeeId;
      }
      return null;
    }
  },
  {
    key: 'firstName',
    label: 'First Name',
    csvValue: row => formatStringValue(row?.firstName),
    jsonValue: row => formatStringValue(row?.firstName)
  },
  {
    key: 'lastName',
    label: 'Last Name',
    csvValue: row => formatStringValue(row?.lastName),
    jsonValue: row => formatStringValue(row?.lastName)
  },
  {
    key: 'role',
    label: 'Role',
    csvValue: row => formatStringValue(row?.role),
    jsonValue: row => formatStringValue(row?.role)
  },
  {
    key: 'employmentType',
    label: 'Employment Type',
    csvValue: row => formatStringValue(row?.employmentType),
    jsonValue: row => formatStringValue(row?.employmentType)
  },
  {
    key: 'status',
    label: 'Status',
    csvValue: row => formatStringValue(row?.status),
    jsonValue: row => formatStringValue(row?.status)
  },
  {
    key: 'compliancePercent',
    label: 'Compliance %',
    csvValue: row => {
      const percent = normalizePercent(row?.compliancePercent);
      if (percent === null) {
        return formatStringValue(row?.compliancePercent);
      }
      return `${percent}%`;
    },
    jsonValue: row => normalizePercent(row?.compliancePercent)
  }
];

function formatDate(value) {
  if (!value) {
    return '';
  }
  try {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return DATE_FORMATTER.format(date);
  } catch (error) {
    console.warn('Failed to format date for export', error);
    return String(value);
  }
}

function formatRequirementCell(record) {
  if (!record) {
    return 'Pending';
  }
  const parts = [];
  const status = record.status ? String(record.status) : 'Pending';
  parts.push(status);
  if (record.completedOn) {
    parts.push(`Completed: ${formatDate(record.completedOn)}`);
  }
  if (record.expiresOn) {
    parts.push(`Expires: ${formatDate(record.expiresOn)}`);
  }
  if (record.notes) {
    parts.push(`Notes: ${String(record.notes)}`);
  }
  return parts.join(' | ');
}

function toCsvValue(value) {
  if (value === null || typeof value === 'undefined') {
    return '';
  }
  const stringValue = String(value);
  if (!stringValue) {
    return '';
  }
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function buildRequirementLookup(row) {
  const map = new Map();
  const entries = Array.isArray(row?.requirements) ? row.requirements : [];
  for (const entry of entries) {
    if (!entry) continue;
    const id = entry.requirementId ?? entry.id;
    if (typeof id === 'undefined' || id === null) continue;
    map.set(id, entry);
  }
  return map;
}

function resolveInfoOrder(columnOrder) {
  const provided = Array.isArray(columnOrder?.info) ? columnOrder.info : [];
  const normalized = [];
  const seen = new Set();
  for (const key of provided) {
    if (typeof key !== 'string') continue;
    const trimmed = key.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  if (!normalized.length) {
    return [...DEFAULT_INFO_ORDER];
  }
  return normalized;
}

function getInfoLabel(key) {
  return INFO_LABELS[key] || key;
}

function normalizeNumberLike(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const numeric = Number(trimmed.replace(/,/g, ''));
    return Number.isFinite(numeric) ? numeric : null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatStringValue(value) {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (value === null || typeof value === 'undefined') {
    return '';
  }
  return String(value);
}

function normalizePercent(value) {
  const cleaned = typeof value === 'string' ? value.trim().replace(/%$/, '') : value;
  const numeric = normalizeNumberLike(cleaned);
  if (numeric === null) {
    return null;
  }
  const rounded = Math.round(Number(numeric));
  if (!Number.isFinite(rounded)) {
    return null;
  }
  return Math.max(0, Math.min(100, rounded));
}

function formatInfoValue(row, key) {
  if (!row) {
    return '';
  }
  switch (key) {
    case 'name': {
      const provided = typeof row.name === 'string' && row.name.trim()
        ? row.name.trim()
        : typeof row.fullName === 'string' && row.fullName.trim()
          ? row.fullName.trim()
          : '';
      if (provided) {
        return provided;
      }
      const combined = `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim();
      return combined || 'Unnamed employee';
    }
    case 'seniorityHours': {
      const numeric = normalizeNumberLike(row.seniorityHours);
      if (numeric !== null) {
        return numeric.toLocaleString();
      }
      if (typeof row.seniorityHours === 'string') {
        return row.seniorityHours.trim();
      }
      return '';
    }
    case 'jobClass':
      return row.jobClass || '';
    case 'jobTitle':
      return row.jobTitle || row.role || '';
    case 'ranking':
      return row.ranking || '';
    case 'positionStatus':
      return row.positionStatus || row.status || '';
    default:
      if (typeof row[key] === 'undefined' || row[key] === null) {
        return '';
      }
      return String(row[key]);
  }
}

function orderRequirements(requirements, columnOrder) {
  const source = Array.isArray(requirements) ? requirements.filter(Boolean) : [];
  const order = Array.isArray(columnOrder?.requirements) ? columnOrder.requirements : [];
  if (!order.length) {
    return source;
  }
  const map = new Map();
  const result = [];
  const seen = new Set();
  for (const requirement of source) {
    const key = requirement?.id ?? requirement?.key ?? null;
    if (key === null) continue;
    map.set(key, requirement);
  }
  for (const id of order) {
    if (seen.has(id)) continue;
    if (!map.has(id)) continue;
    result.push(map.get(id));
    seen.add(id);
  }
  for (const requirement of source) {
    const key = requirement?.id ?? requirement?.key ?? null;
    if (key === null || seen.has(key)) {
      continue;
    }
    result.push(requirement);
    seen.add(key);
  }
  return result;
}

function triggerDownload(filename, data, mimeType) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    console.warn('File downloads are not supported in this environment.');
    return false;
  }
  try {
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return true;
  } catch (error) {
    console.error('Failed to download file', error);
    return false;
  }
}

export function exportFilteredCSV(employees, requirements, rows, columnOrder) {
  const exportRows = Array.isArray(rows) ? rows : [];
  if (!exportRows.length) {
    console.info('No rows available for CSV export.');
    return false;
  }
  const infoOrder = resolveInfoOrder(columnOrder);
  const requirementList = orderRequirements(requirements, columnOrder);

  const header = [
    ...CORE_EXPORT_FIELDS.map(field => field.label),
    ...infoOrder.map(key => getInfoLabel(key))
  ];
  for (const requirement of requirementList) {
    if (!requirement) continue;
    header.push(String(requirement.name || requirement.id || 'Requirement'));
  }

  const csvMatrix = [header.map(toCsvValue)];
  for (const row of exportRows) {
    if (!row) continue;
    const requirementMap = buildRequirementLookup(row);
    const baseCells = [
      ...CORE_EXPORT_FIELDS.map(field => toCsvValue(field.csvValue(row))),
      ...infoOrder.map(key => toCsvValue(formatInfoValue(row, key)))
    ];
    for (const requirement of requirementList) {
      if (!requirement) {
        baseCells.push('');
        continue;
      }
      const requirementId = requirement.id ?? requirement.key;
      const entry = typeof requirementId === 'undefined' ? null : requirementMap.get(requirementId);
      baseCells.push(toCsvValue(formatRequirementCell(entry)));
    }
    csvMatrix.push(baseCells);
  }

  const csvContent = csvMatrix.map(columns => columns.join(',')).join('\r\n');
  const filename = `compliance-export-${new Date().toISOString().slice(0, 10)}.csv`;
  return triggerDownload(filename, csvContent, 'text/csv;charset=utf-8;');
}

export function exportFilteredJSON(employees, requirements, rows, columnOrder) {
  const exportRows = Array.isArray(rows) ? rows : [];
  if (!exportRows.length) {
    console.info('No rows available for JSON export.');
    return false;
  }

  const rawEmployees = Array.isArray(employees)
    ? employees.map(employee => ({ ...(employee || {}) }))
    : [];
  const requirementList = orderRequirements(requirements, columnOrder).map(requirement => ({
    ...(requirement || {})
  }));
  const infoOrder = resolveInfoOrder(columnOrder);

  const payload = {
    generatedAt: new Date().toISOString(),
    employeeCount: exportRows.length,
    requirementCount: requirementList.length,
    employees: exportRows.map(row => {
      const info = {};
      for (const field of CORE_EXPORT_FIELDS) {
        info[field.key] = field.jsonValue(row);
      }
      info.name = formatInfoValue(row, 'name');
      for (const key of infoOrder) {
        info[getInfoLabel(key)] = formatInfoValue(row, key);
      }
      const requirementMap = buildRequirementLookup(row);
      info.requirements = requirementList.map(requirement => {
        const identifier = requirement?.id ?? requirement?.key;
        const entry = typeof identifier === 'undefined' ? null : requirementMap.get(identifier);
        return {
          id: identifier ?? null,
          name: requirement?.name ?? '',
          status: entry?.status ?? 'Pending',
          completedOn: entry?.completedOn ?? null,
          expiresOn: entry?.expiresOn ?? null,
          notes: entry?.notes ?? null
        };
      });
      return info;
    }),
    source: {
      employees: rawEmployees,
      requirements: requirementList
    }
  };

  const filename = `compliance-export-${new Date().toISOString().slice(0, 10)}.json`;
  const jsonContent = JSON.stringify(payload, null, 2);
  return triggerDownload(filename, jsonContent, 'application/json;charset=utf-8;');
}
