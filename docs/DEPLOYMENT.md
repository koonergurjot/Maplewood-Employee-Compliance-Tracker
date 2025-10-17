# Deployment

The application is a static site and can be hosted on any web server.

## Netlify

1. Fork the repository.
2. Connect the fork to Netlify.
3. Configure the build command to `npm run build` and the publish directory to `dist`.

## Other Hosts

1. Install dependencies with `npm install`.
2. Generate a production build with `npm run build`.
3. Deploy the contents of the `dist` directory to your static host or CDN.

   > **Important:** Deploy the entire directory (including `index.html`). The build step rewrites `<script type="module" src="/src/main.js"></script>` to the hashed bundle filename; copying only the generated JavaScript file will leave `index.html` pointing at the wrong entry and break the app.

For local development, run:

```bash
npm install
npm run dev
```

and open the provided URL from the Vite dev server.

> **Note:** The source code uses bare module imports. Serve it through the Vite dev server (`npm run dev`) or deploy the compiled `dist` artifacts; otherwise dependencies such as Dexie, XLSX, and Alpine.js will fail to load when served directly from the repository root.
