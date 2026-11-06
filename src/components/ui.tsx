'use client';

import { depositLabel, fmtDay, fmtLong, hora, money, pct, quote, STATUS_LABEL } from '@/lib/calc';
import type { Reservation } from '@/lib/types';
import { useStore } from './store';

export function ModalHead({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  const { setModal } = useStore();
  return (
    <div className="m-head">
      <div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2>{children}</div>
      <button className="x" type="button" onClick={() => setModal(null)} aria-label="Cerrar">×</button>
    </div>
  );
}

export function StatusPill({ status }: { status: Reservation['status'] }) {
  return <span className={`pill p-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function ResItem({ r, showDate }: { r: Reservation; showDate?: boolean }) {
  const { dishMap, ingMap, restaurant, tableMap, setModal } = useStore();
  const q = quote(r, dishMap, ingMap, restaurant);
  const t = r.table_id ? tableMap.get(r.table_id) : undefined;
  return (
    <button className="item" onClick={() => setModal({ type: 'detail', id: r.id })}>
      <div className="time">{hora(r.time)}{showDate && <small>{fmtDay(r.date)}</small>}</div>
      <div style={{ minWidth: 0 }}>
        <div className="who">{r.customer_name}</div>
        <div className="meta">
          <span>{r.people} pers.</span>
          <span>{t ? `${t.name} · ${t.zone}` : 'Sin mesa'}</span>
          {r.occasion && <span>{r.occasion}</span>}
          {r.allergies && <span className="tag alert">{r.allergies}</span>}
          {!r.items.length && <span className="tag">Sin pre-pedido</span>}
          {r.confirmed_via === 'whatsapp' && <span className="tag good">Confirmó por WhatsApp</span>}
          {r.source === 'web' && <span className="tag">En línea</span>}
          {(r.deposit_status === 'esperando' || r.deposit_status === 'comprobante') && r.status === 'pendiente' &&
            <span className={`tag ${r.deposit_status === 'comprobante' ? 'alert' : ''}`}>{depositLabel(r.deposit_status, r.deposit_method)}</span>}
          {r.deposit_status === 'pagado' && <span className="tag good">{depositLabel('pagado', r.deposit_method)}</span>}
        </div>
      </div>
      <div className="right">
        <StatusPill status={r.status} />
        {q.sub > 0 && <span className="num" style={{ fontSize: 13 }}>{money(q.total)}</span>}
      </div>
    </button>
  );
}

export function Ticket({ r }: { r: Reservation }) {
  const { dishMap, ingMap, restaurant } = useStore();
  const q = quote(r, dishMap, ingMap, restaurant);
  if (!q.lines.length) {
    return <div className="callout amber">Esta reserva no tiene pre-pedido. Edítala para agregar platos y calcular el presupuesto.</div>;
  }
  return (
    <div className="ticket">
      <div className="tt">{restaurant.name} · Cotización</div>
      <div className="ts">R-{r.code} · {fmtDay(r.date)} · {hora(r.time)} · {r.people} pers.</div>
      <hr />
      {q.lines.map((l) => (
        <div className="ln" key={l.dish.id}><span>{l.qty} × {l.dish.name}</span><span>{money(l.total)}</span></div>
      ))}
      <hr />
      <div className="ln"><span>Subtotal</span><span>{money(q.sub)}</span></div>
      <div className="ln"><span>Impoconsumo {pct(restaurant.inc_rate)}</span><span>{money(q.inc)}</span></div>
      <div className="ln big"><span>Total</span><span>{money(q.total)}</span></div>
      {r.deposit > 0 && <>
        <div className="ln"><span>Anticipo{r.deposit_method ? ` (${r.deposit_method})` : ''}</span><span>− {money(r.deposit)}</span></div>
        <div className="ln big"><span>Saldo</span><span>{money(q.due)}</span></div>
      </>}
      <div className="ln dim"><span>Propina sugerida {pct(restaurant.tip_rate)} (voluntaria)</span><span>{money(q.tip)}</span></div>
      <hr />
      <div className="ln dim"><span>Costo insumos (interno)</span><span>{money(q.cost)}</span></div>
      <div className="ln dim"><span>Margen · food cost</span><span>{money(q.margin)} · {pct(q.fc)}</span></div>
    </div>
  );
}

export function useQuoteText() {
  const { dishMap, ingMap, restaurant } = useStore();
  return (r: Reservation) => {
    const q = quote(r, dishMap, ingMap, restaurant);
    return [
      `${restaurant.name} · Cotización R-${r.code}`,
      `${r.customer_name} · ${fmtLong(r.date)} · ${hora(r.time)} · ${r.people} personas`, '',
      ...q.lines.map((l) => `${l.qty} × ${l.dish.name}: ${money(l.total)}`), '',
      `Subtotal: ${money(q.sub)}`, `Impoconsumo ${pct(restaurant.inc_rate)}: ${money(q.inc)}`, `Total: ${money(q.total)}`,
      ...(r.deposit ? [`Anticipo: ${money(r.deposit)}`, `Saldo: ${money(q.due)}`] : []),
      `Propina sugerida ${pct(restaurant.tip_rate)} (voluntaria): ${money(q.tip)}`,
    ].join('\n');
  };
}

/** Botón que pide un segundo toque antes de una acción destructiva. */
export function ConfirmButton({ label, confirmLabel, onConfirm, className = 'btn danger' }: {
  label: string; confirmLabel: string; onConfirm: () => void; className?: string;
}) {
  return (
    // type="button": dentro de un formulario, un botón sin tipo lo envía (guardaba en vez de borrar).
    <button
      type="button"
      className={className}
      onClick={(e) => {
        const el = e.currentTarget;
        if (el.dataset.armed) {
          onConfirm();
          return;
        }
        el.dataset.armed = '1';
        el.classList.add('armed');
        el.textContent = confirmLabel;
        setTimeout(() => {
          if (!el.isConnected) return;
          delete el.dataset.armed;
          el.classList.remove('armed');
          el.textContent = label;
        }, 3500);
      }}
    >
      {label}
    </button>
  );
}
