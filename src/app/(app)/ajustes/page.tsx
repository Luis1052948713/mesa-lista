import type { Metadata } from 'next';
import { Ajustes } from '@/components/views/Ajustes';

export const metadata: Metadata = { title: 'Ajustes' };

export default function Page() {
  return <Ajustes />;
}
