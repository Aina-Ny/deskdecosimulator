import react from '@vitejs/plugin-react';
import type { IncomingMessage } from 'node:http';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/** En local, sert /api/* avec les mêmes handlers que Vercel. */
function devApi(): Plugin {
  const routes: Record<string, string> = {
    '/api/config': 'configHandler',
    '/api/catalog': 'catalogHandler',
    '/api/generate': 'generateHandler',
  };
  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve, reject) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });

  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const exported = routes[url.pathname];
        if (!exported) return next();
        const mod = await server.ssrLoadModule('/api/_lib/handlers.ts');
        const { run, normalizeHeaders } = await server.ssrLoadModule('/api/_lib/http.ts');
        const raw = await readBody(req);
        let body: unknown = undefined;
        try {
          body = raw ? JSON.parse(raw) : undefined;
        } catch {
          body = undefined;
        }
        const out = await run(mod[exported], {
          method: req.method ?? 'GET',
          headers: normalizeHeaders(req.headers),
          query: Object.fromEntries(url.searchParams),
          body,
        });
        res.statusCode = out.status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(out.body));
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
  return { plugins: [react(), devApi()] };
});
