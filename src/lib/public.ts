// Tipos y lecturas de la página pública de reservas (sin sesión).
import { createClient } from './supabase/server';

export interface PublicRestaurant {
  name: string;
  slug: string;
  timezone: string;
  open_time: string;
  last_booking_time: string;
  slot_minutes: number;
  deposit_amount: number;
  hold_minutes: number;
  bank_details: string;
  whatsapp_phone: string;
  booking_policy: string;
  max_online_people: number;
  min_advance_hours: number;
  phone_country_code: string;
  logo_url: string;
  cover_url: string;
  accept_cash: boolean;
  cash_hold_hours: number;
  cash_instructions: string;
  pay_qr_url: string;
}

export interface MenuDish { id: string; name: string; category: string; price: number; description: string; photo_url: string }

export interface PublicReservation {
  code: number;
  customer_name: string;
  people: number;
  date: string;
  time: string;
  status: 'pendiente' | 'confirmada' | 'atendida' | 'cancelada';
  deposit_status: 'no_aplica' | 'esperando' | 'comprobante' | 'pagado' | 'vencido' | 'rechazado';
  deposit_method: 'transferencia' | 'efectivo' | null;
  hold_expires_at: string | null;
  has_receipt: boolean;
  table_name: string | null;
  table_zone: string | null;
  items: { name: string; qty: number; unit_price: number }[];
  restaurant: Pick<PublicRestaurant, 'name' | 'slug' | 'timezone' | 'deposit_amount' | 'bank_details' | 'whatsapp_phone' | 'booking_policy'
    | 'phone_country_code' | 'logo_url' | 'cover_url' | 'cash_instructions' | 'pay_qr_url'>;
}

export async function getPublicRestaurant(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc('public_restaurant', { p_slug: slug });
  if (!data) return null;
  const r = data as PublicRestaurant;
  return { ...r, deposit_amount: Number(r.deposit_amount), accept_cash: r.accept_cash ?? false, cash_hold_hours: Number(r.cash_hold_hours ?? 12) };
}

export async function getPublicMenu(slug: string): Promise<MenuDish[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc('public_menu', { p_slug: slug });
  return ((data ?? []) as MenuDish[]).map((d) => ({ ...d, price: Number(d.price) }));
}

export async function getPublicReservation(token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc('public_reservation', { p_token: token });
  if (!data) return null;
  const r = data as PublicReservation;
  return {
    ...r, items: (r.items ?? []).map((i) => ({ ...i, unit_price: Number(i.unit_price) })),
    restaurant: { ...r.restaurant, deposit_amount: Number(r.restaurant.deposit_amount) },
  };
}
