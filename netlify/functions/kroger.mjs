// Netlify function: /.netlify/functions/kroger?action=...  (see lib/kroger-core.mjs)
import { handleKroger } from '../../lib/kroger-core.mjs';

export default (req) => handleKroger(req, process.env, '/.netlify/functions/kroger-callback');
