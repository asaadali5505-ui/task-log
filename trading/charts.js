/* مساعد التداول — الرسوم البيانية (SVG بلا مكتبات): شموع يابانية وخطوط، مع خط تتبّع وبطاقة قيم
   تظهر عند المرور أو اللمس أو بأسهم لوحة المفاتيح. الألوان تأتي من متغيّرات app.css. */
(function (root) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';

  function s(tag, attrs, text) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function d(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function niceStep(range, count) {
    var raw = range / Math.max(1, count), mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  }
  function ticks(min, max, count) {
    if (!(max > min)) return [min];
    var step = niceStep(max - min, count), out = [];
    for (var v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return out;
  }

  // A touch tooltip stays up until the next tap outside its chart.
  var hosts = [];
  document.addEventListener('pointerdown', function (e) {
    hosts.forEach(function (h) { if (h._hide && !h.contains(e.target)) h._hide(); });
  });

  function setup(host, label) {
    host.textContent = '';
    host._hide = host._key = null;
    host.classList.add('chart');
    host.setAttribute('role', 'group');
    host.setAttribute('aria-label', label || '');
    host.tabIndex = 0;
    if (host._wired) return;
    host._wired = true;
    hosts.push(host);
    host.addEventListener('keydown', function (e) { if (host._key) host._key(e); });
    host.addEventListener('blur', function () { if (host._hide) host._hide(); });
  }

  function pathOf(values, xOf, yOf) {
    var out = '', pen = false;
    for (var i = 0; i < values.length; i++) {
      if (values[i] == null) { pen = false; continue; }
      out += (pen ? 'L' : 'M') + xOf(i).toFixed(1) + ' ' + yOf(values[i]).toFixed(1);
      pen = true;
    }
    return out;
  }

  function yAxis(svg, g, tks, yOf, fmtY) {
    tks.forEach(function (v) {
      var y = Math.round(yOf(v)) + 0.5;
      if (y < g.m.t - 1 || y > g.H - g.m.b + 1) return;
      svg.appendChild(s('line', { x1: g.m.l, x2: g.W - g.m.r, y1: y, y2: y, 'class': 'grid' }));
      svg.appendChild(s('text', { x: g.W - g.m.r + 7, y: y, dy: '0.34em', 'class': 'axis-text' }, fmtY(v)));
    });
  }

  function xAxis(svg, g, n, xOf, label) {
    var y = g.H - g.m.b;
    svg.appendChild(s('line', { x1: g.m.l, x2: g.W - g.m.r, y1: y + 0.5, y2: y + 0.5, 'class': 'axis' }));
    var count = Math.max(1, Math.min(n, Math.floor(g.pw / 104))), last = -1;
    for (var j = 0; j < count; j++) {
      var i = clamp(Math.round((j + 0.5) * n / count - 0.5), 0, n - 1);
      if (i === last) continue;
      last = i;
      svg.appendChild(s('text', { x: xOf(i), y: y + 16, 'text-anchor': 'middle', 'class': 'axis-text' }, label(i)));
    }
  }

  function tipRow(tip, value, name, keyCls) {
    var r = d('div', 'tip-r');
    r.appendChild(keyCls ? d('span', 'tip-k ' + keyCls) : d('span', 'tip-k none'));
    r.appendChild(d('b', null, value));
    r.appendChild(d('span', 'tip-n', name));
    tip.appendChild(r);
  }

  // Crosshair + tooltip shared by both chart kinds. fill(i, tip) writes the readout for index i.
  function interact(host, svg, g, n, xOf, fill) {
    var cross = s('line', { y1: g.m.t, y2: g.H - g.m.b, 'class': 'cross', visibility: 'hidden' });
    svg.appendChild(cross);
    var tip = d('div', 'tip');
    tip.hidden = true;
    host.appendChild(tip);
    var cur = -1;
    function show(i) {
      i = clamp(i, 0, n - 1);
      cur = i;
      var x = xOf(i);
      cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
      tip.textContent = '';
      fill(i, tip);
      tip.hidden = false;
      var tw = tip.offsetWidth, left = x + 12;
      if (left + tw > g.W - 4) left = x - 12 - tw;
      tip.style.left = Math.max(4, left) + 'px';
      tip.style.top = g.m.t + 'px';
    }
    function hide() { cur = -1; cross.setAttribute('visibility', 'hidden'); tip.hidden = true; }
    function idx(e) {
      var r = svg.getBoundingClientRect();
      return g.idxOf((e.clientX - r.left) * (g.W / (r.width || g.W)));
    }
    svg.addEventListener('pointermove', function (e) { show(idx(e)); });
    svg.addEventListener('pointerdown', function (e) { show(idx(e)); });
    svg.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hide(); });
    host._hide = hide;
    host._key = function (e) {
      var step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (step) { show(cur < 0 ? n - 1 : cur + step); e.preventDefault(); }
      else if (e.key === 'Home') { show(0); e.preventDefault(); }
      else if (e.key === 'End') { show(n - 1); e.preventDefault(); }
      else if (e.key === 'Escape') hide();
    };
  }

  /* cfg: candles[{t,o,h,l,c}], overlays[{name, values, cls}], height, label, fmtY(v) axis, fmtVal(v) readout, fmtX(t), fmtTip(t),
     words{o,h,l,c}, showLast. Rising candles are hollow and falling ones solid, so direction never rests on colour alone. */
  function candleChart(host, cfg) {
    setup(host, cfg.label);
    var k = cfg.candles, n = k.length, W = host.clientWidth, H = cfg.height || 320, i;
    var fmtVal = cfg.fmtVal || cfg.fmtY;
    if (!W || !n) return;
    var m = { t: 12, r: 66, b: 26, l: 8 }, pw = W - m.l - m.r, ph = H - m.t - m.b, slot = pw / n;
    var g = { W: W, H: H, m: m, pw: pw, ph: ph, idxOf: function (px) { return clamp(Math.floor((px - m.l) / slot), 0, n - 1); } };
    function xOf(j) { return m.l + slot * (j + 0.5); }
    var lo = Infinity, hi = -Infinity, overlays = cfg.overlays || [];
    for (i = 0; i < n; i++) { if (k[i].l < lo) lo = k[i].l; if (k[i].h > hi) hi = k[i].h; }
    overlays.forEach(function (o) {
      o.values.forEach(function (v) { if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v; } });
    });
    var pad = (hi - lo) * 0.05 || hi * 0.01 || 1;
    lo -= pad; hi += pad;
    function yOf(v) { return m.t + ph * (1 - (v - lo) / (hi - lo)); }

    var svg = s('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, 'aria-hidden': 'true' });
    yAxis(svg, g, ticks(lo, hi, Math.max(3, Math.floor(ph / 56))), yOf, cfg.fmtY);
    xAxis(svg, g, n, xOf, function (j) { return cfg.fmtX(k[j].t); });

    var bw = clamp(Math.floor(slot * 0.7), 1, 14);
    for (i = 0; i < n; i++) {
      var c = k[i], up = c.c >= c.o, x = xOf(i), cls = up ? 'up' : 'down';
      svg.appendChild(s('line', { x1: x, x2: x, y1: yOf(c.h), y2: yOf(c.l), 'class': 'wick ' + cls }));
      var top = yOf(Math.max(c.o, c.c)), bh = Math.max(1, yOf(Math.min(c.o, c.c)) - top);
      if (up && bw >= 4 && bh >= 3) {
        svg.appendChild(s('rect', { x: x - bw / 2 + 0.75, y: top + 0.75, width: bw - 1.5, height: bh - 1.5, 'class': 'body up hollow' }));
      } else {
        svg.appendChild(s('rect', { x: x - bw / 2, y: top, width: bw, height: bh, 'class': 'body ' + cls }));
      }
    }
    overlays.forEach(function (o) {
      svg.appendChild(s('path', { d: pathOf(o.values, xOf, yOf), 'class': 'ln ' + o.cls }));
    });
    if (cfg.showLast) {
      var ly = Math.round(yOf(k[n - 1].c)) + 0.5;
      svg.appendChild(s('line', { x1: m.l, x2: W - m.r, y1: ly, y2: ly, 'class': 'last-line' }));
      svg.appendChild(s('rect', { x: W - m.r + 2, y: ly - 10, width: m.r - 4, height: 20, rx: 4, 'class': 'pill' }));
      svg.appendChild(s('text', { x: W - m.r / 2, y: ly, dy: '0.34em', 'text-anchor': 'middle', 'class': 'pill-text' }, fmtVal(k[n - 1].c)));
    }
    host.appendChild(svg);
    interact(host, svg, g, n, xOf, function (j, tip) {
      var c2 = k[j], w = cfg.words;
      tip.appendChild(d('div', 'tip-h', cfg.fmtTip(c2.t)));
      tipRow(tip, fmtVal(c2.c), w.c);
      tipRow(tip, fmtVal(c2.o), w.o);
      tipRow(tip, fmtVal(c2.h), w.h);
      tipRow(tip, fmtVal(c2.l), w.l);
      overlays.forEach(function (o) { if (o.values[j] != null) tipRow(tip, fmtVal(o.values[j]), o.name, o.cls); });
    });
  }

  /* cfg: n, series[{name, values, cls, area}], band{lo, hi, cls}, refs[{y, cls}], domain[lo, hi], yTicks[],
     fmtY(v) axis, fmtVal(v) readout, xLabel(i), tipHead(i), tipRows(i) -> [{value, name, cls}], height, label,
     bandScale, zero, marginRight. */
  function lineChart(host, cfg) {
    setup(host, cfg.label);
    var n = cfg.n, W = host.clientWidth, H = cfg.height || 220;
    if (!W || !n) return;
    var m = { t: 12, r: cfg.marginRight || 66, b: cfg.xLabel ? 26 : 8, l: 8 }, pw = W - m.l - m.r, ph = H - m.t - m.b, slot = pw / n;
    var g = {
      W: W, H: H, m: m, pw: pw, ph: ph,
      idxOf: function (px) {
        return clamp(cfg.bandScale ? Math.floor((px - m.l) / slot) : Math.round((px - m.l) / pw * (n - 1)), 0, n - 1);
      }
    };
    function xOf(j) { return cfg.bandScale ? m.l + slot * (j + 0.5) : m.l + (n === 1 ? pw / 2 : pw * j / (n - 1)); }
    var lo, hi;
    if (cfg.domain) { lo = cfg.domain[0]; hi = cfg.domain[1]; }
    else {
      lo = Infinity; hi = -Infinity;
      var see = function (v) { if (v != null && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } };
      cfg.series.forEach(function (sr) { sr.values.forEach(see); });
      if (cfg.band) { cfg.band.lo.forEach(see); cfg.band.hi.forEach(see); }
      (cfg.refs || []).forEach(function (r) { see(r.y); });
      if (cfg.zero != null) see(cfg.zero);
      if (!isFinite(lo)) { lo = 0; hi = 1; }
      var pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1;
      lo -= pad; hi += pad;
    }
    function yOf(v) { return m.t + ph * (1 - (v - lo) / (hi - lo)); }

    var svg = s('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, 'aria-hidden': 'true' });
    yAxis(svg, g, cfg.yTicks || ticks(lo, hi, Math.max(2, Math.floor(ph / 48))), yOf, cfg.fmtY);
    if (cfg.xLabel) xAxis(svg, g, n, xOf, cfg.xLabel);
    (cfg.refs || []).forEach(function (r) {
      var y = Math.round(yOf(r.y)) + 0.5;
      svg.appendChild(s('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, 'class': 'ref ' + (r.cls || '') }));
    });
    if (cfg.band) {
      var back = cfg.band.lo.map(function (v, j) { return 'L' + xOf(j).toFixed(1) + ' ' + yOf(v).toFixed(1); }).reverse().join('');
      svg.appendChild(s('path', { d: pathOf(cfg.band.hi, xOf, yOf) + back + 'Z', 'class': 'area ' + cfg.band.cls }));
    }
    cfg.series.forEach(function (sr) {
      var first = -1, last = -1;
      sr.values.forEach(function (v, j) { if (v != null) { if (first < 0) first = j; last = j; } });
      if (last < 0) return;
      var line = pathOf(sr.values, xOf, yOf);
      if (sr.area) {
        var base = yOf(clamp(cfg.zero != null ? cfg.zero : lo, lo, hi)).toFixed(1);
        svg.appendChild(s('path', { d: line + 'L' + xOf(last).toFixed(1) + ' ' + base + 'L' + xOf(first).toFixed(1) + ' ' + base + 'Z', 'class': 'area ' + sr.cls }));
      }
      svg.appendChild(s('path', { d: line, 'class': 'ln ' + sr.cls }));
      if (sr.dot !== false) svg.appendChild(s('circle', { cx: xOf(last), cy: yOf(sr.values[last]), r: 4, 'class': 'dot ' + sr.cls }));
    });
    host.appendChild(svg);
    interact(host, svg, g, n, xOf, function (j, tip) {
      if (cfg.tipHead) tip.appendChild(d('div', 'tip-h', cfg.tipHead(j)));
      var rows = cfg.tipRows ? cfg.tipRows(j) : cfg.series.filter(function (sr) { return sr.values[j] != null; })
        .map(function (sr) { return { value: (cfg.fmtVal || cfg.fmtY)(sr.values[j]), name: sr.name, cls: sr.cls }; });
      rows.forEach(function (r) { tipRow(tip, r.value, r.name, r.cls); });
    });
  }

  root.TradingCharts = { candles: candleChart, lines: lineChart };
})(self);
