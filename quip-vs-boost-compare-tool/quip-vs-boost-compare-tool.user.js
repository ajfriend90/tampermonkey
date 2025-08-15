// ==UserScript==
// @name         Quip vs Boost Compare Tool
// @namespace    https://github.com/ajfriend90/tampermonkey
// @version      2.0
// @description  Load exported CSVs of Quip and Boost and display Asset IDs for discrepencies
// @author       ajfriend
// @match        *://*.quip-amazon.com/*
// @match        *://*.boost.aws.a2z.com/platform*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=quip-amazon.com
// @require      https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/ajfriend90/tampermonkey/main/quip-vs-boost-compare-tool/quip-vs-boost-compare-tool.user.js
// @downloadURL  https://raw.githubusercontent.com/ajfriend90/tampermonkey/main/quip-vs-boost-compare-tool/quip-vs-boost-compare-tool.user.js
// ==/UserScript==

(function () {
  'use strict';
    let quipFiles = [];
    let boostFile = null;
    let resultsWin = null;

    function showInstructionsModal() {
        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'fixed',
            top: 0, left: 0, width: '100%', height: '100%',
            background: 'rgba(11,15,20,0.55)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 999999
        });

        const modal = document.createElement('div');
        Object.assign(modal.style, {
            background: '#111823',
            color: '#e6edf3',
            padding: '20px 24px',
            borderRadius: '10px',
            textAlign: 'left',
            minWidth: '360px',
            maxWidth: '520px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial, sans-serif',
            border: '1px solid #1e293b'
        });

        modal.style.transform = 'scale(0.96)';
        modal.style.opacity = '0';
        modal.style.transition = 'transform 120ms ease, opacity 120ms ease';
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 120ms ease';

        const title = document.createElement('h3');
        Object.assign(title.style, { margin: '0 0 10px 0', fontSize: '16px' });
        title.textContent = 'How to use: Quip ↔ Boost Compare';

        const body = document.createElement('div');
        body.innerHTML = `
  <ol style="margin:0 0 12px 18px; padding:0; line-height:1.5;">
    <li>Click <b>Compare CSVs</b> from the Tampermonkey menu.</li>
    <li>In the dialog, click <b>Add Quip CSV</b> to select a Quip export (.csv). Repeat to add as many as needed
        (filenames will list in the box).</li>
    <li>Click <b>Done</b> to proceed.</li>
    <li>When prompted, click <b>Pick CSV</b> and select your <b>Boost</b> export (.csv).</li>
    <li>A results window opens showing:
      <ul style="margin:6px 0 0 18px; padding:0;">
        <li><b>Quip-only</b> (after status filter)</li>
        <li><b>Boost-only</b></li>
        <li><b>Matched assets</b> count in the header</li>
      </ul>
    </li>
  </ol>
  <p style="margin:8px 0 0 0; color:#9aa7b0; font-size:13px;">
    Tip: You can cancel any dialog by clicking outside it. The results popup can stay open for copy/paste while you work.
  </p>
  <p style="margin:6px 0 0 0; color:#9aa7b0; font-size:13px;">
    Status filter: excludes any status containing “handed off / handed-off”.
  </p>
`;

        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        Object.assign(closeBtn.style, {
            marginTop: '10px',
            padding: '8px 14px',
            fontSize: '14px',
            fontWeight: 'bold',
            backgroundColor: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
        });
        closeBtn.addEventListener('mouseover', () => { closeBtn.style.backgroundColor = '#2563eb'; });
        closeBtn.addEventListener('mouseout', () => { closeBtn.style.backgroundColor = '#3b82f6'; });
        closeBtn.addEventListener('click', () => overlay.remove(), { once: true });

        modal.appendChild(title);
        modal.appendChild(body);
        modal.appendChild(closeBtn);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
            modal.style.transform = 'scale(1)';
            modal.style.opacity = '1';
        });
    }

    function showQuipCollectorModal() {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            Object.assign(overlay.style, {
                position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
                background: 'rgba(11,15,20,0.55)', backdropFilter: 'blur(6px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999999
            });

            const modal = document.createElement('div');
            Object.assign(modal.style, {
                background: '#111823', color: '#e6edf3', padding: '20px 24px',
                borderRadius: '10px', textAlign: 'left', minWidth: '360px', maxWidth: '520px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.5)', border: '1px solid #1e293b',
                fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial, sans-serif',
                transform: 'scale(0.96)', opacity: '0', transition: 'transform 120ms ease, opacity 120ms ease'
            });
            overlay.style.opacity = '0'; overlay.style.transition = 'opacity 120ms ease';

            const title = document.createElement('h3');
            title.textContent = 'Add one or more Quip CSVs';
            Object.assign(title.style, { margin: '0 0 10px 0', fontSize: '16px' });

            const list = document.createElement('div');
            list.style.cssText = `
      margin: 8px 0 12px 0; padding: 8px 10px; background:#0f172a; border:1px solid #1e293b; border-radius:8px;
      max-height: 180px; overflow:auto; font-size:12px; white-space:pre-wrap;
    `;
            list.textContent = 'None added yet.';

            const row = document.createElement('div');
            row.style.display = 'flex'; row.style.gap = '8px';

            const addBtn = document.createElement('button');
            addBtn.textContent = 'Add Quip CSV';
            Object.assign(addBtn.style, {
                padding:'8px 12px', fontSize:'14px', fontWeight:'bold', backgroundColor:'#3b82f6', color:'#fff',
                border:'none', borderRadius:'4px', cursor:'pointer'
            });

            const doneBtn = document.createElement('button');
            doneBtn.textContent = 'Done';
            Object.assign(doneBtn.style, {
                padding:'8px 12px', fontSize:'14px', fontWeight:'bold', backgroundColor:'#16a34a', color:'#fff',
                border:'none', borderRadius:'4px', cursor:'pointer'
            });

            function refreshList() {
                list.textContent = quipFiles.length
                    ? quipFiles.map(f => `• ${f.name}`).join('\n')
                : 'None added yet.';
            }

            addBtn.addEventListener('mouseover', () => { addBtn.style.backgroundColor = '#2563eb'; });
            addBtn.addEventListener('mouseout', () => { addBtn.style.backgroundColor = '#3b82f6'; });
            doneBtn.addEventListener('mouseover', () => { doneBtn.style.backgroundColor = '#15803d'; });
            doneBtn.addEventListener('mouseout', () => { doneBtn.style.backgroundColor = '#16a34a'; });

            addBtn.addEventListener('click', async () => {
                const f = await pickCSV();
                if (f) {
                    quipFiles.push(f);
                    refreshList();
                }
            });

            doneBtn.addEventListener('click', () => { overlay.remove(); resolve(quipFiles.length > 0); });

            // click-outside cancels
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) { overlay.remove(); resolve(false); }
            });

            row.appendChild(addBtn); row.appendChild(doneBtn);
            modal.appendChild(title); modal.appendChild(list); modal.appendChild(row);
            overlay.appendChild(modal); document.body.appendChild(overlay);

            requestAnimationFrame(() => { overlay.style.opacity = '1'; modal.style.transform = 'scale(1)'; modal.style.opacity = '1'; });
        });
    }

    function showBoostCollectorModal(label, onPick) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            Object.assign(overlay.style, {
                position: 'fixed',
                top: 0, left: 0, width: '100%', height: '100%',
                background: 'rgba(11,15,20,0.55)',
                backdropFilter: 'blur(6px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 999999
            });

            const modal = document.createElement('div');
            Object.assign(modal.style, {
                background: '#111823',
                color: '#e6edf3',
                padding: '20px 30px',
                borderRadius: '10px',
                textAlign: 'center',
                minWidth: '280px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial, sans-serif',
                border: '1px solid #1e293b',
                transform: 'scale(0.96)',
                opacity: '0',
                transition: 'transform 120ms ease, opacity 120ms ease'
            });
            overlay.style.opacity = '0';
            overlay.style.transition = 'opacity 120ms ease';

            const msg = document.createElement('p');
            msg.textContent = label;
            Object.assign(msg.style, { marginBottom: '15px', fontSize: '15px', fontWeight: 'bold' });

            const pickBtn = document.createElement('button');
            pickBtn.textContent = 'Pick CSV';
            Object.assign(pickBtn.style, {
                padding: '8px 16px', fontSize: '14px', fontWeight: 'bold',
                backgroundColor: '#3b82f6', color: '#fff', border: 'none',
                borderRadius: '4px', cursor: 'pointer', transition: 'background-color 0.2s ease'
            });
            pickBtn.addEventListener('mouseover', () => { pickBtn.style.backgroundColor = '#2563eb'; });
            pickBtn.addEventListener('mouseout', () => { pickBtn.style.backgroundColor = '#3b82f6'; });

            pickBtn.addEventListener('click', async () => {
                await onPick();
                overlay.remove();
                resolve(true);
            }, { once: true });

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.remove();
                    resolve(false);
                }
            });

            modal.appendChild(msg);
            modal.appendChild(pickBtn);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            requestAnimationFrame(() => {
                overlay.style.opacity = '1';
                modal.style.transform = 'scale(1)';
                modal.style.opacity = '1';
            });
        });
    }

    function pickCSV() {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.csv,text/csv';
            input.style.position = 'fixed';
            input.style.left = '-9999px';
            document.body.appendChild(input);
            input.addEventListener('change', () => {
                const file = input.files && input.files[0] ? input.files[0] : null;
                input.remove();
                resolve(file);
            }, { once: true });
            input.click();
        });
    }

    function readFileUtf8(file) {
        return new Promise((resolve) => {
            const r = new FileReader();
            r.onload = () => resolve(new TextDecoder('utf-8').decode(new Uint8Array(r.result)));
            r.readAsArrayBuffer(file);
        });
    }

    function parseCsv(text) {
        const out = Papa.parse(text, {
            header: false,
            skipEmptyLines: true,
            transform: v => (v ?? '').trim()
        });
        return out.data || [];
    }

    function findHeaderRow(rows) {
        for (let i = 0; i < rows.length && i < 50; i++) {
            for (let cell of rows[i]) {
                const c = (cell || '').trim().toLowerCase();
                if (c === 'asset' || c === 'asset id') {
                    return i;
                }
            }
        }
        return -1;
    }

    function findColumnIndices(rows, headerIndex) {
        const header = rows[headerIndex] || [];
        const key = s => (s || '').trim().toLowerCase();

        let assetCol = -1;
        let statusCol = -1;

        for (let i = 0; i < header.length; i++) {
            const h = key(header[i]);
            if (assetCol === -1 && (h === 'asset' || h === 'asset id')) assetCol = i;
            if (statusCol === -1 && h === 'status') statusCol = i;
        }
        return { assetCol, statusCol };
    }

    function normalizeAsset(s) {
        // ensure not null or undefined is string and stripped of whitespace
        let a = String(s ?? '').trim();

        // strip outer quotes and thousands commas
        a = a.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1').replace(/,/g, '');

        // scientific notation → integer string
        if (/^\d+(\.\d+)?e\+\d+$/i.test(a)) {
            const n = Number(a);
            if (Number.isFinite(n)) a = n.toFixed(0);
        }

        // keep only pure digits
        return /^\d+$/.test(a) ? a : '';
    }

    function buildQuipMap(rows, headerIndex, assetCol, statusCol) {
        const map = new Map();
        for (let i = headerIndex + 1; i < rows.length; i++) {
            const rawAsset = rows[i][assetCol];
            const asset = normalizeAsset(rawAsset);
            const status = (rows[i][statusCol] || '').trim().toLowerCase();
            if (asset) map.set(asset, status);
        }
        return map;
    }

    function buildBoostSet(rows, headerIndex, assetCol) {
        const set = new Set();
        for (let i = headerIndex + 1; i < rows.length; i++) {
            const asset = normalizeAsset(rows[i][assetCol]);
            if (asset) set.add(asset);
        }
        return set;
    }

    function compareAssets(quipMap, boostSet, includeFn) {
        const inQuipNotBoost = [];
        const inBoostNotQuip = [];
        const matchedAssets = [];

        for (const [asset, status] of quipMap.entries()) {
            if (includeFn(status)) {
                if (!boostSet.has(asset)) {
                    inQuipNotBoost.push(asset);
                } else {
                    matchedAssets.push(asset);
                }
            }
        }

        for (const asset of boostSet) {
            if (!quipMap.has(asset)) inBoostNotQuip.push(asset);
        }

        return { inQuipNotBoost, inBoostNotQuip, matchedAssets };
    }

    // helper: open (or reuse) the popup and wait until its document is ready
    function getResultsPopup() {
        resultsWin = resultsWin && !resultsWin.closed
            ? resultsWin
        : window.open('about:blank', 'CompareResults', 'width=640,height=800,scrollbars=yes,resizable=yes');

        return new Promise((resolve) => {
            const doc = resultsWin.document;
            if (doc && doc.readyState === 'complete') return resolve(resultsWin);
            resultsWin.addEventListener('load', () => resolve(resultsWin), { once: true });
        });
    }

    async function showResultsPopup(inQuipNotBoost, inBoostNotQuip, matchedAssets) {
        const win = await getResultsPopup();
        const doc = win.document;

        // reset document
        doc.open(); doc.write('<!doctype html><html><head><meta charset="utf-8"><title>Compare Results</title></head><body></body></html>'); doc.close();

        // styles
        const style = doc.createElement('style');
        style.textContent = `
    :root{--bg:#0b0f14;--panel:#111823;--text:#e6edf3;--muted:#9aa7b0;--accent:#3b82f6;--border:#1e293b;--pre-bg:#0f172a}
    *{box-sizing:border-box}
    body{margin:0;padding:16px 18px 24px;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,Arial,sans-serif}
    header{position:sticky;top:0;z-index:1;background:linear-gradient(to bottom,rgba(11,15,20,.95),rgba(11,15,20,.85));backdrop-filter:blur(6px);margin:-16px -18px 12px;padding:12px 18px;border-bottom:1px solid var(--border)}
    h1{margin:0;font-size:16px;letter-spacing:.2px}
    .muted{color:var(--muted)}
    .grid{display:grid;gap:14px}
    .card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:12px}
    .card h2{margin:0 0 6px 0;font-size:15px;display:flex;align-items:baseline;gap:8px}
    .count{color:var(--muted);font-weight:600;font-size:12px}
    .hint{margin:0 0 8px 0;font-size:12px;color:var(--muted)}
    ul{list-style:none;margin:0;padding:0;display:grid;gap:6px;max-height:520px;overflow:auto}
    .item{padding:6px 10px;border:1px solid var(--border);border-radius:8px;background:var(--pre-bg);cursor:pointer;user-select:none;
          font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Roboto Mono","Liberation Mono",monospace;font-size:12px;line-height:1.45;
          transition:border-color .12s ease, background-color .12s ease, transform .06s ease, opacity .2s ease}
    .item:hover{border-color:var(--accent)}
    .item:active{transform:scale(0.99)}
    .item.copied{outline:2px solid var(--accent)}
    .item.done{text-decoration:line-through;opacity:.5}
    footer{margin-top:14px;color:var(--muted);font-size:12px;text-align:center}
  `;
        doc.head.appendChild(style);

        // header
        const header = doc.createElement('header');
        const h1 = doc.createElement('h1'); h1.textContent = 'Quip ↔ Boost Comparison';
        const p = doc.createElement('p'); p.className = 'muted'; p.textContent = `Matched assets: ${matchedAssets.length}`;
        header.appendChild(h1); header.appendChild(p); doc.body.appendChild(header);

        // section/grid
        const section = doc.createElement('section'); section.className = 'grid'; doc.body.appendChild(section);

        // helper to build a card
        const buildCard = (title, count, listId) => {
            const card = doc.createElement('div'); card.className = 'card';
            const h2 = doc.createElement('h2'); h2.innerHTML = `${title} <span class="count">(${count})</span>`;
            const hint = doc.createElement('p'); hint.className = 'hint'; hint.textContent = 'Click an asset to copy (and mark as done)';
            const ul = doc.createElement('ul'); ul.id = listId;
            card.append(h2, hint, ul); section.appendChild(card);
        };

        buildCard('Quip-only', inQuipNotBoost.length, 'q-list');
        buildCard('Boost-only', inBoostNotQuip.length, 'b-list');

        // footer
        const footer = doc.createElement('footer');
        footer.className = 'muted';
        footer.textContent = 'Window stays open for copy/paste. Resize as needed.';
        doc.body.appendChild(footer);

        // render + events
        const copyText = (txt) => {
            if (win.navigator.clipboard?.writeText) return win.navigator.clipboard.writeText(txt);
            const ta = doc.createElement('textarea'); ta.value = txt; doc.body.appendChild(ta); ta.select();
            try { doc.execCommand('copy'); } catch(e) {}
            ta.remove(); return Promise.resolve();
        };

        const makeItem = (text) => {
            const li = doc.createElement('li');
            li.className = 'item';
            li.textContent = text;
            li.addEventListener('click', () => {
                copyText(text).then(() => {
                    li.classList.add('copied','done');
                    setTimeout(() => li.classList.remove('copied'), 300);
                });
            });
            return li;
        };

        const renderList = (id, items) => {
            const ul = doc.getElementById(id);
            ul.innerHTML = '';
            if (!items.length) {
                const li = doc.createElement('li');
                li.className = 'item'; li.style.opacity = '.7'; li.style.cursor = 'default';
                li.textContent = '— none —'; ul.appendChild(li); return;
            }
            for (const a of items) ul.appendChild(makeItem(a));
        };

        renderList('q-list', inQuipNotBoost);
        renderList('b-list', inBoostNotQuip);
    }

    GM_registerMenuCommand('Compare CSVs', async () => {
        quipFiles = [];
        const okQuip = await showQuipCollectorModal();
        if (!okQuip) return;

        const okBoost = await showBoostCollectorModal('Please choose your Boost CSV', async () => {
            boostFile = await pickCSV();
        });
        if (!okBoost || !boostFile) return;

        const quipMap = new Map();
        for (const f of quipFiles) {
            const txt = await readFileUtf8(f);
            const rows = parseCsv(txt);
            const headerIndex = findHeaderRow(rows);
            if (headerIndex === -1) continue;
            const { assetCol, statusCol } = findColumnIndices(rows, headerIndex);
            if (assetCol === -1) continue;
            const partial = buildQuipMap(rows, headerIndex, assetCol, statusCol);
            for (const [asset, status] of partial.entries()) quipMap.set(asset, status);
        }

        const boostText = await readFileUtf8(boostFile);
        const boostRows = parseCsv(boostText);
        const boostHeaderIndex = findHeaderRow(boostRows);
        if (boostHeaderIndex === -1) { alert('Could not find header row in Boost CSV.'); return; }
        const { assetCol: boostAssetCol } = findColumnIndices(boostRows, boostHeaderIndex);
        if (boostAssetCol === -1) { alert('Missing Asset column in Boost CSV.'); return; }
        const boostSet = buildBoostSet(boostRows, boostHeaderIndex, boostAssetCol);

        const include = (s) => !/\bhanded[-\s]?off\b/i.test(s || '');
        const { inQuipNotBoost, inBoostNotQuip, matchedAssets } = compareAssets(quipMap, boostSet, include);
        showResultsPopup(inQuipNotBoost, inBoostNotQuip, matchedAssets);
    });

    GM_registerMenuCommand('How to use', () => {
        showInstructionsModal();
    });
})();