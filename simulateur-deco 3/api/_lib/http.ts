import type { VercelRequest, VercelResponse } from '@vercel/node';

export interface ApiReq {
  method: string;
  headers: Record<string, string | undefined>;
  query: Record<string, string>;
  body: unknown;
}

export interface ApiRes {
  status: number;
  body: unknown;
}

export type Handler = (req: ApiReq) => Promise<ApiRes>;

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const ok = (body: unknown): ApiRes => ({ status: 200, body });

export async function run(handler: Handler, req: ApiReq): Promise<ApiRes> {
  try {
    return await handler(req);
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: { error: e.message } };
    console.error(e);
    return { status: 500, body: { error: e instanceof Error ? e.message : 'Erreur serveur' } };
  }
}

function normalizeHeaders(h: Record<string, string | string[] | undefined>) {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
  return out;
}

/** Adaptateur Vercel → handler générique */
export function vercel(handler: Handler) {
  return async (req: VercelRequest, res: VercelResponse) => {
    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.query ?? {})) query[k] = Array.isArray(v) ? v[0] : String(v);
    const out = await run(handler, {
      method: req.method ?? 'GET',
      headers: normalizeHeaders(req.headers),
      query,
      body: req.body,
    });
    res.status(out.status).setHeader('Cache-Control', 'no-store').json(out.body);
  };
}

export { normalizeHeaders };
