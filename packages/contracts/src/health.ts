import { registry, z } from './registry';

// API-IMPLEMENTATION §3.1. Health routes are served without the /api/v1 prefix and without the envelope.
export const HealthLive = registry.register(
  'HealthLive',
  z.object({
    status: z.literal('ok'),
    app: z.enum(['api', 'worker']),
    bootId: z.string().uuid(),
    version: z.string(),
    uptimeSeconds: z.number().int().min(0),
  }),
);

const CheckState = z.enum(['ok', 'degraded', 'fail']);
export const HealthReady = registry.register(
  'HealthReady',
  z.object({
    status: z.enum(['ready', 'degraded', 'unavailable']),
    checks: z.record(CheckState),
  }),
);

registry.registerPath({
  method: 'get',
  path: '/health/live',
  operationId: 'getHealthLive',
  tags: ['health'],
  summary: 'Process liveness',
  responses: { 200: { description: 'Alive', content: { 'application/json': { schema: HealthLive } } } },
});

registry.registerPath({
  method: 'get',
  path: '/health/ready',
  operationId: 'getHealthReady',
  tags: ['health'],
  summary: 'Readiness (DB, job lag on the worker)',
  responses: {
    200: { description: 'Ready or degraded', content: { 'application/json': { schema: HealthReady } } },
    503: { description: 'Unavailable', content: { 'application/json': { schema: HealthReady } } },
  },
});
