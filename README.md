# Mesa Lista

App web para restaurantes: reservas con plano de mesas, recordatorios automáticos por WhatsApp,
presupuesto por pedido, lista de compras calculada desde las reservas, recetas con costos e inventario.

- **Next.js 16** (App Router, TypeScript), publicado en **Cloudflare Workers** con OpenNext
- **Supabase**: base de datos Postgres, login y cambios en vivo entre dispositivos
- **WhatsApp Cloud API** (Meta): recordatorios de 24 h y 2 h, y el cliente confirma o cancela con un botón

## Cómo funciona

| Qué | Dónde vive |
|---|---|
| Choques de mesa | Restricción `no_double_booking` en Postgres: dos reservas activas no pueden cruzarse en la misma mesa, ni siquiera si dos meseros guardan al mismo tiempo. |
| Recordatorios | Un *trigger* crea los de 24 h y 2 h al guardar la reserva, los reprograma si cambia la hora y los cancela si se cancela. |
| Envío | El cron del Worker (`triggers.crons` en `wrangler.jsonc`, manejado en `worker.ts`) llama a `/api/cron/reminders` cada 5 minutos; reclama los vencidos con `FOR UPDATE SKIP LOCKED` (nunca se envía dos veces) y los manda por WhatsApp. |
| Respuestas | Meta llama a `/api/whatsapp/webhook`. "Confirmo" pasa la reserva a *confirmada*, "Cancelar" la cancela y libera la mesa. El celular que responde debe coincidir con el de la reserva. |
| Inventario | "Marcar atendida" descuenta los insumos de la receta. Cada compra suma al stock y deja el precio del insumo en el de su compra más reciente; editar una compra ajusta la diferencia y borrarla la revierte (trigger `purchases_stock`). |
| Menú | Platos y recetas se crean, editan y borran desde la app. Un plato que ya está en reservas no se puede borrar (se desactiva), y un insumo que está en recetas tampoco. |
| Seguridad | Seguridad por filas (RLS): cada usuario solo ve los datos de su restaurante. |

## 1. Correrla en tu computador

```bash
npm install
```

```bash
cp .env.example .env.local
```

Llena `.env.local` (paso 2) y luego:

```bash
npm run dev
```

Abre http://localhost:3000, crea tu cuenta y tu restaurante (puedes cargar el menú colombiano de ejemplo).

## 2. Supabase

1. Crea un proyecto gratis en [supabase.com](https://supabase.com).
2. En **SQL Editor**, pega y ejecuta en orden los archivos de `supabase/migrations/` (`…000_init.sql` y luego `…001_hardening.sql`).
   El proyecto `mesa-lista` (us-east-1) ya tiene los dos aplicados.
3. En **Project Settings → API** copia la URL, la `anon key` y la `service_role key` a `.env.local`.
4. En **Authentication → URL Configuration** pon tu dominio como *Site URL* y agrega
   `https://TU-DOMINIO/auth/callback` (y `http://localhost:3000/auth/callback`) en *Redirect URLs*.
5. Si quieres entrar sin confirmar el correo mientras pruebas: **Authentication → Providers → Email** y desactiva *Confirm email*.

## 3. WhatsApp (recordatorios automáticos)

Sin este paso la app funciona igual: los recordatorios aparecen en la pestaña Recordatorios y se envían con un clic desde tu WhatsApp.

1. En [developers.facebook.com](https://developers.facebook.com) crea una app de tipo **Business** y agrega el producto **WhatsApp**.
2. Registra el número del restaurante (no puede estar usándose en la app normal de WhatsApp) y copia su **Phone number ID** a `WHATSAPP_PHONE_NUMBER_ID`.
3. Crea un **token permanente**: Business Settings → Users → System users → genera un token con los permisos
   `whatsapp_business_messaging` y `whatsapp_business_management`. Va en `WHATSAPP_TOKEN`.
4. Copia el **App secret** (App settings → Basic) a `WHATSAPP_APP_SECRET`.
5. Crea la plantilla en **WhatsApp Manager → Message templates**:
   - Nombre: `recordatorio_reserva` · Categoría: **Utility** · Idioma: **Spanish (es)**
   - Cuerpo:
     ```
     Hola {{1}}, te esperamos en {{2}} el {{3}} a las {{4}} para {{5}} personas. ¿Nos confirmas tu asistencia?
     ```
   - Botones de respuesta rápida, en este orden: `Confirmo` y `Cancelar reserva`
   - Espera a que Meta la apruebe (suele tardar minutos).
6. Configura el **webhook** (WhatsApp → Configuration):
   - URL: `https://TU-DOMINIO/api/whatsapp/webhook`
   - Verify token: el mismo texto que pusiste en `WHATSAPP_VERIFY_TOKEN`
   - Suscríbete al campo **messages**.

Meta cobra cada recordatorio como conversación de *utilidad*; las respuestas del cliente dentro de las 24 h siguientes no tienen costo adicional. Revisa la tarifa vigente para Colombia en la página de precios de WhatsApp Business.

## 4. Publicarla

Se publica en **Cloudflare Workers** (plan gratis, permite uso comercial). Las variables `NEXT_PUBLIC_*`
se toman de `.env.local` al compilar; las demás van como *secretos* del Worker.

1. Inicia sesión en Cloudflare (abre el navegador una sola vez):
   ```bash
   npx wrangler login
   ```
2. Sube los secretos del servidor (cada comando pide el valor):
   ```bash
   npx wrangler secret put CRON_SECRET
   ```
   Repite con `SUPABASE_SERVICE_ROLE_KEY` y, cuando tengas WhatsApp, con `WHATSAPP_TOKEN`,
   `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` y `WHATSAPP_VERIFY_TOKEN`.
3. Publica:
   ```bash
   npm run deploy
   ```
   Queda en `https://reservas.softwa.workers.dev` (proyecto `reservas`, subdominio `softwa`). El cron de recordatorios ya viene incluido (cada 5 minutos).
4. En Supabase → **Authentication → URL Configuration** pon esa dirección como *Site URL* y agrega
   `https://reservas.softwa.workers.dev/**` en *Redirect URLs*.

Para probar en tu computador la versión compilada para Cloudflare: `npm run preview`.
`supabase/cron.sql` queda solo como alternativa si algún día publicas en otro lado.

Para probar el cron a mano:

```bash
curl -H "Authorization: Bearer TU_CRON_SECRET" https://TU-DOMINIO/api/cron/reminders
```

## Pruebas

```bash
npm test
```

- `test:db` aplica la migración en un Postgres embebido (PGlite) y prueba reservas, choques de mesa, recordatorios, inventario, compras y que un restaurante no pueda ver los datos de otro.
- `test:logic` prueba fechas por zona horaria, presupuesto, lista de compras, cómo se interpretan las respuestas de WhatsApp y la firma del webhook.

## Pendiente para una siguiente versión

- Editar mesas y posiciones del plano desde la app (hoy se cargan del ejemplo o directo en Supabase).
- Invitar meseros a tu restaurante (la tabla `memberships` ya soporta el rol `staff`).
- Página pública de reservas para que el cliente reserve solo.
