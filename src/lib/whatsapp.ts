// Cliente mínimo de WhatsApp Cloud API (Meta). Solo se usa en el servidor.
import { createHmac, timingSafeEqual } from 'node:crypto';

const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0';
export const TEMPLATE_NAME = process.env.WHATSAPP_TEMPLATE_NAME || 'recordatorio_reserva';
export const TEMPLATE_LANG = process.env.WHATSAPP_TEMPLATE_LANG || 'es';

export const whatsappConfigured = () => Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

/** Número en formato internacional sin "+" (57300…), o null si no sirve. */
export function toWhatsAppNumber(phone: string, countryCode = '57') {
  const d = phone.replace(/\D/g, '');
  if (d.length < 10) return null;
  if (d.length === 10) return countryCode + d;
  return d;
}

export const lastDigits = (phone: string, n = 10) => phone.replace(/\D/g, '').slice(-n);

// Se comparan sin tildes ("sí" → "si") para que \b funcione con cualquier escritura.
const YES = /^(si+|confirm\w*|ok|dale|listo|claro)\b/;
const NO = /^(no|cancel\w*)\b/;
const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Decide si una respuesta de texto libre confirma o cancela la reserva. */
export function intentOf(text: string): 'confirm' | 'cancel' | null {
  const t = plain(text.trim());
  if (YES.test(t)) return 'confirm';
  if (NO.test(t)) return 'cancel';
  return null;
}

async function post(body: unknown): Promise<string> {
  const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json?.error;
    throw new Error(e?.error_user_msg || e?.message || `WhatsApp respondió ${res.status}`);
  }
  return json?.messages?.[0]?.id as string;
}

/**
 * Envía la plantilla aprobada de recordatorio. Las variables del cuerpo van en orden
 * y cada botón de respuesta rápida lleva su payload (CONFIRMAR:<id> / CANCELAR:<id>).
 */
export function sendTemplate(to: string, bodyParams: string[], buttonPayloads: string[]) {
  return post({
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: TEMPLATE_NAME,
      language: { code: TEMPLATE_LANG },
      components: [
        { type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text })) },
        ...buttonPayloads.map((payload, i) => ({
          type: 'button', sub_type: 'quick_reply', index: String(i), parameters: [{ type: 'payload', payload }],
        })),
      ],
    },
  });
}

/** Texto libre: solo permitido dentro de las 24 h después de que el cliente escribe. */
export function sendText(to: string, body: string) {
  return post({ messaging_product: 'whatsapp', to, type: 'text', text: { body } });
}

/** Verifica la firma X-Hub-Signature-256 que Meta pone en cada webhook. */
export function verifySignature(raw: string, header: string | null, secret: string) {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  const got = header.slice(7);
  return got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}
