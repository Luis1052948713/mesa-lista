// Envío de recordatorios por WhatsApp y manejo de respuestas. Solo servidor.
import type { SupabaseClient } from '@supabase/supabase-js';
import { intentOf, lastDigits, sendTemplate, sendText, toWhatsAppNumber } from './whatsapp';

interface ReminderRow { id: string; restaurant_id: string; reservation_id: string; kind: '24h' | '2h' }

function formatWhen(iso: string, tz: string) {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('es-CO', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(d);
  const time = new Intl.DateTimeFormat('es-CO', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
  return { day, time };
}

/** Envía un recordatorio ya reclamado (estado "enviando") y deja el resultado en la base. */
export async function deliverReminder(admin: SupabaseClient, rem: ReminderRow) {
  const { data: res, error } = await admin
    .from('reservations')
    .select('id, customer_name, phone, starts_at, people, status, restaurants(name, timezone, phone_country_code)')
    .eq('id', rem.reservation_id)
    .single();
  if (error || !res) {
    await admin.from('reminders').update({ status: 'fallido', error: 'Reserva no encontrada', attempts: 3 }).eq('id', rem.id);
    return { ok: false, error: 'Reserva no encontrada' };
  }
  const rest = res.restaurants as unknown as { name: string; timezone: string; phone_country_code: string };
  const to = toWhatsAppNumber(res.phone, rest.phone_country_code);
  if (!to) {
    // Sin número válido no tiene sentido reintentar.
    await admin.from('reminders').update({ status: 'fallido', error: 'La reserva no tiene un celular válido', attempts: 3 }).eq('id', rem.id);
    return { ok: false, error: 'La reserva no tiene un celular válido' };
  }
  const { day, time } = formatWhen(res.starts_at, rest.timezone);
  try {
    const messageId = await sendTemplate(
      to,
      [res.customer_name, rest.name, day, time, String(res.people)],
      [`CONFIRMAR:${res.id}`, `CANCELAR:${res.id}`],
    );
    await admin.from('reminders').update({
      status: 'enviado', channel: 'whatsapp', sent_at: new Date().toISOString(), provider_message_id: messageId, error: null,
    }).eq('id', rem.id);
    await admin.from('whatsapp_events').insert({
      restaurant_id: rem.restaurant_id, reservation_id: res.id, direction: 'out', phone: to, kind: `recordatorio_${rem.kind}`,
      body: `${res.customer_name} · ${day} ${time}`, payload: { message_id: messageId },
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from('reminders').update({ status: 'fallido', error: msg.slice(0, 300) }).eq('id', rem.id);
    return { ok: false, error: msg };
  }
}

/** Lo que llama el cron: reclama los vencidos y los envía uno por uno. */
export async function processDueReminders(admin: SupabaseClient) {
  const { data, error } = await admin.rpc('claim_due_reminders', { p_limit: 50 });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ReminderRow[];
  let sent = 0;
  const failed: string[] = [];
  for (const rem of rows) {
    const r = await deliverReminder(admin, rem);
    if (r.ok) sent++;
    else failed.push(r.error ?? 'error');
  }
  return { claimed: rows.length, sent, failed };
}

/* ---------- respuestas del cliente ---------- */

export type IncomingMessage = {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
  button?: { payload?: string; text?: string };
  interactive?: { button_reply?: { id: string; title: string } };
  context?: { id?: string };
};

/** Interpreta una respuesta y confirma o cancela la reserva que corresponda. */
export async function handleIncoming(admin: SupabaseClient, msg: IncomingMessage) {
  const payload = msg.button?.payload ?? msg.interactive?.button_reply?.id ?? '';
  const text = (msg.text?.body ?? msg.button?.text ?? msg.interactive?.button_reply?.title ?? '').trim();
  let action: 'confirm' | 'cancel' | null = null;
  let reservationId: string | null = null;

  const m = /^(CONFIRMAR|CANCELAR):([0-9a-f-]{36})$/i.exec(payload);
  if (m) {
    action = m[1].toUpperCase() === 'CONFIRMAR' ? 'confirm' : 'cancel';
    reservationId = m[2];
  } else {
    action = intentOf(text);
  }

  // Si respondió citando nuestro mensaje, el contexto dice a qué reserva.
  if (!reservationId && msg.context?.id) {
    const { data } = await admin.from('reminders').select('reservation_id').eq('provider_message_id', msg.context.id).maybeSingle();
    reservationId = data?.reservation_id ?? null;
  }

  const digits = lastDigits(msg.from);
  const base = admin
    .from('reservations')
    .select('id, restaurant_id, customer_name, phone_digits, starts_at, status, restaurants(name, timezone)')
    .in('status', ['pendiente', 'confirmada'])
    .gt('starts_at', new Date().toISOString());
  const { data: candidates } = reservationId
    ? await base.eq('id', reservationId)
    : await base.like('phone_digits', `%${digits}`).order('starts_at').limit(1);
  // El celular que responde debe ser el de la reserva: así nadie confirma reservas ajenas.
  const res = candidates?.find((r) => lastDigits(r.phone_digits) === digits);

  await admin.from('whatsapp_events').insert({
    restaurant_id: res?.restaurant_id ?? null, reservation_id: res?.id ?? null, direction: 'in', phone: msg.from,
    kind: action ?? 'mensaje', body: text || payload, payload: msg,
  });
  if (!res || !action) return { handled: false };

  const rest = res.restaurants as unknown as { name: string; timezone: string };
  const { day, time } = formatWhen(res.starts_at, rest.timezone);
  if (action === 'confirm') {
    if (res.status === 'pendiente') {
      await admin.from('reservations').update({ status: 'confirmada', confirmed_via: 'whatsapp' }).eq('id', res.id);
    }
    await reply(admin, res, msg.from, `¡Gracias, ${res.customer_name}! Tu reserva en ${rest.name} para el ${day} a las ${time} quedó confirmada. Te esperamos.`);
  } else {
    await admin.from('reservations').update({ status: 'cancelada' }).eq('id', res.id);
    await reply(admin, res, msg.from, `Listo, ${res.customer_name}. Cancelamos tu reserva en ${rest.name} del ${day} a las ${time}. Si quieres otra fecha, escríbenos por aquí.`);
  }
  return { handled: true, action, reservation: res.id };
}

async function reply(admin: SupabaseClient, res: { id: string; restaurant_id: string }, to: string, body: string) {
  try {
    await sendText(to, body);
    await admin.from('whatsapp_events').insert({ restaurant_id: res.restaurant_id, reservation_id: res.id, direction: 'out', phone: to, kind: 'respuesta', body });
  } catch (e) {
    console.error('No se pudo responder por WhatsApp', e);
  }
}

/** Marca como fallido un recordatorio que WhatsApp no pudo entregar. */
export async function handleStatus(admin: SupabaseClient, status: { id: string; status: string; errors?: { title?: string; message?: string }[] }) {
  if (status.status !== 'failed') return;
  const err = status.errors?.[0];
  await admin.from('reminders')
    .update({ status: 'fallido', error: (err?.message || err?.title || 'WhatsApp no pudo entregar el mensaje').slice(0, 300) })
    .eq('provider_message_id', status.id);
}
