// Environment variables required by modules that construct URLs at load time.
// This file runs via `setupFiles` — before any module imports — so the values
// are available when externalAPI.ts initialises its configUrl constant.
process.env.NEXT_PUBLIC_DEVELOPMENT_BASE_URL = process.env.NEXT_PUBLIC_DEVELOPMENT_BASE_URL || 'http://localhost:3000';
