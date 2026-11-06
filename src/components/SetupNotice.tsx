import { Logo } from './Logo';

export function SetupNotice() {
  return (
    <div className="auth">
      <div className="auth-card setup" style={{ width: 'min(720px, 100%)' }}>
        <div className="row"><Logo /><h1>Falta conectar la base de datos</h1></div>
        <p>
          Mesa Lista guarda las reservas en Supabase. Crea un proyecto gratis en supabase.com, copia{' '}
          <code>.env.example</code> como <code>.env.local</code> y llena estas dos variables:
        </p>
        <pre>{`NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...`}</pre>
        <p>
          Luego ejecuta la migración <code>supabase/migrations/20261024000000_init.sql</code> en el SQL Editor de
          Supabase y reinicia el servidor. Los pasos completos están en <code>README.md</code>.
        </p>
      </div>
    </div>
  );
}
