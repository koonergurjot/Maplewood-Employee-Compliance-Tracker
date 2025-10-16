import './polyfills/async-function-call.js';
import Alpine from 'alpinejs';
import { qs } from './utils/dom.js';
import requirementsGridTemplate from './v2/requirements-grid.html?raw';
const inlineEditTemplate = `
<template>
  <div x-teleport="body">
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
  </div>
</template>
`;
import './styles/tailwind.css';
import { openDatabase, generateId } from '../db.js';

const DEFAULT_APP_FLAGS = { USE_V2_MAIN: true };
const USE_V2_STORAGE_KEY = 'USE_V2_MAIN';
const V2_COMPONENT_REGISTRY_KEY = '__V2_ALPINE_COMPONENTS__';

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
      const host = document.getElementById('app-v2') || document.body;
      if (host) {
        const message = error && (error.stack || error.message) ? error.stack || error.message : String(error);
        const safeMessage = String(message).replace(/[&<>"']/g, char => {
          switch (char) {
            case '&':
              return '&amp;';
            case '<':
              return '&lt;';
            case '>':
              return '&gt;';
            case '"':
              return '&quot;';
            case "'":
              return '&#39;';
            default:
              return char;
          }
        });

        host.innerHTML = `
    <div style="padding:16px;font-family:system-ui">
      <h2>Something went wrong starting the app</h2>
      <pre style="white-space:pre-wrap;background:#f6f8fa;padding:12px;border-radius:8px">${safeMessage}</pre>
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

function normalizeStatus(status) {
  const lowered = normalizeLower(status);
  if (lowered === 'completed' || lowered === 'complete') return 'Completed';
  if (lowered === 'exempt' || lowered === 'not required') return 'Exempt';
  if (lowered === 'pending' || lowered === 'incomplete') return 'Pending';
  return status ? normalizeString(status) : 'Pending';
}

window.Alpine = Alpine;

registerV2Component('v2DashboardApp', () => ({
  db: null,
  partials: {
    requirementsGrid: '',
    importDrawer: ''
  },
  inlineTemplateMounted: false,
  loading: true,
  loadError: null,
  darkMode: false,
  showExportMenu: false,
  employees: [],
  requirements: [],
  employeeRequirements: [],
  employeeRequirementMap: new Map(),
  filteredEmployees: [],
  roleOptions: [],
  filters: {
    roles: [],
    status: 'all',
    compliance: 'all',
    expiringSoon: false,
    search: ''
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
    this.mountInlineTemplate();
    this.initializeDarkMode();
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
    this.bootstrap();
  },
  async bootstrap() {
    try {
      this.loading = true;
      await this.loadPartials();
      this.db = await openDatabase();
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
    await Promise.all([
      (async () => {
        try {
          const response = await fetch('./src/v2/requirements-grid.html');
          if (!response.ok) {
            throw new Error(`Failed to load requirements grid (status ${response.status})`);
          }
          this.partials.requirementsGrid = await response.text();
          this.hydrateRequirementsGrid();
        } catch (error) {
          console.error(error);
          this.partials.requirementsGrid = '';
        }
      })(),
      (async () => {
        try {
          const response = await fetch('./src/v2/import-drawer.html');
          if (!response.ok) {
            throw new Error(`Failed to load import drawer (status ${response.status})`);
          }
          this.partials.importDrawer = await response.text();
          this.hydrateImportDrawer();
        } catch (error) {
          console.error(error);
          this.partials.importDrawer = '';
        }
      })()
    ]);
  },
  hydrateRequirementsGrid() {
    this.$nextTick(() => {
      const container = document.getElementById('requirements-grid');
      if (container && container.dataset.alpineInitialized !== 'true') {
        Alpine.initTree(container);
        container.dataset.alpineInitialized = 'true';
      }
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
    if (!this.db) return;
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
    this.employeeRequirements = employeeRequirements;
    this.refreshRequirementMap();
    this.roleOptions = Array.from(new Set(this.employees.map(emp => normalizeString(emp.role)).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b)
    );
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
  triggerExport(format) {
    this.showExportMenu = false;
    const normalized = typeof format === 'string' ? format.toLowerCase() : '';
    console.info(`Export requested: ${normalized}`);
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
      return true;
    });
    this.updateStoreFilteredEmployees();
  },
  resetFilters() {
    this.filters.roles = [];
    this.filters.status = 'all';
    this.filters.compliance = 'all';
    this.filters.expiringSoon = false;
    this.filters.search = '';
    this.applyFilters();
  },
  getEmployeeRequirement(employeeId, requirementId) {
    return this.employeeRequirementMap.get(this.buildRequirementKey(employeeId, requirementId)) || null;
  },
  requirementExpired(record) {
    if (!record || !record.expiresOn) return false;
    const expiresOn = new Date(record.expiresOn);
    if (Number.isNaN(expiresOn.getTime())) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return expiresOn < today;
  },
  isRequirementExpiring(record, thresholdDays = 30) {
    if (!record || !record.expiresOn) return false;
    const expiresOn = new Date(record.expiresOn);
    if (Number.isNaN(expiresOn.getTime())) return false;
    const today = new Date();
    const diff = (expiresOn - today) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= thresholdDays;
  },
  hasExpiringRequirement(employeeId) {
    for (const req of this.requirements) {
      if (this.isRequirementExpiring(this.getEmployeeRequirement(employeeId, req.id))) {
        return true;
      }
    }
    return false;
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
  statusBadgeClass(employeeId, requirementId) {
    const record = this.getEmployeeRequirement(employeeId, requirementId);
    const status = normalizeStatus(record?.status);
    if (status === 'Completed') return 'status-complete';
    if (status === 'Exempt') return 'status-exempt';
    if (this.requirementExpired(record)) return 'status-overdue';
    return 'status-pending';
  },
  cellStatusLabel(employeeId, requirementId) {
    const record = this.getEmployeeRequirement(employeeId, requirementId);
    return normalizeStatus(record?.status || 'Pending');
  },
  cellSubtext(employeeId, requirementId) {
    const record = this.getEmployeeRequirement(employeeId, requirementId);
    if (!record) return 'Not started';
    const status = normalizeStatus(record.status);
    if (status === 'Completed' && record.completedOn) {
      return `Done ${this.formatDate(record.completedOn)}`;
    }
    if (status === 'Exempt') {
      return 'Exempt';
    }
    if (record.expiresOn) {
      const label = this.requirementExpired(record) ? 'Expired' : 'Expires';
      return `${label} ${this.formatDate(record.expiresOn)}`;
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
  openEditor(employeeId, requirementId, event) {
    const record = this.getEmployeeRequirement(employeeId, requirementId);
    this.editorForm.status = normalizeStatus(record?.status || 'Pending');
    this.editorForm.completedOn = normalizeDateInputValue(record?.completedOn);
    this.editorForm.expiresOn = normalizeDateInputValue(record?.expiresOn);
    this.activeEditor.employeeId = employeeId;
    this.activeEditor.requirementId = requirementId;
    this.activeEditor.style = this.computePopoverStyle(event.currentTarget);
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
    this.setEmployeeRequirement(payload);
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
