import { QueryClient, useQuery } from '@tanstack/react-query';
import { createApiClient } from '@hmedic/contracts/client';
import { apiBase, getAccessToken, refresh } from './auth/session';

/** Selected tenant for X-Tenant-ID (a UI choice; the server re-validates membership on every request). */
let tenantId: string | null = null;
export const setTenant = (id: string | null) => {
  tenantId = id;
};
export const getTenant = () => tenantId;

/** Bearer calls omit cookies; a 401 triggers one single-flight refresh and a retry (WEB-IMPLEMENTATION §2). */
const fetchWithRefresh: typeof fetch = async (input, init) => {
  const first = await fetch(input instanceof Request ? input.clone() : input, init);
  if (first.status !== 401 || !(await refresh())) return first;
  const req = new Request(input, init);
  req.headers.set('authorization', `Bearer ${getAccessToken() ?? ''}`);
  return fetch(req);
};

export const api = createApiClient({
  baseUrl: apiBase(),
  getAccessToken,
  getTenantId: getTenant,
  fetch: fetchWithRefresh,
});

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: true } },
});

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const { data, error, response } = await api.GET('/api/v1/me');
      if (error || !data)
        throw new ApiError(response.status, (error as { code?: string } | undefined)?.code ?? 'ERROR');
      return data.data;
    },
  });
}

export function useTenantContext(tenant: string | null) {
  return useQuery({
    queryKey: ['tenant-context', tenant],
    enabled: tenant !== null,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/api/v1/me/tenant-context', {
        params: { header: { 'X-Tenant-ID': tenant! } },
      });
      if (error || !data)
        throw new ApiError(response.status, (error as { code?: string } | undefined)?.code ?? 'ERROR');
      return data.data;
    },
  });
}
