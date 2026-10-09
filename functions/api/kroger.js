// Cloudflare Pages function: /api/kroger?action=...  (see lib/kroger-core.mjs)
import { handleKroger } from '../../lib/kroger-core.mjs';

export const onRequest = ({ request, env }) => handleKroger(request, env, '/api/kroger-callback');
