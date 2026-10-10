// Shared helpers for the food pages: GitHub storage + ingredient handling.

const REPO = 'scottscalici/loquesea';
const API = `https://api.github.com/repos/${REPO}/contents/`;

function getToken(message = 'Enter GitHub Token:') {
    let token = localStorage.getItem('gh_token');
    if (!token) {
        token = prompt(message);
        if (token) localStorage.setItem('gh_token', token.trim());
    }
    return token;
}

// A saved token that has expired or been deleted gets a 401; ask for a new one and retry once.
async function githubFetch(url, options = {}) {
    const send = () => fetch(url, { ...options, headers: { ...options.headers, 'Authorization': `token ${getToken()}` } });
    let res = await send();
    if (res.status === 401) {
        localStorage.removeItem('gh_token');
        if (getToken('GitHub rejected the saved token (it may have expired). Paste a new token:')) res = await send();
    }
    return res;
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
    const res = await githubFetch(`${API}${path}?t=${Date.now()}`, { cache: 'no-store' });
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
        const res = await githubFetch(API + path, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                // [skip ci] tells Netlify (and Cloudflare) not to redeploy for a data save.
                message: `${message} [skip ci]`,
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
    'cup', 'cups', 'tbsp', 'tsp', 'clove', 'cloves', 'dozen', 'pouch', 'pouches', 'block', 'blocks',
    'gallon', 'gallons', 'gal', 'quart', 'quarts', 'pint', 'pints', 'carton', 'cartons', 'container', 'containers',
    'tub', 'tubs', 'package', 'packages', 'packet', 'packets', 'stick', 'sticks', 'ct',
    'tablespoon', 'tablespoons', 'teaspoon', 'teaspoons', 'ounce', 'ounces', 'pound', 'pounds',
    'g', 'grams', 'kg', 'ml', 'l', 'liter', 'liters', 'pinch', 'pinches', 'dash', 'dashes',
    'slice', 'slices', 'piece', 'pieces', 'sprig', 'sprigs', 'handful', 'handfuls', 'envelope', 'envelopes'];

// Whole numbers, decimals, fractions, mixed numbers ("1 1/2", "1½") and ranges ("2-3").
const QTY = String.raw`(?:\d+(?:\.\d+)?(?:\s*[½¼¾⅓⅔⅛]|\s+\d+\/\d+)?|\d+\/\d+|[½¼¾⅓⅔⅛])`;
const QTY_RE = new RegExp(`^(${QTY}(?:\\s*(?:-|–|to)\\s*${QTY})?)\\s*(?:x\\s+)?`, 'i');

// "2 cans black beans (rinsed)" -> { item: "black beans", amount: "2 cans", note: "rinsed" }
// "1 (15 ounce) can corn, drained" -> { item: "corn", amount: "1 can (15 ounce)", note: "drained" }
function parseIngredientLine(line) {
    let text = line.trim().replace(/^[-*•▢□]\s*/, '');
    if (!text) return null;
    const notes = [];
    const trailing = text.match(/\(([^)]*)\)\s*$/);
    if (trailing) {
        notes.push(trailing[1].trim());
        text = text.slice(0, trailing.index).trim();
    }
    let amount = '';
    const qty = text.match(QTY_RE);
    if (qty) {
        let rest = text.slice(qty[0].length);
        let size = '';
        const paren = rest.match(/^\(([^)]*)\)\s*/);
        if (paren) { size = ` (${paren[1].trim()})`; rest = rest.slice(paren[0].length); }
        let unit = '';
        const u = rest.match(/^([a-z]+)\.?\s+/i);
        if (u && UNITS.includes(u[1].toLowerCase())) { unit = ' ' + u[1]; rest = rest.slice(u[0].length); }
        rest = rest.replace(/^of\s+/i, '');
        if (rest) {
            amount = (qty[1].replace(/\s+/g, ' ') + unit + size).trim();
            text = rest;
        }
    }
    // "garlic, minced" -> note "minced"
    const comma = text.indexOf(', ');
    if (comma > 0) {
        notes.unshift(text.slice(comma + 2).trim());
        text = text.slice(0, comma);
    }
    const note = notes.filter(Boolean).join('; ');
    return { item: text.trim(), ...(amount && { amount }), ...(note && { note }) };
}

function ingredientLabel(ing) {
    return ing.note ? `${ing.item} (${ing.note})` : ing.item;
}

const SINGULAR = { lbs: 'lb', packs: 'pack', cans: 'can', jars: 'jar', bags: 'bag', boxes: 'box',
    bottles: 'bottle', bunches: 'bunch', heads: 'head', loaves: 'loaf', cups: 'cup', cloves: 'clove',
    pouches: 'pouch', blocks: 'block', gallons: 'gallon', quarts: 'quart', pints: 'pint', cartons: 'carton',
    containers: 'container', tubs: 'tub', packages: 'package', packets: 'packet', sticks: 'stick' };
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

// --- Store sections ------------------------------------------------------
// Listed in the order you'd walk the store. food/items.json records each
// item's section; guessSection() fills in new items until one is chosen.

const SECTIONS = ['Produce', 'Bakery & Bread', 'Deli', 'Meat & Seafood', 'Dairy & Eggs',
    'Pasta & Rice', 'Canned & Soups', 'International', 'Oils, Sauces & Condiments',
    'Spices & Baking', 'Snacks & Chips', 'Frozen', 'Other'];

// First match wins, so the more specific sections come first.
const SECTION_RULES = [
    ['Frozen', /\bfrozen\b|voila|\bfries\b|onion rings|egg rolls|dumplings?\b|garlic bread|texas toast|tater tots|ice cream|meatballs/],
    ['Snacks & Chips', /(?<!chocolate )chips|crisps|pretzels|crackers|popcorn|nachos/],
    ['International', /curry paste|coconut milk|saz[oó]n|aj[ií] amarillo|sofrito|miso|wonton|lo mein|ramen|stir fry noodles|tortillas?\b|taco shells|refried|hoisin|oyster sauce|soy sauce|sesame oil|chili oil|mirin|naan|seaweed/],
    ['Spices & Baking', /(biscuit|cake|pancake|brownie|muffin|onion soup|sloppy joe|taco|chili) mix|seasoning/],
    ['Produce', /salad mix|spring mix|salad greens/],
    ['Canned & Soups', /applesauce|canned|broth|stock\b|soup|bisque|(?<!green )beans\b|chickpeas|rotel|tomato paste|tomato sauce|diced tomatoes|crushed tomatoes|pineapple chunks|evaporated milk/],
    ['Pasta & Rice', /pasta|spaghetti|penne|rotini|fettuccine|orzo|ravioli|tortellini|noodles?\b|mac & cheese|\brice\b|quinoa|couscous|knorr|rice-a-roni|tuna helper|lasagna/],
    ['Bakery & Bread', /bread|\bbuns?\b|\brolls?\b|baguette|pita|breadsticks|cornbread|bagels?/],
    ['Deli', /rotisserie|salami|pepperoni|\bdeli\b|\bham\b|hummus|guacamole|cole slaw|salad kit|mashed potatoes|blue cheese dip|tzatziki/],
    ['Meat & Seafood', /chicken|beef|steak|pork|turkey|sausage|bacon|brats|hot ?dogs|burger patties|shrimp|salmon|fish|flounder|crab|lobster|wings|kielbasa|\bmeat\b|tenderloin|chops/],
    ['Spices & Baking', /seasoning|powder|spice|cumin|paprika|turmeric|coriander|garam masala|old bay|\bmsg\b|\bsalt\b|pepper flakes|\bflour\b|sugar|cornstarch|baking|\bmix\b|chocolate chips|gravy|au jus|ground ginger|sesame seeds/],
    ['Oils, Sauces & Condiments', /sauce|ketchup|mayo|mustard|dressing|ranch|salsa|teriyaki|worcestershire|vinegar|glaze|\bjam\b|jelly|syrup|honey|paste|\bdip\b|queso|\boil\b|pickle|gherkins|olives|pepperoncini|banana peppers|peanut butter|alfredo|marinara|arrabbiata/],
    ['Dairy & Eggs', /cheese|cheddar|mozzarella|parmesan|feta|cotija|provolone|milk|cream|butter\b|yogurt|\beggs?\b|velveeta|american/],
    ['Produce', /lettuce|tomato|onion|pepper|garlic|ginger|potato|carrot|celery|broccoli|asparagus|spinach|cucumber|avocado|lemon|lime|cilantro|basil|green beans|corn\b|cabbage|bok choy|brussels|apple|grapes|blueberr|banana|jalape|salad|veggie|\bpeas\b|edamame|mushroom|zucchini|squash|fruit|herbs|plantain|potatoes/],
];

function guessSection(item) {
    const s = item.toLowerCase();
    const hit = SECTION_RULES.find(([, re]) => re.test(s));
    return hit ? hit[0] : 'Other';
}

// Info about an item: { section, pantry?, regular? } from items.json, or a guess.
function itemInfo(items, item) {
    const saved = items[item.trim().toLowerCase()] || {};
    return { section: guessSection(item), ...saved };
}
