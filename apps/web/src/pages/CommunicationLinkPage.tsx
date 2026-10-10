import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import type { ApiSchemas } from '@hmedic/contracts/client';
import { ApiError, patientApi } from '../api';
import { currentUser, logout } from '../auth/session';
import { LanguageToggle } from '../components/LanguageToggle';
import { useI18n } from '../i18n/i18n';
import { TimelinePanel } from '../timeline/TimelinePanel';
import { NotFoundPage } from './ErrorPages';

type Context = ApiSchemas['schemas']['PatientContext'];
function Resolution({ token, context }: { token: string; context: Context }) {
  const { t } = useI18n();
  const result = useQuery({
    queryKey: ['communication-link', currentUser()?.id, token, context.tenantId, context.patientId],
    gcTime: 0,
    staleTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const r = await patientApi.GET('/api/v1/communication-links/{token}', {
        signal,
        params: {
          path: { token },
          header: {
            'X-Tenant-ID': context.tenantId,
            'X-Patient-Context': context.patientId,
          },
        },
      });
      if (r.error || !r.data) throw new ApiError(r.response.status, r.error?.code ?? 'ERROR');
      if (r.data.data.patientId !== context.patientId) throw new ApiError(403, 'FORBIDDEN');
      return r.data.data;
    },
  });
  return (
    <>
      <p>
        <strong>{context.patientDisplayName}</strong> · {context.tenantName}
      </p>
      <button
        disabled={result.isFetching}
        onClick={() => {
          void result.refetch();
        }}
      >
        {t('link.retry')}
      </button>
      {result.isPending && <p>{t('common.loading')}</p>}
      {result.error && <p role="alert">{t('link.failed')}</p>}
      {!result.error && result.data && (
        <TimelinePanel patientId={context.patientId} patientContext={{ tenantId: context.tenantId }} />
      )}
    </>
  );
}
function Landing({ token }: { token: string }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<Context | null>(null);
  const contexts = useQuery({
    queryKey: ['link-patient-contexts', currentUser()?.id],
    gcTime: 0,
    staleTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const r = await patientApi.GET('/api/v1/me/patient-contexts', { signal });
      if (r.error || !r.data) throw new ApiError(r.response.status, r.error?.code ?? 'ERROR');
      return r.data.data.filter(
        (c) => c.relationship === 'SELF' || c.authorityScope.includes('VIEW_RECORDS'),
      );
    },
  });
  // A refreshed context list can remove access while a timeline is displayed.
  const current =
    selected &&
    contexts.data?.find((c) => c.patientId === selected.patientId && c.tenantId === selected.tenantId);
  return (
    <>
      <nav className="topbar">
        <strong>{t('appName')}</strong>
        <span className="spacer" />
        <LanguageToggle />
        <button
          onClick={() => {
            void logout();
          }}
        >
          {t('nav.logout')}
        </button>
      </nav>
      <main className="card narrow" data-testid="communication-link">
        <h1>{t('link.title')}</h1>
        <button
          disabled={contexts.isFetching}
          onClick={() => {
            void contexts.refetch();
          }}
        >
          {t('link.refresh')}
        </button>
        {contexts.isPending && <p>{t('common.loading')}</p>}
        {contexts.error && <p role="alert">{t('link.contextFailed')}</p>}
        {!contexts.error &&
          contexts.data &&
          (current ? (
            <>
              <button onClick={() => setSelected(null)}>{t('link.other')}</button>
              <Resolution
                key={`${token}:${current.tenantId}:${current.patientId}`}
                token={token}
                context={current}
              />
            </>
          ) : (
            <>
              <p>{t('link.choose')}</p>
              {contexts.data.length === 0 && <p>{t('link.none')}</p>}
              <ul className="list">
                {contexts.data.map((c) => (
                  <li key={`${c.tenantId}:${c.patientId}`}>
                    <button onClick={() => setSelected(c)}>
                      <strong>{c.patientDisplayName}</strong> · {c.tenantName}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ))}
      </main>
    </>
  );
}
export function CommunicationLinkPage() {
  const { token } = useParams();
  if (!token || !/^[A-Za-z0-9]{22}$/.test(token)) return <NotFoundPage />;
  return <Landing key={`${currentUser()?.id}:${token}`} token={token} />;
}
