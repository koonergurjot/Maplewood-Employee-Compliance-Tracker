document.addEventListener('DOMContentLoaded', async () => {
  const db = new Dexie('ComplianceMatrixDB');
  db.version(8).stores({
    employees:'id, lastName, firstName, role, employmentType, status, employeeId, seniorityHours',
    requirements:'id, name, defaultExpiryDays, color',
    employeeRequirements:'id, [employeeId+requirementId], status, completedOn, expiresOn, notes',
    settings:'id'
  });

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

  const events = employeeRequirements
    .filter(er => er.expiresOn)
    .map(er => {
      const emp = empMap.get(er.employeeId);
      const req = reqMap.get(er.requirementId);
      return {
        title: `${emp?.firstName ?? ''} ${emp?.lastName ?? ''} - ${req?.name ?? ''}`.trim(),
        start: er.expiresOn,
        allDay: true
      };
    });

  const calendarEl = document.getElementById('calendar');
  const calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    height: '100%',
    events
  });
  calendar.render();
});
