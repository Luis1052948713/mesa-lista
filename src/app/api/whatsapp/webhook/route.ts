import { NextResponse, type NextRequest } from 'next/server';
import { handleIncoming, handleStatus, type IncomingMessage } from '@/lib/reminders';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifySignature } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

// Meta verifica la URL del webhook con un GET al configurarla.
export function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (p.get('hub.mode') === 'subscribe' && p.get('hub.verify_token') === process.env.WHATSAPP_VERIFY_TOKEN && process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(p.get('hub.challenge') ?? '', { status: 200 });
  }
  return new NextResponse('Token de verificación incorrecto', { status: 403 });
}

type WebhookBody = {
  entry?: { changes?: { value?: { messages?: IncomingMessage[]; statuses?: { id: string; status: string }[] } }[] }[];
};

// Respuestas de los clientes y estados de entrega.
export async function POST(req: NextRequest) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return NextResponse.json({ error: 'Falta WHATSAPP_APP_SECRET' }, { status: 500 });
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get('x-hub-signature-256'), secret)) {
    return NextResponse.json({ error: 'Firma inválida' }, { status: 401 });
  }

  let body: WebhookBody;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const admin = createAdminClient();
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const msg of change.value?.messages ?? []) {
        try { await handleIncoming(admin, msg); } catch (e) { console.error('Error procesando mensaje', e); }
      }
      for (const st of change.value?.statuses ?? []) {
        try { await handleStatus(admin, st); } catch (e) { console.error('Error procesando estado', e); }
      }
    }
  }
  // Meta reintenta si no recibe 200, así que siempre respondemos rápido.
  return NextResponse.json({ ok: true });
}
