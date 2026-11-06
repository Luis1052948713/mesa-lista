'use client';

import { useState } from 'react';
import { slotsFor, toMin } from '@/lib/calc';
import { createClient } from '@/lib/supabase/client';
import { BrandPanel, BrandSlot, QrPanel } from '../BrandAndQr';
import { useStore } from '../store';

const ownerOnly = (err: string) => (/row-level|coerce|0 rows/i.test(err) ? 'Solo el dueño del restaurante puede cambiar estos ajustes.' : err);
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function Ajustes() {
  const { restaurant, updateRestaurant, toast, waReady, copy } = useStore();

  /* restaurante */
  const [name, setName] = useState(restaurant.name);
  const [inc, setInc] = useState(Math.round(restaurant.inc_rate * 100));
  const [tip, setTip] = useState(Math.round(restaurant.tip_rate * 100));
  const [enabled, setEnabled] = useState(restaurant.reminders_enabled);
  const [error, setError] = useState('');

  /* horario */
  const [open, setOpen] = useState(restaurant.open_time);
  const [last, setLast] = useState(restaurant.last_booking_time);
  const [step, setStep] = useState(restaurant.slot_minutes);
  const [hErr, setHErr] = useState('');

  /* reservas en línea */
  const [bookingOn, setBookingOn] = useState(restaurant.booking_enabled);
  const [slug, setSlug] = useState(restaurant.slug);
  const [deposit, setDeposit] = useState(String(restaurant.deposit_amount));
  const [hold, setHold] = useState(String(restaurant.hold_minutes));
  const [bank, setBank] = useState(restaurant.bank_details);
  const [wa, setWa] = useState(restaurant.whatsapp_phone);
  const [policy, setPolicy] = useState(restaurant.booking_policy);
  const [maxP, setMaxP] = useState(String(restaurant.max_online_people));
  const [adv, setAdv] = useState(String(restaurant.min_advance_hours));
  const [cashOn, setCashOn] = useState(restaurant.accept_cash);
  const [cashHours, setCashHours] = useState(String(restaurant.cash_hold_hours));
  const [cashText, setCashText] = useState(restaurant.cash_instructions);
  const [bErr, setBErr] = useState('');

  const [password, setPassword] = useState('');
  const publicUrl = typeof window !== 'undefined' && restaurant.slug ? `${window.location.origin}/reservar/${restaurant.slug}` : '';

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (name.trim().length < 2) return setError('El nombre debe tener al menos 2 letras.');
    const err = await updateRestaurant({ name: name.trim(), inc_rate: inc / 100, tip_rate: tip / 100, reminders_enabled: enabled });
    if (err) return setError(ownerOnly(err));
    // Los correos de la cuenta (recuperar contraseña) muestran este nombre.
    await createClient().auth.updateUser({ data: { business_name: name.trim() } });
    toast('Ajustes guardados.');
  }

  async function saveHours(e: React.FormEvent) {
    e.preventDefault();
    setHErr('');
    if (!open || !last) return setHErr('Elige la hora de apertura y la de la última reserva.');
    if (toMin(last) < toMin(open)) return setHErr('La última reserva debe ser después de la hora de apertura.');
    const err = await updateRestaurant({ open_time: open, last_booking_time: last, slot_minutes: step });
    if (err) return setHErr(ownerOnly(err));
    toast(`Horario guardado: reservas de ${open} a ${last}.`);
  }

  async function saveBooking(e: React.FormEvent) {
    e.preventDefault();
    setBErr('');
    const s = slug.trim().toLowerCase();
    if (!SLUG.test(s) || s.length < 3 || s.length > 40) return setBErr('La dirección solo puede tener letras minúsculas, números y guiones (3 a 40), por ejemplo la-20-gourmet.');
    const dep = Number(deposit), h = Number(hold), mp = Number(maxP), ad = Number(adv);
    if (!(dep >= 0)) return setBErr('El anticipo debe ser un valor de 0 en adelante.');
    if (!(h >= 10 && h <= 1440)) return setBErr('El tiempo para pagar debe estar entre 10 minutos y 24 horas (1440).');
    if (!(mp >= 1 && mp <= 60)) return setBErr('El máximo de personas en línea debe estar entre 1 y 60.');
    if (!(ad >= 0 && ad <= 72)) return setBErr('La anticipación mínima debe estar entre 0 y 72 horas.');
    if (bookingOn && dep > 0 && !bank.trim()) return setBErr('Escribe los datos de la cuenta para que el cliente pueda transferir el anticipo.');
    const ch = Number(cashHours);
    if (cashOn && !(ch >= 1 && ch <= 72)) return setBErr('El plazo para pagar en efectivo debe estar entre 1 y 72 horas.');
    const err = await updateRestaurant({
      booking_enabled: bookingOn, slug: s, deposit_amount: dep, hold_minutes: h, bank_details: bank.trim(),
      whatsapp_phone: wa.trim(), booking_policy: policy.trim(), max_online_people: mp, min_advance_hours: ad,
      accept_cash: cashOn, cash_hold_hours: cashOn ? ch : restaurant.cash_hold_hours, cash_instructions: cashText.trim(),
    });
    if (err) return setBErr(/duplicate|unique/i.test(err) ? 'Esa dirección ya la usa otro restaurante. Prueba otra.' : ownerOnly(err));
    setSlug(s);
    toast(bookingOn ? 'Reservas en línea activadas.' : 'Ajustes de reservas en línea guardados.');
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return toast('La contraseña debe tener al menos 8 caracteres.', 'alert');
    const { error } = await createClient().auth.updateUser({ password });
    if (error) return toast(error.message, 'alert');
    setPassword('');
    toast('Contraseña actualizada.');
  }

  const preview = slotsFor({ open_time: open, last_booking_time: last, slot_minutes: step });
  const form = { display: 'grid', gap: 12, alignContent: 'start' } as const;

  return (
    <>
      <div className="head"><div><div className="eyebrow">Ajustes</div><h2>{restaurant.name}</h2></div></div>

      <div className="grid-auto">
        <QrPanel />
        <BrandPanel />
      </div>

      <form className="panel" onSubmit={saveBooking} style={form}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3>Reservas en línea con anticipo</h3>
          <span className={`tag ${restaurant.booking_enabled ? 'good' : ''}`}>{restaurant.booking_enabled ? 'Activas' : 'Apagadas'}</span>
        </div>
        <p className="muted" style={{ fontSize: 14, maxWidth: '70ch' }}>
          Tus clientes eligen día, hora y personas en tu página. La mesa queda apartada mientras transfieren el anticipo y suben el comprobante.
          Tú lo revisas en tu banco y confirmas con un toque. Si no pagan a tiempo, la mesa se libera sola. Sin pasarela de pagos ni comisiones.
        </p>
        {restaurant.booking_enabled && publicUrl && (
          <div className="banner ok">
            <span className="mono" style={{ overflowWrap: 'anywhere' }}>{publicUrl}</span>
            <div className="row">
              <button type="button" className="btn sm" onClick={() => copy(publicUrl, 'Enlace copiado. Ponlo en tu Instagram y WhatsApp.')}>Copiar enlace</button>
              <a className="btn sm" href={publicUrl} target="_blank" rel="noopener noreferrer">Abrir ↗</a>
            </div>
          </div>
        )}
        <label className="check"><input type="checkbox" checked={bookingOn} onChange={(e) => setBookingOn(e.target.checked)} /> Recibir reservas en línea</label>
        <div className="fgrid">
          <div className="field"><label htmlFor="o-slug">Dirección de tu página</label>
            <input id="o-slug" type="text" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
            <span className="muted" style={{ fontSize: 12 }}>…/reservar/<b>{slug || 'tu-restaurante'}</b></span></div>
          <div className="field"><label htmlFor="o-wa">WhatsApp del restaurante</label>
            <input id="o-wa" type="tel" placeholder="300 123 4567" value={wa} onChange={(e) => setWa(e.target.value)} />
            <span className="muted" style={{ fontSize: 12 }}>Para que el cliente te escriba con un toque.</span></div>
          <div className="field"><label htmlFor="o-dep">Anticipo por reserva (COP)</label>
            <input id="o-dep" type="number" min={0} step={5000} value={deposit} onChange={(e) => setDeposit(e.target.value)} />
            <span className="muted" style={{ fontSize: 12 }}>0 = sin anticipo.</span></div>
          <div className="field"><label htmlFor="o-hold">Minutos para pagar</label>
            <input id="o-hold" type="number" min={10} max={1440} step={5} value={hold} onChange={(e) => setHold(e.target.value)} />
            <span className="muted" style={{ fontSize: 12 }}>Si no sube el comprobante en este tiempo, se cancela.</span></div>
          <div className="field"><label htmlFor="o-max">Máximo de personas en línea</label>
            <input id="o-max" type="number" min={1} max={60} value={maxP} onChange={(e) => setMaxP(e.target.value)} /></div>
          <div className="field"><label htmlFor="o-adv">Anticipación mínima (horas)</label>
            <input id="o-adv" type="number" min={0} max={72} value={adv} onChange={(e) => setAdv(e.target.value)} /></div>
        </div>
        <BrandSlot kind="payqr" label="QR para transferir"
          hint="Toma captura del QR de tu Nequi (o Bre-B / banco) y súbela. El cliente lo escanea o lo guarda para pagar. Se guarda al subirlo." />
        <div className="field"><label htmlFor="o-bank">Datos para la transferencia</label>
          <textarea id="o-bank" rows={4} maxLength={500} value={bank} onChange={(e) => setBank(e.target.value)}
            placeholder={'Bancolombia · Cuenta de ahorros\nN.º 000-000000-00\nA nombre de: LA 20 GOURMET S.A.S.\nNIT 900.000.000-0'} />
          <span className="muted" style={{ fontSize: 12 }}>El cliente lo ve tal cual en su reserva. No pongas claves ni datos de acceso.</span></div>
        <div className="cash-box">
          <label className="check"><input type="checkbox" checked={cashOn} onChange={(e) => setCashOn(e.target.checked)} /> Aceptar el anticipo en efectivo en el restaurante</label>
          {cashOn && <>
            <div className="fgrid">
              <div className="field"><label htmlFor="o-ch">Horas para pasar a pagar</label>
                <input id="o-ch" type="number" min={1} max={72} value={cashHours} onChange={(e) => setCashHours(e.target.value)} />
                <span className="muted" style={{ fontSize: 12 }}>Como máximo hasta 2 horas antes de la reserva. Si no paga, se libera sola.</span></div>
            </div>
            <div className="field"><label htmlFor="o-ct">Instrucciones para pagar en efectivo</label>
              <textarea id="o-ct" rows={3} maxLength={400} value={cashText} onChange={(e) => setCashText(e.target.value)}
                placeholder={'Calle 20 # 00-00, barrio …\nCaja abierta de lunes a domingo, 4:00 p. m. a 11:00 p. m.\nDi tu código de reserva al pagar.'} />
              <span className="muted" style={{ fontSize: 12 }}>Pon la dirección y el horario en que pueden pasar a pagar.</span></div>
          </>}
        </div>
        <div className="field"><label htmlFor="o-pol">Condiciones del anticipo</label>
          <textarea id="o-pol" rows={3} maxLength={600} value={policy} onChange={(e) => setPolicy(e.target.value)} /></div>
        {bErr && <div className="err">{bErr}</div>}
        <div><button className="btn primary">Guardar reservas en línea</button></div>
      </form>

      <div className="grid-auto">
        <form className="panel" onSubmit={saveHours} style={form}>
          <h3>Horario de cena</h3>
          <div className="fgrid">
            <div className="field"><label htmlFor="h-open">Primera reserva</label><input id="h-open" type="time" step={900} value={open} onChange={(e) => setOpen(e.target.value)} /></div>
            <div className="field"><label htmlFor="h-last">Última reserva</label><input id="h-last" type="time" step={900} value={last} onChange={(e) => setLast(e.target.value)} /></div>
          </div>
          <div className="field"><label htmlFor="h-step">Turnos cada</label>
            <select id="h-step" value={step} onChange={(e) => setStep(Number(e.target.value))}>
              {[15, 30, 60].map((m) => <option key={m} value={m}>{m} minutos</option>)}
            </select></div>
          <p className="muted" style={{ fontSize: 13 }}>Horas que se ofrecen: {preview.join(' · ') || '—'}</p>
          {hErr && <div className="err">{hErr}</div>}
          <div><button className="btn primary">Guardar horario</button></div>
        </form>

        <form className="panel" onSubmit={save} style={form}>
          <h3>Restaurante</h3>
          <div className="field"><label htmlFor="a-name">Nombre</label><input id="a-name" type="text" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="fgrid">
            <div className="field"><label htmlFor="a-inc">Impoconsumo (%)</label><input id="a-inc" type="number" min={0} max={30} value={inc} onChange={(e) => setInc(parseFloat(e.target.value) || 0)} /></div>
            <div className="field"><label htmlFor="a-tip">Propina sugerida (%)</label><input id="a-tip" type="number" min={0} max={30} value={tip} onChange={(e) => setTip(parseFloat(e.target.value) || 0)} /></div>
          </div>
          {waReady
            ? <label className="check"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enviar recordatorios automáticos por WhatsApp</label>
            : <p className="muted" style={{ fontSize: 13 }}>Recordatorios en modo manual y gratis: la pestaña Recordatorios te dice a quién escribir y abre WhatsApp con el mensaje listo.</p>}
          <p className="muted" style={{ fontSize: 13 }}>Zona horaria: <span className="mono">{restaurant.timezone}</span></p>
          {error && <div className="err">{error}</div>}
          <div><button className="btn primary">Guardar ajustes</button></div>
        </form>

        <form className="panel" onSubmit={changePassword} style={form}>
          <h3>Tu cuenta</h3>
          <div className="field"><label htmlFor="a-pass">Nueva contraseña</label>
            <input id="a-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" /></div>
          <div><button className="btn">Cambiar contraseña</button></div>
        </form>
      </div>
    </>
  );
}
