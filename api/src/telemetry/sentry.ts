/**
 * Sentry observability initialization for Directus.
 *
 * Like OpenTelemetry, Sentry must be initialized BEFORE importing application
 * modules so that it can properly instrument Express, HTTP, and database drivers.
 *
 * Enables: errors, traces, profiling, logs, metrics, and release tracking.
 *
 * We read process.env directly (not useEnv()) to avoid pulling in the full
 * env/logger dependency tree too early. We use console.log/console.error
 * instead of the logger for the same reason.
 *
 * When SENTRY_DSN is not set, this module is a no-op.
 */
import type { ErrorEvent, EventHint, Breadcrumb, BreadcrumbHint } from '@sentry/node';
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

let initialized = false;

/**
 * PII scrubbing — strip sensitive data from Sentry error events.
 *
 * Directus API errors can include request bodies, query parameters, and
 * headers containing child welfare records. This hook redacts those before
 * the event leaves the server.
 */
function beforeSend(event: ErrorEvent, _hint: EventHint): ErrorEvent | null {
	// Scrub request body — may contain item payloads with PII
	if (event.request?.data) {
		event.request.data = '[Redacted]';
	}

	// Scrub query strings — filter values can contain names, IDs, etc.
	if (event.request?.query_string) {
		event.request.query_string = '[Redacted]';
	}

	// Scrub cookies — session tokens
	if (event.request?.cookies) {
		event.request.cookies = {};
	}

	// Scrub Authorization / Cookie headers
	if (event.request?.headers) {
		const sensitiveHeaders = ['authorization', 'cookie', 'set-cookie', 'x-forwarded-for'];

		for (const header of sensitiveHeaders) {
			if (header in event.request.headers) {
				event.request.headers[header] = '[Redacted]';
			}
		}
	}

	// Scrub breadcrumb data that may carry request/response bodies
	if (event.breadcrumbs) {
		for (const breadcrumb of event.breadcrumbs) {
			scrubBreadcrumb(breadcrumb);
		}
	}

	return event;
}

/**
 * Scrub PII from individual breadcrumbs.
 *
 * HTTP breadcrumbs can capture request/response bodies and URLs with
 * query parameters containing record data.
 */
function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
	if (breadcrumb.category === 'http' && breadcrumb.data) {
		// Remove response/request bodies
		delete breadcrumb.data['request_body'];
		delete breadcrumb.data['response_body'];

		// Redact query strings from URLs
		if (typeof breadcrumb.data['url'] === 'string') {
			const qIndex = breadcrumb.data['url'].indexOf('?');

			if (qIndex !== -1) {
				breadcrumb.data['url'] = breadcrumb.data['url'].substring(0, qIndex) + '?[Redacted]';
			}
		}
	}

	return breadcrumb;
}

function beforeBreadcrumb(breadcrumb: Breadcrumb, _hint?: BreadcrumbHint): Breadcrumb | null {
	return scrubBreadcrumb(breadcrumb);
}

function getEnvString(key: string, defaultValue: string): string {
	return process.env[key] || defaultValue;
}

function getEnvFloat(key: string, defaultValue: number): number {
	const value = process.env[key];

	if (value === undefined || value === '') {
		return defaultValue;
	}

	const parsed = Number.parseFloat(value);
	return Number.isNaN(parsed) ? defaultValue : parsed;
}

function getEnvBool(key: string, defaultValue: boolean): boolean {
	const value = process.env[key];

	if (value === undefined || value === '') {
		return defaultValue;
	}

	return value === 'true' || value === '1';
}

export async function initSentry() {
	const dsn = process.env['SENTRY_DSN'];

	if (!dsn) {
		return;
	}

	const environment = getEnvString('SENTRY_ENVIRONMENT', 'development');
	const release = process.env['SENTRY_RELEASE'];
	const tracesSampleRate = getEnvFloat('SENTRY_TRACES_SAMPLE_RATE', 0.1);
	const profileSessionSampleRate = getEnvFloat('SENTRY_PROFILE_SESSION_SAMPLE_RATE', 0.1);
	const enableLogs = getEnvBool('SENTRY_ENABLE_LOGS', true);
	const tenantName = process.env['F2F_TENANT_NAME'];
	const environmentName = process.env['F2F_ENVIRONMENT_NAME'];

	try {
		Sentry.init({
			dsn,
			environment,
			...(release ? { release } : {}),
			tracesSampleRate,

			// Profiling — V8 CpuProfiler via @sentry/profiling-node
			profileSessionSampleRate,
			profileLifecycle: 'trace',
			integrations: [nodeProfilingIntegration()],

			// Logs — captures Sentry.logger.* calls, links to active traces
			enableLogs,

			// PII scrubbing — prevent child welfare data from reaching Sentry.
			// Explicitly disable default PII collection (IP addresses, user agent, etc.)
			sendDefaultPii: false,
			beforeSend,
			beforeBreadcrumb,

			// Sentry manages OpenTelemetry instrumentation internally —
			// no separate OTel SDK init or ADOT sidecar needed.
			skipOpenTelemetrySetup: false,
		});

		// Set multi-tenant context as global tags for filtering in Sentry dashboard
		if (tenantName) {
			Sentry.setTag('tenant_name', tenantName);
		}

		if (environmentName) {
			Sentry.setTag('f2f_environment', environmentName);
		}

		initialized = true;

		const features = [
			'errors',
			'traces',
			profileSessionSampleRate > 0 ? 'profiling' : null,
			enableLogs ? 'logs' : null,
			'metrics',
		].filter(Boolean);

		// eslint-disable-next-line no-console -- logger unavailable (circular dep), Sentry must init before logger
		console.log(`[Sentry] Initialized (env=${environment}, traces=${tracesSampleRate}, features=${features.join(',')})`);
	} catch (error) {
		// eslint-disable-next-line no-console -- logger unavailable (circular dep), Sentry must init before logger
		console.error('[Sentry] Error initializing:', error);
	}
}

/**
 * Register Sentry's Express error handler on the app.
 * Must be called AFTER all routes are mounted.
 */
export function setupSentryExpressHandler(app: Parameters<typeof Sentry.setupExpressErrorHandler>[0]) {
	if (!initialized) {
		return;
	}

	Sentry.setupExpressErrorHandler(app);

	// eslint-disable-next-line no-console -- logger unavailable at this point in the init chain
	console.log('[Sentry] Express error handler registered');
}

/**
 * Gracefully flush and close Sentry.
 * Safe to call even if Sentry was never initialized.
 */
export async function shutdownSentry() {
	if (!initialized) {
		return;
	}

	try {
		// Flush pending events with a 2-second timeout
		await Sentry.close(2000);

		// eslint-disable-next-line no-console -- logger unavailable (circular dep with pino)
		console.log('[Sentry] Shutdown complete');
	} catch (error) {
		// eslint-disable-next-line no-console -- logger unavailable (circular dep with pino)
		console.error('[Sentry] Error shutting down:', error);
	}
}
