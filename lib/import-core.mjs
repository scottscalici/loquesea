// Recipe import for the Recipes page: /api/import?url=...
// - TikTok: the video's caption (via TikTok's public oEmbed), with a guess at which
//   parts are ingredients. Many creators only show ingredients on screen, so this
//   can come back empty.
// - YouTube: the video title (descriptions aren't public without an API key).
// - Recipe websites: the schema.org Recipe data most sites embed for search engines.
// Returns { kind, name, video?, link?, caption?, ingredients: [{ text, likely }] }.

const BROWSER_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const MAX_PAGE = 3_000_000;

class ImportError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export async function handleImport(req) {
    try {
        const site = req.headers.get('sec-fetch-site');
        if (site && site !== 'same-origin') throw new ImportError(403, 'Not allowed');
        let url;
        try { url = new URL((new URL(req.url).searchParams.get('url') || '').trim()); } catch { throw new ImportError(400, "That doesn't look like a link."); }
        if (!/^https?:$/.test(url.protocol)) throw new ImportError(400, "That doesn't look like a link.");
        const host = url.hostname.toLowerCase();
        if (/(^|\.)tiktok\.com$/.test(host)) return json(await fromTikTok(url));
        if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return json(await fromYouTube(url));
        if (/(^|\.)instagram\.com$/.test(host)) {
            return json({ kind: 'video', name: '', video: url.href, ingredients: [],
                message: "Instagram doesn't share captions with other sites. Copy the caption in the Instagram app and use Paste a list." });
        }
        return json(await fromWebPage(url));
    } catch (e) {
        return json({ error: e.message }, e.status || 502);
    }
}

// ---------- TikTok ----------

// Short links (vm.tiktok.com/..., tiktok.com/t/...) redirect to the full video URL.
async function resolveRedirects(url) {
    let current = url.href;
    for (let i = 0; i < 5; i++) {
        const res = await fetch(current, { method: 'GET', redirect: 'manual', headers: { 'User-Agent': BROWSER_UA } });
        const next = res.headers.get('location');
        if (res.status < 300 || res.status >= 400 || !next) break;
        current = new URL(next, current).href;
    }
    const final = new URL(current);
    final.search = '';
    return final.href;
}

async function fromTikTok(url) {
    let target = url.href;
    if (/^v[mt]\./.test(url.hostname) || url.pathname.startsWith('/t/')) {
        target = await resolveRedirects(url).catch(() => url.href);
    }
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(target)}`, { headers: { 'User-Agent': BROWSER_UA, 'Accept': 'application/json' } });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) throw new ImportError(502, "TikTok didn't return that video. Check the link, or the video may be private.");
    const caption = decodeEntities(data.title || '');
    return {
        kind: 'video',
        name: guessName(caption) || '',
        author: data.author_name || '',
        video: url.href,
        caption,
        ingredients: captionIngredients(caption)
    };
}

// The first sentence/line of the caption, without hashtags or emoji, as a name idea.
function guessName(caption) {
    const first = stripTags(caption).split(/\n|ingredients?\s*[:\-–]|[.!?](\s|$)/i)[0] || '';
    const clean = first.replace(/[^\p{L}\p{N}&'’ ,\-]/gu, ' ').replace(/\s+/g, ' ').trim();
    return clean.length >= 3 && clean.split(' ').length <= 10 ? clean : '';
}

function stripTags(text) {
    return text.replace(/#[\p{L}\p{N}_]+/gu, ' ').replace(/@[\w.]+/g, ' ');
}

const BULLETS = /\r?\n|•|·|;|\s[-–]\s|✅|✔️?|▪️?|🔸|🔹|➡️?|👉/u;
const STOPWORDS = /^(ingredients?|instructions?|directions?|method|steps?|recipe|enjoy|follow|save|link in bio|full recipe|comment|like|share|subscribe|so good|so easy|yum+|delicious|try this|you need this|the best)\b/i;
const FOODISH = /\b(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|cans?|cloves?|grams?|g|ml|pinch|bunch|slices?|packs?|packages?|jars?|bags?)\b/i;

// Splits a caption into candidate ingredient lines. "likely" ones are pre-checked.
export function captionIngredients(caption) {
    let text = stripTags(caption);
    const title = (guessName(caption) || '').toLowerCase();
    const start = text.match(/ingredients?\s*(?:[:\-–]|\n)/i);
    const hasHeading = !!start;
    if (start) text = text.slice(start.index + start[0].length);
    const end = text.match(/\b(instructions?|directions?|method|steps|how to make( it)?)\s*(?:[:\-–]|\n)/i);
    if (end) text = text.slice(0, end.index);

    const parts = text.split(BULLETS)
        .flatMap(p => p.split(/,(?![^(]*\))/))
        .map(p => p.replace(/^[^\p{L}\p{N}½¼¾⅓⅔⅛]+/u, '').replace(/[\s.!]+$/u, '').trim())
        .filter(p => p.length >= 2 && p.length <= 80 && !STOPWORDS.test(p));

    const seen = new Set();
    return parts.filter(p => !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase())).map(p => {
        const words = p.split(/\s+/).length;
        const startsWithQty = /^(\d|[½¼¾⅓⅔⅛])/.test(p);
        const isTitle = !hasHeading && title && p.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim() === title.toLowerCase();
        const likely = !isTitle && words <= 8 && (hasHeading || startsWithQty || FOODISH.test(p) || words <= 3);
        return { text: p, likely };
    }).filter(c => c.likely || c.text.split(/\s+/).length <= 12);
}

// ---------- YouTube ----------

async function fromYouTube(url) {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url.href)}`, { headers: { 'User-Agent': BROWSER_UA } });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) throw new ImportError(502, "YouTube didn't return that video. Check the link.");
    return {
        kind: 'video', name: decodeEntities(data.title || ''), author: data.author_name || '', video: url.href, ingredients: [],
        message: "YouTube doesn't share video descriptions with other sites. If the ingredients are in the description, copy it in the YouTube app and use Paste a list."
    };
}

// ---------- Recipe websites ----------

async function fromWebPage(url) {
    const res = await fetch(url.href, { headers: { 'User-Agent': BROWSER_UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' } });
    if (!res.ok) throw new ImportError(502, `That site didn't let us read the page (${res.status}).`);
    const html = (await res.text()).slice(0, MAX_PAGE);
    const recipe = findRecipe(html);
    const pageTitle = decodeEntities((html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i) || html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '');
    if (!recipe) {
        return { kind: 'page', name: pageTitle.trim(), link: url.href, ingredients: [],
            message: "Couldn't find a recipe card on that page. If it lists ingredients, copy them and use Paste a list." };
    }
    const lines = [].concat(recipe.recipeIngredient || recipe.ingredients || [])
        .map(i => decodeEntities(String(i)).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    return {
        kind: 'page',
        name: decodeEntities(String(recipe.name || pageTitle || '')).trim(),
        link: url.href,
        ingredients: lines.map(text => ({ text, likely: true }))
    };
}

function findRecipe(html) {
    const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    for (const [, body] of blocks) {
        let data;
        try { data = JSON.parse(body.trim().replace(/^<!--|-->$/g, '').replace(/^\/\/<!\[CDATA\[|\/\/\]\]>$/g, '')); } catch { continue; }
        const found = walk(data);
        if (found) return found;
    }
    return null;
}

function walk(node, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 6) return null;
    if (Array.isArray(node)) {
        for (const n of node) { const f = walk(n, depth + 1); if (f) return f; }
        return null;
    }
    const type = [].concat(node['@type'] || []).map(t => String(t).toLowerCase());
    if (type.includes('recipe')) return node;
    for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) {
        const f = walk(node[key], depth + 1);
        if (f) return f;
    }
    return null;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', frac12: '½', frac14: '¼', frac34: '¾', deg: '°', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…' };
function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
        if (e[0] === '#') {
            const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : m;
        }
        return ENTITIES[e.toLowerCase()] ?? m;
    });
}
