const DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

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

export function exportFilteredCSV(employees, requirements, rows) {
  const exportRows = Array.isArray(rows) ? rows : [];
  if (!exportRows.length) {
    console.info('No rows available for CSV export.');
    return false;
  }
  const requirementList = Array.isArray(requirements) ? requirements : [];

  const header = [
    'Employee ID',
    'First name',
    'Last name',
    'Employee',
    'Role',
    'Status',
    'Employment type',
    'Compliance %'
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
      toCsvValue(row.employeeId ?? ''),
      toCsvValue(row.firstName ?? ''),
      toCsvValue(row.lastName ?? ''),
      toCsvValue(row.fullName ?? ''),
      toCsvValue(row.role ?? ''),
      toCsvValue(row.status ?? ''),
      toCsvValue(row.employmentType ?? ''),
      toCsvValue(typeof row.compliancePercent === 'number' && Number.isFinite(row.compliancePercent)
        ? `${row.compliancePercent}%`
        : '')
    ];
    for (const requirement of requirementList) {
      const entry = requirement ? requirementMap.get(requirement.id) : null;
      baseCells.push(toCsvValue(formatRequirementCell(entry)));
    }
    csvMatrix.push(baseCells);
  }

  const csvContent = csvMatrix.map(columns => columns.join(',')).join('\r\n');
  const filename = `compliance-export-${new Date().toISOString().slice(0, 10)}.csv`;
  return triggerDownload(filename, csvContent, 'text/csv;charset=utf-8;');
}

export function exportFilteredJSON(employees, requirements, rows) {
  const exportRows = Array.isArray(rows) ? rows : [];
  if (!exportRows.length) {
    console.info('No rows available for JSON export.');
    return false;
  }

  const rawEmployees = Array.isArray(employees)
    ? employees.map(employee => ({ ...(employee || {}) }))
    : [];
  const requirementList = Array.isArray(requirements)
    ? requirements.map(requirement => ({ ...(requirement || {}) }))
    : [];

  const payload = {
    generatedAt: new Date().toISOString(),
    employeeCount: exportRows.length,
    requirementCount: requirementList.length,
    employees: exportRows.map(row => ({
      id: row.employeeId ?? null,
      firstName: row.firstName ?? '',
      lastName: row.lastName ?? '',
      fullName: row.fullName ?? '',
      role: row.role ?? '',
      status: row.status ?? '',
      employmentType: row.employmentType ?? '',
      compliancePercent: typeof row.compliancePercent === 'number' && Number.isFinite(row.compliancePercent)
        ? row.compliancePercent
        : null,
      requirements: (Array.isArray(row.requirements) ? row.requirements : []).map(entry => ({
        id: entry.requirementId ?? entry.id ?? null,
        name: entry.requirementName ?? entry.name ?? '',
        status: entry.status ?? 'Pending',
        completedOn: entry.completedOn ?? null,
        expiresOn: entry.expiresOn ?? null,
        notes: entry.notes ?? null
      }))
    })),
    source: {
      employees: rawEmployees,
      requirements: requirementList
    }
  };

  const filename = `compliance-export-${new Date().toISOString().slice(0, 10)}.json`;
  const jsonContent = JSON.stringify(payload, null, 2);
  return triggerDownload(filename, jsonContent, 'application/json;charset=utf-8;');
}
