import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SetupNotice } from '@/components/SetupNotice';
import { isSupabaseConfigured } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { OnboardingForm } from './OnboardingForm';

export const metadata: Metadata = { title: 'Tu restaurante' };
export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  if (!isSupabaseConfigured()) return <SetupNotice />;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data } = await supabase.from('memberships').select('restaurant_id').eq('user_id', user.id).limit(1);
  if (data?.length) redirect('/hoy');
  const business = typeof user.user_metadata?.business_name === 'string' ? user.user_metadata.business_name : '';
  return <OnboardingForm email={user.email ?? ''} business={business} />;
}
