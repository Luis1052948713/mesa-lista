import { NextResponse, type NextRequest } from 'next/server';
import { deliverReminder } from '@/lib/reminders';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { whatsappConfigured } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

// "Enviar ahora" desde la app: el usuario debe pertenecer al restaurante del recordatorio.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!whatsappConfigured()) return NextResponse.json({ error: 'WhatsApp no está configurado en el servidor.' }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Inicia sesión' }, { status: 401 });
  // Esta lectura pasa por la seguridad por filas: si no es de su restaurante, no la ve.
  const { data: rem } = await supabase.from('reminders').select('id, restaurant_id, reservation_id, kind, status').eq('id', id).maybeSingle();
  if (!rem) return NextResponse.json({ error: 'Recordatorio no encontrado' }, { status: 404 });

  const admin = createAdminClient();
  const { data: claimed } = await admin.from('reminders')
    .update({ status: 'enviando', claimed_at: new Date().toISOString(), attempts: 1 })
    .eq('id', id).in('status', ['programado', 'fallido'])
    .select('id, restaurant_id, reservation_id, kind').maybeSingle();
  if (!claimed) return NextResponse.json({ error: 'Este recordatorio ya se envió o se está enviando.' }, { status: 409 });

  const result = await deliverReminder(admin, claimed);
  return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.error }, { status: 502 });
}
