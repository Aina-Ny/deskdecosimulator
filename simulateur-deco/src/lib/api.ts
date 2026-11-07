import type { AppConfig, GenerateRequest, GenerateResponse, Product } from '../../shared/types';

const APP_KEY = 'sim-deco:app-pwd';
const ADMIN_KEY = 'sim-deco:admin-pwd';

const safeGet = (k: string) => {
  try {
    return sessionStorage.getItem(k) ?? '';
  } catch {
    return '';
  }
};
const safeSet = (k: string, v: string) => {
  try {
    sessionStorage.setItem(k, v);
  } catch {
    /* stockage indisponible : la session reste en mémoire */
  }
};

let appPwd = safeGet(APP_KEY);
let adminPwd = safeGet(ADMIN_KEY);

export const setAppPassword = (p: string) => {
  appPwd = p;
  safeSet(APP_KEY, p);
};
export const setAdminPassword = (p: string) => {
  adminPwd = p;
  safeSet(ADMIN_KEY, p);
};
export const hasAdminPassword = () => Boolean(adminPwd);

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-app-password': appPwd,
      'x-admin-password': adminPwd,
      ...(init.headers ?? {}),
    },
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg =
      (json as { error?: string }).error ??
      (r.status === 413 ? 'Images trop lourdes : retire une inspiration et réessaie.' : `Erreur ${r.status}`);
    throw new ApiError(r.status, msg);
  }
  return json as T;
}

export const api = {
  config: (check?: '1' | 'admin') => call<AppConfig>(`/api/config${check ? `?check=${check}` : ''}`),
  catalog: () => call<Product[]>('/api/catalog'),
  addProduct: (product: Partial<Product>) => call<Product[]>('/api/catalog', { method: 'POST', body: JSON.stringify({ product }) }),
  importProducts: (products: Partial<Product>[]) =>
    call<Product[]>('/api/catalog', { method: 'POST', body: JSON.stringify({ products }) }),
  updateProduct: (product: Partial<Product>) => call<Product[]>('/api/catalog', { method: 'PUT', body: JSON.stringify({ product }) }),
  deleteProduct: (id: string) => call<Product[]>(`/api/catalog?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  generate: (req: GenerateRequest, signal?: AbortSignal) =>
    call<GenerateResponse>('/api/generate', { method: 'POST', body: JSON.stringify(req), signal }),
};
