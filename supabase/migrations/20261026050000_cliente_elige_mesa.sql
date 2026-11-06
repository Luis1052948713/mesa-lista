-- El cliente ve el plano en la página pública y escoge su mesa (o deja que el restaurante la elija).

-- ¿La mesa sirve para este grupo? Al menos los puestos necesarios y como máximo el doble
-- (o 2 de más, lo que sea mayor), para que una pareja no aparte la mesa grande.
create or replace function public.table_fits(p_seats int, p_people int) returns boolean
language sql immutable set search_path = public as $$
  select p_seats >= p_people and p_seats <= greatest(p_people + 2, p_people * 2);
$$;

-- Plano público para una fecha, hora y tamaño de grupo. No dice quién ocupa cada mesa.
create or replace function public.public_floor(p_slug text, p_date date, p_time text, p_people int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r public.restaurants;
  v_start timestamptz;
begin
  select * into r from public.restaurants where slug = lower(p_slug) and booking_enabled;
  if not found then
    return null;
  end if;
  begin
    v_start := (p_date + p_time::time) at time zone r.timezone;
  exception when others then
    return null;
  end;
  return jsonb_build_object(
    'zones', coalesce((select jsonb_agg(jsonb_build_object('name', z.name, 'x', z.x, 'y', z.y, 'w', z.w, 'h', z.h) order by z.sort, z.name)
                         from public.zones z where z.restaurant_id = r.id), '[]'::jsonb),
    'tables', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'seats', t.seats, 'zone', t.zone, 'x', t.x, 'y', t.y, 'shape', t.shape,
        'fits', public.table_fits(t.seats, p_people),
        'free', not exists (
          select 1 from public.reservations v
           where v.table_id = t.id and v.status <> 'cancelada'
             and tstzrange(v.starts_at, v.ends_at) && tstzrange(v_start, v_start + interval '120 minutes'))
      ) order by t.name)
      from public.dining_tables t where t.restaurant_id = r.id and t.active), '[]'::jsonb));
end $$;

grant execute on function public.public_floor(text, date, text, int) to anon, authenticated;

-- Reserva en línea: igual que antes, y si viene "table_id" usa esa mesa.
create or replace function public.public_book(p_slug text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.restaurants;
  v_name text := trim(coalesce(p->>'customer_name', ''));
  v_phone text := regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g');
  v_people int := coalesce(nullif(p->>'people', '')::int, 0);
  v_method text := coalesce(nullif(p->>'method', ''), 'transferencia');
  v_wanted uuid;
  v_date date;
  v_time time;
  v_start timestamptz;
  v_table uuid;
  v_exp timestamptz;
  v_token uuid;
  v_code bigint;
begin
  if coalesce(p->>'website', '') <> '' then
    raise exception 'No se pudo enviar la reserva.' using errcode = 'P0001';
  end if;
  select * into r from public.restaurants where slug = lower(p_slug) and booking_enabled;
  if not found then
    raise exception 'Este restaurante no está recibiendo reservas en línea.' using errcode = 'P0001';
  end if;
  if v_method not in ('transferencia', 'efectivo') or (v_method = 'efectivo' and not r.accept_cash) then
    raise exception 'Elige cómo vas a pagar el anticipo.' using errcode = 'P0001';
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
    v_wanted := nullif(p->>'table_id', '')::uuid;
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

  if v_method = 'efectivo' then
    v_exp := least(now() + make_interval(hours => r.cash_hold_hours), v_start - interval '2 hours');
    if r.deposit_amount > 0 and v_exp < now() + interval '30 minutes' then
      raise exception 'Para pagar en efectivo reserva con más anticipación, o elige transferencia.' using errcode = 'P0001';
    end if;
  else
    v_exp := least(now() + make_interval(mins => r.hold_minutes), v_start);
  end if;

  perform public.expire_holds();
  if (select count(*) from public.reservations
       where restaurant_id = r.id and phone_digits = v_phone and status = 'pendiente'
         and deposit_status in ('esperando', 'comprobante')) >= 2 then
    raise exception 'Ya tienes reservas esperando el anticipo. Termina esas primero o escríbenos por WhatsApp.' using errcode = 'P0001';
  end if;

  if v_wanted is not null then
    -- Mesa escogida por el cliente: debe ser de este restaurante, estar activa y servir para el grupo.
    select t.id into v_table from public.dining_tables t
     where t.id = v_wanted and t.restaurant_id = r.id and t.active and public.table_fits(t.seats, v_people);
    if v_table is null then
      raise exception 'Esa mesa no está disponible para % personas. Elige otra.', v_people using errcode = 'P0001';
    end if;
  else
    v_table := public.pick_table(r.id, v_start, 120, v_people);
    if v_table is null then
      raise exception 'Ya no quedan mesas para % personas a las %. Prueba otra hora.', v_people, to_char(v_time, 'HH24:MI') using errcode = 'P0001';
    end if;
  end if;

  insert into public.reservations
    (restaurant_id, customer_name, phone, email, starts_at, people, table_id, occasion, allergies, notes,
     source, deposit_status, deposit_method, hold_expires_at, created_by)
  values
    (r.id, v_name, left(trim(coalesce(p->>'phone', '')), 20), left(trim(coalesce(p->>'email', '')), 120), v_start, v_people, v_table,
     left(trim(coalesce(p->>'occasion', '')), 60), left(trim(coalesce(p->>'allergies', '')), 200), left(trim(coalesce(p->>'notes', '')), 300),
     'web', case when r.deposit_amount > 0 then 'esperando' else 'no_aplica' end,
     case when r.deposit_amount > 0 then v_method end,
     case when r.deposit_amount > 0 then v_exp end, null)
  returning public_token, code into v_token, v_code;

  return jsonb_build_object('token', v_token, 'code', v_code);
exception
  when exclusion_violation then
    raise exception 'Esa mesa acaba de ocuparse. Elige otra mesa u otra hora.' using errcode = 'P0001';
end $$;

-- La página de la reserva ahora también muestra la mesa y su zona.
create or replace function public.public_reservation(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'code', v.code, 'customer_name', v.customer_name, 'people', v.people,
    'date', to_char(v.starts_at at time zone r.timezone, 'YYYY-MM-DD'),
    'time', to_char(v.starts_at at time zone r.timezone, 'HH24:MI'),
    'status', v.status, 'deposit_status', v.deposit_status, 'deposit_method', v.deposit_method,
    'hold_expires_at', v.hold_expires_at, 'has_receipt', v.receipt_path is not null,
    'table_name', t.name, 'table_zone', t.zone,
    'restaurant', jsonb_build_object(
      'name', r.name, 'slug', r.slug, 'timezone', r.timezone, 'deposit_amount', r.deposit_amount, 'bank_details', r.bank_details,
      'whatsapp_phone', r.whatsapp_phone, 'booking_policy', r.booking_policy, 'phone_country_code', r.phone_country_code,
      'logo_url', r.logo_url, 'cover_url', r.cover_url, 'cash_instructions', r.cash_instructions))
  from public.reservations v
  join public.restaurants r on r.id = v.restaurant_id
  left join public.dining_tables t on t.id = v.table_id
  where v.public_token = p_token;
$$;

grant execute on function public.public_book(text, jsonb) to anon, authenticated;
grant execute on function public.public_reservation(uuid) to anon, authenticated;
