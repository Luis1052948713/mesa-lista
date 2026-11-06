'use client';

import { useState } from 'react';
import { addDays, fmtDay, localParts, money, pct, qf, shopping, type ShopRow } from '@/lib/calc';
import { useStore } from '../store';

type Checklist = { bought: Record<string, true>; paid: Record<string, number> };

export function Compras() {
  const { setModal } = useStore();
  const [tab, setTab] = useState<'lista' | 'historial'>('lista');
  return (
    <>
      <div className="head">
        <div><div className="eyebrow">Compras inteligentes</div><h2>{tab === 'lista' ? 'Lista de mercado' : 'Historial de compras'}</h2>
          <p>{tab === 'lista'
            ? 'Suma los pre-pedidos de las reservas, los multiplica por cada receta, agrega la merma y resta lo que ya tienes en inventario. Llévala en el celular, marca lo que compras y anota el precio real.'
            : 'Cada compra suma a su insumo en el inventario. Si la editas, el stock se ajusta a la diferencia; si la borras, se resta.'}</p></div>
        <button className="btn primary" onClick={() => setModal({ type: 'purchase' })}>+ Registrar compra</button>
      </div>
      <div className="chips" role="tablist">
        <button role="tab" aria-selected={tab === 'lista'} className={`chip ${tab === 'lista' ? 'on' : ''}`} onClick={() => setTab('lista')}>Lista de mercado</button>
        <button role="tab" aria-selected={tab === 'historial'} className={`chip ${tab === 'historial' ? 'on' : ''}`} onClick={() => setTab('historial')}>Historial</button>
      </div>
      {tab === 'lista' ? <ListaMercado /> : <Historial />}
    </>
  );
}

function Historial() {
  const { purchases, ingMap, restaurant, today, setModal } = useStore();
  const [q, setQ] = useState('');
  const [days, setDays] = useState(30);
  const from = addDays(today, -days + 1);
  const needle = q.trim().toLowerCase();
  const rows = purchases
    .map((p) => ({ p, g: ingMap.get(p.ingredient_id), date: localParts(p.bought_at, restaurant.timezone).date }))
    .filter((x) => x.date >= from && (!needle || x.g?.name.toLowerCase().includes(needle) || x.g?.supplier.toLowerCase().includes(needle) || x.p.note.toLowerCase().includes(needle)));
  const total = rows.reduce((a, x) => a + x.p.qty * x.p.unit_price, 0);
  const bySupplier = new Map<string, number>();
  rows.forEach((x) => bySupplier.set(x.g?.supplier || 'Sin proveedor', (bySupplier.get(x.g?.supplier || 'Sin proveedor') ?? 0) + x.p.qty * x.p.unit_price));
  const top = [...bySupplier].sort((a, b) => b[1] - a[1])[0];

  return (
    <>
      <div className="kpis fit">
        <div className="kpi hero"><span className="eyebrow">Gastado en {days} días</span><span className="v">{money(total)}</span><span className="s">{rows.length} compras</span></div>
        <div className="kpi"><span className="eyebrow">Proveedor principal</span><span className="v" style={{ fontSize: 22 }}>{top ? top[0] : '—'}</span><span className="s">{top ? money(top[1]) : 'Sin compras'}</span></div>
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <input type="text" aria-label="Buscar compra" placeholder="Buscar insumo, proveedor o nota…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        <div className="chips">{[7, 30, 90].map((n) => <button key={n} className={`chip ${days === n ? 'on' : ''}`} onClick={() => setDays(n)}>{n} días</button>)}</div>
      </div>
      <div className="panel tw">
        {rows.length === 0 ? <div className="empty">No hay compras en este periodo. Usa &quot;Registrar compra&quot; o marca lo comprado en la lista de mercado.</div> : (
          <table>
            <thead><tr><th>Fecha</th><th>Insumo</th><th>Proveedor</th><th className="n">Cantidad</th><th className="n">Precio</th><th className="n">Total</th><th>Nota</th><th /></tr></thead>
            <tbody>
              {rows.map(({ p, g, date }) => (
                <tr key={p.id}>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{fmtDay(date)}</td>
                  <td><b>{g?.name ?? 'Insumo borrado'}</b></td>
                  <td className="muted">{g?.supplier || '—'}</td>
                  <td className="n">{g ? qf(p.qty, g.unit) : p.qty}</td>
                  <td className="n">{money(p.unit_price)}{g ? `/${g.unit}` : ''}</td>
                  <td className="n">{money(p.qty * p.unit_price)}</td>
                  <td className="muted" style={{ fontSize: 13 }}>{p.note || '—'}</td>
                  <td><button className="btn sm" onClick={() => setModal({ type: 'purchase', purchase: p })}>Editar</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={5}>Total</td><td className="n">{money(total)}</td><td colSpan={2} /></tr></tfoot>
          </table>
        )}
      </div>
    </>
  );
}

function ListaMercado() {
  const s = useStore();
  const { reservations, dishMap, ingredients, today, restaurant, copy, toast, registerPurchase, updateRestaurant } = s;
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  // Lo marcado en el mercado se guarda en este dispositivo hasta registrar la compra.
  const key = `mesalista.compras.${restaurant.id}`;
  // Esta vista solo se pinta en el navegador (el Shell muestra "Cargando" en el servidor).
  const [list, setList] = useState<Checklist>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw) as Checklist;
    } catch { /* sin almacenamiento local */ }
    return { bought: {}, paid: {} };
  });
  const persist = (next: Checklist) => {
    setList(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* sin almacenamiento local */ }
  };

  const { rows, resIn, total } = shopping(reservations, dishMap, ingredients, today, days, restaurant.shop_merma, restaurant.shop_keep_min);
  const groups = new Map<string, ShopRow[]>();
  rows.forEach((x) => groups.set(x.ing.supplier || 'Sin proveedor', [...(groups.get(x.ing.supplier || 'Sin proveedor') ?? []), x]));
  const bought = rows.filter((x) => list.bought[x.ing.id]).length;
  const lines = (xs: ShopRow[]) => xs.map((x) => `• ${x.ing.name}: ${qf(x.buy, x.ing.unit)}`).join('\n');

  async function register() {
    const done = rows.filter((x) => list.bought[x.ing.id]);
    if (!done.length) return toast('Marca primero los insumos que compraste.');
    setBusy(true);
    const err = await registerPurchase(done.map((x) => ({ ingredient_id: x.ing.id, qty: x.buy, unit_price: list.paid[x.ing.id] > 0 ? list.paid[x.ing.id] : null })));
    setBusy(false);
    if (err) return toast(err, 'alert');
    const changed = done.filter((x) => list.paid[x.ing.id] > 0 && list.paid[x.ing.id] !== x.ing.price).length;
    persist({ bought: {}, paid: {} });
    toast(`Compra registrada: ${done.length} insumos al inventario${changed ? `, ${changed} precios actualizados en las recetas` : ''}.`);
  }

  return (
    <>
      <div className="panel" style={{ display: 'grid', gap: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', gap: 14 }}>
          <div className="field"><label>Comprar para</label>
            <div className="chips">{[3, 7, 14].map((n) => <button key={n} className={`chip ${days === n ? 'on' : ''}`} onClick={() => setDays(n)}>{n} días</button>)}</div></div>
          <div className="field"><label htmlFor="cfg-merma">Merma</label>
            <select id="cfg-merma" value={restaurant.shop_merma} onChange={(e) => updateRestaurant({ shop_merma: parseFloat(e.target.value) })}>
              {[0, 0.05, 0.1, 0.15].map((m) => <option key={m} value={m}>{pct(m)}</option>)}
            </select></div>
          <label className="check"><input type="checkbox" checked={restaurant.shop_keep_min} onChange={(e) => updateRestaurant({ shop_keep_min: e.target.checked })} /> Dejar stock mínimo</label>
        </div>
        <div className="kpis fit">
          <div className="kpi hero"><span className="eyebrow">Costo estimado</span><span className="v">{money(total)}</span><span className="s">{rows.length} insumos</span></div>
          <div className="kpi"><span className="eyebrow">Reservas cubiertas</span><span className="v">{resIn.length}</span><span className="s">{resIn.reduce((a, r) => a + r.people, 0)} comensales</span></div>
          <div className="kpi"><span className="eyebrow">Comprado</span><span className="v">{bought}/{rows.length}</span>
            <div className="progress" style={{ marginTop: 6 }}><i style={{ width: `${rows.length ? (bought / rows.length) * 100 : 0}%` }} /></div></div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => rows.length ? copy(`Lista de mercado ${restaurant.name} (${days} días)\n\n${[...groups].map(([sup, xs]) => `${sup}\n${lines(xs)}`).join('\n\n')}`, 'Lista copiada.') : toast('No hay nada por comprar.')}>Copiar lista completa</button>
          <button className="btn primary" disabled={busy} onClick={register}>{busy ? 'Registrando…' : 'Registrar compra en inventario'}</button>
        </div>
      </div>
      {rows.length === 0 ? <div className="empty">Con el inventario actual cubres todas las reservas de este periodo.</div> : [...groups].map(([sup, xs]) => (
        <div key={sup} className="panel">
          <div className="sup-h"><h3>{sup}</h3>
            <div className="row"><span className="num muted" style={{ fontSize: 13 }}>{money(xs.reduce((a, x) => a + x.est, 0))}</span>
              <button className="btn sm" onClick={() => copy(`Hola, pedido para ${restaurant.name}:\n${lines(xs)}\nGracias.`, `Pedido para ${sup} copiado.`)}>Copiar pedido</button></div></div>
          {xs.map((x) => {
            const done = !!list.bought[x.ing.id];
            return (
              <div key={x.ing.id} className={`buy ${done ? 'done' : ''}`}>
                <input type="checkbox" checked={done} aria-label={`Comprado: ${x.ing.name}`} onChange={(e) => {
                  const b = { ...list.bought };
                  if (e.target.checked) b[x.ing.id] = true; else delete b[x.ing.id];
                  persist({ ...list, bought: b });
                }} />
                <div style={{ minWidth: 0 }}><div className="nm">{x.ing.name}</div>
                  <div className="sub">Necesitas {qf(x.need, x.ing.unit)} · tienes {qf(x.ing.stock, x.ing.unit)} · mín. {qf(x.ing.min_stock, x.ing.unit)}</div></div>
                <div className="q">{qf(x.buy, x.ing.unit)}</div>
                <div className="pp"><span className="num muted" style={{ fontSize: 12 }}>{money(x.est)} · {money(x.ing.price)}/{x.ing.unit}</span>
                  <input type="number" min={0} step={100} placeholder={`Precio real/${x.ing.unit}`} aria-label={`Precio pagado por ${x.ing.unit} de ${x.ing.name}`}
                    value={list.paid[x.ing.id] ?? ''} onChange={(e) => {
                      const p = { ...list.paid };
                      const v = parseFloat(e.target.value);
                      if (v > 0) p[x.ing.id] = v; else delete p[x.ing.id];
                      persist({ ...list, paid: p });
                    }} /></div>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
