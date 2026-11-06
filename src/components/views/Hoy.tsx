'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { addDays, capitalize, dayNum, fmtDay, fmtLong, money, pct, quote, shopping, weekday } from '@/lib/calc';
import { reminderViews, useStore } from '../store';
import { ResItem } from '../ui';

export function Hoy() {
  const s = useStore();
  const router = useRouter();
  const { reservations, today, dishMap, ingMap, restaurant, now } = s;
  const q = (r: (typeof reservations)[number]) => quote(r, dishMap, ingMap, restaurant);
  const active = reservations.filter((r) => r.status !== 'cancelada');
  const todays = active.filter((r) => r.date === today);
  const ppl = todays.reduce((a, r) => a + r.people, 0);
  const ventas = todays.reduce((a, r) => a + q(r).total, 0);
  const conf = todays.filter((r) => r.status !== 'pendiente').length;
  const week = active.filter((r) => r.date >= today && r.date < addDays(today, 7)).map(q);
  const wsub = week.reduce((a, x) => a + x.sub, 0);
  const wcost = week.reduce((a, x) => a + x.cost, 0);
  const in14 = active.filter((r) => r.date >= today && r.date < addDays(today, 14));
  const views = reminderViews(reservations, now);
  const due = views.filter((x) => x.state === 'ahora');
  const failed = views.filter((x) => x.state === 'fallido');
  const low = s.ingredients.filter((g) => g.stock < g.min_stock);
  const shop = shopping(reservations, dishMap, s.ingredients, today, 3, restaurant.shop_merma, restaurant.shop_keep_min);
  const pend = in14.filter((r) => r.status === 'pendiente' && r.date < addDays(today, 3));
  const noPre = in14.filter((r) => !r.items.length && r.status !== 'atendida');
  const next = in14.filter((r) => r.status !== 'atendida' && new Date(r.starts_at).getTime() >= now - 90 * 60000).slice(0, 6);
  const days = Array.from({ length: 14 }, (_, i) => {
    const iso = addDays(today, i);
    return { iso, p: active.filter((r) => r.date === iso).reduce((a, r) => a + r.people, 0) };
  });
  const max = Math.max(...days.map((d) => d.p), 1);
  const names = (xs: string[], n = 3) => xs.slice(0, n).join(', ') + (xs.length > n ? '…' : '');

  const toReview = active.filter((r) => r.status === 'pendiente' && r.deposit_status === 'comprobante');
  const waitingPay = active.filter((r) => r.status === 'pendiente' && r.deposit_status === 'esperando');
  const alerts = [
    toReview.length > 0 && { c: 'red', ic: toReview.length, t: 'Comprobantes de anticipo por revisar', s: names(toReview.map((r) => r.customer_name)), href: '/agenda', b: 'Revisar' },
    waitingPay.length > 0 && { c: 'amber', ic: waitingPay.length, t: 'Reservas en línea esperando el anticipo', s: names(waitingPay.map((r) => r.customer_name)), href: '/agenda', b: 'Ver' },
    failed.length > 0 && { c: 'red', ic: failed.length, t: 'Recordatorios que no se pudieron enviar', s: names(failed.map((x) => x.res.customer_name)), href: '/recordatorios', b: 'Revisar' },
    due.length > 0 && { c: 'red', ic: due.length, t: s.waReady ? 'Recordatorios saliendo por WhatsApp' : `${due.length === 1 ? 'Recordatorio listo' : 'Recordatorios listos'} para enviar`, s: names(due.map((x) => x.res.customer_name), 2), href: '/recordatorios', b: s.waReady ? 'Ver' : 'Enviar' },
    pend.length > 0 && { c: 'amber', ic: pend.length, t: 'Reservas sin confirmar en los próximos 3 días', s: names(pend.map((r) => r.customer_name)), href: '/recordatorios', b: 'Revisar' },
    shop.rows.length > 0 && { c: 'blue', ic: shop.rows.length, t: 'Insumos por comprar para 3 días', s: `Costo estimado ${money(shop.total)}`, href: '/compras', b: 'Ver lista' },
    low.length > 0 && { c: 'red', ic: low.length, t: 'Insumos bajo el mínimo', s: names(low.map((g) => g.name)), href: '/inventario', b: 'Inventario' },
    noPre.length > 0 && { c: 'amber', ic: noPre.length, t: 'Reservas sin pre-pedido', s: 'Pide el menú por WhatsApp para calcular compras', href: '/agenda', b: 'Agenda' },
  ].filter(Boolean) as { c: string; ic: number; t: string; s: string; href: string; b: string }[];

  return (
    <>
      <div className="head">
        <div><div className="eyebrow">{fmtLong(today)}</div><h2>Así va el servicio de hoy</h2></div>
        <div className="row"><Link className="btn" href="/salon">Ver salón</Link><Link className="btn" href="/compras">Lista de compras</Link></div>
      </div>
      <section className="kpis">
        <div className="kpi hero"><span className="eyebrow">Reservas hoy</span><span className="v">{todays.length}</span><span className="s">{conf} confirmadas o atendidas</span></div>
        <div className="kpi"><span className="eyebrow">Comensales</span><span className="v">{ppl}</span><span className="s">{todays.length ? `Promedio ${(ppl / todays.length).toFixed(1)} por mesa` : 'Sin reservas'}</span></div>
        <div className="kpi"><span className="eyebrow">Ventas pre-pedidas</span><span className="v">{money(ventas)}</span><span className="s">Con impoconsumo {pct(restaurant.inc_rate)}</span></div>
        <div className="kpi"><span className="eyebrow">Food cost 7 días</span><span className="v">{wsub ? pct(wcost / wsub) : '—'}</span><span className="s">Meta: menos de 32 %</span></div>
      </section>
      <section className="grid2">
        <div className="panel"><h3>Próximas llegadas</h3>
          <div className="list">{next.length ? next.map((r) => <ResItem key={r.id} r={r} showDate={r.date !== today} />)
            : <div className="empty">No hay llegadas pendientes. Crea una reserva con el botón de arriba.</div>}</div>
        </div>
        <div className="panel"><h3>Para hacer ahora</h3>
          <div className="alerts">
            {alerts.length ? alerts.map((a) => (
              <div key={a.t} className={`alert ${a.c}`}><div className="ic">{a.ic}</div>
                <div style={{ minWidth: 0 }}><b>{a.t}</b><span>{a.s}</span></div>
                <Link className="btn sm" href={a.href}>{a.b}</Link></div>
            )) : <div className="alert green"><div className="ic">✓</div><div><b>Todo al día</b><span>No hay recordatorios ni compras pendientes.</span></div></div>}
          </div>
        </div>
      </section>
      <section className="panel">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <h3>Comensales reservados · próximos 14 días</h3><span className="muted" style={{ fontSize: 13 }}>Toca un día para ver su agenda</span>
        </div>
        <div className="bars">
          {days.map((d, i) => (
            <button key={d.iso} className={`bar ${i === 0 ? 'today' : ''} ${d.p ? '' : 'zero'}`}
              style={{ height: `${d.p ? Math.max(4, (d.p / max) * 100) : 1.5}%` }}
              aria-label={`${capitalize(fmtDay(d.iso))}: ${d.p} comensales`}
              onClick={() => { s.setAgendaDay(d.iso); router.push('/agenda'); }}>
              {d.p > 0 && <i>{d.p}</i>}
            </button>
          ))}
        </div>
        <div className="bar-labels">{days.map((d) => <span key={d.iso}>{weekday(d.iso)}<b>{dayNum(d.iso)}</b></span>)}</div>
      </section>
    </>
  );
}
