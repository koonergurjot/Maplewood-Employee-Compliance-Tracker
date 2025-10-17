import { createClient } from '@supabase/supabase-js';

let cachedClient = null;
let cachedConfig = null;

function readEnv(key) {
  if (!key) {
    return '';
  }
  const normalized = String(key).toUpperCase();
  if (typeof process !== 'undefined' && process?.env) {
    if (process.env[normalized]) {
      return process.env[normalized];
    }
    const viteKey = `VITE_${normalized}`;
    if (process.env[viteKey]) {
      return process.env[viteKey];
    }
  }
  if (typeof import.meta !== 'undefined' && import.meta?.env) {
    if (import.meta.env[normalized]) {
      return import.meta.env[normalized];
    }
    const viteKey = `VITE_${normalized}`;
    if (import.meta.env[viteKey]) {
      return import.meta.env[viteKey];
    }
  }
  if (typeof window !== 'undefined') {
    const flags = window.APP_FLAGS || {};
    if (typeof flags[normalized] === 'string') {
      return flags[normalized];
    }
    if (typeof flags[key] === 'string') {
      return flags[key];
    }
    if (window.__env && typeof window.__env === 'object') {
      if (typeof window.__env[normalized] === 'string') {
        return window.__env[normalized];
      }
      if (typeof window.__env[key] === 'string') {
        return window.__env[key];
      }
    }
  }
  return '';
}

function resolveConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }
  const url = String(readEnv('SUPABASE_URL') || '').trim();
  const anonKey = String(readEnv('SUPABASE_ANON_KEY') || '').trim();
  if (!url || !anonKey) {
    return { url: '', anonKey: '' };
  }
  cachedConfig = { url, anonKey };
  return cachedConfig;
}

export function hasSupabaseConfig() {
  const { url, anonKey } = resolveConfig();
  return Boolean(url && anonKey);
}

export function getClient() {
  if (cachedClient) {
    return cachedClient;
  }
  const { url, anonKey } = resolveConfig();
  if (!url || !anonKey) {
    return null;
  }
  cachedClient = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: {
      headers: {
        'x-client-info': 'maplewood-sync'
      }
    }
  });
  return cachedClient;
}

function ensureClient() {
  const client = getClient();
  if (!client) {
    throw new Error('Supabase client is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
  }
  return client;
}

function normalizeRowPayload(row, fallback = {}) {
  if (!row || typeof row !== 'object') {
    return { raw: null, mapped: { ...fallback } };
  }
  if ('raw' in row || 'mapped' in row) {
    const raw = row.raw && typeof row.raw === 'object' ? row.raw : null;
    const mapped = row.mapped && typeof row.mapped === 'object' ? row.mapped : { ...fallback };
    return { raw, mapped };
  }
  if ('employee' in row && typeof row.employee === 'object') {
    return { raw: row.raw || null, mapped: row.employee };
  }
  return { raw: row.raw && typeof row.raw === 'object' ? row.raw : null, mapped: row }; // best effort
}

function mapEmployee(record) {
  const payload = record?.payload && typeof record.payload === 'object' ? record.payload : {};
  const id = payload.id || record?.id || null;
  const createdAt = payload.createdAt || record?.created_at || null;
  const updatedAt = payload.updatedAt || record?.updated_at || null;
  const sanitized = { ...payload };
  if (id && !sanitized.id) {
    sanitized.id = id;
  }
  if (createdAt && !sanitized.createdAt) {
    sanitized.createdAt = createdAt;
  }
  if (updatedAt) {
    sanitized.updatedAt = updatedAt;
  }
  if (sanitized.employeeRequirements) {
    delete sanitized.employeeRequirements;
  }
  return sanitized;
}

function mapRequirement(record) {
  const payload = record?.payload && typeof record.payload === 'object' ? record.payload : {};
  const id = payload.id || record?.id || null;
  const createdAt = payload.createdAt || record?.created_at || null;
  const updatedAt = payload.updatedAt || record?.updated_at || null;
  const normalized = { ...payload };
  if (id && !normalized.id) {
    normalized.id = id;
  }
  if (record?.employee_id && !normalized.employeeId) {
    normalized.employeeId = record.employee_id;
  }
  if (createdAt && !normalized.createdAt) {
    normalized.createdAt = createdAt;
  }
  if (updatedAt) {
    normalized.updatedAt = updatedAt;
  }
  return normalized;
}

function extractCursor(data = []) {
  let latest = null;
  for (const entry of data) {
    const value = entry?.updated_at || entry?.payload?.updatedAt || entry?.payload?.updated_at;
    if (!value) continue;
    const ts = new Date(value).toISOString();
    if (!latest || ts > latest) {
      latest = ts;
    }
  }
  return latest;
}

export async function upsertPendingImport(rows = [], options = {}) {
  const client = ensureClient();
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const mappedRows = normalizedRows.map((row, index) => {
    const normalized = normalizeRowPayload(row);
    return {
      raw: normalized.raw,
      mapped: normalized.mapped,
      ordinal: index + 1
    };
  });

  const {
    summary = null,
    mapping = null,
    headerRow = null,
    mode = 'employees',
    fileName = '',
    requestedBy = ''
  } = typeof options === 'object' && options !== null ? options : {};

  const batchId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `imp_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

  const now = new Date().toISOString();

  const { error: insertError } = await client
    .from('imports')
    .insert({
      id: batchId,
      status: 'pending',
      mode,
      row_count: mappedRows.length,
      file_name: fileName || null,
      summary: summary || null,
      mapping: mapping || null,
      header_row: headerRow || null,
      requested_by: requestedBy || null,
      created_at: now,
      updated_at: now
    });

  if (insertError) {
    throw new Error(insertError.message || 'Failed to create import batch in Supabase.');
  }

  if (mappedRows.length) {
    const payload = mappedRows.map(entry => ({
      import_id: batchId,
      ordinal: entry.ordinal,
      raw: entry.raw,
      mapped: entry.mapped
    }));
    const { error: rowsError } = await client.from('import_rows').insert(payload);
    if (rowsError) {
      throw new Error(rowsError.message || 'Failed to upload import rows to Supabase.');
    }
  }

  return { batchId };
}

function normalizeApprovalPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { employees: [], employeeRequirements: [], cursor: null };
  }
  const employees = Array.isArray(payload.employees) ? payload.employees.map(mapEmployee) : [];
  const requirements = Array.isArray(payload.employeeRequirements)
    ? payload.employeeRequirements.map(mapRequirement)
    : [];
  const cursor = typeof payload.cursor === 'string' && payload.cursor ? payload.cursor : null;
  return { employees, employeeRequirements: requirements, cursor };
}

export async function approveImport(batchId, options = {}) {
  if (!batchId) {
    throw new Error('A batchId is required to approve an import.');
  }
  const client = ensureClient();
  const approvedBy = typeof options === 'object' && options !== null ? options.approvedBy || null : null;
  const body = { batch_id: batchId, approved_by: approvedBy };

  try {
    const { data, error } = await client.rpc('approve_import', body);
    if (error && error.code !== 'PGRST204' && error.code !== '404') {
      throw error;
    }
    if (data) {
      return normalizeApprovalPayload(data);
    }
  } catch (error) {
    if (error?.message) {
      console.warn('approve_import RPC failed', error);
    }
  }

  const approvedAt = new Date().toISOString();
  const { error: updateError } = await client
    .from('imports')
    .update({
      status: 'approved',
      approved_at: approvedAt,
      approved_by: approvedBy || null,
      updated_at: approvedAt
    })
    .eq('id', batchId);

  if (updateError) {
    throw new Error(updateError.message || 'Failed to mark import as approved.');
  }

  return { employees: [], employeeRequirements: [], cursor: approvedAt };
}

export async function pullEmployeesSince(timestamp) {
  const client = getClient();
  if (!client) {
    return { employees: [], employeeRequirements: [], cursor: null };
  }
  const since = timestamp ? new Date(timestamp).toISOString() : null;
  let employeesData = [];
  let requirementsData = [];

  const employeeQuery = client
    .from('employees')
    .select('id, payload, created_at, updated_at')
    .order('updated_at', { ascending: true });
  if (since) {
    employeeQuery.gte('updated_at', since);
  }
  const { data: employeesResult, error: employeesError } = await employeeQuery;
  if (employeesError) {
    throw new Error(employeesError.message || 'Failed to fetch employees from Supabase.');
  }
  if (Array.isArray(employeesResult)) {
    employeesData = employeesResult;
  }

  const requirementsQuery = client
    .from('employee_requirements')
    .select('id, employee_id, payload, created_at, updated_at')
    .order('updated_at', { ascending: true });
  if (since) {
    requirementsQuery.gte('updated_at', since);
  }
  const { data: requirementsResult, error: requirementsError } = await requirementsQuery;
  if (requirementsError) {
    throw new Error(requirementsError.message || 'Failed to fetch employee requirements from Supabase.');
  }
  if (Array.isArray(requirementsResult)) {
    requirementsData = requirementsResult;
  }

  const employees = employeesData.map(mapEmployee);
  const employeeRequirements = requirementsData.map(mapRequirement);

  const employeeCursor = extractCursor(employeesData);
  const requirementsCursor = extractCursor(requirementsData);
  const cursorCandidates = [employeeCursor, requirementsCursor].filter(Boolean);
  cursorCandidates.sort();
  const cursor = cursorCandidates.length ? cursorCandidates[cursorCandidates.length - 1] : null;

  return { employees, employeeRequirements, cursor };
}
