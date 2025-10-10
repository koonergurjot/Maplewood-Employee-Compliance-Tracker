// Consolidated application initialization script extracted from index.html
// Ensures bundler processes the entire dashboard logic.

import Alpine from 'alpinejs';
import Papa from 'papaparse';
import Chart from 'chart.js/auto';
import Sortable from 'sortablejs';
import Fuse from 'fuse.js';
import { safeFeatherReplace } from './feather-utils.js';

import './styles.css';
import './import-employees.js';
import './onboarding.js';
import { createDatabase, ensureDexieLoaded, generateId } from './db.js';

let cachedXlsx = (typeof window !== 'undefined' && (window.__xlsxModule || window.XLSX)) || null;
let xlsxLoadPromise = null;
let xlsxCdnPromise = null;

const XLSX_CDN_TIMEOUT_MS = 15000;
const XLSX_TIMEOUT_MESSAGE = 'We couldn\'t load Excel support from the CDN in time. Please try again later or use the CSV import option instead.';

function withTimeout(promise, timeoutMs, timeoutMessage){
  if(typeof timeoutMs !== 'number' || timeoutMs <= 0) return promise;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(timeoutMessage || 'Operation timed out.');
      error.name = 'TimeoutError';
      reject(error);
    }, timeoutMs);

    promise.then(value => {
      clearTimeout(timer);
      resolve(value);
    }, error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function resolveXlsxFromGlobals(){
  if(typeof window === 'undefined') return null;
  return window.__xlsxModule || window.XLSX || null;
}

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

function injectXlsxFromCdn(){
  const existingGlobal = resolveXlsxFromGlobals();
  if(existingGlobal) return Promise.resolve(existingGlobal);

  if(xlsxCdnPromise) return xlsxCdnPromise;

  xlsxCdnPromise = new Promise((resolve, reject) => {
    if(typeof document === 'undefined'){
      reject(new Error('No document available to load XLSX script.'));
      return;
    }

    const finalize = () => {
      const module = resolveXlsxFromGlobals();
      if(module){
        resolve(module);
      } else {
        reject(new Error('XLSX still unavailable after loading CDN script.'));
      }
    };

    const existing = document.querySelector('script[data-xlsx-loader]');
    if(existing){
      if(resolveXlsxFromGlobals()){
        finalize();
        return;
      }
      existing.addEventListener('load', finalize, { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load XLSX from CDN.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.async = true;
    script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    script.dataset.xlsxLoader = 'true';
    script.addEventListener('load', finalize, { once: true });
    script.addEventListener('error', () => reject(new Error('Failed to load XLSX from CDN.')), { once: true });
    document.head.appendChild(script);
  }).finally(() => {
    if(!resolveXlsxFromGlobals()){
      xlsxCdnPromise = null;
    }
  });

  return xlsxCdnPromise;
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
        console.warn('Dynamic XLSX import failed, attempting CDN fallback.', importError);
        try {
          const cdnModule = await withTimeout(injectXlsxFromCdn(), XLSX_CDN_TIMEOUT_MS, XLSX_TIMEOUT_MESSAGE);
          const raceResolved = resolveXlsxFromGlobals();
          if(raceResolved) return rememberXlsxModule(raceResolved);
          const resolvedAfterCdn = rememberXlsxModule(cdnModule || resolveXlsxFromGlobals());
          if(resolvedAfterCdn) return resolvedAfterCdn;
          throw new Error('XLSX still unavailable');
        } catch (cdnError) {
          if(cdnError?.name === 'TimeoutError'){
            xlsxCdnPromise = null;
          }
          throw cdnError;
        }
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

const BUILD_HASH = typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'dev';
    function activityTimeline(){
      return {
        entries: [],
        async load(){
          if(!this?.$root){
            console.warn('Activity timeline missing root context.');
            return;
          }

          try {
            await waitForReady();
          } catch (error) {
            console.warn('Activity timeline wait for app readiness failed.', error);
            return;
          }

          if(!this.$root.appReady || !this.$root.db){
            console.warn('Activity timeline load aborted: app not ready after wait.');
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
            BulkUpdateStatus: e => new commands.BulkUpdateStatus(this.$root.db, {
              employeeIds: e.metadata?.employeeIds || e.targets || [],
              requirementIds: e.metadata?.requirementIds || [],
              status: e.metadata?.status,
              completedOn: e.metadata?.completedOn || null
            }),
            BulkDeleteEmployees: e => new commands.BulkDeleteEmployees(this.$root.db, {
              employeeIds: e.metadata?.employeeIds || e.targets || []
            }),
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

    const app = () => ({
        loadError:'',
        darkMode:false, showImportModal:false, showExportDropdown:false,
        showSettingsModal:false, settingsSortable:null,
        showActivityLogModal:false,
        appReady:false,
        pendingTimelineRefresh:false,
        db:null, activityLog:null, employees:[], requirements:[], employeeRequirements:[], erMap:new Map(), visibleRequirements:[],
        templates:[], templateRoleMap:new Map(), showTemplateForm:false,
        templateEditor:{ id:null, name:'', rolesInput:'', excludedRequirementIds:[] },
        templateApplyLoading:false,
        importHeaders: [], // ensure array exists before templates iterate over it
        // Toast notification variables
        showToast: false, toastMessage: '', toastColor: 'var(--success)', toastUndo:null, toastTimeout:null,
        lastDeletedRequirement:null,
        highlightHelpButton:false,
        tourMarkedSeen:false,
        tourPromptActive:false,
        // Import UI state
        importType:'excel', importMode:'employees', importData:[],
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
        // Admin panel state
        showAddEmployeeModal:false, showAddRequirementModal:false, showBulkActionsModal:false,
        showEditEmployeeModal:false, showEditRequirementModal:false,
          searchQuery:'', roleFilter:'', statusFilter:'', reqStatusFilter:'', filteredEmployees:[], isFiltering:false, sortField:'firstName', sortDirection:'asc',
          globalSearch:'', searchResults:[],
          globalSearchIndex:null, globalSearchIndexVersion:-1, globalSearchDataVersion:0, globalSearchData:[],
        newEmployee:{firstName:'', lastName:'', role:'', employmentType:'FT', employeeId:'', seniorityHours:''},
          newRequirement:{name:'', defaultExpiryDays:'', color:'#e0e7ff'},
          editingEmployee:{}, editingRequirement:{},
        selectedEmployees:[], selectedRequirements:[], bulkAction:'',
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

          await this.initActivityLog();
          await this.loadData();
          if (this.loadError || !this.db) return;
          this.setAppReady(true);
          const s = await this.db.settings.get('app');
          if (s?.darkMode) this.darkMode = true;
          document.documentElement.classList.toggle('dark', this.darkMode);

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
            const swUrl = `/sw.js?build=${encodeURIComponent(BUILD_HASH)}`;

            const needsClassicFallback = (error) => {
              if (!error) return false;
              if (error.name === 'TypeError') return true;
              const message = String(error.message || '').toLowerCase();
              if (!message) return false;
              return message.includes('module') || message.includes('mime');
            };

            try {
              await navigator.serviceWorker.register(swUrl, { type: 'module' });
            } catch (moduleError) {
              if (needsClassicFallback(moduleError)) {
                console.warn('Module service worker registration failed, retrying without module type', moduleError);
                try {
                  await navigator.serviceWorker.register(swUrl);
                } catch (classicError) {
                  console.warn('Service worker registration failed after module fallback', classicError);
                }
              } else {
                console.warn('Service worker registration failed', moduleError);
              }
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
          if(!this.loadError && this.db){
            this.setAppReady(true);
          }
          this.notify('All data cleared');
        },

        async loadData(){
          if (this.loadError || !this.db) return;
          const [employees, requirements, employeeRequirements] = await Promise.all([
            this.db.employees.toArray(),
            this.db.requirements.toArray(),
            this.db.employeeRequirements.toArray()
          ]);
          this.employees = employees;
          this.requirements = requirements;
          this.employeeRequirements = employeeRequirements;
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
            this.filterEmployees();
          }
        },

        setAppReady(isReady){
          this.appReady = Boolean(isReady);
          if(this.appReady && this.db){
            appState.markReady();
          } else if(!this.appReady && this.loadError){
            appState.fail(new Error(this.loadError));
          } else if(!this.appReady){
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
          const timestamp = new Date().toISOString();
          const excludedSet = new Set((template?.excludedRequirementIds || []).map(id => (id ?? '').toString().trim()).filter(Boolean));
          const requirementIds = this.requirements.map(r => r.id);
          try{
            await this.db.transaction('rw', this.db.employeeRequirements, async () => {
              for (const employeeId of employeeIds){
                for (const requirementId of requirementIds){
                  const isExcluded = excludedSet.has((requirementId ?? '').toString().trim());
                  const existing = this.getER(employeeId, requirementId);
                  if(existing){
                    if(isExcluded){
                      if(existing.status !== 'NotRequired' || existing.completedOn || existing.expiresOn){
                        await this.db.employeeRequirements.update(existing.id, {
                          status:'NotRequired',
                          completedOn:null,
                          expiresOn:null,
                          updatedAt: timestamp
                        });
                      }
                    } else if (existing.status === 'NotRequired') {
                      await this.db.employeeRequirements.update(existing.id, {
                        status:'NotCompleted',
                        completedOn:null,
                        expiresOn:null,
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
                  }
                }
              }
            });
            await this.loadData();
            this.notify(`Template applied to ${employeeIds.length} employee${employeeIds.length === 1 ? '' : 's'}.`);
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
          this.toastMessage=msg;
          this.toastColor=color;
          this.toastUndo=undoHandler;
          this.showToast=true;
          if(this.toastTimeout){
            clearTimeout(this.toastTimeout);
          }
          this.toastTimeout=setTimeout(()=>{
            this.showToast=false;
            this.toastUndo=null;
            this.toastTimeout=null;
          },duration);
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
            if(this.toastTimeout){
              clearTimeout(this.toastTimeout);
              this.toastTimeout=null;
            }
            this.showToast=false;
            this.toastUndo=null;
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
          if(!this.activityLog) return;
          try{
            await this.activityLog.record({
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
          }catch(error){
            console.error('Failed to record activity', error);
          }
        },
        async toggleDarkMode(){
          this.darkMode=!this.darkMode;
          document.documentElement.classList.toggle('dark', this.darkMode);
          this.renderComplianceChart();
          if (this.loadError || !this.db) return;
          const prev=await this.db.settings.get('app')||{id:'app'};
          await this.db.settings.put({...prev, darkMode:this.darkMode});
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
          const file = event.target.files?.[0];
          if(!file) { this.importLoading=false; return; }

          // File validation
          const maxSize = 10 * 1024 * 1024; // 10MB
          if (file.size > maxSize) {
            this.importError = 'File size exceeds 10MB limit. Please choose a smaller file.';
            this.importLoading = false;
            return;
          }

          const fileExtension = '.' + file.name.split('.').pop().toLowerCase();

          if (this.importMode === 'backup') {
            if (fileExtension !== '.json') {
              this.importError = 'Backups must be uploaded as JSON (.json).';
              this.importLoading = false;
              return;
            }
            try {
              await this.loadBackupFromFile(file);
            } finally {
              this.importLoading = false;
            }
            return;
          }

          const allowedTypes = ['.csv', '.xlsx', '.xls'];
          if (!allowedTypes.includes(fileExtension)) {
            this.importError = 'Invalid file type. Please upload a CSV or Excel file (.csv, .xlsx, .xls).';
            this.importLoading = false;
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
          } else {
            let xlsx;
            try {
              xlsx = await loadXlsx();
            } catch (loaderError) {
              console.error('Failed to load XLSX library:', loaderError);
              this.importError = 'XLSX still unavailable. Please check your connection and try again.';
              this.importLoading = false;
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
              }catch(err){
                console.error('Excel processing error:', err);
                this.importError = `Failed to read Excel file: ${err.message || 'Unknown error'}. Ensure it is .xlsx or .xls format and not password protected.`;
                this.importLoading = false;
              }
            };
            reader.onerror = () => {
              this.importError = 'Failed to read the file. Please try again.';
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
            return;
          }
          const reader = new FileReader();
          reader.onload = async (e) => {
            try {
              const data = new Uint8Array(e.target.result);
              const wb = xlsx.read(data, { type:'array', cellDates: true, cellNF: false, cellText: false });

              if (!wb.Sheets[name]) {
                this.importError = `Worksheet "${name}" not found in the file.`;
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
              } else if (this.importData.length === 0) {
                this.importError = `No data rows found in worksheet "${name}".`;
              }
            } catch (err) {
              console.error('Error selecting Excel sheet:', err);
              this.importError = `Failed to process worksheet "${name}": ${err.message || 'Unknown error'}`;
            }
          };
          reader.onerror = () => {
            this.importError = 'Failed to read the file. Please try again.';
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
          if(!this.importErrors.length) return;
          const rows = [['Row','Error'], ...this.importErrors.map(e=>[e.row, e.message])];
          const newline = '\n';
          const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join(newline);
          const blob = new Blob([csv], {type:'text/csv'});
          this.downloadBlob(blob, 'import-errors.csv');
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
          const hasName = Boolean((this.columnMap.firstName && this.columnMap.lastName) || this.columnMap.payrollName);
          if (!hasName) missing.push('Name');
          if (!this.columnMap.employeeId) missing.push('Employee ID');
          if (!this.columnMap.seniorityHours) missing.push('Seniority Hours');
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
        },

        async processImport(){
          this.importError='';
          if (this.importMode === 'backup'){
            const summary = await this.restoreBackup();
            if(!summary) return;
            this.showImportModal=false;
            await this.loadData();
            return;
          }
          if (!this.importData.length || !this.importHeaders.length){ this.importError='Nothing to import'; return; }
          if (this.importMode==='employees'){
            if (!(this.columnMap.firstName || this.columnMap.lastName || this.columnMap.payrollName)){
              this.importError='Map at least First/Last or Payroll Name before importing.'; return;
            }
            const res = await this.importEmployees();
            if(!res) return;
            this.showImportModal=false;
            await this.loadData();
            this.notify(`Employees: ${res.added} added, ${res.updated} updated • Total now: ${this.employees.length}`);
          } else {
            const hasAny = Object.values(this.completionMap).some(Boolean);
            if (!hasAny){ this.importError='Select at least one requirement column on the right to import completions.'; return; }
            const cnt = await this.importCompletions();
            if(cnt === null) return;
            this.showImportModal=false;
            await this.loadData();
            this.notify(`Completions updated: ${cnt}`);
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
          if (!incoming.length) {
            return { added: 0, updated: 0, skipped: skipped.length };
          }
          try{
            const { ImportEmployees } = await import('./commands.js');
            const command = new ImportEmployees(this.db, { employees: incoming });
            const undoPayload = await command.execute();
            const added = undoPayload.addedEmployees?.length || 0;
            const updated = undoPayload.updatedSnapshots?.length || 0;
            const targets = new Set();
            (undoPayload.addedEmployees || []).forEach(emp => targets.add(emp.id));
            (undoPayload.updatedSnapshots || []).forEach(emp => targets.add(emp.id));
            if (added || updated) {
              await this.recordActivity('ImportEmployees', Array.from(targets), {
                added,
                updated,
                skipped: skipped.length,
                mapping: this.getEmployeeImportMappingSnapshot(),
                missingColumns: [...this.missingRequiredColumns],
                sourceHeaders: [...this.importHeaders]
              }, undoPayload);
            }
            return { added, updated, skipped: skipped.length };
          }catch(error){
            console.error('Failed to import employees', error);
            this.notify('Failed to import employees', 'var(--danger)');
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
              const first = (emp.firstName ?? '').toString().toLowerCase();
              const last = (emp.lastName ?? '').toString().toLowerCase();
              const role = (emp.role ?? '').toString().toLowerCase();
              const employeeId = (emp.employeeId ?? '').toString().toLowerCase();
              return (
                first.includes(query) ||
                last.includes(query) ||
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
        },
        performGlobalSearch(query){
          const requirementSource = this.orderedVisibleRequirements();
          const requirementsList = requirementSource.length ? requirementSource : this.requirements;
          const needsRebuild = !this.globalSearchIndex || this.globalSearchIndexVersion !== this.globalSearchDataVersion;

          if (needsRebuild) {
            const data = [
              ...this.employees.map(e => {
                const firstName = e.firstName || '';
                const lastName = e.lastName || '';
                const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
                const role = e.role || '';
                const employeeId = e.employeeId ? String(e.employeeId) : '';
                const textParts = [fullName, role, employeeId].filter(Boolean);
                return {
                  type: 'employee',
                  id: e.id,
                  text: textParts.join(' ').trim(),
                  label: fullName || role || employeeId || 'Employee',
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
          this.$nextTick(() => {
            let selector = '';
            if(type === 'employee'){
              selector = `[data-employee-row="${id}"]`;
            } else if(type === 'requirement'){
              selector = `[data-requirement-header="${id}"]`;
            }
            if(!selector) return;
            const target = document.querySelector(selector);
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
        sortEmployees(field){
          if (this.sortField === field) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
          } else {
            this.sortField = field;
            this.sortDirection = 'asc';
          }
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
        async addEmployee(){
          if (!this.newEmployee.firstName || !this.newEmployee.lastName) {
            this.notify('First name and last name are required', 'var(--danger)');
            return;
          }
          const emp = {
            id: generateId(),
            ...this.newEmployee,
            status: 'Active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          try{
            const { AddEmployee } = await import('./commands.js');
            const command = new AddEmployee(this.db, { employee: emp });
            const undoPayload = await command.execute();
            await this.recordActivity('AddEmployee', [emp.id], { employee: emp }, undoPayload);
            this.newEmployee = {firstName:'', lastName:'', role:'', employmentType:'FT', employeeId:'', seniorityHours:''};
            this.showAddEmployeeModal = false;
            await this.loadData();
            this.refreshFeatherIcons();
            this.notify('Employee added successfully');
          }catch(error){
            console.error('Failed to add employee', error);
            this.notify('Failed to add employee', 'var(--danger)');
          }
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
            const undoPayload = await command.execute();
            this.lastDeletedRequirement = undoPayload;
            await this.recordActivity('DeleteRequirement', [req.id], { requirement: req }, undoPayload);
            await this.loadData();
            this.refreshFeatherIcons();
            this.notify('Requirement deleted','var(--warn)',() => this.undoDeleteRequirement());
          }catch(error){
            console.error('Failed to delete requirement', error);
            this.notify('Failed to delete requirement', 'var(--danger)');
          }
        },
        async undoDeleteRequirement(){
          if(!this.lastDeletedRequirement) return;
          await this.db.requirements.add(this.lastDeletedRequirement.requirement);
          if(this.lastDeletedRequirement.employeeRequirements.length){
            await this.db.employeeRequirements.bulkAdd(this.lastDeletedRequirement.employeeRequirements);
          }
          this.lastDeletedRequirement=null;
          this.toastUndo=null;
          await this.loadData();
          this.refreshFeatherIcons();
          this.notify('Requirement restored');
        },
        async editEmployee(emp){
          this.editingEmployee = { ...emp, seniorityHours: emp.seniorityHours ?? '' };
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
        async executeBulkAction(){
          if (!this.bulkAction || !this.selectedEmployees.length) return;

          if (this.bulkAction === 'complete' || this.bulkAction === 'incomplete') {
            if (!this.selectedRequirements.length) {
              this.notify('Please select at least one requirement', 'var(--danger)');
              return;
            }
            const status = this.bulkAction === 'complete' ? 'Completed' : 'NotCompleted';
            const completedOn = this.bulkAction === 'complete' ? new Date().toISOString().slice(0,10) : null;
            let expiresOn = null;
            if (status === 'Completed') {
              expiresOn = {};
              for (const requirementId of this.selectedRequirements) {
                const req = this.requirements.find(r => r.id === requirementId);
                if (!req) continue;
                const hasDefaultExpiry = req.defaultExpiryDays !== undefined && req.defaultExpiryDays !== null;
                expiresOn[requirementId] = hasDefaultExpiry ? this.addDays(completedOn, req.defaultExpiryDays) : null;
              }
            }
            try{
              const { BulkUpdateStatus } = await import('./commands.js');
              const command = new BulkUpdateStatus(this.db, {
                employeeIds: [...this.selectedEmployees],
                requirementIds: [...this.selectedRequirements],
                status,
                completedOn,
                expiresOn
              });
              const undoPayload = await command.execute();
              if (undoPayload.changes?.length) {
                await this.recordActivity('BulkUpdateStatus', [...this.selectedEmployees], {
                  employeeIds: [...this.selectedEmployees],
                  requirementIds: [...this.selectedRequirements],
                  status,
                  completedOn,
                  expiresOn
                }, undoPayload);
              }
              this.notify(`Bulk ${this.bulkAction} completed for ${this.selectedEmployees.length} employees`);
            }catch(error){
              console.error('Failed to apply bulk status update', error);
              this.notify('Failed to apply bulk status update', 'var(--danger)');
            }
          } else if (this.bulkAction === 'export') {
            const selectedEmps = this.employees.filter(emp => this.selectedEmployees.includes(emp.id));
            const data = {
              employees: selectedEmps,
              requirements: this.requirements,
              employeeRequirements: this.employeeRequirements.filter(er => this.selectedEmployees.includes(er.employeeId))
            };
            const jsonBlob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
            this.downloadBlob(jsonBlob, `selected-employees-${new Date().toISOString().split('T')[0]}.json`);
            this.notify('Selected employees exported');
          } else if (this.bulkAction === 'delete') {
            if (confirm(`Are you sure you want to delete ${this.selectedEmployees.length} employees? This action cannot be undone.`)) {
              try{
                const { BulkDeleteEmployees } = await import('./commands.js');
                const command = new BulkDeleteEmployees(this.db, { employeeIds: [...this.selectedEmployees] });
                const undoPayload = await command.execute();
                if ((undoPayload.employees?.length || undoPayload.employeeRequirements?.length)) {
                  await this.recordActivity('BulkDeleteEmployees', [...this.selectedEmployees], {
                    employeeIds: [...this.selectedEmployees],
                    count: this.selectedEmployees.length
                  }, undoPayload);
                }
                this.notify(`${this.selectedEmployees.length} employees deleted`);
              }catch(error){
                console.error('Failed to delete employees', error);
                this.notify('Failed to delete employees', 'var(--danger)');
              }
            }
          }

          this.selectedEmployees = [];
          this.selectedRequirements = [];
          this.bulkAction = '';
          this.showBulkActionsModal = false;
          await this.loadData();
        }
      });

    Alpine.data('activityTimeline', activityTimeline);
    Alpine.data('app', app);

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

    window.addEventListener('employee-import:missing-columns', (event) => {
      const detail = event?.detail;
      const columns = Array.isArray(detail?.columns) ? detail.columns : [];
      const root = document.querySelector('[x-data="app"]');
      const component = root && root.__x ? root.__x.$data : null;
      if (component && typeof component.handleExternalMissingColumns === 'function'){
        component.handleExternalMissingColumns(columns);
      }
    });
  window.addEventListener('DOMContentLoaded', ()=> {
    if (window.__initImportUI) window.__initImportUI();
  });

  Alpine.start();
