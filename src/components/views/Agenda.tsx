'use client';

import { addDays, capitalize, dayNum, fmtLong, hora, money, quote, weekday } from '@/lib/calc';
import type { Reservation } from '@/lib/types';
import { useStore } from '../store';
import { ResItem } from '../ui';

export function Agenda() {
  const s = useStore();
  const { reservations, today, agendaDay, setAgendaDay, dishMap, ingMap, restaurant, setModal } = s;
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const sel = agendaDay < today ? today : agendaDay;
  if (!days.includes(sel)) days.push(sel);
  const list = reservations.filter((r) => r.date === sel);
  const active = list.filter((r) => r.status !== 'cancelada');
  const total = active.reduce((a, r) => a + quote(r, dishMap, ingMap, restaurant).total, 0);
  const people = (xs: Reservation[]) => xs.filter((r) => r.status !== 'cancelada').reduce((a, r) => a + r.people, 0);

  const pendingDeposit = active.filter((r) => r.deposit_status === 'esperando' || r.deposit_status === 'comprobante').length;

  return (
    <>
      <div className="head">
        <div><div className="eyebrow">Agenda</div><h2>{capitalize(fmtLong(sel))}</h2>
          <p>{active.length} reservas · {people(active)} comensales · ventas pre-pedidas {money(total)}</p></div>
        <button className="btn primary" onClick={() => setModal({ type: 'form', preset: { date: sel } })}>+ Reserva para este día</button>
      </div>
      <div className="days">
        {days.map((iso) => {
          const rs = reservations.filter((r) => r.date === iso && r.status !== 'cancelada');
          return (
            <button key={iso} className={`day ${iso === sel ? 'on' : ''}`} onClick={() => setAgendaDay(iso)} aria-pressed={iso === sel}>
              <span className="dn">{iso === today ? 'Hoy' : weekday(iso)}</span><span className="dd">{dayNum(iso)}</span>
              <span className="dc">{rs.length ? `${people(rs)} pers.` : '—'}</span><span className={`dot ${rs.length ? '' : 'none'}`} />
            </button>
          );
        })}
      </div>
      <div className="panel">
        <h3>Cena · {hora(restaurant.open_time)} a {hora(restaurant.last_booking_time)}
          <span className="muted" style={{ fontWeight: 500, fontSize: 14 }}> · {people(list)} comensales{pendingDeposit ? ` · ${pendingDeposit} con anticipo pendiente` : ''}</span></h3>
        <div className="list">{list.length ? list.map((r) => <ResItem key={r.id} r={r} />) : <div className="empty">Sin reservas para esta noche.</div>}</div>
      </div>
    </>
  );
}
