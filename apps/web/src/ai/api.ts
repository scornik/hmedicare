import type { ApiSchemas } from '@hmedic/contracts/client';
import { ApiError, api, getTenant } from '../api';
export type AiJob = ApiSchemas['schemas']['AiJob'];
export type AiDraft = ApiSchemas['schemas']['AiDraft'];
export type AiSuggestion = ApiSchemas['schemas']['AiSuggestion'];
export type ApproveAiSuggestion = ApiSchemas['schemas']['ApproveAiSuggestionRequest'];
function unwrap<T>(r: { data?: { data: T }; error?: unknown; response: Response }): T {
  if (r.error || !r.data) {
    const e = r.error as { code?: string } | undefined;
    throw new ApiError(r.response.status, e?.code ?? 'ERROR');
  }
  return r.data.data;
}
const header = () => ({ 'X-Tenant-ID': getTenant() ?? '' });
const writeHeader = () => ({ ...header(), 'Idempotency-Key': crypto.randomUUID() });
export const aiApi = {
  jobs: async (id: string) =>
    unwrap(await api.GET('/api/v1/encounters/{id}/ai/jobs', { params: { header: header(), path: { id } } })),
  myCredentials: async () =>
    unwrap(await api.GET('/api/v1/me/ai/credentials', { params: { header: header() } })),
  policy: async () => unwrap(await api.GET('/api/v1/tenant/ai-policy', { params: { header: header() } })),
  credentials: async (id: string) =>
    unwrap(
      await api.GET('/api/v1/doctors/{id}/ai/credentials', { params: { header: header(), path: { id } } }),
    ),
  models: async (providerCode: string) =>
    unwrap(await api.GET('/api/v1/ai/models', { params: { header: header(), query: { providerCode } } })),
  create: async (
    id: string,
    purpose: 'note-draft' | 'history-summary',
    body: ApiSchemas['schemas']['CreateAiJobRequest'],
  ) => {
    const options = { params: { header: writeHeader(), path: { id } }, body };
    return purpose === 'note-draft'
      ? unwrap(await api.POST('/api/v1/encounters/{id}/ai/note-draft', options))
      : unwrap(await api.POST('/api/v1/encounters/{id}/ai/history-summary', options));
  },
  job: async (id: string) =>
    unwrap(await api.GET('/api/v1/ai/jobs/{id}', { params: { header: header(), path: { id } } })),
  cancel: async (id: string) =>
    unwrap(
      await api.POST('/api/v1/ai/jobs/{id}/cancel', { params: { header: writeHeader(), path: { id } } }),
    ),
  draft: async (id: string) =>
    unwrap(await api.GET('/api/v1/ai/drafts/{id}', { params: { header: header(), path: { id } } })),
  open: async (id: string) =>
    unwrap(
      await api.POST('/api/v1/ai/drafts/{id}/open', { params: { header: writeHeader(), path: { id } } }),
    ),
  close: async (id: string) =>
    unwrap(
      await api.POST('/api/v1/ai/drafts/{id}/close', { params: { header: writeHeader(), path: { id } } }),
    ),
  review: async (id: string, body: ApiSchemas['schemas']['ReviewAiSuggestionRequest']) =>
    unwrap(
      await api.POST('/api/v1/ai/suggestions/{id}/review', {
        params: { header: writeHeader(), path: { id } },
        body,
      }),
    ),
  approve: async (id: string, body: ApproveAiSuggestion) =>
    unwrap(
      await api.POST('/api/v1/ai/suggestions/{id}/approve', {
        params: { header: writeHeader(), path: { id } },
        body,
      }),
    ),
};
