import { redirect } from 'next/navigation';
import { SetupNotice } from '@/components/SetupNotice';
import { Shell } from '@/components/Shell';
import { StoreProvider } from '@/components/store';
import { isSupabaseConfigured } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { normalizeRestaurant } from '@/lib/calc';
import { whatsappConfigured } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) return <SetupNotice />;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data } = await supabase.from('memberships').select('restaurants(*)').eq('user_id', user.id).limit(1).maybeSingle();
  const r = data?.restaurants as unknown as Record<string, unknown> | null;
  if (!r) redirect('/onboarding');

  const restaurant = normalizeRestaurant(r);
  return (
    <StoreProvider initialRestaurant={restaurant} userEmail={user.email ?? ''} waReady={whatsappConfigured()}>
      <Shell>{children}</Shell>
    </StoreProvider>
  );
}
