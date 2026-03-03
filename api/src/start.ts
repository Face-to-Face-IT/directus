import { initTelemetry } from './telemetry/opentelemetry.js';

// OpenTelemetry must be initialized BEFORE importing server modules so that
// auto-instrumentation can monkey-patch http, express, database drivers, etc.
// We use a dynamic import for server.js to guarantee the correct loading order.
await initTelemetry();

const { startServer } = await import('./server.js');
startServer();
