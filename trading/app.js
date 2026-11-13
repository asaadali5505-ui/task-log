/* مساعد التداول — الواجهة: الحالة والحفظ على الجهاز، جلب الأسعار، وعرض الأقسام الخمسة.
   الحسابات نفسها في core.js والرسوم في charts.js. */
(function () {
  'use strict';
  var C = window.TradingCore, Charts = window.TradingCharts;
  var KEY = 'trading-assistant-v1';

  /* ---------- small helpers ---------- */

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function clear(node) { node.textContent = ''; return node; }

  // h('div', { class, text, style: {}, onclick, ...attributes }, children). Text always goes in as text, never as HTML.
  function h(tag, props, kids) {
    var e = document.createElement(tag), k;
    if (props) for (k in props) {
      var v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'style') for (var p in v) e.style[p] = v[p];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    if (kids != null) (Array.isArray(kids) ? kids : [kids]).forEach(function (c) {
      if (c == null || c === false) return;
      e.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    });
    return e;
  }

  /* ---------- formatting: Latin digits, each number isolated so signs and symbols keep their order in Arabic text ---------- */

  var nfCache = {};
  function nf(min, max) {
    var k = min + ',' + max;
    return nfCache[k] || (nfCache[k] = new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: max }));
  }
  function iso(s) { return '⁦' + s + '⁩'; }
  function sign(v, signed) { return v < 0 ? '−' : (signed && v > 0 ? '+' : ''); }
  function priceText(v) {
    if (v == null || !isFinite(v)) return '—';
    var a = Math.abs(v);
    return (a >= 10 ? nf(2, 2) : a >= 1 ? nf(2, 4) : a >= 0.01 ? nf(2, 5) : nf(2, 8)).format(v);
  }
  function price(v) { return iso(priceText(v)); }
  function money(v, signed) {
    if (v == null || !isFinite(v)) return '—';
    return iso(sign(v, signed) + nf(2, 2).format(Math.abs(v)) + '\u00A0' + state.settings.currency);
  }
  function pct(v, digits, signed) {
    if (v == null || !isFinite(v)) return '—';
    return iso(sign(v, signed) + nf(digits, digits).format(Math.abs(v)) + '%');
  }
  function rText(r) { return r == null ? '—' : iso(sign(r, true) + nf(2, 2).format(Math.abs(r)) + 'R'); }
  function qty(q) { return iso(nf(0, q >= 100 ? 2 : q >= 1 ? 4 : 6).format(q)); }
  function int(n) { return iso(nf(0, 0).format(n)); }
  function ratio(v) { return v == null ? '—' : v === Infinity ? '∞' : iso(nf(2, 2).format(v)); }
  function signCls(v) { return v > 0 ? 'gain' : v < 0 ? 'loss' : ''; }
  // values written back into inputs: no grouping, no isolates
  function plain(v, dec) {
    if (v == null || !isFinite(v)) return '';
    var s = v.toFixed(dec == null ? 8 : dec);
    return s.indexOf('.') === -1 ? s : s.replace(/0+$/, '').replace(/\.$/, '');
  }
  function plainPrice(v) {
    var a = Math.abs(v);
    return plain(v, a >= 1000 ? 2 : a >= 10 ? 3 : a >= 1 ? 4 : a >= 0.01 ? 6 : 8);
  }
  function plural(n, one, two, few, many) {
    if (n === 1) return one;
    if (n === 2) return two;
    return int(n) + ' ' + (n % 100 >= 3 && n % 100 <= 10 ? few : many);
  }
  function tradesWord(n) { return n === 0 ? 'لا صفقات' : plural(n, 'صفقة واحدة', 'صفقتان', 'صفقات', 'صفقة'); }
  function candlesWord(n) { return plural(n, 'شمعة واحدة', 'شمعتان', 'شموع', 'شمعة'); }

  function dtf(o) { return new Intl.DateTimeFormat('ar-u-nu-latn-ca-gregory', o); }
  var F_DAY = dtf({ day: 'numeric', month: 'short' }), F_TIME = dtf({ hour: '2-digit', minute: '2-digit', hour12: false }),
      F_FULL = dtf({ day: 'numeric', month: 'short', year: 'numeric' }), F_MONTH = dtf({ month: 'short', year: 'numeric' });
  function dayTime(t) { var d = new Date(t); return F_DAY.format(d) + ' ' + F_TIME.format(d); }
  function pad(n) { return ('0' + n).slice(-2); }
  // local wall-clock time in the shape <input type="datetime-local"> uses, which also sorts as text
  function localStr(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function nowLocal() { return localStr(new Date()); }

  /* ---------- state ---------- */

  var TAGS = [
    { id: 'plan', label: 'التزمت بالخطة' },
    { id: 'early', label: 'خرجت مبكراً' },
    { id: 'moved', label: 'حرّكت الوقف' },
    { id: 'fomo', label: 'دخول متسرّع' },
    { id: 'revenge', label: 'تداول انتقامي' },
    { id: 'oversize', label: 'حجم أكبر من الخطة' }
  ];
  function tagLabel(id) { var t = TAGS.filter(function (x) { return x.id === id; })[0]; return t ? t.label : ''; }

  function defaults() {
    return {
      v: 1,
      settings: {
        startBalance: 1000, currency: '$', riskPct: 1, dailyLossPct: 3, maxTrades: 3, feePct: 0.1,
        checklist: [
          'الصفقة مع الاتجاه العام',
          'حددت وقف الخسارة قبل الدخول',
          'العائد ضعف المخاطرة أو أكثر',
          'لا أخبار مؤثرة خلال مدة الصفقة',
          'أدخل بهدوء، لا تعويضاً لخسارة ولا خوفاً من فوات فرصة'
        ]
      },
      trades: [],
      ui: { tab: 'market', symbol: 'BTCUSDT', custom: '', interval: '4h', provider: '', perfRange: 'all', filter: 'all', welcomed: false },
      calc: { balance: '', risk: '', symbol: '', entry: '', stop: '', target: '', fee: '' },
      bt: {
        strat: 'emaCross', fee: '', stop: '0', short: false,
        p: { emaCross: { fast: 20, slow: 50 }, rsiReversion: { period: 14, buy: 30, exit: 55 }, breakout: { entry: 20, exit: 10 } }
      },
      mc: { win: '45', rr: '2', risk: '1', trades: '100' },
      cache: null, csv: null
    };
  }

  function posNum(v) { return typeof v === 'number' && isFinite(v) && v > 0; }
  function cleanTrade(t) {
    if (!t || typeof t !== 'object' || !posNum(t.entry) || !posNum(t.qty) || !t.symbol) return null;
    var closed = t.status === 'closed' && posNum(t.exit) && typeof t.closedAt === 'string';
    return {
      id: String(t.id || uid()), symbol: String(t.symbol).slice(0, 20), side: t.side === 'short' ? 'short' : 'long',
      entry: t.entry, qty: t.qty, stop: posNum(t.stop) ? t.stop : null, target: posNum(t.target) ? t.target : null,
      openedAt: typeof t.openedAt === 'string' ? t.openedAt : nowLocal(),
      setup: String(t.setup || '').slice(0, 40), notes: String(t.notes || '').slice(0, 600),
      checklist: t.checklist && typeof t.checklist.done === 'number' ? { done: t.checklist.done, total: t.checklist.total } : null,
      status: closed ? 'closed' : 'open', exit: closed ? t.exit : null, closedAt: closed ? t.closedAt : null,
      fees: closed && t.fees > 0 ? t.fees : 0, tag: closed && tagLabel(t.tag) ? t.tag : '', lesson: closed ? String(t.lesson || '').slice(0, 600) : ''
    };
  }

  // Copies saved values over the defaults, section by section, keeping only fields the app knows.
  function adopt(st, data) {
    if (!data || typeof data !== 'object') return st;
    ['settings', 'ui', 'calc', 'mc'].forEach(function (sec) {
      var src = data[sec];
      if (!src || typeof src !== 'object') return;
      Object.keys(st[sec]).forEach(function (k) { if (typeof src[k] === typeof st[sec][k] && !Array.isArray(st[sec][k])) st[sec][k] = src[k]; });
    });
    var s = st.settings, def = defaults().settings;
    ['startBalance', 'riskPct'].forEach(function (k) { if (!posNum(s[k])) s[k] = def[k]; });
    ['dailyLossPct', 'maxTrades', 'feePct'].forEach(function (k) { if (!(s[k] >= 0) || !isFinite(s[k])) s[k] = def[k]; });
    s.currency = String(s.currency || '$').slice(0, 6);
    if (data.settings && Array.isArray(data.settings.checklist)) {
      s.checklist = data.settings.checklist.filter(function (x) { return typeof x === 'string' && x.trim(); }).map(function (x) { return x.slice(0, 80); }).slice(0, 12);
    }
    if (Array.isArray(data.trades)) st.trades = data.trades.map(cleanTrade).filter(Boolean);
    if (data.bt && typeof data.bt === 'object') {
      if (st.bt.p[data.bt.strat]) st.bt.strat = data.bt.strat;
      if (typeof data.bt.fee === 'string') st.bt.fee = data.bt.fee;
      if (typeof data.bt.stop === 'string') st.bt.stop = data.bt.stop;
      st.bt.short = !!data.bt.short;
      Object.keys(st.bt.p).forEach(function (name) {
        var src = data.bt.p && data.bt.p[name];
        if (src) Object.keys(st.bt.p[name]).forEach(function (k) { if (posNum(src[k])) st.bt.p[name][k] = Math.round(src[k]); });
      });
    }
    function rowsOk(x) { return x && Array.isArray(x.rows) && x.rows.length && Array.isArray(x.rows[0]); }
    if (rowsOk(data.cache) && typeof data.cache.key === 'string') st.cache = data.cache;
    if (rowsOk(data.csv)) st.csv = { name: String(data.csv.name || 'CSV').slice(0, 20), rows: data.csv.rows, closeOnly: !!data.csv.closeOnly };
    return st;
  }

  function load() {
    var st = defaults();
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) adopt(st, JSON.parse(raw));
    } catch (e) { /* unreadable storage: start from defaults */ }
    return st;
  }

  var state = load(), storageOk = true, saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    try { localStorage.setItem(KEY, JSON.stringify(state)); storageOk = true; }
    catch (e) {
      // most likely the quota: retry without the price cache
      try { localStorage.setItem(KEY, JSON.stringify(Object.assign({}, state, { cache: null }))); storageOk = true; }
      catch (e2) { storageOk = false; }
    }
    $('storage-warn').hidden = storageOk;
  }
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 300); }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function closedTrades() { return state.trades.filter(function (t) { return t.status === 'closed'; }); }
  function openTrades() { return state.trades.filter(function (t) { return t.status === 'open'; }); }
  function balance() {
    return closedTrades().reduce(function (s, t) { return s + C.tradeResult(t).pnl; }, state.settings.startBalance);
  }
  function autoFees(entry, exit, q) { return (entry + exit) * q * state.settings.feePct / 100; }

  // Today's standing against the plan's daily rules.
  function dayStatus() {
    var today = nowLocal().slice(0, 10), s = state.settings, pnl = 0, opened = 0, openRisk = 0, unprotected = 0;
    state.trades.forEach(function (t) {
      if (t.openedAt.slice(0, 10) === today) opened++;
      if (t.status === 'closed' && t.closedAt.slice(0, 10) === today) pnl += C.tradeResult(t).pnl;
      if (t.status === 'open') { if (t.stop) openRisk += Math.abs(t.entry - t.stop) * t.qty; else unprotected++; }
    });
    var bal = balance(), limit = (bal - pnl) * s.dailyLossPct / 100;
    return {
      pnl: pnl, opened: opened, openRisk: openRisk, unprotected: unprotected, balance: bal, limit: limit,
      lossUsed: limit > 0 ? clamp(-pnl / limit, 0, 1) : 0,
      hitLoss: limit > 0 && -pnl >= limit, hitTrades: s.maxTrades > 0 && opened >= s.maxTrades
    };
  }

  /* ---------- dialogs, toast, files ---------- */

  function showDialog(id) { var d = $(id); if (d.open) return; if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
  function hideDialog(id) { var d = $(id); if (!d.open) return; if (d.close) d.close(); else d.removeAttribute('open'); }
  function formError(id, msg) { var e = $(id); e.textContent = msg || ''; e.hidden = !msg; }

  var toastTimer = 0;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2800);
  }

  var confirmCb = null;
  function ask(text, okLabel, danger, cb) {
    $('cf-text').textContent = text;
    $('cf-ok').textContent = okLabel;
    $('cf-ok').className = 'btn ' + (danger ? 'danger' : 'primary');
    confirmCb = cb;
    showDialog('dlg-confirm');
  }

  function download(name, text, mime) {
    try {
      var url = URL.createObjectURL(new Blob([text], { type: mime })), a = h('a', { href: url, download: name });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      return true;
    } catch (e) { return false; }
  }

  function seg(host, options, current, onPick) {
    clear(host);
    options.forEach(function (o) {
      host.appendChild(h('button', {
        type: 'button', text: o.label, 'aria-pressed': String(o.id === current), disabled: o.disabled,
        onclick: function () { onPick(o.id); }
      }));
    });
  }

  /* ---------- header: account line, plan alerts ---------- */

  function renderHeader() {
    var d = dayStatus(), acct = clear($('acct'));
    acct.appendChild(document.createTextNode('الرصيد ' + money(d.balance)));
    if (d.pnl !== 0) {
      acct.appendChild(document.createTextNode(' · اليوم '));
      acct.appendChild(h('span', { class: signCls(d.pnl), text: money(d.pnl, true) }));
    }
    var guard = $('guard'), msg = '';
    if (d.hitLoss) msg = 'بلغت حد الخسارة اليومي في خطتك: خسرت اليوم ' + money(-d.pnl) + ' والحد ' + money(d.limit) + '. توقف عن التداول اليوم.';
    else if (d.hitTrades) msg = 'فتحت اليوم ' + tradesWord(d.opened) + '، وهذا الحد الأقصى في خطتك (' + int(state.settings.maxTrades) + ').';
    guard.textContent = msg;
    guard.className = 'banner ' + (d.hitLoss ? 'danger' : 'warn');
    guard.hidden = !msg;
    $('welcome').hidden = state.ui.welcomed;
  }

  /* ---------- market data ---------- */

  var INTERVALS = [
    { id: '15m', label: '15 د', ms: 9e5, binance: '15m', bybit: '15', okx: '15m' },
    { id: '1h', label: 'ساعة', ms: 36e5, binance: '1h', bybit: '60', okx: '1H' },
    { id: '4h', label: '4 ساعات', ms: 144e5, binance: '4h', bybit: '240', okx: '4H' },
    { id: '1d', label: 'يوم', ms: 864e5, binance: '1d', bybit: 'D', okx: '1Dutc' },
    { id: '1w', label: 'أسبوع', ms: 6048e5, binance: '1w', bybit: 'W', okx: '1Wutc' }
  ];
  var SYMBOLS = [
    { id: 'BTCUSDT', label: 'بيتكوين BTC' }, { id: 'ETHUSDT', label: 'إيثريوم ETH' }, { id: 'SOLUSDT', label: 'سولانا SOL' },
    { id: 'BNBUSDT', label: 'بي إن بي BNB' }, { id: 'XRPUSDT', label: 'ريبل XRP' }, { id: 'PAXGUSDT', label: 'ذهب مرمّز PAXG' }
  ];
  // Public, key-less market data endpoints, tried in order until one answers.
  var PROVIDERS = [
    { id: 'binance', name: 'Binance', norm: C.normalizeBinance,
      url: function (s, i) { return 'https://data-api.binance.vision/api/v3/klines?symbol=' + s + '&interval=' + i.binance + '&limit=500'; } },
    { id: 'binance-api', name: 'Binance', norm: C.normalizeBinance,
      url: function (s, i) { return 'https://api.binance.com/api/v3/klines?symbol=' + s + '&interval=' + i.binance + '&limit=500'; } },
    { id: 'bybit', name: 'Bybit', norm: C.normalizeBybit,
      url: function (s, i) { return 'https://api.bybit.com/v5/market/kline?category=spot&symbol=' + s + '&interval=' + i.bybit + '&limit=500'; } },
    { id: 'okx', name: 'OKX', norm: C.normalizeOkx,
      url: function (s, i) { var p = C.splitSymbol(s); return p ? 'https://www.okx.com/api/v5/market/candles?instId=' + p.base + '-' + p.quote + '&bar=' + i.okx + '&limit=300' : null; } }
  ];

  var market = { candles: [], mode: 'none', source: '', at: 0, loading: false, error: '', key: '', count: 0, offset: 0, seq: 0, planSide: '' };

  function intervalDef() { return INTERVALS.filter(function (i) { return i.id === state.ui.interval; })[0] || INTERVALS[2]; }
  function liveSymbol() {
    var s = state.ui.symbol === '@custom' ? state.ui.custom : state.ui.symbol;
    return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  function isLiveSelection() { return state.ui.symbol.charAt(0) !== '@' || state.ui.symbol === '@custom'; }
  function pack(c) { return c.map(function (x) { return [x.t, x.o, x.h, x.l, x.c, x.v]; }); }
  function unpack(r) { return r.map(function (x) { return { t: x[0], o: x[1], h: x[2], l: x[3], c: x[4], v: x[5] }; }); }
  function demoData(itv) { return C.demoCandles(500, 11, itv.ms, Math.floor(Date.now() / itv.ms) * itv.ms); }
  function realPrices() { return market.mode === 'live' || market.mode === 'cache' || market.mode === 'csv'; }
  function marketName() {
    if (market.mode === 'csv') return iso(state.csv ? state.csv.name : 'CSV');
    if (market.mode === 'demo' || market.mode === 'fallback') return 'بيانات تجريبية';
    var sym = liveSymbol(), p = C.splitSymbol(sym);
    return iso(p ? p.base + '/' + p.quote : sym);
  }

  function fetchJson(url, ms) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
    return fetch(url, ctl ? { signal: ctl.signal } : undefined).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) { var e = new Error('http ' + r.status); e.http = r.status; throw e; }
      return r.json();
    }, function (e) { clearTimeout(timer); throw e; });
  }

  // Rejects with { kind: 'symbol' } when a source answered but does not list the symbol, otherwise { kind: 'network' }.
  function fetchCandles(sym, itv) {
    var order = PROVIDERS.slice(), unknown = false;
    for (var j = 1; j < order.length; j++) if (order[j].id === state.ui.provider) order.unshift(order.splice(j, 1)[0]);
    function attempt(i) {
      if (i >= order.length) return Promise.reject({ kind: unknown ? 'symbol' : 'network' });
      var p = order[i], url = p.url(sym, itv);
      if (!url) return attempt(i + 1);
      return fetchJson(url, 9000).then(function (json) {
        var candles = p.norm(json);
        if (candles.length < 2) { unknown = true; return attempt(i + 1); }
        return { id: p.id, name: p.name, candles: candles };
      }, function (e) {
        if (e && (e.http === 400 || e.http === 404)) unknown = true;
        return attempt(i + 1);
      });
    }
    return attempt(0);
  }

  function setKey(key) {
    if (market.key === key) return false;
    market.key = key; market.offset = 0; market.planSide = '';
    return true;
  }
  function afterData() {
    renderMarket();
    if (state.ui.tab === 'test') { renderTestData(); runTest(); }
  }

  function loadMarket() {
    var itv = intervalDef(), seq = ++market.seq;
    market.error = '';
    if (state.ui.symbol === '@csv' && !state.csv) state.ui.symbol = 'BTCUSDT';
    if (state.ui.symbol === '@csv') {
      setKey('@csv'); market.loading = false; market.candles = unpack(state.csv.rows); market.mode = 'csv';
      return afterData();
    }
    if (state.ui.symbol === '@demo') {
      setKey('@demo|' + itv.id); market.loading = false; market.candles = demoData(itv); market.mode = 'demo';
      return afterData();
    }
    var sym = liveSymbol();
    if (!sym) {
      setKey('@none'); market.loading = false; market.candles = []; market.mode = 'none'; market.error = 'empty';
      return afterData();
    }
    var key = sym + '|' + itv.id;
    if (setKey(key)) {
      if (state.cache && state.cache.key === key) {
        market.candles = unpack(state.cache.rows); market.mode = 'cache'; market.source = state.cache.source; market.at = state.cache.at;
      } else { market.candles = []; market.mode = 'none'; }
    }
    market.loading = true;
    afterData();
    fetchCandles(sym, itv).then(function (res) {
      if (seq !== market.seq) return;
      market.loading = false; market.candles = res.candles; market.mode = 'live'; market.source = res.name; market.at = Date.now();
      state.ui.provider = res.id;
      state.cache = { key: key, source: res.name, at: market.at, rows: pack(res.candles) };
      save();
      afterData();
    }, function (err) {
      if (seq !== market.seq) return;
      market.loading = false;
      market.error = (err && err.kind) || 'network';
      if (market.mode === 'live') market.mode = 'cache';
      // with nothing real to show and no connection, fall back to clearly labelled sample candles
      if ((market.mode === 'none' || market.mode === 'fallback') && market.error === 'network') { market.candles = demoData(itv); market.mode = 'fallback'; }
      afterData();
    });
  }

  function marketStatus() {
    var n = market.candles.length;
    if (market.loading && !n) return ['wait', 'جارٍ جلب الأسعار…'];
    switch (market.mode) {
      case 'live':
        return ['live', 'أسعار من ' + market.source + ' · آخر تحديث ' + iso(F_TIME.format(new Date(market.at))) + (market.loading ? ' · جارٍ التحديث…' : '')];
      case 'cache':
        return market.loading ? ['wait', 'آخر أسعار محفوظة (' + dayTime(market.at) + ') · جارٍ التحديث…']
          : ['warn', 'تعذّر الاتصال بمصدر الأسعار. المعروض آخر أسعار محفوظة من ' + dayTime(market.at) + '.'];
      case 'fallback':
        return market.loading ? ['wait', 'جارٍ جلب الأسعار…']
          : ['warn', 'تعذّر جلب الأسعار، والمعروض بيانات تجريبية مولّدة وليست أسعاراً حقيقية. اضغط «تحديث» للمحاولة من جديد أو استورد ملف CSV.'];
      case 'demo':
        return ['warn', 'بيانات تجريبية مولّدة لتجربة الأدوات، وليست أسعاراً حقيقية.'];
      case 'csv':
        return ['idle', 'ملف مستورد: ' + candlesWord(n) + '، من ' + F_FULL.format(new Date(market.candles[0].t)) + ' إلى ' + F_FULL.format(new Date(market.candles[n - 1].t)) + '.'];
      default:
        if (market.error === 'symbol') return ['error', 'لم نجد الرمز ' + iso(liveSymbol()) + ' لدى مصادر الأسعار. اكتبه كما يظهر في المنصة، مثل DOGEUSDT.'];
        if (market.error === 'empty') return ['idle', 'اكتب رمز الزوج ثم اضغط «عرض».'];
        return ['wait', 'جارٍ جلب الأسعار…'];
    }
  }

  function buildSymbolSelect() {
    var sel = clear($('m-symbol'));
    SYMBOLS.forEach(function (s) { sel.appendChild(h('option', { value: s.id, text: s.label })); });
    if (state.csv) sel.appendChild(h('option', { value: '@csv', text: 'ملف مستورد: ' + state.csv.name }));
    sel.appendChild(h('option', { value: '@custom', text: 'رمز آخر…' }));
    sel.appendChild(h('option', { value: '@demo', text: 'بيانات تجريبية' }));
    sel.value = state.ui.symbol;
    if (sel.value !== state.ui.symbol) { state.ui.symbol = 'BTCUSDT'; sel.value = 'BTCUSDT'; }
  }

  function axisFormatter(lo, hi) {
    var step = (hi - lo) / 5 || Math.abs(hi) / 5 || 1;
    var dec = step >= 1 ? 0 : Math.min(8, Math.ceil(-Math.log10(step)));
    if (hi < 10 && dec < 2) dec = 2;
    var f = nf(dec, dec);
    return function (v) { return f.format(v); };
  }

  function renderMarket() {
    var k = market.candles, n = k.length, st = marketStatus();
    $('m-symbol').value = state.ui.symbol;
    $('m-custom-wrap').hidden = state.ui.symbol !== '@custom';
    seg($('m-interval'), INTERVALS.map(function (i) { return { id: i.id, label: i.label, disabled: state.ui.symbol === '@csv' }; }),
      state.ui.symbol === '@csv' ? '' : state.ui.interval, function (id) { state.ui.interval = id; market.count = 0; saveSoon(); loadMarket(); });
    $('m-status').dataset.state = st[0];
    $('m-status-text').textContent = st[1];
    $('m-refresh').disabled = !isLiveSelection() || market.loading;

    var title = marketName();
    if (market.mode !== 'csv' && n) title += ' · ' + intervalDef().label;
    $('m-title').textContent = n ? title : 'لا بيانات';
    var chg = clear($('m-chg'));
    if (!n) {
      $('m-price').textContent = '—';
      ['m-chart', 'm-rsi', 'm-table', 'm-plan'].forEach(function (id) { clear($(id)); });
      clear($('m-read')).appendChild(h('p', { class: 'hint', text: 'تظهر القراءة بعد تحميل الأسعار.' }));
      return;
    }
    var last = k[n - 1];
    $('m-price').textContent = price(last.c);
    if (n > 1) {
      var d = (last.c / k[n - 2].c - 1) * 100;
      chg.className = 'chg ' + signCls(d);
      chg.textContent = (d > 0 ? '▲ ' : d < 0 ? '▼ ' : '') + pct(d, 2, true) + ' عن إغلاق الشمعة السابقة';
    }
    drawMarketCharts();
    renderTable();
    var a = renderReading();
    renderPlan(a);
  }

  function drawMarketCharts() {
    var k = market.candles, total = k.length, host = $('m-chart'), w = host.clientWidth;
    if (!w || !total) return;
    var fit = clamp(Math.floor((w - 74) / 7), 30, 200), maxCount = Math.min(400, total);
    var count = clamp(market.count || fit, Math.min(20, total), maxCount);
    market.offset = clamp(market.offset, 0, total - count);
    var end = total - market.offset, start = end - count, vis = k.slice(start, end);
    var closes = k.map(function (c) { return c.c; });
    var e20 = C.ema(closes, 20).slice(start, end), e50 = C.ema(closes, 50).slice(start, end), rsi = C.rsi(closes, 14).slice(start, end);
    var step = total > 1 ? k[total - 1].t - k[total - 2].t : 864e5, intraday = step < 864e5, span = vis[count - 1].t - vis[0].t;
    var lo = Infinity, hi = -Infinity;
    vis.forEach(function (c) { if (c.l < lo) lo = c.l; if (c.h > hi) hi = c.h; });
    function axisTime(t) {
      var d = new Date(t);
      if (intraday) return span <= 36 * 36e5 ? F_TIME.format(d) : F_DAY.format(d);
      return span > 400 * 864e5 ? F_MONTH.format(d) : F_DAY.format(d);
    }
    function tipTime(t) { return intraday ? dayTime(t) : F_FULL.format(new Date(t)); }

    Charts.candles(host, {
      candles: vis, height: w < 520 ? 290 : 360,
      label: 'رسم الشموع لـ ' + marketName() + '. استخدم الأسهم يميناً ويساراً لقراءة كل شمعة.',
      overlays: [{ name: 'متوسط 20', values: e20, cls: 's1' }, { name: 'متوسط 50', values: e50, cls: 'sctx' }],
      fmtY: axisFormatter(lo, hi), fmtVal: priceText, fmtX: axisTime, fmtTip: tipTime,
      words: { o: 'الافتتاح', h: 'الأعلى', l: 'الأدنى', c: 'الإغلاق' }, showLast: market.offset === 0
    });
    Charts.lines($('m-rsi'), {
      n: count, height: 110, bandScale: true, domain: [0, 100], yTicks: [30, 50, 70], refs: [{ y: 30 }, { y: 70 }],
      label: 'مؤشر القوة النسبية. فوق 70 تشبّع شرائي وتحت 30 تشبّع بيعي.',
      series: [{ name: 'RSI', values: rsi, cls: 's1', dot: false }],
      fmtY: function (v) { return nf(0, 0).format(v); }, fmtVal: function (v) { return nf(1, 1).format(v); },
      tipHead: function (i) { return tipTime(vis[i].t); }
    });
    $('m-older').disabled = start <= 0;
    $('m-newer').disabled = market.offset === 0;
    $('m-latest').hidden = market.offset === 0;
    $('m-zoom-in').disabled = count <= Math.min(20, total);
    $('m-zoom-out').disabled = count >= maxCount;
    market.shown = count;
  }

  function renderTable() {
    var k = market.candles, tbl = clear($('m-table')), intraday = k.length > 1 && k[k.length - 1].t - k[k.length - 2].t < 864e5;
    tbl.appendChild(h('thead', null, h('tr', null, ['الوقت', 'الافتتاح', 'الأعلى', 'الأدنى', 'الإغلاق', 'التغيّر'].map(function (x) { return h('th', { scope: 'col', text: x }); }))));
    var body = h('tbody');
    k.slice(-12).reverse().forEach(function (c) {
      var d = (c.c / c.o - 1) * 100;
      body.appendChild(h('tr', null, [
        h('td', { text: intraday ? dayTime(c.t) : F_FULL.format(new Date(c.t)) }),
        h('td', { text: price(c.o) }), h('td', { text: price(c.h) }), h('td', { text: price(c.l) }), h('td', { text: price(c.c) }),
        h('td', { class: signCls(d), text: pct(d, 2, true) })
      ]));
    });
    tbl.appendChild(body);
  }

  var READ = {
    strongUp: ['▲', 'صعودي قوي', 'gain'], up: ['▲', 'صعودي', 'gain'], neutral: ['●', 'محايد', ''],
    down: ['▼', 'هبوطي', 'loss'], strongDown: ['▼', 'هبوطي قوي', 'loss']
  };
  var FACT = {
    priceVsEma50: function (f) {
      return [f.dir > 0 ? 'السعر أعلى من متوسط 50' : f.dir < 0 ? 'السعر أدنى من متوسط 50' : 'السعر عند متوسط 50', 'الفرق ' + pct(f.value, 1, true)];
    },
    emaCross: function (f) {
      return [f.dir > 0 ? 'متوسط 20 فوق متوسط 50' : f.dir < 0 ? 'متوسط 20 تحت متوسط 50' : 'المتوسطان متطابقان',
        f.dir > 0 ? 'الحركة القريبة أقوى من المتوسطة' : 'الحركة القريبة أضعف من المتوسطة'];
    },
    emaSlope: function (f) {
      return [f.dir > 0 ? 'متوسط 50 يميل للصعود' : f.dir < 0 ? 'متوسط 50 يميل للهبوط' : 'متوسط 50 أفقي تقريباً', 'ميل آخر 10 شموع'];
    },
    rsi: function (f) {
      var v = f.value;
      return ['مؤشر RSI عند ' + iso(nf(0, 0).format(v)) + ': ' + (v >= 70 ? 'زخم قوي مع تشبّع شرائي' : v >= 55 ? 'زخم إيجابي' : v > 45 ? 'زخم محايد' : v > 30 ? 'زخم سلبي' : 'زخم ضعيف مع تشبّع بيعي'),
        v >= 70 ? 'التشبّع قد يسبق تهدئة أو تصحيحاً' : v <= 30 ? 'التشبّع قد يسبق ارتداداً' : 'بين حدّي التشبّع 30 و70'];
    },
    macd: function (f) {
      return [f.dir > 0 ? 'MACD فوق خط الإشارة' : f.dir < 0 ? 'MACD تحت خط الإشارة' : 'MACD عند خط الإشارة', f.dir > 0 ? 'الزخم يتزايد' : f.dir < 0 ? 'الزخم يتراجع' : 'بلا ميل'];
    }
  };

  function renderReading() {
    var host = clear($('m-read')), a = C.analyze(market.candles);
    if (!a) {
      host.appendChild(h('p', { class: 'hint', text: 'تحتاج القراءة إلى ' + int(C.MIN_ANALYZE) + ' شمعة على الأقل، والمتوفر ' + int(market.candles.length) + '.' }));
      return null;
    }
    var L = READ[a.label];
    host.appendChild(h('div', { class: 'verdict' }, [
      h('b', { class: L[2], text: L[0] + ' ' + L[1] }),
      h('span', { text: 'الدرجة ' + iso(sign(a.score, true) + nf(0, 0).format(Math.abs(a.score))) + ' من 100' })
    ]));
    host.appendChild(h('div', { class: 'score', 'aria-hidden': 'true' }, [
      h('div', { class: 'score-track' }, h('i', { style: { left: (a.score + 100) / 2 + '%' } })),
      h('div', { class: 'score-ends' }, [h('span', { text: 'هبوطي' }), h('span', { text: 'محايد' }), h('span', { text: 'صعودي' })])
    ]));
    var list = h('ul', { class: 'facts' });
    a.factors.forEach(function (f) {
      var txt = FACT[f.key](f);
      list.appendChild(h('li', null, [
        h('span', { class: 'dir ' + (f.dir > 0 ? 'up' : f.dir < 0 ? 'down' : ''), 'aria-hidden': 'true', text: f.dir > 0 ? '▲' : f.dir < 0 ? '▼' : '●' }),
        h('span', null, [txt[0], h('small', { text: txt[1] })])
      ]));
    });
    host.appendChild(list);
    var volWord = a.vol === 'high' ? 'أعلى من المعتاد' : a.vol === 'low' ? 'أقل من المعتاد' : 'ضمن المعتاد';
    function level(v) {
      return v == null ? [h('small', { text: 'لا يوجد في آخر 150 شمعة' })] : [price(v), ' ', h('small', { text: pct((v / a.price - 1) * 100, 1, true) })];
    }
    host.appendChild(h('dl', { class: 'kv' }, [
      h('dt', { text: 'التقلب (ATR 14)' }), h('dd', null, [price(a.atr), ' ', h('small', { text: pct(a.atrPct, 2) + ' · ' + volWord })]),
      h('dt', { text: 'أقرب مقاومة' }), h('dd', null, level(a.resistance)),
      h('dt', { text: 'أقرب دعم' }), h('dd', null, level(a.support))
    ]));
    host.appendChild(h('p', { class: 'hint', text: 'وصف لحال المؤشرات الآن، وليس توقعاً لما سيحدث.' +
      (market.mode === 'live' ? ' الشمعة الأخيرة لم تُغلق بعد، فقد تتغير القراءة حتى إغلاقها.' : '') }));
    return a;
  }

  function renderPlan(a) {
    var host = clear($('m-plan'));
    if (!a) { host.appendChild(h('p', { class: 'hint', text: 'تظهر المستويات عند توفر بيانات كافية.' })); return; }
    var side = market.planSide || (a.score < 0 ? 'short' : 'long'), plan = C.planFromAtr(a.price, a.atr, side);
    var pick = h('div', { class: 'seg', role: 'group', 'aria-label': 'اتجاه الصفقة' });
    seg(pick, [{ id: 'long', label: 'شراء' }, { id: 'short', label: 'بيع' }], side, function (id) { market.planSide = id; renderPlan(a); });
    host.appendChild(pick);
    host.appendChild(h('dl', { class: 'kv' }, [
      h('dt', { text: 'الدخول (آخر سعر)' }), h('dd', { text: price(plan.entry) }),
      h('dt', { text: 'وقف الخسارة' }), h('dd', null, [price(plan.stop), ' ', h('small', { text: pct((plan.stop / plan.entry - 1) * 100, 2, true) })]),
      h('dt', { text: 'الهدف' }), h('dd', null, [price(plan.target), ' ', h('small', { text: pct((plan.target / plan.entry - 1) * 100, 2, true) })])
    ]));
    host.appendChild(h('button', {
      type: 'button', class: 'btn primary block', text: 'احسب حجم الصفقة',
      onclick: function () {
        var c = state.calc;
        c.symbol = realPrices() ? (market.mode === 'csv' ? state.csv.name : liveSymbol()) : '';
        c.entry = plainPrice(plan.entry); c.stop = plainPrice(plan.stop); c.target = plainPrice(plan.target);
        save();
        showTab('calc');
      }
    }));
    host.appendChild(h('p', { class: 'hint', text: 'الوقف على بُعد 1.5 من متوسط حركة الشمعة (ATR)، والهدف ضعف مسافة الوقف. مستويات حسابية وليست توصية بالدخول.' }));
  }

  /* ---------- calculator ---------- */

  var CALC_FIELDS = { 'c-balance': 'balance', 'c-risk': 'risk', 'c-symbol': 'symbol', 'c-entry': 'entry', 'c-stop': 'stop', 'c-target': 'target', 'c-fee': 'fee' };
  var CALC_ERR = {
    balance: 'رصيد الحساب يجب أن يكون رقماً أكبر من صفر.',
    risk: 'نسبة المخاطرة يجب أن تكون أكبر من صفر ولا تتجاوز 100.',
    entry: 'سعر الدخول غير صحيح.',
    stop: 'سعر وقف الخسارة غير صحيح.',
    stopEqual: 'وقف الخسارة يساوي سعر الدخول. ضعه تحت الدخول للشراء أو فوقه للبيع.',
    target: 'سعر الهدف غير صحيح.',
    fee: 'نسبة العمولة غير صحيحة.'
  };
  var calcRes = null, calcChecks = {};

  function calcValues() {
    var c = state.calc, s = state.settings;
    return {
      balance: c.balance.trim() === '' ? balance() : C.parseNum(c.balance),
      riskPct: c.risk.trim() === '' ? s.riskPct : C.parseNum(c.risk),
      entry: C.parseNum(c.entry), stop: C.parseNum(c.stop),
      target: c.target.trim() === '' ? null : C.parseNum(c.target),
      feePct: c.fee.trim() === '' ? s.feePct : C.parseNum(c.fee)
    };
  }

  function renderCalc() {
    var c = state.calc, s = state.settings;
    Object.keys(CALC_FIELDS).forEach(function (id) { $(id).value = c[CALC_FIELDS[id]]; });
    $('c-balance').placeholder = plain(balance(), 2);
    $('c-risk').placeholder = plain(s.riskPct, 2);
    $('c-fee').placeholder = plain(s.feePct, 3);
    renderCalcResult();
    renderChecklist();
  }

  function renderCalcResult() {
    var host = clear($('c-result')), c = state.calc, v = calcValues(), s = state.settings;
    calcRes = null;
    var chips = clear($('c-risk-chips'));
    [0.5, 1, 2].forEach(function (r) {
      chips.appendChild(h('button', { type: 'button', text: pct(r, r % 1 ? 1 : 0), 'aria-pressed': String(v.riskPct === r),
        onclick: function () { state.calc.risk = String(r); $('c-risk').value = String(r); saveSoon(); renderCalcResult(); } }));
    });
    if (c.entry.trim() === '' || c.stop.trim() === '') {
      host.appendChild(h('p', { class: 'hint', text: 'أدخل سعر الدخول ووقف الخسارة لتظهر الكمية المناسبة.' }));
      return;
    }
    var err = '';
    if (v.target !== null && !(v.target > 0)) err = CALC_ERR.target;
    else if (!(v.feePct >= 0)) err = CALC_ERR.fee;
    var res = err ? null : C.positionSize(v);
    if (res && !res.ok) {
      err = res.error === 'targetSide'
        ? (res.side === 'long' ? 'الوقف تحت سعر الدخول، فالصفقة شراء والهدف يجب أن يكون أعلى من سعر الدخول.' : 'الوقف فوق سعر الدخول، فالصفقة بيع والهدف يجب أن يكون أدنى من سعر الدخول.')
        : CALC_ERR[res.error];
    }
    if (err) { host.appendChild(h('p', { class: 'form-error', text: err })); return; }
    calcRes = res;
    calcRes.values = v;

    host.appendChild(h('div', { class: 'trade-head' }, sideBadge(res.side)));
    host.appendChild(h('div', { class: 'size' }, [
      h('span', { class: 'lbl', text: 'الكمية' }),
      h('b', { text: qty(res.qty) }),
      h('span', { text: 'قيمتها ' + money(res.notional) + ' · الوقف يبعد ' + pct(res.stopPct, 2) + ' عن الدخول' })
    ]));
    var rows = [
      h('dt', { text: 'الخسارة عند الوقف' }),
      h('dd', null, [h('span', { class: 'loss', text: money(-res.riskAmount) }), h('small', { class: 'blk', text: pct(v.riskPct, 2) + ' من الرصيد' })])
    ];
    if (res.feeAtStop > 0) rows.push(h('dt', { text: 'منها عمولات' }), h('dd', { text: money(res.feeAtStop) }));
    if (res.rr != null) {
      rows.push(h('dt', { text: 'الربح عند الهدف' }), h('dd', null, h('span', { class: signCls(res.reward), text: money(res.reward, true) })));
      rows.push(h('dt', { text: 'العائد إلى المخاطرة' }), h('dd', { text: iso('1 : ' + nf(2, 2).format(Math.max(0, res.rr))) }));
      rows.push(h('dt', { text: 'نسبة النجاح اللازمة للتعادل' }), h('dd', { text: pct(res.breakeven * 100, 0) }));
    }
    host.appendChild(h('dl', { class: 'kv' }, rows));
    if (res.rr > 0) {
      host.appendChild(h('div', { class: 'rr', 'aria-hidden': 'true' }, [
        h('div', { class: 'rr-bar' }, [h('i', { class: 'risk', style: { flex: '1 1 0' } }), h('i', { class: 'reward', style: { flex: res.rr.toFixed(3) + ' 1 0' } })]),
        h('div', { class: 'rr-cap' }, [h('span', { text: 'الربح المحتمل' }), h('span', { text: 'المخاطرة' })])
      ]));
    }

    var notes = [], d = dayStatus();
    if (d.hitLoss) notes.push(['bad', 'بلغت حد الخسارة اليومي في خطتك. الأفضل ألا تفتح صفقة جديدة اليوم.']);
    else if (d.hitTrades) notes.push(['bad', 'وصلت الحد الأقصى لعدد صفقات اليوم في خطتك.']);
    if (res.rr != null && res.rr <= 0) notes.push(['bad', 'العمولات تستهلك الربح كله عند هذا الهدف.']);
    else if (res.rr != null && res.rr < 1) notes.push(['bad', 'العائد أقل من المخاطرة: لن تتعادل إلا إذا ربحت أكثر من ' + pct(res.breakeven * 100, 0) + ' من صفقاتك.']);
    if (res.leverage > 1) notes.push(['', 'قيمة الصفقة أكبر من رصيدك، فتنفيذها يحتاج رافعة ' + iso('×' + nf(1, 1).format(res.leverage)) + ' تقريباً. بلا رافعة: وسّع الوقف أو اقبل كمية أقل.']);
    if (v.riskPct > 2) notes.push(['', 'مخاطرة ' + pct(v.riskPct, 2) + ' في صفقة واحدة مرتفعة: عشر خسائر متتالية بها تُفقدك ' + pct((1 - Math.pow(1 - v.riskPct / 100, 10)) * 100, 0) + ' من الحساب.']);
    else if (v.riskPct > s.riskPct) notes.push(['', 'النسبة أعلى من المخاطرة المحددة في خطتك (' + pct(s.riskPct, 2) + ').']);
    if (notes.length) host.appendChild(h('ul', { class: 'notes' }, notes.map(function (x) { return h('li', { class: x[0], text: x[1] }); })));
  }

  function renderChecklist() {
    var list = clear($('c-checklist')), items = state.settings.checklist, done = 0;
    items.forEach(function (text, i) {
      if (calcChecks[i]) done++;
      var box = h('input', { type: 'checkbox', id: 'c-chk-' + i });
      box.checked = !!calcChecks[i];
      box.addEventListener('change', function () { calcChecks[i] = box.checked; renderChecklist(); });
      list.appendChild(h('li', null, h('label', { class: 'check', 'for': 'c-chk-' + i }, [box, h('span', { text: text })])));
    });
    $('c-check-note').textContent = !items.length ? 'أضف بنود قائمة التحقق من «الخطة والإعدادات».'
      : done === items.length ? 'اكتملت القائمة.' : 'أكملت ' + int(done) + ' من ' + int(items.length) + '. الدخول قبل اكتمالها يُسجَّل مع الصفقة.';
  }

  /* ---------- trade dialogs ---------- */

  function sideBadge(side) { return h('span', { class: 'badge ' + side, text: side === 'long' ? '▲ شراء' : '▼ بيع' }); }
  function numField(id) { return C.parseNum($(id).value); }
  function optField(id) { return $(id).value.trim() === '' ? null : C.parseNum($(id).value); }

  var tradeCtx = null, tradeSide = 'long';
  function setTradeSide(side) {
    tradeSide = side;
    Array.prototype.forEach.call($('tr-side').children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.side === side)); });
  }

  function openTrade(t, pre) {
    var src = t || pre || {};
    tradeCtx = { id: t ? t.id : null, checklist: src.checklist || null, fromCalc: !!(pre && pre.fromCalc) };
    $('tr-h').textContent = t ? 'تعديل الصفقة' : 'صفقة جديدة';
    $('tr-symbol').value = src.symbol || '';
    setTradeSide(src.side || 'long');
    $('tr-entry').value = src.entry ? plainPrice(src.entry) : '';
    $('tr-qty').value = src.qty ? plain(src.qty, 8) : '';
    $('tr-stop').value = src.stop ? plainPrice(src.stop) : '';
    $('tr-target').value = src.target ? plainPrice(src.target) : '';
    $('tr-opened').value = src.openedAt || nowLocal();
    $('tr-setup').value = src.setup || '';
    $('tr-notes').value = src.notes || '';
    var isClosed = src.status === 'closed';
    $('tr-closed').checked = isClosed;
    $('tr-close-fields').hidden = !isClosed;
    $('tr-exit').value = isClosed ? plainPrice(src.exit) : '';
    $('tr-closed-at').value = isClosed ? src.closedAt : '';
    $('tr-fees').value = isClosed && src.fees ? plain(src.fees, 4) : '';
    $('tr-lesson').value = src.lesson || '';
    var tagSel = clear($('tr-tag'));
    tagSel.appendChild(h('option', { value: '', text: 'غير محدد' }));
    TAGS.forEach(function (x) { tagSel.appendChild(h('option', { value: x.id, text: x.label })); });
    tagSel.value = src.tag || '';
    var seen = {}, dl = clear($('tr-setups'));
    state.trades.forEach(function (x) { if (x.setup && !seen[x.setup]) { seen[x.setup] = 1; dl.appendChild(h('option', { value: x.setup })); } });
    formError('tr-error', '');
    showDialog('dlg-trade');
  }

  function saveTrade(e) {
    e.preventDefault();
    var sym = $('tr-symbol').value.trim().toUpperCase(), entry = numField('tr-entry'), q = numField('tr-qty');
    var stop = optField('tr-stop'), target = optField('tr-target'), dir = tradeSide === 'long' ? 1 : -1, err = '';
    var opened = $('tr-opened').value || nowLocal(), isClosed = $('tr-closed').checked, exit = null, closedAt = null, fees = 0;
    if (!sym) err = 'اكتب رمز الأصل.';
    else if (!(entry > 0)) err = 'سعر الدخول غير صحيح.';
    else if (!(q > 0)) err = 'الكمية غير صحيحة.';
    else if (stop !== null && !(stop > 0)) err = 'سعر وقف الخسارة غير صحيح.';
    else if (stop !== null && (entry - stop) * dir <= 0) err = dir === 1 ? 'في صفقة الشراء يكون وقف الخسارة تحت سعر الدخول.' : 'في صفقة البيع يكون وقف الخسارة فوق سعر الدخول.';
    else if (target !== null && !(target > 0)) err = 'سعر الهدف غير صحيح.';
    else if (target !== null && (target - entry) * dir <= 0) err = dir === 1 ? 'في صفقة الشراء يكون الهدف أعلى من سعر الدخول.' : 'في صفقة البيع يكون الهدف أدنى من سعر الدخول.';
    if (!err && isClosed) {
      exit = numField('tr-exit');
      closedAt = $('tr-closed-at').value || nowLocal();
      var f = optField('tr-fees');
      if (!(exit > 0)) err = 'سعر الخروج غير صحيح.';
      else if (closedAt < opened) err = 'وقت الخروج يسبق وقت الدخول.';
      else if (f !== null && !(f >= 0)) err = 'قيمة العمولات غير صحيحة.';
      else fees = f === null ? autoFees(entry, exit, q) : f;
    }
    if (err) return formError('tr-error', err);
    var t = {
      id: tradeCtx.id || uid(), symbol: sym, side: tradeSide, entry: entry, qty: q, stop: stop, target: target, openedAt: opened,
      setup: $('tr-setup').value.trim(), notes: $('tr-notes').value.trim(), checklist: tradeCtx.checklist,
      status: isClosed ? 'closed' : 'open', exit: exit, closedAt: closedAt, fees: fees,
      tag: isClosed ? $('tr-tag').value : '', lesson: isClosed ? $('tr-lesson').value.trim() : ''
    };
    var i = state.trades.map(function (x) { return x.id; }).indexOf(t.id);
    if (i >= 0) state.trades[i] = t; else state.trades.push(t);
    if (tradeCtx.fromCalc) { state.calc.entry = state.calc.stop = state.calc.target = ''; calcChecks = {}; }
    save();
    hideDialog('dlg-trade');
    renderHeader();
    if (tradeCtx.fromCalc) showTab('journal'); else renderTab();
    toast(i >= 0 ? 'حُفظ التعديل' : 'سُجّلت الصفقة');
  }

  var closeCtx = null;
  function openClose(t) {
    closeCtx = { id: t.id, tag: '' };
    $('cl-summary').textContent = iso(t.symbol) + ' · ' + (t.side === 'long' ? 'شراء' : 'بيع') + ' · الدخول ' + price(t.entry) + ' · الكمية ' + qty(t.qty);
    var known = market.mode === 'live' && market.candles.length && liveSymbol() === t.symbol;
    $('cl-exit').value = known ? plainPrice(market.candles[market.candles.length - 1].c) : '';
    $('cl-at').value = nowLocal();
    $('cl-fees').value = '';
    $('cl-lesson').value = '';
    renderCloseTags();
    formError('cl-error', '');
    closePreview();
    showDialog('dlg-close');
  }
  function renderCloseTags() {
    var host = clear($('cl-tag'));
    TAGS.forEach(function (x) {
      host.appendChild(h('button', { type: 'button', text: x.label, 'aria-pressed': String(closeCtx.tag === x.id),
        onclick: function () { closeCtx.tag = closeCtx.tag === x.id ? '' : x.id; renderCloseTags(); } }));
    });
  }
  function closeValues() {
    var t = state.trades.filter(function (x) { return x.id === closeCtx.id; })[0], exit = numField('cl-exit'), f = optField('cl-fees');
    if (!t || !(exit > 0)) return null;
    var fees = f === null ? autoFees(t.entry, exit, t.qty) : f;
    return { trade: t, exit: exit, fees: fees, feesOk: fees >= 0, result: C.tradeResult(Object.assign({}, t, { exit: exit, fees: fees })) };
  }
  function closePreview() {
    var p = $('cl-preview'), v = closeCtx && closeValues();
    if (!v || !v.feesOk) { p.textContent = ''; return; }
    p.className = 'preview ' + signCls(v.result.pnl);
    p.textContent = 'النتيجة ' + money(v.result.pnl, true) + (v.result.r !== null ? ' · ' + rText(v.result.r) : '') + ' · بعد عمولات ' + money(v.fees);
  }
  function saveClose(e) {
    e.preventDefault();
    var v = closeValues(), at = $('cl-at').value || nowLocal();
    if (!v) return formError('cl-error', 'سعر الخروج غير صحيح.');
    if (!v.feesOk) return formError('cl-error', 'قيمة العمولات غير صحيحة.');
    if (at < v.trade.openedAt) return formError('cl-error', 'وقت الخروج يسبق وقت الدخول.');
    var t = v.trade;
    t.status = 'closed'; t.exit = v.exit; t.closedAt = at; t.fees = v.fees; t.tag = closeCtx.tag; t.lesson = $('cl-lesson').value.trim();
    save();
    hideDialog('dlg-close');
    renderHeader();
    renderTab();
    toast('أُغلقت الصفقة: ' + money(v.result.pnl, true));
  }

  /* ---------- journal ---------- */

  var journalLimit = 30;
  function metaItem(label, value) { return h('span', null, [label + ' ', h('b', { text: value })]); }
  function tile(label, value, sub, cls) {
    return h('div', { class: 'tile' }, [h('span', { class: 'lbl', text: label }), h('b', { class: cls || '', text: value }), sub ? h('small', null, sub) : null]);
  }
  function removeTrade(t) {
    ask('حذف صفقة ' + iso(t.symbol) + ' نهائياً؟', 'حذف', true, function () {
      state.trades = state.trades.filter(function (x) { return x.id !== t.id; });
      save(); renderHeader(); renderTab(); toast('حُذفت الصفقة');
    });
  }

  function renderJournal() {
    var d = dayStatus(), s = state.settings, day = clear($('j-day'));
    var lossTile = tile('نتيجة اليوم', money(d.pnl, true), d.limit > 0 ? 'حد الخسارة اليومي ' + money(d.limit) : 'بلا حد خسارة يومي', signCls(d.pnl));
    if (d.limit > 0) lossTile.appendChild(h('div', { class: 'meter' + (d.lossUsed >= 1 ? ' full' : d.lossUsed >= 0.6 ? ' high' : ''), 'aria-hidden': 'true' }, h('i', { style: { width: (d.lossUsed * 100).toFixed(0) + '%' } })));
    day.appendChild(lossTile);
    day.appendChild(tile('صفقات اليوم', s.maxTrades > 0 ? int(d.opened) + ' من ' + int(s.maxTrades) : int(d.opened),
      s.maxTrades > 0 ? (d.opened >= s.maxTrades ? 'بلغت الحد الأقصى' : 'المتبقي ' + int(s.maxTrades - d.opened)) : 'بلا حد أقصى'));
    day.appendChild(tile('المخاطرة المفتوحة', money(d.openRisk),
      d.unprotected ? plural(d.unprotected, 'صفقة واحدة', 'صفقتان', 'صفقات', 'صفقة') + ' بلا وقف خسارة' : pct(d.balance > 0 ? d.openRisk / d.balance * 100 : 0, 2) + ' من الرصيد'));
    day.appendChild(tile('الرصيد', money(d.balance), 'الابتدائي ' + money(s.startBalance)));

    var opens = openTrades().sort(function (a, b) { return a.openedAt < b.openedAt ? 1 : -1; }), oHost = clear($('j-open'));
    $('j-open-count').textContent = opens.length ? '(' + int(opens.length) + ')' : '';
    if (!opens.length) oHost.appendChild(h('p', { class: 'hint', text: 'لا صفقات مفتوحة. سجّل صفقتك عند الدخول لتتابع مخاطرتها وتُحتسب في إحصاءاتك.' }));
    opens.forEach(function (t) {
      var risk = t.stop ? Math.abs(t.entry - t.stop) * t.qty : null;
      oHost.appendChild(h('article', { class: 'trade' }, [
        h('div', { class: 'trade-head' }, [h('span', { class: 'sym', dir: 'ltr', text: t.symbol }), sideBadge(t.side), t.setup ? h('span', { class: 'badge', text: t.setup }) : null]),
        h('div', { class: 'meta' }, [
          metaItem('الدخول', price(t.entry)), metaItem('الكمية', qty(t.qty)),
          metaItem('الوقف', t.stop ? price(t.stop) : 'غير محدد'), t.target ? metaItem('الهدف', price(t.target)) : null,
          risk !== null ? metaItem('المخاطرة', money(risk)) : null, metaItem('منذ', dayTime(t.openedAt))
        ]),
        t.notes ? h('p', { text: t.notes }) : null,
        h('div', { class: 'btn-row' }, [
          h('button', { type: 'button', class: 'btn primary sm', text: 'إغلاق الصفقة', onclick: function () { openClose(t); } }),
          h('button', { type: 'button', class: 'btn sm', text: 'تعديل', onclick: function () { openTrade(t); } }),
          h('button', { type: 'button', class: 'btn sm danger', text: 'حذف', onclick: function () { removeTrade(t); } })
        ])
      ]));
    });

    var all = closedTrades().sort(function (a, b) { return a.closedAt < b.closedAt ? 1 : -1; });
    seg($('j-filter'), [{ id: 'all', label: 'الكل' }, { id: 'win', label: 'رابحة' }, { id: 'loss', label: 'خاسرة' }], state.ui.filter,
      function (id) { state.ui.filter = id; journalLimit = 30; saveSoon(); renderJournal(); });
    var list = all.filter(function (t) {
      var p = C.tradeResult(t).pnl;
      return state.ui.filter === 'all' || (state.ui.filter === 'win' ? p > 0 : p < 0);
    });
    $('j-closed-count').textContent = all.length ? '(' + int(all.length) + ')' : '';
    var cHost = clear($('j-closed'));
    if (!list.length) cHost.appendChild(h('p', { class: 'hint', text: all.length ? 'لا صفقات بهذه التصفية.' : 'لم تُغلق أي صفقة بعد. الصفقات المغلقة تظهر هنا وتدخل في قسم الأداء.' }));
    list.slice(0, journalLimit).forEach(function (t) {
      var r = C.tradeResult(t);
      cHost.appendChild(h('article', { class: 'trade' }, [
        h('div', { class: 'trade-head' }, [
          h('span', { class: 'sym', dir: 'ltr', text: t.symbol }), sideBadge(t.side), t.setup ? h('span', { class: 'badge', text: t.setup }) : null,
          h('span', { class: 'res ' + signCls(r.pnl), text: money(r.pnl, true) + (r.r !== null ? ' · ' + rText(r.r) : '') })
        ]),
        h('div', { class: 'meta' }, [
          metaItem('الدخول', price(t.entry)), metaItem('الخروج', price(t.exit)), metaItem('الكمية', qty(t.qty)),
          metaItem('أُغلقت', dayTime(t.closedAt)), t.tag ? h('span', { class: 'badge', text: tagLabel(t.tag) }) : null
        ]),
        t.notes ? h('p', null, [h('b', { text: 'السبب: ' }), t.notes]) : null,
        t.lesson ? h('p', null, [h('b', { text: 'الدرس: ' }), t.lesson]) : null,
        h('div', { class: 'btn-row' }, [
          h('button', { type: 'button', class: 'btn sm', text: 'تعديل', onclick: function () { openTrade(t); } }),
          h('button', { type: 'button', class: 'btn sm danger', text: 'حذف', onclick: function () { removeTrade(t); } })
        ])
      ]));
    });
    $('j-more').hidden = list.length <= journalLimit;
  }

  /* ---------- performance ---------- */

  var RANGES = [{ id: 'all', label: 'الكل' }, { id: '7', label: '7 أيام' }, { id: '30', label: '30 يوماً' }, { id: '90', label: '90 يوماً' }];
  var WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  var perfDemo = false;
  var P5 = pct(5, 0), P30 = pct(30, 0), P50 = pct(50, 0);

  // Example trades for trying the section. Built in memory, never saved.
  function sampleTrades() {
    var rand = C.rng(99), out = [], setups = ['مع الاتجاه', 'اختراق', 'ارتداد من دعم'], syms = ['BTCUSDT', 'ETHUSDT', 'XAUUSD'];
    var tags = ['plan', 'plan', 'plan', 'plan', 'early', 'fomo', 'moved'], now = Date.now();
    for (var i = 0; i < 36; i++) {
      var setup = setups[i % 3], tag = tags[Math.floor(rand() * tags.length)], short = rand() < 0.3, at = new Date(now - (36 - i) * 1.55 * 864e5);
      var win = rand() < (setup === 'مع الاتجاه' ? 0.6 : setup === 'اختراق' ? 0.42 : 0.36);
      var r = win ? 0.8 + rand() * 1.9 : -(0.7 + rand() * 0.4);
      if (tag === 'fomo' || tag === 'moved') r = -(0.9 + rand() * 0.8);
      if (tag === 'early' && r > 0) r = 0.3 + rand() * 0.4;
      out.push({
        id: 's' + i, status: 'closed', symbol: syms[(i * 7) % 3], side: short ? 'short' : 'long', entry: 100, stop: short ? 102 : 98, target: null, qty: 5,
        exit: 100 + (short ? -1 : 1) * r * 2, fees: 0, openedAt: localStr(new Date(at - 5 * 36e5)), closedAt: localStr(at),
        setup: setup, tag: tag, notes: '', lesson: '', checklist: { done: tag === 'plan' ? 5 : 3, total: 5 }
      });
    }
    return out;
  }

  function insights(s, list) {
    var out = [];
    function add(kind, text) { out.push({ kind: kind, text: text }); }
    if (s.n < 10) add('', 'العينة صغيرة (' + tradesWord(s.n) + '). الأرقام تبدأ تعبّر عن أدائك بعد 20 إلى 30 صفقة مغلقة.');
    if (s.n >= 5 && s.avgR !== null) {
      if (s.avgR > 0.05) add('good', 'كل صفقة تضيف في المتوسط ' + rText(s.avgR) + ' (مضاعف المخاطرة). الأولوية الآن للثبات على القواعد نفسها.');
      else if (s.avgR < -0.05) add('bad', 'تخسر في المتوسط ' + rText(s.avgR) + ' لكل صفقة. لا تكبّر حجم صفقاتك قبل أن يصبح المتوسط موجباً.');
    }
    if (s.n >= 5 && s.payoff !== null && s.winRate < 1 / (1 + s.payoff)) {
      add('bad', 'متوسط ربحك ' + ratio(s.payoff) + ' من متوسط خسارتك، فتحتاج نسبة نجاح ' + pct(100 / (1 + s.payoff), 0) + ' للتعادل ونسبتك ' + pct(s.winRate * 100, 0) + '. اترك الرابحة تصل هدفها أو اقطع الخاسرة أبكر.');
    }
    var setups = C.groupBy(list, function (t) { return t.setup; }).filter(function (g) { return g.n >= 3; });
    if (setups.length >= 2) {
      var best = setups[0], worst = setups[setups.length - 1];
      if (best.net > 0) add('good', 'أفضل استراتيجية لديك «' + best.key + '»: ' + money(best.net, true) + ' في ' + tradesWord(best.n) + '.');
      if (worst.net < 0) add('bad', 'استراتيجية «' + worst.key + '» تخسر: ' + money(worst.net, true) + ' في ' + tradesWord(worst.n) + '. راجع شروطها أو أوقفها.');
    }
    var off = list.filter(function (t) { return t.tag && t.tag !== 'plan'; });
    if (off.length >= 3) {
      var offNet = off.reduce(function (a, t) { return a + C.tradeResult(t).pnl; }, 0);
      if (offNet < 0) add('bad', 'الصفقات التي خالفت فيها خطتك (' + tradesWord(off.length) + ') كلّفتك ' + money(-offNet) + '.');
    }
    var full = [], partial = [];
    list.forEach(function (t) { if (t.checklist && t.checklist.total) (t.checklist.done >= t.checklist.total ? full : partial).push(t); });
    if (full.length >= 3 && partial.length >= 3) {
      var a = C.stats(full).avgR, b = C.stats(partial).avgR;
      if (a !== null && b !== null && a > b) add('good', 'الصفقات المكتملة قائمة التحقق متوسطها ' + rText(a) + ' مقابل ' + rText(b) + ' لغير المكتملة.');
    }
    var days = C.groupBy(list, function (t) { return new Date(t.closedAt).getDay(); }).filter(function (g) { return g.n >= 3 && g.net < 0; });
    if (days.length && s.net > days[days.length - 1].net) add('', 'أضعف أيامك ' + WEEKDAYS[days[days.length - 1].key] + ': ' + money(days[days.length - 1].net, true) + ' في ' + tradesWord(days[days.length - 1].n) + '.');
    if (s.maxLossStreak >= 4) add('', 'أطول سلسلة خسائر متتالية: ' + int(s.maxLossStreak) + '. اختر مخاطرة للصفقة تتحمل سلسلة كهذه دون أن تضطرك للتوقف.');
    if (!out.length) add('', 'لا ملاحظات بارزة في هذه الفترة.');
    return out;
  }

  function renderBreak(id, groups, nameOf) {
    var host = clear($(id));
    if (!groups.length) { host.appendChild(h('p', { class: 'hint', text: 'لا بيانات لهذا التصنيف في الفترة المعروضة.' })); return; }
    var max = Math.max.apply(null, groups.map(function (g) { return Math.abs(g.net); })) || 1;
    host.appendChild(h('div', { class: 'brk' }, groups.map(function (g) {
      return h('div', { class: 'brk-row', role: 'group' }, [
        h('div', { class: 'brk-name' }, [nameOf(g.key), h('small', { text: tradesWord(g.n) + ' · نجاح ' + pct(g.winRate * 100, 0) + (g.avgR !== null ? ' · ' + rText(g.avgR) : '') })]),
        h('div', { class: 'brk-bar', 'aria-hidden': 'true' }, h('i', { class: g.net >= 0 ? 'pos' : 'neg', style: { width: (Math.abs(g.net) / max * 50).toFixed(1) + '%' } })),
        h('div', { class: 'brk-val ' + signCls(g.net), text: money(g.net, true) })
      ]);
    })));
  }

  function renderPerf() {
    seg($('p-range'), RANGES, state.ui.perfRange, function (id) { state.ui.perfRange = id; saveSoon(); renderPerf(); });
    var all = closedTrades(), demo = perfDemo && !all.length;
    if (demo) all = sampleTrades();
    $('p-demo').hidden = !demo;
    var cutoff = state.ui.perfRange === 'all' ? '' : localStr(new Date(Date.now() - (+state.ui.perfRange) * 864e5));
    var list = all.filter(function (t) { return t.closedAt >= cutoff; });
    var base = all.filter(function (t) { return t.closedAt < cutoff; }).reduce(function (a, t) { return a + C.tradeResult(t).pnl; }, state.settings.startBalance);
    $('p-empty').hidden = !!list.length;
    $('p-body').hidden = !list.length;
    if (!list.length) {
      $('p-empty-text').textContent = all.length ? 'لا صفقات مغلقة في هذه الفترة. جرّب فترة أطول.' : 'تظهر إحصاءاتك هنا بعد إغلاق أول صفقة من قسم «الصفقات».';
      $('p-demo-on').hidden = !!all.length;
      return;
    }
    var s = C.stats(list, base), tiles = clear($('p-tiles'));
    tiles.appendChild(tile('صافي النتيجة', money(s.net, true), tradesWord(s.n), signCls(s.net)));
    tiles.appendChild(tile('نسبة النجاح', pct(s.winRate * 100, 0), int(s.wins) + ' رابحة · ' + int(s.losses) + ' خاسرة'));
    tiles.appendChild(tile('معامل الربح', ratio(s.profitFactor), 'مجموع الأرباح ÷ مجموع الخسائر'));
    tiles.appendChild(tile('متوسط الصفقة', rText(s.avgR), money(s.expectancy, true) + ' للصفقة', signCls(s.avgR || 0)));
    tiles.appendChild(tile('متوسط الربح ÷ الخسارة', ratio(s.payoff), s.avgWin !== null && s.avgLoss !== null ? money(s.avgWin) + ' مقابل ' + money(-s.avgLoss) : 'يلزم ربح وخسارة على الأقل'));
    tiles.appendChild(tile('أقصى تراجع', pct(s.maxDDPct, 1), money(s.maxDD) + ' من القمة إلى القاع'));

    var values = [base].concat(s.curve.map(function (p) { return p.equity; })), af = axisFormatter(Math.min.apply(null, values), Math.max.apply(null, values));
    $('p-curve-cap').textContent = 'الرصيد بعد كل صفقة مغلقة، من ' + money(base) + ' إلى ' + money(values[values.length - 1]) + '.';
    Charts.lines($('p-curve'), {
      n: values.length, height: 240, zero: base, refs: [{ y: base }],
      label: 'منحنى الرصيد عبر ' + tradesWord(s.n) + '.',
      series: [{ name: 'الرصيد', values: values, cls: 's1', area: true }],
      fmtY: af, fmtVal: function (v) { return nf(2, 2).format(v); },
      xLabel: function (i) { return i === 0 ? 'البداية' : F_DAY.format(new Date(s.curve[i - 1].trade.closedAt)); },
      tipHead: function (i) { return i === 0 ? 'قبل أول صفقة' : iso(s.curve[i - 1].trade.symbol) + ' · ' + dayTime(s.curve[i - 1].trade.closedAt); },
      tipRows: function (i) {
        var rows = [{ value: money(values[i]), name: 'الرصيد', cls: 's1' }];
        if (i > 0) rows.push({ value: money(s.curve[i - 1].pnl, true), name: 'نتيجة الصفقة' });
        return rows;
      }
    });

    var ins = clear($('p-insights'));
    insights(s, list).forEach(function (x) { ins.appendChild(h('li', { class: x.kind, text: x.text })); });
    renderBreak('p-setup', C.groupBy(list, function (t) { return t.setup; }), function (k) { return k; });
    renderBreak('p-symbol', C.groupBy(list, function (t) { return t.symbol; }), function (k) { return h('span', { dir: 'ltr', text: k }); });
    renderBreak('p-weekday', C.groupBy(list, function (t) { return new Date(t.closedAt).getDay(); }).sort(function (a, b) { return a.key - b.key; }), function (k) { return WEEKDAYS[k]; });
    renderBreak('p-tag', C.groupBy(list, function (t) { return t.tag; }), tagLabel);
  }

  /* ---------- backtest ---------- */

  var STRATS = {
    emaCross: {
      label: 'تقاطع المتوسطات (مع الاتجاه)', desc: 'تدخل عندما يصعد المتوسط السريع فوق البطيء، وتخرج عند العكس.',
      fields: [['fast', 'المتوسط السريع', 2, 200], ['slow', 'المتوسط البطيء', 3, 400]]
    },
    rsiReversion: {
      label: 'ارتداد RSI (عكس الحركة)', desc: 'تشتري عند التشبّع البيعي حين ينخفض RSI، وتخرج بعد أن يستعيد الزخم.',
      fields: [['period', 'فترة RSI', 2, 50], ['buy', 'شراء تحت RSI', 5, 50], ['exit', 'خروج فوق RSI', 40, 95]]
    },
    breakout: {
      label: 'اختراق القمم', desc: 'تدخل عند إغلاق فوق أعلى قمة لعدد من الشموع، وتخرج عند كسر أدنى قاع لعدد آخر.',
      fields: [['entry', 'قمة آخر كم شمعة', 5, 200], ['exit', 'قاع آخر كم شمعة', 3, 200]]
    }
  };

  function renderTestData() {
    var n = market.candles.length, text;
    if (!n) text = 'لا توجد أسعار محمّلة. افتح قسم «السوق» واختر أصلاً أو استورد ملف CSV.';
    else {
      text = 'البيانات: ' + marketName() + (market.mode === 'csv' ? '' : ' · ' + intervalDef().label) + ' · ' + candlesWord(n) +
        '، من ' + F_FULL.format(new Date(market.candles[0].t)) + ' إلى ' + F_FULL.format(new Date(market.candles[n - 1].t)) + '.';
      if (!realPrices()) text += ' هذه بيانات تجريبية مولّدة، فالنتيجة للتجربة فقط.';
      else text += ' لتغييرها اختر أصلاً أو إطاراً آخر من قسم «السوق».';
    }
    $('t-data').textContent = text;
  }

  function renderTest() {
    var bt = state.bt, sel = $('t-strat');
    if (!sel.options.length) Object.keys(STRATS).forEach(function (id) { sel.appendChild(h('option', { value: id, text: STRATS[id].label })); });
    sel.value = bt.strat;
    $('t-desc').textContent = STRATS[bt.strat].desc;
    var host = clear($('t-params'));
    STRATS[bt.strat].fields.forEach(function (f) {
      var input = h('input', { id: 't-p-' + f[0], class: 'input num', dir: 'ltr', inputmode: 'numeric', value: String(bt.p[bt.strat][f[0]]) });
      input.addEventListener('input', runTest);
      host.appendChild(h('div', { class: 'field' }, [h('label', { 'for': 't-p-' + f[0], text: f[1] }), input]));
    });
    $('t-fee').value = bt.fee;
    $('t-fee').placeholder = plain(state.settings.feePct, 3);
    $('t-stop').value = bt.stop;
    $('t-short').checked = bt.short;
    renderTestData();
    runTest();
    $('mc-win').value = state.mc.win; $('mc-rr').value = state.mc.rr; $('mc-risk').value = state.mc.risk; $('mc-trades').value = state.mc.trades;
    runMc();
  }

  function runTest() {
    var bt = state.bt, def = STRATS[bt.strat], out = clear($('t-out')), k = market.candles, params = {}, err = '';
    bt.fee = $('t-fee').value; bt.stop = $('t-stop').value; bt.short = $('t-short').checked;
    def.fields.forEach(function (f) {
      var el = $('t-p-' + f[0]), v = el ? C.parseNum(el.value) : NaN;
      if (!(v >= f[2] && v <= f[3]) || v % 1) err = err || '«' + f[1] + '» يجب أن يكون عدداً صحيحاً بين ' + int(f[2]) + ' و' + int(f[3]) + '.';
      else params[f[0]] = bt.p[bt.strat][f[0]] = v;
    });
    var fee = bt.fee.trim() === '' ? state.settings.feePct : C.parseNum(bt.fee), stopAtr = bt.stop.trim() === '' ? 0 : C.parseNum(bt.stop);
    if (!err && bt.strat === 'emaCross' && params.fast >= params.slow) err = 'المتوسط السريع يجب أن يكون أقصر من البطيء.';
    if (!err && bt.strat === 'rsiReversion' && params.buy >= params.exit) err = 'حد الخروج يجب أن يكون أعلى من حد الشراء.';
    if (!err && !(fee >= 0 && fee < 10)) err = 'نسبة العمولة غير صحيحة.';
    if (!err && !(stopAtr >= 0 && stopAtr <= 20)) err = 'مضاعف ATR يجب أن يكون بين 0 و20.';
    if (!err && k.length < 60) err = k.length ? 'يلزم 60 شمعة على الأقل للاختبار، والمتوفر ' + int(k.length) + '.' : 'حمّل أسعاراً من قسم «السوق» أولاً.';
    if (err) { out.appendChild(h('p', { class: 'form-error', text: err })); return; }
    saveSoon();

    var r = C.backtest(k, bt.strat, params, { feePct: fee, stopAtr: stopAtr, allowShort: bt.short });
    var diff = (r.totalReturn - r.holdReturn) * 100;
    out.appendChild(h('div', { class: 'tiles' }, [
      tile('عائد الاستراتيجية', pct(r.totalReturn * 100, 1, true), 'بعد العمولات', signCls(r.totalReturn)),
      tile('الشراء والاحتفاظ', pct(r.holdReturn * 100, 1, true), 'للفترة نفسها', signCls(r.holdReturn)),
      tile('أقصى تراجع', pct(r.maxDD * 100, 1), 'الاحتفاظ ' + pct(r.holdMaxDD * 100, 1)),
      tile('عدد الصفقات', int(r.nTrades), r.winRate !== null ? 'نجاح ' + pct(r.winRate * 100, 0) : 'لم تتحقق شروط الدخول'),
      tile('معامل الربح', ratio(r.profitFactor), 'مجموع الأرباح ÷ مجموع الخسائر'),
      tile('الوقت داخل السوق', pct(r.exposure * 100, 0), 'من مدة البيانات')
    ]));
    var verdict = !r.nTrades ? 'لم تظهر أي إشارة دخول في هذه البيانات بهذه الإعدادات.'
      : (diff >= 0 ? 'الاستراتيجية تفوقت على الشراء والاحتفاظ بفارق ' : 'الاستراتيجية أقل من الشراء والاحتفاظ بفارق ') + pct(Math.abs(diff), 1) +
        (r.maxDD < r.holdMaxDD ? '، وبتراجع أقصى أخف.' : '، وبتراجع أقصى أشد أو مماثل.');
    if (r.nTrades && r.nTrades < 30) verdict += ' عدد الصفقات (' + int(r.nTrades) + ') قليل للحكم؛ جرّب إطاراً زمنياً أصغر أو بيانات أطول.';
    out.appendChild(h('p', { class: 'hint', text: verdict }));
    out.appendChild(h('ul', { class: 'legend', 'aria-label': 'مفتاح الرسم' }, [
      h('li', null, [h('span', { class: 'k-line s1' }), 'الاستراتيجية']), h('li', null, [h('span', { class: 'k-line sctx' }), 'الشراء والاحتفاظ'])
    ]));
    var chart = h('div', { dir: 'ltr' });
    out.appendChild(chart);
    var eq = r.equity.map(function (v) { return v * 100; }), hold = r.hold.map(function (v) { return v * 100; }), daily = k[k.length - 1].t - k[k.length - 2].t >= 864e5;
    Charts.lines(chart, {
      n: k.length, height: 260, refs: [{ y: 100 }],
      label: 'قيمة 100 مستثمرة: الاستراتيجية مقابل الشراء والاحتفاظ.',
      series: [{ name: 'الشراء والاحتفاظ', values: hold, cls: 'sctx' }, { name: 'الاستراتيجية', values: eq, cls: 's1' }],
      fmtY: axisFormatter(Math.min.apply(null, eq.concat(hold)), Math.max.apply(null, eq.concat(hold))), fmtVal: function (v) { return nf(1, 1).format(v); },
      xLabel: function (i) { return (k[k.length - 1].t - k[0].t > 400 * 864e5 ? F_MONTH : F_DAY).format(new Date(k[i].t)); },
      tipHead: function (i) { return daily ? F_FULL.format(new Date(k[i].t)) : dayTime(k[i].t); }
    });
    out.appendChild(h('p', { class: 'hint', text: 'الرسم يبيّن قيمة 100 مستثمرة من أول البيانات. التنفيذ عند افتتاح الشمعة التالية للإشارة، برأس المال كاملاً في كل صفقة. نتائج الماضي لا تضمن المستقبل، وتعديل الأرقام حتى تتحسن النتيجة يطابقها على الماضي فقط.' }));

    if (r.nTrades) {
      var REASON = { signal: 'إشارة خروج', stop: 'وقف الخسارة', end: 'نهاية البيانات' };
      var body = h('tbody');
      r.trades.slice(-100).reverse().forEach(function (t) {
        body.appendChild(h('tr', null, [
          h('td', { text: t.side === 'long' ? 'شراء' : 'بيع' }),
          h('td', { text: (daily ? F_FULL.format(new Date(t.entryT)) : dayTime(t.entryT)) + ' · ' + price(t.entryP) }),
          h('td', { text: (daily ? F_FULL.format(new Date(t.exitT)) : dayTime(t.exitT)) + ' · ' + price(t.exitP) }),
          h('td', { class: signCls(t.ret), text: pct(t.ret * 100, 2, true) }),
          h('td', { text: REASON[t.reason] })
        ]));
      });
      out.appendChild(h('details', { class: 'more' }, [
        h('summary', { text: 'جدول الصفقات (' + int(r.nTrades) + ')' }),
        h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, [
          h('thead', null, h('tr', null, ['الاتجاه', 'الدخول', 'الخروج', 'العائد', 'سبب الخروج'].map(function (x) { return h('th', { scope: 'col', text: x }); }))), body
        ]))
      ]));
    }
  }

  /* ---------- Monte Carlo ---------- */

  var mcTimer = 0;
  function runMcSoon() { clearTimeout(mcTimer); mcTimer = setTimeout(runMc, 200); }

  function runMc() {
    var m = state.mc, out = clear($('mc-out'));
    m.win = $('mc-win').value; m.rr = $('mc-rr').value; m.risk = $('mc-risk').value; m.trades = $('mc-trades').value;
    var win = C.parseNum(m.win), rr = C.parseNum(m.rr), risk = C.parseNum(m.risk), n = C.parseNum(m.trades), err = '';
    if (!(win >= 1 && win <= 99)) err = 'نسبة النجاح يجب أن تكون بين 1 و99.';
    else if (!(rr > 0 && rr <= 50)) err = 'متوسط الربح ÷ متوسط الخسارة يجب أن يكون أكبر من صفر.';
    else if (!(risk > 0 && risk <= 50)) err = 'المخاطرة يجب أن تكون أكبر من صفر ولا تتجاوز 50.';
    else if (!(n >= 10 && n <= 500) || n % 1) err = 'عدد الصفقات يجب أن يكون عدداً صحيحاً بين 10 و500.';
    if (err) { out.appendChild(h('p', { class: 'form-error', text: err })); return; }
    saveSoon();

    var bal = balance(), base = { winRate: win / 100, rr: rr, trades: n, runs: 1000 };
    var r = C.monteCarlo(Object.assign({ riskPct: risk }, base)), edge = (win / 100) * rr - (1 - win / 100);
    out.appendChild(h('div', { class: 'tiles' }, [
      tile('الرصيد الأوسط بعد ' + int(n) + ' صفقة', money(bal * r.final.p50), 'نصف الحالات فوقه ونصفها تحته', signCls(r.final.p50 - 1)),
      tile('أسوأ ' + P5 + ' من الحالات', money(bal * r.final.p5), 'أو أقل'),
      tile('أفضل ' + P5 + ' من الحالات', money(bal * r.final.p95), 'أو أكثر'),
      tile('احتمال الانتهاء بخسارة', pct(r.probLoss * 100, 0), 'من 1000 محاكاة'),
      tile('أقصى تراجع متوقع', pct(r.dd.p50 * 100, 0), 'وفي أسوأ ' + P5 + ' من الحالات ' + pct(r.dd.p95 * 100, 0)),
      tile('احتمال تراجع ' + P30 + ' أو أكثر', pct(r.probDD(0.3) * 100, 0), 'في أي لحظة خلال السلسلة')
    ]));
    out.appendChild(h('p', { class: 'hint', text: edge > 0
      ? 'بهذه الأرقام كل صفقة تضيف في المتوسط ' + rText(edge) + '، ومع ذلك تتفاوت النتائج كثيراً بحسب ترتيب الرابح والخاسر.'
      : 'بهذه الأرقام متوسط الصفقة ' + rText(edge) + ': النظام خاسر على المدى الطويل، وأي نسبة مخاطرة لا تصلحه.' }));
    out.appendChild(h('ul', { class: 'legend', 'aria-label': 'مفتاح الرسم' }, [
      h('li', null, [h('span', { class: 'k-line s1' }), 'الحالة الوسطى']), h('li', null, [h('span', { class: 'k-band' }), 'بين أسوأ ' + P5 + ' وأفضل ' + P5])
    ]));
    var chart = h('div', { dir: 'ltr' });
    out.appendChild(chart);
    var p5 = r.bands.p5.map(function (v) { return v * bal; }), p50 = r.bands.p50.map(function (v) { return v * bal; }), p95 = r.bands.p95.map(function (v) { return v * bal; });
    Charts.lines(chart, {
      n: n + 1, height: 240, refs: [{ y: bal }],
      label: 'مدى الرصيد المتوقع عبر ' + int(n) + ' صفقة.',
      band: { lo: p5, hi: p95, cls: 's1 band' },
      series: [{ name: 'الحالة الوسطى', values: p50, cls: 's1' }],
      fmtY: axisFormatter(Math.min.apply(null, p5), Math.max.apply(null, p95)),
      xLabel: function (i) { return 'صفقة ' + i; },
      tipHead: function (i) { return i === 0 ? 'البداية' : 'بعد ' + tradesWord(i); },
      tipRows: function (i) {
        return [{ value: money(p95[i]), name: 'أفضل ' + P5 }, { value: money(p50[i]), name: 'الوسطى', cls: 's1' }, { value: money(p5[i]), name: 'أسوأ ' + P5 }];
      }
    });

    var body = h('tbody');
    [0.5, 1, 2, 5, 10].forEach(function (rk) {
      var x = C.monteCarlo(Object.assign({ riskPct: rk, bands: false }, base));
      body.appendChild(h('tr', null, [
        h('th', { scope: 'row', text: pct(rk, rk % 1 ? 1 : 0) }), h('td', { text: money(bal * x.final.p50) }), h('td', { text: pct(x.dd.p50 * 100, 0) }),
        h('td', { text: pct(x.probDD(0.3) * 100, 0) }), h('td', { text: pct(x.probDD(0.5) * 100, 0) })
      ]));
    });
    out.appendChild(h('h3', { text: 'أثر نسبة المخاطرة على النظام نفسه' }));
    out.appendChild(h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, [
      h('thead', null, h('tr', null, ['المخاطرة للصفقة', 'الرصيد الأوسط', 'أقصى تراجع متوقع', 'احتمال تراجع ' + P30, 'احتمال تراجع ' + P50].map(function (x) { return h('th', { scope: 'col', text: x }); }))), body
    ])));
  }

  function fillMcFromJournal() {
    var s = C.stats(closedTrades());
    if (s.n < 10 || s.payoff === null) return toast('يلزم 10 صفقات مغلقة على الأقل، فيها رابح وخاسر');
    $('mc-win').value = plain(clamp(s.winRate * 100, 1, 99), 0);
    $('mc-rr').value = plain(s.payoff, 2);
    runMc();
    toast('مُلئت الخانات من ' + tradesWord(s.n));
  }

  /* ---------- settings, backup ---------- */

  var draftChecklist = [];
  function renderDraftChecklist() {
    var list = clear($('st-checklist'));
    draftChecklist.forEach(function (text, i) {
      list.appendChild(h('li', null, [
        h('span', { text: text }),
        h('button', { type: 'button', class: 'icon-btn ghost sm', 'aria-label': 'حذف البند: ' + text, onclick: function () { draftChecklist.splice(i, 1); renderDraftChecklist(); } },
          h('span', { 'aria-hidden': 'true', text: '×' }))
      ]));
    });
    if (!draftChecklist.length) list.appendChild(h('li', null, h('span', { class: 'hint', text: 'القائمة فارغة.' })));
  }
  function addChecklistItem() {
    var el = $('st-check-new'), v = el.value.trim();
    if (!v || draftChecklist.length >= 12) return;
    draftChecklist.push(v);
    el.value = '';
    renderDraftChecklist();
  }

  function openSettings() {
    var s = state.settings;
    $('st-balance').value = plain(s.startBalance, 2);
    $('st-currency').value = s.currency;
    $('st-risk').value = plain(s.riskPct, 2);
    $('st-daily').value = plain(s.dailyLossPct, 2);
    $('st-max').value = String(s.maxTrades);
    $('st-fee').value = plain(s.feePct, 3);
    $('st-balance-note').textContent = 'الرصيد الحالي ' + money(balance()) + ' = الرصيد الابتدائي + نتائج الصفقات المغلقة. عند الإيداع أو السحب عدّل الرصيد الابتدائي.';
    draftChecklist = s.checklist.slice();
    renderDraftChecklist();
    $('st-check-new').value = '';
    $('bk-msg').textContent = '';
    $('bk-text').hidden = true;
    formError('st-error', '');
    showDialog('dlg-settings');
  }

  function saveSettings(e) {
    e.preventDefault();
    var bal = numField('st-balance'), risk = numField('st-risk'), daily = numField('st-daily'), max = numField('st-max'), fee = numField('st-fee'), err = '';
    if (!(bal > 0)) err = 'الرصيد الابتدائي يجب أن يكون رقماً أكبر من صفر.';
    else if (!(risk > 0 && risk <= 100)) err = 'المخاطرة لكل صفقة يجب أن تكون أكبر من صفر ولا تتجاوز 100.';
    else if (!(daily >= 0 && daily <= 100)) err = 'حد الخسارة اليومي يجب أن يكون بين 0 و100.';
    else if (!(max >= 0 && max <= 500) || max % 1) err = 'أقصى عدد صفقات يجب أن يكون عدداً صحيحاً (0 بلا حد).';
    else if (!(fee >= 0 && fee < 10)) err = 'نسبة العمولة غير صحيحة.';
    if (err) return formError('st-error', err);
    addChecklistItem();
    var s = state.settings;
    s.startBalance = bal; s.riskPct = risk; s.dailyLossPct = daily; s.maxTrades = max; s.feePct = fee;
    s.currency = $('st-currency').value.trim() || '$';
    s.checklist = draftChecklist.slice();
    state.ui.welcomed = true;
    calcChecks = {};
    save();
    hideDialog('dlg-settings');
    renderHeader();
    renderTab();
    toast('حُفظت الخطة');
  }

  function backupText() {
    return JSON.stringify({ app: 'trading-assistant', v: 1, savedAt: new Date().toISOString(), settings: state.settings, trades: state.trades, bt: state.bt, mc: state.mc });
  }
  function csvCell(v) { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function tradesCsv() {
    var rows = [['symbol', 'side', 'entry', 'stop', 'target', 'qty', 'opened_at', 'exit', 'closed_at', 'fees', 'pnl', 'r_multiple', 'setup', 'execution', 'notes', 'lesson']];
    state.trades.slice().sort(function (a, b) { return a.openedAt < b.openedAt ? -1 : 1; }).forEach(function (t) {
      var r = t.status === 'closed' ? C.tradeResult(t) : null;
      rows.push([t.symbol, t.side, t.entry, t.stop, t.target, t.qty, t.openedAt, t.exit, t.closedAt, r ? plain(t.fees, 4) : '',
        r ? plain(r.pnl, 2) : '', r && r.r !== null ? plain(r.r, 2) : '', t.setup, tagLabel(t.tag), t.notes, t.lesson]);
    });
    return '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }
  function showBackupText(msg) {
    var box = $('bk-text');
    box.value = backupText();
    box.hidden = false;
    box.focus();
    box.select();
    $('bk-msg').textContent = msg;
  }
  function restoreBackup(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { data = null; }
    if (!data || data.app !== 'trading-assistant' || !Array.isArray(data.trades)) { $('bk-msg').textContent = 'هذا الملف ليس نسخة احتياطية من مساعد التداول.'; return; }
    ask('استرجاع النسخة يستبدل البيانات الحالية (' + tradesWord(state.trades.length) + ') بما في الملف (' + tradesWord(data.trades.length) + '). متابعة؟', 'استرجاع', false, function () {
      var fresh = adopt(defaults(), data);
      fresh.ui = state.ui; fresh.cache = state.cache; fresh.csv = state.csv; fresh.calc = state.calc;
      fresh.ui.welcomed = true;
      state = fresh;
      save();
      hideDialog('dlg-settings');
      renderHeader();
      renderTab();
      toast('استُرجعت ' + tradesWord(state.trades.length));
    });
  }

  /* ---------- CSV import ---------- */

  var CSV_ERR = {
    empty: 'الملف فارغ أو فيه صف واحد فقط.',
    columns: 'لم نجد عمودي التاريخ والإغلاق. يجب أن يحوي الصف الأول أسماء الأعمدة، مثل: Date, Open, High, Low, Close.',
    rows: 'لم نستطع قراءة أي صف. تحقق من صيغة التواريخ والأرقام في الملف.'
  };
  function importCsv(text, name) {
    var res = C.parseCsv(text);
    if (res.error) return formError('csv-error', CSV_ERR[res.error]);
    if (res.candles.length < 30) return formError('csv-error', 'في الملف ' + candlesWord(res.candles.length) + ' فقط، ويلزم 30 على الأقل.');
    state.csv = { name: (name || 'CSV').toUpperCase().slice(0, 20), rows: pack(res.candles.slice(-2000)), closeOnly: !!res.closeOnly };
    state.ui.symbol = '@csv';
    market.count = 0;
    save();
    buildSymbolSelect();
    hideDialog('dlg-csv');
    showTab('market');
    loadMarket();
    toast('استُوردت ' + candlesWord(Math.min(2000, res.candles.length)) + (res.skipped ? '، وتُجوهلت ' + int(res.skipped) + ' صفوف غير مقروءة' : ''));
  }
  function submitCsv(e) {
    e.preventDefault();
    formError('csv-error', '');
    var file = $('csv-file').files[0], name = $('csv-name').value.trim(), pasted = $('csv-text').value;
    if (file) {
      var reader = new FileReader();
      reader.onload = function () { importCsv(String(reader.result), name || file.name.replace(/\.[^.]*$/, '')); };
      reader.onerror = function () { formError('csv-error', 'تعذّرت قراءة الملف.'); };
      reader.readAsText(file);
    } else if (pasted.trim()) importCsv(pasted, name);
    else formError('csv-error', 'اختر ملفاً أو الصق محتواه.');
  }

  /* ---------- tabs ---------- */

  var RENDER = { market: renderMarket, calc: renderCalc, journal: renderJournal, perf: renderPerf, test: renderTest };
  function renderTab() { RENDER[state.ui.tab](); }
  function showTab(tab) {
    if (!RENDER[tab]) tab = 'market';
    state.ui.tab = tab;
    Object.keys(RENDER).forEach(function (id) { $('view-' + id).hidden = id !== tab; });
    Array.prototype.forEach.call($('tabs').children, function (b) {
      if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    saveSoon();
    renderTab();
  }

  /* ---------- wiring ---------- */

  function on(id, type, fn) { $(id).addEventListener(type, fn); }

  function init() {
    buildSymbolSelect();
    $('m-custom').value = state.ui.custom;

    on('tabs', 'click', function (e) { var b = e.target.closest('button[data-tab]'); if (b) showTab(b.dataset.tab); });
    on('open-settings', 'click', openSettings);
    on('welcome-go', 'click', openSettings);
    on('welcome-skip', 'click', function () { state.ui.welcomed = true; save(); renderHeader(); });

    on('m-symbol', 'change', function () {
      state.ui.symbol = $('m-symbol').value;
      market.count = 0;
      save();
      loadMarket();
      if (state.ui.symbol === '@custom') $('m-custom').focus();
    });
    function goCustom() { state.ui.custom = $('m-custom').value.trim().toUpperCase(); $('m-custom').value = state.ui.custom; save(); loadMarket(); }
    on('m-custom-go', 'click', goCustom);
    on('m-custom', 'keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); goCustom(); } });
    on('m-refresh', 'click', loadMarket);
    on('m-import', 'click', function () {
      $('csv-file').value = ''; $('csv-text').value = ''; $('csv-name').value = state.csv ? state.csv.name : '';
      formError('csv-error', '');
      showDialog('dlg-csv');
    });
    function shift(by) { market.offset += by; drawMarketCharts(); }
    on('m-older', 'click', function () { shift(Math.max(1, Math.round((market.shown || 60) / 3))); });
    on('m-newer', 'click', function () { shift(-Math.max(1, Math.round((market.shown || 60) / 3))); });
    on('m-latest', 'click', function () { market.offset = 0; drawMarketCharts(); });
    on('m-zoom-in', 'click', function () { market.count = Math.round((market.shown || 60) / 1.4); drawMarketCharts(); });
    on('m-zoom-out', 'click', function () { market.count = Math.round((market.shown || 60) * 1.4); drawMarketCharts(); });

    Object.keys(CALC_FIELDS).forEach(function (id) {
      on(id, 'input', function () {
        state.calc[CALC_FIELDS[id]] = $(id).value;
        saveSoon();
        renderCalcResult();
      });
    });
    on('calc-form', 'submit', function (e) { e.preventDefault(); });
    on('c-reset', 'click', function () {
      Object.keys(state.calc).forEach(function (k) { state.calc[k] = ''; });
      calcChecks = {};
      save();
      renderCalc();
    });
    on('c-log', 'click', function () {
      if (!calcRes) return toast('أكمل سعر الدخول ووقف الخسارة أولاً');
      var total = state.settings.checklist.length, done = 0, v = calcRes.values;
      for (var i = 0; i < total; i++) if (calcChecks[i]) done++;
      openTrade(null, {
        fromCalc: true, symbol: state.calc.symbol.trim().toUpperCase(), side: calcRes.side, entry: v.entry, stop: v.stop, target: v.target,
        qty: calcRes.qty, checklist: total ? { done: done, total: total } : null
      });
    });

    on('j-add', 'click', function () { openTrade(null); });
    on('j-more', 'click', function () { journalLimit += 30; renderJournal(); });
    on('p-demo-on', 'click', function () { perfDemo = true; renderPerf(); });
    on('p-demo-off', 'click', function () { perfDemo = false; renderPerf(); });

    on('t-strat', 'change', function () { state.bt.strat = $('t-strat').value; renderTest(); });
    ['t-fee', 't-stop'].forEach(function (id) { on(id, 'input', runTest); });
    on('t-short', 'change', runTest);
    on('t-form', 'submit', function (e) { e.preventDefault(); });
    ['mc-win', 'mc-rr', 'mc-risk', 'mc-trades'].forEach(function (id) { on(id, 'input', runMcSoon); });
    on('mc-form', 'submit', function (e) { e.preventDefault(); });
    on('mc-fill', 'click', fillMcFromJournal);

    Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) {
      b.addEventListener('click', function () { hideDialog(b.closest('dialog').id); });
    });
    on('tr-side', 'click', function (e) { var b = e.target.closest('button[data-side]'); if (b) setTradeSide(b.dataset.side); });
    on('tr-closed', 'change', function () {
      $('tr-close-fields').hidden = !$('tr-closed').checked;
      if ($('tr-closed').checked && !$('tr-closed-at').value) $('tr-closed-at').value = nowLocal();
    });
    on('tr-form', 'submit', saveTrade);
    on('cl-form', 'submit', saveClose);
    on('cl-exit', 'input', closePreview);
    on('cl-fees', 'input', closePreview);
    on('st-form', 'submit', saveSettings);
    on('st-check-add', 'click', addChecklistItem);
    on('st-check-new', 'keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addChecklistItem(); } });
    on('csv-form', 'submit', submitCsv);
    on('cf-form', 'submit', function (e) {
      e.preventDefault();
      var cb = confirmCb;
      confirmCb = null;
      hideDialog('dlg-confirm');
      if (cb) cb();
    });

    on('bk-save', 'click', function () {
      var ok = download('trading-backup-' + nowLocal().slice(0, 10) + '.json', backupText(), 'application/json');
      $('bk-msg').textContent = ok ? 'بدأ حفظ الملف. إن لم يظهر في تنزيلاتك استخدم «نسخ النسخة كنص».' : 'تعذّر حفظ الملف هنا. استخدم «نسخ النسخة كنص».';
    });
    on('bk-csv', 'click', function () {
      if (!state.trades.length) { $('bk-msg').textContent = 'لا صفقات لتصديرها بعد.'; return; }
      download('trades-' + nowLocal().slice(0, 10) + '.csv', tradesCsv(), 'text/csv');
      $('bk-msg').textContent = 'بدأ حفظ ملف الصفقات. يفتح في Excel مباشرة.';
    });
    on('bk-copy', 'click', function () {
      var text = backupText();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { $('bk-msg').textContent = 'نُسخت النسخة. الصقها في ملاحظة أو رسالة لنفسك واحفظها.'; },
          function () { showBackupText('حدّد النص التالي وانسخه ثم احفظه في مكان آمن.'); });
      } else showBackupText('حدّد النص التالي وانسخه ثم احفظه في مكان آمن.');
    });
    on('bk-load', 'click', function () { $('bk-file').value = ''; $('bk-file').click(); });
    on('bk-file', 'change', function () {
      var file = $('bk-file').files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { restoreBackup(String(reader.result)); };
      reader.onerror = function () { $('bk-msg').textContent = 'تعذّرت قراءة الملف.'; };
      reader.readAsText(file);
    });
    on('st-wipe', 'click', function () {
      ask('حذف كل الصفقات (' + tradesWord(state.trades.length) + ') والإعدادات من هذا الجهاز نهائياً؟ احفظ نسخة أولاً إن أردت الرجوع إليها.', 'حذف الكل', true, function () {
        try { localStorage.removeItem(KEY); } catch (e) { /* nothing stored */ }
        state = defaults();
        calcChecks = {}; perfDemo = false; market.key = '';
        save();
        buildSymbolSelect();
        hideDialog('dlg-settings');
        renderHeader();
        showTab('market');
        loadMarket();
        toast('حُذفت البيانات');
      });
    });

    var resizeTimer = 0, lastWidth = window.innerWidth;
    window.addEventListener('resize', function () {
      if (window.innerWidth === lastWidth) return;   // phones fire resize when the address bar hides
      lastWidth = window.innerWidth;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderTab, 150);
    });
    function refreshIfStale() {
      if (document.hidden) return;
      renderHeader();
      if (state.ui.tab === 'market' && isLiveSelection() && !market.loading && Date.now() - market.at > 55000) loadMarket();
    }
    document.addEventListener('visibilitychange', refreshIfStale);
    setInterval(refreshIfStale, 60000);

    renderHeader();
    showTab(state.ui.tab);
    loadMarket();

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      try { navigator.serviceWorker.register('./sw.js').catch(function () {}); } catch (e) { /* not available here */ }
    }
  }

  init();
})();
