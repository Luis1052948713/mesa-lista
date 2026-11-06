-- Ajustes sugeridos por los asesores de Supabase.

-- search_path fijo en la función del trigger de horarios.
alter function public.set_reservation_times() set search_path = public;

-- Funciones que nadie debe llamar sin sesión. Supabase da EXECUTE a anon por defecto.
revoke execute on function public.create_restaurant(text, boolean) from public, anon;
revoke execute on function public.is_member(uuid) from public, anon;
revoke execute on function public.is_owner(uuid) from public, anon;
grant execute on function public.create_restaurant(text, boolean) to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.is_owner(uuid) to authenticated;

-- Las funciones de trigger solo las ejecuta Postgres; nadie las llama por la API.
revoke execute on function public.schedule_reminders() from public, anon, authenticated;
revoke execute on function public.set_reservation_times() from public, anon, authenticated;

-- auth.uid() evaluado una sola vez por consulta y no por fila.
drop policy memberships_select on public.memberships;
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or public.is_member(restaurant_id));

-- Índices para las llaves foráneas.
create index purchases_ingredient_idx on public.purchases(ingredient_id, restaurant_id);
create index recipe_items_dish_idx on public.recipe_items(dish_id, restaurant_id);
create index recipe_items_ingredient_idx on public.recipe_items(ingredient_id, restaurant_id);
create index reminders_reservation_idx on public.reminders(reservation_id, restaurant_id);
create index reservation_items_dish_idx on public.reservation_items(dish_id, restaurant_id);
create index reservation_items_reservation_idx on public.reservation_items(reservation_id, restaurant_id);
create index reservations_table_idx on public.reservations(table_id, restaurant_id);
create index whatsapp_events_reservation_idx on public.whatsapp_events(reservation_id);
create index whatsapp_events_restaurant_idx on public.whatsapp_events(restaurant_id);
