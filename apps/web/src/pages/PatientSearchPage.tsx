import { type FormEvent, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { getTenant } from '../api';
import { TopBar } from '../components/TopBar';
import { useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
import { type PatientSummary, type SearchInput, classifySearch, usePatientSearch } from '../patients/api';

export function patientName(p: PatientSummary, locale: string): string {
  return locale === 'bn-BD' && p.legalNameBn ? p.legalNameBn : p.displayName;
}

export function PatientSearchPage() {
  const { t, locale } = useI18n();
  const tenant = getTenant();
  const [text, setText] = useState('');
  const [input, setInput] = useState<SearchInput | null>(null);
  const result = usePatientSearch(input);

  if (!tenant) return <Navigate to="/select-tenant" replace />;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setInput(classifySearch(text));
  };

  return (
    <>
      <TopBar />
      <main className="card">
        <div className="row">
          <h1>{t('patients.title')}</h1>
          <Link to="/patients/new" role="button">
            {t('patients.new')}
          </Link>
        </div>
        <form onSubmit={onSubmit} role="search">
          <label>
            {t('patients.searchLabel')}
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('patients.searchPlaceholder')}
              autoComplete="off"
            />
          </label>
          <button type="submit" disabled={text.trim().length < 2}>
            {t('patients.search')}
          </button>
        </form>
        {result.isPending && input && <p>{t('common.loading')}</p>}
        {result.error && <p role="alert">{t('patients.searchFailed')}</p>}
        {result.data && result.data.items.length === 0 && <p>{t('patients.none')}</p>}
        {result.data && result.data.items.length > 0 && (
          <table className="table" data-testid="patient-results">
            <thead>
              <tr>
                <th>{t('patients.mrn')}</th>
                <th>{t('patients.name')}</th>
                <th>{t('patients.sexAge')}</th>
                <th>{t('patients.phone')}</th>
              </tr>
            </thead>
            <tbody>
              {result.data.items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/patients/${p.id}`}>{p.medicalRecordNumber}</Link>
                  </td>
                  <td>{patientName(p, locale)}</td>
                  <td>
                    {p.sex ? t(`patients.sex.${p.sex}` as MessageKey) : '—'}
                    {p.birthYear ? ` · ${p.birthYear}` : ''}
                  </td>
                  <td>{p.phoneMasked ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {result.data?.hasMore && result.data.nextCursor && (
          <button className="link" onClick={() => setInput({ ...input, cursor: result.data.nextCursor! })}>
            {t('common.more')}
          </button>
        )}
      </main>
    </>
  );
}
