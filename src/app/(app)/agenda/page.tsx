import type { Metadata } from 'next';
import { Agenda } from '@/components/views/Agenda';

export const metadata: Metadata = { title: 'Agenda' };

export default function Page() {
  return <Agenda />;
}
