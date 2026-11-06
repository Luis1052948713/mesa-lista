-- Logo y foto del negocio, visibles en la página pública de reservas y en el cartel del QR.

alter table public.restaurants
  add column logo_url text not null default '' check (char_length(logo_url) <= 500),
  add column cover_url text not null default '' check (char_length(cover_url) <= 500);

-- ¿Puede este usuario subir o borrar imágenes en esta ruta? La primera carpeta es el id del restaurante.
create or replace function public.brand_member(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return public.is_member(split_part(p_name, '/', 1)::uuid);
exception when others then
  return false;
end $$;

revoke execute on function public.brand_member(text) from public, anon;
grant execute on function public.brand_member(text) to authenticated;

-- La página pública ahora también muestra el logo y la foto.
create or replace function public.public_restaurant(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'name', name, 'slug', slug, 'timezone', timezone,
    'open_time', to_char(open_time, 'HH24:MI'), 'last_booking_time', to_char(last_booking_time, 'HH24:MI'),
    'slot_minutes', slot_minutes, 'deposit_amount', deposit_amount, 'hold_minutes', hold_minutes,
    'bank_details', bank_details, 'whatsapp_phone', whatsapp_phone, 'booking_policy', booking_policy,
    'max_online_people', max_online_people, 'min_advance_hours', min_advance_hours, 'phone_country_code', phone_country_code,
    'logo_url', logo_url, 'cover_url', cover_url)
  from public.restaurants
  where slug = lower(p_slug) and booking_enabled;
$$;

create or replace function public.public_reservation(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'code', v.code, 'customer_name', v.customer_name, 'people', v.people,
    'date', to_char(v.starts_at at time zone r.timezone, 'YYYY-MM-DD'),
    'time', to_char(v.starts_at at time zone r.timezone, 'HH24:MI'),
    'status', v.status, 'deposit_status', v.deposit_status, 'hold_expires_at', v.hold_expires_at,
    'has_receipt', v.receipt_path is not null,
    'restaurant', jsonb_build_object(
      'name', r.name, 'slug', r.slug, 'deposit_amount', r.deposit_amount, 'bank_details', r.bank_details,
      'whatsapp_phone', r.whatsapp_phone, 'booking_policy', r.booking_policy, 'phone_country_code', r.phone_country_code,
      'logo_url', r.logo_url, 'cover_url', r.cover_url))
  from public.reservations v
  join public.restaurants r on r.id = v.restaurant_id
  where v.public_token = p_token;
$$;

grant execute on function public.public_restaurant(text) to anon, authenticated;
grant execute on function public.public_reservation(uuid) to anon, authenticated;

-- Carpeta pública de imágenes: cualquiera las ve por su enlace; solo el restaurante sube o borra.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('marca', 'marca', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
    execute $p$create policy marca_subir on storage.objects for insert to authenticated
      with check (bucket_id = 'marca' and public.brand_member(name))$p$;
    execute $p$create policy marca_cambiar on storage.objects for update to authenticated
      using (bucket_id = 'marca' and public.brand_member(name)) with check (bucket_id = 'marca' and public.brand_member(name))$p$;
    execute $p$create policy marca_borrar on storage.objects for delete to authenticated
      using (bucket_id = 'marca' and public.brand_member(name))$p$;
  end if;
end $$;
