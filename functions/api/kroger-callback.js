// Cloudflare Pages function: Kroger redirects here after sign-in.
import { handleCallback } from '../../lib/kroger-core.mjs';

export const onRequest = ({ request, env }) => handleCallback(request, env, '/api/kroger-callback');
