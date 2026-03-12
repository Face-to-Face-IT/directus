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
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

let initialized = false;

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
		console.log(`[Sentry] Initialized (env=${environment}, traces=${tracesSampleRate}, features=${features.join(',')})` );
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
