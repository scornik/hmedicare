import createClient, { type Client, type Middleware } from 'openapi-fetch';
import type { paths } from '../../generated/openapi.v1';

export type ApiPaths = paths;
export type ApiClient = Client<paths>;

export interface ApiClientOptions {
  baseUrl: string;
  /** Access token held in memory (web) or secure storage (mobile). Never persisted by this client. */
  getAccessToken?: () => string | null | undefined;
  /** Active tenant for `X-Tenant-ID` (validated server-side; never trusted from the body). */
  getTenantId?: () => string | null | undefined;
  fetch?: typeof globalThis.fetch;
}

/**
 * Typed fetch client over the generated OpenAPI 3.1 paths (WEB-IMPLEMENTATION §2). Sends cookies only to
 * the API origin (`credentials: 'include'` for the refresh cookie flow) and adds bearer/tenant headers.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const client = createClient<paths>({
    baseUrl: options.baseUrl.replace(/\/+$/, ''),
    credentials: 'include',
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
