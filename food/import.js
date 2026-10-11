// "Import from link" on the Recipes page. Asks the site's /api/import helper
// (lib/import-core.mjs) for a recipe's name and ingredients, lets you pick which
// lines to keep, then fills a new recipe or adds to the one being edited.
// Uses openEditor, ingredientRow, updateOpenLinks and toast from recipes.html.

let importMode = 'new';     // 'new' recipe, or 'existing' = add to the recipe being edited
let importResult = null;

function openImport(mode) {
    importMode = mode;
    importResult = null;
    const url = document.getElementById('importUrl');
    url.value = mode === 'existing'
        ? (document.getElementById('mealVideo').value.trim() || document.getElementById('mealLink').value.trim())
        : '';
    document.getElementById('importTitle').textContent = mode === 'existing' ? 'Get ingredients from a link' : 'Import a recipe';
    document.getElementById('importResult').innerHTML = `<p class="hint">Paste a TikTok, YouTube or recipe website link. Recipe websites work best; TikTok works when the ingredients are in the caption.</p>`;
    document.getElementById('importFoot').hidden = true;
    document.getElementById('importPanel').classList.add('open');
    if (url.value) runImport(); else url.focus();
}

function closeImport() { document.getElementById('importPanel').classList.remove('open'); }

async function runImport() {
    const link = document.getElementById('importUrl').value.trim();
    if (!link) return;
    const box = document.getElementById('importResult');
    box.innerHTML = '<p class="hint">Reading the link...</p>';
    document.getElementById('importFoot').hidden = true;
    try {
        const res = await fetch(`/api/import?url=${encodeURIComponent(link)}`);
        if (res.status === 404) throw new Error('Import only works on the Cloudflare (workers.dev) version of this site.');
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Import failed (${res.status})`);
        importResult = data;
        renderImport();
    } catch (e) {
        box.innerHTML = `<p class="import-error">${escapeHtml(e.message)}</p>`;
    }
}

function renderImport() {
    const r = importResult;
    const box = document.getElementById('importResult');
    const lines = r.ingredients || [];
    box.innerHTML = `
        ${importMode === 'new' ? `<label>Recipe name</label><input type="text" id="importName" autocomplete="off">` : ''}
        ${lines.length ? `
            <label>Ingredients found <span style="font-weight:normal">(untick anything that isn't one)</span></label>
            <div id="importLines">${lines.map((l, i) => `
                <label class="import-line"><input type="checkbox" data-i="${i}" ${l.likely ? 'checked' : ''}><span>${escapeHtml(l.text)}</span></label>`).join('')}
            </div>` : `<p class="hint">${escapeHtml(r.message || 'No ingredients found in that link.')}</p>
            <p class="hint">Tip: if the ingredients show on screen in the video, take a screenshot, copy the text with Live Text (iPhone) or Google Lens (Android), and use <b>Paste a list</b> in the recipe.</p>`}
        ${r.caption ? `<details class="import-caption"><summary>Full caption</summary><p>${escapeHtml(r.caption)}</p></details>` : ''}`;
    if (importMode === 'new') document.getElementById('importName').value = r.name || '';
    const foot = document.getElementById('importFoot');
    foot.hidden = false;
    const update = () => {
        const n = box.querySelectorAll('#importLines input:checked').length;
        foot.innerHTML = importMode === 'new'
            ? `<button class="btn-primary" id="importApply">Create recipe${n ? ` with ${n} ingredient${n === 1 ? '' : 's'}` : ''}</button>`
            : `<button class="btn-primary" id="importApply" ${n ? '' : 'disabled'}>Add ${n} ingredient${n === 1 ? '' : 's'} to the main dish</button>`;
        document.getElementById('importApply').onclick = applyImport;
    };
    box.querySelectorAll('#importLines input').forEach(cb => cb.onchange = update);
    update();
}

function applyImport() {
    const r = importResult;
    const picked = [...document.querySelectorAll('#importLines input:checked')]
        .map(cb => parseIngredientLine(r.ingredients[cb.dataset.i].text)).filter(Boolean);
    if (importMode === 'new') {
        const name = document.getElementById('importName').value.trim();
        openEditor(null);
        document.getElementById('mealName').value = name;
        if (r.video) document.getElementById('mealVideo').value = r.video;
        if (r.link) document.getElementById('mealLink').value = r.link;
        updateOpenLinks();
    }
    const main = document.querySelector('#components .component[data-type="main"] .ing-list');
    const have = new Set([...main.querySelectorAll('.item')].map(i => i.value.trim().toLowerCase()).filter(Boolean));
    [...main.children].forEach(row => { if (!row.querySelector('.item').value.trim()) row.remove(); });
    let added = 0;
    picked.forEach(ing => {
        if (have.has(ingredientLabel(ing).toLowerCase()) || have.has(ing.item.toLowerCase())) return;
        main.appendChild(ingredientRow(ing));
        added++;
    });
    if (!main.children.length) main.appendChild(ingredientRow());
    closeImport();
    toast(importMode === 'new'
        ? `Filled in${added ? ` ${added} ingredient${added === 1 ? '' : 's'}` : ''}. Check it over, then Save.`
        : `Added ${added} ingredient${added === 1 ? '' : 's'}. Tap Save to keep them.`);
}

document.getElementById('importGo').onclick = runImport;
document.getElementById('importUrl').addEventListener('keydown', e => { if (e.key === 'Enter') runImport(); });
