// ==UserScript==
// @name         Rack Switch Serial Helper
// @namespace    AWS
// @version      1.0
// @description  Enter a rack assetId, get ordered switch serials (SW1..SWn) for quick copy/paste
// @author       ajfriend
// @match        https://*.amazon.com/*
// @match        https://*.aws.a2z.com/*
// @match        https://*.quip-amazon.com/*
// @match        https://quip-amazon.com/*
// @match        https://app.asana.com/*
// @grant        GM_xmlhttpRequest
// @connect      racks.amazon.com
// ==/UserScript==

(function() {
    'use strict';

    // ------- UI: small floating panel -------

    const panel = document.createElement('div');
    panel.id = 'rack-switch-helper';
    panel.style.cssText = `
        position: fixed;
        bottom: 10px;
        right: 10px;
        z-index: 99999;
        background: #1e1e1e;
        color: #f5f5f5;
        padding: 8px 10px;
        border-radius: 6px;
        font-size: 12px;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 2px 6px rgba(0,0,0,0.4);
        min-width: 260px;
    `;

    panel.innerHTML = `
        <div style="margin-bottom: 4px; display:flex; align-items:center; justify-content:space-between;">
            <span style="font-weight:600;">Rack switches</span>
            <button id="rsh-toggle" type="button"
                style="margin-left:8px;padding:0 4px;font-size:10px;border-radius:2px;border:1px solid #555;background:#333;color:#eee;cursor:pointer;">
                ×
            </button>
        </div>
        <div style="display:flex; gap:4px; margin-bottom:4px;">
            <input id="rsh-asset" type="text" placeholder="Asset ID (e.g. 3549012011)"
                style="flex:1; padding:2px 4px; font-size:11px; border-radius:3px; border:1px solid #555; background:#111; color:#f5f5f5;">
            <button id="rsh-go" type="button"
                style="padding:2px 6px;font-size:11px;border-radius:3px;border:1px solid #888;background:#444;color:#fff;cursor:pointer;">
                Get
            </button>
        </div>
        <pre id="rsh-output"
             style="margin:0; max-height:180px; overflow:auto; white-space:pre-wrap; font-size:11px; background:#111; padding:4px; border-radius:3px; border:1px solid #333;">
(enter asset and press Get)
        </pre>
    `;

    document.body.appendChild(panel);

    const input  = panel.querySelector('#rsh-asset');
    const btnGo  = panel.querySelector('#rsh-go');
    const btnX   = panel.querySelector('#rsh-toggle');
    const output = panel.querySelector('#rsh-output');

    btnX.addEventListener('click', () => {
        panel.style.display = 'none';
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            runLookup();
        }
    });

    btnGo.addEventListener('click', runLookup);

    // ------- Logic: call hosts API and display switches -------

    function runLookup() {
        const assetId = input.value.trim();
        if (!/^\d{7,12}$/.test(assetId)) {
            output.textContent = 'Please enter a valid numeric rack assetId (e.g. 3549012011).';
            return;
        }

        output.textContent = 'Fetching switches for ' + assetId + '...';

        const url = `https://racks.amazon.com/api/hosts?rackAssetId=${assetId}`;

        GM_xmlhttpRequest({
            method: 'GET',
            url,
            onload: function(res) {
                try {
                    const data = JSON.parse(res.responseText);
                    if (!Array.isArray(data)) {
                        output.textContent = 'Unexpected response (not an array). See console.';
                        console.error('[Rack Switch Helper] Response:', data);
                        return;
                    }

                    const switches = data
                        .filter(h => h.assetType === 'SWITCH')
                        .sort((a, b) => (b.scanOrder || 0) - (a.scanOrder || 0)); // highest scanOrder = SW1

                    if (switches.length === 0) {
                        output.textContent = 'No SWITCH assets found for rack ' + assetId + '.';
                        return;
                    }

                    let lines = [];
                    lines.push(`Rack ${assetId} – ${switches.length} switch(es):`);
                    lines.push('');

                    switches.forEach((sw, idx) => {
                        const num = idx + 1; // SW1, SW2, ...
                        const serial = sw.serialNumber || '(no serialNumber)';
                        const order  = sw.scanOrder !== undefined ? sw.scanOrder : '?';
                        lines.push(`SW${num}: ${serial}`);
                    });

                    lines.push('');
                    lines.push('Tip: double-click to select, Ctrl+C to copy.');

                    output.textContent = lines.join('\n');
                } catch (e) {
                    output.textContent = 'Error parsing JSON. See console.';
                    console.error('[Rack Switch Helper] JSON parse error:', e, res.responseText);
                }
            },
            onerror: function(err) {
                output.textContent = 'Request error. See console.';
                console.error('[Rack Switch Helper] Request error:', err);
            }
        });
    }

})();
