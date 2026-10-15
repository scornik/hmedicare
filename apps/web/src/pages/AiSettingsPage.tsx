import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router';
import type { ApiSchemas } from '@hmedic/contracts/client';
import { api, ApiError, getTenant, useTenantContext } from '../api';
import { currentUser } from '../auth/session';
import { TopBar } from '../components/TopBar';
import { useI18n } from '../i18n/i18n';

type Policy = ApiSchemas['schemas']['TenantAiPolicy'];

function PolicyForm({
  policy,
  tenant,
  canManage,
  reload,
}: {
  policy: Policy;
  tenant: string;
  canManage: boolean;
  reload(): Promise<unknown>;
}) {
  const { locale } = useI18n();
  const say = (en: string, bn: string) => (locale === 'bn-BD' ? bn : en);
  const [enabled, setEnabled] = useState(policy.aiEnabled);
  const [free, setFree] = useState(policy.freeTierAiAllowed);
  const [minimize, setMinimize] = useState(policy.minimizationRequiredForNoTraining);
  const [providers, setProviders] = useState(policy.allowedProviderCodes.join(', '));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [reason, setReason] = useState('');
  const [needsRefresh, setNeedsRefresh] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !canManage || needsRefresh) return;
    setBusy(true);
    setNotice('');
    try {
      const result = await api.PUT('/api/v1/tenant/ai-policy', {
        params: { header: { 'X-Tenant-ID': tenant, 'Idempotency-Key': crypto.randomUUID() } },
        body: {
          aiEnabled: enabled,
          freeTierAiAllowed: free,
          minimizationRequiredForNoTraining: minimize,
          allowedProviderCodes: providers
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean),
          rawOutputRetentionDays: policy.rawOutputRetentionDays,
          minAiConsentPolicyVersion: policy.minAiConsentPolicyVersion,
          policyTextVersion: policy.policyTextVersion,
          reason: reason.trim(),
          expectedRowVersion: policy.rowVersion,
        },
      });
      if (result.error || !result.data)
        throw new ApiError(result.response.status, result.error?.code ?? 'ERROR');
      setNeedsRefresh(true);
      setNotice(
        say(
          'Policy saved. Reload to see the effective settings.',
          'নীতি সংরক্ষিত হয়েছে। কার্যকর সেটিংস দেখতে আবার লোড করুন।',
        ),
      );
      await reload();
    } catch {
      setNeedsRefresh(true);
      setNotice(
        say(
          'The save could not be confirmed. Reload the current policy before making another change.',
          'সংরক্ষণ নিশ্চিত করা যায়নি। আরেকটি পরিবর্তনের আগে বর্তমান নীতি আবার লোড করুন।',
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card ai-panel" data-testid="ai-policy-settings">
      <h1>{say('AI settings', 'এআই সেটিংস')}</h1>
      <p>
        {say(
          'Control AI assistance for this clinic. Each doctor also needs an active provider credential and patient consent.',
          'এই ক্লিনিকে এআই সহায়তা নিয়ন্ত্রণ করুন। প্রত্যেক চিকিৎসকের সক্রিয় প্রোভাইডার ক্রেডেনশিয়াল এবং রোগীর সম্মতিও প্রয়োজন।',
        )}
      </p>
      <p>
        {say('Policy version', 'নীতির সংস্করণ')}: {policy.policyVersion}
      </p>
      <p data-testid="ai-free-effective">
        {say('Free-tier use is currently', 'বিনামূল্যের স্তর বর্তমানে')}:{' '}
        {policy.freeTierEffective ? say('allowed', 'অনুমোদিত') : say('off', 'বন্ধ')}
      </p>
      {policy.freeTierForcedOffByProductionGate && (
        <p role="status">
          {say(
            'The server currently blocks free-tier use, even if it is selected below.',
            'নিচে নির্বাচন করা থাকলেও সার্ভার বর্তমানে বিনামূল্যের স্তর ব্যবহার বন্ধ রেখেছে।',
          )}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void reload();
        }}
      >
        {say('Reload policy', 'নীতি আবার লোড করুন')}
      </button>
      {!canManage && (
        <p>
          {say(
            'You can view these settings. A clinic owner can change them.',
            'আপনি এই সেটিংস দেখতে পারবেন। ক্লিনিকের মালিক পরিবর্তন করতে পারবেন।',
          )}
        </p>
      )}
      <form
        onSubmit={(e) => {
          void save(e);
        }}
      >
        <fieldset disabled={!canManage || busy || needsRefresh}>
          <legend>{say('Clinic policy', 'ক্লিনিকের নীতি')}</legend>
          <label className="ai-check">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            {say('Enable AI assistance', 'এআই সহায়তা চালু করুন')}
          </label>
          <label className="ai-check">
            <input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} />
            {say('Allow free-tier providers', 'বিনামূল্যের প্রোভাইডার ব্যবহারের অনুমতি দিন')}
          </label>
          <label className="ai-check">
            <input type="checkbox" checked={minimize} onChange={(e) => setMinimize(e.target.checked)} />
            {say(
              'Remove identifying information for all providers',
              'সব প্রোভাইডারের জন্য পরিচয়সূচক তথ্য সরান',
            )}
          </label>
          <label>
            {say('Allowed providers, separated by commas', 'অনুমোদিত প্রোভাইডার, কমা দিয়ে আলাদা করুন')}
            <input value={providers} maxLength={500} onChange={(e) => setProviders(e.target.value)} />
          </label>
          <p>
            {say(
              'An empty list permits no providers. Provider availability is checked when you save.',
              'তালিকা খালি থাকলে কোনো প্রোভাইডার অনুমোদিত নয়। সংরক্ষণের সময় প্রোভাইডারের প্রাপ্যতা যাচাই করা হয়।',
            )}
          </p>
          <label>
            {say('Reason for change', 'পরিবর্তনের কারণ')}
            <textarea required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button disabled={!reason.trim()}>{say('Save policy', 'নীতি সংরক্ষণ করুন')}</button>
        </fieldset>
      </form>
    </section>
  );
}

function Settings({ tenant, canManage }: { tenant: string; canManage: boolean }) {
  const { locale } = useI18n();
  const policy = useQuery({
    queryKey: ['ai-settings-policy', tenant, currentUser()?.id],
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const r = await api.GET('/api/v1/tenant/ai-policy', {
        signal,
        params: { header: { 'X-Tenant-ID': tenant } },
      });
      if (r.error || !r.data) throw new ApiError(r.response.status, r.error?.code ?? 'ERROR');
      return r.data.data;
    },
  });
  return (
    <main>
      {policy.isPending && <p>{locale === 'bn-BD' ? 'লোড হচ্ছে…' : 'Loading…'}</p>}
      {policy.isError ? (
        <section className="card">
          <p role="alert">
            {locale === 'bn-BD' ? 'বর্তমান নীতি লোড করা যায়নি।' : 'The current policy could not be loaded.'}
          </p>
          <button
            onClick={() => {
              void policy.refetch();
            }}
          >
            {locale === 'bn-BD' ? 'আবার চেষ্টা করুন' : 'Try again'}
          </button>
        </section>
      ) : (
        policy.data && (
          <PolicyForm
            key={`${policy.data.rowVersion}:${policy.dataUpdatedAt}`}
            tenant={tenant}
            canManage={canManage}
            policy={policy.data}
            reload={() => policy.refetch()}
          />
        )
      )}
    </main>
  );
}

export function AiSettingsPage() {
  const tenant = getTenant();
  const context = useTenantContext(tenant);
  if (!tenant) return <Navigate to="/select-tenant" replace />;
  if (context.error || (context.data && !context.data.permissions.includes('ai.policy.read')))
    return <Navigate to="/forbidden" replace />;
  return (
    <>
      <TopBar />
      {context.data && (
        <Settings
          key={`${tenant}:${currentUser()?.id}`}
          tenant={tenant}
          canManage={context.data.permissions.includes('ai.policy.manage')}
        />
      )}
    </>
  );
}
