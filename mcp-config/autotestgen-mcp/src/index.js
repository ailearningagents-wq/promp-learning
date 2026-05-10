#!/usr/bin/env node
/**
 * AutoTestGen MCP Server
 * ----------------------
 * Single-file Node.js MCP server that exposes high-level tools
 * (oidc_login, capture_page_dom, save_storage_state, extract_routes,
 *  probe_conditional, pom_mine_locators) so prompts call ONE tool
 * instead of orchestrating 8–15 browser primitives per page.
 *
 * Wire format: MCP over stdio (newline-delimited JSON-RPC 2.0).
 * Browser:    Playwright (uses the already-installed playwright dep).
 *
 * Deliberately minimal — no @modelcontextprotocol/sdk dependency.
 * All packages resolve from the local node_modules/ installed via
 * `npm install` in this folder. No packages are downloaded at runtime.
 *
 * Browser: uses the system-installed Google Chrome (preferred) or
 * Microsoft Edge — never the bundled Playwright Chromium binary.
 * Set PLAYWRIGHT_HEADLESS=false to watch the session in a visible window.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { chromium } = require('playwright');

// ---------------------------------------------------------------------------
// Browser singleton — reuse one context across tool calls in the same session.
// Prefers system-installed Chrome; falls back to Edge. Never uses the
// bundled Playwright Chromium binary — no browser download required.
// ---------------------------------------------------------------------------
let _browser = null;
let _context = null;
let _page = null;

async function getBrowser() {
  if (!_browser || !_browser.isConnected()) {
    const launchOpts = {
      headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    };
    let lastErr;
    for (const channel of ['chrome', 'msedge']) {
      try {
        _browser = await chromium.launch({ ...launchOpts, channel });
        return _browser;
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error(
      'Neither Google Chrome nor Microsoft Edge was found on this machine.\n' +
      'Install Chrome (preferred) or Edge, then retry.\n' +
      `Details: ${lastErr && lastErr.message}`
    );
  }
  return _browser;
}

async function getContext({ storageStatePath } = {}) {
  if (_context) return _context;
  const browser = await getBrowser();
  const opts = {};
  if (storageStatePath && fs.existsSync(storageStatePath)) {
    opts.storageState = storageStatePath;
  }
  _context = await browser.newContext(opts);
  return _context;
}

async function getPage(args) {
  if (_page && !_page.isClosed()) return _page;
  const ctx = await getContext(args);
  _page = await ctx.newPage();
  return _page;
}

async function closeAll() {
  try { if (_page) await _page.close(); } catch (e) {}
  try { if (_context) await _context.close(); } catch (e) {}
  try { if (_browser) await _browser.close(); } catch (e) {}
  _page = null; _context = null; _browser = null;
}

// ---------------------------------------------------------------------------
// In-page extractors (run inside the browser). Kept here as strings so the
// LLM never sees them — prompts just call the tool by name.
// ---------------------------------------------------------------------------
const EXTRACT_PAGE_DOM = `(() => {
  const isVisible = (el) => {
    if (!el) return false;
    const cs = window.getComputedStyle(el);
    return cs.display !== 'none'
        && cs.visibility !== 'hidden'
        && el.getAttribute('aria-hidden') !== 'true'
        && el.offsetParent !== null;
  };
  const hiddenReasonOf = (el) => {
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none') return 'display-none';
    if (cs.visibility === 'hidden') return 'visibility-hidden';
    if (el.getAttribute('aria-hidden') === 'true') return 'aria-hidden';
    if (el.offsetParent === null) return 'offscreen';
    return null;
  };
  const text = (el) => (el && el.textContent || '').trim();
  const attr = (el, a) => (el && el.getAttribute(a)) || '';

  // -- UI library detection --
  const hasKendo = !!window.kendo
    || !!document.querySelector('[class*=" k-"], [class^="k-"], kendo-dropdownlist, kendo-grid, kendo-combobox');
  const hasMaterial = !!document.querySelector('mat-select, mat-checkbox, mat-form-field, .cdk-overlay-container, mat-radio-group, mat-datepicker');
  const uiLibraries = []
    .concat(hasKendo ? ['kendo'] : [])
    .concat(hasMaterial ? ['material'] : [])
    .concat(!hasKendo && !hasMaterial ? ['native'] : []);
  const primaryLibrary = hasKendo ? 'kendo' : (hasMaterial ? 'material' : 'native');

  // -- 3a Page metadata --
  const metadata = {
    title: document.title || '',
    heading: text(document.querySelector('h1')),
    breadcrumb: Array.from(document.querySelectorAll(
      '[aria-label="breadcrumb"] a, .breadcrumb a, nav.breadcrumbs a'
    )).map(text).filter(Boolean),
    url: location.pathname,
    primaryLibrary,
    uiLibraries
  };

  // -- 3b Forms + fields --
  const fieldSel = [
    'input:not([type=hidden])', 'select', 'textarea',
    'kendo-dropdownlist', 'kendo-combobox', 'kendo-multiselect',
    'kendo-datepicker', 'kendo-numerictextbox',
    'mat-select', 'mat-checkbox', 'mat-radio-group',
    'mat-form-field', 'mat-datepicker-toggle', 'mat-autocomplete'
  ].join(', ');

  const inferUiLib = (el) => {
    const t = el.tagName.toLowerCase();
    if (t.startsWith('kendo-') || el.className && /\\bk-/.test(el.className)) return 'kendo';
    if (t.startsWith('mat-') || el.className && /\\bmat-/.test(el.className)) return 'material';
    return 'native';
  };
  const componentSelectorOf = (el) => {
    const tag = el.tagName.toLowerCase();
    const name = el.getAttribute('formcontrolname') || el.getAttribute('name') || el.id;
    if (tag.startsWith('kendo-')) return name ? \`\${tag}[name="\${name}"]\` : tag;
    if (tag.startsWith('mat-'))   return name ? \`\${tag}[formcontrolname="\${name}"]\` : tag;
    return el.id ? \`#\${el.id}\` : (name ? \`[name="\${name}"]\` : tag);
  };
  const interactionStrategyOf = (el, lib) => {
    const tag = el.tagName.toLowerCase();
    if (lib === 'kendo' && /^kendo-(dropdownlist|combobox|multiselect)$/.test(tag))
      return 'kendo-dropdown-click-list-item';
    if (lib === 'kendo' && tag === 'kendo-datepicker') return 'kendo-datepicker-type-iso';
    if (lib === 'kendo' && tag === 'kendo-numerictextbox') return 'kendo-numeric-clear-type';
    if (lib === 'material' && tag === 'mat-select') return 'material-mat-select-click-option';
    if (lib === 'material' && tag === 'mat-checkbox') return 'material-mat-checkbox-touch-target';
    if (lib === 'material' && tag === 'mat-radio-group') return 'material-mat-radio-click-by-label';
    if (lib === 'material' && tag === 'mat-datepicker-toggle') return 'material-datepicker-type-iso';
    if (tag === 'select') return 'native-selectOption';
    return 'native-fill';
  };

  const forms = Array.from(document.querySelectorAll('form, [role="form"]')).map((form, i) => {
    const fields = Array.from(form.querySelectorAll(fieldSel)).map(el => {
      const lib = inferUiLib(el);
      const lbl = (el.labels && el.labels[0] && el.labels[0].textContent && el.labels[0].textContent.trim())
               || el.getAttribute('aria-label')
               || el.getAttribute('placeholder')
               || '';
      return {
        tag: el.tagName.toLowerCase(),
        fieldType: el.getAttribute('type') || el.tagName.toLowerCase(),
        fieldId: el.id || '',
        fieldName: el.getAttribute('name') || el.getAttribute('formcontrolname') || '',
        label: lbl,
        placeholder: attr(el, 'placeholder'),
        required: el.required || el.getAttribute('aria-required') === 'true',
        readonly: el.readOnly || el.hasAttribute('readonly'),
        disabled: el.disabled || el.hasAttribute('disabled'),
        validationAttributes: {
          minLength: el.minLength > 0 ? el.minLength : null,
          maxLength: el.maxLength > 0 ? el.maxLength : null,
          min: el.min || null,
          max: el.max || null,
          pattern: attr(el, 'pattern') || null,
          step: el.step || null
        },
        options: el.tagName === 'SELECT'
          ? Array.from(el.options).map(o => ({ value: o.value, label: o.text }))
          : [],
        dataTestId: attr(el, 'data-testid') || attr(el, 'data-test-id'),
        ariaLabel: attr(el, 'aria-label'),
        conditionallyVisible: false,
        dependsOn: null,
        hidden: !isVisible(el),
        hiddenReason: hiddenReasonOf(el),
        uiLibrary: lib,
        componentSelector: componentSelectorOf(el),
        interactionStrategy: interactionStrategyOf(el, lib)
      };
    });
    return {
      formId: form.id || form.getAttribute('name') || form.getAttribute('aria-label') || \`form-\${i}\`,
      formAction: form.action || '',
      formMethod: (form.method || 'get').toLowerCase(),
      fields
    };
  });

  // -- 3c Buttons --
  const buttons = Array.from(document.querySelectorAll(
    'button, input[type="submit"], input[type="button"], input[type="reset"], a[role="button"], [role="button"]'
  )).filter(isVisible).map((el, i) => ({
    buttonId: el.id || \`btn-\${i}\`,
    buttonText: text(el) || el.value || attr(el, 'aria-label'),
    buttonType: (el.type || 'button').toLowerCase(),
    dataTestId: attr(el, 'data-testid'),
    ariaLabel: attr(el, 'aria-label'),
    navigatesTo: el.tagName === 'A' ? attr(el, 'href') : '',
    disabled: el.disabled || el.hasAttribute('disabled')
  }));

  // -- 3d Tables / grids --
  const tables = Array.from(document.querySelectorAll(
    'table, [role="grid"], kendo-grid, mat-table'
  )).map((tb, i) => {
    const tag = tb.tagName.toLowerCase();
    const lib = tag.startsWith('kendo-') ? 'kendo'
              : tag === 'mat-table' ? 'material' : 'native';
    const headers = Array.from(tb.querySelectorAll('th, [role="columnheader"]'))
      .map(text).filter(Boolean);
    const rowActions = new Set();
    tb.querySelectorAll('button, a[role="button"], .k-button').forEach(b => {
      const t = text(b); if (t) rowActions.add(t);
    });
    return {
      tableId: tb.id || \`table-\${i}\`,
      uiLibrary: lib,
      columns: headers,
      hasSorting: !!tb.querySelector('[aria-sort], .sortable, .k-sortable'),
      hasFiltering: !!tb.querySelector('.filter, [role="searchbox"], .k-filter-row'),
      hasPagination: !!tb.querySelector('.pagination, .k-pager-wrap, mat-paginator'),
      hasRowActions: rowActions.size > 0,
      rowActionButtons: Array.from(rowActions),
      hasEmptyState: !!tb.querySelector('.empty-state, .no-records, .k-grid-norecords')
    };
  });

  // -- 3e Modals --
  const modals = Array.from(document.querySelectorAll(
    'dialog, [role="dialog"], .modal, .overlay, kendo-dialog, mat-dialog-container'
  )).map((m, i) => ({
    modalId: m.id || \`modal-\${i}\`,
    title: text(m.querySelector('h1, h2, .modal-title, [role="heading"]')),
    hasForm: !!m.querySelector('form'),
    actionButtons: Array.from(m.querySelectorAll('button')).map(text).filter(Boolean),
    closeByBackdrop: !m.hasAttribute('data-no-backdrop')
  }));

  // -- 3f Error containers --
  const errorContainers = {
    inlineErrors: '.field-error, .invalid-feedback, mat-error, .k-form-error-msg',
    toastNotifications: '[role="alert"], .toast, .notification, .snackbar, mat-snack-bar-container',
    pageErrors: '.alert-danger, .error-banner, [role="alert"].error',
    successMessages: '.alert-success, .success-notification, [role="alert"].success'
  };

  // -- 3g Navigation --
  const navigation = {
    primaryNav: 'nav, [role="navigation"], .sidebar, .menu',
    breadcrumbs: '[aria-label="breadcrumb"], .breadcrumb',
    backButton: 'button.back, a.back, [aria-label="Back"]',
    pageActions: '.page-actions, .toolbar, .action-bar'
  };

  return { metadata, forms, buttons, tables, modals, errorContainers, navigation };
})()`;

const EXTRACT_ROUTES = `(() => {
  const sameOrigin = (href) => {
    try { return new URL(href, location.href).origin === location.origin; }
    catch (e) { return false; }
  };
  const skip = (h) => /\\.(pdf|xlsx?|csv|zip|doc|docx)$/i.test(h)
                  || h.startsWith('#') || h.startsWith('mailto:') || h.startsWith('tel:');
  const links = new Set();
  document.querySelectorAll('a[href]').forEach(a => {
    const h = a.getAttribute('href') || '';
    if (!h || skip(h) || !sameOrigin(h)) return;
    try {
      const u = new URL(h, location.href);
      links.add(u.pathname + u.search);
    } catch (e) {}
  });
  return Array.from(links);
})()`;

const PROBE_CHANGES = `(prevSnapshot) => {
  const isVisible = (el) => {
    const cs = window.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden'
        && el.getAttribute('aria-hidden') !== 'true' && el.offsetParent !== null;
  };
  const sel = 'input,select,textarea,kendo-dropdownlist,kendo-combobox,kendo-datepicker,mat-select,mat-checkbox,mat-radio-group';
  const now = {};
  document.querySelectorAll(sel).forEach(el => {
    const id = el.id || el.getAttribute('name') || el.getAttribute('formcontrolname');
    if (!id) return;
    now[id] = { visible: isVisible(el), disabled: el.disabled || el.hasAttribute('disabled'),
                required: el.required || el.getAttribute('aria-required') === 'true' };
  });
  const shows = [], hides = [], enables = [], disables = [];
  for (const k of Object.keys(now)) {
    const p = prevSnapshot[k];
    if (!p) { if (now[k].visible) shows.push(k); continue; }
    if (now[k].visible && !p.visible) shows.push(k);
    if (!now[k].visible && p.visible) hides.push(k);
    if (!now[k].disabled && p.disabled) enables.push(k);
    if (now[k].disabled && !p.disabled) disables.push(k);
  }
  for (const k of Object.keys(prevSnapshot)) {
    if (!(k in now) && prevSnapshot[k].visible) hides.push(k);
  }
  return { shows, hides, enables, disables, snapshot: now };
}`;

const SNAPSHOT_FIELD_STATES = `(() => {
  const sel = 'input,select,textarea,kendo-dropdownlist,kendo-combobox,kendo-datepicker,mat-select,mat-checkbox,mat-radio-group';
  const isVisible = (el) => {
    const cs = window.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden'
        && el.getAttribute('aria-hidden') !== 'true' && el.offsetParent !== null;
  };
  const out = {};
  document.querySelectorAll(sel).forEach(el => {
    const id = el.id || el.getAttribute('name') || el.getAttribute('formcontrolname');
    if (!id) return;
    out[id] = { visible: isVisible(el), disabled: el.disabled || el.hasAttribute('disabled'),
                required: el.required || el.getAttribute('aria-required') === 'true' };
  });
  return out;
})()`;

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function tool_oidc_login(args) {
  const {
    baseUrl, authType,
    loginPageTitle, usernameSelector, passwordSelector, submitSelector,
    postLoginUrlPattern,
    username, password,
    timeoutMs = 30000
  } = args;

  if (authType === 'none') {
    return { ok: true, skipped: true, reason: 'authType=none — nothing to do.' };
  }

  const ctx = await getContext({});
  const page = await getPage();
  await page.goto(baseUrl, { waitUntil: 'load', timeout: timeoutMs });

  // Follow up to 5 SSO redirects
  for (let i = 0; i < 5; i++) {
    if (postLoginUrlPattern && page.url().includes(postLoginUrlPattern)) {
      // Already authenticated
      return { ok: true, alreadyAuthenticated: true, finalUrl: page.url() };
    }
    if (loginPageTitle && (await page.title()).includes(loginPageTitle)) break;
    if (usernameSelector && await page.$(usernameSelector)) break;
    await page.waitForTimeout(1000);
  }

  // Username
  if (usernameSelector) {
    await page.waitForSelector(usernameSelector, { timeout: timeoutMs, state: 'visible' });
    await page.fill(usernameSelector, username);
  }

  // Password may be on same page or step-up
  let pwdSubmitted = false;
  if (passwordSelector) {
    const pwdVisible = await page.$(passwordSelector);
    if (pwdVisible) {
      await page.fill(passwordSelector, password);
      if (submitSelector) await page.click(submitSelector);
      pwdSubmitted = true;
    } else if (submitSelector) {
      // Step-up flow: submit user, wait for password page
      await page.click(submitSelector);
      await page.waitForSelector(passwordSelector, { timeout: timeoutMs, state: 'visible' });
      await page.fill(passwordSelector, password);
      await page.click(submitSelector);
      pwdSubmitted = true;
    }
  }

  // Detect MFA after submit
  await page.waitForLoadState('domcontentloaded');
  const bodyHtml = (await page.content()).toLowerCase();
  if (/mfa|otp|verification code|two[- ]factor|authenticator/.test(bodyHtml)) {
    return { ok: false, error: 'MFA challenge detected. Use a service account without MFA or a bypass policy.' };
  }

  // Wait for post-login indicator
  if (postLoginUrlPattern) {
    await page.waitForURL(`**${postLoginUrlPattern}**`, { timeout: timeoutMs }).catch(() => {});
  }
  return { ok: pwdSubmitted, finalUrl: page.url() };
}

async function tool_save_storage_state(args) {
  const { outPath } = args;
  if (!_context) throw new Error('No browser context. Call mcp_oidc_login first or open a page.');
  const state = await _context.storageState();
  const dir = path.dirname(outPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(state, null, 2));
  const cookieCount = (state.cookies || []).length;
  const lsCount = (state.origins || []).reduce((n, o) => n + (o.localStorage || []).length, 0);
  return { ok: true, path: outPath, cookies: cookieCount, localStorageEntries: lsCount };
}

async function tool_capture_page_dom(args) {
  const { url, waitForSelector = 'body', timeoutMs = 30000, storageStatePath } = args;
  const page = await getPage({ storageStatePath });
  if (url) {
    await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
  }
  await page.waitForSelector(waitForSelector, { timeout: timeoutMs, state: 'visible' }).catch(() => {});
  const dom = await page.evaluate(EXTRACT_PAGE_DOM);
  return dom;
}

async function tool_extract_routes(args) {
  const { url, timeoutMs = 30000 } = args;
  const page = await getPage();
  if (url) await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
  const routes = await page.evaluate(EXTRACT_ROUTES);
  return { routes };
}

async function tool_probe_conditional(args) {
  const { url, formId, triggerFieldId, triggerValue, timeoutMs = 15000, storageStatePath } = args;
  const page = await getPage({ storageStatePath });
  if (url) await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });

  // Snapshot before
  const before = await page.evaluate(SNAPSHOT_FIELD_STATES);

  // Try multiple ways to set the trigger
  const hardCodedFns = [
    async () => { const sel = `#${triggerFieldId}`; await page.selectOption(sel, triggerValue); },
    async () => { const sel = `[name="${triggerFieldId}"]`; await page.selectOption(sel, triggerValue); },
    async () => { const sel = `kendo-dropdownlist[name="${triggerFieldId}"]`;
                  await page.click(sel);
                  await page.click(`.k-list-container .k-list-item:has-text("${triggerValue}")`); },
    async () => { const sel = `mat-select[formcontrolname="${triggerFieldId}"]`;
                  await page.click(sel);
                  await page.click(`.cdk-overlay-pane mat-option:has-text("${triggerValue}")`); },
  ];
  let setOk = false, setError = null;
  for (const fn of hardCodedFns) {
    try { await fn(); setOk = true; break; } catch (e) { setError = String(e); }
  }
  if (!setOk) return { ok: false, error: `Could not set trigger ${triggerFieldId}=${triggerValue}: ${setError}` };

  await page.waitForTimeout(300);

  // Diff
  const after = await page.evaluate(SNAPSHOT_FIELD_STATES);
  const shows = [], hides = [], enables = [], disables = [];
  for (const k of Object.keys(after)) {
    const p = before[k];
    if (!p) { if (after[k].visible) shows.push(k); continue; }
    if (after[k].visible && !p.visible) shows.push(k);
    if (!after[k].visible && p.visible) hides.push(k);
    if (!after[k].disabled && p.disabled) enables.push(k);
    if (after[k].disabled && !p.disabled) disables.push(k);
  }
  for (const k of Object.keys(before)) {
    if (!(k in after) && before[k].visible) hides.push(k);
  }
  return { ok: true, trigger: { fieldId: triggerFieldId, value: triggerValue },
           effect: { shows, hides, enables, disables } };
}

async function tool_pom_mine_locators(args) {
  const { projectPath, framework = 'auto' } = args;
  const exts = ['.ts', '.js', '.java', '.cs'];
  const skipDirs = new Set(['node_modules', 'vendor', 'bin', 'obj', 'target', 'build', 'dist', '.git']);
  const candidates = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { return; }
    for (const e of entries) {
      if (skipDirs.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (exts.includes(path.extname(e.name)) && /Page|PageObject/.test(e.name)) candidates.push(full);
    }
  }
  walk(projectPath);

  const STRATEGY_PATTERNS = [
    { re: /page\.getByTestId\(/g,                 strategy: 'data-testid', fw: 'playwright' },
    { re: /page\.getByRole\(/g,                   strategy: 'role',        fw: 'playwright' },
    { re: /page\.getByLabel\(/g,                  strategy: 'label',       fw: 'playwright' },
    { re: /page\.getByPlaceholder\(/g,            strategy: 'placeholder', fw: 'playwright' },
    { re: /page\.getByText\(/g,                   strategy: 'text',        fw: 'playwright' },
    { re: /page\.getByAltText\(/g,                strategy: 'alt',         fw: 'playwright' },
    { re: /page\.getByTitle\(/g,                  strategy: 'title',       fw: 'playwright' },
    { re: /page\.locator\(['"`]\[data-testid=/g,  strategy: 'data-testid', fw: 'playwright' },
    { re: /page\.locator\(['"`]\[aria-label=/g,   strategy: 'aria-label',  fw: 'playwright' },
    { re: /page\.locator\(['"`]\[name=/g,         strategy: 'name',        fw: 'playwright' },
    { re: /page\.locator\(['"`]#/g,               strategy: 'id',          fw: 'playwright' },
    { re: /page\.locator\(['"`]\/\//g,            strategy: 'xpath',       fw: 'playwright' },
    { re: /page\.locator\(/g,                     strategy: 'css',         fw: 'playwright' },
    { re: /By\.id\(|By\.Id\(/g,                   strategy: 'id',          fw: 'selenium' },
    { re: /By\.name\(|By\.Name\(/g,               strategy: 'name',        fw: 'selenium' },
    { re: /By\.cssSelector\(['"`]\[data-testid=|By\.CssSelector\(['"`]\[data-testid=/g, strategy: 'data-testid', fw: 'selenium' },
    { re: /By\.cssSelector\(['"`]\[aria-label=|By\.CssSelector\(['"`]\[aria-label=/g,   strategy: 'aria-label',  fw: 'selenium' },
    { re: /By\.cssSelector\(|By\.CssSelector\(/g, strategy: 'css',         fw: 'selenium' },
    { re: /By\.xpath\(|By\.XPath\(/g,             strategy: 'xpath',       fw: 'selenium' },
    { re: /By\.linkText\(|By\.partialLinkText\(/g,strategy: 'link-text',   fw: 'selenium' },
    { re: /By\.tagName\(/g,                       strategy: 'tag-name',    fw: 'selenium' },
    { re: /By\.className\(/g,                     strategy: 'class-name',  fw: 'selenium' },
    { re: /\$\(['"`]\[data-testid=/g,             strategy: 'data-testid', fw: 'webdriverio' },
    { re: /\$\(['"`]\[aria-label=/g,              strategy: 'aria-label',  fw: 'webdriverio' },
    { re: /\$\(['"`]\[name=/g,                    strategy: 'name',        fw: 'webdriverio' },
    { re: /\$\(['"`]#/g,                          strategy: 'id',          fw: 'webdriverio' },
    { re: /\$\(['"`]\/\//g,                       strategy: 'xpath',       fw: 'webdriverio' },
    { re: /\$\(/g,                                strategy: 'css',         fw: 'webdriverio' },
  ];

  const counts = {};
  let total = 0;
  let detectedFw = framework;
  for (const f of candidates) {
    let txt;
    try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
    if (detectedFw === 'auto') {
      if (/from ['"]@playwright\/test['"]/.test(txt)) detectedFw = 'playwright';
      else if (/import org\.openqa\.selenium/.test(txt)) detectedFw = 'selenium-java';
      else if (/using OpenQA\.Selenium/.test(txt)) detectedFw = 'selenium-dotnet';
      else if (/require\(['"]selenium-webdriver['"]\)/.test(txt)) detectedFw = 'selenium-js';
      else if (/browser\.\$\(/.test(txt)) detectedFw = 'webdriverio';
    }
    for (const p of STRATEGY_PATTERNS) {
      const m = txt.match(p.re);
      if (m) {
        counts[p.strategy] = (counts[p.strategy] || 0) + m.length;
        total += m.length;
      }
    }
  }
  const locatorStrategies = {};
  for (const k of Object.keys(counts)) {
    locatorStrategies[k] = { count: counts[k], percentage: total ? +(counts[k]/total*100).toFixed(1) : 0 };
  }
  return {
    scanId: 'scan-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5),
    schemaVersion: 1,
    scannedAt: new Date().toISOString(),
    project: {
      path: projectPath,
      framework: detectedFw === 'auto' ? 'unknown' : detectedFw,
      totalPomFiles: candidates.length,
      totalLocators: total
    },
    locatorStrategies,
    byControlType: {},
    byUiLibrary: {},
    interactionPatterns: [],
    fallbackChains: [],
    recommendations: [],
    rawLocators: []
  };
}

// ---------------------------------------------------------------------------
// tool_state_checkpoint — read/merge/write pipeline-state.json atomically.
// Replaces repeated "read state → update field → write state" sequences in
// every stage's per-page and completion checkpoints.
// ---------------------------------------------------------------------------
async function tool_state_checkpoint(args) {
  const { stateFilePath, stageKey, fields = {}, topLevel = {} } = args;
  const resolved = path.isAbsolute(stateFilePath)
    ? stateFilePath
    : path.join(process.cwd(), stateFilePath);
  let state = {};
  if (fs.existsSync(resolved)) {
    try { state = JSON.parse(fs.readFileSync(resolved, 'utf8')); } catch (e) { state = {}; }
  }
  // Apply top-level field overrides
  for (const [k, v] of Object.entries(topLevel)) {
    // Support dot-notation: "pipeline.mode" → state.pipeline.mode
    const parts = k.split('.');
    let obj = state;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]] || typeof obj[parts[i]] !== 'object') obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = v;
  }
  // Apply stage-level field overrides under stages.<stageKey>
  if (stageKey) {
    if (!state.stages) state.stages = {};
    if (!state.stages[stageKey]) state.stages[stageKey] = {};
    for (const [k, v] of Object.entries(fields)) {
      state.stages[stageKey][k] = v;
    }
  }
  const dir = path.dirname(resolved);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(state, null, 2));
  return {
    ok: true,
    stateFilePath: resolved,
    stageKey: stageKey || null,
    updatedStageFields: Object.keys(fields),
    updatedTopLevelPaths: Object.keys(topLevel)
  };
}

// ---------------------------------------------------------------------------
// tool_bootstrap_output — create output directory structure and seed / patch
// pipeline-state.json. Replaces the entire body of Stage 0.
// ---------------------------------------------------------------------------
async function tool_bootstrap_output(args) {
  const {
    workspaceRoot,
    pipelineMode = 'full',
    singleRoute = null,
    codegenMode = null,
    codegenRoute = null
  } = args;
  const dirs = [
    path.join(workspaceRoot, 'output'),
    path.join(workspaceRoot, 'output', 'logs'),
    path.join(workspaceRoot, 'output', 'pages'),
    path.join(workspaceRoot, 'output', 'test-cases')
  ];
  const created = [];
  for (const d of dirs) {
    fs.mkdirSync(d, { recursive: true });
    const keep = path.join(d, '.keep');
    if (!fs.existsSync(keep)) {
      fs.writeFileSync(keep, 'This file is intentional — it ensures the directory is tracked. Safe to ignore.\n');
      created.push(d);
    }
  }
  const stateFile = path.join(workspaceRoot, 'output', 'pipeline-state.json');
  let action;
  if (fs.existsSync(stateFile)) {
    // Patch existing state — preserve stage statuses and counters
    let existing = {};
    try { existing = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (e) { existing = {}; }
    if (!existing.pipeline) existing.pipeline = {};
    existing.pipeline.mode = pipelineMode;
    existing.pipeline.singleRoute = singleRoute;
    existing.pipeline.lastUpdated = new Date().toISOString();
    if (!existing.stages) existing.stages = {};
    if (!existing.stages.stage0) existing.stages.stage0 = {};
    existing.stages.stage0.status = 'completed';
    fs.writeFileSync(stateFile, JSON.stringify(existing, null, 2));
    action = 'patched';
  } else {
    // Seed fresh state
    const seed = {
      pipeline: {
        mode: pipelineMode,
        singleRoute,
        codegenMode,
        codegenRoute,
        lastUpdated: new Date().toISOString()
      },
      perRouteCodegen: {
        routesQueued: [],
        routesCompleted: [],
        lastRouteStarted: null
      },
      stages: {
        stage0: { status: 'completed' },
        stage1: { status: 'pending' },
        stage2: { status: 'pending' },
        stage3: { status: 'pending' },
        stage4: { status: 'pending' },
        stage5: { status: 'pending' },
        stage6: { status: 'pending' },
        stage7: { status: 'pending' },
        stage8: { status: 'pending' }
      },
      counters: {
        routesDiscovered: 0,
        routesCrawled: 0,
        testCasesGenerated: 0,
        dataFilesGenerated: 0,
        pomFilesGenerated: 0,
        specFilesGenerated: 0
      }
    };
    fs.writeFileSync(stateFile, JSON.stringify(seed, null, 2));
    action = 'created';
  }
  return {
    ok: true,
    action,
    stateFile,
    directoriesEnsured: dirs.map(d => path.relative(workspaceRoot, d)),
    newDirectories: created.map(d => path.relative(workspaceRoot, d))
  };
}

// ---------------------------------------------------------------------------
// tool_fingerprint_project — deterministically scan an existing project to
// detect tech stack, folder structure, naming conventions, and import style.
// Replaces Stage 1 Steps 1–4. Steps 5 (code style sampling) and 6 (auth
// pattern detection) still run in the LLM because they need judgment.
// ---------------------------------------------------------------------------
async function tool_fingerprint_project(args) {
  const { projectPath } = args;
  const skipDirs = new Set(['node_modules', '.git', 'bin', 'obj', 'target', 'build', 'dist', 'vendor', '.vscode', '.idea']);

  // --- Tech stack detection from package.json ---
  let techStack = 'unknown';
  let language = 'unknown';
  let testRunner = 'unknown';
  let importStyle = 'import';

  const pkgPath = path.join(projectPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps['@playwright/test']) {
        techStack = 'playwright-typescript'; language = 'typescript'; testRunner = '@playwright/test';
      } else if (deps['playwright']) {
        techStack = 'playwright-javascript'; language = 'javascript'; testRunner = '@playwright/test';
      } else if (deps['webdriverio'] || deps['@wdio/cli']) {
        techStack = 'webdriverio'; language = 'javascript'; testRunner = 'mocha';
      } else if (deps['selenium-webdriver']) {
        techStack = 'selenium-js'; language = 'javascript'; testRunner = 'mocha';
      }
      // Playwright: refine TS vs JS by tsconfig presence
      if (techStack.startsWith('playwright') && fs.existsSync(path.join(projectPath, 'tsconfig.json'))) {
        techStack = 'playwright-typescript'; language = 'typescript';
      } else if (techStack.startsWith('playwright') && language === 'typescript') {
        // already set
      } else if (techStack.startsWith('playwright')) {
        techStack = 'playwright-javascript'; language = 'javascript';
      }
    } catch (e) {}
  }

  // --- Java / .NET detection ---
  if (techStack === 'unknown') {
    if (fs.existsSync(path.join(projectPath, 'pom.xml')) || fs.existsSync(path.join(projectPath, 'build.gradle'))) {
      techStack = 'selenium-java'; language = 'java'; testRunner = 'testng'; importStyle = 'import';
    } else {
      try {
        const root = fs.readdirSync(projectPath);
        if (root.some(f => f.endsWith('.csproj') || f.endsWith('.sln'))) {
          techStack = 'selenium-dotnet'; language = 'csharp'; testRunner = 'nunit'; importStyle = 'using';
        }
      } catch (e) {}
    }
  }

  // --- Folder discovery ---
  const hints = { specs: null, pages: null, fixtures: null, data: null, helpers: null, auth: null, config: null };
  const specExtMap = {
    'playwright-typescript': '.spec.ts', 'playwright-javascript': '.spec.js',
    'selenium-java': 'Test.java', 'selenium-dotnet': 'Tests.cs',
    'selenium-js': '.test.js', 'webdriverio': '.spec.js'
  };
  const specExt = specExtMap[techStack] || '.spec.ts';

  function walkDir(dir, depth) {
    if (depth > 5) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (!e.isDirectory() || skipDirs.has(e.name)) continue;
      const full = path.join(dir, e.name);
      const rel = path.relative(projectPath, full);
      const lower = e.name.toLowerCase();
      if (!hints.specs && ['specs', 'tests', 'test', 'e2e', '__tests__'].includes(lower)) {
        try {
          if (fs.readdirSync(full).some(c => c.endsWith(specExt) || c.endsWith('.spec.ts') || c.endsWith('.spec.js'))) {
            hints.specs = rel + '/';
          }
        } catch (ex) {}
      }
      if (!hints.pages && ['pages', 'pageobjects', 'pom', 'page-objects'].includes(lower)) hints.pages = rel + '/';
      if (!hints.fixtures && ['fixtures', 'fixture'].includes(lower)) hints.fixtures = rel + '/';
      if (!hints.data && ['data', 'testdata', 'test-data'].includes(lower)) hints.data = rel + '/';
      if (!hints.helpers && ['helpers', 'utils', 'utilities'].includes(lower)) hints.helpers = rel + '/';
      if (!hints.config && ['config', 'configuration'].includes(lower)) hints.config = rel + '/';
      walkDir(full, depth + 1);
    }
  }
  walkDir(projectPath, 0);

  // Check for config files at root
  if (!hints.config) {
    const configFiles = ['playwright.config.ts', 'playwright.config.js', 'wdio.conf.js', 'nightwatch.conf.js'];
    const found = configFiles.find(f => fs.existsSync(path.join(projectPath, f)));
    if (found) hints.config = found;
  }

  // Import style detection from a sample spec file
  if (hints.specs) {
    try {
      const specDir = path.join(projectPath, hints.specs);
      const files = fs.readdirSync(specDir).filter(f => f.endsWith('.ts') || f.endsWith('.js')).slice(0, 1);
      if (files.length > 0) {
        const sample = fs.readFileSync(path.join(specDir, files[0]), 'utf8').slice(0, 600);
        if (/^import\s/m.test(sample)) importStyle = 'import';
        else if (/require\s*\(/.test(sample)) importStyle = 'require';
      }
    } catch (e) {}
  }

  const pomExt = language === 'typescript' ? '.ts' : language === 'java' ? '.java' : language === 'csharp' ? '.cs' : '.js';
  const ambiguities = Object.entries(hints).filter(([k, v]) => v === null && k !== 'auth').map(([k]) => k);

  return {
    detectedAt: new Date().toISOString(),
    projectPath,
    techStack,
    language,
    testRunner,
    importStyle,
    folders: hints,
    conventions: {
      specNamingPattern: '*' + specExt,
      pomNamingPattern: '*Page' + pomExt,
      dataFileSuffix: language === 'typescript' ? '.data.ts' : language === 'java' ? 'TestData.java' : language === 'csharp' ? 'TestData.cs' : '.data.js',
      testIdPrefix: 'TC-',
      classStyle: 'PascalCase',
      methodStyle: 'camelCase'
    },
    ambiguities,
    _note: 'Steps 5 (code style sampling) and 6 (auth pattern) are not covered by this tool — the LLM must complete them to fill styleSamples and auth fields.'
  };
}

// ---------------------------------------------------------------------------
// tool_scan_spec_coverage — read spec files one at a time and extract signals
// for the coverage gap report. Replaces Stage 8 Step 0 inner scan loop.
// ---------------------------------------------------------------------------
async function tool_scan_spec_coverage(args) {
  const { specFiles } = args;
  const TC_ID_RE = /TC-[A-Z]+-\d+/g;
  const TEST_NAME_RES = [
    /(?:^|\s)(?:test|it)\s*\(\s*['"`]([^'"`\n]+)['"`]/gm,
    /@DisplayName\s*\(\s*"([^"]+)"\s*\)/g,
    /\[Description\s*\(\s*"([^"]+)"\s*\)\]/g
  ];
  const RAW_SELECTOR_RES = [
    /page\.locator\s*\(/g,
    /By\.(?:cssSelector|CssSelector|xpath|XPath)\s*\(/g,
    /\$\s*\(\s*['"`][\/\.#\[]/g,
    /driver\.findElement\s*\(/g
  ];
  const HARDCODED_ASSERT_RE = /(?:expect|assert\.equal|Assert\.That|Assert\.Equal|Assert\.AreEqual)\s*\(\s*['"`][^'"`]{3,}['"`]/g;
  const CROSS_TEST_RE = /^(?:let|var)\s+\w+\s*=/gm;

  const byFile = {};
  for (const filePath of specFiles) {
    let content;
    try { content = fs.readFileSync(filePath, 'utf8'); } catch (e) {
      byFile[filePath] = { error: String(e) }; continue;
    }
    const testIds = [...new Set(content.match(TC_ID_RE) || [])];
    const testNames = [];
    for (const re of TEST_NAME_RES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(content)) !== null) testNames.push(m[1]);
    }
    const contentNoImports = content.replace(/^.*(?:import|require).*$/gm, '');
    let rawSelectorCount = 0;
    const rawSelectorSamples = [];
    for (const re of RAW_SELECTOR_RES) {
      re.lastIndex = 0;
      const matches = contentNoImports.match(re) || [];
      rawSelectorCount += matches.length;
      rawSelectorSamples.push(...matches.slice(0, 3));
    }
    const hardcoded = (content.match(HARDCODED_ASSERT_RE) || []).map(s => s.substring(0, 80));
    const crossTestRefs = (content.match(CROSS_TEST_RE) || []).map(s => s.trim().substring(0, 60));

    byFile[filePath] = {
      testIds,
      testNames: [...new Set(testNames)],
      rawSelectorCount,
      rawSelectorSamples: rawSelectorSamples.slice(0, 5),
      hardcodedAssertionCount: hardcoded.length,
      hardcodedAssertionSamples: hardcoded.slice(0, 3),
      crossTestRefCount: crossTestRefs.length,
      qualityFlags: {
        hasDirectSelectors:      rawSelectorCount > 0,
        hasHardcodedAssertions:  hardcoded.length > 0,
        hasCrossTestState:       crossTestRefs.length > 0
      }
    };
  }
  return { byFile, totalFiles: specFiles.length };
}

// ---------------------------------------------------------------------------
// tool_compute_coverage_gaps — diff output/pages + output/test-cases against
// spec scan results. Replaces Stage 8 Steps 1–3 (coverage matrix, gap
// identification, unauthorized access audit). LLM still writes the narrative.
// ---------------------------------------------------------------------------
async function tool_compute_coverage_gaps(args) {
  const { pagesDir, testCasesDir, specCoverage = {} } = args;

  // Collect covered test IDs from spec scan
  const coveredIds = new Set();
  for (const fd of Object.values(specCoverage.byFile || {})) {
    if (Array.isArray(fd.testIds)) fd.testIds.forEach(id => coveredIds.add(id));
  }

  // Load all per-page test case files
  const pagesCoverage = {};
  let tcFiles = [];
  try { tcFiles = fs.readdirSync(testCasesDir).filter(f => f.endsWith('.json')); } catch (e) {}
  for (const tcFile of tcFiles) {
    const pageId = path.basename(tcFile, '.json');
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(testCasesDir, tcFile), 'utf8')); } catch (e) { continue; }
    const cases = data.testCases || [];
    const byType = {};
    const byCategory = {};
    cases.forEach(tc => {
      byType[tc.type] = (byType[tc.type] || 0) + 1;
      byCategory[tc.category] = (byCategory[tc.category] || 0) + 1;
    });
    const implementedIds = cases.filter(tc => coveredIds.has(tc.id)).map(tc => tc.id);
    const missingFromSpecs = cases.filter(tc => !coveredIds.has(tc.id)).map(tc => tc.id);
    pagesCoverage[pageId] = {
      url: data.url || pageId,
      totalTestCases: cases.length,
      byType, byCategory,
      implementedInSpecs: implementedIds.length,
      missingFromSpecs,
      hasSmoke: (byType['smoke'] || 0) > 0,
      hasValidation: !!byCategory['validation'] || !!byCategory['form-validation'],
      hasUnauthorizedTest: !!byCategory['unauthorized'] || !!byCategory['access-control']
    };
  }

  // Compare against DOM pages
  const gaps = [];
  let pgFiles = [];
  try { pgFiles = fs.readdirSync(pagesDir).filter(f => f.endsWith('.json')); } catch (e) {}
  for (const pf of pgFiles) {
    const pageId = path.basename(pf, '.json');
    let pgData;
    try { pgData = JSON.parse(fs.readFileSync(path.join(pagesDir, pf), 'utf8')); } catch (e) { continue; }
    const url = (pgData.metadata && pgData.metadata.url) || pageId;
    const pc = pagesCoverage[pageId];
    if (!pc) {
      gaps.push({ severity: 'critical', type: 'no-test-cases', pageId, url, detail: 'DOM detail exists but no test-cases file found.' });
      continue;
    }
    if (!pc.hasSmoke) gaps.push({ severity: 'high', type: 'no-smoke-test', pageId, url });
    if (!pc.hasValidation && (pgData.forms || []).length > 0)
      gaps.push({ severity: 'medium', type: 'no-form-validation-test', pageId, url });
    if (!pc.hasUnauthorizedTest)
      gaps.push({ severity: 'medium', type: 'no-unauthorized-test', pageId, url });
    if (pc.missingFromSpecs.length > 0)
      gaps.push({ severity: 'high', type: 'test-cases-not-implemented-in-specs', pageId, url, missingIds: pc.missingFromSpecs });
  }

  const totalPages = pgFiles.length;
  const pagesWithGaps = new Set(gaps.map(g => g.pageId)).size;
  const coveragePct = totalPages > 0 ? +((totalPages - pagesWithGaps) / totalPages * 100).toFixed(1) : 0;
  return {
    gaps,
    pagesCoverage,
    summary: {
      totalPages,
      pagesWithGaps,
      coveragePct,
      gapsBySeverity: {
        critical: gaps.filter(g => g.severity === 'critical').length,
        high:     gaps.filter(g => g.severity === 'high').length,
        medium:   gaps.filter(g => g.severity === 'medium').length
      }
    }
  };
}

// ---------------------------------------------------------------------------
// tool_build_data_index — read test-plan index + per-page test case files and
// return a dataFile → testCases[] map. Replaces Stage 5 Step 1 file I/O.
// ---------------------------------------------------------------------------
async function tool_build_data_index(args) {
  const { testPlanFile, workspaceRoot } = args;
  let testPlan;
  try { testPlan = JSON.parse(fs.readFileSync(testPlanFile, 'utf8')); }
  catch (e) { throw new Error(`Cannot read test-plan index at ${testPlanFile}: ${e.message}`); }

  const root = workspaceRoot || path.dirname(path.dirname(testPlanFile));
  const pages = testPlan.pages || [];
  const dataIndex = {};
  const pageIds = [];

  for (const page of pages) {
    // Resolve test-cases file path — stored as workspace-relative
    const tcFile = path.isAbsolute(page.testCasesFile)
      ? page.testCasesFile
      : path.join(root, page.testCasesFile);
    let tcData;
    try { tcData = JSON.parse(fs.readFileSync(tcFile, 'utf8')); } catch (e) { continue; }
    pageIds.push(page.pageId);
    for (const tc of (tcData.testCases || [])) {
      const df = tc.artifactRequirements && tc.artifactRequirements.dataFile;
      if (!df) continue;
      if (!dataIndex[df]) dataIndex[df] = [];
      dataIndex[df].push({
        tcId: tc.id,
        pageId: page.pageId,
        url: page.url,
        testDataRequirements: tc.testDataRequirements || {}
      });
    }
  }

  return {
    dataIndex,
    uniqueDataFiles: Object.keys(dataIndex),
    totalDataFiles: Object.keys(dataIndex).length,
    pageIds,
    totalPages: pageIds.length
  };
}

// ---------------------------------------------------------------------------
// MCP protocol layer (JSON-RPC 2.0 over stdio, newline-delimited)
// ---------------------------------------------------------------------------
const TOOLS = {
  mcp_oidc_login: {
    description: 'Run a full OIDC / Ping / basic auth login flow and leave the browser context authenticated. Replaces 8-15 individual browser_* calls per Stage 2 run.',
    inputSchema: {
      type: 'object',
      required: ['baseUrl', 'authType'],
      properties: {
        baseUrl:               { type: 'string' },
        authType:              { type: 'string', enum: ['oidc-ping-pkce','oidc-ping','oidc-standard','basic','none'] },
        loginPageTitle:        { type: 'string' },
        usernameSelector:      { type: 'string' },
        passwordSelector:      { type: 'string' },
        submitSelector:        { type: 'string' },
        postLoginUrlPattern:   { type: 'string' },
        username:              { type: 'string' },
        password:              { type: 'string' },
        timeoutMs:             { type: 'integer', default: 30000 }
      }
    },
    handler: tool_oidc_login
  },
  mcp_save_storage_state: {
    description: 'Save the current browser context as a Playwright-format storageState.json. Run AFTER mcp_oidc_login.',
    inputSchema: {
      type: 'object', required: ['outPath'],
      properties: { outPath: { type: 'string', description: 'Absolute or workspace-relative path to write.' } }
    },
    handler: tool_save_storage_state
  },
  mcp_capture_page_dom: {
    description: 'Navigate to URL (if given), then capture page metadata, forms, fields (with hidden + Kendo/Material detection), buttons, tables, modals, error containers, and navigation in ONE structured response. Replaces the 6 browser_evaluate scripts in Stage 3 sub-steps 3a-3h.',
    inputSchema: {
      type: 'object',
      properties: {
        url:                { type: 'string' },
        waitForSelector:    { type: 'string', default: 'body' },
        timeoutMs:          { type: 'integer', default: 30000 },
        storageStatePath:   { type: 'string', description: 'Optional — load this storage state into the context.' }
      }
    },
    handler: tool_capture_page_dom
  },
  mcp_extract_routes: {
    description: 'Return all unique same-origin route paths reachable from the current (or given) URL. Replaces the route-discovery JS in Stage 3 Step 2.',
    inputSchema: {
      type: 'object',
      properties: {
        url:        { type: 'string' },
        timeoutMs:  { type: 'integer', default: 30000 }
      }
    },
    handler: tool_extract_routes
  },
  mcp_probe_conditional: {
    description: 'Set one trigger field to a given value and return the deltas (fields that became visible/hidden/enabled/disabled). Tries native, Kendo dropdown, and Material select strategies in order.',
    inputSchema: {
      type: 'object',
      required: ['triggerFieldId', 'triggerValue'],
      properties: {
        url:               { type: 'string' },
        formId:            { type: 'string' },
        triggerFieldId:    { type: 'string' },
        triggerValue:      { type: 'string' },
        timeoutMs:         { type: 'integer', default: 15000 },
        storageStatePath:  { type: 'string' }
      }
    },
    handler: tool_probe_conditional
  },
  mcp_pom_mine_locators: {
    description: 'Walk a project directory, scan POM-shaped files, and return the locator-learning JSON aggregate. Replaces the miner utility prompts per-file extraction loop with one deterministic call.',
    inputSchema: {
      type: 'object',
      required: ['projectPath'],
      properties: {
        projectPath: { type: 'string' },
        framework:   { type: 'string', default: 'auto' }
      }
    },
    handler: tool_pom_mine_locators
  },
  mcp_state_checkpoint: {
    description: 'Atomically read, merge, and write output/pipeline-state.json. Use instead of read_file + replace_string_in_file for every per-page and completion checkpoint across all stages.',
    inputSchema: {
      type: 'object',
      required: ['stateFilePath'],
      properties: {
        stateFilePath: { type: 'string', description: 'Absolute or workspace-relative path to pipeline-state.json.' },
        stageKey: { type: 'string', description: 'e.g. "stage3". Fields are written under stages.<stageKey>.' },
        fields: { type: 'object', description: 'Key-value pairs to set under stages.<stageKey>. Supports any field (status, lastCompletedRoute, etc.).' },
        topLevel: { type: 'object', description: 'Key-value pairs to set at the top level (supports dot-notation: "pipeline.mode", "counters.routesCrawled").' }
      }
    },
    handler: tool_state_checkpoint
  },
  mcp_bootstrap_output: {
    description: 'Create the output/ directory structure and seed (or patch) pipeline-state.json. Replaces the entire body of Stage 0.',
    inputSchema: {
      type: 'object',
      required: ['workspaceRoot'],
      properties: {
        workspaceRoot:  { type: 'string', description: 'Absolute path to workspace root.' },
        pipelineMode:   { type: 'string', enum: ['full', 'single-route'], default: 'full' },
        singleRoute:    { type: 'string', default: null },
        codegenMode:    { type: 'string', default: null },
        codegenRoute:   { type: 'string', default: null }
      }
    },
    handler: tool_bootstrap_output
  },
  mcp_fingerprint_project: {
    description: 'Scan an existing project to detect tech stack, folder structure, naming conventions, and import style. Replaces Stage 1 Steps 1–4. LLM still completes Steps 5–6 (code style, auth pattern).',
    inputSchema: {
      type: 'object',
      required: ['projectPath'],
      properties: {
        projectPath: { type: 'string', description: 'Absolute path to the project root.' }
      }
    },
    handler: tool_fingerprint_project
  },
  mcp_scan_spec_coverage: {
    description: 'Read spec files one at a time and extract test IDs, test names, raw selector usage, hardcoded assertion counts, and cross-test state signals. Replaces Stage 8 Step 0 inner file-scan loop.',
    inputSchema: {
      type: 'object',
      required: ['specFiles'],
      properties: {
        specFiles: { type: 'array', items: { type: 'string' }, description: 'Absolute paths to spec files to scan.' }
      }
    },
    handler: tool_scan_spec_coverage
  },
  mcp_compute_coverage_gaps: {
    description: 'Diff output/pages/*.json and output/test-cases/*.json against spec scan results to produce a structured gap list. Replaces Stage 8 Steps 1–3.',
    inputSchema: {
      type: 'object',
      required: ['pagesDir', 'testCasesDir'],
      properties: {
        pagesDir:     { type: 'string', description: 'Absolute path to output/pages/ directory.' },
        testCasesDir: { type: 'string', description: 'Absolute path to output/test-cases/ directory.' },
        specCoverage: { type: 'object', description: 'Result object from mcp_scan_spec_coverage (optional — gaps computed without spec data if omitted).' }
      }
    },
    handler: tool_compute_coverage_gaps
  },
  mcp_build_data_index: {
    description: 'Read the test-plan index and all per-page test-case files to build a dataFile → testCases[] map. Replaces Stage 5 Step 1 I/O loop.',
    inputSchema: {
      type: 'object',
      required: ['testPlanFile'],
      properties: {
        testPlanFile:  { type: 'string', description: 'Absolute or workspace-relative path to output/test-plan.json.' },
        workspaceRoot: { type: 'string', description: 'Absolute path to workspace root (used to resolve relative testCasesFile paths).' }
      }
    },
    handler: tool_build_data_index
  }
};

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}
function replyError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

async function dispatch(req) {
  const { id, method, params } = req;
  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'autotestgen-mcp', version: '0.1.0' }
    });
  }
  if (method === 'tools/list') {
    return reply(id, {
      tools: Object.entries(TOOLS).map(([name, t]) => ({
        name, description: t.description, inputSchema: t.inputSchema
      }))
    });
  }
  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    const tool = TOOLS[name];
    if (!tool) return replyError(id, -32601, `Unknown tool: ${name}`);
    try {
      const result = await tool.handler(args);
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
    } catch (e) {
      return replyError(id, -32000, `Tool ${name} failed: ${e && e.stack || e}`);
    }
  }
  if (method === 'shutdown') {
    await closeAll();
    return reply(id, {});
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return; // notifications have no id / response
  }
  if (id !== undefined) replyError(id, -32601, `Unknown method: ${method}`);
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try { req = JSON.parse(trimmed); }
  catch (e) { return; }
  Promise.resolve(dispatch(req)).catch((err) => {
    if (req && req.id !== undefined) replyError(req.id, -32603, String(err));
  });
});

process.on('SIGINT',  () => { closeAll().finally(() => process.exit(0)); });
process.on('SIGTERM', () => { closeAll().finally(() => process.exit(0)); });
