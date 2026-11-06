// Tamaño, forma y geometría de las cosas del plano (compartido por el salón de la app y la página pública).
import type { TableShape } from './types.ts';

const WIDTH: Record<number, number> = { 2: 8.5, 4: 10.5, 6: 14, 8: 17, 16: 24 };

/** El plano es 16:10: 1 % del alto mide lo mismo que 0,625 % del ancho. */
export const PLAN_RATIO = 10 / 16;

/** Ancho automático de la mesa en % del plano según sus puestos. */
export const widthFor = (seats: number) => WIDTH[seats] ?? Math.min(26, 6 + seats * 1.2);

/** "auto": redonda hasta 4 puestos, rectangular desde 5. */
export const shapeOf = (t: { shape: TableShape; seats: number }) => (t.shape === 'auto' ? (t.seats <= 4 ? 'round' : 'rect') : t.shape);

/** Tamaño de la mesa: w en % del ancho y h en % del alto. 0 = automático. Las redondas siempre son círculos. */
export function tableSize(t: { shape: TableShape; seats: number; w?: number; h?: number }) {
  const w = t.w || widthFor(t.seats);
  return { w, h: shapeOf(t) === 'round' ? w / PLAN_RATIO : t.h || 22 };
}

/** Caja por su centro, en % del plano, girada `rotation` grados. */
export interface Centered { cx: number; cy: number; w: number; h: number; rotation: number }

const rad = (deg: number) => (deg * Math.PI) / 180;
const r2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Ángulo entre 0 y 359. */
export const normDeg = (deg: number) => ((Math.round(deg) % 360) + 360) % 360;

export interface SizeLimits { minW: number; minH: number; maxW: number; maxH: number; square?: boolean }

/**
 * Cambia el tamaño arrastrando la esquina inferior derecha (dx, dy en % del plano).
 * Respeta el giro: la esquina opuesta queda fija en su lugar.
 */
export function resizeFromCorner(c: Centered, dx: number, dy: number, lim: SizeLimits): Centered {
  // Se trabaja en unidades iguales en los dos ejes (% del ancho).
  const a = rad(c.rotation);
  const ux = dx, uy = dy * PLAN_RATIO;
  const lx = ux * Math.cos(a) + uy * Math.sin(a);
  const ly = -ux * Math.sin(a) + uy * Math.cos(a);
  const w0 = c.w, h0 = c.h * PLAN_RATIO;
  let w = clamp(w0 + lx, lim.minW, lim.maxW);
  let h = clamp(h0 + ly, lim.minH * PLAN_RATIO, lim.maxH * PLAN_RATIO);
  if (lim.square) w = h = clamp((w0 + lx + h0 + ly) / 2, Math.max(lim.minW, lim.minH * PLAN_RATIO), Math.min(lim.maxW, lim.maxH * PLAN_RATIO));
  const sx = (w - w0) / 2, sy = (h - h0) / 2;
  return {
    cx: r2(c.cx + sx * Math.cos(a) - sy * Math.sin(a)),
    cy: r2(c.cy + (sx * Math.sin(a) + sy * Math.cos(a)) / PLAN_RATIO),
    w: r2(w), h: r2(h / PLAN_RATIO), rotation: c.rotation,
  };
}

/** Agranda o achica desde el centro (factor 1.1 = 10 % más grande). */
export function scaleBox(c: Centered, f: number, lim: SizeLimits): Centered {
  const k = clamp(f, Math.max(lim.minW / c.w, lim.minH / c.h), Math.min(lim.maxW / c.w, lim.maxH / c.h));
  return { ...c, w: r2(c.w * k), h: r2(c.h * k) };
}

/** Giro según dónde está el dedo respecto al centro (en píxeles de pantalla); el asa va arriba. */
export function angleTo(px: number, py: number, step = 15) {
  const deg = (Math.atan2(py, px) * 180) / Math.PI + 90;
  return normDeg(Math.round(deg / step) * step);
}

/** Dónde queda la esquina superior izquierda de una caja girada (para poner el nombre de la zona). */
export function cornerOf(c: Centered) {
  const a = rad(c.rotation);
  const hw = c.w / 2, hh = (c.h * PLAN_RATIO) / 2;
  return { x: r2(c.cx - hw * Math.cos(a) + hh * Math.sin(a)), y: r2(c.cy + (-hw * Math.sin(a) - hh * Math.cos(a)) / PLAN_RATIO) };
}

/** Zonas y elementos se guardan por su esquina; las mesas, por su centro. */
export const fromCorner = (b: { x: number; y: number; w: number; h: number; rotation?: number }): Centered =>
  ({ cx: b.x + b.w / 2, cy: b.y + b.h / 2, w: b.w, h: b.h, rotation: b.rotation ?? 0 });
export const toCorner = (c: Centered) => ({ x: r2(clamp(c.cx - c.w / 2, 0, 100)), y: r2(clamp(c.cy - c.h / 2, 0, 100)), w: c.w, h: c.h, rotation: c.rotation });

/** Caja que encierra algo girado, en % del plano. */
export function boundsOf(c: Centered) {
  const a = rad(c.rotation);
  const hw = c.w / 2, hh = (c.h * PLAN_RATIO) / 2;
  const bx = Math.abs(hw * Math.cos(a)) + Math.abs(hh * Math.sin(a));
  const by = (Math.abs(hw * Math.sin(a)) + Math.abs(hh * Math.cos(a))) / PLAN_RATIO;
  return { x0: c.cx - bx, y0: c.cy - by, x1: c.cx + bx, y1: c.cy + by };
}

/**
 * Parte del plano que tiene algo dibujado, con un margen para las sillas y los nombres.
 * En el celular se muestra solo esa parte, así las mesas se ven más grandes.
 * No queda más de 1,5 veces más alta que ancha.
 */
export function viewBox(parts: Centered[], margin = 1.5, maxTall = 1.5) {
  if (!parts.length) return { x: 0, y: 0, w: 100, h: 100 };
  const b = parts.map(boundsOf);
  let x0 = Math.min(...b.map((p) => p.x0)) - margin, x1 = Math.max(...b.map((p) => p.x1)) + margin;
  let y0 = Math.min(...b.map((p) => p.y0)) - margin / PLAN_RATIO, y1 = Math.max(...b.map((p) => p.y1)) + margin / PLAN_RATIO;
  x0 = clamp(x0, 0, 100); x1 = clamp(x1, 0, 100); y0 = clamp(y0, 0, 100); y1 = clamp(y1, 0, 100);
  // Alto en las mismas unidades que el ancho; si queda muy alta, se ensancha hacia los dos lados.
  const minW = ((y1 - y0) * PLAN_RATIO) / maxTall;
  if (x1 - x0 < minW) {
    const mid = (x0 + x1) / 2;
    x0 = clamp(mid - minW / 2, 0, 100 - minW);
    x1 = Math.min(100, x0 + minW);
  }
  return { x: r2(x0), y: r2(y0), w: r2(Math.max(5, x1 - x0)), h: r2(Math.max(5, y1 - y0)) };
}
