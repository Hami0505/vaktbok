// Tester av grensesnittet i ekte nettleser: npm run e2e
// Første gang: npm install && npx playwright install chromium
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 20000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'nb-NO',
    timezoneId: 'Europe/Oslo',
    screenshot: 'only-on-failure',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  projects: [
    { name: 'mobil', use: { ...devices['Pixel 7'], browserName: 'chromium', viewport: { width: 390, height: 844 } } },
    { name: 'liten-mobil', use: { browserName: 'chromium', viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true } },
    { name: 'pc', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 }, colorScheme: 'dark' } },
  ],
  webServer: {
    command: 'npx --yes serve@14.2.4 -l 5173 .',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
});
