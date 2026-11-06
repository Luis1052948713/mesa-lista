'use client';

import { useState } from 'react';
import { money, qf } from '@/lib/calc';
import { useStore } from '../store';

export function Inventario() {
  const { ingredients, updateStock, setModal } = useStore();
  const [q, setQ] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const needle = q.trim().toLowerCase();
  const rows = [...ingredients]
    .filter((g) => (!needle || g.name.toLowerCase().includes(needle) || g.supplier.toLowerCase().includes(needle)) && (!onlyLow || g.stock < g.min_stock))
    .sort((a, b) => a.stock / (a.min_stock || 1) - b.stock / (b.min_stock || 1));
  const value = ingredients.reduce((a, g) => a + g.stock * g.price, 0);
  const low = ingredients.filter((g) => g.stock < g.min_stock).length;

  return (
    <>
      <div className="head">
        <div><div className="eyebrow">Bodega</div><h2>Inventario</h2>
          <p>Se descuenta solo cuando marcas una reserva como atendida y sube cuando registras una compra. Corrige el stock a mano después del conteo.</p></div>
        <div className="row">
          <button className="btn" onClick={() => setModal({ type: 'purchase' })}>Registrar compra</button>
          <button className="btn primary" onClick={() => setModal({ type: 'ingredient' })}>+ Nuevo insumo</button>
        </div>
      </div>
      <section className="kpis fit">
        <div className="kpi"><span className="eyebrow">Valor en bodega</span><span className="v">{money(value)}</span></div>
        <div className="kpi"><span className="eyebrow">Bajo el mínimo</span><span className="v" style={{ color: low ? 'var(--chili)' : undefined }}>{low}</span><span className="s">de {ingredients.length} insumos</span></div>
      </section>
      <div className="row">
        <input type="text" aria-label="Buscar insumo o proveedor" placeholder="Buscar insumo o proveedor…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        <label className="check"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> Solo bajo el mínimo</label>
      </div>
      <div className="panel tw">
        {rows.length === 0 ? <div className="empty">{ingredients.length ? 'Ningún insumo coincide con la búsqueda.' : 'Todavía no hay insumos. Toca "Nuevo insumo" para agregar el primero.'}</div> : (
          <table>
            <thead><tr><th>Insumo</th><th>Proveedor</th><th className="n">Stock</th><th className="n">Mínimo</th><th>Nivel</th><th className="n">Precio</th><th /></tr></thead>
            <tbody>
              {rows.map((g) => {
                const isLow = g.stock < g.min_stock;
                const ratio = g.min_stock ? Math.min(1, g.stock / (g.min_stock * 2)) : 1;
                return (
                  <tr key={g.id}>
                    <td><b>{g.name}</b> {isLow && <span className="tag alert">Bajo mínimo</span>}</td>
                    <td className="muted">{g.supplier || '—'}</td>
                    <td className="n"><input type="number" min={0} step={g.unit === 'und' ? 1 : 0.05} defaultValue={Math.round(g.stock * 100) / 100} key={g.stock}
                      aria-label={`Stock de ${g.name} en ${g.unit}`}
                      onBlur={(e) => { const v = parseFloat(e.target.value); if (v >= 0 && v !== g.stock) updateStock(g.id, v); }} /> {g.unit}</td>
                    <td className="n">{qf(g.min_stock, g.unit)}</td>
                    <td><div className={`meter ${isLow ? 'low' : ''}`}><i style={{ width: `${ratio * 100}%` }} /></div></td>
                    <td className="n">{money(g.price)}/{g.unit}</td>
                    <td><div className="row" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                      <button className="btn sm" onClick={() => setModal({ type: 'purchase', ingredientId: g.id })}>Comprar</button>
                      <button className="btn sm" onClick={() => setModal({ type: 'ingredient', ingredient: g })}>Editar</button>
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
