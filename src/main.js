import './polyfills/async-function-call.js';
import Alpine from 'alpinejs';
import { qs } from './utils/dom.js';
import miniAnalyticsTemplate from './v2/mini-analytics.html?raw';
import requirementsGridTemplate from './v2/requirements-grid.html?raw';
import importDrawerTemplate from './v2/import-drawer.html?raw';
import addEmployeeModalTemplate from './v2/add-employee-modal.html?raw';
import bulkActionsTemplate from './v2/bulk-actions.html?raw';
import activityTimelineTemplate from './v2/activity-timeline.html?raw';
const inlineEditTemplate = `
<template>
  <div class="inline-overlay" x-show="activeEditor.open" x-transition.opacity @click="closeEditor" aria-hidden="true"></div>
  <div
    class="inline-panel"
    x-show="activeEditor.open"
    x-transition
    :style="activeEditor.style"
    role="dialog"
    aria-modal="true"
    :aria-label="editorTitle()"
    @keydown.escape.window.stop.prevent="closeEditor"
    @click.outside="closeEditor"
  >
    <form class="inline-form" @submit.prevent="saveActiveEditor">
      <header class="inline-header">
        <h2 class="inline-title" x-text="editorTitle()"></h2>
      </header>
      <div class="inline-body">
        <label class="inline-field">
          <span>Status</span>
          <select class="input" x-ref="editorStatus" x-model="editorForm.status">
            <template x-for="status in editorStatusOptions" :key="status">
              <option :value="status" x-text="status"></option>
            </template>
          </select>
        </label>
        <label class="inline-field">
          <span>Completed on</span>
          <input type="date" class="input" x-model="editorForm.completedOn" />
        </label>
        <label class="inline-field">
          <span>Expires on</span>
          <input type="date" class="input" x-model="editorForm.expiresOn" />
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
import { openDatabase, generateId } from '../db.js';
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

const DEFAULT_APP_FLAGS = { USE_V2_MAIN: true };
const USE_V2_STORAGE_KEY = 'USE_V2_MAIN';
const V2_COMPONENT_REGISTRY_KEY = '__V2_ALPINE_COMPONENTS__';
const ACTIVITY_TIMELINE_LIMIT = 100;

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

function formatActivityTimestamp(date) {
  try {
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  } catch (error) {
    console.warn('Failed to format activity timestamp', error);
    return date.toISOString();
  }
}

function createActivityTimelineStore() {
  return {
    items: [],
    record(entry) {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      let timestamp = null;
      if (typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp)) {
        timestamp = entry.timestamp;
      } else if (typeof entry.timestamp === 'string') {
        const parsed = Date.parse(entry.timestamp);
        if (Number.isFinite(parsed)) {
          timestamp = parsed;
        }
      }

      const date = new Date(Number.isFinite(timestamp) ? timestamp : Date.now());
      if (Number.isNaN(date.getTime())) {
        date.setTime(Date.now());
      }

      const type = (entry.type || entry.actionType || 'Activity').toString();
      const summary = typeof entry.summary === 'string' && entry.summary.trim()
        ? entry.summary.trim()
        : type;
      const normalized = {
        id: entry.id || entry.key || generateId(),
        actionType: entry.actionType || null,
        type,
        summary,
        timestamp: date.getTime(),
        timestampIso: date.toISOString(),
        timeLabel: formatActivityTimestamp(date),
        metadata: entry.metadata || null,
        targets: entry.targets || null
      };

      const nextItems = (Array.isArray(this.items) ? this.items : []).filter(item => item && item.id !== normalized.id);
      nextItems.unshift(normalized);
      if (nextItems.length > ACTIVITY_TIMELINE_LIMIT) {
        nextItems.length = ACTIVITY_TIMELINE_LIMIT;
      }
      this.items = nextItems;
      return normalized;
    }
  };
}
const existingFlags = typeof window.APP_FLAGS === 'object' && window.APP_FLAGS !== null ? window.APP_FLAGS : {};
const appFlagsTarget = { ...DEFAULT_APP_FLAGS, ...existingFlags };

if (typeof window !== 'undefined') {
  try {
    const storedValue = window.localStorage?.getItem(USE_V2_STORAGE_KEY);
    if (storedValue === 'false') {
      appFlagsTarget.USE_V2_MAIN = false;
    } else if (storedValue === 'true') {
      appFlagsTarget.USE_V2_MAIN = true;
    }
  } catch (error) {
    console.warn('Failed to read USE_V2_MAIN override from localStorage.', error);
  }
}

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

function toggleUseV2MainFlag() {
  const nextValue = !(window.APP_FLAGS?.USE_V2_MAIN ?? DEFAULT_APP_FLAGS.USE_V2_MAIN);
  try {
    window.localStorage?.setItem(USE_V2_STORAGE_KEY, String(nextValue));
  } catch (error) {
    console.warn('Failed to persist USE_V2_MAIN flag to localStorage.', error);
  }
  window.APP_FLAGS.USE_V2_MAIN = nextValue;
  window.location.reload();
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

document.addEventListener('keydown', event => {
  if (!event.ctrlKey || !event.altKey) {
    return;
  }

  const key = event.key?.toLowerCase();
  if (key !== 'v') {
    return;
  }

  if (isTextInput(event.target)) {
    return;
  }

  event.preventDefault();
  toggleUseV2MainFlag();
});

function createAppStore() {
  const store = {
    APP_FLAGS: { ...window.APP_FLAGS },
    showImportModal: false,
    showAddEmployeeModal: false,
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

if (typeof window !== 'undefined') {
  try {
    const existingAppStore = typeof window.AppStore === 'function' ? window.AppStore() : null;
    appStore = existingAppStore && typeof existingAppStore === 'object' ? existingAppStore : createAppStore();
    Alpine.store('app', appStore);
    window.AppStore = function AppStore() {
      return appStore;
    };
    window.AppBootOk = true;
  } catch (error) {
    console.error('App boot failed:', error);
    window.AppBootOk = false;
    window.AppStore = function AppStore() {
      return null;
    };

    if (typeof document !== 'undefined') {
      const el = document.getElementById('app-v2') || document.body;
      if (el) {
        el.innerHTML = `<div style="padding:16px;font-family:system-ui">
    <h2>App failed to start</h2>
    <pre style="white-space:pre-wrap;background:#f6f8fa;padding:12px;border-radius:8px">${(error.stack || error.message || error)}</pre>
  </div>`;
      }
    }
  }
}

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

if (window.APP_FLAGS.USE_V2_MAIN) {
  replaceTemplate('inline-edit-template', inlineEditTemplate);
}

function normalizeString(value) {
  return (value ?? '').toString().trim();
}

function normalizeLower(value) {
  return normalizeString(value).toLowerCase();
}

window.Alpine = Alpine;

const activityTimelineStore = createActivityTimelineStore();
Alpine.store('activityLog', activityTimelineStore);

registerV2Component('v2DashboardApp', () => ({
  db: null,
  activityLog: null,
  partials: {
    miniAnalytics: '',
    requirementsGrid: '',
    importDrawer: '',
    addEmployeeModal: '',
    bulkActions: '',
    activityTimeline: ''
  },
  inlineTemplateMounted: false,
  loading: true,
  loadError: null,
  darkMode: false,
  showExportMenu: false,
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
    expiringSoonDays: ANALYTICS_EXPIRING_WINDOW_DAYS
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
  filters: {
    roles: [],
    status: 'all',
    compliance: 'all',
    expiringSoon: false,
    search: '',
    analytics: null
  },
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
  activeEditor: {
    open: false,
    employeeId: null,
    requirementId: null,
    style: ''
  },
  editorForm: {
    status: 'Pending',
    completedOn: '',
    expiresOn: ''
  },
  importDrawer: {
    open: false,
    file: null,
    fileName: '',
    dryRunLoading: false,
    commitLoading: false,
    summary: null,
    mapping: null,
    previewRows: [],
    previewColumns: [],
    previewTotal: 0,
    error: '',
    commitDisabled: true
  },
  init() {
    if (!window.APP_FLAGS?.USE_V2_MAIN) {
      console.info('Legacy dashboard active; skipping v2 bootstrap.');
      return;
    }
    const savedFilters = (() => {
      try {
        return JSON.parse(localStorage.getItem('filters') || '{}') || {};
      } catch (error) {
        console.warn('Failed to parse saved filters', error);
        return {};
      }
    })();
    const defaultFilters = {
      roles: [],
      status: 'all',
      compliance: 'all',
      expiringSoon: false,
      search: '',
      analytics: null
    };
    const normalizedFilters = {
      ...defaultFilters,
      ...savedFilters
    };
    if (!Array.isArray(normalizedFilters.roles)) {
      normalizedFilters.roles = [];
    }
    if (typeof normalizedFilters.status !== 'string') {
      normalizedFilters.status = defaultFilters.status;
    }
    if (typeof normalizedFilters.compliance !== 'string') {
      normalizedFilters.compliance = defaultFilters.compliance;
    }
    if (typeof normalizedFilters.search !== 'string') {
      normalizedFilters.search = defaultFilters.search;
    }
    normalizedFilters.expiringSoon = !!normalizedFilters.expiringSoon;
    this.filters = normalizedFilters;
    this.$watch(
      'filters',
      value => {
        try {
          localStorage.setItem('filters', JSON.stringify(value));
        } catch (error) {
          console.warn('Failed to persist filters', error);
        }
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
        return exportFilteredCSV(employees, requirements, rows);
      },
      exportFilteredJSON: (employees, requirements, employeeRequirements) => {
        const rows = Array.isArray(employeeRequirements) && employeeRequirements.every(entry => Array.isArray(entry?.requirements))
          ? employeeRequirements
          : this._exportRowsCache || this.buildExportRows(employees, requirements, employeeRequirements);
        this._exportRowsCache = null;
        return exportFilteredJSON(employees, requirements, rows);
      }
    };
    this.$watch(
      () => this.$store?.app?.showImportModal,
      value => {
        if (value) {
          this.openImportDrawer();
        } else if (value === false && this.importDrawer.open) {
          this.closeImportDrawer({ silent: true });
        }
      }
    );
    this.$watch(
      () => this.$store?.app?.showAddEmployeeModal,
      value => {
        if (value) {
          this.openAddEmployeeModal();
        } else if (value === false && this.addEmployeeModal.open) {
          this.closeAddEmployeeModal({ silent: true });
        }
      }
    );
    this.resetAddEmployeeForm();
    this.bootstrap();
  },
  async bootstrap() {
    try {
      this.loading = true;
      await this.loadPartials();
      this.db = await openDatabase();
      await ensureSeedRequirements(this.db);
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
  hydrateAddEmployeeModal() {
    this.$nextTick(() => {
      const container = document.getElementById('add-employee-modal');
      if (container && container.dataset.alpineInitialized !== 'true') {
        Alpine.initTree(container);
        container.dataset.alpineInitialized = 'true';
      }
    });
  },
  openImportDrawer() {
    if (!this.importDrawer.open) {
      this.importDrawer.open = true;
      const store = this.$store?.app;
      if (store && store.showImportModal !== true) {
        store.showImportModal = true;
      }
      this.hydrateImportDrawer();
      this.$nextTick(() => {
        this.$refs.importFileInput?.focus();
      });
    }
  },
  closeImportDrawer(options = {}) {
    if (!this.importDrawer.open && !options.force) {
      return;
    }
    const { silent = false, preserveState = false } = options;
    this.importDrawer.open = false;
    if (!preserveState) {
      this.resetImportDrawerState();
    }
    if (!silent) {
      const store = this.$store?.app;
      if (store && store.showImportModal !== false) {
        store.showImportModal = false;
      }
    }
  },
  resetImportDrawerState() {
    this.importDrawer.file = null;
    this.importDrawer.fileName = '';
    this.importDrawer.dryRunLoading = false;
    this.importDrawer.commitLoading = false;
    this.importDrawer.summary = null;
    this.importDrawer.mapping = null;
    this.importDrawer.previewRows = [];
    this.importDrawer.previewColumns = [];
    this.importDrawer.previewTotal = 0;
    this.importDrawer.error = '';
    this.updateImportDrawerCommitState();
    if (this.$refs.importFileInput) {
      this.$refs.importFileInput.value = '';
    }
  },
  updateImportDrawerCommitState() {
    const state = this.importDrawer;
    const disabled = !state.file || !state.summary || state.dryRunLoading || state.commitLoading;
    state.commitDisabled = disabled;
  },
  downloadSampleCSV() {
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
  async initActivityLog() {
    if (!this.db || this.activityLog) {
      return;
    }
    try {
      const { default: ActivityLog } = await import('../activity-log.js');
      this.activityLog = await ActivityLog.init(this.db);
    } catch (error) {
      console.error('Failed to initialize activity log', error);
    }
  },
  openAddEmployee() {
    this.showAddEmployeeModal = true;
    const store = this.$store?.app;
    if (store && store.showAddEmployeeModal !== true) {
      store.showAddEmployeeModal = true;
    }
    this.openAddEmployeeModal();
  },
  openAddEmployeeModal() {
    if (!this.addEmployeeModal.open) {
      if (!this.addEmployeeModal.form.role) {
        this.resetAddEmployeeForm();
      }
      this.addEmployeeModal.open = true;
      this.showAddEmployeeModal = true;
      const store = this.$store?.app;
      if (store && store.showAddEmployeeModal !== true) {
        store.showAddEmployeeModal = true;
      }
      this.hydrateAddEmployeeModal();
      this.$nextTick(() => {
        this.$refs.addEmployeeFirstName?.focus();
      });
    }
  },
  closeAddEmployeeModal(options = {}) {
    const { silent = false, preserveForm = false, force = false } = options;
    if (!this.addEmployeeModal.open && !force) {
      return;
    }
    this.addEmployeeModal.open = false;
    this.showAddEmployeeModal = false;
    if (!preserveForm) {
      this.resetAddEmployeeForm();
    }
    if (!silent) {
      const store = this.$store?.app;
      if (store && store.showAddEmployeeModal !== false) {
        store.showAddEmployeeModal = false;
      }
    }
  },
  resetAddEmployeeForm() {
    const lookups = this.employeeLookups || {
      roles: DEFAULT_ROLE_LOOKUPS,
      statuses: DEFAULT_STATUS_LOOKUPS,
      employmentTypes: DEFAULT_EMPLOYMENT_TYPE_LOOKUPS
    };
    this.addEmployeeModal.form = {
      firstName: '',
      lastName: '',
      role: lookups.roles?.[0] || '',
      status: lookups.statuses?.[0] || '',
      employmentType: lookups.employmentTypes?.[0] || '',
      seniorityHours: ''
    };
    this.addEmployeeModal.errors = {};
  },
  validateAddEmployeeForm() {
    const errors = {};
    const fields = ['firstName', 'lastName', 'role', 'status', 'employmentType', 'seniorityHours'];
    for (const field of fields) {
      const value = this.addEmployeeModal.form[field];
      const normalized = typeof value === 'string' ? value.trim() : value;
      if (normalized === '' || normalized == null) {
        errors[field] = 'This field is required.';
      }
    }
    return {
      valid: Object.keys(errors).length === 0,
      errors
    };
  },
  focusFirstInvalidAddEmployeeField(errors) {
    const order = ['firstName', 'lastName', 'role', 'status', 'employmentType', 'seniorityHours'];
    for (const field of order) {
      if (!errors[field]) continue;
      const refName =
        field === 'seniorityHours'
          ? 'addEmployeeSeniorityHours'
          : `addEmployee${field.charAt(0).toUpperCase()}${field.slice(1)}`;
      const target = this.$refs?.[refName];
      if (target && typeof target.focus === 'function') {
        target.focus();
      }
      break;
    }
  },
  buildAddEmployeePayload() {
    const form = this.addEmployeeModal.form;
    const firstName = typeof form.firstName === 'string' ? form.firstName.trim() : '';
    const lastName = typeof form.lastName === 'string' ? form.lastName.trim() : '';
    const role = typeof form.role === 'string' ? form.role.trim() : '';
    const status = typeof form.status === 'string' ? form.status.trim() : '';
    const employmentType = typeof form.employmentType === 'string' ? form.employmentType.trim() : '';
    const hoursValue = typeof form.seniorityHours === 'string' ? form.seniorityHours.trim() : form.seniorityHours;
    const seniorityHours = Number.parseFloat(hoursValue);
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
      seniorityHours: Number.isFinite(seniorityHours) ? seniorityHours : 0,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  },
  async submitAddEmployeeForm() {
    if (!this.db || this.addEmployeeModal.saving) {
      return;
    }
    const { valid, errors } = this.validateAddEmployeeForm();
    this.addEmployeeModal.errors = errors;
    if (!valid) {
      this.$nextTick(() => this.focusFirstInvalidAddEmployeeField(errors));
      return;
    }
    await this.initActivityLog();
    const payload = this.buildAddEmployeePayload();
    this.addEmployeeModal.saving = true;
    try {
      const { employee } = await addEmployeeApi({
        db: this.db,
        activityLog: this.activityLog,
        employee: payload
      });
      this.closeAddEmployeeModal({ preserveForm: false });
      await this.loadData();
      this.applyFilters();
      const store = this.$store?.app;
      if (store && typeof store.showToast === 'function') {
        const name = `${employee?.firstName || ''} ${employee?.lastName || ''}`.trim() || 'Employee';
        store.showToast({ type: 'success', message: `${name} added.` });
      }
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
      this.addEmployeeModal.errors = {
        ...this.addEmployeeModal.errors,
        form: 'Unable to add employee. Please try again.'
      };
    } finally {
      this.addEmployeeModal.saving = false;
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
  downloadSampleCsv() {
    try {
      window.open('/sample-employees.csv', '_blank', 'noopener');
    } catch (error) {
      console.error('Failed to open sample CSV', error);
      this.setImportDrawerError('Unable to open the sample CSV.', { toast: false });
    }
  },
  setImportDrawerError(message, options = {}) {
    const { toast = true } = options;
    const safeMessage = message ? String(message) : 'Import failed.';
    this.importDrawer.error = safeMessage;
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
    this.importDrawer.previewRows = [];
    this.importDrawer.previewColumns = [];
    this.importDrawer.previewTotal = 0;
    this.importDrawer.error = '';
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
    if (extension === 'xlsx' && !window.XLSX && !window.__xlsxModule) {
      this.toast('Excel not available—use CSV or bundle XLSX', 'error');
      return;
    }
    const dryRunFn = window.importEmployeesDryRun;
    if (typeof dryRunFn !== 'function') {
      this.setImportDrawerError('Employee importer is unavailable. Please reload the page.');
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
    if (this.importDrawer.commitDisabled) {
      return;
    }
    const commitFn = window.importEmployeesCommit;
    if (typeof commitFn !== 'function') {
      this.setImportDrawerError('Employee importer is unavailable. Please reload the page.');
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
      const message = `Employees: ${summary.added} added, ${summary.updated} updated, ${summary.skipped} skipped.`;
      if (store && typeof store.showToast === 'function') {
        store.showToast({ type: 'success', message });
      }
      const timelineStore = this.$store?.activityLog;
      if (timelineStore && typeof timelineStore.record === 'function') {
        timelineStore.record({
          type: 'Import',
          actionType: 'ImportEmployees',
          summary: message,
          timestamp: Date.now(),
          metadata: summary
        });
      }
    } catch (error) {
      console.error('Import commit failed', error);
      const message = error?.message ? String(error.message) : 'Commit failed. Check the console for details.';
      this.setImportDrawerError(message);
    } finally {
      this.importDrawer.commitLoading = false;
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
      const [employees, requirements, employeeRequirements] = await Promise.all([
        this.db.table('employees').toArray(),
        this.db.table('requirements').orderBy('name').toArray(),
        this.db.table('employeeRequirements').toArray()
      ]);
      employees.sort((a, b) => {
        const last = normalizeLower(a?.lastName).localeCompare(normalizeLower(b?.lastName));
        if (last !== 0) return last;
        return normalizeLower(a?.firstName).localeCompare(normalizeLower(b?.firstName));
      });
      this.employees = employees;
      this.updateStoreEmployees();
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
    if (!this.addEmployeeModal.open) {
      if (!this.addEmployeeModal.form.role || !roles.includes(this.addEmployeeModal.form.role)) {
        this.addEmployeeModal.form.role = roles[0] || '';
      }
      if (!this.addEmployeeModal.form.status || !statuses.includes(this.addEmployeeModal.form.status)) {
        this.addEmployeeModal.form.status = statuses[0] || '';
      }
      if (
        !this.addEmployeeModal.form.employmentType ||
        !employmentTypes.includes(this.addEmployeeModal.form.employmentType)
      ) {
        this.addEmployeeModal.form.employmentType = employmentTypes[0] || '';
      }
    }
  },
  refreshAnalytics() {
    this.analytics = computeAnalyticsSummary({
      employees: this.employees,
      requirements: this.requirements,
      employeeRequirements: this.employeeRequirements,
      options: {
        atRiskWindowDays: this.analyticsConfig.atRiskWindowDays,
        expiringSoonDays: this.analyticsConfig.expiringSoonDays
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
        windowDays: this.analyticsConfig.expiringSoonDays
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
    const ids = requirementId ? [requirementId] : requirements.map(req => req?.id).filter(Boolean);
    for (const id of ids) {
      const record = this.getEmployeeRequirement(employeeId, id);
      const state = evaluateRequirementState(record, {
        today: referenceDate,
        atRiskWindowDays: this.analyticsConfig.atRiskWindowDays,
        expiringSoonDays: this.analyticsConfig.expiringSoonDays
      });
      if (state.atRisk) {
        return true;
      }
    }
    return false;
  },
  employeeHasExpiringWithinWindow(employeeId, requirementId = null, windowDays = this.analyticsConfig.expiringSoonDays) {
    if (!employeeId) {
      return false;
    }
    const requirements = Array.isArray(this.requirements) ? this.requirements : [];
    const referenceDate = this.analyticsReferenceDate();
    const ids = requirementId ? [requirementId] : requirements.map(req => req?.id).filter(Boolean);
    for (const id of ids) {
      const record = this.getEmployeeRequirement(employeeId, id);
      const state = evaluateRequirementState(record, {
        today: referenceDate,
        atRiskWindowDays: this.analyticsConfig.atRiskWindowDays,
        expiringSoonDays: windowDays
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
    await this.initActivityLog();
    let activityEntry = null;
    if (this.activityLog) {
      try {
        activityEntry = await this.activityLog.record({
          actionType: 'bulk-update-requirement',
          actor: 'user',
          targets: employeeIds.map(id => ({ type: 'employee', id })),
          metadata: {
            requirementId,
            requirementName: requirement.name,
            action,
            count: updates.length,
            date: dateValue || null,
            reason: reason || null
          },
          supportsUndo: false
        });
      } catch (error) {
        console.error('Failed to record bulk activity', error);
      }
    }
    if (updates.length) {
      const timelineStore = this.$store?.activityLog;
      if (timelineStore && typeof timelineStore.record === 'function') {
        const actionLabel = this.bulkActionLabel(action);
        const summary = `${actionLabel} · ${requirement.name} (${updates.length} ${updates.length === 1 ? 'employee' : 'employees'})`;
        timelineStore.record({
          ...(activityEntry || {}),
          type: 'Bulk update',
          summary,
          timestamp: activityEntry?.timestamp ?? Date.now(),
          metadata: {
            requirementId,
            requirementName: requirement.name,
            action,
            count: updates.length,
            date: dateValue || null,
            reason: reason || null
          }
        });
      }
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
    const requirementList = Array.isArray(requirements) ? requirements.filter(Boolean) : [];
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
      const requirementEntries = requirementList.map(requirement => {
        const key = this.buildRequirementKey(employee?.id, requirement?.id);
        const record = requirementMap.get(key) || null;
        return {
          requirementId: requirement?.id ?? null,
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
        fullName: combinedName || 'Unnamed employee',
        role: normalizeString(employee?.role),
        status: normalizeString(employee?.status),
        employmentType: normalizeString(employee?.employmentType),
        compliancePercent: this.employeeCompliancePercent(employee?.id),
        requirements: requirementEntries
      };
    });
  },
  exportCSV() {
    this.showExportMenu = false;
    const rows = this.buildExportRows(this.filteredEmployees, this.requirements, this.employeeRequirements);
    if (!rows.length) {
      this.$store?.app?.showToast?.({ type: 'info', message: 'No employees match the current filters.' });
      return;
    }
    this._exportRowsCache = rows;
    const success = this.exporter?.exportFilteredCSV?.(
      this.filteredEmployees,
      this.requirements,
      this.employeeRequirements
    );
    if (!this.exporter?.exportFilteredCSV) {
      this._exportRowsCache = null;
    }
    if (!success) {
      this.$store?.app?.showToast?.({ type: 'error', message: 'Unable to export CSV. Please try again.' });
    }
  },
  exportJSON() {
    this.showExportMenu = false;
    const rows = this.buildExportRows(this.filteredEmployees, this.requirements, this.employeeRequirements);
    if (!rows.length) {
      this.$store?.app?.showToast?.({ type: 'info', message: 'No employees match the current filters.' });
      return;
    }
    this._exportRowsCache = rows;
    const success = this.exporter?.exportFilteredJSON?.(
      this.filteredEmployees,
      this.requirements,
      this.employeeRequirements
    );
    if (!this.exporter?.exportFilteredJSON) {
      this._exportRowsCache = null;
    }
    if (!success) {
      this.$store?.app?.showToast?.({ type: 'error', message: 'Unable to export JSON. Please try again.' });
    }
  },
  triggerExport(format) {
    this.showExportMenu = false;
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
    this.showExportMenu = false;
    if (typeof window?.print === 'function') {
      window.print();
    } else {
      console.info('Print requested');
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
          const windowDays = Number.isFinite(analyticsFilter.windowDays)
            ? analyticsFilter.windowDays
            : this.analyticsConfig.expiringSoonDays;
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
    const expiresValue = cell?.expiresAt ?? cell?.expiresOn ?? cell?.raw?.expiresOn;
    if (!expiresValue) return false;
    const expiresOn = new Date(expiresValue);
    if (Number.isNaN(expiresOn.getTime())) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return expiresOn < today;
  },
  cellWarn(cell) {
    const expiresValue = cell?.expiresAt ?? cell?.expiresOn ?? cell?.raw?.expiresOn;
    if (!expiresValue) return false;
    const expiresOn = new Date(expiresValue);
    if (Number.isNaN(expiresOn.getTime())) return false;
    const diff = (expiresOn.getTime() - Date.now()) / 86400000;
    return diff >= 0 && diff <= 30;
  },
  chipText(cell) {
    const status = normalizeStatus(cell?.status || 'Pending');
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
      this.$refs.editorStatus?.focus();
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
    await this.initActivityLog();
    let activityEntry = null;
    if (this.activityLog) {
      try {
        activityEntry = await this.activityLog.record({
          actionType: 'update-requirement',
          actor: 'user',
          targets: [{ type: 'employee', id: employeeId }],
          metadata: {
            requirementId,
            status: payload.status,
            completedOn: payload.completedOn,
            expiresOn: payload.expiresOn
          },
          supportsUndo: false
        });
      } catch (error) {
        console.error('Failed to record inline edit activity', error);
      }
    }
    const timelineStore = this.$store?.activityLog;
    if (timelineStore && typeof timelineStore.record === 'function') {
      const employee = this.employees.find(emp => emp.id === employeeId);
      const requirement = this.requirements.find(req => req.id === requirementId);
      const employeeName = `${normalizeString(employee?.firstName)} ${normalizeString(employee?.lastName)}`.trim() || 'Employee';
      const requirementName = requirement?.name || 'Requirement';
      const statusLabel = normalizeStatus(payload.status);
      const summary = `${requirementName} updated for ${employeeName} (${statusLabel})`;
      timelineStore.record({
        ...(activityEntry || {}),
        type: 'Requirement',
        summary,
        timestamp: activityEntry?.timestamp ?? Date.now(),
        metadata: {
          requirementId,
          status: statusLabel,
          completedOn: payload.completedOn,
          expiresOn: payload.expiresOn,
          employeeId
        }
      });
    }
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
}));

Alpine.start();
