import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { ApiError, getTenant } from '../api';
import { TopBar } from '../components/TopBar';
import { useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
import { usePatient } from '../patients/api';
import {
  AUTOSAVE_DEBOUNCE_MS,
  type Diagnosis,
  type NoteDraft,
  useAddDiagnosis,
  useCompleteEncounter,
  useDiagnoses,
  useEncounter,
  useNoteDraft,
  useNoteRevisions,
  usePatientEncounters,
  useSaveDraft,
  useSignNote,
  useVoidDiagnosis,
} from '../clinical/api';

const SECTIONS = ['chiefComplaint', 'history', 'examination', 'assessment', 'plan'] as const;
type Section = (typeof SECTIONS)[number];
type Sections = Record<Section, string>;

/** What the doctor is told about their text right now. Only one of these is ever true. */
type SaveState =
  | { kind: 'idle' }
  | { kind: 'unsaved' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'conflict'; theirs: NoteDraft; mine: Sections }
  | { kind: 'failed' };

function sectionsOf(draft: NoteDraft): Sections {
  return {
    chiefComplaint: draft.chiefComplaint ?? '',
    history: draft.history ?? '',
    examination: draft.examination ?? '',
    assessment: draft.assessment ?? '',
    plan: draft.plan ?? '',
  };
}

/**
 * The consultation workspace (WEB-002, Stage 6 §6): one screen where a doctor calls up the patient in
 * front of them, writes, signs and finishes, without navigating anywhere.
 *
 * Three decisions drive the rest of this file.
 *
 * **Typed text is never lost and never silently overwritten.** The editor owns what the doctor typed;
 * autosave reports what the server did with it. A stale save does not retry and does not win — it stops
 * and shows both versions, because the other version is also something a clinician wrote.
 *
 * **Nothing clinical touches `localStorage`.** Unsent text lives in memory for the life of the tab. The
 * security documents allow browser storage for preferences, not for a patient's record, and a note left
 * in a shared consulting room's browser is a disclosure nobody chose.
 *
 * **Panels for later stages are labelled and empty.** Prescriptions, labs, the timeline and AI arrive in
 * Stages 7, 10 and 11. An empty panel that says so is honest; a mocked one teaches a doctor to expect
 * something that does not exist.
 */
export function ConsultationWorkspacePage() {
  const { t, locale } = useI18n();
  const { encounterId = '' } = useParams();
  const tenant = getTenant();

  const encounter = useEncounter(encounterId);
  const draft = useNoteDraft(encounterId);
  const diagnoses = useDiagnoses(encounterId);
  const save = useSaveDraft(encounterId);
  const sign = useSignNote(encounterId);
  const complete = useCompleteEncounter(encounterId);
  const patient = usePatient(encounter.data?.patientId ?? null);
  const history = usePatientEncounters(encounter.data?.patientId ?? null, encounterId);

  const [sections, setSections] = useState<Sections | null>(null);
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const [showHistory, setShowHistory] = useState(false);
  const revisions = useNoteRevisions(encounterId, showHistory);

  // The version the editor's text is based on. Held in a ref rather than state because the autosave
  // timer closes over it, and a stale closure here would send a version that is already spent.
  const version = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!draft.data || sections !== null) return;
    setSections(sectionsOf(draft.data));
    version.current = draft.data.rowVersion;
  }, [draft.data, sections]);

  const flush = useCallback(
    (next: Sections) => {
      if (version.current === null) return;
      setState({ kind: 'saving' });
      save.mutate(
        { expectedRowVersion: version.current, sections: next },
        {
          onSuccess: (saved) => {
            version.current = saved.rowVersion;
            setState({ kind: 'saved' });
          },
          onError: (e) => {
            if (e instanceof ApiError && e.code === 'STALE_VERSION') {
              // Stop. Retrying with the server's version would overwrite whatever the other window
              // wrote, which is the one outcome this whole mechanism exists to prevent.
              void draft.refetch().then((r) => {
                if (r.data) setState({ kind: 'conflict', theirs: r.data, mine: next });
              });
              return;
            }
            setState({ kind: 'failed' });
          },
        },
      );
    },
    [draft, save],
  );

  const edit = (section: Section, value: string) => {
    setSections((prev) => {
      const next = { ...(prev ?? ({} as Sections)), [section]: value };
      if (timer.current) clearTimeout(timer.current);
      // A conflict is not cleared by more typing: the doctor has to choose first.
      if (state.kind !== 'conflict') {
        setState({ kind: 'unsaved' });
        timer.current = setTimeout(() => flush(next), AUTOSAVE_DEBOUNCE_MS);
      }
      return next;
    });
  };

  const saveNow = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (sections) flush(sections);
  }, [flush, sections]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  // Leaving with text in flight would lose it, so the browser asks first. This is the only place the
  // page reaches outside React, and it reaches for a warning rather than for storage.
  useEffect(() => {
    const unsaved = state.kind === 'unsaved' || state.kind === 'conflict';
    if (!unsaved) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [state.kind]);

  // Keyboard-first: a doctor's hands are on the keyboard, and reaching for a mouse between patients is
  // the difference between forty consultations in an evening and thirty.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 's') {
        e.preventDefault();
        saveNow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveNow]);

  const signed = (draft.data?.lastSignedRevision ?? 0) > 0;
  const locked = draft.data?.status === 'SIGNED_LOCKED';
  const patientName = useMemo(() => {
    const p = patient.data;
    if (!p) return '';
    return locale === 'bn-BD' && p.legalNameBn ? p.legalNameBn : p.legalName;
  }, [patient.data, locale]);

  if (!tenant) return <Navigate to="/select-tenant" replace />;
  if (encounter.error instanceof ApiError && encounter.error.status === 404)
    return <Navigate to="/404" replace />;
  if (encounter.error instanceof ApiError && encounter.error.status === 403)
    return <Navigate to="/forbidden" replace />;

  return (
    <>
      <TopBar />
      <main className="workspace">
        <header className="card" data-testid="patient-header">
          <div className="row">
            <h1 data-testid="workspace-patient">{patientName || t('common.loading')}</h1>
            {patient.data?.medicalRecordNumber && (
              <span className="badge" data-testid="workspace-mrn">
                {patient.data.medicalRecordNumber}
              </span>
            )}
            {encounter.data && (
              <span className="badge" data-testid="encounter-status">
                {t(`encounter.status.${encounter.data.status}` as MessageKey)}
              </span>
            )}
            {encounter.data?.coveringDoctorProfileId && (
              <span className="badge" data-testid="covering-badge">
                {t('encounter.covering')}
              </span>
            )}
          </div>
        </header>

        <section className="card" aria-labelledby="note-heading">
          <div className="row">
            <h2 id="note-heading">{t('note.title')}</h2>
            <SaveIndicator state={state} />
          </div>

          {state.kind === 'conflict' && (
            <ConflictChooser
              theirs={state.theirs}
              mine={state.mine}
              onKeepMine={() => {
                version.current = state.theirs.rowVersion;
                flush(state.mine);
              }}
              onTakeTheirs={() => {
                setSections(sectionsOf(state.theirs));
                version.current = state.theirs.rowVersion;
                setState({ kind: 'idle' });
              }}
            />
          )}

          {sections &&
            SECTIONS.map((s) => (
              <label key={s} className="field">
                <span>{t(`note.section.${s}` as MessageKey)}</span>
                <textarea
                  data-testid={`note-${s}`}
                  rows={s === 'chiefComplaint' ? 2 : 4}
                  value={sections[s]}
                  disabled={locked}
                  onChange={(e) => edit(s, e.target.value)}
                  onBlur={saveNow}
                />
              </label>
            ))}

          <div className="row">
            <SignControls
              disabled={locked || state.kind === 'conflict' || !sections}
              signed={signed}
              onSign={(reason) => {
                if (version.current === null) return;
                saveNow();
                sign.mutate(
                  { expectedRowVersion: version.current, ...(reason ? { correctionReason: reason } : {}) },
                  {
                    onSuccess: () =>
                      void draft.refetch().then((r) => {
                        if (r.data) version.current = r.data.rowVersion;
                      }),
                  },
                );
              }}
            />
            <button
              data-testid="complete-encounter"
              disabled={!encounter.data || encounter.data.status === 'COMPLETED'}
              onClick={() => {
                if (!encounter.data) return;
                complete.mutate({ expectedRowVersion: encounter.data.rowVersion });
              }}
            >
              {t('encounter.action.complete')}
            </button>
            <button data-testid="toggle-revisions" onClick={() => setShowHistory((v) => !v)}>
              {t('note.revisions')}
            </button>
          </div>

          {showHistory && (
            <ol data-testid="revision-list">
              {(revisions.data ?? []).map((r) => (
                <li key={r.id}>
                  <strong>#{r.revision}</strong>{' '}
                  <time dateTime={r.signedAt}>{new Date(r.signedAt).toLocaleString(locale)}</time>
                  {r.correctionReason && <em> — {r.correctionReason}</em>}
                </li>
              ))}
            </ol>
          )}
        </section>

        <DiagnosesPanel
          encounterId={encounterId}
          diagnoses={diagnoses.data ?? []}
          canEdit={!locked}
          signed={signed}
        />

        <section className="card" aria-labelledby="history-heading">
          <h2 id="history-heading">{t('encounter.history')}</h2>
          {history.isPending && <p>{t('common.loading')}</p>}
          {(history.data ?? []).length === 0 && !history.isPending && <p>{t('encounter.noHistory')}</p>}
          <ul data-testid="encounter-history">
            {(history.data ?? []).map((e) => (
              <li key={e.id}>
                <Link to={`/consultations/${e.id}`}>
                  <time dateTime={e.startedAt}>{new Date(e.startedAt).toLocaleDateString(locale)}</time>
                </Link>{' '}
                <span className="muted">{t(`encounter.status.${e.status}` as MessageKey)}</span>{' '}
                {e.signedRevisions > 0 ? (
                  <span className="badge">
                    {t('note.signedCount').replace('{n}', `${e.signedRevisions}`)}
                  </span>
                ) : (
                  <span className="muted">{t('note.noNote')}</span>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* Stages 7, 10 and 11. Labelled and empty on purpose: a mocked panel here would teach a doctor
            to expect a prescription pad that does not exist yet. */}
        {(['prescriptions', 'labs', 'timeline', 'ai'] as const).map((key) => (
          <section className="card muted" key={key} data-testid={`panel-${key}`}>
            <h2>{t(`workspace.panel.${key}` as MessageKey)}</h2>
            <p>{t('workspace.panel.later')}</p>
          </section>
        ))}
      </main>
    </>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const { t } = useI18n();
  const key: MessageKey =
    state.kind === 'saving'
      ? 'note.saving'
      : state.kind === 'saved'
        ? 'note.saved'
        : state.kind === 'unsaved'
          ? 'note.unsaved'
          : state.kind === 'conflict'
            ? 'note.conflict'
            : state.kind === 'failed'
              ? 'note.saveFailed'
              : 'note.ready';
  return (
    <span
      data-testid="save-state"
      data-state={state.kind}
      role={state.kind === 'conflict' || state.kind === 'failed' ? 'alert' : undefined}
    >
      {t(key)}
    </span>
  );
}

/**
 * Both versions, side by side, and no default. The doctor decides which text is the record; the software
 * does not get to pick on their behalf.
 */
function ConflictChooser({
  theirs,
  mine,
  onKeepMine,
  onTakeTheirs,
}: {
  theirs: NoteDraft;
  mine: Sections;
  onKeepMine: () => void;
  onTakeTheirs: () => void;
}) {
  const { t } = useI18n();
  const server = sectionsOf(theirs);
  const changed = SECTIONS.filter((s) => server[s] !== mine[s]);
  return (
    <div className="conflict" role="alert" data-testid="conflict">
      <p>{t('note.conflictExplain')}</p>
      {changed.map((s) => (
        <div key={s} className="conflict-section">
          <h3>{t(`note.section.${s}` as MessageKey)}</h3>
          <div className="row">
            <pre data-testid={`conflict-mine-${s}`}>{mine[s]}</pre>
            <pre data-testid={`conflict-theirs-${s}`}>{server[s]}</pre>
          </div>
        </div>
      ))}
      <div className="row">
        <button data-testid="conflict-keep-mine" onClick={onKeepMine}>
          {t('note.keepMine')}
        </button>
        <button data-testid="conflict-take-theirs" onClick={onTakeTheirs}>
          {t('note.takeTheirs')}
        </button>
      </div>
    </div>
  );
}

/** Signing once, then amending with a reason. The reason field only appears when one is required. */
function SignControls({
  disabled,
  signed,
  onSign,
}: {
  disabled: boolean;
  signed: boolean;
  onSign: (reason?: string) => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState<string | null>(null);

  if (!signed) {
    return (
      <button data-testid="sign-note" disabled={disabled} onClick={() => onSign()}>
        {t('note.sign')}
      </button>
    );
  }
  if (reason === null) {
    return (
      <button data-testid="amend-note" disabled={disabled} onClick={() => setReason('')}>
        {t('note.amend')}
      </button>
    );
  }
  return (
    <span className="row">
      <input
        data-testid="amend-reason"
        value={reason}
        placeholder={t('note.amendReason')}
        onChange={(e) => setReason(e.target.value)}
      />
      <button
        data-testid="amend-confirm"
        disabled={reason.trim().length < 3}
        onClick={() => {
          onSign(reason.trim());
          setReason(null);
        }}
      >
        {t('note.amendConfirm')}
      </button>
    </span>
  );
}

function DiagnosesPanel({
  encounterId,
  diagnoses,
  canEdit,
  signed,
}: {
  encounterId: string;
  diagnoses: Diagnosis[];
  canEdit: boolean;
  signed: boolean;
}) {
  const { t } = useI18n();
  const add = useAddDiagnosis(encounterId);
  const voidOne = useVoidDiagnosis(encounterId);
  const [display, setDisplay] = useState('');
  const [voiding, setVoiding] = useState<{ id: string; rowVersion: number; reason: string } | null>(null);

  return (
    <section className="card" aria-labelledby="dx-heading" data-testid="diagnoses-panel">
      <h2 id="dx-heading">{t('diagnosis.title')}</h2>
      <ul>
        {diagnoses.map((d) => (
          <li key={d.id} data-testid={`diagnosis-${d.id}`}>
            <span className={d.clinicalStatus === 'ENTERED_IN_ERROR' ? 'muted strike' : undefined}>
              {d.display}
            </span>{' '}
            <span className="badge">{t(`diagnosis.certainty.${d.certainty}` as MessageKey)}</span>
            {d.clinicalStatus === 'ENTERED_IN_ERROR' ? (
              <em className="muted"> — {d.voidReason}</em>
            ) : (
              canEdit && (
                <button
                  data-testid={`void-${d.id}`}
                  onClick={() => setVoiding({ id: d.id, rowVersion: d.rowVersion, reason: '' })}
                >
                  {t('diagnosis.void')}
                </button>
              )
            )}
          </li>
        ))}
      </ul>

      {voiding && (
        <div className="row" role="group">
          <input
            data-testid="void-reason"
            value={voiding.reason}
            placeholder={t('diagnosis.voidReason')}
            onChange={(e) => setVoiding({ ...voiding, reason: e.target.value })}
          />
          <button
            data-testid="void-confirm"
            disabled={voiding.reason.trim().length < 3}
            onClick={() => {
              voidOne.mutate({
                id: voiding.id,
                expectedRowVersion: voiding.rowVersion,
                reason: voiding.reason.trim(),
              });
              setVoiding(null);
            }}
          >
            {t('diagnosis.voidConfirm')}
          </button>
        </div>
      )}

      {canEdit && (
        <div className="row">
          <input
            data-testid="diagnosis-input"
            value={display}
            placeholder={t('diagnosis.add')}
            onChange={(e) => setDisplay(e.target.value)}
          />
          <button
            data-testid="diagnosis-add"
            disabled={display.trim().length === 0}
            onClick={() => {
              add.mutate({ display: display.trim(), certainty: 'PROVISIONAL' });
              setDisplay('');
            }}
          >
            {t('diagnosis.addAction')}
          </button>
        </div>
      )}
      {/* After signing, a diagnosis is withdrawn and replaced rather than edited: something may already
          have been decided on the strength of it. */}
      {signed && <p className="muted">{t('diagnosis.signedHint')}</p>}
    </section>
  );
}
