// Shared helpers for the food pages: GitHub storage + ingredient handling.

const REPO = 'scottscalici/loquesea';
const API = `https://api.github.com/repos/${REPO}/contents/`;

function getToken() {
    let token = localStorage.getItem('gh_token');
    if (!token) {
        token = prompt('Enter GitHub Token:');
        if (token) localStorage.setItem('gh_token', token.trim());
    }
    return token;
}

// btoa/atob only handle Latin-1, which garbled accented characters on every save.
function encodeBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
}

function decodeBase64(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

async function readJson(path) {
    const res = await fetch(`${API}${path}?t=${Date.now()}`, {
        headers: { 'Authorization': `token ${getToken()}` },
        cache: 'no-store'
    });
    if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
    const file = await res.json();
    return { data: JSON.parse(decodeBase64(file.content)), sha: file.sha };
}

// Fetches the latest copy, applies `mutate(data)`, and saves it back.
// Re-reading first means a save never clobbers a change made from another tab or device.
async function updateJson(path, mutate, message) {
    for (let attempt = 0; attempt < 2; attempt++) {
        const { data, sha } = await readJson(path);
        const updated = mutate(data) ?? data;
        const res = await fetch(API + path, {
            method: 'PUT',
            headers: { 'Authorization': `token ${getToken()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message,
                content: encodeBase64(JSON.stringify(updated, null, 2) + '\n'),
                sha
            })
        });
        if (res.ok) return updated;
        if (res.status !== 409) throw new Error(`Save failed (${res.status})`);
    }
    throw new Error('Save failed: file kept changing, try again');
}

// --- Ingredients ---------------------------------------------------------
// Stored as { item, amount?, note? }. Old data may still be plain strings.

function normalizeIngredient(ing) {
    return typeof ing === 'string' ? { item: ing.trim() } : ing;
}

const UNITS = ['lb', 'lbs', 'oz', 'pack', 'packs', 'pkg', 'can', 'cans', 'jar', 'jars', 'bag', 'bags',
    'box', 'boxes', 'bottle', 'bottles', 'bunch', 'bunches', 'head', 'heads', 'loaf', 'loaves',
    'cup', 'cups', 'tbsp', 'tsp', 'clove', 'cloves', 'dozen', 'pouch', 'pouches', 'block', 'blocks'];

// "2 cans black beans (rinsed)" -> { item: "black beans", amount: "2 cans", note: "rinsed" }
function parseIngredientLine(line) {
    let text = line.trim().replace(/^[-*•]\s*/, '');
    if (!text) return null;
    const out = {};
    const note = text.match(/\(([^)]*)\)\s*$/);
    if (note) {
        out.note = note[1].trim();
        text = text.slice(0, note.index).trim();
    }
    const qty = text.match(/^(\d+(?:[.\/]\d+)?|½|¼|¾)\s*(?:x\s+)?/i);
    if (qty) {
        let amount = qty[1];
        let rest = text.slice(qty[0].length);
        const unit = rest.match(/^([a-z]+)\.?\s+/i);
        if (unit && UNITS.includes(unit[1].toLowerCase())) {
            amount += ' ' + unit[1];
            rest = rest.slice(unit[0].length);
        }
        rest = rest.replace(/^of\s+/i, '');
        if (rest) {
            out.amount = amount;
            text = rest;
        }
    }
    return { item: text.trim(), ...(out.amount && { amount: out.amount }), ...(out.note && { note: out.note }) };
}

function ingredientLabel(ing) {
    return ing.note ? `${ing.item} (${ing.note})` : ing.item;
}

const SINGULAR = { lbs: 'lb', packs: 'pack', cans: 'can', jars: 'jar', bags: 'bag', boxes: 'box',
    bottles: 'bottle', bunches: 'bunch', heads: 'head', loaves: 'loaf', cups: 'cup', cloves: 'clove',
    pouches: 'pouch', blocks: 'block' };
const PLURAL = Object.fromEntries(Object.entries(SINGULAR).map(([p, s]) => [s, p]));

// Adds up amounts like "1 pack" + "2 packs" -> "3 packs"; anything else is listed as-is.
// `bare` counts uses with no amount at all.
function combineAmounts(amounts) {
    const totals = {}, other = [];
    let bare = 0;
    for (const a of amounts) {
        if (!a) { bare++; continue; }
        const m = a.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
        if (!m) { other.push(a); continue; }
        const unit = SINGULAR[m[2].toLowerCase()] || m[2];
        totals[unit] = (totals[unit] || 0) + parseFloat(m[1]);
    }
    const parts = Object.entries(totals).map(([unit, n]) => {
        const num = Math.round(n * 100) / 100;
        const label = num !== 1 && PLURAL[unit.toLowerCase()] ? PLURAL[unit.toLowerCase()] : unit;
        return label ? `${num} ${label}` : `${num}`;
    });
    return { parts: parts.concat(other), bare };
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
