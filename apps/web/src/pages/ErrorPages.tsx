import { Link } from 'react-router';
import { useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';

function ErrorPage({ code, message }: { code: string; message: MessageKey }) {
  const { t } = useI18n();
  return (
    <main className="card narrow center">
      <h1>{code}</h1>
      <p>{t(message)}</p>
      <Link to="/">{t('common.back')}</Link>
    </main>
  );
}

export const ForbiddenPage = () => <ErrorPage code="403" message="error.forbidden" />;
export const NotFoundPage = () => <ErrorPage code="404" message="error.notFound" />;
export function OfflinePage() {
  const { t } = useI18n();
  return (
    <main className="card narrow center" role="alert">
      <p>{t('error.offline')}</p>
    </main>
  );
}
