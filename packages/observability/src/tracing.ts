import { SpanStatusCode, trace } from '@opentelemetry/api';

type Attrs = Record<string, string | number | boolean>;

const tracer = trace.getTracer('bigforge');

/**
 * Runs `fn` inside an OpenTelemetry span. With no SDK registered this is a no-op, so the demo
 * has no telemetry dependency; with an exporter configured the spans are exported.
 * Never put prompts, evidence or secrets in span attributes.
 */
export async function withSpan<T>(
  name: string,
  attributes: Attrs,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn();
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message.slice(0, 200) : 'error',
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

export interface TelemetryStatus {
  enabled: boolean;
  exporter: 'azure-monitor' | 'otlp' | 'none';
  note: string;
}

type Env = Record<string, string | undefined>;

/**
 * Optional exporter wiring. Exporter packages are NOT installed by default: if they are missing
 * the status says so honestly and the app keeps running with metrics + logs only.
 * - APPLICATIONINSIGHTS_CONNECTION_STRING -> @azure/monitor-opentelemetry
 * - OTEL_EXPORTER_OTLP_ENDPOINT          -> @opentelemetry/sdk-node
 */
export async function setupTelemetry(env: Env): Promise<TelemetryStatus> {
  const load = async (name: string): Promise<Record<string, unknown> | null> => {
    try {
      return (await import(/* @vite-ignore */ name)) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  if (env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
    const mod = await load('@azure/monitor-opentelemetry');
    const use = mod?.useAzureMonitor as ((o: unknown) => void) | undefined;
    if (!use)
      return {
        enabled: false,
        exporter: 'none',
        note: 'APPLICATIONINSIGHTS_CONNECTION_STRING is set but @azure/monitor-opentelemetry is not installed; telemetry export is disabled.',
      };
    use({
      azureMonitorExporterOptions: { connectionString: env.APPLICATIONINSIGHTS_CONNECTION_STRING },
    });
    return {
      enabled: true,
      exporter: 'azure-monitor',
      note: 'Exporting traces and metrics to Application Insights.',
    };
  }
  if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const mod = await load('@opentelemetry/sdk-node');
    const NodeSDK = mod?.NodeSDK as (new () => { start(): void }) | undefined;
    if (!NodeSDK)
      return {
        enabled: false,
        exporter: 'none',
        note: 'OTEL_EXPORTER_OTLP_ENDPOINT is set but @opentelemetry/sdk-node is not installed; telemetry export is disabled.',
      };
    new NodeSDK().start();
    return { enabled: true, exporter: 'otlp', note: 'Exporting via OTLP.' };
  }
  return {
    enabled: false,
    exporter: 'none',
    note: 'No telemetry exporter configured; in-process metrics and structured logs only.',
  };
}

/** Fastify/pino redaction paths: logs carry request metadata only, never cookies, headers or bodies. */
export const LOG_REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  'req.body',
  'res.body',
];
