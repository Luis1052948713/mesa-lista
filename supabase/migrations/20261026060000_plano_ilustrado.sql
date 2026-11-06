-- Plano ilustrado: piso por zona, elementos del local (barra, puerta, cocina…) y foto o dibujo de fondo.

alter table public.zones
  add column floor text not null default 'madera'
    check (floor in ('madera', 'baldosa', 'concreto', 'pasto', 'alfombra', 'ninguno'));

-- La terraza del ejemplo arranca con baldosa.
update public.zones set floor = 'baldosa' where name ilike 'terraza%';

alter table public.restaurants
  add column plan_bg_url text not null default '' check (char_length(plan_bg_url) <= 500);

create table public.floor_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  kind text not null check (kind in ('barra', 'puerta', 'cocina', 'bano', 'caja', 'planta', 'ventana', 'escalera', 'pared')),
  label text not null default '' check (char_length(label) <= 30),
  x numeric(5,2) not null default 50 check (x between 0 and 100),
  y numeric(5,2) not null default 50 check (y between 0 and 100),
  w numeric(5,2) not null default 10 check (w between 1 and 100),
  h numeric(5,2) not null default 10 check (h between 1 and 100),
  rotation int not null default 0 check (rotation in (0, 90, 180, 270)),
  created_at timestamptz not null default now()
);
create index floor_items_restaurant_idx on public.floor_items(restaurant_id);

alter table public.floor_items enable row level security;
create policy floor_items_member_all on public.floor_items for all to authenticated
  using (public.is_member(restaurant_id)) with check (public.is_member(restaurant_id));

-- El plano público ahora incluye piso de cada zona, elementos y fondo.
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
    'bg', r.plan_bg_url,
    'zones', coalesce((select jsonb_agg(jsonb_build_object('name', z.name, 'x', z.x, 'y', z.y, 'w', z.w, 'h', z.h, 'floor', z.floor) order by z.sort, z.name)
                         from public.zones z where z.restaurant_id = r.id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('kind', i.kind, 'label', i.label, 'x', i.x, 'y', i.y, 'w', i.w, 'h', i.h, 'rotation', i.rotation))
                         from public.floor_items i where i.restaurant_id = r.id), '[]'::jsonb),
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

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.floor_items;
  end if;
end $$;

-- Los restaurantes nuevos con ejemplo también arrancan con la terraza en baldosa.
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
    insert into public.zones (restaurant_id, name, x, y, w, h, sort, floor)
    values (rid, 'Salón', 2, 4, 57, 92, 1, 'madera'), (rid, 'Terraza', 61, 4, 37, 92, 2, 'baldosa');
    perform public.seed_demo(rid);
  else
    insert into public.zones (restaurant_id, name, x, y, w, h, sort) values (rid, 'Salón', 2, 4, 96, 92, 1);
  end if;
  return rid;
end $$;

revoke execute on function public.create_restaurant(text, boolean) from public, anon;
grant execute on function public.create_restaurant(text, boolean) to authenticated;
