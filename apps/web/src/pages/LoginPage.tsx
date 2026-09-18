import { type FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useSignedIn } from '../auth/hooks';
import { loginWithPassword, requestOtp, verifyOtp } from '../auth/session';
import { LanguageToggle } from '../components/LanguageToggle';
import { useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';

export function LoginPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const signedIn = useSignedIn();
  const [mode, setMode] = useState<'staff' | 'patient'>('staff');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [hint, setHint] = useState<MessageKey | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  if (signedIn) return <Navigate to="/select-tenant" replace />;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setFailed(false);
    try {
      await fn();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const onPassword = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await loginWithPassword(email, password);
      setPassword('');
      await navigate('/select-tenant');
    });
  };
  const onRequestOtp = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await requestOtp(phone, locale);
      setHint(`otp.hint.${r.hint}` as MessageKey);
    });
  };
  const onVerifyOtp = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await verifyOtp(phone, code);
      setCode('');
      await navigate('/select-tenant');
    });
  };

  return (
    <main className="card narrow">
      <header className="row">
        <h1>{t('login.title')}</h1>
        <LanguageToggle />
      </header>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'staff'} onClick={() => setMode('staff')}>
          {t('login.staff')}
        </button>
        <button role="tab" aria-selected={mode === 'patient'} onClick={() => setMode('patient')}>
          {t('login.patient')}
        </button>
      </div>
      {mode === 'staff' ? (
        <form onSubmit={onPassword}>
          <label>
            {t('login.email')}
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            {t('login.password')}
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button type="submit" disabled={busy}>
            {t('login.submit')}
          </button>
        </form>
      ) : (
        <>
          <form onSubmit={onRequestOtp}>
            <label>
              {t('otp.phone')}
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              {t('otp.send')}
            </button>
          </form>
          {hint && <p role="status">{t(hint)}</p>}
          {hint && (
            <form onSubmit={onVerifyOtp}>
              <label>
                {t('otp.code')}
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </label>
              <button type="submit" disabled={busy}>
                {t('otp.verify')}
              </button>
            </form>
          )}
        </>
      )}
      {failed && <p role="alert">{t('login.failed')}</p>}
    </main>
  );
}
