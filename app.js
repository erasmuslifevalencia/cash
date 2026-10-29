/* ELV Cash — app for the Erasmus Life Valencia office: cash receipts, back office check, till.
 * Talks to the "ELV Cash Receipts" Google Apps Script with the person's Google sign-in. */
(function () {
'use strict';
var CFG = window.ELV_CASH || {};
var $ = function (id) { return document.getElementById(id); };
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var num = function (v) { var n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : 0; };
var r2 = function (n) { return Math.round(n * 100) / 100; };
var eur = function (n) { return new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }).format(r2(+n || 0)) + ' €'; };
var dmy = function (iso) { return iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : ''; };
var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function longDay(iso) { var d = new Date(iso + 'T12:00:00'); return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
function shortDay(iso) { var d = new Date(iso + 'T12:00:00'); return DAYS[d.getDay()].slice(0, 3) + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; }
function addDays(iso, n) { var d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k) || ''; localStorage.setItem(k, v); } catch (e) { return ''; } }
function toast(msg) { var t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3200); }
function fold(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

var ICON = {
  receipt: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"></path><path d="M9 8h6M9 12h6"></path></svg>',
  day: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M3 10h18M8 3v4M16 3v4"></path></svg>',
  till: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="10" width="18" height="11" rx="2"></rect><path d="M7 10V6h10v4M7 15h2M11 15h2M15 15h2"></path></svg>',
  search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5F6170" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>',
  print: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6"></path><rect x="3" y="9" width="18" height="8" rx="2"></rect><path d="M6 14h12v7H6z"></path></svg>'
};

/* ---------------- state ---------------- */
var S = {
  view: 'new', boot: null, products: [], groups: [],
  form: { customer: '', by: '', lines: [], note: '', bo: false, q: '' },
  saved: null, day: '', dayData: null, pendingOnly: false, search: '', till: null, pending: 0
};

/* ---------------- Google sign-in ---------------- */
var ID = { token: '', exp: 0, email: '', waiting: [] };
try { var kept = JSON.parse(ls('elvcash-id') || 'null'); if (kept && kept.exp * 1000 > Date.now() + 120000) { ID.token = kept.token; ID.exp = kept.exp; ID.email = kept.email; } } catch (e) {}
function jwtBody(t) { try { return JSON.parse(decodeURIComponent(escape(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); } catch (e) { return {}; } }
function onCredential(resp) {
  var b = jwtBody(resp.credential || '');
  ID.token = resp.credential || ''; ID.exp = Number(b.exp) || 0; ID.email = String(b.email || '');
  ls('elvcash-id', JSON.stringify({ token: ID.token, exp: ID.exp, email: ID.email }));
  var w = ID.waiting; ID.waiting = []; w.forEach(function (f) { f(ID.token); });
  if (S.gate) { S.gate = null; start(); }
}
function gis() {
  return new Promise(function (resolve) {
    (function wait(n) {
      if (window.google && google.accounts && google.accounts.id) {
        if (!gis.ready) {
          gis.ready = true;
          google.accounts.id.initialize({ client_id: CFG.clientId, callback: onCredential, auto_select: true,
            cancel_on_tap_outside: false, use_fedcm_for_prompt: true, itp_support: true });
        }
        resolve(google.accounts.id);
      } else if (n < 100) setTimeout(function () { wait(n + 1); }, 100);
      else resolve(null);
    })(0);
  });
}
function idToken() {
  if (ID.token && ID.exp * 1000 > Date.now() + 60000) return Promise.resolve(ID.token);
  return new Promise(function (resolve) {
    ID.waiting.push(resolve);
    gis().then(function (g) {
      if (!g) { showGate('signin'); return; }
      g.prompt(function (n) { if ((n.isNotDisplayed && n.isNotDisplayed()) || (n.isSkippedMoment && n.isSkippedMoment())) showGate('signin'); });
    });
  });
}
function signOut() {
  ls('elvcash-id', ''); ID.token = ''; ID.exp = 0; ID.email = '';
  if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
  S.boot = null; showGate('signin');
}

/* ---------------- talking to the script ---------------- */
function api(fn, args, tries) {
  tries = tries || 0;
  return idToken().then(function (tok) {
    return fetch(CFG.api, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: fn, args: args || [], idToken: tok }) });
  }).then(function (r) { if (!r.ok) throw new Error('net'); return r.json(); })
    .then(function (d) {
      if (d && d.ok) return d.data;
      if (d && d.error === 'signin' && tries < 1) { ID.token = ''; ID.exp = 0; ls('elvcash-id', ''); return api(fn, args, tries + 1); }
      if (d && d.error === 'access') { showGate('access', d.email); throw new Error('access'); }
      throw new Error((d && d.error) || 'Something went wrong.');
    })
    .catch(function (e) {
      if (e && (e.message === 'net' || e.name === 'TypeError')) throw new Error('No connection to the server. Check the internet and try again.');
      throw e;
    });
}

/* ---------------- gate (sign-in / no access) ---------------- */
function showGate(kind, email) {
  S.gate = kind;
  var setup = !CFG.clientId;
  $('app').innerHTML = '<div class="gate"><div class="box"><img src="icons/logo.png" alt="Erasmus Life">' +
    '<div><h1>ELV Cash</h1><p style="margin-top:6px">Cash receipts and till of the Erasmus Life office</p></div>' +
    (setup ? '<p class="err">The Google sign-in is not set up yet (client ID missing in config.js).</p>' :
      kind === 'access'
        ? '<p class="err">' + esc(email || ID.email) + ' cannot open ELV Cash.</p><p>Ask Corentin to add this Google account to the team.</p><button class="ghost" id="other" type="button">Use another account</button>'
        : '<div id="gbtn"></div><p style="font-size:13px">Only the team’s Google accounts can open the till.</p>') +
    '</div></div>';
  if (setup) return;
  if (kind === 'access') { $('other').onclick = signOut; return; }
  gis().then(function (g) { if (g && $('gbtn')) g.renderButton($('gbtn'), { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 280 }); });
}

/* ---------------- start ---------------- */
function start() {
  if (!CFG.clientId) { showGate('signin'); return; }
  $('app').innerHTML = '<div class="loading">Loading ELV Cash…</div>';
  api('init', []).then(function (d) {
    S.boot = d; S.products = d.products; buildGroups(); S.day = d.today;
    var last = ls('elvcash-by');
    S.form.by = d.employees.indexOf(d.user.name) >= 0 ? d.user.name : (d.employees.indexOf(last) >= 0 ? last : '');
    renderShell(); go(S.view);
    refreshPending();
  }).catch(function (e) { if (e.message !== 'access') { $('app').innerHTML = '<div class="loading"><div style="text-align:center"><p class="err">' + esc(e.message) + '</p><button class="ghost" id="retry" type="button">Try again</button></div></div>'; $('retry').onclick = start; } });
}

/* ---------------- shell ---------------- */
function renderShell() {
  var u = S.boot.user, init = (u.name || u.email || '?').charAt(0).toUpperCase();
  var nav = function (v, label, icon) { return '<button type="button" class="nav" data-go="' + v + '">' + ICON[icon] + label + (v === 'today' ? '<span class="badge" data-badge hidden></span>' : '') + '</button>'; };
  $('app').innerHTML =
    '<div class="mobilehead"><img src="icons/logo.png" alt=""><b id="mtitle">ELV Cash</b><button type="button" class="av" id="mav" aria-label="Account">' + esc(init) + '</button></div>' +
    '<div class="shell"><nav class="side" aria-label="Main">' +
      '<div class="brand"><img src="icons/logo.png" alt="Erasmus Life"><div><b>ELV Cash</b><span>Erasmus Life Valencia</span></div></div>' +
      nav('new', 'New receipt', 'receipt') + nav('today', 'Today', 'day') + nav('till', 'Till', 'till') +
      '<div class="me"><div class="av">' + esc(init) + '</div><div class="who"><b>' + esc(u.name || u.email) + '</b><span>' + esc(u.email) + '</span><button type="button" class="linkbtn" id="out">Sign out</button></div></div>' +
    '</nav><main class="work" id="work"></main></div>' +
    '<nav class="bottom" aria-label="Main">' +
      '<button type="button" data-go="new">' + ICON.receipt + 'New</button>' +
      '<button type="button" data-go="today">' + ICON.day + 'Today<span class="badge" data-badge hidden></span></button>' +
      '<button type="button" data-go="till">' + ICON.till + 'Till</button></nav>';
  Array.prototype.forEach.call(document.querySelectorAll('[data-go]'), function (b) { b.onclick = function () { go(b.getAttribute('data-go')); }; });
  $('out').onclick = signOut;
  $('mav').onclick = function () { ask('Signed in as ' + (u.email || ''), '', 'Sign out', 'Close').then(function (ok) { if (ok) signOut(); }); };
}
function go(v) {
  S.view = v;
  Array.prototype.forEach.call(document.querySelectorAll('[data-go]'), function (b) { b.classList.toggle('on', b.getAttribute('data-go') === v); });
  if ($('mtitle')) $('mtitle').textContent = { new: 'New receipt', today: 'Today', till: 'Till' }[v];
  window.scrollTo(0, 0);
  if (v === 'new') viewNew(); else if (v === 'today') viewToday(); else viewTill();
}
function setBadge(n) {
  S.pending = n;
  Array.prototype.forEach.call(document.querySelectorAll('[data-badge]'), function (b) { b.textContent = n; b.hidden = !n; });
}
function refreshPending() { api('list', [{ pending: true }]).then(function (d) { setBadge(d.pendingCount || 0); }).catch(function () {}); }

/* ---------------- dialogs ---------------- */
function ask(title, text, okLabel, cancelLabel, input) {
  return new Promise(function (resolve) {
    var d = $('dlg');
    d.innerHTML = '<form class="dlg" method="dialog"><h2>' + esc(title) + '</h2>' + (text ? '<p class="muted" style="margin:0">' + esc(text) + '</p>' : '') +
      (input ? '<label class="lbl">' + esc(input) + '<input class="inp" id="dlgIn" autocomplete="off" required></label>' : '') +
      '<div class="btns"><button class="ghost" value="no" type="submit">' + esc(cancelLabel || 'Cancel') + '</button><button class="primary" style="padding:12px 18px" value="yes" type="submit">' + esc(okLabel || 'OK') + '</button></div></form>';
    d.onclose = function () { var ok = d.returnValue === 'yes'; resolve(input ? (ok ? ($('dlgIn').value || '').trim() : null) : ok); };
    if (input) $('dlgIn').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !this.value.trim()) e.preventDefault(); });
    d.returnValue = ''; d.showModal(); if (input) $('dlgIn').focus();
  });
}

/* ---------------- items (search + prices) ---------------- */
function buildGroups() {
  var map = {}; S.groups = [];
  var today = S.boot.today;
  S.products.forEach(function (p, i) {
    var g = map[p.category]; if (!g) { g = map[p.category] = { name: p.category || 'Items', items: [] }; S.groups.push(g); }
    var short = p.item.indexOf(p.category + ' – ') === 0 ? p.item.slice(p.category.length + 3) : p.item;
    var promo = /promo/i.test(p.item);
    g.items.push({ i: i, short: short, price: p.price, promo: promo, over: promo && p.promoUntil && today > p.promoUntil, until: p.promoUntil });
  });
  var rank = function (t) { t = t.toLowerCase(); return /classic/.test(t) && !/promo/.test(t) ? 0 : /premium/.test(t) && !/promo/.test(t) ? 1 : /classic/.test(t) ? 2 : /premium/.test(t) ? 3 : 4; };
  S.groups.forEach(function (g) { g.items.sort(function (a, b) { return rank(a.short) - rank(b.short); }); g.key = fold(g.name + ' ' + g.items.map(function (x) { return x.short; }).join(' ')); });
}
function drawResults() {
  var q = fold(S.form.q.trim()), words = q.split(/\s+/).filter(String), box = $('results');
  if (!box) return;
  var hits = q ? S.groups.filter(function (g) { return words.every(function (w) { return g.key.indexOf(w) >= 0; }); })
    : S.groups.filter(function (g) { return /card|sim/i.test(g.name); });
  box.innerHTML = (hits.length ? hits.slice(0, 12).map(function (g) {
    var nameHit = words.every(function (w) { return fold(g.name).indexOf(w) >= 0; });
    var items = nameHit || !q ? g.items : g.items.filter(function (x) { return words.some(function (w) { return fold(x.short).indexOf(w) >= 0; }); });
    if (!items.length) items = g.items;
    return '<div class="grp"><b>' + esc(g.name) + '</b><div class="chips">' + items.map(function (x) {
      return '<button type="button" class="price' + (x.promo ? ' promo' : '') + '" data-p="' + x.i + '"' + (x.over ? ' disabled title="Promo ended ' + esc(dmy(x.until)) + '"' : '') + '>' +
        esc(x.short) + '<span>' + (x.price ? eur(x.price) : 'type price') + '</span></button>';
    }).join('') + '</div></div>';
  }).join('') : '<div class="grp"><span class="muted">Nothing found. Use “Add a line” and type it.</span></div>') +
    (q ? '' : '<div class="hint">Type a trip, a card or a SIM to see its prices. Deposit or remaining payment: choose it and type the amount.</div>');
  Array.prototype.forEach.call(box.querySelectorAll('[data-p]'), function (b) { b.onclick = function () { var p = S.products[+b.getAttribute('data-p')]; addLine(p.item, p.price || ''); S.form.q = ''; $('q').value = ''; drawResults(); }; });
}
function addLine(concept, unit) { S.form.lines.push({ concept: concept || '', qty: 1, unit: unit === undefined ? '' : String(unit).replace('.', ',') }); drawLines(true); }
function total() { return r2(S.form.lines.reduce(function (a, l) { return a + Math.max(1, Math.round(num(l.qty)) || 1) * num(l.unit); }, 0)); }
function drawLines(focusLast) {
  var box = $('lines'); if (!box) return;
  box.innerHTML = S.form.lines.length ? '<div class="line muted" style="font-size:12px;padding:0 0 4px;border:0"><span>What</span><span style="text-align:right">Qty</span><span style="text-align:right">Price €</span><span></span></div>' +
    S.form.lines.map(function (l, i) {
      return '<div class="line">' + (l.free ? '<input class="inp" style="font-size:15px;padding:8px;text-align:left;font-family:var(--body)" data-c="' + i + '" value="' + esc(l.concept) + '" placeholder="What is paid">' : '<div class="name">' + esc(l.concept) + '</div>') +
        '<input inputmode="numeric" aria-label="Quantity" data-q="' + i + '" value="' + esc(l.qty) + '">' +
        '<input inputmode="decimal" aria-label="Price in euros" data-u="' + i + '" value="' + esc(l.unit) + '" placeholder="0,00">' +
        '<button type="button" class="x" aria-label="Remove ' + esc(l.concept || 'line') + '" data-rm="' + i + '">×</button></div>';
    }).join('') : '<p class="empty">Nothing added yet. Search an item on the left.</p>';
  Array.prototype.forEach.call(box.querySelectorAll('[data-c]'), function (el) { el.oninput = function () { S.form.lines[+el.getAttribute('data-c')].concept = el.value; }; });
  Array.prototype.forEach.call(box.querySelectorAll('[data-q]'), function (el) { el.oninput = function () { S.form.lines[+el.getAttribute('data-q')].qty = el.value; drawTotal(); }; });
  Array.prototype.forEach.call(box.querySelectorAll('[data-u]'), function (el) { el.oninput = function () { S.form.lines[+el.getAttribute('data-u')].unit = el.value; drawTotal(); }; });
  Array.prototype.forEach.call(box.querySelectorAll('[data-rm]'), function (el) { el.onclick = function () { S.form.lines.splice(+el.getAttribute('data-rm'), 1); drawLines(); }; });
  drawTotal();
  if (focusLast && S.form.lines.length) {
    var l = S.form.lines[S.form.lines.length - 1], sel = l.free ? '[data-c]' : (num(l.unit) ? null : '[data-u]');
    if (sel) { var els = box.querySelectorAll(sel); if (els.length) els[els.length - 1].focus(); }
  }
}
function drawTotal() { if ($('tot')) $('tot').textContent = eur(total()); if ($('rcName')) $('rcName').textContent = S.form.customer; }

/* ---------------- New receipt ---------------- */
function viewNew() {
  var f = S.form, b = S.boot;
  if (S.saved) return viewSaved();
  $('work').innerHTML =
    '<header class="top"><div><h1>New receipt</h1><p>' + esc(longDay(b.today)) + ' · cash payment at the office</p></div><span class="pill">Next nº ' + esc(b.nextNo) + '</span></header>' +
    '<div class="cols"><section class="card col-main">' +
      '<label class="lbl">Customer name<input class="inp" id="cust" autocomplete="off" placeholder="First name LAST NAME" value="' + esc(f.customer) + '"></label>' +
      '<div class="lbl">Received by<div class="chips" id="byChips">' + b.employees.map(function (e) { return '<button type="button" class="who-chip' + (e === f.by ? ' on' : '') + '" data-by="' + esc(e) + '">' + esc(e) + '</button>'; }).join('') + '</div></div>' +
      '<div class="lbl"><label for="q">Add what is paid</label><div class="search">' + ICON.search + '<input id="q" autocomplete="off" placeholder="Search a trip, card, SIM… (e.g. moro, sim, gold)" value="' + esc(f.q) + '"></div>' +
        '<div class="results" id="results"></div>' +
        '<div><button type="button" class="ghost sm" id="free">+ Add a line by hand</button></div></div>' +
      '<label class="lbl">Internal note (not printed)<input class="inp" id="note" autocomplete="off" placeholder="Optional" value="' + esc(f.note) + '"></label>' +
    '</section>' +
    '<aside class="card col-side"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px"><h2>Receipt</h2><span class="muted" style="font-size:13px" id="rcName">' + esc(f.customer) + '</span></div>' +
      '<div id="lines"></div>' +
      '<div class="total"><b>Total cash</b><span class="mono" id="tot">0,00 €</span></div>' +
      '<label class="bo' + (f.bo ? ' ok' : '') + '" id="boBox"><input type="checkbox" id="bo"' + (f.bo ? ' checked' : '') + '><span><b>Validated in the back office</b><br><span class="muted">Required. Validate the payment on erasmus-valencia.com first.</span></span></label>' +
      '<p class="err" id="err" hidden></p>' +
      '<button type="button" class="primary" id="save">' + ICON.print + 'Save &amp; print</button>' +
      '<p class="muted" style="margin:0;font-size:13px;text-align:center">Prints the customer copy and the office copy on one A4 sheet.</p>' +
    '</aside></div>';
  $('cust').oninput = function () { f.customer = this.value; drawTotal(); };
  $('note').oninput = function () { f.note = this.value; };
  $('q').oninput = function () { f.q = this.value; drawResults(); };
  $('free').onclick = function () { S.form.lines.push({ concept: '', qty: 1, unit: '', free: true }); drawLines(true); };
  Array.prototype.forEach.call(document.querySelectorAll('[data-by]'), function (el) { el.onclick = function () { f.by = el.getAttribute('data-by'); ls('elvcash-by', f.by); Array.prototype.forEach.call(document.querySelectorAll('[data-by]'), function (x) { x.classList.toggle('on', x === el); }); }; });
  $('bo').onchange = function () { f.bo = this.checked; $('boBox').classList.toggle('ok', f.bo); $('boBox').classList.remove('need'); if (f.bo && /back office/.test($('err').textContent)) $('err').hidden = true; };
  $('save').onclick = save;
  drawResults(); drawLines();
  if (!f.customer) $('cust').focus();
}
function save() {
  var f = S.form, err = $('err');
  var lines = f.lines.map(function (l) { return { concept: (l.concept || '').trim(), qty: l.qty, unit: l.unit }; });
  var msg = !f.customer.trim() ? 'Write the customer name.' : !f.by ? 'Choose who received the money.' :
    !lines.some(function (l) { return l.concept && num(l.unit); }) ? 'Add at least one line with a price.' :
    lines.some(function (l) { return !l.concept && num(l.unit); }) ? 'Say what each line is for.' :
    !f.bo ? 'Validate the payment in the back office first, then tick “Validated in the back office”.' : '';
  $('boBox').classList.toggle('need', !f.bo && !!f.customer.trim());
  if (msg) { err.textContent = msg; err.hidden = false; return; }
  err.hidden = true;
  var btn = $('save'); btn.disabled = true; btn.textContent = 'Saving…';
  api('create', [{ customer: f.customer, by: f.by, note: f.note, boValidated: true, lines: lines }]).then(function (r) {
    S.saved = r; S.form = { customer: '', by: f.by, lines: [], note: '', bo: false, q: '' };
    S.boot.nextNo = nextNo(r.receiptNo);
    viewSaved(); printReceipt(r);
  }).catch(function (e) { btn.disabled = false; btn.innerHTML = ICON.print + 'Save &amp; print'; err.textContent = e.message; err.hidden = false; });
}
function nextNo(no) { var m = String(no).match(/^(.*-)(\d+)$/); return m ? m[1] + ('000' + (+m[2] + 1)).slice(-Math.max(4, m[2].length)) : ''; }
function viewSaved() {
  var r = S.saved;
  $('work').innerHTML = '<header class="top"><div><h1>Receipt ' + esc(r.receiptNo) + ' saved</h1><p>' + esc(r.customer) + ' · ' + eur(r.total) + ' in cash</p></div></header>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="primary" id="again" style="padding:13px 18px">' + ICON.print + 'Print again</button>' +
    '<button type="button" class="ghost" id="next">New receipt</button></div>' +
    '<p class="muted" style="margin:0">Give the customer copy, keep the office copy. On a phone, choose “Save as PDF” in the print window to send it.</p>' +
    '<div class="sheetwrap"><div id="sheet">' + sheetHtml(r) + '</div></div>';
  $('again').onclick = function () { printReceipt(r); };
  $('next').onclick = function () { S.saved = null; viewNew(); };
}

/* ---------------- receipt paper ---------------- */
function receiptHtml(r, copy) {
  var st = S.boot.settings;
  var d = dmy(r.date), time = (r.createdAt || '').slice(11, 16);
  var legal = [st.legalName, st.taxId ? 'CIF/NIF ' + st.taxId : '', st.address].filter(Boolean).join(' · ');
  var contact = [st.phone, st.email, st.website].filter(Boolean).join(' · ');
  var rows = (r.lines || []).map(function (l) { return '<tr><td>' + esc(l.concept) + '</td><td class="num">' + esc(l.qty) + '</td><td class="num">' + eur(l.unit) + '</td><td class="num">' + eur(l.amount) + '</td></tr>'; }).join('');
  return '<div class="rcpt">' + (r.void ? '<div class="stamp">ANULADO · VOID</div>' : '') +
    '<div class="rtop"><div><div class="rbrand"><img src="icons/logo.png" alt="">' + esc(st.businessName) + '</div><div class="legal">' + esc(legal) + '</div><div class="legal">' + esc(contact) + '</div></div>' +
    '<div class="rtitle"><h3>RECIBO · RECEIPT</h3><div class="rno">Nº ' + esc(r.receiptNo) + '</div><div class="legal">' + d + (time ? ' · ' + time : '') + '</div>' +
    (copy ? '<div class="copy">' + copy + '</div>' : '') + '</div></div>' +
    '<div class="rwho"><div><small>Recibido de · Received from</small><b>' + esc(r.customer) + '</b></div><div><small>Atendido por · Received by</small>' + esc(r.by) + '</div></div>' +
    '<table><thead><tr><th>Concepto · Concept</th><th class="num">Cant. · Qty</th><th class="num">Precio · Price</th><th class="num">Importe · Amount</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<div class="rtot"><span>TOTAL</span><span>' + eur(r.total) + '</span></div>' +
    '<div class="pay">Forma de pago · Payment method: <b>Efectivo · Cash</b> — Pagado · Paid</div>' +
    (r.void ? '<div class="pay" style="color:#c0392b">Anulado · Voided ' + esc(r.voidAt) + (r.voidReason ? ' — ' + esc(r.voidReason) : '') + '</div>' : '') +
    '<div class="sign"><span>Valencia, ' + d + '</span><span class="l">Firma · Signature</span></div>' +
    '<div class="foot">' + esc(st.footer) + '</div></div>';
}
function sheetHtml(r) { return S.boot.settings.twoCopies ? receiptHtml(r, 'Copia cliente · Customer copy') + receiptHtml(r, 'Copia oficina · Office copy') : receiptHtml(r, ''); }
function printReceipt(r) {
  var pa = $('printArea'); pa.innerHTML = sheetHtml(r);
  var imgs = pa.querySelectorAll('img'), left = imgs.length, done = false;
  var fire = function () { if (done) return; done = true; setTimeout(function () { window.print(); }, 50); };
  if (!left) return fire();
  Array.prototype.forEach.call(imgs, function (im) { if (im.complete) { if (--left === 0) fire(); } else im.onload = im.onerror = function () { if (--left === 0) fire(); }; });
  setTimeout(fire, 1500);
}

/* ---------------- Today ---------------- */
function viewToday() {
  $('work').innerHTML =
    '<header class="top"><div class="daynav"><button type="button" class="sq" id="prev" aria-label="Previous day">‹</button><h1 id="dayTitle"></h1>' +
    '<button type="button" class="sq" id="nextd" aria-label="Next day">›</button><input type="date" class="datepick" id="dpick" aria-label="Choose a day"></div>' +
    '<label class="search" style="flex:0 1 340px;min-width:0;border-width:1px">' + ICON.search + '<input id="find" aria-label="Search all receipts" placeholder="Search a name, a number, a trip…" style="padding:11px 0;font-size:15px"></label></header>' +
    '<div id="dayBox"><div class="loading" style="min-height:30vh">Loading…</div></div>';
  $('prev').onclick = function () { S.day = addDays(S.day, -1); S.search = ''; $('find').value = ''; loadDay(); };
  $('nextd').onclick = function () { S.day = addDays(S.day, 1); S.search = ''; $('find').value = ''; loadDay(); };
  $('dpick').onchange = function () { if (this.value) { S.day = this.value; S.search = ''; $('find').value = ''; loadDay(); } };
  var tmr; $('find').value = S.search;
  $('find').oninput = function () { var v = this.value; clearTimeout(tmr); tmr = setTimeout(function () { S.search = v.trim(); S.pendingOnly = false; loadDay(); }, 350); };
  loadDay();
}
function loadDay() {
  if (!$('dayBox')) return;
  $('dayTitle').textContent = S.search ? 'Search' : S.pendingOnly ? 'To validate' : (S.day === S.boot.today ? 'Today · ' : '') + shortDay(S.day);
  $('dpick').value = S.day; $('nextd').disabled = S.day >= S.boot.today;
  api('list', [{ date: S.day, q: S.search, pending: S.pendingOnly }]).then(function (d) { S.dayData = d; setBadge(d.pendingCount || 0); drawDay(); })
    .catch(function (e) { $('dayBox').innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
}
function rowHtml(r, i) {
  var when = S.search || S.pendingOnly ? dmy(r.date) + ' ' + (r.createdAt || '').slice(11, 16) : (r.createdAt || '').slice(11, 16);
  var bo = r.void ? '' : r.boValidated
    ? '<button type="button" class="okchip" data-unbo="' + i + '" title="' + esc('Validated ' + (r.boValidatedAt || '') + (r.boValidatedBy ? ' by ' + r.boValidatedBy : '')) + '">✓ Back office</button>'
    : '<button type="button" class="todochip" data-bo="' + i + '">Mark validated</button>';
  return '<div class="row' + (r.void ? ' void' : !r.boValidated ? ' todo' : '') + '">' +
    '<div><div class="no' + (r.void ? ' strike' : '') + '">' + esc(r.receiptNo) + '</div><div class="sub">' + esc(when) + '</div></div>' +
    '<div class="amt"><div class="mono' + (r.void ? ' strike' : '') + '" style="font-weight:600">' + eur(r.total) + '</div><div class="sub">' + esc(r.by) + '</div></div>' +
    '<div class="who" style="min-width:0"><b>' + esc(r.customer) + '</b>' + (r.void ? ' <span class="tag void">CANCELLED</span>' : '') +
      '<div class="sub">' + esc(r.concept) + (r.void && r.voidReason ? ' · ' + esc(r.voidReason) : '') + '</div></div>' +
    '<div class="acts">' + bo + '<button type="button" class="ghost sm" data-pr="' + i + '">Print</button>' + (r.void ? '' : '<button type="button" class="more" data-void="' + i + '">Cancel</button>') + '</div></div>';
}
function drawDay() {
  var d = S.dayData, box = $('dayBox');
  var list = d.list || [];
  var html = '';
  if (!S.search && !S.pendingOnly) {
    var per = Object.keys(d.perBy || {}).sort(function (a, b) { return d.perBy[b] - d.perBy[a]; });
    html += '<section class="card sum"><div><div class="muted" style="font-size:13px;font-weight:600">Cash received</div><div class="big">' + eur(d.grandTotal) + '</div></div>' +
      '<div style="display:flex;gap:28px"><div><div class="muted" style="font-size:13px">Trips &amp; others</div><div class="mono" style="font-size:18px;font-weight:600">' + eur(d.total) + '</div></div>' +
      '<div><div class="muted" style="font-size:13px">Rents</div><div class="mono" style="font-size:18px;font-weight:600">' + eur(d.rentTotal) + '</div></div></div>' +
      '<div class="chips" style="margin-left:auto">' + (per.length ? per.map(function (k) { return '<span class="who-pill">' + esc(k && k !== '—' ? k : 'No name') + ' · <b>' + eur(d.perBy[k]) + '</b></span>'; }).join('') : '<span class="muted">No cash payment this day.</span>') + '</div></section>' +
      (d.rentError ? '<p class="err">' + esc(d.rentError) + '</p>' : '');
  }
  if (S.pendingOnly) html += '<div class="warnbar"><span><b>' + list.length + '</b> receipt' + (list.length === 1 ? '' : 's') + ' still to validate in the back office</span><button type="button" class="ghost sm" id="allDay">Back to the day</button></div>';
  else if (d.pendingCount) html += '<div class="warnbar"><span><b>' + d.pendingCount + ' receipt' + (d.pendingCount === 1 ? '' : 's') + '</b> still to validate in the back office</span><button type="button" class="ghost sm" id="onlyPending">Show only these</button></div>';
  html += '<section class="list"><div class="head"><b>' + (S.search ? 'Results' : S.pendingOnly ? 'To validate' : 'Trips &amp; others') + '</b><span class="muted" style="font-size:13px">' + list.length + ' receipt' + (list.length === 1 ? '' : 's') + '</span></div>' +
    (list.length ? list.map(rowHtml).join('') : '<div class="row" style="display:block"><span class="muted">' + (S.search ? 'Nothing found.' : 'No receipt.') + '</span></div>') + '</section>';
  if (!S.search && !S.pendingOnly) {
    var rents = d.rents || [];
    html += '<section class="list"><div class="head"><b>Rents</b><span class="muted" style="font-size:13px">' + rents.length + ' payment' + (rents.length === 1 ? '' : 's') + ' · printed from the rent app</span></div>' +
      (rents.length ? rents.map(function (r) {
        return '<div class="row"><div><div class="no">' + esc(r.receiptNo) + '</div><div class="tag rent">RENT</div></div>' +
          '<div class="amt"><div class="mono" style="font-weight:600">' + eur(r.total) + '</div><div class="sub">' + esc(r.by || 'No name') + '</div></div>' +
          '<div class="who" style="min-width:0"><b>' + esc(r.student) + '</b><div class="sub">' + esc(r.flat) + ' · room ' + esc(r.room) + ' · ' + esc(r.month) + '</div></div><div></div></div>';
      }).join('') : '<div class="row" style="display:block"><span class="muted">No rent paid in cash.</span></div>') + '</section>';
  }
  box.innerHTML = html;
  if ($('onlyPending')) $('onlyPending').onclick = function () { S.pendingOnly = true; S.search = ''; $('find').value = ''; loadDay(); };
  if ($('allDay')) $('allDay').onclick = function () { S.pendingOnly = false; loadDay(); };
  var at = function (sel, fn) { Array.prototype.forEach.call(box.querySelectorAll('[' + sel + ']'), function (el) { el.onclick = function () { fn(list[+el.getAttribute(sel)], el); }; }); };
  at('data-pr', function (r) { printReceipt(r); });
  at('data-bo', function (r, el) { setBo(r, true, el); });
  at('data-unbo', function (r, el) { ask('Untick ' + r.receiptNo + '?', 'It will show again as “to validate in the back office”.', 'Untick', 'Keep').then(function (ok) { if (ok) setBo(r, false, el); }); });
  at('data-void', function (r) {
    ask('Cancel receipt ' + r.receiptNo + '?', r.customer + ' · ' + eur(r.total) + '. The receipt stays in the list, marked as cancelled.', 'Cancel the receipt', 'Keep it', 'Why? (e.g. wrong amount, paid by card)')
      .then(function (reason) { if (!reason) return; api('void', [r.receiptNo, reason, '']).then(function () { toast('Receipt ' + r.receiptNo + ' cancelled'); loadDay(); }).catch(function (e) { toast(e.message); }); });
  });
}
function setBo(r, on, el) {
  el.disabled = true;
  api('validated', [r.receiptNo, on, '']).then(function () { toast(on ? r.receiptNo + ' validated' : r.receiptNo + ' unticked'); loadDay(); })
    .catch(function (e) { el.disabled = false; toast(e.message); });
}

/* ---------------- Till ---------------- */
function viewTill() {
  $('work').innerHTML = '<header class="top"><div><h1>Till</h1><p id="since">Loading…</p></div></header><div id="tillBox"></div>';
  api('till', []).then(function (t) { S.till = t; drawTill(); }).catch(function (e) { $('tillBox').innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
}
function drawTill() {
  var t = S.till, receipts = r2(t.elvTotal + t.rentTotal), me = S.boot.user.name;
  $('since').textContent = 'Since the last closing · ' + t.fromText + (t.last ? ' by ' + t.last.by : ' (no closing yet: from the start of today)');
  var hist = (t.history || []).map(function (c) {
    var cls = Math.abs(c.diff) < 0.005 ? 'ok' : c.diff > 0 ? 'plus' : 'bad';
    return '<div class="hist"><div><b>' + esc(dmy((c.closedAt || '').slice(0, 10))) + ' ' + esc((c.closedAt || '').slice(11)) + '</b><div class="muted" style="font-size:13px">' + esc(c.by) + (c.note ? ' · ' + esc(c.note) : '') + '</div></div>' +
      '<div class="r hide-s"><div class="mono" style="font-weight:600">' + eur(c.expected) + '</div><div class="muted" style="font-size:12px">receipts</div></div>' +
      '<div class="r hide-s"><div class="mono" style="font-weight:600">' + eur(c.counted) + '</div><div class="muted" style="font-size:12px">counted</div></div>' +
      '<div class="r"><span class="res ' + cls + '">' + (cls === 'ok' ? 'Exact' : (c.diff > 0 ? '+' : '−') + eur(Math.abs(c.diff))) + '</span></div></div>';
  }).join('');
  var moves = (t.moves || []).map(function (m) {
    return '<div class="row"><div><div class="no">' + esc(m.no) + '</div><div class="sub">' + esc(m.time) + '</div></div>' +
      '<div class="amt"><div class="mono" style="font-weight:600">' + eur(m.total) + '</div><div class="sub">' + esc(m.by || '') + '</div></div>' +
      '<div class="who" style="min-width:0"><b>' + esc(m.who) + '</b><div class="sub">' + (m.kind === 'rent' ? 'Rent · ' : '') + esc(m.what) + '</div></div><div></div></div>';
  }).join('');
  $('tillBox').innerHTML =
    '<div class="tri">' +
      '<div class="tcard"><div><div class="t">Cash float</div><div class="s">Left in the till at the last closing</div></div><div class="v">' + eur(t.startFloat) + '</div></div>' +
      '<div class="tcard"><div><div class="t">Cash receipts</div><div class="s">Rents ' + eur(t.rentTotal) + ' + trips &amp; others ' + eur(t.elvTotal) + '</div></div><div class="v">' + eur(receipts) + '</div></div>' +
      '<div class="tcard dark"><div><div class="t">Should be in the till</div><div class="s">Float + receipts</div></div><div class="v">' + eur(t.expected) + '</div></div>' +
    '</div>' + (t.rentError ? '<p class="err">' + esc(t.rentError) + '</p>' : '') +
    '<section class="card" style="display:flex;flex-direction:column;gap:16px;margin-top:18px"><div><h2>Close the till</h2><p class="muted" style="margin:4px 0 0;font-size:14px">Count the cash, take the float out, and type what is left. It is compared with the cash receipts, then the count starts again.</p></div>' +
      '<div class="two"><label class="lbl">Cash counted, without the float<input class="inp money" id="cnt" inputmode="decimal" autocomplete="off" placeholder="0,00"></label>' +
      '<label class="lbl">Float left in the till for next time<input class="inp money" id="flt" inputmode="decimal" autocomplete="off" value="' + esc(String(t.startFloat).replace('.', ',')) + '"></label></div>' +
      '<div id="diff" hidden></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end"><label class="lbl" style="flex:1 1 260px">Note<input class="inp" id="cnote" autocomplete="off" placeholder="e.g. given to Corentin"></label>' +
      '<button type="button" class="primary" id="close" style="padding:14px 22px">Close the till</button></div>' +
      '<p class="err" id="cerr" hidden></p><p class="muted" style="margin:0;font-size:13px">Closed by ' + esc(me) + ' (signed in).</p></section>' +
    '<section class="list" style="margin-top:18px"><div class="head"><b>Since the last closing</b><span class="muted" style="font-size:13px">' + (t.moves || []).length + ' payment' + ((t.moves || []).length === 1 ? '' : 's') + '</span></div>' +
      (moves || '<div class="row" style="display:block"><span class="muted">No cash payment since the last closing.</span></div>') + '</section>' +
    '<section class="list" style="margin-top:18px"><div class="head"><b>Last closings</b></div>' + (hist || '<div class="hist" style="display:block"><span class="muted">No closing yet.</span></div>') + '</section>';
  $('cnt').oninput = drawDiff;
  $('close').onclick = closeTill;
}
function drawDiff() {
  var v = $('cnt').value.trim(), box = $('diff'), t = S.till;
  if (!v) { box.hidden = true; return; }
  var d = r2(num(v) - r2(t.elvTotal + t.rentTotal));
  box.hidden = false;
  box.className = 'diff ' + (Math.abs(d) < 0.005 ? 'ok' : d > 0 ? 'plus' : 'bad');
  box.textContent = Math.abs(d) < 0.005 ? 'The till is right.' : d > 0 ? eur(d) + ' more than the receipts' : eur(-d) + ' missing compared with the receipts';
}
function closeTill() {
  var t = S.till, cnt = $('cnt').value.trim(), flt = $('flt').value.trim(), err = $('cerr');
  if (!cnt) { err.textContent = 'Type the cash you counted, without the float.'; err.hidden = false; return; }
  err.hidden = true;
  var rc = r2(t.elvTotal + t.rentTotal), d = r2(num(cnt) - rc);
  ask('Close the till?', 'Receipts ' + eur(rc) + ', counted without the float ' + eur(num(cnt)) + (Math.abs(d) >= 0.005 ? ' (' + (d > 0 ? '+' : '−') + eur(Math.abs(d)) + ')' : '') + '. Float left in the till: ' + eur(num(flt)) + '.', 'Close the till', 'Back')
    .then(function (ok) {
      if (!ok) return;
      var b = $('close'); b.disabled = true; b.textContent = 'Saving…';
      api('closeTill', [{ counted: cnt, leftInTill: flt === '' ? String(t.startFloat) : flt, by: S.boot.user.name || S.boot.user.email, note: $('cnote').value, fromMs: t.fromMs }])
        .then(function () { toast('Till closed'); viewTill(); })
        .catch(function (e) { b.disabled = false; b.textContent = 'Close the till'; err.textContent = e.message; err.hidden = false; });
    });
}

/* ---------------- go ---------------- */
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
if (ID.token) start(); else if (!CFG.clientId) showGate('signin'); else { showGate('signin'); idToken().then(function () {}); }
window.ELV_CASH_TEST = { S: S, onCredential: onCredential };
})();
