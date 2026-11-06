-- Borrar un insumo aunque esté en recetas: lo quita de esas recetas y lo borra en la
-- misma transacción (sus compras se borran en cascada). La app pide confirmación antes.
create or replace function public.delete_ingredient(p_id uuid) returns void
language plpgsql set search_path = public as $$
declare
  v_rid uuid;
begin
  -- Corre con los permisos del usuario: si no es de su restaurante, no lo ve.
  select restaurant_id into v_rid from public.ingredients where id = p_id;
  if v_rid is null then
    raise exception 'El insumo no existe o ya fue borrado.' using errcode = 'P0002';
  end if;
  if not public.is_member(v_rid) then
    raise exception 'No tienes acceso a este restaurante' using errcode = '42501';
  end if;
  delete from public.recipe_items where ingredient_id = p_id;
  delete from public.ingredients where id = p_id;
end $$;

revoke execute on function public.delete_ingredient(uuid) from public, anon;
grant execute on function public.delete_ingredient(uuid) to authenticated;
