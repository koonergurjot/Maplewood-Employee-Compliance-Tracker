<h1 align="center">
  <span style="display:inline-block;padding:0.35em 1.2em;border-radius:1.5em;background:linear-gradient(135deg,#7f5cff,#21d4fd);color:#fff;font-weight:700;font-size:1.3em;letter-spacing:0.05em;">Maplewood Employee Compliance Tracker</span>
</h1>

<p align="center">
  <a href="https://www.netlify.com/">
    <img src="https://img.shields.io/badge/Netlify-Deployed-brightgreen?logo=netlify" alt="Netlify Status" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License" />
  </a>
</p>

<p align="center" style="font-size:1.1em;">
  <em>Effortlessly track employee compliance with quick imports, colourful dashboards, and celebratory summaries.</em>
</p>

---

## 🌈 Quick Glimpse

<table>
  <tr>
    <td><strong>🎯 Purpose</strong></td>
    <td>Audit and celebrate employee compliance with a joyful, streamlined dashboard.</td>
  </tr>
  <tr>
    <td><strong>🧰 Tech Stack</strong></td>
    <td>HTML · CSS · JavaScript (Vite) · IndexedDB</td>
  </tr>
  <tr>
    <td><strong>🚀 Hosting</strong></td>
    <td>Optimised for static hosts like Netlify (bundled build required).</td>
  </tr>
</table>

## 🎉 Feature Parade

- ✨ <strong>Preset mappings</strong> for Maplewood Seniority and Education Tracker sheets.
- 📝 <strong>Name format options</strong>: automatic, <code>Last, First</code>, or <code>First Last</code>.
- 🧪 <strong>Dry run mode</strong> to preview add/update counts and skipped rows.
- 📊 <strong>Post-import celebration</strong> with toast notifications and total employee counts.
- ♻️ <strong>Cache-clearing portal</strong> via <a href="clear-cache.html"><code>clear-cache.html</code></a> for fresh testing runs.
- 💾 <strong>Complete backups</strong> covering employees, templates, snapshots, and the activity log.
- 🛟 <strong>Guided restore flow</strong> that replaces every table in a single IndexedDB transaction.

## 🧭 Table of Joy

- [🚀 Quick Start](#-quick-start)
- [💡 Dashboard Magic](#-dashboard-magic)
- [🗃️ Backup &amp; Restore](#%EF%B8%8F-backup--restore)
- [📚 Documentation](#-documentation)
- [🔮 Roadmap](#-roadmap)
- [🤝 Contributing](#-contributing)
- [📜 License](#-license)
- [🛡️ Security](#%EF%B8%8F-security)

## 🚀 Quick Start

1. **Clone the party pack**

   ```bash
   git clone https://github.com/USER/Maplewood-Employee-Compliance-Tracker.git
   cd Maplewood-Employee-Compliance-Tracker
   ```

2. **Install confetti launchers**

   ```bash
   npm install
   npm run dev
   ```

   Launch the URL displayed in your terminal and start exploring the dashboard.

3. **Build for the spotlight**

   ```bash
   npm run build
   ```

   Serve the generated <code>dist/</code> directory from your favourite static host. Serving the repository root directly (for example, via <code>npx serve .</code>) will break Dexie, XLSX, and Alpine imports because the bare module specifiers are only resolved by Vite's dev server or the bundled build. Always upload the full contents of the <code>dist/</code> folder (including <code>index.html</code>) rather than copying an individual hashed JavaScript file. See <a href="docs/DEPLOYMENT.md">docs/DEPLOYMENT.md</a> for more deployment details.

## 💡 Dashboard Magic

- <strong>Filter at light speed:</strong> Role, status, compliance buckets, the "Expiring soon" toggle, and the search field all dance together. Adjust any combination to update the grid instantly—use the Reset button to clear the stage.
- <strong>Inline glow-ups:</strong> Click any requirement cell to open the inline editor. Choose a new status, optionally enter completed/expiry dates, and press <strong>Save changes</strong> (or hit <strong>Esc</strong> to cancel). Updates persist to IndexedDB and the compliance ring refreshes automatically.
- <strong>Track streaks:</strong> Toasts recap how many records were created, updated, or skipped so you always know who to high-five.

## 🗃️ Backup & Restore

1. Open <strong>Export → JSON</strong> to download a complete backup. The file includes employees, requirements, completions, settings, templates, compliance snapshots, and the activity log.
2. Choose <strong>Import → Backup</strong>, upload the JSON file, review the summary counts, and click <strong>Restore Backup</strong> to bring everything back in a single IndexedDB transaction.
3. Backup restores cannot be undone from the activity timeline, so keep a copy of the exported file if you plan to compare states or run audits later.

## 📚 Documentation

- <a href="docs/CONFIGURATION.md">Configuration</a>
- <a href="docs/DEPLOYMENT.md">Deployment</a>
- <a href="convert-icons.html">PWA Icon Conversion Helper</a>
- <a href="docs/SCREENSHOTS.md">Screenshots</a>
- <a href="docs/SECURITY.md">Security Notes</a>

## 🔮 Roadmap

- [ ] Offline support improvements
- [ ] Additional data import formats
- [ ] Built-in analytics dashboard

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Please open an issue or submit a pull request.
See <a href="CONTRIBUTING.md">CONTRIBUTING.md</a> for the full guidelines.

## 📜 License

This project is licensed under the <a href="LICENSE">MIT License</a>.

## 🛡️ Security

For vulnerability disclosure, please review <a href="SECURITY.md">SECURITY.md</a>.

---

<p align="center" style="font-size:0.95em;">
  Made with <span style="color:#ff5c8d;">♥</span> for teams who love vibrant compliance tracking.
</p>
