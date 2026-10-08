import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getTenant, ApiError, useTenantContext } from '../api';
import { currentUser } from '../auth/session';
import { useI18n } from '../i18n/i18n';
import type { ApiSchemas } from '@hmedic/contracts/client';
type Plan = ApiSchemas['schemas']['FollowUpPlan'];
export function FollowUpPanel({
  encounterId,
  chamberId,
  canWrite,
}: {
  encounterId: string;
  chamberId: string;
  canWrite: boolean;
}) {
  const { t } = useI18n(),
    tenant = getTenant(),
    user = currentUser(),
    client = useQueryClient();
  const context = useTenantContext(tenant);
  canWrite = canWrite && (context.data?.permissions.includes('followup.write') ?? false);
  const canBook = context.data?.permissions.includes('appointment.write') ?? false;
  const [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [reason, setReason] = useState(''),
    [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const key = ['follow-up', tenant, user?.id, encounterId];
  const plans = useQuery({
    queryKey: key,
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const r = await api.GET('/api/v1/encounters/{id}/follow-ups', {
        signal,
        params: { path: { id: encounterId }, header: { 'X-Tenant-ID': tenant! } },
      });
      if (r.error || !r.data) throw new ApiError(r.response.status, r.error?.code ?? 'ERROR');
      return r.data.data;
    },
  });
  async function run(work: () => Promise<{ response: Response; error?: unknown }>) {
    setBusy(true);
    setError(null);
    try {
      const r = await work();
      if (r.error || !r.response.ok) throw new ApiError(r.response.status, 'ERROR');
      await client.invalidateQueries({ queryKey: key });
      return true;
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? t('followup.conflict') : t('followup.failed'));
      await client.invalidateQueries({ queryKey: key });
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function change(p: Plan, status: 'COMPLETED' | 'CANCELLED' | 'MISSED') {
    await run(() =>
      api.PATCH('/api/v1/follow-ups/{id}', {
        params: { path: { id: p.id }, header: { 'X-Tenant-ID': tenant! } },
        body: { expectedRowVersion: p.rowVersion, status },
      }),
    );
  }
  return (
    <section className="card" aria-label={t('followup.title')} data-testid="follow-up-panel">
      <h2>{t('followup.title')}</h2>
      {(error || plans.error) && <p role="alert">{error ?? t('followup.failed')}</p>}
      {plans.isPending && <p>{t('common.loading')}</p>}
      {!plans.isPending && !plans.error && !plans.data?.length && <p>{t('followup.empty')}</p>}
      <ul>
        {!plans.error &&
          (plans.data ?? []).map((p) => (
            <li key={p.id}>
              <time>
                {p.dueStartDate}
                {p.dueEndDate ? ` – ${p.dueEndDate}` : ''}
              </time>{' '}
              <strong>{p.reason}</strong>
              {p.instructions && <p>{p.instructions}</p>}
              <p>{t(`followup.${p.status}`)}</p>
              {(p.appointmentId || p.status === 'BOOKED') && <p>{t('followup.bookingRemains')}</p>}
              {canWrite && ['PLANNED', 'BOOKED'].includes(p.status) && (
                <div className="row">
                  {p.status === 'PLANNED' && canBook && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          api.POST('/api/v1/follow-ups/{id}/book', {
                            params: {
                              path: { id: p.id },
                              header: { 'X-Tenant-ID': tenant!, 'Idempotency-Key': crypto.randomUUID() },
                            },
                            body: {
                              chamberId,
                              localDate: p.dueStartDate,
                              careMode: 'PHYSICAL',
                              expectedRowVersion: p.rowVersion,
                            },
                          }),
                        )
                      }
                    >
                      {t('followup.book')}
                    </button>
                  )}
                  <button disabled={busy} onClick={() => void change(p, 'COMPLETED')}>
                    {t('followup.complete')}
                  </button>
                  <button disabled={busy} onClick={() => void change(p, 'CANCELLED')}>
                    {t('followup.cancel')}
                  </button>
                </div>
              )}
            </li>
          ))}
      </ul>
      {canWrite && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(() =>
              api.POST('/api/v1/encounters/{id}/follow-ups', {
                params: {
                  path: { id: encounterId },
                  header: { 'X-Tenant-ID': tenant!, 'Idempotency-Key': crypto.randomUUID() },
                },
                body: {
                  dueStartDate: start,
                  dueEndDate: end || null,
                  reason,
                  instructions: instructions || null,
                },
              }),
            ).then((ok) => {
              if (ok) {
                setReason('');
                setInstructions('');
              }
            });
          }}
        >
          <label>
            {t('followup.start')}
            <input type="date" required value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            {t('followup.end')}
            <input type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
          <label>
            {t('followup.reason')}
            <input required maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <label>
            {t('followup.instructions')}
            <textarea
              maxLength={1000}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </label>
          <button disabled={busy || !reason.trim()}>{t('followup.create')}</button>
        </form>
      )}
    </section>
  );
}
