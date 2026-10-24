import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ApiSchemas } from '@hmedic/contracts/client';
import { patientApi } from '../api';
import { currentUser, logout } from '../auth/session';
import { LanguageToggle } from '../components/LanguageToggle';
import { PatientLabReportsPanel } from '../documents/PatientLabReportsPanel';
import { useI18n } from '../i18n/i18n';
import { TimelinePanel } from '../timeline/TimelinePanel';

type Context = ApiSchemas['schemas']['PatientContext'];

export function PatientRecordsPage() {
  const { t } = useI18n();
  const [selected, setSelected] = useState<Context | null>(null);
  const contexts = useQuery({
    queryKey: ['record-patient-contexts', currentUser()?.id],
    gcTime: 0,
    staleTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await patientApi.GET('/api/v1/me/patient-contexts', { signal });
      if (result.error || !result.data) throw new Error('Patient contexts unavailable');
      return result.data.data.filter(
        (context) => context.relationship === 'SELF' || context.authorityScope.includes('VIEW_RECORDS'),
      );
    },
  });
  const current =
    selected &&
    contexts.data?.find(
      (context) => context.tenantId === selected.tenantId && context.patientId === selected.patientId,
    );
  return (
    <>
      <nav className="topbar">
        <strong>{t('appName')}</strong>
        <span className="spacer" />
        <LanguageToggle />
        <button onClick={() => void logout()}>{t('nav.logout')}</button>
      </nav>
      <main className="patient-records">
        <header className="dashboard-header">
          <h1>{t('records.title')}</h1>
        </header>
        {contexts.isPending && <p role="status">{t('common.loading')}</p>}
        {contexts.isError && <p role="alert">{t('link.contextFailed')}</p>}
        {contexts.data && !current && (
          <section className="card" aria-label={t('records.choose')}>
            <h2>{t('records.choose')}</h2>
            {contexts.data.length === 0 && <p>{t('records.none')}</p>}
            <ul className="list">
              {contexts.data.map((context) => (
                <li key={`${context.tenantId}:${context.patientId}`}>
                  <button type="button" onClick={() => setSelected(context)}>
                    <strong>{context.patientDisplayName}</strong> · {context.tenantName}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {current && (
          <>
            <div className="row">
              <p>
                <strong>{current.patientDisplayName}</strong> · {current.tenantName}
              </p>
              <button type="button" onClick={() => setSelected(null)}>
                {t('records.switch')}
              </button>
            </div>
            <PatientLabReportsPanel
              key={`${current.tenantId}:${current.patientId}`}
              tenantId={current.tenantId}
              patientId={current.patientId}
            />
            <TimelinePanel patientId={current.patientId} patientContext={{ tenantId: current.tenantId }} />
          </>
        )}
      </main>
    </>
  );
}
