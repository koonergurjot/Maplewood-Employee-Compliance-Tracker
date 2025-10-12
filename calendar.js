import { Calendar } from 'fullcalendar';
import { safeFeatherReplace } from './feather-utils.js';
import './fullcalendar.css';

import ActivityLog from './activity-log.js';
import { createDatabase } from './db.js';
import './styles.css';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EXCEL_SERIAL_EPOCH = Date.UTC(1899, 11, 30);

const numberPattern = /^\d+(?:\.\d+)?$/;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const slashDatePattern = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function formatDateInTimeZone(date, tz) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  const parts = formatter.formatToParts(date);
  const partMap = Object.fromEntries(parts.map(part => [part.type, part.value]));

  if (!partMap.year || !partMap.month || !partMap.day) {
    return null;
  }

  return `${partMap.year}-${partMap.month}-${partMap.day}`;
}

function isValidDateParts(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function createDateFromParts(year, month, day, tz) {
  if (!isValidDateParts(year, month, day)) {
    return null;
  }

  return formatDateInTimeZone(new Date(Date.UTC(year, month - 1, day)), tz);
}

function parseExcelSerial(value, tz) {
  const serial = Math.trunc(value);

  if (!Number.isFinite(serial) || serial <= 0 || serial > 60000) {
    return null;
  }

  const adjustedSerial = serial >= 60 ? serial - 1 : serial;
  const utcTime = EXCEL_SERIAL_EPOCH + adjustedSerial * MS_PER_DAY;
  return formatDateInTimeZone(new Date(utcTime), tz);
}

export function parseDateLoose(value, tz = 'America/Vancouver') {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return formatDateInTimeZone(value, tz);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const excelDate = parseExcelSerial(value, tz);
    if (excelDate) {
      return excelDate;
    }
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (!trimmed) {
      return null;
    }

    if (isoDatePattern.test(trimmed)) {
      const [yearStr, monthStr, dayStr] = trimmed.split('-');
      const year = Number.parseInt(yearStr, 10);
      const month = Number.parseInt(monthStr, 10);
      const day = Number.parseInt(dayStr, 10);
      return createDateFromParts(year, month, day, tz);
    }

    if (slashDatePattern.test(trimmed)) {
      const [, firstStr, secondStr, yearStr] = trimmed.match(slashDatePattern);
      const first = Number.parseInt(firstStr, 10);
      const second = Number.parseInt(secondStr, 10);
      const year = Number.parseInt(yearStr, 10);

      const asMonthDay = createDateFromParts(year, first, second, tz);
      const asDayMonth = createDateFromParts(year, second, first, tz);

      if (asMonthDay && !asDayMonth) {
        return asMonthDay;
      }

      if (asDayMonth && !asMonthDay) {
        return asDayMonth;
      }

      if (asMonthDay && asDayMonth) {
        const error = new Error('Ambiguous date value');
        error.code = 'AMBIGUOUS_DATE';
        error.value = trimmed;
        throw error;
      }

      return null;
    }

    if (trimmed.includes('T')) {
      const parsed = Number.isNaN(Date.parse(trimmed)) ? null : new Date(trimmed);
      if (parsed) {
        return formatDateInTimeZone(parsed, tz);
      }
    }

    if (numberPattern.test(trimmed)) {
      const numericValue = Number.parseFloat(trimmed);
      const excelDate = parseExcelSerial(numericValue, tz);
      if (excelDate) {
        return excelDate;
      }
    }

    const parsed = Number.isNaN(Date.parse(trimmed)) ? null : new Date(trimmed);
    if (parsed) {
      return formatDateInTimeZone(parsed, tz);
    }
  }

  const error = new Error('Unrecognized date value');
  error.code = 'INVALID_DATE';
  error.value = value;
  throw error;
}

document.addEventListener('DOMContentLoaded', async () => {
  let db;
  let activityLog = null;

  try {
    db = await createDatabase();
    await db.open();
  } catch (error) {
    console.error('Failed to open database for calendar', error);
    return;
  }

  try {
    const setting = await db.settings.get('app');
    if (setting?.darkMode) {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {
    console.error('Failed to load settings', e);
  }

  try {
    activityLog = await ActivityLog.init(db);
  } catch (error) {
    console.error('Failed to initialize activity log for calendar', error);
    activityLog = null;
  }

  const [employees, requirements, employeeRequirements] = await Promise.all([
    db.employees.toArray(),
    db.requirements.toArray(),
    db.employeeRequirements.toArray()
  ]);

  const empMap = new Map(employees.map(e => [e.id, e]));
  const reqMap = new Map(requirements.map(r => [r.id, r]));

  const events = [];

  for (const er of employeeRequirements) {
    if (!er.expiresOn) {
      continue;
    }

    let start;

    try {
      start = parseDateLoose(er.expiresOn);
      if (!start) {
        throw Object.assign(new Error('Invalid calendar date'), {
          code: 'INVALID_DATE',
          value: er.expiresOn
        });
      }
    } catch (error) {
      console.warn('Failed to parse expiration date for calendar event', er, error);

      if (activityLog) {
        try {
          await activityLog.record({
            actionType: 'calendar:invalid-date',
            actor: 'system',
            targets: er.id ? [{ type: 'employeeRequirement', id: er.id }] : [],
            metadata: {
              source: 'calendar',
              employeeId: er.employeeId ?? null,
              requirementId: er.requirementId ?? null,
              rawValue: er.expiresOn,
              reason: error?.message ?? 'Unknown parsing error',
              code: error?.code ?? 'UNKNOWN'
            },
            supportsUndo: false
          });
        } catch (logError) {
          console.error('Failed to record invalid date in activity log', logError);
        }
      }

      continue;
    }

    const emp = empMap.get(er.employeeId);
    const req = reqMap.get(er.requirementId);

    events.push({
      title: `${emp?.firstName ?? ''} ${emp?.lastName ?? ''} - ${req?.name ?? ''}`.trim(),
      start,
      allDay: true
    });
  }

  const calendarEl = document.getElementById('calendar');
  const calendar = new Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    height: '100%',
    events
  });
  calendar.render();

  safeFeatherReplace();
});
