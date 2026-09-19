import createClient, { type Client, type Middleware } from 'openapi-fetch';
import type { components, paths } from '../../generated/openapi.v1';

export type ApiPaths = paths;
/** Generated component schemas (`ApiSchemas['schemas']['Patient']`) for typed UI code. */
export type ApiSchemas = components;
export type ApiClient = Client<paths>;

export interface ApiClientOptions {
  baseUrl: string;
  /** Access token held in memory (web) or secure storage (mobile). Never persisted by this client. */
  getAccessToken?: () => string | null | undefined;
  /** Active tenant for `X-Tenant-ID` (validated server-side; never trusted from the body). */
  getTenantId?: () => string | null | undefined;
  fetch?: typeof globalThis.fetch;
  /**
   * Cookies are sent only where the auth transport needs them (refresh/CSRF/logout). Ordinary calls use
   * bearer tokens with `omit` (WEB-IMPLEMENTATION §2).
   */
  credentials?: 'omit' | 'same-origin' | 'include';
}

/**
 * Typed fetch client over the generated OpenAPI 3.1 paths (WEB-IMPLEMENTATION §2). Adds bearer/tenant
 * headers; cookies are omitted unless a caller opts in for the auth endpoints.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const client = createClient<paths>({
    baseUrl: options.baseUrl.replace(/\/+$/, ''),
    credentials: options.credentials ?? 'omit',
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const auth: Middleware = {
    onRequest({ request }) {
      const token = options.getAccessToken?.();
      if (token) request.headers.set('authorization', `Bearer ${token}`);
      const tenant = options.getTenantId?.();
      if (tenant) request.headers.set('x-tenant-id', tenant);
      return request;
    },
  };
  client.use(auth);
  return client;
}
