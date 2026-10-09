// /.netlify/functions/kroger?action=...
//   login      -> redirects to Kroger's sign-in page
//   locations  -> stores near ?zip=
//   products   -> search ?q= at ?locationId=
//   refresh    -> POST {refresh_token}, returns fresh user tokens
//   cart       -> POST {items:[{upc, quantity}], modality}, Authorization: Bearer <user token>
import { USER_SCOPES, KROGER_API, HttpError, credentials, redirectUri, tokenRequest, appAccessToken, krogerGet, tokenPayload, json } from '../lib/kroger.mjs';

export default async (req) => {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');
    try {
        if (action === 'login') return login(req);
        // Everything else is only for this site's own pages.
        if (req.headers.get('sec-fetch-site') && req.headers.get('sec-fetch-site') !== 'same-origin') {
            throw new HttpError(403, 'Not allowed');
        }
        if (action === 'locations') return json(await locations(url.searchParams.get('zip')));
        if (action === 'products') return json(await products(url.searchParams.get('q'), url.searchParams.get('locationId')));
        if (action === 'refresh' && req.method === 'POST') return json(await refresh(await req.json()));
        if (action === 'cart' && req.method === 'POST') return json(await addToCart(req));
        throw new HttpError(400, 'Unknown action');
    } catch (e) {
        return json({ error: e.message }, e.status || 500);
    }
};

function login(req) {
    const { id } = credentials();
    const state = crypto.randomUUID();
    const target = new URL(`${KROGER_API}/connect/oauth2/authorize`);
    target.search = new URLSearchParams({
        scope: USER_SCOPES, response_type: 'code', client_id: id, redirect_uri: redirectUri(req), state
    });
    return new Response(null, {
        status: 302,
        headers: {
            'Location': target.toString(),
            // Checked by kroger-callback so only a sign-in started here is accepted.
            'Set-Cookie': `kroger_state=${state}; Path=/.netlify/functions; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
        }
    });
}

async function locations(zip) {
    if (!/^\d{5}$/.test(zip || '')) throw new HttpError(400, 'Enter a 5-digit zip code.');
    const data = await krogerGet(`/locations?filter.zipCode.near=${zip}&filter.limit=10`, await appAccessToken());
    return (data.data || []).map(l => ({
        locationId: l.locationId,
        name: l.name,
        chain: l.chain,
        address: [l.address?.addressLine1, l.address?.city, l.address?.state].filter(Boolean).join(', ')
    }));
}

async function products(q, locationId) {
    const term = (q || '').trim();
    if (term.length < 2) throw new HttpError(400, 'Type at least 2 letters to search.');
    const params = new URLSearchParams({ 'filter.term': term.split(/\s+/).slice(0, 8).join(' '), 'filter.limit': '20' });
    if (locationId) params.set('filter.locationId', locationId);
    const data = await krogerGet(`/products?${params}`, await appAccessToken());
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

async function refresh(body) {
    if (!body?.refresh_token) throw new HttpError(401, 'Sign in to Kroger again.');
    return tokenPayload(await tokenRequest({ grant_type: 'refresh_token', refresh_token: body.refresh_token }));
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
