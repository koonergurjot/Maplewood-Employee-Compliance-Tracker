// Consolidated application initialization script extracted from index.html
// Ensures bundler processes the entire dashboard logic.

import './src/polyfills/async-function-call.js';
import Alpine from '@alpinejs/csp';
import Papa from 'papaparse';
import Chart from 'chart.js/auto';
import Sortable from 'sortablejs';
import Fuse from 'fuse.js';
import { safeFeatherReplace } from './feather-utils.js';
import { trapFocusWithin, getFocusableElements } from './a11y-utils.js';
import { qs } from './src/utils/dom.js';

import './styles.css';
import './import-employees.js';
import './onboarding.js';
import './src/debug-hitboxes.js';
import { createDatabase, ensureDexieLoaded, generateId, listLookups, addLookup, putEmployeeRecord, getDexie, openDatabase } from './db.js';
import * as CompatAPI from './src/compat/index.js';
import { warnOnce } from './src/compat/deprecations.js';

const hasWindowObject = typeof window !== 'undefined';

if (hasWindowObject && window.APP_FLAGS?.USE_V2_MAIN) {
  warnOnce('legacy-dashboard', 'Legacy dashboard loaded but v2 is active; not mounting.');
}

const skipLegacyBootstrap = hasWindowObject && Boolean(window.APP_FLAGS?.USE_V2_MAIN);

const onboardingModulePromise = import('./onboarding.js');
let importerModulePromise = Promise.resolve();

if (hasWindowObject) {
  try {
    await openDatabase();
  } catch (error) {
    console.error('Failed to initialize the compliance database. Some features may not work.', error);
  }

  importerModulePromise = import('./import-employees.js');
}

await Promise.all([onboardingModulePromise, importerModulePromise]);

const DEFAULT_ROLE_LOOKUPS = ['LPN', 'RCA', 'Rec', 'Receptionist', 'ADP Rec', 'ADP LPN', 'Other'];
const DEFAULT_STATUS_LOOKUPS = ['Active', 'Inactive'];
const DEFAULT_EMPLOYMENT_TYPE_LOOKUPS = ['FT', 'PT', 'Casual'];
const THEME_STORAGE_KEY = 'maplewood:theme';
const COLUMN_VISIBILITY_STORAGE_KEY = 'maplewood:employeeTable:visibleColumns';
const V2_COMPONENT_REGISTRY_KEY = '__V2_ALPINE_COMPONENTS__';

function registerLegacyComponent(name, definition) {
  if (!name || typeof name !== 'string') {
    Alpine.data(name, definition);
    return;
  }

  const hasWindow = typeof window !== 'undefined' && window !== null;
  const registry = hasWindow ? window[V2_COMPONENT_REGISTRY_KEY] : null;
  const useV2Main = hasWindow && !!(window.APP_FLAGS && window.APP_FLAGS.USE_V2_MAIN);

  if (useV2Main && registry && typeof registry.has === 'function' && registry.has(name)) {
    warnOnce(name, `Skipping legacy Alpine component "${name}" because the v2 dashboard is active.`);
    return;
  }

  Alpine.data(name, definition);
}
const DEFAULT_SORT_FIELD = 'seniorityHours';
const DEFAULT_SORT_DIRECTION = 'desc';
const EMPLOYEE_SORT_STORAGE_KEY = 'maplewood:employeeTable:sort';

const DEFAULT_VISIBLE_COLUMNS = Object.freeze({
  role: true,
  employmentType: true,
  status: true,
  seniorityHours: true
});

function getSortStorage(){
  if(typeof window === 'undefined') return null;
  try {
    return window.localStorage || null;
  } catch (error) {
    console.warn('Sort preference: localStorage unavailable', error);
    return null;
  }
}

function readStoredEmployeeSort(){
  const storage = getSortStorage();
  if(!storage){
    return null;
  }
  try {
    const raw = storage.getItem(EMPLOYEE_SORT_STORAGE_KEY);
    if(!raw){
      return null;
    }
    const parsed = JSON.parse(raw);
    if(!parsed || typeof parsed !== 'object' || Array.isArray(parsed)){
      return null;
    }
    const field = typeof parsed.field === 'string' && parsed.field.trim() ? parsed.field.trim() : '';
    const direction = parsed.direction === 'asc' || parsed.direction === 'desc' ? parsed.direction : '';
    if(!field || !direction){
      return null;
    }
    return { field, direction };
  } catch (error) {
    console.warn('Sort preference: failed to read preference', error);
    return null;
  }
}

function writeStoredEmployeeSort(field, direction){
  const storage = getSortStorage();
  if(!storage){
    return;
  }
  if(typeof field !== 'string' || !field.trim()){
    try {
      storage.removeItem(EMPLOYEE_SORT_STORAGE_KEY);
    } catch (error) {
      console.warn('Sort preference: failed to clear preference', error);
    }
    return;
  }
  const normalizedDirection = direction === 'desc' ? 'desc' : 'asc';
  try {
    storage.setItem(EMPLOYEE_SORT_STORAGE_KEY, JSON.stringify({ field: field.trim(), direction: normalizedDirection }));
  } catch (error) {
    console.warn('Sort preference: failed to persist preference', error);
  }
}

function getColumnStorage(){
  if(typeof window === 'undefined'){ return null; }
  try {
    return window.localStorage || null;
  } catch (error) {
    console.warn('Column visibility preferences: localStorage unavailable', error);
    return null;
  }
}

function loadStoredVisibleColumns(defaults = {}){
  const storage = getColumnStorage();
  const baseline = { ...defaults };
  if(!storage){
    return baseline;
  }
  try {
    const raw = storage.getItem(COLUMN_VISIBILITY_STORAGE_KEY);
    if(!raw){
      return baseline;
    }
    const parsed = JSON.parse(raw);
    if(!parsed || typeof parsed !== 'object' || Array.isArray(parsed)){
      return baseline;
    }

    const normalized = { ...baseline };
    for(const [key, defaultValue] of Object.entries(baseline)){
      if(Object.prototype.hasOwnProperty.call(parsed, key)){
        normalized[key] = parsed[key] !== false;
      } else {
        normalized[key] = defaultValue;
      }
    }
    for(const [key, value] of Object.entries(parsed)){
      if(!(key in normalized)){
        normalized[key] = value !== false;
      }
    }
    return normalized;
  } catch (error) {
    console.warn('Failed to load column visibility preferences', error);
    return baseline;
  }
}

function persistVisibleColumns(columns){
  const storage = getColumnStorage();
  if(!storage){
    return;
  }
  try {
    const payload = {};
    for(const [key, value] of Object.entries(columns || {})){
      payload[key] = value !== false;
    }
    storage.setItem(COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('Failed to save column visibility preferences', error);
  }
}

let cachedXlsx = (typeof window !== 'undefined' && (window.__xlsxModule || window.XLSX)) || null;
const DEFAULT_IMPORT_TYPE = cachedXlsx ? 'excel' : 'csv';
let xlsxLoadPromise = null;

function resolveXlsxFromGlobals(){
  if(typeof window === 'undefined') return null;
  return window.__xlsxModule || window.XLSX || null;
}

function getThemeStorage(){
  if(typeof window === 'undefined') return null;
  try {
    return window.localStorage || null;
  } catch (error) {
    console.warn('Theme preference: localStorage unavailable', error);
    return null;
  }
}

function readStoredThemePreference(){
  const storage = getThemeStorage();
  if(!storage) return null;
  try {
    return storage.getItem(THEME_STORAGE_KEY);
  } catch (error) {
    console.warn('Theme preference: failed to read preference', error);
    return null;
  }
}

function hasStoredThemePreference(){
  const value = readStoredThemePreference();
  return value === 'dark' || value === 'light';
}

function persistThemePreference(value){
  const storage = getThemeStorage();
  if(!storage) return;
  try {
    if(value === null){
      storage.removeItem(THEME_STORAGE_KEY);
    } else {
      storage.setItem(THEME_STORAGE_KEY, value);
    }
  } catch (error) {
    console.warn('Theme preference: failed to persist preference', error);
  }
}

function systemPrefersDark(){
  if(typeof window === 'undefined' || typeof window.matchMedia !== 'function'){
    return false;
  }
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch (error) {
    return false;
  }
}

function applyDocumentDarkMode(isDark){
  if(typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', Boolean(isDark));
  document.documentElement.style.colorScheme = Boolean(isDark) ? 'dark' : 'light';
}

function resolveInitialDarkMode(){
  const stored = readStoredThemePreference();
  if(stored === 'dark') return true;
  if(stored === 'light') return false;
  return systemPrefersDark();
}

function watchSystemThemeChange(callback){
  if(typeof window === 'undefined' || typeof window.matchMedia !== 'function'){
    return () => {};
  }
  let mediaQuery;
  try {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  } catch (error) {
    return () => {};
  }
  if(!mediaQuery) return () => {};
  const handler = (event) => {
    try {
      callback(Boolean(event.matches));
    } catch (error) {
      console.warn('Theme preference: system preference handler failed', error);
    }
  };
  if(typeof mediaQuery.addEventListener === 'function'){
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }
  if(typeof mediaQuery.addListener === 'function'){
    mediaQuery.addListener(handler);
    return () => mediaQuery.removeListener(handler);
  }
  return () => {};
}

const initialDarkMode = resolveInitialDarkMode();
applyDocumentDarkMode(initialDarkMode);

function rememberXlsxModule(mod){
  if(!mod) return null;
  const resolved = mod.default || mod.XLSX || mod;
  if(!resolved) return null;
  cachedXlsx = resolved;
  if(typeof window !== 'undefined'){
    window.__xlsxModule = resolved;
    if(!window.XLSX) window.XLSX = resolved;
  }
  return resolved;
}

function createAppReadyState(){
  let resolveReady;
  let rejectReady;
  let pending = false;
  let lastError = null;

  const state = {
    readyPromise: null,
    markLoading(){
      lastError = null;
      if(pending){
        return;
      }
      state.readyPromise = new Promise((resolve, reject) => {
        pending = true;
        resolveReady = () => {
          pending = false;
          resolve();
        };
        rejectReady = (error) => {
          pending = false;
          reject(error);
        };
      });
    },
    markReady(){
      if(!pending){
        state.markLoading();
      }
      lastError = null;
      resolveReady();
    },
    fail(error){
      const reason = error instanceof Error ? error : new Error(String(error || 'App failed to initialize.'));
      lastError = reason;
      if(!pending){
        state.markLoading();
      }
      rejectReady(reason);
    }
  };

  Object.defineProperty(state, 'error', {
    get(){
      return lastError;
    }
  });

  state.markLoading();

  return state;
}

const appState = createAppReadyState();

function resolveComponentData(element){
  if(!element){
    return null;
  }

  if(typeof Alpine !== 'undefined' && typeof Alpine.$data === 'function'){
    try {
      return Alpine.$data(element) || null;
    } catch (error) {
      // Fall through to the manual resolution below.
    }
  }

  if(element.__x && element.__x.$data){
    return element.__x.$data;
  }

  if(Array.isArray(element._x_dataStack) && element._x_dataStack.length){
    return element._x_dataStack[element._x_dataStack.length - 1] || null;
  }

  return null;
}

function resolveParentComponentData(context){
  if(!context || !context.$el){
    return null;
  }

  let parent = context.$el.parentElement;
  while(parent){
    const data = resolveComponentData(parent);
    if(data){
      return data;
    }
    parent = parent.parentElement;
  }

  return null;
}

function createModalA11y(getter, setter){
  return {
    focusTrapCleanup: null,
    lastActiveElement: null,
    evaluateIsOpen(){
      try {
        if(typeof getter === 'function'){
          return Boolean(getter.call(this));
        }
        if(typeof getter === 'string'){
          const parentData = resolveParentComponentData(this);
          if(parentData && getter in parentData){
            return Boolean(parentData[getter]);
          }
        }
      } catch (error) {
        return false;
      }
      return false;
    },
    updateState(value){
      const next = typeof value === 'undefined' ? false : Boolean(value);
      if(typeof setter === 'function'){
        setter.call(this, next);
      } else if(typeof getter === 'string'){
        const parentData = resolveParentComponentData(this);
        if(parentData && getter in parentData){
          parentData[getter] = next;
        }
      }
    },
    init(){
      this.$watch(() => this.evaluateIsOpen(), (isOpen) => this.handleToggle(isOpen));
      if(this.evaluateIsOpen()){
        this.handleToggle(true);
      }
    },
    handleToggle(isOpen){
      if(isOpen){
        this.onOpen();
      } else {
        this.onClose();
      }
    },
    onOpen(){
      if(typeof document !== 'undefined'){
        const active = document.activeElement;
        if(active && active !== document.body && !this.$el.contains(active)){
          this.lastActiveElement = active;
        }
      }

      this.$nextTick(() => {
        const container = this.$refs?.dialog || this.$el;
        this.deactivateFocusTrap();
        this.focusTrapCleanup = trapFocusWithin(container);
        const focusTarget = container.querySelector('[data-modal-initial-focus]')
          || getFocusableElements(container)[0]
          || container;
        if(focusTarget && typeof focusTarget.focus === 'function'){
          try {
            focusTarget.focus({ preventScroll: true });
          } catch (error) {
            focusTarget.focus();
          }
        }
      });
    },
    onClose(){
      this.deactivateFocusTrap();
      const target = this.lastActiveElement;
      this.lastActiveElement = null;
      if(!target || typeof target.focus !== 'function'){
        return;
      }
      this.$nextTick(() => {
        if(typeof document !== 'undefined' && typeof document.contains === 'function'){
          if(!document.contains(target)){
            return;
          }
        }
        try {
          target.focus({ preventScroll: true });
        } catch (error) {
          target.focus();
        }
      });
    },
    close(){
      this.updateState(false);
    },
    handleEscape(event){
      if(event){
        if(typeof event.preventDefault === 'function') event.preventDefault();
        if(typeof event.stopPropagation === 'function') event.stopPropagation();
      }
      this.close();
    },
    deactivateFocusTrap(){
      if(typeof this.focusTrapCleanup === 'function'){
        this.focusTrapCleanup();
      }
      this.focusTrapCleanup = null;
    }
  };
}

function parsePath(path){
  if(Array.isArray(path)){
    return path.filter(segment => typeof segment === 'string' && segment.length);
  }
  if(typeof path === 'string'){
    return path.split('.').map(segment => segment.trim()).filter(Boolean);
  }
  return [];
}

function getNestedValue(target, path){
  if(!target){
    return undefined;
  }
  return path.reduce((current, segment) => {
    if(current && typeof current === 'object' && segment in current){
      return current[segment];
    }
    return undefined;
  }, target);
}

function setNestedValue(target, path, value){
  if(!target || !path.length){
    return;
  }
  let current = target;
  for(let index = 0; index < path.length - 1; index += 1){
    const segment = path[index];
    if(typeof current[segment] !== 'object' || current[segment] === null){
      current[segment] = {};
    }
    current = current[segment];
  }
  current[path[path.length - 1]] = value;
}

function modalStateBinding(stateKey){
  if(typeof stateKey !== 'string' || !stateKey.length){
    return createModalA11y(() => false);
  }
  return createModalA11y(stateKey);
}

function modalStoreBinding(storeName, statePath, closeMethodName){
  const path = parsePath(statePath);
  function resolveStore(){
    if(typeof storeName !== 'string' || !storeName.length){
      return null;
    }
    try {
      return Alpine.store(storeName) || null;
    } catch (error) {
      return null;
    }
  }

  return createModalA11y(
    function(){
      const store = resolveStore();
      if(!store){
        return false;
      }
      if(!path.length){
        return false;
      }
      return Boolean(getNestedValue(store, path));
    },
    function(value){
      const store = resolveStore();
      if(!store){
        return;
      }
      const normalized = Boolean(value);
      if(normalized){
        if(path.length){
          setNestedValue(store, path, true);
        }
        return;
      }
      if(typeof closeMethodName === 'string' && closeMethodName.length && typeof store[closeMethodName] === 'function'){
        store[closeMethodName]();
        return;
      }
      if(path.length){
        setNestedValue(store, path, false);
      }
    }
  );
}

function mappingPanel(){
  return {
    mappingValidated: false,
    markValidated(){
      this.mappingValidated = true;
      if(this?.$root && typeof this.$root.updateMissingRequiredColumns === 'function'){
        this.$root.updateMissingRequiredColumns();
      }
    },
    handleFieldChange(){
      this.mappingValidated = false;
      if(this?.$root && typeof this.$root.updateEligibilityPreview === 'function'){
        this.$root.updateEligibilityPreview();
      }
    }
  };
}

if(typeof window !== 'undefined'){
  window.modalA11y = function(getter, setter){
    return createModalA11y(getter, setter);
  };
}

export async function waitForReady(ms = 10000) {
  if(appState.error){
    throw appState.error;
  }

  let timeoutId;
  const timeout = new Promise((_, rej) => {
    timeoutId = setTimeout(() => rej(new Error('app init timeout')), ms);
  });

  try {
    await Promise.race([appState.readyPromise, timeout]);
  } finally {
    if(timeoutId){
      clearTimeout(timeoutId);
    }
  }

  if(appState.error){
    throw appState.error;
  }
}

export async function loadXlsx(){
  if(cachedXlsx) return cachedXlsx;

  const existing = resolveXlsxFromGlobals();
  if(existing) return rememberXlsxModule(existing);

  if(!xlsxLoadPromise){
    xlsxLoadPromise = (async () => {
      try {
        const mod = await import('xlsx');
        const resolved = rememberXlsxModule(mod);
        if(resolved) return resolved;
      } catch (importError) {
        console.error('Dynamic XLSX import failed.', importError);
        throw new Error('Excel import support could not be loaded. Please refresh and try again or use CSV instead.');
      }

      const finalModule = rememberXlsxModule(resolveXlsxFromGlobals());
      if(finalModule) return finalModule;
      throw new Error('XLSX still unavailable');
    })().catch(error => {
      cachedXlsx = null;
      throw error;
    }).finally(() => {
      if(!cachedXlsx) xlsxLoadPromise = null;
    });
  }

  return xlsxLoadPromise;
}

window.Alpine = Alpine;

// Global store for shared UI state
Alpine.store('app', {
  showImportModal: false,
  showLookupModal: null,
  toast: null,
  _toastTimer: null,
  storageKeys: Object.freeze({
    filterViews: 'maplewood:employeeFilters:savedViews'
  }),
  showToast(msg){
    if(this._toastTimer){
      clearTimeout(this._toastTimer);
      this._toastTimer = null;
    }
    const payload = typeof msg === 'object' && msg !== null ? { ...msg } : { message: String(msg ?? '') };
    if(!payload.type){
      payload.type = 'info';
    }
    this.toast = payload;
    if(payload.type !== 'progress'){
      const duration = typeof payload.duration === 'number' && Number.isFinite(payload.duration)
        ? Math.max(0, payload.duration)
        : 3500;
      if(duration > 0){
        this._toastTimer = setTimeout(() => {
          if(this.toast?.type !== 'progress'){
            this.toast = null;
          }
          this._toastTimer = null;
        }, duration);
      }
    }
  },
  hideToast(){
    if(this._toastTimer){
      clearTimeout(this._toastTimer);
      this._toastTimer = null;
    }
    this.toast = null;
  },
  hasToastAction(){
    const toast = this.toast;
    if(!toast || !toast.action){
      return false;
    }
    return typeof toast.action.handler === 'function';
  },
  toastActionLabel(){
    const toast = this.toast;
    if(!toast || !toast.action){
      return 'Undo';
    }
    const label = toast.action.label;
    if(typeof label === 'string' && label.trim().length){
      return label;
    }
    return 'Undo';
  },
  isProgressToast(){
    const toast = this.toast;
    return Boolean(toast && toast.type === 'progress');
  },
  toastProgressPercent(){
    const toast = this.toast;
    if(!toast){
      return 0;
    }
    const value = typeof toast.percent === 'number' && Number.isFinite(toast.percent)
      ? toast.percent
      : 0;
    const clamped = Math.max(0, Math.min(100, Math.round(value)));
    return clamped;
  },
  async runToastAction(){
    const toast = this.toast;
    if(!toast || !toast.action || typeof toast.action.handler !== 'function'){
      return;
    }
    const action = toast.action;
    try {
      await action.handler();
    } catch (error) {
      console.error('Toast action failed', error);
    } finally {
      if(action.dismiss !== false){
        if(typeof this.hideToast === 'function'){
          this.hideToast();
        } else {
          this.toast = null;
        }
      }
    }
  },
  setProgress(p){
    if(this._toastTimer){
      clearTimeout(this._toastTimer);
      this._toastTimer = null;
    }
    const percent = typeof p === 'number' && Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : 0;
    this.toast = { type: 'progress', message: 'Importing...', percent };
  },
  lookupDialog: {
    open: false,
    type: '',
    label: '',
    value: '',
    error: '',
    loading: false,
    initializing: false,
    existing: [],
    onResolve: null
  },
  visibleColumns: loadStoredVisibleColumns(DEFAULT_VISIBLE_COLUMNS),
  initColumnPreferences(defaults = DEFAULT_VISIBLE_COLUMNS){
    const normalizedDefaults = { ...DEFAULT_VISIBLE_COLUMNS, ...(defaults || {}) };
    this.visibleColumns = loadStoredVisibleColumns(normalizedDefaults);
    this.persistColumnPreferences();
  },
  ensureColumnVisibility(columns){
    if(!Array.isArray(columns)){
      return;
    }
    const current = { ...(this.visibleColumns || {}) };
    let changed = false;
    for(const column of columns){
      if(typeof column !== 'string' || !column){
        continue;
      }
      if(!(column in current)){
        current[column] = true;
        changed = true;
      }
    }
    if(changed){
      this.visibleColumns = current;
      this.persistColumnPreferences();
    }
  },
  persistColumnPreferences(){
    persistVisibleColumns(this.visibleColumns);
  },
  setColumnVisibility(column, visible){
    if(!column){
      return;
    }
    const next = { ...(this.visibleColumns || {}) };
    next[column] = visible !== false;
    this.visibleColumns = next;
    this.persistColumnPreferences();
  },
  toggleColumn(column){
    if(!column){
      return;
    }
    this.setColumnVisibility(column, !this.isColumnVisible(column));
  },
  isColumnVisible(column){
    if(!column){
      return true;
    }
    const prefs = this.visibleColumns || {};
    if(!(column in prefs)){
      return true;
    }
    return prefs[column] !== false;
  },
  setToast(t){
    this.toast = t;
  },
  async openLookupDialog({ type, label, initialValue = '', onSuccess, existingValues = [] } = {}){
    if(!type){
      return;
    }

    const dialog = this.lookupDialog;
    this.showLookupModal = typeof type === 'string' ? type : '';
    dialog.type = String(type);
    dialog.label = label || 'Value';
    dialog.value = typeof initialValue === 'string' ? initialValue : '';
    dialog.error = '';
    dialog.loading = false;
    dialog.initializing = true;
    dialog.open = true;
    dialog.onResolve = typeof onSuccess === 'function' ? onSuccess : null;
    dialog.existing = Array.isArray(existingValues)
      ? existingValues
          .map(entry => {
            if(typeof entry === 'string') return entry.trim();
            if(entry == null) return '';
            return String(entry).trim();
          })
          .filter(Boolean)
      : [];

    try {
      const values = await listLookups(type);
      if(Array.isArray(values) && values.length){
        const seen = new Set(dialog.existing.map(v => v.toLocaleLowerCase()));
        for(const entry of values){
          if(typeof entry !== 'string') continue;
          const trimmed = entry.trim();
          if(!trimmed) continue;
          const key = trimmed.toLocaleLowerCase();
          if(seen.has(key)) continue;
          seen.add(key);
          dialog.existing.push(trimmed);
        }
      }
    } catch (error) {
      console.warn('lookupDialog: failed to load existing values for', type, error);
    } finally {
      dialog.initializing = false;
    }
  },
  closeLookupDialog(){
    const dialog = this.lookupDialog;
    dialog.open = false;
    dialog.type = '';
    dialog.label = '';
    dialog.value = '';
    dialog.error = '';
    dialog.loading = false;
    dialog.initializing = false;
    dialog.existing = [];
    dialog.onResolve = null;
    this.showLookupModal = '';
  },
  async submitLookupDialog(){
    const dialog = this.lookupDialog;
    if(!dialog.open || dialog.loading || dialog.initializing){
      return;
    }

    const rawValue = typeof dialog.value === 'string' ? dialog.value : '';
    const trimmed = rawValue.trim();
    if(!trimmed){
      dialog.error = 'Enter a value to add.';
      return;
    }

    const lower = trimmed.toLocaleLowerCase();
    if(dialog.existing.some(entry => entry.toLocaleLowerCase() === lower)){
      dialog.error = 'That value already exists.';
      return;
    }

    dialog.loading = true;
    dialog.error = '';

    try {
      const record = await addLookup(dialog.type, trimmed);
      const resolved = record?.value || trimmed;
      if(typeof dialog.onResolve === 'function'){
        dialog.onResolve(resolved);
      }
      this.closeLookupDialog();
    } catch (error) {
      console.warn('lookupDialog: failed to add value for', dialog.type, error);
      dialog.error = 'Unable to save this value. Try again.';
    } finally {
      if(dialog.open){
        dialog.loading = false;
      }
    }
  }
});

const BUILD_HASH = typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'dev';
    const TIMELINE_READY_MAX_RETRIES = 3;
    const TIMELINE_READY_RETRY_DELAY = 500;
    let timelineReadyGiveUpLogged = false;
    const timelineReadyWaits = new Set();

    function flushTimelineReadyWaits(){
      if(!timelineReadyWaits.size){
        return;
      }

      const waits = Array.from(timelineReadyWaits);
      timelineReadyWaits.clear();
      for(const wait of waits){
        if(typeof wait.finish === 'function'){
          wait.finish();
        }
      }
    }

    async function waitForTimelineAppReady(root, maxAttempts = TIMELINE_READY_MAX_RETRIES){
      if(!root) return false;

      const attempts = Math.max(1, maxAttempts);
      for(let attempt = 0; attempt < attempts; attempt += 1){
        if(root?.appReady && root?.db){
          return true;
        }

        if(attempt < attempts - 1){
          await new Promise(resolve => {
            const wait = {
              timerId: null,
              finish(){
                if(wait.timerId !== null){
                  clearTimeout(wait.timerId);
                  wait.timerId = null;
                }
                timelineReadyWaits.delete(wait);
                resolve();
              }
            };

            wait.timerId = setTimeout(() => {
              wait.timerId = null;
              timelineReadyWaits.delete(wait);
              resolve();
            }, TIMELINE_READY_RETRY_DELAY);

            timelineReadyWaits.add(wait);
          });
        }
      }

      if(!timelineReadyGiveUpLogged){
        console.info('Activity timeline idle: app not ready after retries; rendering fallback skeleton.');
        timelineReadyGiveUpLogged = true;
      }

      return false;
    }

    function activityTimeline(){
      return {
        entries: [],
        async load(){
          if(!this?.$root){
            console.warn('Activity timeline missing root context.');
            return;
          }

          const ready = await waitForTimelineAppReady(this.$root);
          if(!ready){
            if(this.$root){
              this.$root.pendingTimelineRefresh = true;
            }
            return;
          }

          const { default: ActivityLog } = await import('./activity-log.js');

          if(!this.$root.activityLog){
            if(typeof this.$root.initActivityLog === 'function'){
              await this.$root.initActivityLog();
            }

            if(!this.$root.activityLog){
              this.$root.activityLog = await ActivityLog.init(this.$root.db);
            }
          }

          if(!this.$root.activityLog) return;

          this.entries = await this.$root.activityLog.recent();
        },
        async init(){
          await this.load();
        },
        async undo(entry){
          if(!this?.$root?.appReady || !this?.$root?.db){
            console.warn('Undo requested before app ready.');
            return;
          }

          const commands = await import('./commands.js');
          const factories = {
            AddEmployee: e => new commands.AddEmployee(this.$root.db, { employee: e.metadata?.employee }),
            UpdateEmployee: e => new commands.UpdateEmployee(this.$root.db, { employeeId: e.targets?.[0], newData: e.metadata?.newData }),
            AddRequirement: e => new commands.AddRequirement(this.$root.db, { requirement: e.metadata?.requirement }),
            UpdateRequirement: e => new commands.UpdateRequirement(this.$root.db, { requirementId: e.targets?.[0], newData: e.metadata?.newData }),
            DeleteRequirement: e => new commands.DeleteRequirement(this.$root.db, { requirementId: e.targets?.[0] }),
            DeleteEmployee: e => new commands.DeleteEmployee(this.$root.db, { employeeId: e.targets?.[0] }),
            BulkUpdateStatus: e => new commands.BulkUpdateStatus(this.$root.db, {
              employeeIds: e.metadata?.employeeIds || e.targets || [],
              requirementIds: e.metadata?.requirementIds || [],
              status: e.metadata?.status,
              completedOn: e.metadata?.completedOn || null
            }),
            BulkDeleteEmployees: e => new commands.BulkDeleteEmployees(this.$root.db, {
              employeeIds: e.metadata?.employeeIds || e.targets || []
            }),
            ApplyTemplateToEmployees: () => new commands.ApplyTemplateToEmployees(this.$root.db, { template: {}, employeeIds: [], requirements: [] }),
            ImportEmployees: () => new commands.ImportEmployees(this.$root.db),
            ImportCompletions: () => new commands.ImportCompletions(this.$root.db)
          };
          const factory = factories[entry.actionType];
          if(!factory) return;
          await this.$root.activityLog.undo(entry.id, factory);
          await this.load();
          await this.$root.loadData();
        }
      };
    }

    function addEmployeeModal(){
      return {
        open: false,
        saving: false,
        firstName: '',
        lastName: '',
        role: '',
        status: '',
        employmentType: '',
        employeeId: '',
        seniorityHours: '',
        roles: [],
        statuses: [],
        employmentTypes: [],
        appComponent: null,
        resolveAppComponent(force = false){
          if(!force && this.appComponent && typeof this.appComponent === 'object'){
            return this.appComponent;
          }

          const component = resolveParentComponentData(this);
          if(component && typeof component === 'object'){
            this.appComponent = component;
            return component;
          }

          if(force){
            this.appComponent = null;
          }

          return this.appComponent;
        },
        lastActiveElement: null,
        db: null,
        dbPromise: null,
        async init(){
          if(this?.$el){
            Object.defineProperty(this.$el, '__api', {
              configurable: true,
              enumerable: false,
              value: Object.freeze({
                show: () => this.show(),
                hide: () => this.hide()
              })
            });
          }

          this.resolveAppComponent(true);

          this.$watch(() => {
            const appComponent = this.resolveAppComponent(true);
            return appComponent ? Boolean(appComponent.showAddEmployeeModal) : false;
          }, value => {
            if(value){
              this.show();
            } else if(this.open){
              this.hide();
            }
          });

          this.$watch('open', value => {
            if(!value){
              const appComponent = this.resolveAppComponent();
              if(appComponent){
                appComponent.showAddEmployeeModal = false;
              }
            }
          });

          this.$watch('open', value => {
            if(!value){
              this.reset();
            }
          });

          await this.loadLookups();
        },
        async loadLookups(){
          await Promise.all([
            this.refreshLookupOptions('role'),
            this.refreshLookupOptions('employmentType'),
            this.refreshLookupOptions('status')
          ]);
        },
        mergeLookupValues(...sources){
          const seen = new Set();
          const result = [];
          for(const source of sources){
            if(!Array.isArray(source)) continue;
            for(const entry of source){
              if(typeof entry !== 'string') continue;
              const value = entry.trim();
              if(!value) continue;
              const key = value.toLocaleLowerCase();
              if(seen.has(key)) continue;
              seen.add(key);
              result.push(value);
            }
          }
          return result.sort((a, b) => a.localeCompare(b));
        },
        defaultLookupValues(type){
          if(type === 'role'){
            return DEFAULT_ROLE_LOOKUPS;
          }
          if(type === 'employmentType'){
            return DEFAULT_EMPLOYMENT_TYPE_LOOKUPS;
          }
          if(type === 'status'){
            return DEFAULT_STATUS_LOOKUPS;
          }
          return [];
        },
        async collectLookupValues(type){
          const map = {
            role: ['role', 'position'],
            employmentType: ['employmentType', 'rank'],
            status: ['status']
          };
          const targets = map[type] || [type];
          const results = await Promise.all(targets.map(async lookupType => {
            try {
              const values = await listLookups(lookupType);
              return Array.isArray(values) ? values : [];
            } catch (error) {
              console.warn(`addEmployeeModal: failed to load ${lookupType} lookups`, error);
              return [];
            }
          }));
          return results.flat();
        },
        getLookupCollectionKey(type){
          if(type === 'status'){
            return 'statuses';
          }
          if(type === 'employmentType'){
            return 'employmentTypes';
          }
          if(type === 'role'){
            return 'roles';
          }
          return null;
        },
        getLookupLabel(type){
          if(type === 'employmentType'){
            return 'Employment Type';
          }
          if(type === 'status'){
            return 'Status';
          }
          return 'Role';
        },
        async refreshLookupOptions(type){
          const defaults = this.defaultLookupValues(type);
          const values = await this.collectLookupValues(type);
          const merged = this.mergeLookupValues(defaults, values);
          const key = this.getLookupCollectionKey(type);
          if(key){
            this[key] = merged;
          }
          return merged;
        },
        reset(){
          this.firstName = '';
          this.lastName = '';
          this.role = '';
          this.status = '';
          this.employmentType = '';
          this.employeeId = '';
          this.seniorityHours = '';
        },
        show(){
          this.lastActiveElement = null;
          if(typeof document !== 'undefined'){
            const activeElement = document.activeElement;
            if(activeElement && activeElement !== document.body && typeof activeElement.focus === 'function'){
              if(!this.$el || !this.$el.contains(activeElement)){
                this.lastActiveElement = activeElement;
              }
            }
          }

          this.open = true;
          return new Promise(resolve => {
            this.$nextTick(() => {
              const input = this.$refs?.firstName;
              if(input && typeof input.focus === 'function'){
                try {
                  input.focus({ preventScroll: true });
                } catch (error) {
                  input.focus();
                }
                if(typeof input.select === 'function'){
                  input.select();
                }
              }
              resolve();
            });
          });
        },
        hide(){
          this.open = false;
          this.reset();
          if(typeof window !== 'undefined'){
            this.$nextTick(() => {
              const target = this.lastActiveElement;
              this.lastActiveElement = null;
              if(!target || typeof target.focus !== 'function'){
                return;
              }

              let isInDocument = true;
              if(typeof document !== 'undefined'){
                const docContains = typeof document.contains === 'function' ? document.contains(target) : false;
                const bodyContains = document.body && typeof document.body.contains === 'function' ? document.body.contains(target) : false;
                const rootContains = document.documentElement && typeof document.documentElement.contains === 'function' ? document.documentElement.contains(target) : false;
                isInDocument = docContains || bodyContains || rootContains;
              }

              if(isInDocument){
                try {
                  target.focus({ preventScroll: true });
                } catch (error) {
                  target.focus();
                }
              }
            });
          }
          return Promise.resolve();
        },
        close(){
          const result = this.hide();
          const appComponent = this.resolveAppComponent();
          if(appComponent){
            appComponent.showAddEmployeeModal = false;
          }
          return result;
        },
        valid(){
          const required = [this.firstName, this.lastName, this.role, this.status, this.employmentType];
          return required.every(value => typeof value === 'string' && value.trim().length > 0);
        },
        async ensureDb(){
          if(this.db && (typeof this.db.isOpen !== 'function' || this.db.isOpen())){
            return this.db;
          }

          if(!this.dbPromise){
            this.dbPromise = (async () => {
              await ensureDexieLoaded();
              const instance = await createDatabase();
              if(typeof instance.open === 'function' && (!instance.isOpen || !instance.isOpen())){
                try {
                  await instance.open();
                } catch (error) {
                  console.warn('addEmployeeModal: failed to explicitly open database, continuing with lazy open.', error);
                }
              }
              this.db = instance;
              return instance;
            })();
          }

          try {
            this.db = await this.dbPromise;
          } catch (error) {
            this.dbPromise = null;
            throw error;
          }

          return this.db;
        },
        async ensureLookupValue(type, value){
          if(!value){
            return null;
          }

          const trimmed = value.trim();
          if(!trimmed){
            return null;
          }

          try {
            const record = await addLookup(type, trimmed);
            const resolvedValue = record?.value || trimmed;
            const key = this.getLookupCollectionKey(type);
            if(key){
              const current = Array.isArray(this[key]) ? this[key] : [];
              if(!current.some(entry => entry.toLocaleLowerCase() === resolvedValue.toLocaleLowerCase())){
                this[key] = [...current, resolvedValue].sort((a, b) => a.localeCompare(b));
              }
            }
            return resolvedValue;
          } catch (error) {
            console.warn(`addEmployeeModal: failed to add lookup for ${type}`, error);
            return trimmed;
          }
        },
        addNew(type){
          const store = Alpine.store('app');
          if(!store || typeof store.openLookupDialog !== 'function'){
            console.warn('addEmployeeModal: lookup dialog is not available');
            return;
          }

          const key = this.getLookupCollectionKey(type);
          const existing = key && Array.isArray(this[key]) ? [...this[key]] : [];
          const label = this.getLookupLabel(type);

          store.showLookupModal = type;
          store.openLookupDialog({
            type,
            label,
            existingValues: existing,
            onSuccess: value => {
              Promise.resolve(this.handleLookupAdded(type, value)).catch(error => {
                console.warn(`addEmployeeModal: failed to handle lookup add for ${type}`, error);
              });
            }
          });
        },
        async handleLookupAdded(type, value){
          const trimmed = typeof value === 'string' ? value.trim() : '';
          if(!trimmed){
            return;
          }

          await this.refreshLookupOptions(type);

          if(type === 'role'){
            this.role = trimmed;
          } else if(type === 'status'){
            this.status = trimmed;
          } else if(type === 'employmentType'){
            this.employmentType = trimmed;
          }
        },
        async save(){
          if(this.saving){
            return;
          }

          if(!this.valid()){
            if(typeof Alpine !== 'undefined' && typeof Alpine.store === 'function'){
              const store = Alpine.store('app');
              if(store && typeof store.showToast === 'function'){
                store.showToast({ type: 'error', message: 'Please fill out all required fields before saving.' });
              }
            } else if(typeof window !== 'undefined' && typeof window.alert === 'function'){
              window.alert('Please fill out all required fields before saving.');
            }

            const input = this.$refs?.firstName;
            if(input && typeof input.focus === 'function'){
              input.focus();
            }
            return;
          }

          const appRoot = this?.$root;
          if(appRoot && (!appRoot.appReady || !appRoot.db)){
            const message = 'The database is still initializing. Please try again in a moment.';
            console.warn('addEmployeeModal: attempted to save before database ready.');
            if(typeof Alpine !== 'undefined' && typeof Alpine.store === 'function'){
              const store = Alpine.store('app');
              if(store && typeof store.showToast === 'function'){
                store.showToast({ type: 'warning', message });
              }
            } else if(typeof window !== 'undefined' && typeof window.alert === 'function'){
              window.alert(message);
            }
            return;
          }

          this.saving = true;

          try {
            const db = await this.ensureDb();
            const timestamp = new Date().toISOString();
            const trimmedFirstName = typeof this.firstName === 'string' ? this.firstName.trim() : '';
            const trimmedLastName = typeof this.lastName === 'string' ? this.lastName.trim() : '';
            const baseEmployee = {
              id: generateId(),
              firstName: trimmedFirstName,
              lastName: trimmedLastName,
              name: trimmedFirstName && trimmedLastName
                ? `${trimmedFirstName} ${trimmedLastName}`
                : (trimmedFirstName || trimmedLastName),
              role: this.role.trim(),
              employmentType: this.employmentType.trim(),
              status: this.status ? this.status.trim() : '',
              position: this.role.trim(),
              rank: this.employmentType.trim(),
              createdAt: timestamp,
              updatedAt: timestamp
            };
            if(this.employeeId){
              baseEmployee.employeeId = this.employeeId.trim();
            }
            if(this.seniorityHours){
              baseEmployee.seniorityHours = Number(this.seniorityHours) || 0;
            }

            const [roleValue, statusValue, employmentTypeValue] = await Promise.all([
              this.ensureLookupValue('role', baseEmployee.role),
              this.ensureLookupValue('status', baseEmployee.status),
              this.ensureLookupValue('employmentType', baseEmployee.employmentType)
            ]);

            if(roleValue){
              baseEmployee.role = roleValue;
              baseEmployee.position = roleValue;
            }
            if(statusValue){
              baseEmployee.status = statusValue;
            }
            if(employmentTypeValue){
              baseEmployee.employmentType = employmentTypeValue;
              baseEmployee.rank = employmentTypeValue;
            }

            const { AddEmployee } = await import('./commands.js');
            const command = new AddEmployee(db, { employee: baseEmployee });
            const result = await command.execute();
            const createdEmployee = result?.employee || baseEmployee;

            this.$dispatch('employee:added', { employee: createdEmployee });

            await this.hide();
          } catch (error) {
            console.error('addEmployeeModal: failed to save employee', error);
            this.$dispatch('employee:add-failed', { error });
          } finally {
            this.saving = false;
          }
        }
      };
    }

    const app = () => ({
        loadError:'',
        darkMode:initialDarkMode, showImportModal:false, showExportDropdown:false,
        showSettingsModal:false, settingsSortable:null,
        showActivityLogModal:false,
        appReady:false,
        initialReadyDispatched:false,
        pendingTimelineRefresh:false,
        db:null, activityLog:null, employees:[], requirements:[], employeeRequirements:[], erMap:new Map(), visibleRequirements:[],
        templates:[], templateRoleMap:new Map(), showTemplateForm:false,
        templateEditor:{ id:null, name:'', rolesInput:'', excludedRequirementIds:[] },
        templateApplyLoading:false,
        importHeaders: [], // ensure array exists before templates iterate over it
        highlightHelpButton:false,
        themeMediaCleanup:null,
        tourMarkedSeen:false,
        tourPromptActive:false,
        // Import UI state
        importType:DEFAULT_IMPORT_TYPE, importMode:'employees', importData:[],
        importSheets:[], importSheetName:'', importWarning:'', importError:'', importLoading:false,
        importProgress:0, importErrors:[],
        missingRequiredColumns:[], missingColumnsBannerDismissed:false,
        duplicateHeaderGroups:[], duplicateHeaderNames:[], duplicateHeaderWarningDismissed:false, duplicateHeaderSignature:'',
        mappingHighlightTimer:null, lastMissingColumnsSignature:'',
        nameFormat:'auto', previewEligible:0, dryRunDetails:[], dryRunSummary:{added:0,updated:0,skipped:0},
        fieldLabels:{ firstName:'First Name', lastName:'Last Name', payrollName:'Payroll/Employee Name', role:'Role / Job Title', employmentType:'Employment Type / Class', employeeId:'Employee ID / Position ID', status:'Position Status', seniorityHours:'Seniority Hours' },
        columnMap:{ firstName:'', lastName:'', payrollName:'', role:'', employmentType:'', employeeId:'', status:'', seniorityHours:'' },
        completionMap:{},
        backupPayload:null,
        backupSummary:null,
        backupValidationErrors:[],
        importDiagnosticsPanelOpen:false,
        importDiagnosticsLoading:false,
        importDiagnostics:{
          indexedDbStatus:'Not checked',
          dexieVersion:'Unknown',
          storeCounts:[],
          lastImportTime:null,
          lastImportResult:'',
          lastImportStatus:'idle',
          lastImportDetails:null,
          logs:[],
        },
        // Admin panel state
        showAddEmployeeModal:false, showAddRequirementModal:false,
        showEditEmployeeModal:false, showEditRequirementModal:false,
        columnOptions:[
          { key:'role', label:'Role' },
          { key:'employmentType', label:'Type' },
          { key:'status', label:'Status' },
          { key:'seniorityHours', label:'Seniority' }
        ],
        showColumnMenu:false,
          searchQuery:'', roleFilter:'', statusFilter:'', reqStatusFilter:'', filteredEmployees:[], isFiltering:false, sortField:DEFAULT_SORT_FIELD, sortDirection:DEFAULT_SORT_DIRECTION,
          savedViews:[], selectedViewName:'',
          globalSearch:'', searchResults:[],
          globalSearchIndex:null, globalSearchIndexVersion:-1, globalSearchDataVersion:0, globalSearchData:[],
          virtualWindowSize:60, virtualStartIndex:0, virtualPaddingTop:0, virtualPaddingBottom:0, virtualRowHeight:48, virtualScrollInitialized:false, virtualOverscan:6,
        roleOptions:[...DEFAULT_ROLE_LOOKUPS],
        statusOptions:[...DEFAULT_STATUS_LOOKUPS],
        employmentTypeOptions:[...DEFAULT_EMPLOYMENT_TYPE_LOOKUPS],
        inlineEditSnapshots:{},
        newEmployee:{firstName:'', lastName:'', role:'', employmentType:'FT', employeeId:'', seniorityHours:'', status:'Active'},
          newRequirement:{name:'', defaultExpiryDays:'', color:'#e0e7ff'},
          editingEmployee:{}, editingRequirement:{},
        bulkTemplateId:'',
        bulkTemplatePanelOpen:false,
        bulkStatusPanelOpen:false,
        bulkStatusAction:'',
        bulkStatusRequirementIds:[],
        bulkStatusCompletedOn:'',
        bulkStatusSubmitting:false,
        get selectedEmployees(){
          const store = Alpine.store('app');
          if(store && Array.isArray(store.selectedEmployeeIds)){
            return store.selectedEmployeeIds;
          }
          return [];
        },
        set selectedEmployees(value){
          const store = Alpine.store('app');
          if(store && typeof store.setSelectedEmployeeIds === 'function'){
            store.setSelectedEmployeeIds(value);
          } else if(store){
            store.selectedEmployeeIds = Array.isArray(value) ? [...value] : [];
          }
        },
        complianceChart:null,
        complianceTrendChart:null,
        complianceHistory:[],
        complianceHistoryMemory:[],
        complianceHistoryLimit:30,
        // Chart.js plugin container so we can safely set properties during init
        chartBgPlugin: {
          id: 'chartBgColor',
          beforeDraw(chart, args, opts) {
            const {ctx, width, height} = chart;
            ctx.save();
            ctx.globalCompositeOperation = 'destination-over';
            ctx.fillStyle = opts?.color || getComputedStyle(document.documentElement).getPropertyValue('--card') || '#fff';
            ctx.fillRect(0, 0, width, height);
            ctx.restore();
          }
        },

        isColumnVisible(column){
          const store = Alpine.store('app');
          if(!store || typeof store.isColumnVisible !== 'function'){
            return true;
          }
          return store.isColumnVisible(column);
        },

        visibleBaseColumnCount(){
          if(!Array.isArray(this.columnOptions) || !this.columnOptions.length){
            return Object.keys(DEFAULT_VISIBLE_COLUMNS).length;
          }
          return this.columnOptions.reduce((count, option) => {
            if(!option || typeof option.key !== 'string'){
              return count;
            }
            return count + (this.isColumnVisible(option.key) ? 1 : 0);
          }, 0);
        },

        mergeLookupValues(...sources){
          const seen = new Set();
          const result = [];
          for(const source of sources){
            if(!Array.isArray(source)) continue;
            for(const entry of source){
              if(typeof entry !== 'string') continue;
              const value = entry.trim();
              if(!value) continue;
              const key = value.toLocaleLowerCase();
              if(seen.has(key)) continue;
              seen.add(key);
              result.push(value);
            }
          }
          return result;
        },

        formatEmploymentTypeLabel(type){
          if(type == null){
            return '';
          }
          const value = String(type).trim();
          if(!value){
            return '';
          }
          const normalized = value.toUpperCase();
          if(normalized === 'FT'){ return 'Full Time'; }
          if(normalized === 'PT'){ return 'Part Time'; }
          if(normalized === 'PRN'){ return 'PRN'; }
          if(normalized === 'CASUAL'){ return 'Casual'; }
          return value;
        },

        statusSelectClasses(status){
          const value = typeof status === 'string' ? status.trim().toLowerCase() : '';
          if(!value){
            return '';
          }
          if(value === 'active'){
            return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
          }
          if(value === 'inactive'){
            return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
          }
          return '';
        },

        statusCellClass(status){
          const value = typeof status === 'string' ? status.toLowerCase() : '';
          switch(value){
            case 'compliant':
              return 'requirement-status-cell--compliant';
            case 'expiring':
              return 'requirement-status-cell--expiring';
            case 'overdue':
              return 'requirement-status-cell--overdue';
            case 'not-required':
              return 'requirement-status-cell--not-required';
            default:
              return 'requirement-status-cell--incomplete';
          }
        },

        trackInlineEdit(emp, field){
          if(!emp?.id || !field){
            return;
          }
          if(!this.inlineEditSnapshots || typeof this.inlineEditSnapshots !== 'object'){
            this.inlineEditSnapshots = {};
          }
          const key = `${emp.id}:${field}`;
          this.inlineEditSnapshots[key] = emp[field] ?? '';
        },

        async handleInlineEmployeeUpdate(emp, field, value){
          if(!emp?.id || !field || !this.db){
            return;
          }

          const editableFields = ['role', 'status', 'employmentType'];
          if(!editableFields.includes(field)){
            return;
          }

          if(!this.inlineEditSnapshots || typeof this.inlineEditSnapshots !== 'object'){
            this.inlineEditSnapshots = {};
          }

          const snapshotKey = `${emp.id}:${field}`;
          const previousValue = Object.prototype.hasOwnProperty.call(this.inlineEditSnapshots, snapshotKey)
            ? this.inlineEditSnapshots[snapshotKey]
            : emp[field];
          delete this.inlineEditSnapshots[snapshotKey];

          const rawValue = value ?? emp[field] ?? '';
          const sanitizedValue = typeof rawValue === 'string' ? rawValue.trim() : (rawValue ?? '');
          const normalizedPrevious = typeof previousValue === 'string' ? previousValue.trim() : (previousValue ?? '');

          if(sanitizedValue === normalizedPrevious){
            if(emp[field] !== sanitizedValue){
              emp[field] = sanitizedValue;
            }
            return;
          }

          const updatedAt = new Date().toISOString();
          const baseRecord = this.employees.find(e => e.id === emp.id) || emp;
          const updatedRecord = {
            ...baseRecord,
            [field]: sanitizedValue,
            updatedAt
          };

          if(baseRecord?.createdAt && !updatedRecord.createdAt){
            updatedRecord.createdAt = baseRecord.createdAt;
          }

          try{
            await putEmployeeRecord(this.db, updatedRecord);

            const applyUpdate = (collection) => {
              if(!Array.isArray(collection)){
                return;
              }
              const target = collection.find(e => e.id === emp.id);
              if(target){
                target[field] = sanitizedValue;
                target.updatedAt = updatedAt;
              }
            };

            applyUpdate(this.employees);
            applyUpdate(this.filteredEmployees);

            emp[field] = sanitizedValue;
            emp.updatedAt = updatedAt;

            this.ensureLookupValue(field, sanitizedValue);
            this.touchGlobalSearchVersion();
            this.filterEmployees();

            const labels = {
              role: 'Role',
              status: 'Status',
              employmentType: 'Employment Type'
            };
            const formattedValue = sanitizedValue
              ? (field === 'employmentType'
                  ? (this.formatEmploymentTypeLabel(sanitizedValue) || sanitizedValue)
                  : sanitizedValue)
              : 'cleared';
            const message = sanitizedValue
              ? `${labels[field]} updated to ${formattedValue}`
              : `${labels[field]} cleared`;
            this.notify(message);
          } catch(error){
            console.error('Failed to update employee inline', error);
            const revertValue = typeof previousValue === 'string' ? previousValue : (previousValue ?? '');
            emp[field] = revertValue;
            const target = this.employees.find(e => e.id === emp.id);
            if(target){
              target[field] = revertValue;
            }
            this.notify('Failed to save change', 'var(--danger)');
          }
        },

        appendLookupValue(type, value){
          if(!type) return;
          const normalized = typeof value === 'string' ? value.trim() : '';
          if(!normalized) return;
          const key = normalized.toLocaleLowerCase();
          const map = {
            role: 'roleOptions',
            status: 'statusOptions',
            employmentType: 'employmentTypeOptions'
          };
          const targetKey = map[type];
          if(!targetKey || !Array.isArray(this[targetKey])){
            return;
          }
          if(this[targetKey].some(entry => entry.toLocaleLowerCase() === key)){
            return;
          }
          this[targetKey] = [...this[targetKey], normalized];
        },

        ensureLookupValue(type, value){
          if(!value) return;
          this.appendLookupValue(type, value);
        },

        async loadEmployeeLookups(){
          try{
            const [roleValues, statusValues, typeValues] = await Promise.all([
              listLookups('role'),
              listLookups('status'),
              listLookups('employmentType')
            ]);

            const employeeRoles = this.employees.map(emp => emp.role).filter(Boolean);
            const employeeStatuses = this.employees.map(emp => emp.status).filter(Boolean);
            const employeeTypes = this.employees.map(emp => emp.employmentType).filter(Boolean);

            this.roleOptions = this.mergeLookupValues(
              DEFAULT_ROLE_LOOKUPS,
              Array.isArray(roleValues) ? roleValues : [],
              employeeRoles
            );
            this.statusOptions = this.mergeLookupValues(
              DEFAULT_STATUS_LOOKUPS,
              Array.isArray(statusValues) ? statusValues : [],
              employeeStatuses
            );
            this.employmentTypeOptions = this.mergeLookupValues(
              DEFAULT_EMPLOYMENT_TYPE_LOOKUPS,
              Array.isArray(typeValues) ? typeValues : [],
              employeeTypes
            );
          }catch(error){
            console.warn('Failed to load employee lookup values', error);
            const employeeRoles = this.employees.map(emp => emp.role).filter(Boolean);
            const employeeStatuses = this.employees.map(emp => emp.status).filter(Boolean);
            const employeeTypes = this.employees.map(emp => emp.employmentType).filter(Boolean);
            this.roleOptions = this.mergeLookupValues(DEFAULT_ROLE_LOOKUPS, employeeRoles);
            this.statusOptions = this.mergeLookupValues(DEFAULT_STATUS_LOOKUPS, employeeStatuses);
            this.employmentTypeOptions = this.mergeLookupValues(DEFAULT_EMPLOYMENT_TYPE_LOOKUPS, employeeTypes);
          }
        },

        async loadBackupFromFile(file){
          try {
            const text = await file.text();
            let parsed;
            try {
              parsed = JSON.parse(text);
            } catch (parseError) {
              console.error('Failed to parse backup JSON', parseError);
              this.importError = 'Backup file is not valid JSON.';
              this.backupPayload = null;
              this.backupSummary = null;
              this.backupValidationErrors = ['The uploaded file could not be parsed as JSON.'];
              return;
            }

            const { normalized, summary, errors } = this.analyzeBackupPayload(parsed);
            if (!normalized) {
              this.importError = 'Backup file is missing required sections. See errors below.';
              this.backupPayload = null;
              this.backupSummary = null;
              this.backupValidationErrors = errors;
              return;
            }

            this.backupPayload = normalized;
            this.backupSummary = summary;
            this.backupValidationErrors = errors;
            if (errors.length) {
              this.importWarning = 'The backup contains validation issues. Review the messages below before restoring.';
            } else {
              this.importWarning = '';
            }
          } catch (error) {
            console.error('Failed to load backup file', error);
            this.importError = 'We were unable to read the backup file. Please try again.';
            this.backupPayload = null;
            this.backupSummary = null;
            this.backupValidationErrors = [];
          }
        },

        analyzeBackupPayload(payload){
          const errors = [];
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            errors.push('Backup payload must be a JSON object.');
            return { normalized: null, summary: null, errors };
          }

          const readArray = (primaryKey, fallbacks = [], label = primaryKey) => {
            let source = payload[primaryKey];
            for (const key of fallbacks) {
              if (!Array.isArray(source)) {
                source = payload[key];
              }
            }
            if (!Array.isArray(source)) {
              errors.push(`Missing array for "${label}".`);
              return [];
            }
            const sanitized = [];
            let rejected = 0;
            for (const entry of source) {
              if (!entry || typeof entry !== 'object') {
                rejected++;
                continue;
              }
              sanitized.push({ ...entry });
            }
            if (rejected) {
              errors.push(`${rejected} ${label} entr${rejected === 1 ? 'y was' : 'ies were'} skipped because they are not objects.`);
            }
            return sanitized;
          };

          const normalized = {
            employees: readArray('employees'),
            requirements: readArray('requirements'),
            employeeRequirements: readArray('employeeRequirements', ['completions'], 'employeeRequirements'),
            settings: readArray('settings'),
            templates: readArray('templates', ['roleRequirementProfiles'], 'templates'),
            snapshots: readArray('snapshots', ['complianceSnapshots'], 'snapshots'),
            activityLog: readArray('activityLog', ['logs'], 'activityLog').map(entry => ({
              ...entry,
              supportsUndo: entry?.supportsUndo === false ? false : true
            }))
          };

          const metadata = (payload.meta && typeof payload.meta === 'object') ? { ...payload.meta } : {};
          if (payload.generatedAt && !metadata.generatedAt) {
            metadata.generatedAt = payload.generatedAt;
          }

          const summary = {
            employees: normalized.employees.length,
            requirements: normalized.requirements.length,
            completions: normalized.employeeRequirements.length,
            settings: normalized.settings.length,
            templates: normalized.templates.length,
            snapshots: normalized.snapshots.length,
            activityLog: normalized.activityLog.length,
            generatedAt: metadata.generatedAt || null
          };

          return { normalized: { ...normalized, metadata }, summary, errors };
        },

        async restoreBackup(){
          if (this.loadError || !this.db) {
            this.importError = 'Database is not ready. Reload the page and try again.';
            return null;
          }
          if (!this.backupPayload) {
            this.importError = 'Upload a backup file before restoring.';
            return null;
          }
          if (this.backupValidationErrors.length) {
            this.importError = 'Resolve the backup validation issues before restoring.';
            return null;
          }

          const payload = this.backupPayload;
          const summary = this.backupSummary || this.analyzeBackupPayload(payload).summary;

          try {
            await this.db.transaction('rw',
              this.db.employees,
              this.db.requirements,
              this.db.employeeRequirements,
              this.db.settings,
              this.db.roleRequirementProfiles,
              this.db.complianceSnapshots,
              this.db.activityLog,
              async () => {
                await this.db.employees.clear();
                await this.db.requirements.clear();
                await this.db.employeeRequirements.clear();
                await this.db.settings.clear();
                if (this.db.roleRequirementProfiles) await this.db.roleRequirementProfiles.clear();
                if (this.db.complianceSnapshots) await this.db.complianceSnapshots.clear();
                if (this.db.activityLog) await this.db.activityLog.clear();

                if (payload.employees.length) await this.db.employees.bulkPut(payload.employees);
                if (payload.requirements.length) await this.db.requirements.bulkPut(payload.requirements);
                if (payload.employeeRequirements.length) await this.db.employeeRequirements.bulkPut(payload.employeeRequirements);
                if (payload.settings.length) await this.db.settings.bulkPut(payload.settings);
                if (this.db.roleRequirementProfiles && payload.templates.length) await this.db.roleRequirementProfiles.bulkPut(payload.templates);
                if (this.db.complianceSnapshots && payload.snapshots.length) await this.db.complianceSnapshots.bulkPut(payload.snapshots);
                if (this.db.activityLog && payload.activityLog.length) await this.db.activityLog.bulkPut(payload.activityLog);
                if (payload.metadata && Object.keys(payload.metadata).length) {
                  await this.db.settings.put({ id: 'backupMeta', value: payload.metadata });
                }
              }
            );

            await this.recordActivity('RestoreBackup', [], { summary }, null, { supportsUndo: false });
            this.notify('Backup restored successfully.');
            this.backupPayload = null;
            this.backupSummary = null;
            this.backupValidationErrors = [];
            return summary;
          } catch (error) {
            console.error('Failed to restore backup', error);
            this.importError = 'Restoring the backup failed. Check the console for details.';
            return null;
          }
        },

        formatYears(days){ return Math.floor(days/365)+'y'; },

        normalizeRequirementColor(color){
          return typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color) ? color : '';
        },

        requirementHeaderStyle(color){
          const validColor = this.normalizeRequirementColor(color);
          return `background:${validColor ? `${validColor}1A` : '#f8fafc'}; border-left:3px solid ${validColor || '#94a3b8'}`;
        },

        async init(){
          const store = Alpine.store('app');
          if(store){
            const columnList = Array.isArray(this.columnOptions) ? this.columnOptions : [];
            const defaults = columnList.length
              ? Object.fromEntries(columnList.filter(option => option?.key).map(option => [option.key, true]))
              : { ...DEFAULT_VISIBLE_COLUMNS };
            if(typeof store.initColumnPreferences === 'function'){
              store.initColumnPreferences(defaults);
            } else if(typeof store.ensureColumnVisibility === 'function'){
              store.ensureColumnVisibility(Object.keys(defaults));
            }
          }
          if(typeof this.$watch === 'function'){
            this.$watch(() => this.selectedEmployees.length, (count) => {
              if(count){
                return;
              }
              this.bulkTemplatePanelOpen = false;
              this.bulkStatusPanelOpen = false;
              this.bulkTemplateId = '';
              this.bulkStatusRequirementIds = [];
              this.bulkStatusAction = '';
              this.bulkStatusCompletedOn = '';
            });
          }
          await this.initDB();
          if (this.loadError || !this.db) {
            this.$nextTick(() => this.$root?.removeAttribute('x-cloak'));
            this.setAppReady(false);
            return;
          }

          this.$nextTick(() => this.$root?.removeAttribute('x-cloak'));

          const markTourSeenHandler = () => this.markTourSeen();
          window.addEventListener('tour:started', markTourSeenHandler);
          window.addEventListener('tour:ended', markTourSeenHandler);

          this.loadSortPreferences();
          await this.initActivityLog();
          await this.loadData();
          this.loadSavedViewsFromStorage();
          if (this.loadError || !this.db) return;
          this.applyDarkMode(this.darkMode);
          this.setupThemeWatcher();

          // Ensure our custom chart plugin exists before charts initialize
          this.chartBgPlugin.fullSize = true;
          Chart.register(this.chartBgPlugin);

          // Initialize feather icons after DOM is ready
          this.$nextTick(() => {
            // Add a small delay to ensure all elements are rendered
            setTimeout(() => {
              this.initializeFeatherIcons();
            }, 100);
          });

          if ('serviceWorker' in navigator) {
            if (window.__SW_REGISTERED__) {
              console.info('SW registration skipped (already registered).');
            } else if (location.hostname.endsWith('.pages.dev') || location.hostname === 'YOUR_CUSTOM_DOMAIN') {
              const swUrl = `sw.js?build=${BUILD_HASH}`;
              navigator.serviceWorker
                ?.register(swUrl, { scope: './' })
                .then((registration) => {
                  console.info('SW registered', registration.scope);
                })
                .catch((error) => {
                  console.info('SW disabled (register failed):', error);
                });
              window.__SW_REGISTERED__ = true;
            } else {
              // Service Worker registration is disabled unless running on Pages; not required for importer.
              console.info('SW disabled (non-Pages host).');
            }
          }

          const tourSetting = await this.db.settings.get('hasSeenTour');
          this.tourMarkedSeen = !!tourSetting?.value;
          if (!this.tourMarkedSeen) {
            this.promptTour();
          }
        },

        async initDB(){
          if (this.loadError || typeof window === 'undefined') {
            return;
          }
          try {
            await ensureDexieLoaded();
            this.db = await createDatabase();
          } catch (error) {
            console.error('Failed to initialize Dexie database', error);
            this.loadError = 'The offline database library (Dexie.js) did not load. Data cannot be displayed without it.';
            this.db = null;
            this.setAppReady(false);
          }
        },

        async initActivityLog(){
          if (this.loadError || !this.db) return;
          try {
            const { default: ActivityLog } = await import('./activity-log.js');
            this.activityLog = await ActivityLog.init(this.db);
          } catch (error) {
            console.error('Failed to initialize activity log', error);
          }
        },

        openActivityLog(){
          if(!this.appReady){
            console.warn('Attempted to open activity log before app ready.');
            return;
          }
          this.showActivityLogModal = true;
          this.$nextTick(() => {
            this.$refs.activityTimeline?.load();
          });
        },

        openCalendar(){
          window.open('calendar.html', '_blank', 'noopener');
        },

        async clearAllData(){
          if (this.loadError || !this.db) return;
          if(!confirm('This will delete all data. Are you sure?')){
            this.notify('Data deletion cancelled','var(--warn)');
            return;
          }
          await this.db.delete();
          this.setAppReady(false);
          await this.initDB();
          await this.initActivityLog();
          await this.loadData();
          this.notify('All data cleared');
        },

        async loadData(){
          if (this.loadError || !this.db) return;

          try {
            this.loadError = '';
            const [employees, requirements, employeeRequirements] = await Promise.all([
              this.db.employees.toArray(),
              this.db.requirements.toArray(),
              this.db.employeeRequirements.toArray()
            ]);

            this.employees = employees;
            const store = Alpine.store('app');
            if(store && typeof store.pruneSelectedEmployees === 'function'){
              store.pruneSelectedEmployees(employees.map(emp => emp.id));
            } else if(store && Array.isArray(store.selectedEmployeeIds)){
              const valid = new Set(employees.map(emp => (emp?.id == null ? '' : String(emp.id))));
              store.selectedEmployeeIds = store.selectedEmployeeIds.filter(id => valid.has(id == null ? '' : String(id)));
            }
            this.requirements = requirements;
            this.employeeRequirements = employeeRequirements;

            await this.loadEmployeeLookups();

            this.erMap = new Map();
            for (const er of this.employeeRequirements){
              if(!this.erMap.has(er.employeeId)) this.erMap.set(er.employeeId,new Map());
              this.erMap.get(er.employeeId).set(er.requirementId, er);
            }

            await this.loadVisibleRequirements();
            await this.loadTemplates();
            await this.collectComplianceSnapshot();
            this.renderComplianceChart();
            this.touchGlobalSearchVersion();

            if (!this.loadError) {
              hideFallback();
              this.filterEmployees();
            }

            if(!this.appReady && !this.loadError && this.db){
              this.setAppReady(true);
            }
          } catch (error) {
            console.error('Failed to load dashboard data from IndexedDB', error);

            this.employees = [];
            this.requirements = [];
            this.employeeRequirements = [];
            this.erMap = new Map();

            const store = Alpine.store('app');
            if(store && typeof store.clearSelectedEmployees === 'function'){
              store.clearSelectedEmployees();
            } else if(store){
              store.selectedEmployeeIds = [];
            }

            const friendlyMessage = 'We couldn\'t access the local dashboard database. Private browsing or low device storage can block offline data. Reload in a standard window or free up space, then try again.';
            this.loadError = friendlyMessage;

            showFallback();
            this.setAppReady(false);

            if (typeof this.$nextTick === 'function') {
              this.$nextTick(() => this.$root?.removeAttribute('x-cloak'));
            }
          }
        },

        setAppReady(isReady){
          const nextReady = Boolean(isReady);
          const previous = this.appReady;
          this.appReady = nextReady;

          if(previous !== nextReady){
            flushTimelineReadyWaits();
          }

          if(this.appReady && this.db){
            if(!this.initialReadyDispatched){
              this.initialReadyDispatched = true;
              appState.markReady();
            }
            timelineReadyGiveUpLogged = false;
          } else if(!this.appReady && this.loadError){
            this.initialReadyDispatched = false;
            appState.fail(new Error(this.loadError));
          } else if(!this.appReady){
            this.initialReadyDispatched = false;
            appState.markLoading();
          }

          if(this.appReady && this.pendingTimelineRefresh){
            this.pendingTimelineRefresh = false;
            this.$nextTick(() => {
              this.$refs.activityTimeline?.load();
            });
          }
        },

        touchGlobalSearchVersion(){
          this.globalSearchDataVersion += 1;
          this.globalSearchIndex = null;
          this.globalSearchIndexVersion = -1;
          this.globalSearchData = [];
        },

        async loadVisibleRequirements(){
          if (this.loadError || !this.db) return;
          const setting = await this.db.settings.get('visibleRequirements');
          if(setting && Array.isArray(setting.value)){
            const map = new Map(setting.value.map(s => [s.id, s]));
            this.visibleRequirements = this.requirements.map((r, idx) => {
              const pref = map.get(r.id);
              return { ...r, order: pref?.order ?? idx, visible: pref?.visible ?? true };
            });
            let changed = this.visibleRequirements.length !== setting.value.length;
            this.visibleRequirements.sort((a,b) => a.order - b.order);
            if(changed) await this.saveRequirementsSettings();
          } else {
            this.visibleRequirements = this.requirements.map((r, idx) => ({ ...r, order: idx, visible: true }));
            await this.saveRequirementsSettings();
          }
        },

        async saveRequirementsSettings(){
          if (this.loadError || !this.db) return;
          await this.db.settings.put({
            id:'visibleRequirements',
            value: this.visibleRequirements.map(r => ({id:r.id, order:r.order, visible:r.visible}))
          });
        },

        async loadTemplates(){
          if (this.loadError || !this.db || !this.db.roleRequirementProfiles){
            this.templates = [];
            this.templateRoleMap = new Map();
            return;
          }
          try{
            const raw = await this.db.roleRequirementProfiles.toArray();
            const validIds = new Set(this.requirements.map(r => r.id));
            const sanitized = [];
            const dirty = [];
            for (const template of raw){
              const roles = Array.isArray(template.roles)
                ? template.roles.map(role => (role ?? '').toString().trim()).filter(Boolean)
                : [];
              const excluded = Array.isArray(template.excludedRequirementIds)
                ? template.excludedRequirementIds.filter(id => validIds.has(id))
                : [];
              const sanitizedTemplate = {
                ...template,
                roles,
                excludedRequirementIds: excluded
              };
              sanitized.push(sanitizedTemplate);
              const originalRoleCount = Array.isArray(template.roles)
                ? template.roles.filter(role => (role ?? '').toString().trim()).length
                : 0;
              const originalExcludedCount = Array.isArray(template.excludedRequirementIds)
                ? template.excludedRequirementIds.length
                : 0;
              if (roles.length !== originalRoleCount || excluded.length !== originalExcludedCount){
                dirty.push(sanitizedTemplate);
              }
            }
            if (dirty.length){
              await Promise.all(dirty.map(t => this.db.roleRequirementProfiles.put(t)));
            }
            this.templates = sanitized;
          }catch(error){
            console.error('Failed to load templates', error);
            this.templates = [];
          }
          this.rebuildTemplateRoleMap();
        },

        rebuildTemplateRoleMap(){
          const map = new Map();
          for (const template of this.templates){
            const roles = Array.isArray(template.roles) ? template.roles : [];
            for (const role of roles){
              const key = this.normalizeRole(role);
              if (key && !map.has(key)){
                map.set(key, template);
              }
            }
          }
          this.templateRoleMap = map;
        },

        normalizeRole(role){
          return (role ?? '').toString().trim().toLowerCase();
        },

        getTemplateForRole(role){
          return this.templateRoleMap.get(this.normalizeRole(role)) || null;
        },

        getTemplateRequirementList(){
          const source = this.visibleRequirements?.length ? [...this.visibleRequirements] : [...this.requirements];
          return source.sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
        },

        startTemplateCreate(){
          this.showTemplateForm = true;
          this.templateEditor = { id:null, name:'', rolesInput:'', excludedRequirementIds:[] };
        },

        editTemplate(template){
          if(!template) return;
          this.showTemplateForm = true;
          this.templateEditor = {
            id: template.id,
            name: template.name || '',
            rolesInput: (template.roles || []).join(', '),
            excludedRequirementIds: Array.isArray(template.excludedRequirementIds) ? [...template.excludedRequirementIds] : []
          };
        },

        cancelTemplateEdit(){
          this.showTemplateForm = false;
          this.templateEditor = { id:null, name:'', rolesInput:'', excludedRequirementIds:[] };
        },

        toggleTemplateRequirement(reqId, required){
          const current = new Set(this.templateEditor.excludedRequirementIds || []);
          if(required){
            current.delete(reqId);
          } else {
            current.add(reqId);
          }
          this.templateEditor.excludedRequirementIds = Array.from(current);
        },

        templateRequirementCount(template){
          if(!template) return 0;
          const excluded = Array.isArray(template.excludedRequirementIds) ? template.excludedRequirementIds.length : 0;
          return Math.max(0, this.requirements.length - excluded);
        },

        async saveTemplate(){
          if (this.loadError || !this.db) return;
          const name = (this.templateEditor.name || '').trim();
          if(!name){
            this.notify('Template name is required', 'var(--danger)');
            return;
          }
          const roles = (this.templateEditor.rolesInput || '')
            .split(',')
            .map(r => r.trim())
            .filter(Boolean);
          const validIds = new Set(this.requirements.map(r => r.id));
          const excluded = Array.from(new Set((this.templateEditor.excludedRequirementIds || []).filter(id => validIds.has(id))));
          const timestamp = new Date().toISOString();
          let createdAt = timestamp;
          if (this.templateEditor.id){
            const existing = this.templates.find(t => t.id === this.templateEditor.id);
            if (existing?.createdAt){
              createdAt = existing.createdAt;
            }
          }
          const payload = {
            id: this.templateEditor.id || generateId(),
            name,
            roles,
            excludedRequirementIds: excluded,
            createdAt,
            updatedAt: timestamp
          };
          try{
            await this.db.roleRequirementProfiles.put(payload);
            await this.loadTemplates();
            this.cancelTemplateEdit();
            this.notify('Template saved');
          }catch(error){
            console.error('Failed to save template', error);
            this.notify('Failed to save template', 'var(--danger)');
          }
        },

        confirmDeleteTemplate(template){
          if(!template) return;
          if(confirm(`Delete template "${template.name}"?`)){
            this.deleteTemplate(template.id);
          }
        },

        async deleteTemplate(templateId){
          if (this.loadError || !this.db || !templateId) return;
          try{
            await this.db.roleRequirementProfiles.delete(templateId);
            if(this.templateEditor.id === templateId){
              this.cancelTemplateEdit();
            }
            await this.loadTemplates();
            this.notify('Template deleted', 'var(--warn)');
          }catch(error){
            console.error('Failed to delete template', error);
            this.notify('Failed to delete template', 'var(--danger)');
          }
        },

        async applyTemplateToRoles(template){
          if(!template) return;
          const roles = (template.roles || []).map(r => this.normalizeRole(r)).filter(Boolean);
          if(!roles.length){
            this.notify('Add at least one role before applying.', 'var(--warn)');
            return;
          }
          const matches = this.employees
            .filter(emp => roles.includes(this.normalizeRole(emp.role)))
            .map(emp => emp.id);
          if(!matches.length){
            this.notify('No employees matched the template roles.', 'var(--warn)');
            return;
          }
          await this.applyTemplateToEmployees(template, matches);
        },

        async applyTemplateToSelection(template){
          if(!template) return;
          const ids = Array.from(new Set(this.selectedEmployees));
          if(!ids.length){
            this.notify('Select employees before applying a template.', 'var(--warn)');
            return;
          }
          await this.applyTemplateToEmployees(template, ids);
        },

        async applyTemplateToEmployees(template, employeeIds){
          if (this.loadError || !this.db || !Array.isArray(employeeIds) || !employeeIds.length) return;
          this.templateApplyLoading = true;
          try{
            const { ApplyTemplateToEmployees } = await import('./commands.js');
            const command = new ApplyTemplateToEmployees(this.db, {
              template,
              employeeIds,
              requirements: this.requirements
            });
            await this.runCommand({
              command,
              actionType: 'ApplyTemplateToEmployees',
              targets: [...employeeIds],
              metadata: {
                templateId: template?.id,
                templateName: template?.name,
                employeeIds: [...employeeIds],
                excludedRequirementIds: Array.isArray(template?.excludedRequirementIds)
                  ? [...template.excludedRequirementIds]
                  : []
              },
              successMessage: `Template applied to ${employeeIds.length} employee${employeeIds.length === 1 ? '' : 's'}.`,
              successColor: 'var(--accent)',
              undoMessage: `Template application undone for ${employeeIds.length} employee${employeeIds.length === 1 ? '' : 's'}.`,
              refreshIcons: true
            });
          }catch(error){
            console.error('Failed to apply template to employees', error);
            this.notify('Failed to apply template', 'var(--danger)');
          }finally{
            this.templateApplyLoading = false;
          }
        },

        orderedVisibleRequirements(){
          return this.visibleRequirements.filter(r => r.visible).sort((a,b) => a.order - b.order);
        },

        openSettingsModal(){
          if(!this.appReady){
            console.warn('Attempted to open settings before app ready.');
            return;
          }
          this.cancelTemplateEdit();
          this.showSettingsModal = true;
          this.$nextTick(() => {
            if(this.settingsSortable) this.settingsSortable.destroy();
            this.settingsSortable = Sortable.create(this.$refs.settingsList, {
              handle: '.handle',
              animation: 150,
              onEnd: (evt) => {
                const moved = this.visibleRequirements.splice(evt.oldIndex,1)[0];
                this.visibleRequirements.splice(evt.newIndex,0,moved);
                this.visibleRequirements.forEach((r,i)=> r.order = i);
              }
            });
            this.refreshFeatherIcons();
          });
        },

        async saveAndCloseSettings(){
          this.visibleRequirements.forEach((r,i)=> r.order=i);
          await this.saveRequirementsSettings();
          this.cancelTemplateEdit();
          this.showSettingsModal = false;
          this.touchGlobalSearchVersion();
          this.refreshFeatherIcons();
        },

        // Status helpers (minimal)
          getER(eId,rId){ return this.erMap.get(eId)?.get(rId) || null; },
          getStatus(eId,rId){
            const er=this.getER(eId,rId);
            if(!er) return 'NotCompleted';
            if(er.status==='NotRequired') return 'NotRequired';
            if(er.status!=='Completed') return 'NotCompleted';
            if(er.expiresOn){
              const d=Math.ceil((new Date(er.expiresOn)-new Date())/86400000);
              if(d<=0) return 'Expired';
            }
            return 'Completed';
          },
          calcStatus(eId,rId){
            const er=this.getER(eId,rId);
            if(!er) return 'incomplete';
            if(er.status==='NotRequired') return 'not-required';
            if(er.status!=='Completed') return 'incomplete';
            if(er.expiresOn){
              const d=Math.ceil((new Date(er.expiresOn)-new Date())/86400000);
              if(d<=0) return 'overdue';
              if(d<=30) return 'expiring';
            }
            return 'compliant';
          },
          async toggleStatus(emp, req){
            console.log('Toggle clicked for:', emp.firstName, emp.lastName, req.name);

            try {
              const er=this.getER(emp.id, req.id);
              if(er?.status === 'NotRequired'){
                this.notify('This requirement is marked as not required for this employee.', 'var(--warn)');
                return;
              }
              const previousStatus = er?.status ?? 'NotCompleted';
              const newStatus = previousStatus === 'Completed' ? 'NotCompleted' : 'Completed';
              console.log('Current status:', previousStatus, 'New status:', newStatus);

              const completedOn = newStatus === 'Completed' ? new Date().toISOString().slice(0,10) : null;
              const hasDefaultExpiry = req?.defaultExpiryDays !== undefined && req?.defaultExpiryDays !== null;
              const expiresOn = newStatus === 'Completed'
                ? (hasDefaultExpiry ? this.addDays(completedOn, req.defaultExpiryDays) : null)
                : null;

              const { BulkUpdateStatus } = await import('./commands.js');
              const command = new BulkUpdateStatus(this.db, {
                employeeIds: [emp.id],
                requirementIds: [req.id],
                status: newStatus,
                completedOn,
                expiresOn
              });

              const undoPayload = await command.execute();
              await this.loadData();

              if (undoPayload?.changes?.length) {
                await this.recordActivity('BulkUpdateStatus', [emp.id], {
                  employeeIds: [emp.id],
                  requirementIds: [req.id],
                  requirementName: req?.name,
                  status: newStatus,
                  previousStatus,
                  completedOn,
                  expiresOn,
                  triggeredBy: 'toggleStatus'
                }, undoPayload);
              }

              console.log('Toggle completed');
            } catch (error) {
              console.error('Error toggling status:', error);
              if (error && error.stack) {
                console.error(error.stack);
              }
              const message = error && error.message ? `Error updating status: ${String(error.message)}` : 'Error updating status. Please try again.';
              this.notify(message, 'var(--danger)');
            }
          },

        // UI helpers
        notify(msg,color='var(--success)',undoHandler=null,duration=3000){
          const hasAlpineStore = typeof Alpine !== 'undefined' && typeof Alpine.store === 'function';
          if(hasAlpineStore){
            let type = 'success';
            const normalized = typeof color === 'string' ? color.toLowerCase() : '';
            if(normalized.includes('danger') || normalized.includes('error')){
              type = 'error';
            } else if(normalized.includes('warn') || normalized.includes('warning') || normalized.includes('accent')){
              type = 'info';
            }
            const store = Alpine.store('app');
            if(store && typeof store.showToast === 'function'){
              const payload = {
                type,
                message: typeof msg === 'string' ? msg : String(msg ?? '')
              };
              if(typeof duration === 'number' && Number.isFinite(duration)){
                payload.duration = duration;
              }
              if(typeof undoHandler === 'function'){
                payload.action = { label: 'Undo', handler: undoHandler };
              }
              store.showToast(payload);
              return;
            }
          }
          if(typeof window !== 'undefined' && typeof window.alert === 'function'){
            window.alert(typeof msg === 'string' ? msg : String(msg ?? ''));
          }
        },
        async runCommand({
          command,
          actionType,
          targets = [],
          metadata = {},
          successMessage = '',
          successColor = 'var(--success)',
          undoMessage = 'Action undone',
          undoColor = 'var(--success)',
          undoErrorMessage = 'Failed to undo action',
          refresh = true,
          refreshIcons = false,
          toastDuration = 10000,
          supportsUndo = true
        } = {}){
          if (!command || typeof command.execute !== 'function') {
            throw new Error('runCommand requires a command instance with execute()');
          }

          const undoPayload = await command.execute();
          let entry = null;
          if (actionType) {
            entry = await this.recordActivity(actionType, targets, metadata, undoPayload, { supportsUndo });
          }

          if (refresh) {
            await this.loadData();
            if (refreshIcons && typeof this.refreshFeatherIcons === 'function') {
              this.refreshFeatherIcons();
            }
          }

          const undoHandler = supportsUndo === false ? null : async () => {
            try {
              if (entry && this.activityLog) {
                await this.activityLog.undo(entry.id, () => command);
              } else if (typeof command.undo === 'function') {
                await command.undo(undoPayload);
              }
              if (refresh) {
                await this.loadData();
                if (refreshIcons && typeof this.refreshFeatherIcons === 'function') {
                  this.refreshFeatherIcons();
                }
              }
              if (undoMessage) {
                this.notify(undoMessage, undoColor);
              }
            } catch (error) {
              console.error(`Failed to undo ${actionType || 'command'}`, error);
              this.notify(undoErrorMessage, 'var(--danger)');
            }
          };

          if (successMessage) {
            this.notify(successMessage, successColor, undoHandler, toastDuration);
          }

          return { undo: undoHandler, entry, undoPayload };
        },
        promptTour(){
          this.tourPromptActive=true;
          this.highlightHelpButton=true;
          this.notify('Need a walkthrough? Click Help to start the tour.', 'var(--accent)', null, 6000);
        },
        async beginTour(){
          if(typeof startTour === 'function'){
            startTour();
          }
          await this.markTourSeen();
        },
        async markTourSeen(){
          this.highlightHelpButton=false;
          if(this.tourPromptActive){
            this.tourPromptActive=false;
            if(typeof Alpine !== 'undefined' && typeof Alpine.store === 'function'){
              const store = Alpine.store('app');
              if(store){
                if(typeof store.hideToast === 'function'){
                  store.hideToast();
                } else {
                  store.toast = null;
                }
              }
            }
          }
          if(this.tourMarkedSeen){
            return;
          }
          if(!this.db){
            this.tourMarkedSeen=true;
            return;
          }
          try{
            const existing = await this.db.settings.get('hasSeenTour');
            if(existing?.value){
              this.tourMarkedSeen=true;
              return;
            }
            const payload = existing ? {...existing, value:true} : {id:'hasSeenTour', value:true};
            await this.db.settings.put(payload);
            this.tourMarkedSeen=true;
          }catch(error){
            console.error('Failed to persist tour completion', error);
          }
        },
        async recordActivity(actionType, targets = [], metadata = {}, undoPayload = null, options = {}){
          if(!this.activityLog) return null;
          try{
            const entry = await this.activityLog.record({
              actionType,
              actor:'user',
              targets,
              metadata,
              undoPayload,
              supportsUndo: options.supportsUndo !== false
            });
            if(this.appReady){
              this.$refs.activityTimeline?.load();
            } else {
              this.pendingTimelineRefresh = true;
            }
            return entry;
          }catch(error){
            console.error('Failed to record activity', error);
            return null;
          }
        },
        applyDarkMode(isDark){
          const next = Boolean(isDark);
          this.darkMode = next;
          applyDocumentDarkMode(next);
        },
        setupThemeWatcher(){
          if(this.themeMediaCleanup){
            this.themeMediaCleanup();
            this.themeMediaCleanup = null;
          }
          if(hasStoredThemePreference()){
            return;
          }
          this.themeMediaCleanup = watchSystemThemeChange((matches) => {
            if(hasStoredThemePreference()){
              this.teardownThemeWatcher();
              return;
            }
            this.applyDarkMode(matches);
            this.renderComplianceChart();
          });
        },
        teardownThemeWatcher(){
          if(this.themeMediaCleanup){
            this.themeMediaCleanup();
            this.themeMediaCleanup = null;
          }
        },
        async toggleDarkMode(){
          const next=!this.darkMode;
          this.applyDarkMode(next);
          this.teardownThemeWatcher();
          this.renderComplianceChart();
          persistThemePreference(next ? 'dark' : 'light');
          if(!hasStoredThemePreference()){
            this.setupThemeWatcher();
          }
        },
        initializeFeatherIcons() {
          try {
            safeFeatherReplace();
          } catch (error) {
            console.warn('Feather icons initialization error:', error);
          }
        },
        refreshFeatherIcons(){
          this.$nextTick(() => {
            this.initializeFeatherIcons();
          });
        },

        recordImportLog(message, level = 'info', meta = null){
          const logs = Array.isArray(this.importDiagnostics.logs) ? [...this.importDiagnostics.logs] : [];
          const timestamp = new Date().toISOString();
          let text;
          if (typeof message === 'string') {
            text = message;
          } else {
            try {
              text = JSON.stringify(message);
            } catch (_) {
              text = String(message ?? '');
            }
          }
          logs.push({ timestamp, level: level || 'info', message: text, meta: meta ?? null });
          const maxLogs = 200;
          const trimmed = logs.slice(Math.max(0, logs.length - maxLogs));
          this.importDiagnostics = { ...this.importDiagnostics, logs: trimmed };
        },

        formatImportTimestamp(value){
          if(!value){
            return 'Never';
          }
          try {
            const date = new Date(value);
            if(Number.isNaN(date.getTime())){
              return String(value);
            }
            return date.toLocaleString();
          } catch (_) {
            return String(value);
          }
        },

        formatImportTime(value){
          if(!value){
            return '—';
          }
          try {
            const date = new Date(value);
            if(Number.isNaN(date.getTime())){
              return String(value);
            }
            return date.toLocaleTimeString();
          } catch (_) {
            return String(value);
          }
        },

        formatImportLogEntry(entry){
          if(!entry){
            return '';
          }
          const timestamp = this.formatImportTime(entry.timestamp);
          const level = (entry.level || 'info').toUpperCase();
          const message = entry.message || '';
          return `[${timestamp}] ${level}: ${message}`;
        },

        recentImportLogs(){
          const logs = Array.isArray(this.importDiagnostics.logs) ? this.importDiagnostics.logs : [];
          return logs.slice(-10).reverse();
        },

        captureImportOutcome({ status = 'success', summary = '', details = null, logMessage = null, level = null } = {}){
          const timestamp = new Date().toISOString();
          const normalizedStatus = status || 'success';
          const nextState = {
            ...this.importDiagnostics,
            lastImportTime: timestamp,
            lastImportStatus: normalizedStatus,
            lastImportResult: summary || '',
            lastImportDetails: details ?? null
          };
          this.importDiagnostics = nextState;
          const logLevel = level || (normalizedStatus === 'error' ? 'error' : 'info');
          const message = logMessage || summary || (normalizedStatus === 'error' ? 'Import failed' : 'Import completed');
          this.recordImportLog(message, logLevel, details ?? null);
        },

        toggleImportDiagnosticsPanel(){
          this.importDiagnosticsPanelOpen = !this.importDiagnosticsPanelOpen;
          if(this.importDiagnosticsPanelOpen){
            this.refreshImportDiagnostics();
          }
        },

        async refreshImportDiagnostics(){
          if(this.importDiagnosticsLoading){
            return;
          }
          this.importDiagnosticsLoading = true;
          const nextState = { ...this.importDiagnostics, storeCounts: [] };
          const logQueue = [];

          try {
            await ensureDexieLoaded();
            const DexieCtor = getDexie();
            if(DexieCtor && typeof DexieCtor.semVer === 'string' && DexieCtor.semVer){
              nextState.dexieVersion = DexieCtor.semVer;
            } else if (DexieCtor && typeof DexieCtor.version === 'string' && DexieCtor.version) {
              nextState.dexieVersion = DexieCtor.version;
            } else {
              nextState.dexieVersion = 'Unknown';
            }
          } catch (dexieError) {
            nextState.dexieVersion = 'Unavailable';
            logQueue.push({ message: `Dexie load failed: ${dexieError?.message || dexieError}`, level: 'error' });
          }

          let db = this.db;
          let closeWhenDone = false;
          try {
            if(!db){
              db = await openDatabase();
              closeWhenDone = true;
            } else if(!db.isOpen()) {
              await db.open();
            }

            if(db){
              nextState.indexedDbStatus = db.isOpen() ? 'Open' : 'Closed';
              if(Array.isArray(db.tables)){
                const counts = [];
                for(const table of db.tables){
                  if(!table || !table.name){
                    continue;
                  }
                  try {
                    const count = await table.count();
                    counts.push({ name: table.name, count, error: '' });
                  } catch (countError) {
                    counts.push({ name: table.name, count: null, error: countError?.message || String(countError) });
                  }
                }
                counts.sort((a, b) => a.name.localeCompare(b.name));
                nextState.storeCounts = counts;
              }
            } else {
              nextState.indexedDbStatus = 'Unavailable';
            }
          } catch (dbError) {
            nextState.indexedDbStatus = `Error: ${dbError?.message || dbError}`;
            nextState.storeCounts = [];
            logQueue.push({ message: `IndexedDB check failed: ${dbError?.message || dbError}`, level: 'error' });
          } finally {
            if(closeWhenDone && db){
              try {
                db.close();
              } catch (_) {
                // Ignore close errors
              }
            }
            nextState.logs = Array.isArray(this.importDiagnostics.logs) ? [...this.importDiagnostics.logs] : [];
            this.importDiagnostics = nextState;
            this.importDiagnosticsLoading = false;
            if(logQueue.length){
              for(const entry of logQueue){
                if(entry && entry.message){
                  this.recordImportLog(entry.message, entry.level || 'info');
                }
              }
            }
          }
        },

        async copyImportLogs(){
          const logs = Array.isArray(this.importDiagnostics.logs) ? this.importDiagnostics.logs : [];
          if(!logs.length){
            this.notify('No import logs available to copy.', 'var(--warn)');
            return;
          }
          const text = logs.map(entry => this.formatImportLogEntry(entry)).join('\n');
          try {
            if(typeof navigator !== 'undefined' && navigator?.clipboard?.writeText){
              await navigator.clipboard.writeText(text);
            } else {
              const textarea = document.createElement('textarea');
              textarea.value = text;
              textarea.setAttribute('readonly', '');
              textarea.style.position = 'fixed';
              textarea.style.opacity = '0';
              document.body.appendChild(textarea);
              textarea.select();
              document.execCommand('copy');
              document.body.removeChild(textarea);
            }
            this.notify('Import logs copied to clipboard.');
            this.recordImportLog('Import logs copied to clipboard.');
          } catch (error) {
            console.error('Failed to copy import logs', error);
            this.notify('Failed to copy import logs. See console for details.', 'var(--danger)');
            this.recordImportLog(`Failed to copy import logs: ${error?.message || error}`, 'error');
          }
        },

        // ---------- Import ----------
        async handleFileUpload(event){
          this.importError=''; this.importWarning=''; this.importData=[]; this.importHeaders=[]; this.importSheets=[]; this.importSheetName=''; this.previewEligible=0; this.dryRunDetails=[]; this.importProgress=0; this.importErrors=[];
          this.dryRunSummary = { added:0, updated:0, skipped:0 };
          this.columnMap = { firstName:'', lastName:'', payrollName:'', role:'', employmentType:'', employeeId:'', status:'', seniorityHours:'' };
          this.completionMap = {};
          this.backupPayload = null;
          this.backupSummary = null;
          this.backupValidationErrors = [];
          this.duplicateHeaderGroups = [];
          this.duplicateHeaderNames = [];
          this.duplicateHeaderWarningDismissed = false;
          this.duplicateHeaderSignature = '';
          this.importLoading=true;
          this.recordImportLog('Import session initialized.');
          const file = event.target.files?.[0];
          if(!file) { this.importLoading=false; this.recordImportLog('Import cancelled: no file selected.', 'warn'); return; }

          const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
          this.recordImportLog(`File selected: ${file.name} (${sizeMb} MB) [mode: ${this.importMode}]`);

          // File validation
          const maxSize = 10 * 1024 * 1024; // 10MB
          if (file.size > maxSize) {
            this.importError = 'File size exceeds 10MB limit. Please choose a smaller file.';
            this.importLoading = false;
            this.recordImportLog(`File rejected: ${file.name} exceeds 10MB limit.`, 'warn');
            return;
          }

          const fileExtension = '.' + file.name.split('.').pop().toLowerCase();

          if (this.importMode === 'backup') {
            if (fileExtension !== '.json') {
              this.importError = 'Backups must be uploaded as JSON (.json).';
              this.importLoading = false;
              this.recordImportLog('Backup import failed: file must be JSON.', 'warn');
              return;
            }
            try {
              this.recordImportLog(`Loading backup file: ${file.name}`);
              await this.loadBackupFromFile(file);
            } finally {
              this.importLoading = false;
              this.recordImportLog('Backup file processed.');
            }
            return;
          }

          const allowedTypes = ['.csv', '.xlsx', '.xls'];
          if (!allowedTypes.includes(fileExtension)) {
            this.importError = 'Invalid file type. Please upload a CSV or Excel file (.csv, .xlsx, .xls).';
            this.importLoading = false;
            this.recordImportLog(`File rejected: unsupported type ${fileExtension}`, 'warn');
            return;
          }

          // Auto-detect import type based on file extension if not set correctly
          if (fileExtension === '.csv' && this.importType === 'excel') {
            this.importType = 'csv';
          } else if ((fileExtension === '.xlsx' || fileExtension === '.xls') && this.importType === 'csv') {
            this.importType = 'excel';
          }

          if (this.importType === 'csv') {
            if (typeof Papa === 'undefined') {
              this.importError = 'CSV parsing library is unavailable. Check your internet connection and try again.';
              this.importLoading = false;
              this.recordImportLog('CSV parsing library unavailable.', 'error');
              return;
            }
            const text = await file.text();
            const lines = text.split(/\r?\n/);
            const body = this.stripTitleLines(lines);
            let res;
            try {
              res = Papa.parse(body, { header:true, skipEmptyLines:true });
            } catch (parseError) {
              console.error('Failed to parse CSV file', parseError);
              this.importError = 'We could not read the CSV file. Ensure it is properly formatted and try again.';
              this.importLoading = false;
              this.recordImportLog(`CSV parse failed for ${file.name}: ${parseError?.message || parseError}`, 'error');
              return;
            }
            this.importData = res.data; this.importHeaders = res.meta.fields || [];
            const trimmed = (res.meta.fields || []).map(h => h.trim());
            this.importData = res.data.map(row => {
              const obj = {};
              trimmed.forEach((h, i) => obj[h] = row[res.meta.fields[i]]);
              return obj;
            });
            this.importHeaders = trimmed;
            await this.handleDuplicateHeaders({
              rawHeaders: res.meta?.fields || [],
              displayHeaders: trimmed,
              renamedHeaders: res.meta?.renamedHeaders || {}
            });
            this.autoMapColumns(this.importHeaders);
            this.updateEligibilityPreview();
            await this.validateImportData();
            if (!this.importHeaders.length) this.importError = 'No headers detected — check the CSV file.';
            this.importLoading = false;
            this.recordImportLog(`CSV loaded: ${file.name} (${this.importData.length} rows, ${this.importHeaders.length} headers)`);
          } else {
            let xlsx;
            try {
              xlsx = await loadXlsx();
            } catch (loaderError) {
              console.error('Failed to load XLSX library:', loaderError);
              this.importError = 'XLSX still unavailable. Please check your connection and try again.';
              this.importLoading = false;
              if (this.importType === 'excel') {
                this.importType = 'csv';
                this.recordImportLog('Excel import disabled: XLSX library unavailable. Falling back to CSV mode.', 'warn');
              }
              this.recordImportLog(`Failed to load XLSX library: ${loaderError?.message || loaderError}`, 'error');
              return;
            }
            const reader = new FileReader();
            reader.onload = async (e) => {
              try{
                const data = new Uint8Array(e.target.result);
                const wb = xlsx.read(data, { type:'array', cellDates: true, cellNF: false, cellText: false });

                if (!wb.SheetNames || wb.SheetNames.length === 0) {
                  this.importError = 'No worksheets found in the Excel file.';
                  return;
                }

                this.importSheets = wb.SheetNames;
                let best = { name: wb.SheetNames[0], score: -1, headers: [], rows: [] };

                for (const name of wb.SheetNames){
                  try {
                    const { headers, rows, score } = this.extractFromSheet(wb.Sheets[name], xlsx);
                    if (score > best.score) best = { name, score, headers, rows };
                  } catch (sheetErr) {
                    console.warn(`Error processing sheet "${name}":`, sheetErr);
                    continue;
                  }
                }
                
                this.importSheetName = best.name;
                this.importHeaders = best.headers;
                this.importData = best.rows;
                await this.handleDuplicateHeaders({ rawHeaders: best.headers, displayHeaders: best.headers });
                this.autoMapColumns(this.importHeaders);
                this.updateEligibilityPreview();
                await this.validateImportData();

                if (!this.importHeaders.length) {
                  this.importError = 'Could not detect headers in Excel sheet. Try selecting a different worksheet above or check if the file has proper column headers.';
                } else if (this.importData.length === 0) {
                  this.importError = 'No data rows found in the selected worksheet.';
                }
                this.importLoading = false;
                this.recordImportLog(`Excel loaded: ${file.name} • Sheet ${this.importSheetName} (${this.importData.length} rows, ${this.importHeaders.length} headers)`);
              }catch(err){
                console.error('Excel processing error:', err);
                this.importError = `Failed to read Excel file: ${err.message || 'Unknown error'}. Ensure it is .xlsx or .xls format and not password protected.`;
                this.importLoading = false;
                this.recordImportLog(`Excel processing error for ${file.name}: ${err?.message || err}`, 'error');
              }
            };
            reader.onerror = () => {
              this.importError = 'Failed to read the file. Please try again.';
              this.recordImportLog(`File read failed for ${file.name}.`, 'error');
              this.importLoading = false;
            };
            reader.readAsArrayBuffer(file);
          }
        },
        async selectExcelSheet(name){
          const input = document.getElementById('file-upload');
          const file = input?.files?.[0];
          if(!file || !name) return;
          this.importError = '';
          this.importProgress = 0;
          this.importErrors = [];
          this.dryRunSummary = { added:0, updated:0, skipped:0 };
          this.columnMap = { firstName:'', lastName:'', payrollName:'', role:'', employmentType:'', employeeId:'', status:'', seniorityHours:'' };
          this.completionMap = {};
          this.backupPayload = null;
          this.backupSummary = null;
          this.backupValidationErrors = [];
          let xlsx;
          try {
            xlsx = await loadXlsx();
          } catch (loaderError) {
            console.error('Failed to load XLSX library:', loaderError);
            this.importError = 'XLSX still unavailable. Please check your connection and try again.';
            if (this.importType === 'excel') {
              this.importType = 'csv';
              this.recordImportLog('Excel import disabled while switching sheets: XLSX library unavailable. Falling back to CSV mode.', 'warn');
            }
            this.recordImportLog(`Failed to load XLSX library while switching sheet: ${loaderError?.message || loaderError}`, 'error');
            return;
          }
          const reader = new FileReader();
          reader.onload = async (e) => {
            try {
              this.recordImportLog(`Switching Excel sheet to ${name}`);
              const data = new Uint8Array(e.target.result);
              const wb = xlsx.read(data, { type:'array', cellDates: true, cellNF: false, cellText: false });

              if (!wb.Sheets[name]) {
                this.importError = `Worksheet "${name}" not found in the file.`;
                this.recordImportLog(`Worksheet ${name} not found in workbook.`, 'warn');
                return;
              }

              const { headers, rows } = this.extractFromSheet(wb.Sheets[name], xlsx);
              this.importHeaders = headers;
              this.importData = rows;
              this.duplicateHeaderSignature = '';
              await this.handleDuplicateHeaders({ rawHeaders: headers, displayHeaders: headers });
              this.autoMapColumns(this.importHeaders);
              this.updateEligibilityPreview();
              await this.validateImportData();

              if (!this.importHeaders.length) {
                this.importError = `No headers detected in worksheet "${name}".`;
                this.recordImportLog(`No headers detected when switching to sheet ${name}.`, 'warn');
              } else if (this.importData.length === 0) {
                this.importError = `No data rows found in worksheet "${name}".`;
                this.recordImportLog(`No data rows found when switching to sheet ${name}.`, 'warn');
              } else {
                this.recordImportLog(`Excel sheet "${name}" loaded (${this.importData.length} rows, ${this.importHeaders.length} headers).`);
              }
            } catch (err) {
              console.error('Error selecting Excel sheet:', err);
              this.importError = `Failed to process worksheet "${name}": ${err.message || 'Unknown error'}`;
              this.recordImportLog(`Failed to process worksheet ${name}: ${err?.message || err}`, 'error');
            }
          };
          reader.onerror = () => {
            this.importError = 'Failed to read the file. Please try again.';
            this.recordImportLog('Failed to read file while switching sheets.', 'error');
          };
          reader.readAsArrayBuffer(file);
        },
        async validateImportData(){
          const total = this.importData.length;
          this.importErrors = [];
          this.importProgress = 0;
          if (!total){ this.importProgress = 100; return; }
          for(let i=0;i<total;i++){
            const a = this.analyzeRow(this.importData[i]);
            if(!a.first || !a.last){
              this.importErrors.push({row:i+1, message:'Missing first or last name'});
            }
            this.importProgress = Math.round(((i+1)/total)*100);
            await new Promise(r=>setTimeout(r));
          }
        },
        downloadImportErrors(){
          if(!this.importErrors.length){
            this.recordImportLog('Download import errors requested, but there are no errors.', 'warn');
            return;
          }
          const rows = [['Row','Error'], ...this.importErrors.map(e=>[e.row, e.message])];
          const newline = '\n';
          const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join(newline);
          const blob = new Blob([csv], {type:'text/csv'});
          this.downloadBlob(blob, 'import-errors.csv');
          this.recordImportLog('Import errors downloaded.');
        },
        stripTitleLines(lines){
          let bestIdx=0, bestScore=-1;
          for(let i=0;i<Math.min(30,lines.length);i++){ const cols=(lines[i]||'').split(',').map(s=>s.replace(/\"/g,'').trim()); const sc=this.scoreHeaderRow(cols); if(sc>bestScore){bestScore=sc;bestIdx=i;} }
          const newline = '\n';
          return lines.slice(bestIdx).join(newline);
        },
        extractFromSheet(sheet, xlsxLib){
          try {
            const lib = xlsxLib || cachedXlsx || resolveXlsxFromGlobals();
            if(!lib) throw new Error('XLSX still unavailable');
            const aoa = lib.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
            
            if (!aoa || aoa.length === 0) {
              return { headers: [], rows: [], score: -1 };
            }
            
            let bestIdx = 0, bestScore = -1;
            for (let i=0; i<Math.min(30, aoa.length); i++){
              const row = (aoa[i]||[]).map(v => (v==null || v===undefined ? '' : String(v).trim()));
              const score = this.scoreHeaderRow(row);
              if (score > bestScore){ bestScore = score; bestIdx = i; }
            }
            
            const headers = (aoa[bestIdx] || []).map(v => String(v||'').trim()).filter(x => x !== '');
            const rows = [];
            
            for (let r=bestIdx+1; r<aoa.length; r++){
              const row = aoa[r]; 
              if (!row || row.every(v => v==null || v===undefined || String(v).trim()==='')) continue;
              
              const obj = {}; 
              for (let c=0; c<headers.length; c++){ 
                const value = row[c];
                // Handle different data types properly
                if (value === null || value === undefined) {
                  obj[headers[c]] = '';
                } else if (typeof value === 'object' && value instanceof Date) {
                  obj[headers[c]] = value.toISOString().split('T')[0]; // Format dates as YYYY-MM-DD
                } else {
                  obj[headers[c]] = String(value).trim();
                }
              }
              rows.push(obj);
            }
            
            return { headers, rows, score: bestScore };
          } catch (err) {
            console.error('Error extracting from sheet:', err);
            return { headers: [], rows: [], score: -1 };
          }
        },
        computeDuplicateHeaderGroups(rawHeaders = [], displayHeaders = [], renamedHeaders = {}){
          const raw = Array.isArray(rawHeaders) && rawHeaders.length ? rawHeaders : displayHeaders;
          if (!Array.isArray(raw) || !raw.length) return [];

          const display = Array.isArray(displayHeaders) && displayHeaders.length === raw.length
            ? displayHeaders
            : raw.map((value) => (value == null ? '' : String(value).trim()));

          const renameMap = new Map();
          if (renamedHeaders && typeof renamedHeaders === 'object') {
            for (const [key, value] of Object.entries(renamedHeaders)) {
              const normalizedKey = key == null ? '' : String(key).trim();
              if (!normalizedKey) continue;
              const normalizedValue = value == null ? '' : String(value).trim();
              if (!normalizedValue) continue;
              renameMap.set(normalizedKey, normalizedValue);
            }
          }

          const groups = new Map();
          raw.forEach((rawHeader, index) => {
            const displayName = display[index] == null ? '' : String(display[index]).trim();
            if (!displayName) return;

            const trimmedRaw = rawHeader == null ? '' : String(rawHeader).trim();
            const baseCandidate = renameMap.get(rawHeader)
              ?? renameMap.get(trimmedRaw)
              ?? renameMap.get(displayName)
              ?? displayName;
            const base = baseCandidate == null ? '' : String(baseCandidate).trim();
            const key = base || displayName;

            const entry = { label: displayName, raw: trimmedRaw || displayName, index };
            const existing = groups.get(key) || [];
            existing.push(entry);
            groups.set(key, existing);
          });

          return Array.from(groups.entries())
            .filter(([, entries]) => entries.length > 1)
            .map(([base, entries]) => ({
              base,
              entries: entries.map((entry, idx) => ({
                ...entry,
                status: idx === 0 ? 'primary' : 'duplicate'
              }))
            }));
        },
        async handleDuplicateHeaders({ rawHeaders = [], displayHeaders = [], renamedHeaders = {} } = {}){
          const groups = this.computeDuplicateHeaderGroups(rawHeaders, displayHeaders, renamedHeaders);

          if (!groups.length){
            this.duplicateHeaderGroups = [];
            this.duplicateHeaderNames = [];
            this.duplicateHeaderWarningDismissed = false;
            this.duplicateHeaderSignature = '';
            return;
          }

          this.duplicateHeaderGroups = groups;
          this.duplicateHeaderNames = Array.from(new Set(groups.map(group => group.base).filter(Boolean)));
          this.duplicateHeaderWarningDismissed = false;
          this.highlightMappingSection();

          const signature = groups
            .map(group => `${group.base}::${group.entries.map(entry => entry.label).join('|')}`)
            .sort()
            .join('||');

          if (signature !== this.duplicateHeaderSignature){
            try {
              if (!this.activityLog && typeof this.initActivityLog === 'function'){
                await this.initActivityLog();
              }
              await this.recordActivity('ImportDuplicateHeadersDetected', [], {
                importMode: this.importMode,
                headerCount: Array.isArray(displayHeaders) && displayHeaders.length
                  ? displayHeaders.length
                  : (Array.isArray(rawHeaders) ? rawHeaders.length : 0),
                duplicates: groups.map(group => ({
                  header: group.base,
                  columns: group.entries.map(entry => entry.label),
                  primary: group.entries.find(entry => entry.status === 'primary')?.label || null
                }))
              }, null, { supportsUndo: false });
            } catch (error) {
              console.error('Failed to log duplicate header detection', error);
            } finally {
              this.duplicateHeaderSignature = signature;
            }
          }
        },
        scoreHeaderRow(cols){
          const patterns=[/first/i,/last/i,/employee\\s*name/i,/payroll\\s*name/i,/job\\s*title|role/i,/employment\\s*type|class/i,/position\\s*id|employee\\s*id/i,/status/i,/seniority|total.*hours/i];
          let score=0;
          for(const c of cols){
            const s=String(c||'');
            for(const p of patterns) if(p.test(s)) score++;
          }
          return score;
        },
        normalizeHeaderValue(value){
          if (value == null) return '';
          let normalized = String(value).toLowerCase();
          normalized = normalized.replace(/[#]+/g, ' number ');
          normalized = normalized.replace(/&/g, ' and ');
          normalized = normalized.replace(/hrs?\\b/g, 'hours');
          normalized = normalized.replace(/senor/gi, 'senior');
          normalized = normalized.replace(/senority/gi, 'seniority');
          normalized = normalized.replace(/emp\\b/g, 'employee');
          normalized = normalized.replace(/[^a-z0-9\\s]+/g, ' ');
          normalized = normalized.replace(/\\s+/g, ' ').trim();
          return normalized;
        },
        tokenizeHeaderValue(normalized){
          if (!normalized) return [];
          return normalized.split(' ').filter(Boolean);
        },
        levenshteinDistance(a, b){
          if (a === b) return 0;
          const aLen = a.length;
          const bLen = b.length;
          if (!aLen) return bLen;
          if (!bLen) return aLen;
          const matrix = new Array(aLen + 1);
          for (let i = 0; i <= aLen; i++){
            matrix[i] = new Array(bLen + 1);
            matrix[i][0] = i;
          }
          for (let j = 0; j <= bLen; j++){
            matrix[0][j] = j;
          }
          for (let i = 1; i <= aLen; i++){
            const aCode = a.charCodeAt(i - 1);
            for (let j = 1; j <= bLen; j++){
              const cost = aCode === b.charCodeAt(j - 1) ? 0 : 1;
              matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
              );
            }
          }
          return matrix[aLen][bLen];
        },
        detectHeaderColumn(headers, { variants = [], preferredTokens = [], minScore = 80 } = {}){
          if (!Array.isArray(headers) || !headers.length) return null;

          const processed = headers.map((orig) => {
            const normalized = this.normalizeHeaderValue(orig);
            return {
              orig,
              normalized,
              tokens: this.tokenizeHeaderValue(normalized)
            };
          });

          const normalizedVariants = variants.map((value) => {
            const normalized = this.normalizeHeaderValue(value);
            return {
              normalized,
              tokens: this.tokenizeHeaderValue(normalized)
            };
          });

          let bestMatch = null;
          let bestScore = -Infinity;

          for (const col of processed){
            if (!col.normalized) continue;
            let score = 0;

            for (const variant of normalizedVariants){
              if (!variant.normalized) continue;

              if (col.normalized === variant.normalized){
                score = Math.max(score, 100);
                continue;
              }

              if (
                variant.tokens.length > 1 &&
                variant.tokens.every((token) => col.tokens.includes(token))
              ){
                score = Math.max(score, 92);
                continue;
              }

              if (
                variant.normalized.length >= 4 &&
                col.normalized.includes(variant.normalized)
              ){
                score = Math.max(score, 88);
                continue;
              }

              if (
                variant.tokens.length &&
                variant.tokens.every((token) => col.tokens.some((ct) => ct.startsWith(token) || ct.endsWith(token)))
              ){
                score = Math.max(score, 85);
                continue;
              }

              const threshold = Math.min(2, Math.ceil(Math.max(col.normalized.length, variant.normalized.length) * 0.25));
              const distance = this.levenshteinDistance(col.normalized, variant.normalized);
              if (distance && distance <= threshold){
                score = Math.max(score, 75 - distance);
              }
            }

            if (score > 0 && preferredTokens.length){
              const bonus = preferredTokens.reduce((acc, token) => (
                col.tokens.some((ct) => ct === token || ct.startsWith(token)) ? acc + 3 : acc
              ), 0);
              score += bonus;
            }

            if (score > bestScore){
              bestScore = score;
              bestMatch = col.orig;
            }
          }

          if (bestScore >= minScore){
            return bestMatch;
          }
          return null;
        },
        highlightMappingSection(){
          this.$nextTick(() => {
            const panel = this.$refs.employeeMappingPanel;
            if (!panel) return;
            panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            panel.classList.add('ring-2', 'ring-red-400');
            if (this.mappingHighlightTimer){
              clearTimeout(this.mappingHighlightTimer);
            }
            this.mappingHighlightTimer = setTimeout(() => {
              panel.classList.remove('ring-2', 'ring-red-400');
              this.mappingHighlightTimer = null;
            }, 1600);
          });
        },
        updateMissingRequiredColumns(){
          const missing = [];
          const hasNamePair = Boolean(this.columnMap.firstName && this.columnMap.lastName);
          const hasEmployeeId = Boolean(this.columnMap.employeeId);
          if (!hasEmployeeId && !hasNamePair) missing.push('Employee ID or First & Last Name');
          if (!this.columnMap.status) missing.push('Status');
          const signature = missing.slice().sort().join('|');
          const changed = signature !== this.lastMissingColumnsSignature;
          this.lastMissingColumnsSignature = signature;
          this.missingRequiredColumns = missing;
          if (!missing.length){
            this.missingColumnsBannerDismissed = false;
            return;
          }
          if (changed){
            this.missingColumnsBannerDismissed = false;
            this.highlightMappingSection();
          }
        },
        handleExternalMissingColumns(columns){
          if (!Array.isArray(columns)) return;
          const normalized = columns.filter(Boolean);
          const signature = normalized.slice().sort().join('|');
          const changed = signature !== this.lastMissingColumnsSignature;
          this.lastMissingColumnsSignature = signature;
          this.missingRequiredColumns = normalized;
          if (!normalized.length){
            this.missingColumnsBannerDismissed = false;
            return;
          }
          this.missingColumnsBannerDismissed = false;
          if (changed){
            this.highlightMappingSection();
          }
        },
        getEmployeeImportMappingSnapshot(){
          const snapshot = {};
          for (const key of Object.keys(this.fieldLabels)){
            if (this.columnMap[key]){
              snapshot[key] = this.columnMap[key];
            }
          }
          return snapshot;
        },
        autoMapColumns(headers){
          const normalized = (headers||[]).map(h=>({orig:h, norm:String(h).toLowerCase().trim()}));
          for(const [key,label] of Object.entries(this.fieldLabels)){
            if(this.columnMap[key]) continue;
            const match = normalized.find(h=>h.norm === label.toLowerCase());
            if(match){
              this.columnMap[key]=match.orig;
              continue;
            }

            const configMap = {
              payrollName: {
                variants: ['employee name','payroll name','full name','name','staff name','team member name','associate name'],
                preferredTokens: ['employee','name'],
                minScore: 82
              },
              firstName: {
                variants: ['first name','first','given name','fname'],
                preferredTokens: ['first','given'],
                minScore: 84
              },
              lastName: {
                variants: ['last name','surname','family name','lname'],
                preferredTokens: ['last','surname','family'],
                minScore: 84
              },
              employeeId: {
                variants: ['employee id','employee number','employee #','employee code','position id','position number','personnel id','emp id','id number','id'],
                preferredTokens: ['employee','id','number'],
                minScore: 82
              },
              seniorityHours: {
                variants: ['seniority hours','total seniority hours','seniority hrs','seniority hour','sen hours','seniority total','seniority time','seniority','hours'],
                preferredTokens: ['seniority','senior','hours'],
                minScore: 82
              },
              status: {
                variants: ['status','position status','employment status','employee status','active status','active?'],
                preferredTokens: ['status'],
                minScore: 80
              }
            };

            if (configMap[key]){
              const detected = this.detectHeaderColumn(headers, configMap[key]);
              if (detected){
                this.columnMap[key] = detected;
              }
            }
          }
          this.updateMissingRequiredColumns();
        },

        // Presets
        applyPreset(key){
          if (key==='maplewood_csv'){
            this.importType='csv';
            this.columnMap = {
              firstName:'', lastName:'',
              payrollName:'Payroll Name',
              role:'Job Title Description',
              employmentType:'Job Class Code',
              employeeId:'Position ID',
              status:'Position Status',
              seniorityHours:'Total Seniority Hours as at June 30, 2025'
            };
            this.nameFormat='last_first';
          } else if (key==='education_name'){
            this.importType='excel';
            this.columnMap = {
              firstName:'', lastName:'',
              payrollName:'Employee Name',
              role:'', employmentType:'', employeeId:'EE#', status:'Active?', seniorityHours:''
            };
            this.nameFormat='first_last';
          }
          this.updateEligibilityPreview();
        },

        // Eligibility & parsing
        analyzeRow(row){
          const g = (k) => { const c=this.columnMap[k]; return c? (row[c] ?? '') : ''; };
          let first = g('firstName'); let last = g('lastName');
          const payroll = g('payrollName');
          if ((!first || !last) && payroll){
            const s = String(payroll).replace(/\s*[-–—]+$/, '').trim();
            if (this.nameFormat==='last_first' || (this.nameFormat==='auto' && s.includes(','))){
              const parts = s.split(','); last = (parts[0]||'').trim(); first = (parts.slice(1).join(',')||'').trim();
            } else {
              const parts = s.split(/\\s+/);
              if (parts.length>=2){ first = parts[0].trim(); last = parts.slice(1).join(' ').trim(); }
            }
            first = first.replace(/\s*[-–—]+$/, '').trim();
            last  = last.replace(/\s*[-–—]+$/, '').trim();
          }
          return { first, last, role: g('role'), type: g('employmentType'), empId: g('employeeId'), status: g('status'), hours: g('seniorityHours') };
        },
        updateEligibilityPreview(){
          this.updateMissingRequiredColumns();
          let eligible=0, missing=0;
          for (const row of this.importData){
            const a = this.analyzeRow(row);
            if (a.first && a.last) eligible++; else missing++;
          }
          this.previewEligible = eligible;
          if (eligible===0) this.importWarning = 'No rows have usable names. Map First/Last or Payroll Name, and set Name Format if needed.';
          else if (missing>0) this.importWarning = `${missing} row(s) missing names will be skipped.`;
          else this.importWarning = '';
        },

        async dryRun(){
          if (this.importMode === 'backup') return;
          // Simulate import and list first skipped reasons
          const existing = await this.db.employees.toArray();
          const normalizeId = (value) => {
            if (value === null || value === undefined) return '';
            return String(value).trim().toLowerCase();
          };
          const compositeOf = (employee) => {
            const first = String(employee.firstName || '').trim().toLowerCase();
            const last = String(employee.lastName || '').trim().toLowerCase();
            const role = String(employee.role || '').trim().toLowerCase();
            return `${first}|${last}|${role}`;
          };
          const byEmpId = new Map();
          const byComposite = new Map();
          for (const record of existing){
            const idKey = normalizeId(record.employeeId);
            if (idKey) byEmpId.set(idKey, record);
            byComposite.set(compositeOf(record), record);
          }
          let added=0, updated=0, skipped=0; const details=[];
          for (const row of this.importData){
            const a = this.analyzeRow(row);
            if (!a.first || !a.last){ skipped++; if(details.length<15) details.push('Skipped row: missing name'); continue; }
            const emp = { id:'-', firstName:a.first, lastName:a.last, role:a.role||'Other', employmentType:a.type||'FT', employeeId:a.empId||'', status:/inactive|leave/i.test(a.status||'')?'Inactive':'Active' };
            const match = emp.employeeId
              ? byEmpId.get(normalizeId(emp.employeeId))
              : byComposite.get(compositeOf(emp));
            if (match) updated++; else added++;
          }
          this.dryRunSummary = { added, updated, skipped };
          this.dryRunDetails = details;
          this.recordImportLog(`Dry run completed: ${added} added, ${updated} updated, ${skipped} skipped.`);
        },

        async processImport(){
          this.importError='';
          this.recordImportLog(`Process import triggered (mode: ${this.importMode})`);
          if (this.importMode === 'backup'){
            const summary = await this.restoreBackup();
            if(!summary) return;
            this.recordImportLog('Backup restore completed successfully.');
            this.showImportModal=false;
            Alpine.store('app').showImportModal = false;
            await this.loadData();
            return;
          }
          if (!this.importData.length || !this.importHeaders.length){ this.importError='Nothing to import'; this.recordImportLog('Import aborted: no data or headers available.', 'warn'); return; }
          if (this.importMode==='employees'){
            if (!(this.columnMap.firstName || this.columnMap.lastName || this.columnMap.payrollName)){
              this.importError='Map at least First/Last or Payroll Name before importing.'; this.recordImportLog('Import aborted: required name mappings missing.', 'warn'); return;
            }
            this.recordImportLog(`Starting employees import (${this.importData.length} rows).`);
            const res = await this.importEmployees();
            if(!res) return;
            this.showImportModal=false;
            Alpine.store('app').showImportModal = false;
            await this.loadData();
            this.notify(`Employees: ${res.added} added, ${res.updated} updated • Total now: ${this.employees.length}`);
            this.captureImportOutcome({
              status: 'success',
              summary: `Employees import: ${res.added} added, ${res.updated} updated, ${res.skipped} skipped`,
              details: {
                mode: 'employees',
                added: res.added,
                updated: res.updated,
                skipped: res.skipped,
                attemptedRows: this.importData.length
              },
              logMessage: `Employees import completed (${res.added} added, ${res.updated} updated, ${res.skipped} skipped).`
            });
            try {
              await this.refreshImportDiagnostics();
            } catch (diagError) {
              console.warn('Failed to refresh import diagnostics', diagError);
              this.recordImportLog(`Import diagnostics refresh failed: ${diagError?.message || diagError}`, 'warn');
            }
          } else {
            const hasAny = Object.values(this.completionMap).some(Boolean);
            if (!hasAny){ this.importError='Select at least one requirement column on the right to import completions.'; this.recordImportLog('Import aborted: no completion columns selected.', 'warn'); return; }
            this.recordImportLog(`Starting completions import (${this.importData.length} rows).`);
            const cnt = await this.importCompletions();
            if(cnt === null) return;
            this.showImportModal=false;
            Alpine.store('app').showImportModal = false;
            await this.loadData();
            this.notify(`Completions updated: ${cnt}`);
            this.captureImportOutcome({
              status: 'success',
              summary: `Completions import: ${cnt} updates applied`,
              details: {
                mode: 'completions',
                updates: cnt,
                selectedRequirements: Object.values(this.completionMap).filter(Boolean).length,
                attemptedRows: this.importData.length
              },
              logMessage: `Completions import completed (${cnt} updates).`
            });
            try {
              await this.refreshImportDiagnostics();
            } catch (diagError) {
              console.warn('Failed to refresh import diagnostics', diagError);
              this.recordImportLog(`Import diagnostics refresh failed: ${diagError?.message || diagError}`, 'warn');
            }
          }
        },

        async importEmployees(){
          const incoming=[]; const skipped=[];
          for (const row of this.importData){
            const a = this.analyzeRow(row);
            if (!a.first || !a.last){ skipped.push(row); continue; }
            const role = (/licen[cs]ed/i.test(a.role) && /practical/i.test(a.role)) ? 'LPN'
                        : /care\\s*aide|rca/i.test(a.role) ? 'RCA'
                        : /recreation|activity/i.test(a.role) ? 'Recreation'
                        : /reception/i.test(a.role) ? 'Reception'
                        : /rehab/i.test(a.role) ? 'RehabAssistant' : (a.role || 'Other');
            const type = /\\bpt\\b|part/i.test(a.type) ? 'PT' : (/\\bcas|casual|ca\\b/i.test(a.type) ? 'Casual' : 'FT');
            const status = /inactive|leave/i.test(a.status||'') ? 'Inactive' : 'Active';
            incoming.push({ id:generateId(), firstName:a.first, lastName:a.last, role, employmentType:type, status, employeeId:a.empId, seniorityHours:a.hours, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() });
          }

          const activityMetadata = {
            mapping: this.getEmployeeImportMappingSnapshot(),
            missingColumns: [...this.missingRequiredColumns],
            sourceHeaders: [...this.importHeaders]
          };

          const LegacyAPI = {
            importEmployees: async ({ employees, metadata, skipped: skippedCount }) => {
              if (!employees.length) {
                return { added: 0, updated: 0, skipped: skippedCount };
              }
              const { ImportEmployees } = await import('./commands.js');
              const command = new ImportEmployees(this.db, { employees });
              const undoPayload = await command.execute();
              const added = undoPayload.addedEmployees?.length || 0;
              const updated = undoPayload.updatedSnapshots?.length || 0;
              const targets = new Set();
              (undoPayload.addedEmployees || []).forEach(emp => targets.add(emp.id));
              (undoPayload.updatedSnapshots || []).forEach(emp => targets.add(emp.id));
              if (added || updated) {
                await this.recordActivity('ImportEmployees', Array.from(targets), {
                  ...metadata,
                  added,
                  updated,
                  skipped: skippedCount
                }, undoPayload);
              }
              return { added, updated, skipped: skippedCount };
            }
          };

          const API = window.APP_FLAGS.USE_V2_MAIN ? CompatAPI : LegacyAPI;

          try{
            return await API.importEmployees({
              db: this.db,
              activityLog: this.activityLog,
              employees: incoming,
              actor: 'user',
              metadata: activityMetadata,
              skipped: skipped.length,
              supportsUndo: true
            });
          }catch(error){
            const stage = error && typeof error === 'object' && error.importStage ? error.importStage : 'write';
            const stageLabel = stage === 'parse' ? 'Parse' : (stage === 'transform' ? 'Transform' : 'Write');
            const messageText = error && error.message ? String(error.message) : String(error ?? 'Unknown error');
            const toastMessage = `Import failed during ${stageLabel}: ${messageText}. See console for details.`;
            console.error('Failed to import employees', error);
            try {
              const hasStore = typeof Alpine !== 'undefined' && typeof Alpine.store === 'function';
              const store = hasStore ? Alpine.store('app') : null;
              if(store && typeof store.showToast === 'function'){
                store.showToast({
                  type: 'error',
                  message: toastMessage,
                  duration: 8000,
                  action: {
                    label: 'See details',
                    dismiss: false,
                    handler(){
                      console.log(`Import failure details (${stageLabel} stage):`, error);
                      if(error && error.stack){
                        console.error(error.stack);
                      }
                    }
                  }
                });
              } else {
                this.notify(toastMessage, 'var(--danger)');
              }
            } catch (toastError) {
              console.error('Failed to show import error toast', toastError);
              this.notify(toastMessage, 'var(--danger)');
            }
            this.captureImportOutcome({
              status: 'error',
              summary: `Employees import failed during ${stageLabel}`,
              details: {
                mode: 'employees',
                stage,
                error: messageText
              },
              logMessage: `Employees import failed during ${stageLabel}: ${messageText}`,
              level: 'error'
            });
            return null;
          }
        },

        async importCompletions(){
          const reqs = await this.db.requirements.toArray();
          const reqById = new Map(reqs.map(r=>[r.id,r]));
          const employees = await this.db.employees.toArray();
          const byEmpId = new Map(employees.filter(e=>e.employeeId).map(e=>[String(e.employeeId).trim().toLowerCase(), e]));
          const byName = new Map(employees.map(e=>[(e.lastName+','+e.firstName).trim().toLowerCase(), e]));
          const updates = [];
          for (const row of this.importData){
            const a = this.analyzeRow(row);
            let emp = null;
            if (a.empId){ emp = byEmpId.get(String(a.empId).trim().toLowerCase()) || null; }
            if (!emp && a.first && a.last){ emp = byName.get((a.last+','+a.first).toLowerCase()) || null; }
            if (!emp) continue;
            for (const [rid, col] of Object.entries(this.completionMap)){
              if (!col) continue;
              const val = row[col]; if (!val) continue;
              const completedOn = this.normalizeDate(val); if (!completedOn) continue;
              const req = reqById.get(rid);
              const expiresOn = req?.defaultExpiryDays ? this.addDays(completedOn, req.defaultExpiryDays) : null;
              updates.push({
                employeeId: emp.id,
                requirementId: rid,
                status: 'Completed',
                completedOn,
                expiresOn
              });
            }
          }
          if (!updates.length) return 0;
          try{
            const { ImportCompletions } = await import('./commands.js');
            const command = new ImportCompletions(this.db, { updates });
            const undoPayload = await command.execute();
            const count = undoPayload.changes?.length || 0;
            if (count){
              const employeeIds = Array.from(new Set(updates.map(u => u.employeeId)));
              const requirementIds = Array.from(new Set(updates.map(u => u.requirementId)));
              await this.recordActivity('ImportCompletions', employeeIds, {
                employeeIds,
                requirementIds,
                count
              }, undoPayload);
            }
            return count;
          }catch(error){
            console.error('Failed to import completions', error);
            this.notify('Failed to import completions', 'var(--danger)');
            const message = error && error.message ? String(error.message) : String(error ?? 'Unknown error');
            this.captureImportOutcome({
              status: 'error',
              summary: 'Completions import failed',
              details: {
                mode: 'completions',
                error: message
              },
              logMessage: `Completions import failed: ${message}`,
              level: 'error'
            });
            return null;
          }
        },

        normalizeDate(v){
          if (!v) return null; const s=String(v).trim(); if (/^\\d{4}-\\d{2}-\\d{2}$/.test(s)) return s;
          const d=new Date(s); if(!isNaN(d.getTime())) return d.toISOString().slice(0,10);
          const n=Number(s); if(!isNaN(n)&&n>25569){ const ms=(n-25569)*86400*1000; return new Date(ms).toISOString().slice(0,10); }
          return null;
        },
        addDays(dateOnly, days){ if(!dateOnly) return null; const [y,m,d]=dateOnly.split('-').map(Number); const dt=new Date(Date.UTC(y,m-1,d)); dt.setUTCDate(dt.getUTCDate()+Number(days)); return dt.toISOString().slice(0,10); },
        exportData: async function(format='json'){
          const generatedAt = new Date().toISOString();
          const hasTemplatesTable = this.db.roleRequirementProfiles && typeof this.db.roleRequirementProfiles.toArray === 'function';
          const hasSnapshotsTable = this.db.complianceSnapshots && typeof this.db.complianceSnapshots.toArray === 'function';
          const hasActivityLogTable = this.db.activityLog && typeof this.db.activityLog.toArray === 'function';
          const [templates, snapshots, activityLog] = await Promise.all([
            hasTemplatesTable ? this.db.roleRequirementProfiles.toArray() : [],
            hasSnapshotsTable ? this.db.complianceSnapshots.toArray() : [],
            hasActivityLogTable ? this.db.activityLog.toArray() : []
          ]);
          const data={
            employees:await this.db.employees.toArray(),
            requirements:await this.db.requirements.toArray(),
            employeeRequirements:await this.db.employeeRequirements.toArray(),
            settings:await this.db.settings.toArray(),
            templates,
            snapshots,
            activityLog,
            generatedAt
          };
          const date=`compliance-matrix-${generatedAt.split('T')[0]}`;
          let blob, filename, message;
          if(format==='csv'){
            const csv=Papa.unparse(data.employees);
            blob=new Blob([csv],{type:'text/csv'});
            filename=`${date}.csv`;
            message='Exported CSV';
          } else if(format==='xlsx'){
            let xlsx;
            try {
              xlsx = await loadXlsx();
            } catch (loaderError) {
              console.error('Failed to load XLSX library for export:', loaderError);
              this.notify('Excel export unavailable: XLSX still unavailable.', 'var(--danger)');
              return;
            }
            const wb=xlsx.utils.book_new();
            xlsx.utils.book_append_sheet(wb,xlsx.utils.json_to_sheet(data.employees),'Employees');
            xlsx.utils.book_append_sheet(wb,xlsx.utils.json_to_sheet(data.requirements),'Requirements');
            xlsx.utils.book_append_sheet(wb,xlsx.utils.json_to_sheet(data.employeeRequirements),'EmployeeRequirements');
            xlsx.utils.book_append_sheet(wb,xlsx.utils.json_to_sheet(data.settings),'Settings');
            xlsx.utils.book_append_sheet(wb,xlsx.utils.json_to_sheet(data.templates),'Templates');
            xlsx.utils.book_append_sheet(wb,xlsx.utils.json_to_sheet(data.snapshots),'Snapshots');
            xlsx.utils.book_append_sheet(wb,xlsx.utils.json_to_sheet(data.activityLog),'ActivityLog');
            const wbout=xlsx.write(wb,{bookType:'xlsx',type:'array'});
            blob=new Blob([wbout],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
            filename=`${date}.xlsx`;
            message='Exported Excel';
          } else {
            blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
            filename=`${date}.json`;
            message='Exported JSON';
          }
          this.downloadBlob(blob, filename);
          this.notify(message);
        },
        downloadBlob(blob, filename){ const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); },

        // Admin panel functions
        getCompletedCount(){
          return this.employeeRequirements.filter(er => er.status === 'Completed').length;
        },
        getExpiringSoonCount(){
          return this.employeeRequirements.filter(er => this.calcStatus(er.employeeId, er.requirementId) === 'expiring').length;
        },
        getExpiredCount(){
          return this.employeeRequirements.filter(er => {
            if (er.status !== 'Completed' || !er.expiresOn) return false;
            return new Date(er.expiresOn) <= new Date();
          }).length;
        },
        getIncompleteCount(){
          return this.employeeRequirements.filter(er => er.status === 'NotCompleted').length;
        },
        renderComplianceChart(){
            const ctx=document.getElementById('complianceChart');
            if(!ctx) return;
            const existingChart=typeof Chart!=='undefined'&&typeof Chart.getChart==='function'?Chart.getChart(ctx):null;
            if(existingChart&&existingChart!==this.complianceChart&&typeof existingChart.destroy==='function'){
              existingChart.destroy();
            }
            if(this.complianceChart&&this.complianceChart.ctx?.canvas!==ctx&&typeof this.complianceChart.destroy==='function'){
              this.complianceChart.destroy();
              this.complianceChart=null;
            }
            const data=[this.getCompletedCount(),this.getExpiringSoonCount(),this.getExpiredCount(),this.getIncompleteCount()];
            const colors=['--success','--expiring','--warn','--danger'].map(v=>this.getThemeColor(v));
            const legendColor=this.getThemeColor('--muted','#6b7280');
            const pluginColor=this.getThemeColor('--card','#ffffff');
            if(this.complianceChart){
              const dataset=this.complianceChart.data.datasets[0];
              dataset.data=data;
              dataset.backgroundColor=colors;
              this.complianceChart.options.plugins=this.complianceChart.options.plugins||{};
              this.complianceChart.options.plugins.chartBgColor={color:pluginColor};
              if(this.complianceChart.options.plugins.legend?.labels){
                this.complianceChart.options.plugins.legend.labels.color=legendColor;
              }
              this.complianceChart.update();
            } else {
              this.complianceChart=new Chart(ctx,{
                type:'doughnut',
                data:{
                  labels:['Completed','Expiring Soon','Expired','Incomplete'],
                  datasets:[{
                    data,
                    backgroundColor:colors,
                    borderWidth:0
                  }]
                },
                options:{
                  responsive:true,
                  maintainAspectRatio:false,
                  plugins:{
                    chartBgColor:{color:pluginColor},
                    legend:{
                      labels:{color:legendColor}
                    }
                  }
                }
              });
            }
            this.renderComplianceTrendChart();
          },
          async collectComplianceSnapshot(){
            const snapshot=this.buildComplianceSnapshot();
            const todayKey=snapshot.date;
            if(!todayKey){
              this.updateInMemoryHistory(snapshot);
              return;
            }
            if(!this.db?.complianceSnapshots){
              this.updateInMemoryHistory(snapshot);
              return;
            }
            try{
              const existing=await this.db.complianceSnapshots.get(todayKey);
              if(!existing||existing.compliant!==snapshot.compliant||existing.expiring!==snapshot.expiring||existing.overdue!==snapshot.overdue||existing.incomplete!==snapshot.incomplete||existing.total!==snapshot.total){
                await this.db.complianceSnapshots.put(snapshot);
              }
              const limit=this.complianceHistoryLimit || 30;
              const totalCount=await this.db.complianceSnapshots.count();
              if(totalCount>limit){
                const overflow=totalCount-limit;
                const staleKeys=await this.db.complianceSnapshots.orderBy('date').limit(overflow).keys();
                if(staleKeys.length){
                  await this.db.complianceSnapshots.bulkDelete(staleKeys);
                }
              }
              const history=await this.db.complianceSnapshots.orderBy('date').reverse().limit(limit).toArray();
              this.complianceHistory=history.reverse();
              this.complianceHistoryMemory=[];
            }catch(error){
              console.warn('Failed to persist compliance snapshot', error);
              this.updateInMemoryHistory(snapshot);
            }
          },
          updateInMemoryHistory(snapshot){
            if(!snapshot) return;
            this.complianceHistoryMemory.push(snapshot);
            if(this.complianceHistoryMemory.length>this.complianceHistoryLimit){
              this.complianceHistoryMemory=this.complianceHistoryMemory.slice(-this.complianceHistoryLimit);
            }
            this.complianceHistory=[...this.complianceHistoryMemory];
          },
          buildComplianceSnapshot(){
            const now=new Date();
            const isoDate=Number.isNaN(now.getTime())?null:now.toISOString();
            const snapshot={
              date:isoDate?isoDate.slice(0,10):null,
              capturedAt:isoDate,
              compliant:0,
              expiring:0,
              overdue:0,
              incomplete:0,
              total:0
            };
            for(const er of this.employeeRequirements){
              if(er.status === 'NotRequired') continue;
              snapshot.total++;
              const status=this.calcStatus(er.employeeId, er.requirementId);
              if(status==='compliant') snapshot.compliant++;
              else if(status==='expiring') snapshot.expiring++;
              else if(status==='overdue') snapshot.overdue++;
              else snapshot.incomplete++;
            }
            return snapshot;
          },
          getThemeColor(variable,fallback='#000000'){
            if(!variable) return fallback;
            try{
              const style=getComputedStyle(document.documentElement);
              const value=style.getPropertyValue(variable)?.trim();
              return value||fallback;
            }catch(error){
              return fallback;
            }
          },
          withAlpha(color,alpha){
            if(!color) return `rgba(0,0,0,${alpha})`;
            if(color.startsWith('#')){
              let hex=color.replace('#','');
              if(hex.length===3){
                hex=hex.split('').map(ch=>ch+ch).join('');
              }
              if(hex.length===6){
                const bigint=parseInt(hex,16);
                const r=(bigint>>16)&255;
                const g=(bigint>>8)&255;
                const b=bigint&255;
                return `rgba(${r}, ${g}, ${b}, ${alpha})`;
              }
            }
            if(color.startsWith('rgb(')){
              return color.replace('rgb','rgba').replace(')',`, ${alpha})`);
            }
            if(color.startsWith('rgba(')){
              return color.replace(/rgba\(([^)]+)\)/,(_,inner)=>{
                const parts=inner.split(',').map(p=>p.trim());
                return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
              });
            }
            return color;
          },
          renderComplianceTrendChart(){
            const ctx=document.getElementById('complianceTrendChart');
            if(!ctx) return;
            const existingChart=typeof Chart!=='undefined'&&typeof Chart.getChart==='function'?Chart.getChart(ctx):null;
            if(existingChart&&existingChart!==this.complianceTrendChart&&typeof existingChart.destroy==='function'){
              existingChart.destroy();
            }
            if(this.complianceTrendChart&&this.complianceTrendChart.ctx?.canvas!==ctx&&typeof this.complianceTrendChart.destroy==='function'){
              this.complianceTrendChart.destroy();
              this.complianceTrendChart=null;
            }
            const history=this.complianceHistory?.length?this.complianceHistory:[];
            const labels=history.length?history.map(entry=>entry.date):[new Date().toISOString().slice(0,10)];
            const datasets=[
              {key:'compliant',label:'Compliant',colorVar:'--success'},
              {key:'expiring',label:'Expiring Soon',colorVar:'--expiring'},
              {key:'overdue',label:'Overdue',colorVar:'--warn'}
            ].map(cfg=>{
              const baseColor=this.getThemeColor(cfg.colorVar);
              return {
                label:cfg.label,
                data:history.length?history.map(entry=>entry?.[cfg.key]||0):[0],
                borderColor:baseColor,
                backgroundColor:this.withAlpha(baseColor,0.2),
                fill:true,
                tension:0.35,
                pointRadius:3,
                pointHoverRadius:5
              };
            });
            const legendColor=this.getThemeColor('--muted','#6b7280');
            const gridColor=this.withAlpha(this.getThemeColor('--line','#d1d5db'),0.35);
            const tickColor=this.getThemeColor('--text','#111827');
            const pluginColor=this.getThemeColor('--card','#ffffff');
            if(this.complianceTrendChart){
              this.complianceTrendChart.data.labels=labels;
              if(this.complianceTrendChart.data.datasets.length!==datasets.length){
                this.complianceTrendChart.data.datasets=datasets;
              }else{
                this.complianceTrendChart.data.datasets.forEach((dataset,idx)=>{
                  const incoming=datasets[idx];
                  if(!incoming) return;
                  dataset.data=incoming.data;
                  dataset.borderColor=incoming.borderColor;
                  dataset.backgroundColor=incoming.backgroundColor;
                });
              }
              this.complianceTrendChart.options.plugins.chartBgColor={color:pluginColor};
              if(this.complianceTrendChart.options.plugins.legend?.labels){
                this.complianceTrendChart.options.plugins.legend.labels.color=legendColor;
              }
              if(this.complianceTrendChart.options.scales?.x){
                this.complianceTrendChart.options.scales.x.ticks.color=tickColor;
                this.complianceTrendChart.options.scales.x.grid.color=gridColor;
              }
              if(this.complianceTrendChart.options.scales?.y){
                this.complianceTrendChart.options.scales.y.ticks.color=tickColor;
                this.complianceTrendChart.options.scales.y.grid.color=gridColor;
              }
              this.complianceTrendChart.update();
            }else{
              this.complianceTrendChart=new Chart(ctx,{
                type:'line',
                data:{labels,datasets},
                options:{
                  responsive:true,
                  maintainAspectRatio:false,
                  plugins:{
                    chartBgColor:{color:pluginColor},
                    legend:{
                      labels:{color:legendColor}
                    }
                  },
                  interaction:{mode:'index',intersect:false},
                  scales:{
                    x:{
                      ticks:{color:tickColor},
                      grid:{color:gridColor,drawBorder:false}
                    },
                    y:{
                      beginAtZero:true,
                      ticks:{color:tickColor},
                      grid:{color:gridColor,drawBorder:false}
                    }
                  }
                }
              });
            }
          },
          getUniqueRoles(){
            const roles = this.employees
              .map(emp => (emp.role ?? '').toString())
              .filter(role => role);
            return [...new Set(roles)];
          },
        filterEmployees(){
          let filtered = [...this.employees];
          const rawQuery = this.searchQuery || '';
          const trimmedQuery = rawQuery.trim();
          if (trimmedQuery) {
            const query = trimmedQuery.toLowerCase();
            filtered = filtered.filter(emp => {
              const name = this.getEmployeeName(emp).toLowerCase();
              const role = (emp.role ?? '').toString().toLowerCase();
              const employeeId = (emp.employeeId ?? '').toString().toLowerCase();
              return (
                name.includes(query) ||
                role.includes(query) ||
                employeeId.includes(query)
              );
            });
          }
          if (this.roleFilter) {
            filtered = filtered.filter(emp => emp.role === this.roleFilter);
          }
          if (this.statusFilter) {
            filtered = filtered.filter(emp => emp.status === this.statusFilter);
          }
          if (this.reqStatusFilter) {
            filtered = filtered.filter(emp =>
              this.requirements.some(req => this.getStatus(emp.id, req.id) === this.reqStatusFilter)
            );
          }
          this.isFiltering = Boolean(trimmedQuery || this.roleFilter || this.statusFilter || this.reqStatusFilter);
          this.filteredEmployees = this.isFiltering ? filtered : [];
          this.resetVirtualWindow();
          this.updateSelectedViewMatch();
        },
        get activeFilterChips(){
          const chips = [];
          if(this.roleFilter){
            chips.push({ key: 'roleFilter', label: 'Role', value: this.roleFilter });
          }
          if(this.statusFilter){
            chips.push({ key: 'statusFilter', label: 'Status', value: this.statusFilter });
          }
          if(this.reqStatusFilter){
            chips.push({ key: 'reqStatusFilter', label: 'Expiry', value: this.formatRequirementStatusLabel(this.reqStatusFilter) });
          }
          return chips;
        },
        formatRequirementStatusLabel(value){
          if(!value) return '';
          const labels = {
            Completed: 'Completed',
            Expired: 'Expired',
            NotCompleted: 'Incomplete',
            NotRequired: 'Not Required'
          };
          return labels[value] || value;
        },
        clearFilterChip(key){
          if(key === 'roleFilter'){
            this.roleFilter = '';
          } else if(key === 'statusFilter'){
            this.statusFilter = '';
          } else if(key === 'reqStatusFilter'){
            this.reqStatusFilter = '';
          }
          this.filterEmployees();
        },
        getCurrentFilterState(){
          return {
            searchQuery: this.searchQuery || '',
            roleFilter: this.roleFilter || '',
            statusFilter: this.statusFilter || '',
            reqStatusFilter: this.reqStatusFilter || ''
          };
        },
        filtersMatchView(view){
          if(!view || typeof view !== 'object'){
            return false;
          }
          const current = this.getCurrentFilterState();
          const filters = view.filters || {};
          return (
            (filters.searchQuery || '') === current.searchQuery &&
            (filters.roleFilter || '') === current.roleFilter &&
            (filters.statusFilter || '') === current.statusFilter &&
            (filters.reqStatusFilter || '') === current.reqStatusFilter
          );
        },
        updateSelectedViewMatch(){
          const match = this.savedViews.find((view) => this.filtersMatchView(view));
          this.selectedViewName = match ? match.name : '';
        },
        promptAndSaveView(){
          const defaultName = this.selectedViewName || '';
          const name = typeof window !== 'undefined'
            ? (window.prompt('Name this view', defaultName) || '').trim()
            : '';
          if(!name){
            return;
          }
          const filters = this.getCurrentFilterState();
          const existingIndex = this.savedViews.findIndex((view) => view.name.toLowerCase() === name.toLowerCase());
          const updatedView = { name, filters };
          if(existingIndex >= 0){
            const updated = [...this.savedViews];
            updated[existingIndex] = updatedView;
            this.savedViews = updated;
          } else {
            this.savedViews = [...this.savedViews.filter((view) => view.name.toLowerCase() !== name.toLowerCase()), updatedView];
          }
          this.selectedViewName = name;
          this.persistViews();
          this.updateSelectedViewMatch();
          if(typeof this.notify === 'function'){
            this.notify('View saved.', 'var(--accent)');
          }
        },
        applyViewByName(name){
          if(!name){
            this.selectedViewName = '';
            return;
          }
          const view = this.savedViews.find((entry) => entry.name === name);
          if(!view){
            return;
          }
          this.applyView(view);
        },
        applyView(view){
          if(!view){
            return;
          }
          const filters = view.filters || {};
          this.searchQuery = filters.searchQuery || '';
          this.roleFilter = filters.roleFilter || '';
          this.statusFilter = filters.statusFilter || '';
          this.reqStatusFilter = filters.reqStatusFilter || '';
          this.selectedViewName = view.name;
          this.filterEmployees();
        },
        loadSavedViewsFromStorage(){
          if(typeof window === 'undefined' || !window.localStorage){
            return;
          }
          const storageKey = this.storageKeys?.filterViews;
          if(!storageKey){
            return;
          }
          try {
            const raw = window.localStorage.getItem(storageKey);
            if(!raw){
              return;
            }
            const parsed = JSON.parse(raw);
            if(Array.isArray(parsed)){
              const views = parsed
                .filter((view) => view && typeof view.name === 'string' && view.name.trim())
                .map((view) => ({
                  name: view.name.trim(),
                  filters: {
                    searchQuery: view.filters?.searchQuery || '',
                    roleFilter: view.filters?.roleFilter || '',
                    statusFilter: view.filters?.statusFilter || '',
                    reqStatusFilter: view.filters?.reqStatusFilter || ''
                  }
                }));
              this.savedViews = views;
            }
          } catch (error) {
            console.warn('Failed to load saved views', error);
          }
          this.updateSelectedViewMatch();
        },
        persistViews(){
          if(typeof window === 'undefined' || !window.localStorage){
            return;
          }
          const storageKey = this.storageKeys?.filterViews;
          if(!storageKey){
            return;
          }
          try {
            window.localStorage.setItem(storageKey, JSON.stringify(this.savedViews));
          } catch (error) {
            console.warn('Failed to persist saved views', error);
          }
        },
        performGlobalSearch(query){
          const requirementSource = this.orderedVisibleRequirements();
          const requirementsList = requirementSource.length ? requirementSource : this.requirements;
          const needsRebuild = !this.globalSearchIndex || this.globalSearchIndexVersion !== this.globalSearchDataVersion;

          if (needsRebuild) {
            const data = [
              ...this.employees.map(e => {
                const name = this.getEmployeeName(e);
                const role = e.role || '';
                const employeeId = e.employeeId ? String(e.employeeId) : '';
                const textParts = [name, role, employeeId].filter(Boolean);
                return {
                  type: 'employee',
                  id: e.id,
                  text: textParts.join(' ').trim(),
                  label: name || role || employeeId || 'Employee',
                  meta: {
                    role,
                    employeeId: employeeId ? `ID: ${employeeId}` : ''
                  }
                };
              }),
              ...requirementsList.map(r => ({
                type: 'requirement',
                id: r.id,
                text: r.name || '',
                label: r.name || 'Requirement'
              }))
            ];
            this.globalSearchData = data;
            this.globalSearchIndex = new Fuse(data, { keys:['text'], includeMatches:true, threshold:0.3 });
            this.globalSearchIndexVersion = this.globalSearchDataVersion;
          }

          this.searchResults = query ? this.globalSearchIndex.search(query).slice(0, 12) : [];
          this.refreshFeatherIcons();
        },
        clearGlobalSearch(){
          this.globalSearch='';
          this.dismissSearchResults();
        },
        dismissSearchResults(){
          this.searchResults=[];
          this.refreshFeatherIcons();
        },
        focusSearchResult(result){
          if(!result?.item) return;
          const { type, id } = result.item;
          if(type === 'employee'){
            this.ensureEmployeeVisible(id);
          }
          this.$nextTick(() => {
            let selector = '';
            if(type === 'employee'){
              selector = `[data-employee-row="${id}"]`;
            } else if(type === 'requirement'){
              selector = `[data-requirement-header="${id}"]`;
            }
            if(!selector) return;
            const target = qs(document, selector);
            if(!target) return;

            if(target.dataset && target.dataset.searchFocusTimeout){
              clearTimeout(Number(target.dataset.searchFocusTimeout));
            }

            const scrollOptions = type === 'employee'
              ? { behavior:'smooth', block:'center', inline:'nearest' }
              : { behavior:'smooth', block:'nearest', inline:'center' };

            try{
              target.scrollIntoView(scrollOptions);
            }catch(error){
              target.scrollIntoView({ behavior:'smooth' });
            }

            target.classList.add('search-focus-ring');
            const timeout = window.setTimeout(() => {
              target.classList.remove('search-focus-ring');
              if(target.dataset){
                delete target.dataset.searchFocusTimeout;
              }
            }, 1700);
            if(target.dataset){
              target.dataset.searchFocusTimeout = String(timeout);
            }
          });
        },
        getEscapedGlobalSearch(){
          if(!this.globalSearch) return '';
          return String(this.globalSearch).replace(/[.*+?^${}()|[\]\\]/g, '\$&');
        },
        escapeHtml(text){
          if(text == null) return '';
          return String(text).replace(/[&<>"']/g, (char) => {
            switch(char){
              case '&': return '&amp;';
              case '<': return '&lt;';
              case '>': return '&gt;';
              case '"': return '&quot;';
              case "'": return '&#39;';
              default: return char;
            }
          });
        },
        getEmployeeName(emp){
          if(!emp) return '';
          const first = emp.firstName == null ? '' : String(emp.firstName).trim();
          const last = emp.lastName == null ? '' : String(emp.lastName).trim();
          const combined = [first, last].filter(Boolean).join(' ').trim();
          if(combined){
            return combined;
          }
          const meta = (emp.meta && typeof emp.meta === 'object') ? emp.meta : null;
          if(meta){
            const candidates = [meta.sourceName, meta.fullName, meta.name]
              .map(value => (value == null ? '' : String(value).trim()))
              .filter(Boolean);
            if(candidates.length){
              return candidates[0];
            }
          }
          if(emp.employeeId != null && emp.employeeId !== ''){
            const id = String(emp.employeeId).trim();
            if(id){
              return `Employee ${id}`;
            }
          }
          if(emp.id != null){
            const fallbackId = String(emp.id).trim();
            if(fallbackId){
              return `Employee ${fallbackId}`;
            }
          }
          return '';
        },
        getEmployeeLabel(emp){
          const name = this.getEmployeeName(emp);
          if(name){
            return name;
          }
          return 'Employee';
        },
        highlightText(text){
          if(text == null) return '';
          const value = String(text);
          if(!this.globalSearch) return this.escapeHtml(value);
          const escapedSearch = this.getEscapedGlobalSearch();
          if(!escapedSearch) return this.escapeHtml(value);

          const regex = new RegExp(`(${escapedSearch})`, 'gi');
          let match;
          let lastIndex = 0;
          const segments = [];

          while((match = regex.exec(value)) !== null){
            const preceding = value.slice(lastIndex, match.index);
            if(preceding){
              segments.push(this.escapeHtml(preceding));
            }
            segments.push(`<mark>${this.escapeHtml(match[0])}</mark>`);
            lastIndex = match.index + match[0].length;
          }

          if(!segments.length){
            return this.escapeHtml(value);
          }

          if(lastIndex < value.length){
            segments.push(this.escapeHtml(value.slice(lastIndex)));
          }

          return segments.join('');
        },
        applyDefaultSort(shouldPersist = false){
          this.sortField = DEFAULT_SORT_FIELD;
          this.sortDirection = DEFAULT_SORT_DIRECTION;
          if(shouldPersist){
            this.persistSortPreference();
          }
        },
        loadSortPreferences(){
          const stored = readStoredEmployeeSort();
          if(stored){
            this.sortField = stored.field;
            this.sortDirection = stored.direction;
          } else {
            this.applyDefaultSort(true);
          }
        },
        persistSortPreference(){
          writeStoredEmployeeSort(this.sortField, this.sortDirection);
        },
        sortEmployees(field){
          if (this.sortField === field) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
          } else {
            this.sortField = field;
            this.sortDirection = 'asc';
          }
          this.persistSortPreference();
          this.resetVirtualWindow();
        },
        sortedEmployees(){
          const source = this.isFiltering ? this.filteredEmployees : this.employees;
          const arr = [...source];
          const field = this.sortField;

          const numericFields = new Set(['seniorityHours', 'totalHours', 'completedCount', 'pendingCount']);
          const dateFields = new Set(['createdAt', 'updatedAt', 'startDate', 'endDate', 'hireDate', 'expiresOn', 'completedOn', 'dueDate', 'timestamp']);

          const normalize = (value) => {
            if (value == null) return null;

            if (value instanceof Date) {
              const timestamp = value.getTime();
              return Number.isNaN(timestamp) ? null : timestamp;
            }

            if (typeof value === 'number') {
              return Number.isNaN(value) ? null : value;
            }

            if (numericFields.has(field)) {
              const numberValue = typeof value === 'number'
                ? value
                : parseFloat(String(value).replace(/,/g, ''));
              return Number.isNaN(numberValue) ? null : numberValue;
            }

            if (dateFields.has(field)) {
              const timestamp = new Date(value).getTime();
              return Number.isNaN(timestamp) ? null : timestamp;
            }

            return String(value).toLowerCase();
          };

          return arr.sort((a,b) => {
            const aVal = normalize(a[field]);
            const bVal = normalize(b[field]);

            if (aVal == null && bVal == null) return 0;
            if (aVal == null) return this.sortDirection === 'asc' ? 1 : -1;
            if (bVal == null) return this.sortDirection === 'asc' ? -1 : 1;

            if (aVal < bVal) return this.sortDirection === 'asc' ? -1 : 1;
            if (aVal > bVal) return this.sortDirection === 'asc' ? 1 : -1;
            return 0;
          });
        },
        scheduleVirtualUpdate(cb){
          if(typeof cb !== 'function') return;
          if(typeof requestAnimationFrame === 'function'){
            requestAnimationFrame(cb);
          } else {
            setTimeout(cb, 16);
          }
        },
        syncVirtualPadding(totalCount){
          if(!Number.isFinite(totalCount) || totalCount <= 0){
            if(this.virtualStartIndex !== 0){
              this.virtualStartIndex = 0;
            }
            if(this.virtualPaddingTop !== 0){
              this.virtualPaddingTop = 0;
            }
            if(this.virtualPaddingBottom !== 0){
              this.virtualPaddingBottom = 0;
            }
            return { start: 0, end: 0 };
          }

          const maxStart = Math.max(0, totalCount - this.virtualWindowSize);
          let startIndex = Math.min(this.virtualStartIndex, maxStart);
          if(startIndex !== this.virtualStartIndex){
            this.virtualStartIndex = startIndex;
          }

          const endIndex = Math.min(totalCount, startIndex + this.virtualWindowSize);
          const rowHeight = this.virtualRowHeight || 1;
          const top = startIndex * rowHeight;
          const bottom = Math.max(0, (totalCount - endIndex) * rowHeight);

          if(this.virtualPaddingTop !== top){
            this.virtualPaddingTop = top;
          }
          if(this.virtualPaddingBottom !== bottom){
            this.virtualPaddingBottom = bottom;
          }

          return { start: startIndex, end: endIndex };
        },
        visibleEmployees(){
          const sorted = this.sortedEmployees();
          const { start, end } = this.syncVirtualPadding(sorted.length);
          return sorted.slice(start, end);
        },
        visibleSelectionStats(){
          const visible = this.visibleEmployees();
          const total = visible.length;
          if(!total){
            return { total: 0, selected: 0 };
          }
          const store = Alpine.store('app');
          const normalize = (value) => {
            if(store && typeof store.normalizeId === 'function'){
              return store.normalizeId(value);
            }
            return value == null ? '' : String(value);
          };
          let selected = 0;
          for(const emp of visible){
            if(!emp){
              continue;
            }
            const key = normalize(emp.id);
            if(!key){
              continue;
            }
            const isSelected = store && typeof store.isEmployeeSelected === 'function'
              ? store.isEmployeeSelected(emp.id)
              : this.selectedEmployees.some(id => normalize(id) === key);
            if(isSelected){
              selected += 1;
            }
          }
          return { total, selected };
        },
        areAllVisibleSelected(){
          const { total, selected } = this.visibleSelectionStats();
          return total > 0 && selected === total;
        },
        areSomeVisibleSelected(){
          const { total, selected } = this.visibleSelectionStats();
          return total > 0 && selected > 0;
        },
        isEmployeeSelected(empId){
          const store = Alpine.store('app');
          if(store && typeof store.isEmployeeSelected === 'function'){
            return store.isEmployeeSelected(empId);
          }
          const key = empId == null ? '' : String(empId);
          if(!key){
            return false;
          }
          return this.selectedEmployees.some(id => (id == null ? '' : String(id)) === key);
        },
        toggleEmployeeSelection(empId, checked){
          const store = Alpine.store('app');
          if(store && typeof store.toggleEmployeeSelection === 'function'){
            store.toggleEmployeeSelection(empId, checked);
            return;
          }
          const key = empId == null ? '' : String(empId);
          if(!key){
            return;
          }
          const current = Array.isArray(this.selectedEmployees) ? [...this.selectedEmployees] : [];
          const exists = current.some(id => (id == null ? '' : String(id)) === key);
          if((checked === true || (checked == null && !exists)) && !exists){
            this.selectedEmployees = [...current, empId];
            return;
          }
          if((checked === false || (checked == null && exists)) && exists){
            this.selectedEmployees = current.filter(id => (id == null ? '' : String(id)) !== key);
          }
        },
        removeSelectedEmployee(empId){
          const store = Alpine.store('app');
          if(store && typeof store.toggleEmployeeSelection === 'function'){
            store.toggleEmployeeSelection(empId, false);
            return;
          }
          const key = empId == null ? '' : String(empId);
          if(!key){
            return;
          }
          this.selectedEmployees = this.selectedEmployees.filter(id => (id == null ? '' : String(id)) !== key);
        },
        toggleVisibleSelection(checked){
          const visible = this.visibleEmployees();
          if(!visible.length){
            return;
          }
          const store = Alpine.store('app');
          const ids = visible.filter(Boolean).map(emp => emp.id);
          if(checked){
            if(store && typeof store.selectEmployees === 'function'){
              store.selectEmployees(ids, { merge: true });
              return;
            }
            const current = Array.isArray(this.selectedEmployees) ? [...this.selectedEmployees] : [];
            const seen = new Set(current.map(id => (id == null ? '' : String(id))));
            for(const id of ids){
              const key = id == null ? '' : String(id);
              if(!key || seen.has(key)){
                continue;
              }
              seen.add(key);
              current.push(id);
            }
            this.selectedEmployees = current;
          } else {
            const toRemove = new Set(ids.map(id => (id == null ? '' : String(id))));
            this.selectedEmployees = this.selectedEmployees.filter(id => !toRemove.has(id == null ? '' : String(id)));
            if(store && typeof store.setSelectedEmployeeIds === 'function'){
              store.setSelectedEmployeeIds(this.selectedEmployees);
            }
          }
        },
        clearSelectedEmployees(){
          const store = Alpine.store('app');
          if(store && typeof store.clearSelectedEmployees === 'function'){
            store.clearSelectedEmployees();
          } else {
            this.selectedEmployees = [];
          }
          this.closeBulkPanels();
          this.bulkTemplateId = '';
          this.bulkStatusRequirementIds = [];
          this.bulkStatusAction = '';
          this.bulkStatusCompletedOn = '';
        },
        selectedEmployeeCount(){
          return Array.isArray(this.selectedEmployees) ? this.selectedEmployees.length : 0;
        },
        toggleBulkTemplatePanel(){
          this.bulkTemplatePanelOpen = !this.bulkTemplatePanelOpen;
          if(this.bulkTemplatePanelOpen){
            this.bulkStatusPanelOpen = false;
            if(!this.bulkTemplateId && this.templates.length){
              this.bulkTemplateId = this.templates[0].id;
            }
          }
        },
        toggleBulkStatusPanel(){
          this.bulkStatusPanelOpen = !this.bulkStatusPanelOpen;
          if(this.bulkStatusPanelOpen){
            this.bulkTemplatePanelOpen = false;
            if(!this.bulkStatusAction){
              this.bulkStatusAction = 'completed';
            }
            if(!this.bulkStatusCompletedOn){
              this.bulkStatusCompletedOn = new Date().toISOString().slice(0,10);
            }
          }
        },
        closeBulkPanels(){
          this.bulkTemplatePanelOpen = false;
          this.bulkStatusPanelOpen = false;
        },
        async bulkApplyTemplate(){
          const ids = Array.from(new Set(this.selectedEmployees));
          if(!ids.length){
            this.notify('Select employees before applying a template.', 'var(--warn)');
            return;
          }
          if(!this.bulkTemplateId){
            this.notify('Choose a template to apply.', 'var(--warn)');
            return;
          }
          const template = this.templates.find(t => t.id === this.bulkTemplateId);
          if(!template){
            this.notify('Template not found.', 'var(--danger)');
            return;
          }
          await this.applyTemplateToEmployees(template, ids);
          this.closeBulkPanels();
        },
        async bulkSetStatus(){
          if(this.bulkStatusSubmitting){
            return;
          }
          const ids = Array.from(new Set(this.selectedEmployees));
          if(!ids.length){
            this.notify('Select employees before updating status.', 'var(--warn)');
            return;
          }
          const requirementIds = Array.from(new Set(this.bulkStatusRequirementIds));
          if(!requirementIds.length){
            this.notify('Select at least one requirement to update.', 'var(--warn)');
            return;
          }
          let status = '';
          if(this.bulkStatusAction === 'completed'){
            status = 'Completed';
          } else if(this.bulkStatusAction === 'notRequired'){
            status = 'NotRequired';
          } else if(this.bulkStatusAction === 'notCompleted'){
            status = 'NotCompleted';
          }
          if(!status){
            this.notify('Choose a status to apply.', 'var(--warn)');
            return;
          }
          const completedOn = status === 'Completed'
            ? (this.bulkStatusCompletedOn || new Date().toISOString().slice(0,10))
            : null;
          let expiresOn = null;
          if(status === 'Completed'){
            expiresOn = {};
            for(const requirementId of requirementIds){
              const req = this.requirements.find(r => r.id === requirementId);
              if(!req){
                continue;
              }
              const hasDefaultExpiry = req?.defaultExpiryDays != null && req.defaultExpiryDays !== '';
              expiresOn[requirementId] = hasDefaultExpiry
                ? this.addDays(completedOn, req.defaultExpiryDays)
                : null;
            }
          }

          try{
            this.bulkStatusSubmitting = true;
            const { BulkUpdateStatus } = await import('./commands.js');
            const command = new BulkUpdateStatus(this.db, {
              employeeIds: ids,
              requirementIds,
              status,
              completedOn,
              expiresOn
            });
            await this.runCommand({
              command,
              actionType: 'BulkUpdateStatus',
              targets: [...ids],
              metadata: {
                employeeIds: [...ids],
                requirementIds: [...requirementIds],
                status,
                completedOn,
                expiresOn
              },
              successMessage: `Status updated for ${ids.length} employee${ids.length === 1 ? '' : 's'}.`,
              undoMessage: `Reverted status for ${ids.length} employee${ids.length === 1 ? '' : 's'}.`,
              refreshIcons: true
            });
            this.bulkStatusPanelOpen = false;
          }catch(error){
            console.error('Failed to apply bulk status update', error);
            this.notify('Failed to update status', 'var(--danger)');
          }finally{
            this.bulkStatusSubmitting = false;
          }
        },
        async bulkDeleteSelected(){
          const ids = Array.from(new Set(this.selectedEmployees));
          if(!ids.length){
            this.notify('Select employees before deleting.', 'var(--warn)');
            return;
          }
          if(!confirm(`Delete ${ids.length} employee${ids.length === 1 ? '' : 's'}? This cannot be undone without using undo.`)){
            return;
          }
          try{
            const { BulkDeleteEmployees } = await import('./commands.js');
            const command = new BulkDeleteEmployees(this.db, { employeeIds: ids });
            await this.runCommand({
              command,
              actionType: 'BulkDeleteEmployees',
              targets: [...ids],
              metadata: {
                employeeIds: [...ids],
                count: ids.length
              },
              successMessage: `${ids.length} employee${ids.length === 1 ? '' : 's'} deleted`,
              successColor: 'var(--warn)',
              undoMessage: `${ids.length} employee${ids.length === 1 ? '' : 's'} restored`,
              undoColor: 'var(--accent)',
              refreshIcons: true
            });
            this.clearSelectedEmployees();
          }catch(error){
            console.error('Failed to delete employees', error);
            this.notify('Failed to delete employees', 'var(--danger)');
          }
        },
        visibleColumnCount(){
          const baseColumns = 1 + this.visibleBaseColumnCount();
          return baseColumns + this.orderedVisibleRequirements().length;
        },
        measureVirtualRowHeight(){
          const container = this.$refs.virtualScroll;
          if(!container) return;
          const probe = container.querySelector('tbody tr[data-employee-row]');
          if(!probe) return;
          const height = probe.getBoundingClientRect().height;
          if(height > 0){
            const normalized = Math.max(1, Math.round(height));
            if(Math.abs(normalized - this.virtualRowHeight) > 0.5){
              this.virtualRowHeight = normalized;
            }
          }
          this.updateVirtualWindowSize();
        },
        updateVirtualWindowSize(){
          const container = this.$refs.virtualScroll;
          const rowHeight = this.virtualRowHeight || 48;
          if(!container || !rowHeight){
            const minimum = Math.max(50, this.virtualWindowSize || 0);
            if(this.virtualWindowSize !== minimum){
              this.virtualWindowSize = minimum;
              this.scheduleVirtualUpdate(() => {
                const sorted = this.sortedEmployees();
                this.syncVirtualPadding(sorted.length);
              });
            }
            return;
          }
          const visibleCount = Math.max(1, Math.ceil(container.clientHeight / rowHeight));
          const overscan = Math.max(0, this.virtualOverscan || 0);
          const desired = Math.max(visibleCount + overscan * 2, 50);
          if(this.virtualWindowSize !== desired){
            this.virtualWindowSize = desired;
            this.scheduleVirtualUpdate(() => {
              const sorted = this.sortedEmployees();
              this.syncVirtualPadding(sorted.length);
            });
          }
        },
        resetVirtualWindow({ scrollToTop = true } = {}){
          this.virtualScrollInitialized = false;
          this.virtualStartIndex = 0;
          if(scrollToTop){
            this.$nextTick(() => {
              const container = this.$refs.virtualScroll;
              if(container){
                container.scrollTop = 0;
              }
            });
          }
          this.$nextTick(() => {
            this.scheduleVirtualUpdate(() => {
              this.measureVirtualRowHeight();
              const sorted = this.sortedEmployees();
              this.syncVirtualPadding(sorted.length);
              this.refreshFeatherIcons();
            });
          });
        },
        handleVirtualScroll(){
          const container = this.$refs.virtualScroll;
          if(!container) return;
          if(!this.virtualScrollInitialized){
            this.virtualScrollInitialized = true;
            this.measureVirtualRowHeight();
          }
          this.updateVirtualWindowSize();
          const rowHeight = this.virtualRowHeight || 1;
          const sorted = this.sortedEmployees();
          const total = sorted.length;
          if(!total){
            this.syncVirtualPadding(0);
            return;
          }
          const overscan = Math.max(0, this.virtualOverscan || 0);
          const rawStart = Math.floor(container.scrollTop / rowHeight) - overscan;
          const maxStart = Math.max(0, total - this.virtualWindowSize);
          const startIndex = Math.min(Math.max(0, rawStart), maxStart);
          if(startIndex !== this.virtualStartIndex){
            this.virtualStartIndex = startIndex;
            this.syncVirtualPadding(total);
            this.refreshFeatherIcons();
          } else {
            this.syncVirtualPadding(total);
          }
        },
        ensureEmployeeVisible(employeeId){
          if(!employeeId) return;
          const sorted = this.sortedEmployees();
          const index = sorted.findIndex(emp => emp.id === employeeId);
          if(index === -1){
            return;
          }
          const halfWindow = Math.max(0, Math.floor(this.virtualWindowSize / 2));
          const maxStart = Math.max(0, sorted.length - this.virtualWindowSize);
          const desiredStart = Math.min(Math.max(0, index - halfWindow), maxStart);
          if(desiredStart !== this.virtualStartIndex){
            this.virtualStartIndex = desiredStart;
          }
          this.$nextTick(() => {
            const container = this.$refs.virtualScroll;
            if(container){
              const rowHeight = this.virtualRowHeight || 1;
              container.scrollTop = desiredStart * rowHeight;
            }
            this.scheduleVirtualUpdate(() => {
              this.syncVirtualPadding(sorted.length);
              this.refreshFeatherIcons();
            });
          });
        },
        async addEmployee(){
          if (!this.newEmployee.firstName || !this.newEmployee.lastName) {
            this.notify('First name and last name are required', 'var(--danger)');
            return;
          }
          const employee = {
            id: generateId(),
            ...this.newEmployee,
            status: this.newEmployee.status || 'Active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };

          const LegacyAPI = {
            addEmployee: async ({ employee: legacyEmployee }) => {
              const { AddEmployee } = await import('./commands.js');
              const command = new AddEmployee(this.db, { employee: legacyEmployee });
              const undoPayload = await command.execute();
              await this.recordActivity('AddEmployee', [legacyEmployee.id], { employee: legacyEmployee }, undoPayload);
              return { undoPayload };
            }
          };

          const API = window.APP_FLAGS.USE_V2_MAIN ? CompatAPI : LegacyAPI;

          try{
            await API.addEmployee({
              db: this.db,
              activityLog: this.activityLog,
              employee,
              actor: 'user',
              metadata: { employee },
              supportsUndo: true
            });
            this.newEmployee = {firstName:'', lastName:'', role:'', employmentType:'FT', employeeId:'', seniorityHours:'', status:'Active'};
            this.showAddEmployeeModal = false;
            await this.loadData();
            this.refreshFeatherIcons();
            this.notify('Employee added successfully');
          }catch(error){
            console.error('Failed to add employee', error);
            this.notify('Failed to add employee', 'var(--danger)');
          }
        },
        async handleEmployeeAdded(employee){
          this.showAddEmployeeModal = false;

          if(employee && employee.id){
            try {
              await this.recordActivity('AddEmployee', [employee.id], { employee }, null, { supportsUndo: false });
            } catch (error) {
              console.warn('Failed to record employee addition activity', error);
            }
          }

          await this.loadData();
          this.refreshFeatherIcons();

          const label = employee?.name && typeof employee.name === 'string' && employee.name.trim()
            ? employee.name.trim()
            : 'Employee';
          this.notify(`${label} added successfully`);
        },
        handleEmployeeAddFailed(error){
          this.showAddEmployeeModal = false;
          if(error){
            console.error('Employee add failed', error);
          }
          this.notify('Failed to add employee', 'var(--danger)');
        },
        async addRequirement(){
          if (!this.newRequirement.name) {
            this.notify('Requirement name is required', 'var(--danger)');
            return;
          }
          const req = {
            id: generateId(),
            ...this.newRequirement,
            defaultExpiryDays: this.newRequirement.defaultExpiryDays ? parseInt(this.newRequirement.defaultExpiryDays) : null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          try{
            const { AddRequirement } = await import('./commands.js');
            const command = new AddRequirement(this.db, { requirement: req });
            const undoPayload = await command.execute();
            await this.recordActivity('AddRequirement', [req.id], { requirement: req }, undoPayload);
            this.newRequirement = {name:'', defaultExpiryDays:'', color:'#e0e7ff'};
            this.showAddRequirementModal = false;
            await this.loadData();
            this.refreshFeatherIcons();
            this.notify('Requirement added successfully');
          }catch(error){
            console.error('Failed to add requirement', error);
            this.notify('Failed to add requirement', 'var(--danger)');
          }
        },
        async editRequirement(req){
          this.editingRequirement = { ...req, defaultExpiryDays: req.defaultExpiryDays ?? '' };
          this.showEditRequirementModal = true;
        },
        async updateRequirement(){
          const r = this.editingRequirement;
          if (!r.name || !r.name.trim()) {
            this.notify('Requirement name is required', 'var(--danger)');
            return;
          }
          if (r.defaultExpiryDays && isNaN(parseInt(r.defaultExpiryDays))) {
            this.notify('Expiry days must be a number', 'var(--danger)');
            return;
          }
          const updateData = {
            name: r.name,
            color: r.color,
            defaultExpiryDays: r.defaultExpiryDays ? parseInt(r.defaultExpiryDays) : null,
            updatedAt: new Date().toISOString()
          };
          try{
            const { UpdateRequirement } = await import('./commands.js');
            const command = new UpdateRequirement(this.db, { requirementId: r.id, newData: updateData });
            const undoPayload = await command.execute();
            await this.recordActivity('UpdateRequirement', [r.id], { newData: updateData }, undoPayload);
            this.showEditRequirementModal = false;
            await this.loadData();
            this.refreshFeatherIcons();
            this.notify('Requirement updated');
          }catch(error){
            console.error('Failed to update requirement', error);
            this.notify('Failed to update requirement', 'var(--danger)');
          }
        },
        confirmDeleteRequirement(req){
          if(confirm(`Delete requirement "${req.name}"? This will remove all related records.`)){
            this.deleteRequirement(req);
          }
        },
        async deleteRequirement(req){
          try{
            const { DeleteRequirement } = await import('./commands.js');
            const command = new DeleteRequirement(this.db, { requirementId: req.id });
            await this.runCommand({
              command,
              actionType: 'DeleteRequirement',
              targets: [req.id],
              metadata: { requirement: req },
              successMessage: 'Requirement deleted',
              successColor: 'var(--warn)',
              undoMessage: 'Requirement restored',
              refreshIcons: true
            });
          }catch(error){
            console.error('Failed to delete requirement', error);
            this.notify('Failed to delete requirement', 'var(--danger)');
          }
        },
        async editEmployee(emp){
          this.editingEmployee = { ...emp, seniorityHours: emp.seniorityHours ?? '' };
          this.ensureLookupValue('role', emp.role);
          this.ensureLookupValue('employmentType', emp.employmentType);
          this.ensureLookupValue('status', emp.status);
          this.showEditEmployeeModal = true;
        },
        async updateEmployee(){
          const e = this.editingEmployee;
          if (!e.firstName || !e.firstName.trim() || !e.lastName || !e.lastName.trim()) {
            this.notify('First and last name are required', 'var(--danger)');
            return;
          }
          if (e.seniorityHours && isNaN(parseFloat(e.seniorityHours))) {
            this.notify('Seniority hours must be a number', 'var(--danger)');
            return;
          }
          const updateData = {
            firstName: e.firstName,
            lastName: e.lastName,
            role: e.role,
            employmentType: e.employmentType,
            status: e.status,
            employeeId: e.employeeId,
            seniorityHours: e.seniorityHours,
            updatedAt: new Date().toISOString()
          };
          try{
            const { UpdateEmployee } = await import('./commands.js');
            const command = new UpdateEmployee(this.db, { employeeId: e.id, newData: updateData });
            const undoPayload = await command.execute();
            await this.recordActivity('UpdateEmployee', [e.id], { newData: updateData }, undoPayload);
            this.showEditEmployeeModal = false;
            await this.loadData();
            this.refreshFeatherIcons();
            this.notify('Employee updated');
          }catch(error){
            console.error('Failed to update employee', error);
            this.notify('Failed to update employee', 'var(--danger)');
          }
        },
        confirmDeleteEmployee(emp){
          if(!emp) return;
          const label = this.getEmployeeLabel(emp);
          if(confirm(`Delete employee "${label}"? This will remove all associated records.`)){
            this.deleteEmployee(emp);
          }
        },
        async deleteEmployee(emp){
          if (!emp?.id) return;
          try{
            const { DeleteEmployee } = await import('./commands.js');
            const command = new DeleteEmployee(this.db, { employeeId: emp.id });
            await this.runCommand({
              command,
              actionType: 'DeleteEmployee',
              targets: [emp.id],
              metadata: {
                employeeId: emp.id,
                firstName: emp.firstName,
                lastName: emp.lastName,
                displayName: this.getEmployeeName(emp) || this.getEmployeeLabel(emp)
              },
              successMessage: `Deleted ${this.getEmployeeLabel(emp)}`,
              successColor: 'var(--warn)',
              undoMessage: `Restored ${this.getEmployeeLabel(emp)}`,
              refreshIcons: true
            });
            this.showEditEmployeeModal = false;
            this.editingEmployee = {};
            this.removeSelectedEmployee(emp.id);
          }catch(error){
            console.error('Failed to delete employee', error);
            this.notify('Failed to delete employee', 'var(--danger)');
          }
        },
        getStatusTooltip(empId, reqId){
          const er = this.getER(empId, reqId);
          if (!er) {
            return 'Not completed yet';
          }
          if (er.status === 'NotRequired') {
            return 'Not required for this employee';
          }
          if (er.status !== 'Completed') {
            return !er.completedOn ? 'Not completed yet' : 'Marked incomplete';
          }
          if (er.expiresOn) {
            const daysLeft = Math.ceil((new Date(er.expiresOn) - new Date()) / 86400000);
            if (daysLeft <= 0) return 'Expired';
            return `Completed, expires in ${daysLeft} days`;
          }
          return 'Completed (no expiry)';
        },
      });

    if (!skipLegacyBootstrap) {
      registerLegacyComponent('modalStateBinding', modalStateBinding);
      registerLegacyComponent('modalStoreBinding', modalStoreBinding);
      registerLegacyComponent('mappingPanel', mappingPanel);
      registerLegacyComponent('activityTimeline', activityTimeline);
      registerLegacyComponent('addEmployeeModal', addEmployeeModal);
      registerLegacyComponent('app', app);

      function showFallback() {
        document.body?.removeAttribute('x-cloak');

        const dashboard = document.getElementById('dashboard-app');
        if (dashboard) {
          dashboard.setAttribute('hidden', '');
        }

        const fallback = document.getElementById('alpine-fallback');
        if (fallback) {
          fallback.removeAttribute('hidden');
        }
      }

      function hideFallback() {
        const fallback = document.getElementById('alpine-fallback');
        if (fallback && !fallback.hasAttribute('hidden')) {
          fallback.setAttribute('hidden', '');
        }

        const dashboard = document.getElementById('dashboard-app');
        if (dashboard) {
          dashboard.removeAttribute('hidden');
        }
      }

      document.addEventListener('alpine:initialized', () => {
        hideFallback();
      });

      window.addEventListener('load', () => {
        setTimeout(() => {
          const rootStack = document.body ? document.body._x_dataStack : null;
          const alpineReady = Boolean(window.Alpine) && Array.isArray(rootStack) && rootStack.length > 0;

          if (!alpineReady) {
            console.error('Alpine.js failed to initialize');
            showFallback();
          }
        }, 1200);
      });
      const replaceFeatherIcons = () => {
        safeFeatherReplace();
      };

      document.addEventListener('DOMContentLoaded', replaceFeatherIcons);
      document.addEventListener('alpine:init', replaceFeatherIcons);

      document.addEventListener('employee:added', event => {
        const root = qs(document, '[x-data="app"]');
        if (!root) {
          return;
        }

        const target = event?.target ?? null;
        if (target && target !== document && target !== window && root.contains(target)) {
          return;
        }

        const component = root.__x?.$data;
        if (!component || typeof component.loadData !== 'function') {
          return;
        }

        Promise.resolve(component.loadData())
          .then(() => {
            if (typeof component.refreshFeatherIcons === 'function') {
              component.refreshFeatherIcons();
            }
          })
          .catch(error => {
            console.error('Failed to refresh employees after external addition', error);
          });
      });

      window.addEventListener('employee-import:missing-columns', (event) => {
        const detail = event?.detail;
        const columns = Array.isArray(detail?.columns) ? detail.columns : [];
        const root = qs(document, '[x-data="app"]');
        const component = root && root.__x ? root.__x.$data : null;
        if (component && typeof component.handleExternalMissingColumns === 'function'){
          component.handleExternalMissingColumns(columns);
        }
      });
    }

  if (!skipLegacyBootstrap) {
    window.addEventListener('DOMContentLoaded', ()=> {
      if (window.__initImportUI) window.__initImportUI();
    });

    Alpine.start();
  }
