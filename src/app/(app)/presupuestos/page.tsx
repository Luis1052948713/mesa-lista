import type { Metadata } from 'next';
import { Presupuestos } from '@/components/views/Presupuestos';

export const metadata: Metadata = { title: 'Presupuestos' };

export default function Page() {
  return <Presupuestos />;
}
