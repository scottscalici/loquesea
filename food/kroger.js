// Kroger features for the Shop page: pick a store, link items to products,
// and send the list to the Kroger cart. Talks to Kroger through the site's
// Kroger helper at /api/kroger (worker.js + lib/kroger-core.mjs), which holds the
// Kroger keys on Cloudflare.
// Uses rows, trip, itemsDb, saveTrip, render and toast from shop.html.

const KROGER_FN = '/api/kroger';
const AUTH_KEY = 'kroger_auth';
const PENDING_KEY = 'kroger_pending';
const WEIGHT_UNITS = ['lb', 'lbs', 'oz', 'cup', 'cups', 'tbsp', 'tsp', 'clove', 'cloves'];
let settingsDb = {};
let reviewQty = {};      // item key -> quantity chosen on the review screen
let reviewOn = {};       // item key -> include in this send

async function krogerInit() {
    settingsDb = await readJson('food/settings.json').then(r => r.data, () => ({}));
    if (Object.keys(pendingItems).length) {
        itemsDb = applyItemChanges({ ...itemsDb }, pendingItems);
        render();
        flushItems();
    }
    const params = new URLSearchParams(location.search);
    const status = params.get('kroger');
    if (status) {
        history.replaceState(null, '', location.pathname);
        if (status === 'connected') {
            toast('Connected to Kroger');
            const pending = readPending();
            if (pending) {
                reviewQty = pending.qty || {};
                reviewOn = pending.on || {};
                openReview(true);
            }
        } else {
            let msg = 'Kroger sign-in failed';
            try { msg = sessionStorage.getItem('kroger_error') || msg; } catch (e) { /* ignore */ }
            toast(msg, true);
        }
    }
}

// ---------- Talking to the Netlify functions ----------
async function krogerApi(action, { params = {}, body, token } = {}) {
    const url = `${KROGER_FN}?${new URLSearchParams({ action, ...params })}`;
    const res = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: { ...(body && { 'Content-Type': 'application/json' }), ...(token && { 'Authorization': `Bearer ${token}` }) },
        body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 404) throw Object.assign(new Error('Kroger only works on the Cloudflare (workers.dev) version of this site.'), { status: 404 });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Kroger error (${res.status})`), { status: res.status });
    return data;
}

function readAuth() {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (e) { return null; }
}
function writeAuth(auth) {
    try { auth ? localStorage.setItem(AUTH_KEY, JSON.stringify(auth)) : localStorage.removeItem(AUTH_KEY); } catch (e) { /* ignore */ }
}
function readPending() {
    try {
        const p = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
        sessionStorage.removeItem(PENDING_KEY);
        return p;
    } catch (e) { return null; }
}

// A user token that's good for at least another minute, or null if Kroger sign-in is needed.
async function krogerUserToken() {
    const auth = readAuth();
    if (!auth) return null;
    if (auth.access_token && auth.expires_at > Date.now() + 60000) return auth.access_token;
    if (!auth.refresh_token) return null;
    try {
        const fresh = await krogerApi('refresh', { body: { refresh_token: auth.refresh_token } });
        writeAuth({ ...auth, ...fresh, refresh_token: fresh.refresh_token || auth.refresh_token });
        return fresh.access_token;
    } catch (e) {
        if (e.status === 401) writeAuth(null);
        else throw e;
        return null;
    }
}

async function signInToKroger() {
    await flushItems();
    try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ qty: reviewQty, on: reviewOn })); } catch (e) { /* ignore */ }
    location.href = `${KROGER_FN}?action=login`;
}

// ---------- Saving to the repo ----------
async function saveSettings(patch, message) {
    settingsDb = { ...settingsDb, ...patch };
    settingsDb = await updateJson('food/settings.json', s => ({ ...s, ...patch }), message);
}

// Item changes (product links, skips) are applied right away and saved to
// items.json in batches, so linking many items doesn't make a commit per tap.
// Unsaved changes are also kept on the phone and saved on the next visit if
// the page closes first.
const UNSAVED_KEY = 'kroger_unsaved_items';
let pendingItems = loadUnsaved();   // item key -> { field: value, null = remove }
let flushTimer = null;
let flushing = null;

function loadUnsaved() {
    try { return JSON.parse(localStorage.getItem(UNSAVED_KEY) || '{}'); } catch (e) { return {}; }
}
function storeUnsaved() {
    try { localStorage.setItem(UNSAVED_KEY, JSON.stringify(pendingItems)); } catch (e) { /* still saved in a moment */ }
}

function changeItem(key, patch) {
    pendingItems[key] = { ...(pendingItems[key] || {}), ...patch };
    storeUnsaved();
    itemsDb = applyItemChanges({ ...itemsDb }, { [key]: patch });
    render();
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flushItems, 2500);
}

function applyItemChanges(items, changes) {
    Object.entries(changes).forEach(([key, patch]) => {
        const next = { ...(items[key] || {}) };
        Object.entries(patch).forEach(([field, value]) => {
            if (value === null) delete next[field]; else next[field] = value;
        });
        if (Object.keys(next).length) items[key] = next; else delete items[key];
    });
    return Object.fromEntries(Object.keys(items).sort().map(k => [k, items[k]]));
}

async function flushItems() {
    clearTimeout(flushTimer);
    if (flushing) await flushing;
    const changes = pendingItems;
    const count = Object.keys(changes).length;
    if (!count) return;
    pendingItems = {};
    flushing = updateJson('food/items.json', items => applyItemChanges(items, changes),
        count === 1 ? `Kroger: update ${Object.keys(changes)[0]}` : `Kroger: update ${count} items`)
        .then(saved => {
            // Keep anything changed while the save was running.
            itemsDb = applyItemChanges(saved, pendingItems);
            storeUnsaved();
            render();
        })
        .catch(e => {
            pendingItems = { ...changes, ...pendingItems };
            storeUnsaved();
            toast('Could not save Kroger links: ' + e.message, true);
        })
        .finally(() => { flushing = null; });
    return flushing;
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushItems(); });

function linkProduct(row, product) {
    const kroger = product ? {
        upc: product.upc, productId: product.productId,
        description: productName(product),
        size: product.size || '', image: product.image || ''
    } : null;
    changeItem(row.key, { kroger, krogerSkip: null });
}

// "Not from Kroger": takes an item out of the linking queue.
function skipItem(row, skip = true) {
    changeItem(row.key, { krogerSkip: skip ? true : null });
}

// ---------- Full-screen panel ----------
function openPanel(title, bodyHtml, footHtml = '', onBack = closePanel) {
    document.getElementById('kpanelTitle').textContent = title;
    document.getElementById('kpanelBody').innerHTML = bodyHtml;
    document.getElementById('kpanelFoot').innerHTML = footHtml;
    document.getElementById('kpanelFoot').hidden = !footHtml;
    document.getElementById('kpanelBack').onclick = onBack;
    document.getElementById('kpanel').classList.add('open');
    document.getElementById('kpanelBody').scrollTop = 0;
}
function closePanel() { document.getElementById('kpanel').classList.remove('open'); }

// ---------- Store picker ----------
function openStorePicker(then) {
    const store = settingsDb.kroger;
    openPanel('Your Kroger store', `
        ${store ? `<p class="kmuted">Current: <b>${escapeHtml(store.name)}</b><br>${escapeHtml(store.address)}</p>` : '<p class="kmuted">Pick the store you shop at, so products and prices match it.</p>'}
        <div class="row"><input type="text" id="kzip" inputmode="numeric" maxlength="5" placeholder="Zip code" autocomplete="postal-code">
        <button class="btn-primary" id="kzipGo">Find</button></div>
        <div id="kstores"></div>`, '', () => then ? then() : closePanel());
    const zip = document.getElementById('kzip');
    const go = async () => {
        const box = document.getElementById('kstores');
        box.innerHTML = '<p class="kmuted">Searching...</p>';
        try {
            const stores = await krogerApi('locations', { params: { zip: zip.value.trim() } });
            box.innerHTML = stores.length ? stores.map((s, i) => `
                <button class="kresult" data-i="${i}"><span class="kres-text"><b>${escapeHtml(s.name)}</b><br><span class="kmuted">${escapeHtml(s.address)}</span></span></button>`).join('')
                : '<p class="kmuted">No stores found near that zip.</p>';
            box.onclick = async e => {
                const b = e.target.closest('.kresult');
                if (!b) return;
                const s = stores[b.dataset.i];
                try {
                    await saveSettings({ kroger: { locationId: s.locationId, name: s.name, address: s.address } }, `Kroger: store ${s.name}`);
                    toast(`Store set: ${s.name}`);
                    then ? then() : closePanel();
                } catch (err) { toast('Could not save: ' + err.message, true); }
            };
        } catch (err) {
            box.innerHTML = `<p class="kerror">${escapeHtml(err.message)}</p>`;
        }
    };
    document.getElementById('kzipGo').onclick = go;
    zip.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    zip.focus();
}

// ---------- Product picker ----------
// With `queue` ({ left, next }), this is one step of "link everything": picking or
// skipping moves on to the next item instead of going back.
function openProductPicker(row, then = closePanel, queue = null) {
    if (!settingsDb.kroger) return openStorePicker(() => openProductPicker(row, then, queue));
    const info = itemInfo(itemsDb, row.item);
    const linked = info.kroger;
    const done = queue ? queue.next : then;
    const foot = queue
        ? `<div class="kqueue"><button class="btn-light" id="kskip">Not from Kroger</button><button class="btn-light" id="klater">Later</button></div>`
        : '';
    openPanel(queue ? `${row.item} · ${queue.left} left` : `Kroger product for "${row.item}"`, `
        ${linked ? `<div class="klinked">${productCard(linked)}<button class="btn-light" id="kunlink">Unlink</button></div>` : ''}
        ${info.krogerSkip ? `<div class="klinked"><span class="kres-text">Marked as not from Kroger.</span><button class="btn-light" id="kunskip">Undo</button></div>` : ''}
        ${row.uses ? `<p class="kmuted">Used in ${row.uses} recipe${row.uses === 1 ? '' : 's'}${row.amounts ? ` · amounts: ${escapeHtml(row.amounts)}` : ''}</p>` : ''}
        <div class="row"><input type="search" id="kq" autocomplete="off"><button class="btn-primary" id="kqGo">Search</button></div>
        <p class="kmuted">At ${escapeHtml(settingsDb.kroger.name)}. Tap the one you usually buy.</p>
        <div id="kproducts"></div>`, foot, () => { flushItems(); then(); });
    const q = document.getElementById('kq');
    q.value = row.item;
    if (linked) document.getElementById('kunlink').onclick = () => { linkProduct(row, null); toast('Unlinked'); then(); };
    if (info.krogerSkip) document.getElementById('kunskip').onclick = () => { skipItem(row, false); openProductPicker(row, then, queue); };
    if (queue) {
        document.getElementById('kskip').onclick = () => { skipItem(row); queue.next(); };
        document.getElementById('klater').onclick = () => queue.next(row.key);
    }
    const go = async () => {
        const box = document.getElementById('kproducts');
        box.innerHTML = '<p class="kmuted">Searching...</p>';
        try {
            const products = await krogerApi('products', { params: { q: q.value, locationId: settingsDb.kroger.locationId } });
            box.innerHTML = products.length
                ? products.map((p, i) => `<button class="kresult" data-i="${i}">${productCard(p)}</button>`).join('')
                : '<p class="kmuted">Nothing found. Try fewer or different words.</p>';
            box.onclick = async e => {
                const b = e.target.closest('.kresult');
                if (!b) return;
                linkProduct(row, products[b.dataset.i]);
                toast(`Linked ${row.item}`);
                done();
            };
        } catch (err) {
            box.innerHTML = `<p class="kerror">${escapeHtml(err.message)}</p>`;
        }
    };
    document.getElementById('kqGo').onclick = go;
    q.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    go();
}

// Kroger descriptions usually start with the brand already; add it only when they don't.
function productName(p) {
    if (!p.brand || !p.description || p.description.toLowerCase().startsWith(p.brand.toLowerCase())) return p.description || '';
    return `${p.brand} ${p.description}`;
}

function productCard(p) {
    const name = productName(p);
    const price = p.price ? `$${Number(p.price).toFixed(2)}` + (p.regularPrice && p.regularPrice > p.price ? ` <s>$${Number(p.regularPrice).toFixed(2)}</s>` : '') : '';
    return `${p.image ? `<img src="${escapeHtml(p.image)}" alt="" loading="lazy">` : '<span class="kimg-empty">🛒</span>'}
        <span class="kres-text"><b>${escapeHtml(name || '')}</b><br>
        <span class="kmuted">${escapeHtml(p.size || '')}${price ? ` · ${price}` : ''}${p.available === false ? ' · not available here' : ''}</span></span>`;
}

// ---------- Link everything (initial setup) ----------
let linkTab = 'todo';
let linkSearch = '';

// Every ingredient in every recipe, plus "every trip" items, most-used first.
function allIngredientRows() {
    const byKey = {};
    const add = (name, recipe, amount) => {
        const key = name.trim().toLowerCase();
        if (!key) return;
        const r = byKey[key] || (byKey[key] = { key, item: name.trim(), recipes: new Set(), amountList: [] });
        if (recipe) r.recipes.add(recipe);
        if (amount) r.amountList.push(amount);
    };
    mealsDb.forEach(m => m.components.forEach(c => c.ingredients.map(normalizeIngredient)
        .forEach(i => add(i.item, m.name, i.amount))));
    Object.entries(itemsDb).forEach(([key, info]) => { if (info.regular) add(info.name || key); });
    return Object.values(byKey).map(r => ({
        key: r.key, item: r.item, uses: r.recipes.size,
        amounts: [...new Set(r.amountList)].slice(0, 3).join(', '),
        info: itemInfo(itemsDb, r.item)
    })).sort((a, b) => b.uses - a.uses || a.item.localeCompare(b.item));
}

function openLinkAll() {
    if (!settingsDb.kroger) return openStorePicker(() => openLinkAll());
    const all = allIngredientRows();
    const groups = {
        todo: all.filter(r => !r.info.kroger && !r.info.krogerSkip),
        linked: all.filter(r => r.info.kroger),
        skipped: all.filter(r => !r.info.kroger && r.info.krogerSkip)
    };
    const doneCount = groups.linked.length + groups.skipped.length;
    const pct = all.length ? Math.round(doneCount / all.length * 100) : 100;
    const q = linkSearch.toLowerCase();
    const shown = groups[linkTab].filter(r => !q || r.item.toLowerCase().includes(q));
    const tab = (id, label) => `<button data-tab="${id}" class="${linkTab === id ? 'on' : ''}">${label} (${groups[id].length})</button>`;
    openPanel('Link Kroger products', `
        <p style="margin:0 0 6px"><b>${groups.linked.length}</b> of ${all.length} ingredients linked${groups.skipped.length ? `, ${groups.skipped.length} skipped` : ''}</p>
        <div class="kbar"><span style="width:${pct}%"></span></div>
        <p class="kmuted">Link each ingredient to the product you buy at ${escapeHtml(settingsDb.kroger.name)}. Most-used ones are first.</p>
        <div class="kmode ktabs">${tab('todo', 'To do')}${tab('linked', 'Linked')}${tab('skipped', 'Skipped')}</div>
        <input type="search" id="klinkq" placeholder="Find an ingredient" autocomplete="off" style="margin-top:10px">
        <div id="klinklist">${shown.map(r => `
            <button class="kresult kitem" data-key="${escapeHtml(r.key)}">
                ${r.info.kroger?.image ? `<img src="${escapeHtml(r.info.kroger.image)}" alt="" loading="lazy">` : ''}
                <span class="kres-text"><b>${escapeHtml(r.item)}</b><br>
                <span class="kmuted">${r.info.kroger ? escapeHtml(r.info.kroger.description + (r.info.kroger.size ? ' · ' + r.info.kroger.size : ''))
                    : r.info.krogerSkip ? 'Not from Kroger' : r.uses ? `in ${r.uses} recipe${r.uses === 1 ? '' : 's'}` : 'every trip'}</span></span>
            </button>`).join('') || `<p class="kmuted">${linkTab === 'todo' && !q ? '🎉 Everything is linked or skipped.' : 'Nothing here.'}</p>`}</div>`,
        groups.todo.length ? `<button class="btn-primary" id="kstartlink">Start linking (${groups.todo.length} to go)</button>` : '',
        () => { flushItems(); closePanel(); });

    const search = document.getElementById('klinkq');
    search.value = linkSearch;
    search.oninput = () => {
        linkSearch = search.value;
        const pos = search.selectionStart;
        openLinkAll();
        const s2 = document.getElementById('klinkq');
        s2.focus();
        s2.setSelectionRange(pos, pos);
    };
    document.querySelectorAll('.ktabs button').forEach(b => b.onclick = () => { linkTab = b.dataset.tab; openLinkAll(); });
    document.getElementById('klinklist').onclick = e => {
        const b = e.target.closest('.kitem');
        if (b) openProductPicker(all.find(r => r.key === b.dataset.key), () => openLinkAll());
    };
    const start = document.getElementById('kstartlink');
    if (start) start.onclick = () => linkQueue(groups.todo.map(r => r.key));
}

// Walks the unlinked items one by one. "Later" moves an item to the end of this run.
function linkQueue(keys) {
    const later = new Set();
    const step = (laterKey) => {
        if (laterKey) later.add(laterKey);
        const rows = allIngredientRows();
        const todo = keys.map(k => rows.find(r => r.key === k)).filter(r => r && !r.info.kroger && !r.info.krogerSkip);
        const next = todo.find(r => !later.has(r.key)) || null;
        if (!next) { flushItems(); toast(todo.length ? 'Done for now. The ones you put off are still in To do.' : 'All linked!'); return openLinkAll(); }
        openProductPicker(next, () => openLinkAll(), { left: todo.length, next: step });
    };
    step();
}

// ---------- Item options sheet ----------
// Adds the Kroger product line to the ⋯ sheet in shop.html.
function krogerSheet(row) {
    const box = document.getElementById('sheetKroger');
    const linked = row.info.kroger;
    box.innerHTML = `<div class="switch"><span>Kroger product<small>${linked ? escapeHtml(`${linked.description}${linked.size ? ' · ' + linked.size : ''}`) : 'Not linked yet'}</small></span>
        <button class="btn-light" style="padding:8px 12px; flex:none">${linked ? 'Change' : 'Link'}</button></div>`;
    box.querySelector('button').onclick = () => { closeSheet(); openProductPicker(row); };
}

// ---------- Send to cart ----------
function defaultQty(row) {
    const m = (row.qty || '').match(/^(\d+(?:\.\d+)?)\s*([a-z]*)/i);
    if (!m || WEIGHT_UNITS.includes(m[2].toLowerCase())) return 1;
    return Math.min(20, Math.max(1, Math.ceil(parseFloat(m[1]))));
}

function reviewRows() {
    return rows.filter(r => !trip.checked[r.key] && !trip.skipped[r.key])
        .sort((a, b) => (SECTIONS.indexOf(a.info.section) - SECTIONS.indexOf(b.info.section)) || a.item.localeCompare(b.item));
}

function openReview(fromSignIn = false) {
    if (!settingsDb.kroger) return openStorePicker(() => openReview());
    const list = reviewRows();
    const linked = list.filter(r => r.info.kroger);
    const unlinked = list.filter(r => !r.info.kroger);
    linked.forEach(r => {
        if (!(r.key in reviewQty)) reviewQty[r.key] = defaultQty(r);
        if (!(r.key in reviewOn)) reviewOn[r.key] = !r.info.pantry;   // pantry items start unticked
    });
    const modality = settingsDb.krogerModality || 'PICKUP';
    const count = linked.filter(r => reviewOn[r.key]).length;
    const body = `
        <div class="kstore">🏬 <b>${escapeHtml(settingsDb.kroger.name)}</b> <button class="klink" id="kchangeStore">Change</button>
            <button class="klink" id="klinkAll" style="float:right">Link all ingredients</button></div>
        <div class="kmode">
            <button data-mode="PICKUP" class="${modality === 'PICKUP' ? 'on' : ''}">Pickup</button>
            <button data-mode="DELIVERY" class="${modality === 'DELIVERY' ? 'on' : ''}">Delivery</button>
        </div>
        ${linked.length ? `<h4>Ready to add (${linked.length})</h4>` + linked.map(r => `
            <div class="krow ${reviewOn[r.key] ? '' : 'off'}" data-key="${escapeHtml(r.key)}">
                <input type="checkbox" class="kon" ${reviewOn[r.key] ? 'checked' : ''}>
                <span class="kres-text"><b>${escapeHtml(r.item)}</b>${r.qty ? ` <span class="kneed">need ${escapeHtml(r.qty)}</span>` : ''}${r.info.pantry ? ' <span class="kneed">usually have</span>' : ''}<br>
                <span class="kmuted">${escapeHtml(r.info.kroger.description)}${r.info.kroger.size ? ' · ' + escapeHtml(r.info.kroger.size) : ''}</span></span>
                <span class="kstep"><button class="kminus">−</button><b>${reviewQty[r.key]}</b><button class="kplus">+</button></span>
            </div>`).join('') : ''}
        ${unlinked.length ? `<h4>Not linked yet (${unlinked.length})</h4><p class="kmuted">Link each once and it's remembered for next time.</p>` + unlinked.map(r => `
            <div class="krow" data-key="${escapeHtml(r.key)}">
                <span class="kres-text"><b>${escapeHtml(r.item)}</b>${r.qty ? ` <span class="kneed">need ${escapeHtml(r.qty)}</span>` : ''}</span>
                <button class="btn-light klinkbtn">Link</button>
            </div>`).join('') : ''}
        ${!list.length ? '<p class="kmuted">Nothing left on the list.</p>' : ''}`;
    const foot = `<button class="btn-primary" id="ksend" ${count ? '' : 'disabled'}>${readAuth() ? '' : 'Sign in & '}Add ${count} item${count === 1 ? '' : 's'} to Kroger cart</button>`;
    openPanel('Send to Kroger', body, foot);
    if (fromSignIn && count) toast('Connected. Tap the green button to add your items.');

    const panel = document.getElementById('kpanelBody');
    document.getElementById('kchangeStore').onclick = () => openStorePicker(() => openReview());
    document.getElementById('klinkAll').onclick = () => openLinkAll();
    panel.querySelectorAll('.kmode button').forEach(b => b.onclick = async () => {
        try { await saveSettings({ krogerModality: b.dataset.mode }, `Kroger: ${b.dataset.mode.toLowerCase()}`); } catch (e) { toast('Could not save: ' + e.message, true); }
        openReview();
    });
    panel.onclick = e => {
        const rowEl = e.target.closest('.krow');
        if (!rowEl) return;
        const key = rowEl.dataset.key;
        const row = list.find(r => r.key === key);
        if (e.target.closest('.klinkbtn')) return openProductPicker(row, () => openReview());
        if (e.target.closest('.kminus')) reviewQty[key] = Math.max(1, reviewQty[key] - 1);
        else if (e.target.closest('.kplus')) reviewQty[key] = Math.min(50, reviewQty[key] + 1);
        else if (e.target.closest('.kon') || e.target.closest('.kres-text')) reviewOn[key] = !reviewOn[key];
        else return;
        const y = panel.scrollTop;
        openReview();
        document.getElementById('kpanelBody').scrollTop = y;
    };
    document.getElementById('ksend').onclick = () => sendToCart(linked.filter(r => reviewOn[r.key]));
}

async function sendToCart(list) {
    const btn = document.getElementById('ksend');
    btn.disabled = true;
    btn.textContent = 'Adding...';
    try {
        const token = await krogerUserToken();
        if (!token) return signInToKroger();
        const items = list.map(r => ({ upc: r.info.kroger.upc, quantity: reviewQty[r.key] }));
        try {
            await krogerApi('cart', { body: { items, modality: settingsDb.krogerModality || 'PICKUP' }, token });
        } catch (e) {
            if (e.status === 401) { writeAuth(null); return signInToKroger(); }
            throw e;
        }
        list.forEach(r => { trip.checked[r.key] = true; });
        saveTrip();
        reviewQty = {};
        reviewOn = {};
        render();
        openPanel('Added to your cart', `
            <p style="font-size:1.1em">✅ Added <b>${list.length}</b> item${list.length === 1 ? '' : 's'} to your Kroger cart.</p>
            <p class="kmuted">They're marked "In the cart" on your list. Open the Kroger app to choose a time and check out.</p>
            <p class="kmuted">If you sent something twice, Kroger may combine it into a bigger quantity, so give the cart a quick look.</p>`,
            `<a class="btn-primary kopen" href="https://www.kroger.com/cart" target="_blank" rel="noopener">Open Kroger cart</a>`);
    } catch (e) {
        toast(e.message, true);
        btn.disabled = false;
        btn.textContent = 'Try again';
    }
}
