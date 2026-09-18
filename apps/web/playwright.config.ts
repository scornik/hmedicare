import { defineConfig, devices } from '@playwright/test';

/**
 * Stage 4 smoke (WEB-IMPLEMENTATION §7 subset): the built app served by `vite preview` (SPA fallback like
 * the Hostinger .htaccess) against a mocked API (`page.route`), so no backend or real data is needed.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  // PW_CHANNEL (e.g. msedge/chrome) lets a local run use an installed browser; CI uses the pinned bundled Chromium.
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
      },
    },
  ],
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { VITE_API_BASE_URL: 'http://localhost:3999', VITE_APP_ENV: 'test' },
  },
});
