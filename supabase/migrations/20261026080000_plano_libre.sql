-- Plano libre: mesas con tamaño propio y giro; zonas y elementos giran a cualquier ángulo.

-- w y h en % del plano; 0 = tamaño automático según los puestos.
alter table public.dining_tables
  add column w numeric(5,2) not null default 0 check (w = 0 or w between 3 and 60),
  add column h numeric(5,2) not null default 0 check (h = 0 or h between 3 and 90),
  add column rotation int not null default 0 check (rotation between 0 and 359);

alter table public.zones
  add column rotation int not null default 0 check (rotation between 0 and 359);

alter table public.floor_items drop constraint if exists floor_items_rotation_check;
alter table public.floor_items add constraint floor_items_rotation_check check (rotation between 0 and 359);

-- El plano público trae el tamaño y el giro de cada cosa.
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
    'zones', coalesce((select jsonb_agg(jsonb_build_object('name', z.name, 'x', z.x, 'y', z.y, 'w', z.w, 'h', z.h, 'floor', z.floor, 'rotation', z.rotation)
                         order by z.sort, z.name)
                         from public.zones z where z.restaurant_id = r.id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('kind', i.kind, 'label', i.label, 'x', i.x, 'y', i.y, 'w', i.w, 'h', i.h, 'rotation', i.rotation))
                         from public.floor_items i where i.restaurant_id = r.id), '[]'::jsonb),
    'tables', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'seats', t.seats, 'zone', t.zone, 'x', t.x, 'y', t.y, 'shape', t.shape,
        'w', t.w, 'h', t.h, 'rotation', t.rotation,
        'fits', public.table_fits(t.seats, p_people),
        'free', not exists (
          select 1 from public.reservations v
           where v.table_id = t.id and v.status <> 'cancelada'
             and tstzrange(v.starts_at, v.ends_at) && tstzrange(v_start, v_start + interval '120 minutes'))
      ) order by t.name)
      from public.dining_tables t where t.restaurant_id = r.id and t.active), '[]'::jsonb));
end $$;

grant execute on function public.public_floor(text, date, text, int) to anon, authenticated;
