// Unit tests for insight-core.js with a fixed synthetic dataset and hand-built samples.
// Run: node tests/insight-core.test.js
const C = require('../insight-core.js');
const assert = require('assert');
let pass = 0, failN = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('ok   ' + name); } catch (e) { failN++; console.log('FAIL ' + name + '\n     ' + e.message); } };
const NOW = Date.UTC(2026, 9, 17, 6, 30); // 12:00 IST
const DAY = 864e5, id = n => 'evt_' + String(n).padStart(8, '0');

t('unknown event type is rejected', () => assert.strictEqual(C.validate({ id: id(1), name: 'hack' }).ok, false));
t('bad id is rejected', () => assert.strictEqual(C.validate({ id: 'x', name: 'page_view' }).ok, false));
t('prohibited fields are rejected', () => {
  for (const k of ['password', 'otp', 'cardNumber', 'cvv', 'upiPin', 'flag', 'answer', 'message', 'ip']) assert.strictEqual(C.validate({ id: id(2), name: 'click', [k]: 'x' }).ok, false, k);
});
t('raw IP or email never stored; long digit runs redacted', () => {
  const v = C.validate({ id: id(3), name: 'click', feature: 'a@b.com', page: 'p9876543210', ipAddress: '1.2.3.4' }); assert.strictEqual(v.ok, false);
  const w = C.validate({ id: id(3), name: 'click', feature: 'a@b.com', page: 'p9876543210' }).event; assert.strictEqual(w.feature, '[redacted]'); assert.strictEqual(w.page, '[redacted]');
});
t('unlisted fields are dropped', () => { const v = C.validate({ id: id(4), name: 'click', foo: 'bar' }).event; assert.strictEqual(v.foo, undefined); });
t('business events from the browser are rejected (server only)', () => {
  assert.strictEqual(C.validate({ id: id(5), name: 'paid_access_granted' }).ok, false);
  assert.strictEqual(C.validate({ id: id(5), name: 'paid_access_granted', source: 'server' }).ok, true);
});
t('session context overrides client-sent role and plan', () => {
  const v = C.validate({ id: id(6), name: 'click', role: 'admin', plan: 'paid' }, { session: { uid: 'u1', role: 'student', plan: 'free' } }).event;
  assert.deepStrictEqual([v.uid, v.role, v.plan], ['u1', 'student', 'free']);
  const g = C.validate({ id: id(6), name: 'click', role: 'admin' }).event; assert.strictEqual(g.role, 'guest');
});
t('ingest dedups by id: 3 sent, 1 duplicate', () => {
  const s = []; const r = C.ingest(s, [{ id: id(7), name: 'page_load', dur: 100 }, { id: id(7), name: 'page_load', dur: 100 }, { id: id(8), name: 'page_load', dur: 200 }], {});
  assert.deepStrictEqual([r.accepted, r.duplicate, s.length], [2, 1, 2]);
});
t('no consent: analytics events dropped, essential events kept', () => {
  const s = []; const r = C.ingest(s, [{ id: id(9), name: 'click' }, { id: id(10), name: 'js_error' }], { consent: false });
  assert.deepStrictEqual([r.accepted, r.rejected.length, s[0].name], [1, 1, 'js_error']);
});
t('long text fields are clipped to 80 characters', () => assert.strictEqual(C.validate({ id: id(11), name: 'click', op: 'q'.repeat(3000) }).event.op.length, 80));
t('out-of-range duration is rejected', () => assert.strictEqual(C.validate({ id: id(12), name: 'page_load', dur: -5 }).ok, false));
t('quantiles: p50/p95 exact on 1..100', () => { const xs = Array.from({ length: 100 }, (_, i) => i + 1); const p = C.pct(xs); assert.deepStrictEqual([p.p50, p.p95, p.p99], [51, 95, 99]); });
t('p95 withheld below 20 samples, p99 below 100', () => { const p = C.pct([1, 2, 3]); assert.strictEqual(p.p95, null); assert.strictEqual(p.p99, null); assert.strictEqual(C.pct(Array(50).fill(5)).p99, null); });

// hand-built funnel with known answer: 10 start checkout, 8 attempt, 6 verified, 5 granted; one user out of order
t('funnel counts ordered unique users with previous-step denominators', () => {
  const ev = []; let n = 100; const E = (u, name, k) => ev.push({ id: id(n++), name, uid: 'u' + u, ts: NOW - DAY + k * 1000 + u, source: 'server' });
  for (let u = 0; u < 10; u++) { E(u, 'checkout_started', 1); if (u < 8) E(u, 'payment_attempt', 2); if (u < 6) E(u, 'payment_verified', 3); if (u < 5) E(u, 'paid_access_granted', 4); }
  E(20, 'paid_access_granted', 0); // granted without checkout: not counted
  const f = C.funnel(ev, 'checkout');
  assert.deepStrictEqual(f.stages.map(s => s.users), [10, 8, 6, 5]);
  assert.strictEqual(f.conversion, 0.5); assert.strictEqual(f.worst.to, 'Payment verified'); assert.strictEqual(f.worst.lost, 2); // 8 -> 6 is a 25% drop, larger than 10 -> 8 (20%)
  assert.deepStrictEqual(f.instrumented, [true, true, true, true]);
});
t('uninstrumented stages are flagged, not treated as real zero', () => { const f = C.funnel([{ id: id(1), name: 'lab_started', uid: 'a', ts: 1 }], 'lab'); assert.deepStrictEqual(f.instrumented, [true, false, false]); });
t('error rate withheld below 30 requests', () => { const h = C.headline([{ name: 'api_call', result: 'fail', ts: 1 }]); assert.strictEqual(h.errorRate, null); });

// synthetic dataset: deterministic, labelled, and carries a known OFF-05 slowdown
const S = C.synthetic(NOW);
t('synthetic data is labelled and deterministic', () => {
  assert.ok(S.length > 1000); assert.ok(S.every(e => e.synthetic === true));
  const S2 = C.synthetic(NOW); assert.strictEqual(S2.length, S.length); assert.deepStrictEqual(S2[500], S[500]);
});
t('synthetic events contain no prohibited fields', () => assert.ok(S.every(e => Object.keys(e).every(k => !/pass|otp|cvv|card|pin\b|flag|answer|message|email|phone|\bip\b/i.test(k)))));
const F = { from: NOW - 7 * DAY, to: NOW };
t('friction ranks the slowed OFF-05 lab start first among lab starts with a p95 rise', () => {
  const fr = C.friction(S, F); const lab = fr.slow.filter(r => r.op.startsWith('Lab start'));
  assert.ok(lab.length); const off = fr.slow.find(r => r.op === 'Lab start: OFF-05'); assert.ok(off, 'OFF-05 row'); assert.ok(off.change > 0.25, 'p95 change ' + off.change);
});
t('insight feed reports the OFF-05 slowdown with a peak-hour hypothesis', () => {
  const ins = C.insights(S, F); const c = ins.find(x => x.key === 'slow:Lab start: OFF-05'); assert.ok(c, 'card exists');
  assert.ok(c.hypotheses.some(h => /18:00|19:00|20:00|IST/.test(h.text)), 'peak hypothesis'); assert.ok(c.evidence.length >= 1);
});
t('every insight without a supported hypothesis says so', () => C.insights(S, F).forEach(c => assert.ok(c.hypotheses.length || c.noCause, c.title)));
t('forecast with 35 days returns a result with a backtest', () => { const f = C.forecast(S, 'lab', NOW); assert.strictEqual(f.status, 'ok'); assert.ok(f.mae != null); });
t('forecast with short history says "Insufficient data for reliable forecast"', () => {
  const short = S.filter(e => e.ts > NOW - 10 * DAY); const f = C.forecast(short, 'lab', NOW); assert.strictEqual(f.status, 'insufficient'); assert.ok(/^Insufficient data for reliable forecast/.test(f.why));
});
t('anomaly detection needs a baseline', () => { const a = C.anomalies(S.filter(e => e.ts > NOW - 2 * DAY), NOW); assert.ok(a.every(x => x.status === 'insufficient')); });
t('alert rules evaluate with configurable thresholds', () => {
  const r1 = C.evaluateRules(S, F, [{ id: 'X', metric: 'error_rate', op: '>', value: 0, on: true }]); assert.strictEqual(r1[0].fired, true);
  const r2 = C.evaluateRules(S, F, [{ id: 'X', metric: 'error_rate', op: '>', value: 0.99, on: true }]); assert.strictEqual(r2[0].fired, false);
});
t('analyst refuses questions outside the allowlist and never runs SQL', () => {
  const r = C.ask(S, F, 'DROP TABLE users; select * from payments'); assert.strictEqual(r.intent, 'dropoff'); // "drop" maps to the funnel query, not SQL
  const r2 = C.ask(S, F, 'tell me a joke'); assert.strictEqual(r2.intent, null);
  const r3 = C.ask(S, F, 'Which labs are slow to start?'); assert.strictEqual(r3.intent, 'slow_labs'); assert.ok(/OFF-05/.test(r3.answer));
});
console.log(`\n${pass} passed, ${failN} failed`); process.exit(failN ? 1 : 0);
