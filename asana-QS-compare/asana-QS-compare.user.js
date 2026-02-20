// ==UserScript==
// @name         Asana QS Compare
// @namespace    https://github.com/ajfriend90/tampermonkey
// @version      1.0.0
// @description  Paste Asana JSON export URL + upload Quicksuite CSV → compare 10-digit Asset IDs.
// @author       Joey Friend (@ajfriend)
// @match        https://app.asana.com/*
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/ajfriend90/tampermonkey/main/asana-QS-compare/asana-QS-compare.user.js
// @updateURL    https://raw.githubusercontent.com/ajfriend90/tampermonkey/main/asana-QS-compare/asana-QS-compare.user.js
// ==/UserScript==

(function () {
  'use strict';

  const WIDGET_ID = 'tm-asana-json-csv-compare';

  const state = {
    asana: { tasks: [], assets: new Set(), assetFieldName: 'Asset (ID)' },
    csv: { rows: [], headers: [], assets: new Set(), assetCol: null },
    ignore: { assets: new Set() },
    lastOutput: '',
  };

  GM_registerMenuCommand('Asana JSON ↔ Quicksuite CSV Compare', toggleWidget);

  // ---------------------------
  // UI
  // ---------------------------
  function injectStyle() {
    const styleId = `${WIDGET_ID}-style`;
    if (document.getElementById(styleId)) return;

    const css = `
      #${WIDGET_ID} {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 999999;
        width: 640px;
        padding: 12px;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        color: rgba(255,255,255,0.88);
        background: rgba(10,10,12,0.62);
        border: 1px solid rgba(255,255,255,0.10);
        border-radius: 14px;
        box-shadow: 0 18px 50px rgba(0,0,0,0.55);
        backdrop-filter: blur(14px) saturate(140%);
        -webkit-backdrop-filter: blur(14px) saturate(140%);
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      #${WIDGET_ID} .hdr {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        user-select: none;
      }
      #${WIDGET_ID} .title { font-size: 13px; font-weight: 650; }
      #${WIDGET_ID} .subtitle { font-size: 12px; color: rgba(255,255,255,0.62); }
      #${WIDGET_ID} .row { display: flex; gap: 10px; }
      #${WIDGET_ID} .col { flex: 1; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
      #${WIDGET_ID} .btnCol { width: 200px; display: flex; flex-direction: column; gap: 8px; }
      #${WIDGET_ID} .btn {
        width: 100%; height: 38px;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.14);
        background: rgba(255,255,255,0.06);
        cursor: pointer;
        font-size: 13px; font-weight: 600;
        color: rgba(255,255,255,0.88);
      }
      #${WIDGET_ID} .btn:hover { background: rgba(255,255,255,0.10); }
      #${WIDGET_ID} .btn:disabled { opacity: 0.6; cursor: not-allowed; }
      #${WIDGET_ID} .btn.primary {
        background: rgba(99,91,255,0.90);
        color: white;
        border-color: rgba(0,0,0,0.20);
      }
      #${WIDGET_ID} .btn.primary:hover { background: rgba(99,91,255,1); }
      #${WIDGET_ID} .btn.danger {
        background: rgba(255,77,79,0.22);
        border-color: rgba(255,77,79,0.45);
      }
      #${WIDGET_ID} .iconBtn {
        appearance: none;
        border: 1px solid rgba(255,255,255,0.14);
        background: rgba(255,255,255,0.06);
        border-radius: 10px;
        padding: 4px 8px;
        font-size: 12px;
        cursor: pointer;
        color: rgba(255,255,255,0.88);
      }
      #${WIDGET_ID} .status {
        font-size: 12px;
        color: rgba(255,255,255,0.72);
        line-height: 1.25;
        white-space: normal;
      }
      #${WIDGET_ID} .results {
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(0,0,0,0.22);
        border-radius: 12px;
        padding: 10px;
        max-height: 360px;
        overflow: auto;
        font-size: 12px;
        line-height: 1.25;
        color: rgba(255,255,255,0.84);
        white-space: pre-wrap;
      }
      #${WIDGET_ID} input[type="file"] {
        width: 100%;
        font-size: 12px;
        color: rgba(255,255,255,0.78);
      }
      #${WIDGET_ID} select, #${WIDGET_ID} input[type="text"] {
        width: 100%;
        height: 34px;
        border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.14);
        background: rgba(255,255,255,0.06);
        color: rgba(255,255,255,0.88);
        padding: 0 8px;
        font-size: 12px;
        box-sizing: border-box;
      }
      #${WIDGET_ID} label {
        font-size: 11px;
        color: rgba(255,255,255,0.62);
      }
      #${WIDGET_ID} .hint {
        font-size: 11px;
        color: rgba(255,255,255,0.58);
        line-height: 1.2;
      }
      #${WIDGET_ID} .chkRow {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        color: rgba(255,255,255,0.78);
        user-select: none;
      }
      #${WIDGET_ID} .chkRow input { transform: translateY(1px); }
      #${WIDGET_ID}-instructions {
        position: fixed;
        right: 680px;
        bottom: 16px;
        width: 520px;
        max-height: 600px;
        overflow: auto;
        padding: 16px;
        z-index: 999998;

        font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        color: rgba(255,255,255,0.88);

        background: rgba(10,10,12,0.72);
        border: 1px solid rgba(255,255,255,0.10);
        border-radius: 16px;
        box-shadow: 0 18px 50px rgba(0,0,0,0.55);
        backdrop-filter: blur(16px) saturate(140%);
        -webkit-backdrop-filter: blur(16px) saturate(140%);
      }
      #${WIDGET_ID}-instructions h3 {
        margin: 0 0 10px 0;
        font-size: 15px;
      }
      #${WIDGET_ID}-instructions ol {
        padding-left: 18px;
        font-size: 13px;
        line-height: 1.4;
      }
      #${WIDGET_ID}-instructions .closeInstr {
        position: absolute;
        top: 10px;
        right: 12px;
        cursor: pointer;
        font-size: 14px;
        opacity: 0.7;
      }
      #${WIDGET_ID}-instructions .closeInstr:hover {
        opacity: 1;
      }
    `;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function toggleWidget() {
    const existing = document.getElementById(WIDGET_ID);
    if (existing) existing.remove();
    else createWidget();
  }

  function setStatus(el, msg) {
    el.textContent = msg;
  }

  // ---------------------------
  // Helpers
  // ---------------------------
  function stripBom(s) {
    return (s && s.charCodeAt(0) === 0xFEFF) ? s.slice(1) : s;
  }

  function pickLast10Digits(s) {
    // last 10-digit group anywhere in the string (right-most)
    const m = String(s || '').match(/(\d{10})(?!.*\d{10})/);
    return m ? m[1] : null;
  }

  function extractAll10DigitAssets(text) {
    const s = String(text || '');
    const matches = s.match(/\d{10}/g) || [];
    return new Set(matches);
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error(`JSON parse failed: ${String(e?.message || e)}`);
    }
  }

  async function fetchAsanaJsonFromUrl(url) {
    const u = String(url || '').trim();
    if (!u) throw new Error('Paste an Asana JSON export URL first.');

    // Enforce same-origin so we don’t accidentally fetch random sites with your cookies.
    const parsed = new URL(u, location.href);
    if (parsed.origin !== location.origin) {
      throw new Error(`URL must be on ${location.origin} (same origin).`);
    }

    const res = await fetch(parsed.toString(), {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });

    if (!res.ok) {
      throw new Error(`Fetch failed: HTTP ${res.status} ${res.statusText}`);
    }

    const text = stripBom(await res.text()).trim();
    if (!text.startsWith('{') && !text.startsWith('[')) {
      throw new Error('Response did not look like JSON (did not start with { or [ ). Are you logged in / is the URL correct?');
    }

    return safeJsonParse(text);
  }

  function doesCustomFieldExistAnywhere(tasks, fieldName) {
    const want = String(fieldName || '').trim();
    if (!want) return false;

    for (const t of tasks) {
      const cfs = Array.isArray(t?.custom_fields) ? t.custom_fields : [];
      if (cfs.some(cf => String(cf?.name || '') === want)) return true;
    }
    return false;
  }

  // ---------------------------
  // Asana JSON parsing
  // ---------------------------
  function extractAsanaTasksFromExport(json) {
    const data = Array.isArray(json) ? json
      : (json && Array.isArray(json.data) ? json.data
      : (json ? [json] : []));

    return data.filter(Boolean);
  }

  function extractAsanaAssets(tasks, assetFieldName, onlyIncomplete) {
    const assets = new Set();

    for (const t of tasks) {
      if (!t || typeof t !== 'object') continue;

      if (onlyIncomplete && t.completed === true) continue;

      // EXCLUDE Rack Type (ID) === "Network"
      const cfs = Array.isArray(t.custom_fields) ? t.custom_fields : [];

      const rackTypeField = cfs.find(cf => String(cf?.name || '') === 'Rack Type (ID)');
      const rackTypeValue = rackTypeField?.text_value ?? rackTypeField?.display_value ?? '';

      if (String(rackTypeValue).trim().toLowerCase() === 'network') continue;

      // Asset extraction
      let asset = null;

      const assetField = cfs.find(cf => String(cf?.name || '') === assetFieldName);
      if (assetField) {
        asset = pickLast10Digits(assetField.text_value ?? assetField.display_value ?? '');
      }

      // Fallback: sometimes task name contains the asset id
      if (!asset) {
        asset = pickLast10Digits(String(t.name || '').trim());
      }

      if (asset) assets.add(asset);
    }

    return assets;
  }

  // ---------------------------
  // CSV parsing
  // ---------------------------
  function splitCsvLine(line) {
    const out = [];
    let cur = '';
    let inQ = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ',') { out.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  function parseCsv(text) {
    const lines = String(text || '').split(/\r?\n/).filter(l => l.trim().length > 0);
    if (!lines.length) return { headers: [], rows: [] };

    const headers = splitCsvLine(stripBom(lines[0])).map(h => h.trim());
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = splitCsvLine(lines[i]);
      const row = {};
      for (let c = 0; c < headers.length; c++) row[headers[c]] = (cols[c] ?? '').trim();
      rows.push(row);
    }

    return { headers, rows };
  }

  function guessAssetColumn(headers) {
    const want = ['asset id', 'asset_id', 'asset (id)', 'asset', 'rack id', 'rack_id', 'id'];
    const lower = headers.map(h => String(h).toLowerCase());

    for (const w of want) {
      const idx = lower.indexOf(w);
      if (idx >= 0) return headers[idx];
    }

    const assetLike = headers.find(h => /asset/i.test(h));
    return assetLike || headers[0] || '';
  }

  function extractAssetsFromCsvRows(rows, assetColumn) {
    const assets = new Set();
    for (const r of rows) {
      const v = r?.[assetColumn];
      if (v == null) continue;

      const asset = pickLast10Digits(String(v));
      if (asset) assets.add(asset);
    }
    return assets;
  }

  // ---------------------------
  // Compare + output
  // ---------------------------
  function compareSets(aSet, bSet) {
    const aOnly = [];
    for (const a of aSet) if (!bSet.has(a)) aOnly.push(a);

    const bOnly = [];
    for (const b of bSet) if (!aSet.has(b)) bOnly.push(b);

    aOnly.sort();
    bOnly.sort();
    return { aOnly, bOnly };
  }

  function formatOutput() {
    const asanaCount = state.asana.assets.size;
    const csvCount = state.csv.assets.size;

    const ignored = state.ignore.assets;

    const asanaFiltered = new Set([...state.asana.assets].filter(a => !ignored.has(a)));
    const csvFiltered = new Set([...state.csv.assets].filter(a => !ignored.has(a)));

    const { aOnly: asanaMissingInCsv, bOnly: csvMissingInAsana } =
      compareSets(asanaFiltered, csvFiltered);

    const lines = [];
    lines.push('Asana JSON ↔ Quicksuite CSV Compare');
    lines.push(`Asana JSON assets: ${asanaCount}  (field: ${state.asana.assetFieldName})`);
    lines.push(`CSV assets: ${csvCount}  (column: ${state.csv.assetCol || '(unknown)'})`);
    lines.push(`Ignored assets: ${state.ignore.assets.size}`);
    lines.push(`Compared (after ignore): Asana=${asanaFiltered.size} | CSV=${csvFiltered.size}`);
    lines.push('');

    lines.push(`Present in Asana JSON, missing in CSV: ${asanaMissingInCsv.length}`);
    lines.push(asanaMissingInCsv.length ? asanaMissingInCsv.join('\n') : '(none)');
    lines.push('');

    lines.push(`Present in CSV, missing in Asana JSON: ${csvMissingInAsana.length}`);
    lines.push(csvMissingInAsana.length ? csvMissingInAsana.join('\n') : '(none)');

    return lines.join('\n');
  }

  // ---------------------------
  // Build widget
  // ---------------------------
  function createWidget() {
    injectStyle();

    const box = document.createElement('div');
    box.id = WIDGET_ID;

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'hdr';

    const hdrLeft = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = 'Asana JSON ↔ Quicksuite CSV Compare';

    const subtitle = document.createElement('div');
    subtitle.className = 'subtitle';
    subtitle.textContent = 'Paste Asana JSON export URL + upload CSV → compare 10-digit Asset IDs.';

    hdrLeft.appendChild(title);
    hdrLeft.appendChild(subtitle);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'iconBtn';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', () => box.remove());

    hdr.appendChild(hdrLeft);
    hdr.appendChild(closeBtn);

    // Body layout
    const row = document.createElement('div');
    row.className = 'row';

    const col = document.createElement('div');
    col.className = 'col';

    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Tip: export JSON → copy the URL from the JSON viewer tab → paste it here → Load JSON.';

    // Asana JSON URL
    const jsonUrlLabel = document.createElement('label');
    jsonUrlLabel.textContent = 'Asana JSON export URL:';

    const jsonUrlInput = document.createElement('input');
    jsonUrlInput.type = 'text';
    jsonUrlInput.placeholder = 'https://app.asana.com/api/...';

    const assetFieldLabel = document.createElement('label');
    assetFieldLabel.textContent = 'Asana asset custom field name:';

    const assetFieldInput = document.createElement('input');
    assetFieldInput.type = 'text';
    assetFieldInput.value = state.asana.assetFieldName;

    const chkRow = document.createElement('div');
    chkRow.className = 'chkRow';
    const onlyIncompleteChk = document.createElement('input');
    onlyIncompleteChk.type = 'checkbox';
    onlyIncompleteChk.checked = true;
    const chkText = document.createElement('span');
    chkText.textContent = 'Only include incomplete tasks (completed=false)';
    chkRow.appendChild(onlyIncompleteChk);
    chkRow.appendChild(chkText);

    //ignore assets
    const ignoreLabel = document.createElement('label');
    ignoreLabel.textContent = 'Ignore assets (Any 10-digit IDs will be ignored):';

    const ignoreBox = document.createElement('textarea');
    ignoreBox.style.width = '100%';
    ignoreBox.style.height = '90px';
    ignoreBox.style.borderRadius = '12px';
    ignoreBox.style.border = '1px solid rgba(255,255,255,0.14)';
    ignoreBox.style.background = 'rgba(255,255,255,0.06)';
    ignoreBox.style.color = 'rgba(255,255,255,0.88)';
    ignoreBox.style.padding = '8px';
    ignoreBox.style.fontSize = '12px';
    ignoreBox.style.boxSizing = 'border-box';
    ignoreBox.placeholder = 'Example:\nMigration racks (ignore):\n4905031117\n4905031141\n...';

    const ignoreLoadBtn = document.createElement('button');
    ignoreLoadBtn.className = 'btn';
    ignoreLoadBtn.textContent = 'Load Ignore List';

    // CSV input
    const csvLabel = document.createElement('label');
    csvLabel.textContent = 'Quicksuite CSV export:';

    const csvInput = document.createElement('input');
    csvInput.type = 'file';
    csvInput.accept = '.csv,text/csv';

    const csvColLabel = document.createElement('label');
    csvColLabel.textContent = 'CSV asset column header (auto-detected; override if needed):';

    const csvColInput = document.createElement('input');
    csvColInput.type = 'text';
    csvColInput.placeholder = 'Auto-detected after CSV load…';
    csvColInput.disabled = true;

    const csvColApplyBtn = document.createElement('button');
    csvColApplyBtn.className = 'btn';
    csvColApplyBtn.textContent = 'Apply Column';
    csvColApplyBtn.disabled = true;

    const status = document.createElement('div');
    status.className = 'status';
    status.textContent = 'Step 1: Load JSON from URL. Step 2: Upload CSV. Step 3: Compare.';

    const results = document.createElement('div');
    results.className = 'results';
    results.textContent = 'Results will appear here.';

    col.appendChild(hint);
    col.appendChild(jsonUrlLabel);
    col.appendChild(jsonUrlInput);
    col.appendChild(assetFieldLabel);
    col.appendChild(assetFieldInput);
    col.appendChild(chkRow);
    col.appendChild(ignoreLabel);
    col.appendChild(ignoreBox);
    col.appendChild(ignoreLoadBtn);
    col.appendChild(csvLabel);
    col.appendChild(csvInput);
    col.appendChild(csvColLabel);
    col.appendChild(csvColInput);
    col.appendChild(csvColApplyBtn);
    col.appendChild(status);
    col.appendChild(results);

    // Buttons
    const btnCol = document.createElement('div');
    btnCol.className = 'btnCol';

    const loadJsonUrlBtn = document.createElement('button');
    loadJsonUrlBtn.className = 'btn';
    loadJsonUrlBtn.textContent = 'Load JSON';

    const compareBtn = document.createElement('button');
    compareBtn.className = 'btn primary';
    compareBtn.textContent = 'Compare';
    compareBtn.disabled = true;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn';
    copyBtn.textContent = 'Copy Results';
    copyBtn.disabled = true;

    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn danger';
    clearBtn.textContent = 'Clear';

    const instructionsBtn = document.createElement('button');
    instructionsBtn.className = 'btn';
    instructionsBtn.textContent = 'Instructions';

    btnCol.appendChild(loadJsonUrlBtn);
    btnCol.appendChild(compareBtn);
    btnCol.appendChild(copyBtn);
    btnCol.appendChild(clearBtn);
    btnCol.appendChild(instructionsBtn);

    row.appendChild(col);
    row.appendChild(btnCol);

    box.appendChild(hdr);
    box.appendChild(row);
    document.body.appendChild(box);

    // ------------
    // Handlers
    // ------------

    function toggleInstructionsPanel() {
      const existing = document.getElementById(`${WIDGET_ID}-instructions`);
      if (existing) {
        existing.remove();
        return;
      }

      const panel = document.createElement('div');
      panel.id = `${WIDGET_ID}-instructions`;

      panel.innerHTML = `
        <div class="closeInstr">✕</div>
        <h3>How To Use This Tool</h3>
        <ol>
          <li>
            In <b>Asana</b>, near the project name (top left), click the
            <b>"Actions"</b> dropdown → select <b>"Export or sync"</b> → choose <b>"JSON"</b>.
          </li>
          <li>
            In the new JSON tab that opens, copy the URL and paste it into the tool’s
            <b>Asana JSON export URL</b> textbox.
          </li>
          <li>
            The <b>Asana asset custom field</b> will default to <b>Asset (ID)</b>.
            If your project uses a different field name, type it in.
            <br>
            If you only want to compare incomplete tasks, keep the checkbox checked.
          </li>
          <li>Click <b>"Load JSON"</b>.</li>
          <li>
            If you have previously verified assets to ignore, paste them into the
            <b>Ignore assets</b> box and click <b>"Load Ignore List"</b>.
          </li>
          <li>
            Go to <b>Quicksuite Backlog Racks Dashboard</b>:
            <a href="https://us-east-1.quicksight.aws.amazon.com/sn/account/amazonbi/dashboards/13b6f36e-e749-462d-8a46-0dc87c811481" target="_blank" style="color:#8ea6ff;">Link Here</a>
          </li>
          <li>Select the correct filters for <b>AZ</b> and <b>Site</b>.</li>
          <li>
            Click the <b>3-dot menu</b> in the top right of the dashboard and select
            <b>"Export to CSV"</b>.
          </li>
          <li>
            Click the 'Browse' file button to upload the <b>Quicksuite CSV</b> file.
          </li>
          <li>
            The <b>CSV Asset Header Column</b> will default to <b>Asset Id</b>.
            If your CSV has a different header column name, type it in and click <b>Apply Column</b>
          </li>
          <li>
            Click <b>"Compare"</b> to view discrepancies.
          </li>
          <li>
            Review results. If an asset is expected noise (e.g., migration racks),
            add it to the daily ignore list for future runs.
          </li>
        </ol>
      `;

      panel.querySelector('.closeInstr').addEventListener('click', () => {
        panel.remove();
      });

      document.body.appendChild(panel);
    }

    instructionsBtn.addEventListener('click', toggleInstructionsPanel);

    function updateCompareEnabled() {
      compareBtn.disabled = !(state.asana.assets.size > 0 && state.csv.assets.size > 0);
    }

    ignoreLoadBtn.addEventListener('click', () => {
      const assets = extractAll10DigitAssets(ignoreBox.value);
      state.ignore.assets = assets;
      setStatus(status, `Ignore list loaded: ${assets.size} assets will be excluded from the comparison.`);
    });

    function applyCsvColumnFromInput() {
      const typed = (csvColInput.value || '').trim();
      if (!typed) {
        setStatus(status, 'CSV column is blank. Type the exact header name from the CSV.');
        return;
      }

      const headersLower = state.csv.headers.map(h => String(h).toLowerCase());
      const idx = headersLower.indexOf(typed.toLowerCase());

      if (idx < 0) {
        setStatus(status, `CSV column not found: "${typed}". Check spelling/case. Available headers: ${state.csv.headers.join(', ')}`);
        return;
      }

      // Use the canonical header string from the file (preserves exact casing/spaces)
      const canonical = state.csv.headers[idx];

      state.csv.assetCol = canonical;
      csvColInput.value = canonical;

      state.csv.assets = extractAssetsFromCsvRows(state.csv.rows, state.csv.assetCol);

      setStatus(status, `CSV column set: ${state.csv.assetCol} | assets=${state.csv.assets.size}`);
      updateCompareEnabled();
    }

    csvColApplyBtn.addEventListener('click', applyCsvColumnFromInput);

    csvColInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyCsvColumnFromInput();
      }
    });

    loadJsonUrlBtn.addEventListener('click', async () => {
      setStatus(status, 'Fetching Asana JSON from URL…');
      try {
        state.asana.assetFieldName = assetFieldInput.value.trim() || 'Asset (ID)';

        const json = await fetchAsanaJsonFromUrl(jsonUrlInput.value);
        const tasks = extractAsanaTasksFromExport(json);

        const fieldName = state.asana.assetFieldName;
        const fieldExists = doesCustomFieldExistAnywhere(tasks, fieldName);

        state.asana.tasks = tasks;
        state.asana.assets = extractAsanaAssets(tasks, fieldName, onlyIncompleteChk.checked);

        // build a notice if the field doesn't exist
        const notice = fieldExists
          ? ''
          : ` | NOTE: custom field "${fieldName}" not found — using task-name fallback (10-digit scan)`;

        setStatus(
          status,
          `Asana JSON loaded: tasks=${tasks.length} | assets=${state.asana.assets.size} | onlyIncomplete=${onlyIncompleteChk.checked} | excluded Rack Type (ID)=Network${notice}`
        );
      } catch (e) {
        setStatus(status, `Load JSON failed: ${String(e?.message || e)}`);
      }
      updateCompareEnabled();
    });

    assetFieldInput.addEventListener('input', () => {
      state.asana.assetFieldName = assetFieldInput.value.trim() || 'Asset (ID)';
      setStatus(status, `Asana asset field set to: ${state.asana.assetFieldName}`);
    });

    onlyIncompleteChk.addEventListener('change', () => {
      if (state.asana.tasks.length) {
        state.asana.assets = extractAsanaAssets(state.asana.tasks, state.asana.assetFieldName, onlyIncompleteChk.checked);
        setStatus(status, `Asana filter updated: onlyIncomplete=${onlyIncompleteChk.checked} | assets=${state.asana.assets.size} | excluded Rack Type (ID)=Network`);
        updateCompareEnabled();
      }
    });

    // CSV load
    let csvRows = [];
    let csvHeaders = [];

    csvInput.addEventListener('change', async () => {
      state.csv.rows = [];
      state.csv.headers = [];
      state.csv.assets = new Set();
      state.csv.assetCol = null;

      csvColInput.value = '';
      csvColInput.disabled = true;
      csvColApplyBtn.disabled = true;

      const f = csvInput.files?.[0];
      if (!f) {
        setStatus(status, 'CSV cleared.');
        updateCompareEnabled();
        return;
      }

      setStatus(status, `Reading CSV: ${f.name}…`);
      try {
        const text = await f.text();
        const parsed = parseCsv(text);

        csvRows = parsed.rows;
        csvHeaders = parsed.headers;

        state.csv.rows = csvRows;
        state.csv.headers = csvHeaders;

        const guess = guessAssetColumn(csvHeaders);

        // enable override UI
        csvColInput.disabled = false;
        csvColApplyBtn.disabled = false;

        // fill the detected column name into the input
        csvColInput.value = guess || '';

        state.csv.assetCol = csvColInput.value;
        state.csv.assets = extractAssetsFromCsvRows(csvRows, state.csv.assetCol);

        setStatus(status, `CSV loaded: rows=${csvRows.length} | assets=${state.csv.assets.size} | column=${state.csv.assetCol || '(blank)'}`);
      } catch (e) {
        setStatus(status, `CSV read failed: ${String(e?.message || e)}`);
      }

      updateCompareEnabled();
    });

    // Compare
    compareBtn.addEventListener('click', () => {
      const out = formatOutput();
      results.textContent = out;
      state.lastOutput = out;
      copyBtn.disabled = !out;
      setStatus(status, 'Compared. See results.');
    });

    // Copy
    copyBtn.addEventListener('click', async () => {
      try {
        if (!state.lastOutput) return;
        await navigator.clipboard.writeText(state.lastOutput);
        setStatus(status, 'Copied results to clipboard.');
      } catch (e) {
        setStatus(status, `Copy failed: ${String(e?.message || e)}`);
      }
    });

    // Clear
    clearBtn.addEventListener('click', () => {
      state.asana.tasks = [];
      state.asana.assets = new Set();

      state.ignore.assets = new Set();
      ignoreBox.value = '';

      state.csv.rows = [];
      state.csv.headers = [];
      state.csv.assets = new Set();
      state.csv.assetCol = null;

      state.lastOutput = '';

      jsonUrlInput.value = '';
      csvInput.value = '';
      csvColInput.value = '';
      csvColInput.disabled = true;
      csvColApplyBtn.disabled = true;

      results.textContent = 'Results will appear here.';
      copyBtn.disabled = true;
      compareBtn.disabled = true;

      setStatus(status, 'Cleared.');
    });
  }

})();