import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Metrics registry (OBSERVABILITY.md §4). Stage 4 defines the platform, job, auth and SMS metrics;
 * later stages add their own. No label ever carries PHI, tenant names or doctor names.
 */
export function createMetrics(app: string) {
  const registry = new Registry();
  registry.setDefaultLabels({ app });
  collectDefaultMetrics({ register: registry });

  const m = {
    registry,
    httpRequests: new Counter({
      name: 'http_requests_total',
      help: 'HTTP requests',
      labelNames: ['route', 'method', 'status_class'] as const,
      registers: [registry],
    }),
    httpDuration: new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latency',
      labelNames: ['route', 'method', 'status_class'] as const,
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [registry],
    }),
    dbTxRetries: new Counter({
      name: 'db_tx_retries_total',
      help: 'Transaction retries after lock wait/deadlock',
      labelNames: ['context', 'mysql_errno'] as const,
      registers: [registry],
    }),
    dbTxRetryExhausted: new Counter({
      name: 'db_tx_retry_exhausted_total',
      help: 'Transactions that exhausted retries',
      labelNames: ['context', 'mysql_errno'] as const,
      registers: [registry],
    }),
    jobLag: new Gauge({
      name: 'job_lag_seconds',
      help: 'now - run_at of the oldest QUEUED job per queue',
      labelNames: ['queue'] as const,
      registers: [registry],
    }),
    jobsClaimed: new Counter({
      name: 'jobs_claimed_total',
      help: 'Jobs claimed',
      labelNames: ['queue', 'type'] as const,
      registers: [registry],
    }),
    jobsCompleted: new Counter({
      name: 'jobs_completed_total',
      help: 'Jobs completed',
      labelNames: ['queue', 'type'] as const,
      registers: [registry],
    }),
    jobsFailed: new Counter({
      name: 'jobs_failed_total',
      help: 'Job attempts that failed',
      labelNames: ['queue', 'type', 'error_class'] as const,
      registers: [registry],
    }),
    jobsDead: new Counter({
      name: 'jobs_dead_total',
      help: 'Jobs moved to dead letters',
      labelNames: ['queue', 'type', 'error_class'] as const,
      registers: [registry],
    }),
    outboxLag: new Gauge({
      name: 'outbox_publish_lag_seconds',
      help: 'Age of the oldest pending outbox event',
      registers: [registry],
    }),
    runnerHeartbeat: new Gauge({
      name: 'runner_heartbeat_timestamp_seconds',
      help: 'Last runner loop heartbeat',
      labelNames: ['mode'] as const,
      registers: [registry],
    }),
    rateLimitTripped: new Counter({
      name: 'rate_limit_tripped_total',
      help: 'Requests rejected by a rate limit',
      labelNames: ['scope'] as const,
      registers: [registry],
    }),
    otpDelivery: new Counter({
      name: 'otp_delivery_total',
      help: 'OTP delivery outcomes',
      labelNames: ['outcome'] as const,
      registers: [registry],
    }),
    smsSend: new Counter({
      name: 'sms_send_total',
      help: 'SMS send outcomes',
      labelNames: ['provider', 'purpose', 'outcome', 'error_class', 'credential_scope'] as const,
      registers: [registry],
    }),
    smsSegments: new Counter({
      name: 'sms_segments_estimated_total',
      help: 'Estimated SMS segments sent',
      labelNames: ['encoding', 'credential_scope'] as const,
      registers: [registry],
    }),
    smsLatency: new Histogram({
      name: 'sms_provider_latency_seconds',
      help: 'SMS provider latency',
      labelNames: ['provider', 'operation'] as const,
      buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 20],
      registers: [registry],
    }),
    smsBalance: new Gauge({
      name: 'sms_balance_bdt',
      help: 'Latest SMS balance (BDT, platform account)',
      labelNames: ['credential_scope'] as const,
      registers: [registry],
    }),
    smsKeyAge: new Gauge({
      name: 'sms_key_age_days',
      help: 'Age of the platform SMS API key',
      labelNames: ['credential_scope'] as const,
      registers: [registry],
    }),
    integrityFailures: new Counter({
      name: 'integrity_chain_verification_failures_total',
      help: 'Hash chain verification failures',
      labelNames: ['chain_type'] as const,
      registers: [registry],
    }),
  };
  return m;
}

export type Metrics = ReturnType<typeof createMetrics>;

export function statusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}
