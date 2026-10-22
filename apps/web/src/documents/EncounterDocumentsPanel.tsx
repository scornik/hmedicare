import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, getTenant } from '../api';
import { useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
import { downloadDocument } from './download';

const categoryKeys: Record<string, MessageKey> = {
  PRESCRIPTION_PDF: 'documents.category.prescription',
  LAB_REPORT: 'documents.category.lab',
  IMAGE: 'documents.category.image',
  REFERRAL: 'documents.category.referral',
  OTHER: 'documents.category.other',
};

export function EncounterDocumentsPanel({ encounterId }: { encounterId: string }) {
  const { t, locale } = useI18n();
  const tenant = getTenant();
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['encounter-documents', tenant, encounterId, page],
    queryFn: async () => {
      const result = await api.GET('/api/v1/documents/by-encounter/{encounterId}', {
        params: {
          header: { 'X-Tenant-ID': tenant ?? '' },
          path: { encounterId },
          query: { page },
        },
      });
      if (result.error || !result.data) throw new Error('Document list unavailable');
      return result.data.data;
    },
  });
  const download = useMutation({
    mutationFn: downloadDocument,
  });

  return (
    <section
      className="card encounter-documents"
      aria-labelledby="encounter-documents-heading"
      data-testid="panel-documents"
    >
      <div className="row">
        <h2 id="encounter-documents-heading">{t('documents.title')}</h2>
        <button type="button" onClick={() => void list.refetch()} disabled={list.isFetching}>
          {t('documents.refresh')}
        </button>
      </div>
      {list.isPending && <p role="status">{t('common.loading')}</p>}
      {list.isError && (
        <p role="alert">
          {t('documents.listFailed')}{' '}
          <button type="button" onClick={() => void list.refetch()}>
            {t('documents.retry')}
          </button>
        </p>
      )}
      {list.data && list.data.items.length === 0 && <p className="muted">{t('documents.empty')}</p>}
      {list.data && list.data.items.length > 0 && (
        <ul className="encounter-document-list" data-testid="encounter-documents">
          {list.data.items.map((document) => (
            <li key={document.id}>
              <div>
                <strong>
                  {document.title || t(categoryKeys[document.category] ?? 'documents.category.other')}
                </strong>
                <span className="muted">
                  {t(categoryKeys[document.category] ?? 'documents.category.other')} ·{' '}
                  <time dateTime={document.createdAt}>
                    {new Date(document.createdAt).toLocaleDateString(locale)}
                  </time>
                </span>
              </div>
              <button
                type="button"
                disabled={download.isPending}
                onClick={() => download.mutate(document.id)}
                aria-label={`${t('documents.download')}: ${document.title || t(categoryKeys[document.category] ?? 'documents.category.other')}`}
              >
                {t('documents.download')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {download.isError && <p role="alert">{t('documents.downloadFailed')}</p>}
      {list.data && (page > 1 || list.data.hasMore) && (
        <div className="row encounter-documents-pages">
          <button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>
            {t('documents.previous')}
          </button>
          <span>{t('documents.page').replace('{n}', String(page))}</span>
          <button type="button" disabled={!list.data.hasMore} onClick={() => setPage((value) => value + 1)}>
            {t('documents.next')}
          </button>
        </div>
      )}
    </section>
  );
}
