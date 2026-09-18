import { useI18n } from '../i18n/i18n';

export function LanguageToggle() {
  const { t, locale, setLocale } = useI18n();
  return (
    <button className="link" onClick={() => setLocale(locale === 'bn-BD' ? 'en-BD' : 'bn-BD')}>
      {t('nav.language')}
    </button>
  );
}
