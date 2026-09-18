import { Navigate } from 'react-router';
import { ApiError, getTenant, useTenantContext } from '../api';
import { TopBar } from '../components/TopBar';
import { useI18n } from '../i18n/i18n';

export function DashboardPage() {
  const { t } = useI18n();
  const tenant = getTenant();
  const ctx = useTenantContext(tenant);

  if (!tenant) return <Navigate to="/select-tenant" replace />;
  if (ctx.error instanceof ApiError && ctx.error.status === 403) return <Navigate to="/forbidden" replace />;

  return (
    <>
      <TopBar />
      <main className="card">
        <h1>{t('dashboard.title')}</h1>
        {ctx.isPending && <p>{t('common.loading')}</p>}
        {ctx.data && (
          <dl>
            <dt>{t('dashboard.role')}</dt>
            <dd data-testid="role">{ctx.data.role}</dd>
            <dt>{t('dashboard.permissions')}</dt>
            <dd data-testid="permission-count">{ctx.data.permissions.length}</dd>
          </dl>
        )}
      </main>
    </>
  );
}
