import { useNavigate } from 'react-router';
import { setTenant, useMe } from '../api';
import { TopBar } from '../components/TopBar';
import { useI18n } from '../i18n/i18n';

export function TenantPickerPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const me = useMe();

  return (
    <>
      <TopBar />
      <main className="card narrow">
        <h1>{t('tenant.title')}</h1>
        {me.isPending && <p>{t('common.loading')}</p>}
        {me.data && me.data.memberships.length === 0 && <p>{t('tenant.none')}</p>}
        <ul className="list">
          {me.data?.memberships.map((m) => (
            <li key={m.membershipId}>
              <button
                onClick={() => {
                  setTenant(m.tenantId);
                  void navigate('/dashboard');
                }}
              >
                <strong>{m.tenantName}</strong> <span className="muted">{m.role}</span>
              </button>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
