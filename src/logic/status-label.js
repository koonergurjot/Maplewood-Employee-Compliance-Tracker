import { normalizeStatus } from './analytics.js';

function normalizeNow(now) {
  if (now instanceof Date && !Number.isNaN(now.getTime())) {
    return now;
  }
  return new Date();
}

function parseDate(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function statusLabelForLink(link, options = {}) {
  if (!link) {
    return 'Pending';
  }

  const status = normalizeStatus(link.status);
  if (status === 'Exempt') {
    return 'Exempt';
  }

  if (link.completedOn) {
    return 'Complete';
  }

  const now = normalizeNow(options.now);
  if (link.completedOn || status === 'Completed') {
    return 'Complete';
  }
  const expiresOn = parseDate(link.expiresOn);
  if (expiresOn && expiresOn < now) {
    return 'Expired';
  }

  return 'Pending';
}

export default statusLabelForLink;
