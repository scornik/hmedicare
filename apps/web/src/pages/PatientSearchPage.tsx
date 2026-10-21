import { type FormEvent, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { getTenant } from '../api';
import { TopBar } from '../components/TopBar';
import { useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
import {
  type PatientSummary,
  type SearchInput,
  classifySearch,
  usePatientSearchPages,
} from '../patients/api';

export function patientName(p: PatientSummary, locale: string): string {
  return locale === 'bn-BD' && p.legalNameBn ? p.legalNameBn : p.displayName;
}

export function PatientSearchPage() {
  const { t, locale } = useI18n();
  const tenant = getTenant();
  const [text, setText] = useState('');
  const [input, setInput] = useState<SearchInput | null>(null);
  const result = usePatientSearchPages(input);
  const patients = result.data?.pages.flatMap((page) => page.items) ?? [];

  if (!tenant) return <Navigate to="/select-tenant" replace />;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setInput(classifySearch(text));
  };

  return (
    <>
      <TopBar />
      <main className="card patient-search">
        <div className="row patient-search-header">
          <h1>{t('patients.title')}</h1>
          <Link to="/patients/new" role="button">
            {t('patients.new')}
          </Link>
        </div>
        <form onSubmit={onSubmit} role="search" className="patient-search-form">
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
        {!input && <p className="muted">{t('patients.searchHint')}</p>}
        {result.isPending && input && <p role="status">{t('common.loading')}</p>}
        {result.isError && patients.length === 0 && <p role="alert">{t('patients.searchFailed')}</p>}
        {result.data && patients.length === 0 && <p role="status">{t('patients.none')}</p>}
        {patients.length > 0 && (
          <section aria-label={t('patients.results')}>
            <h2 className="patient-results-title">{t('patients.results')}</h2>
            <ul className="patient-result-list" data-testid="patient-results">
              {patients.map((p) => (
                <li className="patient-result" key={p.id}>
                  <div>
                    <strong>{patientName(p, locale)}</strong>
                    <span className="muted">
                      {p.sex ? t(`patients.sex.${p.sex}` as MessageKey) : '—'}
                      {p.birthYear ? ` · ${p.birthYear}` : ''}
                    </span>
                  </div>
                  <div className="patient-result-meta">
                    <Link to={`/patients/${p.id}`}>{p.medicalRecordNumber}</Link>
                    <span>{p.phoneMasked ?? '—'}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
        {result.hasNextPage && (
          <button
            className="link"
            onClick={() => void result.fetchNextPage()}
            disabled={result.isFetchingNextPage}
          >
            {result.isFetchingNextPage ? t('common.loading') : t('common.more')}
          </button>
        )}
        {result.isFetchNextPageError && <p role="alert">{t('patients.moreFailed')}</p>}
      </main>
    </>
  );
}
