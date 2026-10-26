'use strict';
// Preloaded with `node -r ./src/tracing.js`. Enabled only when an OTLP endpoint is configured.
if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT && process.env.NODE_ENV !== 'test') {
  try {
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
    const sdk = new NodeSDK({
      serviceName: process.env.OTEL_SERVICE_NAME || 'amrutam-api',
      traceExporter: new OTLPTraceExporter(),
      instrumentations: [getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } })],
    });
    sdk.start();
    process.on('SIGTERM', () => sdk.shutdown().catch(() => {}));
  } catch (e) {
    console.error('tracing disabled:', e.message);
  }
}
