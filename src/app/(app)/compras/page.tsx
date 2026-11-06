import type { Metadata } from 'next';
import { Compras } from '@/components/views/Compras';

export const metadata: Metadata = { title: 'Compras' };

export default function Page() {
  return <Compras />;
}
