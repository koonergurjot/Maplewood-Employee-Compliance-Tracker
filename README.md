# Maplewood Employee Compliance Tracker

[![Netlify Status](https://img.shields.io/badge/Netlify-Deployed-brightgreen?logo=netlify)](https://www.netlify.com/) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> Effortlessly track employee compliance with quick imports and clear summaries.

## Overview

A lightweight web application that helps teams audit employee compliance records. The project uses plain HTML, CSS, and JavaScript and can be served from any static host.

Read the full project overview in [docs/OVERVIEW.md](docs/OVERVIEW.md).

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Documentation](#documentation)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)
- [Security](#security)

## Features

- ✨ **Preset mappings** for Maplewood Seniority and Education Tracker sheets
- 📝 **Name format options**: automatic, `Last, First`, or `First Last`
- 🧪 **Dry run mode** to preview add/update counts and skipped rows
- 📊 **Post-import summary** with toast notifications and total employee counts
- ♻️ **Cache clearing** via [`clear-cache.html`](clear-cache.html) for fresh testing
- 💾 **Full backups** that capture employees, templates, snapshots, and the activity log

## Quick Start

1. Clone the repository

   ```bash
   git clone https://github.com/USER/Maplewood-Employee-Compliance-Tracker.git
   cd Maplewood-Employee-Compliance-Tracker
   ```

2. Install dependencies and start the development server:

   ```bash
   npm install
   npm run dev
   ```

   Then open the local URL shown in the terminal to use the app.

3. For production, run a build and serve the generated `dist` directory from your preferred static host:

   ```bash
   npm run build
   ```

   Serving the repository root directly (for example, via `npx serve .`) will break Dexie, XLSX, and Alpine imports because the bare module specifiers are only resolved by Vite's dev server or the bundled build. Always upload the full contents of the `dist/` folder (including `index.html`) rather than copying an individual hashed JavaScript file. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for more deployment details.

## Dashboard Tips

- **Filter quickly:** Role, status, compliance buckets, the “Expiring soon” toggle, and the search field all work together. Adjust any combination to update the grid instantly—use the Reset button to clear everything.
- **Inline updates:** Click any requirement cell to open the inline editor. Choose a new status, optionally enter completed/expiry dates, and press **Save changes** (or hit **Esc** to cancel). Updates persist to IndexedDB and the compliance ring refreshes automatically.

## Backup & Restore

The dashboard now supports a dedicated backup workflow:

1. Open **Export → JSON** to download a complete backup. The file includes employees, requirements, completions, settings, templates, compliance snapshots, and the activity log.
2. To restore, choose **Import → Backup**, upload the JSON file, review the summary counts, and click **Restore Backup**. The restore runs inside a single IndexedDB transaction to replace every table.
3. Backup restores cannot be undone from the activity timeline, so keep a copy of the exported file if you plan to compare states.

## Documentation

- [Configuration](docs/CONFIGURATION.md)
- [Deployment](docs/DEPLOYMENT.md)
- [PWA Icon Conversion Helper](convert-icons.html)
- [Screenshots](docs/SCREENSHOTS.md)
- [Security Notes](docs/SECURITY.md)

## Roadmap

- [ ] Offline support improvements
- [ ] Additional data import formats
- [ ] Built-in analytics dashboard

## Contributing

Contributions, issues, and feature requests are welcome!
Please open an issue or submit a pull request.
See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the [MIT License](LICENSE).

## Security

For vulnerability disclosure, please review [SECURITY.md](SECURITY.md).
