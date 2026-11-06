'use client';

import { useMemo, useState } from 'react';
import { fcClass, fromSmall, localParts, money, pct, qf, smallUnit, toSmall, UNIT_LABEL } from '@/lib/calc';
import type { DiningTable, Dish, FloorItem, FloorKind, Ingredient, ItemKind, Purchase, TableShape, Unit, Zone } from '@/lib/types';
import { FLOORS, ITEM_KINDS } from './floorArt';
import { useStore } from './store';
import { ConfirmButton, ModalHead } from './ui';

const CATEGORIES = ['Entrada', 'Plato fuerte', 'Bebida', 'Postre', 'Acompañamiento'];
const numOr0 = (v: string) => (v.trim() === '' ? 0 : Number(v.replace(',', '.')));

function Footer({ busy, saveLabel, onDelete, deleteLabel, confirmLabel }: {
  busy: boolean; saveLabel: string; onDelete?: () => void; deleteLabel?: string; confirmLabel?: string;
}) {
  const { setModal } = useStore();
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <div>{onDelete && <ConfirmButton label={deleteLabel ?? 'Borrar'} confirmLabel={confirmLabel ?? 'Toca otra vez para borrar'} onConfirm={onDelete} />}</div>
      <div className="row">
        <button type="button" className="btn" onClick={() => setModal(null)}>Cancelar</button>
        <button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : saveLabel}</button>
      </div>
    </div>
  );
}

/* ---------- plato y receta ---------- */

type Line = { key: number; ingredient_id: string; amount: string };

export function DishForm({ dish }: { dish?: Dish }) {
  const { dishes, ingredients, ingMap, saveDish, deleteDish, setDishPhoto, setModal, toast } = useStore();
  const [name, setName] = useState(dish?.name ?? '');
  const [category, setCategory] = useState(dish?.category ?? 'Plato fuerte');
  const [price, setPrice] = useState(dish ? String(dish.price) : '');
  const [active, setActive] = useState(dish?.active ?? true);
  const [description, setDescription] = useState(dish?.description ?? '');
  const [photoBusy, setPhotoBusy] = useState(false);
  // La foto se muestra desde el store para ver el cambio apenas se sube.
  const photo = dishes.find((d) => d.id === dish?.id)?.photo_url ?? '';
  const [lines, setLines] = useState<Line[]>(() => (dish?.recipe ?? []).map((l, i) => {
    const u = ingMap.get(l.ingredient_id)?.unit ?? 'kg';
    return { key: i, ingredient_id: l.ingredient_id, amount: String(toSmall(l.qty, u)) };
  }));
  const [nextKey, setNextKey] = useState(1000);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sorted = useMemo(() => [...ingredients].sort((a, b) => a.name.localeCompare(b.name, 'es')), [ingredients]);
  const categories = [...new Set([...CATEGORIES, ...dishes.map((d) => d.category)])];

  const recipe = lines.flatMap((l) => {
    const g = ingMap.get(l.ingredient_id);
    const amount = numOr0(l.amount);
    return g && amount > 0 ? [{ ingredient_id: g.id, qty: fromSmall(amount, g.unit), cost: fromSmall(amount, g.unit) * g.price }] : [];
  });
  const cost = recipe.reduce((a, l) => a + l.cost, 0);
  const p = numOr0(price);
  const fc = p > 0 ? cost / p : 0;
  const setLine = (key: number, patch: Partial<Line>) => setLines((xs) => xs.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('Escribe el nombre del plato.');
    if (!(p > 0)) return setError('El precio de venta debe ser mayor que cero.');
    if (lines.some((l) => !l.ingredient_id || !(numOr0(l.amount) > 0))) return setError('Cada línea de la receta necesita un insumo y una cantidad mayor que cero, o quítala.');
    setBusy(true);
    const err = await saveDish(dish?.id ?? null, { name: name.trim(), category, price: p, active, description, recipe });
    setBusy(false);
    if (err) return setError(err);
    setModal(null);
    toast(dish ? `${name.trim()} actualizado.` : `${name.trim()} agregado al menú.`);
  }

  async function remove() {
    const err = await deleteDish(dish!.id);
    if (err) return setError(err);
    setModal(null);
    toast(`${dish!.name} borrado del menú.`);
  }

  return (
    <>
      <ModalHead eyebrow="Menú y recetas" title={dish ? 'Editar plato' : 'Nuevo plato'} />
      <form className="m-body" onSubmit={submit} noValidate>
        <div className="fgrid">
          <div className="field"><label htmlFor="d-name">Nombre</label>
            <input id="d-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Arroz con pollo" autoFocus /></div>
          <div className="field"><label htmlFor="d-cat">Categoría</label>
            <input id="d-cat" type="text" list="d-cats" value={category} onChange={(e) => setCategory(e.target.value)} />
            <datalist id="d-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></div>
          <div className="field"><label htmlFor="d-price">Precio de venta (COP)</label>
            <input id="d-price" type="number" min={0} step={500} value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          <label className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Disponible (sale en la carta)</label>
          <div className="field full" style={{ gridColumn: '1 / -1' }}><label htmlFor="d-desc">Descripción para la carta</label>
            <textarea id="d-desc" rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Ej. Fríjoles, arroz, chicharrón, chorizo, huevo, maduro, aguacate y arepa." /></div>
        </div>
        <div className="dish-photo">
          <div className="dish-photo-prev">
            {/* eslint-disable-next-line @next/next/no-img-element -- foto en Supabase Storage */}
            {photo ? <img src={photo} alt={`Foto de ${name}`} /> : <span className="muted" style={{ fontSize: 12 }}>Sin foto</span>}
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <b>Foto para la carta</b>
            {dish ? (
              <div className="row">
                <label className="btn sm" style={{ cursor: 'pointer' }}>
                  {photoBusy ? 'Subiendo…' : photo ? 'Cambiar foto' : 'Subir foto'}
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/heic" hidden disabled={photoBusy} onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    setPhotoBusy(true);
                    const err = await setDishPhoto(dish.id, f);
                    setPhotoBusy(false);
                    toast(err ?? 'Foto del plato actualizada.', err ? 'alert' : undefined);
                  }} />
                </label>
                {photo && <button type="button" className="btn sm ghost" onClick={async () => {
                  const err = await setDishPhoto(dish.id, null);
                  toast(err ?? 'Foto quitada.', err ? 'alert' : undefined);
                }}>Quitar</button>}
              </div>
            ) : <span className="muted" style={{ fontSize: 13 }}>Guarda el plato primero y luego le subes la foto.</span>}
          </div>
        </div>

        <div>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <h3>Receta por porción</h3>
            <button type="button" className="btn sm" onClick={() => { setLines((xs) => [...xs, { key: nextKey, ingredient_id: '', amount: '' }]); setNextKey((k) => k + 1); }}>+ Agregar insumo</button>
          </div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>Los insumos en kg o litros se escriben en gramos o mililitros. ¿Falta un insumo? Créalo primero en Inventario.</p>
          {lines.length === 0 ? <div className="empty">Sin receta. Agrega los insumos de una porción para calcular el costo y la lista de compras.</div> : (
            <div className="rec-rows">
              {lines.map((l) => {
                const g = ingMap.get(l.ingredient_id);
                const amount = numOr0(l.amount);
                return (
                  <div key={l.key} className="rec-row">
                    <select aria-label="Insumo" value={l.ingredient_id} onChange={(e) => setLine(l.key, { ingredient_id: e.target.value })}>
                      <option value="">Elige un insumo…</option>
                      {sorted.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                    <div className="qty-in">
                      <input type="number" min={0} step={g?.unit === 'und' ? 0.25 : 5} aria-label="Cantidad" value={l.amount}
                        onChange={(e) => setLine(l.key, { amount: e.target.value })} />
                      <span className="muted">{g ? smallUnit(g.unit) : ''}</span>
                    </div>
                    <span className="num muted rec-cost">{g && amount > 0 ? money(fromSmall(amount, g.unit) * g.price) : '—'}</span>
                    <button type="button" className="x sm-x" aria-label="Quitar línea" onClick={() => setLines((xs) => xs.filter((x) => x.key !== l.key))}>×</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="summary">
          <span>Costo por porción <b>{money(cost)}</b></span>
          <span>Margen <b>{money(p - cost)}</b></span>
          <span>Food cost <b>{p > 0 ? pct(fc) : '—'}</b></span>
          {p > 0 && fcClass(fc) === 'bad' && <span>Para 32 %: <b>{money(Math.ceil(cost / 0.32 / 1000) * 1000)}</b></span>}
        </div>
        {error && <div className="err" role="alert">{error}</div>}
        <Footer busy={busy} saveLabel={dish ? 'Guardar cambios' : 'Agregar plato'} onDelete={dish ? remove : undefined} deleteLabel="Borrar plato" />
      </form>
    </>
  );
}

/* ---------- insumo ---------- */

export function IngredientForm({ ingredient }: { ingredient?: Ingredient }) {
  const { ingredients, dishes, saveIngredient, deleteIngredient, setModal, toast } = useStore();
  const [name, setName] = useState(ingredient?.name ?? '');
  const [unit, setUnit] = useState<Unit>(ingredient?.unit ?? 'kg');
  const [price, setPrice] = useState(ingredient ? String(ingredient.price) : '');
  const [supplier, setSupplier] = useState(ingredient?.supplier ?? '');
  const [stock, setStock] = useState(ingredient ? String(ingredient.stock) : '0');
  const [min, setMin] = useState(ingredient ? String(ingredient.min_stock) : '0');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const suppliers = [...new Set(ingredients.map((i) => i.supplier).filter(Boolean))].sort();
  const usedIn = ingredient ? dishes.filter((d) => d.recipe.some((r) => r.ingredient_id === ingredient.id)) : [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('Escribe el nombre del insumo.');
    const values = [numOr0(price), numOr0(stock), numOr0(min)];
    if (values.some((v) => Number.isNaN(v) || v < 0)) return setError('Precio, stock y mínimo deben ser números de cero en adelante.');
    setBusy(true);
    const err = await saveIngredient(ingredient?.id ?? null, { name, unit, price: values[0], supplier, stock: values[1], min_stock: values[2] });
    setBusy(false);
    if (err) return setError(err);
    setModal(null);
    toast(ingredient ? `${name.trim()} actualizado.` : `${name.trim()} agregado al inventario.`);
  }

  async function remove() {
    const err = await deleteIngredient(ingredient!.id);
    if (err) return setError(err);
    setModal(null);
    toast(usedIn.length
      ? `${ingredient!.name} borrado del inventario y quitado de: ${usedIn.map((d) => d.name).join(', ')}.`
      : `${ingredient!.name} borrado del inventario.`);
  }

  return (
    <>
      <ModalHead eyebrow="Inventario" title={ingredient ? 'Editar insumo' : 'Nuevo insumo'} />
      <form className="m-body" onSubmit={submit} noValidate>
        <div className="fgrid">
          <div className="field"><label htmlFor="i-name">Nombre</label>
            <input id="i-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Cilantro" autoFocus /></div>
          <div className="field"><label htmlFor="i-unit">Unidad de compra</label>
            <select id="i-unit" value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
              {(Object.keys(UNIT_LABEL) as Unit[]).map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
            </select></div>
          <div className="field"><label htmlFor="i-price">Precio por {unit} (COP)</label>
            <input id="i-price" type="number" min={0} step={100} value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          <div className="field"><label htmlFor="i-sup">Proveedor</label>
            <input id="i-sup" type="text" list="i-sups" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Ej. Plaza de Paloquemao" />
            <datalist id="i-sups">{suppliers.map((s) => <option key={s} value={s} />)}</datalist></div>
          <div className="field"><label htmlFor="i-stock">Stock actual ({unit})</label>
            <input id="i-stock" type="number" min={0} step={unit === 'und' ? 1 : 0.05} value={stock} onChange={(e) => setStock(e.target.value)} /></div>
          <div className="field"><label htmlFor="i-min">Stock mínimo ({unit})</label>
            <input id="i-min" type="number" min={0} step={unit === 'und' ? 1 : 0.05} value={min} onChange={(e) => setMin(e.target.value)} /></div>
        </div>
        {ingredient && unit !== ingredient.unit && usedIn.length > 0 && (
          <div className="callout amber">Cambiar la unidad no convierte las recetas. Revisa las cantidades en: {usedIn.map((d) => d.name).join(', ')}.</div>
        )}
        {usedIn.length > 0 && (
          <p className="muted" style={{ fontSize: 13 }}>
            Se usa en {usedIn.length} {usedIn.length === 1 ? 'receta' : 'recetas'}: <b>{usedIn.map((d) => d.name).join(', ')}</b>.
            Si lo borras, se quita de {usedIn.length === 1 ? 'esa receta' : 'esas recetas'} y su costo baja.
          </p>
        )}
        {error && <div className="err" role="alert">{error}</div>}
        <Footer busy={busy} saveLabel={ingredient ? 'Guardar cambios' : 'Agregar insumo'} onDelete={ingredient ? remove : undefined}
          deleteLabel={usedIn.length ? `Borrar y quitar de ${usedIn.length} ${usedIn.length === 1 ? 'receta' : 'recetas'}` : 'Borrar insumo'}
          confirmLabel={usedIn.length ? 'Toca otra vez para confirmar' : 'Toca otra vez: borra también sus compras'} />
      </form>
    </>
  );
}

/* ---------- compra ---------- */

export function PurchaseForm({ purchase, ingredientId }: { purchase?: Purchase; ingredientId?: string }) {
  const { ingredients, ingMap, restaurant, today, savePurchase, deletePurchase, setModal, toast } = useStore();
  const sorted = useMemo(() => [...ingredients].sort((a, b) => a.name.localeCompare(b.name, 'es')), [ingredients]);
  const [ing, setIng] = useState(purchase?.ingredient_id ?? ingredientId ?? '');
  const g = ingMap.get(ing);
  const [qty, setQty] = useState(purchase ? String(purchase.qty) : '');
  const [price, setPrice] = useState(purchase ? String(purchase.unit_price) : g ? String(g.price) : '');
  const [date, setDate] = useState(purchase ? localParts(purchase.bought_at, restaurant.timezone).date : today);
  const [note, setNote] = useState(purchase?.note ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const q = numOr0(qty);
  const p = numOr0(price);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!g) return setError('Elige el insumo que compraste.');
    if (!(q > 0)) return setError('La cantidad debe ser mayor que cero.');
    if (Number.isNaN(p) || p < 0) return setError('El precio no puede ser negativo.');
    if (!date) return setError('Elige la fecha de la compra.');
    setBusy(true);
    const err = await savePurchase(purchase?.id ?? null, { ingredient_id: g.id, qty: q, unit_price: p, date, note });
    setBusy(false);
    if (err) return setError(err);
    setModal(null);
    toast(purchase ? 'Compra actualizada. El stock se ajustó a la diferencia.' : `Compra registrada: +${qf(q, g.unit)} de ${g.name}.`);
  }

  async function remove() {
    const err = await deletePurchase(purchase!.id);
    if (err) return setError(err);
    setModal(null);
    toast('Compra borrada. Se restó del stock.');
  }

  return (
    <>
      <ModalHead eyebrow="Compras" title={purchase ? 'Editar compra' : 'Registrar compra'} />
      <form className="m-body" onSubmit={submit} noValidate>
        <div className="fgrid">
          <div className="field"><label htmlFor="p-ing">Insumo</label>
            <select id="p-ing" value={ing} autoFocus onChange={(e) => {
              setIng(e.target.value);
              const n = ingMap.get(e.target.value);
              if (n && !purchase) setPrice(String(n.price));
            }}>
              <option value="">Elige un insumo…</option>
              {sorted.map((i) => <option key={i.id} value={i.id}>{i.name}{i.supplier ? ` · ${i.supplier}` : ''}</option>)}
            </select></div>
          <div className="field"><label htmlFor="p-date">Fecha</label>
            <input id="p-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="field"><label htmlFor="p-qty">Cantidad{g ? ` (${g.unit})` : ''}</label>
            <input id="p-qty" type="number" min={0} step={g?.unit === 'und' ? 1 : 0.05} value={qty} onChange={(e) => setQty(e.target.value)} /></div>
          <div className="field"><label htmlFor="p-price">Precio pagado por {g?.unit ?? 'unidad'} (COP)</label>
            <input id="p-price" type="number" min={0} step={100} value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          <div className="field full" style={{ gridColumn: '1 / -1' }}><label htmlFor="p-note">Nota (opcional)</label>
            <input id="p-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej. factura 0452, llegó con 1 kg de más" /></div>
        </div>
        <div className="summary">
          <span>Total <b>{money(q * p)}</b></span>
          {g && <span>Stock después <b>{qf(Math.max(0, g.stock - (purchase && purchase.ingredient_id === g.id ? purchase.qty : 0) + q), g.unit)}</b></span>}
          {!purchase && g && p > 0 && p !== g.price && <span>Precio en recetas: {money(g.price)} → <b>{money(p)}</b></span>}
        </div>
        {error && <div className="err" role="alert">{error}</div>}
        <Footer busy={busy} saveLabel={purchase ? 'Guardar cambios' : 'Registrar compra'} onDelete={purchase ? remove : undefined}
          deleteLabel="Borrar compra" confirmLabel="Toca otra vez: se resta del stock" />
      </form>
    </>
  );
}

/* ---------- mesa ---------- */

const SHAPES: Record<TableShape, string> = { auto: 'Automática (redonda hasta 4 puestos)', round: 'Redonda', rect: 'Rectangular' };

function nextTableName(tables: DiningTable[]) {
  const n = Math.max(0, ...tables.map((t) => Number(/^T(\d+)$/i.exec(t.name)?.[1] ?? 0)));
  return `T${n + 1}`;
}

export function TableForm({ table, zone }: { table?: DiningTable; zone?: string }) {
  const { tables, zones, reservations, now, saveTable, deleteTable, setModal, toast } = useStore();
  const [name, setName] = useState(table?.name ?? nextTableName(tables));
  const [seats, setSeats] = useState(String(table?.seats ?? 4));
  const [zoneName, setZoneName] = useState(table?.zone ?? zone ?? zones[0]?.name ?? '');
  const [shape, setShape] = useState<TableShape>(table?.shape ?? 'auto');
  const [active, setActive] = useState(table?.active ?? true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const upcoming = table ? reservations.filter((r) => r.table_id === table.id && (r.status === 'pendiente' || r.status === 'confirmada') && new Date(r.ends_at).getTime() > now) : [];
  const s = parseInt(seats) || 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('Escribe el nombre de la mesa, por ejemplo T14.');
    if (name.trim().length > 20) return setError('El nombre de la mesa puede tener hasta 20 letras.');
    if (s < 1 || s > 60) return setError('Los puestos deben estar entre 1 y 60.');
    if (!zoneName) return setError('Crea primero una zona para poner la mesa.');
    setBusy(true);
    const err = await saveTable(table?.id ?? null, { name, seats: s, zone: zoneName, shape, active });
    setBusy(false);
    if (err) return setError(err);
    setModal(null);
    toast(table ? `Mesa ${name.trim()} actualizada.` : `Mesa ${name.trim()} agregada. Arrástrala a su lugar en el plano.`);
  }

  async function remove() {
    if (upcoming.length) return setError(`La mesa tiene ${upcoming.length} ${upcoming.length === 1 ? 'reserva próxima' : 'reservas próximas'}. Muévelas a otra mesa o desmarca "Disponible" en lugar de borrarla.`);
    const err = await deleteTable(table!.id);
    if (err) return setError(err);
    setModal(null);
    toast(`Mesa ${table!.name} borrada.`);
  }

  return (
    <>
      <ModalHead eyebrow="Plano del restaurante" title={table ? `Editar mesa ${table.name}` : 'Nueva mesa'} />
      <form className="m-body" onSubmit={submit} noValidate>
        <div className="fgrid">
          <div className="field"><label htmlFor="t-name">Nombre</label>
            <input id="t-name" type="text" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
          <div className="field"><label htmlFor="t-seats">Puestos</label>
            <input id="t-seats" type="number" min={1} max={60} value={seats} onChange={(e) => setSeats(e.target.value)} /></div>
          <div className="field"><label htmlFor="t-zone">Zona</label>
            <select id="t-zone" value={zoneName} onChange={(e) => setZoneName(e.target.value)}>
              {zones.map((z) => <option key={z.id} value={z.name}>{z.name}</option>)}
            </select></div>
          <div className="field"><label htmlFor="t-shape">Forma</label>
            <select id="t-shape" value={shape} onChange={(e) => setShape(e.target.value as TableShape)}>
              {(Object.keys(SHAPES) as TableShape[]).map((k) => <option key={k} value={k}>{SHAPES[k]}</option>)}
            </select></div>
        </div>
        <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Disponible para reservar</label>
        {!active && <p className="muted" style={{ fontSize: 13 }}>Una mesa no disponible no aparece en el salón ni se asigna en las reservas nuevas. Sirve para mesas en reparación o de temporada.</p>}
        {upcoming.length > 0 && <p className="muted" style={{ fontSize: 13 }}>Tiene {upcoming.length} {upcoming.length === 1 ? 'reserva próxima' : 'reservas próximas'}.</p>}
        {table && s > 0 && upcoming.some((r) => r.people > s) && (
          <div className="callout amber">Hay reservas próximas con más personas que {s} puestos en esta mesa. Revísalas en la Agenda.</div>
        )}
        {error && <div className="err" role="alert">{error}</div>}
        <Footer busy={busy} saveLabel={table ? 'Guardar cambios' : 'Agregar mesa'} onDelete={table ? remove : undefined} deleteLabel="Borrar mesa" />
      </form>
    </>
  );
}

/* ---------- zona ---------- */

export function ZoneForm({ zone }: { zone?: Zone }) {
  const { tables, saveZone, deleteZone, setModal, toast } = useStore();
  const [name, setName] = useState(zone?.name ?? '');
  const [floor, setFloor] = useState<FloorKind>(zone?.floor ?? 'madera');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inZone = zone ? tables.filter((t) => t.zone === zone.name) : [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('Escribe el nombre de la zona, por ejemplo Terraza o Segundo piso.');
    if (name.trim().length > 30) return setError('El nombre de la zona puede tener hasta 30 letras.');
    setBusy(true);
    const err = await saveZone(zone?.id ?? null, { name, floor });
    setBusy(false);
    if (err) return setError(err);
    setModal(null);
    toast(zone ? `Zona renombrada a ${name.trim()}.` : `Zona ${name.trim()} agregada. Arrástrala y ajusta su tamaño desde la esquina.`);
  }

  async function remove() {
    if (inZone.length) return setError(`La zona tiene ${inZone.length} ${inZone.length === 1 ? 'mesa' : 'mesas'} (${inZone.map((t) => t.name).join(', ')}). Muévelas a otra zona o bórralas primero.`);
    const err = await deleteZone(zone!.id);
    if (err) return setError(err);
    setModal(null);
    toast(`Zona ${zone!.name} borrada.`);
  }

  return (
    <>
      <ModalHead eyebrow="Plano del restaurante" title={zone ? `Editar zona ${zone.name}` : 'Nueva zona'} />
      <form className="m-body" onSubmit={submit} noValidate>
        <div className="field"><label htmlFor="z-name">Nombre</label>
          <input id="z-name" type="text" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Segundo piso, Barra, Jardín" autoFocus /></div>
        <div className="field"><label>Piso</label>
          <div className="chips">{(Object.keys(FLOORS) as FloorKind[]).map((k) => (
            <button type="button" key={k} className={`chip floor-chip ${floor === k ? 'on' : ''}`} aria-pressed={floor === k} onClick={() => setFloor(k)}>
              <i className={`swatch floor-${k}`} aria-hidden="true" /> {FLOORS[k]}
            </button>
          ))}</div></div>
        {zone && <p className="muted" style={{ fontSize: 13 }}>{inZone.length ? `Tiene ${inZone.length} ${inZone.length === 1 ? 'mesa' : 'mesas'}: ${inZone.map((t) => t.name).join(', ')}. Al renombrarla, sus mesas se cambian solas.` : 'No tiene mesas.'}</p>}
        {error && <div className="err" role="alert">{error}</div>}
        <Footer busy={busy} saveLabel={zone ? 'Guardar cambios' : 'Agregar zona'} onDelete={zone ? remove : undefined} deleteLabel="Borrar zona" />
      </form>
    </>
  );
}

/* ---------- elemento del plano (barra, puerta…) ---------- */

export function ItemForm({ item }: { item?: FloorItem }) {
  const { saveItem, deleteItem, setModal, toast } = useStore();
  const [kind, setKind] = useState<ItemKind>(item?.kind ?? 'barra');
  const [label, setLabel] = useState(item?.label ?? '');
  const [rotation, setRotation] = useState(item?.rotation ?? 0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (label.trim().length > 30) return setError('El texto puede tener hasta 30 letras.');
    setBusy(true);
    const err = await saveItem(item?.id ?? null, { kind, label, rotation });
    setBusy(false);
    if (err) return setError(err);
    setModal(null);
    toast(item ? 'Elemento actualizado.' : `${ITEM_KINDS[kind].label} agregado. Arrástralo a su lugar y usa la esquina para cambiar su tamaño.`);
  }

  async function remove() {
    const err = await deleteItem(item!.id);
    if (err) return setError(err);
    setModal(null);
    toast(`${ITEM_KINDS[item!.kind].label} quitado del plano.`);
  }

  return (
    <>
      <ModalHead eyebrow="Plano del restaurante" title={item ? `Editar ${ITEM_KINDS[item.kind].label.toLowerCase()}` : 'Agregar elemento'} />
      <form className="m-body" onSubmit={submit} noValidate>
        <div className="field"><label>Qué es</label>
          <div className="chips">{(Object.keys(ITEM_KINDS) as ItemKind[]).map((k) => (
            <button type="button" key={k} className={`chip ${kind === k ? 'on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{ITEM_KINDS[k].label}</button>
          ))}</div></div>
        <div className="fgrid">
          <div className="field"><label htmlFor="it-label">Texto (opcional)</label>
            <input id="it-label" type="text" maxLength={30} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={ITEM_KINDS[kind].label} /></div>
          <div className="field"><label>Girar</label>
            <div className="chips">{([0, 90, 180, 270] as const).map((r) => (
              <button type="button" key={r} className={`chip ${rotation === r ? 'on' : ''}`} aria-pressed={rotation === r} onClick={() => setRotation(r)}>{r}°</button>
            ))}</div></div>
        </div>
        {error && <div className="err" role="alert">{error}</div>}
        <Footer busy={busy} saveLabel={item ? 'Guardar cambios' : 'Agregar al plano'} onDelete={item ? remove : undefined} deleteLabel="Quitar del plano" />
      </form>
    </>
  );
}
