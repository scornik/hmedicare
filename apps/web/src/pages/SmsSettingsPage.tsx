import { type FormEvent, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router';
import { api, ApiError, getTenant, useTenantContext } from '../api';
import { currentUser } from '../auth/session';
import { TopBar } from '../components/TopBar';
import { useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
function Settings({ tenant }: { tenant: string }) {
  const { t } = useI18n();
  const [apiKey, setApiKey] = useState(''),
    [senderId, setSenderId] = useState(''),
    [balanceAlertBdt, setAlert] = useState('100');
  const [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [notice, setNotice] = useState('');
  const accounts = useQuery({
    queryKey: ['sms-accounts', tenant, currentUser()?.id],
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await api.GET('/api/v1/tenant/sms-credentials', {
        signal,
        params: { header: { 'X-Tenant-ID': tenant } },
      });
      if (result.error || !result.data)
        throw new ApiError(result.response.status, result.error?.code ?? 'ERROR');
      return result.data.data;
    },
  });
  useEffect(() => {
    if (accounts.error) {
      setApiKey('');
      setNotice('');
    }
  }, [accounts.error]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setFailed(false);
    setNotice('');
    try {
      await action();
      await accounts.refetch();
    } catch {
      setFailed(true);
      await accounts.refetch();
    } finally {
      setBusy(false);
    }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    const key = apiKey;
    setApiKey('');
    await run(async () => {
      const result = await api.POST('/api/v1/tenant/sms-credentials', {
        params: { header: { 'X-Tenant-ID': tenant } },
        body: { apiKey: key, senderId, balanceAlertBdt },
      });
      if (result.error || !result.data) throw Error('create failed');
      setSenderId('');
      setNotice(t('sms.created'));
    });
  }
  return (
    <main className="card" data-testid="sms-settings">
      <div className="row">
        <h1>{t('sms.settings')}</h1>
        <button
          disabled={accounts.isFetching || busy}
          onClick={() => {
            void accounts.refetch();
          }}
        >
          {t('timeline.refresh')}
        </button>
      </div>
      <p>{t('sms.ownAccount')}</p>
      {(accounts.error || failed) && <p role="alert">{t('sms.failed')}</p>}
      {!accounts.error && notice && <p role="status">{notice}</p>}
      {accounts.isPending && <p>{t('common.loading')}</p>}
      {!accounts.error && accounts.data && (
        <>
          <form
            onSubmit={(e) => {
              void create(e);
            }}
            autoComplete="off"
          >
            <fieldset disabled={busy}>
              <legend>{t('sms.add')}</legend>
              <label>
                {t('sms.apiKey')}
                <input
                  type="password"
                  autoComplete="new-password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  minLength={8}
                  maxLength={256}
                  required
                />
              </label>
              <label>
                {t('sms.sender')}
                <input
                  value={senderId}
                  onChange={(e) => setSenderId(e.target.value)}
                  maxLength={11}
                  pattern="[A-Za-z0-9 _-]+"
                  required
                />
              </label>
              <label>
                {t('sms.threshold')}
                <input
                  inputMode="decimal"
                  value={balanceAlertBdt}
                  onChange={(e) => setAlert(e.target.value)}
                  pattern="[0-9]{1,10}(\.[0-9]{1,2})?"
                  required
                />
              </label>
              <button disabled={busy}>{t('sms.save')}</button>
            </fieldset>
          </form>
          {accounts.data.length === 0 && <p>{t('sms.platformDefault')}</p>}
          <ul>
            {accounts.data.map((account) => (
              <li key={account.id}>
                <strong>{account.publicIdentifier}</strong>
                {' · '}
                {t(`sms.${account.status}` as MessageKey)}
                {' · '}
                {t('sms.keyEnding')} {account.secretLast4}
                {account.status !== 'REVOKED' && account.status !== 'DISABLED' && (
                  <div className="row">
                    <button
                      disabled={busy}
                      onClick={() => {
                        void run(async () => {
                          const result = await api.POST('/api/v1/tenant/sms-credentials/{id}/validate', {
                            params: { path: { id: account.id }, header: { 'X-Tenant-ID': tenant } },
                            body: { rowVersion: account.rowVersion },
                          });
                          if (result.error || !result.data) throw Error('validate failed');
                          const balance = result.data.data.balance;
                          setNotice(
                            balance?.parseStatus === 'PARSED'
                              ? `${t('sms.balance')}: ${balance.balance} ${balance.currencyText ?? 'BDT'}`
                              : t('sms.balanceUnknown'),
                          );
                        });
                      }}
                    >
                      {t('sms.validate')}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => {
                        void run(async () => {
                          const result = await api.DELETE('/api/v1/tenant/sms-credentials/{id}', {
                            params: { path: { id: account.id }, header: { 'X-Tenant-ID': tenant } },
                          });
                          if (result.error || !result.data) throw Error('revoke failed');
                        });
                      }}
                    >
                      {t('sms.revoke')}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
export function SmsSettingsPage() {
  const tenant = getTenant(),
    context = useTenantContext(tenant);
  if (!tenant) return <Navigate to="/select-tenant" replace />;
  if (context.error || (context.data && !context.data.permissions.includes('sms.credentials.manage')))
    return <Navigate to="/forbidden" replace />;
  return (
    <>
      <TopBar />
      {context.data && <Settings key={`${tenant}:${currentUser()?.id}`} tenant={tenant} />}
    </>
  );
}
