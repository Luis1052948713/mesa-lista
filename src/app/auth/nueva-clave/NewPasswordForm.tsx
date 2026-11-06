'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Logo } from '@/components/Logo';
import { createClient } from '@/lib/supabase/client';

export function NewPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('La contraseña debe tener al menos 8 caracteres.');
    if (password !== repeat) return setError('Las dos contraseñas no son iguales.');
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (error) {
      if (/session/i.test(error.message)) return setError('El enlace venció. Vuelve a pedir "Olvidé mi contraseña".');
      if (/different from the old/i.test(error.message)) return setError('Usa una contraseña distinta a la anterior.');
      return setError(error.message);
    }
    router.replace('/hoy');
    router.refresh();
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="row" style={{ gap: 12 }}>
          <Logo />
          <div><h1 style={{ fontSize: 26 }}>Nueva contraseña</h1><span className="muted">Escríbela dos veces para no equivocarte</span></div>
        </div>
        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="np-1">Contraseña nueva</label>
            <input id="np-1" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" autoFocus />
          </div>
          <div className="field">
            <label htmlFor="np-2">Repítela</label>
            <input id="np-2" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          </div>
          {error && <div className="err" role="alert">{error}</div>}
          <button className="btn primary wide" disabled={busy}>{busy ? 'Guardando…' : 'Guardar y entrar'}</button>
          <Link className="btn ghost sm" href="/login">Volver a entrar</Link>
        </form>
      </div>
    </div>
  );
}
