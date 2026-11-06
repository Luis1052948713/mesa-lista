'use client';

import { floorClass, ItemArt, tableLook } from '@/components/floorArt';
import { cornerOf, fromCorner, tableSize, viewBox } from '@/lib/floor';
import type { FloorItem, FloorKind, TableShape } from '@/lib/types';

/* eslint-disable @next/next/no-img-element -- foto del local en Supabase Storage */

export interface FloorTable {
  id: string; name: string; seats: number; zone: string; x: number; y: number; shape: TableShape;
  w: number; h: number; rotation: number;
  /** Sirve para el tamaño del grupo. */
  fits: boolean;
  /** Libre a esa hora. */
  free: boolean;
}
export interface FloorZone { name: string; x: number; y: number; w: number; h: number; floor: FloorKind; rotation?: number }
export interface Floor { bg: string; zones: FloorZone[]; items: Omit<FloorItem, 'id'>[]; tables: FloorTable[] }

/** Plano ilustrado para que el cliente toque una mesa libre. No muestra quién ocupa las demás. */
export function PublicFloor({ floor, selected, onSelect }: { floor: Floor; selected: string; onSelect: (id: string) => void }) {
  const tables = floor.tables.map((t) => ({ ...t, w: Number(t.w ?? 0), h: Number(t.h ?? 0), rotation: t.rotation ?? 0 }));
  // Solo se muestra la parte del plano que tiene algo (con foto de fondo se muestra entero, para no cortarla).
  const v = floor.bg ? { x: 0, y: 0, w: 100, h: 100 } : viewBox([
    ...floor.zones.map(fromCorner),
    ...floor.items.map(fromCorner),
    ...tables.map((t) => ({ cx: t.x, cy: t.y, ...tableSize(t), rotation: t.rotation })),
  ]);
  return (
    <div className="scroll-x">
      <div className="plan-view" style={{ aspectRatio: `${v.w * 16} / ${v.h * 10}`, minWidth: `${Math.round(4.6 * v.w)}px` }}>
        <div className={`plan public ${floor.bg ? 'has-bg' : ''}`} role="group" aria-label="Plano del restaurante"
          style={{ width: `${10000 / v.w}%`, left: `${(-v.x * 100) / v.w}%`, top: `${(-v.y * 100) / v.h}%` }}>
          {floor.bg && <img className="plan-bg" src={floor.bg} alt="" />}
          {floor.zones.map((z) => (
            <div key={z.name} className={`zone ${floorClass(z.floor)}`}
              style={{ left: `${z.x}%`, top: `${z.y}%`, width: `${z.w}%`, height: `${z.h}%`, transform: z.rotation ? `rotate(${z.rotation}deg)` : undefined }} />
          ))}
          {floor.items.map((it, i) => (
            <div key={i} className="fitem" aria-hidden="true"
              style={{ left: `${it.x}%`, top: `${it.y}%`, width: `${it.w}%`, height: `${it.h}%`, transform: it.rotation ? `rotate(${it.rotation}deg)` : undefined }}>
              <ItemArt kind={it.kind} label={it.label} />
            </div>
          ))}
          {/* Los nombres de las zonas van por encima de los elementos (una barra no los tapa). */}
          {floor.zones.map((z) => {
            const p = cornerOf(fromCorner(z));
            return <span key={`n-${z.name}`} className="zname" style={{ left: `${p.x}%`, top: `${p.y}%` }}>{z.name}</span>;
          })}
          {tables.map((t) => {
            const look = tableLook(t);
            const can = t.free && t.fits;
            const state = selected === t.id ? 'picked' : !t.free ? 'taken' : !t.fits ? 'nofit' : 'open';
            return (
              <button key={t.id} type="button" disabled={!can}
                className={`tbl ${look.cls} pt-${state}`}
                style={look.style}
                aria-pressed={selected === t.id}
                aria-label={`Mesa ${t.name}, ${t.seats} puestos, ${t.zone}: ${state === 'taken' ? 'ocupada' : state === 'nofit' ? 'no es para tu grupo' : 'libre'}`}
                onClick={() => onSelect(selected === t.id ? '' : t.id)}>
                {look.chairs}
                <span className="tlabel" style={look.labelStyle}><b>{t.name}</b><small>{t.seats}p</small></span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
