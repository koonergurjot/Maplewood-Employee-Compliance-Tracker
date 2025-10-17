import './polyfills/async-function-call.js';
import './import/import-employees.js';
import Alpine from 'alpinejs';
import { qs } from './utils/dom.js';
import miniAnalyticsTemplate from './v2/mini-analytics.html?raw';
import requirementsGridTemplate from './v2/requirements-grid.html?raw';
import importDrawerTemplate from './v2/import-drawer.html?raw';
import addEmployeeModalTemplate from './v2/add-employee-modal.html?raw';
import addRequirementModalTemplate from './v2/add-requirement-modal.html?raw';
import bulkActionsTemplate from './v2/bulk-actions.html?raw';
import activityTimelineTemplate from './v2/activity-timeline.html?raw';
import employeeProfileTemplate from './v2/employee-profile.html?raw';
import {
  approveImport as approveSupabaseImport,
  getClient as getSupabaseClient,
  hasSupabaseConfig,
  pullEmployeesSince,
  upsertPendingImport as submitImportForApproval
} from './cloud/supabase.js';
const inlineEditTemplate = `
<template>
  <div class="inline-overlay" x-show="activeEditor.open" x-transition.opacity @click="closeEditor" aria-hidden="true"></div>
  <div
    id="inline-editor"
    class="inline-panel"
    x-show="activeEditor.open"
    x-transition
    :style="activeEditor.style"
    role="dialog"
    aria-modal="true"
    :aria-label="editorTitle()"
    @keydown.escape.stop="closeEditor()"
    @click.outside="closeEditor"
  >
    <form class="inline-form" @submit.prevent="saveActiveEditor">
      <header class="inline-header">
        <h2 class="inline-title" x-text="editorTitle()"></h2>
      </header>
      <div class="inline-body">
        <label class="inline-field" for="inline-editor-status">
          <span>Status</span>
          <select
            class="input"
            name="status"
            x-ref="editorStatus"
            x-model="editorForm.status"
            id="inline-editor-status"
            data-autofocus
          >
            <template x-for="status in editorStatusOptions" :key="status">
              <option :value="status" x-text="status"></option>
            </template>
          </select>
        </label>
        <label class="inline-field" for="inline-editor-completed-on">
          <span>Completed on</span>
          <input
            type="date"
            class="input"
            name="completedOn"
            id="inline-editor-completed-on"
            x-model="editorForm.completedOn"
          />
        </label>
        <label class="inline-field" for="inline-editor-expires-on">
          <span>Expires on</span>
          <input
            type="date"
            class="input"
            name="expiresOn"
            id="inline-editor-expires-on"
            x-model="editorForm.expiresOn"
          />
        </label>
      </div>
      <footer class="inline-footer">
        <button type="button" class="btn ghost" @click="closeEditor">Cancel</button>
        <button type="submit" class="btn primary">Save changes</button>
      </footer>
    </form>
  </div>
</template>
`;
import './styles/tailwind.css';
import { openDatabase, generateId, mapPositionStatus } from '../db.js';
import { AddRequirement, deleteEmployee as deleteEmployeeHelper } from '../commands.js';
import { addEmployee as addEmployeeApi } from './v2/api.js';
import { exportFilteredCSV, exportFilteredJSON } from './v2/exporter.js';
import {
  ANALYTICS_AT_RISK_WINDOW_DAYS,
  ANALYTICS_EXPIRING_WINDOW_DAYS,
  computeAnalyticsSummary,
  evaluateRequirementState,
  normalizeStatus
} from './logic/analytics.js';

const DEFAULT_ROLE_LOOKUPS = ['LPN', 'RCA', 'Rec', 'Receptionist', 'ADP Rec', 'ADP LPN', 'Other'];
const DEFAULT_STATUS_LOOKUPS = ['Active', 'Inactive'];
const DEFAULT_EMPLOYMENT_TYPE_LOOKUPS = ['FT', 'PT', 'Casual'];
const CLOUD_LAST_SYNC_STORAGE_KEY = 'maplewood:cloud:lastSync';

const DEFAULT_APP_FLAGS = { USE_V2_MAIN: true };
const V2_COMPONENT_REGISTRY_KEY = '__V2_ALPINE_COMPONENTS__';
const ACTIVITY_TIMELINE_LIMIT = 100;
const FILTERS_STORAGE_KEY = 'filters';
const DEFAULT_FILTER_STATE = {
  roles: [],
  status: 'all',
  compliance: 'all',
  expiringSoon: false,
  search: '',
  analytics: null
};

function getV2ComponentRegistry() {
  if (typeof window === 'undefined') {
    return new Set();
  }

  if (!window[V2_COMPONENT_REGISTRY_KEY]) {
    window[V2_COMPONENT_REGISTRY_KEY] = new Set();
  }

  return window[V2_COMPONENT_REGISTRY_KEY];
}

function registerV2Component(name, definition) {
  const registry = getV2ComponentRegistry();
  if (typeof name === 'string' && name) {
    registry.add(name);
  }
  return Alpine.data(name, definition);
}

async function ensureSeedRequirements(db) {
  const count = (await db.requirements.count?.()) ?? 0;
  if (count) {
    return;
  }
  const now = new Date().toISOString();
  const seed = [
    { key: 'CRC', name: 'Criminal Record Check (CRC)', color: '#fee2e2', defaultExpiryDays: 730 },
    { key: 'FA', name: 'First Aid / CPR', color: '#e0e7ff', defaultExpiryDays: 1095 },
    { key: 'FS', name: 'FoodSafe', color: '#dcfce7', defaultExpiryDays: 1825 },
    { key: 'N95', name: 'N95 Fit Test', color: '#fef9c3', defaultExpiryDays: 365 },
    { key: 'TB', name: 'TB Test', color: '#dbeafe', defaultExpiryDays: 1825 },
    { key: 'IMM', name: 'Immunizations', color: '#fae8ff', defaultExpiryDays: null },
    { key: 'PRV', name: 'Privacy & Confidentiality', color: '#fde68a', defaultExpiryDays: 365 }
  ].map(requirement => ({
    id: crypto.randomUUID?.() || Math.random().toString(36).slice(2),
    createdAt: now,
    updatedAt: now,
    ...requirement
  }));

  await db.transaction('rw', db.requirements, async () => {
    await db.requirements.bulkAdd(seed);
  });
}

function cloneActivityDetail(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(item => cloneActivityDetail(item));
  }
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, entryValue] of Object.entries(value)) {
      if (typeof entryValue === 'function') {
        continue;
      }
      output[key] = cloneActivityDetail(entryValue);
    }
    return output;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function ensureSentencePeriod(text) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) {
    return '';
  }
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function buildActivitySummary(summary, details, timestampIso) {
  const base = ensureSentencePeriod(summary);
  if (!details || typeof details !== 'object') {
    return base;
  }
  const approvalDetails = details.approval && typeof details.approval === 'object' ? details.approval : details;
  const approvedBy = approvalDetails?.approvedBy || approvalDetails?.by;
  if (!approvedBy) {
    return base;
  }
  const approvedAtSource = approvalDetails?.approvedAt || approvalDetails?.at || timestampIso;
  let approvedDate = new Date(approvedAtSource);
  if (Number.isNaN(approvedDate.getTime())) {
    approvedDate = new Date(timestampIso);
  }
  const approvedTime = approvedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${base} Approved by ${approvedBy} at ${approvedTime}.`;
}
const existingFlags =
  typeof window !== 'undefined' && typeof window.APP_FLAGS === 'object' && window.APP_FLAGS !== null
    ? window.APP_FLAGS
    : {};
const appFlagsTarget = { ...DEFAULT_APP_FLAGS, ...existingFlags };

if (typeof window !== 'undefined') {
  window.APP_FLAGS = new Proxy(appFlagsTarget, {
    set(target, property, value) {
      target[property] = value;
      document.dispatchEvent(
        new CustomEvent('app-flags:changed', {
          detail: { property, value }
        })
      );
      return true;
    }
  });
}

function normalizeDateInputValue(value) {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }

    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      return trimmed.slice(0, 10);
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }

    return '';
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toISOString().slice(0, 10);
}

function isTextInput(element) {
  if (!element || element.nodeType !== 1) {
    return false;
  }
  const tag = element.tagName?.toLowerCase();
  if (!tag) {
    return false;
  }
  if (tag === 'input') {
    const type = element.getAttribute('type')?.toLowerCase();
    return type !== 'checkbox' && type !== 'radio' && type !== 'button' && type !== 'submit';
  }
  return tag === 'textarea' || element.isContentEditable;
}

function createAppStore() {
  const store = {
    APP_FLAGS: { ...window.APP_FLAGS },
    overlay: {
      current: null,
      _lastInvoker: null,
      open(name, options = {}) {
        if (!name) {
          return;
        }

        const invoker = options?.invoker;
        const isFocusableInvoker = invoker && typeof invoker.focus === 'function' ? invoker : null;
        const activeElement = (() => {
          if (typeof document === 'undefined') {
            return null;
          }
          const active = document.activeElement;
          if (!active || typeof active.focus !== 'function') {
            return null;
          }
          return active;
        })();

        if (this.current !== name) {
          this._lastInvoker = isFocusableInvoker || activeElement || null;
          this.current = name;
          return;
        }

        if (isFocusableInvoker) {
          this._lastInvoker = isFocusableInvoker;
        }
      },
      close(name) {
        if (name && this.current && name !== this.current) {
          return;
        }

        this.current = null;

        const target = this._lastInvoker;
        this._lastInvoker = null;

        if (!target || typeof target.focus !== 'function') {
          return;
        }

        const focusTarget = () => {
          try {
            target.focus({ preventScroll: false });
          } catch (error) {
            try {
              target.focus();
            } catch (nestedError) {
              void nestedError;
            }
          }
        };

        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(() => focusTarget());
        } else {
          setTimeout(() => focusTarget(), 0);
        }
      }
    },
    showAddRequirementModal: false,
    employees: [],
    filteredEmployees: [],
    showLookupModal: null,
    toast: null,
    _toastTimer: null,
    showToast(message, type = 'info', options = {}) {
      if (this._toastTimer) {
        clearTimeout(this._toastTimer);
        this._toastTimer = null;
      }

      const payload = typeof message === 'object' && message !== null ? { ...message } : { message };
      payload.type = typeof payload.type === 'string' && payload.type ? payload.type : type;

      if (typeof payload.message !== 'string') {
        payload.message = String(payload.message ?? '');
      }

      if (typeof options === 'object' && options !== null) {
        Object.assign(payload, options);
      }

      this.toast = payload;

      if (payload.type === 'progress') {
        return;
      }

      const duration = typeof payload.duration === 'number' && Number.isFinite(payload.duration)
        ? Math.max(0, payload.duration)
        : 3500;

      if (duration > 0) {
        this._toastTimer = setTimeout(() => {
          if (!this.toast || this.toast.type !== 'progress') {
            this.toast = null;
          }
          this._toastTimer = null;
        }, duration);
      }
    },
    hideToast() {
      if (this._toastTimer) {
        clearTimeout(this._toastTimer);
        this._toastTimer = null;
      }
      this.toast = null;
    },
    hasToastAction() {
      const toast = this.toast;
      return Boolean(toast && toast.action && typeof toast.action.handler === 'function');
    },
    toastActionLabel() {
      const toast = this.toast;
      if (!toast || !toast.action) {
        return 'Undo';
      }
      const label = toast.action.label;
      return typeof label === 'string' && label.trim() ? label.trim() : 'Undo';
    },
    isProgressToast() {
      return this.toast?.type === 'progress';
    },
    toastProgressPercent() {
      if (!this.toast || typeof this.toast.percent !== 'number') {
        return 0;
      }
      const percent = Math.round(this.toast.percent);
      return Math.max(0, Math.min(100, percent));
    },
    async runToastAction() {
      if (!this.hasToastAction()) {
        return;
      }

      const action = this.toast.action;
      try {
        await action.handler();
      } catch (error) {
        console.error('Toast action failed', error);
      } finally {
        if (action.dismiss !== false) {
          this.hideToast();
        }
      }
    },
    setProgress(percent) {
      if (this._toastTimer) {
        clearTimeout(this._toastTimer);
        this._toastTimer = null;
      }

      const normalized = typeof percent === 'number' && Number.isFinite(percent) ? percent : 0;
      const clamped = Math.max(0, Math.min(100, Math.round(normalized)));

      this.toast = {
        type: 'progress',
        message: 'Importing…',
        percent: clamped
      };
    },
    setToast(toast) {
      this.toast = toast ?? null;
    },
    setEmployees(employees) {
      this.employees = Array.isArray(employees) ? employees : [];
    },
    setFilteredEmployees(employees) {
      this.filteredEmployees = Array.isArray(employees) ? employees : [];
    },
    totalEmployees() {
      return this.employees.length;
    },
    filteredCount() {
      return this.filteredEmployees.length;
    }
  };

  const handleFlagChange = () => {
    store.APP_FLAGS = { ...window.APP_FLAGS };
  };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('app-flags:changed', handleFlagChange);
  }

  return store;
}

let appStore = null;

const DARK_MODE_KEY = 'maplewood:dashboard:dark-mode';
const RING_RADIUS = 16;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function replaceTemplate(targetId, html) {
  const placeholder = document.getElementById(targetId);
  if (!placeholder) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html.trim();
  const templateEl = qs(wrapper, 'template');
  if (templateEl) {
    templateEl.id = targetId;
    placeholder.replaceWith(templateEl);
  } else {
    placeholder.outerHTML = html;
  }
}

function normalizeString(value) {
  return (value ?? '').toString().trim();
}

function normalizeLower(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeNonNegativeNumber(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizeWindowDays(value, fallback = ANALYTICS_EXPIRING_WINDOW_DAYS) {
  return normalizeNonNegativeNumber(value, fallback);
}

function splitFullName(fullName, defaults = {}) {
  const baseline = typeof defaults === 'object' && defaults !== null ? defaults : {};
  const value = normalizeString(fullName);
  if (!value) {
    return {
      firstName: normalizeString(baseline.firstName),
      lastName: normalizeString(baseline.lastName)
    };
  }
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return {
      firstName: '',
      lastName: ''
    };
  }
  if (parts.length === 1) {
    return {
      firstName: parts[0],
      lastName: ''
    };
  }
  const lastName = parts.pop();
  return {
    firstName: parts.join(' '),
    lastName: lastName || ''
  };
}

const v2DashboardAppDefinition = () => ({
  db: null,
  activityLog: [],
  activityLogLoaded: false,
  _activityLogLoading: null,
  partials: {
    miniAnalytics: '',
    requirementsGrid: '',
    importDrawer: '',
    addRequirementModal: '',
    addEmployeeModal: '',
    bulkActions: '',
    activityTimeline: '',
    employeeProfile: ''
  },
  inlineTemplateMounted: false,
  loading: true,
  loadError: null,
  darkMode: false,
  showAddRequirementModal: false,
  showAddEmployeeModal: false,
  exporter: null,
  _exportRowsCache: null,
  employees: [],
  requirements: [],
  employeeRequirements: [],
  employeeRequirementMap: new Map(),
  analytics: {
    generatedAt: null,
    atRisk: [],
    complianceByRole: [],
    expiringThisWeek: [],
    totals: {
      atRiskAssignments: 0,
      overdueAssignments: 0,
      expiringThisWeek: 0
    }
  },
  analyticsConfig: {
    atRiskWindowDays: ANALYTICS_AT_RISK_WINDOW_DAYS,
    expiringSoonDays: ANALYTICS_EXPIRING_WINDOW_DAYS,
    expiringThisWeekDays: ANALYTICS_EXPIRING_WINDOW_DAYS
  },
  filteredEmployees: [],
  selectedEmployees: [],
  bulk: {
    requirementId: '',
    action: '',
    date: '',
    reason: ''
  },
  bulkProcessing: false,
  roleOptions: [],
  filters: { ...DEFAULT_FILTER_STATE },
  _lastSerializedFilters: '',
  complianceOptions: [
    { value: 'all', label: 'All compliance' },
    { value: 'high', label: '≥ 90%' },
    { value: 'mid', label: '70–89%' },
    { value: 'low', label: '< 70%' }
  ],
  statusOptions: [
    { value: 'all', label: 'All statuses' },
    { value: 'Active', label: 'Active' },
    { value: 'Inactive', label: 'Inactive' }
  ],
  editorStatusOptions: ['Completed', 'Pending', 'Exempt'],
  employeeLookups: {
    roles: [...DEFAULT_ROLE_LOOKUPS],
    statuses: [...DEFAULT_STATUS_LOOKUPS],
    employmentTypes: [...DEFAULT_EMPLOYMENT_TYPE_LOOKUPS]
  },
  form: {
    firstName: '',
    lastName: '',
    role: '',
    status: '',
    employmentType: '',
    seniorityHours: '',
    jobClass: '',
    jobTitle: '',
    ranking: '',
    positionStatus: ''
  },
  formErrors: {},
  formSaving: false,
  api: {
    addEmployee: addEmployeeApi,
    deleteEmployee: deleteEmployeeHelper
  },
  addRequirementModal: {
    open: false,
    saving: false,
    form: {
      name: '',
      color: '#e2e8f0',
      defaultExpiryDays: ''
    },
    errors: {}
  },
  addEmployeeModal: {
    open: false,
    saving: false,
    form: {
      firstName: '',
      lastName: '',
      role: '',
      status: '',
      employmentType: '',
      seniorityHours: ''
    },
    errors: {}
  },
  profilePanel: {
    open: false,
    employeeId: null,
    editing: false,
    saving: false,
    error: '',
    form: {
      name: '',
      seniorityHours: '',
      jobClass: '',
      jobTitle: '',
      ranking: '',
      positionStatus: ''
    }
  },
  activeEditor: {
    open: false,
    employeeId: null,
    requirementId: null,
    style: ''
  },
  gridColumnOrder() {
    const requirementIds = Array.isArray(this.requirements)
      ? this.requirements
          .filter(requirement => typeof requirement?.id !== 'undefined' && requirement.id !== null)
          .map(requirement => requirement.id)
      : [];
    return {
      info: ['name'],
      requirements: requirementIds
    };
  },
  gridInfoColumnLabel(key) {
    const labels = {
      name: 'Employee',
      seniorityHours: 'Seniority Hours',
      jobClass: 'Job Class',
      jobTitle: 'Job Title',
      ranking: 'Ranking',
      positionStatus: 'Position Status'
    };
    return labels[key] || key;
  },
  gridInfoColumns() {
    const orderDefinition = this.gridColumnOrder();
    const infoOrder = Array.isArray(orderDefinition?.info) ? orderDefinition.info : [];
    const columns = [];
    let infoIndex = 1;
    for (const key of infoOrder) {
      if (key === 'name') {
        columns.push({
          key,
          label: this.gridInfoColumnLabel(key),
          headerClass: 'sticky-col sticky-header sticky-col-name employee-header',
          cellClass: 'sticky-col sticky-col-name employee-info-cell',
          cellType: 'th'
        });
        continue;
      }
      const headerClass = `sticky-col sticky-header sticky-info-col sticky-col-info-${infoIndex} employee-header`;
      const baseCellClass = `sticky-col sticky-info-col sticky-col-info-${infoIndex} employee-info-cell`;
      const cellClass = key === 'seniorityHours'
        ? `${baseCellClass} employee-info-cell-number`
        : baseCellClass;
      columns.push({
        key,
        label: this.gridInfoColumnLabel(key),
        headerClass,
        cellClass,
        cellType: 'td'
      });
      infoIndex += 1;
    }
    return columns;
  },
  gridInfoCellText(employee, key) {
    if (!employee) {
      return '—';
    }
    switch (key) {
      case 'seniorityHours': {
        const { seniorityHours } = employee;
        if (seniorityHours !== null && seniorityHours !== '') {
          const numeric = Number(seniorityHours);
          if (Number.isFinite(numeric)) {
            return numeric.toLocaleString();
          }
          if (typeof seniorityHours === 'string') {
            const trimmed = seniorityHours.trim();
            return trimmed || '—';
          }
          return `${seniorityHours}`;
        }
        return '—';
      }
      case 'jobClass':
        return employee.jobClass || '—';
      case 'jobTitle':
        return employee.jobTitle || employee.role || '—';
      case 'ranking':
        return employee.ranking || '—';
      case 'positionStatus':
        return employee.positionStatus || employee.status || '—';
      default:
        return '—';
    }
  },
  gridOrderedRequirements(requirements = this.requirements) {
    const source = Array.isArray(requirements) ? requirements.filter(Boolean) : [];
    const orderDefinition = this.gridColumnOrder();
    const order = Array.isArray(orderDefinition?.requirements) ? orderDefinition.requirements : [];
    if (!order.length) {
      return source;
    }
    const requirementMap = new Map();
    const visited = new Set();
    for (const requirement of source) {
      if (!requirement) continue;
      const key = requirement.id ?? requirement.key;
      requirementMap.set(key, requirement);
    }
    const ordered = [];
    for (const id of order) {
      if (visited.has(id)) continue;
      const match = requirementMap.get(id);
      if (match) {
        ordered.push(match);
        visited.add(id);
      }
    }
    for (const requirement of source) {
      const key = requirement.id ?? requirement.key;
      if (visited.has(key)) continue;
      ordered.push(requirement);
      visited.add(key);
    }
    return ordered;
  },
  editorForm: {
    status: 'Pending',
    completedOn: '',
    expiresOn: ''
  },
  cloudAvailable: hasSupabaseConfig(),
  lastCloudSync: '',
  importDrawer: {
    open: false,
    mode: 'employees',
    file: null,
    fileName: '',
    dryRunLoading: false,
    commitLoading: false,
    commitLocalLoading: false,
    submitLoading: false,
    summary: null,
    mapping: null,
    mappingRows: [],
    previewRows: [],
    previewColumns: [],
    previewTotal: 0,
    error: '',
    commitDisabled: true,
    headerRowNumber: null,
    submitDisabled: true,
    submitLoading: false,
    awaitingApproval: false,
    pendingBatchId: '',
    approvalMessage: '',
    pendingRows: [],
    pendingRawRows: [],
    pendingSummary: null,
    pendingHeader: null,
    adminMode: false,
    pendingImports: [],
    pendingImportsLoading: false,
    pendingImportsError: '',
    approvingBatchId: '',
    commitLocalDisabled: true,
    submitDisabled: true,
    headerRowNumber: null
  },
  init() {
    const savedFilters = this.readSavedFilters();
    const urlFilters = this.readFiltersFromUrl();
    const normalizedFilters = this.normalizeFilters({
      ...savedFilters,
      ...urlFilters
    });
    this.filters = normalizedFilters;
    this.persistFilters(this.filters);
    this.updateUrlFilters(this.filters);
    this.$watch(
      'filters',
      value => {
        this.persistFilters(value);
        this.updateUrlFilters(value);
      },
      { deep: true }
    );
    this.mountInlineTemplate();
    this.initializeDarkMode();
    this.exporter = {
      exportFilteredCSV: (employees, requirements, employeeRequirements) => {
        const rows = Array.isArray(employeeRequirements) && employeeRequirements.every(entry => Array.isArray(entry?.requirements))
          ? employeeRequirements
          : this._exportRowsCache || this.buildExportRows(employees, requirements, employeeRequirements);
        this._exportRowsCache = null;
        return exportFilteredCSV(employees, requirements, rows, this.gridColumnOrder());
      },
      exportFilteredJSON: (employees, requirements, employeeRequirements) => {
        const rows = Array.isArray(employeeRequirements) && employeeRequirements.every(entry => Array.isArray(entry?.requirements))
          ? employeeRequirements
          : this._exportRowsCache || this.buildExportRows(employees, requirements, employeeRequirements);
        this._exportRowsCache = null;
        return exportFilteredJSON(employees, requirements, rows, this.gridColumnOrder());
      }
    };
    this.$watch(
      () => this.$store?.app?.overlay?.current,
      value => {
        if (value === 'import') {
          this.openImportDrawer();
        } else if (this.importDrawer.open && value !== 'import') {
          this.closeImportDrawer({ silent: true });
        }

        if (value === 'add') {
          this.openAddEmployeeModal();
        } else if (this.showAddEmployeeModal && value !== 'add') {
          this.closeAddEmployeeModal({ silent: true });
        }

        if (value === 'profile') {
          if (!this.profilePanel.open && this.profilePanel.employeeId) {
            this.openProfile(this.profilePanel.employeeId);
          }
        } else if (this.profilePanel.open) {
          this.closeProfile({ silent: true });
        }
      }
    );
    this.$watch(
      () => this.$store?.app?.showAddRequirementModal,
      value => {
        if (value) {
          this.openAddRequirementModal();
        } else if (value === false && this.addRequirementModal.open) {
          this.closeAddRequirementModal({ silent: true });
        }
      }
    );
    this.resetAddRequirementForm();
    this.resetAddEmployeeForm();
    this.bootstrap();
  },
  async bootstrap() {
    try {
      this.loading = true;
      await this.loadPartials();
      this.cloudAvailable = hasSupabaseConfig();
      this.lastCloudSync = this.readLastCloudSync();
      this.db = await openDatabase();
      await ensureSeedRequirements(this.db);
      if (this.cloudAvailable) {
        try {
          await this.syncFromCloud();
        } catch (syncError) {
          console.warn('Cloud sync failed during bootstrap', syncError);
        }
      }
      await this.initActivityLog();
      await this.loadData();
      this.applyFilters();
    } catch (error) {
      console.error(error);
      this.loadError = 'Unable to load compliance data.';
    } finally {
      this.loading = false;
    }
  },
  async loadPartials() {
    try {
      this.partials.miniAnalytics = miniAnalyticsTemplate;
      this.hydrateMiniAnalytics();
    } catch (error) {
      console.error(error);
      this.partials.miniAnalytics = '';
    }

    try {
      this.partials.requirementsGrid = requirementsGridTemplate;
      this.hydrateRequirementsGrid();
    } catch (error) {
      console.error(error);
      this.partials.requirementsGrid = '';
    }

    try {
      this.partials.importDrawer = importDrawerTemplate;
      this.hydrateImportDrawer();
    } catch (error) {
      console.error(error);
      this.partials.importDrawer = '';
    }

    try {
      this.partials.addRequirementModal = addRequirementModalTemplate;
      this.hydrateAddRequirementModal();
    } catch (error) {
      console.error(error);
      this.partials.addRequirementModal = '';
    }

    try {
      this.partials.addEmployeeModal = addEmployeeModalTemplate;
      this.hydrateAddEmployeeModal();
    } catch (error) {
      console.error(error);
      this.partials.addEmployeeModal = '';
    }

    try {
      this.partials.bulkActions = bulkActionsTemplate;
      this.hydrateBulkActions();
    } catch (error) {
      console.error(error);
      this.partials.bulkActions = '';
    }

    try {
      this.partials.activityTimeline = activityTimelineTemplate;
      this.hydrateActivityTimeline();
    } catch (error) {
      console.error(error);
      this.partials.activityTimeline = '';
    }

    try {
      this.partials.employeeProfile = profileDrawerTemplate;
      this.hydrateEmployeeProfile();
    } catch (error) {
      console.error(error);
      this.partials.employeeProfile = '';
    }
  },
  hydrateMiniAnalytics() {
    this.$nextTick(() => {
      const container = document.getElementById('mini-analytics');
      if (container && container.dataset.alpineInitialized !== 'true') {
        Alpine.initTree(container);
        container.dataset.alpineInitialized = 'true';
      }
    });
  },
  hydrateRequirementsGrid() {
    this.$nextTick(() => {
      const container = document.getElementById('requirements-grid');
      if (container && container.dataset.alpineInitialized !== 'true') {
        Alpine.initTree(container);
        container.dataset.alpineInitialized = 'true';
      }
      this.hydrateBulkActions();
    });
  },
  hydrateImportDrawer() {
    this.$nextTick(() => {
      const container = document.getElementById('import-drawer');
      if (container && container.dataset.alpineInitialized !== 'true') {
        Alpine.initTree(container);
        container.dataset.alpineInitialized = 'true';
      }
    });
  },
  hydrateBulkActions() {
    this.$nextTick(() => {
      const container = document.getElementById('bulk-actions');
      if (container && container.dataset.alpineInitialized !== 'true') {
        Alpine.initTree(container);
        container.dataset.alpineInitialized = 'true';
      }
    });
  },
  hydrateActivityTimeline() {
    this.$nextTick(() => {
      const container = document.getElementById('activity-timeline');
      if (container && container.dataset.alpineInitialized !== 'true') {
        Alpine.initTree(container);
        container.dataset.alpineInitialized = 'true';
      }
    });
  },
  hydrateAddRequirementModal() {
    this.$nextTick(() => {
      const container = document.getElementById('add-requirement-modal');
      if (container && container.dataset.alpineInitialized !== 'true') {
        Alpine.initTree(container);
        container.dataset.alpineInitialized = 'true';
      }
    });
  },
  hydrateAddEmployeeModal() {
    this.$nextTick(() => {
      const container = document.getElementById('add-employee-modal');
      if (container && container.dataset.alpineInitialized !== 'true') {
        Alpine.initTree(container);
        container.dataset.alpineInitialized = 'true';
      }
    });
  },
  hydrateEmployeeProfile() {
    this.$nextTick(() => {
      const container = document.getElementById('employee-profile');
      if (container && container.dataset.alpineInitialized !== 'true') {
        Alpine.initTree(container);
        container.dataset.alpineInitialized = 'true';
      }
    });
  },
  openImportDrawer() {
    const store = this.$store?.app;
    if (store?.overlay && typeof store.overlay.open === 'function') {
      store.overlay.open('import');
    }
    const wasOpen = !!this.importDrawer.open;
    this.importDrawer.open = true;
    this.hydrateImportDrawer();
    if (!wasOpen) {
      this.$nextTick(() => {
        const node = document.querySelector('#import-drawer-root [data-autofocus]');
        if (node && typeof node.focus === 'function') {
          node.focus();
        }
      });
    }
  },
  setImportDrawerMode(mode) {
    const normalized = mode === 'seniority' ? 'seniority' : 'employees';
    if (this.importDrawer.mode === normalized) {
      return;
    }

    if (
      this.importDrawer.dryRunLoading
      || this.importDrawer.commitLoading
      || this.importDrawer.commitLocalLoading
      || this.importDrawer.submitLoading
    ) {
      return;
    }

    this.importDrawer.mode = normalized;
    this.importDrawer.file = null;
    this.importDrawer.fileName = '';
    this.importDrawer.summary = null;
    this.importDrawer.mapping = null;
    this.importDrawer.mappingRows = [];
    this.importDrawer.previewRows = [];
    this.importDrawer.previewColumns = [];
    this.importDrawer.previewTotal = 0;
    this.importDrawer.error = '';
    this.importDrawer.dryRunLoading = false;
    this.importDrawer.commitLoading = false;
    this.importDrawer.commitDisabled = true;
    this.importDrawer.commitLocalLoading = false;
    this.importDrawer.submitLoading = false;
    this.importDrawer.commitLocalDisabled = true;
    this.importDrawer.submitDisabled = true;
    this.importDrawer.headerRowNumber = null;

    this.updateImportDrawerCommitState();

    if (this.$refs.importFileInput) {
      this.$refs.importFileInput.value = '';
      this.$nextTick(() => {
        const node = document.querySelector('#import-drawer-root [data-autofocus]');
        if (node && typeof node.focus === 'function') {
          node.focus();
        }
      });
    }
  },
  closeImportDrawer(options = {}) {
    const { silent = false, preserveState = false, force = false } = options;
    const wasOpen = !!this.importDrawer.open;
    this.importDrawer.open = false;
    if (!wasOpen && !force) {
      return;
    }
    if (!preserveState) {
      this.resetImportDrawerState();
    }
    if (!silent) {
      const overlay = this.$store?.app?.overlay;
      if (overlay && typeof overlay.close === 'function') {
        overlay.close('import');
      }
    }
  },
  resetImportDrawerState() {
    this.importDrawer.mode = 'employees';
    this.importDrawer.file = null;
    this.importDrawer.fileName = '';
    this.importDrawer.dryRunLoading = false;
    this.importDrawer.commitLoading = false;
    this.importDrawer.commitLocalLoading = false;
    this.importDrawer.submitLoading = false;
    this.importDrawer.summary = null;
    this.importDrawer.mapping = null;
    this.importDrawer.mappingRows = [];
    this.importDrawer.previewRows = [];
    this.importDrawer.previewColumns = [];
    this.importDrawer.previewTotal = 0;
    this.importDrawer.error = '';
    this.importDrawer.headerRowNumber = null;
    this.importDrawer.submitDisabled = true;
    this.importDrawer.submitLoading = false;
    this.importDrawer.awaitingApproval = false;
    this.importDrawer.pendingBatchId = '';
    this.importDrawer.approvalMessage = '';
    this.importDrawer.pendingRows = [];
    this.importDrawer.pendingRawRows = [];
    this.importDrawer.pendingSummary = null;
    this.importDrawer.pendingHeader = null;
    this.importDrawer.pendingImportsError = '';
    this.importDrawer.approvingBatchId = '';
    this.importDrawer.adminMode = false;
    this.importDrawer.pendingImports = [];
    this.importDrawer.pendingImportsLoading = false;
    this.importDrawer.commitDisabled = true;
    this.importDrawer.commitLocalDisabled = true;
    this.importDrawer.submitDisabled = true;
    this.updateImportDrawerCommitState();
    if (this.$refs.importFileInput) {
      this.$refs.importFileInput.value = '';
    }
  },
  updateImportDrawerCommitState() {
    const state = this.importDrawer;
    const hasSummary = Boolean(state.summary);
    const submitDisabled = !hasSummary || state.dryRunLoading || state.submitLoading || !this.cloudAvailable;
    state.submitDisabled = submitDisabled || state.awaitingApproval;
    const disabled = !state.file || !hasSummary || state.dryRunLoading || state.commitLoading || state.submitLoading;
    state.commitDisabled = disabled || state.awaitingApproval;
  },
  readLastCloudSync() {
    if (typeof window === 'undefined' || !window.localStorage) {
      return '';
    }
    try {
      return window.localStorage.getItem(CLOUD_LAST_SYNC_STORAGE_KEY) || '';
    } catch (error) {
      console.warn('Unable to read cloud sync timestamp', error);
      return '';
    }
  },
  writeLastCloudSync(value) {
    if (typeof window === 'undefined' || !window.localStorage) {
      this.lastCloudSync = value || '';
      return;
    }
    try {
      if (value) {
        window.localStorage.setItem(CLOUD_LAST_SYNC_STORAGE_KEY, value);
      } else {
        window.localStorage.removeItem(CLOUD_LAST_SYNC_STORAGE_KEY);
      }
      this.lastCloudSync = value || '';
    } catch (error) {
      console.warn('Unable to persist cloud sync timestamp', error);
      this.lastCloudSync = value || '';
    }
  },
  currentUserName() {
    const flags = typeof window !== 'undefined' ? window.APP_FLAGS || {} : {};
    const fromFlags = typeof flags.currentUserName === 'string' && flags.currentUserName.trim()
      ? flags.currentUserName.trim()
      : '';
    if (fromFlags) {
      return fromFlags;
    }
    if (typeof flags.currentUserEmail === 'string' && flags.currentUserEmail.trim()) {
      return flags.currentUserEmail.trim();
    }
    return '';
  },
  computeLatestSyncTimestamp(employees = [], requirements = []) {
    const timestamps = [];
    const collect = value => {
      if (!value) {
        return;
      }
      try {
        const iso = new Date(value).toISOString();
        timestamps.push(iso);
      } catch (_) {
        // ignore parse errors
      }
    };
    employees.forEach(entry => collect(entry?.updatedAt));
    requirements.forEach(entry => collect(entry?.updatedAt));
    timestamps.sort();
    return timestamps.length ? timestamps[timestamps.length - 1] : '';
  },
  async syncFromCloud(force = false) {
    if (!this.db || !this.cloudAvailable) {
      return;
    }
    const since = force ? '' : this.readLastCloudSync();
    const safeSince = typeof since === 'string' && since ? since : '';
    const result = await pullEmployeesSince(safeSince);
    if (!result) {
      return;
    }
    const employees = Array.isArray(result.employees) ? result.employees : [];
    const requirements = Array.isArray(result.employeeRequirements) ? result.employeeRequirements : [];
    if (employees.length || requirements.length) {
      await this.db.transaction('rw', this.db.employees, this.db.employeeRequirements, async () => {
        if (employees.length) {
          await this.db.employees.bulkPut(employees);
        }
        if (requirements.length) {
          await this.db.employeeRequirements.bulkPut(requirements);
        }
      });
    }
    const nextCursor = result.cursor || this.computeLatestSyncTimestamp(employees, requirements) || new Date().toISOString();
    if (nextCursor) {
      this.writeLastCloudSync(nextCursor);
    }
  },
  async submitImportForCloudApproval() {
    if (!this.cloudAvailable) {
      this.toast('Cloud sync is not configured.', 'error');
      return;
    }
    if (this.importDrawer.submitLoading) {
      return;
    }
    const rows = Array.isArray(this.importDrawer.pendingRows) ? this.importDrawer.pendingRows : [];
    if (!rows.length) {
      this.toast('Run a dry-run before submitting for approval.', 'error');
      return;
    }
    const rawRows = Array.isArray(this.importDrawer.pendingRawRows) ? this.importDrawer.pendingRawRows : [];
    const payloadRows = rows.map((row, index) => ({
      mapped: row,
      raw: rawRows[index] || null
    }));
    const metadata = {
      summary: this.importDrawer.pendingSummary,
      mapping: this.importDrawer.mapping,
      headerRow: this.importDrawer.pendingHeader,
      mode: this.importDrawer.mode === 'seniority' ? 'seniority' : 'employees',
      fileName: this.importDrawer.fileName,
      requestedBy: this.currentUserName()
    };
    this.importDrawer.submitLoading = true;
    this.importDrawer.pendingImportsError = '';
    this.updateImportDrawerCommitState();
    try {
      const response = await submitImportForApproval(payloadRows, metadata);
      this.importDrawer.pendingBatchId = response?.batchId || '';
      this.importDrawer.awaitingApproval = true;
      this.importDrawer.approvalMessage = 'Awaiting approval';
      this.toast('Import submitted for approval.', 'success');
    } catch (error) {
      console.error('Failed to submit import for approval', error);
      const message = error?.message ? `Submit failed: ${error.message}` : 'Submit failed. See console for details.';
      this.setImportDrawerError(message);
    } finally {
      this.importDrawer.submitLoading = false;
      this.updateImportDrawerCommitState();
    }
  },
  toggleImportAdminMode() {
    if (!this.cloudAvailable) {
      this.toast('Cloud sync is not configured.', 'error');
      return;
    }
    this.importDrawer.adminMode = !this.importDrawer.adminMode;
    if (this.importDrawer.adminMode) {
      this.loadPendingImports();
    }
  },
  async loadPendingImports() {
    if (!this.cloudAvailable) {
      return;
    }
    const client = getSupabaseClient();
    if (!client) {
      this.importDrawer.pendingImports = [];
      this.importDrawer.pendingImportsError = '';
      return;
    }
    this.importDrawer.pendingImportsLoading = true;
    this.importDrawer.pendingImportsError = '';
    try {
      const { data, error } = await client
        .from('imports')
        .select('id, status, summary, row_count, created_at, requested_by, mode, file_name')
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
      if (error) {
        throw error;
      }
      const pending = Array.isArray(data) ? data : [];
      this.importDrawer.pendingImports = pending.map(entry => {
        const summary = entry?.summary && typeof entry.summary === 'object' ? entry.summary : {};
        const added = Number(summary.added) || 0;
        const updated = Number(summary.updated) || 0;
        const skipped = Number(summary.skipped) || 0;
        const createdAt = entry?.created_at ? new Date(entry.created_at) : null;
        const createdLabel = createdAt && !Number.isNaN(createdAt.valueOf())
          ? createdAt.toLocaleString()
          : '';
        return {
          id: entry.id,
          status: entry.status,
          mode: entry.mode || 'employees',
          summary,
          rowCount: entry.row_count || 0,
          createdAt: entry.created_at,
          createdAtLabel: createdLabel,
          requestedBy: entry.requested_by || '',
          fileName: entry.file_name || '',
          summaryText: `${added} added, ${updated} updated, ${skipped} skipped`
        };
      });
    } catch (error) {
      console.error('Failed to load pending imports', error);
      this.importDrawer.pendingImportsError = error?.message ? String(error.message) : 'Unable to load pending imports.';
    } finally {
      this.importDrawer.pendingImportsLoading = false;
    }
  },
  async approvePendingImport(batchId) {
    if (!batchId || !this.cloudAvailable) {
      return;
    }
    if (this.importDrawer.approvingBatchId) {
      return;
    }
    if (!this.db) {
      this.toast('Database is not ready.', 'error');
      return;
    }
    this.importDrawer.approvingBatchId = batchId;
    this.importDrawer.pendingImportsError = '';
    try {
      const approvedBy = this.currentUserName() || undefined;
      const result = await approveSupabaseImport(batchId, { approvedBy });
      const employees = Array.isArray(result?.employees) ? result.employees : [];
      const requirements = Array.isArray(result?.employeeRequirements) ? result.employeeRequirements : [];
      if (employees.length || requirements.length) {
        await this.db.transaction('rw', this.db.employees, this.db.employeeRequirements, async () => {
          if (employees.length) {
            await this.db.employees.bulkPut(employees);
          }
          if (requirements.length) {
            await this.db.employeeRequirements.bulkPut(requirements);
          }
        });
      }
      if (result?.cursor) {
        this.writeLastCloudSync(result.cursor);
      } else {
        const cursor = this.computeLatestSyncTimestamp(employees, requirements);
        if (cursor) {
          this.writeLastCloudSync(cursor);
        }
      }
      await this.syncFromCloud(true);
      await this.loadPendingImports();
      await this.loadData();
      this.toast('Import approved and synced.', 'success');
    } catch (error) {
      console.error('Failed to approve import', error);
      const message = error?.message ? String(error.message) : 'Approval failed.';
      this.importDrawer.pendingImportsError = message;
      this.toast('Approval failed. See console for details.', 'error');
    } finally {
      this.importDrawer.approvingBatchId = '';
    }
    const hasSummary = !!state.summary && typeof state.summary === 'object';
    const baseDisabled = !state.file || !hasSummary || state.dryRunLoading;
    state.commitDisabled = baseDisabled || state.commitLoading;
    state.commitLocalDisabled = baseDisabled || state.commitLocalLoading || state.submitLoading;
    state.submitDisabled = baseDisabled || state.submitLoading || state.commitLocalLoading;
  },
  downloadSampleCSV() {
    if (this.importDrawer.mode === 'seniority') {
      try {
        window.open('/sample-seniority-import.csv', '_blank', 'noopener');
      } catch (error) {
        console.error('Failed to open seniority sample', error);
        this.setImportDrawerError('Unable to open the seniority sample file.', { toast: false });
      }
      return;
    }

    const csv = `First Name,Last Name,Role,Status,Employment Type,Seniority Hours
Ravneet,KAUR,LPN,Active,Full-Time,1123
Tirth,SINGH,HCA,Active,Casual,456
Mehak,BRAICH,LPN,Active,Part-Time,988
`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sample-employees.csv';
    link.click();
    URL.revokeObjectURL(url);
  },
  async initActivityLog(force = false) {
    if (!this.db) {
      return;
    }

    if (this.activityLogLoaded && !force) {
      return;
    }

    if (this._activityLogLoading) {
      await this._activityLogLoading;
      return;
    }

    const table = this.db.activities;
    if (!table || typeof table.orderBy !== 'function') {
      this.activityLogLoaded = true;
      if (force) {
        this.activityLog.splice(0);
      }
      return;
    }

    this._activityLogLoading = (async () => {
      try {
        const records = await table.orderBy('createdAt').reverse().limit(ACTIVITY_TIMELINE_LIMIT).toArray();
        const normalized = Array.isArray(records)
          ? records.map(entry => ({
              id: entry?.id ?? entry?.key ?? generateId(),
              type: typeof entry?.type === 'string' && entry.type ? entry.type : 'activity',
              summary: typeof entry?.summary === 'string' ? entry.summary : '',
              details: entry?.details && typeof entry.details === 'object' ? cloneActivityDetail(entry.details) : {},
              createdAt: entry?.createdAt || new Date().toISOString()
            }))
          : [];
        this.activityLog.splice(0, this.activityLog.length, ...normalized);
      } catch (error) {
        console.error('Failed to load activity log', error);
        if (force) {
          this.activityLog.splice(0);
        }
      } finally {
        this.activityLogLoaded = true;
        this._activityLogLoading = null;
      }
    })();

    await this._activityLogLoading;
  },
  async recordActivity({ type, summary, details = {} } = {}) {
    if (!this.db) {
      return null;
    }

    await this.initActivityLog();

    const table = this.db.activities;
    const normalizedType = typeof type === 'string' && type.trim() ? type.trim() : 'activity';
    const normalizedDetails = cloneActivityDetail(details);
    const timestampIso = new Date().toISOString();
    const finalSummary = buildActivitySummary(summary || normalizedType, normalizedDetails, timestampIso);
    const entry = {
      type: normalizedType,
      summary: finalSummary,
      details: normalizedDetails,
      createdAt: timestampIso
    };

    if (table && typeof table.add === 'function') {
      try {
        entry.id = await table.add(entry);
      } catch (error) {
        console.error('Failed to persist activity entry', error);
      }
    }

    if (entry.id == null) {
      entry.id = `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    this.activityLog.unshift(entry);
    if (this.activityLog.length > ACTIVITY_TIMELINE_LIMIT) {
      this.activityLog.length = ACTIVITY_TIMELINE_LIMIT;
    }

    console.info('Activity:', finalSummary);
    return entry;
  },
  openAddRequirement() {
    this.showAddRequirementModal = true;
    const store = this.$store?.app;
    if (store && store.showAddRequirementModal !== true) {
      store.showAddRequirementModal = true;
    }
    this.openAddRequirementModal();
  },
  openAddRequirementModal() {
    if (!this.addRequirementModal.open) {
      if (!this.addRequirementModal.form.name) {
        this.resetAddRequirementForm();
      }
      this.addRequirementModal.open = true;
      this.showAddRequirementModal = true;
      const store = this.$store?.app;
      if (store && store.showAddRequirementModal !== true) {
        store.showAddRequirementModal = true;
      }
      this.hydrateAddRequirementModal();
      this.$nextTick(() => {
        this.$refs.addRequirementName?.focus();
      });
    }
  },
  closeAddRequirementModal(options = {}) {
    const { silent = false, preserveForm = false, force = false } = options;
    if (!this.addRequirementModal.open && !force) {
      return;
    }
    this.addRequirementModal.open = false;
    this.showAddRequirementModal = false;
    if (!preserveForm) {
      this.resetAddRequirementForm();
    }
    if (!silent) {
      const store = this.$store?.app;
      if (store && store.showAddRequirementModal !== false) {
        store.showAddRequirementModal = false;
      }
    }
  },
  resetAddRequirementForm() {
    this.addRequirementModal.form = {
      name: '',
      color: '#e2e8f0',
      defaultExpiryDays: ''
    };
    this.addRequirementModal.saving = false;
    this.addRequirementModal.errors = {};
  },
  validateAddRequirementForm() {
    const errors = {};
    const name = typeof this.addRequirementModal.form.name === 'string'
      ? this.addRequirementModal.form.name.trim()
      : '';
    if (!name) {
      errors.name = 'Name is required.';
    }
    const expiryValue = this.addRequirementModal.form.defaultExpiryDays;
    if (expiryValue !== '' && expiryValue !== null && expiryValue !== undefined) {
      const parsed = Number.parseInt(expiryValue, 10);
      if (!Number.isFinite(parsed) || parsed < 0) {
        errors.defaultExpiryDays = 'Enter a non-negative number of days.';
      }
    }
    return {
      valid: Object.keys(errors).length === 0,
      errors,
      name
    };
  },
  async submitAddRequirementForm() {
    if (!this.db || this.addRequirementModal.saving) {
      return;
    }

    const { valid, errors, name } = this.validateAddRequirementForm();
    this.addRequirementModal.errors = errors;
    if (!valid) {
      return;
    }

    const color = typeof this.addRequirementModal.form.color === 'string'
      ? this.addRequirementModal.form.color.trim()
      : '';
    const expiryValue = this.addRequirementModal.form.defaultExpiryDays;
    const parsedExpiry = expiryValue === '' || expiryValue === null || expiryValue === undefined
      ? null
      : Number.parseInt(expiryValue, 10);
    const timestamp = new Date().toISOString();
    const requirement = {
      id: generateId(),
      name,
      color: color || null,
      defaultExpiryDays: Number.isFinite(parsedExpiry) ? parsedExpiry : null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.addRequirementModal.saving = true;
    try {
      const command = new AddRequirement(this.db, {
        requirement,
        initialStatus: 'Pending',
        respectTemplates: false
      });
      await command.execute();
      await this.loadData();
      this.applyFilters();
      this.closeAddRequirementModal();

      const store = this.$store?.app;
      const successMessage = `${requirement.name} added`;
      if (store && typeof store.showToast === 'function') {
        store.showToast({ type: 'success', message: successMessage });
      }
      await this.recordActivity({
        type: 'requirement:add',
        summary: successMessage,
        details: {
          requirementId: requirement.id,
          defaultExpiryDays: requirement.defaultExpiryDays,
          color: requirement.color || null
        }
      });
    } catch (error) {
      console.error('Failed to add requirement', error);
      this.addRequirementModal.errors = {
        ...this.addRequirementModal.errors,
        form: 'Unable to add requirement. Please try again.'
      };
      const store = this.$store?.app;
      if (store && typeof store.showToast === 'function') {
        store.showToast({ type: 'error', message: 'Failed to add requirement.' });
      }
    } finally {
      this.addRequirementModal.saving = false;
    }
  },
  openAddEmployee() {
    this.openAddEmployeeModal();
  },
  openAddEmployeeModal() {
    if (this.showAddEmployeeModal) {
      return;
    }
    if (!this.form.role) {
      this.resetAddEmployeeForm();
    }
    this.showAddEmployeeModal = true;
    const overlay = this.$store?.app?.overlay;
    if (overlay && typeof overlay.open === 'function') {
      overlay.open('add');
    }
    this.hydrateAddEmployeeModal();
    this.$nextTick(() => {
      const node = document.querySelector('#add-employee-modal-root [data-autofocus]');
      if (node && typeof node.focus === 'function') {
        node.focus();
      }
    });
  },
  closeAddEmployeeModal(options = {}) {
    const { silent = false, preserveForm = false, force = false } = options;
    if (!this.showAddEmployeeModal && !force) {
      return;
    }
    this.showAddEmployeeModal = false;
    this.formSaving = false;
    if (!preserveForm) {
      this.resetAddEmployeeForm();
    }
    if (!silent) {
      const overlay = this.$store?.app?.overlay;
      if (overlay && typeof overlay.close === 'function') {
        overlay.close('add');
      }
    }
  },
  resetAddEmployeeForm() {
    const lookups = this.employeeLookups || {
      roles: DEFAULT_ROLE_LOOKUPS,
      statuses: DEFAULT_STATUS_LOOKUPS,
      employmentTypes: DEFAULT_EMPLOYMENT_TYPE_LOOKUPS
    };
    const role = lookups.roles?.[0] || '';
    const status = lookups.statuses?.[0] || '';
    const employmentType = lookups.employmentTypes?.[0] || '';
    this.form = {
      firstName: '',
      lastName: '',
      role,
      status,
      employmentType,
      seniorityHours: '',
      jobClass: '',
      jobTitle: '',
      ranking: '',
      positionStatus: mapPositionStatus(employmentType) || ''
    };
    this.formErrors = {};
  },
  validateAddEmployeeForm() {
    const errors = {};
    const required = [
      'firstName',
      'lastName',
      'role',
      'status',
      'employmentType',
      'seniorityHours',
      'jobClass',
      'jobTitle',
      'ranking',
      'positionStatus'
    ];
    for (const field of required) {
      const value = this.form[field];
      const normalized = typeof value === 'string' ? value.trim() : value;
      if (normalized === '' || normalized == null) {
        errors[field] = 'This field is required.';
      }
    }
    if (!errors.seniorityHours) {
      const hours = Number.parseFloat(this.form.seniorityHours);
      if (!Number.isFinite(hours) || hours < 0) {
        errors.seniorityHours = 'Enter a valid number.';
      }
    }
    if (!errors.ranking) {
      const rankingValue = Number.parseFloat(this.form.ranking);
      if (!Number.isFinite(rankingValue)) {
        errors.ranking = 'Enter a valid number.';
      }
    }
    return errors;
  },
  focusFirstInvalidAddEmployeeField(errors) {
    const order = [
      'firstName',
      'lastName',
      'role',
      'status',
      'employmentType',
      'seniorityHours',
      'jobClass',
      'jobTitle',
      'ranking',
      'positionStatus'
    ];
    for (const field of order) {
      if (!errors[field]) continue;
      const refName = `addEmployee${field.charAt(0).toUpperCase()}${field.slice(1)}`;
      const target = this.$refs?.[refName];
      if (target && typeof target.focus === 'function') {
        target.focus();
      }
      break;
    }
  },
  buildAddEmployeePayload() {
    const form = this.form;
    const firstName = typeof form.firstName === 'string' ? form.firstName.trim() : '';
    const lastName = typeof form.lastName === 'string' ? form.lastName.trim() : '';
    const role = typeof form.role === 'string' ? form.role.trim() : '';
    const status = typeof form.status === 'string' ? form.status.trim() : '';
    const employmentType = typeof form.employmentType === 'string' ? form.employmentType.trim() : '';
    const hoursValue = typeof form.seniorityHours === 'string' ? form.seniorityHours.trim() : form.seniorityHours;
    const seniorityHours = Number.parseFloat(hoursValue);
    const jobClass = typeof form.jobClass === 'string' ? form.jobClass.trim() : '';
    const jobTitle = typeof form.jobTitle === 'string' ? form.jobTitle.trim() : '';
    const rankingValue = typeof form.ranking === 'string' ? form.ranking.trim() : form.ranking;
    const ranking = Number.parseFloat(rankingValue);
    const rawPositionStatus = typeof form.positionStatus === 'string' ? form.positionStatus.trim() : '';
    const normalizedPositionStatus = mapPositionStatus(rawPositionStatus, employmentType);
    const timestamp = new Date().toISOString();
    return {
      id: generateId(),
      firstName,
      lastName,
      name: `${firstName} ${lastName}`.trim(),
      role,
      status,
      employmentType,
      position: role,
      rank: employmentType,
      jobClass,
      jobTitle,
      ranking: Number.isFinite(ranking) ? ranking : null,
      positionStatus: normalizedPositionStatus || rawPositionStatus,
      seniorityHours: Number.isFinite(seniorityHours) ? seniorityHours : 0,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  },
  async addEmployeeSubmit() {
    if (!this.db || this.formSaving) {
      return;
    }
    const errors = this.validateAddEmployeeForm();
    this.formErrors = errors;
    if (!this.form.firstName || !this.form.lastName || !this.form.role) {
      this.toast('Please fill required fields', 'error');
      this.$nextTick(() => this.focusFirstInvalidAddEmployeeField(errors));
      return;
    }
    if (Object.keys(errors).length) {
      this.$nextTick(() => this.focusFirstInvalidAddEmployeeField(errors));
      return;
    }
    const payload = this.buildAddEmployeePayload();
    this.formSaving = true;
    try {
      const { undoPayload, employee } = await this.api.addEmployee({
        db: this.db,
        activityLog: this.activityLog,
        employee: { ...payload }
      });
      void undoPayload;
      this.closeAddEmployeeModal({ preserveForm: false });
      this.showAddEmployeeModal = false;
      await this.loadData();
      this.applyFilters();
      const store = this.$store?.app;
      if (store && typeof store.showToast === 'function') {
        const name = `${employee?.firstName || ''} ${employee?.lastName || ''}`.trim() || 'Employee';
        store.showToast({ type: 'success', message: `${name} added.` });
      }
      const employeeName = `${employee?.firstName || ''} ${employee?.lastName || ''}`.trim() || 'Employee';
      const roleLabel = employee?.role ? ` (${employee.role})` : '';
      await this.recordActivity({
        type: 'employee:add',
        summary: `Added employee ${employeeName}${roleLabel}`,
        details: {
          employeeId: employee?.id || payload.id,
          role: employee?.role || '',
          status: employee?.status || '',
          employmentType: employee?.employmentType || '',
          createdAt: employee?.createdAt
        }
      });
      this.toast('Employee added', 'success');
      const timelineStore = this.$store?.activityLog;
      if (timelineStore && typeof timelineStore.record === 'function') {
        const name = `${employee?.firstName || ''} ${employee?.lastName || ''}`.trim() || 'Employee';
        timelineStore.record({
          type: 'Add employee',
          actionType: 'AddEmployee',
          summary: `${name} added`,
          timestamp: Date.now(),
          metadata: { employeeId: employee?.id || payload.id }
        });
      }
    } catch (error) {
      console.error('Failed to add employee', error);
      this.formErrors = {
        ...this.formErrors,
        form: 'Unable to add employee. Please try again.'
      };
    } finally {
      this.formSaving = false;
    }
  },
  toast(message, type = 'info', options = {}) {
    const store = this.$store?.app;
    const payload = typeof options === 'object' && options !== null ? { ...options } : {};
    payload.type = typeof type === 'string' && type ? type : 'info';
    payload.message = typeof message === 'string' ? message : String(message ?? '');
    if (store && typeof store.showToast === 'function') {
      store.showToast(payload);
      return;
    }
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(payload.message);
    }
  },
  async confirmAndDeleteEmployee(employeeId) {
    if (!this.db || !employeeId) {
      return;
    }
    const employee = await this.db.employees.get(employeeId);
    if (!employee) {
      return;
    }
    const displayName = `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || employee.name || 'this employee';
    const ok = confirm(`Are you sure you want to permanently delete ${displayName}? This cannot be undone.`);
    if (!ok) {
      return;
    }

    if (typeof this.api?.deleteEmployee !== 'function') {
      console.warn('Delete employee API is unavailable.');
      this.toast('Delete action is unavailable right now.', 'error');
      return;
    }

    try {
      await this.api.deleteEmployee({
        db: this.db,
        employeeId,
        activityLog: this.activityLog
      });
    } catch (error) {
      console.error('Failed to delete employee', error);
      this.toast('Failed to delete employee', 'error');
      return;
    }

    this.employees = this.employees.filter(emp => emp?.id !== employeeId);
    this.filteredEmployees = this.filteredEmployees.filter(emp => emp?.id !== employeeId);
    this.selectedEmployees = this.selectedEmployees.filter(id => id !== employeeId);

    if (this.profilePanel.employeeId === employeeId) {
      this.closeProfile();
    }

    this.toast(`Deleted ${displayName}`, 'success');
    await this.loadData();
    this.applyFilters();
  },
  downloadSampleCsv() {
    try {
      window.open('/sample-employees.csv', '_blank', 'noopener');
    } catch (error) {
      console.error('Failed to open sample CSV', error);
      this.setImportDrawerError('Unable to open the sample CSV.', { toast: false });
    }
  },
  openProfile(employeeId) {
    const employee = this.employeeById(employeeId);
    if (!employee) {
      this.toast('Employee not found.', 'error');
      return;
    }
    this.profilePanel.employeeId = employee.id;
    this.profilePanel.editing = false;
    this.profilePanel.saving = false;
    this.profilePanel.error = '';
    this.profilePanel.form = this.buildProfileForm(employee);
    const overlay = this.$store?.app?.overlay;
    if (overlay && typeof overlay.open === 'function') {
      overlay.open('profile');
    }
    const wasOpen = !!this.profilePanel.open;
    this.profilePanel.open = true;
    this.hydrateEmployeeProfile();
    if (!wasOpen) {
      this.$nextTick(() => {
        const node = document.querySelector('#employee-profile-root [data-autofocus]');
        if (node && typeof node.focus === 'function') {
          node.focus();
        }
      });
    }
  },
  closeProfile(options = {}) {
    const { silent = false, force = false } = options;
    if (!this.profilePanel.open && !force) {
      return;
    }
    this.profilePanel.open = false;
    if (!silent) {
      const overlay = this.$store?.app?.overlay;
      if (overlay && typeof overlay.close === 'function') {
        overlay.close('profile');
      }
    }
    this.profilePanel.employeeId = null;
    this.resetProfileForm();
  },
  setImportDrawerError(message, options = {}) {
    const { toast = true } = options;
    const safeMessage = message ? String(message) : 'Import failed.';
    this.importDrawer.error = safeMessage;
    this.importDrawer.submitLoading = false;
    this.importDrawer.awaitingApproval = false;
    this.importDrawer.pendingBatchId = '';
    this.importDrawer.approvalMessage = '';
    this.updateImportDrawerCommitState();
    if (toast) {
      const store = this.$store?.app;
      if (store && typeof store.showToast === 'function') {
        store.showToast({ type: 'error', message: safeMessage, duration: 8000 });
      }
    }
  },
  normalizeImportSummary(payload) {
    if (!payload || typeof payload !== 'object') {
      return { added: 0, updated: 0, skipped: 0 };
    }
    const source = typeof payload.summary === 'object' && payload.summary !== null ? payload.summary : payload;
    return {
      added: Number(source.added) || 0,
      updated: Number(source.updated) || 0,
      skipped: Number(source.skipped) || 0
    };
  },
  applyDryRunPreview(result) {
    const summary = this.normalizeImportSummary(result);
    this.importDrawer.summary = summary;
    const mapping = result && typeof result.mapping === 'object' ? result.mapping : (result && typeof result.columns === 'object' ? result.columns : null);
    this.importDrawer.mapping = mapping;
    const pendingEmployees = Array.isArray(result?.employees)
      ? result.employees.filter(row => row && typeof row === 'object')
      : [];
    this.importDrawer.pendingRows = pendingEmployees;
    this.importDrawer.pendingRawRows = Array.isArray(result?.rows)
      ? result.rows.filter(row => row && typeof row === 'object')
      : [];
    this.importDrawer.pendingSummary = summary;
    this.importDrawer.pendingHeader = Array.isArray(result?.headerRow) ? [...result.headerRow] : null;
    this.importDrawer.awaitingApproval = false;
    this.importDrawer.pendingBatchId = '';
    this.importDrawer.approvalMessage = '';
    this.importDrawer.submitLoading = false;
    const mappingRows = Array.isArray(result?.mappingRows)
      ? result.mappingRows
          .filter(row => row && typeof row === 'object')
          .map((row, index) => ({
            key: typeof row.fieldKey === 'string' && row.fieldKey ? row.fieldKey : `field-${index}`,
            fieldKey: typeof row.fieldKey === 'string' ? row.fieldKey : '',
            sourceHeader: row.sourceHeader != null ? String(row.sourceHeader) : '—',
            mappedField: row.mappedField != null ? String(row.mappedField) : ''
          }))
      : [];
    this.importDrawer.mappingRows = mappingRows;
    const headerRowNumber = Number(result?.headerRowNumber);
    this.importDrawer.headerRowNumber = Number.isFinite(headerRowNumber) && headerRowNumber > 0 ? headerRowNumber : null;
    let previewRows = [];
    let previewColumns = [];
    let total = 0;
    if (result && typeof result === 'object') {
      const preview = result.preview;
      if (preview && typeof preview === 'object') {
        if (Array.isArray(preview.rows)) {
          previewRows = preview.rows;
        }
        if (Array.isArray(preview.columns)) {
          previewColumns = preview.columns;
        }
        if (typeof preview.total === 'number' && Number.isFinite(preview.total)) {
          total = preview.total;
        }
      }
      if (!previewRows.length && Array.isArray(result.previewRows)) {
        previewRows = result.previewRows;
      }
      if (!previewColumns.length && Array.isArray(result.previewColumns)) {
        previewColumns = result.previewColumns;
      }
      if (!previewRows.length && Array.isArray(result.rows)) {
        previewRows = result.rows;
      }
      if (!previewColumns.length && Array.isArray(result.columns)) {
        previewColumns = result.columns;
      }
      if (!total && typeof result.total === 'number' && Number.isFinite(result.total)) {
        total = result.total;
      }
    }
    const normalizedRows = Array.isArray(previewRows)
      ? previewRows.filter(row => row && typeof row === 'object').slice(0, 10)
      : [];
    let normalizedColumns = Array.isArray(previewColumns)
      ? previewColumns.map(col => String(col))
      : [];
    if (!normalizedColumns.length && normalizedRows.length) {
      normalizedColumns = Object.keys(normalizedRows[0]);
    }
    this.importDrawer.previewRows = normalizedRows;
    this.importDrawer.previewColumns = normalizedColumns;
    this.importDrawer.previewTotal = total || normalizedRows.length;
    this.importDrawer.error = '';
    this.updateImportDrawerCommitState();
  },
  async onImportFileChange(event) {
    const file = event?.target?.files?.[0] || null;
    this.importDrawer.file = file;
    this.importDrawer.fileName = file ? file.name : '';
    this.importDrawer.summary = null;
    this.importDrawer.mapping = null;
    this.importDrawer.mappingRows = [];
    this.importDrawer.previewRows = [];
    this.importDrawer.previewColumns = [];
    this.importDrawer.previewTotal = 0;
    this.importDrawer.error = '';
    this.importDrawer.headerRowNumber = null;
    this.importDrawer.pendingRows = [];
    this.importDrawer.pendingRawRows = [];
    this.importDrawer.pendingSummary = null;
    this.importDrawer.pendingHeader = null;
    this.importDrawer.awaitingApproval = false;
    this.importDrawer.pendingBatchId = '';
    this.importDrawer.approvalMessage = '';
    this.importDrawer.submitLoading = false;
    this.importDrawer.commitLoading = false;
    this.importDrawer.commitLocalLoading = false;
    this.importDrawer.submitLoading = false;
    this.importDrawer.commitDisabled = true;
    this.importDrawer.commitLocalDisabled = true;
    this.importDrawer.submitDisabled = true;
    this.updateImportDrawerCommitState();
    if (file) {
      await this.runImportDryRun(file);
    }
  },
  async runImportDryRun(file) {
    const targetFile = file || this.importDrawer.file;
    if (!targetFile) {
      this.setImportDrawerError('Select a file to start the dry-run.', { toast: false });
      return;
    }
    const fileName = typeof targetFile.name === 'string' ? targetFile.name : '';
    const extension = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
    const mode = this.importDrawer.mode === 'seniority' ? 'seniority' : 'employees';
    if (
      mode === 'seniority'
      && (extension === 'xlsx' || extension === 'xls')
      && !window.XLSX
      && !window.__xlsxModule
    ) {
      this.toast('Excel not available—use CSV or bundle XLSX', 'error');
      return;
    }
    const dryRunFn =
      mode === 'seniority'
        ? window.importEmployeesSeniorityDryRun
            || window.importSeniorityDryRun
            || window.importEmployeesDryRun
        : window.importEmployeesDryRun;
    if (typeof dryRunFn !== 'function') {
      const errorMessage =
        mode === 'seniority'
          ? 'Seniority importer is unavailable. Please reload the page.'
          : 'Employee importer is unavailable. Please reload the page.';
      this.setImportDrawerError(errorMessage);
      return;
    }
    this.importDrawer.dryRunLoading = true;
    this.updateImportDrawerCommitState();
    try {
      const result = await dryRunFn(targetFile);
      this.applyDryRunPreview(result || {});
    } catch (error) {
      console.error('Dry-run failed', error);
      const message = error?.message ? String(error.message) : 'Dry-run failed. Check the console for details.';
      this.setImportDrawerError(message);
    } finally {
      this.importDrawer.dryRunLoading = false;
      this.updateImportDrawerCommitState();
    }
  },
  async commitImport() {
    if (this.importDrawer.mode === 'seniority') {
      return this.commitImportLocally();
    }
    if (this.importDrawer.commitDisabled) {
      return;
    }
    const mode = this.importDrawer.mode === 'seniority' ? 'seniority' : 'employees';
    const commitFn =
      mode === 'seniority'
        ? window.importEmployeesSeniorityCommit
            || window.importSeniorityCommit
            || window.importEmployeesCommit
        : window.importEmployeesCommit;
    if (typeof commitFn !== 'function') {
      const errorMessage =
        mode === 'seniority'
          ? 'Seniority importer is unavailable. Please reload the page.'
          : 'Employee importer is unavailable. Please reload the page.';
      this.setImportDrawerError(errorMessage);
      return;
    }
    this.importDrawer.commitLoading = true;
    this.updateImportDrawerCommitState();
    try {
      const result = await commitFn();
      const summary = this.normalizeImportSummary(result || {});
      await this.loadData();
      this.closeImportDrawer();
      const store = this.$store?.app;
      const label = mode === 'seniority' ? 'Seniority' : 'Employees';
      const message = `${label}: ${summary.added} added, ${summary.updated} updated, ${summary.skipped} skipped.`;
      if (store && typeof store.showToast === 'function') {
        store.showToast({ type: 'success', message });
      }
      const total = summary.added + summary.updated;
      const sourceLabel = mode === 'seniority' ? 'seniority' : 'employees';
      const approvedBy = (window.APP_FLAGS?.currentUserName && String(window.APP_FLAGS.currentUserName).trim())
        || 'Admin';
      await this.recordActivity({
        type: 'import',
        summary: `Imported ${total} employees (${sourceLabel}). ${summary.updated} updated. ${summary.added} added.`,
        details: {
          ...summary,
          source: sourceLabel,
          total,
          approvedBy,
          approvedAt: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Import commit failed', error);
      const message = error?.message ? String(error.message) : 'Commit failed. Check the console for details.';
      this.setImportDrawerError(message);
    } finally {
      this.importDrawer.commitLoading = false;
      this.updateImportDrawerCommitState();
    }
  },
  async commitImportLocally() {
    if (this.importDrawer.mode !== 'seniority') {
      return this.commitImport();
    }
    if (this.importDrawer.commitLocalDisabled) {
      return;
    }
    const commitFn =
      window.importEmployeesSeniorityCommit
        || window.importSeniorityCommit
        || window.importEmployeesCommit;
    if (typeof commitFn !== 'function') {
      this.setImportDrawerError('Seniority importer is unavailable. Please reload the page.');
      return;
    }
    this.importDrawer.commitLocalLoading = true;
    this.updateImportDrawerCommitState();
    try {
      const result = await commitFn();
      const summary = this.normalizeImportSummary(result || {});
      await this.loadData();
      this.closeImportDrawer();
      const store = this.$store?.app;
      const message = `Seniority import committed locally: ${summary.added} added, ${summary.updated} updated, ${summary.skipped} skipped.`;
      if (store && typeof store.showToast === 'function') {
        store.showToast({ type: 'success', message });
      }
      const total = summary.added + summary.updated;
      const approvedBy = (window.APP_FLAGS?.currentUserName && String(window.APP_FLAGS.currentUserName).trim())
        || 'Admin';
      await this.recordActivity({
        type: 'import',
        summary: `Imported ${total} employees (seniority). ${summary.updated} updated. ${summary.added} added.`,
        details: {
          ...summary,
          source: 'seniority',
          total,
          approvedBy,
          approvedAt: new Date().toISOString(),
          action: 'localCommit'
        }
      });
    } catch (error) {
      console.error('Seniority import commit failed', error);
      const message = error?.message ? String(error.message) : 'Local commit failed. Check the console for details.';
      this.setImportDrawerError(message);
    } finally {
      this.importDrawer.commitLocalLoading = false;
      this.updateImportDrawerCommitState();
    }
  },
  async submitImportForApproval() {
    if (this.importDrawer.mode !== 'seniority') {
      return;
    }
    if (this.importDrawer.submitDisabled) {
      return;
    }
    const submitFn =
      window.importEmployeesSenioritySubmitForApproval
        || window.importSenioritySubmitForApproval
        || window.submitSeniorityImportForApproval;
    if (typeof submitFn !== 'function') {
      this.setImportDrawerError('Pending import workflow is unavailable. Please reload the page.');
      return;
    }
    this.importDrawer.submitLoading = true;
    this.updateImportDrawerCommitState();
    try {
      const result = await submitFn({
        fileName: this.importDrawer.fileName,
        headerRowNumber: this.importDrawer.headerRowNumber
      });
      const summarySource = result && typeof result === 'object' && result.summary ? result.summary : result;
      const summary = this.normalizeImportSummary(summarySource || {});
      this.closeImportDrawer();
      const store = this.$store?.app;
      const message = `Seniority import submitted for approval: ${summary.added} added, ${summary.updated} updated, ${summary.skipped} skipped.`;
      if (store && typeof store.showToast === 'function') {
        store.showToast({ type: 'success', message });
      }
      const total = summary.added + summary.updated;
      const submittedBy = (window.APP_FLAGS?.currentUserName && String(window.APP_FLAGS.currentUserName).trim())
        || 'Admin';
      await this.recordActivity({
        type: 'importPending',
        summary: `Submitted ${total} seniority updates for approval. ${summary.updated} updated. ${summary.added} added.`,
        details: {
          ...summary,
          source: 'seniority',
          total,
          approval: {
            status: 'pending',
            submittedBy,
            submittedAt: new Date().toISOString()
          }
        }
      });
    } catch (error) {
      console.error('Submit for approval failed', error);
      const message = error?.message ? String(error.message) : 'Submit for approval failed. Check the console for details.';
      this.setImportDrawerError(message);
    } finally {
      this.importDrawer.submitLoading = false;
      this.updateImportDrawerCommitState();
    }
  },
  async loadData() {
    if (!this.db) {
      this.loading = false;
      return;
    }
    this.loading = true;
    try {
      const [employees, requirementsRaw, employeeRequirements] = await Promise.all([
        this.db.table('employees').toArray(),
        this.db.table('requirements').toArray(),
        this.db.table('employeeRequirements').toArray()
      ]);
      employees.sort((a, b) => {
        const last = normalizeLower(a?.lastName).localeCompare(normalizeLower(b?.lastName));
        if (last !== 0) return last;
        return normalizeLower(a?.firstName).localeCompare(normalizeLower(b?.firstName));
      });
      this.employees = employees;
      this.updateStoreEmployees();
      const requirements = Array.isArray(requirementsRaw) ? [...requirementsRaw] : [];
      requirements.sort((a, b) => {
        const aTime = Date.parse(a?.createdAt ?? '');
        const bTime = Date.parse(b?.createdAt ?? '');
        const aValid = Number.isFinite(aTime);
        const bValid = Number.isFinite(bTime);
        if (aValid && bValid && aTime !== bTime) {
          return aTime - bTime;
        }
        if (aValid && !bValid) {
          return -1;
        }
        if (!aValid && bValid) {
          return 1;
        }
        return normalizeLower(a?.name).localeCompare(normalizeLower(b?.name));
      });
      this.requirements = requirements;
      this.ensureBulkRequirement();
      this.employeeRequirements = employeeRequirements;
      this.refreshRequirementMap();
      this.refreshEmployeeLookups();
      this.refreshAnalytics();
    } finally {
      this.loading = false;
    }
  },
  refreshRequirementMap() {
    const nextMap = new Map();
    for (const record of this.employeeRequirements) {
      if (!record) continue;
      const key = this.buildRequirementKey(record.employeeId, record.requirementId);
      nextMap.set(key, { ...record });
    }
    this.employeeRequirementMap = nextMap;
  },
  refreshEmployeeLookups() {
    const collect = (defaults, accessor) => {
      const values = new Map();
      const addValue = value => {
        if (typeof value !== 'string') return;
        const trimmed = value.trim();
        if (!trimmed) return;
        const key = trimmed.toLowerCase();
        if (!values.has(key)) {
          values.set(key, trimmed);
        }
      };
      defaults.forEach(addValue);
      for (const employee of this.employees) {
        addValue(accessor(employee));
      }
      return Array.from(values.values()).sort((a, b) => a.localeCompare(b));
    };

    const roles = collect(DEFAULT_ROLE_LOOKUPS, employee => employee?.role);
    const statuses = collect(DEFAULT_STATUS_LOOKUPS, employee => employee?.status);
    const employmentTypes = collect(DEFAULT_EMPLOYMENT_TYPE_LOOKUPS, employee => employee?.employmentType);

    this.roleOptions = roles;
    this.employeeLookups = {
      roles,
      statuses,
      employmentTypes
    };
    if (!this.showAddEmployeeModal) {
      if (!this.form.role || !roles.includes(this.form.role)) {
        this.form.role = roles[0] || '';
      }
      if (!this.form.status || !statuses.includes(this.form.status)) {
        this.form.status = statuses[0] || '';
      }
      if (!this.form.employmentType || !employmentTypes.includes(this.form.employmentType)) {
        this.form.employmentType = employmentTypes[0] || '';
        this.form.positionStatus = mapPositionStatus(this.form.employmentType) || this.form.positionStatus;
      }
    }
  },
  refreshAnalytics() {
    this.analytics = computeAnalyticsSummary({
      employees: this.employees,
      requirements: this.requirements,
      employeeRequirements: this.employeeRequirements,
      options: {
        atRiskWindowDays: normalizeNonNegativeNumber(
          this.analyticsConfig.atRiskWindowDays,
          ANALYTICS_AT_RISK_WINDOW_DAYS
        ),
        expiringSoonDays: normalizeWindowDays(this.analyticsConfig.expiringSoonDays),
        expiringThisWeekDays: normalizeWindowDays(
          this.analyticsConfig.expiringThisWeekDays,
          ANALYTICS_EXPIRING_WINDOW_DAYS
        )
      }
    });
  },
  analyticsReferenceDate() {
    const source = this.analytics?.generatedAt;
    const reference = source ? new Date(source) : new Date();
    return Number.isNaN(reference.getTime()) ? new Date() : reference;
  },
  analyticsChipClass(active) {
    const base =
      'inline-flex items-center justify-between gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2';
    const offset = this.darkMode ? 'focus-visible:ring-offset-slate-900' : 'focus-visible:ring-offset-white';
    const activeClasses =
      'border-blue-500 bg-blue-50 text-blue-700 focus-visible:ring-blue-500 dark:border-blue-400 dark:bg-blue-500/20 dark:text-blue-100';
    const inactiveClasses =
      'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-slate-100 focus-visible:ring-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 dark:focus-visible:ring-slate-500';
    return `${base} ${offset} ${active ? activeClasses : inactiveClasses}`;
  },
  applyRequirementRiskFilter(entry) {
    if (!entry || !entry.requirementId) {
      return;
    }
    if (this.isRequirementRiskFilterActive(entry.requirementId)) {
      this.filters.analytics = null;
    } else {
      this.filters.analytics = {
        type: 'requirement-risk',
        requirementId: entry.requirementId
      };
    }
    this.applyFilters();
  },
  isRequirementRiskFilterActive(requirementId) {
    const filter = this.filters.analytics;
    if (!filter || filter.type !== 'requirement-risk') {
      return false;
    }
    return filter.requirementId === requirementId;
  },
  applyRoleFilterFromAnalytics(role) {
    if (!role) {
      return;
    }
    if (this.isRoleFilterActive(role)) {
      this.filters.roles = [];
    } else {
      this.filters.roles = [role];
    }
    this.applyFilters();
  },
  isRoleFilterActive(role) {
    if (!role || !Array.isArray(this.filters.roles)) {
      return false;
    }
    return this.filters.roles.length === 1 && this.filters.roles[0] === role;
  },
  applyExpiringWeekFilter(requirementId = null) {
    const normalized = requirementId || null;
    if (this.isExpiringWeekFilterActive(normalized)) {
      this.filters.analytics = null;
    } else {
      this.filters.analytics = {
        type: 'expiring-week',
        requirementId: normalized,
        windowDays: normalizeWindowDays(
          this.analyticsConfig.expiringThisWeekDays,
          ANALYTICS_EXPIRING_WINDOW_DAYS
        )
      };
    }
    this.applyFilters();
  },
  isExpiringWeekFilterActive(requirementId = null) {
    const filter = this.filters.analytics;
    if (!filter || filter.type !== 'expiring-week') {
      return false;
    }
    return (filter.requirementId || null) === (requirementId || null);
  },
  clearAnalyticsFilter() {
    if (!this.filters.analytics) {
      return;
    }
    this.filters.analytics = null;
    this.applyFilters();
  },
  employeeHasRequirementRisk(employeeId, requirementId) {
    if (!employeeId) {
      return false;
    }
    const requirements = Array.isArray(this.requirements) ? this.requirements : [];
    const referenceDate = this.analyticsReferenceDate();
    const atRiskWindow = normalizeNonNegativeNumber(
      this.analyticsConfig.atRiskWindowDays,
      ANALYTICS_AT_RISK_WINDOW_DAYS
    );
    const expiringSoonWindow = normalizeWindowDays(this.analyticsConfig.expiringSoonDays);
    const expiringWeekWindow = normalizeWindowDays(
      this.analyticsConfig.expiringThisWeekDays,
      ANALYTICS_EXPIRING_WINDOW_DAYS
    );
    const ids = requirementId ? [requirementId] : requirements.map(req => req?.id).filter(Boolean);
    for (const id of ids) {
      const record = this.getEmployeeRequirement(employeeId, id);
      const state = evaluateRequirementState(record, {
        today: referenceDate,
        atRiskWindowDays: atRiskWindow,
        expiringSoonDays: expiringSoonWindow,
        expiringThisWeekDays: expiringWeekWindow
      });
      if (state.atRisk) {
        return true;
      }
    }
    return false;
  },
  employeeHasExpiringWithinWindow(
    employeeId,
    requirementId = null,
    windowDays = this.analyticsConfig.expiringThisWeekDays
  ) {
    if (!employeeId) {
      return false;
    }
    const requirements = Array.isArray(this.requirements) ? this.requirements : [];
    const referenceDate = this.analyticsReferenceDate();
    const normalizedWindow = normalizeWindowDays(windowDays, ANALYTICS_EXPIRING_WINDOW_DAYS);
    const atRiskWindow = normalizeNonNegativeNumber(
      this.analyticsConfig.atRiskWindowDays,
      ANALYTICS_AT_RISK_WINDOW_DAYS
    );
    const ids = requirementId ? [requirementId] : requirements.map(req => req?.id).filter(Boolean);
    for (const id of ids) {
      const record = this.getEmployeeRequirement(employeeId, id);
      const state = evaluateRequirementState(record, {
        today: referenceDate,
        atRiskWindowDays: atRiskWindow,
        expiringSoonDays: normalizedWindow,
        expiringThisWeekDays: normalizedWindow
      });
      if (state.expiringThisWeek) {
        return true;
      }
    }
    return false;
  },
  ensureBulkRequirement() {
    if (!Array.isArray(this.requirements) || this.requirements.length === 0) {
      this.bulk.requirementId = '';
      return;
    }
    if (!this.bulk.requirementId || !this.requirements.some(req => req.id === this.bulk.requirementId)) {
      this.bulk.requirementId = this.requirements[0].id;
    }
  },
  selectedRequirementName() {
    const requirement = this.requirements.find(req => req.id === this.bulk.requirementId);
    return requirement ? requirement.name : 'Select a requirement';
  },
  syncSelectedEmployees() {
    if (!Array.isArray(this.selectedEmployees) || this.selectedEmployees.length === 0) {
      this.selectedEmployees = [];
      return;
    }
    const visibleIds = new Set(this.filteredEmployees.map(employee => employee.id));
    const next = this.selectedEmployees.filter(id => visibleIds.has(id));
    if (next.length !== this.selectedEmployees.length) {
      this.selectedEmployees = next;
    }
  },
  isEmployeeSelected(employeeId) {
    return this.selectedEmployees.includes(employeeId);
  },
  toggleEmployeeSelection(employeeId, checked) {
    if (checked) {
      if (!this.isEmployeeSelected(employeeId)) {
        this.selectedEmployees = [...this.selectedEmployees, employeeId];
      }
    } else if (this.isEmployeeSelected(employeeId)) {
      this.selectedEmployees = this.selectedEmployees.filter(id => id !== employeeId);
    }
  },
  toggleSelectAll(checked) {
    const visibleIds = this.filteredEmployees.map(employee => employee.id);
    if (checked) {
      const unique = new Set([...this.selectedEmployees, ...visibleIds]);
      this.selectedEmployees = Array.from(unique);
    } else if (visibleIds.length) {
      const visibleSet = new Set(visibleIds);
      this.selectedEmployees = this.selectedEmployees.filter(id => !visibleSet.has(id));
    }
  },
  areAllVisibleSelected() {
    if (!this.filteredEmployees.length) {
      return false;
    }
    return this.filteredEmployees.every(employee => this.isEmployeeSelected(employee.id));
  },
  hasSomeVisibleSelected() {
    if (!this.filteredEmployees.length) {
      return false;
    }
    return this.filteredEmployees.some(employee => this.isEmployeeSelected(employee.id));
  },
  clearSelectedEmployees() {
    if (!this.selectedEmployees.length) {
      return;
    }
    this.selectedEmployees = [];
    this.resetBulkForm({ preserveRequirement: true });
  },
  resetBulkForm(options = {}) {
    const { preserveRequirement = false } = options;
    if (!preserveRequirement) {
      this.ensureBulkRequirement();
    } else if (this.bulk.requirementId && !this.requirements.some(req => req.id === this.bulk.requirementId)) {
      this.ensureBulkRequirement();
    }
    this.bulk.action = '';
    this.bulk.date = '';
    this.bulk.reason = '';
  },
  bulkActionRequiresDate(action) {
    return action === 'complete' || action === 'set-expiry';
  },
  bulkActionRequiresReason(action) {
    return action === 'exempt';
  },
  bulkDateLabel() {
    if (this.bulk.action === 'complete') {
      return 'Completed on';
    }
    if (this.bulk.action === 'set-expiry') {
      return 'Expires on';
    }
    return 'Date';
  },
  bulkActionLabel(action) {
    switch (action) {
      case 'complete':
        return 'Mark complete';
      case 'set-expiry':
        return 'Set expiry';
      case 'exempt':
        return 'Mark exempt';
      case 'clear':
        return 'Clear progress';
      default:
        return 'Apply updates';
    }
  },
  bulkActionButtonLabel() {
    return this.bulkProcessing ? 'Applying…' : this.bulkActionLabel(this.bulk.action || 'apply');
  },
  bulkSelectionDetail() {
    const actionLabel = this.bulk.action ? this.bulkActionLabel(this.bulk.action) : 'Choose an action';
    return `${actionLabel} · ${this.selectedRequirementName()}`;
  },
  bulkActionDisabled() {
    if (this.bulkProcessing) {
      return true;
    }
    if (!this.selectedEmployees.length || !this.bulk.requirementId || !this.bulk.action) {
      return true;
    }
    if (this.bulkActionRequiresDate(this.bulk.action) && !this.bulk.date) {
      return true;
    }
    if (this.bulkActionRequiresReason(this.bulk.action)) {
      const reason = typeof this.bulk.reason === 'string' ? this.bulk.reason.trim() : '';
      if (!reason) {
        return true;
      }
    }
    return false;
  },
  onBulkActionChanged() {
    if (!this.bulkActionRequiresDate(this.bulk.action)) {
      this.bulk.date = '';
    }
    if (!this.bulkActionRequiresReason(this.bulk.action)) {
      this.bulk.reason = '';
    }
  },
  async runBulkUpdate() {
    if (this.bulkActionDisabled()) {
      return;
    }
    if (!this.db) {
      return;
    }
    const requirementId = this.bulk.requirementId;
    const requirement = this.requirements.find(req => req.id === requirementId);
    if (!requirement) {
      const store = this.$store?.app;
      store?.showToast?.({ type: 'error', message: 'Select a requirement before applying.' });
      return;
    }
    const employeeIds = [...this.selectedEmployees];
    if (!employeeIds.length) {
      return;
    }
    const action = this.bulk.action;
    const dateValue = this.bulkActionRequiresDate(action) ? this.bulk.date : '';
    const reason = this.bulkActionRequiresReason(action)
      ? (typeof this.bulk.reason === 'string' ? this.bulk.reason.trim() : '')
      : '';
    const timestamp = new Date().toISOString();
    const table = this.db.table('employeeRequirements');
    const updates = [];
    this.bulkProcessing = true;
    try {
      await this.db.transaction('rw', table, async () => {
        for (const employeeId of employeeIds) {
          const existing = this.getEmployeeRequirement(employeeId, requirementId);
          const baseRecord = existing
            ? { ...existing }
            : { id: generateId(), employeeId, requirementId, createdAt: timestamp };
          const nextRecord = this.buildBulkRequirementRecord(baseRecord, {
            action,
            dateValue,
            reason,
            timestamp
          });
          await table.put(nextRecord);
          updates.push(nextRecord);
        }
      });
    } catch (error) {
      console.error('Bulk update failed', error);
      const store = this.$store?.app;
      store?.showToast?.({ type: 'error', message: 'Bulk update failed. Please try again.' });
      this.bulkProcessing = false;
      return;
    }
    for (const record of updates) {
      this.setEmployeeRequirement(record);
    }
    if (updates.length) {
      const actionLabel = this.bulkActionLabel(action);
      const peopleLabel = updates.length === 1 ? 'employee' : 'employees';
      await this.recordActivity({
        type: 'requirement:bulk-update',
        summary: `${actionLabel} · ${requirement.name} (${updates.length} ${peopleLabel})`,
        details: {
          requirementId,
          requirementName: requirement.name,
          action,
          count: updates.length,
          date: dateValue || null,
          reason: reason || null,
          employeeIds
        }
      });
    }
    this.refreshAnalytics();
    this.applyFilters();
    const store = this.$store?.app;
    this.bulkProcessing = false;
    store?.showToast?.({ type: 'success', message: `${updates.length} updated` });
  },
  buildBulkRequirementRecord(baseRecord, context) {
    const { action, dateValue, reason, timestamp } = context;
    const next = { ...baseRecord, updatedAt: timestamp };
    if (!next.createdAt) {
      next.createdAt = timestamp;
    }
    const normalizedDate = dateValue ? dateValue : null;
    switch (action) {
      case 'complete':
        next.status = 'Completed';
        next.completedOn = normalizedDate;
        if (typeof next.expiresOn === 'undefined') {
          next.expiresOn = null;
        }
        next.notes = null;
        break;
      case 'set-expiry':
        if (!next.status) {
          next.status = 'Pending';
        }
        next.expiresOn = normalizedDate;
        break;
      case 'exempt':
        next.status = 'Exempt';
        next.completedOn = null;
        next.expiresOn = null;
        next.notes = reason || null;
        break;
      case 'clear':
        next.status = 'Pending';
        next.completedOn = null;
        next.expiresOn = null;
        next.notes = null;
        break;
      default:
        break;
    }
    if (action !== 'exempt' && action !== 'clear') {
      if (!reason) {
        next.notes = next.notes || null;
      }
    }
    return next;
  },
  buildRequirementKey(employeeId, requirementId) {
    return `${employeeId ?? ''}::${requirementId ?? ''}`;
  },
  mountInlineTemplate() {
    if (this.inlineTemplateMounted) return;
    const inlineTpl = document.getElementById('inline-edit-template');
    if (!inlineTpl) return;
    const host = document.createElement('div');
    host.style.display = 'contents';
    const templateContent = inlineTpl.content instanceof DocumentFragment ? inlineTpl.content : null;
    let cloned;

    if (templateContent && typeof templateContent.cloneNode === 'function') {
      cloned = templateContent.cloneNode(true);
    } else if (typeof inlineTpl.cloneNode === 'function') {
      cloned = inlineTpl.cloneNode(true);
    } else {
      console.warn('Inline edit template unavailable; skipping mount.');
      this.inlineTemplateMounted = true;
      return;
    }

    host.appendChild(cloned);
    inlineTpl.replaceWith(host);
    Alpine.initTree(host);
    this.inlineTemplateMounted = true;
  },
  initializeDarkMode() {
    const stored = localStorage.getItem(DARK_MODE_KEY);
    if (stored === 'dark') {
      this.darkMode = true;
      return;
    }
    if (stored === 'light') {
      this.darkMode = false;
      return;
    }
    this.darkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  },
  toggleDarkMode() {
    this.darkMode = !this.darkMode;
    localStorage.setItem(DARK_MODE_KEY, this.darkMode ? 'dark' : 'light');
  },
  updateStoreEmployees() {
    const appStore = this.$store?.app;
    if (!appStore) return;
    if (typeof appStore.setEmployees === 'function') {
      appStore.setEmployees(this.employees);
      return;
    }
    appStore.employees = Array.isArray(this.employees) ? this.employees : [];
  },
  updateStoreFilteredEmployees() {
    const appStore = this.$store?.app;
    if (!appStore) return;
    if (typeof appStore.setFilteredEmployees === 'function') {
      appStore.setFilteredEmployees(this.filteredEmployees);
      return;
    }
    appStore.filteredEmployees = Array.isArray(this.filteredEmployees) ? this.filteredEmployees : [];
  },
  buildExportRows(
    employees = this.filteredEmployees,
    requirements = this.requirements,
    employeeRequirements = this.employeeRequirements
  ) {
    const source = Array.isArray(employees) ? employees.filter(Boolean) : [];
    const requirementList = this.gridOrderedRequirements(requirements);
    const requirementMap = new Map();
    if (Array.isArray(employeeRequirements)) {
      for (const record of employeeRequirements) {
        if (!record) continue;
        const key = this.buildRequirementKey(record.employeeId, record.requirementId);
        requirementMap.set(key, record);
      }
    }
    return source.map(employee => {
      const firstName = normalizeString(employee?.firstName);
      const lastName = normalizeString(employee?.lastName);
      const combinedName = `${firstName} ${lastName}`.trim();
      const displayName = employee?.fullName || combinedName || 'Unnamed employee';
      const jobClass = normalizeString(employee?.jobClass);
      const jobTitle = normalizeString(employee?.jobTitle) || normalizeString(employee?.role);
      const ranking = normalizeString(employee?.ranking);
      const positionStatus = normalizeString(employee?.positionStatus) || normalizeString(employee?.status);
      const requirementEntries = requirementList.map(requirement => {
        const requirementId = requirement?.id ?? requirement?.key ?? null;
        const key = this.buildRequirementKey(employee?.id, requirementId);
        const record = requirementMap.get(key) || null;
        return {
          requirementId,
          requirementName: requirement?.name ?? '',
          status: normalizeStatus(record?.status || 'Pending'),
          completedOn: record?.completedOn || null,
          expiresOn: record?.expiresOn || null,
          notes: record?.notes ?? null
        };
      });
      return {
        employeeId: employee?.id ?? null,
        firstName,
        lastName,
        fullName: displayName,
        name: displayName,
        role: normalizeString(employee?.role),
        status: normalizeString(employee?.status),
        employmentType: normalizeString(employee?.employmentType),
        seniorityHours: employee?.seniorityHours ?? '',
        jobClass,
        jobTitle,
        ranking,
        positionStatus,
        compliancePercent: this.employeeCompliancePercent(employee?.id),
        requirements: requirementEntries
      };
    });
  },
  exportCSV() {
    const success = this.exporter?.exportFilteredCSV?.(
      this.filteredEmployees,
      this.requirements,
      this.employeeRequirements
    );
    if (success === false) {
      this.$store?.app?.showToast?.({ type: 'error', message: 'Unable to export CSV. Please try again.' });
    } else if (!this.exporter?.exportFilteredCSV) {
      this.$store?.app?.showToast?.({ type: 'error', message: 'CSV export is unavailable.' });
    }
    return success;
  },
  exportJSON() {
    const success = this.exporter?.exportFilteredJSON?.(
      this.filteredEmployees,
      this.requirements,
      this.employeeRequirements
    );
    if (success === false) {
      this.$store?.app?.showToast?.({ type: 'error', message: 'Unable to export JSON. Please try again.' });
    } else if (!this.exporter?.exportFilteredJSON) {
      this.$store?.app?.showToast?.({ type: 'error', message: 'JSON export is unavailable.' });
    }
    return success;
  },
  triggerExport(format) {
    const normalized = typeof format === 'string' ? format.toLowerCase() : '';
    if (normalized === 'csv') {
      this.exportCSV();
      return;
    }
    if (normalized === 'json') {
      this.exportJSON();
      return;
    }
    console.info(`Unsupported export format requested: ${normalized}`);
  },
  printReport() {
    if (typeof window?.print === 'function') {
      window.print();
    } else {
      console.info('Print requested');
    }
  },
  defaultFilters() {
    return { ...DEFAULT_FILTER_STATE };
  },
  normalizeFilters(source = {}) {
    const defaults = this.defaultFilters();
    const normalized = { ...defaults, ...(source && typeof source === 'object' ? source : {}) };
    normalized.roles = Array.isArray(normalized.roles)
      ? normalized.roles
          .map(role => (typeof role === 'string' ? role.trim() : role))
          .filter(role => typeof role === 'string' && role)
      : [];
    normalized.status = typeof normalized.status === 'string' && normalized.status
      ? normalized.status
      : defaults.status;
    normalized.compliance = typeof normalized.compliance === 'string' && normalized.compliance
      ? normalized.compliance
      : defaults.compliance;
    normalized.search = typeof normalized.search === 'string' ? normalized.search : defaults.search;
    normalized.expiringSoon = !!normalized.expiringSoon;
    normalized.analytics = normalized.analytics && typeof normalized.analytics === 'object'
      ? normalized.analytics
      : defaults.analytics;
    return normalized;
  },
  readSavedFilters() {
    if (typeof window === 'undefined' || !window.localStorage) {
      return {};
    }
    try {
      const raw = window.localStorage.getItem(FILTERS_STORAGE_KEY) || '{}';
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      console.warn('Failed to parse saved filters', error);
      return {};
    }
  },
  readFiltersFromUrl() {
    if (typeof window === 'undefined' || typeof window.location === 'undefined') {
      return {};
    }
    try {
      const params = new URLSearchParams(window.location.search || '');
      const raw = params.get(FILTERS_STORAGE_KEY);
      if (!raw) {
        return {};
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        return {};
      }
      const result = {};
      if (Array.isArray(parsed.roles)) {
        const roles = parsed.roles
          .map(role => (typeof role === 'string' ? role.trim() : role))
          .filter(role => typeof role === 'string' && role);
        if (roles.length) {
          result.roles = roles;
        }
      }
      if (typeof parsed.status === 'string' && parsed.status) {
        result.status = parsed.status;
      }
      if (typeof parsed.compliance === 'string' && parsed.compliance) {
        result.compliance = parsed.compliance;
      }
      if (typeof parsed.search === 'string') {
        result.search = parsed.search;
      }
      if (typeof parsed.expiringSoon !== 'undefined') {
        result.expiringSoon = !!parsed.expiringSoon;
      }
      if (parsed.analytics && typeof parsed.analytics === 'object') {
        const analyticsPayload = {};
        if (typeof parsed.analytics.type === 'string' && parsed.analytics.type) {
          analyticsPayload.type = parsed.analytics.type;
          if ('requirementId' in parsed.analytics) {
            const value = parsed.analytics.requirementId;
            if (value === null || typeof value === 'string') {
              analyticsPayload.requirementId = value;
            }
          }
          if (Number.isFinite(parsed.analytics.windowDays)) {
            analyticsPayload.windowDays = parsed.analytics.windowDays;
          }
        }
        if (Object.keys(analyticsPayload).length) {
          result.analytics = analyticsPayload;
        }
      }
      return result;
    } catch (error) {
      console.warn('Failed to parse filters from URL', error);
      return {};
    }
  },
  persistFilters(filters) {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      const payload = this.normalizeFilters(filters);
      window.localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn('Failed to persist filters', error);
    }
  },
  buildShareableFilters(filters) {
    const defaults = this.defaultFilters();
    const safe = this.normalizeFilters(filters);
    const payload = {};
    if (safe.roles.length) {
      payload.roles = safe.roles;
    }
    if (safe.status !== defaults.status) {
      payload.status = safe.status;
    }
    if (safe.compliance !== defaults.compliance) {
      payload.compliance = safe.compliance;
    }
    if (safe.expiringSoon) {
      payload.expiringSoon = true;
    }
    if (safe.search) {
      payload.search = safe.search;
    }
    if (safe.analytics && typeof safe.analytics === 'object' && safe.analytics.type) {
      const analyticsPayload = { type: safe.analytics.type };
      if ('requirementId' in safe.analytics) {
        const value = safe.analytics.requirementId;
        if (value === null || typeof value === 'string') {
          analyticsPayload.requirementId = value;
        }
      }
      if (Number.isFinite(safe.analytics.windowDays)) {
        analyticsPayload.windowDays = safe.analytics.windowDays;
      }
      if (Object.keys(analyticsPayload).length > 0) {
        payload.analytics = analyticsPayload;
      }
    }
    return payload;
  },
  updateUrlFilters(filters) {
    if (typeof window === 'undefined' || !window.history?.replaceState || !window.location) {
      return;
    }
    try {
      const params = new URLSearchParams(window.location.search || '');
      const payload = this.buildShareableFilters(filters);
      const hasPayload = Object.keys(payload).length > 0;
      if (!hasPayload) {
        if (!params.has(FILTERS_STORAGE_KEY)) {
          this._lastSerializedFilters = '';
          return;
        }
        params.delete(FILTERS_STORAGE_KEY);
        this._lastSerializedFilters = '';
      } else {
        const serialized = JSON.stringify(payload);
        if (params.get(FILTERS_STORAGE_KEY) === serialized && this._lastSerializedFilters === serialized) {
          return;
        }
        params.set(FILTERS_STORAGE_KEY, serialized);
        this._lastSerializedFilters = serialized;
      }
      const query = params.toString();
      const hash = window.location.hash || '';
      const newUrl = `${window.location.pathname}${query ? `?${query}` : ''}${hash}`;
      window.history.replaceState(null, '', newUrl);
    } catch (error) {
      console.warn('Failed to update filters in URL', error);
    }
  },
  buildFiltersShareUrl(filters = this.filters) {
    if (typeof window === 'undefined' || !window.location) {
      return '';
    }
    this.updateUrlFilters(filters);
    return window.location.href;
  },
  async copyFiltersLink() {
    const url = this.buildFiltersShareUrl();
    if (!url) {
      this.toast('Unable to copy link.', 'error');
      return;
    }
    let copied = false;
    try {
      if (typeof navigator !== 'undefined' && navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        copied = true;
      }
    } catch (error) {
      console.warn('Clipboard write failed', error);
    }
    if (!copied && typeof window?.prompt === 'function') {
      window.prompt('Copy this link to share your current filters:', url);
      copied = true;
    }
    if (copied) {
      this.toast('Link copied to clipboard.', 'success');
    } else {
      this.toast('Unable to copy link.', 'error');
    }
  },
  applyFilters() {
    const roleFilter = this.filters.roles.map(normalizeLower);
    const statusFilter = normalizeLower(this.filters.status);
    const complianceFilter = this.filters.compliance;
    const query = normalizeLower(this.filters.search);
    const expiring = !!this.filters.expiringSoon;
    const analyticsFilter = this.filters.analytics;
    this.filteredEmployees = this.employees.filter(employee => {
      const role = normalizeLower(employee.role);
      if (roleFilter.length && !roleFilter.includes(role)) return false;
      if (statusFilter && statusFilter !== 'all') {
        if (normalizeLower(employee.status) !== statusFilter) return false;
      }
      if (query) {
        const name = `${normalizeString(employee.firstName)} ${normalizeString(employee.lastName)}`.trim().toLowerCase();
        if (!name.includes(query)) return false;
      }
      if (expiring && !this.hasExpiringRequirement(employee.id)) return false;
      if (complianceFilter && complianceFilter !== 'all') {
        const pct = this.employeeCompliancePercent(employee.id);
        if (complianceFilter === 'high' && pct < 90) return false;
        if (complianceFilter === 'mid' && (pct < 70 || pct > 89)) return false;
        if (complianceFilter === 'low' && pct >= 70) return false;
      }
      if (analyticsFilter) {
        if (analyticsFilter.type === 'requirement-risk') {
          if (!this.employeeHasRequirementRisk(employee.id, analyticsFilter.requirementId)) {
            return false;
          }
        } else if (analyticsFilter.type === 'expiring-week') {
          const windowDays = normalizeWindowDays(
            analyticsFilter.windowDays,
            normalizeWindowDays(
              this.analyticsConfig.expiringThisWeekDays,
              ANALYTICS_EXPIRING_WINDOW_DAYS
            )
          );
          if (
            !this.employeeHasExpiringWithinWindow(
              employee.id,
              analyticsFilter.requirementId || null,
              windowDays
            )
          ) {
            return false;
          }
        }
      }
      return true;
    });
    this.updateStoreFilteredEmployees();
    this.syncSelectedEmployees();
  },
  resetFilters() {
    this.filters.roles = [];
    this.filters.status = 'all';
    this.filters.compliance = 'all';
    this.filters.expiringSoon = false;
    this.filters.search = '';
    this.filters.analytics = null;
    this.applyFilters();
  },
  employeeById(id) {
    if (!id) return null;
    return this.employees.find(emp => emp && emp.id === id) || null;
  },
  requirementById(id) {
    if (!id) return null;
    return this.requirements.find(req => req && req.id === id) || null;
  },
  requirementBadgeClass(cell) {
    const status = normalizeStatus(cell?.status || '');
    if (this.cellExpired(cell)) {
      return 'badge badge-rose';
    }
    if (status === 'Completed' && this.cellWarn(cell)) {
      return 'badge badge-amber';
    }
    if (status === 'Completed') {
      return 'badge badge-green';
    }
    return 'badge badge-slate';
  },
  profileEmployee() {
    return this.employeeById(this.profilePanel.employeeId);
  },
  profileEmployeeName() {
    const employee = this.profileEmployee();
    if (!employee) return 'Employee details';
    const first = normalizeString(employee.firstName);
    const last = normalizeString(employee.lastName);
    const fullName = `${first} ${last}`.trim();
    return fullName || employee.fullName || 'Employee details';
  },
  profileEmployeeInitials() {
    const employee = this.profileEmployee();
    if (!employee) return '';
    const first = normalizeString(employee.firstName);
    const last = normalizeString(employee.lastName);
    const initials = `${first.charAt(0)}${last.charAt(0)}`.trim();
    if (initials) {
      return initials.toUpperCase();
    }
    if (employee.fullName) {
      return employee.fullName.slice(0, 2).toUpperCase();
    }
    return '';
  },
  profileEmployeeMeta() {
    const employee = this.profileEmployee();
    if (!employee) return '';
    const role = employee.jobTitle || employee.role || '—';
    const status = employee.status || employee.positionStatus || '—';
    return `${role} • ${status}`;
  },
  profileEmployeeRole() {
    const employee = this.profileEmployee();
    if (!employee) return '—';
    return employee.jobTitle || employee.role || '—';
  },
  profileEmployeeStatus() {
    const employee = this.profileEmployee();
    if (!employee) return '—';
    return employee.status || employee.positionStatus || '—';
  },
  profileEmployeeEmploymentType() {
    const employee = this.profileEmployee();
    if (!employee) return '—';
    return employee.employmentType || '—';
  },
  profileEmployeeSeniority() {
    const employee = this.profileEmployee();
    if (!employee) return '—';
    return this.gridInfoCellText(employee, 'seniorityHours');
  },
  profileInfoRows() {
    const employee = this.profileEmployee();
    if (!employee) {
      return [];
    }
    return [
      { key: 'name', label: 'Name', value: this.profileEmployeeName() },
      {
        key: 'seniorityHours',
        label: 'Seniority Hours',
        value: this.gridInfoCellText(employee, 'seniorityHours')
      },
      {
        key: 'jobClass',
        label: 'Job Class',
        value: employee.jobClass ? String(employee.jobClass).trim() : '—'
      },
      {
        key: 'jobTitle',
        label: 'Job Title',
        value: employee.jobTitle || employee.role || '—'
      },
      {
        key: 'ranking',
        label: 'Ranking',
        value: employee.ranking ? String(employee.ranking).trim() : '—'
      },
      {
        key: 'positionStatus',
        label: 'Position Status',
        value: employee.positionStatus || employee.status || '—'
      }
    ];
  },
  profileCompliancePercent() {
    if (!this.profilePanel.employeeId) return 0;
    return this.employeeCompliancePercent(this.profilePanel.employeeId);
  },
  profileComplianceDash() {
    const percent = this.profileCompliancePercent();
    const safe = Math.max(0, Math.min(100, Number(percent) || 0));
    const dash = (safe / 100) * 62.83;
    return `${dash.toFixed(2)} 62.83`;
  },
  profileComplianceStrokeClass() {
    const percent = this.profileCompliancePercent();
    const safe = Math.max(0, Math.min(100, Number(percent) || 0));
    if (safe >= 90) return 'stroke-emerald-500';
    if (safe >= 70) return 'stroke-amber-500';
    return 'stroke-rose-500';
  },
  profileEmployeeHasRisk() {
    if (!this.profilePanel.employeeId) return false;
    return this.employeeHasRequirementRisk(this.profilePanel.employeeId);
  },
  profileEmployeeHasExpiring() {
    if (!this.profilePanel.employeeId) return false;
    return this.employeeHasExpiringWithinWindow(this.profilePanel.employeeId);
  },
  profileAttentionSummary() {
    if (!this.profilePanel.employeeId) {
      return 'No alerts.';
    }
    const hasRisk = this.profileEmployeeHasRisk();
    const hasExpiring = this.profileEmployeeHasExpiring();
    if (hasRisk && hasExpiring) {
      return 'Requirements are overdue and expiring soon.';
    }
    if (hasRisk) {
      return 'One or more requirements are overdue.';
    }
    if (hasExpiring) {
      return 'Upcoming deadlines within 30 days.';
    }
    return 'All assignments are on track.';
  },
  profileRequirementStatusLabel(cell) {
    const status = normalizeStatus(cell?.status || 'Pending');
    if (status === 'Exempt') {
      return 'Exempt';
    }
    if (this.cellExpired(cell)) {
      return 'Expired';
    }
    if (status === 'Completed' && this.cellWarn(cell)) {
      return 'Due soon';
    }
    if (status === 'Completed') {
      return 'Completed';
    }
    return 'Pending';
  },
  profileAssignments() {
    if (!this.profilePanel.employeeId) {
      return [];
    }
    const employeeId = this.profilePanel.employeeId;
    const assignments = [];
    const requirements = this.gridOrderedRequirements();
    requirements.forEach((requirement, index) => {
      if (!requirement) return;
      const cell = this.getRequirementCell(employeeId, requirement.id);
      const keyBase = requirement.id ?? requirement.key ?? requirement.name ?? index;
      const completedOn = cell.completedAt ? this.formatDate(cell.completedAt) : '';
      const expiresOn = cell.expiresAt ? this.formatDate(cell.expiresAt) : '';
      assignments.push({
        key: `req-${String(keyBase)}-${index}`,
        name: requirement.name || 'Requirement',
        badgeClass: this.requirementBadgeClass(cell),
        badgeLabel: this.chipText(cell),
        subtext: this.cellSubtext(cell),
        statusLabel: this.profileRequirementStatusLabel(cell),
        completedOn: completedOn || '—',
        expiresOn: expiresOn || '—'
      });
    });
    return assignments;
  },
  profileFormDefaults() {
    return {
      name: '',
      seniorityHours: '',
      jobClass: '',
      jobTitle: '',
      ranking: '',
      positionStatus: ''
    };
  },
  buildProfileForm(employee) {
    if (!employee) {
      return this.profileFormDefaults();
    }
    const first = normalizeString(employee.firstName);
    const last = normalizeString(employee.lastName);
    const fullName = `${first} ${last}`.trim() || normalizeString(employee.fullName);
    let seniority = '';
    if (typeof employee.seniorityHours === 'number') {
      seniority = Number.isFinite(employee.seniorityHours)
        ? String(employee.seniorityHours)
        : '';
    } else if (typeof employee.seniorityHours === 'string') {
      seniority = employee.seniorityHours.trim();
    }
    return {
      name: fullName,
      seniorityHours: seniority,
      jobClass: employee.jobClass ? String(employee.jobClass).trim() : '',
      jobTitle: employee.jobTitle ? String(employee.jobTitle).trim() : employee.role || '',
      ranking: employee.ranking ? String(employee.ranking).trim() : '',
      positionStatus: employee.positionStatus
        ? String(employee.positionStatus).trim()
        : employee.status
          ? String(employee.status).trim()
          : ''
    };
  },
  resetProfileForm(employee = null) {
    const source = employee || this.profileEmployee();
    this.profilePanel.form = this.buildProfileForm(source);
    this.profilePanel.editing = false;
    this.profilePanel.saving = false;
    this.profilePanel.error = '';
  },
  startProfileEdit() {
    const employee = this.profileEmployee();
    if (!employee) {
      this.profilePanel.error = 'Employee not found.';
      return;
    }
    this.profilePanel.form = this.buildProfileForm(employee);
    this.profilePanel.editing = true;
    this.profilePanel.error = '';
    this.$nextTick(() => {
      const node = document.querySelector('#employee-profile-root [data-profile-autofocus]');
      if (node && typeof node.focus === 'function') {
        node.focus();
      }
    });
  },
  cancelProfileEdit() {
    const employee = this.profileEmployee();
    this.profilePanel.form = this.buildProfileForm(employee);
    this.profilePanel.editing = false;
    this.profilePanel.saving = false;
    this.profilePanel.error = '';
  },
  normalizeProfileSeniorityInput(value) {
    if (value === null || typeof value === 'undefined') {
      return '';
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : '';
    }
    const stringValue = String(value).trim();
    if (!stringValue) {
      return '';
    }
    const numeric = Number(stringValue.replace(/,/g, ''));
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    return stringValue;
  },
  profileFormIsUnchanged(form, employee) {
    if (!employee) {
      return false;
    }
    const baseline = this.buildProfileForm(employee);
    const keys = ['name', 'seniorityHours', 'jobClass', 'jobTitle', 'ranking', 'positionStatus'];
    return keys.every(key => normalizeString(form?.[key]) === normalizeString(baseline[key]));
  },
  async saveProfileChanges() {
    if (!this.profilePanel.editing || this.profilePanel.saving) {
      return;
    }
    const employee = this.profileEmployee();
    if (!employee) {
      this.profilePanel.error = 'Employee not found.';
      return;
    }
    const form = this.profilePanel.form || {};
    if (this.profileFormIsUnchanged(form, employee)) {
      this.profilePanel.editing = false;
      this.profilePanel.error = '';
      return;
    }
    const fullName = normalizeString(form.name);
    if (!fullName) {
      this.profilePanel.error = 'Name is required.';
      return;
    }
    const { firstName, lastName } = splitFullName(form.name, employee);
    const seniorityHours = this.normalizeProfileSeniorityInput(form.seniorityHours);
    const jobClass = typeof form.jobClass === 'string' ? form.jobClass.trim() : '';
    const jobTitle = typeof form.jobTitle === 'string' ? form.jobTitle.trim() : '';
    const ranking = typeof form.ranking === 'string' ? form.ranking.trim() : '';
    const positionInput = typeof form.positionStatus === 'string' ? form.positionStatus.trim() : '';
    const normalizedPositionStatus = mapPositionStatus(positionInput) || positionInput;
    const updates = {
      firstName,
      lastName,
      fullName,
      seniorityHours,
      jobClass,
      jobTitle,
      ranking,
      positionStatus: normalizedPositionStatus,
      updatedAt: new Date().toISOString()
    };
    const syncPayload = {
      id: employee.id,
      firstName,
      lastName,
      fullName,
      seniorityHours,
      jobClass,
      jobTitle,
      ranking,
      positionStatus: normalizedPositionStatus
    };
    const compareKeys = ['firstName', 'lastName', 'seniorityHours', 'jobClass', 'jobTitle', 'ranking', 'positionStatus'];
    const diff = {};
    const comparableValue = value => {
      if (value === null || typeof value === 'undefined') return '';
      if (typeof value === 'number') {
        return Number.isFinite(value) ? value : '';
      }
      return String(value);
    };
    compareKeys.forEach(key => {
      if (comparableValue(employee[key]) !== comparableValue(updates[key])) {
        diff[key] = {
          before: employee[key] ?? '',
          after: updates[key]
        };
      }
    });
    this.profilePanel.saving = true;
    try {
      const employeesTable = this.db?.table ? this.db.table('employees') : null;
      if (employeesTable) {
        await employeesTable.update(employee.id, updates);
      }
      const index = this.employees.findIndex(emp => emp && emp.id === employee.id);
      const updatedEmployee = { ...employee, ...updates };
      if (index !== -1) {
        this.employees.splice(index, 1, updatedEmployee);
      }
      this.employees.sort((a, b) => {
        const lastCompare = normalizeLower(a?.lastName).localeCompare(normalizeLower(b?.lastName));
        if (lastCompare !== 0) return lastCompare;
        return normalizeLower(a?.firstName).localeCompare(normalizeLower(b?.firstName));
      });
      this.updateStoreEmployees();
      this.refreshEmployeeLookups();
      this.applyFilters();
      this.profilePanel.form = this.buildProfileForm(updatedEmployee);
      this.profilePanel.editing = false;
      this.profilePanel.error = '';
      await this.syncEmployeeProfileUpdate(employee.id, syncPayload);
      if (Object.keys(diff).length) {
        const summaryName = `${normalizeString(updates.firstName)} ${normalizeString(updates.lastName)}`.trim()
          || updates.fullName
          || employee.fullName
          || 'Employee';
        await this.recordActivity({
          type: 'employee:update',
          summary: `Updated profile for ${summaryName}`,
          details: { employeeId: employee.id, changes: diff }
        });
      }
      this.toast('Employee profile updated', 'success');
    } catch (error) {
      console.error('Failed to update employee profile', error);
      this.profilePanel.error = 'Unable to save changes. Please try again.';
    } finally {
      this.profilePanel.saving = false;
    }
  },
  async syncEmployeeProfileUpdate(employeeId, payload) {
    if (typeof window === 'undefined') {
      return;
    }
    const flags = window.APP_FLAGS || {};
    const flagValue =
      typeof flags.SUPABASE_SYNC !== 'undefined'
        ? flags.SUPABASE_SYNC
        : flags.SUPABASE_SYNC_ENABLED;
    const syncClient = window.SupabaseSync || window.supabaseSync || window.SUPABASE_SYNC;
    if (!syncClient) {
      return;
    }
    if (flagValue === false) {
      return;
    }
    try {
      if (typeof syncClient.updateEmployee === 'function') {
        await syncClient.updateEmployee(employeeId, payload);
        return;
      }
      if (typeof syncClient.upsertEmployee === 'function') {
        await syncClient.upsertEmployee(payload);
      }
    } catch (error) {
      console.error('Supabase sync failed', error);
    }
  },
  async toggleRequirement(empId, reqId, checked) {
    if (!this.db) return;
    const table = this.db.employeeRequirements;
    if (!table) return;
    const row = await table.where({ employeeId: empId, requirementId: reqId }).first();
    if (!row) return;
    const timestamp = new Date().toISOString();
    row.status = checked ? 'Completed' : 'Pending';
    if (checked) {
      if (!row.completedAt) {
        row.completedAt = timestamp;
      }
      if (!row.completedOn) {
        row.completedOn = timestamp;
      }
    } else {
      row.completedAt = null;
      row.completedOn = null;
    }
    row.updatedAt = timestamp;
    await table.put(row);
    this.setEmployeeRequirement(row);
    this.refreshAnalytics();
    this.applyFilters();
    await this.loadData();
    this.applyFilters();
    const requirement = this.requirementById(reqId);
    const employee = this.employees.find(emp => emp.id === empId);
    const employeeName = employee
      ? `${normalizeString(employee.firstName)} ${normalizeString(employee.lastName)}`.trim() || 'Employee'
      : 'Employee';
    const requirementName = requirement?.name || 'Requirement';
    await this.recordActivity({
      type: 'requirement:status',
      summary: `${checked ? 'Completed' : 'Cleared'} ${requirementName} for ${employeeName}`,
      details: {
        employeeId: empId,
        requirementId: reqId,
        status: row.status,
        completedOn: row.completedOn || null,
        expiresOn: row.expiresOn || null
      }
    });
  },
  getEmployeeRequirement(employeeId, requirementId) {
    return this.employeeRequirementMap.get(this.buildRequirementKey(employeeId, requirementId)) || null;
  },
  getRequirementCell(employeeId, requirementId) {
    const record = this.getEmployeeRequirement(employeeId, requirementId);
    const status = normalizeStatus(record?.status || 'Pending');
    return {
      employeeId,
      requirementId,
      status,
      completedAt: record?.completedOn || null,
      expiresAt: record?.expiresOn || null,
      raw: record || null
    };
  },
  cellExpired(cell) {
    const expiresAt = cell?.expiresAt ?? cell?.expiresOn ?? cell?.raw?.expiresOn;
    if (!expiresAt) return false;
    const expiresOn = new Date(expiresAt);
    if (Number.isNaN(expiresOn.getTime())) return false;
    return expiresOn < new Date();
  },
  cellWarn(cell) {
    const expiresAt = cell?.expiresAt ?? cell?.expiresOn ?? cell?.raw?.expiresOn;
    if (!expiresAt) return false;
    const expiresOn = new Date(expiresAt);
    if (Number.isNaN(expiresOn.getTime())) return false;
    const d = (expiresOn.getTime() - Date.now()) / 86400000;
    return d >= 0 && d <= 30;
  },
  chipText(cell) {
    const status = normalizeStatus(cell?.status);
    if (status === 'Exempt') return '◎ Exempt';
    if (this.cellExpired(cell)) return '✖ Expired';
    if (status === 'Completed' && this.cellWarn(cell)) return '⚠ Due soon';
    if (status === 'Completed') return '✔ Complete';
    return '○ Pending';
  },
  requirementExpired(record) {
    if (!record) return false;
    return this.cellExpired({ expiresAt: record.expiresOn, raw: record });
  },
  isRequirementExpiring(record, thresholdDays = 30) {
    if (!record || !record.expiresOn) return false;
    if (thresholdDays === 30) {
      return this.cellWarn({ expiresAt: record.expiresOn });
    }
    const expiresOn = new Date(record.expiresOn);
    if (Number.isNaN(expiresOn.getTime())) return false;
    const diff = (expiresOn.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= thresholdDays;
  },
  hasExpiringRequirement(employeeId) {
    return this.requirements.some(req => this.cellWarn(this.getRequirementCell(employeeId, req.id)));
  },
  employeeCompliancePercent(employeeId) {
    if (!this.requirements.length) return 0;
    let completed = 0;
    for (const requirement of this.requirements) {
      const record = this.getEmployeeRequirement(employeeId, requirement.id);
      if (!record) continue;
      const status = normalizeStatus(record.status);
      if (status === 'Completed' || status === 'Exempt') {
        completed += 1;
      }
    }
    return Math.round((completed / this.requirements.length) * 100);
  },
  cellSubtext(cell) {
    if (!cell?.raw) return 'Not started';
    const status = normalizeStatus(cell.status);
    if (status === 'Completed' && cell.completedAt) {
      return `Done ${this.formatDate(cell.completedAt)}`;
    }
    if (status === 'Exempt') {
      return 'Exempt';
    }
    if (cell.expiresAt) {
      const label = this.cellExpired(cell) ? 'Expired' : 'Expires';
      return `${label} ${this.formatDate(cell.expiresAt)}`;
    }
    return 'Pending';
  },
  formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  },
  progressRingDash(percent) {
    const safe = Math.max(0, Math.min(100, Number(percent) || 0));
    const dash = (safe / 100) * RING_CIRCUMFERENCE;
    return `${dash} ${RING_CIRCUMFERENCE - dash}`;
  },
  progressStrokeClass(percent) {
    if (percent >= 90) return 'ring-complete';
    if (percent >= 70) return 'ring-good';
    if (percent >= 40) return 'ring-warn';
    return 'ring-alert';
  },
  computePopoverStyle(target) {
    if (!target) return '';
    const rect = target.getBoundingClientRect();
    const width = 320;
    const offset = 12;
    let left = rect.left + window.scrollX;
    const viewportRight = window.scrollX + window.innerWidth;
    if (left + width > viewportRight - 16) {
      left = Math.max(16, viewportRight - width - 16);
    }
    const top = rect.bottom + window.scrollY + offset;
    return `top:${top}px;left:${left}px;width:${width}px`;
  },
  openEditor(event, employeeId, requirementId) {
    const record = this.getEmployeeRequirement(employeeId, requirementId);
    this.editorForm.status = normalizeStatus(record?.status || 'Pending');
    this.editorForm.completedOn = normalizeDateInputValue(record?.completedOn);
    this.editorForm.expiresOn = normalizeDateInputValue(record?.expiresOn);
    this.activeEditor.employeeId = employeeId;
    this.activeEditor.requirementId = requirementId;
    const currentTarget = event?.currentTarget || null;
    const anchor = currentTarget?.classList?.contains?.('badge')
      ? currentTarget
      : currentTarget?.querySelector?.('.badge') || currentTarget;
    this.activeEditor.style = this.computePopoverStyle(anchor);
    this.activeEditor.open = true;
    this.$nextTick(() => {
      const node = document.querySelector('#inline-editor [data-autofocus]');
      if (node && typeof node.focus === 'function') {
        node.focus();
      }
    });
  },
  closeEditor() {
    this.activeEditor.open = false;
    this.activeEditor.employeeId = null;
    this.activeEditor.requirementId = null;
  },
  editorTitle() {
    const employee = this.employees.find(emp => emp.id === this.activeEditor.employeeId);
    const requirement = this.requirements.find(req => req.id === this.activeEditor.requirementId);
    if (!employee || !requirement) return 'Update requirement';
    const name = `${normalizeString(employee.firstName)} ${normalizeString(employee.lastName)}`.trim();
    return `${requirement.name} · ${name || 'Employee'}`;
  },
  async saveActiveEditor() {
    if (!this.activeEditor.open || !this.db) return;
    const { employeeId, requirementId } = this.activeEditor;
    const table = this.db.table('employeeRequirements');
    const existing = this.getEmployeeRequirement(employeeId, requirementId);
    const payload = {
      employeeId,
      requirementId,
      status: this.editorForm.status,
      completedOn: this.editorForm.completedOn || null,
      expiresOn: this.editorForm.expiresOn || null,
      updatedAt: new Date().toISOString()
    };
    if (existing && existing.id) {
      payload.id = existing.id;
      payload.createdAt = existing.createdAt;
      await table.put({ ...existing, ...payload });
    } else {
      payload.id = generateId();
      payload.createdAt = new Date().toISOString();
      await table.put(payload);
    }
    const employee = this.employees.find(emp => emp.id === employeeId);
    const requirement = this.requirements.find(req => req.id === requirementId);
    const employeeName = `${normalizeString(employee?.firstName)} ${normalizeString(employee?.lastName)}`.trim() || 'Employee';
    const requirementName = requirement?.name || 'Requirement';
    const statusLabel = normalizeStatus(payload.status);
    await this.recordActivity({
      type: 'requirement:edit',
      summary: `${requirementName} updated for ${employeeName} (${statusLabel})`,
      details: {
        requirementId,
        status: statusLabel,
        completedOn: payload.completedOn,
        expiresOn: payload.expiresOn,
        employeeId
      }
    });
    this.setEmployeeRequirement(payload);
    this.refreshAnalytics();
    this.closeEditor();
    this.applyFilters();
  },
  setEmployeeRequirement(record) {
    if (!record) return;
    const key = this.buildRequirementKey(record.employeeId, record.requirementId);
    const current = this.employeeRequirements.find(item => item && item.id === record.id);
    if (current) {
      Object.assign(current, record);
    } else {
      this.employeeRequirements.push({ ...record });
    }
    this.employeeRequirementMap.set(key, { ...(this.employeeRequirementMap.get(key) || {}), ...record });
  }
});

function bootApp() {
  if (typeof window === 'undefined') {
    return;
  }

  const existingAppStore = typeof window.AppStore === 'function' ? window.AppStore() : null;
  appStore = existingAppStore && typeof existingAppStore === 'object' ? existingAppStore : createAppStore();
  Alpine.store('app', appStore);
  window.AppStore = function AppStore() {
    return appStore;
  };

  if (window.APP_FLAGS?.USE_V2_MAIN) {
    replaceTemplate('inline-edit-template', inlineEditTemplate);
  }

  window.Alpine = Alpine;

  registerV2Component('v2DashboardApp', v2DashboardAppDefinition);

  Alpine.start();
}

try {
  bootApp();
  if (typeof window !== 'undefined') {
    window.AppBootOk = true;
  }
} catch (error) {
  console.error('App boot failed:', error);
  if (typeof window !== 'undefined') {
    window.AppBootOk = false;
    window.AppStore = function AppStore() {
      return null;
    };

    const el = typeof document !== 'undefined' ? document.getElementById('app-v2') || document.body : null;
    if (el) {
      el.innerHTML = `<div style="padding:16px;font-family:system-ui">
    <h2>App failed to start</h2>
    <pre style="white-space:pre-wrap;background:#f6f8fa;padding:12px;border-radius:8px">${(error.stack || error.message || error)}</pre>
  </div>`;
    }
  }
}
