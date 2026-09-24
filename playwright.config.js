import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:8796',
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
          args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
    {
      // Real WebKit engine (Safari's actual rendering/JS engine), not a Chromium
      // stand-in. STUDIO_README previously documented this coverage as missing.
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: { command: 'npm run preview -- --ip 127.0.0.1', url: 'http://127.0.0.1:8796', reuseExistingServer: !process.env.CI, timeout: 30000 },
});
