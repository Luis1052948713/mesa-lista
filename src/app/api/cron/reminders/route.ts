import { NextResponse, type NextRequest } from 'next/server';
import { processDueReminders } from '@/lib/reminders';
import { createAdminClient } from '@/lib/supabase/admin';
import { whatsappConfigured } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

// Lo llama un cron cada 5 minutos con el encabezado: Authorization: Bearer <CRON_SECRET>
async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'Falta CRON_SECRET en el servidor' }, { status: 500 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
  if (!whatsappConfigured()) {
    return NextResponse.json({ skipped: true, reason: 'WhatsApp no está configurado' });
  }
  try {
    const result = await processDueReminders(createAdminClient());
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
