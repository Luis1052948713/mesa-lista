import type { Metadata } from 'next';
import { Salon } from '@/components/views/Salon';

export const metadata: Metadata = { title: 'Salón' };

export default function Page() {
  return <Salon />;
}
