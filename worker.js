// Entry point for the Cloudflare Worker. Files in the repo are served as-is;
// only the helper paths run code: Kroger (lib/kroger-core.mjs) and recipe
// import (lib/import-core.mjs).
import { handleKroger, handleCallback } from './lib/kroger-core.mjs';
import { handleImport } from './lib/import-core.mjs';

const CALLBACK_PATH = '/api/kroger-callback';

export default {
    async fetch(request, env) {
        const { pathname } = new URL(request.url);
        if (pathname === '/api/kroger') return handleKroger(request, env, CALLBACK_PATH);
        if (pathname === CALLBACK_PATH) return handleCallback(request, env, CALLBACK_PATH);
        if (pathname === '/api/import') return handleImport(request);
        return env.ASSETS.fetch(request);
    }
};
