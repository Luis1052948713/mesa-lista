-- Plano configurable: zonas con nombre, tamaño y posición; forma de cada mesa.

create table public.zones (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 30),
  x numeric(5,2) not null default 2 check (x between 0 and 100),
  y numeric(5,2) not null default 4 check (y between 0 and 100),
  w numeric(5,2) not null default 50 check (w between 5 and 100),
  h numeric(5,2) not null default 92 check (h between 5 and 100),
  sort int not null default 0,
  unique (restaurant_id, name)
);

alter table public.zones enable row level security;
create policy zones_member_all on public.zones for all to authenticated
  using (public.is_member(restaurant_id)) with check (public.is_member(restaurant_id));

-- Zonas de los restaurantes que ya existen, a partir de las que usan sus mesas.
insert into public.zones (restaurant_id, name, x, y, w, h, sort)
select distinct t.restaurant_id, t.zone,
       case when t.zone = 'Terraza' then 61 else 2 end, 4,
       case when t.zone = 'Terraza' then 37 else 57 end, 92,
       case when t.zone = 'Terraza' then 2 else 1 end
  from public.dining_tables t
on conflict (restaurant_id, name) do nothing;

insert into public.zones (restaurant_id, name, x, y, w, h, sort)
select r.id, 'Salón', 2, 4, 96, 92, 1
  from public.restaurants r
 where not exists (select 1 from public.zones z where z.restaurant_id = r.id);

-- Cada mesa pertenece a una zona existente. Renombrar la zona actualiza sus mesas;
-- una zona con mesas no se puede borrar.
alter table public.dining_tables
  add constraint dining_tables_zone_fkey foreign key (restaurant_id, zone)
  references public.zones(restaurant_id, name) on update cascade on delete restrict;
create index dining_tables_zone_idx on public.dining_tables(restaurant_id, zone);

alter table public.dining_tables
  add column shape text not null default 'auto' check (shape in ('auto', 'round', 'rect'));

-- No se borra una mesa con reservas por venir: se pierde a dónde sentar al cliente.
create or replace function public.guard_table_delete() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.reservations r
              where r.table_id = old.id and r.status in ('pendiente', 'confirmada') and r.ends_at > now()) then
    raise exception 'La mesa % tiene reservas próximas. Muévelas a otra mesa o desactívala en lugar de borrarla.', old.name
      using errcode = 'P0001';
  end if;
  return old;
end $$;

create trigger dining_tables_guard_delete before delete on public.dining_tables
for each row execute function public.guard_table_delete();

revoke execute on function public.guard_table_delete() from public, anon, authenticated;

-- Los restaurantes nuevos arrancan con su zona (o las dos del ejemplo).
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

-- Los cambios del plano llegan en vivo a los otros dispositivos.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.dining_tables, public.zones;
  end if;
end $$;
