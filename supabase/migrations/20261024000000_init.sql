-- Mesa Lista: esquema inicial
-- Cada restaurante es un "tenant": todas las filas llevan restaurant_id y la
-- seguridad por filas (RLS) solo deja ver los datos del restaurante del usuario.

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- Restaurantes y miembros
-- ---------------------------------------------------------------------------
create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  timezone text not null default 'America/Bogota',
  phone_country_code text not null default '57',
  inc_rate numeric(5,4) not null default 0.08,      -- impoconsumo
  tip_rate numeric(5,4) not null default 0.10,      -- propina sugerida
  shop_merma numeric(5,4) not null default 0.10,
  shop_keep_min boolean not null default true,
  reminders_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.memberships (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (restaurant_id, user_id)
);
create index memberships_user_idx on public.memberships(user_id);

create or replace function public.is_member(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships where restaurant_id = rid and user_id = auth.uid());
$$;

create or replace function public.is_owner(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships where restaurant_id = rid and user_id = auth.uid() and role = 'owner');
$$;

-- ---------------------------------------------------------------------------
-- Insumos, platos y recetas
-- ---------------------------------------------------------------------------
create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  unit text not null check (unit in ('kg', 'l', 'und')),
  price numeric(12,2) not null default 0 check (price >= 0),
  supplier text not null default '',
  stock numeric(12,3) not null default 0 check (stock >= 0),
  min_stock numeric(12,3) not null default 0 check (min_stock >= 0),
  created_at timestamptz not null default now(),
  unique (restaurant_id, name),
  unique (id, restaurant_id)
);

create table public.dishes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  category text not null default 'Plato fuerte',
  price numeric(12,2) not null check (price >= 0),
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (restaurant_id, name),
  unique (id, restaurant_id)
);

create table public.recipe_items (
  dish_id uuid not null,
  ingredient_id uuid not null,
  restaurant_id uuid not null,
  qty numeric(12,4) not null check (qty > 0),
  primary key (dish_id, ingredient_id),
  foreign key (dish_id, restaurant_id) references public.dishes(id, restaurant_id) on delete cascade,
  foreign key (ingredient_id, restaurant_id) references public.ingredients(id, restaurant_id) on delete restrict
);

-- ---------------------------------------------------------------------------
-- Mesas y reservas
-- ---------------------------------------------------------------------------
create table public.dining_tables (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 20),
  seats int not null check (seats between 1 and 60),
  zone text not null default 'Salón',
  x numeric(5,2) not null default 50 check (x between 0 and 100),
  y numeric(5,2) not null default 50 check (y between 0 and 100),
  active boolean not null default true,
  unique (restaurant_id, name),
  unique (id, restaurant_id)
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  code bigint generated always as identity (start with 1001),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_name text not null check (char_length(customer_name) between 1 and 120),
  phone text not null default '',
  phone_digits text generated always as (regexp_replace(phone, '\D', '', 'g')) stored,
  starts_at timestamptz not null,
  duration_min int not null default 120 check (duration_min between 30 and 600),
  ends_at timestamptz not null,
  people int not null check (people between 1 and 300),
  table_id uuid,
  occasion text not null default '',
  allergies text not null default '',
  notes text not null default '',
  deposit numeric(12,2) not null default 0 check (deposit >= 0),
  status text not null default 'pendiente' check (status in ('pendiente', 'confirmada', 'atendida', 'cancelada')),
  confirmed_via text check (confirmed_via in ('whatsapp', 'manual')),
  served_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  foreign key (table_id, restaurant_id) references public.dining_tables(id, restaurant_id) on delete set null (table_id),
  -- Una mesa no puede tener dos reservas activas que se crucen en el tiempo.
  constraint no_double_booking exclude using gist (
    table_id with =, tstzrange(starts_at, ends_at) with &&
  ) where (status <> 'cancelada' and table_id is not null)
);
create index reservations_restaurant_time_idx on public.reservations(restaurant_id, starts_at);
create index reservations_phone_idx on public.reservations(phone_digits);

create or replace function public.set_reservation_times() returns trigger
language plpgsql as $$
begin
  new.ends_at := new.starts_at + make_interval(mins => new.duration_min);
  new.updated_at := now();
  return new;
end $$;

create trigger reservations_times before insert or update on public.reservations
for each row execute function public.set_reservation_times();

create table public.reservation_items (
  reservation_id uuid not null,
  dish_id uuid not null,
  restaurant_id uuid not null,
  qty int not null check (qty between 1 and 500),
  unit_price numeric(12,2) not null check (unit_price >= 0),  -- precio congelado al cotizar
  primary key (reservation_id, dish_id),
  foreign key (reservation_id, restaurant_id) references public.reservations(id, restaurant_id) on delete cascade,
  foreign key (dish_id, restaurant_id) references public.dishes(id, restaurant_id) on delete restrict
);

-- ---------------------------------------------------------------------------
-- Recordatorios, compras y registro de WhatsApp
-- ---------------------------------------------------------------------------
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  reservation_id uuid not null,
  kind text not null check (kind in ('24h', '2h')),
  send_at timestamptz not null,
  status text not null default 'programado'
    check (status in ('programado', 'enviando', 'enviado', 'fallido', 'cancelado', 'omitido')),
  channel text check (channel in ('whatsapp', 'manual')),
  attempts int not null default 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  unique (reservation_id, kind),
  foreign key (reservation_id, restaurant_id) references public.reservations(id, restaurant_id) on delete cascade
);
create index reminders_due_idx on public.reminders(send_at) where status in ('programado', 'fallido', 'enviando');
create index reminders_provider_idx on public.reminders(provider_message_id);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  ingredient_id uuid not null,
  qty numeric(12,3) not null check (qty > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  bought_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (ingredient_id, restaurant_id) references public.ingredients(id, restaurant_id) on delete cascade
);

create table public.whatsapp_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references public.restaurants(id) on delete cascade,
  reservation_id uuid references public.reservations(id) on delete set null,
  direction text not null check (direction in ('in', 'out')),
  phone text not null default '',
  kind text not null default '',
  body text not null default '',
  payload jsonb,
  created_at timestamptz not null default now()
);

-- Programa los recordatorios de 24 h y 2 h cada vez que se crea, mueve o
-- reactiva una reserva, y los cancela cuando se cancela o se atiende.
create or replace function public.schedule_reminders() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  k record;
  t timestamptz;
begin
  if new.status in ('cancelada', 'atendida') then
    update public.reminders set status = 'cancelado'
     where reservation_id = new.id and status in ('programado', 'fallido', 'enviando');
    return new;
  end if;

  if tg_op = 'INSERT'
     or new.starts_at is distinct from old.starts_at
     or old.status in ('cancelada', 'atendida') then
    delete from public.reminders where reservation_id = new.id;
    for k in select * from (values ('24h', interval '24 hours'), ('2h', interval '2 hours')) v(kind, off) loop
      t := new.starts_at - k.off;
      if t <= now() then
        -- Reserva hecha con menos de 24 h: el de confirmación sale ya, si queda tiempo.
        if k.kind = '24h' and new.starts_at - now() > interval '3 hours' then
          t := now();
        else
          insert into public.reminders (restaurant_id, reservation_id, kind, send_at, status)
          values (new.restaurant_id, new.id, k.kind, t, 'omitido');
          continue;
        end if;
      end if;
      insert into public.reminders (restaurant_id, reservation_id, kind, send_at)
      values (new.restaurant_id, new.id, k.kind, t);
    end loop;
  end if;
  return new;
end $$;

create trigger reservations_reminders after insert or update of starts_at, status on public.reservations
for each row execute function public.schedule_reminders();

-- ---------------------------------------------------------------------------
-- Operaciones (RPC)
-- ---------------------------------------------------------------------------

-- Crea o edita una reserva con su pre-pedido en una sola transacción.
-- Si no se indica mesa, asigna la más pequeña libre que alcance.
create or replace function public.save_reservation(p_restaurant uuid, p_id uuid, p jsonb, p_items jsonb)
returns uuid language plpgsql set search_path = public as $$
declare
  v_id uuid;
  v_table uuid := nullif(p->>'table_id', '')::uuid;
  v_start timestamptz := (p->>'starts_at')::timestamptz;
  v_people int := (p->>'people')::int;
  v_dur int := coalesce(nullif(p->>'duration_min', '')::int, 120);
begin
  if not public.is_member(p_restaurant) then
    raise exception 'No tienes acceso a este restaurante' using errcode = '42501';
  end if;

  if v_table is null then
    select t.id into v_table
      from public.dining_tables t
     where t.restaurant_id = p_restaurant and t.active and t.seats >= v_people
       and not exists (
         select 1 from public.reservations r
          where r.table_id = t.id and r.status <> 'cancelada'
            and (p_id is null or r.id <> p_id)
            and tstzrange(r.starts_at, r.ends_at) && tstzrange(v_start, v_start + make_interval(mins => v_dur)))
     order by t.seats, t.name
     limit 1;
    if v_table is null then
      raise exception 'No hay mesas libres para % personas a esa hora. Prueba otra hora.', v_people using errcode = 'P0001';
    end if;
  end if;

  if p_id is null then
    insert into public.reservations
      (restaurant_id, customer_name, phone, starts_at, duration_min, people, table_id, occasion, allergies, notes, deposit)
    values
      (p_restaurant, trim(p->>'customer_name'), coalesce(p->>'phone', ''), v_start, v_dur, v_people, v_table,
       coalesce(p->>'occasion', ''), coalesce(p->>'allergies', ''), coalesce(p->>'notes', ''),
       coalesce(nullif(p->>'deposit', '')::numeric, 0))
    returning id into v_id;
  else
    update public.reservations set
      customer_name = trim(p->>'customer_name'), phone = coalesce(p->>'phone', ''), starts_at = v_start,
      duration_min = v_dur, people = v_people, table_id = v_table, occasion = coalesce(p->>'occasion', ''),
      allergies = coalesce(p->>'allergies', ''), notes = coalesce(p->>'notes', ''),
      deposit = coalesce(nullif(p->>'deposit', '')::numeric, 0)
    where id = p_id and restaurant_id = p_restaurant
    returning id into v_id;
    if v_id is null then
      raise exception 'La reserva no existe' using errcode = 'P0002';
    end if;
  end if;

  -- Los platos que ya estaban conservan el precio con que se cotizaron.
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

-- Marca la reserva como atendida y descuenta del inventario lo que lleva su pedido.
create or replace function public.serve_reservation(p_id uuid) returns void
language plpgsql set search_path = public as $$
declare
  v public.reservations;
begin
  select * into v from public.reservations where id = p_id for update;
  if not found then
    raise exception 'La reserva no existe' using errcode = 'P0002';
  end if;
  if v.status not in ('pendiente', 'confirmada') then
    raise exception 'Esta reserva ya está %', v.status using errcode = 'P0001';
  end if;
  update public.reservations set status = 'atendida', served_at = now() where id = p_id;
  update public.ingredients i set stock = greatest(0, i.stock - s.q)
    from (select ri.ingredient_id, sum(ri.qty * it.qty) q
            from public.reservation_items it
            join public.recipe_items ri on ri.dish_id = it.dish_id
           where it.reservation_id = p_id
           group by ri.ingredient_id) s
   where i.id = s.ingredient_id;
end $$;

-- Registra lo comprado: sube el stock y actualiza el precio de cada insumo.
-- p_items: [{ "ingredient_id": uuid, "qty": número, "unit_price": número | null }]
create or replace function public.register_purchase(p_restaurant uuid, p_items jsonb) returns int
language plpgsql set search_path = public as $$
declare
  n int;
begin
  if not public.is_member(p_restaurant) then
    raise exception 'No tienes acceso a este restaurante' using errcode = '42501';
  end if;
  with x as (
    select (e->>'ingredient_id')::uuid id, (e->>'qty')::numeric qty, nullif(e->>'unit_price', '')::numeric price
      from jsonb_array_elements(p_items) e
     where (e->>'qty')::numeric > 0
  ), ins as (
    insert into public.purchases (restaurant_id, ingredient_id, qty, unit_price)
    select p_restaurant, x.id, x.qty, coalesce(x.price, i.price)
      from x join public.ingredients i on i.id = x.id and i.restaurant_id = p_restaurant
    returning ingredient_id
  )
  update public.ingredients i
     set stock = i.stock + x.qty, price = coalesce(x.price, i.price)
    from x
   where i.id = x.id and i.restaurant_id = p_restaurant;
  get diagnostics n = row_count;
  return n;
end $$;

-- Reclama los recordatorios vencidos para enviarlos. Solo lo llama el servidor
-- (service_role). FOR UPDATE SKIP LOCKED evita envíos dobles si el cron se cruza.
create or replace function public.claim_due_reminders(p_limit int default 50)
returns setof public.reminders
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select r.id
      from public.reminders r
      join public.reservations v on v.id = r.reservation_id
      join public.restaurants s on s.id = r.restaurant_id
     where r.send_at <= now()
       and v.starts_at > now()
       and v.status in ('pendiente', 'confirmada')
       and s.reminders_enabled
       and (r.status = 'programado'
            or (r.status = 'fallido' and r.attempts < 3)
            or (r.status = 'enviando' and r.claimed_at < now() - interval '10 minutes'))
     order by r.send_at
     limit p_limit
       for update of r skip locked
  )
  update public.reminders r
     set status = 'enviando', attempts = r.attempts + 1, claimed_at = now()
    from due
   where r.id = due.id
  returning r.*;
end $$;

-- Crea el restaurante del usuario que inicia sesión y lo deja como dueño.
create or replace function public.create_restaurant(p_name text, p_demo boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  rid uuid;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Inicia sesión primero' using errcode = '42501';
  end if;
  insert into public.restaurants (name) values (trim(p_name)) returning id into rid;
  insert into public.memberships (restaurant_id, user_id, role) values (rid, uid, 'owner');
  if p_demo then
    perform public.seed_demo(rid);
  end if;
  return rid;
end $$;

-- Carga un menú colombiano de ejemplo (insumos, platos, recetas y mesas).
-- No crea reservas: así nunca se envía un WhatsApp a un número inventado.
create or replace function public.seed_demo(rid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.ingredients (restaurant_id, name, unit, price, supplier, stock, min_stock)
  select rid, v.* from (values
    ('Carne de res molida','kg',28000,'Carnes El Llano',2.5,2),
    ('Chicharrón (tocino)','kg',24000,'Carnes El Llano',2,2),
    ('Chorizo antioqueño','kg',22000,'Carnes El Llano',1.5,1),
    ('Pechuga de pollo','kg',14000,'Carnes El Llano',4,3),
    ('Muchacho de res (posta)','kg',32000,'Carnes El Llano',1.2,1.5),
    ('Mojarra roja','und',9000,'Pescadería El Puerto',4,6),
    ('Fríjol cargamanto','kg',9000,'Plaza de Paloquemao',3,2),
    ('Papa criolla','kg',4500,'Plaza de Paloquemao',3,2),
    ('Papa sabanera','kg',2200,'Plaza de Paloquemao',5,3),
    ('Plátano maduro','und',1200,'Plaza de Paloquemao',10,12),
    ('Plátano verde','und',1000,'Plaza de Paloquemao',14,10),
    ('Aguacate Hass','und',3000,'Plaza de Paloquemao',6,8),
    ('Mazorca','und',1800,'Plaza de Paloquemao',6,6),
    ('Guascas','kg',20000,'Plaza de Paloquemao',0.15,0.1),
    ('Limón Tahití','kg',4000,'Plaza de Paloquemao',3,2),
    ('Tomate chonto','kg',4000,'Plaza de Paloquemao',3,2),
    ('Cebolla larga','kg',3500,'Plaza de Paloquemao',2,1.5),
    ('Arroz blanco','kg',4200,'Distribuidora Central',12,8),
    ('Huevo AA','und',600,'Distribuidora Central',30,30),
    ('Arepa de maíz','und',700,'Distribuidora Central',20,15),
    ('Crema de leche','l',14000,'Distribuidora Central',1,1),
    ('Alcaparras','kg',40000,'Distribuidora Central',0.3,0.2),
    ('Panela','kg',5000,'Distribuidora Central',2,1.5),
    ('Leche de coco','l',12000,'Distribuidora Central',2,2),
    ('Aceite vegetal','l',9000,'Distribuidora Central',6,4),
    ('Queso costeño / cuajada','kg',22000,'Lácteos San Pedro',1.5,1.5)
  ) v(name, unit, price, supplier, stock, min_stock);

  insert into public.dishes (restaurant_id, name, category, price, sort)
  select rid, v.* from (values
    ('Bandeja paisa','Plato fuerte',38000,1),
    ('Ajiaco santafereño','Plato fuerte',32000,2),
    ('Posta cartagenera','Plato fuerte',42000,3),
    ('Mojarra frita','Plato fuerte',34000,4),
    ('Sancocho de gallina','Plato fuerte',30000,5),
    ('Patacones con hogao','Entrada',14000,6),
    ('Limonada de coco','Bebida',12000,7),
    ('Cuajada con melao','Postre',11000,8)
  ) v(name, category, price, sort);

  insert into public.recipe_items (dish_id, ingredient_id, restaurant_id, qty)
  select d.id, i.id, rid, v.qty from (values
    ('Bandeja paisa','Fríjol cargamanto',0.12),('Bandeja paisa','Arroz blanco',0.1),('Bandeja paisa','Carne de res molida',0.12),
    ('Bandeja paisa','Chicharrón (tocino)',0.15),('Bandeja paisa','Chorizo antioqueño',0.08),('Bandeja paisa','Huevo AA',1),
    ('Bandeja paisa','Plátano maduro',0.5),('Bandeja paisa','Aguacate Hass',0.25),('Bandeja paisa','Arepa de maíz',1),
    ('Ajiaco santafereño','Pechuga de pollo',0.2),('Ajiaco santafereño','Papa criolla',0.15),('Ajiaco santafereño','Papa sabanera',0.15),
    ('Ajiaco santafereño','Mazorca',0.5),('Ajiaco santafereño','Guascas',0.01),('Ajiaco santafereño','Crema de leche',0.04),
    ('Ajiaco santafereño','Alcaparras',0.01),('Ajiaco santafereño','Aguacate Hass',0.25),('Ajiaco santafereño','Arroz blanco',0.08),
    ('Posta cartagenera','Muchacho de res (posta)',0.25),('Posta cartagenera','Panela',0.05),('Posta cartagenera','Cebolla larga',0.05),
    ('Posta cartagenera','Tomate chonto',0.05),('Posta cartagenera','Arroz blanco',0.1),('Posta cartagenera','Leche de coco',0.08),
    ('Posta cartagenera','Plátano maduro',0.5),
    ('Mojarra frita','Mojarra roja',1),('Mojarra frita','Plátano verde',1),('Mojarra frita','Arroz blanco',0.1),
    ('Mojarra frita','Leche de coco',0.08),('Mojarra frita','Limón Tahití',0.05),('Mojarra frita','Aceite vegetal',0.15),
    ('Mojarra frita','Tomate chonto',0.05),('Mojarra frita','Cebolla larga',0.03),
    ('Sancocho de gallina','Pechuga de pollo',0.25),('Sancocho de gallina','Papa sabanera',0.15),('Sancocho de gallina','Plátano verde',0.5),
    ('Sancocho de gallina','Mazorca',0.5),('Sancocho de gallina','Arroz blanco',0.08),('Sancocho de gallina','Aguacate Hass',0.25),
    ('Sancocho de gallina','Cebolla larga',0.03),
    ('Patacones con hogao','Plátano verde',1.5),('Patacones con hogao','Tomate chonto',0.08),('Patacones con hogao','Cebolla larga',0.05),
    ('Patacones con hogao','Aceite vegetal',0.1),('Patacones con hogao','Queso costeño / cuajada',0.06),
    ('Limonada de coco','Limón Tahití',0.08),('Limonada de coco','Leche de coco',0.12),('Limonada de coco','Panela',0.03),
    ('Cuajada con melao','Queso costeño / cuajada',0.12),('Cuajada con melao','Panela',0.08)
  ) v(dish, ing, qty)
  join public.dishes d on d.restaurant_id = rid and d.name = v.dish
  join public.ingredients i on i.restaurant_id = rid and i.name = v.ing;

  insert into public.dining_tables (restaurant_id, name, seats, zone, x, y)
  select rid, v.* from (values
    ('T1',2,'Salón',10,20),('T2',2,'Salón',24,20),('T3',4,'Salón',41,20),('T4',4,'Salón',11,49),
    ('T5',4,'Salón',27,49),('T6',6,'Salón',45,49),('T7',8,'Salón',16,80),('Privado',16,'Salón',43,80),
    ('T8',2,'Terraza',71,20),('T9',2,'Terraza',88,20),('T10',4,'Terraza',71,49),('T11',4,'Terraza',88,49),
    ('T12',6,'Terraza',79.5,80)
  ) v(name, seats, zone, x, y);
end $$;

revoke execute on function public.claim_due_reminders(int) from public, anon, authenticated;
revoke execute on function public.seed_demo(uuid) from public, anon, authenticated;
grant execute on function public.claim_due_reminders(int) to service_role;

-- ---------------------------------------------------------------------------
-- Seguridad por filas
-- ---------------------------------------------------------------------------
alter table public.restaurants enable row level security;
alter table public.memberships enable row level security;
alter table public.ingredients enable row level security;
alter table public.dishes enable row level security;
alter table public.recipe_items enable row level security;
alter table public.dining_tables enable row level security;
alter table public.reservations enable row level security;
alter table public.reservation_items enable row level security;
alter table public.reminders enable row level security;
alter table public.purchases enable row level security;
alter table public.whatsapp_events enable row level security;

create policy restaurants_select on public.restaurants for select to authenticated using (public.is_member(id));
create policy restaurants_update on public.restaurants for update to authenticated
  using (public.is_owner(id)) with check (public.is_owner(id));

create policy memberships_select on public.memberships for select to authenticated
  using (user_id = auth.uid() or public.is_member(restaurant_id));

do $$
declare t text;
begin
  foreach t in array array['ingredients','dishes','recipe_items','dining_tables','reservations','reservation_items','purchases'] loop
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_member(restaurant_id)) with check (public.is_member(restaurant_id))',
      t || '_member_all', t);
  end loop;
end $$;

create policy reminders_select on public.reminders for select to authenticated using (public.is_member(restaurant_id));
create policy reminders_update on public.reminders for update to authenticated
  using (public.is_member(restaurant_id)) with check (public.is_member(restaurant_id));
create policy whatsapp_events_select on public.whatsapp_events for select to authenticated
  using (restaurant_id is not null and public.is_member(restaurant_id));

-- Tiempo real: la app se actualiza sola cuando otro dispositivo cambia una reserva.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.reservations, public.reminders;
  end if;
end $$;
