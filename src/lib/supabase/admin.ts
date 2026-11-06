import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL } from '../env';

/**
 * Cliente con la llave de servicio: se salta la seguridad por filas.
 * Solo para rutas del servidor (cron y webhook). Nunca lo importes en el navegador.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !key) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
