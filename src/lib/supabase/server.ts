import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../env';

/** Cliente con la sesión del usuario (respeta la seguridad por filas). */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(list: { name: string; value: string; options: CookieOptions }[]) {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Llamado desde un Server Component: el middleware ya refresca la sesión.
        }
      },
    },
  });
}
