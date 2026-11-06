// Cálculos del negocio: fechas en la zona del restaurante, presupuestos y compras.
import type { Dish, Ingredient, Reservation, Restaurant, Unit } from './types.ts';

/** Convierte la fila de Supabase (numeric como texto, time como "18:00:00") al tipo de la app. */
export function normalizeRestaurant(raw: Record<string, unknown>): Restaurant {
  const r = raw as unknown as Restaurant;
  const hhmm = (v: unknown, d: string) => (typeof v === 'string' && v.length >= 5 ? v.slice(0, 5) : d);
  return {
    ...r,
    inc_rate: Number(r.inc_rate), tip_rate: Number(r.tip_rate), shop_merma: Number(r.shop_merma),
    deposit_amount: Number(r.deposit_amount ?? 50000), hold_minutes: Number(r.hold_minutes ?? 60),
    slot_minutes: Number(r.slot_minutes ?? 30), max_online_people: Number(r.max_online_people ?? 12),
    min_advance_hours: Number(r.min_advance_hours ?? 2),
    open_time: hhmm(r.open_time, '18:00'), last_booking_time: hhmm(r.last_booking_time, '22:00'),
    slug: r.slug ?? '', bank_details: r.bank_details ?? '', whatsapp_phone: r.whatsapp_phone ?? '', booking_policy: r.booking_policy ?? '',
    logo_url: r.logo_url ?? '', cover_url: r.cover_url ?? '', pay_qr_url: r.pay_qr_url ?? '',
    accept_cash: r.accept_cash ?? true, cash_hold_hours: Number(r.cash_hold_hours ?? 12), cash_instructions: r.cash_instructions ?? '',
    plan_bg_url: r.plan_bg_url ?? '',
  };
}

/** Turnos de reserva según el horario del restaurante (por defecto, cena de 18:00 a 22:00). */
export function slotsFor(r: { open_time?: string; last_booking_time?: string; slot_minutes?: number }) {
  const start = toMin(r.open_time || '18:00');
  const end = toMin(r.last_booking_time || '22:00');
  const step = r.slot_minutes || 30;
  const out: string[] = [];
  for (let m = start; m <= end && m < 24 * 60; m += step) out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  return out;
}
export const METHOD_LABEL = { transferencia: 'transferencia', efectivo: 'efectivo' } as const;

/** Etiqueta del anticipo con su método, p. ej. "Anticipo pagado · efectivo". */
export function depositLabel(status: keyof typeof DEPOSIT_LABEL, method: 'transferencia' | 'efectivo' | null) {
  if (status === 'esperando' && method === 'efectivo') return 'Esperando anticipo en efectivo';
  if (status === 'pagado' && method) return `Anticipo pagado · ${METHOD_LABEL[method]}`;
  return DEPOSIT_LABEL[status];
}

export const DEPOSIT_LABEL = {
  no_aplica: '', esperando: 'Esperando anticipo', comprobante: 'Comprobante por revisar',
  pagado: 'Anticipo pagado', vencido: 'Anticipo vencido', rechazado: 'Anticipo rechazado',
} as const;
export const OCCASIONS = ['', 'Almuerzo familiar', 'Cumpleaños', 'Aniversario', 'Negocios', 'Evento empresarial', 'Primera cita', 'Despedida'];
export const STATUS_LABEL = { pendiente: 'Pendiente', confirmada: 'Confirmada', atendida: 'Atendida', cancelada: 'Cancelada' } as const;
export const REMINDER_LABEL = { '24h': '24 h antes', '2h': '2 h antes' } as const;

const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const DAYS_L = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
export const money = (n: number) => COP.format(Math.round(n || 0));
export const pct = (n: number) => `${Math.round(n * 100)} %`;
const pad = (n: number) => String(n).padStart(2, '0');

/* ---------- fechas ---------- */

function partsIn(ts: number, tz: string) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

/** Fecha (YYYY-MM-DD) y hora (HH:MM) de un instante en la zona del restaurante. */
export function localParts(iso: string, tz: string) {
  const p = partsIn(new Date(iso).getTime(), tz);
  return { date: `${p.y}-${pad(p.m)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}

/** Convierte fecha y hora locales del restaurante a un instante ISO (UTC). */
export function zonedToUtc(date: string, time: string, tz: string) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const offset = (ts: number) => {
    const p = partsIn(ts, tz);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ts / 1000) * 1000;
  };
  let t = guess - offset(guess);
  const second = offset(t);
  if (second !== offset(guess)) t = guess - second;
  return new Date(t).toISOString();
}

export const todayIn = (tz: string) => localParts(new Date().toISOString(), tz).date;
export function addDays(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
}
const dateOf = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
export const weekday = (iso: string) => DAYS[dateOf(iso).getUTCDay()];
export const dayNum = (iso: string) => dateOf(iso).getUTCDate();
export const fmtDay = (iso: string) => {
  const d = dateOf(iso);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
export const fmtLong = (iso: string) => {
  const d = dateOf(iso);
  return `${DAYS_L[d.getUTCDay()]} ${d.getUTCDate()} de ${MONTHS_L[d.getUTCMonth()]}`;
};
/** "19:30" → "7:30 pm": la hora de 12 horas, como se lee en Colombia. Los datos siguen guardados en 24 h. */
export const hora = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
};

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
export function relTime(ms: number) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? 'día' : 'días'}`;
}

/* ---------- cantidades ---------- */

export function qf(q: number, unit: Unit) {
  if (unit === 'und') return `${Math.round(q * 10) / 10} und`;
  if (q < 1) return `${Math.round(q * 1000)} ${unit === 'kg' ? 'g' : 'ml'}`;
  return `${(Math.round(q * 100) / 100).toLocaleString('es-CO')} ${unit}`;
}
/** En las recetas se escribe en gramos/mililitros; en inventario y compras, en kg/l. */
export const smallUnit = (unit: Unit) => (unit === 'kg' ? 'g' : unit === 'l' ? 'ml' : 'und');
export const toSmall = (q: number, unit: Unit) => (unit === 'und' ? q : Math.round(q * 1000 * 100) / 100);
export const fromSmall = (q: number, unit: Unit) => (unit === 'und' ? q : q / 1000);
export const UNIT_LABEL = { kg: 'kilogramo (kg)', l: 'litro (l)', und: 'unidad (und)' } as const;

function roundBuy(q: number, unit: Unit) {
  if (q <= 1e-9) return 0;
  return unit === 'und' ? Math.ceil(q - 1e-9) : Math.ceil(q * 20 - 1e-9) / 20;
}

/* ---------- costos y presupuesto ---------- */

export function dishCost(d: Dish, ing: Map<string, Ingredient>) {
  return d.recipe.reduce((s, r) => s + r.qty * (ing.get(r.ingredient_id)?.price ?? 0), 0);
}
export const fcClass = (fc: number) => (fc < 0.3 ? 'ok' : fc < 0.36 ? 'warn' : 'bad');

export interface Quote {
  lines: { dish: Dish; qty: number; unit_price: number; total: number; cost: number }[];
  sub: number; cost: number; inc: number; total: number; tip: number; margin: number; fc: number; due: number;
}

export function quote(
  r: Pick<Reservation, 'items' | 'deposit'>,
  dishes: Map<string, Dish>, ing: Map<string, Ingredient>, rest: Pick<Restaurant, 'inc_rate' | 'tip_rate'>,
): Quote {
  const lines = r.items.flatMap((it) => {
    const dish = dishes.get(it.dish_id);
    if (!dish) return [];
    return [{ dish, qty: it.qty, unit_price: it.unit_price, total: it.qty * it.unit_price, cost: it.qty * dishCost(dish, ing) }];
  });
  const sub = lines.reduce((s, l) => s + l.total, 0);
  const cost = lines.reduce((s, l) => s + l.cost, 0);
  const inc = sub * rest.inc_rate;
  return {
    lines, sub, cost, inc, total: sub + inc, tip: sub * rest.tip_rate, margin: sub - cost,
    fc: sub ? cost / sub : 0, due: Math.max(0, sub + inc - (r.deposit || 0)),
  };
}

/* ---------- compras ---------- */

export interface ShopRow { ing: Ingredient; need: number; buy: number; est: number }

export function shopping(
  reservations: Reservation[], dishes: Map<string, Dish>, ingredients: Ingredient[],
  from: string, days: number, merma: number, keepMin: boolean,
) {
  const to = addDays(from, days);
  const resIn = reservations.filter((r) => r.status !== 'cancelada' && r.status !== 'atendida' && r.date >= from && r.date < to);
  const need = new Map<string, number>();
  for (const r of resIn) {
    for (const it of r.items) {
      const d = dishes.get(it.dish_id);
      if (!d) continue;
      for (const line of d.recipe) need.set(line.ingredient_id, (need.get(line.ingredient_id) ?? 0) + it.qty * line.qty);
    }
  }
  const rows: ShopRow[] = ingredients
    .map((ing) => {
      const n = need.get(ing.id) ?? 0;
      const target = n * (1 + merma) + (keepMin ? ing.min_stock : 0);
      const buy = roundBuy(Math.max(0, target - ing.stock), ing.unit);
      return { ing, need: n, buy, est: buy * ing.price };
    })
    .filter((x) => x.buy > 0);
  return { rows, resIn, total: rows.reduce((s, x) => s + x.est, 0) };
}

/* ---------- WhatsApp ---------- */

export function reminderText(r: Reservation, restaurantName: string, today: string, tableName?: string) {
  const when = r.date === today ? 'hoy' : r.date === addDays(today, 1) ? 'mañana' : `el ${fmtLong(r.date)}`;
  return `Hola ${r.customer_name}, te escribimos de ${restaurantName}. Te esperamos ${when} a las ${hora(r.time)} para ${r.people} ${r.people === 1 ? 'persona' : 'personas'}${tableName ? ` (mesa ${tableName})` : ''}. ¿Nos confirmas tu asistencia? Responde SÍ para confirmar o NO si necesitas cancelar.`;
}

export function waLink(phone: string, text: string, countryCode = '57') {
  const p = phone.replace(/\D/g, '');
  const n = p.length === 10 ? countryCode + p : p;
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}
