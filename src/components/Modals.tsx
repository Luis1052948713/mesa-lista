'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  depositLabel, fmtDay, fmtLong, hora, localParts, money, OCCASIONS, pct, quote, REMINDER_LABEL, reminderText, slotsFor, waLink, zonedToUtc,
} from '@/lib/calc';
import type { Reminder, Reservation, ReservationInput } from '@/lib/types';
import { DishForm, IngredientForm, ItemForm, PurchaseForm, TableForm, ZoneForm } from './CrudModals';
import { conflictOf, useStore } from './store';
import { ConfirmButton, StatusPill, Ticket, useQuoteText } from './ui';

export function ModalHost() {
  const { modal, setModal } = useStore();
  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setModal(null);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [modal, setModal]);
  if (!modal) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setModal(null)}>
      <div className="modal" role="dialog" aria-modal="true">
        {modal.type === 'form' && <ReservationForm reservation={modal.reservation} preset={modal.preset} />}
        {modal.type === 'detail' && <ReservationDetail id={modal.id} />}
        {modal.type === 'copy' && <CopyBox text={modal.text} />}
        {modal.type === 'dish' && <DishForm dish={modal.dish} />}
        {modal.type === 'ingredient' && <IngredientForm ingredient={modal.ingredient} />}
        {modal.type === 'purchase' && <PurchaseForm purchase={modal.purchase} ingredientId={modal.ingredientId} />}
        {modal.type === 'table' && <TableForm table={modal.table} zone={modal.zone} />}
        {modal.type === 'zone' && <ZoneForm zone={modal.zone} />}
        {modal.type === 'item' && <ItemForm item={modal.item} />}
      </div>
    </div>
  );
}

function Head({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  const { setModal } = useStore();
  return (
    <div className="m-head">
      <div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2>{children}</div>
      <button className="x" onClick={() => setModal(null)} aria-label="Cerrar">×</button>
    </div>
  );
}

function CopyBox({ text }: { text: string }) {
  return (
    <>
      <Head eyebrow="Copiar" title="Copia este texto" />
      <div className="m-body"><textarea rows={10} defaultValue={text} autoFocus onFocus={(e) => e.currentTarget.select()} /></div>
    </>
  );
}

/* ---------- formulario de reserva ---------- */

function ReservationForm({ reservation: r, preset }: {
  reservation?: Reservation; preset?: Partial<Pick<ReservationInput, 'date' | 'time' | 'table_id' | 'people'>>;
}) {
  const { dishes, tables, reservations, restaurant, today, dishMap, ingMap, saveReservation, setModal, setAgendaDay, toast } = useStore();
  const presetTable = preset?.table_id ? tables.find((t) => t.id === preset.table_id) : undefined;
  const [f, setF] = useState<ReservationInput>(() => ({
    customer_name: r?.customer_name ?? '',
    phone: r?.phone ?? '',
    date: r?.date ?? preset?.date ?? today,
    time: r?.time ?? preset?.time ?? (slotsFor(restaurant).includes('19:30') ? '19:30' : slotsFor(restaurant)[0] ?? '19:30'),
    people: r?.people ?? preset?.people ?? (presetTable ? Math.max(1, Math.min(presetTable.seats, presetTable.seats - 2 || 2)) : 2),
    table_id: r?.table_id ?? preset?.table_id ?? '',
    occasion: r?.occasion ?? '',
    allergies: r?.allergies ?? '',
    notes: r?.notes ?? '',
    deposit: r?.deposit ?? 0,
    deposit_method: r?.deposit_method ?? 'efectivo',
    items: Object.fromEntries((r?.items ?? []).map((i) => [i.dish_id, i.qty])),
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof ReservationInput>(k: K, v: ReservationInput[K]) => setF((x) => ({ ...x, [k]: v }));

  const startIso = useMemo(() => zonedToUtc(f.date, f.time, restaurant.timezone), [f.date, f.time, restaurant.timezone]);
  const q = quote({ items: Object.entries(f.items).filter(([, n]) => n > 0).map(([dish_id, qty]) => ({ dish_id, qty, unit_price: dishMap.get(dish_id)?.price ?? 0 })), deposit: f.deposit }, dishMap, ingMap, restaurant);
  const base = slotsFor(restaurant);
  const slots = base.includes(f.time) ? base : [...base, f.time].sort();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!f.customer_name.trim()) return setError('Escribe el nombre de quien reserva.');
    if (!f.date) return setError('Elige la fecha de la reserva.');
    if (!(f.people >= 1)) return setError('La reserva necesita al menos 1 persona.');
    if (f.phone && f.phone.replace(/\D/g, '').length < 10) return setError('El celular debe tener al menos 10 dígitos para enviar recordatorios.');
    const t = f.table_id ? tables.find((x) => x.id === f.table_id) : undefined;
    if (t && t.seats < f.people) return setError(`La mesa ${t.name} es para ${t.seats} personas. Elige una más grande o deja "Asignar automáticamente".`);
    setBusy(true);
    const err = await saveReservation(r?.id ?? null, { ...f, customer_name: f.customer_name.trim() });
    setBusy(false);
    if (err) return setError(err);
    setAgendaDay(f.date);
    setModal(null);
    toast(r ? 'Reserva actualizada.' : 'Reserva guardada. Los recordatorios de 24 h y 2 h quedaron programados.');
  }

  return (
    <>
      <Head eyebrow={r ? `R-${r.code}` : 'Nueva reserva'} title={r ? 'Editar reserva' : 'Reservar mesa'} />
      <form className="m-body" onSubmit={submit} noValidate>
        <div className="fgrid">
          <div className="field"><label htmlFor="f-name">Nombre de quien reserva</label>
            <input id="f-name" type="text" value={f.customer_name} onChange={(e) => set('customer_name', e.target.value)} placeholder="Ej. Carolina Díaz" autoComplete="off" autoFocus /></div>
          <div className="field"><label htmlFor="f-phone">Celular (WhatsApp)</label>
            <input id="f-phone" type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="300 123 4567" autoComplete="off" /></div>
          <div className="field"><label htmlFor="f-date">Fecha</label>
            <input id="f-date" type="date" value={f.date} min={today} onChange={(e) => set('date', e.target.value)} /></div>
          <div className="field"><label htmlFor="f-time">Hora</label>
            <select id="f-time" value={f.time} onChange={(e) => set('time', e.target.value)}>{slots.map((s) => <option key={s} value={s}>{hora(s)}</option>)}</select></div>
          <div className="field"><label htmlFor="f-people">Personas</label>
            <input id="f-people" type="number" min={1} max={300} value={f.people} onChange={(e) => set('people', parseInt(e.target.value) || 0)} /></div>
          <div className="field"><label htmlFor="f-table">Mesa</label>
            <select id="f-table" value={f.table_id} onChange={(e) => set('table_id', e.target.value)}>
              <option value="">Asignar automáticamente</option>
              {tables.filter((t) => t.active).map((t) => {
                const c = conflictOf(reservations, t.id, startIso, 120, r?.id);
                return <option key={t.id} value={t.id}>{t.name} · {t.seats} puestos · {t.zone}{c ? ` · ocupada ${hora(c.time)}` : t.seats < f.people ? ' · pequeña' : ''}</option>;
              })}
            </select></div>
          <div className="field"><label htmlFor="f-occ">Ocasión</label>
            <select id="f-occ" value={f.occasion} onChange={(e) => set('occasion', e.target.value)}>
              {(OCCASIONS.includes(f.occasion) ? OCCASIONS : [...OCCASIONS, f.occasion]).map((o) => <option key={o} value={o}>{o || 'Ninguna'}</option>)}
            </select></div>
          <div className="field"><label htmlFor="f-dep">Anticipo recibido (COP)</label>
            {r && (r.deposit_status === 'esperando' || r.deposit_status === 'comprobante')
              ? <p className="muted" style={{ fontSize: 13 }}>Reserva en línea esperando el anticipo: confírmalo desde el detalle de la reserva.</p>
              : <div className="dep-in">
                <input id="f-dep" type="number" min={0} step={10000} value={f.deposit} onChange={(e) => set('deposit', parseFloat(e.target.value) || 0)} />
                <select aria-label="Cómo pagó el anticipo" value={f.deposit_method} disabled={!(f.deposit > 0)}
                  onChange={(e) => set('deposit_method', e.target.value as ReservationInput['deposit_method'])}>
                  <option value="efectivo">En efectivo</option>
                  <option value="transferencia">Por transferencia</option>
                </select>
              </div>}
          </div>
          <div className="field"><label htmlFor="f-all">Alergias o restricciones</label>
            <input id="f-all" type="text" value={f.allergies} onChange={(e) => set('allergies', e.target.value)} placeholder="Ej. sin lácteos" /></div>
          <div className="field"><label htmlFor="f-notes">Notas</label>
            <input id="f-notes" type="text" value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Ej. traen torta" /></div>
        </div>
        <div>
          <h3>Pre-pedido</h3>
          <p className="muted" style={{ fontSize: 13, margin: '2px 0 10px' }}>Con el pre-pedido la app calcula el presupuesto y la lista de compras.</p>
          <div className="steppers">
            {dishes.filter((d) => d.active).map((d) => {
              const n = f.items[d.id] ?? 0;
              const change = (delta: number) => set('items', { ...f.items, [d.id]: Math.max(0, n + delta) });
              return (
                <div key={d.id} className={`step ${n ? 'has' : ''}`}>
                  <div className="nm">{d.name}<small>{money(d.price)}</small></div>
                  <div className="ctl">
                    <button type="button" onClick={() => change(-1)} aria-label={`Quitar ${d.name}`}>−</button>
                    <b>{n}</b>
                    <button type="button" onClick={() => change(1)} aria-label={`Agregar ${d.name}`}>+</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="summary">
          {q.sub ? <>
            <span>Total <b>{money(q.total)}</b></span><span>Costo insumos <b>{money(q.cost)}</b></span>
            <span>Margen <b>{money(q.margin)}</b></span><span>Food cost <b>{pct(q.fc)}</b></span>
            {q.due !== q.total && <span>Saldo <b>{money(q.due)}</b></span>}
          </> : <span>Agrega platos para ver el presupuesto.</span>}
        </div>
        {error && <div className="err" role="alert">{error}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={() => setModal(null)}>Cancelar</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : r ? 'Guardar cambios' : 'Guardar reserva'}</button>
        </div>
      </form>
    </>
  );
}

/* ---------- detalle de reserva ---------- */

function reminderStatusText(rem: Reminder, tz: string, now: number) {
  const { date, time } = localParts(rem.send_at, tz);
  switch (rem.status) {
    case 'enviado': return rem.channel === 'whatsapp' ? 'Enviado por WhatsApp' : 'Marcado como enviado';
    case 'enviando': return 'Enviando…';
    case 'fallido': return `No se pudo enviar${rem.error ? `: ${rem.error}` : ''}`;
    case 'cancelado': return 'Cancelado';
    case 'omitido': return 'No aplica: la reserva se hizo con poca anticipación';
    default: return new Date(rem.send_at).getTime() <= now ? 'Listo para enviar' : `Programado: ${fmtDay(date)} ${hora(time)}`;
  }
}

function ReservationDetail({ id }: { id: string }) {
  const s = useStore();
  const { reservations, tableMap, restaurant, now, today, waReady, setModal, setStatus, markReminderSent, sendReminderNow, copy, toast } = s;
  const quoteText = useQuoteText();
  const r = reservations.find((x) => x.id === id);
  if (!r) return <><Head eyebrow="Reserva" title="Esta reserva ya no está disponible" /><div className="m-body" /></>;
  const t = r.table_id ? tableMap.get(r.table_id) : undefined;
  const open = r.status === 'pendiente' || r.status === 'confirmada';
  const msg = reminderText(r, restaurant.name, today, t?.name);
  const act = async (status: Reservation['status'], done: string) => {
    const err = await setStatus(r.id, status);
    toast(err ?? done, err ? 'alert' : undefined);
  };
  const rems = [...r.reminders].sort((a) => (a.kind === '24h' ? -1 : 1));

  return (
    <>
      <Head eyebrow={`R-${r.code} · ${fmtLong(r.date)}`} title={r.customer_name}>
        <div className="row" style={{ marginTop: 6 }}><StatusPill status={r.status} />{r.occasion && <span className="tag">{r.occasion}</span>}
          {r.confirmed_via === 'whatsapp' && <span className="tag good">Confirmó por WhatsApp</span>}</div>
      </Head>
      <div className="m-body">
        <div className="dl">
          <div><span className="eyebrow">Hora</span><b className="mono">{hora(r.time)}</b></div>
          <div><span className="eyebrow">Personas</span><b>{r.people}</b></div>
          <div><span className="eyebrow">Mesa</span><b>{t ? `${t.name} · ${t.zone}` : 'Sin mesa'}</b></div>
          <div><span className="eyebrow">Celular</span><b className="mono" style={{ userSelect: 'all' }}>{r.phone || '—'}</b></div>
        </div>
        {r.allergies && <div className="callout red"><b>Alergias:</b> {r.allergies}</div>}
        {r.notes && <div className="callout amber"><b>Notas:</b> {r.notes}</div>}
        {r.deposit_status !== 'no_aplica' && <DepositBlock r={r} />}
        {r.status === 'atendida' && <div className="muted" style={{ fontSize: 13 }}>Reserva atendida. Los insumos de su pedido ya se descontaron del inventario.</div>}
        <div className="row">
          {r.status === 'pendiente' && <button className="btn primary" onClick={() => act('confirmada', `${r.customer_name}: reserva confirmada.`)}>Confirmar</button>}
          {open && <button className="btn" onClick={() => act('atendida', `${r.customer_name}: atendida. Insumos descontados del inventario.`)}>Marcar atendida</button>}
          {open && <ConfirmButton label="Cancelar reserva" confirmLabel="Toca otra vez para cancelar" onConfirm={() => act('cancelada', `Reserva de ${r.customer_name} cancelada. La mesa quedó libre.`)} />}
          {r.status === 'cancelada' && <button className="btn" onClick={() => act('pendiente', 'Reserva reactivada. Recordatorios reprogramados.')}>Reactivar</button>}
          {r.status !== 'atendida' && <button className="btn" onClick={() => setModal({ type: 'form', reservation: r })}>Editar</button>}
        </div>
        <div>
          <h3 style={{ marginBottom: 4 }}>Recordatorios por WhatsApp</h3>
          {rems.map((rem) => {
            const pending = open && (rem.status === 'programado' || rem.status === 'fallido');
            return (
              <div className="rem-line" key={rem.id}>
                <span><b>{REMINDER_LABEL[rem.kind]}</b> · <span className="muted">{reminderStatusText(rem, restaurant.timezone, now)}</span></span>
                {pending && <div className="row">
                  {waReady && r.phone && <button className="btn sm primary" onClick={() => sendReminderNow(rem.id)}>Enviar ahora</button>}
                  <button className="btn sm" onClick={() => markReminderSent(rem.id)}>Marcar enviado</button>
                </div>}
              </div>
            );
          })}
          {open && r.phone && <div className="row" style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={() => copy(msg, 'Mensaje copiado. Pégalo en WhatsApp.')}>Copiar mensaje</button>
            <a className="btn sm" href={waLink(r.phone, msg, restaurant.phone_country_code)} target="_blank" rel="noopener noreferrer">Abrir en WhatsApp ↗</a>
          </div>}
          {open && !r.phone && <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>Agrega el celular del cliente para enviarle recordatorios.</p>}
        </div>
        <div>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <h3>Presupuesto</h3>
            {r.items.length > 0 && <button className="btn sm" onClick={() => copy(quoteText(r), 'Cotización copiada.')}>Copiar cotización</button>}
          </div>
          <Ticket r={r} />
        </div>
      </div>
    </>
  );
}

/* ---------- anticipo de una reserva en línea ---------- */

function DepositBlock({ r }: { r: Reservation }) {
  const { restaurant, now, reviewDeposit, receiptUrl, toast } = useStore();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const left = r.hold_expires_at ? new Date(r.hold_expires_at).getTime() - now : 0;
  const until = r.hold_expires_at ? localParts(r.hold_expires_at, restaurant.timezone) : null;
  const cash = r.deposit_method === 'efectivo';
  const isPdf = r.receipt_path?.toLowerCase().endsWith('.pdf');
  const msg = cash
    ? `Hola ${r.customer_name}, te escribimos de ${restaurant.name} por tu reserva R-${r.code}. Te esperamos para recibir el anticipo de ${money(restaurant.deposit_amount)} en efectivo${until ? ` antes del ${fmtDay(until.date)} a las ${hora(until.time)}` : ''}.`
    : `Hola ${r.customer_name}, te escribimos de ${restaurant.name} por tu reserva R-${r.code}. Para confirmarla falta el anticipo de ${money(restaurant.deposit_amount)}.`;
  const leftText = left >= 3600000 ? `${Math.floor(left / 3600000)} h ${Math.round((left % 3600000) / 60000)} min` : `${Math.ceil(left / 60000)} min`;

  async function show() {
    if (!r.receipt_path) return;
    const u = await receiptUrl(r.receipt_path);
    if (!u) return toast('No se pudo abrir el comprobante. Vuelve a intentarlo.', 'alert');
    setUrl(u);
  }
  async function review(ok: boolean, method?: 'transferencia' | 'efectivo') {
    setBusy(true);
    const err = await reviewDeposit(r.id, ok, method);
    setBusy(false);
    toast(err ?? (ok
      ? `Anticipo de ${r.customer_name} recibido${method ? ` en ${method}` : ''}. Reserva confirmada.`
      : `Anticipo rechazado. La reserva de ${r.customer_name} quedó cancelada y la mesa libre.`), err ? 'alert' : undefined);
  }

  return (
    <div className={`deposit d-${r.deposit_status}`}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>{depositLabel(r.deposit_status, r.deposit_method)} · {money(r.deposit_status === 'pagado' ? r.deposit : restaurant.deposit_amount)}</b>
        {r.source === 'web' && <span className="tag">Reserva en línea</span>}
      </div>
      {r.deposit_status === 'esperando' && (
        <p>{left > 0
          ? cash
            ? `Eligió pagar en efectivo en el restaurante. Tiene ${leftText} (hasta el ${until ? `${fmtDay(until.date)} ${hora(until.time)}` : ''}). Si no pasa, la mesa se libera sola.`
            : `La mesa queda apartada ${leftText} más. Si no llega el comprobante, se libera sola.`
          : 'El tiempo para pagar terminó; se cancelará en unos minutos.'}</p>
      )}
      {r.deposit_status === 'comprobante' && <p>El cliente subió el comprobante. Revisa en tu banco que el dinero llegó antes de confirmar.</p>}
      {r.deposit_status === 'pagado' && <p>Se descuenta de la cuenta el día de la reserva.</p>}
      {r.receipt_path && !url && <button className="btn sm" onClick={show}>Ver comprobante</button>}
      {url && (isPdf
        ? <a className="btn sm" href={url} target="_blank" rel="noopener noreferrer">Abrir comprobante (PDF) ↗</a>
        // eslint-disable-next-line @next/next/no-img-element -- enlace firmado temporal de Supabase
        : <a href={url} target="_blank" rel="noopener noreferrer"><img className="receipt" src={url} alt={`Comprobante de ${r.customer_name}`} /></a>)}
      {(r.deposit_status === 'esperando' || r.deposit_status === 'comprobante') && r.status === 'pendiente' && (
        <div className="row">
          {/* El botón principal es el método que eligió el cliente; el otro queda al lado por si pagó distinto. */}
          {(cash ? ['efectivo', 'transferencia'] as const : ['transferencia', 'efectivo'] as const).map((m, i) => (
            <button key={m} className={`btn ${i === 0 ? 'primary' : ''}`} disabled={busy} onClick={() => review(true, m)}>
              {m === 'efectivo' ? 'Recibido en efectivo' : 'Recibido por transferencia'}
            </button>
          ))}
          <ConfirmButton label="Rechazar y liberar mesa" confirmLabel="Toca otra vez para rechazar" onConfirm={() => review(false)} />
          {r.phone && <a className="btn sm" href={waLink(r.phone, msg, restaurant.phone_country_code)} target="_blank" rel="noopener noreferrer">Escribirle por WhatsApp ↗</a>}
        </div>
      )}
    </div>
  );
}
