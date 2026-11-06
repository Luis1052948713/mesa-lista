'use client';

import dynamic from 'next/dynamic';
import type { MenuDish, PublicRestaurant } from '@/lib/public';
import { BrandHeader } from './BookingForm';

// Se pinta solo en el navegador para poder llenar el nombre y el celular guardados de la última vez.
const Form = dynamic(() => import('./BookingForm').then((m) => m.BookingForm), {
  ssr: false,
  loading: () => null,
});

export function BookingFormClient({ r, menu }: { r: PublicRestaurant; menu: MenuDish[] }) {
  return (
    <>
      <noscript>
        <div className="pub"><div className="pub-card">
          <BrandHeader name={r.name} logo={r.logo_url} cover={r.cover_url} subtitle="Activa JavaScript para reservar." />
        </div></div>
      </noscript>
      <Form r={r} menu={menu} />
    </>
  );
}
