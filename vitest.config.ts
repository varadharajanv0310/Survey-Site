import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    // Longest prefix first: '@app/db/schema' must win over '@app/db'.
    alias: [
      { find: '@app/db/schema', replacement: resolve(root, 'packages/db/src/schema/index.ts') },
      { find: '@app/db', replacement: resolve(root, 'packages/db/src/index.ts') },
      { find: '@app/core', replacement: resolve(root, 'packages/core/src/index.ts') },
    ],
  },
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    // These talk to a real Postgres. An in-memory fake would not reproduce the
    // triggers, CHECK constraints or unique indexes that carry the guarantees.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
})
