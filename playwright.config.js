/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  testDir: 'tests',
  testMatch: '**/*.spec.{ts,js}',
  timeout: 60000,
  use: {
    browserName: 'webkit',
    headless: true,
    baseURL: 'http://127.0.0.1:4173'
  },
  projects: [
    {
      name: 'webkit',
      use: {
        browserName: 'webkit',
        headless: true,
        baseURL: 'http://127.0.0.1:4173'
      }
    }
  ],
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173',
    port: 4173,
    reuseExistingServer: true,
    stdout: 'pipe',
    stderr: 'pipe'
  }
};

module.exports = config;
