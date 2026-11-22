import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: { __PLUGIN_VERSION__: JSON.stringify('0.0.0-test') },
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
