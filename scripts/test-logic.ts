// Pruebas de la lógica pura. Corre con: npm run test:logic
import { strict as assert } from 'node:assert';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { addDays, localParts, quote, shopping, zonedToUtc } from '../src/lib/calc.ts';
import type { Dish, Ingredient, Reservation } from '../src/lib/types.ts';
import { intentOf, toWhatsAppNumber, verifySignature } from '../src/lib/whatsapp.ts';

test('fechas en la zona del restaurante (Bogotá, UTC−5)', () => {
  assert.equal(zonedToUtc('2026-10-24', '19:30', 'America/Bogota'), '2026-10-25T00:30:00.000Z');
  assert.deepEqual(localParts('2026-10-25T00:30:00.000Z', 'America/Bogota'), { date: '2026-10-24', time: '19:30' });
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('fechas con cambio de horario (Madrid)', () => {
  const iso = zonedToUtc('2026-03-29', '20:00', 'Europe/Madrid');
  assert.deepEqual(localParts(iso, 'Europe/Madrid'), { date: '2026-03-29', time: '20:00' });
});

const ing: Ingredient[] = [
  { id: 'pollo', name: 'Pollo', unit: 'kg', price: 14000, supplier: 'Carnes', stock: 0.5, min_stock: 1 },
  { id: 'arroz', name: 'Arroz', unit: 'kg', price: 4000, supplier: 'Plaza', stock: 10, min_stock: 1 },
];
const dish: Dish = { id: 'ajiaco', name: 'Ajiaco', category: '', price: 32000, active: true, sort: 1, description: '', photo_url: '',
  recipe: [{ ingredient_id: 'pollo', qty: 0.2 }, { ingredient_id: 'arroz', qty: 0.1 }] };
const ingMap = new Map(ing.map((i) => [i.id, i]));
const dishMap = new Map([[dish.id, dish]]);
const res = (over: Partial<Reservation>): Reservation => ({
  id: 'r', code: 1001, customer_name: 'Ana', phone: '', starts_at: '', ends_at: '', duration_min: 120, people: 4, table_id: null,
  occasion: '', allergies: '', notes: '', deposit: 0, status: 'pendiente', confirmed_via: null, reminders: [],
  source: 'app', email: '', deposit_status: 'no_aplica', deposit_method: null, hold_expires_at: null, receipt_path: null,
  items: [{ dish_id: 'ajiaco', qty: 4, unit_price: 30000 }], date: '2026-10-25', time: '13:00', ...over,
});

test('presupuesto usa el precio congelado y descuenta el anticipo', () => {
  const q = quote(res({ deposit: 50000 }), dishMap, ingMap, { inc_rate: 0.08, tip_rate: 0.1 });
  assert.equal(q.sub, 120000);
  assert.equal(q.cost, 4 * (0.2 * 14000 + 0.1 * 4000));
  assert.equal(Math.round(q.total), 129600);
  assert.equal(Math.round(q.due), 79600);
});

test('lista de compras: necesidad + merma + mínimo − stock, redondeada a 50 g', () => {
  const { rows } = shopping([res({}), res({ id: 'x', status: 'cancelada' })], dishMap, ing, '2026-10-24', 7, 0.1, true);
  assert.equal(rows.length, 1);
  // pollo: 0,8 kg × 1,1 + 1 kg mínimo − 0,5 kg en stock = 1,38 → 1,4 kg
  assert.equal(rows[0].ing.id, 'pollo');
  assert.equal(rows[0].buy, 1.4);
});

test('respuestas de WhatsApp', () => {
  for (const t of ['Sí', 'si', 'SI!', 'Confirmo', 'confirmado', 'ok', 'Dale']) assert.equal(intentOf(t), 'confirm', t);
  for (const t of ['No', 'no puedo', 'Cancelar', 'cancelo']) assert.equal(intentOf(t), 'cancel', t);
  for (const t of ['Hola', '¿A qué hora abren?', 'sinceramente no sé', 'nosotros llegamos tarde']) assert.equal(intentOf(t), null, t);
});

test('números de WhatsApp', () => {
  assert.equal(toWhatsAppNumber('300 123 4567'), '573001234567');
  assert.equal(toWhatsAppNumber('+57 300 123 4567'), '573001234567');
  assert.equal(toWhatsAppNumber('12345'), null);
});

test('el botón de borrar no envía el formulario (no debe guardar en vez de borrar)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/components/ui.tsx', import.meta.url), 'utf8');
  const confirm = src.slice(src.indexOf('export function ConfirmButton'));
  assert.match(confirm.slice(0, confirm.indexOf('className={className}')), /type="button"/);
});

test('firma del webhook de Meta', () => {
  const body = '{"entry":[]}';
  const sig = 'sha256=' + createHmac('sha256', 's3cr3t').update(body).digest('hex');
  assert.equal(verifySignature(body, sig, 's3cr3t'), true);
  assert.equal(verifySignature(body + ' ', sig, 's3cr3t'), false);
  assert.equal(verifySignature(body, null, 's3cr3t'), false);
});

test('plano: cambiar tamaño de algo girado deja fija la esquina opuesta', async () => {
  const { resizeFromCorner, cornerOf, angleTo, tableSize, scaleBox, PLAN_RATIO } = await import('../src/lib/floor.ts');
  const lim = { minW: 3, minH: 3, maxW: 60, maxH: 90 };
  // Sin giro: crecer 4 % a la derecha mueve el centro 2 %.
  assert.deepEqual(resizeFromCorner({ cx: 50, cy: 50, w: 10, h: 20, rotation: 0 }, 4, 0, lim), { cx: 52, cy: 50, w: 14, h: 20, rotation: 0 });
  // Girada 90°: la esquina superior izquierda (la opuesta al asa) no se mueve.
  const c = { cx: 50, cy: 50, w: 10, h: 20, rotation: 90 };
  const before = cornerOf(c);
  const after = resizeFromCorner(c, -3, 5, lim);
  const k = cornerOf(after);
  assert.ok(Math.abs(k.x - before.x) < 0.05 && Math.abs(k.y - before.y) < 0.05, `esquina fija ${JSON.stringify([before, k])}`);
  assert.ok(after.w > c.w && after.h > c.h);
  // Límites y círculo.
  assert.equal(resizeFromCorner(c, -50, -50, lim).w, 3);
  const sq = resizeFromCorner({ cx: 50, cy: 50, w: 10, h: 10 / PLAN_RATIO, rotation: 0 }, 2, 0, { ...lim, square: true });
  assert.ok(Math.abs(sq.w - sq.h * PLAN_RATIO) < 0.02, 'una mesa redonda sigue siendo círculo');
  assert.deepEqual(scaleBox({ cx: 50, cy: 50, w: 10, h: 20, rotation: 0 }, 10, lim), { cx: 50, cy: 50, w: 45, h: 90, rotation: 0 });
  // El asa de giro va arriba: el dedo a la derecha del centro es 90°.
  assert.equal(angleTo(0, -100), 0);
  assert.equal(angleTo(100, 0), 90);
  assert.equal(angleTo(-100, 2), 270);
  assert.equal(angleTo(100, 100, 1), 135);
  // Tamaño automático de las mesas.
  assert.deepEqual(tableSize({ shape: 'auto', seats: 6 }), { w: 14, h: 22 });
  assert.deepEqual(tableSize({ shape: 'rect', seats: 6, w: 9, h: 40 }), { w: 9, h: 40 });
  assert.equal(tableSize({ shape: 'round', seats: 4, w: 10 }).h, 16);
});

test('plano público: muestra solo la parte con algo dibujado', async () => {
  const { viewBox, boundsOf } = await import('../src/lib/floor.ts');
  // Una zona angosta y alta (como un salón largo): se recorta a lo ancho, sin pasar de 1,5 veces más alto que ancho.
  const v = viewBox([{ cx: 37.5, cy: 50, w: 25, h: 90, rotation: 0 }]);
  assert.ok(v.w < 60 && v.h > 90, JSON.stringify(v));
  assert.ok((v.h * 10) / (v.w * 16) <= 1.5 + 1e-6);
  assert.ok(v.x <= 22 && v.x + v.w >= 53);
  assert.deepEqual(viewBox([]), { x: 0, y: 0, w: 100, h: 100 });
  // Girar 90° una caja ancha la vuelve alta.
  const b = boundsOf({ cx: 50, cy: 50, w: 20, h: 4, rotation: 90 });
  assert.ok(Math.abs(b.x1 - b.x0 - 4 * 0.625) < 0.01 && Math.abs(b.y1 - b.y0 - 20 / 0.625) < 0.01);
});

test('horas de 12 horas para mostrar', async () => {
  const { hora } = await import('../src/lib/calc.ts');
  assert.equal(hora('19:30'), '7:30 pm');
  assert.equal(hora('18:00'), '6:00 pm');
  assert.equal(hora('23:00'), '11:00 pm');
  assert.equal(hora('12:15'), '12:15 pm');
  assert.equal(hora('00:05'), '12:05 am');
  assert.equal(hora('09:00:00'), '9:00 am');
  assert.equal(hora(''), '');
});
