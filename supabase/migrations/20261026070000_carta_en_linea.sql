-- La carta en línea: cada plato con descripción y foto; el cliente la ve y pide al reservar.

alter table public.dishes
  add column description text not null default '' check (char_length(description) <= 300),
  add column photo_url text not null default '' check (char_length(photo_url) <= 500);

-- Carta pública: solo lo que ve un cliente (nunca costos ni recetas).
create or replace function public.public_menu(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'name', d.name, 'category', d.category, 'price', d.price,
      'description', d.description, 'photo_url', d.photo_url) order by d.sort, d.name), '[]'::jsonb)
    from public.restaurants r
    join public.dishes d on d.restaurant_id = r.id and d.active
   where r.slug = lower(p_slug) and r.booking_enabled;
$$;

grant execute on function public.public_menu(text) to anon, authenticated;

-- Reserva en línea con pedido opcional desde la carta ("items": [{ dish_id, qty }]).
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
  v_id uuid;
  v_lines int;
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
  returning id, public_token, code into v_id, v_token, v_code;

  -- Pedido desde la carta (opcional): solo platos activos de este restaurante, con el precio de hoy.
  insert into public.reservation_items (reservation_id, dish_id, restaurant_id, qty, unit_price)
  select v_id, d.id, r.id, least(greatest(sum((x->>'qty')::int), 1), 50), d.price
    from jsonb_array_elements(case when jsonb_typeof(p->'items') = 'array' then p->'items' else '[]'::jsonb end) x
    join public.dishes d on d.id = (x->>'dish_id')::uuid and d.restaurant_id = r.id and d.active
   where (x->>'qty') ~ '^[0-9]{1,4}$' and (x->>'qty')::int > 0
   group by d.id, d.price;
  get diagnostics v_lines = row_count;

  return jsonb_build_object('token', v_token, 'code', v_code, 'items', v_lines);
exception
  when exclusion_violation then
    raise exception 'Esa mesa acaba de ocuparse. Elige otra mesa u otra hora.' using errcode = 'P0001';
end $$;

grant execute on function public.public_book(text, jsonb) to anon, authenticated;

-- La página de la reserva muestra lo que pidió el cliente.
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
      'logo_url', r.logo_url, 'cover_url', r.cover_url, 'cash_instructions', r.cash_instructions, 'inc_rate', r.inc_rate))
  from public.reservations v
  join public.restaurants r on r.id = v.restaurant_id
  left join public.dining_tables t on t.id = v.table_id
  where v.public_token = p_token;
$$;

grant execute on function public.public_reservation(uuid) to anon, authenticated;

-- Guardar plato: ahora también con descripción.
-- p: { name, category, price, active, description }   p_recipe: [{ ingredient_id, qty }]
create or replace function public.save_dish(p_restaurant uuid, p_id uuid, p jsonb, p_recipe jsonb) returns uuid
language plpgsql set search_path = public as $$
declare
  v_id uuid;
  v_category text := coalesce(nullif(trim(p->>'category'), ''), 'Plato fuerte');
begin
  if not public.is_member(p_restaurant) then
    raise exception 'No tienes acceso a este restaurante' using errcode = '42501';
  end if;

  if p_id is null then
    insert into public.dishes (restaurant_id, name, category, price, active, description, sort)
    values (p_restaurant, trim(p->>'name'), v_category, (p->>'price')::numeric, coalesce((p->>'active')::boolean, true),
            left(trim(coalesce(p->>'description', '')), 300),
            coalesce((select max(sort) + 1 from public.dishes where restaurant_id = p_restaurant), 1))
    returning id into v_id;
  else
    update public.dishes
       set name = trim(p->>'name'), category = v_category, price = (p->>'price')::numeric,
           active = coalesce((p->>'active')::boolean, true),
           description = left(trim(coalesce(p->>'description', '')), 300)
     where id = p_id and restaurant_id = p_restaurant
    returning id into v_id;
    if v_id is null then
      raise exception 'El plato no existe' using errcode = 'P0002';
    end if;
  end if;

  delete from public.recipe_items where dish_id = v_id;
  insert into public.recipe_items (dish_id, ingredient_id, restaurant_id, qty)
  select v_id, i.id, p_restaurant, sum((x->>'qty')::numeric)
    from jsonb_array_elements(coalesce(p_recipe, '[]')) x
    join public.ingredients i on i.id = (x->>'ingredient_id')::uuid and i.restaurant_id = p_restaurant
   where (x->>'qty')::numeric > 0
   group by i.id;

  return v_id;
exception
  when unique_violation then
    raise exception 'Ya existe un plato con ese nombre.' using errcode = 'P0001';
end $$;

revoke execute on function public.save_dish(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_dish(uuid, uuid, jsonb, jsonb) to authenticated;
