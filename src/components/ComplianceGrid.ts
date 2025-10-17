import { REQUIREMENTS } from "@/config/requirements";
import { employeesSeed, newMatrix, type CellStatus } from "@/state/complianceStore";

// expose for Alpine
// @ts-ignore
window.complianceGrid = function () {
  return {
    requirements: REQUIREMENTS,
    employees: employeesSeed,
    state: newMatrix(employeesSeed, REQUIREMENTS.map(r => r.key)),

    toggle(empId: string, reqKey: string) {
      const row = this.state[empId] || (this.state[empId] = {});
      const cur = row[reqKey] ?? 'pending';
      row[reqKey] = cur === 'pending' ? 'ok' : cur === 'ok' ? 'expired' : 'pending';
      // TODO: persist to storage/API
    },
    statusClass(s: CellStatus) {
      return s === 'ok'
        ? 'bg-green-100 text-green-800 border border-green-200'
        : s === 'expired'
        ? 'bg-amber-100 text-amber-800 border border-amber-200'
        : 'bg-slate-100 text-slate-700 border border-slate-200';
    },
    labelFor(s: CellStatus) { return s === 'ok' ? 'OK' : s === 'expired' ? 'Expired' : 'Pending'; },

    fitToWidth() { document.documentElement.style.setProperty('--cellMin','96px'); },
    resetZoom()   { document.documentElement.style.setProperty('--cellMin','120px'); },
  };
};
