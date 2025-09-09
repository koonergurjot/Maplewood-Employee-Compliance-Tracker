# Compliance Matrix (Static)

A single-file, offline-first employee compliance tracker (rows = employees, columns = requirements). Click cells to toggle completion. Shift+Click to set a specific date. Alt+Click to clear.

## Deploy on Netlify
1) Create a new repo and add these files.
2) Connect the repo to Netlify. Build command can be empty. Publish directory: `/`.
3) Deploy.

## Local
Open `index.html` via a simple static server (service worker requires http). On macOS/Linux: `python3 -m http.server`.

## Files
- index.html – app (Alpine.js + Dexie + Tailwind CDN)
- manifest.webmanifest – PWA manifest
- sw.js – service worker (offline shell cache)
- netlify.toml – SPA redirect
- icons/ – PWA icons
