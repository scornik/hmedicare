import { type FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { ApiError, getTenant } from '../api';
import { TopBar } from '../components/TopBar';
import { useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
import {
  type CreatePatientRequest,
  type DuplicateCandidate,
  newIdempotencyKey,
  useCreatePatient,
  useDuplicateCheck,
} from '../patients/api';
import { patientName } from './PatientSearchPage';

const SEXES = ['FEMALE', 'MALE', 'INTERSEX', 'UNKNOWN'] as const;
const CONSENTS = ['care', 'sms', 'ai_assistance'] as const;

/**
 * Patient create with duplicate review (API §3.4, DATABASE §4.4). A duplicate check runs when the name or
 * phone loses focus; a 409 DUPLICATE_PATIENT_REVIEW_REQUIRED shows the candidates and asks the staff member
 * to confirm (with a reason) that they are different people before the create is retried with
 * `duplicateReview`. Each submit intent gets its own Idempotency-Key (the body changes between attempts).
 */
export function PatientCreatePage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const tenant = getTenant();
  const create = useCreatePatient();
  const check = useDuplicateCheck();
  const [legalName, setLegalName] = useState('');
  const [legalNameBn, setLegalNameBn] = useState('');
  const [sex, setSex] = useState<(typeof SEXES)[number] | ''>('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [phone, setPhone] = useState('');
  const [consents, setConsents] = useState<Set<string>>(new Set(['care']));
  const [candidates, setCandidates] = useState<DuplicateCandidate[]>([]);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [reviewReason, setReviewReason] = useState('');
  const [error, setError] = useState<MessageKey | null>(null);

  if (!tenant) return <Navigate to="/select-tenant" replace />;

  const body = (): CreatePatientRequest => ({
    legalName: legalName.trim(),
    ...(legalNameBn.trim() ? { legalNameBn: legalNameBn.trim().normalize('NFC') } : {}),
    ...(sex ? { sex } : {}),
    ...(dateOfBirth ? { dateOfBirth } : birthYear ? { birthYear: Number(birthYear) } : {}),
    contacts: [{ type: 'PHONE', value: phone.trim(), relationship: 'SELF', isPreferred: true }],
    consents: [...consents] as CreatePatientRequest['consents'],
  });

  const runCheck = () => {
    if (legalName.trim().length < 2 || phone.trim().length < 6) return;
    check.mutate(
      {
        legalName: legalName.trim(),
        ...(legalNameBn.trim() ? { legalNameBn: legalNameBn.trim() } : {}),
        phones: [phone.trim()],
        ...(dateOfBirth ? { dateOfBirth } : birthYear ? { birthYear: Number(birthYear) } : {}),
      },
      {
        onSuccess: (r) => {
          setCandidates(r.candidates);
          setReviewRequired(r.reviewRequired);
        },
      },
    );
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const req = body();
    if (reviewRequired && acknowledged) {
      req.duplicateReview = {
        acknowledgedCandidateIds: candidates.map((c) => c.patient.id),
        reason: reviewReason.trim(),
      };
    }
    create.mutate(
      { body: req, idempotencyKey: newIdempotencyKey() },
      {
        onSuccess: (p) => void navigate(`/patients/${p.id}`),
        onError: (err) => {
          if (err instanceof ApiError && err.code === 'DUPLICATE_PATIENT_REVIEW_REQUIRED') {
            setReviewRequired(true);
            const ids = String(err.details?.candidateIds ?? '').split(',');
            if (!candidates.some((c) => ids.includes(c.patient.id))) runCheck();
            return;
          }
          setError(
            err instanceof ApiError && err.status === 400 ? 'patients.invalid' : 'patients.createFailed',
          );
        },
      },
    );
  };

  const toggleConsent = (purpose: string) =>
    setConsents((s) => {
      const next = new Set(s);
      if (next.has(purpose)) next.delete(purpose);
      else next.add(purpose);
      return next;
    });

  return (
    <>
      <TopBar />
      <main className="card narrow">
        <h1>{t('patients.newTitle')}</h1>
        <form onSubmit={onSubmit}>
          <label>
            {t('patients.legalName')}
            <input
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              onBlur={runCheck}
              required
            />
          </label>
          <label>
            {t('patients.legalNameBn')}
            <input value={legalNameBn} onChange={(e) => setLegalNameBn(e.target.value)} lang="bn" />
          </label>
          <label>
            {t('patients.phone')}
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={runCheck}
              inputMode="tel"
              required
            />
          </label>
          <label>
            {t('patients.sex')}
            <select value={sex} onChange={(e) => setSex(e.target.value as typeof sex)}>
              <option value="">—</option>
              {SEXES.map((s) => (
                <option key={s} value={s}>
                  {t(`patients.sex.${s}` as MessageKey)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('patients.dateOfBirth')}
            <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
          </label>
          <label>
            {t('patients.birthYear')}
            <input
              inputMode="numeric"
              value={birthYear}
              onChange={(e) => setBirthYear(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
              disabled={dateOfBirth !== ''}
            />
          </label>
          <fieldset>
            <legend>{t('patients.consents')}</legend>
            {CONSENTS.map((c) => (
              <label key={c} className="inline">
                <input type="checkbox" checked={consents.has(c)} onChange={() => toggleConsent(c)} />
                {t(`patients.consent.${c}` as MessageKey)}
              </label>
            ))}
          </fieldset>

          {candidates.length > 0 && (
            <section className="notice" data-testid="duplicate-candidates" aria-live="polite">
              <strong>{t(reviewRequired ? 'patients.dupReview' : 'patients.dupWarn')}</strong>
              <ul className="list">
                {candidates.map((c) => (
                  <li key={c.patient.id}>
                    <span>
                      {c.patient.medicalRecordNumber} · {patientName(c.patient, locale)}
                      {c.patient.birthYear ? ` · ${c.patient.birthYear}` : ''} ·{' '}
                      {c.patient.phoneMasked ?? '—'}
                    </span>
                    <span className="muted">
                      {Math.round(c.score * 100)}% ·{' '}
                      {c.reasons.map((r) => t(`patients.dupReason.${r}` as MessageKey)).join(', ')}
                    </span>
                  </li>
                ))}
              </ul>
              {reviewRequired && (
                <>
                  <label className="inline">
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      onChange={(e) => setAcknowledged(e.target.checked)}
                    />
                    {t('patients.dupAcknowledge')}
                  </label>
                  <label>
                    {t('patients.dupReasonLabel')}
                    <input value={reviewReason} onChange={(e) => setReviewReason(e.target.value)} />
                  </label>
                </>
              )}
            </section>
          )}
          {error && <p role="alert">{t(error)}</p>}
          <button
            type="submit"
            disabled={
              create.isPending || (reviewRequired && (!acknowledged || reviewReason.trim().length < 3))
            }
          >
            {t('patients.create')}
          </button>
        </form>
      </main>
    </>
  );
}
