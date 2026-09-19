import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSchemas } from '@hmedic/contracts/client';
import { ApiError, api, getTenant } from '../api';

/**
 * Patient registry hooks (WEB-IMPLEMENTATION §4 `/patients/*`, API §3.4). Every call carries X-Tenant-ID
 * (validated server-side) and every mutation an Idempotency-Key generated per click intent. Responses only
 * ever contain masked phones (PatientSummary.phoneMasked / PatientContact.displayValue).
 */
export type PatientSummary = ApiSchemas['schemas']['PatientSummary'];
export type Patient = ApiSchemas['schemas']['Patient'];
export type DuplicateCandidate = ApiSchemas['schemas']['DuplicateCandidate'];
export type DuplicateCheckResponse = ApiSchemas['schemas']['DuplicateCheckResponse'];
export type CreatePatientRequest = ApiSchemas['schemas']['CreatePatientRequest'];
export type DuplicateCheckRequest = ApiSchemas['schemas']['DuplicateCheckRequest'];
export type MergeCase = ApiSchemas['schemas']['MergeCase'];

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
export const newIdempotencyKey = (): string => crypto.randomUUID();

export interface SearchInput {
  query?: string;
  phone?: string;
  mrn?: string;
  cursor?: string;
}

/** Classifies free text into the API's search fields: MRN prefix, digits → phone, otherwise name tokens. */
export function classifySearch(text: string): SearchInput | null {
  const v = text.trim();
  if (v.length < 2) return null;
  if (/^p-?[0-9a-z-]{4,}$/i.test(v)) return { mrn: v.toUpperCase() };
  if (/^\+?[0-9০-৯\s-]{6,}$/.test(v)) return { phone: v.replace(/[\s-]/g, '') };
  return { query: v };
}

export function usePatientSearch(input: SearchInput | null) {
  const tenant = getTenant();
  return useQuery({
    queryKey: ['patients', 'search', tenant, input],
    enabled: input !== null,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/patients', {
          params: { header: tenantHeader(), query: { ...input, limit: 20 } },
        }),
      ),
  });
}

export function usePatient(id: string | null) {
  const tenant = getTenant();
  return useQuery({
    queryKey: ['patients', tenant, id],
    enabled: id !== null,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/patients/{id}', { params: { header: tenantHeader(), path: { id: id! } } }),
      ),
  });
}

export function useDuplicateCheck() {
  return useMutation({
    mutationFn: async (body: DuplicateCheckRequest) =>
      unwrap(
        await api.POST('/api/v1/patients/duplicate-check', { params: { header: tenantHeader() }, body }),
      ),
  });
}

export function useCreatePatient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { body: CreatePatientRequest; idempotencyKey: string }) =>
      unwrap(
        await api.POST('/api/v1/patients', {
          params: { header: { ...tenantHeader(), 'Idempotency-Key': input.idempotencyKey } },
          body: input.body,
        }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['patients'] }),
  });
}

export function useMergeCases() {
  const tenant = getTenant();
  return useQuery({
    queryKey: ['merge-cases', tenant],
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/merge-cases', {
          params: { header: tenantHeader(), query: { status: 'OPEN', limit: 50 } },
        }),
      ),
  });
}

export function useOpenMergeCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      sourcePatientId: string;
      targetPatientId: string;
      reason: string;
      idempotencyKey: string;
    }) =>
      unwrap(
        await api.POST('/api/v1/patients/{id}/merge-cases', {
          params: {
            header: { ...tenantHeader(), 'Idempotency-Key': input.idempotencyKey },
            path: { id: input.sourcePatientId },
          },
          body: { targetPatientId: input.targetPatientId, reason: input.reason },
        }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['merge-cases'] }),
  });
}

export function useReviewMergeCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      decision: 'approve' | 'reject';
      expectedRowVersion: number;
      reason?: string;
      idempotencyKey: string;
    }) => {
      const params = {
        header: { ...tenantHeader(), 'Idempotency-Key': input.idempotencyKey },
        path: { id: input.id },
      };
      const body = { expectedRowVersion: input.expectedRowVersion, reason: input.reason };
      return unwrap(
        input.decision === 'approve'
          ? await api.POST('/api/v1/merge-cases/{id}/approve', { params, body })
          : await api.POST('/api/v1/merge-cases/{id}/reject', { params, body }),
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['merge-cases'] });
      void qc.invalidateQueries({ queryKey: ['patients'] });
    },
  });
}
