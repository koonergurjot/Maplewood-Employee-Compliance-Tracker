const assert = require('assert');

function autofillMappings(importHeaders, columnMap={}){
  const H = (importHeaders||[]).map(h=>String(h));
  const find = (regexArr) => H.find(h => regexArr.some(r => r.test(h)));
  const setIf = (key, regexArr) => {
    const h = find(regexArr);
    if (h && !columnMap[key]) columnMap[key] = h;
  };
  setIf('firstName', [/^first\b/i, /given\s*name/i]);
  setIf('lastName', [/^last\b/i, /surname/i]);
  setIf('payrollName', [/payroll\s*name/i, /employee\s*name/i, /^name$/i, /full\s*name/i]);
  setIf('role', [/job\s*title/i, /^role$/i]);
  setIf('employmentType', [/employment\s*type/i, /class\s*code/i]);
  setIf('employeeId', [/position\s*id/i, /employee\s*id/i, /file\s*#/i]);
  setIf('status', [/status/i, /active\?/i]);
  setIf('seniorityHours', [/seniority/i, /total.*hours/i]);
  return columnMap;
}

const map = autofillMappings(['Given Name', 'Surname', 'Full Name']);
assert.strictEqual(map.firstName, 'Given Name');
assert.strictEqual(map.lastName, 'Surname');
assert.strictEqual(map.payrollName, 'Full Name');
console.log('autofillMappings tests passed');
