import { timingSafeEqual } from 'node:crypto';
import { HttpError, type ApiReq } from './http';

function same(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export const appAuthRequired = () => Boolean(process.env.APP_PASSWORD);

/** Accès à l'app : protège les crédits IA. */
export function requireApp(req: ApiReq) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return;
  const given = req.headers['x-app-password'] ?? '';
  if (!same(given, expected)) throw new HttpError(401, 'Mot de passe de l’app invalide.');
}

/** Écriture du catalogue : réservée à l'admin. */
export function requireAdmin(req: ApiReq) {
  requireApp(req);
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
      throw new HttpError(403, 'ADMIN_PASSWORD n’est pas configuré sur le serveur.');
    }
    return; // dev local sans mot de passe admin
  }
  const given = req.headers['x-admin-password'] ?? '';
  if (!same(given, expected)) throw new HttpError(401, 'Mot de passe admin invalide.');
}
