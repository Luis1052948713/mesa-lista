export type Unit = 'kg' | 'l' | 'und';
export type Status = 'pendiente' | 'confirmada' | 'atendida' | 'cancelada';
export type ReminderKind = '24h' | '2h';
export type ReminderStatus = 'programado' | 'enviando' | 'enviado' | 'fallido' | 'cancelado' | 'omitido';

export interface Restaurant {
  id: string;
  name: string;
  timezone: string;
  phone_country_code: string;
  inc_rate: number;
  tip_rate: number;
  shop_merma: number;
  shop_keep_min: boolean;
  reminders_enabled: boolean;
  /** Horario de reservas, "HH:MM". */
  open_time: string;
  last_booking_time: string;
  slot_minutes: number;
  slug: string;
  booking_enabled: boolean;
  deposit_amount: number;
  hold_minutes: number;
  bank_details: string;
  whatsapp_phone: string;
  booking_policy: string;
  max_online_people: number;
  min_advance_hours: number;
  /** Enlaces públicos de la carpeta "marca" en Supabase Storage. */
  logo_url: string;
  cover_url: string;
  /** Imagen del QR para transferir el anticipo (Nequi, Bre-B o banco). */
  pay_qr_url: string;
  accept_cash: boolean;
  cash_hold_hours: number;
  cash_instructions: string;
  /** Foto o dibujo del local que va de fondo en el plano. */
  plan_bg_url: string;
}

export type DepositMethod = 'transferencia' | 'efectivo';
export type DepositStatus = 'no_aplica' | 'esperando' | 'comprobante' | 'pagado' | 'vencido' | 'rechazado';

export interface Ingredient {
  id: string;
  name: string;
  unit: Unit;
  price: number;
  supplier: string;
  stock: number;
  min_stock: number;
}

export interface RecipeLine {
  ingredient_id: string;
  qty: number;
}

export interface Dish {
  id: string;
  name: string;
  category: string;
  price: number;
  active: boolean;
  sort: number;
  /** Lo que ve el cliente en la carta. */
  description: string;
  photo_url: string;
  recipe: RecipeLine[];
}

export interface Purchase {
  id: string;
  ingredient_id: string;
  qty: number;
  unit_price: number;
  bought_at: string;
  note: string;
}

export interface DishInput {
  name: string;
  category: string;
  price: number;
  active: boolean;
  description: string;
  recipe: RecipeLine[];
}

export type IngredientInput = Omit<Ingredient, 'id'>;

export interface PurchaseInput {
  ingredient_id: string;
  qty: number;
  unit_price: number;
  date: string;
  note: string;
}

export type TableShape = 'auto' | 'round' | 'rect';

export interface DiningTable {
  id: string;
  name: string;
  seats: number;
  zone: string;
  x: number;
  y: number;
  active: boolean;
  shape: TableShape;
  /** Tamaño en % del plano; 0 = automático según los puestos. */
  w: number;
  h: number;
  rotation: number;
}

export type TableInput = Pick<DiningTable, 'name' | 'seats' | 'zone' | 'shape' | 'active'>;

export type FloorKind = 'madera' | 'baldosa' | 'concreto' | 'pasto' | 'alfombra' | 'ninguno';

/** Área del plano en porcentajes del lienzo (0–100). */
export interface Zone {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  sort: number;
  floor: FloorKind;
  rotation: number;
}

export type ItemKind = 'barra' | 'puerta' | 'cocina' | 'bano' | 'caja' | 'planta' | 'ventana' | 'escalera' | 'pared';

/** Elemento dibujado en el plano (barra, puerta…), en % del lienzo; x/y es la esquina superior izquierda. */
export interface FloorItem {
  id: string;
  kind: ItemKind;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Grados, de 0 a 359. */
  rotation: number;
}

export type ZoneBox = Pick<Zone, 'x' | 'y' | 'w' | 'h'>;

/** Posición, tamaño y giro de algo del plano. */
export type Geo = ZoneBox & { rotation: number };

export interface Reminder {
  id: string;
  reservation_id: string;
  kind: ReminderKind;
  send_at: string;
  status: ReminderStatus;
  channel: 'whatsapp' | 'manual' | null;
  sent_at: string | null;
  error: string | null;
  attempts: number;
}

export interface OrderLine {
  dish_id: string;
  qty: number;
  unit_price: number;
}

export interface Reservation {
  id: string;
  code: number;
  customer_name: string;
  phone: string;
  starts_at: string;
  ends_at: string;
  duration_min: number;
  people: number;
  table_id: string | null;
  occasion: string;
  allergies: string;
  notes: string;
  deposit: number;
  status: Status;
  confirmed_via: 'whatsapp' | 'manual' | null;
  source: 'app' | 'web';
  email: string;
  deposit_status: DepositStatus;
  deposit_method: DepositMethod | null;
  hold_expires_at: string | null;
  receipt_path: string | null;
  items: OrderLine[];
  reminders: Reminder[];
  /** Fecha y hora locales del restaurante, derivadas de starts_at. */
  date: string;
  time: string;
}

export interface ReservationInput {
  customer_name: string;
  phone: string;
  date: string;
  time: string;
  people: number;
  table_id: string;
  occasion: string;
  allergies: string;
  notes: string;
  deposit: number;
  deposit_method: DepositMethod;
  items: Record<string, number>;
}
