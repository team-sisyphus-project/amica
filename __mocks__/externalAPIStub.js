// Stub for @/features/externalAPI/externalAPI
// The real module constructs a URL at module-load time using
// process.env.NEXT_PUBLIC_DEVELOPMENT_BASE_URL which is undefined in Jest's
// jsdom environment.  This stub provides no-op replacements for all exports.
module.exports = {
  configUrl: { searchParams: { append: () => {} } },
  handleConfig: jest.fn(),
  serverConfig: jest.fn(),
  handleUserInput: jest.fn(),
  handleChatLogs: jest.fn(),
  handleSubconscious: jest.fn(),
};
