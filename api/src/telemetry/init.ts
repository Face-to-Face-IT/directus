/**
 * OpenTelemetry pre-loader module.
 *
 * This module is designed to be used with Node's --import flag so that
 * OpenTelemetry auto-instrumentation hooks are registered BEFORE any
 * application modules (http, express, pg, etc.) are loaded.
 *
 * Usage:
 *   node --import @directus/api/telemetry/init.js cli.js start
 *
 * When OPENTELEMETRY_ENABLED is not set to 'true', this module is a no-op.
 */
import { initTelemetry } from './opentelemetry.js';

await initTelemetry();
