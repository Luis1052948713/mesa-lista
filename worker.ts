// Punto de entrada del Worker en Cloudflare: la app de Next (generada por OpenNext)
// más el cron que envía los recordatorios cada 5 minutos (ver "triggers" en wrangler.jsonc).
// @ts-expect-error: .open-next/worker.js lo genera `opennextjs-cloudflare build`.
import handler from './.open-next/worker.js';

interface Env { CRON_SECRET?: string }
interface Ctx { waitUntil(p: Promise<unknown>): void }

export default {
  fetch: handler.fetch,

  // Llama a la misma ruta que usaría un cron externo, con el mismo secreto.
  async scheduled(_controller: unknown, env: Env, ctx: Ctx) {
    const req = new Request('https://mesa-lista.internal/api/cron/reminders', {
      headers: { Authorization: `Bearer ${env.CRON_SECRET ?? ''}` },
    });
    ctx.waitUntil(
      handler.fetch(req, env, ctx).then(async (res: Response) => {
        if (!res.ok) console.error('Cron de recordatorios falló', res.status, await res.text());
      }),
    );
  },
};
