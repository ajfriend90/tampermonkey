// ==UserScript==
// @name         Asana Rack Helper
// @namespace    https://github.com/ajfriend90/tampermonkey
// @version      1.0.0
// @description  Create and populate Asana tasks from rack asset IDs (Boost + RACKS).
// @author       Joey Friend (@ajfriend)
// @match        https://app.asana.com/*
// @grant        GM_xmlhttpRequest
// @connect      platform.bpds.boost.aws.a2z.com
// @connect      racks.aka.amazon.com
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/ajfriend90/tampermonkey/main/asana-rack-helper/asana-rack-helper.user.js
// @updateURL    https://raw.githubusercontent.com/ajfriend90/tampermonkey/main/asana-rack-helper/asana-rack-helper.user.js
// ==/UserScript==

(function () {
  'use strict';
    window.AsanaHelper = window.AsanaHelper || {};
    window.AsanaHelper.VERSION = '1.0.0';
    window.AsanaHelper.config = {
      API: {
        RACKS: "https://racks.aka.amazon.com/api/racks/",
        PROCUREMENT: "https://racks.aka.amazon.com/api/procurement/racks/?rackAssetIds[]=",
        HOSTS: "https://racks.amazon.com/api/hosts?rackAssetId=",
        PROVISIONING: "https://provisioning-web.amazon.com/racks/",
        MAXIS_SEARCH: "https://maxis-service-prod-pdx.amazon.com/issues",
        SCM: "https://awsscm.corp.amazon.com/physicalasset/details/",
        BOOST_GRAPHQL: "https://platform.bpds.boost.aws.a2z.com/graphql"
      }
    };

    window.AsanaHelper.log = window.AsanaHelper.log || {
      enabled: false,
      prefix: '[RackHelper]',
      info(...args) { if (this.enabled) console.log(this.prefix, ...args); },
      warn(...args) { console.warn(this.prefix, ...args); },
      error(...args) { console.error(this.prefix, ...args); }
    };

    window.AsanaHelper.state = window.AsanaHelper.state || {};
    window.AsanaHelper.state.run = window.AsanaHelper.state.run || {
      isRunning: false,
      cancelRequested: false,
      totals: { total: 0, done: 0, ok: 0, failed: 0 },
      failures: []
    };

    window.AsanaHelper.utils = window.AsanaHelper.utils || {};

    window.AsanaHelper.utils.safeParseJson = function (maybeJson) {
      if (maybeJson == null) return null;
      if (typeof maybeJson === 'object') return maybeJson;
      if (typeof maybeJson !== 'string') return null;
      try { return JSON.parse(maybeJson); } catch { return null; }
    };

    window.AsanaHelper.utils.parseUplinkConfig = function parseUplinkConfig(uplinkConfig) {
      if (typeof uplinkConfig !== 'string') {
        return { fabric: '', uplinks: '' };
      }

      // Expected format: "EC2 | (32+32+32+32)x100"
      const parts = uplinkConfig.split('|').map(p => p.trim());

      const rawFabric = parts[0] || '';
      const uplinks = parts[1] || '';

      // Normalize fabric naming
      let fabric = rawFabric;
      if (fabric.toUpperCase() === 'PRODUCTION') fabric = 'PROD';

      return { fabric, uplinks };
    };

    window.AsanaHelper.utils.normalizeWorkRequestResult = function (item) {
      const sr = window.AsanaHelper.utils.safeParseJson(item.searchResult) || item.searchResult;

      const get = (key) => {
        if (!sr || typeof sr !== 'object') return undefined;
        if (key in sr) return sr[key];
        if (sr.fields && key in sr.fields) return sr.fields[key];
        if (sr.values && key in sr.values) return sr.values[key];
        return undefined;
      };

      return {
        workRequestId: item.workRequestId,

        scannedDate: get('scannedDate'),
        location: get('location'),
        position: get('position'),
        brickName: get('brickName'),
        rackType: get('rackType'),
        uplinkConfig: get('uplinkConfig'),
        vendor: get('vendor')
      };
    };

    window.AsanaHelper.utils.minutesToAsanaDateTime = function minutesToAsanaDateTime(minutes) {
      // Input: minutesRemainingToHandoff (number; can be negative)
      // Output:
      //  - mdy: "MM/DD/YYYY" (DatePicker expects this)
      //  - time12: "h:mma/p" (e.g. "2:05pm")
      //  - dateObj: Date (useful for logs)

      if (typeof minutes !== 'number' || Number.isNaN(minutes)) {
        return { mdy: '', time12: '', dateObj: null };
      }

      const dateObj = new Date(Date.now() + minutes * 60 * 1000);

      const pad2 = (n) => String(n).padStart(2, '0');

      const mm = pad2(dateObj.getMonth() + 1);
      const dd = pad2(dateObj.getDate());
      const yyyy = String(dateObj.getFullYear());
      const mdy = `${mm}/${dd}/${yyyy}`;

      let hh = dateObj.getHours();
      const min = pad2(dateObj.getMinutes());

      const ampm = hh >= 12 ? 'pm' : 'am';
      hh = hh % 12;
      if (hh === 0) hh = 12;

      const time12 = `${hh}:${min}${ampm}`;

      return { mdy, time12, dateObj };
    };

    window.AsanaHelper.utils.parseAssetIds = function parseAssetIds(raw) {
      if (typeof raw !== 'string') return { valid: [], invalid: [] };

      const parts = raw
        .split(/[\n,;\t ]+/g)
        .map(s => s.trim())
        .filter(Boolean);

      const seen = new Set();
      const valid = [];
      const invalid = [];

      for (const token of parts) {
        const s = String(token).trim();

        // EXACTLY 10 digits
        if (!/^\d{10}$/.test(s)) {
          invalid.push(s);
          continue;
        }

        if (!seen.has(s)) {
          seen.add(s);
          valid.push(s);
        }
      }

      return { valid, invalid };
    };

    window.AsanaHelper.utils.mapLimit = async function mapLimit(items, limit, mapper) {
      const results = new Array(items.length);
      let next = 0;

      async function worker() {
        while (true) {
          const i = next++;
          if (i >= items.length) return;
          results[i] = await mapper(items[i], i);
        }
      }

      const workers = [];
      const n = Math.max(1, Math.min(limit, items.length));
      for (let i = 0; i < n; i++) workers.push(worker());
      await Promise.all(workers);
      return results;
    };

    window.AsanaHelper.utils.setNativeValue = function setNativeValue(el, value) {
      if (!el) return false;
      const v = String(value ?? '');

      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        // React-controlled inputs: use the native setter when possible
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && typeof desc.set === 'function') {
          desc.set.call(el, v);
        } else {
          el.value = v;
        }

        // Trigger React/Asana listeners
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }

      // Fallback: contenteditable (task name sometimes is, depending on view)
      if (el.isContentEditable) {
        el.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }

      return false;
    };

    window.AsanaHelper.utils.normalizeBuilding = function normalizeBuilding(building) {
      if (typeof building !== 'string') return '';

      const s = building.trim().toUpperCase();

      // Match: PREFIX + optional 0 + 2–3 digits
      // Examples:
      //   CMH70   -> CMH070
      //   CMH070  -> CMH070
      //   OSU5    -> OSU005
      //   OSU059  -> OSU059
      //   PDX2    -> PDX002
      const m = s.match(/^([A-Z]{2,4})0?(\d{1,3})$/);
      if (!m) return s;

      const prefix = m[1];
      const num = m[2].padStart(3, '0');

      return `${prefix}${num}`;
    };

    window.AsanaHelper.utils.pressKey = function pressKey(el, key) {
      if (!el) return;
      const opts = { key, code: key, bubbles: true };
      el.dispatchEvent(new KeyboardEvent('keydown', opts));
      el.dispatchEvent(new KeyboardEvent('keyup', opts));
    };

    window.AsanaHelper.utils.pressEnterStrong = function pressEnterStrong(el) {
      if (!el) return;

      const evInit = {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true
      };

      el.dispatchEvent(new KeyboardEvent('keydown', evInit));
      el.dispatchEvent(new KeyboardEvent('keypress', evInit));
      el.dispatchEvent(new KeyboardEvent('keyup', evInit));
    };

    window.AsanaHelper.utils.normalizeRackTypeForAsana = function normalizeRackTypeForAsana(rawRackType) {
      if (typeof rawRackType !== 'string') return null;

      const s = rawRackType.trim().toUpperCase();

      // Helper: "word-ish" contains check to reduce false positives
      // (still simple, but avoids some accidental matches)
      const has = (token) => s.includes(token);

      // 1) Special override: Juicebox wins no matter what else is in the string
      if (has('JUICEBOX')) return 'Juicebox';

      // 2) GB must be checked before B because "GB300" contains "B300"
      if (has('GB200')) return 'GB200';
      if (has('GB300')) return 'GB300';

      // 3) Then the B-series
      if (has('B200')) return 'B200';
      if (has('B300')) return 'B300';

      // 4) The rest are straightforward "contains"
      if (has('GLACIER')) return 'Glacier';
      if (has('EBS')) return 'EBS';
      if (has('S3')) return 'S3';
      if (has('TRN2P')) return 'TRN2P';
      if (has('P5')) return 'P5';

      // 5) Network detection (only after known compute/storage families are handled)
      // Notes:
      // - "NW" is risky as a raw substring, so we look for "NW." / "NW-" / "NW_" / " NW " patterns too.
      const networkSignals = [
        'FUSION',
        'PATCH',
        'ONEFABRIC',
        'STORM',
        'EUCLID',
        'PUFFIN',
        'FISSION',
        '12.8T',
        '51.2T',
        'BRICK',
      ];

      const nwSignals = [
        'NW.', 'NW-', 'NW_', ' NW ', 'NW/', 'NW\\', 'NW:', 'NW='
      ];

      const isNetwork =
        networkSignals.some(k => has(k)) ||
        nwSignals.some(k => has(k)) ||
        // also catch "starts with NW" cases (e.g., "NW....")
        /^NW\b/.test(s);

      if (isNetwork) return 'Network';

      // 6) Default bucket
      return 'Core';
    };

    window.AsanaHelper.utils.normalizeLocationForRackPosition = function normalizeLocationForRackPosition(location) {
      if (typeof location !== 'string') return '';
      const s = location.trim().toUpperCase();

      // Match prefix + digits, strip leading zeros from the numeric part
      const m = s.match(/^([A-Z]+)0*(\d+)$/);
      if (!m) return s;

      const prefix = m[1];
      const num = String(parseInt(m[2], 10)); // removes leading zeros
      return `${prefix}${num}`;
    };

    window.AsanaHelper.utils.buildRackPosition = function buildRackPosition(location, position) {
      const locRaw = (location ?? '').toString().trim();
      const posRaw = (position ?? '').toString().trim();

      if (!locRaw && !posRaw) return '';
      if (!locRaw) return posRaw;
      if (!posRaw) return window.AsanaHelper.utils.normalizeLocationForRackPosition(locRaw);

      const locPos = window.AsanaHelper.utils.normalizeLocationForRackPosition(locRaw);
      const locPad = window.AsanaHelper.utils.normalizeBuilding(locRaw);

      const variants = [
        locRaw.toUpperCase(),
        locPos.toUpperCase(),
        locPad.toUpperCase(),
      ].filter(Boolean);

      const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const group = variants.map(escapeRe).join('|');

      const re = new RegExp(`^(?:(?:${group})\\s*\\.?\\s*)+`, 'i');

      let trimmed = posRaw.replace(re, '').trim();
      trimmed = trimmed.replace(/^\.+\s*/, '').trim();

      if (!trimmed) return locPos;

      return `${locPos}.${trimmed}`;
    };

    window.AsanaHelper.utils.collectVisibleEnumOptions = function collectVisibleEnumOptions({
      timeoutMs = 1200,
      intervalMs = 50,
    } = {}) {
      const isVisible = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 4 && r.height > 4;
      };

      const deadline = Date.now() + timeoutMs;

      return new Promise((resolve) => {
        (function poll() {
          const menuRoots = [
            ...document.querySelectorAll('[role="listbox"]'),
            ...document.querySelectorAll('[data-testid*="dropdown"]'),
            ...document.querySelectorAll('[data-testid*="typeahead"]'),
            ...document.querySelectorAll('.LayerPositioner-layer'),
          ].filter(isVisible);

          const texts = new Set();

          for (const root of menuRoots) {
            const opts = root.querySelectorAll(
              '[role="option"], [role="menuitem"], .MenuItem'
            );

            for (const o of opts) {
              if (!isVisible(o)) continue;

              const text = (o.textContent || '')
                .replace(/\s+/g, ' ')
                .trim();

              if (!text) continue;
              if (text === '—') continue;
              if (/^edit options$/i.test(text)) continue;

              texts.add(text);
            }
          }

          if (texts.size > 0 || Date.now() > deadline) {
            resolve(texts);
          } else {
            setTimeout(poll, intervalMs);
          }
        })();
      });
    };

    window.AsanaHelper.API = window.AsanaHelper.API || {};

    window.AsanaHelper.API.gmJson = function gmJson({ method, url, headers, body, timeoutMs = 30000 }) {
      return new Promise((resolve) => {
        GM_xmlhttpRequest({
          method,
          url,
          anonymous: false,
          withCredentials: true,
          headers: {
            'Accept': 'application/json',
            ...(headers || {})
          },
          data: body ? JSON.stringify(body) : undefined,
          timeout: timeoutMs,

          onload: (resp) => {
            const text = resp.responseText || '';
            let json = null;
            try { json = text ? JSON.parse(text) : null; } catch { /* leave json null */ }

            resolve({
              ok: resp.status >= 200 && resp.status < 300,
              status: resp.status,
              url,
              text,
              json,
              headers: resp.responseHeaders || ''
            });
          },

          onerror: (err) => resolve({ ok: false, status: undefined, url, error: err }),
          ontimeout: () => resolve({ ok: false, status: undefined, url, error: new Error('timeout') })
        });
      });
    };

    window.AsanaHelper.API.buildBoostSearchWorkRequestsPayload = function buildBoostSearchWorkRequestsPayload(assetId) {
      const query = `query SearchWorkRequestsCRS($queryInput: QueryInputInput, $requestedOutputFields: [RequestedOutputFieldInput!], $requestedSearchResultsNumber: Int, $startOffset: Int, $sortInputs: [SortInputInput!]) {
        workRequestsCRS(
          queryInput: $queryInput
          requestedOutputFields: $requestedOutputFields
          requestedSearchResultsNumber: $requestedSearchResultsNumber
          startOffset: $startOffset
          sortInputs: $sortInputs
        ) {
          totalSearchResultsNumber
          searchResults {
            workRequestId
            searchResult
            __typename
          }
          __typename
        }
      }`;

      const variables = {
        queryInput: {
          combiningOperator: "AND",
          singleFieldQueries: [
            {
              fieldAlias: "workRequestTemplateCategory",
              searchValues: ["Rack", "Rack Install"],
              queryOperator: "IN_SET"
            },
            {
              fieldAlias: "workRequestTemplateWorkType",
              searchValues: ["Boost_Rack_Installation"],
              queryOperator: "IN_SET"
            },
            {
              fieldAlias: "allMatch",
              searchValues: [String(assetId)],
              queryOperator: "MATCH_PREFIX"
            },
            {
              fieldAlias: "workRequestStatus",
              searchValues: ["ACCEPTED", "COMPLETED"],
              queryOperator: "IN_SET"
            },
            {
              fieldAlias: "latestWorkflowMilestoneName",
              searchValues: ["Rejected"],
              queryOperator: "NOT_EQUAL"
            }
          ]
        },

        requestedOutputFields: [
          { fieldType: "FIELD_ALIAS", requestedOutputFieldValue: "location" },
          { fieldType: "FIELD_ALIAS", requestedOutputFieldValue: "position" },
          { fieldType: "FIELD_ALIAS", requestedOutputFieldValue: "brickName" },
          { fieldType: "FIELD_ALIAS", requestedOutputFieldValue: "rackType" },
          { fieldType: "FIELD_ALIAS", requestedOutputFieldValue: "uplinkConfig" },
          { fieldType: "FIELD_ALIAS", requestedOutputFieldValue: "vendor" }
        ],

        startOffset: 0,
        requestedSearchResultsNumber: 1,
        sortInputs: [
          { fieldAlias: "scannedDate", sortOrder: "DESC", precedence: 1 }
        ]
      };

      return { operationName: "SearchWorkRequestsCRS", query, variables };
    };

    window.AsanaHelper.API.fetchBoostRackInfo = async function fetchBoostRackInfo(assetId) {
      const payload = window.AsanaHelper.API.buildBoostSearchWorkRequestsPayload(assetId);

      const res = await window.AsanaHelper.API.gmJson({
        method: 'POST',
        url: window.AsanaHelper.config.API.BOOST_GRAPHQL,
        headers: { 'Content-Type': 'application/json' },
        body: payload
      });

      if (!res.ok) {
        const text = String(res.text || '');
        const isAuthStale = res.status === 403 && /Missing Authentication Token/i.test(text);

        window.AsanaHelper.log.error('Boost fetch failed', {
          status: res.status,
          text: text.slice(0, 250),
          isAuthStale
        });

        return { ok: false, res, authStale: isAuthStale };
      }

      if (res.json?.errors?.length) {
        window.AsanaHelper.log.warn('Boost GraphQL errors present', res.json.errors);
      }

      const wr = res.json?.data?.workRequestsCRS;
      const item = wr?.searchResults?.[0];
      if (!item) {
        window.AsanaHelper.log.warn('Boost returned 0 results', { total: wr?.totalSearchResultsNumber });
        return { ok: true, boost: null, res };
      }

      const selected = window.AsanaHelper.utils.normalizeWorkRequestResult(item);
      return { ok: true, boost: selected, res };
    };

    window.AsanaHelper.API.fetchRacksSla = async function fetchRacksSla(assetId) {
      const url = `${window.AsanaHelper.config.API.RACKS}${encodeURIComponent(assetId)}`;

      const res = await window.AsanaHelper.API.gmJson({
        method: 'GET',
        url
      });

      if (!res.ok) {
        window.AsanaHelper.log.error('RACKS API fetch failed', { status: res.status, text: (res.text || '').slice(0, 250) });
        return { ok: false, slaMinutes: null, racks: null, res };
      }

      const racks = res.json;
      const slaMinutes = typeof racks?.minutesRemainingToHandoff === 'number'
        ? racks.minutesRemainingToHandoff
        : null;

      if (slaMinutes == null) {
        window.AsanaHelper.log.warn('RACKS API: minutesRemainingToHandoff missing/unexpected type', {
          type: typeof racks?.minutesRemainingToHandoff,
          value: racks?.minutesRemainingToHandoff
        });
      }

      return { ok: true, slaMinutes, racks, res };
    };

    // Returns an Asana-ready fieldMap (final strings) for one rack assetId.
    // This is the boundary: everything above fetches/parses; everything below writes into Asana.
    window.AsanaHelper.service = window.AsanaHelper.service || {};

    window.AsanaHelper.service.getRackFieldMap = async function getRackFieldMap(assetId) {
      const [boostOut, slaOut] = await Promise.all([
        window.AsanaHelper.API.fetchBoostRackInfo(assetId),
        window.AsanaHelper.API.fetchRacksSla(assetId)
      ]);

      if (!boostOut.ok || !boostOut.boost) {
        const authStale = !!boostOut.authStale;

        return {
          assetId,
          ok: false,
          authStale,
          error: authStale
            ? 'Boost auth stale: open Boost in another tab and refresh, then refresh Asana.'
            : 'No Boost result',
          boostOk: boostOut.ok,
          slaOk: slaOut.ok,
          boostStatus: boostOut.res?.status,
          slaStatus: slaOut.res?.status,
          fieldMap: null
        };
      }

      const selected = boostOut.boost;

      // uplinkConfig -> fabric/uplinks
      const { fabric, uplinks } =
        window.AsanaHelper.utils.parseUplinkConfig(selected.uplinkConfig);

      const sla = window.AsanaHelper.utils.minutesToAsanaDateTime(slaOut.slaMinutes);

      const fieldMap = {
        assetId,
        building: selected.location || '',
        rackPosition: window.AsanaHelper.utils.buildRackPosition(selected.location, selected.position),
        brickName: selected.brickName || '',
        rackTypeRaw: selected.rackType || '',
        rackTypeAsana: window.AsanaHelper.utils.normalizeRackTypeForAsana(selected.rackType),
        vendor: selected.vendor || '',
        fabric,
        uplinks,
        workRequestId: selected.workRequestId || '',
        SLA: {mdy: sla.mdy, time12: sla.time12}
      };

      return {
        assetId,
        ok: true,
        boostOk: boostOut.ok,
        slaOk: slaOut.ok,
        boostStatus: boostOut.res?.status,
        slaStatus: slaOut.res?.status,
        fieldMap,
        selected
      };
    };

    window.AsanaHelper.asana = window.AsanaHelper.asana || {};

    window.AsanaHelper.asana.waitFor = window.AsanaHelper.utils.waitFor || (async (fn, { timeoutMs = 10000, intervalMs = 100 } = {}) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const v = fn();
        if (v) return v;
        await new Promise(r => setTimeout(r, intervalMs));
      }
      return null;
    });

    window.AsanaHelper.asana.sleep = (ms) => new Promise(r => setTimeout(r, ms));

    window.AsanaHelper.asana.closeTaskPaneIfOpen = async function closeTaskPaneIfOpen() {
      const pane = document.querySelector('.TaskPaneBody');
      if (!pane) return;

      // Escape usually closes the pane
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }));
      await this.sleep(120);
    };

    window.AsanaHelper.asana.clickAddTask = async function clickAddTask() {
      const btn = Array.from(document.querySelectorAll('div[role="button"]'))
        .find(el => (el.textContent || '').trim().includes('Add task'));

      if (!btn) throw new Error('Add task button not found');

      btn.click();

      // Asana focuses the new task-name editor immediately.
      const editor = await this.waitFor(() => {
        const ae = document.activeElement;
        if (!ae) return null;
        if (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT') return ae;
        if (ae.isContentEditable) return ae;
        return null;
      }, { timeoutMs: 8000 });

      if (!editor) throw new Error('New task name editor did not receive focus');

      return editor;
    };

    window.AsanaHelper.asana.setFocusedTaskName = async function setFocusedTaskName(name) {
      const el = document.activeElement;
      if (!el) throw new Error('No activeElement for task name');

      const ok = window.AsanaHelper.utils.setNativeValue(el, String(name));
      if (!ok) throw new Error('Focused element not editable (could not set task name)');

      // Give React a beat to commit and render the row controls.
      await this.sleep(120);
    };

    window.AsanaHelper.asana.openDetailsForFocusedRow = async function openDetailsForFocusedRow() {
      const tryFindAndClick = () => {
        const start = document.activeElement;
        if (!start) return false;

        let node = start;
        let detailsBtn = null;

        for (let i = 0; i < 12 && node; i++) {
          detailsBtn = node.querySelector?.('div[role="button"][aria-label="Details"]');
          if (detailsBtn) break;
          node = node.parentElement;
        }

        if (!detailsBtn) {
          const selected = document.querySelector('[aria-selected="true"]');
          detailsBtn = selected?.querySelector?.('div[role="button"][aria-label="Details"]') || null;
        }

        if (!detailsBtn) return false;

        detailsBtn.click();
        return true;
      };

      if (!tryFindAndClick()) {
        const el = document.activeElement;
        if (el) {
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }));
          await this.sleep(80);
        }

        if (!tryFindAndClick()) {
          throw new Error('Details button not found for the new task row');
        }
      }

      const pane = await this.waitFor(() => document.querySelector('.TaskPaneBody'), { timeoutMs: 8000 });
      if (!pane) throw new Error('TaskPaneBody did not appear after clicking Details');
      return pane;
    };

    window.AsanaHelper.asana.setTextCustomFieldInPane = async function setTextCustomFieldInPane(paneEl, fieldName, value) {
      if (!paneEl) throw new Error('paneEl missing');
      const wanted = String(fieldName).trim();

      const span = paneEl.querySelector(`span[aria-label="${CSS.escape(wanted)}"]`);
      if (!span) throw new Error(`Field label span not found: "${wanted}"`);

      const label = span.closest('label');
      const labelId = label?.id;
      if (!labelId) throw new Error(`Label id not found for "${wanted}"`);

      const input = paneEl.querySelector(`textarea[aria-labelledby="${CSS.escape(labelId)}"]`)
                || paneEl.querySelector(`input[aria-labelledby="${CSS.escape(labelId)}"]`);

      if (!input) throw new Error(`Input not found for "${wanted}" using aria-labelledby=${labelId}`);

      input.focus();
      const ok = window.AsanaHelper.utils.setNativeValue(input, String(value ?? ''));
      if (!ok) throw new Error(`Could not set value for "${wanted}" (unexpected input type)`);

      await this.sleep(80);
    };

    window.AsanaHelper.asana.createAndFillOneTask = async function createAndFillOneTask(fieldMap) {
      window.AsanaHelper.log.info('Asana: creating task', fieldMap.assetId);
      const warnings = [];

      await this.clickAddTask();
      await this.setFocusedTaskName(fieldMap.rackPosition);

      const pane = await this.openDetailsForFocusedRow();

      await this.setTextCustomFieldInPane(pane, 'Asset (ID)', fieldMap.assetId);
      await this.setTextCustomFieldInPane(pane, 'Brick', fieldMap.brickName);
      await this.setTextCustomFieldInPane(pane, 'Vendor', fieldMap.vendor);
      await this.setTextCustomFieldInPane(pane, 'Uplinks', fieldMap.uplinks);

      const buildingOption = window.AsanaHelper.utils.normalizeBuilding(fieldMap.building);
      const buildingSetOk = await this.setEnumCustomFieldInPane(pane, 'Building', buildingOption);
      if (!buildingSetOk) {
        warnings.push({ code: 'BUILDING_NOT_FOUND', message: `Building not found in Asana: ${buildingOption}` });
      }

      await this.setEnumCustomFieldInPane(pane, 'Rack Type (ID)', fieldMap.rackTypeAsana);
      await this.setTextCustomFieldInPane(pane, 'Rack Type Raw', fieldMap.rackTypeRaw);

      await this.setSlaDate(pane, fieldMap.SLA);
      const slaRawStr = `${fieldMap.SLA?.mdy || ''} ${fieldMap.SLA?.time12 || ''}`.trim();
      await this.setTextCustomFieldInPane(pane, 'SLA Raw', slaRawStr);

      window.AsanaHelper.log.info('Asana: filled text fields ✅', fieldMap.assetId);
      return { ok: true, warnings };
    };

    window.AsanaHelper.asana.runCreateTasksFromBatch = async function runCreateTasksFromBatch(okRows, { onProgress } = {}) {
      const run = window.AsanaHelper.state.run;
      run.isRunning = true;
      run.cancelRequested = false;
      run.failures = [];
      run.warnings = [];
      run.totals = { total: okRows.length, done: 0, ok: 0, failed: 0 };

      const progress = () => {
        if (typeof onProgress === 'function') onProgress({ ...run.totals });
      };

      progress();

      for (const r of okRows) {
        if (run.cancelRequested) break;

        try {
          await this.closeTaskPaneIfOpen();

          const out = await this.createAndFillOneTask(r.fieldMap);

          if (out?.warnings?.length) {
            for (const w of out.warnings) {
              run.warnings.push({ assetId: r.assetId, ...w});
            }
          }

          run.totals.ok += 1;
        } catch (e) {
          run.totals.failed += 1;
          run.failures.push({ assetId: r.assetId, error: String(e?.message || e) });
          window.AsanaHelper.log.error('Asana: failed for assetId ' + r.assetId, e);

          await this.closeTaskPaneIfOpen();
        } finally {
          run.totals.done += 1;
          progress();
          await this.sleep(200);
        }
      }

      run.isRunning = false;
      progress();

      return { ...run.totals, failures: run.failures.slice(), warnings: (run.warnings || []).slice() };
    };

    window.AsanaHelper.asana.setEnumCustomFieldInPane = async function setEnumCustomFieldInPane(
      paneEl,
      labelAriaText,
      optionText
    ) {
      const log = window.AsanaHelper.log;
      const utils = window.AsanaHelper.utils;

      if (!paneEl) throw new Error('paneEl missing');

      const labelPrefix = String(labelAriaText || '').trim();
      if (!labelPrefix) throw new Error('labelAriaText empty');

      const wanted = String(optionText ?? '').replace(/\s+/g, ' ').trim();
      if (!wanted) {
        log.warn(`Enum optionText empty for field "${labelPrefix}" — skipping`);
        return false;
      }

      // Prefix match so passing "Building" works across "(CMH50az)", "(CMH51az)", etc.
      const labelSpan = Array.from(paneEl.querySelectorAll('span[aria-label]')).find((s) =>
        String(s.getAttribute('aria-label') || '').trim().startsWith(labelPrefix)
      );
      if (!labelSpan) throw new Error(`Label not found in pane (prefix): "${labelPrefix}"`);

      const rowRoot = labelSpan.closest('.LabeledRowStructure-left')?.parentElement;
      if (!rowRoot) throw new Error(`Row root not found for label (prefix): "${labelPrefix}"`);

      // Prefix match so it works when aria-label becomes "Building (CMH50az) CMH059"
      const btn = Array.from(rowRoot.querySelectorAll('div[role="button"][aria-label]')).find((b) =>
        String(b.getAttribute('aria-label') || '').trim().startsWith(labelPrefix)
      );
      if (!btn) throw new Error(`Enum button not found for label prefix: "${labelPrefix}"`);

      btn.click();
      await this.sleep(80);

      // Collect visible options from the now-open dropdown
      const optionSet = await utils.collectVisibleEnumOptions?.({ timeoutMs: 1200 }) ?? new Set();

      // If we can't see any options at all, don't hard-fail here; fall back to typing.
      if (optionSet.size > 0 && !optionSet.has(wanted)) {
        log.warn(`Enum option not available: "${wanted}" — clearing field`, {
          field: labelPrefix,
          available: Array.from(optionSet)
        });

        const isVisible = (el) => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return r.width > 4 && r.height > 4;
        };

        // Try to explicitly select the "no value" option (—)
        const clearOption = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"]'))
          .find(o => {
            if (!isVisible(o)) return false;
            const t = (o.textContent || '').replace(/\s+/g, ' ').trim();
            return t === '—';
          });

        if (clearOption) {
          clearOption.click();
          await this.sleep(120);
          log.info(`Cleared enum field "${labelPrefix}" via "—" option`);
          return false;
        }

        // Fallback: close + try to clear via keyboard
        utils.pressKey(document.body, 'Escape');
        await this.sleep(80);

        return false;
      }

      // Prefer clicking the exact option if it exists (more reliable than Enter)
      const clickExactOptionIfPresent = () => {
        const isVisible = (el) => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return r.width > 4 && r.height > 4;
        };

        // Narrow search to visible listboxes first
        const roots = Array.from(document.querySelectorAll('[role="listbox"]')).filter(isVisible);
        const pools = roots.length ? roots : [document];

        for (const root of pools) {
          const opts = Array.from(root.querySelectorAll('[role="option"], [role="menuitem"]'));
          for (const o of opts) {
            if (!isVisible(o)) continue;
            const t = String(o.textContent || '').replace(/\s+/g, ' ').trim();
            if (!t) continue;
            if (t === '—') continue;
            if (/^edit options$/i.test(t)) continue;

            if (t === wanted) {
              o.click();
              return true;
            }
          }
        }
        return false;
      };

      if (clickExactOptionIfPresent()) {
        await this.sleep(120);
        log.info(`Set enum field "${labelPrefix}" -> "${wanted}" (clicked)`);
        return true;
      }

      // Fallback: type + Enter
      const input = await this.waitFor(
        () => {
          const a = document.activeElement;
          if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return a;
          return null;
        },
        { timeoutMs: 2500 }
      );

      if (!input) throw new Error('Enum picker input did not appear');

      const ok = utils.setNativeValue(input, wanted);
      if (!ok) throw new Error('Could not type into enum picker input');

      await this.sleep(80);
      utils.pressEnterStrong?.(input) || utils.pressKey(input, 'Enter');
      await this.sleep(120);

      log.info(`Set enum field "${labelPrefix}" -> "${wanted}" (typed+enter)`);
      return true;
    };

    window.AsanaHelper.asana.setSlaDate = async function setSlaDate(paneEl, sla) {
      const u = window.AsanaHelper.utils;
      const log = window.AsanaHelper.log;
      const FIELD_LABEL = 'SLA Date (ID)';

      const mdy = sla?.mdy || '';
      if (!mdy) {
        log.warn('No SLA date to set; skipping', { sla });
        return false;
      }

      const wrapper = paneEl.querySelector(
        `div.CustomPropertyDateValueInput[aria-label="${CSS.escape(FIELD_LABEL)}"]`
      );
      if (!wrapper) throw new Error(`SLA field wrapper not found: ${FIELD_LABEL}`);

      const tokenBtn = wrapper.querySelector(`div[role="button"][aria-label="${CSS.escape(FIELD_LABEL)}"]`);
      if (!tokenBtn) throw new Error('SLA token button not found');

      tokenBtn.click();
      await this.sleep(200);

      const picker = document.querySelector('.DatePicker-container');
      if (!picker) throw new Error('DatePicker popup not found');

      const dateInput = picker.querySelector('#due_date_input_id_select');
      if (!dateInput) throw new Error('Date input #due_date_input_id_select not found');

      dateInput.focus();
      u.setNativeValue(dateInput, '');
      u.setNativeValue(dateInput, mdy);

      // Commit the date
      u.pressEnterStrong?.(dateInput) || u.pressKey(dateInput, 'Enter');
      await this.sleep(120);

      // Close picker
      u.pressKey(document.body, 'Escape');
      await this.sleep(80);

      log.info(`Set SLA date-only -> ${mdy}`);
      return true;
    };

    window.AsanaHelper.ui = window.AsanaHelper.ui || {};

    window.AsanaHelper.ui.storageKey = (k) => `AsanaHelper:${k}`;

    window.AsanaHelper.ui.savePos = function savePos(pos) {
      try { localStorage.setItem(this.storageKey('pos'), JSON.stringify(pos)); } catch {}
    };

    window.AsanaHelper.ui.loadPos = function loadPos() {
      try {
        const raw = localStorage.getItem(this.storageKey('pos'));
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    };

    window.AsanaHelper.ui.saveCollapsed = function saveCollapsed(v) {
      try { localStorage.setItem(this.storageKey('collapsed'), v ? '1' : '0'); } catch {}
    };

    window.AsanaHelper.ui.loadCollapsed = function loadCollapsed() {
      try { return localStorage.getItem(this.storageKey('collapsed')) === '1'; } catch { return false; }
    };

    window.AsanaHelper.ui.makeDraggable = function makeDraggable(container, handle) {
      let dragging = false;
      let startX = 0, startY = 0;
      let startLeft = 0, startTop = 0;

      const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

      const onDown = (e) => {
        // ignore clicks on buttons inside header
        if (e.target && (e.target.closest?.('button') || e.target.closest?.('.iconBtn'))) return;

        dragging = true;
        const rect = container.getBoundingClientRect();

        startX = e.clientX;
        startY = e.clientY;
        startLeft = rect.left;
        startTop = rect.top;

        // Switch from bottom/right positioning to explicit top/left (drag friendly)
        container.style.right = 'auto';
        container.style.bottom = 'auto';
        container.style.left = `${rect.left}px`;
        container.style.top = `${rect.top}px`;

        handle.setPointerCapture?.(e.pointerId);
        e.preventDefault();
      };

      const onMove = (e) => {
        if (!dragging) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        const w = container.offsetWidth;
        const h = container.offsetHeight;

        const maxLeft = window.innerWidth - w - 8;
        const maxTop = window.innerHeight - h - 8;

        const left = clamp(startLeft + dx, 8, maxLeft);
        const top = clamp(startTop + dy, 8, maxTop);

        container.style.left = `${left}px`;
        container.style.top = `${top}px`;
      };

      const onUp = () => {
        if (!dragging) return;
        dragging = false;

        const left = parseFloat(container.style.left) || 0;
        const top = parseFloat(container.style.top) || 0;
        window.AsanaHelper.ui.savePos({ left, top });
      };

      handle.addEventListener('pointerdown', onDown);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };

    const WIDGET_ID = 'tm-asana-rack-helper';
    const ROOT_CSS = `
      :root {
        --rh-bg: rgba(10, 10, 12, 0.62);     /* black glass */
        --rh-border: rgba(255,255,255,0.10);
        --rh-shadow: 0 18px 50px rgba(0,0,0,0.55);

        --rh-text: rgba(255,255,255,0.88);
        --rh-muted: rgba(255,255,255,0.62);

        --rh-accent: #635bff;
        --rh-accent-hover: #544cff;
        --rh-danger: #ff4d4f;
      }

      #${WIDGET_ID} {
        position: fixed;
        isolation: isolate;
        right: 16px;
        bottom: 16px;
        z-index: 999999;

        width: 320px;
        padding: 12px;

        font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        color: var(--rh-text);

        background: var(--rh-bg);
        border: 1px solid var(--rh-border);
        border-radius: 14px;
        box-shadow: var(--rh-shadow);

        /* glass */
        backdrop-filter: blur(14px) saturate(140%);
        -webkit-backdrop-filter: blur(14px) saturate(140%);

        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      #${WIDGET_ID}::before {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: 14px;
        pointer-events: none;
        background: linear-gradient(
          180deg,
          rgba(255,255,255,0.10),
          rgba(255,255,255,0.02) 35%,
          rgba(0,0,0,0.00)
        );
      }

      #${WIDGET_ID} .hdr {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        user-select: none;
        cursor: grab;
        touch-action: none;
      }

      #${WIDGET_ID} .hdr:active {
        cursor: grabbing;
      }

      #${WIDGET_ID} .iconBtn {
        appearance: none;
        border: 1px solid rgba(255,255,255,0.14);
        background: rgba(255,255,255,0.06);
        border-radius: 10px;
        padding: 4px 8px;
        font-size: 12px;
        line-height: 1;
        cursor: pointer;
        color: var(--rh-text);
      }

      #${WIDGET_ID} .iconBtn:hover {
        background: rgba(255,255,255,0.10);
      }

      #${WIDGET_ID} .title {
        font-size: 13px;
        font-weight: 650;
        letter-spacing: 0.2px;
      }

      #${WIDGET_ID} .subtitle {
        font-size: 12px;
        color: var(--rh-muted);
      }

      #${WIDGET_ID} .pill {
        font-size: 11px;
        padding: 4px 8px;
        border-radius: 999px;
        background: rgba(255,255,255,0.07);
        border: 1px solid rgba(255,255,255,0.10);
        color: rgba(255,255,255,0.72);
      }

      #${WIDGET_ID} .row {
        display: flex;
        gap: 8px;
        align-items: flex-start;
      }

      #${WIDGET_ID} textarea {
        width: 100%;
        box-sizing: border-box;

        min-height: 78px;
        padding: 10px 10px;

        font-size: 13px;
        line-height: 1.25;

        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.14);
        background: rgba(0,0,0,0.25);
        color: var(--rh-text);

        outline: none;

        resize: vertical;
        overflow: auto;
        flex: 0 0 auto;
      }

      #${WIDGET_ID} textarea:focus {
        border-color: rgba(99,91,255,0.60);
        box-shadow: 0 0 0 4px rgba(99,91,255,0.18);
        background: rgba(0,0,0,0.32);
      }

      #${WIDGET_ID} .btn {
        width: 94px;
        margin-top: 0;
        height: 38px;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.14);
        background: rgba(255,255,255,0.06);
        cursor: pointer;

        font-size: 13px;
        font-weight: 600;
        color: var(--rh-text);

        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;

        transition: transform 0.05s ease, background 0.12s ease, border-color 0.12s ease;
      }

      #${WIDGET_ID} .btnCol {
        width: 94px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      #${WIDGET_ID} .btnCol .btn {
        width: 100%;
      }

      #${WIDGET_ID} .btn:hover {
        background: rgba(255,255,255,0.10);
      }

      #${WIDGET_ID} .btn:active {
        transform: translateY(1px);
      }

      #${WIDGET_ID} .btn.primary {
        background: rgba(99,91,255,0.90);
        color: white;
        border-color: rgba(0,0,0,0.20);
      }

      #${WIDGET_ID} .btn.primary:hover {
        background: rgba(99,91,255,1);
      }

      #${WIDGET_ID} .btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      #${WIDGET_ID} .btn.clear {
        background: rgba(255,255,255,0.06);
        font-weight: 600;
      }

      #${WIDGET_ID} .footer {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
      }

      #${WIDGET_ID} .footerRight {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 0 0 auto;
      }

      #${WIDGET_ID} .detailsBtn {
        appearance: none;
        border: 1px solid rgba(255,255,255,0.14);
        background: rgba(255,255,255,0.06);
        border-radius: 10px;
        padding: 4px 8px;
        font-size: 12px;
        line-height: 1;
        cursor: pointer;
        color: rgba(255,255,255,0.88);
        user-select: none;
      }

      #${WIDGET_ID} .detailsBtn:hover {
        background: rgba(255,255,255,0.10);
      }

      #${WIDGET_ID} .detailsPanel {
        display: none;
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(0,0,0,0.22);
        border-radius: 12px;
        padding: 10px;
        max-height: 180px;
        overflow: auto;
        font-size: 12px;
        line-height: 1.25;
        color: rgba(255,255,255,0.78);
        white-space: pre-wrap;
      }

      #${WIDGET_ID} .detailsPanel.show {
        display: block;
      }

      #${WIDGET_ID} .detailsHdr {
        font-weight: 650;
        margin: 0 0 6px 0;
        color: rgba(255,255,255,0.88);
      }

      #${WIDGET_ID} .detailsSection {
        margin-top: 10px;
      }

      #${WIDGET_ID} .detailsItem {
        padding: 4px 0;
        border-top: 1px solid rgba(255,255,255,0.08);
      }

      #${WIDGET_ID} .detailsItem:first-of-type {
        border-top: none;
      }

      #${WIDGET_ID} .tagWarn {
        display: inline-block;
        margin-right: 6px;
        padding: 1px 6px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.14);
        background: rgba(255,255,255,0.06);
        color: rgba(255,255,255,0.80);
        font-size: 11px;
      }

      #${WIDGET_ID} .tagFail {
        display: inline-block;
        margin-right: 6px;
        padding: 1px 6px;
        border-radius: 999px;
        border: 1px solid rgba(255,77,79,0.45);
        background: rgba(255,77,79,0.12);
        color: rgba(255,255,255,0.92);
        font-size: 11px;
      }

      #${WIDGET_ID} .status {
        font-size: 12px;
        color: var(--rh-muted);

        white-space: normal;
        overflow: visible;
        text-overflow: unset;

        max-width: none;
        flex: 1;
        min-width: 0;
        line-height: 1.25;
      }

      #${WIDGET_ID}.collapsed .row,
      #${WIDGET_ID}.collapsed .footer {
        display: none;
      }
    `;

    function injectStyle(cssText) {
      const STYLE_ID = `${WIDGET_ID}-style`;
      const old = document.getElementById(STYLE_ID);
      if (old) old.remove();

      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = cssText;
      document.head.appendChild(style);
    }

  function createWidget() {
    const existing = document.getElementById(WIDGET_ID);
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = WIDGET_ID;

    const savedPos = window.AsanaHelper.ui.loadPos();
    if (savedPos && typeof savedPos.left === 'number' && typeof savedPos.top === 'number') {
      container.style.right = 'auto';
      container.style.bottom = 'auto';
      container.style.left = `${savedPos.left}px`;
      container.style.top = `${savedPos.top}px`;
    }

    const hdr = document.createElement('div');
    hdr.className = 'hdr';

    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.flexDirection = 'column';
    left.style.gap = '2px';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = 'Asana Helper';

    const subtitle = document.createElement('div');
    subtitle.className = 'subtitle';
    subtitle.textContent = 'Rack assets → Asana tasks';

    left.appendChild(title);
    left.appendChild(subtitle);

    const pill = document.createElement('div');
    pill.className = 'pill';
    pill.textContent = `v${window.AsanaHelper.VERSION}`;

    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '8px';

    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'iconBtn';
    collapseBtn.title = 'Collapse / expand';
    collapseBtn.textContent = '▾'; // will flip based on state

    right.appendChild(pill);
    right.appendChild(collapseBtn);

    hdr.appendChild(left);
    hdr.appendChild(right);

    container.appendChild(hdr);

    const row = document.createElement('div');
    row.className = 'row';

    const input = document.createElement('textarea');
    input.placeholder = 'Paste asset IDs (one per line, or comma-separated)';
    input.spellcheck = false;

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn';
    clearBtn.textContent = 'Clear';
    clearBtn.className = 'btn clear';
    clearBtn.style.alignSelf = 'flex-start';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn primary';
    btn.textContent = 'Fetch';

    const stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    stopBtn.className = 'btn';
    stopBtn.textContent = 'Stop';
    stopBtn.disabled = true;

    const footer = document.createElement('div');
    footer.className = 'footer';

    const status = document.createElement('div');
    status.className = 'status';
    status.textContent = 'Idle';

    const footerRight = document.createElement('div');
    footerRight.className = 'footerRight';

    const detailsBtn = document.createElement('button');
    detailsBtn.type = 'button';
    detailsBtn.className = 'detailsBtn';
    detailsBtn.textContent = 'Details ▸';
    detailsBtn.disabled = true;

    footerRight.appendChild(detailsBtn);

    const detailsPanel = document.createElement('div');
    detailsPanel.className = 'detailsPanel';
    detailsPanel.textContent = 'No details yet.';

    let lastResult = null;
    let uiWarnings = [];
    let uiFailures = [];

    const setDetailsEnabled = (enabled) => {
      detailsBtn.disabled = !enabled;
      if (!enabled) {
        detailsPanel.classList.remove('show');
        detailsBtn.textContent = 'Details ▸';
      }
    };

    const renderDetails = (result) => {
      lastResult = result || null;

      const warns = result?.warnings || [];
      const fails = result?.failures || [];

      if (!warns.length && !fails.length) {
        detailsPanel.textContent = 'No warnings or failures.';
        return;
      }

      // Build simple, readable lines
      const lines = [];
      lines.push(`Warnings: ${warns.length}`);
      if (warns.length) {
        for (const w of warns) {
          const msg = (w.message || w.code || 'Warning').trim();
          lines.push(`  - [${w.assetId}] ${msg}`);
        }
      }

      lines.push('');
      lines.push(`Failures: ${fails.length}`);
      if (fails.length) {
        for (const f of fails) {
          const msg = (f.error || 'Failure').trim();
          lines.push(`  - [${f.assetId}] ${msg}`);
        }
      }

      detailsPanel.textContent = lines.join('\n');
    };

    const addUiWarnings = (arr) => {
      if (Array.isArray(arr) && arr.length) uiWarnings.push(...arr);
    };

    const resetUiDetails = () => {
      uiWarnings = [];
      uiFailures = [];
    };

    detailsBtn.addEventListener('click', () => {
      if (!lastResult) return;
      const isOpen = detailsPanel.classList.toggle('show');
      detailsBtn.textContent = isOpen ? 'Details ▾' : 'Details ▸';
    });

    setDetailsEnabled(false);

    const setCollapsed = (collapsed) => {
      container.classList.toggle('collapsed', collapsed);
      collapseBtn.textContent = collapsed ? '▸' : '▾';
      window.AsanaHelper.ui.saveCollapsed(collapsed);
    };

    setCollapsed(window.AsanaHelper.ui.loadCollapsed());

    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setCollapsed(!container.classList.contains('collapsed'));
    });

    window.AsanaHelper.ui.makeDraggable(container, hdr);

    hdr.addEventListener('dblclick', () => {
      setCollapsed(!container.classList.contains('collapsed'));
    });

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      stopBtn.disabled = true;
      status.textContent = 'Fetching…';
      resetUiDetails();
      setDetailsEnabled(false);
      detailsPanel.textContent = 'No details yet.';

      try {
        const raw = input.value;
        const trimmed = String(raw || '').trim();
        const { valid: assetIds, invalid: invalidIds } = window.AsanaHelper.utils.parseAssetIds(raw);
        const inputCount = assetIds.length + invalidIds.length;
        const skippedInvalid = invalidIds.length;

        // Case 1: literally nothing typed
        if (!trimmed) {
          status.textContent = 'Enter at least 1 assetId';
          setDetailsEnabled(false);
          return;
        }

        // Case 2: user typed something, but none of it is valid
        if (assetIds.length === 0 && invalidIds.length > 0) {
          status.textContent = `No valid asset IDs. IDs must be exactly 10 digits. (invalid=${invalidIds.length})`;

          const warnLines = invalidIds.map(x => ({
            assetId: x,
            code: 'INVALID_ASSET_ID',
            message: 'Not exactly 10 digits'
          }));

          addUiWarnings(warnLines);
          setDetailsEnabled(true);
          renderDetails({ warnings: warnLines, failures: uiFailures });

          return;
        }

        // Case 3: at least one valid (proceed), but optionally warn about invalids
        if (invalidIds.length) {
          status.textContent = `Ignoring ${invalidIds.length} invalid ID(s). Continuing with ${assetIds.length} valid.`;

          const warnLines = invalidIds.map(x => ({
            assetId: x,
            code: 'INVALID_ASSET_ID',
            message: 'Not exactly 10 digits'
          }));

          addUiWarnings(warnLines);
          renderDetails({ warnings: warnLines, failures: [] });
          setDetailsEnabled(true);
        }

        const CONCURRENCY = 4;
        window.AsanaHelper.log.info(`Fetching ${assetIds.length} rack(s) (concurrency=${CONCURRENCY})...`);

        const batch = await window.AsanaHelper.utils.mapLimit(
          assetIds,
          CONCURRENCY,
          (id) => window.AsanaHelper.service.getRackFieldMap(id)
        );

        window.AsanaHelper.state = window.AsanaHelper.state || {};
        window.AsanaHelper.state.batch = batch;

        const anyAuthStale = batch.some(r => r && r.authStale);
        if (anyAuthStale) {
          const blocker = [{
            code: 'BOOST_AUTH_STALE',
            message: 'Boost authentication expired. Open Boost in another tab, refresh, then refresh Asana.'
          }];

          renderDetails({ warnings: blocker, failures: [] });
          setDetailsEnabled(true);

          status.textContent =
            'Boost auth stale — click Details for more info';
          return;
        }

        console.table(batch.map(r => ({
          assetId: r.assetId,
          ok: r.ok,
          building: r.fieldMap?.building,
          pos: r.fieldMap?.rackPosition,
          brickName: r.fieldMap?.brickName,
          rackTypeRaw: r.fieldMap?.rackTypeRaw,
          vendor: r.fieldMap?.vendor,
          fabric: r.fieldMap?.fabric,
          uplinks: r.fieldMap?.uplinks,
          SLA: r.fieldMap?.SLA,
          workRequestId: r.fieldMap?.workRequestId,
          boostStatus: r.boostStatus,
          slaStatus: r.slaStatus,
          error: r.error
        })));

        const okRows = batch.filter(r => r.ok && r.fieldMap);

        if (okRows.length === 0) {
          status.textContent = 'No valid racks found';
          return;
        }

        stopBtn.disabled = false;
        const statusPrefix = skippedInvalid ? `Skipped invalid: ${skippedInvalid}. ` : '';
        const result = await window.AsanaHelper.asana.runCreateTasksFromBatch(okRows, {
          onProgress: ({ total, done, ok, failed }) => {
            status.textContent = `${statusPrefix}Asana: ${done}/${total} (ok=${ok}, failed=${failed})`;
          }
        });

        stopBtn.disabled = true;

        const stopped = !!window.AsanaHelper.state?.run?.cancelRequested;

        const warnCount = result.warnings?.length || 0;
        const warnSuffix = warnCount ? `, warn=${warnCount}` : '';

        const base =
          `${stopped ? 'Stopped' : 'Done'}: ` +
          `${result.done}/${result.total} ` +
          `(ok=${result.ok}, failed=${result.failed}${warnSuffix})`;

        const skippedSuffix = skippedInvalid ? ` | Skipped invalid: ${skippedInvalid}` : '';
        status.textContent = base + skippedSuffix;

        // Add building-specific info if present
        if (warnCount) {
          const buildingMisses = result.warnings.filter(
            w => w.code === 'BUILDING_NOT_FOUND'
          );

          if (buildingMisses.length) {
            const ids = [...new Set(buildingMisses.map(w => w.assetId))];

            status.textContent += ` | Building(s) not found, click Details for more info`;
          }
        }

        const merged = {
          warnings: [...(uiWarnings || []), ...(result.warnings || [])],
          failures: [...(uiFailures || []), ...(result.failures || [])]
        };
        renderDetails(merged);
        setDetailsEnabled(true);

        if (result.failures?.length) {
          window.AsanaHelper.log.warn('Failures summary:', result.failures);
        }
      } catch (e) {
        window.AsanaHelper.log.error('Unhandled error', e);
        status.textContent = 'Error (see console)';
      } finally {
        btn.disabled = false;
        stopBtn.disabled = true;
        if (window.AsanaHelper.state?.run) window.AsanaHelper.state.run.isRunning = false;
      }
    });

    stopBtn.addEventListener('click', () => {
      const run = window.AsanaHelper.state.run;
      if (!run?.isRunning) return;
      run.cancelRequested = true;
      status.textContent = 'Stopping…';
    });

    clearBtn.addEventListener('click', () => {
      input.value = '';
      status.textContent = 'Idle';
      input.focus();
      detailsPanel.classList.remove('show');
      detailsPanel.textContent = 'No details yet.';
      detailsBtn.textContent = 'Details ▸';
      detailsBtn.disabled = true;
    });

    footer.appendChild(status);
    footer.appendChild(footerRight);

    const inputCol = document.createElement('div');
    inputCol.style.display = 'flex';
    inputCol.style.flexDirection = 'column';
    inputCol.style.gap = '6px';
    inputCol.style.alignItems = 'flex-start';
    inputCol.style.flex = '1';

    const btnCol = document.createElement('div');
    btnCol.className = 'btnCol';
    btnCol.style.display = 'flex';
    btnCol.style.flexDirection = 'column';
    btnCol.style.gap = '8px';
    btnCol.style.alignItems = 'stretch';
    btnCol.style.flex = '0 0 auto';

    inputCol.appendChild(input);
    inputCol.appendChild(clearBtn);

    btnCol.appendChild(btn);
    btnCol.appendChild(stopBtn);

    row.appendChild(inputCol);
    row.appendChild(btnCol);

    container.appendChild(row);
    container.appendChild(footer);
    container.appendChild(detailsPanel);

    document.body.appendChild(container);
  }

  function init() {
    injectStyle(ROOT_CSS);
    createWidget();
  }

  init();
})();