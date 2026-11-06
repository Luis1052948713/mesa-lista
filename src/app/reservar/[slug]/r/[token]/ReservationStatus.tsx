'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BrandHeader } from '../../BookingForm';
import { capitalize, fmtLong, hora, localParts, money, waLink } from '@/lib/calc';
import type { PublicReservation } from '@/lib/public';
import { createClient } from '@/lib/supabase/client';

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

export function ReservationStatus({ r, token }: { r: PublicReservation; token: string }) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const rest = r.restaurant;
  const left = r.hold_expires_at ? new Date(r.hold_expires_at).getTime() - now : 0;
  const waiting = r.status === 'pendiente' && r.deposit_status === 'esperando';
  const reference = `R-${r.code} ${r.customer_name}`;
  const wa = rest.whatsapp_phone.replace(/\D/g, '');

  // Cuenta regresiva y, cuando vence, vuelve a pedir el estado al servidor.
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [waiting]);
  useEffect(() => {
    if (waiting && left <= 0) {
      const t = setTimeout(() => router.refresh(), 2000);
      return () => clearTimeout(t);
    }
  }, [waiting, left, router]);

  // Mientras el restaurante revisa el comprobante, consulta el estado cada 30 segundos.
  const reviewing = r.status === 'pendiente' && r.deposit_status === 'comprobante';
  useEffect(() => {
    if (!reviewing) return;
    const id = setInterval(() => router.refresh(), 30000);
    return () => clearInterval(id);
  }, [reviewing, router]);

  async function upload(file: File | undefined) {
    setError('');
    if (!file) return;
    if (!TYPES.includes(file.type)) return setError('Sube una foto (JPG, PNG) o un PDF del comprobante.');
    if (file.size > MAX_BYTES) return setError('El archivo pesa más de 5 MB. Toma una captura de pantalla y súbela.');
    setBusy(true);
    const ext = file.type === 'application/pdf' ? 'pdf' : (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${token}/${Date.now()}.${ext}`;
    const supabase = createClient();
    const up = await supabase.storage.from('comprobantes').upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) {
      setBusy(false);
      return setError('No se pudo subir el comprobante. Revisa tu conexión y vuelve a intentarlo.');
    }
    const { error } = await supabase.rpc('public_receipt_uploaded', { p_token: token, p_path: path });
    setBusy(false);
    if (error) return setError(error.message);
    router.refresh();
  }

  function copyRef() {
    navigator.clipboard?.writeText(reference).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }, () => {});
  }

  const head = <BrandHeader name={rest.name} logo={rest.logo_url} cover={rest.cover_url} subtitle={`Reserva R-${r.code}`} />;
  const summary = (
    <div className={`pub-sum ${r.table_name ? 'four' : ''}`}>
      <div><span className="eyebrow">Día</span><b>{capitalize(fmtLong(r.date))}</b></div>
      <div><span className="eyebrow">Hora</span><b className="mono">{hora(r.time)}</b></div>
      <div><span className="eyebrow">Personas</span><b>{r.people}</b></div>
      {r.table_name && <div><span className="eyebrow">Mesa</span><b>{r.table_name}{r.table_zone ? ` · ${r.table_zone}` : ''}</b></div>}
    </div>
  );
  const orderTotal = r.items.reduce((a, i) => a + i.qty * i.unit_price, 0);
  const order = r.items.length > 0 && (
    <div className="order-sum">
      <b>Tu pedido</b>
      {r.items.map((i) => <div key={i.name} className="ln"><span>{i.qty} × {i.name}</span><span>{money(i.qty * i.unit_price)}</span></div>)}
      <div className="ln tot"><span>Total estimado</span><span>{money(orderTotal)}</span></div>
      <span className="muted" style={{ fontSize: 12 }}>Si quieres cambiar algo, escríbele al restaurante por WhatsApp.</span>
    </div>
  );
  const contact = wa ? (
    <a className="btn wide" href={waLink(wa, `Hola, tengo la reserva R-${r.code} a nombre de ${r.customer_name}.`, rest.phone_country_code)} target="_blank" rel="noopener noreferrer">
      Escribir al restaurante por WhatsApp ↗</a>
  ) : null;

  let body: React.ReactNode;
  if (r.status === 'cancelada') {
    body = <>
      <div className="callout red"><b>{r.deposit_status === 'vencido' ? 'El tiempo para pagar el anticipo terminó y la mesa se liberó.' : 'Esta reserva fue cancelada.'}</b></div>
      <Link className="btn primary wide" href={`/reservar/${rest.slug}`}>Hacer una nueva reserva</Link>
    </>;
  } else if (r.status === 'confirmada' || r.status === 'atendida' || r.deposit_status === 'pagado' || r.deposit_status === 'no_aplica') {
    body = <>
      <div className="note">¡Listo, {r.customer_name}! Tu reserva está confirmada. Te esperamos.</div>
      {r.deposit_status === 'pagado' && <p className="muted">Recibimos tu anticipo de {money(rest.deposit_amount)}; se descuenta de tu cuenta ese día.</p>}
    </>;
  } else if (r.deposit_status === 'comprobante') {
    body = <>
      <div className="callout amber"><b>Recibimos tu comprobante.</b> El restaurante lo está revisando y tu mesa sigue apartada. Esta página se actualiza cuando confirmen.</div>
      <label className="btn wide" style={{ cursor: 'pointer' }}>
        {busy ? 'Subiendo…' : 'Subir otro comprobante'}
        <input type="file" accept={TYPES.join(',')} hidden disabled={busy} onChange={(e) => upload(e.target.files?.[0])} />
      </label>
    </>;
  } else {
    const mins = Math.max(0, Math.floor(left / 60000));
    const secs = Math.max(0, Math.floor((left % 60000) / 1000));
    const cash = r.deposit_method === 'efectivo';
    const until = r.hold_expires_at ? localParts(r.hold_expires_at, rest.timezone) : null;
    const transfer = (
      <>
        <div className="pay">
          <div className="pay-amount"><span className="eyebrow">Valor a transferir</span><b>{money(rest.deposit_amount)}</b></div>
          {rest.pay_qr_url && (
            <div className="pay-qr">
              {/* eslint-disable-next-line @next/next/no-img-element -- QR del restaurante en Supabase Storage */}
              <img src={rest.pay_qr_url} alt="QR para transferir el anticipo" />
              <span>Escanéalo con tu app de Nequi o de tu banco. Si estás en este mismo celular, abre el QR, mantenlo presionado para guardarlo y en tu app elige escanear desde la galería.</span>
              <a className="btn sm" href={rest.pay_qr_url} target="_blank" rel="noopener noreferrer">Abrir el QR para guardarlo ↗</a>
            </div>
          )}
          {rest.bank_details
            ? rest.pay_qr_url
              ? <details className="more"><summary>Ver los datos de la cuenta</summary><pre className="pay-bank">{rest.bank_details}</pre></details>
              : <pre className="pay-bank">{rest.bank_details}</pre>
            : !rest.pay_qr_url && <p className="muted">El restaurante te enviará los datos de la cuenta por WhatsApp.</p>}
          <div className="pay-ref">
            <span className="eyebrow">Escribe esto en la descripción de la transferencia</span>
            <div className="row"><b className="mono">{reference}</b><button type="button" className="btn sm" onClick={copyRef}>{copied ? 'Copiado' : 'Copiar'}</button></div>
          </div>
        </div>
        <label className={`btn ${cash ? '' : 'primary'} wide`} style={{ cursor: 'pointer' }}>
          {busy ? 'Subiendo comprobante…' : 'Subir foto o PDF del comprobante'}
          <input type="file" accept={TYPES.join(',')} hidden disabled={busy} onChange={(e) => upload(e.target.files?.[0])} />
        </label>
      </>
    );
    body = cash ? <>
      <div className="callout amber">
        <b>Tu mesa está apartada{until ? ` hasta el ${fmtLong(until.date)} a las ${hora(until.time)}` : ''}.</b> Pasa por el restaurante a pagar el anticipo en efectivo para confirmarla{left >= 3600000 ? ` (te quedan ${Math.floor(left / 3600000)} h ${Math.round((left % 3600000) / 60000)} min)` : ` (te quedan ${mins} min)`}.
      </div>
      <div className="pay">
        <div className="pay-amount"><span className="eyebrow">Anticipo en efectivo</span><b>{money(rest.deposit_amount)}</b></div>
        {rest.cash_instructions && <p style={{ whiteSpace: 'pre-wrap' }}>{rest.cash_instructions}</p>}
        <div className="pay-ref">
          <span className="eyebrow">Tu código de reserva</span>
          <div className="row"><b className="mono" style={{ fontSize: 22 }}>R-{r.code}</b></div>
        </div>
      </div>
      <button type="button" className="btn ghost" onClick={() => setShowTransfer((v) => !v)} aria-expanded={showTransfer}>
        {showTransfer ? 'Ocultar datos para transferir' : '¿Prefieres transferir? Ver los datos'}
      </button>
      {showTransfer && transfer}
      {rest.booking_policy && <p className="muted" style={{ fontSize: 13 }}>{rest.booking_policy}</p>}
    </> : <>
      <div className="callout amber">
        <b>Tu mesa está apartada por {mins}:{String(secs).padStart(2, '0')} minutos.</b> Transfiere el anticipo y sube el comprobante para confirmarla.
      </div>
      {transfer}
      {rest.booking_policy && <p className="muted" style={{ fontSize: 13 }}>{rest.booking_policy}</p>}
    </>;
  }

  return (
    <div className="pub">
      <div className="pub-card">
        {head}
        {summary}
        {order}
        {body}
        {error && <div className="err" role="alert">{error}</div>}
        {contact}
        <p className="muted" style={{ fontSize: 12 }}>Guarda este enlace: aquí puedes ver el estado de tu reserva en cualquier momento.</p>
      </div>
    </div>
  );
}
