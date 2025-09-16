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

## Quick Start

1. Clone the repository

   ```bash
   git clone https://github.com/USER/Maplewood-Employee-Compliance-Tracker.git
   cd Maplewood-Employee-Compliance-Tracker
   ```

2. Serve the site from the project root so `index.html`, `sw.js`, and `manifest.webmanifest` load correctly. For example:

   ```bash
   npx serve .
   ```

3. Open `http://localhost:3000` (or the port shown) to use the app.

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
