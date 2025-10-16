import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateRequirementState, computeAnalyticsSummary } from '../src/logic/analytics.js';

function daysFromToday(days) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

test('pending requirements within at-risk window but outside expiring-soon window are not marked expiring soon', () => {
  const twentyDaysOut = daysFromToday(20);
  const state = evaluateRequirementState({ status: 'Pending', expiresOn: twentyDaysOut });

  assert.equal(state.expiringSoon, false, 'should not be marked expiring soon');
  assert.equal(state.atRisk, true, 'should be considered at risk');
});

test('analytics summary counts at-risk assignments even when not expiring soon', () => {
  const requirement = { id: 'req-1', name: 'Test Requirement' };
  const employee = { id: 'emp-1', role: 'Nurse' };
  const record = {
    employeeId: 'emp-1',
    requirementId: 'req-1',
    status: 'Pending',
    expiresOn: daysFromToday(20)
  };

  const summary = computeAnalyticsSummary({
    employees: [employee],
    requirements: [requirement],
    employeeRequirements: [record],
    options: {
      today: new Date(),
      atRiskWindowDays: 30,
      expiringSoonDays: 7
    }
  });

  assert.equal(summary.atRisk.length, 1, 'requirement should appear in at-risk list');
  assert.equal(summary.atRisk[0].atRiskCount, 1, 'at-risk count should include pending record');
  assert.equal(summary.atRisk[0].expiringSoonCount, 0, 'expiring soon count should remain zero');
});
