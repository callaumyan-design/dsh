import { useState } from 'react';
import { Cloud, KeyRound, Layers, MonitorSmartphone } from 'lucide-react';
import { Button, Input } from '@/components/ui/primitives';
import { Logo } from '@/components/layout/Logo';
import { login, register, useAuth } from '@/store/auth';
import { useT } from '@/i18n';

export function AuthPage() {
  const t = useT();
  const status = useAuth((s) => s.status);
  const firstRun = status ? !status.hasUsers : false;
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isRegister = firstRun || mode === 'register';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (isRegister && password !== confirm) {
      setError(t('auth.mismatch'));
      return;
    }
    setBusy(true);
    try {
      if (isRegister) await register(username.trim(), password);
      else await login(username.trim(), password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const features = [
    { icon: <Layers className="size-4" />, text: t('auth.f1') },
    { icon: <MonitorSmartphone className="size-4" />, text: t('auth.f2') },
    { icon: <Cloud className="size-4" />, text: t('auth.f3') },
    { icon: <KeyRound className="size-4" />, text: t('auth.f4') },
  ];

  return (
    <div className="flex min-h-full items-center justify-center overflow-y-auto bg-soft px-4 py-10">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-3xl border border-line bg-elevated shadow-pop md:grid-cols-2">
        <div className="relative hidden flex-col justify-between overflow-hidden bg-[linear-gradient(135deg,var(--accent),color-mix(in_oklab,var(--accent)_45%,#0ea5e9))] p-10 text-white md:flex">
          <div className="absolute -top-24 -right-24 size-72 rounded-full bg-white/10" />
          <div className="absolute -bottom-32 -left-20 size-80 rounded-full bg-white/5" />
          <div className="relative flex items-center gap-2.5">
            <Logo className="size-9 [&_rect]:fill-white/20" />
            <span className="text-lg font-semibold">OmniChat</span>
          </div>
          <div className="relative">
            <h2 className="text-2xl leading-snug font-semibold">{t('auth.tagline')}</h2>
            <ul className="mt-6 space-y-3 text-sm text-white/90">
              {features.map((f, i) => (
                <li key={i} className="flex items-center gap-2.5">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-white/15">{f.icon}</span>
                  {f.text}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative text-xs text-white/60">v{status?.version ?? ''}</div>
        </div>

        <form onSubmit={submit} className="flex flex-col justify-center p-8 sm:p-10">
          <div className="mb-6 flex items-center gap-2.5 md:hidden">
            <Logo className="size-9" />
            <span className="text-lg font-semibold">OmniChat</span>
          </div>
          <h1 className="text-xl font-semibold">{firstRun ? t('auth.setupTitle') : isRegister ? t('auth.registerTitle') : t('auth.loginTitle')}</h1>
          <p className="mt-1.5 text-sm text-fg-muted">{firstRun ? t('auth.setupDesc') : isRegister ? t('auth.registerDesc') : t('auth.loginDesc')}</p>
          {!status && <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">{t('auth.serverDown')}</p>}

          <div className="mt-6 space-y-3">
            <Input autoFocus autoComplete="username" placeholder={t('auth.username')} value={username} onChange={(e) => setUsername(e.target.value)} />
            <Input
              type="password"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              placeholder={t('auth.password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {isRegister && (
              <Input type="password" autoComplete="new-password" placeholder={t('auth.confirm')} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            )}
          </div>
          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
          <Button type="submit" variant="primary" className="mt-5 w-full" loading={busy} disabled={!username.trim() || password.length < 1}>
            {isRegister ? (firstRun ? t('auth.createAdmin') : t('auth.register')) : t('auth.login')}
          </Button>
          {!firstRun && status?.allowRegister && (
            <button
              type="button"
              className="mt-4 text-center text-sm text-fg-muted hover:text-fg"
              onClick={() => {
                setMode(isRegister ? 'login' : 'register');
                setError(null);
              }}
            >
              {isRegister ? t('auth.haveAccount') : t('auth.noAccount')}
            </button>
          )}
          {!firstRun && !status?.allowRegister && status && <p className="mt-4 text-center text-xs text-fg-subtle">{t('auth.closed')}</p>}
        </form>
      </div>
    </div>
  );
}
