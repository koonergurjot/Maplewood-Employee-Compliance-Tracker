const assert = require('assert');

function autoMapColumns(headers, columnMap = {}, fieldLabels = {}) {
  const normalized = headers.map(h => ({ orig: h, norm: String(h).toLowerCase().trim() }));
  for (const [key, label] of Object.entries(fieldLabels)) {
    if (columnMap[key]) continue;
    const match = normalized.find(h => h.norm === label.toLowerCase());
    if (match) columnMap[key] = match.orig;
  }
  return columnMap;
}

const fieldLabels = {
  firstName: 'First Name',
  lastName: 'Last Name',
  payrollName: 'Payroll/Employee Name'
};

const headers = ['First Name', 'Last Name', 'Payroll/Employee Name'];
const map = autoMapColumns(headers, {}, fieldLabels);

assert.strictEqual(map.firstName, 'First Name');
assert.strictEqual(map.lastName, 'Last Name');
assert.strictEqual(map.payrollName, 'Payroll/Employee Name');

console.log('autoMapColumns tests passed');

