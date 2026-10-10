import { useInfiniteQuery } from '@tanstack/react-query';
import { ApiError, api, patientApi, getTenant } from '../api';
import { currentUser } from '../auth/session';
import { useI18n } from '../i18n/i18n';
import { MESSAGES, type MessageKey } from '../i18n/messages';
export function TimelinePanel({
  patientId,
  patientContext,
}: {
  patientId: string;
  patientContext?: { tenantId: string };
}) {
  const { t, locale } = useI18n();
  const tenant = patientContext?.tenantId ?? getTenant(),
    user = currentUser();
  const query = useInfiniteQuery({
    queryKey: ['timeline', user?.id, tenant, patientId, patientContext ? 'patient' : 'staff'],
    enabled: !!user && !!tenant,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const r = await (patientContext ? patientApi : api).GET('/api/v1/patients/{id}/timeline', {
        signal,
        params: {
          path: { id: patientId },
          header: { 'X-Tenant-ID': tenant!, ...(patientContext ? { 'X-Patient-Context': patientId } : {}) },
          query: { limit: 25, ...(pageParam ? { cursor: pageParam } : {}) },
        },
      });
      if (r.error || !r.data) throw new ApiError(r.response.status, r.error?.code ?? 'ERROR');
      return r.data.data;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = query.error ? [] : (query.data?.pages.flatMap((page) => page.items) ?? []);
  return (
    <section className="card" aria-label={t('timeline.title')} data-testid="patient-timeline">
      <div className="row">
        <h2>{t('timeline.title')}</h2>
        <button
          onClick={() => {
            void query.refetch();
          }}
          disabled={query.isFetching}
        >
          {t('timeline.refresh')}
        </button>
      </div>
      {query.isPending && <p>{t('common.loading')}</p>}
      {query.error && (
        <p role="alert">
          {t(
            query.error instanceof ApiError && query.error.status === 403
              ? 'timeline.denied'
              : 'timeline.failed',
          )}
        </p>
      )}
      {!query.error && query.data?.pages.some((p) => p.stale) && <p role="status">{t('timeline.stale')}</p>}
      {!query.isPending && !query.error && items.length === 0 && <p>{t('timeline.empty')}</p>}
      <ol>
        {items.map((item) => {
          const key = (
            item.summary === 'Note amended' ? 'timeline.amended' : `timeline.${item.eventType}`
          ) as MessageKey;
          return (
            <li key={item.id}>
              <time dateTime={item.occurredAt}>
                {new Date(item.occurredAt).toLocaleString(locale, { timeZone: 'Asia/Dhaka' })}
              </time>{' '}
              <span>{key in MESSAGES[locale] ? t(key) : t('timeline.record')}</span>
            </li>
          );
        })}
      </ol>
      {!query.error && query.hasNextPage && (
        <button
          onClick={() => {
            void query.fetchNextPage();
          }}
          disabled={query.isFetching}
        >
          {t('timeline.more')}
        </button>
      )}
    </section>
  );
}
