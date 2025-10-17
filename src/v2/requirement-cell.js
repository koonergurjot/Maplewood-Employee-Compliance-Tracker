import Alpine from 'alpinejs';
import { getEmployeeRequirement as fetchEmployeeRequirement } from '../../db.js';

function badgeClassesForLabel(label) {
  switch (label) {
    case 'Complete':
      return 'bg-green-100 text-green-700';
    case 'Expired':
      return 'bg-amber-100 text-amber-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

export function requirementCell(employeeId, requirementId) {
  return {
    employeeId,
    requirementId,
    link: null,
    checked: false,
    label: 'Pending',
    badgeClass: badgeClassesForLabel('Pending'),
    async init() {
      await this.reload();
    },
    async reload() {
      this.link = await Alpine.store('employees').requirementLink(this.employeeId, this.requirementId);
      this.sync();
    },
    sync() {
      const label = Alpine.store('employees').statusLabel(this.link);
      this.label = label;
      this.checked = Boolean(this.link && this.link.completedOn);
      this.badgeClass = badgeClassesForLabel(label);
    },
    async onToggle(checked) {
      const result = await Alpine.store('employees').toggle(this.employeeId, this.requirementId, checked);
      this.link = result || (await fetchEmployeeRequirement(this.employeeId, this.requirementId));
      this.sync();
    }
  };
}

export default requirementCell;
