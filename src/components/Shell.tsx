'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { shopping } from '@/lib/calc';
import { createClient } from '@/lib/supabase/client';
import { Logo } from './Logo';
import { ModalHost } from './Modals';
import { reminderViews, useStore } from './store';

const TABS = [
  ['/hoy', 'Hoy'], ['/salon', 'Salón'], ['/agenda', 'Agenda'], ['/recordatorios', 'Recordatorios'],
  ['/presupuestos', 'Presupuestos'], ['/compras', 'Compras'], ['/menu', 'Menú y recetas'], ['/inventario', 'Inventario'],
  ['/ajustes', 'Ajustes'],
] as const;

export function Shell({ children }: { children: React.ReactNode }) {
  const s = useStore();
  const path = usePathname();
  const router = useRouter();
  const badges: Record<string, number> = {
    '/recordatorios': reminderViews(s.reservations, s.now).filter((x) => x.state === 'ahora' || x.state === 'fallido').length,
    '/inventario': s.ingredients.filter((g) => g.stock < g.min_stock).length,
    '/compras': shopping(s.reservations, s.dishMap, s.ingredients, s.today, 3, s.restaurant.shop_merma, s.restaurant.shop_keep_min).rows.length,
  };

  async function signOut() {
    await createClient().auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  return (
    <>
      <header className="top">
        <div className="wrap">
          <Link href="/hoy" className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element -- logo subido a Supabase Storage */}
            {s.restaurant.logo_url ? <img className="brand-logo" src={s.restaurant.logo_url} alt="" /> : <Logo />}<div><b>Mesa Lista</b><span>{s.restaurant.name}</span></div></Link>
          <div className="row">
            <span className={`live ${s.live ? '' : 'off'}`} title={s.live ? 'Los cambios de otros dispositivos llegan solos' : 'Sin conexión en vivo'}>
              <i />{s.live ? 'En vivo' : 'Sin conexión en vivo'}</span>
            <button className="btn primary" onClick={() => s.setModal({ type: 'form', preset: { date: path === '/agenda' ? s.agendaDay : undefined } })}>+ Nueva reserva</button>
          </div>
        </div>
      </header>
      <nav className="nav" aria-label="Secciones">
        <div className="wrap"><div className="tabs">
          {TABS.map(([href, label]) => (
            <Link key={href} href={href} className={`tab ${path === href ? 'on' : ''}`} aria-current={path === href ? 'page' : undefined}>
              {label}{badges[href] ? <span className="badge">{badges[href]}</span> : null}
            </Link>
          ))}
        </div></div>
      </nav>
      <main className="wrap">
        {s.loadError ? <div className="err">{s.loadError}</div> : s.loading ? <div className="loading">Cargando el restaurante…</div> : children}
      </main>
      <footer><div className="wrap">
        <span>{s.userEmail}</span>
        <button className="btn sm ghost" onClick={signOut}>Cerrar sesión</button>
      </div></footer>
      <ModalHost />
      <div className="toasts" aria-live="polite">
        {s.toasts.map((t) => <div key={t.id} className={`toast ${t.kind ?? ''}`}>{t.text}</div>)}
      </div>
    </>
  );
}
