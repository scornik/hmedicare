import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { ApiError, getTenant, useTenantContext } from '../api';
import { TopBar } from '../components/TopBar';
import { useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
import {
  type QueueEntry,
  type QueueSnapshot,
  useQueueSnapshot,
  useReorderQueue,
  useConsultationCommand,
  useSerialCommand,
  useSkipSerial,
} from '../queue/api';

/** Statuses a receptionist can still act on; everything else is history for the day. */
const ACTIVE = new Set(['CHECKED_IN', 'WAITING', 'CALLED', 'IN_CONSULTATION']);

/** Every SerialStatus has a `queue.status.*` message in both locales (asserted by the messages test). */
const statusKey = (status: QueueEntry['status']): MessageKey => `queue.status.${status}` as MessageKey;

/**
 * The live queue board of one chamber day (WEB §4, QUEUE §3.5). It polls the snapshot every five seconds
 * and reconciles: a click updates the row at once, the server's answer replaces it, and the next poll is
 * the truth. Positions can be dragged; the reorder carries the `queueOrderVersion` the board was rendered
 * from, so two receptionists dragging at once cannot silently overwrite one another.
 */
export function QueueBoardPage() {
  const { t } = useI18n();
  const { chamberDayId } = useParams<{ chamberDayId: string }>();
  const tenant = getTenant();
  const ctx = useTenantContext(tenant);
  const snapshot = useQueueSnapshot(chamberDayId ?? null);

  if (!tenant) return <Navigate to="/select-tenant" replace />;
  if (!chamberDayId) return <Navigate to="/dashboard" replace />;
  if (ctx.data && !ctx.data.permissions.includes('queue.read')) return <Navigate to="/forbidden" replace />;
  if (snapshot.error instanceof ApiError && snapshot.error.status === 403)
    return <Navigate to="/forbidden" replace />;

  return (
    <>
      <TopBar />
      <main className="card">
        <h1>{t('queue.title')}</h1>
        {snapshot.isPending && <p>{t('common.loading')}</p>}
        {snapshot.data && <Board day={chamberDayId} snapshot={snapshot.data} />}
      </main>
    </>
  );
}

function Board({ day, snapshot }: { day: string; snapshot: QueueSnapshot }) {
  const { t } = useI18n();
  const reorder = useReorderQueue(day);
  const [conflict, setConflict] = useState(false);
  // While a drag is in progress the poll would yank rows out from under the cursor, so the board renders a
  // local order until the drop resolves.
  const [dragging, setDragging] = useState<string | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const liveOrder = snapshot.entries.filter((e) => ACTIVE.has(e.status)).map((e) => e.serialId);
  const shown = order ?? liveOrder;
  const byId = new Map(snapshot.entries.map((e) => [e.serialId, e]));

  // Drop the local order once the server's snapshot matches it, so polling takes over again.
  const settled = useRef(snapshot.queueOrderVersion);
  useEffect(() => {
    if (order && snapshot.queueOrderVersion !== settled.current) {
      settled.current = snapshot.queueOrderVersion;
      setOrder(null);
    }
  }, [order, snapshot.queueOrderVersion]);

  const drop = (targetId: string) => {
    if (!dragging || dragging === targetId) return setDragging(null);
    const next = shown.filter((id) => id !== dragging);
    next.splice(next.indexOf(targetId), 0, dragging);
    setDragging(null);
    setOrder(next);
    setConflict(false);
    reorder.mutate(
      { expectedQueueOrderVersion: snapshot.queueOrderVersion, orderedSerialIds: next },
      {
        onError: (e) => {
          setOrder(null);
          if (e instanceof ApiError && e.code === 'QUEUE_VERSION_CONFLICT') setConflict(true);
        },
      },
    );
  };

  return (
    <>
      <p className="muted" data-testid="queue-counts">
        {t('queue.waiting')}: {snapshot.counts.waiting} · {t('queue.called')}: {snapshot.counts.called} ·{' '}
        {t('queue.inConsultation')}: {snapshot.counts.inConsultation} · {t('queue.completed')}:{' '}
        {snapshot.counts.completed}
      </p>
      {snapshot.expectedDelayMinutes !== null && (
        <p className="muted">
          {t('queue.delay')}: {snapshot.expectedDelayMinutes}
        </p>
      )}
      {conflict && (
        <p role="alert" data-testid="queue-conflict">
          {t('queue.reorderConflict')}
        </p>
      )}
      <ol className="list" data-testid="queue-entries">
        {shown.map((id) => {
          const entry = byId.get(id);
          return entry ? (
            <Row
              key={id}
              day={day}
              entry={entry}
              onDragStart={() => setDragging(id)}
              onDrop={() => drop(id)}
            />
          ) : null;
        })}
      </ol>
      {snapshot.entries.length === 0 && <p>{t('queue.empty')}</p>}
    </>
  );
}

function Row({
  day,
  entry,
  onDragStart,
  onDrop,
}: {
  day: string;
  entry: QueueEntry;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  const { t } = useI18n();
  const command = useSerialCommand(day);
  const consultation = useConsultationCommand(day);
  const skip = useSkipSerial(day);
  const [stale, setStale] = useState(false);
  const navigate = useNavigate();
  // Hoisted so the narrowing survives into the click handler.
  const encounterId = entry.encounterId;

  const run = (
    c: Parameters<typeof command.mutate>[0]['command'],
    optimisticStatus?: QueueEntry['status'],
  ) => {
    setStale(false);
    command.mutate(
      { command: c, serialId: entry.serialId, expectedRowVersion: entry.rowVersion, optimisticStatus },
      {
        onError: (e) => {
          if (e instanceof ApiError && (e.code === 'STALE_VERSION' || e.code === 'QUEUE_STATE_CONFLICT'))
            setStale(true);
        },
      },
    );
  };

  /** Errors from the encounter routes read the same as queue ones: a stale row is a stale row. */
  const onConsultationError = (e: unknown) => {
    if (e instanceof ApiError && (e.code === 'STALE_VERSION' || e.code === 'QUEUE_STATE_CONFLICT'))
      setStale(true);
  };

  return (
    <li
      className="row"
      data-testid={`queue-row-${entry.serialNumber}`}
      data-status={entry.status}
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <span className="serial">#{entry.serialNumber}</span>
      <span>
        {entry.medicalRecordNumber} · {entry.patientDisplayName}
      </span>
      <span className="muted">{t(statusKey(entry.status))}</span>
      {entry.lateArrival && <span className="muted">{t('queue.late')}</span>}
      {entry.status === 'CHECKED_IN' && (
        <button onClick={() => run('mark-waiting', 'WAITING')}>{t('queue.action.waiting')}</button>
      )}
      {entry.status === 'WAITING' && (
        <button onClick={() => run('call', 'CALLED')}>{t('queue.action.call')}</button>
      )}
      {entry.status === 'CALLED' && (
        <>
          <button onClick={() => run('recall')}>{t('queue.action.recall')}</button>
          <button
            onClick={() => {
              setStale(false);
              consultation.mutate(
                { command: 'start', serialId: entry.serialId, expectedRowVersion: entry.rowVersion },
                {
                  onError: onConsultationError,
                  onSuccess: (encounter) => navigate(`/consultations/${encounter.id}`),
                },
              );
            }}
          >
            {t('queue.action.start')}
          </button>
          <SkipButton entry={entry} skip={skip} />
        </>
      )}
      {/* Already in the room: back to the note rather than starting again. */}
      {entry.status === 'IN_CONSULTATION' && encounterId !== null && (
        <Link to={`/consultations/${encounterId}`} data-testid={`open-${entry.serialId}`}>
          {t('nav.consultation')}
        </Link>
      )}
      {entry.status === 'IN_CONSULTATION' && encounterId !== null && (
        <button
          onClick={() => {
            setStale(false);
            consultation.mutate({ command: 'complete', encounterId }, { onError: onConsultationError });
          }}
        >
          {t('queue.action.complete')}
        </button>
      )}
      {stale && <span role="alert">{t('common.stale')}</span>}
    </li>
  );
}

/** Skipping needs a reason; it is recorded on the queue chain and shown in the day's history. */
function SkipButton({ entry, skip }: { entry: QueueEntry; skip: ReturnType<typeof useSkipSerial> }) {
  const { t } = useI18n();
  const [reason, setReason] = useState<string | null>(null);
  if (reason === null) return <button onClick={() => setReason('')}>{t('queue.action.skip')}</button>;
  return (
    <span>
      <label>
        {t('queue.skipReason')}
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button
        disabled={reason.trim().length < 3}
        onClick={() =>
          skip.mutate(
            { serialId: entry.serialId, expectedRowVersion: entry.rowVersion, reason: reason.trim() },
            { onSuccess: () => setReason(null) },
          )
        }
      >
        {t('queue.action.skip')}
      </button>
    </span>
  );
}
