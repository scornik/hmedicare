import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSchemas } from '@hmedic/contracts/client';
import { ApiError, api, getTenant } from '../api';

/**
 * Queue board hooks (WEB-IMPLEMENTATION §4 `/queue/*`, API §3.5, QUEUE §3.5). The board polls the snapshot;
 * every command carries an Idempotency-Key generated per click and the `rowVersion` the row was rendered
 * from, so a stale click is refused by the server rather than applied to a row that has since moved.
 */
export type QueueSnapshot = ApiSchemas['schemas']['QueueSnapshot'];
export type QueueEntry = ApiSchemas['schemas']['QueueEntry'];
export type Serial = ApiSchemas['schemas']['Serial'];
export type ChamberDay = ApiSchemas['schemas']['ChamberDay'];

interface ApiResult<T> {
  data?: { data: T; meta?: unknown };
  error?: unknown;
  response: Response;
}

function unwrap<T>(r: ApiResult<T>): T {
  if (r.error || !r.data) {
    const e = r.error as { code?: string; details?: Record<string, unknown> } | undefined;
    throw new ApiError(r.response.status, e?.code ?? 'ERROR', e?.details);
  }
  return r.data.data;
}

const tenantHeader = () => ({ 'X-Tenant-ID': getTenant() ?? '' });
const idem = () => crypto.randomUUID();

/** How often the board re-reads the snapshot. QUEUE §3.5 sets the staff board at five seconds. */
export const QUEUE_POLL_MS = 5000;

export const queueKey = (tenant: string | null, chamberDayId: string) =>
  ['queue', tenant, chamberDayId] as const;

/**
 * The live board. Polling continues while the tab is hidden is switched off: a receptionist with the board
 * open in a background tab would otherwise keep a request in flight every five seconds all day.
 */
export function useQueueSnapshot(chamberDayId: string | null) {
  const tenant = getTenant();
  const qc = useQueryClient();
  const key = queueKey(tenant, chamberDayId ?? '');
  return useQuery({
    queryKey: key,
    enabled: chamberDayId !== null,
    refetchInterval: QUEUE_POLL_MS,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      // Conditional polling (ADR-013, audit C-09). A quiet chamber answers 304 with no body, so the
      // five-second poll costs a round trip rather than a whole board; the cached snapshot is returned
      // unchanged, which also leaves its object identity alone and re-renders nothing.
      const cached = qc.getQueryData<QueueSnapshot>(key);
      const result = await api.GET('/api/v1/chamber-days/{id}/queue', {
        params: {
          header: { ...tenantHeader(), ...(cached ? { 'If-None-Match': cached.etag } : {}) },
          path: { id: chamberDayId! },
        },
      });
      if (result.response.status === 304 && cached) return cached;
      return unwrap(result);
    },
  });
}

export function useChamberDays(input: { chamberId?: string; from: string; to: string } | null) {
  const tenant = getTenant();
  return useQuery({
    queryKey: ['chamber-days', tenant, input],
    enabled: input !== null,
    queryFn: async () =>
      unwrap(await api.GET('/api/v1/chamber-days', { params: { header: tenantHeader(), query: input! } })),
  });
}

type SerialCommand = 'check-in' | 'mark-waiting' | 'call' | 'recall' | 'start-consultation' | 'complete';

/**
 * One serial command. React Query's cache is updated optimistically so the row reacts to the click at once,
 * but the answer from the server replaces it and the next poll reconciles: the optimistic row is a
 * prediction of the queue, never a second source of truth for it.
 */
export function useSerialCommand(chamberDayId: string) {
  const qc = useQueryClient();
  const tenant = getTenant();
  const key = queueKey(tenant, chamberDayId);
  return useMutation({
    mutationFn: async (input: {
      command: SerialCommand;
      serialId: string;
      expectedRowVersion: number;
      /** The status to show while the request is in flight. */
      optimisticStatus?: QueueEntry['status'];
    }) => {
      const params = {
        header: { ...tenantHeader(), 'Idempotency-Key': idem() },
        path: { id: input.serialId },
      };
      const body = { expectedRowVersion: input.expectedRowVersion };
      switch (input.command) {
        case 'check-in':
          return unwrap(await api.POST('/api/v1/serials/{id}/check-in', { params, body }));
        case 'mark-waiting':
          return unwrap(await api.POST('/api/v1/serials/{id}/mark-waiting', { params, body }));
        case 'call':
          return unwrap(await api.POST('/api/v1/serials/{id}/call', { params, body }));
        case 'recall':
          return unwrap(await api.POST('/api/v1/serials/{id}/recall', { params, body }));
        case 'start-consultation':
          return unwrap(await api.POST('/api/v1/serials/{id}/start-consultation', { params, body }));
        case 'complete':
          return unwrap(await api.POST('/api/v1/serials/{id}/complete', { params, body }));
      }
    },
    onMutate: async (input) => {
      if (!input.optimisticStatus) return;
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<QueueSnapshot>(key);
      qc.setQueryData<QueueSnapshot>(key, (snap) =>
        snap
          ? {
              ...snap,
              entries: snap.entries.map((e) =>
                e.serialId === input.serialId ? { ...e, status: input.optimisticStatus! } : e,
              ),
            }
          : snap,
      );
      return { previous };
    },
    onError: (_e, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  });
}

export function useSkipSerial(chamberDayId: string) {
  const qc = useQueryClient();
  const tenant = getTenant();
  return useMutation({
    mutationFn: async (input: { serialId: string; expectedRowVersion: number; reason: string }) =>
      unwrap(
        await api.POST('/api/v1/serials/{id}/skip', {
          params: {
            header: { ...tenantHeader(), 'Idempotency-Key': idem() },
            path: { id: input.serialId },
          },
          body: { expectedRowVersion: input.expectedRowVersion, reason: input.reason },
        }),
      ),
    onSettled: () => void qc.invalidateQueries({ queryKey: queueKey(tenant, chamberDayId) }),
  });
}

export function useIssueWalkIn(chamberDayId: string) {
  const qc = useQueryClient();
  const tenant = getTenant();
  return useMutation({
    mutationFn: async (input: { patientId: string; careMode: 'PHYSICAL' | 'REMOTE' | 'HYBRID' }) =>
      unwrap(
        await api.POST('/api/v1/chamber-days/{id}/walk-ins', {
          params: {
            header: { ...tenantHeader(), 'Idempotency-Key': idem() },
            path: { id: chamberDayId },
          },
          body: input,
        }),
      ),
    onSettled: () => void qc.invalidateQueries({ queryKey: queueKey(tenant, chamberDayId) }),
  });
}

/**
 * Drag-reorder. `expectedQueueOrderVersion` is the version the board was rendered from: if anyone else
 * reordered the day in the meantime the server answers QUEUE_VERSION_CONFLICT and the caller reloads rather
 * than overwriting their change.
 */
export function useReorderQueue(chamberDayId: string) {
  const qc = useQueryClient();
  const tenant = getTenant();
  const key = queueKey(tenant, chamberDayId);
  return useMutation({
    mutationFn: async (input: { expectedQueueOrderVersion: number; orderedSerialIds: string[] }) =>
      unwrap(
        await api.POST('/api/v1/chamber-days/{id}/reorder', {
          params: {
            header: { ...tenantHeader(), 'Idempotency-Key': idem() },
            path: { id: chamberDayId },
          },
          body: input,
        }),
      ),
    onSuccess: (snapshot) => qc.setQueryData<QueueSnapshot>(key, snapshot),
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  });
}
