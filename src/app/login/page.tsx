import type { Metadata } from 'next';
import { SetupNotice } from '@/components/SetupNotice';
import { isSupabaseConfigured } from '@/lib/env';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Entrar' };
export const dynamic = 'force-dynamic';

export default function LoginPage() {
  if (!isSupabaseConfigured()) return <SetupNotice />;
  return <LoginForm />;
}
