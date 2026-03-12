/**
 * pm2 ecosystem options
 * See https://pm2.keymetrics.io/docs/usage/application-declaration/
 *
 * Attributes down below are in order of the above linked documentation
 */

const sentryEnabled = !!process.env.SENTRY_DSN;

// Build --import flags for pre-loader modules.
// Sentry must be loaded before any application modules so that its built-in
// OpenTelemetry instrumentation can monkey-patch http, express, database drivers, etc.
const importFlags = [
	...(sentryEnabled ? ['--import', '@directus/api/telemetry/sentry-init'] : []),
];

module.exports = [
	{
		// General
		name: 'directus',
		script: 'cli.js',
		args: ['start'],

		// The --import flag runs loader modules before the application entry point.
		...(importFlags.length > 0 && { node_args: importFlags }),

		// General
		instances: process.env.PM2_INSTANCES ?? 1,
		exec_mode: process.env.PM2_EXEC_MODE ?? 'cluster',
		max_memory_restart: process.env.PM2_MAX_MEMORY_RESTART,

		// Control flow
		min_uptime: process.env.PM2_MIN_UPTIME,
		listen_timeout: process.env.PM2_LISTEN_TIMEOUT,
		kill_timeout: process.env.PM2_KILL_TIMEOUT,
		wait_ready: true,
		max_restarts: process.env.PM2_MAX_RESTARTS,
		restart_delay: process.env.PM2_RESTART_DELAY ?? 0,
		autorestart: process.env.PM2_AUTO_RESTART === 'true',

		// Logs
		error_file: process.env.PM2_LOG_ERROR_FILE,
		out_file: process.env.PM2_LOG_OUT_FILE,
	},
];
