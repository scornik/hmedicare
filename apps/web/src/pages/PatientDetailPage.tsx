import { type FormEvent, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { ApiError, getTenant, useTenantContext } from '../api';
import { TopBar } from '../components/TopBar';
import { useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
import { newIdempotencyKey, useOpenMergeCase, usePatient, usePatientSearch } from '../patients/api';

/** Patient record (operational minimum: masked contacts) and, with `patient.merge`, a merge-case opener. */
export function PatientDetailPage() {
  const { t, locale } = useI18n();
  const { patientId = null } = useParams();
  const tenant = getTenant();
  const ctx = useTenantContext(tenant);
  const patient = usePatient(patientId);

  if (!tenant) return <Navigate to="/select-tenant" replace />;
  if (patient.error instanceof ApiError && patient.error.status === 404)
    return <Navigate to="/404" replace />;
  const p = patient.data;
  const canMerge = ctx.data?.permissions.includes('patient.merge') ?? false;

  return (
    <>
      <TopBar />
      <main className="card">
        {patient.isPending && <p>{t('common.loading')}</p>}
        {patient.error && !(patient.error instanceof ApiError) && (
          <p role="alert">{t('patients.loadFailed')}</p>
        )}
        {p && (
          <>
            <div className="row">
              <h1 data-testid="patient-name">
                {locale === 'bn-BD' && p.legalNameBn ? p.legalNameBn : p.legalName}
              </h1>
              <span className="badge" data-testid="patient-status">
                {t(`patients.status.${p.status}` as MessageKey)}
              </span>
            </div>
            {p.status === 'MERGED' && p.mergedIntoPatientId && (
              <p className="notice">
                {t('patients.mergedInto')}{' '}
                <Link to={`/patients/${p.mergedIntoPatientId}`}>{t('patients.open')}</Link>
              </p>
            )}
            <dl>
              <dt>{t('patients.mrn')}</dt>
              <dd data-testid="patient-mrn">{p.medicalRecordNumber}</dd>
              <dt>{t('patients.legalName')}</dt>
              <dd>
                {p.legalName}
                {p.legalNameBn ? ` / ${p.legalNameBn}` : ''}
              </dd>
              <dt>{t('patients.sex')}</dt>
              <dd>{p.sex ? t(`patients.sex.${p.sex}` as MessageKey) : '—'}</dd>
              <dt>{t('patients.dateOfBirth')}</dt>
              <dd>{p.dateOfBirth ?? p.birthYear ?? '—'}</dd>
              <dt>{t('patients.contacts')}</dt>
              <dd>
                <ul className="plain">
                  {p.contacts.map((c) => (
                    <li key={c.id}>
                      {c.displayValue}{' '}
                      <span className="muted">
                        {t(`patients.contactType.${c.type}` as MessageKey)}
                        {c.isPreferred ? ` · ${t('patients.preferred')}` : ''}
                        {c.verificationStatus === 'VERIFIED' ? ` · ${t('patients.verified')}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </dd>
            </dl>
            {canMerge && p.status === 'ACTIVE' && <MergeOpener sourcePatientId={p.id} />}
          </>
        )}
      </main>
    </>
  );
}

function MergeOpener({ sourcePatientId }: { sourcePatientId: string }) {
  const { t, locale } = useI18n();
  const [mrn, setMrn] = useState('');
  const [lookup, setLookup] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [opened, setOpened] = useState<string | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const target = usePatientSearch(lookup ? { mrn: lookup } : null);
  const open = useOpenMergeCase();
  const candidate = target.data?.items.find((i) => i.id !== sourcePatientId) ?? null;

  const onOpen = (e: FormEvent) => {
    e.preventDefault();
    if (!candidate) return;
    setError(null);
    open.mutate(
      {
        sourcePatientId,
        targetPatientId: candidate.id,
        reason: reason.trim(),
        idempotencyKey: newIdempotencyKey(),
      },
      {
        onSuccess: (c) => setOpened(c.id),
        onError: (err) =>
          setError(
            err instanceof ApiError && err.code === 'MERGE_CASE_EXISTS' ? 'merge.exists' : 'merge.openFailed',
          ),
      },
    );
  };

  return (
    <section className="subcard" data-testid="merge-opener">
      <h2>{t('merge.openTitle')}</h2>
      <p className="muted">{t('merge.openHelp')}</p>
      <form onSubmit={onOpen}>
        <label>
          {t('merge.targetMrn')}
          <input
            value={mrn}
            onChange={(e) => setMrn(e.target.value)}
            onBlur={() => setLookup(mrn.trim() || null)}
          />
        </label>
        {lookup && target.data && !candidate && <p role="alert">{t('merge.targetNotFound')}</p>}
        {candidate && (
          <p data-testid="merge-target">
            {candidate.medicalRecordNumber} ·{' '}
            {locale === 'bn-BD' && candidate.legalNameBn ? candidate.legalNameBn : candidate.displayName}
          </p>
        )}
        <label>
          {t('merge.reason')}
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {error && <p role="alert">{t(error)}</p>}
        {opened ? (
          <p role="status">
            {t('merge.opened')} <Link to="/patients/merge-cases">{t('merge.reviewLink')}</Link>
          </p>
        ) : (
          <button type="submit" disabled={!candidate || reason.trim().length < 3 || open.isPending}>
            {t('merge.open')}
          </button>
        )}
      </form>
    </section>
  );
}
