import type { AppConfig, EngineId, GenerateRequest, GenerateResponse, InlineImage } from '../../shared/types.js';
import { HttpError } from './http.js';

const GEMINI_DEFAULT_MODEL = 'gemini-3.1-flash-image';
const POLLINATIONS_DEFAULT_MODEL = 'google/gemini-2.5-flash-image';
const CLOUDFLARE_DEFAULT_MODEL = '@cf/black-forest-labs/flux-2-klein-4b';

export const GEMINI_RATIOS = ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

export function availableEngines(): AppConfig['engines'] {
  const list: AppConfig['engines'] = [];
  if (process.env.GEMINI_API_KEY)
    list.push({ id: 'gemini', label: 'Google Gemini (Nano Banana)', model: process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL });
  if (process.env.POLLINATIONS_API_KEY)
    list.push({ id: 'pollinations', label: 'Pollinations', model: process.env.POLLINATIONS_MODEL || POLLINATIONS_DEFAULT_MODEL });
  if (cloudflareEnv())
    list.push({ id: 'cloudflare', label: 'Cloudflare (gratuit)', model: process.env.CLOUDFLARE_MODEL || CLOUDFLARE_DEFAULT_MODEL });
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
  // Nettoie les erreurs de copier-coller courantes : espaces, retours à la ligne, guillemets, préfixe "Bearer".
  const key = (process.env.POLLINATIONS_API_KEY ?? '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  if (!key) throw new HttpError(400, 'Moteur Pollinations non configuré (POLLINATIONS_API_KEY manquante).');
  if (key.startsWith('pk_'))
    throw new HttpError(
      400,
      'Pollinations : la clé configurée est une clé publique (pk_). Il faut une clé secrète sk_ — à créer sur enter.pollinations.ai, onglet Keys.',
    );
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
    const hint = r.status === 402 ? ' — solde Pollen épuisé.' : r.status === 401
          ? ` — clé refusée (clé reçue : ${key.slice(0, 3)}… ${key.length} caractères). Vérifie qu'elle commence par sk_, qu'elle est active sur enter.pollinations.ai, puis redéploie.`
          : '';
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

/* ------------------------- Cloudflare Workers AI ------------------------- */
/* Gratuit : 10 000 neurones/jour (offre Workers Free, sans carte bancaire). */

function cloudflareEnv() {
  const account = (process.env.CLOUDFLARE_ACCOUNT_ID ?? '').trim();
  const token = (process.env.CLOUDFLARE_API_TOKEN ?? '').trim().replace(/^Bearer\s+/i, '');
  return account && token ? { account, token } : null;
}

async function callCloudflare(prompt: string, images: InlineImage[], width: number, height: number) {
  const env = cloudflareEnv();
  if (!env) throw new HttpError(400, 'Moteur Cloudflare non configuré (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN).');
  const model = process.env.CLOUDFLARE_MODEL || CLOUDFLARE_DEFAULT_MODEL;
  // Sortie : bord long 1024 px, multiples de 16.
  const scale = 1024 / Math.max(width, height);
  const r16 = (n: number) => Math.max(256, Math.round((n * scale) / 16) * 16);

  const form = new FormData();
  // Cloudflare limite la taille d'un prompt : on garde l'essentiel.
  form.append('prompt', prompt.slice(0, 2000));
  images.slice(0, 4).forEach((img, i) => {
    form.append(`input_image_${i}`, new Blob([Buffer.from(img.data, 'base64')], { type: img.mime }), `image-${i}.jpg`);
  });
  form.append('width', String(r16(width)));
  form.append('height', String(r16(height)));

  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.account)}/ai/run/${model}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.token}` },
    body: form,
    signal: AbortSignal.timeout(110_000),
  });
  const json = (await r.json().catch(() => ({}))) as {
    success?: boolean;
    result?: { image?: string };
    image?: string;
    errors?: { message?: string; code?: number }[];
  };
  const image = json.result?.image ?? json.image;
  if (!r.ok || !image) {
    const msg = json.errors?.map((e) => e.message).filter(Boolean).join(' · ') || `HTTP ${r.status}`;
    const hint =
      r.status === 401 || r.status === 403
        ? ' — jeton ou identifiant de compte invalide (le jeton doit avoir la permission « Workers AI »).'
        : r.status === 429 || /neuron|quota|limit/i.test(msg)
          ? ' — quota gratuit du jour atteint (remis à zéro à 1 h du matin, heure de Paris).'
          : '';
    throw new HttpError(r.status === 429 ? 429 : 502, `Cloudflare : ${msg}${hint}`);
  }
  return { image: { mime: image.startsWith('/9j') ? 'image/jpeg' : 'image/png', data: image }, model };
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
function imageLegend(products: { name: string }[], inspirationCount: number, base = 1) {
  const lines = ['', 'INPUT IMAGES:', `- Image ${base}: the original office photo to edit (the base scene).`];
  let n = base + 1;
  for (const p of products) lines.push(`- Image ${n++}: product reference for "${p.name}" — reproduce this item as faithfully as possible.`);
  for (let i = 0; i < inspirationCount; i++)
    lines.push(`- Image ${n++}: style inspiration only — borrow mood, colors and materials, never its layout, walls or furniture.`);
  return lines.join('\n');
}

export async function generate(req: GenerateRequest): Promise<GenerateResponse> {
  validate(req);
  const engines = availableEngines();
  if (!engines.some((e) => e.id === req.engine)) throw new HttpError(400, `Moteur « ${req.engine} » indisponible.`);

  // Cloudflare : 4 images max, toutes < 512 px (redimensionnées côté navigateur).
  // Les photos produit, de taille inconnue, ne sont donc pas transmises : elles restent décrites dans le prompt.
  const isCf = req.engine === 'cloudflare';
  const fetched = isCf
    ? []
    : await Promise.all(
        (req.productRefs ?? []).map(async (p) => ({ name: p.name, img: await fetchProductImage(p.imageUrl) })),
      );
  const okProducts = fetched.filter((p): p is { name: string; img: InlineImage } => p.img !== null);
  const productImages = okProducts.map((p) => p.img);
  // Ordre : 1 = photo source, puis produits, puis inspirations (cf. imageLegend).
  const inspirations = (req.inspirations ?? []).slice(0, isCf ? 3 : 4);
  const images = [req.source, ...productImages, ...inspirations];
  // Cloudflare numérote les images à partir de 0 et tronque les longs prompts : la légende passe en tête.
  const prompt = isCf
    ? imageLegend(okProducts, inspirations.length, 0).trim() + '\n\n' + req.prompt.replaceAll('image 1', 'image 0')
    : req.prompt + '\n' + imageLegend(okProducts, inspirations.length);

  if (req.engine === 'mock') {
    await new Promise((r) => setTimeout(r, 600));
    // Test local : renvoie la 1re inspiration si fournie (permet de vérifier le recollage des zones protégées).
    return { image: inspirations[0] ?? req.source, engine: 'mock', model: 'mock', productRefsUsed: productImages.length };
  }
  const out =
    req.engine === 'gemini'
      ? await callGemini(prompt, images, req.aspect)
      : req.engine === 'cloudflare'
        ? await callCloudflare(prompt, images, req.width, req.height)
        : await callPollinations(prompt, images, req.width, req.height);
  return { ...out, engine: req.engine, productRefsUsed: productImages.length };
}
