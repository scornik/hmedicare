import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, getTenant } from '../api';
import { currentUser } from '../auth/session';
import { useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
export function CommunicationPanel({ patientId, canWrite }: { patientId: string; canWrite: boolean }) {
  const { t, locale } = useI18n(),
    tenant = getTenant(),
    user = currentUser();
  const [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const notifications = useQuery({
    queryKey: ['communications', tenant, user?.id, patientId],
    enabled: !!tenant && !!user,
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await api.GET('/api/v1/patients/{id}/communications', {
        signal,
        params: { path: { id: patientId }, header: { 'X-Tenant-ID': tenant! } },
      });
      if (result.error || !result.data)
        throw new ApiError(result.response.status, result.error?.code ?? 'ERROR');
      return result.data.data;
    },
  });
  const preferences = useQuery({
    queryKey: ['communication-preferences', tenant, user?.id, patientId],
    enabled: !!tenant && !!user,
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await api.GET('/api/v1/patients/{id}/communication-preferences', {
        signal,
        params: { path: { id: patientId }, header: { 'X-Tenant-ID': tenant! } },
      });
      if (result.error || !result.data)
        throw new ApiError(result.response.status, result.error?.code ?? 'ERROR');
      return result.data.data;
    },
  });
  async function update(channel: 'email' | 'whatsapp' | 'sms', allow: boolean) {
    setBusy(true);
    setFailed(false);
    const previous = preferences.data?.find((item) => item.channel === channel);
    try {
      const result = await api.PUT('/api/v1/patients/{id}/communication-preferences', {
        params: { path: { id: patientId }, header: { 'X-Tenant-ID': tenant! } },
        body: {
          channel,
          preference: allow ? 'OPT_IN' : 'OPT_OUT',
          consentVersion: previous?.consentVersion ?? 1,
          contactId: previous?.contactId ?? null,
        },
      });
      if (result.error || !result.data)
        throw new ApiError(result.response.status, result.error?.code ?? 'ERROR');
      await preferences.refetch();
    } catch {
      setFailed(true);
      await preferences.refetch();
    } finally {
      setBusy(false);
    }
  }
  const error = notifications.error || preferences.error;
  return (
    <section className="card" data-testid="patient-communications" aria-label={t('communication.title')}>
      <div className="row">
        <h2>{t('communication.title')}</h2>
        <button
          disabled={notifications.isFetching || preferences.isFetching}
          onClick={() => {
            setFailed(false);
            void notifications.refetch();
            void preferences.refetch();
          }}
        >
          {t('timeline.refresh')}
        </button>
      </div>
      {(notifications.isPending || preferences.isPending) && <p>{t('common.loading')}</p>}
      {(error || failed) && (
        <p role="alert">
          {t(
            error instanceof ApiError && [401, 403, 404].includes(error.status)
              ? 'timeline.denied'
              : 'communication.failed',
          )}
        </p>
      )}
      {!error && preferences.data && (
        <fieldset disabled={busy || !canWrite}>
          <legend>{t('communication.preferences')}</legend>
          <p className="muted">{t('communication.consentRequired')}</p>
          {(['email', 'whatsapp', 'sms'] as const).map((channel) => {
            const preference = preferences.data.find((item) => item.channel === channel);
            return (
              <label key={channel} className="communication-channel">
                <input
                  type="checkbox"
                  checked={preference?.preference !== 'OPT_OUT'}
                  onChange={(e) => {
                    void update(channel, e.target.checked);
                  }}
                />
                {t(`communication.${channel}`)}
              </label>
            );
          })}
        </fieldset>
      )}
      {!error && !notifications.isPending && notifications.data?.length === 0 && (
        <p>{t('communication.empty')}</p>
      )}
      {!error && (
        <ol>
          {notifications.data?.map((item) => (
            <li key={item.id}>
              <time dateTime={item.createdAt}>
                {new Date(item.createdAt).toLocaleString(locale, { timeZone: 'Asia/Dhaka' })}
              </time>{' '}
              {t(`communication.${item.channel}` as MessageKey)}
              {' · '}
              {t(`communication.${item.status}` as MessageKey)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
