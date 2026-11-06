'use client';

import { useEffect, useState } from 'react';
import { POSTER_THEMES, posterDataUrl, qrDataUrl, type PosterTheme } from '@/lib/poster';
import { useStore, type BrandKind } from './store';
import { ConfirmButton } from './ui';

/* eslint-disable @next/next/no-img-element -- imágenes de Supabase Storage y QR generado en el navegador */

export function BrandSlot({ kind, label, hint }: { kind: BrandKind; label: string; hint: string }) {
  const { restaurant, uploadBrand, removeBrand, toast } = useStore();
  const [busy, setBusy] = useState(false);
  const url = kind === 'logo' ? restaurant.logo_url : kind === 'cover' ? restaurant.cover_url : restaurant.pay_qr_url;

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    const err = await uploadBrand(kind, file);
    setBusy(false);
    toast(err ?? `${label} actualizado.`, err ? 'alert' : undefined);
  }

  return (
    <div className="brand-slot">
      <div className={`brand-prev ${kind}`}>
        {url ? <img src={url} alt={label} /> : <span className="muted">Sin {label.toLowerCase()}</span>}
      </div>
      <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
        <b>{label}</b>
        <span className="muted" style={{ fontSize: 13 }}>{hint}</span>
        <div className="row">
          <label className="btn sm" style={{ cursor: 'pointer' }}>
            {busy ? 'Subiendo…' : url ? 'Cambiar' : 'Subir imagen'}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/heic" hidden disabled={busy}
              onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {url && <ConfirmButton className="btn sm danger" label="Quitar" confirmLabel="Toca otra vez" onConfirm={async () => {
            const err = await removeBrand(kind);
            toast(err ?? `${label} quitado.`, err ? 'alert' : undefined);
          }} />}
        </div>
      </div>
    </div>
  );
}

export function BrandPanel() {
  return (
    <div className="panel" style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
      <h3>Logo y foto del negocio</h3>
      <p className="muted" style={{ fontSize: 14 }}>Se ven en tu página de reservas, en el cartel del QR y en el encabezado de la app.</p>
      <BrandSlot kind="logo" label="Logo" hint="Cuadrado y con fondo claro o transparente. Se achica solo a 512 px." />
      <BrandSlot kind="cover" label="Foto del negocio" hint="Horizontal: tu fachada, el salón o tu plato estrella. Se achica sola a 1600 px." />
    </div>
  );
}

const THEME_KEY = 'mesalista.cartel.tema';
function readTheme(): PosterTheme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v && v in POSTER_THEMES) return v as PosterTheme;
  } catch { /* sin almacenamiento */ }
  return 'oscuro';
}

export function QrPanel() {
  const { restaurant, toast, copy } = useStore();
  const [qr, setQr] = useState('');
  const [poster, setPoster] = useState('');
  const [theme, setTheme] = useState<PosterTheme>(readTheme);
  const url = restaurant.slug && typeof window !== 'undefined' ? `${window.location.origin}/reservar/${restaurant.slug}` : '';
  const file = restaurant.slug || 'reservas';

  // El QR y la vista previa del cartel se generan en el navegador cada vez que cambia algo.
  useEffect(() => {
    if (!url) return;
    let alive = true;
    qrDataUrl(url, 1024).then((d) => { if (alive) setQr(d); }, () => {});
    posterDataUrl({ name: restaurant.name, url, logoUrl: restaurant.logo_url || undefined, deposit: restaurant.deposit_amount, theme })
      .then((d) => { if (alive) setPoster(d); }, () => { if (alive) toast('No se pudo crear el cartel. Vuelve a intentarlo.', 'alert'); });
    return () => { alive = false; };
  }, [url, restaurant.name, restaurant.logo_url, restaurant.deposit_amount, theme, toast]);

  function pickTheme(t: PosterTheme) {
    setTheme(t);
    try { localStorage.setItem(THEME_KEY, t); } catch { /* sin almacenamiento */ }
  }

  if (!restaurant.booking_enabled) {
    return (
      <div className="panel" style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
        <h3>Código QR para reservar</h3>
        <p className="muted">Activa las reservas en línea para generar el código QR de tu página.</p>
      </div>
    );
  }

  return (
    <div className="panel" style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
      <h3>Código QR y cartel</h3>
      <p className="muted" style={{ fontSize: 14 }}>
        El cliente escanea con la cámara del celular y llega directo a tu formulario. Ponlo en las mesas, la entrada, la caja, tu menú o tus historias.
      </p>
      <div className="qr-row">
        <div className="poster-prev">
          {poster ? <img src={poster} alt="Vista previa del cartel" /> : <span className="muted">Creando…</span>}
        </div>
        <div style={{ display: 'grid', gap: 8, alignContent: 'start', minWidth: 0 }}>
          <span className="eyebrow">Colores del cartel</span>
          <div className="chips">
            {(Object.keys(POSTER_THEMES) as PosterTheme[]).map((k) => (
              <button type="button" key={k} className={`chip ${theme === k ? 'on' : ''}`} aria-pressed={theme === k} onClick={() => pickTheme(k)}>
                <i className="swatch" style={{ background: POSTER_THEMES[k].bg, borderColor: POSTER_THEMES[k].accent }} /> {POSTER_THEMES[k].label}
              </button>
            ))}
          </div>
          {!restaurant.logo_url && <p className="callout amber" style={{ fontSize: 13 }}>Sube tu logo en &quot;Logo y foto del negocio&quot; para que aparezca arriba y en el centro del QR.</p>}
          {poster && <a className="btn sm primary" href={poster} download={`cartel-${file}.png`}>Descargar cartel (historias y estados)</a>}
          <button type="button" className="btn sm" disabled={!poster} onClick={() => window.print()}>Imprimir cartel</button>
          {qr && <a className="btn sm" href={qr} download={`qr-${file}.png`}>Descargar solo el QR</a>}
          <button type="button" className="btn sm ghost" onClick={() => copy(url, 'Enlace copiado.')}>Copiar enlace</button>
          <span className="mono muted" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{url}</span>
        </div>
      </div>

      {/* Solo se ve al imprimir: el mismo cartel, a página completa. */}
      {poster && <div className="poster-print" aria-hidden="true"><img src={poster} alt="" /></div>}
    </div>
  );
}
