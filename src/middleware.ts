import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isSupabaseConfigured, SUPABASE_ANON_KEY, SUPABASE_URL } from './lib/env';

// Rutas que no exigen sesión: el cron y el webhook se autentican con su propio secreto.
const PUBLIC = ['/login', '/auth', '/api/cron', '/api/whatsapp', '/reservar'];

export async function middleware(req: NextRequest) {
  if (!isSupabaseConfigured()) return NextResponse.next();

  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll(list: { name: string; value: string; options: CookieOptions }[]) {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  const path = req.nextUrl.pathname;

  if (!user && !PUBLIC.some((p) => path.startsWith(p))) {
    if (path.startsWith('/api/')) return NextResponse.json({ error: 'Inicia sesión' }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  if (user && path === '/login') {
    const url = req.nextUrl.clone();
    url.pathname = '/hoy';
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|ico|webp)$).*)'],
};
