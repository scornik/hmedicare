import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { patientApi } from '../api';
import { currentUser } from '../auth/session';
import { useI18n } from '../i18n/i18n';
import { uploadEncounterDocument } from './upload';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

export function PatientUploadPanel({ tenantId, patientId }: { tenantId: string; patientId: string }) {
  const { t, locale } = useI18n();
  const [encounterId, setEncounterId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const headers = { 'X-Tenant-ID': tenantId, 'X-Patient-Context': patientId };
  const capability = useQuery({
    queryKey: ['patient-upload-capability', currentUser()?.id, tenantId, patientId],
    staleTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await patientApi.GET('/api/v1/documents/upload-capability', {
        signal,
        params: { header: headers },
      });
      if (result.error || !result.data) throw new Error('Upload capability unavailable');
      return result.data.data.enabled;
    },
  });
  const encounters = useQuery({
    queryKey: ['patient-upload-encounters', currentUser()?.id, tenantId, patientId],
    staleTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await patientApi.GET('/api/v1/documents/patient/upload-encounters', {
        signal,
        params: { header: headers },
      });
      if (result.error || !result.data) throw new Error('Upload encounters unavailable');
      return result.data.data.items;
    },
  });
  const selectedVisit = encounters.data?.some((encounter) => encounter.id === encounterId) ?? false;
  const fileValid =
    !!file && file.size > 0 && file.size <= MAX_FILE_BYTES && ALLOWED_TYPES.includes(file.type);
  const upload = useMutation({
    mutationFn: () =>
      uploadEncounterDocument({
        encounterId,
        patientId,
        category: 'LAB_REPORT',
        file: file!,
        patientContext: { tenantId, patientId },
        onProgress: (completed, total) => setProgress({ completed, total }),
      }),
    onMutate: () => setProgress(null),
    onSuccess: () => {
      setFile(null);
      setFileKey((key) => key + 1);
      setProgress(null);
    },
  });

  return (
    <section
      className="card patient-upload"
      aria-labelledby="patient-upload-title"
      data-testid="patient-upload"
    >
      <h2 id="patient-upload-title">{t('records.uploadTitle')}</h2>
      <p className="muted">{t('records.uploadHelp')}</p>
      {capability.isPending && <p role="status">{t('common.loading')}</p>}
      {capability.isError && <p role="alert">{t('records.uploadCheckFailed')}</p>}
      {capability.data === false && <p>{t('documents.uploadUnavailable')}</p>}
      {capability.data === true && (
        <>
          {encounters.isPending && <p role="status">{t('common.loading')}</p>}
          {encounters.isError && (
            <p role="alert">
              {t('records.visitsFailed')}{' '}
              <button type="button" onClick={() => void encounters.refetch()}>
                {t('documents.retry')}
              </button>
            </p>
          )}
          {encounters.data?.length === 0 && <p>{t('records.noVisits')}</p>}
          {encounters.data && encounters.data.length > 0 && (
            <form
              className="encounter-document-upload"
              onSubmit={(event) => {
                event.preventDefault();
                if (selectedVisit && fileValid && !upload.isPending) upload.mutate();
              }}
            >
              <label>
                {t('records.chooseVisit')}
                <select
                  value={encounterId}
                  onChange={(event) => {
                    setEncounterId(event.target.value);
                    upload.reset();
                  }}
                  disabled={upload.isPending}
                >
                  <option value="">{t('records.chooseVisitPlaceholder')}</option>
                  {encounters.data.map((encounter) => (
                    <option key={encounter.id} value={encounter.id}>
                      {new Date(encounter.startedAt).toLocaleDateString(locale)} ·{' '}
                      {t(`encounter.status.${encounter.status}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('records.chooseReport')}
                <input
                  key={fileKey}
                  type="file"
                  accept=".pdf,image/jpeg,image/png,image/webp"
                  disabled={upload.isPending}
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    upload.reset();
                  }}
                />
              </label>
              <button type="submit" disabled={!selectedVisit || !fileValid || upload.isPending}>
                {t('records.submitReport')}
              </button>
            </form>
          )}
          {file && !fileValid && <p role="alert">{t('documents.invalidFile')}</p>}
          {upload.isPending && (
            <p role="status">
              {t('documents.uploading')}
              {progress ? ` ${progress.completed}/${progress.total}` : ''}
            </p>
          )}
          {upload.isSuccess && <p role="status">{t('records.uploadSubmitted')}</p>}
          {upload.isError && <p role="alert">{t('documents.uploadFailed')}</p>}
        </>
      )}
    </section>
  );
}
