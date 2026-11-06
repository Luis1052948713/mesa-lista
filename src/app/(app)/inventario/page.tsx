import type { Metadata } from 'next';
import { Inventario } from '@/components/views/Inventario';

export const metadata: Metadata = { title: 'Inventario' };

export default function Page() {
  return <Inventario />;
}
