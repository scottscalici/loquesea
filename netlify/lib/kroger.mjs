// Shared Kroger API helpers for the Netlify functions.
// KROGER_CLIENT_ID and KROGER_CLIENT_SECRET live in Netlify's environment variables, never in the repo.

export const KROGER_API = 'https://api.kroger.com/v1';
export const USER_SCOPES = 'cart.basic:write product.compact';

export function credentials() {
    const id = process.env.KROGER_CLIENT_ID;
    const secret = process.env.KROGER_CLIENT_SECRET;
    if (!id || !secret) throw new HttpError(500, 'Kroger keys are not set up in Netlify yet.');
    return { id, secret };
}

export class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

// The redirect URI must exactly match one registered on the Kroger app.
export function redirectUri(req) {
    return process.env.KROGER_REDIRECT_URI || `${new URL(req.url).origin}/.netlify/functions/kroger-callback`;
}

export async function tokenRequest(params) {
    const { id, secret } = credentials();
    const res = await fetch(`${KROGER_API}/connect/oauth2/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64')
        },
        body: new URLSearchParams(params)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(res.status === 400 || res.status === 401 ? 401 : 502, data.error_description || data.error || 'Kroger sign-in failed');
    return data;
}

// App-level token for product and store search. Kept while this function instance stays warm.
let appToken = null;
export async function appAccessToken() {
    if (appToken && appToken.expires > Date.now() + 60_000) return appToken.value;
    const data = await tokenRequest({ grant_type: 'client_credentials', scope: 'product.compact' });
    appToken = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
    return appToken.value;
}

export async function krogerGet(path, token) {
    const res = await fetch(KROGER_API + path, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(502, data.errors?.reason || data.message || `Kroger request failed (${res.status})`);
    return data;
}

// What the page needs to know about tokens; expires_at is in ms.
export function tokenPayload(data) {
    return { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + (data.expires_in || 1800) * 1000 };
}

export function json(body, status = 200, headers = {}) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
}
