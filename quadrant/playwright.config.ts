import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4174/',
    trace: 'off',
  },
  webServer: {
    command: 'npx vite build && npx vite preview --port 4174 --strictPort',
    url: 'http://localhost:4174/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1400, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
