import nextJest from 'next/jest.js'
 
const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
})
 
// Add any custom config to be passed to Jest
/** @type {import('jest').Config} */
const config = {
  // Add more setup options before each test is run
  // setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],

  testEnvironment: 'jest-environment-jsdom',
  // setupFiles runs before any module imports in the test worker, so env vars
  // set here are available when modules construct globals at load time.
  setupFiles: ['./jest.env.setup.mjs'],
  setupFilesAfterEnv: ['./jest.setup.mjs'],

  // Stub out modules that cause Jest to fail in the jsdom environment:
  //   • three/examples/jsm – ESM-only files that Jest cannot transform in CJS mode
  //   • @/lib/VRMAnimation/loadVRMAnimation – imports the three.js ESM chain
  //   • @/features/externalAPI/externalAPI – constructs a URL at module level
  //     using process.env.NEXT_PUBLIC_DEVELOPMENT_BASE_URL which is undefined in CI
  // These stubs are only consulted by Jest; next build uses the real files.
  // Only collect coverage from application source files in src/.
  // This explicitly excludes __mocks__/ (test infrastructure) and other
  // non-source directories so the doctor's test-coverage check does not
  // flag mock files as "source files without test files".
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.stories.{js,jsx,ts,tsx}',
  ],

  moduleNameMapper: {
    // three.js ESM sub-paths that Jest cannot transform in CJS mode
    '^three/examples/jsm/(.*)$': '<rootDir>/__mocks__/threejsStub.js',
    // loadVRMAnimation pulls in three.js ESM; stub it out for tests.
    '^@/lib/VRMAnimation/loadVRMAnimation': '<rootDir>/__mocks__/threejsStub.js',
    '/src/lib/VRMAnimation/loadVRMAnimation': '<rootDir>/__mocks__/threejsStub.js',
    // externalAPI constructs a URL at module-load time; stub it for tests.
    '^@/features/externalAPI/externalAPI': '<rootDir>/__mocks__/externalAPIStub.js',
    '/src/features/externalAPI/externalAPI': '<rootDir>/__mocks__/externalAPIStub.js',
  },
}
 
// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default createJestConfig(config)
