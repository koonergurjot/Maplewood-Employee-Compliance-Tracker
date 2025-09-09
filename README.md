# Compliance Matrix – v4.1

**Why your import showed “0 processed”**
- The app now **validates mappings** and shows how many rows are eligible **before** import.
- Added a **Name Format** selector (Auto / “Last, First” / “First Last”). If your Excel uses “Payroll Name”, pick the right format.
- Clear warnings: missing name columns, unmapped fields, or no requirement columns for completions.

**Deploy**
- Netlify: build command empty, publish `/`. Hard refresh after updates.
