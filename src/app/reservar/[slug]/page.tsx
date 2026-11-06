import type { Metadata } from 'next';
import { Logo } from '@/components/Logo';
import { getPublicMenu, getPublicRestaurant } from '@/lib/public';
import { BookingFormClient } from './BookingFormClient';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const r = await getPublicRestaurant((await params).slug);
  return { title: r ? `Reservar en ${r.name}` : 'Reservas' };
}

export default async function ReservarPage({ params }: { params: Promise<{ slug: string }> }) {
  const r = await getPublicRestaurant((await params).slug);
  if (!r) {
    return (
      <div className="pub"><div className="pub-card">
        <div className="row"><Logo /><h1 style={{ fontSize: 24 }}>Reservas en línea</h1></div>
        <p>Este restaurante no está recibiendo reservas en línea en este momento. Comunícate directamente con ellos.</p>
      </div></div>
    );
  }
  const menu = await getPublicMenu(r.slug);
  return <BookingFormClient r={r} menu={menu} />;
}
