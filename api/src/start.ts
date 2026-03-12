import { initSentry } from './telemetry/sentry.js';

// Sentry must be initialized BEFORE importing server modules so that its
// built-in OpenTelemetry instrumentation can monkey-patch http, express,
// database drivers, etc. We use a dynamic import for server.js to guarantee
// the correct loading order.
await initSentry();

const { startServer } = await import('./server.js');
startServer();
