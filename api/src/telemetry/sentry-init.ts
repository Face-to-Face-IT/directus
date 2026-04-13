/**
 * Sentry pre-loader module.
 *
 * This module is designed to be used with Node's --import flag so that
 * Sentry error tracking is initialized BEFORE any application modules
 * (http, express, pg, etc.) are loaded.
 *
 * Usage:
 *   node --import @directus/api/telemetry/sentry-init.js cli.js start
 *
 * When SENTRY_DSN is not set, this module is a no-op.
 */
import { initSentry } from './sentry.js';

await initSentry();
