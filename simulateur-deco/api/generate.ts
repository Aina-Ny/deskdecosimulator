import { generateHandler } from './_lib/handlers';
import { vercel } from './_lib/http';

export default vercel(generateHandler);
