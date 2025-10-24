import test from 'node:test';
import assert from 'node:assert/strict';

import { statusLabelForLink } from '../src/logic/status-label.js';

const FIXED_NOW = new Date('2024-02-01T00:00:00Z');

const withNow = (link = {}) => ({ link, options: { now: FIXED_NOW } });

test('returns Exempt for exempt requirement links', () => {
  const { link, options } = withNow({
    status: 'exempt',
    expiresOn: '2023-01-01',
    completedOn: null
  });

  const label = statusLabelForLink(link, options);

  assert.equal(label, 'Exempt');
});

test('falls back to expired when requirement is past due', () => {
  const { link, options } = withNow({
    status: 'Pending',
    expiresOn: '2024-01-01'
  });

  const label = statusLabelForLink(link, options);

  assert.equal(label, 'Expired');
});

test('falls back to complete when requirement has been completed', () => {
  const { link, options } = withNow({
    status: 'Pending',
    completedOn: '2024-01-15'
  });

  const label = statusLabelForLink(link, options);

  assert.equal(label, 'Complete');
});
