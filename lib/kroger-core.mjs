// Kroger sign-in, store/product search and add-to-cart, used by the
// Cloudflare Worker (worker.js) and the Netlify functions (netlify/functions/). KROGER_CLIENT_ID and KROGER_CLIENT_SECRET come from
// the host's environment variables, never from the repo.
//
// handleKroger(req, env, callbackPath) answers ?action=
//   login      -> redirects to Kroger's sign-in page
//   locations  -> stores near ?zip=
//   products   -> search ?q= at ?locationId=
//   refresh    -> POST {refresh_token}, returns fresh user tokens
//   cart       -> POST {items:[{upc, quantity}], modality}, Authorization: Bearer <user token>
// handleCallback(req, env, callbackPath) finishes sign-in.

const KROGER_API = 'https://api.kroger.com/v1';
const USER_SCOPES = 'cart.basic:write product.compact';

class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

function credentials(env) {
    const id = env.KROGER_CLIENT_ID;
    const secret = env.KROGER_CLIENT_SECRET;
    if (!id || !secret) throw new HttpError(500, 'Kroger keys are not set up on this site yet.');
    return { id, secret };
}

// Must exactly match a redirect URI registered on the Kroger app.
function redirectUri(req, env, callbackPath) {
    return env.KROGER_REDIRECT_URI || `${new URL(req.url).origin}${callbackPath}`;
}

async function tokenRequest(env, params) {
    const { id, secret } = credentials(env);
    const res = await fetch(`${KROGER_API}/connect/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + btoa(`${id}:${secret}`) },
        body: new URLSearchParams(params).toString()
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(res.status === 400 || res.status === 401 ? 401 : 502, data.error_description || data.error || 'Kroger sign-in failed');
    return data;
}

// App-level token for product and store search, reused while this instance stays warm.
let appToken = null;
async function appAccessToken(env) {
    if (appToken && appToken.expires > Date.now() + 60_000) return appToken.value;
    const data = await tokenRequest(env, { grant_type: 'client_credentials', scope: 'product.compact' });
    appToken = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
    return appToken.value;
}

async function krogerGet(path, token) {
    const res = await fetch(KROGER_API + path, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(502, data.errors?.reason || data.message || `Kroger request failed (${res.status})`);
    return data;
}

// What the page keeps about the user's sign-in; expires_at is in ms.
function tokenPayload(data) {
    return { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + (data.expires_in || 1800) * 1000 };
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export async function handleKroger(req, env, callbackPath) {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');
    try {
        if (action === 'login') return login(req, env, callbackPath);
        // Everything else is only for this site's own pages.
        const site = req.headers.get('sec-fetch-site');
        if (site && site !== 'same-origin') throw new HttpError(403, 'Not allowed');
        if (action === 'locations') return json(await locations(env, url.searchParams.get('zip')));
        if (action === 'products') return json(await products(env, url.searchParams.get('q'), url.searchParams.get('locationId')));
        if (action === 'refresh' && req.method === 'POST') return json(await refresh(env, await req.json()));
        if (action === 'cart' && req.method === 'POST') return json(await addToCart(req));
        throw new HttpError(400, 'Unknown action');
    } catch (e) {
        return json({ error: e.message }, e.status || 500);
    }
}

function login(req, env, callbackPath) {
    const { id } = credentials(env);
    const state = crypto.randomUUID();
    const target = new URL(`${KROGER_API}/connect/oauth2/authorize`);
    target.search = new URLSearchParams({
        scope: USER_SCOPES, response_type: 'code', client_id: id, redirect_uri: redirectUri(req, env, callbackPath), state
    }).toString();
    return new Response(null, {
        status: 302,
        headers: {
            'Location': target.toString(),
            // Checked by the callback so only a sign-in started here is accepted.
            'Set-Cookie': `kroger_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
        }
    });
}

async function locations(env, zip) {
    if (!/^\d{5}$/.test(zip || '')) throw new HttpError(400, 'Enter a 5-digit zip code.');
    const data = await krogerGet(`/locations?filter.zipCode.near=${zip}&filter.limit=10`, await appAccessToken(env));
    return (data.data || []).map(l => ({
        locationId: l.locationId,
        name: l.name,
        chain: l.chain,
        address: [l.address?.addressLine1, l.address?.city, l.address?.state].filter(Boolean).join(', ')
    }));
}

async function products(env, q, locationId) {
    const term = (q || '').trim();
    if (term.length < 2) throw new HttpError(400, 'Type at least 2 letters to search.');
    const params = new URLSearchParams({ 'filter.term': term.split(/\s+/).slice(0, 8).join(' '), 'filter.limit': '20' });
    if (locationId) params.set('filter.locationId', locationId);
    const data = await krogerGet(`/products?${params}`, await appAccessToken(env));
    return (data.data || []).map(p => {
        const item = p.items?.[0] || {};
        const image = (p.images || []).find(i => i.featured) || p.images?.[0];
        const size = image?.sizes?.find(s => s.size === 'medium') || image?.sizes?.find(s => s.size === 'thumbnail') || image?.sizes?.[0];
        return {
            productId: p.productId,
            upc: p.upc,
            brand: p.brand || '',
            description: p.description,
            size: item.size || '',
            price: item.price?.promo || item.price?.regular || null,
            regularPrice: item.price?.regular || null,
            image: size?.url || '',
            available: item.fulfillment ? !!(item.fulfillment.curbside || item.fulfillment.delivery || item.fulfillment.inStore) : null
        };
    });
}

async function refresh(env, body) {
    if (!body?.refresh_token) throw new HttpError(401, 'Sign in to Kroger again.');
    return tokenPayload(await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: body.refresh_token }));
}

async function addToCart(req) {
    const auth = req.headers.get('authorization') || '';
    if (!auth.startsWith('Bearer ')) throw new HttpError(401, 'Sign in to Kroger first.');
    const { items, modality } = await req.json();
    const clean = (items || [])
        .filter(i => /^\d{6,14}$/.test(i.upc) && Number.isInteger(i.quantity) && i.quantity > 0 && i.quantity <= 50)
        .map(i => ({ upc: i.upc, quantity: i.quantity, ...(modality === 'DELIVERY' || modality === 'PICKUP' ? { modality } : {}) }));
    if (!clean.length) throw new HttpError(400, 'Nothing to add.');
    const res = await fetch(`${KROGER_API}/cart/add`, {
        method: 'PUT',
        headers: { 'Authorization': auth, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ items: clean })
    });
    if (res.status === 401) throw new HttpError(401, 'Kroger sign-in expired.');
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new HttpError(502, data.errors?.reason || data.message || `Kroger cart error (${res.status})`);
    }
    return { added: clean.length };
}

// Kroger sends the browser here after sign-in. The code is swapped for tokens using the
// client secret, then a tiny page hands the tokens to the Shop page via localStorage.
export async function handleCallback(req, env, callbackPath) {
    const url = new URL(req.url);
    const cookieState = (req.headers.get('cookie') || '').match(/(?:^|;\s*)kroger_state=([^;]+)/)?.[1];
    let payload, error;
    try {
        if (url.searchParams.get('error')) throw new Error(url.searchParams.get('error_description') || url.searchParams.get('error'));
        if (!cookieState || cookieState !== url.searchParams.get('state')) throw new Error('Sign-in expired, please try again.');
        payload = tokenPayload(await tokenRequest(env, {
            grant_type: 'authorization_code',
            code: url.searchParams.get('code') || '',
            redirect_uri: redirectUri(req, env, callbackPath)
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
            'Set-Cookie': 'kroger_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
        }
    });
}
