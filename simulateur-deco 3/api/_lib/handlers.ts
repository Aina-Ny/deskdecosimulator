import { randomUUID } from 'node:crypto';
import { CATEGORIES } from '../../shared/categories.js';
import type { AppConfig, GenerateRequest, Product } from '../../shared/types.js';
import { appAuthRequired, requireAdmin, requireApp } from './auth.js';
import { availableEngines, defaultEngine, generate } from './engines.js';
import { HttpError, ok, type Handler } from './http.js';
import { getCatalog, saveCatalog, storageKind } from './store.js';

export const configHandler: Handler = async (req) => {
  if (req.method !== 'GET') throw new HttpError(405, 'Méthode non autorisée');
  // Le contrôle du mot de passe est optionnel ici : le front s'en sert pour valider la saisie.
  if (req.query.check === '1') requireApp(req);
  if (req.query.check === 'admin') requireAdmin(req);
  const cfg: AppConfig = {
    authRequired: appAuthRequired(),
    engines: availableEngines(),
    defaultEngine: defaultEngine(),
    storage: storageKind(),
  };
  return ok(cfg);
};

export const generateHandler: Handler = async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Méthode non autorisée');
  requireApp(req);
  return ok(await generate(req.body as GenerateRequest));
};

const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));
const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const optUrl = (v: unknown) => {
  const s = str(v, 1000);
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
};

function sanitize(input: Partial<Product>, existing?: Product): Product {
  const name = str(input.name, 120);
  const brand = str(input.brand, 80);
  const store = str(input.store, 200);
  const price = Number(input.price);
  if (!name) throw new HttpError(400, 'Nom du produit obligatoire.');
  if (!input.category || !CATEGORY_IDS.has(input.category)) throw new HttpError(400, 'Catégorie invalide.');
  if (!brand) throw new HttpError(400, 'Enseigne obligatoire.');
  if (!store) throw new HttpError(400, 'Magasin obligatoire.');
  if (!Number.isFinite(price) || price < 0 || price > 100_000) throw new HttpError(400, 'Prix invalide.');
  const priceChanged = !existing || existing.price !== price;
  return {
    id: existing?.id ?? randomUUID(),
    name,
    category: input.category,
    brand,
    store,
    city: str(input.city, 80),
    price: Math.round(price * 100) / 100,
    url: optUrl(input.url),
    imageUrl: optUrl(input.imageUrl),
    styles: Array.isArray(input.styles) ? input.styles.map((s) => str(s, 40)).filter(Boolean).slice(0, 10) : [],
    description: str(input.description, 300) || undefined,
    priceCheckedAt:
      str(input.priceCheckedAt, 30) || (priceChanged ? new Date().toISOString() : existing!.priceCheckedAt),
  };
}

export const catalogHandler: Handler = async (req) => {
  if (req.method === 'GET') {
    requireApp(req);
    return ok(await getCatalog());
  }
  requireAdmin(req);
  const list = await getCatalog();
  const body = (req.body ?? {}) as { product?: Partial<Product>; products?: Partial<Product>[]; id?: string };

  if (req.method === 'POST') {
    // Import en masse (remplace) ou ajout unitaire
    if (Array.isArray(body.products)) {
      const next = body.products.slice(0, 1000).map((p) => sanitize(p));
      await saveCatalog(next);
      return ok(next);
    }
    const p = sanitize(body.product ?? {});
    const next = [...list, p];
    await saveCatalog(next);
    return ok(next);
  }
  if (req.method === 'PUT') {
    const id = body.product?.id;
    const existing = list.find((p) => p.id === id);
    if (!existing) throw new HttpError(404, 'Produit introuvable.');
    const updated = sanitize({ ...body.product, priceCheckedAt: undefined }, existing);
    const next = list.map((p) => (p.id === id ? updated : p));
    await saveCatalog(next);
    return ok(next);
  }
  if (req.method === 'DELETE') {
    const id = req.query.id ?? body.id;
    const next = list.filter((p) => p.id !== id);
    if (next.length === list.length) throw new HttpError(404, 'Produit introuvable.');
    await saveCatalog(next);
    return ok(next);
  }
  throw new HttpError(405, 'Méthode non autorisée');
};
