import { Link, Navigate } from 'react-router';
import { ApiError, getTenant, useTenantContext } from '../api';
import { TopBar } from '../components/TopBar';
import { useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
import { useChamberDays } from '../queue/api';

/** Clinic-local date (Asia/Dhaka, UTC+6, no DST). Chamber days are keyed by it, never by UTC. */
function todayLocal(): string {
  const now = new Date(Date.now() + 6 * 3600_000);
  return now.toISOString().slice(0, 10);
}

/**
 * The chamber days running today, as the way into the queue board. The board itself is addressed by chamber
 * day id; without this a receptionist would have to paste a URL.
 */
function TodaysQueues() {
  const { t } = useI18n();
  const today = todayLocal();
  const days = useChamberDays({ from: today, to: today });
  if (days.isPending) return <p>{t('common.loading')}</p>;
  const open = (days.data ?? []).filter((d) => d.status === 'OPEN' || d.status === 'PAUSED');
  if (open.length === 0) return <p>{t('queue.noneToday')}</p>;
  return (
    <ul className="list" data-testid="todays-queues">
      {open.map((d) => (
        <li key={d.id}>
          <Link to={`/queue/${d.id}`}>
            {d.localStartTime}–{d.localEndTime} · {t(`queue.day.${d.status}` as MessageKey)}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function DashboardPage() {
  const { t, locale } = useI18n();
  const tenant = getTenant();
  const ctx = useTenantContext(tenant);
  const hasQuickAction =
    ctx.data?.permissions.some((permission) =>
      ['patient.read', 'sms.credentials.manage', 'ai.use', 'ai.policy.read'].includes(permission),
    ) ?? false;

  if (!tenant) return <Navigate to="/select-tenant" replace />;
  if (ctx.error instanceof ApiError && ctx.error.status === 403) return <Navigate to="/forbidden" replace />;

  return (
    <>
      <TopBar />
      <main className="dashboard">
        <header className="dashboard-header">
          <h1>{t('dashboard.title')}</h1>
          <p>{t('dashboard.intro')}</p>
        </header>
        {ctx.isPending && <p>{t('common.loading')}</p>}
        <div className="dashboard-grid">
          {ctx.data?.permissions.includes('queue.read') && (
            <section className="card">
              <h2>{t('queue.title')}</h2>
              <TodaysQueues />
            </section>
          )}
          <section className="card">
            <h2>{t('dashboard.quickActions')}</h2>
            <nav className="dashboard-actions" aria-label={t('dashboard.quickActions')}>
              {ctx.data && !hasQuickAction && <p className="muted">{t('dashboard.noActions')}</p>}
              {ctx.data?.permissions.includes('patient.read') && (
                <Link to="/patients/search">{t('dashboard.findPatient')}</Link>
              )}
              {ctx.data?.permissions.includes('sms.credentials.manage') && (
                <Link to="/settings/sms">{t('sms.settings')}</Link>
              )}
              {ctx.data?.permissions.includes('ai.use') && (
                <Link to="/settings/ai/accounts">
                  {locale === 'bn-BD' ? 'আমার এআই অ্যাকাউন্ট' : 'My AI accounts'}
                </Link>
              )}
              {ctx.data?.permissions.includes('ai.policy.read') && (
                <Link to="/settings/ai">{locale === 'bn-BD' ? 'এআই সেটিংস' : 'AI settings'}</Link>
              )}
            </nav>
            {ctx.data && (
              <details className="dashboard-details">
                <summary>{t('dashboard.accountDetails')}</summary>
                <dl>
                  <dt>{t('dashboard.role')}</dt>
                  <dd data-testid="role">{ctx.data.role}</dd>
                  <dt>{t('dashboard.permissions')}</dt>
                  <dd data-testid="permission-count">{ctx.data.permissions.length}</dd>
                </dl>
              </details>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
