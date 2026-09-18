import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';
import { type Locale, MESSAGES, type MessageKey } from './messages';

interface I18n {
  locale: Locale;
  t: (key: MessageKey) => string;
  setLocale: (l: Locale) => void;
}

const LOCALE_KEY = 'hm.locale'; // UI preference only (not a secret, not auth state).
const Ctx = createContext<I18n | null>(null);

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_KEY);
    if (saved === 'bn-BD' || saved === 'en-BD') return saved;
  } catch {
    /* storage unavailable */
  }
  return 'bn-BD';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  useEffect(() => {
    document.documentElement.lang = locale === 'bn-BD' ? 'bn' : 'en';
    try {
      localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      /* ignore */
    }
  }, [locale]);
  const value = useMemo<I18n>(
    () => ({ locale, setLocale, t: (key) => MESSAGES[locale][key] ?? MESSAGES['bn-BD'][key] }),
    [locale],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('I18nProvider missing');
  return v;
}
