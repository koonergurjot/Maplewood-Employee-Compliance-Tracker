// Consolidated application initialization script extracted from index.html
// Ensures bundler processes the entire dashboard logic.

import './import-employees.js';
import { createDatabase, generateId } from './db.js';

window.addEventListener('DOMContentLoaded', function () {
  // Fallback for XLSX library loading
  if (typeof XLSX === 'undefined') {
    console.error('XLSX library failed to load. Trying alternative CDN...');
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js';
    script.onerror = function () {
      console.error('Alternative XLSX CDN also failed to load');
    };
    document.head.appendChild(script);
  }
});
    function activityTimeline(){
      return {
        entries: [],
        async load(){
          if(!this?.$root?.db){
            this.$nextTick(() => this.load());
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

    document.addEventListener('alpine:init', () => {
      Alpine.data('activityTimeline', activityTimeline);
      Alpine.data('app', () => ({
        loadError:'',
        darkMode:false, showImportModal:false, showExportDropdown:false,
        showSettingsModal:false, settingsSortable:null,
        showActivityLogModal:false,
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
        nameFormat:'auto', previewEligible:0, dryRunDetails:[], dryRunSummary:{added:0,updated:0,skipped:0},
        fieldLabels:{ firstName:'First Name', lastName:'Last Name', payrollName:'Payroll/Employee Name', role:'Role / Job Title', employmentType:'Employment Type / Class', employeeId:'Employee ID / Position ID', status:'Position Status', seniorityHours:'Seniority Hours' },
        columnMap:{ firstName:'', lastName:'', payrollName:'', role:'', employmentType:'', employeeId:'', status:'', seniorityHours:'' },
        completionMap:{},
        // Admin panel state
        showAddEmployeeModal:false, showAddRequirementModal:false, showBulkActionsModal:false,
        showEditEmployeeModal:false, showEditRequirementModal:false,
          searchQuery:'', roleFilter:'', statusFilter:'', reqStatusFilter:'', filteredEmployees:[], isFiltering:false, sortField:'firstName', sortDirection:'asc',
          globalSearch:'', searchResults:[],
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

        formatYears(days){ return Math.floor(days/365)+'y'; },

        normalizeRequirementColor(color){
          return typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color) ? color : '';
        },

        requirementHeaderStyle(color){
          const validColor = this.normalizeRequirementColor(color);
          return `background:${validColor ? `${validColor}1A` : '#f8fafc'}; border-left:3px solid ${validColor || '#94a3b8'}`;
        },

        async init(){
          if (typeof window.Dexie === 'undefined') {
            this.loadError = 'The offline database library (Dexie.js) did not load. Data cannot be displayed without it.';
            this.$nextTick(() => this.$root?.removeAttribute('x-cloak'));
            return;
          }

          this.initDB();

          this.$nextTick(() => this.$root?.removeAttribute('x-cloak'));

          const markTourSeenHandler = () => this.markTourSeen();
          window.addEventListener('tour:started', markTourSeenHandler);
          window.addEventListener('tour:ended', markTourSeenHandler);

          await this.initActivityLog();
          await this.loadData();
          if (this.loadError || !this.db) return;
          const s = await this.db.settings.get('app');
          if (s?.darkMode) this.darkMode = true;
          document.documentElement.classList.toggle('dark', this.darkMode);

          // Ensure our custom chart plugin exists before charts initialize
          this.chartBgPlugin.fullSize = true;
          if (typeof Chart !== 'undefined') {
            Chart.register(this.chartBgPlugin);
          }

          // Initialize feather icons after DOM is ready
          this.$nextTick(() => {
            // Add a small delay to ensure all elements are rendered
            setTimeout(() => {
              this.initializeFeatherIcons();
            }, 100);
          });
          
          if ('serviceWorker' in navigator) try{ await navigator.serviceWorker.register('/sw.js?v=1'); }catch(e){}

          const tourSetting = await this.db.settings.get('hasSeenTour');
          this.tourMarkedSeen = !!tourSetting?.value;
          if (!this.tourMarkedSeen) {
            this.promptTour();
          }
        },

        initDB(){
          if (this.loadError || typeof window === 'undefined' || typeof window.Dexie === 'undefined') {
            return;
          }
          this.db = createDatabase();
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
          this.showActivityLogModal = true;
          this.$nextTick(() => {
            this.$refs.activityTimeline?.load();
          });
        },

        async clearAllData(){
          if (this.loadError || !this.db) return;
          if(!confirm('This will delete all data. Are you sure?')){
            this.notify('Data deletion cancelled','var(--warn)');
            return;
          }
          await this.db.delete();
          this.initDB();
          await this.initActivityLog();
          await this.loadData();
          this.notify('All data cleared');
        },

        async loadData(){
          if (this.loadError || !this.db) return;
          this.employees = await this.db.employees.toArray();
          this.requirements = await this.db.requirements.toArray();
          this.employeeRequirements = await this.db.employeeRequirements.toArray();
          this.erMap = new Map();
          for (const er of this.employeeRequirements){
            if(!this.erMap.has(er.employeeId)) this.erMap.set(er.employeeId,new Map());
            this.erMap.get(er.employeeId).set(er.requirementId, er);
          }
          await this.loadVisibleRequirements();
          await this.loadTemplates();
          await this.collectComplianceSnapshot();
          this.renderComplianceChart();
          if (!this.loadError) {
            this.filterEmployees();
          }
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
        async recordActivity(actionType, targets = [], metadata = {}, undoPayload = null){
          if(!this.activityLog) return;
          try{
            await this.activityLog.record({
              actionType,
              actor:'user',
              targets,
              metadata,
              undoPayload
            });
            this.$refs.activityTimeline?.load();
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
            if (typeof feather === 'undefined') {
              console.warn('Feather icons library not loaded');
              return;
            }

            feather.replace();
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
          this.importError=''; this.importWarning=''; this.importData=[]; this.importHeaders=[]; this.importSheets=[]; this.importSheetName=''; this.previewEligible=0; this.dryRunDetails=[]; this.importLoading=true; this.importProgress=0; this.importErrors=[];
          this.columnMap = { firstName:'', lastName:'', payrollName:'', role:'', employmentType:'', employeeId:'', status:'', seniorityHours:'' };
          this.completionMap = {};
          const file = event.target.files[0];
          if(!file) { this.importLoading=false; return; }
          
          // File validation
          const maxSize = 10 * 1024 * 1024; // 10MB
          if (file.size > maxSize) {
            this.importError = 'File size exceeds 10MB limit. Please choose a smaller file.';
            this.importLoading = false;
            return;
          }
          
          const allowedTypes = ['.csv', '.xlsx', '.xls'];
          const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
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
          
          // Check if XLSX library is available for Excel files
          if (this.importType === 'excel' && typeof XLSX === 'undefined') {
            this.importError = 'Excel processing library is not loaded. Please refresh the page and try again.';
            this.importLoading = false;
            return;
          }
          
          if (this.importType === 'csv') {
            const text = await file.text();
            const lines = text.split(/\r?\n/);
            const body = this.stripTitleLines(lines);
            const res = Papa.parse(body, { header:true, skipEmptyLines:true });
            this.importData = res.data; this.importHeaders = res.meta.fields || [];
            const trimmed = (res.meta.fields || []).map(h => h.trim());
            this.importData = res.data.map(row => {
              const obj = {};
              trimmed.forEach((h, i) => obj[h] = row[res.meta.fields[i]]);
              return obj;
            });
            this.importHeaders = trimmed;
            this.autoMapColumns(this.importHeaders);
            this.updateEligibilityPreview();
            await this.validateImportData();
            if (!this.importHeaders.length) this.importError = 'No headers detected — check the CSV file.';
            this.importLoading = false;
          } else {
            const reader = new FileReader();
            reader.onload = async (e) => {
              try{
                const data = new Uint8Array(e.target.result);
                const wb = XLSX.read(data, { type:'array', cellDates: true, cellNF: false, cellText: false });
                
                if (!wb.SheetNames || wb.SheetNames.length === 0) {
                  this.importError = 'No worksheets found in the Excel file.';
                  return;
                }
                
                this.importSheets = wb.SheetNames;
                let best = { name: wb.SheetNames[0], score: -1, headers: [], rows: [] };
                
                for (const name of wb.SheetNames){
                  try {
                    const { headers, rows, score } = this.extractFromSheet(wb.Sheets[name]);
                    if (score > best.score) best = { name, score, headers, rows };
                  } catch (sheetErr) {
                    console.warn(`Error processing sheet "${name}":`, sheetErr);
                    continue;
                  }
                }
                
                this.importSheetName = best.name;
                this.importHeaders = best.headers;
                this.importData = best.rows;
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
          this.columnMap = { firstName:'', lastName:'', payrollName:'', role:'', employmentType:'', employeeId:'', status:'', seniorityHours:'' };
          this.completionMap = {};
          const reader = new FileReader();
          reader.onload = async (e) => {
            try {
              const data = new Uint8Array(e.target.result);
              const wb = XLSX.read(data, { type:'array', cellDates: true, cellNF: false, cellText: false });
              
              if (!wb.Sheets[name]) {
                this.importError = `Worksheet "${name}" not found in the file.`;
                return;
              }
              
            const { headers, rows } = this.extractFromSheet(wb.Sheets[name]);
            this.importHeaders = headers;
            this.importData = rows;
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
        extractFromSheet(sheet){
          try {
            const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
            
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
        scoreHeaderRow(cols){
          const patterns=[/first/i,/last/i,/employee\\s*name/i,/payroll\\s*name/i,/job\\s*title|role/i,/employment\\s*type|class/i,/position\\s*id|employee\\s*id/i,/status/i,/seniority|total.*hours/i];
          let score=0; for(const c of cols){ const s=String(c||''); for(const p of patterns) if(p.test(s)) score++; } return score;
        },
        autoMapColumns(headers){
          const normalized = (headers||[]).map(h=>({orig:h, norm:String(h).toLowerCase().trim()}));
          for(const [key,label] of Object.entries(this.fieldLabels)){
            if(this.columnMap[key]) continue;
            const match = normalized.find(h=>h.norm === label.toLowerCase());
            if(match) this.columnMap[key]=match.orig;
          }
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
          // Simulate import and list first skipped reasons
          const existing = await this.db.employees.toArray();
          const byEmpId = new Map(existing.filter(e=>e.employeeId).map(e=>[String(e.employeeId), e]));
          const keyOf = (e) => e.employeeId || `${e.firstName}|${e.lastName}|${e.role}`;
          let added=0, updated=0, skipped=0; const details=[];
          for (const row of this.importData){
            const a = this.analyzeRow(row);
            if (!a.first || !a.last){ skipped++; if(details.length<15) details.push('Skipped row: missing name'); continue; }
            const emp = { id:'-', firstName:a.first, lastName:a.last, role:a.role||'Other', employmentType:a.type||'FT', employeeId:a.empId||'', status:/inactive|leave/i.test(a.status||'')?'Inactive':'Active' };
            const match = emp.employeeId ? byEmpId.get(String(emp.employeeId)) : existing.find(e=>keyOf(e)===keyOf(emp));
            if (match) updated++; else added++;
          }
          this.dryRunSummary = { added, updated, skipped };
          this.dryRunDetails = details;
        },

        async processImport(){
          this.importError='';
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
                skipped: skipped.length
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
          const data={ employees:await this.db.employees.toArray(), requirements:await this.db.requirements.toArray(), employeeRequirements:await this.db.employeeRequirements.toArray(), settings:await this.db.settings.toArray() };
          const date=`compliance-matrix-${new Date().toISOString().split('T')[0]}`;
          let blob, filename, message;
          if(format==='csv'){
            const csv=Papa.unparse(data.employees);
            blob=new Blob([csv],{type:'text/csv'});
            filename=`${date}.csv`;
            message='Exported CSV';
          } else if(format==='xlsx'){
            const wb=XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data.employees),'Employees');
            XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data.requirements),'Requirements');
            XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data.employeeRequirements),'EmployeeRequirements');
            XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data.settings),'Settings');
            const wbout=XLSX.write(wb,{bookType:'xlsx',type:'array'});
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
              total:this.employeeRequirements.filter(er => er.status !== 'NotRequired').length
            };
            for(const er of this.employeeRequirements){
              if(er.status === 'NotRequired') continue;
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
          const fuse = new Fuse(data, { keys:['text'], includeMatches:true, threshold:0.3 });
          this.searchResults = query ? fuse.search(query).slice(0, 12) : [];
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
      }));
    });
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
      if (window.feather && typeof feather.replace === 'function') {
        feather.replace();
      }
    };

    document.addEventListener('DOMContentLoaded', replaceFeatherIcons);
    document.addEventListener('alpine:init', replaceFeatherIcons);
  window.addEventListener('DOMContentLoaded', ()=> {
    if (window.__initImportUI) window.__initImportUI();
  });
