# Configuration

Before adjusting any configuration, make sure the production bundle is created with the required Vite build (`npm run build`). To deploy that output or learn more about hosting options, see the [deployment guide](./DEPLOYMENT.md). Once the build is in place, you can customize runtime behavior through the options in `onboarding.js` and `commands.js`.

## Prerequisites

- Node.js for running local tooling such as tests or linters
- A modern browser for running the app

## Environment Variables

The app is fully client-side and uses no environment variables. If deploying to Netlify, you may configure a publish directory and caching options in `netlify.toml`.

## Customizing Columns

Mappings for spreadsheet columns are defined in `autoMapColumns.test.js`. Update the arrays to support additional formats.

## Requirement Templates

The dashboard stores template definitions in the IndexedDB table `roleRequirementProfiles`. Templates let you mark certain requirements as "Not Required" for specific roles. Any requirement excluded by a template:

- Is written to `employeeRequirements` with the status `NotRequired` and blank expiration dates.
- Is ignored by the overdue/incomplete charts and KPI totals.
- Can still be surfaced by selecting the **Not Required** filter in the dashboard.

### Creating and managing templates

1. Open **Settings → Column Settings** and use the **Role Templates** panel.
2. Click **New Template** to provide a name, assign one or more roles (comma separated), and toggle which requirements remain required.
3. Save the template to persist it to IndexedDB. Templates are matched to roles case-insensitively.
4. Use **Apply to Roles** to update every employee whose role matches, or **Apply to Selection** to target the currently selected employees. Both actions reset excluded items to `NotRequired` and restore required items to `NotCompleted` unless already completed.

### Migrating historical employees

Existing workbooks will contain legacy `NotCompleted` rows for requirements that should now be optional. After defining templates:

1. (Optional) Export your data for backup via **Export → JSON**.
2. Select the affected employees in the grid (or rely on the automatic role match) and open **Settings → Column Settings → Role Templates**.
3. Choose the relevant template and apply it. All matching employee/requirement pairs are normalised—excluded items become `NotRequired`, while previously excluded items that are now required revert to `NotCompleted` so progress can be tracked.
4. Repeat for each role-specific template until the dashboard KPIs reflect the desired scope.

## Backups

Use the built-in backup mode when you need to migrate data between browsers or seed a new device:

1. Export a JSON backup via **Export → JSON**. The file captures every IndexedDB table, including templates, compliance snapshots, and the activity log.
2. On the destination device, open **Import → Backup** and upload the JSON file. The app validates the structure, displays table counts, and highlights any issues before restoring.
3. Click **Restore Backup** to replace the existing database in a single transaction. Because the operation rewrites every table, it cannot be undone from the activity log.
