type DashboardApp = {
  filteredEmployees?: any[];
  employees?: any[];
  requirements?: any[];
  gridOrderedRequirements?: (requirements?: any[]) => any[];
  getRequirementCell?: (employeeId: string, requirementId: string) => any;
  cellExpired?: (cell: any) => boolean;
  openEditor?: (event: Event, employeeId: string, requirementId: string) => void;
};

type DisplayStatus = 'pending' | 'ok' | 'expired' | 'exempt';

function getDashboardApp(): DashboardApp | null {
  const host = document.getElementById('app-v2') as HTMLElement & { __x?: { $data?: DashboardApp } };
  return host?.__x?.$data ?? null;
}

function employeeInitials(employee: any): string {
  if (!employee) return '';
  const first = String(employee.firstName ?? '').trim();
  const last = String(employee.lastName ?? '').trim();
  const combined = `${first.charAt(0)}${last.charAt(0)}`.trim();
  if (combined) return combined.toUpperCase();
  const fullName = String(employee.fullName ?? employee.name ?? '').trim();
  return fullName ? fullName.slice(0, 2).toUpperCase() : '';
}

function employeeName(employee: any): string {
  if (!employee) return '';
  const first = String(employee.firstName ?? '').trim();
  const last = String(employee.lastName ?? '').trim();
  const combined = `${first} ${last}`.trim();
  return combined || String(employee.fullName ?? employee.name ?? 'Employee').trim();
}

function employeeMeta(employee: any): string {
  if (!employee) return '';
  const role = String(employee.jobTitle ?? employee.role ?? '').trim();
  const status = String(employee.status ?? employee.positionStatus ?? '').trim();
  if (role && status) return `${role} • ${status}`;
  return role || status || '';
}

function normalizeRequirement(requirement: any) {
  if (!requirement) return null;
  const key = requirement.id ?? requirement.key ?? null;
  if (!key) return null;
  const label = String(requirement.shortName ?? requirement.name ?? requirement.label ?? key).trim();
  return {
    id: key,
    label: label || String(key),
    color: requirement.color ?? null,
  };
}

function describeStatus(cell: any, expired: boolean): DisplayStatus {
  if (!cell) return 'pending';
  if (expired) return 'expired';
  const status = String(cell.status ?? '').trim();
  if (status === 'Exempt') return 'exempt';
  if (status === 'Completed') return 'ok';
  return 'pending';
}

function labelForStatus(status: DisplayStatus, cell: any): string {
  if (status === 'ok') return cell?.status === 'Completed' ? 'Completed' : 'OK';
  if (status === 'exempt') return 'Exempt';
  if (status === 'expired') return 'Expired';
  return 'Pending';
}

function statusClass(status: DisplayStatus): string {
  switch (status) {
    case 'ok':
      return 'bg-green-100 text-green-800 border border-green-200';
    case 'expired':
      return 'bg-amber-100 text-amber-800 border border-amber-200';
    case 'exempt':
      return 'bg-sky-100 text-sky-800 border border-sky-200';
    default:
      return 'bg-slate-100 text-slate-700 border border-slate-200';
  }
}

// expose for Alpine
// @ts-ignore
window.complianceGrid = function () {
  return {
    app: null as DashboardApp | null,

    init() {
      this.app = getDashboardApp();
      if (!this.app) {
        queueMicrotask?.(() => {
          this.app = getDashboardApp();
        });
      }
    },

    get requirements() {
      if (!this.app) return [];
      const source = typeof this.app.gridOrderedRequirements === 'function'
        ? this.app.gridOrderedRequirements()
        : Array.isArray(this.app.requirements)
          ? this.app.requirements
          : [];
      return source.map(normalizeRequirement).filter(Boolean);
    },

    get employees() {
      if (!this.app) return [];
      const source = Array.isArray(this.app.filteredEmployees) && this.app.filteredEmployees.length
        ? this.app.filteredEmployees
        : Array.isArray(this.app.employees)
          ? this.app.employees
          : [];
      return source
        .filter(emp => emp && emp.id)
        .map(emp => ({
          id: emp.id,
          initials: employeeInitials(emp),
          name: employeeName(emp),
          meta: employeeMeta(emp),
        }));
    },

    cellStatus(empId: string, reqId: string): DisplayStatus {
      if (!this.app || typeof this.app.getRequirementCell !== 'function') return 'pending';
      const cell = this.app.getRequirementCell(empId, reqId);
      const expired = typeof this.app.cellExpired === 'function' ? this.app.cellExpired(cell) : false;
      return describeStatus(cell, expired);
    },

    cellLabel(empId: string, reqId: string): string {
      if (!this.app || typeof this.app.getRequirementCell !== 'function') return 'Pending';
      const cell = this.app.getRequirementCell(empId, reqId);
      const expired = typeof this.app.cellExpired === 'function' ? this.app.cellExpired(cell) : false;
      const status = describeStatus(cell, expired);
      return labelForStatus(status, cell);
    },

    cellClass(empId: string, reqId: string): string {
      const status = this.cellStatus(empId, reqId);
      return statusClass(status);
    },

    toggle(event: Event, empId: string, reqId: string) {
      if (this.app && typeof this.app.openEditor === 'function') {
        this.app.openEditor(event, empId, reqId);
      }
    },

    fitToWidth() { document.documentElement.style.setProperty('--cellMin','96px'); },
    resetZoom()   { document.documentElement.style.setProperty('--cellMin','120px'); },
  };
};
