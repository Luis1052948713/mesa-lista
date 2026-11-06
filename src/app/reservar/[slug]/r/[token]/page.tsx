import type { Metadata } from 'next';
import { Logo } from '@/components/Logo';
import { getPublicReservation } from '@/lib/public';
import { ReservationStatus } from './ReservationStatus';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Tu reserva', robots: { index: false } };

export default async function ReservaPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { token } = await params;
  const r = await getPublicReservation(token);
  if (!r) {
    return (
      <div className="pub"><div className="pub-card">
        <div className="row"><Logo /><h1 style={{ fontSize: 24 }}>Reserva no encontrada</h1></div>
        <p>Revisa que el enlace esté completo. Si el problema sigue, comunícate con el restaurante.</p>
      </div></div>
    );
  }
  return <ReservationStatus r={r} token={token} />;
}
