import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@hmedic/kernel';
import {
  ERROR_CODE_VALUES,
  HealthLive,
  ProblemDetails,
  buildOpenApiV30,
  buildOpenApiV31,
} from '../../src/index';
import { createApiClient } from '../../src/client/index';

type Doc = { openapi: string; paths: Record<string, Record<string, { operationId?: string }>> };
const opIds = (doc: Doc) =>
  Object.values(doc.paths)
    .flatMap((item) => Object.values(item).map((op) => op.operationId))
    .sort();

describe('OpenAPI documents (FOUND-010)', () => {
  const v31 = buildOpenApiV31() as unknown as Doc;
  const v30 = buildOpenApiV30() as unknown as Doc;

  it('emits 3.1.0 and 3.0.3 from one registry with the same operations', () => {
    expect(v31.openapi).toBe('3.1.0');
    expect(v30.openapi).toBe('3.0.3');
    expect(opIds(v31)).toEqual(opIds(v30));
    expect(opIds(v31)).toContain('getHealthLive');
  });

  it('keeps the error-code enum identical to the kernel table', () => {
    expect([...ERROR_CODE_VALUES].sort()).toEqual(Object.keys(ERROR_CODES).sort());
  });

  it('validates representative bodies', () => {
    expect(
      ProblemDetails.safeParse({
        code: 'RATE_LIMITED',
        message: 'RATE_LIMITED',
        requestId: '01a0b422-fd6f-7480-8586-444e7fc66080',
        retryAfterSeconds: 3,
      }).success,
    ).toBe(true);
    expect(ProblemDetails.safeParse({ code: 'NOT_A_CODE', message: 'x', requestId: 'y' }).success).toBe(
      false,
    );
    expect(
      HealthLive.safeParse({ status: 'ok', app: 'api', bootId: 'x', version: '1', uptimeSeconds: 1 }).success,
    ).toBe(false);
  });
});

describe('createApiClient', () => {
  it('adds bearer and tenant headers and omits cookies by default', async () => {
    const seen: Request[] = [];
    const client = createApiClient({
      baseUrl: 'https://api.example.invalid/',
      getAccessToken: () => 'token-in-memory',
      getTenantId: () => '01a0b422-fd6f-7480-8586-444e7fc66082',
      fetch: async (input: string | URL | Request) => {
        seen.push(input as Request);
        return new Response(
          JSON.stringify({
            status: 'ok',
            app: 'api',
            bootId: '01a0b422-fd6f-7480-8586-444e7fc66083',
            version: '1',
            uptimeSeconds: 1,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });
    const { data } = await client.GET('/health/live');
    expect(data?.status).toBe('ok');
    expect(seen[0]!.url).toBe('https://api.example.invalid/health/live');
    expect(seen[0]!.headers.get('authorization')).toBe('Bearer token-in-memory');
    expect(seen[0]!.headers.get('x-tenant-id')).toBe('01a0b422-fd6f-7480-8586-444e7fc66082');
    expect(seen[0]!.credentials).toBe('omit');
  });
});
