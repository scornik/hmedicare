import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getTenant } from '../api';
import { useI18n } from '../i18n/i18n';
import { downloadDocument } from './download';

export function LabReportsPanel({ encounterId }: { encounterId: string }) {
  const { t } = useI18n();
  const tenant = getTenant();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [labName, setLabName] = useState('');
  const [reportDate, setReportDate] = useState('');
  const [analyte, setAnalyte] = useState('');
  const [valueKind, setValueKind] = useState<'numeric' | 'text'>('numeric');
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState('');
  const [referenceRange, setReferenceRange] = useState('');
  const [attested, setAttested] = useState(false);

  const documents = useQuery({
    queryKey: ['encounter-documents', tenant, encounterId, 1],
    queryFn: async () => {
      const result = await api.GET('/api/v1/documents/by-encounter/{encounterId}', {
        params: { header: { 'X-Tenant-ID': tenant ?? '' }, path: { encounterId }, query: { page: 1 } },
      });
      if (result.error || !result.data) throw new Error('Documents unavailable');
      return result.data.data;
    },
  });
  const reports = useQuery({
    queryKey: ['lab-reports', tenant, encounterId],
    queryFn: async () => {
      const result = await api.GET('/api/v1/lab-reports/by-encounter/{encounterId}', {
        params: { header: { 'X-Tenant-ID': tenant ?? '' }, path: { encounterId } },
      });
      if (result.error || !result.data) throw new Error('Lab reports unavailable');
      return result.data.data.items;
    },
  });
  const detail = useQuery({
    queryKey: ['lab-report', tenant, selectedId],
    enabled: selectedId !== null,
    queryFn: async () => {
      const result = await api.GET('/api/v1/lab-reports/{id}', {
        params: { header: { 'X-Tenant-ID': tenant ?? '' }, path: { id: selectedId! } },
      });
      if (result.error || !result.data) throw new Error('Lab report unavailable');
      return result.data.data;
    },
  });
  const available = (documents.data?.items ?? []).filter(
    (document) =>
      document.category === 'LAB_REPORT' &&
      !reports.data?.some((report) => report.documentId === document.id),
  );
  const create = useMutation({
    mutationFn: async (documentId: string) => {
      const result = await api.POST('/api/v1/lab-reports', {
        params: { header: { 'X-Tenant-ID': tenant ?? '', 'Idempotency-Key': crypto.randomUUID() } },
        body: { documentId, labName: labName.trim() || null, reportDate: reportDate || null },
      });
      if (result.error || !result.data) throw new Error('Create lab report failed');
      return result.data.data;
    },
    onSuccess: (report) => {
      setSelectedId(report.id);
      setLabName('');
      setReportDate('');
      void queryClient.invalidateQueries({ queryKey: ['lab-reports', tenant, encounterId] });
    },
  });
  const addResult = useMutation({
    mutationFn: async () => {
      if (!selectedId || !detail.data) throw new Error('Select a lab report');
      const result = await api.POST('/api/v1/lab-reports/{id}/results', {
        params: {
          header: { 'X-Tenant-ID': tenant ?? '', 'Idempotency-Key': crypto.randomUUID() },
          path: { id: selectedId },
        },
        body: {
          expectedRowVersion: detail.data.rowVersion,
          analyteDisplay: analyte.trim(),
          valueNumeric: valueKind === 'numeric' ? value.trim() : null,
          valueText: valueKind === 'text' ? value.trim() : null,
          unit: unit.trim() || null,
          referenceRange: referenceRange.trim() || null,
        },
      });
      if (result.error || !result.data) throw new Error('Record lab result failed');
    },
    onSuccess: () => {
      setAnalyte('');
      setValue('');
      setUnit('');
      setReferenceRange('');
      void queryClient.invalidateQueries({ queryKey: ['lab-report', tenant, selectedId] });
      void queryClient.invalidateQueries({ queryKey: ['lab-reports', tenant, encounterId] });
    },
  });
  const review = useMutation({
    mutationFn: async () => {
      if (!selectedId || !detail.data) throw new Error('Select a lab report');
      const result = await api.POST('/api/v1/lab-reports/{id}/review', {
        params: {
          header: { 'X-Tenant-ID': tenant ?? '', 'Idempotency-Key': crypto.randomUUID() },
          path: { id: selectedId },
        },
        body: { expectedRowVersion: detail.data.rowVersion, attestedSource: true },
      });
      if (result.error || !result.data) throw new Error('Review lab report failed');
    },
    onSuccess: () => {
      setAttested(false);
      void queryClient.invalidateQueries({ queryKey: ['lab-report', tenant, selectedId] });
      void queryClient.invalidateQueries({ queryKey: ['lab-reports', tenant, encounterId] });
    },
  });
  const source = useMutation({ mutationFn: downloadDocument });

  return (
    <section className="card lab-reports" aria-labelledby="lab-reports-heading" data-testid="panel-labs">
      <div className="row">
        <h2 id="lab-reports-heading">{t('workspace.panel.labs')}</h2>
        <button
          type="button"
          onClick={() => {
            void documents.refetch();
            void reports.refetch();
          }}
        >
          {t('documents.refresh')}
        </button>
      </div>
      <p className="muted">{t('labs.sourceNotice')}</p>
      {(documents.isPending || reports.isPending) && <p role="status">{t('common.loading')}</p>}
      {(documents.isError || reports.isError) && <p role="alert">{t('labs.loadFailed')}</p>}
      {available.length > 0 && (
        <div className="lab-report-create">
          <p>{t('labs.linkIntro')}</p>
          <label>
            {t('labs.name')}
            <input value={labName} maxLength={200} onChange={(event) => setLabName(event.target.value)} />
          </label>
          <label>
            {t('labs.date')}
            <input type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} />
          </label>
          <div className="lab-report-candidates">
            {available.map((document) => (
              <button
                key={document.id}
                type="button"
                disabled={create.isPending}
                onClick={() => create.mutate(document.id)}
              >
                {t('labs.link')}: {document.title || t('documents.category.lab')}
              </button>
            ))}
          </div>
        </div>
      )}
      {create.isError && <p role="alert">{t('labs.createFailed')}</p>}
      {reports.data?.length === 0 && <p className="muted">{t('labs.empty')}</p>}
      {reports.data && reports.data.length > 0 && (
        <div className="lab-report-list">
          {reports.data.map((report) => (
            <button
              type="button"
              key={report.id}
              aria-current={selectedId === report.id ? 'true' : undefined}
              onClick={() => {
                setSelectedId(report.id);
                setAttested(false);
              }}
            >
              <strong>{report.labName || t('documents.category.lab')}</strong>
              <span>
                {report.reportDate || ''} ·{' '}
                {t(report.reviewStatus === 'REVIEWED' ? 'labs.reviewed' : 'labs.unreviewed')}
              </span>
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
            <button type="button" onClick={() => source.mutate(detail.data.documentId)}>
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
          {detail.data.results.length === 0 && <p className="muted">{t('labs.noResults')}</p>}
          {detail.data.reviewStatus === 'UNREVIEWED' && (
            <>
              <form
                className="lab-result-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (analyte.trim() && value.trim()) addResult.mutate();
                }}
              >
                <label>
                  {t('labs.analyte')}
                  <input
                    value={analyte}
                    maxLength={200}
                    required
                    onChange={(event) => setAnalyte(event.target.value)}
                  />
                </label>
                <label>
                  {t('labs.valueType')}
                  <select
                    value={valueKind}
                    onChange={(event) => {
                      setValueKind(event.target.value as 'numeric' | 'text');
                      setValue('');
                    }}
                  >
                    <option value="numeric">{t('labs.numeric')}</option>
                    <option value="text">{t('labs.text')}</option>
                  </select>
                </label>
                <label>
                  {t('labs.value')}
                  <input
                    value={value}
                    required
                    inputMode={valueKind === 'numeric' ? 'decimal' : 'text'}
                    onChange={(event) => setValue(event.target.value)}
                  />
                </label>
                <label>
                  {t('labs.unit')}
                  <input value={unit} maxLength={40} onChange={(event) => setUnit(event.target.value)} />
                </label>
                <label>
                  {t('labs.reference')}
                  <input
                    value={referenceRange}
                    maxLength={120}
                    onChange={(event) => setReferenceRange(event.target.value)}
                  />
                </label>
                <button type="submit" disabled={addResult.isPending}>
                  {t('labs.addResult')}
                </button>
              </form>
              {addResult.isError && <p role="alert">{t('labs.saveFailed')}</p>}
              <label className="lab-review-attestation">
                <input
                  type="checkbox"
                  checked={attested}
                  onChange={(event) => setAttested(event.target.checked)}
                />
                {t('labs.attestSource')}
              </label>
              <button
                type="button"
                disabled={!attested || review.isPending || addResult.isPending || detail.isFetching}
                onClick={() => review.mutate()}
              >
                {t('labs.review')}
              </button>
              {review.isError && <p role="alert">{t('labs.reviewFailed')}</p>}
            </>
          )}
          {detail.data.reviewStatus === 'REVIEWED' && <p className="badge">{t('labs.reviewed')}</p>}
        </div>
      )}
    </section>
  );
}
