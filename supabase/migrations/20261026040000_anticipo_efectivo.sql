-- El anticipo se puede pagar por transferencia o en efectivo en el restaurante.
-- En línea, quien elige efectivo tiene `cash_hold_hours` para pasar a pagar
-- (como máximo hasta 2 horas antes de la reserva); si no, la mesa se libera sola.

alter table public.restaurants
  add column accept_cash boolean not null default true,
  add column cash_hold_hours int not null default 12 check (cash_hold_hours between 1 and 72),
  add column cash_instructions text not null default
    'Pasa por el restaurante, di tu código de reserva y paga el anticipo en caja.'
    check (char_length(cash_instructions) <= 400);

alter table public.reservations
  add column deposit_method text check (deposit_method in ('transferencia', 'efectivo'));

-- Las reservas ya pagadas antes de este cambio fueron por transferencia.
update public.reservations set deposit_method = 'transferencia' where deposit_status in ('esperando', 'comprobante', 'pagado') and deposit_method is null;

-- ---------------------------------------------------------------------------
-- Reserva en línea: ahora con método de pago
-- ---------------------------------------------------------------------------
create or replace function public.public_book(p_slug text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.restaurants;
  v_name text := trim(coalesce(p->>'customer_name', ''));
  v_phone text := regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g');
  v_people int := coalesce(nullif(p->>'people', '')::int, 0);
  v_method text := coalesce(nullif(p->>'method', ''), 'transferencia');
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

  -- Plazo para pagar: transferencia en minutos; efectivo en horas, hasta 2 h antes de la reserva.
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

  v_table := public.pick_table(r.id, v_start, 120, v_people);
  if v_table is null then
    raise exception 'Ya no quedan mesas para % personas a las %. Prueba otra hora.', v_people, to_char(v_time, 'HH24:MI') using errcode = 'P0001';
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
    raise exception 'Alguien acaba de tomar esa mesa. Prueba otra hora.' using errcode = 'P0001';
end $$;

-- Si sube comprobante, el método pasa a transferencia (también si había elegido efectivo).
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
     set receipt_path = p_path, deposit_status = 'comprobante', deposit_method = 'transferencia'
   where public_token = p_token and status = 'pendiente' and deposit_status in ('esperando', 'comprobante');
  if not found then
    raise exception 'Esta reserva ya no está esperando el anticipo.' using errcode = 'P0001';
  end if;
end $$;

create or replace function public.public_restaurant(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'name', name, 'slug', slug, 'timezone', timezone,
    'open_time', to_char(open_time, 'HH24:MI'), 'last_booking_time', to_char(last_booking_time, 'HH24:MI'),
    'slot_minutes', slot_minutes, 'deposit_amount', deposit_amount, 'hold_minutes', hold_minutes,
    'bank_details', bank_details, 'whatsapp_phone', whatsapp_phone, 'booking_policy', booking_policy,
    'max_online_people', max_online_people, 'min_advance_hours', min_advance_hours, 'phone_country_code', phone_country_code,
    'logo_url', logo_url, 'cover_url', cover_url,
    'accept_cash', accept_cash, 'cash_hold_hours', cash_hold_hours, 'cash_instructions', cash_instructions)
  from public.restaurants
  where slug = lower(p_slug) and booking_enabled;
$$;

create or replace function public.public_reservation(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'code', v.code, 'customer_name', v.customer_name, 'people', v.people,
    'date', to_char(v.starts_at at time zone r.timezone, 'YYYY-MM-DD'),
    'time', to_char(v.starts_at at time zone r.timezone, 'HH24:MI'),
    'status', v.status, 'deposit_status', v.deposit_status, 'deposit_method', v.deposit_method,
    'hold_expires_at', v.hold_expires_at, 'has_receipt', v.receipt_path is not null,
    'restaurant', jsonb_build_object(
      'name', r.name, 'slug', r.slug, 'timezone', r.timezone, 'deposit_amount', r.deposit_amount, 'bank_details', r.bank_details,
      'whatsapp_phone', r.whatsapp_phone, 'booking_policy', r.booking_policy, 'phone_country_code', r.phone_country_code,
      'logo_url', r.logo_url, 'cover_url', r.cover_url, 'cash_instructions', r.cash_instructions))
  from public.reservations v
  join public.restaurants r on r.id = v.restaurant_id
  where v.public_token = p_token;
$$;

grant execute on function public.public_book(text, jsonb) to anon, authenticated;
grant execute on function public.public_receipt_uploaded(uuid, text) to anon, authenticated;
grant execute on function public.public_restaurant(text) to anon, authenticated;
grant execute on function public.public_reservation(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reserva desde la app: el anticipo anotado queda como pagado, con su método
-- ---------------------------------------------------------------------------
create or replace function public.save_reservation(p_restaurant uuid, p_id uuid, p jsonb, p_items jsonb)
returns uuid language plpgsql set search_path = public as $$
declare
  v_id uuid;
  v_table uuid := nullif(p->>'table_id', '')::uuid;
  v_start timestamptz := (p->>'starts_at')::timestamptz;
  v_people int := (p->>'people')::int;
  v_dur int := coalesce(nullif(p->>'duration_min', '')::int, 120);
  v_deposit numeric := coalesce(nullif(p->>'deposit', '')::numeric, 0);
  v_method text := nullif(p->>'deposit_method', '');
begin
  if not public.is_member(p_restaurant) then
    raise exception 'No tienes acceso a este restaurante' using errcode = '42501';
  end if;
  if v_method is not null and v_method not in ('transferencia', 'efectivo') then
    raise exception 'Método de pago inválido' using errcode = 'P0001';
  end if;
  if v_deposit > 0 and v_method is null then
    v_method := 'efectivo';
  end if;

  if v_table is null then
    v_table := public.pick_table(p_restaurant, v_start, v_dur, v_people, p_id);
    if v_table is null then
      raise exception 'No hay mesas libres para % personas a esa hora. Prueba otra hora.', v_people using errcode = 'P0001';
    end if;
  end if;

  if p_id is null then
    insert into public.reservations
      (restaurant_id, customer_name, phone, starts_at, duration_min, people, table_id, occasion, allergies, notes,
       deposit, deposit_status, deposit_method)
    values
      (p_restaurant, trim(p->>'customer_name'), coalesce(p->>'phone', ''), v_start, v_dur, v_people, v_table,
       coalesce(p->>'occasion', ''), coalesce(p->>'allergies', ''), coalesce(p->>'notes', ''),
       v_deposit, case when v_deposit > 0 then 'pagado' else 'no_aplica' end, case when v_deposit > 0 then v_method end)
    returning id into v_id;
  else
    update public.reservations set
      customer_name = trim(p->>'customer_name'), phone = coalesce(p->>'phone', ''), starts_at = v_start,
      duration_min = v_dur, people = v_people, table_id = v_table, occasion = coalesce(p->>'occasion', ''),
      allergies = coalesce(p->>'allergies', ''), notes = coalesce(p->>'notes', ''),
      deposit = v_deposit,
      -- Las reservas en línea que esperan anticipo se confirman desde su bloque de anticipo, no aquí.
      deposit_status = case when deposit_status in ('no_aplica', 'pagado')
                            then case when v_deposit > 0 then 'pagado' else 'no_aplica' end
                            else deposit_status end,
      deposit_method = case when deposit_status in ('no_aplica', 'pagado')
                            then case when v_deposit > 0 then v_method end
                            else deposit_method end
    where id = p_id and restaurant_id = p_restaurant
    returning id into v_id;
    if v_id is null then
      raise exception 'La reserva no existe' using errcode = 'P0002';
    end if;
  end if;

  delete from public.reservation_items
   where reservation_id = v_id
     and dish_id not in (select (x->>'dish_id')::uuid from jsonb_array_elements(coalesce(p_items, '[]')) x
                          where (x->>'qty')::int > 0);
  insert into public.reservation_items (reservation_id, dish_id, restaurant_id, qty, unit_price)
  select v_id, d.id, p_restaurant, (x->>'qty')::int, d.price
    from jsonb_array_elements(coalesce(p_items, '[]')) x
    join public.dishes d on d.id = (x->>'dish_id')::uuid and d.restaurant_id = p_restaurant
   where (x->>'qty')::int > 0
  on conflict (reservation_id, dish_id) do update set qty = excluded.qty;

  return v_id;
exception
  when exclusion_violation then
    raise exception 'Esa mesa ya está reservada en ese horario. Elige otra mesa u otra hora.' using errcode = 'P0001';
end $$;

-- save_reservation corre con los permisos del usuario y ahora usa pick_table,
-- que respeta la seguridad por filas: solo ve las mesas y reservas de su restaurante.
grant execute on function public.pick_table(uuid, timestamptz, int, int, uuid) to authenticated;
