import { Link, useNavigate } from 'react-router';
import { getTenant, useTenantContext } from '../api';
import { currentUser, logout } from '../auth/session';
import { useI18n } from '../i18n/i18n';
import { LanguageToggle } from './LanguageToggle';

export function TopBar() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const user = currentUser();
  const tenant = getTenant();
  const ctx = useTenantContext(tenant);
  const can = (p: string) => ctx.data?.permissions.includes(p) ?? false;
  return (
    <nav className="topbar">
      <strong>{t('appName')}</strong>
      <span className="muted">{user?.displayName ?? user?.phoneMasked ?? ''}</span>
      {tenant && can('patient.read') && <Link to="/patients/search">{t('nav.patients')}</Link>}
      {tenant && can('patient.merge') && <Link to="/patients/merge-cases">{t('nav.mergeCases')}</Link>}
      <span className="spacer" />
      <button onClick={() => void navigate('/select-tenant')}>{t('nav.switchTenant')}</button>
      <LanguageToggle />
      <button
        onClick={() => {
          void logout().then(() => navigate('/login'));
        }}
      >
        {t('nav.logout')}
      </button>
    </nav>
  );
}
