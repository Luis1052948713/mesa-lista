'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Logo } from '@/components/Logo';
import { createClient } from '@/lib/supabase/client';

export function OnboardingForm({ email, business }: { email: string; business: string }) {
  const router = useRouter();
  const [name, setName] = useState(business);
  const [demo, setDemo] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setError('Escribe el nombre del restaurante.');
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc('create_restaurant', { p_name: name.trim(), p_demo: demo });
    if (error) {
      setBusy(false);
      return setError(error.message);
    }
    // Los correos (recuperar contraseña) usan este nombre.
    if (name.trim() !== business) await supabase.auth.updateUser({ data: { business_name: name.trim() } });
    router.replace('/hoy');
    router.refresh();
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="row" style={{ gap: 12 }}><Logo /><div><h1 style={{ fontSize: 26 }}>Tu restaurante</h1><span className="muted">{email}</span></div></div>
        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="rname">Nombre del restaurante</label>
            <input id="rname" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Fogón 38" autoFocus />
          </div>
          <label className="check"><input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
            Cargar menú, recetas y mesas de ejemplo</label>
          <p className="muted" style={{ fontSize: 13 }}>
            El ejemplo trae 8 platos colombianos con sus recetas, 26 insumos con precios y un salón de 13 mesas. Puedes cambiarlos después.
          </p>
          {error && <div className="err" role="alert">{error}</div>}
          <button className="btn primary wide" disabled={busy}>{busy ? 'Creando…' : 'Crear restaurante'}</button>
        </form>
      </div>
    </div>
  );
}
