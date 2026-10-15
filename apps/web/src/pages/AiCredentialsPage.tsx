import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router';
import { getTenant, useTenantContext } from '../api';
import { aiApi } from '../ai/api';
import { currentUser } from '../auth/session';
import { TopBar } from '../components/TopBar';
import { useI18n } from '../i18n/i18n';

function Credentials({ tenant }: { tenant: string }) {
  const { locale } = useI18n();
  const say = (en: string, bn: string) => (locale === 'bn-BD' ? bn : en);
  const audience = [tenant, currentUser()?.id];
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const own = useQuery({
    queryKey: ['ai-credential-settings', ...audience],
    queryFn: aiApi.myCredentials,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const policy = useQuery({
    queryKey: ['ai-credential-policy', ...audience],
    queryFn: aiApi.policy,
    retry: false,
    gcTime: 0,
  });
  const texts = useQuery({
    queryKey: ['ai-acknowledgement-texts', ...audience],
    queryFn: aiApi.acknowledgementTexts,
    retry: false,
    gcTime: 0,
  });
  const [provider, setProvider] = useState('');
  const [tier, setTier] = useState<'FREE' | 'PAID'>('PAID');
  const [secret, setSecret] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const failed = own.isError || policy.isError || texts.isError;
  const text = texts.data?.items.find((t) => t.locale === locale && t.tier === tier);
  useEffect(() => {
    setAgree(false);
    setSecret('');
  }, [provider, tier, locale, text?.version, text?.sha256]);
  useEffect(() => {
    if (failed) {
      setSecret('');
      setAgree(false);
    }
  }, [failed]);
  async function refresh() {
    setSecret('');
    setAgree(false);
    setBusy(true);
    try {
      const results = await Promise.all([own.refetch(), policy.refetch(), texts.refetch()]);
      if (results.every((r) => !r.isError)) {
        setUncertain(false);
        setNotice('');
      }
    } finally {
      setBusy(false);
    }
  }
  async function write(action: () => Promise<unknown>) {
    if (busy || uncertain || !own.data || failed) return;
    setBusy(true);
    setNotice('');
    try {
      await action();
      setNotice(
        say(
          'Account updated. Refresh to check its latest validation status.',
          'অ্যাকাউন্ট আপডেট হয়েছে। যাচাইয়ের সর্বশেষ অবস্থা দেখতে রিফ্রেশ করুন।',
        ),
      );
      const result = await own.refetch();
      if (result.isError) setUncertain(true);
    } catch {
      setUncertain(true);
      setNotice(
        say(
          'The update could not be confirmed. Refresh before trying another change. Your key has been cleared.',
          'আপডেট নিশ্চিত করা যায়নি। আরেকটি পরিবর্তনের আগে রিফ্রেশ করুন। আপনার কী মুছে ফেলা হয়েছে।',
        ),
      );
    } finally {
      setSecret('');
      setAgree(false);
      setBusy(false);
    }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (!own.data || !text || !agree || !provider || !policy.data?.allowedProviderCodes.includes(provider))
      return;
    const key = secret;
    setSecret('');
    await write(async () => {
      const acknowledgement = await aiApi.acknowledge({
        doctorProfileId: own.data!.doctorProfileId,
        providerCode: provider,
        tier,
        locale,
        termsTextVersion: text.version,
      });
      if (!mounted.current || getTenant() !== tenant || currentUser()?.id !== audience[1]) return;
      await aiApi.createCredential(own.data!.doctorProfileId, {
        providerCode: provider,
        declaredTier: tier,
        billingMode: tier === 'FREE' ? 'DOCTOR_BYOK_FREE' : 'DOCTOR_BYOK_PAID',
        secret: key,
        dataUseAckId: acknowledgement.id,
      });
    });
  }
  return (
    <main className="card ai-panel" data-testid="ai-credential-settings">
      <h1>{say('My AI accounts', 'আমার এআই অ্যাকাউন্ট')}</h1>
      <p>
        {say(
          'Use your own provider account. A saved key is encrypted and only its last four characters are shown later.',
          'নিজের প্রোভাইডার অ্যাকাউন্ট ব্যবহার করুন। সংরক্ষিত কী এনক্রিপ্ট করা হয় এবং পরে শুধু শেষ চারটি অক্ষর দেখানো হয়।',
        )}
      </p>
      <button
        disabled={busy}
        onClick={() => {
          void refresh();
        }}
      >
        {say('Refresh accounts', 'অ্যাকাউন্ট রিফ্রেশ করুন')}
      </button>
      {notice && <p role="status">{notice}</p>}
      {failed ? (
        <p role="alert">
          {say(
            'Current account settings could not be loaded. Refresh to try again.',
            'বর্তমান অ্যাকাউন্ট সেটিংস লোড করা যায়নি। আবার রিফ্রেশ করুন।',
          )}
        </p>
      ) : own.data && policy.data && texts.data ? (
        <>
          {!policy.data.aiEnabled && (
            <p>
              {say(
                'AI assistance is currently off for this clinic. You can prepare your account; a clinic owner controls access.',
                'এই ক্লিনিকে এআই সহায়তা বর্তমানে বন্ধ। আপনি অ্যাকাউন্ট প্রস্তুত রাখতে পারেন; ক্লিনিকের মালিক ব্যবহার নিয়ন্ত্রণ করেন।',
              )}
            </p>
          )}
          <form
            autoComplete="off"
            onSubmit={(e) => {
              void create(e);
            }}
          >
            <fieldset disabled={busy || uncertain}>
              <legend>{say('Add provider account', 'প্রোভাইডার অ্যাকাউন্ট যোগ করুন')}</legend>
              <label>
                {say('Provider', 'প্রোভাইডার')}
                <select required value={provider} onChange={(e) => setProvider(e.target.value)}>
                  <option value="">{say('Choose a provider', 'প্রোভাইডার বেছে নিন')}</option>
                  {policy.data.allowedProviderCodes.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
              {!policy.data.allowedProviderCodes.length && (
                <p>
                  {say(
                    'Ask the clinic owner to allow a provider in AI settings first.',
                    'আগে ক্লিনিকের মালিককে এআই সেটিংসে একটি প্রোভাইডার অনুমোদন করতে বলুন।',
                  )}
                </p>
              )}
              <label>
                {say('Account tier', 'অ্যাকাউন্টের স্তর')}
                <select value={tier} onChange={(e) => setTier(e.target.value as 'FREE' | 'PAID')}>
                  <option value="PAID">{say('Paid', 'পেইড')}</option>
                  <option value="FREE">{say('Free', 'বিনামূল্যে')}</option>
                </select>
              </label>
              {tier === 'FREE' && !policy.data.freeTierEffective && (
                <p>
                  {say(
                    'Free-tier use is currently blocked. Saving an account does not enable its use.',
                    'বিনামূল্যের স্তর ব্যবহার বর্তমানে বন্ধ। অ্যাকাউন্ট সংরক্ষণ করলে ব্যবহার চালু হবে না।',
                  )}
                </p>
              )}
              {text ? (
                <>
                  <p style={{ whiteSpace: 'pre-wrap' }} data-testid="ai-account-data-use">
                    {text.body}
                  </p>
                  <label className="ai-check">
                    <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                    {say(
                      'I have read and accept this data-use statement for this provider and tier.',
                      'এই প্রোভাইডার ও স্তরের জন্য ডেটা ব্যবহারের বিবৃতি পড়েছি এবং মেনে নিচ্ছি।',
                    )}
                  </label>
                </>
              ) : (
                <p role="alert">
                  {say(
                    'The current data-use statement is unavailable.',
                    'বর্তমান ডেটা ব্যবহারের বিবৃতি পাওয়া যাচ্ছে না।',
                  )}
                </p>
              )}
              <label>
                {say('API key (write-only)', 'এপিআই কী (শুধু লেখার জন্য)')}
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={16}
                  maxLength={512}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                />
              </label>
              <button disabled={!agree || !text || !provider || secret.length < 16}>
                {say('Save account', 'অ্যাকাউন্ট সংরক্ষণ করুন')}
              </button>
            </fieldset>
          </form>
          <h2>{say('Saved accounts', 'সংরক্ষিত অ্যাকাউন্ট')}</h2>
          {!own.data.items.length && (
            <p>{say('No AI account saved yet.', 'এখনও কোনো এআই অ্যাকাউন্ট সংরক্ষিত নেই।')}</p>
          )}
          <ul>
            {own.data.items.map((credential) => (
              <li key={credential.id}>
                <strong>
                  {credential.providerCode} · {credential.declaredTier}
                </strong>
                <p>
                  {credential.status} · …{credential.secretLast4 ?? '—'}
                </p>
                {credential.lastErrorClass && (
                  <p>
                    {say('Latest validation result', 'যাচাইয়ের সর্বশেষ ফল')}: {credential.lastErrorClass}
                  </p>
                )}
                {credential.status !== 'REVOKED' && (
                  <div className="row">
                    {(
                      [
                        'REVALIDATE',
                        ...(credential.status === 'DISABLED'
                          ? (['ENABLE'] as const)
                          : (['DISABLE'] as const)),
                        'REVOKE',
                      ] as const
                    ).map((action) => (
                      <button
                        key={action}
                        disabled={busy || uncertain}
                        onClick={() => {
                          void write(() =>
                            aiApi.changeCredential(own.data!.doctorProfileId, credential.id, {
                              action,
                              expectedRowVersion: credential.rowVersion,
                            }),
                          );
                        }}
                      >
                        {action === 'REVALIDATE'
                          ? say('Request validation', 'যাচাইয়ের অনুরোধ করুন')
                          : action === 'ENABLE'
                            ? say('Enable', 'চালু করুন')
                            : action === 'DISABLE'
                              ? say('Disable', 'বন্ধ করুন')
                              : say('Revoke', 'প্রত্যাহার করুন')}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>{say('Loading…', 'লোড হচ্ছে…')}</p>
      )}
    </main>
  );
}

export function AiCredentialsPage() {
  const tenant = getTenant();
  const context = useTenantContext(tenant);
  if (!tenant) return <Navigate to="/select-tenant" replace />;
  if (context.error || (context.data && !context.data.permissions.includes('ai.use')))
    return <Navigate to="/forbidden" replace />;
  return (
    <>
      <TopBar />
      {context.data && <Credentials key={`${tenant}:${currentUser()?.id}`} tenant={tenant} />}
    </>
  );
}
