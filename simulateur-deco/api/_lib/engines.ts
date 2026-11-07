import type { AppConfig, EngineId, GenerateRequest, GenerateResponse, InlineImage } from '../../shared/types';
import { HttpError } from './http';

const GEMINI_DEFAULT_MODEL = 'gemini-3.1-flash-image';
const POLLINATIONS_DEFAULT_MODEL = 'google/gemini-2.5-flash-image';

export const GEMINI_RATIOS = ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

export function availableEngines(): AppConfig['engines'] {
  const list: AppConfig['engines'] = [];
  if (process.env.GEMINI_API_KEY)
    list.push({ id: 'gemini', label: 'Google Gemini (Nano Banana)', model: process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL });
  if (process.env.POLLINATIONS_API_KEY)
    list.push({ id: 'pollinations', label: 'Pollinations', model: process.env.POLLINATIONS_MODEL || POLLINATIONS_DEFAULT_MODEL });
  if (process.env.MOCK_ENGINE === '1') list.push({ id: 'mock', label: 'Moteur factice (test)', model: 'mock' });
  return list;
}

export function defaultEngine(): EngineId | null {
  const engines = availableEngines();
  const wanted = process.env.DEFAULT_ENGINE as EngineId | undefined;
  return engines.find((e) => e.id === wanted)?.id ?? engines[0]?.id ?? null;
}

/* ------------------------------------------------------------------ */
/* Images produit : téléchargées côté serveur (évite le CORS navigateur) */
/* ------------------------------------------------------------------ */

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$|172\.(1[6-9]|2\d|3[01])\.)/i;
const MAX_PRODUCT_IMAGE_BYTES = 4 * 1024 * 1024;

async function fetchProductImage(url: string): Promise<InlineImage | null> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || PRIVATE_HOST.test(u.hostname)) return null;
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(8000), redirect: 'follow' });
    if (!r.ok) return null;
    const mime = (r.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!/^image\/(jpeg|png|webp)$/.test(mime)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.byteLength > MAX_PRODUCT_IMAGE_BYTES) return null;
    return { mime, data: buf.toString('base64') };
  } catch {
    return null;
  }
}

/* --------------------------------- Gemini -------------------------------- */

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  inline_data?: { mime_type: string; data: string };
}

async function callGemini(prompt: string, images: InlineImage[], aspect: string): Promise<{ image: InlineImage; model: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new HttpError(400, 'Moteur Gemini non configuré (GEMINI_API_KEY manquante).');
  const model = process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL;
  const imageConfig: Record<string, string> = {};
  if (GEMINI_RATIOS.includes(aspect)) imageConfig.aspectRatio = aspect;
  if (process.env.GEMINI_IMAGE_SIZE) imageConfig.imageSize = process.env.GEMINI_IMAGE_SIZE;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }, ...images.map((i) => ({ inline_data: { mime_type: i.mime, data: i.data } }))],
      },
    ],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig },
  };

  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(110_000),
  });
  const json = (await r.json().catch(() => ({}))) as {
    error?: { message?: string; status?: string };
    candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };
  if (!r.ok) {
    const msg = json.error?.message ?? `HTTP ${r.status}`;
    throw new HttpError(r.status === 429 ? 429 : 502, `Gemini : ${msg}`);
  }
  for (const c of json.candidates ?? []) {
    for (const p of c.content?.parts ?? []) {
      if (p.inlineData?.data) return { image: { mime: p.inlineData.mimeType, data: p.inlineData.data }, model };
      if (p.inline_data?.data) return { image: { mime: p.inline_data.mime_type, data: p.inline_data.data }, model };
    }
  }
  const reason =
    json.promptFeedback?.blockReason ??
    json.candidates?.[0]?.finishReason ??
    json.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text ??
    'aucune image renvoyée';
  throw new HttpError(502, `Gemini n’a pas produit d’image (${reason}). Reformule le prompt et réessaie.`);
}

/* ------------------------------- Pollinations ----------------------------- */

async function callPollinations(prompt: string, images: InlineImage[], width: number, height: number) {
  const key = process.env.POLLINATIONS_API_KEY;
  if (!key) throw new HttpError(400, 'Moteur Pollinations non configuré (POLLINATIONS_API_KEY manquante).');
  const model = process.env.POLLINATIONS_MODEL || POLLINATIONS_DEFAULT_MODEL;
  const round16 = (n: number) => Math.max(256, Math.round(n / 16) * 16);

  const form = new FormData();
  images.forEach((img, i) => {
    const ext = img.mime.split('/')[1] ?? 'jpg';
    form.append('image', new Blob([Buffer.from(img.data, 'base64')], { type: img.mime }), `image-${i + 1}.${ext}`);
  });
  form.append('prompt', prompt);
  form.append('model', model);
  form.append('size', `${round16(width)}x${round16(height)}`);
  form.append('response_format', 'b64_json');

  const r = await fetch('https://gen.pollinations.ai/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(110_000),
  });
  const json = (await r.json().catch(() => ({}))) as {
    data?: { b64_json?: string; url?: string }[];
    error?: { message?: string } | string;
  };
  if (!r.ok) {
    const msg = typeof json.error === 'string' ? json.error : json.error?.message ?? `HTTP ${r.status}`;
    const hint = r.status === 402 ? ' — solde Pollen épuisé.' : r.status === 401 ? ' — clé invalide.' : '';
    throw new HttpError(r.status === 429 ? 429 : 502, `Pollinations : ${msg}${hint}`);
  }
  const first = json.data?.[0];
  if (first?.b64_json) return { image: { mime: 'image/png', data: first.b64_json }, model };
  if (first?.url) {
    const img = await fetch(first.url, { signal: AbortSignal.timeout(30_000) });
    const mime = (img.headers.get('content-type') ?? 'image/jpeg').split(';')[0];
    return { image: { mime, data: Buffer.from(await img.arrayBuffer()).toString('base64') }, model };
  }
  throw new HttpError(502, 'Pollinations n’a renvoyé aucune image.');
}

/* --------------------------------- Entrée -------------------------------- */

function validate(req: GenerateRequest) {
  if (!req || typeof req.prompt !== 'string' || !req.prompt.trim()) throw new HttpError(400, 'Prompt manquant.');
  if (!req.source?.data || !/^image\//.test(req.source.mime)) throw new HttpError(400, 'Image source manquante.');
  if (req.prompt.length > 8000) throw new HttpError(400, 'Prompt trop long.');
  if ((req.inspirations?.length ?? 0) > 4) throw new HttpError(400, '4 images d’inspiration maximum.');
  if ((req.productRefs?.length ?? 0) > 8) throw new HttpError(400, '8 produits maximum par génération.');
}

/** Décrit au modèle le rôle de chaque image, d'après celles réellement transmises. */
function imageLegend(products: { name: string }[], inspirationCount: number) {
  const lines = ['', 'INPUT IMAGES:', '- Image 1: the original office photo to edit (the base scene).'];
  let n = 2;
  for (const p of products) lines.push(`- Image ${n++}: product reference for "${p.name}" — reproduce this item as faithfully as possible.`);
  for (let i = 0; i < inspirationCount; i++)
    lines.push(`- Image ${n++}: style inspiration only — borrow mood, colors and materials, never its layout, walls or furniture.`);
  return lines.join('\n');
}

export async function generate(req: GenerateRequest): Promise<GenerateResponse> {
  validate(req);
  const engines = availableEngines();
  if (!engines.some((e) => e.id === req.engine)) throw new HttpError(400, `Moteur « ${req.engine} » indisponible.`);

  const fetched = await Promise.all(
    (req.productRefs ?? []).map(async (p) => ({ name: p.name, img: await fetchProductImage(p.imageUrl) })),
  );
  const okProducts = fetched.filter((p): p is { name: string; img: InlineImage } => p.img !== null);
  const productImages = okProducts.map((p) => p.img);
  // Ordre : 1 = photo source, puis produits, puis inspirations (cf. imageLegend).
  const inspirations = req.inspirations ?? [];
  const images = [req.source, ...productImages, ...inspirations];
  const prompt = req.prompt + '\n' + imageLegend(okProducts, inspirations.length);

  if (req.engine === 'mock') {
    await new Promise((r) => setTimeout(r, 600));
    // Test local : renvoie la 1re inspiration si fournie (permet de vérifier le recollage des zones protégées).
    return { image: inspirations[0] ?? req.source, engine: 'mock', model: 'mock', productRefsUsed: productImages.length };
  }
  const out =
    req.engine === 'gemini'
      ? await callGemini(prompt, images, req.aspect)
      : await callPollinations(prompt, images, req.width, req.height);
  return { ...out, engine: req.engine, productRefsUsed: productImages.length };
}
