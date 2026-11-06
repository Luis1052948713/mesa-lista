-- Horario de cena configurable y reservas en línea con anticipo por transferencia.
--
-- Flujo: el cliente llena el formulario público → la mesa queda apartada
-- `hold_minutes` minutos en estado "esperando anticipo" → el cliente transfiere y
-- sube el comprobante → el restaurante lo revisa y confirma con un toque.
-- Si no llega el comprobante a tiempo, la reserva se cancela sola y libera la mesa.

-- ---------------------------------------------------------------------------
-- Ajustes del restaurante
-- ---------------------------------------------------------------------------
create or replace function public.slugify(t text) returns text
language sql immutable set search_path = public as $$
  select trim(both '-' from regexp_replace(
    translate(lower(coalesce(t, '')), 'áàäâéèëêíìïîóòöôúùüûñç', 'aaaaeeeeiiiioooouuuunc'),
    '[^a-z0-9]+', '-', 'g'));
$$;

alter table public.restaurants
  add column open_time time not null default '18:00',
  add column last_booking_time time not null default '22:00',
  add column slot_minutes int not null default 30 check (slot_minutes in (15, 30, 60)),
  add column slug text unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 40),
  add column booking_enabled boolean not null default false,
  add column deposit_amount numeric(12,2) not null default 50000 check (deposit_amount >= 0),
  add column hold_minutes int not null default 60 check (hold_minutes between 10 and 1440),
  add column bank_details text not null default '' check (char_length(bank_details) <= 500),
  add column whatsapp_phone text not null default '',
  add column booking_policy text not null default
    'El anticipo se descuenta de tu cuenta el día de la reserva. Si no llegas o cancelas con menos de 24 horas, no se devuelve.'
    check (char_length(booking_policy) <= 600),
  add column max_online_people int not null default 12 check (max_online_people between 1 and 60),
  add column min_advance_hours int not null default 2 check (min_advance_hours between 0 and 72),
  add constraint restaurants_hours_check check (last_booking_time >= open_time);

update public.restaurants r
   set slug = s.slug
  from (select id, left(coalesce(nullif(public.slugify(name), ''), 'restaurante'), 34)
                 || case when row_number() over (partition by public.slugify(name) order by created_at) > 1
                         then '-' || row_number() over (partition by public.slugify(name) order by created_at) else '' end slug
          from public.restaurants) s
 where s.id = r.id and r.slug is null;

-- ---------------------------------------------------------------------------
-- Reservas: origen, anticipo y enlace privado para el cliente
-- ---------------------------------------------------------------------------
alter table public.reservations
  add column source text not null default 'app' check (source in ('app', 'web')),
  add column email text not null default '' check (char_length(email) <= 120),
  add column deposit_status text not null default 'no_aplica'
    check (deposit_status in ('no_aplica', 'esperando', 'comprobante', 'pagado', 'vencido', 'rechazado')),
  add column hold_expires_at timestamptz,
  add column receipt_path text,
  add column public_token uuid not null default gen_random_uuid() unique;

create index reservations_hold_idx on public.reservations(hold_expires_at) where deposit_status = 'esperando';

-- Mesa más pequeña libre para ese horario (la misma regla que usa save_reservation).
create or replace function public.pick_table(p_restaurant uuid, p_start timestamptz, p_minutes int, p_people int, p_except uuid default null)
returns uuid language sql stable set search_path = public as $$
  select t.id
    from public.dining_tables t
   where t.restaurant_id = p_restaurant and t.active and t.seats >= p_people
     and not exists (
       select 1 from public.reservations r
        where r.table_id = t.id and r.status <> 'cancelada'
          and (p_except is null or r.id <> p_except)
          and tstzrange(r.starts_at, r.ends_at) && tstzrange(p_start, p_start + make_interval(mins => p_minutes)))
   order by t.seats, t.name
   limit 1;
$$;

-- Cancela las reservas en línea cuyo anticipo no llegó a tiempo. La corre pg_cron cada 5 minutos.
create or replace function public.expire_holds() returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  update public.reservations
     set status = 'cancelada', deposit_status = 'vencido'
   where deposit_status = 'esperando' and status = 'pendiente' and hold_expires_at < now();
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- API pública (sin sesión): solo lo necesario para reservar y pagar
-- ---------------------------------------------------------------------------
create or replace function public.public_restaurant(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'name', name, 'slug', slug, 'timezone', timezone,
    'open_time', to_char(open_time, 'HH24:MI'), 'last_booking_time', to_char(last_booking_time, 'HH24:MI'),
    'slot_minutes', slot_minutes, 'deposit_amount', deposit_amount, 'hold_minutes', hold_minutes,
    'bank_details', bank_details, 'whatsapp_phone', whatsapp_phone, 'booking_policy', booking_policy,
    'max_online_people', max_online_people, 'min_advance_hours', min_advance_hours, 'phone_country_code', phone_country_code)
  from public.restaurants
  where slug = lower(p_slug) and booking_enabled;
$$;

create or replace function public.public_slots(p_slug text, p_date date, p_people int) returns table (slot text)
language plpgsql stable security definer set search_path = public as $$
declare
  r public.restaurants;
  t time;
  s timestamptz;
  today date;
begin
  select * into r from public.restaurants where slug = lower(p_slug) and booking_enabled;
  if not found or p_people is null or p_people < 1 or p_people > r.max_online_people then
    return;
  end if;
  today := (now() at time zone r.timezone)::date;
  if p_date < today or p_date > today + 60 then
    return;
  end if;
  t := r.open_time;
  loop
    exit when t > r.last_booking_time;
    s := (p_date + t) at time zone r.timezone;
    if s >= now() + make_interval(hours => r.min_advance_hours) and public.pick_table(r.id, s, 120, p_people) is not null then
      slot := to_char(t, 'HH24:MI');
      return next;
    end if;
    exit when t + make_interval(mins => r.slot_minutes) <= t;  -- pasó la medianoche
    t := t + make_interval(mins => r.slot_minutes);
  end loop;
end $$;

create or replace function public.public_book(p_slug text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.restaurants;
  v_name text := trim(coalesce(p->>'customer_name', ''));
  v_phone text := regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g');
  v_people int := coalesce(nullif(p->>'people', '')::int, 0);
  v_date date;
  v_time time;
  v_start timestamptz;
  v_table uuid;
  v_exp timestamptz;
  v_token uuid;
  v_code bigint;
begin
  -- Campo trampa: las personas no lo ven; los robots lo llenan.
  if coalesce(p->>'website', '') <> '' then
    raise exception 'No se pudo enviar la reserva.' using errcode = 'P0001';
  end if;
  select * into r from public.restaurants where slug = lower(p_slug) and booking_enabled;
  if not found then
    raise exception 'Este restaurante no está recibiendo reservas en línea.' using errcode = 'P0001';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'Escribe tu nombre completo.' using errcode = 'P0001';
  end if;
  if char_length(v_phone) < 10 or char_length(v_phone) > 15 then
    raise exception 'Escribe un celular válido de 10 dígitos.' using errcode = 'P0001';
  end if;
  if v_people < 1 then
    raise exception 'Indica cuántas personas vienen.' using errcode = 'P0001';
  end if;
  if v_people > r.max_online_people then
    raise exception 'Para grupos de más de % personas escríbenos por WhatsApp.', r.max_online_people using errcode = 'P0001';
  end if;
  begin
    v_date := (p->>'date')::date;
    v_time := (p->>'time')::time;
  exception when others then
    raise exception 'Elige la fecha y la hora de tu reserva.' using errcode = 'P0001';
  end;
  if v_date is null or v_time is null or v_time < r.open_time or v_time > r.last_booking_time
     or (extract(epoch from (v_time - r.open_time))::int % (r.slot_minutes * 60)) <> 0 then
    raise exception 'Esa hora no está disponible. Elige una de la lista.' using errcode = 'P0001';
  end if;
  v_start := (v_date + v_time) at time zone r.timezone;
  if v_start < now() + make_interval(hours => r.min_advance_hours) then
    raise exception 'Las reservas en línea se hacen con al menos % horas de anticipación.', r.min_advance_hours using errcode = 'P0001';
  end if;
  if v_date > (now() at time zone r.timezone)::date + 60 then
    raise exception 'Recibimos reservas en línea hasta con 60 días de anticipación.' using errcode = 'P0001';
  end if;

  perform public.expire_holds();
  if (select count(*) from public.reservations
       where restaurant_id = r.id and phone_digits = v_phone and status = 'pendiente'
         and deposit_status in ('esperando', 'comprobante')) >= 2 then
    raise exception 'Ya tienes reservas esperando el anticipo. Termina esas primero o escríbenos por WhatsApp.' using errcode = 'P0001';
  end if;

  v_table := public.pick_table(r.id, v_start, 120, v_people);
  if v_table is null then
    raise exception 'Ya no quedan mesas para % personas a las %. Prueba otra hora.', v_people, to_char(v_time, 'HH24:MI') using errcode = 'P0001';
  end if;
  v_exp := least(now() + make_interval(mins => r.hold_minutes), v_start);

  insert into public.reservations
    (restaurant_id, customer_name, phone, email, starts_at, people, table_id, occasion, allergies, notes,
     source, deposit_status, hold_expires_at, created_by)
  values
    (r.id, v_name, left(trim(coalesce(p->>'phone', '')), 20), left(trim(coalesce(p->>'email', '')), 120), v_start, v_people, v_table,
     left(trim(coalesce(p->>'occasion', '')), 60), left(trim(coalesce(p->>'allergies', '')), 200), left(trim(coalesce(p->>'notes', '')), 300),
     'web', case when r.deposit_amount > 0 then 'esperando' else 'no_aplica' end,
     case when r.deposit_amount > 0 then v_exp end, null)
  returning public_token, code into v_token, v_code;

  return jsonb_build_object('token', v_token, 'code', v_code);
exception
  when exclusion_violation then
    raise exception 'Alguien acaba de tomar esa mesa. Prueba otra hora.' using errcode = 'P0001';
end $$;

-- Estado de una reserva para el cliente, con el enlace privado que recibió al reservar.
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
      'whatsapp_phone', r.whatsapp_phone, 'booking_policy', r.booking_policy, 'phone_country_code', r.phone_country_code))
  from public.reservations v
  join public.restaurants r on r.id = v.restaurant_id
  where v.public_token = p_token;
$$;

-- ¿Se puede subir un comprobante con este nombre? El nombre empieza con el token de la reserva.
create or replace function public.receipt_allowed(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.reservations
     where public_token::text = split_part(p_name, '/', 1)
       and status = 'pendiente' and deposit_status in ('esperando', 'comprobante'));
$$;

-- ¿Puede este usuario ver el comprobante? Solo los miembros del restaurante de la reserva.
create or replace function public.receipt_visible(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.reservations where receipt_path = p_name and public.is_member(restaurant_id));
$$;

-- El cliente avisa que ya subió el comprobante: la reserva pasa a "por revisar".
create or replace function public.public_receipt_uploaded(p_token uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare
  found_file boolean := true;
begin
  if split_part(p_path, '/', 1) <> p_token::text then
    raise exception 'Comprobante inválido.' using errcode = 'P0001';
  end if;
  if to_regclass('storage.objects') is not null then
    execute 'select exists (select 1 from storage.objects where bucket_id = ''comprobantes'' and name = $1)' into found_file using p_path;
  end if;
  if not found_file then
    raise exception 'No encontramos el archivo. Vuelve a subirlo.' using errcode = 'P0001';
  end if;
  update public.reservations
     set receipt_path = p_path, deposit_status = 'comprobante'
   where public_token = p_token and status = 'pendiente' and deposit_status in ('esperando', 'comprobante');
  if not found then
    raise exception 'Esta reserva ya no está esperando el anticipo.' using errcode = 'P0001';
  end if;
end $$;

-- Permisos: la API pública la puede llamar cualquiera; lo interno, nadie desde fuera.
revoke execute on function public.pick_table(uuid, timestamptz, int, int, uuid) from public, anon, authenticated;
revoke execute on function public.expire_holds() from public, anon, authenticated;
revoke execute on function public.receipt_visible(text) from public, anon;
grant execute on function public.receipt_visible(text) to authenticated;
grant execute on function public.public_restaurant(text) to anon, authenticated;
grant execute on function public.public_slots(text, date, int) to anon, authenticated;
grant execute on function public.public_book(text, jsonb) to anon, authenticated;
grant execute on function public.public_reservation(uuid) to anon, authenticated;
grant execute on function public.receipt_allowed(text) to anon, authenticated;
grant execute on function public.public_receipt_uploaded(uuid, text) to anon, authenticated;

-- Los restaurantes nuevos reciben su dirección pública (slug) al crearse.
create or replace function public.create_restaurant(p_name text, p_demo boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  rid uuid;
  uid uuid := auth.uid();
  base text := left(coalesce(nullif(public.slugify(p_name), ''), 'restaurante'), 34);
  v_slug text := base;
  n int := 1;
begin
  if uid is null then
    raise exception 'Inicia sesión primero' using errcode = '42501';
  end if;
  if char_length(v_slug) < 3 then
    base := 'restaurante-' || v_slug;
    v_slug := base;
  end if;
  while exists (select 1 from public.restaurants where slug = v_slug) loop
    n := n + 1;
    v_slug := base || '-' || n;
  end loop;
  insert into public.restaurants (name, slug) values (trim(p_name), v_slug) returning id into rid;
  insert into public.memberships (restaurant_id, user_id, role) values (rid, uid, 'owner');
  if p_demo then
    insert into public.zones (restaurant_id, name, x, y, w, h, sort)
    values (rid, 'Salón', 2, 4, 57, 92, 1), (rid, 'Terraza', 61, 4, 37, 92, 2);
    perform public.seed_demo(rid);
  else
    insert into public.zones (restaurant_id, name, x, y, w, h, sort) values (rid, 'Salón', 2, 4, 96, 92, 1);
  end if;
  return rid;
end $$;

revoke execute on function public.create_restaurant(text, boolean) from public, anon;
grant execute on function public.create_restaurant(text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Comprobantes (Supabase Storage, privado) y vencimiento automático (pg_cron)
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('comprobantes', 'comprobantes', false, 5242880,
            array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
    on conflict (id) do nothing;
    execute $p$create policy comprobantes_subir on storage.objects for insert to anon, authenticated
      with check (bucket_id = 'comprobantes' and public.receipt_allowed(name))$p$;
    execute $p$create policy comprobantes_ver on storage.objects for select to authenticated
      using (bucket_id = 'comprobantes' and public.receipt_visible(name))$p$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('mesa-lista-vencer-anticipos', '*/5 * * * *', 'select public.expire_holds()');
  end if;
end $$;
