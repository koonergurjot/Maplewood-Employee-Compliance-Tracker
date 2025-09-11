# Overview

Maplewood Employee Compliance Tracker centralizes import and review of compliance records. It is designed for quick, manual auditing without a server component.

## Key Components

- **index.html** – main interface for loading spreadsheets and viewing summaries
- **calendar.html** – renders deadlines with `calendar.js`
- **sw.js** – service worker enabling offline caching

## Data Flow

1. Upload a Maplewood spreadsheet.
2. The app maps columns and validates entries.
3. Summaries display counts for updated or skipped employees.

Additional setup and configuration details are documented in [CONFIGURATION.md](CONFIGURATION.md).
