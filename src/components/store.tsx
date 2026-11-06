'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { localParts, normalizeRestaurant, todayIn, zonedToUtc } from '@/lib/calc';
import { resizeImage } from '@/lib/image';
import { ITEM_KINDS } from './floorArt';
import { createClient } from '@/lib/supabase/client';
import type {
  DiningTable, Dish, DishInput, Ingredient, IngredientInput, Purchase, PurchaseInput, Reminder, Reservation, ReservationInput,
  FloorItem, FloorKind, Geo, ItemKind, Restaurant, Status, TableInput, Zone,
} from '@/lib/types';

export type Modal =
  | { type: 'form'; reservation?: Reservation; preset?: Partial<Pick<ReservationInput, 'date' | 'time' | 'table_id' | 'people'>> }
  | { type: 'detail'; id: string }
  | { type: 'copy'; text: string }
  | { type: 'dish'; dish?: Dish }
  | { type: 'ingredient'; ingredient?: Ingredient }
  | { type: 'purchase'; purchase?: Purchase; ingredientId?: string }
  | { type: 'table'; table?: DiningTable; zone?: string }
  | { type: 'zone'; zone?: Zone }
  | { type: 'item'; item?: FloorItem };

type DbError = { message: string; code?: string };

/** Traduce los errores de Postgres a mensajes que se entienden en la cocina. */
function friendly(e: DbError, what: 'plato' | 'insumo' | 'compra' | 'mesa' | 'zona') {
  if (e.code === '23503') {
    if (what === 'plato') return 'Este plato ya está en reservas. Desactívalo para que no aparezca al reservar, en lugar de borrarlo.';
    if (what === 'insumo') return 'Este insumo se usa en recetas. Quítalo de esas recetas antes de borrarlo.';
    if (what === 'zona') return 'Esta zona tiene mesas. Muévelas a otra zona o bórralas antes de borrar la zona.';
    return 'Este registro está en uso.';
  }
  if (e.code === '23505') return `Ya existe ${what === 'mesa' || what === 'zona' || what === 'compra' ? 'una' : 'un'} ${what} con ese nombre.`;
  if (e.code === '23514') return 'Revisa los valores: hay un número negativo o un campo fuera de rango.';
  return e.message;
}

interface Toast { id: number; text: string; kind?: 'alert' }

interface StoreValue {
  restaurant: Restaurant;
  userEmail: string;
  waReady: boolean;
  loading: boolean;
  loadError: string;
  live: boolean;
  ingredients: Ingredient[];
  dishes: Dish[];
  tables: DiningTable[];
  reservations: Reservation[];
  purchases: Purchase[];
  zones: Zone[];
  floorItems: FloorItem[];
  ingMap: Map<string, Ingredient>;
  dishMap: Map<string, Dish>;
  tableMap: Map<string, DiningTable>;
  today: string;
  now: number;
  agendaDay: string;
  setAgendaDay: (d: string) => void;
  modal: Modal | null;
  setModal: (m: Modal | null) => void;
  toasts: Toast[];
  toast: (text: string, kind?: 'alert') => void;
  copy: (text: string, label?: string) => void;
  reload: () => Promise<void>;
  saveReservation: (id: string | null, input: ReservationInput) => Promise<string | null>;
  setStatus: (id: string, status: Status) => Promise<string | null>;
  markReminderSent: (reminderId: string) => Promise<void>;
  sendReminderNow: (reminderId: string) => Promise<void>;
  updateDishPrice: (id: string, price: number) => Promise<void>;
  updateStock: (id: string, stock: number) => Promise<void>;
  registerPurchase: (items: { ingredient_id: string; qty: number; unit_price: number | null }[]) => Promise<string | null>;
  updateRestaurant: (patch: Partial<Restaurant>) => Promise<string | null>;
  saveDish: (id: string | null, input: DishInput) => Promise<string | null>;
  deleteDish: (id: string) => Promise<string | null>;
  saveIngredient: (id: string | null, input: IngredientInput) => Promise<string | null>;
  deleteIngredient: (id: string) => Promise<string | null>;
  savePurchase: (id: string | null, input: PurchaseInput) => Promise<string | null>;
  deletePurchase: (id: string) => Promise<string | null>;
  saveTable: (id: string | null, input: TableInput) => Promise<string | null>;
  deleteTable: (id: string) => Promise<string | null>;
  moveTable: (id: string, patch: Partial<Pick<DiningTable, 'x' | 'y' | 'w' | 'h' | 'rotation'>>) => Promise<void>;
  saveZone: (id: string | null, input: { name: string; floor: FloorKind }) => Promise<string | null>;
  deleteZone: (id: string) => Promise<string | null>;
  moveZone: (id: string, box: Partial<Geo>) => Promise<void>;
  reviewDeposit: (id: string, approved: boolean, method?: 'transferencia' | 'efectivo') => Promise<string | null>;
  receiptUrl: (path: string) => Promise<string | null>;
  uploadBrand: (kind: BrandKind, file: File) => Promise<string | null>;
  saveItem: (id: string | null, input: { kind: ItemKind; label: string; rotation: number }) => Promise<string | null>;
  deleteItem: (id: string) => Promise<string | null>;
  moveItem: (id: string, box: Partial<Geo>) => Promise<void>;
  setPlanBackground: (file: File | null) => Promise<string | null>;
  setDishPhoto: (dishId: string, file: File | null) => Promise<string | null>;
  removeBrand: (kind: BrandKind) => Promise<string | null>;
}

export type BrandKind = 'logo' | 'cover' | 'payqr';
const BRAND_FIELD = { logo: 'logo_url', cover: 'cover_url', payqr: 'pay_qr_url' } as const;
// El QR se guarda más grande para que se pueda escanear sin problema.
const BRAND_SIZE = { logo: 512, cover: 1600, payqr: 1200 } as const;

const Ctx = createContext<StoreValue | null>(null);
export const useStore = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore fuera de StoreProvider');
  return v;
};

const num = (v: unknown) => Number(v ?? 0);

export function StoreProvider({ initialRestaurant, userEmail, waReady, children }: {
  initialRestaurant: Restaurant; userEmail: string; waReady: boolean; children: React.ReactNode;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [restaurant, setRestaurant] = useState(initialRestaurant);
  const rid = restaurant.id;
  const tz = restaurant.timezone;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [live, setLive] = useState(false);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [floorItems, setFloorItems] = useState<FloorItem[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [agendaDay, setAgendaDay] = useState(() => todayIn(tz));
  const [modal, setModal] = useState<Modal | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const toast = useCallback((text: string, kind?: 'alert') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'alert' ? 8000 : 4200);
  }, []);

  const copy = useCallback((text: string, label = 'Copiado') => {
    try {
      navigator.clipboard.writeText(text).then(() => toast(label), () => setModal({ type: 'copy', text }));
    } catch {
      setModal({ type: 'copy', text });
    }
  }, [toast]);

  const reload = useCallback(async () => {
    const since = new Date(Date.now() - 3 * 864e5).toISOString();
    const boughtSince = new Date(Date.now() - 120 * 864e5).toISOString();
    const [ing, dis, tab, res, pur, zon, itm] = await Promise.all([
      supabase.from('ingredients').select('id,name,unit,price,supplier,stock,min_stock').eq('restaurant_id', rid).order('name'),
      supabase.from('dishes').select('id,name,category,price,active,sort,description,photo_url,recipe_items(ingredient_id,qty)').eq('restaurant_id', rid).order('sort'),
      supabase.from('dining_tables').select('id,name,seats,zone,x,y,active,shape,w,h,rotation').eq('restaurant_id', rid).order('name'),
      supabase.from('reservations')
        .select('*, reservation_items(dish_id,qty,unit_price), reminders(id,reservation_id,kind,send_at,status,channel,sent_at,error,attempts)')
        .eq('restaurant_id', rid).gte('starts_at', since).order('starts_at').limit(2000),
      supabase.from('purchases').select('id,ingredient_id,qty,unit_price,bought_at,note')
        .eq('restaurant_id', rid).gte('bought_at', boughtSince).order('bought_at', { ascending: false }).limit(1000),
      supabase.from('zones').select('id,name,x,y,w,h,sort,floor,rotation').eq('restaurant_id', rid).order('sort').order('name'),
      supabase.from('floor_items').select('id,kind,label,x,y,w,h,rotation').eq('restaurant_id', rid).order('created_at'),
    ]);
    const err = ing.error || dis.error || tab.error || res.error || pur.error || zon.error || itm.error;
    if (err) {
      setLoadError(`No se pudieron cargar los datos: ${err.message}`);
      setLoading(false);
      return;
    }
    setLoadError('');
    setIngredients((ing.data ?? []).map((i) => ({ ...i, price: num(i.price), stock: num(i.stock), min_stock: num(i.min_stock) })));
    setDishes((dis.data ?? []).map((d) => ({
      id: d.id, name: d.name, category: d.category, price: num(d.price), active: d.active, sort: d.sort,
      description: d.description ?? '', photo_url: d.photo_url ?? '',
      recipe: (d.recipe_items ?? []).map((r: { ingredient_id: string; qty: unknown }) => ({ ingredient_id: r.ingredient_id, qty: num(r.qty) })),
    })));
    setTables((tab.data ?? []).map((t) => ({ ...t, x: num(t.x), y: num(t.y), w: num(t.w), h: num(t.h) })));
    setPurchases((pur.data ?? []).map((p) => ({ ...p, qty: num(p.qty), unit_price: num(p.unit_price) })));
    setZones((zon.data ?? []).map((z) => ({ ...z, x: num(z.x), y: num(z.y), w: num(z.w), h: num(z.h) })));
    setFloorItems((itm.data ?? []).map((i) => ({ ...i, x: num(i.x), y: num(i.y), w: num(i.w), h: num(i.h) })));
    setReservations((res.data ?? []).map((r) => {
      const { date, time } = localParts(r.starts_at, tz);
      return {
        ...r, code: num(r.code), deposit: num(r.deposit), date, time,
        items: (r.reservation_items ?? []).map((i: { dish_id: string; qty: unknown; unit_price: unknown }) => ({
          dish_id: i.dish_id, qty: num(i.qty), unit_price: num(i.unit_price),
        })),
        reminders: (r.reminders ?? []) as Reminder[],
      } as Reservation;
    }));
    setLoading(false);
  }, [supabase, rid, tz]);

  // Carga inicial, reloj de la página y cambios en vivo desde otros dispositivos.
  useEffect(() => {
    // reload() solo cambia el estado después de esperar a Supabase, no de forma síncrona.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
    const tick = setInterval(() => setNow(Date.now()), 30000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(reload, 400);
    };
    const channel = supabase
      .channel(`restaurant-${rid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations', filter: `restaurant_id=eq.${rid}` }, (p) => {
        const n = p.new as Partial<Reservation> | undefined;
        const o = p.old as Partial<Reservation> | undefined;
        if (p.eventType === 'INSERT' && n?.source === 'web') {
          toast(`Nueva reserva en línea: ${n.customer_name}, ${n.people} pers.${n.deposit_status === 'esperando' ? ' Esperando el anticipo.' : ''}`, 'alert');
        }
        if (p.eventType === 'UPDATE' && n?.deposit_status === 'comprobante' && o?.deposit_status !== 'comprobante') {
          toast(`${n.customer_name} subió el comprobante del anticipo. Revísalo para confirmar.`, 'alert');
        }
        if (p.eventType === 'UPDATE' && n?.confirmed_via === 'whatsapp' && n.status === 'confirmada' && (p.old as Partial<Reservation>)?.status !== 'confirmada') {
          toast(`${n.customer_name} confirmó su reserva por WhatsApp.`);
        }
        soon();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reminders', filter: `restaurant_id=eq.${rid}` }, (p) => {
        const n = p.new as Partial<Reminder> | undefined;
        if (p.eventType === 'UPDATE' && n?.status === 'fallido') toast(`Un recordatorio no se pudo enviar: ${n.error ?? 'error de WhatsApp'}`, 'alert');
        soon();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dining_tables', filter: `restaurant_id=eq.${rid}` }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'zones', filter: `restaurant_id=eq.${rid}` }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'floor_items', filter: `restaurant_id=eq.${rid}` }, soon)
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));
    return () => {
      clearInterval(tick);
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [supabase, rid, reload, toast]);

  const ingMap = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const dishMap = useMemo(() => new Map(dishes.map((d) => [d.id, d])), [dishes]);
  const tableMap = useMemo(() => new Map(tables.map((t) => [t.id, t])), [tables]);
  const today = useMemo(() => localParts(new Date(now).toISOString(), tz).date, [now, tz]);

  const saveReservation = useCallback(async (id: string | null, f: ReservationInput) => {
    const { error } = await supabase.rpc('save_reservation', {
      p_restaurant: rid,
      p_id: id,
      p: {
        customer_name: f.customer_name, phone: f.phone, starts_at: zonedToUtc(f.date, f.time, tz), people: f.people,
        table_id: f.table_id, occasion: f.occasion, allergies: f.allergies, notes: f.notes, deposit: f.deposit,
        deposit_method: f.deposit > 0 ? f.deposit_method : null,
      },
      p_items: Object.entries(f.items).filter(([, q]) => q > 0).map(([dish_id, qty]) => ({ dish_id, qty })),
    });
    if (error) return error.message;
    await reload();
    return null;
  }, [supabase, rid, tz, reload]);

  const setStatus = useCallback(async (id: string, status: Status) => {
    const { error } = status === 'atendida'
      ? await supabase.rpc('serve_reservation', { p_id: id })
      : await supabase.from('reservations')
        .update({ status, ...(status === 'confirmada' ? { confirmed_via: 'manual' } : {}) }).eq('id', id);
    await reload();
    return error ? error.message : null;
  }, [supabase, reload]);

  const markReminderSent = useCallback(async (reminderId: string) => {
    await supabase.from('reminders').update({ status: 'enviado', channel: 'manual', sent_at: new Date().toISOString() }).eq('id', reminderId);
    await reload();
  }, [supabase, reload]);

  const sendReminderNow = useCallback(async (reminderId: string) => {
    const r = await fetch(`/api/reminders/${reminderId}/send`, { method: 'POST' });
    const body = await r.json().catch(() => ({}));
    if (r.ok) toast('Recordatorio enviado por WhatsApp.');
    else toast(body.error ?? 'No se pudo enviar el recordatorio.', 'alert');
    await reload();
  }, [reload, toast]);

  const updateDishPrice = useCallback(async (id: string, price: number) => {
    const { error } = await supabase.from('dishes').update({ price }).eq('id', id);
    if (error) toast(error.message, 'alert');
    await reload();
  }, [supabase, reload, toast]);

  const updateStock = useCallback(async (id: string, stock: number) => {
    const { error } = await supabase.from('ingredients').update({ stock }).eq('id', id);
    if (error) toast(error.message, 'alert');
    await reload();
  }, [supabase, reload, toast]);

  const registerPurchase = useCallback(async (items: { ingredient_id: string; qty: number; unit_price: number | null }[]) => {
    const { error } = await supabase.rpc('register_purchase', { p_restaurant: rid, p_items: items });
    await reload();
    return error ? error.message : null;
  }, [supabase, rid, reload]);

  const updateRestaurant = useCallback(async (patch: Partial<Restaurant>) => {
    const { data, error } = await supabase.from('restaurants').update(patch).eq('id', rid).select().single();
    if (error) return error.message;
    setRestaurant(normalizeRestaurant(data));
    return null;
  }, [supabase, rid]);

  /* ---------- menú, inventario y compras ---------- */

  const saveDish = useCallback(async (id: string | null, f: DishInput) => {
    const { error } = await supabase.rpc('save_dish', {
      p_restaurant: rid, p_id: id,
      p: { name: f.name, category: f.category, price: f.price, active: f.active, description: f.description },
      p_recipe: f.recipe.filter((l) => l.ingredient_id && l.qty > 0),
    });
    if (error) return friendly(error, 'plato');
    await reload();
    return null;
  }, [supabase, rid, reload]);

  const deleteDish = useCallback(async (id: string) => {
    const { error } = await supabase.from('dishes').delete().eq('id', id);
    if (error) return friendly(error, 'plato');
    await reload();
    return null;
  }, [supabase, reload]);

  const saveIngredient = useCallback(async (id: string | null, f: IngredientInput) => {
    const row = { ...f, name: f.name.trim(), supplier: f.supplier.trim() };
    const { error } = id
      ? await supabase.from('ingredients').update(row).eq('id', id)
      : await supabase.from('ingredients').insert({ ...row, restaurant_id: rid });
    if (error) return friendly(error, 'insumo');
    await reload();
    return null;
  }, [supabase, rid, reload]);

  // También lo quita de las recetas que lo usan (la app lo advierte antes de confirmar).
  const deleteIngredient = useCallback(async (id: string) => {
    const { error } = await supabase.rpc('delete_ingredient', { p_id: id });
    if (error) return friendly(error, 'insumo');
    await reload();
    return null;
  }, [supabase, reload]);

  const savePurchase = useCallback(async (id: string | null, f: PurchaseInput) => {
    const row = {
      ingredient_id: f.ingredient_id, qty: f.qty, unit_price: f.unit_price, note: f.note.trim(),
      bought_at: zonedToUtc(f.date, '12:00', tz),
    };
    const { error } = id
      ? await supabase.from('purchases').update(row).eq('id', id)
      : await supabase.from('purchases').insert({ ...row, restaurant_id: rid });
    if (error) return friendly(error, 'compra');
    await reload();
    return null;
  }, [supabase, rid, tz, reload]);

  const deletePurchase = useCallback(async (id: string) => {
    const { error } = await supabase.from('purchases').delete().eq('id', id);
    if (error) return friendly(error, 'compra');
    await reload();
    return null;
  }, [supabase, reload]);

  /* ---------- plano: mesas y zonas ---------- */

  const saveTable = useCallback(async (id: string | null, f: TableInput) => {
    const row = { ...f, name: f.name.trim() };
    let error: DbError | null;
    if (id) {
      ({ error } = await supabase.from('dining_tables').update(row).eq('id', id));
    } else {
      // Una mesa nueva aparece en el centro de su zona; luego se arrastra a su lugar.
      const z = zones.find((x) => x.name === f.zone);
      const pos = z ? { x: +(z.x + z.w / 2).toFixed(2), y: +(z.y + z.h / 2).toFixed(2) } : { x: 50, y: 50 };
      ({ error } = await supabase.from('dining_tables').insert({ ...row, ...pos, restaurant_id: rid }));
    }
    if (error) return friendly(error, 'mesa');
    await reload();
    return null;
  }, [supabase, rid, zones, reload]);

  const deleteTable = useCallback(async (id: string) => {
    const { error } = await supabase.from('dining_tables').delete().eq('id', id);
    if (error) return friendly(error, 'mesa');
    await reload();
    return null;
  }, [supabase, reload]);

  // Al arrastrar se actualiza la pantalla de una vez y se guarda en segundo plano.
  const moveTable = useCallback(async (id: string, patch: Partial<Pick<DiningTable, 'x' | 'y' | 'w' | 'h' | 'rotation'>>) => {
    setTables((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    const { error } = await supabase.from('dining_tables').update(patch).eq('id', id);
    if (error) {
      toast(`No se pudo guardar la posición: ${error.message}`, 'alert');
      await reload();
    }
  }, [supabase, reload, toast]);

  const saveZone = useCallback(async (id: string | null, { name, floor }: { name: string; floor: FloorKind }) => {
    const { error } = id
      ? await supabase.from('zones').update({ name: name.trim(), floor }).eq('id', id)
      : await supabase.from('zones').insert({
        restaurant_id: rid, name: name.trim(), floor, x: 30, y: 30, w: 40, h: 40,
        sort: Math.max(0, ...zones.map((z) => z.sort)) + 1,
      });
    if (error) return friendly(error, 'zona');
    await reload();
    return null;
  }, [supabase, rid, zones, reload]);

  const deleteZone = useCallback(async (id: string) => {
    const { error } = await supabase.from('zones').delete().eq('id', id);
    if (error) return friendly(error, 'zona');
    await reload();
    return null;
  }, [supabase, reload]);

  const moveZone = useCallback(async (id: string, box: Partial<Geo>) => {
    setZones((zs) => zs.map((z) => (z.id === id ? { ...z, ...box } : z)));
    const { error } = await supabase.from('zones').update(box).eq('id', id);
    if (error) {
      toast(`No se pudo guardar la zona: ${error.message}`, 'alert');
      await reload();
    }
  }, [supabase, reload, toast]);

  /* ---------- anticipos de reservas en línea ---------- */

  const reviewDeposit = useCallback(async (id: string, approved: boolean, method?: 'transferencia' | 'efectivo') => {
    const r = reservations.find((x) => x.id === id);
    const patch = approved
      ? {
        deposit_status: 'pagado', deposit_method: method ?? r?.deposit_method ?? 'transferencia',
        deposit: Math.max(r?.deposit ?? 0, restaurant.deposit_amount), status: 'confirmada', confirmed_via: 'manual', hold_expires_at: null,
      }
      : { deposit_status: 'rechazado', status: 'cancelada', hold_expires_at: null };
    const { error } = await supabase.from('reservations').update(patch).eq('id', id);
    await reload();
    return error ? error.message : null;
  }, [supabase, reservations, restaurant.deposit_amount, reload]);

  const receiptUrl = useCallback(async (path: string) => {
    const { data, error } = await supabase.storage.from('comprobantes').createSignedUrl(path, 600);
    return error ? null : data.signedUrl;
  }, [supabase]);

  /* ---------- logo y foto del negocio ---------- */

  // Ruta dentro de la carpeta "marca" a partir del enlace público guardado.
  const brandPath = (url: string) => url.split('/storage/v1/object/public/marca/')[1]?.split('?')[0];

  const uploadBrand = useCallback(async (kind: BrandKind, file: File) => {
    let blob: Blob;
    try {
      blob = await resizeImage(file, BRAND_SIZE[kind]);
    } catch (e) {
      return e instanceof Error ? e.message : 'No se pudo preparar la imagen.';
    }
    // Un nombre nuevo cada vez evita que los celulares muestren la imagen vieja guardada.
    const path = `${rid}/${kind}-${Date.now()}.webp`;
    const up = await supabase.storage.from('marca').upload(path, blob, { contentType: 'image/webp', upsert: false });
    if (up.error) return `No se pudo subir la imagen: ${up.error.message}`;
    const url = supabase.storage.from('marca').getPublicUrl(path).data.publicUrl;
    const field = BRAND_FIELD[kind];
    const old = brandPath(restaurant[field]);
    const err = await updateRestaurant({ [field]: url });
    if (err) {
      await supabase.storage.from('marca').remove([path]);
      return err;
    }
    if (old) await supabase.storage.from('marca').remove([old]);
    return null;
  }, [supabase, rid, restaurant, updateRestaurant]);

  const removeBrand = useCallback(async (kind: BrandKind) => {
    const field = BRAND_FIELD[kind];
    const old = brandPath(restaurant[field]);
    const err = await updateRestaurant({ [field]: '' });
    if (err) return err;
    if (old) await supabase.storage.from('marca').remove([old]);
    return null;
  }, [supabase, restaurant, updateRestaurant]);

  /* ---------- elementos del plano y fondo ---------- */

  const saveItem = useCallback(async (id: string | null, f: { kind: ItemKind; label: string; rotation: number }) => {
    const row = { kind: f.kind, label: f.label.trim(), rotation: f.rotation };
    let error: DbError | null;
    if (id) {
      ({ error } = await supabase.from('floor_items').update(row).eq('id', id));
    } else {
      // Aparece en el centro del plano con su tamaño típico; luego se arrastra a su lugar.
      const size = ITEM_KINDS[f.kind];
      ({ error } = await supabase.from('floor_items').insert({
        ...row, restaurant_id: rid, w: size.w, h: size.h, x: +(50 - size.w / 2).toFixed(2), y: +(50 - size.h / 2).toFixed(2),
      }));
    }
    if (error) return error.message;
    await reload();
    return null;
  }, [supabase, rid, reload]);

  const deleteItem = useCallback(async (id: string) => {
    const { error } = await supabase.from('floor_items').delete().eq('id', id);
    if (error) return error.message;
    await reload();
    return null;
  }, [supabase, reload]);

  const moveItem = useCallback(async (id: string, box: Partial<Geo>) => {
    setFloorItems((xs) => xs.map((i) => (i.id === id ? { ...i, ...box } : i)));
    const { error } = await supabase.from('floor_items').update(box).eq('id', id);
    if (error) {
      toast(`No se pudo guardar el elemento: ${error.message}`, 'alert');
      await reload();
    }
  }, [supabase, reload, toast]);

  const setPlanBackground = useCallback(async (file: File | null) => {
    const old = brandPath(restaurant.plan_bg_url);
    if (!file) {
      const err = await updateRestaurant({ plan_bg_url: '' });
      if (!err && old) await supabase.storage.from('marca').remove([old]);
      return err;
    }
    let blob: Blob;
    try {
      blob = await resizeImage(file, 2000);
    } catch (e) {
      return e instanceof Error ? e.message : 'No se pudo preparar la imagen.';
    }
    const path = `${rid}/plano-${Date.now()}.webp`;
    const up = await supabase.storage.from('marca').upload(path, blob, { contentType: 'image/webp', upsert: false });
    if (up.error) return `No se pudo subir la imagen: ${up.error.message}`;
    const err = await updateRestaurant({ plan_bg_url: supabase.storage.from('marca').getPublicUrl(path).data.publicUrl });
    if (err) {
      await supabase.storage.from('marca').remove([path]);
      return err;
    }
    if (old) await supabase.storage.from('marca').remove([old]);
    return null;
  }, [supabase, rid, restaurant, updateRestaurant]);

  // Foto del plato para la carta: se achica a 1000 px y va a la carpeta pública "marca".
  const setDishPhoto = useCallback(async (dishId: string, file: File | null) => {
    const old = brandPath(dishes.find((d) => d.id === dishId)?.photo_url ?? '');
    let url = '';
    if (file) {
      let blob: Blob;
      try {
        blob = await resizeImage(file, 1000);
      } catch (e) {
        return e instanceof Error ? e.message : 'No se pudo preparar la imagen.';
      }
      const path = `${rid}/plato-${dishId}-${Date.now()}.webp`;
      const up = await supabase.storage.from('marca').upload(path, blob, { contentType: 'image/webp', upsert: false });
      if (up.error) return `No se pudo subir la foto: ${up.error.message}`;
      url = supabase.storage.from('marca').getPublicUrl(path).data.publicUrl;
    }
    const { error } = await supabase.from('dishes').update({ photo_url: url }).eq('id', dishId);
    if (error) return error.message;
    if (old) await supabase.storage.from('marca').remove([old]);
    await reload();
    return null;
  }, [supabase, rid, dishes, reload]);

  const value: StoreValue = {
    restaurant, userEmail, waReady, loading, loadError, live, ingredients, dishes, tables, reservations, purchases, zones, floorItems,
    ingMap, dishMap, tableMap, today, now, agendaDay, setAgendaDay, modal, setModal, toasts, toast, copy, reload,
    saveReservation, setStatus, markReminderSent, sendReminderNow, updateDishPrice, updateStock, registerPurchase, updateRestaurant,
    saveDish, deleteDish, saveIngredient, deleteIngredient, savePurchase, deletePurchase,
    saveTable, deleteTable, moveTable, saveZone, deleteZone, moveZone, reviewDeposit, receiptUrl, uploadBrand, removeBrand,
    saveItem, deleteItem, moveItem, setPlanBackground, setDishPhoto,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* ---------- utilidades derivadas ---------- */

export type ReminderView = { rem: Reminder; res: Reservation; state: 'ahora' | 'programado' | 'enviado' | 'fallido' | 'enviando' };

/** Recordatorios vigentes de reservas futuras, con su estado para mostrar. */
export function reminderViews(reservations: Reservation[], now: number): ReminderView[] {
  const out: ReminderView[] = [];
  for (const res of reservations) {
    if (res.status === 'cancelada' || res.status === 'atendida') continue;
    if (new Date(res.starts_at).getTime() < now) continue;
    for (const rem of res.reminders) {
      if (rem.status === 'cancelado' || rem.status === 'omitido') continue;
      const due = new Date(rem.send_at).getTime() <= now;
      const state = rem.status === 'enviado' ? 'enviado'
        : rem.status === 'enviando' ? 'enviando'
          : rem.status === 'fallido' ? 'fallido'
            : due ? 'ahora' : 'programado';
      out.push({ rem, res, state });
    }
  }
  return out.sort((a, b) => a.rem.send_at.localeCompare(b.rem.send_at));
}

export function conflictOf(reservations: Reservation[], tableId: string, startIso: string, minutes: number, exceptId?: string | null) {
  const s = new Date(startIso).getTime();
  const e = s + minutes * 60000;
  return reservations.find((r) => r.id !== exceptId && r.table_id === tableId && r.status !== 'cancelada'
    && new Date(r.starts_at).getTime() < e && new Date(r.ends_at).getTime() > s);
}
