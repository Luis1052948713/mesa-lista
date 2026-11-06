'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Logo } from '@/components/Logo';
import { createClient } from '@/lib/supabase/client';

function friendly(message: string) {
  if (/invalid login credentials/i.test(message)) return 'Correo o contraseña incorrectos.';
  if (/already registered/i.test(message)) return 'Ya existe una cuenta con ese correo. Entra con tu contraseña.';
  if (/email not confirmed/i.test(message)) return 'Confirma tu correo antes de entrar. Revisa tu bandeja de entrada.';
  if (/password should be at least/i.test(message)) return 'La contraseña debe tener al menos 8 caracteres.';
  // El correo gratis de Supabase solo envía unos pocos correos por hora en todo el proyecto.
  if (/email rate limit/i.test(message)) {
    return 'Por ahora no pudimos enviar el correo de confirmación: se alcanzó el límite de correos por hora. Intenta de nuevo en una hora o pide al administrador que active la entrada sin confirmar el correo.';
  }
  if (/rate limit/i.test(message)) return 'Demasiados intentos seguidos. Espera unos minutos y vuelve a intentar.';
  return message;
}

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<'entrar' | 'crear'>('entrar');
  const [email, setEmail] = useState('');
  const [business, setBusiness] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    if (mode === 'crear' && business.trim().length < 2) return setError('Escribe el nombre de tu negocio.');
    if (mode === 'crear' && password.length < 8) return setError('La contraseña debe tener al menos 8 caracteres.');
    setBusy(true);
    const supabase = createClient();
    if (mode === 'entrar') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setBusy(false);
      if (error) return setError(friendly(error.message));
      router.replace('/hoy');
      router.refresh();
    } else {
      const { data, error } = await supabase.auth.signUp({
        // El nombre del negocio va con el usuario: los correos de confirmación y recuperación lo usan.
        email, password, options: { emailRedirectTo: `${window.location.origin}/auth/callback`, data: { business_name: business.trim().slice(0, 60) } },
      });
      setBusy(false);
      if (error) return setError(friendly(error.message));
      if (data.session) {
        router.replace('/onboarding');
        router.refresh();
      } else {
        setInfo(`Te enviamos un correo a ${email}. Abre el enlace para activar tu cuenta.`);
      }
    }
  }

  async function resetPassword() {
    setError('');
    if (!email) return setError('Escribe tu correo y vuelve a tocar "Olvidé mi contraseña".');
    const { error } = await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/nueva-clave`,
    });
    if (error) return setError(friendly(error.message));
    setInfo(`Te enviamos un enlace a ${email} para crear una contraseña nueva.`);
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="row" style={{ gap: 12 }}>
          <Logo />
          <div><h1 style={{ fontSize: 26 }}>Mesa Lista</h1><span className="muted">Reservas, compras y recordatorios</span></div>
        </div>
        <div className="auth-switch" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'entrar'} className={mode === 'entrar' ? 'on' : ''} onClick={() => setMode('entrar')}>Entrar</button>
          <button type="button" role="tab" aria-selected={mode === 'crear'} className={mode === 'crear' ? 'on' : ''} onClick={() => setMode('crear')}>Crear cuenta</button>
        </div>
        <form onSubmit={submit} noValidate>
          {mode === 'crear' && (
            <div className="field">
              <label htmlFor="business">Nombre de tu negocio</label>
              <input id="business" type="text" autoComplete="organization" maxLength={60} value={business}
                onChange={(e) => setBusiness(e.target.value)} placeholder="Ej. Fogón 38" />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">Correo</label>
            <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">Contraseña</label>
            <input id="password" type="password" autoComplete={mode === 'entrar' ? 'current-password' : 'new-password'} required
              value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'crear' ? 'Mínimo 8 caracteres' : ''} />
          </div>
          {error && <div className="err" role="alert">{error}</div>}
          {info && <div className="note" role="status">{info}</div>}
          <button className="btn primary wide" disabled={busy}>
            {busy ? 'Un momento…' : mode === 'entrar' ? 'Entrar' : 'Crear cuenta'}
          </button>
          {mode === 'entrar' && (
            <button type="button" className="btn ghost sm" onClick={resetPassword}>Olvidé mi contraseña</button>
          )}
        </form>
      </div>
    </div>
  );
}
