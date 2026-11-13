// node --test trading/tests
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
const bar = (t, o, h, l, c) => ({ t, o, h, l, c, v: 0 });
const flat = (prices) => prices.map((p, i) => bar(i * 1000, p, p, p, p));

test('parseNum: Arabic digits, separators and decimal comma', () => {
  assert.equal(C.parseNum('١٢٣٫٥'), 123.5);
  assert.equal(C.parseNum('۱۲۳'), 123);
  assert.equal(C.parseNum('1,234.56'), 1234.56);
  assert.equal(C.parseNum('1,234'), 1234);
  assert.equal(C.parseNum('1,234,567'), 1234567);
  assert.equal(C.parseNum('0,5'), 0.5);
  assert.equal(C.parseNum('12,75'), 12.75);
  assert.equal(C.parseNum(' 67 250.10 '), 67250.1);
  assert.equal(C.parseNum('−3.5'), -3.5);
  assert.equal(C.parseNum('.5'), 0.5);
  assert.ok(Number.isNaN(C.parseNum('')));
  assert.ok(Number.isNaN(C.parseNum('abc')));
  assert.ok(Number.isNaN(C.parseNum('1.2.3')));
  assert.ok(Number.isNaN(C.parseNum(null)));
});

test('sma and ema: warm-up, seed and recursion', () => {
  assert.deepEqual(C.sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  const e = C.ema([1, 2, 3, 4, 5], 3);
  assert.deepEqual(e.slice(0, 2), [null, null]);
  near(e[2], 2);            // seed = SMA(1,2,3)
  near(e[3], 4 * 0.5 + 2 * 0.5);
  near(e[4], 5 * 0.5 + 3 * 0.5);
  assert.deepEqual(C.ema([1, 2], 3), [null, null]);
});

test('rsi: matches a direct Wilder computation and stays in range', () => {
  const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64];
  const n = 14, out = C.rsi(closes, n);
  assert.equal(out[n - 1], null);
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  near(out[n], 100 - 100 / (1 + g / l), 1e-9);
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    g = (g * 13 + Math.max(d, 0)) / 14; l = (l * 13 + Math.max(-d, 0)) / 14;
    near(out[i], 100 - 100 / (1 + g / l), 1e-9);
  }
  near(out[n], 70.46, 0.1);  // the textbook value for this series
  assert.equal(C.rsi([1, 2, 3, 4, 5, 6], 3)[5], 100);
  assert.equal(C.rsi([5, 5, 5, 5, 5], 3)[4], 50);
  assert.equal(C.rsi([6, 5, 4, 3, 2, 1], 3)[5], 0);
});

test('atr: true range uses the previous close', () => {
  const k = [bar(0, 10, 12, 9, 11), bar(1, 11, 11.5, 10.5, 11), bar(2, 14, 15, 13.5, 14)];
  const a = C.atr(k, 2);
  assert.equal(a[0], null);
  near(a[1], (3 + 1) / 2);
  near(a[2], (2 * 1 + 4) / 2);   // gap up: |15 - 11| = 4 beats the bar's own range of 1.5
});

test('macd: histogram is line minus signal', () => {
  const c = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 10 + i * 0.3);
  const m = C.macd(c);
  assert.equal(m.line[24], null);
  assert.notEqual(m.line[25], null);
  assert.equal(m.signal[32], null);
  assert.notEqual(m.signal[33], null);
  near(m.hist[59], m.line[59] - m.signal[59]);
});

test('levels: nearest swing low below and swing high above the last close', () => {
  const highs = [10, 11, 12, 15, 12, 11, 10, 9, 8, 7, 8, 9, 10, 11, 10.5, 10, 10.2];
  const k = highs.map((h, i) => bar(i, h - 0.5, h, h - 1, h - 0.5));
  const lv = C.levels(k, 2, 100);
  assert.equal(lv.resistance, 11);   // the swing at 11 is nearer to the last close (9.7) than the one at 15
  assert.equal(lv.support, 6);
});

test('analyze: a steady uptrend reads bullish, a downtrend bearish', () => {
  const up = Array.from({ length: 120 }, (_, i) => { const p = 100 * Math.pow(1.01, i); return bar(i, p, p * 1.004, p * 0.996, p * 1.002); });
  const a = C.analyze(up);
  assert.ok(a.score >= 60, 'score ' + a.score);
  assert.equal(a.label, 'strongUp');
  assert.equal(a.factors.length, 5);
  const down = Array.from({ length: 120 }, (_, i) => { const p = 100 * Math.pow(0.99, i); return bar(i, p, p * 1.004, p * 0.996, p * 0.998); });
  assert.ok(C.analyze(down).score <= -60);
  assert.equal(C.analyze(up.slice(0, 59)), null);
});

test('positionSize: risk at the stop equals the chosen share of the balance', () => {
  const p = C.positionSize({ balance: 10000, riskPct: 1, entry: 100, stop: 95, target: 110 });
  assert.equal(p.ok, true);
  assert.equal(p.side, 'long');
  near(p.qty, 20);
  near(p.notional, 2000);
  near(p.riskAmount, 100);
  near(p.reward, 200);
  near(p.rr, 2);
  near(p.breakeven, 1 / 3);
  near(p.stopPct, 5);
  near(p.leverage, 0.2);
});

test('positionSize: short side, fees and leverage', () => {
  const s = C.positionSize({ balance: 5000, riskPct: 2, entry: 50, stop: 52, target: 44 });
  assert.equal(s.side, 'short');
  near(s.qty, 50);
  near(s.rr, 3);
  const f = C.positionSize({ balance: 10000, riskPct: 1, entry: 100, stop: 95, feePct: 0.1 });
  near(f.qty * (5 + 195 * 0.001), 100);       // the loss at the stop including both fees is still 100
  assert.ok(f.qty < 20);
  const tight = C.positionSize({ balance: 1000, riskPct: 1, entry: 100, stop: 99.9 });
  near(tight.leverage, 10);
});

test('positionSize: rejects impossible inputs', () => {
  const base = { balance: 1000, riskPct: 1, entry: 100, stop: 95 };
  assert.equal(C.positionSize({ ...base, balance: 0 }).error, 'balance');
  assert.equal(C.positionSize({ ...base, riskPct: 0 }).error, 'risk');
  assert.equal(C.positionSize({ ...base, riskPct: 150 }).error, 'risk');
  assert.equal(C.positionSize({ ...base, entry: NaN }).error, 'entry');
  assert.equal(C.positionSize({ ...base, stop: NaN }).error, 'stop');
  assert.equal(C.positionSize({ ...base, stop: 100 }).error, 'stopEqual');
  assert.equal(C.positionSize({ ...base, target: 90 }).error, 'targetSide');
  assert.equal(C.positionSize({ ...base, stop: 105, target: 110 }).error, 'targetSide');
  assert.equal(C.positionSize({ ...base, target: NaN }).ok, true);
});

test('tradeResult: profit, fees and R multiple for both directions', () => {
  const long = C.tradeResult({ side: 'long', entry: 100, exit: 110, qty: 2, stop: 95, fees: 1 });
  near(long.pnl, 19); near(long.r, 1.9); near(long.pct, 9.5);
  const short = C.tradeResult({ side: 'short', entry: 100, exit: 110, qty: 2, stop: 104 });
  near(short.pnl, -20); near(short.r, -2.5);
  assert.equal(C.tradeResult({ side: 'long', entry: 100, exit: 90, qty: 1 }).r, null);
});

test('stats: totals, ratios, drawdown and streaks', () => {
  const mk = (pnl, day) => ({ side: 'long', entry: 100, exit: 100 + pnl, qty: 1, stop: 90, closedAt: '2026-01-' + day + 'T10:00' });
  // listed out of order on purpose: stats sorts by close time
  const s = C.stats([mk(-10, '03'), mk(20, '01'), mk(-10, '02'), mk(30, '04'), mk(-5, '05')], 1000);
  assert.equal(s.n, 5); assert.equal(s.wins, 2); assert.equal(s.losses, 3);
  near(s.net, 25); near(s.winRate, 0.4);
  near(s.profitFactor, 2); near(s.avgWin, 25); near(s.avgLoss, -25 / 3); near(s.payoff, 3);
  near(s.expectancy, 5); near(s.avgR, 0.5);
  near(s.maxDD, 20);                    // 1020 -> 1000
  near(s.maxDDPct, 20 / 1020 * 100);
  assert.equal(s.maxLossStreak, 2); assert.equal(s.maxWinStreak, 1); assert.equal(s.streak, -1);
  assert.deepEqual(s.curve.map(p => p.equity), [1020, 1010, 1000, 1030, 1025]);
  assert.equal(s.best, 30); assert.equal(s.worst, -10);
  const none = C.stats([], 1000);
  assert.equal(none.winRate, null); assert.equal(none.profitFactor, null);
  assert.equal(C.stats([mk(5, '01')], 0).profitFactor, Infinity);
});

test('groupBy: nets per key, skips empty keys, best first', () => {
  const mk = (pnl, setup) => ({ side: 'long', entry: 100, exit: 100 + pnl, qty: 1, stop: 90, setup, closedAt: '2026-01-01T10:00' });
  const g = C.groupBy([mk(10, 'a'), mk(-30, 'b'), mk(5, 'a'), mk(1, '')], t => t.setup);
  assert.deepEqual(g.map(x => x.key), ['a', 'b']);
  near(g[0].net, 15); assert.equal(g[0].n, 2); near(g[0].winRate, 1); near(g[0].avgR, 0.75);
});

test('backtest: executes at the next open, never on the signal bar', () => {
  // closes rise so EMA(1) > EMA(2) from bar 2 on; the entry must be the open of bar 3
  const k = [bar(0, 10, 10, 10, 10), bar(1, 10, 10, 10, 10), bar(2, 10, 12, 10, 12), bar(3, 13, 15, 13, 15), bar(4, 15, 16, 14, 16)];
  const r = C.backtest(k, 'emaCross', { fast: 1, slow: 2 });
  assert.equal(r.nTrades, 1);
  assert.equal(r.trades[0].entryP, 13);
  assert.equal(r.trades[0].entryT, 3);
  assert.equal(r.trades[0].reason, 'end');
  near(r.totalReturn, 16 / 13 - 1);
  assert.deepEqual(r.equity.slice(0, 3), [1, 1, 1]);
  near(r.equity[3], 15 / 13);
  near(r.holdReturn, 0.6);
  near(r.exposure, 2 / 4);
});

test('backtest: fees reduce the result on both sides', () => {
  const k = [bar(0, 10, 10, 10, 10), bar(1, 10, 10, 10, 10), bar(2, 10, 12, 10, 12), bar(3, 13, 15, 13, 15), bar(4, 15, 16, 14, 16)];
  const r = C.backtest(k, 'emaCross', { fast: 1, slow: 2 }, { feePct: 1 });
  near(r.totalReturn, 0.99 * (16 / 13) * 0.99 - 1);
  near(r.trades[0].ret, r.totalReturn);
});

test('backtest: ATR stop exits intrabar and waits for the signal to reset', () => {
  const k = [];
  for (let i = 0; i < 20; i++) k.push(bar(i, 100 + i, 101 + i, 99 + i, 100 + i));   // steady rise, ATR = 2
  k.push(bar(20, 120, 120, 100, 101));                                               // crash through the stop
  k.push(bar(21, 101, 106, 100, 105));
  k.push(bar(22, 105, 110, 104, 109));
  const r = C.backtest(k, 'emaCross', { fast: 2, slow: 5 }, { stopAtr: 2 });
  assert.equal(r.trades[0].entryT, 14);          // no entry before the ATR exists (first value at bar 13)
  const stopped = r.trades.find(t => t.reason === 'stop');
  assert.ok(stopped, 'expected a stop-out');
  assert.equal(stopped.exitT, 20);
  near(stopped.exitP, 114 - 2 * 2);              // entry 114, stop two ATRs (2 each) below
  assert.equal(r.nTrades, 1);                    // still "long" after the stop-out: no re-entry until the signal resets
  const noStop = C.backtest(k, 'emaCross', { fast: 2, slow: 5 });
  assert.ok(noStop.trades.every(t => t.reason !== 'stop'));
});

test('backtest: shorts profit from a decline only when allowed', () => {
  const k = Array.from({ length: 60 }, (_, i) => { const p = 200 - i * 2; return bar(i, p, p + 1, p - 3, p - 2); });
  const longOnly = C.backtest(k, 'emaCross', { fast: 3, slow: 8 });
  assert.equal(longOnly.nTrades, 0);
  assert.equal(longOnly.totalReturn, 0);
  const both = C.backtest(k, 'emaCross', { fast: 3, slow: 8 }, { allowShort: true });
  assert.equal(both.trades[0].side, 'short');
  assert.ok(both.totalReturn > 0);
});

test('backtest: breakout and RSI strategies trade and stay consistent', () => {
  const k = C.demoCandles(600, 3, 3600000);
  ['breakout', 'rsiReversion'].forEach((name) => {
    const params = name === 'breakout' ? { entry: 20, exit: 10 } : { period: 14, buy: 30, exit: 55 };
    const r = C.backtest(k, name, params, { feePct: 0.1 });
    assert.ok(r.nTrades > 0, name + ' made no trades');
    assert.equal(r.equity.length, k.length);
    let eq = 1;
    r.trades.forEach(t => { eq *= 1 + t.ret; assert.ok(t.exitT >= t.entryT); });
    near(eq - 1, r.totalReturn, 1e-9);          // compounded trade returns reproduce the total
    near(r.equity[k.length - 1] - 1, r.totalReturn, 1e-9);
    assert.ok(r.maxDD >= 0 && r.maxDD <= 1);
  });
});

test('maxDrawdown', () => {
  near(C.maxDrawdown([1, 1.2, 0.9, 1.5, 1.2]), 0.25);
  assert.equal(C.maxDrawdown([1, 2, 3]), 0);
});

test('monteCarlo: deterministic, ordered percentiles, sensible extremes', () => {
  const p = { winRate: 0.5, rr: 2, riskPct: 1, trades: 100, runs: 500, seed: 42 };
  const a = C.monteCarlo(p), b = C.monteCarlo(p);
  assert.deepEqual(a.final, b.final);
  assert.ok(a.final.p5 <= a.final.p50 && a.final.p50 <= a.final.p95);
  assert.equal(a.bands.p50.length, 101);
  assert.ok(a.final.p50 > 1.3 && a.final.p50 < 2.2, 'median ' + a.final.p50);  // expectancy +0.5R per trade
  assert.ok(a.probDD(0.1) >= a.probDD(0.3));
  const sure = C.monteCarlo({ winRate: 1, rr: 1, riskPct: 1, trades: 10, runs: 10 });
  near(sure.final.p5, Math.pow(1.01, 10)); assert.equal(sure.probLoss, 0); assert.equal(sure.dd.p95, 0);
  const doomed = C.monteCarlo({ winRate: 0, rr: 1, riskPct: 10, trades: 10, runs: 10 });
  near(doomed.final.p95, Math.pow(0.9, 10)); assert.equal(doomed.probLoss, 1); assert.equal(doomed.probDD(0.5), 1);
  const risky = C.monteCarlo({ ...p, riskPct: 5 });
  assert.ok(risky.dd.p50 > a.dd.p50);
});

test('normalizers: exchange payloads become ascending candles', () => {
  const bn = C.normalizeBinance([[1000, '10', '12', '9', '11', '5', 1999], [2000, '11', '13', '10', '12', '6', 2999]]);
  assert.deepEqual(bn, [{ t: 1000, o: 10, h: 12, l: 9, c: 11, v: 5 }, { t: 2000, o: 11, h: 13, l: 10, c: 12, v: 6 }]);
  assert.deepEqual(C.normalizeBinance({ code: -1121, msg: 'Invalid symbol.' }), []);
  const by = C.normalizeBybit({ retCode: 0, result: { list: [['2000', '11', '13', '10', '12', '6', '70'], ['1000', '10', '12', '9', '11', '5', '50']] } });
  assert.deepEqual(by.map(x => x.t), [1000, 2000]);
  assert.deepEqual(C.normalizeBybit({ retCode: 10001, result: {} }), []);
  const ok = C.normalizeOkx({ code: '0', data: [['2000', '11', '13', '10', '12', '6'], ['1000', '10', '12', '9', '11', '5']] });
  assert.deepEqual(ok.map(x => x.c), [11, 12]);
  assert.deepEqual(C.normalizeOkx({ code: '51001', data: [] }), []);
});

test('splitSymbol', () => {
  assert.deepEqual(C.splitSymbol('btcusdt'), { base: 'BTC', quote: 'USDT' });
  assert.deepEqual(C.splitSymbol('ETHBTC'), { base: 'ETH', quote: 'BTC' });
  assert.equal(C.splitSymbol('???'), null);
});

test('parseCsv: TradingView style with unix seconds', () => {
  const r = C.parseCsv('time,open,high,low,close,Volume\n1700003600,11,13,10,12,6\n1700000000,10,12,9,11,5\n');
  assert.equal(r.error, undefined);
  assert.deepEqual(r.candles.map(c => c.t), [1700000000000, 1700003600000]);
  assert.equal(r.candles[0].c, 11);
});

test('parseCsv: Investing.com style (newest first, quoted thousands, Price = close)', () => {
  const csv = '"Date","Price","Open","High","Low","Vol.","Change %"\n' +
    '"11/13/2026","2,015.50","2,000.00","2,020.00","1,995.25","12.5K","0.78%"\n' +
    '"11/12/2026","2,000.00","1,990.00","2,005.00","1,985.00","1.2M","0.50%"\n';
  const r = C.parseCsv(csv);
  assert.equal(r.candles.length, 2);
  assert.equal(r.candles[1].c, 2015.5);
  assert.equal(r.candles[1].l, 1995.25);
  assert.equal(r.candles[1].v, 12500);
  assert.equal(new Date(r.candles[1].t).getMonth(), 10);
  assert.ok(r.candles[0].t < r.candles[1].t);
});

test('parseCsv: MetaTrader tab-separated with separate date and time columns', () => {
  const csv = '<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\n' +
    '2026.01.02\t00:00:00\t1.1000\t1.1050\t1.0980\t1.1020\t100\n' +
    '2026.01.02\t01:00:00\t1.1020\t1.1060\t1.1010\t1.1040\t120\n';
  const r = C.parseCsv(csv);
  assert.equal(r.candles.length, 2);
  assert.equal(r.candles[1].t - r.candles[0].t, 3600000);
  assert.equal(r.candles[1].v, 120);
});

test('parseCsv: day-first dates, semicolons, no header, close only, bad files', () => {
  const dayFirst = C.parseCsv('Date;Open;High;Low;Close\n25/12/2025;10;12;9;11\n05/01/2026;11;13;10;12\n');
  assert.equal(new Date(dayFirst.candles[0].t).getMonth(), 11);
  assert.equal(new Date(dayFirst.candles[1].t).getDate(), 5);
  const bare = C.parseCsv('2026-01-01,10,12,9,11,5\n2026-01-02,11,13,10,12,6\n');
  assert.equal(bare.candles.length, 2);
  assert.equal(bare.candles[1].v, 6);
  const closeOnly = C.parseCsv('date,close\n2026-01-01,10\n2026-01-02,11\n');
  assert.equal(closeOnly.closeOnly, true);
  assert.equal(closeOnly.candles[1].h, 11);
  const skipped = C.parseCsv('date,open,high,low,close\n2026-01-01,10,12,9,11\nbad,row,x,y,z\n');
  assert.equal(skipped.candles.length, 1); assert.equal(skipped.skipped, 1);
  assert.equal(C.parseCsv('').error, 'empty');
  assert.equal(C.parseCsv('a,b\n1,2\n').error, 'columns');
  assert.equal(C.parseCsv('date,close\nx,y\n').error, 'rows');
});

test('demoCandles: deterministic and well formed', () => {
  const a = C.demoCandles(200, 5, 3600000), b = C.demoCandles(200, 5, 3600000);
  assert.deepEqual(a, b);
  assert.ok(a.every(x => x.h >= Math.max(x.o, x.c) && x.l <= Math.min(x.o, x.c) && x.l > 0));
  assert.equal(a[1].t - a[0].t, 3600000);
});
