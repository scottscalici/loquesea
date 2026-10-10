// Entry point for the Cloudflare Worker. Files in the repo are served as-is;
// only the Kroger helper paths run code (see lib/kroger-core.mjs).
import { handleKroger, handleCallback } from './lib/kroger-core.mjs';

const CALLBACK_PATH = '/api/kroger-callback';

export default {
    async fetch(request, env) {
        const { pathname } = new URL(request.url);
        if (pathname === '/api/kroger') return handleKroger(request, env, CALLBACK_PATH);
        if (pathname === CALLBACK_PATH) return handleCallback(request, env, CALLBACK_PATH);
        return env.ASSETS.fetch(request);
    }
};
