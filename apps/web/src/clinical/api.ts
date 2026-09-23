import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSchemas } from '@hmedic/contracts/client';
import { ApiError, api, getTenant } from '../api';

/**
 * Consultation workspace hooks (CLIN-002…004, API §3.7).
 *
 * The draft is the only thing here that autosaves, and it carries `expectedRowVersion` on every write.
 * A refusal is never swallowed: `STALE_VERSION` reaches the screen as a choice for the doctor, because
 * the alternative — picking a winner silently — loses clinical text somebody typed.
 */
export type Encounter = ApiSchemas['schemas']['Encounter'];
export type EncounterSummary = ApiSchemas['schemas']['EncounterSummary'];
export type NoteDraft = ApiSchemas['schemas']['EncounterNoteDraft'];
export type NoteRevision = ApiSchemas['schemas']['EncounterNoteRevision'];
export type Diagnosis = ApiSchemas['schemas']['Diagnosis'];
export type SymptomObservation = ApiSchemas['schemas']['SymptomObservation'];

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

export const encounterKey = (tenant: string | null, id: string) => ['encounter', tenant, id] as const;
export const noteKey = (tenant: string | null, id: string) => ['note', tenant, id] as const;
export const diagnosesKey = (tenant: string | null, id: string) => ['diagnoses', tenant, id] as const;
export const historyKey = (tenant: string | null, patientId: string) =>
  ['patient-encounters', tenant, patientId] as const;

/** How long after the last keystroke the draft is sent. Long enough not to send a request per letter. */
export const AUTOSAVE_DEBOUNCE_MS = 1200;

export function useEncounter(encounterId: string) {
  const tenant = getTenant();
  return useQuery({
    queryKey: encounterKey(tenant, encounterId),
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/encounters/{id}', {
          params: { header: tenantHeader(), path: { id: encounterId } },
        }),
      ),
  });
}

export function useNoteDraft(encounterId: string) {
  const tenant = getTenant();
  return useQuery({
    queryKey: noteKey(tenant, encounterId),
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/encounters/{id}/note', {
          params: { header: tenantHeader(), path: { id: encounterId } },
        }),
      ),
    // Never refetched behind the doctor's back: a background refetch while they are typing would swap
    // the version under the editor and turn the next save into a conflict they did not cause.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useNoteRevisions(encounterId: string, enabled: boolean) {
  const tenant = getTenant();
  return useQuery({
    queryKey: [...noteKey(tenant, encounterId), 'revisions'] as const,
    enabled,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/encounters/{id}/note/revisions', {
          params: { header: tenantHeader(), path: { id: encounterId } },
        }),
      ),
  });
}

/**
 * Autosave. The caller owns the text; this only reports what the server did with it.
 *
 * Deliberately not optimistic. An optimistic draft would show "saved" for text the server may still
 * refuse, and the one thing a doctor must be able to trust on this screen is whether what they typed is
 * actually stored.
 */
export function useSaveDraft(encounterId: string) {
  const qc = useQueryClient();
  const tenant = getTenant();
  return useMutation({
    mutationFn: async (input: { expectedRowVersion: number; sections: Record<string, string | null> }) =>
      unwrap(
        await api.PUT('/api/v1/encounters/{id}/note', {
          params: { header: tenantHeader(), path: { id: encounterId } },
          body: input,
        }),
      ),
    onSuccess: (draft) => qc.setQueryData(noteKey(tenant, encounterId), draft),
  });
}

export function useSignNote(encounterId: string) {
  const qc = useQueryClient();
  const tenant = getTenant();
  return useMutation({
    mutationFn: async (input: { expectedRowVersion: number; correctionReason?: string }) => {
      const params = {
        header: { ...tenantHeader(), 'Idempotency-Key': idem() },
        path: { id: encounterId },
      };
      // An amendment is a signature with a reason, and it has its own route so the intent is explicit
      // in the request rather than inferred from whether a field happens to be present.
      return input.correctionReason
        ? unwrap(
            await api.POST('/api/v1/encounters/{id}/note/corrections', {
              params,
              body: {
                expectedRowVersion: input.expectedRowVersion,
                correctionReason: input.correctionReason,
              },
            }),
          )
        : unwrap(
            await api.POST('/api/v1/encounters/{id}/note/sign', {
              params,
              body: { expectedRowVersion: input.expectedRowVersion },
            }),
          );
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: noteKey(tenant, encounterId) });
      void qc.invalidateQueries({ queryKey: [...noteKey(tenant, encounterId), 'revisions'] });
    },
  });
}

export function useDiagnoses(encounterId: string) {
  const tenant = getTenant();
  return useQuery({
    queryKey: diagnosesKey(tenant, encounterId),
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/encounters/{id}/diagnoses', {
          params: { header: tenantHeader(), path: { id: encounterId } },
        }),
      ),
  });
}

export function useAddDiagnosis(encounterId: string) {
  const qc = useQueryClient();
  const tenant = getTenant();
  return useMutation({
    mutationFn: async (input: {
      display: string;
      certainty: 'CONFIRMED' | 'PROVISIONAL' | 'DIFFERENTIAL';
      replacesDiagnosisId?: string;
    }) =>
      unwrap(
        await api.POST('/api/v1/encounters/{id}/diagnoses', {
          params: {
            header: { ...tenantHeader(), 'Idempotency-Key': idem() },
            path: { id: encounterId },
          },
          body: input,
        }),
      ),
    onSettled: () => void qc.invalidateQueries({ queryKey: diagnosesKey(tenant, encounterId) }),
  });
}

export function useVoidDiagnosis(encounterId: string) {
  const qc = useQueryClient();
  const tenant = getTenant();
  return useMutation({
    mutationFn: async (input: { id: string; expectedRowVersion: number; reason: string }) =>
      unwrap(
        await api.POST('/api/v1/diagnoses/{id}/void', {
          params: {
            header: { ...tenantHeader(), 'Idempotency-Key': idem() },
            path: { id: input.id },
          },
          body: { expectedRowVersion: input.expectedRowVersion, reason: input.reason },
        }),
      ),
    onSettled: () => void qc.invalidateQueries({ queryKey: diagnosesKey(tenant, encounterId) }),
  });
}

/** The patient's earlier consultations. No note text: opening one is a separate, audited read. */
export function usePatientEncounters(patientId: string | null, excludeEncounterId?: string) {
  const tenant = getTenant();
  return useQuery({
    queryKey: historyKey(tenant, patientId ?? ''),
    enabled: patientId !== null,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/patients/{id}/encounters', {
          params: {
            header: tenantHeader(),
            path: { id: patientId! },
            query: { limit: 10, ...(excludeEncounterId ? { excludeEncounterId } : {}) },
          },
        }),
      ),
  });
}

export function useCompleteEncounter(encounterId: string) {
  const qc = useQueryClient();
  const tenant = getTenant();
  return useMutation({
    mutationFn: async (input: { expectedRowVersion: number }) =>
      unwrap(
        await api.POST('/api/v1/encounters/{id}/complete', {
          params: {
            header: { ...tenantHeader(), 'Idempotency-Key': idem() },
            path: { id: encounterId },
          },
          body: input,
        }),
      ),
    onSettled: () => void qc.invalidateQueries({ queryKey: encounterKey(tenant, encounterId) }),
  });
}
