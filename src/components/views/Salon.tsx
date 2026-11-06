'use client';

import { useRef, useState } from 'react';
import { fmtDay, fmtLong, hora, localParts, slotsFor, zonedToUtc } from '@/lib/calc';
import {
  angleTo, cornerOf, fromCorner, normDeg, resizeFromCorner, scaleBox, shapeOf, tableSize, toCorner,
  type Centered, type SizeLimits,
} from '@/lib/floor';
import type { DiningTable, Geo } from '@/lib/types';
import { FLOORS, floorClass, ITEM_KINDS, ItemArt, tableLook } from '../floorArt';
import { conflictOf, useStore } from '../store';
import { ResItem } from '../ui';

const snap = (v: number) => Math.round(v * 2) / 2;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

type Kind = 'table' | 'zone' | 'item';
type Mode = 'move' | 'resize' | 'rotate';
type Sel = { kind: Kind; id: string };
type Drag = { mode: Mode; kind: Kind; id: string; sx: number; sy: number; cx: number; cy: number; start: Geo; last: Geo; moved: boolean };

// Las zonas tienen un tamaño mínimo de 8 %; los elementos pueden ser tan delgados como una pared.
const LIMITS: Record<Kind, SizeLimits> = {
  table: { minW: 3, minH: 3, maxW: 60, maxH: 90 },
  zone: { minW: 8, minH: 8, maxW: 100, maxH: 100 },
  item: { minW: 1.5, minH: 1.5, maxW: 100, maxH: 100 },
};

/** Las mesas se guardan por su centro; zonas y elementos, por su esquina. */
const centered = (kind: Kind, g: Geo): Centered => (kind === 'table' ? { cx: g.x, cy: g.y, w: g.w, h: g.h, rotation: g.rotation } : fromCorner(g));
const fromCentered = (kind: Kind, c: Centered): Geo =>
  (kind === 'table' ? { x: clamp(c.cx, 2, 98), y: clamp(c.cy, 3, 97), w: c.w, h: c.h, rotation: c.rotation } : toCorner(c));

export function Salon() {
  const s = useStore();
  const { reservations, tables, zones, floorItems, today, restaurant, setModal, moveTable, moveZone, moveItem, setPlanBackground, toast } = s;
  const [bgBusy, setBgBusy] = useState(false);
  const nowTime = localParts(new Date(s.now).toISOString(), restaurant.timezone).time;
  const [date, setDate] = useState(today);
  const slots = slotsFor(restaurant);
  const [slot, setSlot] = useState(() => slots.find((x) => x >= nowTime) ?? slots[0] ?? '19:30');
  const [editing, setEditing] = useState(false);
  const [sel, setSel] = useState<Sel | null>(null);
  const [draft, setDraft] = useState<Record<string, Geo>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const plan = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  const startIso = zonedToUtc(date, slot, restaurant.timezone);
  const shown = editing ? tables : tables.filter((t) => t.active);
  const active = tables.filter((t) => t.active);
  const busy = new Map(active.map((t) => [t.id, conflictOf(reservations, t.id, startIso, 1)]));
  const free = active.filter((t) => !busy.get(t.id)).reduce((a, t) => a + t.seats, 0);
  const total = active.reduce((a, t) => a + t.seats, 0);
  const dayRes = reservations.filter((r) => r.date === date && r.status !== 'cancelada');

  const isRound = (id: string) => { const t = tables.find((x) => x.id === id); return !!t && shapeOf(t) === 'round'; };
  const limitsOf = (kind: Kind, id: string) => ({ ...LIMITS[kind], square: kind === 'table' && isRound(id) });

  /** Posición, tamaño y giro de lo que se ve ahora (incluye lo que se está arrastrando). */
  function geoOf(kind: Kind, id: string): Geo | null {
    if (draft[id]) return draft[id];
    if (kind === 'table') {
      const t = tables.find((x) => x.id === id);
      return t ? { x: t.x, y: t.y, ...tableSize(t), rotation: t.rotation } : null;
    }
    const b = kind === 'zone' ? zones.find((x) => x.id === id) : floorItems.find((x) => x.id === id);
    return b ? { x: b.x, y: b.y, w: b.w, h: b.h, rotation: b.rotation } : null;
  }

  /** Guarda solo lo que cambió: mover no fija el tamaño automático de una mesa. */
  async function commit(kind: Kind, id: string, mode: Mode, g: Geo) {
    const patch = mode === 'move' ? { x: g.x, y: g.y } : mode === 'rotate' ? { rotation: g.rotation }
      : { x: g.x, y: g.y, w: g.w, h: kind === 'table' && isRound(id) ? 0 : g.h };
    if (kind === 'table') await moveTable(id, patch);
    else if (kind === 'item') await moveItem(id, patch);
    else await moveZone(id, patch);
  }

  function openEditor(kind: Kind, id: string) {
    if (kind === 'table') setModal({ type: 'table', table: tables.find((t) => t.id === id) });
    else if (kind === 'item') setModal({ type: 'item', item: floorItems.find((i) => i.id === id) });
    else setModal({ type: 'zone', zone: zones.find((z) => z.id === id) });
  }

  /* ---------- arrastrar, cambiar tamaño y girar ---------- */

  function begin(e: React.PointerEvent, mode: Mode, kind: Kind, id: string) {
    const g = geoOf(kind, id);
    const r = plan.current?.getBoundingClientRect();
    if (!editing || e.button > 0 || !g || !r) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const c = centered(kind, g);
    drag.current = {
      mode, kind, id, sx: e.clientX, sy: e.clientY, start: g, last: g, moved: false,
      cx: r.left + (c.cx / 100) * r.width, cy: r.top + (c.cy / 100) * r.height,
    };
  }

  function move(e: React.PointerEvent) {
    const d = drag.current;
    const r = plan.current?.getBoundingClientRect();
    if (!d || !r) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
    if (!d.moved) { setDragId(d.id); setSel({ kind: d.kind, id: d.id }); }
    d.moved = true;
    const dx = ((e.clientX - d.sx) / r.width) * 100;
    const dy = ((e.clientY - d.sy) / r.height) * 100;
    const b = d.start;
    if (d.mode === 'rotate') d.last = { ...b, rotation: angleTo(e.clientX - d.cx, e.clientY - d.cy, e.shiftKey ? 1 : 15) };
    else if (d.mode === 'resize') d.last = fromCentered(d.kind, resizeFromCorner(centered(d.kind, b), dx, dy, limitsOf(d.kind, d.id)));
    else if (d.kind === 'table') d.last = { ...b, x: clamp(snap(b.x + dx), 2, 98), y: clamp(snap(b.y + dy), 3, 97) };
    else d.last = { ...b, x: clamp(snap(b.x + dx), 0, 100 - b.w), y: clamp(snap(b.y + dy), 0, 100 - b.h) };
    setDraft((m) => ({ ...m, [d.id]: d.last }));
  }

  async function end() {
    const d = drag.current;
    drag.current = null;
    setDragId(null);
    if (!d) return;
    if (!d.moved) {
      // Un toque selecciona; tocar otra vez lo que ya está seleccionado abre sus datos.
      if (d.mode !== 'move') return;
      if (sel?.id === d.id) openEditor(d.kind, d.id);
      else setSel({ kind: d.kind, id: d.id });
      return;
    }
    await commit(d.kind, d.id, d.mode, d.last);
    setDraft((m) => {
      const n = { ...m };
      delete n[d.id];
      return n;
    });
  }

  // Con el teclado: flechas mueven la mesa 1 %, con Mayús 5 %.
  function nudge(e: React.KeyboardEvent, t: DiningTable) {
    const step = e.shiftKey ? 5 : 1;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!delta) return;
    e.preventDefault();
    moveTable(t.id, { x: clamp(t.x + delta[0], 2, 98), y: clamp(t.y + delta[1], 3, 97) });
  }

  const dragHandlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end };

  /** Asas de lo seleccionado: la esquina cambia el tamaño y el círculo de arriba lo gira. */
  const handles = (kind: Kind, id: string) => editing && sel?.id === id && <>
    <i className="grip" aria-hidden="true" onPointerDown={(e) => begin(e, 'resize', kind, id)} {...dragHandlers} />
    <i className="rot-knob" aria-hidden="true" onPointerDown={(e) => begin(e, 'rotate', kind, id)} {...dragHandlers} />
  </>;

  /* ---------- barra de lo seleccionado ---------- */

  const selGeo = sel ? geoOf(sel.kind, sel.id) : null;
  const selTable = sel?.kind === 'table' ? tables.find((t) => t.id === sel.id) : undefined;
  const selName = !sel ? '' : sel.kind === 'table' ? `Mesa ${selTable?.name ?? ''}`
    : sel.kind === 'zone' ? `Zona ${zones.find((z) => z.id === sel.id)?.name ?? ''}`
      : (() => { const it = floorItems.find((i) => i.id === sel.id); return it ? it.label || ITEM_KINDS[it.kind].label : ''; })();

  function rotateTo(deg: number) {
    if (!sel || !selGeo || Number.isNaN(deg)) return;
    commit(sel.kind, sel.id, 'rotate', { ...selGeo, rotation: normDeg(deg) });
  }
  function scale(f: number) {
    if (!sel || !selGeo) return;
    commit(sel.kind, sel.id, 'resize', fromCentered(sel.kind, scaleBox(centered(sel.kind, selGeo), f, limitsOf(sel.kind, sel.id))));
  }

  async function pickBackground(file: File | null) {
    setBgBusy(true);
    const err = await setPlanBackground(file);
    setBgBusy(false);
    toast(err ?? (file ? 'Fondo del plano actualizado. Acomoda las zonas y mesas encima.' : 'Fondo del plano quitado.'), err ? 'alert' : undefined);
  }

  return (
    <>
      <div className="head">
        <div><div className="eyebrow">Plano del restaurante</div><h2>{zones.map((z) => z.name).join(' · ') || 'Plano'}</h2>
          <p>{editing
            ? 'Arrastra mesas, zonas y elementos a su lugar. Toca uno para seleccionarlo: la esquina verde cambia su tamaño y el círculo de arriba lo gira. Tócalo otra vez para editar sus datos. Los cambios se guardan solos.'
            : 'Toca una mesa libre para reservarla o una ocupada para ver la reserva. Cada reserva bloquea la mesa 2 horas.'}</p></div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          {editing ? <>
            <button className="btn" onClick={() => setModal({ type: 'zone' })}>+ Zona</button>
            <button className="btn" onClick={() => setModal({ type: 'table' })} disabled={!zones.length}>+ Mesa</button>
            <button className="btn" onClick={() => setModal({ type: 'item' })}>+ Elemento</button>
            <label className="btn" style={{ cursor: 'pointer' }}>
              {bgBusy ? 'Subiendo…' : restaurant.plan_bg_url ? 'Cambiar fondo' : 'Foto de fondo'}
              <input type="file" accept="image/jpeg,image/png,image/webp,image/heic" hidden disabled={bgBusy}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pickBackground(f); }} />
            </label>
            {restaurant.plan_bg_url && <button className="btn ghost" onClick={() => pickBackground(null)}>Quitar fondo</button>}
            <button className="btn primary" onClick={() => { setEditing(false); setSel(null); }}>Listo</button>
          </> : <>
            <div className="field"><label htmlFor="pl-date">Fecha</label><input id="pl-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
            <div className="field"><label htmlFor="pl-slot">Hora</label>
              <select id="pl-slot" value={slot} onChange={(e) => setSlot(e.target.value)}>{slots.map((x) => <option key={x} value={x}>{hora(x)}</option>)}</select></div>
            <button className="btn" onClick={() => setEditing(true)}>Editar plano</button>
          </>}
        </div>
      </div>

      {!editing && (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="legend">
            <span><i style={{ borderColor: 'var(--ok)', background: 'var(--surface)' }} />Libre</span>
            <span><i style={{ borderColor: 'var(--saffron)', background: 'var(--saffron-soft)' }} />Reservada</span>
            <span><i style={{ borderColor: 'var(--olive)', background: 'var(--olive)' }} />Atendida</span>
          </div>
          <span className="num" style={{ fontSize: 13 }}>{free} de {total} puestos libres · {fmtDay(date)} {hora(slot)}</span>
        </div>
      )}
      {editing && (sel && selGeo ? (
        <div className="seltools" role="toolbar" aria-label={`Ajustar ${selName}`}>
          <b>{selName}</b>
          <div className="grp"><span>Girar</span>
            <button type="button" className="btn sm" onClick={() => rotateTo(selGeo.rotation - 15)} aria-label="Girar 15 grados a la izquierda">↺</button>
            <input key={`${sel.id}-${selGeo.rotation}`} type="number" min={0} max={359} step={1} defaultValue={selGeo.rotation} aria-label="Grados de giro"
              onBlur={(e) => { const v = parseInt(e.target.value, 10); if (v !== selGeo.rotation) rotateTo(v); }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />°
            <button type="button" className="btn sm" onClick={() => rotateTo(selGeo.rotation + 15)} aria-label="Girar 15 grados a la derecha">↻</button>
            <button type="button" className="btn sm" onClick={() => rotateTo(selGeo.rotation + 90)}>90°</button>
          </div>
          <div className="grp"><span>Tamaño</span>
            <button type="button" className="btn sm" onClick={() => scale(1 / 1.1)} aria-label="Más pequeño">−</button>
            <button type="button" className="btn sm" onClick={() => scale(1.1)} aria-label="Más grande">+</button>
            {selTable && (selTable.w > 0 || selTable.h > 0) && (
              <button type="button" className="btn sm ghost" onClick={() => moveTable(selTable.id, { w: 0, h: 0 })}>Automático</button>
            )}
          </div>
          <button type="button" className="btn sm" onClick={() => openEditor(sel.kind, sel.id)}>Editar datos…</button>
          <button type="button" className="btn sm ghost" onClick={() => setSel(null)} aria-label="Quitar selección">✕</button>
        </div>
      ) : (
        <div className="banner"><span><b>Editando el plano.</b> {tables.length} mesas en {zones.length} {zones.length === 1 ? 'zona' : 'zonas'}. Toca una mesa, zona o elemento para girarlo o cambiar su tamaño. Las mesas no disponibles se ven punteadas.</span></div>
      ))}

      <div className="scroll-x"><div ref={plan} className={`plan ${editing ? 'editing' : ''} ${restaurant.plan_bg_url ? 'has-bg' : ''}`}
        onPointerDown={(e) => { if (editing && (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('plan-bg'))) setSel(null); }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- foto del local en Supabase Storage */}
        {restaurant.plan_bg_url && <img className="plan-bg" src={restaurant.plan_bg_url} alt="" />}
        {zones.map((z) => {
          const b = draft[z.id] ?? z;
          return (
            <div key={z.id} className={`zone ${floorClass(z.floor)} ${dragId === z.id ? 'dragging' : ''} ${sel?.id === z.id ? 'sel' : ''}`}
              style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%`, transform: b.rotation ? `rotate(${b.rotation}deg)` : undefined }}
              title={editing ? `${z.name} · piso ${FLOORS[z.floor].toLowerCase()}` : undefined}
              onPointerDown={(e) => begin(e, 'move', 'zone', z.id)} {...dragHandlers}>
              {handles('zone', z.id)}
            </div>
          );
        })}
        {floorItems.map((it) => {
          const b = draft[it.id] ?? it;
          return (
            <div key={it.id} className={`fitem ${dragId === it.id ? 'dragging' : ''} ${sel?.id === it.id ? 'sel' : ''}`}
              style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%`, transform: b.rotation ? `rotate(${b.rotation}deg)` : undefined }}
              role={editing ? 'button' : undefined} tabIndex={editing ? 0 : undefined}
              aria-label={editing ? `${it.label || ITEM_KINDS[it.kind].label}: arrastra para mover, Enter para editar` : undefined}
              onKeyDown={editing ? (e) => { if (e.key === 'Enter') setModal({ type: 'item', item: it }); } : undefined}
              onPointerDown={(e) => begin(e, 'move', 'item', it.id)} {...dragHandlers}>
              <ItemArt kind={it.kind} label={it.label} />
              {handles('item', it.id)}
            </div>
          );
        })}
        {/* Los nombres de las zonas van por encima de los elementos (una barra no los tapa). */}
        {zones.map((z) => {
          const p = cornerOf(fromCorner(draft[z.id] ?? z));
          return editing
            ? <button key={`n-${z.id}`} className="zname zlabel-btn" style={{ left: `${p.x}%`, top: `${p.y}%` }}
              onPointerDown={(e) => e.stopPropagation()} onClick={() => setModal({ type: 'zone', zone: z })}>✎ {z.name}</button>
            : <span key={`n-${z.id}`} className="zname" style={{ left: `${p.x}%`, top: `${p.y}%` }}>{z.name}</span>;
        })}
        {shown.map((t) => {
          const r = editing ? undefined : busy.get(t.id);
          const cls = r ? (r.status === 'atendida' ? 'served' : 'busy') : '';
          const g = draft[t.id];
          const look = tableLook(g ? { ...t, ...g } : t);
          return (
            <button key={t.id} className={`tbl ${look.cls} ${cls} ${t.active ? '' : 'off'} ${dragId === t.id ? 'dragging' : ''} ${sel?.id === t.id ? 'sel' : ''}`}
              style={look.style}
              aria-label={editing ? `${t.name}, ${t.seats} puestos. Arrastra para mover, Enter para editar` : `${t.name}, ${t.seats} puestos, ${r ? `reservada por ${r.customer_name}` : 'libre'}`}
              onPointerDown={(e) => begin(e, 'move', 'table', t.id)} {...dragHandlers}
              onKeyDown={editing ? (e) => nudge(e, t) : undefined}
              onClick={(e) => {
                if (editing) {
                  // El clic del mouse ya lo maneja end(); aquí solo llega Enter o Espacio del teclado.
                  if (e.detail === 0) setModal({ type: 'table', table: t });
                  return;
                }
                if (r) setModal({ type: 'detail', id: r.id });
                else setModal({ type: 'form', preset: { date, time: slot, table_id: t.id } });
              }}>
              {look.chairs}
              <span className="tlabel" style={look.labelStyle}>
                <b>{t.name}</b><small>{r ? `${r.customer_name.split(' ')[0]} ${hora(r.time)}` : `${t.seats} puestos`}</small>
              </span>
              {handles('table', t.id)}
            </button>
          );
        })}
        {zones.length === 0 && (
          <div className="plan-empty">
            <p>Tu plano está vacío.</p>
            <button className="btn primary" onClick={() => { setEditing(true); setModal({ type: 'zone' }); }}>Crear la primera zona</button>
          </div>
        )}
      </div></div>

      {!editing && (
        <div className="panel"><h3>Reservas del {fmtLong(date)}</h3>
          <div className="list">{dayRes.length ? dayRes.map((r) => <ResItem key={r.id} r={r} />) : <div className="empty">No hay reservas este día.</div>}</div>
        </div>
      )}
    </>
  );
}
