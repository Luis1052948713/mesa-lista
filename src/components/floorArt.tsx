// Dibujo del plano compartido por el salón de la app y la página pública:
// pisos por zona, sillas alrededor de cada mesa y elementos del local.
import { PLAN_RATIO, shapeOf, tableSize } from '@/lib/floor';
import type { FloorKind, ItemKind, TableShape } from '@/lib/types';

export const FLOORS: Record<FloorKind, string> = {
  madera: 'Madera', baldosa: 'Baldosa', concreto: 'Concreto', pasto: 'Pasto', alfombra: 'Alfombra', ninguno: 'Sin piso',
};

/** Tamaño inicial (en % del plano, que es 16:10) y nombre de cada elemento. */
export const ITEM_KINDS: Record<ItemKind, { label: string; w: number; h: number }> = {
  barra: { label: 'Barra', w: 30, h: 7 },
  cocina: { label: 'Cocina', w: 16, h: 18 },
  bano: { label: 'Baños', w: 9, h: 12 },
  caja: { label: 'Caja', w: 8, h: 7 },
  puerta: { label: 'Puerta', w: 9, h: 3 },
  ventana: { label: 'Ventana', w: 14, h: 2 },
  escalera: { label: 'Escalera', w: 8, h: 15 },
  planta: { label: 'Planta', w: 4, h: 6.4 },
  pared: { label: 'Pared', w: 20, h: 1.6 },
};

/** Sillas alrededor de la mesa: en círculo si es redonda, a lo largo del lado largo si es rectangular. */
export function Chairs({ seats, round, vertical = false }: { seats: number; round: boolean; vertical?: boolean }) {
  const n = Math.min(seats, 20);
  const pos: { left: string; top: string }[] = [];
  if (round) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const c = Math.cos(a).toFixed(3), s = Math.sin(a).toFixed(3);
      pos.push({ left: `calc(50% + ${c} * (50% + 1.15cqw))`, top: `calc(50% + ${s} * (50% + 1.15cqw))` });
    }
  } else if (vertical) {
    const left = Math.ceil(n / 2), right = n - left;
    for (let j = 0; j < left; j++) pos.push({ top: `${((j + 0.5) / left) * 100}%`, left: 'calc(0% - 1.15cqw)' });
    for (let j = 0; j < right; j++) pos.push({ top: `${((j + 0.5) / right) * 100}%`, left: 'calc(100% + 1.15cqw)' });
  } else {
    const top = Math.ceil(n / 2), bottom = n - top;
    for (let j = 0; j < top; j++) pos.push({ left: `${((j + 0.5) / top) * 100}%`, top: 'calc(0% - 1.15cqw)' });
    for (let j = 0; j < bottom; j++) pos.push({ left: `${((j + 0.5) / bottom) * 100}%`, top: 'calc(100% + 1.15cqw)' });
  }
  return <>{pos.map((p, i) => <i key={i} className="chair" style={p} aria-hidden="true" />)}</>;
}

/** Dibujo de un elemento del local. El contenedor lo posiciona y lo gira. */
export function ItemArt({ kind, label }: { kind: ItemKind; label: string }) {
  const text = label || (kind === 'planta' || kind === 'pared' || kind === 'ventana' ? '' : ITEM_KINDS[kind].label);
  return (
    <span className={`it it-${kind}`}>
      {kind === 'puerta' && <i className="door-arc" aria-hidden="true" />}
      {kind === 'planta' && <i className="leaf" aria-hidden="true" />}
      {text && <b>{text}</b>}
    </span>
  );
}

/** Mesa dibujada con su tamaño, giro y sillas; el nombre queda siempre derecho. */
export function tableLook(t: { shape: TableShape; seats: number; w?: number; h?: number; rotation?: number; x: number; y: number }) {
  const size = tableSize(t);
  const round = shapeOf(t) === 'round';
  const rot = t.rotation ?? 0;
  return {
    cls: round ? 'round' : 'rect',
    style: {
      left: `${t.x}%`, top: `${t.y}%`, width: `${size.w}%`, height: round ? undefined : `${size.h}%`, '--rot': `${rot}deg`,
    } as React.CSSProperties,
    chairs: <Chairs seats={t.seats} round={round} vertical={!round && size.h * PLAN_RATIO > size.w} />,
    labelStyle: rot ? { transform: `rotate(${-rot}deg)` } : undefined,
  };
}

export const floorClass =(f: FloorKind | undefined) => `floor-${f ?? 'madera'}`;
