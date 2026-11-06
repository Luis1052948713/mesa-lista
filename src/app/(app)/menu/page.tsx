import type { Metadata } from 'next';
import { Menu } from '@/components/views/Menu';

export const metadata: Metadata = { title: 'Menú y recetas' };

export default function Page() {
  return <Menu />;
}
