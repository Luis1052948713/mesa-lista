// Prueba la migración en un Postgres embebido (PGlite), sin Docker ni Supabase.
// Simula lo mínimo de Supabase: roles, auth.users y auth.uid().
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

const db = new PGlite({ extensions: { btree_gist } });
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`);
  if (!cond) failures++;
};
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const as = async (uid) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  await db.exec(uid ? 'set role authenticated' : 'set role anon');
};
const asService = () => db.exec('reset role; set role service_role');
const fails = async (fn) => {
  try { await fn(); return null; } catch (e) { return e.message; }
};

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema extensions;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`);

const dir = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
for (const f of readdirSync(dir).sort()) {
  await db.exec(readFileSync(join(dir, f), 'utf8'));
  console.log(`Migración aplicada: ${f}`);
}

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
await db.exec(`insert into auth.users values ('${A}'), ('${B}')`);

console.log('\nRestaurante y datos de ejemplo');
await as(A);
const { rid } = await one(`select public.create_restaurant('Fogón 38', true) rid`);
ok(!!rid, 'create_restaurant devuelve el id');
const counts = await one(`select (select count(*) from ingredients)::int ing, (select count(*) from dishes)::int dis,
  (select count(*) from recipe_items)::int rec, (select count(*) from dining_tables)::int tab`);
ok(counts.ing === 26 && counts.dis === 8 && counts.rec === 50 && counts.tab === 13,
  `menú de ejemplo cargado (${counts.ing} insumos, ${counts.dis} platos, ${counts.rec} líneas de receta, ${counts.tab} mesas)`);
ok(!!(await fails(() => db.query(`select public.seed_demo($1)`, [rid]))), 'un usuario no puede llamar seed_demo directamente');

console.log('\nReservas');
const bandeja = (await one(`select id from dishes where name='Bandeja paisa'`)).id;
const ajiaco = (await one(`select id from dishes where name='Ajiaco santafereño'`)).id;
const in3days = `(date_trunc('day', now()) + interval '3 days 20 hours')`;
const { r1 } = await one(`select public.save_reservation($1, null,
  jsonb_build_object('customer_name','Andrés Gómez','phone','300 123 4567','starts_at', ${in3days}, 'people', 4),
  jsonb_build_array(jsonb_build_object('dish_id',$2::text,'qty',2), jsonb_build_object('dish_id',$3::text,'qty',2))) r1`, [rid, bandeja, ajiaco]);
const res1 = await one(`select r.*, t.name tname, t.seats from reservations r join dining_tables t on t.id=r.table_id where r.id=$1`, [r1]);
ok(res1.seats === 4, `asigna sola la mesa más pequeña que alcanza (${res1.tname}, ${res1.seats} puestos)`);
ok(res1.phone_digits === '3001234567', 'normaliza el teléfono para buscarlo');
ok(Number(res1.code) >= 1001, `código legible R-${res1.code}`);
const rem1 = (await db.query(`select kind, status from reminders where reservation_id=$1 order by kind`, [r1])).rows;
ok(rem1.length === 2 && rem1.every((r) => r.status === 'programado'), 'programa recordatorios de 24 h y 2 h');
const items1 = await one(`select count(*)::int n, sum(qty*unit_price)::int total from reservation_items where reservation_id=$1`, [r1]);
ok(items1.n === 2 && items1.total === 2 * 38000 + 2 * 32000, `guarda el pre-pedido con precio congelado (${items1.total})`);

const clash = await fails(() => db.query(`select public.save_reservation($1, null,
  jsonb_build_object('customer_name','Otra','starts_at', ${in3days} + interval '1 hour', 'people', 2, 'table_id', $2::text), '[]')`, [rid, res1.table_id]));
ok(clash?.includes('ya está reservada'), 'no deja reservar una mesa ocupada en un horario cruzado');

await db.query(`update dishes set price = 40000 where id=$1`, [bandeja]);
await db.query(`select public.save_reservation($1, $2,
  jsonb_build_object('customer_name','Andrés Gómez','phone','3001234567','starts_at', ${in3days}, 'people', 4, 'table_id', $3::text),
  jsonb_build_array(jsonb_build_object('dish_id',$4::text,'qty',3)))`, [rid, r1, res1.table_id, bandeja]);
const items2 = await one(`select count(*)::int n, max(qty) q, max(unit_price)::int p from reservation_items where reservation_id=$1`, [r1]);
ok(items2.n === 1 && items2.q === 3 && items2.p === 38000, 'al editar, conserva el precio cotizado y quita platos eliminados');

const soon = `(now() + interval '150 minutes')`;
const { r2 } = await one(`select public.save_reservation($1, null,
  jsonb_build_object('customer_name','Laura Pérez','phone','3145556677','starts_at', ${soon}, 'people', 2), '[]') r2`, [rid]);
const rem2 = Object.fromEntries((await db.query(`select kind, status from reminders where reservation_id=$1`, [r2])).rows.map((r) => [r.kind, r.status]));
ok(rem2['24h'] === 'omitido' && rem2['2h'] === 'programado', 'reserva a 2,5 h: omite el de 24 h y programa el de 2 h');

const { r3 } = await one(`select public.save_reservation($1, null,
  jsonb_build_object('customer_name','Sofía Castaño','phone','3018889900','starts_at', now() + interval '6 hours', 'people', 3), '[]') r3`, [rid]);
const rem3 = await one(`select send_at <= now() + interval '1 minute' as now_ from reminders where reservation_id=$1 and kind='24h'`, [r3]);
ok(rem3.now_, 'reserva a 6 h: el recordatorio de 24 h sale de inmediato');

console.log('\nRecordatorios (servidor)');
ok(!!(await fails(() => db.query(`select * from public.claim_due_reminders(10)`))), 'un usuario no puede reclamar recordatorios');
await asService();
const claimed = (await db.query(`select * from public.claim_due_reminders(10)`)).rows;
ok(claimed.length === 1 && claimed[0].reservation_id === r3, 'el cron reclama solo los vencidos');
const again = (await db.query(`select * from public.claim_due_reminders(10)`)).rows;
ok(again.length === 0, 'no reclama dos veces el mismo recordatorio');

await as(A);
await db.query(`update reservations set status='cancelada' where id=$1`, [r2]);
const rem2c = await one(`select status from reminders where reservation_id=$1 and kind='2h'`, [r2]);
ok(rem2c.status === 'cancelado', 'cancelar la reserva cancela sus recordatorios');
await db.query(`update reservations set starts_at = starts_at + interval '1 day' where id=$1`, [r1]);
const rem1m = (await db.query(`select status from reminders where reservation_id=$1`, [r1])).rows;
ok(rem1m.length === 2 && rem1m.every((r) => r.status === 'programado'), 'mover la reserva reprograma los recordatorios');

console.log('\nInventario y compras');
const before = await one(`select stock::float s from ingredients where name='Chicharrón (tocino)'`);
await db.query(`select public.serve_reservation($1)`, [r1]);
const after = await one(`select stock::float s from ingredients where name='Chicharrón (tocino)'`);
ok(Math.abs(before.s - 0.45 - after.s) < 1e-6, `atender descuenta inventario (chicharrón ${before.s} → ${after.s} kg)`);
ok((await fails(() => db.query(`select public.serve_reservation($1)`, [r1])))?.includes('ya está'), 'no descuenta dos veces');
const pollo = await one(`select id, stock::float s from ingredients where name='Pechuga de pollo'`);
const n = await one(`select public.register_purchase($1, jsonb_build_array(jsonb_build_object('ingredient_id',$2::text,'qty',5,'unit_price',15000))) n`, [rid, pollo.id]);
const pollo2 = await one(`select stock::float s, price::int p from ingredients where id=$1`, [pollo.id]);
ok(n.n === 1 && pollo2.s === pollo.s + 5 && pollo2.p === 15000, 'registrar compra sube el stock y actualiza el precio');

console.log('\nMenú, inventario y compras (CRUD)');
const arroz = await one(`select id from ingredients where name='Arroz blanco'`);
const { nd } = await one(`select public.save_dish($1, null, jsonb_build_object('name','Arroz con pollo','category','Plato fuerte','price',28000),
  jsonb_build_array(jsonb_build_object('ingredient_id',$2::text,'qty',0.2), jsonb_build_object('ingredient_id',$3::text,'qty',0.1),
                    jsonb_build_object('ingredient_id',$3::text,'qty',0.05))) nd`, [rid, pollo.id, arroz.id]);
const rec = (await db.query(`select qty::float q from recipe_items where dish_id=$1 order by qty`, [nd])).rows.map((r) => r.q);
ok(rec.length === 2 && Math.abs(rec[0] - 0.15) < 1e-9 && rec[1] === 0.2, 'crea un plato con su receta (y suma insumos repetidos)');
await db.query(`select public.save_dish($1, $2, jsonb_build_object('name','Arroz con pollo','price',30000,'active',false),
  jsonb_build_array(jsonb_build_object('ingredient_id',$3::text,'qty',0.25)))`, [rid, nd, pollo.id]);
const nd2 = await one(`select price::int p, active, (select count(*)::int from recipe_items where dish_id=$1) n from dishes where id=$1`, [nd]);
ok(nd2.p === 30000 && nd2.active === false && nd2.n === 1, 'edita el plato y reemplaza su receta');
ok((await fails(() => db.query(`select public.save_dish($1, null, jsonb_build_object('name','Bandeja paisa','price',1), '[]')`, [rid])))?.includes('Ya existe'),
  'no deja dos platos con el mismo nombre');
await db.query(`delete from dishes where id=$1`, [nd]);
ok((await one(`select count(*)::int n from recipe_items where dish_id=$1`, [nd])).n === 0, 'borrar un plato borra su receta');
ok(!!(await fails(() => db.query(`delete from dishes where id=$1`, [bandeja]))), 'no deja borrar un plato que está en reservas');
ok(!!(await fails(() => db.query(`delete from ingredients where id=$1`, [pollo.id]))), 'no deja borrar un insumo que está en recetas');

const s0 = (await one(`select stock::float s from ingredients where id=$1`, [arroz.id])).s;
const { pid } = await one(`insert into purchases (restaurant_id, ingredient_id, qty, unit_price) values ($1,$2,10,4500) returning id pid`, [rid, arroz.id]);
const s1 = await one(`select stock::float s, price::int p from ingredients where id=$1`, [arroz.id]);
ok(s1.s === s0 + 10 && s1.p === 4500, 'crear una compra suma al stock y actualiza el precio');
await db.query(`update purchases set qty = 6 where id=$1`, [pid]);
ok((await one(`select stock::float s from ingredients where id=$1`, [arroz.id])).s === s0 + 6, 'editar la cantidad ajusta el stock por la diferencia');
await db.query(`delete from purchases where id=$1`, [pid]);
ok((await one(`select stock::float s from ingredients where id=$1`, [arroz.id])).s === s0, 'borrar la compra revierte el stock');
const { nid } = await one(`insert into ingredients (restaurant_id, name, unit, price) values ($1, 'Cilantro', 'kg', 8000) returning id nid`, [rid]);
await db.query(`update ingredients set min_stock = 0.2, supplier = 'Plaza' where id=$1`, [nid]);
await db.query(`delete from ingredients where id=$1`, [nid]);
ok((await one(`select count(*)::int n from ingredients where id=$1`, [nid])).n === 0, 'crea, edita y borra un insumo sin uso');

const papa = await one(`select id from ingredients where restaurant_id=$1 and name='Papa criolla'`, [rid]);
await as(B);
ok(!!(await fails(() => db.query(`select public.delete_ingredient($1)`, [papa.id]))), 'otro usuario no puede borrar insumos ajenos');
await as(A);
const usosAntes = (await one(`select count(*)::int n from recipe_items where ingredient_id=$1`, [papa.id])).n;
await db.query(`select public.delete_ingredient($1)`, [papa.id]);
const papaDespues = await one(`select (select count(*)::int from ingredients where id=$1) i, (select count(*)::int from recipe_items where ingredient_id=$1) r`, [papa.id]);
ok(usosAntes > 0 && papaDespues.i === 0 && papaDespues.r === 0, `borra un insumo en uso y lo quita de sus recetas (${usosAntes} receta)`);
ok((await one(`select count(*)::int n from dishes where restaurant_id=$1 and name='Ajiaco santafereño'`, [rid])).n === 1, 'el plato se conserva, solo pierde ese insumo');

console.log('\nPlano: zonas y mesas');
const zs = (await db.query(`select name from zones where restaurant_id=$1 order by sort`, [rid])).rows.map((r) => r.name);
ok(zs.join(',') === 'Salón,Terraza', 'el restaurante de ejemplo trae las zonas Salón y Terraza');
await db.query(`update zones set name='Terraza cubierta' where restaurant_id=$1 and name='Terraza'`, [rid]);
ok((await one(`select count(*)::int n from dining_tables where restaurant_id=$1 and zone='Terraza cubierta'`, [rid])).n === 5,
  'renombrar una zona mueve el nombre a sus mesas');
ok(!!(await fails(() => db.query(`delete from zones where restaurant_id=$1 and name='Salón'`, [rid]))), 'no deja borrar una zona con mesas');
ok(!!(await fails(() => db.query(`insert into dining_tables (restaurant_id, name, seats, zone) values ($1, 'X1', 2, 'No existe')`, [rid]))),
  'no deja crear una mesa en una zona que no existe');
const { zb } = await one(`insert into zones (restaurant_id, name, x, y, w, h) values ($1, 'Barra', 2, 70, 30, 25) returning id zb`, [rid]);
const { tb } = await one(`insert into dining_tables (restaurant_id, name, seats, zone, x, y, shape) values ($1, 'B1', 2, 'Barra', 10, 80, 'round') returning id tb`, [rid]);
await db.query(`update dining_tables set x = 20, y = 85, seats = 3 where id=$1`, [tb]);
const tbr = await one(`select x::float x, seats from dining_tables where id=$1`, [tb]);
ok(tbr.x === 20 && tbr.seats === 3, 'crea, mueve y edita una mesa');
const { rb } = await one(`select public.save_reservation($1, null, jsonb_build_object('customer_name','Barra','starts_at', now() + interval '1 day', 'people', 2, 'table_id', $2::text), '[]') rb`, [rid, tb]);
ok((await fails(() => db.query(`delete from dining_tables where id=$1`, [tb])))?.includes('reservas próximas'), 'no deja borrar una mesa con reservas próximas');
await db.query(`update reservations set status='cancelada' where id=$1`, [rb]);
await db.query(`delete from dining_tables where id=$1`, [tb]);
await db.query(`delete from zones where id=$1`, [zb]);
ok((await one(`select count(*)::int n from zones where id=$1`, [zb])).n === 0, 'borra la mesa sin reservas y luego su zona vacía');
const { rid2 } = await one(`select public.create_restaurant('Sin ejemplo', false) rid2`);
const z2 = (await db.query(`select name from zones where restaurant_id=$1`, [rid2])).rows.map((r) => r.name);
await db.query(`insert into dining_tables (restaurant_id, name, seats) values ($1, 'M1', 4)`, [rid2]);
ok(z2.join(',') === 'Salón', 'un restaurante sin ejemplo arranca con la zona Salón y acepta mesas');

console.log('\nReservas en línea con anticipo');
await as(A);
const slugRow = await one(`select slug from restaurants where id=$1`, [rid]);
ok(slugRow.slug === 'fogon-38', `el restaurante recibe su dirección pública (${slugRow.slug})`);
await as(null);
ok((await one(`select public.public_restaurant('fogon-38') r`)).r === null, 'sin activar, la página pública no muestra el restaurante');
await as(A);
await db.query(`update restaurants set booking_enabled = true, bank_details = 'Bancolombia ahorros 123', whatsapp_phone = '3001112233' where id=$1`, [rid]);
await as(null);
const pub = (await one(`select public.public_restaurant('FOGON-38') r`)).r;
ok(pub?.name === 'Fogón 38' && Number(pub.deposit_amount) === 50000 && pub.open_time === '18:00', 'la página pública muestra nombre, horario y anticipo');
const day = `((now() at time zone 'America/Bogota')::date + 5)`;
const slots = (await db.query(`select slot from public.public_slots('fogon-38', ${day}, 4)`)).rows.map((r) => r.slot);
ok(slots.length === 9 && slots[0] === '18:00' && slots.at(-1) === '22:00', `horarios de cena cada 30 min (${slots.join(' ')})`);
ok((await db.query(`select slot from public.public_slots('fogon-38', ${day}, 40)`)).rows.length === 0, 'no ofrece horarios para grupos más grandes que el máximo en línea');
const book = (extra) => one(`select public.public_book('fogon-38', $1::jsonb) b`,
  [JSON.stringify({ customer_name: 'Cliente Web', phone: '310 555 0101', people: 2, date: null, time: '20:00', ...extra })]);
const dayStr = (await one(`select ${day}::text d`)).d;
const b1 = (await book({ date: dayStr })).b;
ok(!!b1?.token && Number(b1.code) > 0, `un visitante sin sesión puede reservar (R-${b1?.code})`);
await asService();
const w1 = await one(`select status, source, deposit_status, hold_expires_at > now() h, table_id is not null t,
  (select count(*)::int from reminders where reservation_id = reservations.id and status='programado') rem from reservations where public_token=$1`, [b1.token]);
ok(w1.status === 'pendiente' && w1.source === 'web' && w1.deposit_status === 'esperando' && w1.h && w1.t, 'queda pendiente, con mesa apartada, esperando el anticipo');
await as(null);
const msg = async (extra) => fails(() => book({ date: dayStr, ...extra }));
ok((await msg({ time: '18:10' }))?.includes('no está disponible'), 'rechaza horas fuera de la lista');
ok((await msg({ time: '23:30' }))?.includes('no está disponible'), 'rechaza horas después de la última reserva');
ok((await msg({ people: 30 }))?.includes('WhatsApp'), 'grupos grandes: pide escribir por WhatsApp');
ok((await msg({ phone: '123' }))?.includes('celular'), 'valida el celular');
ok((await msg({ website: 'http://spam' }))?.includes('No se pudo'), 'el campo trampa bloquea robots');
await book({ date: dayStr, time: '18:30' });
ok((await msg({ time: '19:00' }))?.includes('esperando el anticipo'), 'máximo 2 reservas esperando anticipo por celular');
const st = (await one(`select public.public_reservation($1) r`, [b1.token])).r;
ok(st?.deposit_status === 'esperando' && st.restaurant.bank_details.includes('Bancolombia') && st.time === '20:00', 'el cliente ve su estado y los datos para transferir');
ok(!!(await fails(() => db.query(`select public.expire_holds()`))), 'un visitante no puede ejecutar el vencimiento');
ok((await one(`select public.receipt_allowed($1) ok`, [`${b1.token}/comprobante.jpg`])).ok === true, 'puede subir comprobante con su enlace');
ok((await one(`select public.receipt_allowed($1) ok`, [`00000000-0000-0000-0000-000000000000/x.jpg`])).ok === false, 'no puede subir comprobantes a una reserva ajena');
await db.query(`select public.public_receipt_uploaded($1, $2)`, [b1.token, `${b1.token}/comprobante.jpg`]);
ok((await one(`select public.public_reservation($1) r`, [b1.token])).r.deposit_status === 'comprobante', 'al subir el comprobante queda por revisar');
await asService();
await db.query(`update reservations set hold_expires_at = now() - interval '1 minute' where public_token=$1 or (source='web' and deposit_status='esperando')`, [b1.token]);
await db.exec('reset role');
const nExp = (await one(`select public.expire_holds() n`)).n;
const after1 = await one(`select status, deposit_status from reservations where public_token=$1`, [b1.token]);
const expd = await one(`select count(*)::int n from reservations where source='web' and deposit_status='vencido' and status='cancelada'`);
ok(nExp === 1 && expd.n === 1 && after1.status === 'pendiente', 'vence solo la que no mandó comprobante; la que lo mandó espera tu revisión');

console.log('\nAnticipo en efectivo');
await as(null);
const dayCash = (await one(`select ((now() at time zone 'America/Bogota')::date + 6)::text d`)).d;
const bookCash = (extra) => one(`select public.public_book('fogon-38', $1::jsonb) b`,
  [JSON.stringify({ customer_name: 'Pago Efectivo', phone: '311 222 3344', people: 2, date: dayCash, time: '19:00', method: 'efectivo', ...extra })]);
const c1 = (await bookCash({})).b;
await asService();
const cr = await one(`select deposit_status, deposit_method, round(extract(epoch from hold_expires_at - now()) / 3600) horas from reservations where public_token=$1`, [c1.token]);
ok(cr.deposit_status === 'esperando' && cr.deposit_method === 'efectivo' && Number(cr.horas) === 12, `reserva en línea con efectivo: espera el pago ${cr.horas} horas`);
await as(null);
ok((await one(`select public.public_reservation($1) r`, [c1.token])).r.deposit_method === 'efectivo', 'el cliente ve que eligió efectivo');
const soonCash = await fails(() => one(`select public.public_book('fogon-38', $1::jsonb) b`, [JSON.stringify({
  customer_name: 'Muy Pronto', phone: '312 000 1111', people: 2, method: 'efectivo',
  date: null, time: null })]));
ok(!!soonCash, 'valida la reserva en efectivo como cualquier otra');
await db.query(`select public.public_receipt_uploaded($1, $2)`, [c1.token, `${c1.token}/x.jpg`]);
ok((await one(`select public.public_reservation($1) r`, [c1.token])).r.deposit_method === 'transferencia', 'si sube comprobante, pasa a transferencia');
await as(A);
await db.query(`update restaurants set accept_cash = false where id=$1`, [rid]);
await as(null);
ok((await fails(() => bookCash({ phone: '313 444 5566', time: '20:00' })))?.includes('cómo vas a pagar'), 'si apagas el efectivo, no se puede elegir');
await as(A);
await db.query(`update restaurants set accept_cash = true where id=$1`, [rid]);
const { cashApp } = await one(`select public.save_reservation($1, null, jsonb_build_object('customer_name','Mostrador','phone','3001110000',
  'starts_at', now() + interval '5 days', 'people', 2, 'deposit', 50000, 'deposit_method', 'efectivo'), '[]') "cashApp"`, [rid]);
const ca = await one(`select deposit_status, deposit_method, deposit::int d from reservations where id=$1`, [cashApp]);
ok(ca.deposit_status === 'pagado' && ca.deposit_method === 'efectivo' && ca.d === 50000, 'reserva hecha en la app con anticipo en efectivo queda pagada');
await db.query(`select public.save_reservation($1, $2, jsonb_build_object('customer_name','Mostrador','phone','3001110000',
  'starts_at', now() + interval '5 days', 'people', 2, 'deposit', 0), '[]')`, [rid, cashApp]);
ok((await one(`select deposit_status from reservations where id=$1`, [cashApp])).deposit_status === 'no_aplica', 'si quitas el anticipo, deja de figurar como pagado');

console.log('\nEl cliente escoge su mesa');
await as(null);
const dayT = (await one(`select ((now() at time zone 'America/Bogota')::date + 9)::text d`)).d;
const floor = (await one(`select public.public_floor('fogon-38', $1::date, '20:00', 2) f`, [dayT])).f;
ok(floor && floor.zones.length >= 1 && floor.tables.length >= 10, `el plano público trae zonas y mesas (${floor?.tables.length} mesas)`);
ok(!JSON.stringify(floor).includes('customer'), 'el plano no dice quién tiene cada mesa');
const two = floor.tables.find((t) => t.seats === 2 && t.free);
const big = floor.tables.find((t) => t.seats >= 8);
ok(two.fits === true && big.fits === false, 'para 2 personas sirven mesas pequeñas; la grande no');
const bookT = (extra) => one(`select public.public_book('fogon-38', $1::jsonb) b`,
  [JSON.stringify({ customer_name: 'Escoge Mesa', phone: '314 999 0001', people: 2, date: dayT, time: '20:00', ...extra })]);
const tb1 = (await bookT({ table_id: two.id })).b;
const myRes = (await one(`select public.public_reservation($1) r`, [tb1.token])).r;
ok(myRes.table_name === two.name, `reserva con la mesa que escogió (${two.name})`);
const floor2 = (await one(`select public.public_floor('fogon-38', $1::date, '20:30', 2) f`, [dayT])).f;
ok(floor2.tables.find((t) => t.id === two.id).free === false, 'esa mesa aparece ocupada para otros a esa hora');
ok((await fails(() => bookT({ table_id: two.id, phone: '314 999 0002' })))?.includes('acaba de ocuparse'), 'si otro intenta la misma mesa, le pide elegir otra');
ok((await fails(() => bookT({ table_id: big.id, phone: '314 999 0003' })))?.includes('no está disponible para 2'), 'no deja apartar una mesa muy grande para el grupo');
ok((await fails(() => bookT({ table_id: '00000000-0000-0000-0000-000000000000', phone: '314 999 0004' })))?.includes('no está disponible'), 'no acepta mesas de otro restaurante o inexistentes');

console.log('\nPlano ilustrado');
await as(A);
const terr = await one(`select floor from zones where restaurant_id=$1 and name ilike 'terraza%'`, [rid]);
ok(terr.floor === 'baldosa', 'la terraza arranca con piso de baldosa');
const { bar } = await one(`insert into floor_items (restaurant_id, kind, label, x, y, w, h) values ($1, 'barra', 'Barra', 30, 6, 40, 6) returning id bar`, [rid]);
await db.query(`update floor_items set rotation = 90, x = 50 where id=$1`, [bar]);
await db.query(`update floor_items set rotation = 45 where id=$1`, [bar]);
ok((await fails(() => db.query(`update floor_items set rotation = 360 where id=$1`, [bar]))) !== null, 'el giro va de 0 a 359 grados');
await db.query(`update floor_items set rotation = 90 where id=$1`, [bar]);
const tGiro = await one(`select id from dining_tables where restaurant_id=$1 order by name limit 1`, [rid]);
await db.query(`update dining_tables set w = 12.5, h = 30, rotation = 45 where id=$1`, [tGiro.id]);
ok(!!(await fails(() => db.query(`update dining_tables set w = 1 where id=$1`, [tGiro.id]))), 'una mesa no puede ser diminuta');
await db.query(`update zones set rotation = 15 where restaurant_id=$1`, [rid]);
await db.query(`update restaurants set plan_bg_url = 'https://x/plano.webp' where id=$1`, [rid]);
await as(B);
ok((await one(`select count(*)::int n from floor_items`)).n === 0, 'otro usuario no ve los elementos del plano');
ok(!!(await fails(() => db.query(`insert into floor_items (restaurant_id, kind) values ($1, 'planta')`, [rid]))), 'otro usuario no puede agregar elementos');
await as(null);
const fl = (await one(`select public.public_floor('fogon-38', ((now() at time zone 'America/Bogota')::date + 9), '20:00', 2) f`)).f;
ok(fl.items.length === 1 && fl.items[0].rotation === 90 && fl.bg === 'https://x/plano.webp' && fl.zones.every((z) => z.floor),
  'el plano público trae pisos, elementos y fondo');
const flT = fl.tables.find((t) => t.id === tGiro.id);
ok(Number(flT.w) === 12.5 && Number(flT.h) === 30 && flT.rotation === 45 && fl.zones.every((z) => z.rotation === 15),
  'el plano público trae el tamaño y el giro de mesas y zonas');
await as(A);
await db.query(`delete from floor_items where id=$1`, [bar]);
ok((await one(`select count(*)::int n from floor_items where id=$1`, [bar])).n === 0, 'borra un elemento del plano');

console.log('\nCarta en línea');
await as(A);
const menuDish = await one(`select id from dishes where restaurant_id=$1 and name='Bandeja paisa'`, [rid]);
await db.query(`select public.save_dish($1, $2, jsonb_build_object('name','Bandeja paisa','category','Plato fuerte','price',38000,'active',true,
  'description','Fríjoles, arroz, carne molida, chicharrón, chorizo, huevo, maduro, aguacate y arepa.'),
  (select jsonb_agg(jsonb_build_object('ingredient_id', ingredient_id::text, 'qty', qty)) from recipe_items where dish_id=$2))`, [rid, menuDish.id]);
const offDish = await one(`select id from dishes where restaurant_id=$1 and name='Cuajada con melao'`, [rid]);
await db.query(`update dishes set active = false where id=$1`, [offDish.id]);
await as(null);
const carta = (await one(`select public.public_menu('fogon-38') m`)).m;
const bandejaPub = carta.find((d) => d.name === 'Bandeja paisa');
ok(carta.length >= 6 && bandejaPub?.description.startsWith('Fríjoles'), `la carta pública muestra los platos con su descripción (${carta.length})`);
ok(!carta.some((d) => d.name === 'Cuajada con melao'), 'un plato no disponible no sale en la carta');
ok(!JSON.stringify(carta).match(/recipe|cost|ingredient/), 'la carta no muestra costos ni recetas');
const dayM = (await one(`select ((now() at time zone 'America/Bogota')::date + 11)::text d`)).d;
const limo = carta.find((d) => d.name === 'Limonada de coco');
const bm = (await one(`select public.public_book('fogon-38', $1::jsonb) b`, [JSON.stringify({
  customer_name: 'Pide Carta', phone: '315 777 0001', people: 2, date: dayM, time: '19:30',
  items: [{ dish_id: bandejaPub.id, qty: 2 }, { dish_id: limo.id, qty: 1 }, { dish_id: limo.id, qty: 1 },
          { dish_id: offDish.id, qty: 3 }, { dish_id: bandejaPub.id, qty: 'x' }, { dish_id: limo.id, qty: -4 }],
})])).b;
ok(bm.items === 2, 'reserva con pedido: suma repetidos e ignora no disponibles o cantidades inválidas');
const pm = (await one(`select public.public_reservation($1) r`, [bm.token])).r;
const tot = pm.items.reduce((a, i) => a + i.qty * Number(i.unit_price), 0);
ok(pm.items.length === 2 && tot === 2 * 38000 + 2 * 12000, `el cliente ve su pedido y el total (${tot})`);
const bigQty = (await one(`select public.public_book('fogon-38', $1::jsonb) b`, [JSON.stringify({
  customer_name: 'Mucho', phone: '315 777 0002', people: 2, date: dayM, time: '21:00', items: [{ dish_id: limo.id, qty: 900 }] })])).b;
ok((await one(`select public.public_reservation($1) r`, [bigQty.token])).r.items[0].qty === 50, 'limita a 50 unidades por plato');
await as(A);
await db.query(`update dishes set active = true where id=$1`, [offDish.id]);

console.log('\nLogo y foto');
await as(A);
await db.query(`update restaurants set logo_url = 'https://x/logo.webp', cover_url = 'https://x/foto.webp' where id=$1`, [rid]);
ok((await one(`select public.brand_member($1) ok`, [`${rid}/logo.webp`])).ok === true, 'el dueño puede subir imágenes a la carpeta de su restaurante');
ok((await one(`select public.brand_member('no-es-un-id/logo.webp') ok`)).ok === false, 'una ruta inválida no da permiso (sin error)');
await as(B);
ok((await one(`select public.brand_member($1) ok`, [`${rid}/logo.webp`])).ok === false, 'otro usuario no puede subir imágenes a ese restaurante');
await as(null);
const pubLogo = (await one(`select public.public_restaurant('fogon-38') r`)).r;
ok(pubLogo?.logo_url === 'https://x/logo.webp' && pubLogo.cover_url === 'https://x/foto.webp', 'la página pública muestra el logo y la foto');
ok(!!(await fails(() => db.query(`select public.brand_member('x/y')`))), 'un visitante no puede usar la función de permisos');

console.log('\nSeguridad entre restaurantes');
await as(B);
const seen = await one(`select (select count(*) from reservations)::int r, (select count(*) from ingredients)::int i, (select count(*) from restaurants)::int s`);
ok(seen.r === 0 && seen.i === 0 && seen.s === 0, 'otro usuario no ve nada del restaurante');
ok(!!(await fails(() => db.query(`select public.save_reservation($1, null, jsonb_build_object('customer_name','X','starts_at', now() + interval '1 day','people',2), '[]')`, [rid]))),
  'otro usuario no puede crear reservas en ese restaurante');
ok(!!(await fails(() => db.query(`insert into ingredients (restaurant_id, name, unit) values ($1, 'Intruso', 'kg')`, [rid]))),
  'otro usuario no puede insertar insumos en ese restaurante');
await as(null);
ok((await one(`select count(*)::int n from reservations`)).n === 0, 'un visitante sin sesión no ve reservas');

console.log(failures ? `\n${failures} prueba(s) fallaron` : '\nTodas las pruebas pasaron');
process.exit(failures ? 1 : 0);
