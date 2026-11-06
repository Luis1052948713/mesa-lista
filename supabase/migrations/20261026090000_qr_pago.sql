-- QR para transferir el anticipo (imagen del QR de Nequi, Bre-B o del banco).

alter table public.restaurants
  add column pay_qr_url text not null default '' check (char_length(pay_qr_url) <= 500);

create or replace function public.public_restaurant(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'name', name, 'slug', slug, 'timezone', timezone,
    'open_time', to_char(open_time, 'HH24:MI'), 'last_booking_time', to_char(last_booking_time, 'HH24:MI'),
    'slot_minutes', slot_minutes, 'deposit_amount', deposit_amount, 'hold_minutes', hold_minutes,
    'bank_details', bank_details, 'whatsapp_phone', whatsapp_phone, 'booking_policy', booking_policy,
    'max_online_people', max_online_people, 'min_advance_hours', min_advance_hours, 'phone_country_code', phone_country_code,
    'logo_url', logo_url, 'cover_url', cover_url,
    'accept_cash', accept_cash, 'cash_hold_hours', cash_hold_hours, 'cash_instructions', cash_instructions,
    'pay_qr_url', pay_qr_url)
  from public.restaurants
  where slug = lower(p_slug) and booking_enabled;
$$;

grant execute on function public.public_restaurant(text) to anon, authenticated;

create or replace function public.public_reservation(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'code', v.code, 'customer_name', v.customer_name, 'people', v.people,
    'date', to_char(v.starts_at at time zone r.timezone, 'YYYY-MM-DD'),
    'time', to_char(v.starts_at at time zone r.timezone, 'HH24:MI'),
    'status', v.status, 'deposit_status', v.deposit_status, 'deposit_method', v.deposit_method,
    'hold_expires_at', v.hold_expires_at, 'has_receipt', v.receipt_path is not null,
    'table_name', t.name, 'table_zone', t.zone,
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', d.name, 'qty', i.qty, 'unit_price', i.unit_price) order by d.sort, d.name)
                         from public.reservation_items i join public.dishes d on d.id = i.dish_id
                        where i.reservation_id = v.id), '[]'::jsonb),
    'restaurant', jsonb_build_object(
      'name', r.name, 'slug', r.slug, 'timezone', r.timezone, 'deposit_amount', r.deposit_amount, 'bank_details', r.bank_details,
      'whatsapp_phone', r.whatsapp_phone, 'booking_policy', r.booking_policy, 'phone_country_code', r.phone_country_code,
      'logo_url', r.logo_url, 'cover_url', r.cover_url, 'cash_instructions', r.cash_instructions, 'inc_rate', r.inc_rate, 'pay_qr_url', r.pay_qr_url))
  from public.reservations v
  join public.restaurants r on r.id = v.restaurant_id
  left join public.dining_tables t on t.id = v.table_id
  where v.public_token = p_token;
$$;

grant execute on function public.public_reservation(uuid) to anon, authenticated;
