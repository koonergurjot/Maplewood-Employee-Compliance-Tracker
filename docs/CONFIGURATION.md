# Configuration

This project does not require a build step. To customize behavior, adjust the options in `onboarding.js` and `commands.js`.

## Prerequisites

- Node.js for running local tooling such as tests or linters
- A modern browser for running the app

## Environment Variables

The app is fully client-side and uses no environment variables. If deploying to Netlify, you may configure a publish directory and caching options in `netlify.toml`.

## Customizing Columns

Mappings for spreadsheet columns are defined in `autoMapColumns.test.js`. Update the arrays to support additional formats.
