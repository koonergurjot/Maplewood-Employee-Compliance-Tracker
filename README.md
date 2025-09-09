# Compliance Matrix – v4

**Fixes & Upgrades**
- **Excel import fixed**: detects the correct header row even when sheets have title rows/notes.
- **Sheet picker**: choose which worksheet to import; auto-selects the one with the best header match.
- CSV import still detects the true header row when a title is present.
- Same v3 features: mapping UI, completions import, column colors, advanced filters, dark mode, date modal, exports, offline.

**Deploy on Netlify**
- Build command: *(empty)*, Publish directory: `/`.
- If upgrading: hard refresh to update the service worker.
