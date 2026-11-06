-- Programa el envío de recordatorios cada 5 minutos desde Supabase (plan gratis incluido).
-- Ejecútalo UNA vez en el SQL Editor de Supabase, después de publicar la app.
-- Antes cambia los dos valores marcados con <...>.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'mesa-lista-recordatorios',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://<TU-DOMINIO>/api/cron/reminders',
    headers := jsonb_build_object('Authorization', 'Bearer <TU_CRON_SECRET>', 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- Para ver las últimas ejecuciones:
--   select * from cron.job_run_details order by start_time desc limit 10;
-- Para detenerlo:
--   select cron.unschedule('mesa-lista-recordatorios');
