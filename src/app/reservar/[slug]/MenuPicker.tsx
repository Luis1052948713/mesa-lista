'use client';

import { money } from '@/lib/calc';
import type { MenuDish } from '@/lib/public';

/* eslint-disable @next/next/no-img-element -- fotos de los platos en Supabase Storage */

/** Carta por categorías, con botones + y − para pedir desde la reserva. */
export function MenuPicker({ menu, order, onChange }: {
  menu: MenuDish[]; order: Record<string, number>; onChange: (next: Record<string, number>) => void;
}) {
  const categories = [...new Set(menu.map((d) => d.category))];
  const set = (id: string, qty: number) => {
    const next = { ...order };
    if (qty > 0) next[id] = Math.min(qty, 50);
    else delete next[id];
    onChange(next);
  };

  return (
    <div className="carta">
      {categories.map((c) => (
        <section key={c} className="carta-cat">
          <h3>{c}</h3>
          {menu.filter((d) => d.category === c).map((d) => {
            const q = order[d.id] ?? 0;
            return (
              <div key={d.id} className={`carta-dish ${q ? 'has' : ''}`}>
                {d.photo_url ? <img src={d.photo_url} alt={d.name} loading="lazy" /> : <span className="carta-noimg" aria-hidden="true" />}
                <div className="carta-txt">
                  <b>{d.name}</b>
                  {d.description && <span>{d.description}</span>}
                  <em>{money(d.price)}</em>
                </div>
                <div className="carta-qty">
                  {q > 0 && <>
                    <button type="button" onClick={() => set(d.id, q - 1)} aria-label={`Quitar ${d.name}`}>−</button>
                    <b aria-live="polite">{q}</b>
                  </>}
                  <button type="button" className="add" onClick={() => set(d.id, q + 1)} aria-label={`Agregar ${d.name}`}>+</button>
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
