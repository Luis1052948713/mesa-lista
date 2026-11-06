'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Logo } from '@/components/Logo';
import { addDays, capitalize, dayNum, fmtLong, hora, localParts, money, OCCASIONS, weekday, zonedToUtc } from '@/lib/calc';
import type { MenuDish, PublicRestaurant } from '@/lib/public';
import { createClient } from '@/lib/supabase/client';
import { MenuPicker } from './MenuPicker';
import { PublicFloor, type Floor } from './PublicFloor';

/* eslint-disable @next/next/no-img-element -- imágenes públicas de Supabase Storage */

const SAVED = 'mesalista.cliente';
type Saved = { name: string; phone: string; email: string };

// Este formulario solo se pinta en el navegador (ver BookingFormClient), así que puede leer lo guardado.
function readSaved(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED) || '{}');
    return { name: v.name || '', phone: v.phone || '', email: v.email || '' };
  } catch {
    return { name: '', phone: '', email: '' };
  }
}

export function BrandHeader({ name, logo, cover, subtitle }: { name: string; logo?: string; cover?: string; subtitle: string }) {
  return (
    <div className={`pub-hero ${cover ? 'has-cover' : ''}`} style={cover ? { backgroundImage: `url("${cover}")` } : undefined}>
      <div className="pub-hero-in">
        {logo ? <img className="pub-logo" src={logo} alt={`Logo de ${name}`} /> : <Logo size={56} />}
        <div><h1>{name}</h1><span>{subtitle}</span></div>
      </div>
    </div>
  );
}

export function BookingForm({ r, menu = [] }: { r: PublicRestaurant; menu?: MenuDish[] }) {
  const router = useRouter();
  const today = localParts(new Date().toISOString(), r.timezone).date;
  const quickDays = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const [saved] = useState(readSaved);
  const [date, setDate] = useState('');
  const [otherDate, setOtherDate] = useState(false);
  const [people, setPeople] = useState(2);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [time, setTime] = useState('');
  const [name, setName] = useState(saved.name);
  const [phone, setPhone] = useState(saved.phone);
  const [email, setEmail] = useState(saved.email);
  const [occasion, setOccasion] = useState('');
  const [allergies, setAllergies] = useState('');
  const [notes, setNotes] = useState('');
  const [website, setWebsite] = useState('');
  const [accept, setAccept] = useState(false);
  const [method, setMethod] = useState<'transferencia' | 'efectivo'>('transferencia');
  // Momento en que se abrió el formulario; el plazo exacto lo calcula la base de datos al reservar.
  const [openedAt] = useState(() => Date.now());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  // Plano a la hora elegida y mesa escogida ("" = que el restaurante la elija).
  const [floor, setFloor] = useState<Floor | null>(null);
  const [tableId, setTableId] = useState('');
  // Pedido desde la carta: id del plato → cantidad.
  const [order, setOrder] = useState<Record<string, number>>({});
  const orderLines = menu.filter((d) => order[d.id]).map((d) => ({ d, q: order[d.id] }));
  const orderCount = orderLines.reduce((a, l) => a + l.q, 0);
  const orderTotal = orderLines.reduce((a, l) => a + l.q * l.d.price, 0);
  const wa = r.whatsapp_phone.replace(/\D/g, '');
  const quickPeople = Array.from({ length: Math.min(8, r.max_online_people) }, (_, i) => i + 1);

  async function loadFloor(d: string, t: string, p: number) {
    setTableId('');
    setFloor(null);
    const { data } = await createClient().rpc('public_floor', { p_slug: r.slug, p_date: d, p_time: t, p_people: p });
    const f = data as Floor | null;
    // Solo se muestra si hay plano armado con al menos una mesa.
    if (f && f.tables.length) {
      setFloor({
        bg: f.bg ?? '',
        zones: f.zones.map((z) => ({ ...z, x: +z.x, y: +z.y, w: +z.w, h: +z.h })),
        items: (f.items ?? []).map((i) => ({ ...i, x: +i.x, y: +i.y, w: +i.w, h: +i.h })),
        tables: f.tables.map((x) => ({ ...x, x: +x.x, y: +x.y })),
      });
    }
  }
  const pickTime = (t: string) => { setTime(t); loadFloor(date, t, people); };

  async function loadSlots(d: string, p: number) {
    setTime('');
    setFloor(null);
    setTableId('');
    setSlots(null);
    setError('');
    if (!d) return;
    setLoadingSlots(true);
    const { data, error } = await createClient().rpc('public_slots', { p_slug: r.slug, p_date: d, p_people: p });
    setLoadingSlots(false);
    if (error) return setError('No pudimos consultar los horarios. Vuelve a intentarlo.');
    setSlots(((data ?? []) as { slot: string }[]).map((x) => x.slot));
  }
  const pickDate = (d: string) => { setDate(d); loadSlots(d, people); };
  const pickPeople = (p: number) => { setPeople(p); loadSlots(date, p); };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!date || !time) return setError('Elige el día y la hora de tu reserva.');
    if (name.trim().length < 2) return setError('Escribe tu nombre.');
    if (phone.replace(/\D/g, '').length < 10) return setError('Escribe tu celular de 10 dígitos.');
    if (r.deposit_amount > 0 && !accept) return setError('Acepta las condiciones del anticipo para continuar.');
    setBusy(true);
    const { data, error } = await createClient().rpc('public_book', {
      p_slug: r.slug,
      p: { customer_name: name, phone, email, people, date, time, occasion, allergies, notes, website, method: cashOk ? method : 'transferencia', table_id: tableId,
        items: Object.entries(order).map(([dish_id, qty]) => ({ dish_id, qty })) },
    });
    if (error) {
      setBusy(false);
      // Si alguien tomó esa mesa mientras llenaba el formulario, refrescamos el plano.
      if (/acaba de ocuparse|no está disponible para/i.test(error.message)) loadFloor(date, time, people);
      else if (/mesa|hora/i.test(error.message)) loadSlots(date, people);
      return setError(error.message);
    }
    try { localStorage.setItem(SAVED, JSON.stringify({ name: name.trim(), phone: phone.trim(), email: email.trim() })); } catch { /* sin almacenamiento */ }
    router.push(`/reservar/${r.slug}/r/${(data as { token: string }).token}`);
  }

  // Hasta cuándo puede pasar a pagar en efectivo: 12 h (o lo configurado), y como máximo 2 h antes de la reserva.
  const startMs = date && time ? new Date(zonedToUtc(date, time, r.timezone)).getTime() : 0;
  const cashUntilMs = startMs ? Math.min(openedAt + r.cash_hold_hours * 3600000, startMs - 2 * 3600000) : 0;
  const cashOk = r.accept_cash && r.deposit_amount > 0 && (!startMs || cashUntilMs > openedAt + 30 * 60000);
  const cashUntil = cashUntilMs ? localParts(new Date(cashUntilMs).toISOString(), r.timezone) : null;
  const label = (d: string) => (d === today ? 'Hoy' : d === addDays(today, 1) ? 'Mañana' : capitalize(weekday(d)));

  return (
    <div className="pub">
      <form className="pub-card" onSubmit={submit} noValidate>
        <BrandHeader name={r.name} logo={r.logo_url} cover={r.cover_url} subtitle={`Reserva tu mesa · cena de ${hora(r.open_time)} a ${hora(r.last_booking_time)}`} />


        <fieldset>
          <legend>¿Cuántas personas?</legend>
          <div className="chips big">
            {quickPeople.map((n) => (
              <button type="button" key={n} className={`chip ${people === n ? 'on' : ''}`} aria-pressed={people === n} onClick={() => pickPeople(n)}>{n}</button>
            ))}
            {r.max_online_people > 8 && (
              <select aria-label="Más personas" className={`chip-select ${people > 8 ? 'on' : ''}`} value={people > 8 ? people : ''} onChange={(e) => e.target.value && pickPeople(Number(e.target.value))}>
                <option value="">Más…</option>
                {Array.from({ length: r.max_online_people - 8 }, (_, i) => i + 9).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend>¿Qué día?</legend>
          <div className="chips big days-chips">
            {quickDays.map((d) => (
              <button type="button" key={d} className={`chip day-chip ${date === d && !otherDate ? 'on' : ''}`} aria-pressed={date === d && !otherDate}
                onClick={() => { setOtherDate(false); pickDate(d); }}>
                <span>{label(d)}</span><b>{dayNum(d)}</b>
              </button>
            ))}
            <button type="button" className={`chip day-chip ${otherDate ? 'on' : ''}`} onClick={() => { setOtherDate(true); setDate(''); setSlots(null); setTime(''); }}>
              <span>Otra</span><b>📅</b>
            </button>
          </div>
          {otherDate && (
            <input aria-label="Elige otra fecha" type="date" min={addDays(today, 7)} max={addDays(today, 60)} value={date} onChange={(e) => pickDate(e.target.value)} />
          )}
        </fieldset>

        {date && (
          <fieldset>
            <legend>¿A qué hora? <span className="muted" style={{ fontWeight: 500, fontSize: 14 }}>{capitalize(fmtLong(date))}</span></legend>
            {loadingSlots ? <p className="muted">Buscando mesas libres…</p>
              : slots && slots.length === 0
                ? <p className="muted">No quedan mesas para {people} {people === 1 ? 'persona' : 'personas'} ese día. Prueba otro día{wa ? ' o escríbenos por WhatsApp' : ''}.</p>
                : <div className="chips big">{(slots ?? []).map((s) => (
                  <button type="button" key={s} className={`chip ${time === s ? 'on' : ''}`} aria-pressed={time === s} onClick={() => pickTime(s)}>{hora(s)}</button>
                ))}</div>}
          </fieldset>
        )}

        {time && floor && (
          <fieldset>
            <legend>Escoge tu mesa <span className="muted" style={{ fontWeight: 500, fontSize: 14 }}>(opcional)</span></legend>
            <div className="chips">
              <button type="button" className={`chip text ${tableId === '' ? 'on' : ''}`} aria-pressed={tableId === ''} onClick={() => setTableId('')}>Que el restaurante la elija</button>
            </div>
            <PublicFloor floor={floor} selected={tableId} onSelect={setTableId} />
            <div className="legend">
              <span><i style={{ borderColor: 'var(--ok)', background: 'var(--surface)' }} />Libre</span>
              <span><i style={{ borderColor: 'var(--olive)', background: 'var(--olive)' }} />Tu mesa</span>
              <span><i style={{ borderColor: 'var(--line)', background: 'var(--sunken)' }} />Ocupada</span>
              <span><i style={{ borderColor: 'var(--line)', background: 'var(--surface)', borderStyle: 'dashed' }} />No es para {people}</span>
            </div>
            {tableId && <p className="note" style={{ fontSize: 14 }}>Escogiste la mesa <b>{floor?.tables.find((t) => t.id === tableId)?.name}</b> · {floor?.tables.find((t) => t.id === tableId)?.seats} puestos · {floor?.tables.find((t) => t.id === tableId)?.zone}</p>}
            {!floor.tables.some((t) => t.free && t.fits) && <p className="muted" style={{ fontSize: 13 }}>No hay mesas libres de tu tamaño en el plano a esa hora; el restaurante te asignará una si queda espacio.</p>}
          </fieldset>
        )}

        {/* Primero la mesa; después, si quiere, lo que va a pedir. */}
        {menu.length > 0 && (
          <details className="carta-box">
            <summary>
              <span><b>Ver la carta</b> y pedir desde ya <span className="muted">(opcional)</span></span>
              {orderCount > 0 && <span className="carta-badge">{orderCount} · {money(orderTotal)}</span>}
            </summary>
            <MenuPicker menu={menu} order={order} onChange={setOrder} />
          </details>
        )}

        {time && (
          <fieldset>
            <legend>Tus datos</legend>
            <div className="fgrid">
              <div className="field"><label htmlFor="b-name">Nombre</label>
                <input id="b-name" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="field"><label htmlFor="b-phone">Celular (WhatsApp)</label>
                <input id="b-phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="300 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            </div>
            <details className="more">
              <summary>Agregar detalles (opcional): ocasión, alergias, correo</summary>
              <div className="fgrid" style={{ marginTop: 10 }}>
                <div className="field"><label htmlFor="b-occ">Ocasión</label>
                  <select id="b-occ" value={occasion} onChange={(e) => setOccasion(e.target.value)}>
                    {OCCASIONS.map((o) => <option key={o} value={o}>{o || 'Ninguna'}</option>)}
                  </select></div>
                <div className="field"><label htmlFor="b-all">Alergias o restricciones</label>
                  <input id="b-all" type="text" value={allergies} onChange={(e) => setAllergies(e.target.value)} /></div>
                <div className="field"><label htmlFor="b-email">Correo</label>
                  <input id="b-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                <div className="field"><label htmlFor="b-notes">Algo que debamos saber</label>
                  <input id="b-notes" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
              </div>
            </details>
            {/* Campo trampa para robots: las personas no lo ven. */}
            <input className="hp" type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={website} onChange={(e) => setWebsite(e.target.value)} />

            {r.deposit_amount > 0 && (
              <div className="callout amber" style={{ display: 'grid', gap: 8 }}>
                <span>Para apartar la mesa pedimos un anticipo de <b>{money(r.deposit_amount)}</b>. ¿Cómo lo vas a pagar?</span>
                <div className="pay-methods" role="radiogroup" aria-label="Cómo pagar el anticipo">
                  <button type="button" role="radio" aria-checked={method === 'transferencia' || !cashOk} className={`pay-method ${method === 'transferencia' || !cashOk ? 'on' : ''}`} onClick={() => setMethod('transferencia')}>
                    <b>Transferencia</b><span>Nequi o banco. Tienes {r.hold_minutes} minutos para subir el comprobante.</span>
                  </button>
                  {r.accept_cash && (
                    <button type="button" role="radio" aria-checked={cashOk && method === 'efectivo'} disabled={!cashOk}
                      className={`pay-method ${cashOk && method === 'efectivo' ? 'on' : ''}`} onClick={() => setMethod('efectivo')}>
                      <b>Efectivo en el restaurante</b>
                      <span>{cashOk
                        ? `Pasa a pagar${cashUntil ? ` antes del ${fmtLong(cashUntil.date)} a las ${hora(cashUntil.time)}` : ` en las próximas ${r.cash_hold_hours} horas`}.`
                        : 'No alcanza el tiempo para pasar a pagar antes de tu reserva.'}</span>
                    </button>
                  )}
                </div>
                {r.booking_policy && <span style={{ fontSize: 13 }}>{r.booking_policy}</span>}
                <label className="check"><input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} /> Acepto las condiciones del anticipo</label>
              </div>
            )}
          </fieldset>
        )}

        {time && orderLines.length > 0 && (
          <div className="order-sum">
            <b>Tu pedido</b>
            {orderLines.map((l) => <div key={l.d.id} className="ln"><span>{l.q} × {l.d.name}</span><span>{money(l.q * l.d.price)}</span></div>)}
            <div className="ln tot"><span>Total estimado</span><span>{money(orderTotal)}</span></div>
            <span className="muted" style={{ fontSize: 12 }}>Lo pagas en el restaurante; el anticipo se descuenta de la cuenta.</span>
          </div>
        )}
        {error && <div className="err" role="alert">{error}</div>}
        {time && (
          <button className="btn primary wide big-btn" disabled={busy}>
            {busy ? 'Apartando tu mesa…' : `Apartar ${tableId ? `mesa ${floor?.tables.find((t) => t.id === tableId)?.name}` : 'mesa'} · ${people} ${people === 1 ? 'persona' : 'personas'} · ${hora(time)}`}
          </button>
        )}
        <p className="muted" style={{ fontSize: 12, textAlign: 'center' }}>
          Reservas con al menos {r.min_advance_hours} {r.min_advance_hours === 1 ? 'hora' : 'horas'} de anticipación y hasta {r.max_online_people} personas.
          {wa ? ' Para grupos más grandes escríbenos por WhatsApp.' : ''}
        </p>
      </form>
    </div>
  );
}
