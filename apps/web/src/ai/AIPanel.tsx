import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ApiError, getTenant } from '../api';
import { currentUser } from '../auth/session';
import { useI18n } from '../i18n/i18n';
import { aiApi, type AiSuggestion, type ApproveAiSuggestion } from './api';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const sections = ['chief_complaint', 'history', 'examination', 'assessment', 'plan'] as const;
type NoteSection = (typeof sections)[number];

export function AIPanel({
  encounterId,
  doctorProfileId,
  canWrite,
  noteRowVersion,
  needsChartRefresh,
  onBusy,
  onApproved,
}: {
  encounterId: string;
  doctorProfileId: string;
  canWrite: boolean;
  noteRowVersion: number | null;
  needsChartRefresh: boolean;
  onBusy(value: boolean): void;
  onApproved(): Promise<void>;
}) {
  const { locale } = useI18n();
  const say = (en: string, bn: string) => (locale === 'bn-BD' ? bn : en);
  const audience = [getTenant(), currentUser()?.id, encounterId];
  const [credentialId, setCredentialId] = useState('');
  const [modelId, setModelId] = useState('');
  const [purpose, setPurpose] = useState<'note-draft' | 'history-summary'>('note-draft');
  const [selectedSections, setSelectedSections] = useState<NoteSection[]>([]);
  const [search, setSearch] = useSearchParams();
  const initialJobId = search.get('aiJob');
  const [jobId, setJobId] = useState<string | null>(
    initialJobId && /^[a-f0-9-]{36}$/i.test(initialJobId) ? initialJobId : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const policy = useQuery({
    queryKey: ['ai-policy', ...audience],
    queryFn: aiApi.policy,
    gcTime: 0,
    retry: false,
  });
  const credentials = useQuery({
    queryKey: ['ai-credentials', ...audience, doctorProfileId],
    queryFn: aiApi.myCredentials,
    enabled: policy.data?.aiEnabled === true && !policy.isError,
    gcTime: 0,
    retry: false,
  });
  const active = credentials.data?.items.filter((c) => c.status === 'ACTIVE') ?? [];
  const credential = active.find((c) => c.id === credentialId) ?? active[0];
  const history = useQuery({
    queryKey: ['ai-jobs', ...audience],
    queryFn: () => aiApi.jobs(encounterId),
    enabled: !!credential,
    gcTime: 0,
    retry: false,
  });
  const models = useQuery({
    queryKey: ['ai-models', ...audience, credential?.providerCode],
    queryFn: () => aiApi.models(credential!.providerCode),
    enabled: !!credential,
    gcTime: 0,
  });
  const compatible =
    models.data?.items.filter(
      (m) =>
        m.capabilities.includes('text') &&
        m.capabilities.includes('json_schema') &&
        m.tierAvailability.includes(credential!.declaredTier),
    ) ?? [];
  const job = useQuery({
    queryKey: ['ai-job', ...audience, jobId],
    queryFn: () => aiApi.job(jobId!),
    enabled: !!jobId,
    gcTime: 0,
    retry: false,
    refetchInterval: (q) =>
      q.state.data && ['QUEUED', 'RUNNING', 'WAITING_RATE_LIMIT'].includes(q.state.data.status)
        ? 2000
        : false,
  });
  const jobMatches = job.data?.encounterId === encounterId;
  const draftId = !job.isError && jobMatches ? job.data?.draftId : null;
  const draft = useQuery({
    queryKey: ['ai-draft', ...audience, draftId],
    queryFn: () => aiApi.draft(draftId!),
    enabled: !!draftId,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  async function act(fn: () => Promise<unknown>, clinical = false) {
    if (busy) return;
    setBusy(true);
    setError(null);
    if (clinical) onBusy(true);
    let committed = false;
    try {
      await fn();
      committed = true;
      if (clinical) await onApproved();
    } catch (e) {
      const uncertainClinical = clinical && !committed && (!(e instanceof ApiError) || e.status >= 500);
      if (uncertainClinical) {
        try {
          await onApproved();
          await draft.refetch();
        } catch {
          /* The parent keeps the chart locked until it can reload. */
        }
      }
      setError(
        clinical && committed
          ? say(
              'Approval was saved, but the chart could not refresh. Reload the chart before editing.',
              'অনুমোদন সংরক্ষিত হয়েছে, কিন্তু রেকর্ড রিফ্রেশ করা যায়নি। সম্পাদনার আগে রেকর্ড আবার লোড করুন।',
            )
          : e instanceof ApiError && e.code === 'STALE_VERSION'
            ? say(
                'The record changed. Refresh the review before continuing.',
                'রেকর্ড পরিবর্তিত হয়েছে। এগিয়ে যাওয়ার আগে পর্যালোচনা রিফ্রেশ করুন।',
              )
            : say(
                'The action could not be confirmed. Refresh the review before continuing.',
                'কাজটির ফল নিশ্চিত করা যায়নি। এগিয়ে যাওয়ার আগে পর্যালোচনা রিফ্রেশ করুন।',
              ),
      );
    } finally {
      setBusy(false);
      if (clinical) onBusy(false);
    }
  }
  // Optional assistive work never interrupts the manual consultation.
  if (!policy.data?.aiEnabled || policy.isError || credentials.isError || !credential) return null;
  const draftMatches = draft.data?.encounterId === encounterId && draft.data?.aiJobId === jobId;
  const reviewable =
    draftMatches &&
    draft.data &&
    !draft.isError &&
    ['READY_FOR_REVIEW', 'IN_REVIEW'].includes(draft.data.status) &&
    new Date(draft.data.expiresAt) > new Date();
  return (
    <section className="card ai-panel" data-testid="ai-panel">
      <h2>{say('AI assistance', 'AI সহায়তা')}</h2>
      <p className="muted">
        {say(
          'Suggestions stay separate from the chart until you review and approve each one.',
          'প্রতিটি প্রস্তাব পর্যালোচনা ও অনুমোদন না করা পর্যন্ত রোগীর রেকর্ডে যোগ হবে না।',
        )}
      </p>
      <p>
        <a href="#ai-patient-history">
          {say('Review cited records in patient history', 'রোগীর ইতিহাসে উদ্ধৃত রেকর্ড পর্যালোচনা করুন')}
        </a>
      </p>
      {!history.isError && !!history.data?.items.length && (
        <details>
          <summary>{say('Recent AI requests', 'সাম্প্রতিক AI অনুরোধ')}</summary>
          {history.data.items.map((previous) => (
            <button
              key={previous.id}
              disabled={busy}
              onClick={() => {
                setJobId(previous.id);
                setError(null);
              }}
            >
              {previous.purpose.replaceAll('_', ' ')} · {previous.status} ·{' '}
              {previous.finishedAt
                ? new Date(previous.finishedAt).toLocaleString(locale)
                : previous.providerCode}
            </button>
          ))}
        </details>
      )}
      {history.isError && (
        <p role="alert">
          {say(
            'Request history could not load. Refresh it before starting more work.',
            'অনুরোধের ইতিহাস লোড করা যায়নি। নতুন কাজের আগে রিফ্রেশ করুন।',
          )}
          <button onClick={() => void history.refetch()}>
            {say('Reload requests', 'অনুরোধ আবার লোড করুন')}
          </button>
        </p>
      )}
      <label>
        {say('Credential', 'ক্রেডেনশিয়াল')}
        <select
          value={credential.id}
          disabled={busy}
          onChange={(e) => {
            setCredentialId(e.target.value);
            setModelId('');
          }}
        >
          {active.map((c) => (
            <option key={c.id} value={c.id}>
              {c.providerCode} · {c.declaredTier} · …{c.secretLast4}
            </option>
          ))}
        </select>
      </label>
      <label>
        {say('Model', 'মডেল')}
        <select
          data-testid="ai-model"
          value={modelId}
          disabled={busy || models.isError}
          onChange={(e) => setModelId(e.target.value)}
        >
          <option value="">{say('Choose a catalog model', 'ক্যাটালগ থেকে মডেল বেছে নিন')}</option>
          {compatible.map((m) => (
            <option key={m.modelId} value={m.modelId}>
              {m.displayName}
            </option>
          ))}
        </select>
      </label>
      <label>
        {say('Purpose', 'উদ্দেশ্য')}
        <select
          value={purpose}
          disabled={busy}
          onChange={(e) => setPurpose(e.target.value as typeof purpose)}
        >
          <option value="note-draft">{say('Note suggestions', 'নোটের প্রস্তাব')}</option>
          <option value="history-summary">{say('History summary', 'ইতিহাসের সারাংশ')}</option>
        </select>
      </label>
      <fieldset disabled={busy}>
        <legend>{say('Saved note sections to include', 'সংরক্ষিত নোটের যে অংশগুলো পাঠাবেন')}</legend>
        {sections.map((s) => (
          <label key={s} className="ai-check">
            <input
              type="checkbox"
              checked={selectedSections.includes(s)}
              onChange={(e) =>
                setSelectedSections((old) => (e.target.checked ? [...old, s] : old.filter((v) => v !== s)))
              }
            />
            {s.replaceAll('_', ' ')}
          </label>
        ))}
      </fieldset>
      <p className="muted">
        {say(
          'The request also uses authorized patient history. Current AI consent is checked by the server.',
          'অনুরোধে অনুমোদিত রোগীর ইতিহাসও ব্যবহৃত হবে। সার্ভার বর্তমান AI সম্মতি যাচাই করবে।',
        )}
      </p>
      {!canWrite && (
        <p role="status">
          {say(
            'Save or resolve your note before requesting or approving AI work.',
            'AI অনুরোধ বা অনুমোদনের আগে নোট সংরক্ষণ করুন বা বিরোধ সমাধান করুন।',
          )}
        </p>
      )}
      <button
        disabled={
          busy ||
          history.isPending ||
          history.isError ||
          !!history.data?.items.some((previous) =>
            ['QUEUED', 'RUNNING', 'WAITING_RATE_LIMIT'].includes(previous.status),
          ) ||
          !canWrite ||
          !compatible.some((m) => m.modelId === modelId) ||
          (!!jobId &&
            (!job.data ||
              job.isError ||
              ['QUEUED', 'RUNNING', 'WAITING_RATE_LIMIT'].includes(job.data.status)))
        }
        onClick={() =>
          void act(async () => {
            const created = await aiApi.create(encounterId, purpose, {
              credentialId: credential.id,
              modelId,
              sourceSelection: { draftSections: selectedSections },
            });
            setJobId(created.id);
            await history.refetch();
            setSearch(
              (old) => {
                const next = new URLSearchParams(old);
                next.set('aiJob', created.id);
                return next;
              },
              { replace: true },
            );
          })
        }
      >
        {say('Request suggestions', 'প্রস্তাব অনুরোধ করুন')}
      </button>
      {models.isError && (
        <p role="alert">{say('The model catalog could not be loaded.', 'মডেল ক্যাটালগ লোড করা যায়নি।')}</p>
      )}
      {error && <p role="alert">{error}</p>}
      {needsChartRefresh && (
        <button disabled={busy} onClick={() => void act(onApproved)}>
          {say('Reload chart', 'রেকর্ড আবার লোড করুন')}
        </button>
      )}
      {(job.isError || draft.isError) && (
        <p role="alert">
          {say(
            'Access or loading failed. Refresh before viewing suggestions.',
            'তথ্য লোড বা প্রবেশাধিকার যাচাই ব্যর্থ হয়েছে। প্রস্তাব দেখার আগে রিফ্রেশ করুন।',
          )}
        </p>
      )}
      {job.data && !job.isError && jobMatches && (
        <div>
          <p role="status">
            {job.data.status}
            {job.data.errorClass ? ` · ${job.data.errorClass}` : ''}
          </p>
          <p data-testid="ai-data-use">
            {job.data.providerCode} · {job.data.modelId} —{' '}
            {job.data.effectiveDataUsePolicy !== 'NO_TRAINING_CONTRACTUAL'
              ? say(
                  'Provider may train on or review submitted data.',
                  'প্রদানকারী পাঠানো তথ্য দিয়ে প্রশিক্ষণ বা পর্যালোচনা করতে পারে।',
                )
              : say(
                  'Contractual no-training data-use policy.',
                  'চুক্তি অনুযায়ী প্রশিক্ষণে তথ্য ব্যবহার করা হয় না।',
                )}
          </p>
          {['QUEUED', 'RUNNING', 'WAITING_RATE_LIMIT'].includes(job.data.status) && (
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await aiApi.cancel(job.data!.id);
                  await job.refetch();
                })
              }
            >
              {say('Cancel request', 'অনুরোধ বাতিল করুন')}
            </button>
          )}
          <button
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await job.refetch();
                await draft.refetch();
              })
            }
          >
            {say('Refresh review', 'পর্যালোচনা রিফ্রেশ করুন')}
          </button>
        </div>
      )}
      {draft.data && draftMatches && !draft.isError && !job.isError && (
        <div>
          <p>
            {draft.data.status} · {say('Expires', 'মেয়াদ শেষ')}{' '}
            {new Date(draft.data.expiresAt).toLocaleString(locale)}
          </p>
          {draft.data.droppedUnsourcedCount > 0 && (
            <p>
              {say('Unsourced suggestions were discarded:', 'উৎসহীন প্রস্তাব বাদ দেওয়া হয়েছে:')}{' '}
              {draft.data.droppedUnsourcedCount}
            </p>
          )}
          {reviewable && (
            <>
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await aiApi.open(draft.data!.id);
                    await draft.refetch();
                  })
                }
              >
                {say('Open review', 'পর্যালোচনা খুলুন')}
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await aiApi.close(draft.data!.id);
                    await draft.refetch();
                  })
                }
              >
                {say('Finish review', 'পর্যালোচনা শেষ করুন')}
              </button>
            </>
          )}
          {draft.data.suggestions.map((s) => (
            <Suggestion
              key={`${s.id}:${s.rowVersion}`}
              suggestion={s}
              editable={!!reviewable && !busy && !error}
              canApprove={canWrite && !!reviewable && !busy && !error}
              noteRowVersion={noteRowVersion}
              say={say}
              onReview={(decision, editedCandidate) =>
                act(async () => {
                  await aiApi.review(s.id, {
                    decision,
                    expectedRowVersion: s.rowVersion,
                    ...(editedCandidate ? { editedCandidate } : {}),
                  });
                  await draft.refetch();
                })
              }
              onApprove={(body) =>
                act(async () => {
                  await aiApi.approve(s.id, body);
                  await draft.refetch();
                }, true)
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

function Suggestion({
  suggestion: s,
  editable,
  canApprove,
  noteRowVersion,
  say,
  onReview,
  onApprove,
}: {
  suggestion: AiSuggestion;
  editable: boolean;
  canApprove: boolean;
  noteRowVersion: number | null;
  say(en: string, bn: string): string;
  onReview(decision: 'ACCEPT' | 'EDIT' | 'REJECT' | 'IGNORE' | 'REOPEN', edited?: unknown): Promise<void>;
  onApprove(body: ApproveAiSuggestion): Promise<void>;
}) {
  const candidate = record(s.editedCandidate ?? s.candidate);
  const originalText =
    typeof candidate.text === 'string'
      ? candidate.text
      : typeof candidate.display === 'string'
        ? candidate.display
        : '';
  const [text, setText] = useState(originalText);
  const [attested, setAttested] = useState(false);
  const [mode, setMode] = useState<'APPEND' | 'REPLACE'>('APPEND');
  const section = sections.find((v) => v === s.targetSection);
  const supported =
    (s.suggestionType === 'NOTE_SECTION' && !!section && noteRowVersion !== null) ||
    s.suggestionType === 'DIAGNOSIS';
  const mutable = editable && ['PENDING', 'ACCEPTED', 'EDITED'].includes(s.status);
  const changed = text !== originalText;
  return (
    <article className="card" data-testid="ai-suggestion">
      <h3>
        {s.suggestionType.replaceAll('_', ' ')} · {s.status}
      </h3>
      {s.targetSection && (
        <p>
          {say('Target section', 'নোটের অংশ')}: {s.targetSection.replaceAll('_', ' ')}
        </p>
      )}
      {s.suggestionType === 'DIAGNOSIS' && (
        <p>
          {String(candidate.certainty ?? '')}{' '}
          {typeof candidate.codeSystem === 'string' ? candidate.codeSystem : ''}{' '}
          {typeof candidate.code === 'string' ? candidate.code : ''}
        </p>
      )}
      {(s.confidence === 'LOW' || s.confidence === 'UNKNOWN') && (
        <p role="status">
          {say('Low or unknown confidence — verify carefully.', 'আস্থা কম বা অজানা — সতর্কভাবে যাচাই করুন।')}
        </p>
      )}
      <textarea
        aria-label={say('Suggestion content', 'প্রস্তাবের বিষয়বস্তু')}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setAttested(false);
        }}
        readOnly={!mutable || !supported}
        maxLength={s.suggestionType === 'DIAGNOSIS' ? 300 : 4000}
      />
      <p className="muted">
        {say('Sources', 'উৎস')}:{' '}
        {s.sourceRefs.map((ref) => `${ref.sourceType} · ${ref.occurredAt}`).join('; ')}
      </p>
      {mutable && (
        <div>
          {changed ? (
            <button
              disabled={!text.trim()}
              onClick={() =>
                void onReview('EDIT', {
                  ...candidate,
                  ...(s.suggestionType === 'DIAGNOSIS' ? { display: text } : { text }),
                })
              }
            >
              {say('Save edit for review', 'পর্যালোচনার জন্য সম্পাদনা সংরক্ষণ করুন')}
            </button>
          ) : (
            s.status === 'PENDING' && (
              <button onClick={() => void onReview('ACCEPT')}>
                {say('Accept for review', 'পর্যালোচনার জন্য গ্রহণ করুন')}
              </button>
            )
          )}
          <button onClick={() => void onReview('REJECT')}>{say('Reject', 'প্রত্যাখ্যান করুন')}</button>
          <button onClick={() => void onReview('IGNORE')}>{say('Ignore', 'এড়িয়ে যান')}</button>
        </div>
      )}
      {editable && ['REJECTED', 'IGNORED'].includes(s.status) && (
        <button onClick={() => void onReview('REOPEN')}>{say('Reopen', 'আবার খুলুন')}</button>
      )}
      {supported && ['ACCEPTED', 'EDITED'].includes(s.status) && (
        <div>
          {s.suggestionType === 'NOTE_SECTION' && (
            <label>
              {say('Write to note', 'নোটে লিখুন')}
              <select
                value={mode}
                disabled={!canApprove}
                onChange={(e) => {
                  setMode(e.target.value as typeof mode);
                  setAttested(false);
                }}
              >
                <option value="APPEND">{say('Append to section', 'অংশের শেষে যোগ করুন')}</option>
                <option value="REPLACE">{say('Replace section', 'অংশটি প্রতিস্থাপন করুন')}</option>
              </select>
            </label>
          )}
          <label className="ai-check">
            <input
              type="checkbox"
              checked={attested}
              disabled={!canApprove || changed}
              onChange={(e) => setAttested(e.target.checked)}
            />
            {say(
              'I reviewed the content and sources, verified clinical accuracy, and take responsibility for adding this to the chart.',
              'আমি বিষয়বস্তু ও উৎস পর্যালোচনা করেছি, চিকিৎসাগত নির্ভুলতা যাচাই করেছি এবং রোগীর রেকর্ডে এটি যোগ করার দায়িত্ব নিচ্ছি।',
            )}
          </label>
          <button
            disabled={!canApprove || !attested || changed}
            onClick={() => {
              const common = { expectedRowVersion: s.rowVersion, attestationVersion: 1 };
              if (s.suggestionType === 'NOTE_SECTION' && section && noteRowVersion !== null)
                void onApprove({
                  ...common,
                  approvedTarget: 'ENCOUNTER_NOTE_SECTION',
                  noteSection: { section, mode, text, expectedNoteRowVersion: noteRowVersion },
                });
              else if (
                s.suggestionType === 'DIAGNOSIS' &&
                ['CONFIRMED', 'PROVISIONAL', 'DIFFERENTIAL'].includes(String(candidate.certainty))
              )
                void onApprove({
                  ...common,
                  approvedTarget: 'DIAGNOSIS',
                  diagnosis: {
                    display: text,
                    certainty: candidate.certainty as 'CONFIRMED' | 'PROVISIONAL' | 'DIFFERENTIAL',
                    ...(typeof candidate.code === 'string' && typeof candidate.codeSystem === 'string'
                      ? { code: candidate.code, codeSystem: candidate.codeSystem }
                      : {}),
                  },
                });
            }}
          >
            {say('Approve this suggestion into the chart', 'এই প্রস্তাব রোগীর রেকর্ডে অনুমোদন করুন')}
          </button>
        </div>
      )}
    </article>
  );
}
