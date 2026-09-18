import { useNavigate } from 'react-router';
import { currentUser, logout } from '../auth/session';
import { useI18n } from '../i18n/i18n';
import { LanguageToggle } from './LanguageToggle';

export function TopBar() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const user = currentUser();
  return (
    <nav className="topbar">
      <strong>{t('appName')}</strong>
      <span className="muted">{user?.displayName ?? user?.phoneMasked ?? ''}</span>
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
