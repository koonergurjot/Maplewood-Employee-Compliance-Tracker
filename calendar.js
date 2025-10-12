import { Calendar } from 'fullcalendar';
import { safeFeatherReplace } from './feather-utils.js';
import './fullcalendar.css';

import { createDatabase } from './db.js';
import './styles.css';

document.addEventListener('DOMContentLoaded', async () => {
  let db;

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

  const [employees, requirements, employeeRequirements] = await Promise.all([
    db.employees.toArray(),
    db.requirements.toArray(),
    db.employeeRequirements.toArray()
  ]);

  const empMap = new Map(employees.map(e => [e.id, e]));
  const reqMap = new Map(requirements.map(r => [r.id, r]));

  const normaliseToIsoDate = value => {
    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();
    const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

    if (isoDatePattern.test(trimmed)) {
      return trimmed;
    }

    if (trimmed.includes('T')) {
      const [datePart] = trimmed.split('T');
      if (isoDatePattern.test(datePart)) {
        return datePart;
      }
    }

    const parsed = Date.parse(trimmed);
    if (Number.isNaN(parsed)) {
      return trimmed;
    }

    try {
      const date = new Date(parsed);
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    } catch (error) {
      console.warn('Failed to parse expiration date', value, error);
      return trimmed;
    }
  };

  const events = employeeRequirements
    .filter(er => er.expiresOn)
    .map(er => {
      const emp = empMap.get(er.employeeId);
      const req = reqMap.get(er.requirementId);
      return {
        title: `${emp?.firstName ?? ''} ${emp?.lastName ?? ''} - ${req?.name ?? ''}`.trim(),
        start: normaliseToIsoDate(er.expiresOn),
        allDay: true
      };
    });

  const calendarEl = document.getElementById('calendar');
  const calendar = new Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    height: '100%',
    events
  });
  calendar.render();

  safeFeatherReplace();
});
