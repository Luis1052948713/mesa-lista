'use client';

import { useState } from 'react';
import { dishCost, fcClass, money, pct, qf } from '@/lib/calc';
import { useStore } from '../store';

export function Menu() {
  const { dishes, ingMap, updateDishPrice, toast, setModal } = useStore();
  const [cat, setCat] = useState('');
  const categories = [...new Set(dishes.map((d) => d.category))];
  const shown = cat ? dishes.filter((d) => d.category === cat) : dishes;

  return (
    <>
      <div className="head">
        <div><div className="eyebrow">Ingeniería de menú</div><h2>Menú y recetas</h2>
          <p>El costo de cada plato sale de su receta y del último precio pagado por cada insumo. Los platos disponibles, con su foto y descripción, salen en la carta que ven tus clientes al reservar.</p></div>
        <button className="btn primary" onClick={() => setModal({ type: 'dish' })}>+ Nuevo plato</button>
      </div>
      {categories.length > 1 && (
        <div className="chips">
          <button className={`chip ${cat === '' ? 'on' : ''}`} onClick={() => setCat('')}>Todos ({dishes.length})</button>
          {categories.map((c) => <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c} ({dishes.filter((d) => d.category === c).length})</button>)}
        </div>
      )}
      {dishes.length === 0 && <div className="empty">Todavía no hay platos. Toca &quot;Nuevo plato&quot; para crear el primero con su receta.</div>}
      <div className="dishes">
        {shown.map((d) => {
          const c = dishCost(d, ingMap);
          const fc = d.price ? c / d.price : 0;
          const suggested = Math.ceil(c / 0.32 / 1000) * 1000;
          return (
            <article key={d.id} className={`dish ${d.active ? '' : 'off'}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- foto en Supabase Storage */}
              {d.photo_url && <img className="dish-thumb" src={d.photo_url} alt={`Foto de ${d.name}`} />}
              <div className="top2">
                <div><div className="eyebrow">{d.category}{!d.active && ' · No disponible'}</div><h3>{d.name}</h3>
                  {d.description && <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>{d.description}</p>}</div>
                <div className="row" style={{ gap: 6 }}>
                  <span className={`fc ${fcClass(fc)}`}>{pct(fc)}</span>
                  <button className="btn sm" onClick={() => setModal({ type: 'dish', dish: d })}>Editar</button>
                </div>
              </div>
              <div className="figs">
                <div><span>Costo</span><b>{money(c)}</b></div>
                <div><span>Margen</span><b>{money(d.price - c)}</b></div>
                <div><span>Insumos</span><b>{d.recipe.length}</b></div>
              </div>
              <div className="price-in">
                <label htmlFor={`price-${d.id}`} className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Precio de venta</label>
                <input id={`price-${d.id}`} type="number" step={500} min={0} defaultValue={d.price} key={d.price}
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value);
                    if (v > 0 && v !== d.price) updateDishPrice(d.id, v).then(() => toast(`Precio de ${d.name}: ${money(v)}`));
                  }} />
              </div>
              {fcClass(fc) === 'bad' && <div className="hint">Food cost alto. Con {money(suggested)} quedas en 32 %.</div>}
              {d.recipe.length === 0
                ? <div className="callout amber" style={{ fontSize: 13 }}>Sin receta: no suma a la lista de compras. Edítalo para agregar los insumos.</div>
                : <div className="recipe">
                  {d.recipe.map((line) => {
                    const g = ingMap.get(line.ingredient_id);
                    return g ? <div key={line.ingredient_id}><span>{g.name}</span><span>{qf(line.qty, g.unit)} · {money(line.qty * g.price)}</span></div> : null;
                  })}
                </div>}
            </article>
          );
        })}
      </div>
    </>
  );
}
