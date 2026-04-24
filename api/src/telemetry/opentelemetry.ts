import { logs } from '@opentelemetry/api-logs';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { Resource } from '@opentelemetry/resources';
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

let sdk: NodeSDK | null = null;
let loggerProvider: LoggerProvider | null = null;
let meterProvider: MeterProvider | null = null;

/**
 * Read process.env directly instead of useEnv() because OpenTelemetry must be
 * initialized before any other modules (http, express, database drivers, etc.)
 * are imported. Using useEnv() would pull in the full env/logger dependency
 * tree too early, defeating auto-instrumentation.
 */
function getEnvBoolean(key: string, defaultValue: boolean): boolean {
	const value = process.env[key];

	if (value === undefined || value === '') {
		return defaultValue;
	}

	return value === 'true' || value === '1';
}

function getEnvString(key: string, defaultValue: string): string {
	return process.env[key] || defaultValue;
}

export async function initTelemetry() {
	if (!getEnvBoolean('OPENTELEMETRY_ENABLED', false)) {
		return;
	}

	const baseEndpoint = getEnvString('OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318');
	const serviceName = getEnvString('OPENTELEMETRY_SERVICE_NAME', 'directus-api');
	const serviceVersion = getEnvString('npm_package_version', 'unknown');

	const resource = new Resource({
		[ATTR_SERVICE_NAME]: serviceName,
		[ATTR_SERVICE_VERSION]: serviceVersion,
	});

	// ========== LOGS ==========
	const logExporter = new OTLPLogExporter({
		url: `${baseEndpoint}/v1/logs`,
	});

	loggerProvider = new LoggerProvider({ resource });
	loggerProvider.addLogRecordProcessor(new BatchLogRecordProcessor(logExporter));
	logs.setGlobalLoggerProvider(loggerProvider);

	// ========== METRICS ==========
	const metricExporter = new OTLPMetricExporter({
		url: `${baseEndpoint}/v1/metrics`,
	});

	meterProvider = new MeterProvider({
		resource,
		readers: [
			new PeriodicExportingMetricReader({
				exporter: metricExporter,
				exportIntervalMillis: 60000, // Export every 60 seconds
			}),
		],
	});

	// ========== TRACES (via NodeSDK) ==========
	sdk = new NodeSDK({
		resource,
		traceExporter: new OTLPTraceExporter({
			url: `${baseEndpoint}/v1/traces`,
		}),
		logRecordProcessor: new BatchLogRecordProcessor(logExporter),
		metricReader: new PeriodicExportingMetricReader({
			exporter: metricExporter,
			exportIntervalMillis: 60000,
		}),
		instrumentations: [getNodeAutoInstrumentations()],
	});

	try {
		sdk.start();
		// eslint-disable-next-line no-console -- logger unavailable (circular dep), OTel must init before logger
		console.log('[OpenTelemetry] Initialized with traces, logs, and metrics');
	} catch (error) {
		// eslint-disable-next-line no-console -- logger unavailable (circular dep), OTel must init before logger
		console.error('[OpenTelemetry] Error initializing:', error);
	}
}

/**
 * Get the OpenTelemetry logger for emitting structured logs
 */
export function getOtelLogger(name = 'directus-api') {
	return logs.getLogger(name);
}

/**
 * Get the OpenTelemetry meter for recording metrics
 */
export function getOtelMeter(name = 'directus-api') {
	return meterProvider?.getMeter(name);
}

/**
 * Gracefully shutdown OpenTelemetry providers.
 * Safe to call even if telemetry was never initialized (all providers will be null).
 */
export async function shutdownTelemetry() {
	if (!sdk && !loggerProvider && !meterProvider) {
		return;
	}

	try {
		await Promise.all([sdk?.shutdown(), loggerProvider?.shutdown(), meterProvider?.shutdown()]);

		// eslint-disable-next-line no-console -- logger unavailable (circular dep with pino-otel-transport)
		console.log('[OpenTelemetry] Shutdown complete');
	} catch (error) {
		// eslint-disable-next-line no-console -- logger unavailable (circular dep with pino-otel-transport)
		console.error('[OpenTelemetry] Error shutting down:', error);
	}
}
