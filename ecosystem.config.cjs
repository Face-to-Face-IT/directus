/**
 * pm2 ecosystem options
 * See https://pm2.keymetrics.io/docs/usage/application-declaration/
 *
 * Attributes down below are in order of the above linked documentation
 */

const otelEnabled = process.env.OPENTELEMETRY_ENABLED === 'true' || process.env.OPENTELEMETRY_ENABLED === '1';

module.exports = [
	{
		// General
		name: 'directus',
		script: 'cli.js',
		args: ['start'],

		// OpenTelemetry must be loaded before any application modules so that
		// auto-instrumentation can monkey-patch http, express, database drivers, etc.
		// The --import flag runs the loader module before the application entry point.
		...(otelEnabled && { node_args: ['--import', '@directus/api/telemetry/init'] }),

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
