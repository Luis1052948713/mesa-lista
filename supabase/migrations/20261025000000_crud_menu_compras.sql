-- CRUD de menú, recetas, inventario y compras.

alter table public.purchases add column note text not null default '';
create index purchases_restaurant_time_idx on public.purchases(restaurant_id, bought_at desc);

-- Cada compra mueve el stock de su insumo: crearla suma, editarla ajusta la
-- diferencia y borrarla la revierte. El precio del insumo queda en el de su
-- compra más reciente.
create or replace function public.apply_purchase_stock() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.ingredients set stock = greatest(0, stock - old.qty) where id = old.ingredient_id;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  update public.ingredients set stock = stock + new.qty where id = new.ingredient_id;
  update public.ingredients i set price = p.unit_price
    from (select unit_price from public.purchases
           where ingredient_id = new.ingredient_id
           order by bought_at desc, id desc limit 1) p
   where i.id = new.ingredient_id;
  return new;
end $$;

create trigger purchases_stock after insert or update of qty, ingredient_id, unit_price, bought_at or delete on public.purchases
for each row execute function public.apply_purchase_stock();

revoke execute on function public.apply_purchase_stock() from public, anon, authenticated;

-- El stock y el precio ahora los mueve el trigger; aquí solo se registran las compras.
create or replace function public.register_purchase(p_restaurant uuid, p_items jsonb) returns int
language plpgsql set search_path = public as $$
declare
  n int;
begin
  if not public.is_member(p_restaurant) then
    raise exception 'No tienes acceso a este restaurante' using errcode = '42501';
  end if;
  insert into public.purchases (restaurant_id, ingredient_id, qty, unit_price)
  select p_restaurant, i.id, (e->>'qty')::numeric, coalesce(nullif(e->>'unit_price', '')::numeric, i.price)
    from jsonb_array_elements(p_items) e
    join public.ingredients i on i.id = (e->>'ingredient_id')::uuid and i.restaurant_id = p_restaurant
   where (e->>'qty')::numeric > 0;
  get diagnostics n = row_count;
  return n;
end $$;

-- Crea o edita un plato y reemplaza su receta en una sola transacción.
-- p: { name, category, price, active }   p_recipe: [{ ingredient_id, qty }]
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
    insert into public.dishes (restaurant_id, name, category, price, active, sort)
    values (p_restaurant, trim(p->>'name'), v_category, (p->>'price')::numeric, coalesce((p->>'active')::boolean, true),
            coalesce((select max(sort) + 1 from public.dishes where restaurant_id = p_restaurant), 1))
    returning id into v_id;
  else
    update public.dishes
       set name = trim(p->>'name'), category = v_category, price = (p->>'price')::numeric,
           active = coalesce((p->>'active')::boolean, true)
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
