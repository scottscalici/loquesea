// Cozi calendar feed for the dashboard (planner/index.html): /api/cozi
// The feed's private link lives in the COZI_FEED_URL secret, never in the repo.
// Anyone holding the link can read the family calendar, so this route only
// answers requests carrying the DASHBOARD_KEY passphrase (X-Dashboard-Key).

function text(body, status, type = 'text/plain') {
    return new Response(body, { status, headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });
}

// Compare without stopping at the first different character.
function sameKey(given, expected) {
    const a = new TextEncoder().encode(given);
    const b = new TextEncoder().encode(expected);
    let diff = a.length ^ b.length;
    for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
    return diff === 0;
}

export async function handleCozi(req, env) {
    if (!env.COZI_FEED_URL || !env.DASHBOARD_KEY) return text('Cozi is not set up on this site yet.', 500);
    if (!sameKey(req.headers.get('x-dashboard-key') || '', env.DASHBOARD_KEY)) return text('Wrong passphrase', 401);
    const res = await fetch(env.COZI_FEED_URL);
    if (!res.ok) return text(`Cozi feed failed (${res.status})`, 502);
    return text(await res.text(), 200, 'text/calendar; charset=utf-8');
}
