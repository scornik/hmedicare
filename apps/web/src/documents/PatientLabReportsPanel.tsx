import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { patientApi } from '../api';
import { currentUser } from '../auth/session';
import { useI18n } from '../i18n/i18n';
import { downloadDocument } from './download';

export function PatientLabReportsPanel({ tenantId, patientId }: { tenantId: string; patientId: string }) {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const headers = { 'X-Tenant-ID': tenantId, 'X-Patient-Context': patientId };
  const reports = useQuery({
    queryKey: ['patient-lab-reports', currentUser()?.id, tenantId, patientId],
    gcTime: 0,
    staleTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await patientApi.GET('/api/v1/lab-reports/patient/mine', {
        signal,
        params: { header: headers },
      });
      if (result.error || !result.data) throw new Error('Lab reports unavailable');
      return result.data.data.items;
    },
  });
  const detail = useQuery({
    queryKey: ['patient-lab-report', currentUser()?.id, tenantId, patientId, selectedId],
    enabled: selectedId !== null,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await patientApi.GET('/api/v1/lab-reports/patient/mine/{id}', {
        signal,
        params: { header: headers, path: { id: selectedId! } },
      });
      if (result.error || !result.data) throw new Error('Lab report unavailable');
      return result.data.data;
    },
  });
  const source = useMutation({
    mutationFn: (documentId: string) => downloadDocument(documentId, { tenantId, patientId }),
  });
  return (
    <section className="card lab-reports" aria-label={t('labs.patientTitle')} data-testid="patient-labs">
      <div className="row">
        <h2>{t('labs.patientTitle')}</h2>
        <button type="button" disabled={reports.isFetching} onClick={() => void reports.refetch()}>
          {t('documents.refresh')}
        </button>
      </div>
      {reports.isPending && <p role="status">{t('common.loading')}</p>}
      {reports.isError && <p role="alert">{t('labs.loadFailed')}</p>}
      {reports.data?.length === 0 && <p>{t('labs.patientEmpty')}</p>}
      {reports.data && reports.data.length > 0 && (
        <div className="lab-report-list">
          {reports.data.map((report) => (
            <button
              type="button"
              key={report.id}
              aria-current={selectedId === report.id ? 'true' : undefined}
              onClick={() => setSelectedId(report.id)}
            >
              <strong>{report.labName || t('documents.category.lab')}</strong>
              <span>{report.reportDate ?? ''}</span>
            </button>
          ))}
        </div>
      )}
      {detail.isPending && selectedId && <p role="status">{t('common.loading')}</p>}
      {detail.isError && <p role="alert">{t('labs.loadFailed')}</p>}
      {detail.data && (
        <div className="lab-report-detail">
          <div className="row">
            <h3>{detail.data.labName || t('documents.category.lab')}</h3>
            <button
              type="button"
              disabled={source.isPending}
              onClick={() => source.mutate(detail.data.documentId)}
            >
              {t('labs.openSource')}
            </button>
          </div>
          {source.isError && <p role="alert">{t('documents.downloadFailed')}</p>}
          <ul>
            {detail.data.results.map((result) => (
              <li key={result.id}>
                <strong>{result.analyteDisplay}</strong> — {result.valueNumeric ?? result.valueText}{' '}
                {result.unit ?? ''}
                {result.referenceRange && (
                  <span className="muted">
                    {' '}
                    · {t('labs.reference')}: {result.referenceRange}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {detail.data.results.length === 0 && <p>{t('labs.noResults')}</p>}
        </div>
      )}
    </section>
  );
}
