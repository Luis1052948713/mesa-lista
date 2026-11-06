'use client';

import { addDays, fcClass, fmtDay, hora, money, pct, quote } from '@/lib/calc';
import { useStore } from '../store';
import { StatusPill } from '../ui';

export function Presupuestos() {
  const { reservations, today, dishMap, ingMap, restaurant, setModal } = useStore();
  const list = reservations
    .filter((r) => r.status !== 'cancelada' && r.date >= today && r.date < addDays(today, 14))
    .map((r) => ({ r, q: quote(r, dishMap, ingMap, restaurant) }));
  const sum = (k: 'sub' | 'cost' | 'total' | 'due') => list.reduce((a, x) => a + x.q[k], 0);
  const sub = sum('sub');
  const cost = sum('cost');
  const dep = list.reduce((a, x) => a + (x.r.deposit || 0), 0);

  return (
    <>
      <div className="head"><div><div className="eyebrow">Próximos 14 días</div><h2>Presupuesto por pedido</h2>
        <p>Cada plato tiene su receta con gramos y precio de cada insumo, así que el costo real de cada reserva se calcula solo. El precio de venta queda congelado cuando se hace el pedido.</p></div></div>
      <section className="kpis">
        <div className="kpi hero"><span className="eyebrow">Ventas pre-pedidas</span><span className="v">{money(sum('total'))}</span><span className="s">{list.length} reservas</span></div>
        <div className="kpi"><span className="eyebrow">Costo de insumos</span><span className="v">{money(cost)}</span><span className="s">Según recetas</span></div>
        <div className="kpi"><span className="eyebrow">Margen bruto</span><span className="v">{money(sub - cost)}</span><span className="s">Food cost {sub ? pct(cost / sub) : '—'}</span></div>
        <div className="kpi"><span className="eyebrow">Anticipos recibidos</span><span className="v">{money(dep)}</span><span className="s">Saldo por cobrar {money(sum('due'))}</span></div>
      </section>
      <div className="panel tw">
        {list.length === 0 ? <div className="empty">No hay reservas en los próximos 14 días.</div> : (
          <table>
            <thead><tr><th>Fecha</th><th>Cliente</th><th className="n">Pers.</th><th className="n">Venta</th><th className="n">Costo</th><th className="n">Margen</th><th className="n">Food cost</th><th className="n">Anticipo</th></tr></thead>
            <tbody>
              {list.map(({ r, q }) => (
                <tr key={r.id} className="click" onClick={() => setModal({ type: 'detail', id: r.id })}>
                  <td style={{ whiteSpace: 'nowrap' }}><span className="mono">{fmtDay(r.date)} {hora(r.time)}</span></td>
                  <td><b>{r.customer_name}</b><br /><span style={{ display: 'inline-block', marginTop: 3 }}><StatusPill status={r.status} /></span></td>
                  <td className="n">{r.people}</td>
                  <td className="n">{q.sub ? money(q.sub) : <span className="tag">Sin pre-pedido</span>}</td>
                  <td className="n">{q.sub ? money(q.cost) : '—'}</td>
                  <td className="n">{q.sub ? money(q.margin) : '—'}</td>
                  <td className="n">{q.sub ? <span className={`fc ${fcClass(q.fc)}`}>{pct(q.fc)}</span> : '—'}</td>
                  <td className="n">{r.deposit ? money(r.deposit) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={3}>Total</td><td className="n">{money(sub)}</td><td className="n">{money(cost)}</td><td className="n">{money(sub - cost)}</td><td className="n">{sub ? pct(cost / sub) : '—'}</td><td className="n">{money(dep)}</td></tr></tfoot>
          </table>
        )}
      </div>
    </>
  );
}
