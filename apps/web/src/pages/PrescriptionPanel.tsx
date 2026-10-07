import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getTenant } from '../api';
import { useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';

/**
 * The prescription editor inside the consultation workspace (Stage 7 CP10).
 *
 * Three things shape it, and each is a mistake it is built to prevent:
 *
 * **Nothing clinical is prefilled.** Choosing a catalog medicine fills the brand, the strength text and
 * the form, and leaves dose, frequency and duration empty. A prescription pad that guesses a dose is a
 * pad that gets one accepted without being read.
 *
 * **An approved prescription is read-only here.** The server refuses the edit anyway, but a form that
 * lets a doctor type into a frozen prescription and then rejects the save has already wasted the work
 * and taught them the wrong model. The correction button is the only way forward.
 *
 * **Every catalog row says where it came from.** `UNVERIFIED` is the review status of the whole Stage M
 * dataset, so the badge is on every catalog line rather than hidden behind a tooltip.
 */
const tenantHeader = () => ({ 'X-Tenant-ID': getTenant() ?? '' });
const idemHeader = () => ({ ...tenantHeader(), 'Idempotency-Key': crypto.randomUUID() });

type ClinicalStatus = 'DRAFT' | 'REVIEWED' | 'APPROVED' | 'VOID';

interface CatalogSnapshot {
  brandName: string;
  brandNameBn: string | null;
  genericDisplay: string;
  strengthText: string | null;
  dosageForm: string;
  manufacturerDisplay: string;
  reviewStatus: string;
  dgdaMatch: string;
}

interface ItemDraft {
  sequence: number;
  medicationId: string | null;
  medicationDatasetVersion: string | null;
  catalogSnapshot: CatalogSnapshot | null;
  freeTextName: string | null;
  isFreeText: boolean;
  strength: string | null;
  dosageForm: string | null;
  route: string | null;
  dose: string;
  frequency: string;
  duration: string;
  quantity: string | null;
  timing: string | null;
  instructions: string | null;
  instructionsBn: string | null;
  substitutionAllowed: boolean;
}

interface SearchHit {
  medicationId: string;
  brandName: string;
  brandNameBn: string | null;
  genericDisplay: string;
  strengthText: string | null;
  dosageForm: string;
  dosageFormUnmapped: boolean;
  manufacturerDisplay: string;
  tier: string;
  matchedOn: string | null;
  source: { datasetVersion: string; reviewStatus: string; dgdaMatch: string; isSynthetic: boolean };
}

const blankFromCatalog = (hit: SearchHit, sequence: number): ItemDraft => ({
  sequence,
  medicationId: hit.medicationId,
  medicationDatasetVersion: hit.source.datasetVersion,
  catalogSnapshot: {
    brandName: hit.brandName,
    brandNameBn: hit.brandNameBn,
    genericDisplay: hit.genericDisplay,
    strengthText: hit.strengthText,
    dosageForm: hit.dosageForm,
    manufacturerDisplay: hit.manufacturerDisplay,
    reviewStatus: hit.source.reviewStatus,
    dgdaMatch: hit.source.dgdaMatch,
  },
  freeTextName: null,
  isFreeText: false,
  // Strength and form are the two the catalog may prefill, and both stay editable: a product's
  // packaged strength is not automatically the strength being prescribed.
  strength: hit.strengthText,
  dosageForm: hit.dosageForm,
  route: null,
  // Deliberately empty. The catalog has no business filling these in.
  dose: '',
  frequency: '',
  duration: '',
  quantity: null,
  timing: null,
  instructions: null,
  instructionsBn: null,
  substitutionAllowed: true,
});

const blankFreeText = (name: string, sequence: number): ItemDraft => ({
  sequence,
  medicationId: null,
  medicationDatasetVersion: null,
  catalogSnapshot: null,
  freeTextName: name,
  isFreeText: true,
  strength: null,
  dosageForm: null,
  route: null,
  dose: '',
  frequency: '',
  duration: '',
  quantity: null,
  timing: null,
  instructions: null,
  instructionsBn: null,
  substitutionAllowed: true,
});

export function PrescriptionPanel({ encounterId }: { encounterId: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [items, setItems] = useState<ItemDraft[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<MessageKey | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [attested, setAttested] = useState(false);
  // The render is a queued job, so the panel tracks what it last heard rather than assuming the PDF is
  // ready the moment the request returns.
  const [renderNote, setRenderNote] = useState<MessageKey | null>(null);
  // Held in a ref as well as in the query, so a save sends the version the editor was opened against
  // rather than one a background refetch moved underneath it.
  const rowVersion = useRef<number>(0);

  const list = useQuery({
    queryKey: ['prescriptions', encounterId],
    queryFn: async () => {
      const r = await api.GET('/api/v1/encounters/{id}/prescriptions', {
        params: { header: tenantHeader(), path: { id: encounterId } },
      });
      return r.data?.data?.items ?? [];
    },
  });

  const current = useMemo(() => {
    const all = list.data ?? [];
    return (
      all.find((p) => p.clinicalStatus === 'DRAFT' || p.clinicalStatus === 'REVIEWED') ??
      all.find((p) => p.clinicalStatus === 'APPROVED') ??
      all[0] ??
      null
    );
  }, [list.data]);

  useEffect(() => {
    if (!current) return;
    rowVersion.current = current.rowVersion;
    setItems(current.items as unknown as ItemDraft[]);
    setAttested(false);
  }, [current?.id, current?.rowVersion]);

  const editable = current?.clinicalStatus === 'DRAFT' || current?.clinicalStatus === 'REVIEWED';

  const search = useQuery({
    queryKey: ['medication-search', query],
    enabled: query.trim().length >= 2 && editable,
    queryFn: async () => {
      const r = await api.GET('/api/v1/medications/search', {
        params: { header: tenantHeader(), query: { q: query.trim(), limit: 8 } },
      });
      return (r.data?.data?.items ?? []) as unknown as SearchHit[];
    },
  });

  /** One place to turn a failed call into something the doctor can act on. */
  const onFailure = (status: number | undefined, code: string | undefined) => {
    setError(status === 409 || code === 'STALE_VERSION' ? 'rx.conflict' : 'rx.failed');
    void qc.invalidateQueries({ queryKey: ['prescriptions', encounterId] });
  };

  const open = useMutation({
    mutationFn: async () => {
      const r = await api.POST('/api/v1/encounters/{id}/prescriptions', {
        params: { header: idemHeader(), path: { id: encounterId } },
      });
      if (r.error) throw r;
      return r.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['prescriptions', encounterId] }),
    onError: (e: { response?: { status: number } }) => onFailure(e?.response?.status, undefined),
  });

  const save = useMutation({
    mutationFn: async (next: ItemDraft[]) => {
      const r = await api.PATCH('/api/v1/prescriptions/{id}', {
        params: { header: tenantHeader(), path: { id: current!.id } },
        body: { expectedRowVersion: rowVersion.current, items: next as never },
      });
      if (r.error) throw r;
      return r.data;
    },
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['prescriptions', encounterId] });
    },
    onError: (e: { response?: { status: number } }) => onFailure(e?.response?.status, undefined),
  });

  const act = (
    path:
      | '/api/v1/prescriptions/{id}/review'
      | '/api/v1/prescriptions/{id}/approve'
      | '/api/v1/prescriptions/{id}/void'
      | '/api/v1/prescriptions/{id}/corrections',
    body: Record<string, unknown>,
  ) =>
    api
      .POST(
        path as never,
        {
          params: { header: idemHeader(), path: { id: current!.id } },
          ...(Object.keys(body).length > 0 ? { body: body as never } : {}),
        } as never,
      )
      .then((r) => {
        if ((r as { error?: unknown }).error) throw r;
        setError(null);
        setVoidReason('');
        void qc.invalidateQueries({ queryKey: ['prescriptions', encounterId] });
      })
      .catch((e: { response?: { status: number } }) => onFailure(e?.response?.status, undefined));

  /**
   * Queues a PDF, then reports what the server said rather than what we hoped.
   *
   * `renderStatus` comes back AVAILABLE when a PDF already exists — a re-render leaves the current copy
   * downloadable — so "queued" is only shown when the server actually queued a first one.
   */
  const render = useMutation({
    mutationFn: async () => {
      const r = await api.POST('/api/v1/prescriptions/{id}/render', {
        params: { header: idemHeader(), path: { id: current!.id } },
      });
      if (r.error) throw r;
      return r.data?.data;
    },
    onSuccess: (data) => {
      setError(null);
      setRenderNote(data?.renderStatus === 'AVAILABLE' ? null : 'rx.pdfQueued');
      void qc.invalidateQueries({ queryKey: ['prescriptions', encounterId] });
    },
    onError: (e: { response?: { status: number } }) => onFailure(e?.response?.status, undefined),
  });

  /**
   * Fetches a single-use token and follows it.
   *
   * The token is spent on use and bound to this actor, so it cannot be turned into a link to share —
   * which is why the download is driven here rather than rendered as an anchor the browser might
   * prefetch or a user might copy.
   */
  const download = useMutation({
    mutationFn: async (documentId: string) => {
      const issued = await api.POST('/api/v1/documents/{id}/download-token', {
        params: { header: idemHeader(), path: { id: documentId } },
      });
      if (issued.error) throw issued;
      const token = issued.data?.data?.token;
      if (!token) throw issued;
      window.location.assign(
        `/api/v1/documents/${encodeURIComponent(documentId)}/download?token=${encodeURIComponent(token)}`,
      );
    },
    onError: (e: { response?: { status: number } }) => onFailure(e?.response?.status, undefined),
  });

  const setItem = (i: number, patch: Partial<ItemDraft>) =>
    setItems((prev) => (prev ?? []).map((it, n) => (n === i ? { ...it, ...patch } : it)));

  const addItem = (draft: ItemDraft) => {
    setItems((prev) => [...(prev ?? []), { ...draft, sequence: (prev?.length ?? 0) + 1 }]);
    setQuery('');
  };

  const removeItem = (i: number) =>
    setItems((prev) => (prev ?? []).filter((_, n) => n !== i).map((it, n) => ({ ...it, sequence: n + 1 })));

  const incomplete = (items ?? []).some((i) => !i.dose.trim() || !i.frequency.trim() || !i.duration.trim());

  if (!current) {
    return (
      <section className="card" data-testid="panel-prescriptions">
        <h2>{t('rx.title')}</h2>
        <button type="button" onClick={() => open.mutate()} data-testid="rx-open">
          {t('rx.open')}
        </button>
      </section>
    );
  }

  return (
    <section className="card" aria-labelledby="rx-heading" data-testid="panel-prescriptions">
      <h2 id="rx-heading">{t('rx.title')}</h2>
      <p className="muted" data-testid="rx-status">
        {t('rx.revision')} {current.revision} ·{' '}
        {t(`rx.status.${current.clinicalStatus as ClinicalStatus}` as MessageKey)}
      </p>
      {error ? (
        <p role="alert" data-testid="rx-error">
          {t(error)}
        </p>
      ) : null}

      {/* An approved prescription is shown, never offered for editing: a form that accepts typing and
          then refuses the save has already wasted the work. */}
      {!editable ? <p data-testid="rx-locked">{t('rx.approvedLocked')}</p> : null}

      {editable ? (
        <>
          <p className="muted">{t('rx.noSuggestionHint')}</p>
          <label htmlFor="rx-search">{t('rx.search')}</label>
          <input
            id="rx-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('rx.searchHint')}
            data-testid="rx-search"
          />
          {query.trim().length >= 2 ? (
            <ul data-testid="rx-results">
              {(search.data ?? []).map((hit) => (
                <li key={hit.medicationId}>
                  <button
                    type="button"
                    onClick={() => addItem(blankFromCatalog(hit, 0))}
                    data-testid={`rx-pick-${hit.medicationId}`}
                  >
                    {hit.brandName}
                  </button>{' '}
                  <span className="muted">
                    {hit.genericDisplay}
                    {hit.strengthText ? ` · ${hit.strengthText}` : ''}
                  </span>{' '}
                  {/* The whole Stage M dataset is UNVERIFIED, so the badge belongs on every row. */}
                  <span className="badge">{t('rx.unverifiedBadge')}</span>{' '}
                  {hit.dosageFormUnmapped ? <span className="badge">{t('rx.unmappedForm')}</span> : null}
                  {hit.source.isSynthetic ? <span className="badge">{t('rx.syntheticBadge')}</span> : null}
                </li>
              ))}
              {(search.data ?? []).length === 0 && !search.isFetching ? (
                <li data-testid="rx-no-results">
                  {t('rx.noResults')}{' '}
                  <button
                    type="button"
                    onClick={() => addItem(blankFreeText(query.trim(), 0))}
                    data-testid="rx-add-free-text"
                  >
                    {t('rx.addFreeText')}
                  </button>
                </li>
              ) : null}
            </ul>
          ) : null}
        </>
      ) : null}

      {(items ?? []).length === 0 ? <p data-testid="rx-empty">{t('rx.empty')}</p> : null}

      <ol data-testid="rx-items">
        {(items ?? []).map((item, i) => (
          <li key={`${item.sequence}-${item.medicationId ?? item.freeTextName}`} data-testid={`rx-item-${i}`}>
            <strong>{item.isFreeText ? item.freeTextName : item.catalogSnapshot?.brandName}</strong>{' '}
            {/* A free-text line is marked wherever it appears, so nobody mistakes it for a catalog one. */}
            {item.isFreeText ? (
              <span className="badge" data-testid={`rx-free-text-${i}`}>
                {t('rx.freeTextBadge')}
              </span>
            ) : (
              <span className="badge">{t('rx.unverifiedBadge')}</span>
            )}
            <div>
              <label htmlFor={`rx-dose-${i}`}>{t('rx.dose')}</label>
              <input
                id={`rx-dose-${i}`}
                value={item.dose}
                disabled={!editable}
                onChange={(e) => setItem(i, { dose: e.target.value })}
                data-testid={`rx-dose-${i}`}
              />
              <label htmlFor={`rx-frequency-${i}`}>{t('rx.frequency')}</label>
              <input
                id={`rx-frequency-${i}`}
                value={item.frequency}
                disabled={!editable}
                onChange={(e) => setItem(i, { frequency: e.target.value })}
                data-testid={`rx-frequency-${i}`}
              />
              <label htmlFor={`rx-duration-${i}`}>{t('rx.duration')}</label>
              <input
                id={`rx-duration-${i}`}
                value={item.duration}
                disabled={!editable}
                onChange={(e) => setItem(i, { duration: e.target.value })}
                data-testid={`rx-duration-${i}`}
              />
              <label htmlFor={`rx-instructions-${i}`}>{t('rx.instructions')}</label>
              <input
                id={`rx-instructions-${i}`}
                value={item.instructions ?? ''}
                disabled={!editable}
                onChange={(e) => setItem(i, { instructions: e.target.value || null })}
                data-testid={`rx-instructions-${i}`}
              />
            </div>
            {editable ? (
              <button type="button" onClick={() => removeItem(i)} data-testid={`rx-remove-${i}`}>
                {t('rx.remove')}
              </button>
            ) : null}
          </li>
        ))}
      </ol>

      {editable ? (
        <>
          {incomplete ? <p data-testid="rx-required-hint">{t('rx.requiredHint')}</p> : null}
          <button
            type="button"
            onClick={() => save.mutate(items ?? [])}
            disabled={save.isPending}
            data-testid="rx-save"
          >
            {t('rx.save')}
          </button>
          <button
            type="button"
            onClick={() =>
              void act('/api/v1/prescriptions/{id}/review', { expectedRowVersion: rowVersion.current })
            }
            disabled={(items ?? []).length === 0}
            data-testid="rx-review"
          >
            {t('rx.review')}
          </button>

          {/* The attestation is read and ticked before approve becomes available: approving is the act
              that puts a doctor's name on what the patient will be given. */}
          <label htmlFor="rx-attest">
            <input
              id="rx-attest"
              type="checkbox"
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
              data-testid="rx-attest"
            />{' '}
            {t('rx.attestation')}
          </label>
          <button
            type="button"
            onClick={() =>
              void act('/api/v1/prescriptions/{id}/approve', {
                expectedRowVersion: rowVersion.current,
                attestationVersion: 1,
              })
            }
            disabled={!attested || incomplete || (items ?? []).length === 0}
            data-testid="rx-approve"
          >
            {t('rx.approve')}
          </button>
        </>
      ) : null}

      {/* A PDF exists only for a final revision, and a void one prints watermarked for the audit
          trail. Offered for both, because the superseded copy is often the one someone needs to see. */}
      {current.clinicalStatus === 'APPROVED' || current.clinicalStatus === 'VOID' ? (
        <>
          <button
            type="button"
            onClick={() => render.mutate()}
            disabled={render.isPending}
            data-testid="rx-render"
          >
            {t('rx.pdf')}
          </button>
          {current.renderedDocumentId ? (
            <button
              type="button"
              onClick={() => download.mutate(current.renderedDocumentId!)}
              disabled={download.isPending}
              data-testid="rx-pdf-download"
            >
              {t('rx.pdfDownload')}
            </button>
          ) : (
            <p className="muted" data-testid="rx-pdf-pending">
              {t(renderNote ?? 'rx.pdfPending')}
            </p>
          )}
          {current.clinicalStatus === 'VOID' ? (
            <p className="muted" data-testid="rx-pdf-void-notice">
              {t('rx.pdfVoidNotice')}
            </p>
          ) : null}
        </>
      ) : null}

      {current.clinicalStatus === 'APPROVED' ? (
        <>
          <button
            type="button"
            onClick={() => void act('/api/v1/prescriptions/{id}/corrections', {})}
            data-testid="rx-correction"
          >
            {t('rx.correction')}
          </button>
          <label htmlFor="rx-void-reason">{t('rx.voidReason')}</label>
          <input
            id="rx-void-reason"
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            data-testid="rx-void-reason"
          />
          <button
            type="button"
            disabled={voidReason.trim().length === 0}
            onClick={() =>
              void act('/api/v1/prescriptions/{id}/void', {
                expectedRowVersion: rowVersion.current,
                reason: voidReason.trim(),
              })
            }
            data-testid="rx-void"
          >
            {t('rx.void')}
          </button>
        </>
      ) : null}
    </section>
  );
}
