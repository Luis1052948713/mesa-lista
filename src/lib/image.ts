/**
 * Achica una foto en el navegador antes de subirla (las del celular pesan varios MB).
 * Devuelve WebP, que conserva la transparencia de los logos y pesa poco.
 */
export async function resizeImage(file: File, maxSide: number): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) {
    throw new Error('Sube una imagen JPG, PNG o WebP.');
  }
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error('No pudimos leer esa imagen. Si es una foto HEIC de iPhone, compártela como JPG y vuelve a intentarlo.');
  }
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Tu navegador no pudo procesar la imagen.');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.86));
  if (!blob) throw new Error('No se pudo preparar la imagen. Prueba con otra.');
  return blob;
}
