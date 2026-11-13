/* مساعد التداول — الحسابات البحتة (بلا واجهة): المؤشرات الفنية، حجم الصفقة، إحصاءات السجل،
   الاختبار الرجعي، محاكاة مونت كارلو، وقراءة ملفات CSV. يُختبر عبر: node --test trading/tests */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TradingCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var C = {};

  function filled(n) { var a = new Array(n); for (var i = 0; i < n; i++) a[i] = null; return a; }

  /* ---------- numbers ---------- */

  // Accepts Arabic-Indic digits, Arabic separators, thousands commas and a decimal comma.
  C.parseNum = function (s) {
    if (typeof s === 'number') return isFinite(s) ? s : NaN;
    if (s == null) return NaN;
    s = String(s).trim();
    if (!s) return NaN;
    s = s.replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
         .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); })
         .replace(/٫/g, '.')
         .replace(/[٬\s ⁦-⁩‎‏_']/g, '')
         .replace(/−/g, '-');
    var commas = (s.match(/,/g) || []).length;
    if (commas) {
      if (s.indexOf('.') !== -1 || commas > 1) s = s.replace(/,/g, '');
      else {
        var parts = s.split(',');
        // "1,234" is a thousands group; "0,5" and "12,75" use a decimal comma
        s = (parts[1].length === 3 && /^[-+]?[1-9]\d{0,2}$/.test(parts[0])) ? parts.join('') : parts.join('.');
      }
    }
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
    return parseFloat(s);
  };

  /* ---------- indicators (arrays aligned to the input, null during warm-up) ---------- */

  C.sma = function (v, n) {
    var out = filled(v.length), sum = 0;
    for (var i = 0; i < v.length; i++) {
      sum += v[i];
      if (i >= n) sum -= v[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  };

  // Seeded with the SMA of the first n values.
  C.ema = function (v, n) {
    var out = filled(v.length);
    if (v.length < n || n < 1) return out;
    var k = 2 / (n + 1), sum = 0, i;
    for (i = 0; i < n; i++) sum += v[i];
    var prev = sum / n;
    out[n - 1] = prev;
    for (i = n; i < v.length; i++) { prev = v[i] * k + prev * (1 - k); out[i] = prev; }
    return out;
  };

  // Wilder's RSI.
  C.rsi = function (c, n) {
    n = n || 14;
    var out = filled(c.length);
    if (c.length <= n) return out;
    var g = 0, l = 0, i, d;
    function val() { return l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l); }
    for (i = 1; i <= n; i++) { d = c[i] - c[i - 1]; if (d >= 0) g += d; else l -= d; }
    g /= n; l /= n;
    out[n] = val();
    for (i = n + 1; i < c.length; i++) {
      d = c[i] - c[i - 1];
      g = (g * (n - 1) + (d > 0 ? d : 0)) / n;
      l = (l * (n - 1) + (d < 0 ? -d : 0)) / n;
      out[i] = val();
    }
    return out;
  };

  // Wilder's Average True Range.
  C.atr = function (k, n) {
    n = n || 14;
    var out = filled(k.length);
    if (k.length < n) return out;
    var tr = [], i;
    for (i = 0; i < k.length; i++) {
      var hl = k[i].h - k[i].l;
      tr.push(i === 0 ? hl : Math.max(hl, Math.abs(k[i].h - k[i - 1].c), Math.abs(k[i].l - k[i - 1].c)));
    }
    var sum = 0;
    for (i = 0; i < n; i++) sum += tr[i];
    var prev = sum / n;
    out[n - 1] = prev;
    for (i = n; i < k.length; i++) { prev = (prev * (n - 1) + tr[i]) / n; out[i] = prev; }
    return out;
  };

  C.macd = function (c, fast, slow, sig) {
    fast = fast || 12; slow = slow || 26; sig = sig || 9;
    var ef = C.ema(c, fast), es = C.ema(c, slow), n = c.length;
    var line = filled(n), signal = filled(n), hist = filled(n), vals = [], start = -1, i;
    for (i = 0; i < n; i++) {
      if (ef[i] == null || es[i] == null) continue;
      line[i] = ef[i] - es[i];
      if (start < 0) start = i;
      vals.push(line[i]);
    }
    var se = C.ema(vals, sig);
    for (i = 0; i < vals.length; i++) {
      if (se[i] == null) continue;
      signal[start + i] = se[i];
      hist[start + i] = vals[i] - se[i];
    }
    return { line: line, signal: signal, hist: hist };
  };

  // Nearest swing low below the last close and nearest swing high above it.
  C.levels = function (k, span, lookback) {
    span = span || 3; lookback = lookback || 150;
    var n = k.length, sup = null, res = null;
    if (!n) return { support: null, resistance: null };
    var price = k[n - 1].c;
    for (var i = Math.max(span, n - lookback); i < n - span; i++) {
      var hi = true, lo = true;
      for (var j = i - span; j <= i + span; j++) {
        if (j === i) continue;
        if (k[j].h >= k[i].h) hi = false;
        if (k[j].l <= k[i].l) lo = false;
      }
      if (hi && k[i].h > price && (res === null || k[i].h < res)) res = k[i].h;
      if (lo && k[i].l < price && (sup === null || k[i].l > sup)) sup = k[i].l;
    }
    return { support: sup, resistance: res };
  };

  /* ---------- technical reading: a weighted description of the indicators, not a forecast ---------- */

  C.MIN_ANALYZE = 60;

  C.analyze = function (k) {
    var n = k.length;
    if (n < C.MIN_ANALYZE) return null;
    var c = k.map(function (x) { return x.c; }), last = n - 1, price = c[last];
    var e20 = C.ema(c, 20), e50 = C.ema(c, 50), r = C.rsi(c, 14), m = C.macd(c), a = C.atr(k, 14);
    var slope = a[last] > 0 ? (e50[last] - e50[last - 10]) / a[last] : 0; // 10-bar change in ATR units
    var rv = r[last], h = m.hist[last];
    var factors = [
      { key: 'priceVsEma50', dir: price > e50[last] ? 1 : price < e50[last] ? -1 : 0, weight: 25, value: (price / e50[last] - 1) * 100 },
      { key: 'emaCross', dir: e20[last] > e50[last] ? 1 : e20[last] < e50[last] ? -1 : 0, weight: 25, value: (e20[last] / e50[last] - 1) * 100 },
      { key: 'emaSlope', dir: slope > 0.25 ? 1 : slope < -0.25 ? -1 : 0, weight: 15, value: slope },
      { key: 'rsi', dir: rv >= 70 ? 0.5 : rv >= 55 ? 1 : rv > 45 ? 0 : rv > 30 ? -1 : -0.5, weight: 20, value: rv },
      { key: 'macd', dir: h > 0 ? 1 : h < 0 ? -1 : 0, weight: 15, value: h }
    ];
    var score = 0;
    factors.forEach(function (f) { score += f.dir * f.weight; });
    var atrPct = a[last] / price * 100, hist = [];
    for (var i = Math.max(13, n - 100); i < n; i++) if (a[i] != null) hist.push(a[i] / c[i] * 100);
    hist.sort(function (x, y) { return x - y; });
    var med = hist[Math.floor(hist.length / 2)], ratio = med > 0 ? atrPct / med : 1;
    var lv = C.levels(k);
    return {
      price: price, score: score,
      label: score >= 60 ? 'strongUp' : score >= 20 ? 'up' : score > -20 ? 'neutral' : score > -60 ? 'down' : 'strongDown',
      factors: factors, ema20: e20[last], ema50: e50[last], rsi: rv, macdHist: h,
      atr: a[last], atrPct: atrPct, volRatio: ratio, vol: ratio > 1.3 ? 'high' : ratio < 0.7 ? 'low' : 'normal',
      support: lv.support, resistance: lv.resistance
    };
  };

  C.planFromAtr = function (price, atr, side, stopMult, rr) {
    stopMult = stopMult || 1.5; rr = rr || 2;
    var s = side === 'short' ? -1 : 1, d = atr * stopMult;
    return { side: s === 1 ? 'long' : 'short', entry: price, stop: price - s * d, target: price + s * d * rr };
  };

  /* ---------- risk ---------- */

  // Size the position so that hitting the stop (plus fees on both sides) loses exactly riskPct of the balance.
  // The direction is inferred from where the stop sits relative to the entry.
  C.positionSize = function (p) {
    var bal = p.balance, risk = p.riskPct, e = p.entry, s = p.stop, t = p.target, fee = (p.feePct > 0 ? p.feePct : 0) / 100;
    if (!(bal > 0)) return { ok: false, error: 'balance' };
    if (!(risk > 0) || risk > 100) return { ok: false, error: 'risk' };
    if (!(e > 0)) return { ok: false, error: 'entry' };
    if (!(s > 0)) return { ok: false, error: 'stop' };
    if (s === e) return { ok: false, error: 'stopEqual' };
    var side = s < e ? 'long' : 'short', dir = side === 'long' ? 1 : -1;
    var perUnit = Math.abs(e - s), feeUnit = (e + s) * fee, riskAmount = bal * risk / 100;
    var qty = riskAmount / (perUnit + feeUnit);
    var out = {
      ok: true, side: side, qty: qty, notional: qty * e, riskAmount: riskAmount,
      stopPct: perUnit / e * 100, leverage: qty * e / bal, feeAtStop: qty * feeUnit
    };
    if (t != null && !isNaN(t)) {
      if (!(t > 0) || (t - e) * dir <= 0) return { ok: false, error: 'targetSide', side: side };
      out.reward = qty * (Math.abs(t - e) - (e + t) * fee);
      out.rr = out.reward / riskAmount;
      out.breakeven = out.rr > 0 ? 1 / (1 + out.rr) : 1;
      out.targetPct = Math.abs(t - e) / e * 100;
    }
    return out;
  };

  /* ---------- journal statistics ---------- */

  C.tradeResult = function (t) {
    var dir = t.side === 'short' ? -1 : 1;
    var gross = (t.exit - t.entry) * dir * t.qty, fees = t.fees > 0 ? t.fees : 0, pnl = gross - fees;
    var risk = (t.stop > 0 && t.stop !== t.entry) ? Math.abs(t.entry - t.stop) * t.qty : null;
    var cost = t.entry * t.qty;
    return { pnl: pnl, gross: gross, fees: fees, risk: risk, r: risk ? pnl / risk : null, pct: cost > 0 ? pnl / cost * 100 : 0 };
  };

  function byClose(a, b) { return a.closedAt < b.closedAt ? -1 : a.closedAt > b.closedAt ? 1 : 0; }

  // base = account equity before the first trade in the list (drawdown % is measured against the equity peak).
  C.stats = function (trades, base) {
    base = base || 0;
    var list = trades.slice().sort(byClose);
    var s = {
      n: list.length, wins: 0, losses: 0, flat: 0, grossProfit: 0, grossLoss: 0, net: 0,
      best: null, worst: null, maxDD: 0, maxDDPct: 0, maxWinStreak: 0, maxLossStreak: 0, curve: []
    };
    var eq = base, peak = base, ws = 0, ls = 0, rSum = 0, rN = 0;
    list.forEach(function (t) {
      var r = C.tradeResult(t);
      if (r.pnl > 0) { s.wins++; s.grossProfit += r.pnl; ws++; ls = 0; }
      else if (r.pnl < 0) { s.losses++; s.grossLoss += r.pnl; ls++; ws = 0; }
      else { s.flat++; ws = 0; ls = 0; }
      if (ws > s.maxWinStreak) s.maxWinStreak = ws;
      if (ls > s.maxLossStreak) s.maxLossStreak = ls;
      s.net += r.pnl;
      if (s.best === null || r.pnl > s.best) s.best = r.pnl;
      if (s.worst === null || r.pnl < s.worst) s.worst = r.pnl;
      if (r.r !== null) { rSum += r.r; rN++; }
      eq += r.pnl;
      if (eq > peak) peak = eq;
      var dd = peak - eq;
      if (dd > s.maxDD) s.maxDD = dd;
      if (peak > 0 && dd / peak * 100 > s.maxDDPct) s.maxDDPct = dd / peak * 100;
      s.curve.push({ trade: t, pnl: r.pnl, r: r.r, equity: eq });
    });
    s.winRate = s.n ? s.wins / s.n : null;
    s.profitFactor = s.grossLoss < 0 ? s.grossProfit / -s.grossLoss : (s.grossProfit > 0 ? Infinity : null);
    s.avgWin = s.wins ? s.grossProfit / s.wins : null;
    s.avgLoss = s.losses ? s.grossLoss / s.losses : null;
    s.payoff = (s.avgWin !== null && s.avgLoss) ? s.avgWin / -s.avgLoss : null;
    s.expectancy = s.n ? s.net / s.n : null;
    s.avgR = rN ? rSum / rN : null;
    s.rCount = rN;
    s.streak = ws ? ws : -ls;
    return s;
  };

  // Groups closed trades by keyFn(trade); a trade whose key is null is skipped. Sorted by net result, best first.
  C.groupBy = function (trades, keyFn) {
    var map = {}, order = [];
    trades.forEach(function (t) {
      var key = keyFn(t);
      if (key == null || key === '') return;
      var g = map[key];
      if (!g) { g = map[key] = { key: key, n: 0, wins: 0, net: 0, rSum: 0, rN: 0 }; order.push(g); }
      var r = C.tradeResult(t);
      g.n++; g.net += r.pnl;
      if (r.pnl > 0) g.wins++;
      if (r.r !== null) { g.rSum += r.r; g.rN++; }
    });
    order.forEach(function (g) { g.avgR = g.rN ? g.rSum / g.rN : null; g.winRate = g.wins / g.n; });
    return order.sort(function (a, b) { return b.net - a.net; });
  };

  C.maxDrawdown = function (series) {
    var peak = -Infinity, dd = 0;
    for (var i = 0; i < series.length; i++) {
      if (series[i] > peak) peak = series[i];
      if (peak > 0 && 1 - series[i] / peak > dd) dd = 1 - series[i] / peak;
    }
    return dd;
  };

  /* ---------- backtest ---------- */

  // Each signal function returns the position wanted at the close of every bar: 1 long, -1 short, 0 flat.
  C.signals = {
    emaCross: function (k, p, allowShort) {
      var c = k.map(function (x) { return x.c; }), f = C.ema(c, p.fast), s = C.ema(c, p.slow);
      return c.map(function (_, i) {
        if (f[i] == null || s[i] == null) return 0;
        return f[i] > s[i] ? 1 : (allowShort && f[i] < s[i] ? -1 : 0);
      });
    },
    rsiReversion: function (k, p, allowShort) {
      var r = C.rsi(k.map(function (x) { return x.c; }), p.period), pos = 0;
      return r.map(function (v) {
        if (v == null) return 0;
        if (pos === 1 && v >= p.exit) pos = 0;
        else if (pos === -1 && v <= 100 - p.exit) pos = 0;
        if (pos === 0) {
          if (v <= p.buy) pos = 1;
          else if (allowShort && v >= 100 - p.buy) pos = -1;
        }
        return pos;
      });
    },
    breakout: function (k, p, allowShort) {
      var pos = 0, out = [], warm = Math.max(p.entry, p.exit);
      for (var i = 0; i < k.length; i++) {
        if (i < warm) { out.push(0); continue; }
        var hh = -Infinity, ll = Infinity, xh = -Infinity, xl = Infinity, j;
        for (j = i - p.entry; j < i; j++) { if (k[j].h > hh) hh = k[j].h; if (k[j].l < ll) ll = k[j].l; }
        for (j = i - p.exit; j < i; j++) { if (k[j].h > xh) xh = k[j].h; if (k[j].l < xl) xl = k[j].l; }
        var c = k[i].c;
        if (pos === 1 && c < xl) pos = 0;
        else if (pos === -1 && c > xh) pos = 0;
        if (pos === 0) {
          if (c > hh) pos = 1;
          else if (allowShort && c < ll) pos = -1;
        }
        out.push(pos);
      }
      return out;
    }
  };

  // A signal read at the close of bar i-1 is executed at the open of bar i (no look-ahead).
  // The whole equity is invested in each trade; fees are charged on entry and on exit.
  // opts: feePct (per side), stopAtr (0 = no stop; otherwise a stop that many ATRs from the entry), allowShort.
  C.backtest = function (k, strategy, params, opts) {
    opts = opts || {};
    var fee = (opts.feePct > 0 ? opts.feePct : 0) / 100, stopMult = opts.stopAtr > 0 ? opts.stopAtr : 0;
    var n = k.length, sig = C.signals[strategy](k, params, !!opts.allowShort), atr = stopMult ? C.atr(k, 14) : null;
    var eq = 1, pos = 0, entry = 0, entryI = 0, eqBefore = 1, eqEntry = 1, stop = null, blocked = 0, inBars = 0;
    var equity = [1], trades = [];

    function close(i, price, reason) {
      eq = Math.max(0, eqEntry * (1 + pos * (price - entry) / entry) * (1 - fee));
      trades.push({
        side: pos === 1 ? 'long' : 'short', entryT: k[entryI].t, entryP: entry, exitT: k[i].t, exitP: price,
        ret: eq / eqBefore - 1, pnl: eq - eqBefore, bars: i - entryI, reason: reason
      });
      pos = 0; stop = null;
    }

    for (var i = 1; i < n; i++) {
      var b = k[i], want = sig[i - 1];
      if (blocked && want !== blocked) blocked = 0;       // after a stop-out, wait for the signal to reset
      if (pos !== 0 && want !== pos) close(i, b.o, 'signal');
      // with a stop requested, no trade is taken until the ATR exists
      if (pos === 0 && want !== 0 && want !== blocked && eq > 0 && (!stopMult || atr[i - 1] != null)) {
        pos = want; entry = b.o; entryI = i; eqBefore = eq;
        eq = eqEntry = eq * (1 - fee);
        stop = stopMult ? entry - pos * stopMult * atr[i - 1] : null;
      }
      if (pos !== 0 && stop !== null) {
        if (pos === 1 && b.l <= stop) { blocked = 1; close(i, Math.min(stop, b.o), 'stop'); }
        else if (pos === -1 && b.h >= stop) { blocked = -1; close(i, Math.max(stop, b.o), 'stop'); }
      }
      if (pos !== 0) inBars++;
      equity.push(pos === 0 ? eq : Math.max(0, eqEntry * (1 + pos * (b.c - entry) / entry)));
    }
    if (pos !== 0) { close(n - 1, k[n - 1].c, 'end'); equity[n - 1] = eq; }

    var hold = k.map(function (x) { return x.c / k[0].c; });
    var wins = 0, gp = 0, gl = 0;
    trades.forEach(function (t) { if (t.pnl > 0) { wins++; gp += t.pnl; } else if (t.pnl < 0) gl += t.pnl; });
    return {
      trades: trades, equity: equity, hold: hold,
      totalReturn: eq - 1, holdReturn: hold[n - 1] * (1 - fee) * (1 - fee) - 1,
      maxDD: C.maxDrawdown(equity), holdMaxDD: C.maxDrawdown(hold),
      nTrades: trades.length, winRate: trades.length ? wins / trades.length : null,
      profitFactor: gl < 0 ? gp / -gl : (gp > 0 ? Infinity : null),
      avgTrade: trades.length ? trades.reduce(function (s, t) { return s + t.ret; }, 0) / trades.length : null,
      exposure: n > 1 ? inBars / (n - 1) : 0
    };
  };

  /* ---------- Monte Carlo ---------- */

  C.rng = function (seed) { // mulberry32
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  function pct(sorted, p) {
    if (!sorted.length) return null;
    var idx = (sorted.length - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }
  function numAsc(a, b) { return a - b; }

  // Fixed-fractional risk: each trade risks riskPct of the current equity; a win pays rr times the risk.
  // Equity is normalised to 1 at the start. bands: false skips the per-trade percentile paths.
  C.monteCarlo = function (p) {
    var runs = p.runs || 1000, N = p.trades, w = p.winRate, rr = p.rr, risk = p.riskPct / 100, rand = C.rng(p.seed || 20260101);
    var finals = [], dds = [], cols = [], i, r, wantBands = p.bands !== false;
    if (wantBands) for (i = 0; i < N; i++) cols.push(new Array(runs));
    for (r = 0; r < runs; r++) {
      var eq = 1, peak = 1, dd = 0;
      for (i = 0; i < N; i++) {
        eq *= rand() < w ? 1 + risk * rr : 1 - risk;
        if (eq > peak) peak = eq;
        if (1 - eq / peak > dd) dd = 1 - eq / peak;
        if (wantBands) cols[i][r] = eq;
      }
      finals.push(eq); dds.push(dd);
    }
    finals.sort(numAsc);
    var ddSorted = dds.slice().sort(numAsc);
    var bands = { p5: [1], p50: [1], p95: [1] };
    for (i = 0; wantBands && i < N; i++) {
      cols[i].sort(numAsc);
      bands.p5.push(pct(cols[i], 0.05)); bands.p50.push(pct(cols[i], 0.5)); bands.p95.push(pct(cols[i], 0.95));
    }
    function share(arr, test) { var c = 0; for (var j = 0; j < arr.length; j++) if (test(arr[j])) c++; return c / arr.length; }
    return {
      runs: runs,
      final: { p5: pct(finals, 0.05), p25: pct(finals, 0.25), p50: pct(finals, 0.5), p75: pct(finals, 0.75), p95: pct(finals, 0.95) },
      probLoss: share(finals, function (x) { return x < 1; }),
      dd: { p50: pct(ddSorted, 0.5), p95: pct(ddSorted, 0.95) },
      probDD: function (level) { return share(dds, function (x) { return x >= level; }); },
      bands: wantBands ? bands : null
    };
  };

  /* ---------- market data ---------- */

  function candle(t, o, h, l, c, v) { return { t: +t, o: +o, h: +h, l: +l, c: +c, v: +v || 0 }; }
  function valid(x) { return isFinite(x.t) && x.o > 0 && x.h > 0 && x.l > 0 && x.c > 0 && x.h >= x.l; }
  function finish(list) {
    var seen = {}, out = [];
    list.filter(valid).sort(function (a, b) { return a.t - b.t; }).forEach(function (x) {
      if (seen[x.t]) return;
      seen[x.t] = 1; out.push(x);
    });
    return out;
  }

  // Binance klines: [[openTime, open, high, low, close, volume, ...], ...] oldest first.
  C.normalizeBinance = function (json) {
    if (!Array.isArray(json)) return [];
    return finish(json.map(function (r) { return candle(r[0], r[1], r[2], r[3], r[4], r[5]); }));
  };
  // Bybit v5: { retCode: 0, result: { list: [[start, open, high, low, close, volume, turnover], ...] } } newest first.
  C.normalizeBybit = function (json) {
    var list = json && json.retCode === 0 && json.result && json.result.list;
    if (!Array.isArray(list)) return [];
    return finish(list.map(function (r) { return candle(r[0], r[1], r[2], r[3], r[4], r[5]); }));
  };
  // OKX v5: { code: "0", data: [[ts, open, high, low, close, vol, ...], ...] } newest first.
  C.normalizeOkx = function (json) {
    var list = json && String(json.code) === '0' && json.data;
    if (!Array.isArray(list)) return [];
    return finish(list.map(function (r) { return candle(r[0], r[1], r[2], r[3], r[4], r[5]); }));
  };

  // "BTCUSDT" -> "BTC-USDT" (OKX instrument id). Returns null when the quote currency is not recognised.
  C.splitSymbol = function (sym) {
    var m = /^([A-Z0-9]{2,12}?)(USDT|USDC|FDUSD|BUSD|TUSD|DAI|USD|EUR|TRY|BTC|ETH|BNB)$/.exec(String(sym).toUpperCase());
    return m ? { base: m[1], quote: m[2] } : null;
  };

  function splitRow(line, delim) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === delim && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(function (x) { return x.trim(); });
  }

  function volNum(s) {
    s = String(s == null ? '' : s).trim();
    var m = /^([\d.,]+)\s*([KMB])$/i.exec(s);
    if (m) return C.parseNum(m[1]) * { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase()];
    var v = C.parseNum(s);
    return isNaN(v) ? 0 : v;
  }

  var HEAD = {
    t: ['time', 'date', 'datetime', 'timestamp', 'opentime', 'التاريخ', 'الوقت', 'تاريخ'],
    clock: ['time', 'الوقت'],
    o: ['open', 'فتح', 'الافتتاح', 'افتتاح'],
    h: ['high', 'أعلى', 'الأعلى', 'اعلى'],
    l: ['low', 'أدنى', 'الأدنى', 'ادنى'],
    c: ['close', 'price', 'last', 'adjclose', 'إغلاق', 'الإغلاق', 'اغلاق', 'السعر', 'الأخير'],
    v: ['volume', 'vol', 'tickvol', 'الحجم', 'حجم']
  };

  // Reads price history exported from TradingView, Investing.com, MetaTrader or any table with
  // date + open/high/low/close columns. A file with only a close column becomes flat candles.
  C.parseCsv = function (text) {
    var lines = String(text == null ? '' : text).replace(/^﻿/, '').split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (lines.length < 2) return { candles: [], error: 'empty' };
    var first = lines[0], delim = ',', best = 0;
    ['\t', ';', ','].forEach(function (d) { var c = first.split(d).length; if (c > best) { best = c; delim = d; } });
    var rows = lines.map(function (l) { return splitRow(l, delim); });
    var head = rows[0].map(function (x) { return x.toLowerCase().replace(/[<>."'*\s_-]/g, ''); });
    var hasHeader = head.some(function (x) { return x && isNaN(C.parseNum(x)) && !/^\d{4}/.test(x) && !/\d{1,2}[\/:]\d/.test(x); });
    var col = { t: -1, clock: -1, o: -1, h: -1, l: -1, c: -1, v: -1 };
    if (hasHeader) {
      head.forEach(function (name, i) {
        ['o', 'h', 'l', 'c', 'v'].forEach(function (key) { if (col[key] < 0 && HEAD[key].indexOf(name) !== -1) col[key] = i; });
        if (HEAD.t.indexOf(name) !== -1) {
          if (col.t < 0) col.t = i;
          else if (col.clock < 0 && HEAD.clock.indexOf(name) !== -1) col.clock = i;
        }
      });
      rows.shift();
    } else {
      col = { t: 0, clock: -1, o: 1, h: 2, l: 3, c: 4, v: rows[0].length > 5 ? 5 : -1 };
    }
    if (col.t < 0 || col.c < 0) return { candles: [], error: 'columns' };
    var closeOnly = col.o < 0 || col.h < 0 || col.l < 0;

    // dd/mm vs mm/dd: decided by whichever position ever exceeds 12 (mm/dd when the file never tells)
    var dayFirst = false;
    rows.some(function (r) {
      var m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-]\d{2,4}/.exec(r[col.t] || '');
      if (m && +m[1] > 12) { dayFirst = true; return true; }
      return !!(m && +m[2] > 12);
    });
    function parseTime(s, clock) {
      s = String(s || '').trim();
      if (/^\d{9,10}(\.\d+)?$/.test(s)) return parseFloat(s) * 1000;
      if (/^\d{12,13}$/.test(s)) return parseInt(s, 10);
      var m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(.*)$/.exec(s);
      if (m) {
        var y = +m[3] < 100 ? 2000 + +m[3] : +m[3], d = dayFirst ? +m[1] : +m[2], mo = dayFirst ? +m[2] : +m[1];
        s = y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2) + m[4];
      } else {
        s = s.replace(/^(\d{4})[.\/](\d{1,2})[.\/](\d{1,2})/, function (_, y2, mo2, d2) {
          return y2 + '-' + ('0' + mo2).slice(-2) + '-' + ('0' + d2).slice(-2);
        });
      }
      if (clock) s += ' ' + clock;
      s = s.trim().replace(/^(\d{4}-\d{2}-\d{2})\s+(\d)/, '$1T$2');
      var t = Date.parse(s);
      return isNaN(t) ? NaN : t;
    }

    var list = [], bad = 0;
    rows.forEach(function (r) {
      var t = parseTime(r[col.t], col.clock >= 0 ? r[col.clock] : ''), c = C.parseNum(r[col.c]);
      var x = closeOnly ? candle(t, c, c, c, c, 0)
        : candle(t, C.parseNum(r[col.o]), C.parseNum(r[col.h]), C.parseNum(r[col.l]), c, col.v >= 0 ? volNum(r[col.v]) : 0);
      if (valid(x)) list.push(x); else bad++;
    });
    var candles = finish(list);
    if (!candles.length) return { candles: [], error: 'rows' };
    return { candles: candles, skipped: bad, closeOnly: closeOnly };
  };

  // Synthetic candles for trying the tools offline. Never real prices.
  C.demoCandles = function (n, seed, stepMs, endT) {
    var rand = C.rng(seed || 7), out = [], price = 100, vol = 0.012, drift = 0.0006;
    var t = (endT || 1767225600000) - (n - 1) * stepMs;
    function gauss() { return (rand() + rand() + rand() + rand() - 2) * 1.2247; }
    for (var i = 0; i < n; i++) {
      if (rand() < 0.03) drift = (rand() - 0.45) * 0.004;
      vol = Math.max(0.004, Math.min(0.035, vol * (0.92 + rand() * 0.17)));
      var o = price, c = o * Math.exp(drift + gauss() * vol);
      var hi = Math.max(o, c) * (1 + Math.abs(gauss()) * vol * 0.45), lo = Math.min(o, c) * (1 - Math.abs(gauss()) * vol * 0.45);
      out.push(candle(t + i * stepMs, o, hi, lo, c, Math.round(500 + rand() * 1500)));
      price = c;
    }
    return out;
  };

  return C;
});
