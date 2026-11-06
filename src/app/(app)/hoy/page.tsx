import type { Metadata } from 'next';
import { Hoy } from '@/components/views/Hoy';

export const metadata: Metadata = { title: 'Hoy' };

export default function Page() {
  return <Hoy />;
}
