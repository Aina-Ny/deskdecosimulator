import type { InlineImage, Product } from '../../shared/types';
import { categoryLabel } from '../../shared/categories';

/** Ratios acceptés par Gemini ; on recadre la photo sur le plus proche pour que la sortie s'aligne pixel à pixel. */
const RATIOS: [string, number][] = [
  ['1:1', 1],
  ['5:4', 5 / 4],
  ['4:3', 4 / 3],
  ['3:2', 3 / 2],
  ['16:9', 16 / 9],
  ['21:9', 21 / 9],
  ['4:5', 4 / 5],
  ['3:4', 3 / 4],
  ['2:3', 2 / 3],
  ['9:16', 9 / 16],
];

export interface PreparedSource {
  canvas: HTMLCanvasElement;
  dataUrl: string;
  inline: InlineImage;
  aspect: string;
  width: number;
  height: number;
  /** Part de l'image retirée par le recadrage (0–1) */
  cropped: number;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image illisible.'));
    img.src = src;
  });
}

export const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

export function dataUrlToInline(dataUrl: string): InlineImage {
  const [head, data] = dataUrl.split(',');
  return { mime: head.slice(5, head.indexOf(';')), data };
}

export const inlineToDataUrl = (i: InlineImage) => `data:${i.mime};base64,${i.data}`;

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export async function prepareSource(file: File, maxEdge = 1600): Promise<PreparedSource> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Format accepté : JPG, PNG ou WebP.');
  const img = await loadImage(await fileToDataUrl(file));
  const r = img.naturalWidth / img.naturalHeight;
  const [aspect, target] = RATIOS.reduce((best, cur) =>
    Math.abs(Math.log(cur[1] / r)) < Math.abs(Math.log(best[1] / r)) ? cur : best,
  );
  // Recadrage centré au ratio cible
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  if (r > target) sw = Math.round(sh * target);
  else sh = Math.round(sw / target);
  const sx = Math.round((img.naturalWidth - sw) / 2);
  const sy = Math.round((img.naturalHeight - sh) / 2);
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const width = Math.round(sw * scale);
  const height = Math.round(sh * scale);
  const canvas = makeCanvas(width, height);
  canvas.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  return {
    canvas,
    dataUrl,
    inline: dataUrlToInline(dataUrl),
    aspect,
    width,
    height,
    cropped: 1 - (sw * sh) / (img.naturalWidth * img.naturalHeight),
  };
}

export async function compressImage(file: File, maxEdge = 1024): Promise<{ dataUrl: string; inline: InlineImage }> {
  const img = await loadImage(await fileToDataUrl(file));
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const c = makeCanvas(Math.round(img.naturalWidth * scale), Math.round(img.naturalHeight * scale));
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL('image/jpeg', 0.85);
  return { dataUrl, inline: dataUrlToInline(dataUrl) };
}

/** Réduit une image (bord long ≤ maxEdge) — requis par Cloudflare (entrées < 512 px). */
export async function downscaleInline(dataUrl: string, maxEdge: number): Promise<InlineImage> {
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const c = makeCanvas(Math.round(img.naturalWidth * scale), Math.round(img.naturalHeight * scale));
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return dataUrlToInline(c.toDataURL('image/jpeg', 0.9));
}

/** True si le masque contient au moins une zone peinte. */
export function maskHasPaint(mask: HTMLCanvasElement) {
  const d = mask.getContext('2d')!.getImageData(0, 0, mask.width, mask.height).data;
  for (let i = 3; i < d.length; i += 16) if (d[i] > 0) return true;
  return false;
}

/**
 * Recolle les pixels d'origine sur les zones protégées (bureau, écrans, chaise…).
 * Le masque est flouté pour une transition douce.
 */
export async function compositeProtected(
  source: HTMLCanvasElement,
  generated: InlineImage,
  mask: HTMLCanvasElement | null,
  feather = 6,
): Promise<HTMLCanvasElement> {
  const gen = await loadImage(inlineToDataUrl(generated));
  const out = makeCanvas(source.width, source.height);
  const ctx = out.getContext('2d')!;
  ctx.drawImage(gen, 0, 0, out.width, out.height);
  if (!mask || !maskHasPaint(mask)) return out;

  const layer = makeCanvas(out.width, out.height);
  const l = layer.getContext('2d')!;
  l.filter = `blur(${feather}px)`;
  l.drawImage(mask, 0, 0, out.width, out.height);
  l.filter = 'none';
  l.globalCompositeOperation = 'source-in';
  l.drawImage(source, 0, 0);
  ctx.drawImage(layer, 0, 0);
  return out;
}

const euro = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const day = (iso: string) => new Date(iso).toLocaleDateString('fr-FR');

/** Ajoute la légende « où trouver les pièces » sous l'image. */
export function withLegend(image: HTMLCanvasElement, products: Product[]): HTMLCanvasElement {
  const w = image.width;
  const pad = Math.round(w * 0.03);
  const fs = Math.max(13, Math.round(w / 62));
  const line = Math.round(fs * 1.45);
  const rows = products.length ? products.length * 2 : 1;
  const legendH = Math.round(pad * 2 + line * (rows + 4));
  const out = makeCanvas(w, image.height + legendH);
  const ctx = out.getContext('2d')!;
  ctx.drawImage(image, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, image.height, w, legendH);
  ctx.fillStyle = '#1b1b1f';
  ctx.textBaseline = 'top';
  let y = image.height + pad;
  ctx.font = `600 ${Math.round(fs * 1.15)}px Inter, system-ui, sans-serif`;
  ctx.fillText('Où trouver les pièces en Île-de-France', pad, y);
  y += line * 1.4;

  const fit = (text: string, max: number) => {
    if (ctx.measureText(text).width <= max) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t + '…';
  };

  if (!products.length) {
    ctx.font = `400 ${fs}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = '#5c5c66';
    ctx.fillText('Aucune pièce du catalogue associée à cette simulation.', pad, y);
    y += line;
  }
  products.forEach((p, i) => {
    ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = '#1b1b1f';
    const priceTxt = euro(p.price);
    const priceW = ctx.measureText(priceTxt).width;
    ctx.fillText(priceTxt, w - pad - priceW, y);
    ctx.fillText(fit(`${i + 1}. ${p.name} · ${categoryLabel(p.category)}`, w - pad * 3 - priceW), pad, y);
    ctx.font = `400 ${Math.round(fs * 0.9)}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = '#5c5c66';
    const where = `${p.brand} — ${p.store}${p.city ? `, ${p.city}` : ''} · prix relevé le ${day(p.priceCheckedAt)}`;
    ctx.fillText(fit(where, w - pad * 2), pad + fs * 1.2, y + line * 0.9);
    y += line * 2;
  });

  y += line * 0.4;
  ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = '#1b1b1f';
  const total = products.reduce((s, p) => s + p.price, 0);
  ctx.fillText(`Total estimé : ${euro(total)}`, pad, y);
  ctx.font = `400 ${Math.round(fs * 0.85)}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = '#8a8a94';
  const note = 'Visuel généré par IA : l’aspect peut différer des produits réels. Prix et disponibilité à confirmer en magasin.';
  ctx.fillText(fit(note, w - pad * 2), pad, y + line);
  return out;
}

export function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, 'image/png');
}
