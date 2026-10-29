import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    passWithNoTests: false,
    // One process, one file at a time.
    //
    // The default pool runs several files in parallel, and on Windows that
    // intermittently lost whole files: Vitest writes SSR-transformed modules to
    // a temp directory keyed by content hash, two workers race on the same
    // file, one gets `EPERM: operation not permitted, open ...\ssr\<hash>`, and
    // that file's tests are silently never collected. The run still reports
    // success — just with a smaller number, so "334 passed" and "313 passed"
    // were both green. A suite whose size changes between runs cannot be
    // trusted to have run the test you just wrote.
    //
    // Measured before this change: 10 runs gave 334, 334, 334, 334, 325, 334,
    // 334, 326, 313, 331 — files went missing at random, including the one
    // covering a module edited minutes earlier. With `singleFork`, 8
    // consecutive runs all reported the full count. The suite takes about 3
    // seconds either way, so the parallelism was not buying anything.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } }
  }
})