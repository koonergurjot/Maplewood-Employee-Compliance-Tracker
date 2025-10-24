import test from 'node:test';
import assert from 'node:assert/strict';

import { formatRequirementStatus } from '../src/v2/exporter.js';

const REFERENCE_DATE = new Date('2024-01-15T00:00:00Z');

const withNow = value => ({ now: REFERENCE_DATE, ...value });

test('marks template-excluded requirements as Not Required', () => {
  const status = formatRequirementStatus(
    { status: 'NotRequired' },
    withNow()
  );

  assert.equal(status, 'Not Required');
});

test('preserves exempt statuses when exporting', () => {
  const status = formatRequirementStatus(
    { status: 'Exempt' },
    withNow()
  );

  assert.equal(status, 'Exempt');
});

test('treats completed requirements as complete when not expired', () => {
  const status = formatRequirementStatus(
    {
      status: 'Completed',
      completedOn: '2024-01-10',
      expiresOn: '2024-02-01'
    },
    withNow()
  );

  assert.equal(status, 'Complete');
});

test('reports expired completions correctly', () => {
  const status = formatRequirementStatus(
    {
      status: 'Completed',
      completedOn: '2023-12-01',
      expiresOn: '2024-01-01'
    },
    withNow()
  );

  assert.equal(status, 'Expired');
});

