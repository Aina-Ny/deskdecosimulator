import type { Product } from '../../shared/types';

const KEY = 'simulateur-deco:catalog:v1';

let memory: Product[] = [];

function redisEnv() {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

export const storageKind = (): 'redis' | 'memory' => (redisEnv() ? 'redis' : 'memory');

async function redis(command: unknown[]) {
  const env = redisEnv();
  if (!env) throw new Error('Redis non configuré');
  const r = await fetch(env.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const json = (await r.json()) as { result?: unknown; error?: string };
  if (!r.ok || json.error) throw new Error(`Redis : ${json.error ?? r.status}`);
  return json.result;
}

export async function getCatalog(): Promise<Product[]> {
  if (!redisEnv()) return memory;
  const raw = await redis(['GET', KEY]);
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Product[]) : [];
  } catch {
    return [];
  }
}

export async function saveCatalog(products: Product[]) {
  if (!redisEnv()) {
    memory = products;
    return;
  }
  await redis(['SET', KEY, JSON.stringify(products)]);
}
