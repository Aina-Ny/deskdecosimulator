import { configHandler } from './_lib/handlers.js';
import { vercel } from './_lib/http.js';

export default vercel(configHandler);
