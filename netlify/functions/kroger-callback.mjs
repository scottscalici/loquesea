// Netlify function: Kroger redirects here after sign-in.
import { handleCallback } from '../../lib/kroger-core.mjs';

export default (req) => handleCallback(req, process.env, '/.netlify/functions/kroger-callback');
