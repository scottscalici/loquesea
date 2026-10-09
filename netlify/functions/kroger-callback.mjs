// Kroger sends the browser here after sign-in. The code is swapped for tokens using the
// client secret, then a tiny page hands the tokens to the Shop page via localStorage.
import { redirectUri, tokenRequest, tokenPayload } from '../lib/kroger.mjs';

export default async (req) => {
    const url = new URL(req.url);
    const cookieState = (req.headers.get('cookie') || '').match(/(?:^|;\s*)kroger_state=([^;]+)/)?.[1];
    let payload, error;
    try {
        if (url.searchParams.get('error')) throw new Error(url.searchParams.get('error_description') || url.searchParams.get('error'));
        if (!cookieState || cookieState !== url.searchParams.get('state')) throw new Error('Sign-in expired, please try again.');
        payload = tokenPayload(await tokenRequest({
            grant_type: 'authorization_code',
            code: url.searchParams.get('code') || '',
            redirect_uri: redirectUri(req)
        }));
    } catch (e) {
        error = e.message;
    }
    // Escape "<" so nothing in the data can close the script tag.
    const data = JSON.stringify({ payload, error }).replace(/</g, '\\u003c');
    const html = `<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kroger</title><p style="font-family:sans-serif;padding:20px">Connecting to Kroger...</p>
<script>
const r = ${data};
try {
    if (r.payload) localStorage.setItem('kroger_auth', JSON.stringify(r.payload));
    else sessionStorage.setItem('kroger_error', r.error || 'Kroger sign-in failed');
} catch (e) {}
location.replace('/food/shop.html?kroger=' + (r.payload ? 'connected' : 'failed'));
</script>`;
    return new Response(html, {
        status: 200,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Set-Cookie': 'kroger_state=; Path=/.netlify/functions; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
        }
    });
};
