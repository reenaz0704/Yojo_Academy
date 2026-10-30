/** Unit tests live next to the code (*.spec.ts); e2e/integration tests need PostgreSQL and Redis (test/*.e2e-spec.ts). */
const base = { preset: 'ts-jest', testEnvironment: 'node', moduleFileExtensions: ['ts', 'js', 'json'] };
module.exports = {
  testTimeout: 30000,
  projects: [
    { ...base, displayName: 'unit', rootDir: 'src', testRegex: '.*\\.spec\\.ts$' },
    { ...base, displayName: 'e2e', rootDir: 'test', testRegex: '.*\\.e2e-spec\\.ts$', globalSetup: './global-setup.ts', setupFiles: ['./setup-env.ts'] },
  ],
};
