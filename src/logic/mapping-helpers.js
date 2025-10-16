const normalizeHeaderValue = value => {
  if (value == null) {
    return '';
  }

  return String(value)
    .replace(/[\s\u00a0]+/g, ' ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
};

const normalizeCandidate = candidate => {
  if (Array.isArray(candidate)) {
    return candidate.map(normalizeCandidate).filter(Boolean);
  }

  return normalizeHeaderValue(candidate);
};

const cellMatchesCandidate = (cell, candidate) => {
  const normalizedCell = normalizeHeaderValue(cell);
  if (!normalizedCell) {
    return false;
  }

  const normalizedCandidate = normalizeCandidate(candidate);
  if (!normalizedCandidate) {
    return false;
  }

  if (Array.isArray(normalizedCandidate)) {
    return normalizedCandidate.some(option => cellMatchesCandidate(cell, option));
  }

  return normalizedCell.includes(normalizedCandidate);
};

const findColumnIndex = (row, candidates) => {
  if (!Array.isArray(row) || !row.length) {
    return -1;
  }

  const normalizedCandidates = Array.isArray(candidates) ? candidates : [candidates];

  for (const candidate of normalizedCandidates) {
    const normalizedCandidate = normalizeCandidate(candidate);
    if (!normalizedCandidate) {
      continue;
    }

    for (let index = 0; index < row.length; index += 1) {
      if (cellMatchesCandidate(row[index], normalizedCandidate)) {
        return index;
      }
    }
  }

  return -1;
};

const HEADER_TOKEN_GROUPS = [
  ['ranking'],
  ['total seniority hours'],
  ['job class code', 'job class'],
  ['job title', 'position description'],
  ['position status', 'status'],
  ['position id', 'employee id']
];

const rowMatchesTokenGroup = (row, group) => {
  if (!Array.isArray(row) || !row.length) {
    return false;
  }

  return group.some(token => row.some(cell => cellMatchesCandidate(cell, token)));
};

export function detectHeaderRow(rows, searchLimit = 10) {
  if (!Array.isArray(rows) || !rows.length) {
    return null;
  }

  const limit = Math.min(searchLimit, rows.length);

  for (let index = 0; index < limit; index += 1) {
    const row = rows[index];
    if (!Array.isArray(row) || row.every(cell => normalizeHeaderValue(cell) === '')) {
      continue;
    }

    let matches = 0;
    for (const group of HEADER_TOKEN_GROUPS) {
      if (rowMatchesTokenGroup(row, group)) {
        matches += 1;
      }
    }

    if (matches >= 3) {
      return { index, row };
    }
  }

  return null;
}

export function buildHeaderMap(row = []) {
  const columns = {};
  const labels = {};
  const meta = { firstName: -1, lastName: -1 };

  const assign = (key, candidates) => {
    const index = findColumnIndex(row, candidates);
    if (index >= 0) {
      columns[key] = index;
      labels[key] = row[index];
    }
    return index;
  };

  const nameIndex = assign('name', ['employee name', 'name']);
  if (nameIndex === -1) {
    const lastFirstIndex = findColumnIndex(row, ['last, first', 'last first', 'employee']);
    if (lastFirstIndex >= 0) {
      columns.name = lastFirstIndex;
      labels.name = row[lastFirstIndex];
      meta.nameFormat = 'lastFirst';
    }
  }

  meta.firstName = findColumnIndex(row, ['first name', 'first']);
  meta.lastName = findColumnIndex(row, ['last name', 'last']);

  assign('seniorityHours', ['total seniority hours', 'seniority hours', 'seniority hour']);
  assign('jobClass', ['job class code', 'job class']);
  assign('jobTitle', ['position description', 'job title']);
  assign('ranking', ['ranking', 'rank']);
  assign('positionStatus', ['position status', 'status']);
  assign('employeeId', ['position id', 'employee id', 'employee #', 'emp id']);

  return { columns, labels, meta };
}

export function normalizeHeaderLabel(value) {
  if (value == null) {
    return '';
  }

  return String(value).trim();
}

export function normalizeCellValue(value) {
  if (value == null) {
    return '';
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return String(value).trim();
}

export function isBlankRow(row = []) {
  if (!Array.isArray(row)) {
    return true;
  }

  return row.every(cell => {
    const normalized = normalizeCellValue(cell);
    if (typeof normalized === 'number') {
      return Number.isNaN(normalized);
    }
    return normalized === '';
  });
}

