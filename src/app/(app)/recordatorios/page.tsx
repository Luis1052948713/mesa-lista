import type { Metadata } from 'next';
import { Recordatorios } from '@/components/views/Recordatorios';

export const metadata: Metadata = { title: 'Recordatorios' };

export default function Page() {
  return <Recordatorios />;
}
