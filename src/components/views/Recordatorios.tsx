'use client';

import { fmtDay, hora, REMINDER_LABEL, reminderText, relTime, waLink } from '@/lib/calc';
import { reminderViews, useStore, type ReminderView } from '../store';
import { StatusPill } from '../ui';

export function Recordatorios() {
  const s = useStore();
  const { reservations, now, restaurant, today, tableMap, waReady, copy, markReminderSent, sendReminderNow, setStatus, setModal, toast } = s;
  const all = reminderViews(reservations, now);
  const failed = all.filter((x) => x.state === 'fallido');
  const due = all.filter((x) => x.state === 'ahora' || x.state === 'enviando');
  const scheduled = all.filter((x) => x.state === 'programado');
  const sent = all.filter((x) => x.state === 'enviado');

  const row = ({ rem, res, state }: ReminderView) => {
    const msg = reminderText(res, restaurant.name, today, res.table_id ? tableMap.get(res.table_id)?.name : undefined);
    const when = state === 'enviado' ? 'ENVIADO' : state === 'fallido' ? 'FALLÓ' : state === 'enviando' ? 'ENVIANDO'
      : state === 'ahora' ? 'AHORA' : `en ${relTime(new Date(rem.send_at).getTime() - now)}`;
    const open = state === 'ahora' || state === 'fallido' || state === 'programado';
    return (
      <div key={rem.id} className={`rem ${state === 'ahora' ? 'now' : state === 'enviado' ? 'sent' : state === 'fallido' ? 'failed' : ''}`}>
        <div className="when">{when}<div>{REMINDER_LABEL[rem.kind]}</div></div>
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}><b>{res.customer_name}</b><StatusPill status={res.status} />
            {state === 'enviado' && <span className="tag">{rem.channel === 'whatsapp' ? 'Automático' : 'Manual'}</span>}</div>
          <div className="muted" style={{ fontSize: 13 }}>{fmtDay(res.date)} · {hora(res.time)} · {res.people} pers. · <span className="mono">{res.phone || 'sin celular'}</span></div>
          {state === 'fallido' && rem.error && <div className="msg" style={{ borderColor: 'var(--chili)' }}>{rem.error}</div>}
          {open && state !== 'fallido' && !waReady && <div className="msg">{msg}</div>}
        </div>
        <div className="row acts" style={{ justifyContent: 'flex-end' }}>
          {open && waReady && res.phone && state !== 'programado' && <button className="btn sm primary" onClick={() => sendReminderNow(rem.id)}>{state === 'fallido' ? 'Reintentar' : 'Enviar ahora'}</button>}
          {open && !waReady && res.phone && <>
            <button className="btn sm" onClick={() => copy(msg, 'Mensaje copiado. Pégalo en WhatsApp.')}>Copiar mensaje</button>
            <a className="btn sm" href={waLink(res.phone, msg, restaurant.phone_country_code)} target="_blank" rel="noopener noreferrer">WhatsApp ↗</a>
          </>}
          {open && <button className={`btn sm ${waReady ? '' : 'primary'}`} onClick={() => markReminderSent(rem.id)}>Marcar enviado</button>}
          {state === 'enviado' && res.status === 'pendiente' && (
            <button className="btn sm primary" onClick={async () => { await setStatus(res.id, 'confirmada'); toast(`${res.customer_name}: reserva confirmada.`); }}>Cliente confirmó</button>
          )}
          <button className="btn sm ghost" onClick={() => setModal({ type: 'detail', id: res.id })}>Ver reserva</button>
        </div>
      </div>
    );
  };
  const block = (title: string, xs: ReminderView[], empty: string) => (
    <div className="panel"><h3>{title} <span className="muted" style={{ fontWeight: 500 }}>({xs.length})</span></h3>
      {xs.length ? xs.map(row) : <div className="empty">{empty}</div>}</div>
  );

  return (
    <>
      <div className="head"><div><div className="eyebrow">Notificaciones</div><h2>Recordatorios a clientes</h2>
        <p>Cada reserva programa dos recordatorios: 24 horas y 2 horas antes. {waReady
          ? 'Salen solos por WhatsApp, y si el cliente responde "Confirmo" o "Cancelar", la reserva se actualiza sola.'
          : 'Mientras WhatsApp no esté conectado, la app te avisa cuando toca y tú los envías con un clic.'}</p></div></div>
      {waReady
        ? <div className="banner ok"><span><b>WhatsApp conectado.</b> {restaurant.reminders_enabled ? 'Los recordatorios se envían automáticamente.' : 'Los envíos automáticos están pausados en Ajustes.'}</span></div>
        : <div className="banner"><span><b>Modo manual y gratis.</b> Toca &quot;WhatsApp&quot; en cada recordatorio: se abre el chat del cliente con el mensaje listo, lo envías y tocas &quot;Marcar enviado&quot;. Hazlo al abrir y unas horas antes del servicio.</span></div>}
      {failed.length > 0 && block('No se pudieron enviar', failed, '')}
      {block(waReady ? 'Saliendo ahora' : 'Para enviar ahora', due, 'No hay recordatorios pendientes por enviar.')}
      {block('Programados', scheduled, 'No hay recordatorios programados.')}
      {block('Enviados', sent, 'Todavía no se han enviado recordatorios.')}
    </>
  );
}
