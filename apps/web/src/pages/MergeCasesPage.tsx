import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { ApiError, getTenant, useTenantContext } from '../api';
import { TopBar } from '../components/TopBar';
import { useI18n } from '../i18n/i18n';
import {
  type MergeCase,
  newIdempotencyKey,
  useMergeCases,
  usePatient,
  useReviewMergeCase,
} from '../patients/api';

/**
 * Open merge cases for reviewers with `patient.merge` (API §3.4, audit C-47). Approve runs the merge
 * server-side; a STALE_VERSION answer shows a reload prompt instead of retrying blindly (WEB §5).
 */
export function MergeCasesPage() {
  const { t } = useI18n();
  const tenant = getTenant();
  const ctx = useTenantContext(tenant);
  const cases = useMergeCases();

  if (!tenant) return <Navigate to="/select-tenant" replace />;
  if (ctx.data && !ctx.data.permissions.includes('patient.merge'))
    return <Navigate to="/forbidden" replace />;
  if (cases.error instanceof ApiError && cases.error.status === 403)
    return <Navigate to="/forbidden" replace />;

  return (
    <>
      <TopBar />
      <main className="card">
        <h1>{t('merge.title')}</h1>
        {cases.isPending && <p>{t('common.loading')}</p>}
        {cases.data && cases.data.items.length === 0 && <p>{t('merge.none')}</p>}
        <ul className="list" data-testid="merge-cases">
          {cases.data?.items.map((c) => (
            <MergeCaseRow key={c.id} item={c} onChanged={() => void cases.refetch()} />
          ))}
        </ul>
      </main>
    </>
  );
}

function Name({ id }: { id: string }) {
  const { locale } = useI18n();
  const p = usePatient(id);
  if (!p.data) return <span className="muted">{id.slice(-8)}</span>;
  return (
    <Link to={`/patients/${id}`}>
      {p.data.medicalRecordNumber} ·{' '}
      {locale === 'bn-BD' && p.data.legalNameBn ? p.data.legalNameBn : p.data.legalName}
    </Link>
  );
}

function MergeCaseRow({ item, onChanged }: { item: MergeCase; onChanged: () => void }) {
  const { t } = useI18n();
  const review = useReviewMergeCase();
  const [stale, setStale] = useState(false);
  const [failed, setFailed] = useState(false);
  const decide = (decision: 'approve' | 'reject') => {
    setStale(false);
    setFailed(false);
    review.mutate(
      { id: item.id, decision, expectedRowVersion: item.rowVersion, idempotencyKey: newIdempotencyKey() },
      {
        onSuccess: onChanged,
        onError: (err) => {
          if (err instanceof ApiError && err.code === 'STALE_VERSION') setStale(true);
          else setFailed(true);
        },
      },
    );
  };
  return (
    <li className="subcard">
      <div>
        <div>
          <span className="muted">{t('merge.source')}</span> <Name id={item.sourcePatientId} />
        </div>
        <div>
          <span className="muted">{t('merge.target')}</span> <Name id={item.targetPatientId} />
        </div>
        <div className="muted">
          {item.reason}
          {item.duplicateScore !== null ? ` · ${Math.round(item.duplicateScore * 100)}%` : ''}
        </div>
      </div>
      <div className="row">
        <button onClick={() => decide('approve')} disabled={review.isPending}>
          {t('merge.approve')}
        </button>
        <button className="link" onClick={() => decide('reject')} disabled={review.isPending}>
          {t('merge.reject')}
        </button>
      </div>
      {stale && (
        <p role="alert">
          {t('common.stale')}{' '}
          <button className="link" onClick={onChanged}>
            {t('common.reload')}
          </button>
        </p>
      )}
      {failed && <p role="alert">{t('merge.reviewFailed')}</p>}
    </li>
  );
}
