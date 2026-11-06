import QRCode from 'qrcode';

export type PosterTheme = 'oscuro' | 'verde' | 'claro';

export const POSTER_THEMES: Record<PosterTheme, {
  label: string; bg: string; glow: string; ink: string; muted: string; accent: string; card: string; border: string;
}> = {
  // Negro y dorado: combina con logos tipo escudo sobre fondo oscuro.
  oscuro: { label: 'Oscuro', bg: '#0C0C0C', glow: 'rgba(227,179,65,.18)', ink: '#FFFFFF', muted: 'rgba(255,255,255,.72)', accent: '#E3B341', card: '#FFFFFF', border: '#E3B341' },
  verde: { label: 'Verde', bg: '#24402B', glow: 'rgba(232,178,76,.16)', ink: '#FFFFFF', muted: 'rgba(255,255,255,.78)', accent: '#E8B24C', card: '#FFFFFF', border: '#E8B24C' },
  claro: { label: 'Claro', bg: '#F6F4EF', glow: 'rgba(176,56,30,.08)', ink: '#17201A', muted: '#5A665D', accent: '#B0381E', card: '#FFFFFF', border: '#17201A' },
};

/** QR simple para descargar. Con logo al centro se usa corrección alta (H) para que siga leyéndose. */
export function qrDataUrl(url: string, width = 1024, withLogoSpace = false) {
  return QRCode.toDataURL(url, {
    width, margin: 2, errorCorrectionLevel: withLogoSpace ? 'H' : 'M', color: { dark: '#111111', light: '#FFFFFF' },
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Usa la tipografía de la app (la carga next/font) y una de respaldo del sistema.
function fontFamily(varName: string, fallback: string) {
  const v = typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue(varName).trim() : '';
  return v ? `${v}, ${fallback}` : fallback;
}

function fitText(g: CanvasRenderingContext2D, text: string, weight: number, start: number, min: number, family: string, maxW: number) {
  let size = start;
  g.font = `${weight} ${size}px ${family}`;
  while (g.measureText(text).width > maxW && size > min) {
    size -= 2;
    g.font = `${weight} ${size}px ${family}`;
  }
  return size;
}

function drawContain(g: CanvasRenderingContext2D, img: HTMLImageElement, cx: number, cy: number, box: number, radius = 0) {
  const k = Math.min(box / img.width, box / img.height);
  const w = img.width * k, h = img.height * k, x = cx - w / 2, y = cy - h / 2;
  if (radius) {
    g.save();
    g.beginPath();
    g.roundRect(x, y, w, h, radius);
    g.clip();
  }
  g.drawImage(img, x, y, w, h);
  if (radius) g.restore();
}

/**
 * Color de las esquinas del logo si son opacas y parecidas (logos sobre fondo sólido).
 * Sirve para que el fondo del cartel se funda con el del logo en vez de verse un cuadro.
 */
function cornerColor(img: HTMLImageElement): string | null {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(img, 0, 0, s, s);
  const px = [[1, 1], [s - 2, 1], [1, s - 2], [s - 2, s - 2]].map(([x, y]) => g.getImageData(x, y, 1, 1).data);
  if (px.some((p) => p[3] < 250)) return null;
  const avg = [0, 1, 2].map((i) => Math.round(px.reduce((a, p) => a + p[i], 0) / 4));
  const spread = Math.max(...[0, 1, 2].map((i) => Math.max(...px.map((p) => p[i])) - Math.min(...px.map((p) => p[i]))));
  return spread < 40 ? `rgb(${avg[0]},${avg[1]},${avg[2]})` : null;
}

const isDark = (rgb: string) => {
  const [r, g, b] = rgb.match(/\d+/g)!.map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 70;
};

/**
 * Cartel vertical 1080×1920 (historia de Instagram y estado de WhatsApp; también se imprime).
 * Cada bloque tiene su franja vertical fija, así ningún texto se monta sobre otro.
 */
export async function posterDataUrl(opts: { name: string; url: string; logoUrl?: string; deposit?: number; theme?: PosterTheme }) {
  const t = { ...POSTER_THEMES[opts.theme ?? 'oscuro'] };
  const W = 1080, H = 1920, M = 80;
  if (typeof document !== 'undefined' && document.fonts) await document.fonts.ready;
  const display = fontFamily('--font-display', 'system-ui, -apple-system, "Segoe UI", sans-serif');
  const body = fontFamily('--font-body', 'system-ui, -apple-system, "Segoe UI", sans-serif');
  const mono = fontFamily('--font-mono', 'ui-monospace, Consolas, monospace');

  let logo: HTMLImageElement | null = null;
  if (opts.logoUrl) {
    try { logo = await loadImage(opts.logoUrl); } catch { logo = null; }
  }
  // En el tema oscuro, si el logo trae fondo oscuro sólido, el cartel usa ese mismo color.
  const logoBg = logo ? cornerColor(logo) : null;
  const blend = Boolean(logoBg && (opts.theme ?? 'oscuro') === 'oscuro' && isDark(logoBg!));
  if (blend) t.bg = logoBg!;

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';

  // Fondo con un brillo suave detrás del logo.
  g.fillStyle = t.bg;
  g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W / 2, 360, 40, W / 2, 360, 700);
  glow.addColorStop(0, t.glow);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  // Franja 1 (60–660): logo grande, o el nombre si no hay logo.
  if (logo) {
    // Si se funde con el fondo va tal cual; si no, como una placa con esquinas redondeadas.
    drawContain(g, logo, W / 2, 370, 560, blend || !logoBg ? 0 : 40);
  } else {
    g.fillStyle = t.ink;
    fitText(g, opts.name.toUpperCase(), 800, 120, 56, display, W - 2 * M);
    g.fillText(opts.name.toUpperCase(), W / 2, 400);
  }

  // Franja 2 (690–800): titular y subtítulo.
  g.fillStyle = t.accent;
  fitText(g, 'RESERVA TU MESA', 800, 112, 60, display, W - 2 * M);
  g.fillText('RESERVA TU MESA', W / 2, 745);
  g.fillStyle = t.muted;
  g.font = `500 38px ${body}`;
  g.fillText('Escanea con la cámara de tu celular', W / 2, 805);

  // Franja 3 (850–1510): QR en tarjeta blanca con borde y el logo al centro.
  const card = 660, qrSize = 580, top = 850;
  const cx = W / 2, cy = top + card / 2;
  g.fillStyle = t.card;
  g.beginPath();
  g.roundRect(cx - card / 2, top, card, card, 44);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = t.border;
  g.stroke();
  const qr = await loadImage(await qrDataUrl(opts.url, qrSize * 2, Boolean(logo)));
  g.drawImage(qr, cx - qrSize / 2, cy - qrSize / 2, qrSize, qrSize);
  if (logo) {
    const r = 64;
    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.arc(cx, cy, r + 10, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = t.bg;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
    drawContain(g, logo, cx, cy, r * 2);
    g.restore();
  }

  // Franja 4 (1560–1700): tres pasos.
  const steps = ['Escanea', 'Elige día y hora', 'Aparta tu mesa'];
  const colW = (W - 2 * M) / 3;
  steps.forEach((s, i) => {
    const x = M + colW * i + colW / 2;
    g.fillStyle = t.accent;
    g.beginPath();
    g.arc(x, 1600, 34, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = t.bg;
    g.font = `800 38px ${display}`;
    g.fillText(String(i + 1), x, 1614);
    g.fillStyle = t.ink;
    fitText(g, s, 700, 34, 24, body, colW - 20);
    g.fillText(s, x, 1688);
  });

  // Franja 5 (1740–1880): anticipo y enlace.
  if (opts.deposit && opts.deposit > 0) {
    g.fillStyle = t.muted;
    g.font = `500 32px ${body}`;
    g.fillText(`Anticipo de $${opts.deposit.toLocaleString('es-CO')} para garantizar tu reserva`, W / 2, 1770);
  }
  g.fillStyle = t.muted;
  const link = opts.url.replace(/^https?:\/\//, '');
  fitText(g, link, 500, 28, 18, mono, W - 2 * M);
  g.fillText(link, W / 2, 1855);

  return c.toDataURL('image/png');
}
