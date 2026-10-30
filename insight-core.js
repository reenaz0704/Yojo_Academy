/* Yojo Insight Engine: analysis core (design document pages 37 and 38, 09H and 09I).
   Pure functions over validated analytics events. The same code runs in the browser demo (admin-data.js
   calls it as the "server") and in Node tests (tests/insight-core.test.js), so every number on the
   Insight Engine pages can be checked against a dataset with known answers.
   Nothing here invents a figure: when a sample is too small the result says so instead.
   All thresholds are [PROVISIONAL] and live in DEFAULTS so an admin can change them. */
(function (root) {
  'use strict';
  const HOUR = 36e5, DAY = 864e5;

  /* ---------------- event schema ---------------- */
  const SCHEMA_VERSION = 1;
  // name -> purpose. 'essential' = service health and business events (always on);
  // 'analytics' = behavioural events (only with the visitor's consent).
  const EVENTS = {
    page_view: 'analytics', page_time: 'analytics', scroll_depth: 'analytics', click: 'analytics', rage_click: 'analytics', dead_click: 'analytics',
    search: 'analytics', popup_shown: 'analytics', popup_closed: 'analytics', blog_read: 'analytics', video_progress: 'analytics', job_hunter_scan: 'analytics',
    page_load: 'essential', web_vital: 'essential', api_call: 'essential', js_error: 'essential', video_buffer: 'essential', otp_delivery: 'essential',
    message_delivery: 'essential', lab_provision: 'essential',
    signup_completed: 'essential', onboarding_completed: 'essential', lab_started: 'essential', lab_checkpoint: 'essential', lab_completed: 'essential',
    lesson_completed: 'essential', class_joined: 'essential', assessment_started: 'essential', assessment_submitted: 'essential', blog_submitted: 'essential',
    ctf_registered: 'essential', ctf_flag_attempt: 'essential', enquiry_submitted: 'essential',
    checkout_started: 'essential', payment_attempt: 'essential', payment_verified: 'essential', payment_failed: 'essential', paid_access_granted: 'essential'
  };
  // events whose truth must come from the server record, never from a browser
  const SERVER_ONLY = new Set(['payment_verified', 'payment_failed', 'paid_access_granted', 'otp_delivery', 'message_delivery']);
  const FIELDS = ['id', 'name', 'v', 'ts', 'rts', 'uid', 'sid', 'role', 'plan', 'mode', 'batch', 'page', 'area', 'feature', 'op', 'dur', 'value', 'result', 'err', 'method', 'device', 'browser', 'screen', 'net', 'lang', 'region', 'purpose', 'source', 'synthetic'];
  // never accepted, at any depth or under any spelling
  const PROHIBITED = /pass(word)?|otp|pin\b|cvv|card|pan\b|flag|answer|message|body|text|email|phone|ip\b|address/i;
  const MAX_BYTES = 2048;

  function validate(e, ctx = {}) {
    if (!e || typeof e !== 'object') return { ok: false, why: 'not an object' };
    if (!EVENTS[e.name]) return { ok: false, why: 'unknown event type' };
    if (typeof e.id !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(e.id)) return { ok: false, why: 'missing or bad event id' };
    if (SERVER_ONLY.has(e.name) && e.source !== 'server') return { ok: false, why: 'business event must come from the server' };
    const out = {};
    for (const k of FIELDS) if (e[k] !== undefined && e[k] !== null && e[k] !== '') out[k] = e[k];
    for (const k of Object.keys(e)) if (!FIELDS.includes(k) && PROHIBITED.test(k)) return { ok: false, why: 'prohibited field ' + k };
    for (const k of ['page', 'feature', 'op', 'err', 'area']) if (out[k] != null) { out[k] = String(out[k]).slice(0, 80); if (/@|\d{10,}/.test(out[k])) out[k] = '[redacted]'; }
    if (out.dur != null) { out.dur = Number(out.dur); if (!(out.dur >= 0 && out.dur < 6 * HOUR)) return { ok: false, why: 'duration out of range' }; }
    out.v = SCHEMA_VERSION; out.purpose = EVENTS[e.name];
    out.rts = ctx.now || Date.now();                       // server receipt time is authoritative for ordering
    if (!(out.ts > 0) || Math.abs(out.ts - out.rts) > 2 * DAY) out.ts = out.rts;
    // context from the authenticated server session wins over anything the client sent
    if (ctx.session) for (const k of ['uid', 'role', 'plan', 'mode', 'batch']) { if (ctx.session[k] != null) out[k] = ctx.session[k]; else delete out[k]; }
    else for (const k of ['role', 'plan', 'mode', 'batch']) delete out[k];
    if (!out.role) out.role = 'guest';
    if (JSON.stringify(out).length > MAX_BYTES) return { ok: false, why: 'event too large' };
    return { ok: true, event: out };
  }
  // idempotent ingest: duplicate ids are dropped
  function ingest(store, incoming, ctx = {}) {
    const seen = new Set(store.map(x => x.id)); const res = { accepted: 0, duplicate: 0, rejected: [] };
    for (const e of incoming) {
      if (e && seen.has(e.id)) { res.duplicate++; continue; }
      if (!ctx.consent && e && EVENTS[e.name] === 'analytics') { res.rejected.push({ id: e.id, why: 'no analytics consent' }); continue; }
      const v = validate(e, ctx); if (!v.ok) { res.rejected.push({ id: e && e.id, why: v.why }); continue; }
      store.push(v.event); seen.add(v.event.id); res.accepted++;
    }
    return res;
  }

  /* ---------------- helpers ---------------- */
  const DEFAULTS = {
    minSampleP95: 20, minSampleP99: 100, minSampleRate: 30,
    anomaly: { baselineDays: 7, minBaselineDays: 5, z: 3, minRelChange: 0.25, minDailySample: 10 },
    forecast: { minHistoryDays: 28 },
    rules: [
      { id: 'AR-ERR', metric: 'error_rate', op: '>', value: 0.05, severity: 'High', cooldownH: 6, on: true, label: 'Error rate above 5%' },
      { id: 'AR-P95', metric: 'p95_load_ms', op: '>', value: 4000, severity: 'Medium', cooldownH: 6, on: true, label: 'Page-load p95 above 4 s' },
      { id: 'AR-FUN', metric: 'checkout_conversion', op: '<', value: 0.2, severity: 'High', cooldownH: 24, on: true, label: 'Checkout to paid below 20%' }
    ]
  };
  const quantile = (xs, q) => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return Math.round(s[lo] + (s[hi] - s[lo]) * (i - lo)); };
  function pct(xs, cfg = DEFAULTS) { const n = xs.length; return { n, p50: n ? quantile(xs, .5) : null, p95: n >= cfg.minSampleP95 ? quantile(xs, .95) : null, p99: n >= cfg.minSampleP99 ? quantile(xs, .99) : null }; }
  const uniq = xs => new Set(xs).size;
  const change = (cur, prev) => cur == null || prev == null || prev === 0 ? null : (cur - prev) / prev;
  const round = (x, d = 1) => x == null ? null : Math.round(x * 10 ** d) / 10 ** d;

  function applyFilters(ev, f = {}) {
    return ev.filter(e => (!f.from || e.ts >= f.from) && (!f.to || e.ts < f.to) && (!f.role || e.role === f.role) && (!f.plan || (e.plan || 'none') === f.plan)
      && (!f.mode || e.mode === f.mode) && (!f.batch || e.batch === f.batch) && (!f.device || e.device === f.device) && (!f.browser || e.browser === f.browser) && (!f.region || e.region === f.region));
  }
  function periods(f) { const len = f.to - f.from; return { cur: { ...f }, prev: { ...f, from: f.from - len, to: f.from } }; }

  /* ---------------- headline metrics ---------------- */
  function sessions(ev) {
    const m = new Map();
    for (const e of ev) { if (!e.sid) continue; const s = m.get(e.sid) || { sid: e.sid, uid: e.uid, start: e.ts, end: e.ts, pages: [], errors: 0, device: e.device, plan: e.plan, mode: e.mode };
      s.start = Math.min(s.start, e.ts); s.end = Math.max(s.end, e.ts + (e.name === 'page_time' ? 0 : 0));
      if (e.name === 'page_view') s.pages.push({ ts: e.ts, page: e.page, area: e.area });
      if (e.name === 'js_error' || (e.name === 'api_call' && e.result === 'fail')) s.errors++;
      m.set(e.sid, s); }
    return [...m.values()].map(s => ({ ...s, dur: s.end - s.start, pages: s.pages.sort((a, b) => a.ts - b.ts) }));
  }
  function headline(ev) {
    const ss = sessions(ev), users = uniq(ev.filter(e => e.uid).map(e => e.uid));
    const req = ev.filter(e => e.name === 'api_call').length + ev.filter(e => e.name === 'page_view').length;
    const errs = ev.filter(e => e.name === 'js_error' || (e.name === 'api_call' && e.result === 'fail')).length;
    const loads = ev.filter(e => e.name === 'page_load' && e.dur != null).map(e => e.dur);
    return { users, sessions: ss.length, events: ev.length, avgSessionMs: ss.length ? Math.round(ss.reduce((a, s) => a + s.dur, 0) / ss.length) : null,
      errorRate: req >= DEFAULTS.minSampleRate ? errs / req : null, errorCount: errs, requests: req, load: pct(loads) };
  }
  function overview(all, f, cfg = DEFAULTS) {
    const { cur, prev } = periods(f), a = applyFilters(all, cur), b = applyFilters(all, prev);
    const h = headline(a), hp = headline(b);
    return { period: { from: cur.from, to: cur.to }, prevPeriod: { from: prev.from, to: prev.to }, cur: h, prev: hp,
      delta: { users: change(h.users, hp.users), avgSessionMs: change(h.avgSessionMs, hp.avgSessionMs), errorRate: h.errorRate != null && hp.errorRate != null ? h.errorRate - hp.errorRate : null, p95: change(h.load.p95, hp.load.p95) },
      timeByArea: timeByArea(a, b), funnels: funnels(a), freshness: all.length ? Math.max(...all.map(e => e.rts || e.ts)) : null, sample: a.length };
  }

  /* ---------------- time spent by area ---------------- */
  const AREAS = ['Labs and cyber range', 'Courses and LMS', 'Live and recorded classes', 'Dashboard', 'Lore Vault', 'CTF', 'Job Hunter'];
  function timeByArea(a, b = []) {
    const sum = (ev, ar) => ev.filter(e => e.name === 'page_time' && e.area === ar).reduce((x, e) => x + e.dur, 0);
    const rows = AREAS.map(ar => ({ area: ar, ms: sum(a, ar), prevMs: sum(b, ar), users: uniq(a.filter(e => e.name === 'page_time' && e.area === ar).map(e => e.uid)) }));
    const total = rows.reduce((x, r) => x + r.ms, 0);
    return { total, rows: rows.map(r => ({ ...r, share: total ? r.ms / total : 0, change: change(r.ms, r.prevMs) })) };
  }

  /* ---------------- funnels (ordered, unique users) ---------------- */
  const FUNNELS = {
    signup: { title: 'Landing to paid', stages: [['Landing page', e => e.name === 'page_view' && e.area === 'Landing'], ['Sign-up', e => e.name === 'signup_completed'], ['Onboarding completed', e => e.name === 'onboarding_completed'], ['First lab', e => e.name === 'lab_started'], ['Checkout started', e => e.name === 'checkout_started'], ['Paid', e => e.name === 'paid_access_granted']] },
    lab: { title: 'Lab completion', stages: [['Lab started', e => e.name === 'lab_started'], ['Checkpoint completed', e => e.name === 'lab_checkpoint'], ['Lab completed', e => e.name === 'lab_completed']] },
    checkout: { title: 'Checkout to paid access', stages: [['Checkout started', e => e.name === 'checkout_started'], ['Payment attempt', e => e.name === 'payment_attempt'], ['Payment verified', e => e.name === 'payment_verified'], ['Paid access granted', e => e.name === 'paid_access_granted']] }
  };
  function funnel(ev, key) {
    const F = FUNNELS[key], byUser = new Map();
    for (const e of ev) if (e.uid) (byUser.get(e.uid) || byUser.set(e.uid, []).get(e.uid)).push(e);
    const counts = F.stages.map(() => 0);
    for (const list of byUser.values()) {
      list.sort((x, y) => x.ts - y.ts); let t = -Infinity;
      for (let i = 0; i < F.stages.length; i++) { const hit = list.find(e => e.ts >= t && F.stages[i][1](e)); if (!hit) break; counts[i]++; t = hit.ts; }
    }
    const stages = F.stages.map(([label], i) => ({ label, users: counts[i], fromPrev: i ? (counts[i - 1] ? counts[i] / counts[i - 1] : null) : 1, fromStart: counts[0] ? counts[i] / counts[0] : null }));
    let worst = null; stages.forEach((s, i) => { if (i && s.fromPrev != null) { const drop = 1 - s.fromPrev; if (!worst || drop > worst.drop) worst = { from: stages[i - 1].label, to: s.label, drop, lost: stages[i - 1].users - s.users }; } });
    const instrumented = F.stages.map(([, test]) => ev.some(test));
    return { key, title: F.title, stages, conversion: counts[0] ? counts[counts.length - 1] / counts[0] : null, abandonment: counts[0] ? 1 - counts[counts.length - 1] / counts[0] : null, worst, instrumented };
  }
  const funnels = ev => Object.keys(FUNNELS).map(k => funnel(ev, k));

  /* ---------------- friction ---------------- */
  function friction(all, f, cfg = DEFAULTS) {
    const { cur, prev } = periods(f), a = applyFilters(all, cur), b = applyFilters(all, prev);
    const ops = new Map(); const key = e => e.name === 'page_load' ? 'Page load: ' + e.page : e.name === 'api_call' ? 'API: ' + e.op : e.name === 'lab_provision' ? 'Lab start: ' + (e.feature || 'lab') : e.name === 'video_buffer' ? 'Video buffering: ' + (e.feature || 'video') : null;
    const add = (ev, slot) => ev.forEach(e => { if (e.dur == null) return; const k = key(e); if (!k) return; const o = ops.get(k) || ops.set(k, { op: k, cur: [], prev: [] }).get(k); o[slot].push(e.dur); });
    add(a, 'cur'); add(b, 'prev');
    const slow = [...ops.values()].map(o => { const c = pct(o.cur, cfg), p = pct(o.prev, cfg); return { op: o.op, ...c, prevP95: p.p95, change: change(c.p95, p.p95), note: c.p95 == null ? `Only ${c.n} samples (p95 needs ${cfg.minSampleP95})` : '' }; })
      .filter(r => r.n).sort((x, y) => (y.p95 ?? -1) - (x.p95 ?? -1) || (y.p50 ?? 0) - (x.p50 ?? 0));
    const cat = new Map(); a.filter(e => e.name === 'js_error' || e.name === 'payment_failed' || (e.name === 'api_call' && e.result === 'fail') || (e.name === 'otp_delivery' && e.dur > 60000) || e.name === 'video_buffer' || e.name === 'dead_click' || e.name === 'rage_click' || (e.name === 'message_delivery' && e.result === 'fail'))
      .forEach(e => { const k = e.name === 'api_call' ? 'Failed API request' : e.name === 'js_error' ? 'Crash or script error' : e.name === 'payment_failed' ? 'Payment failed' + (e.method ? ' (' + e.method + ')' : '') : e.name === 'otp_delivery' ? 'OTP email over 60 s' : e.name === 'video_buffer' ? 'Video buffering' : e.name === 'dead_click' ? 'Dead click' : e.name === 'rage_click' ? 'Rage click' : 'WhatsApp delivery failed';
        const r = cat.get(k) || cat.set(k, { category: k, events: 0, users: new Set(), where: new Map() }).get(k); r.events++; if (e.uid) r.users.add(e.uid); const w = e.feature || e.op || e.page || '-'; r.where.set(w, (r.where.get(w) || 0) + 1); });
    const errors = [...cat.values()].map(r => ({ category: r.category, events: r.events, users: r.users.size, top: [...r.where.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([w, n]) => ({ where: w, n })) })).sort((x, y) => y.users - x.users || y.events - x.events);
    const ss = sessions(a); const exits = new Map(); ss.forEach(s => { const l = s.pages[s.pages.length - 1]; if (l) exits.set(l.page, (exits.get(l.page) || 0) + 1); });
    const exitPages = [...exits.entries()].map(([page, n]) => ({ page, sessions: n, share: ss.length ? n / ss.length : 0 })).sort((x, y) => y.sessions - x.sessions).slice(0, 8);
    const abandon = funnels(a).map(fu => fu.worst && { journey: fu.title, step: fu.worst.from + ' → ' + fu.worst.to, lost: fu.worst.lost, drop: fu.worst.drop }).filter(Boolean)
      .concat([['popup_shown', 'popup_closed', 'CTF registration pop-up closed']].map(([s, c, label]) => { const n = a.filter(e => e.name === s).length; return n ? { journey: label, step: 'Shown → closed', lost: a.filter(e => e.name === c).length, drop: a.filter(e => e.name === c).length / n } : null; }).filter(Boolean));
    return { period: { from: cur.from, to: cur.to }, slow, errors, exitPages, abandon, sample: a.length };
  }
  // drill-down: daily series + segment split for one operation or error category
  function drill(all, f, sel) {
    const a = applyFilters(all, f), test = sel.op ? (e => (e.name === 'page_load' && 'Page load: ' + e.page === sel.op) || (e.name === 'api_call' && 'API: ' + e.op === sel.op) || (e.name === 'lab_provision' && 'Lab start: ' + (e.feature || 'lab') === sel.op) || (e.name === 'video_buffer' && 'Video buffering: ' + (e.feature || 'video') === sel.op)) : (e => e.name === sel.name);
    const hit = a.filter(test), days = [];
    for (let t = startOfDay(f.from); t < f.to; t += DAY) { const d = hit.filter(e => e.ts >= t && e.ts < t + DAY); days.push({ day: t, n: d.length, p95: pct(d.filter(e => e.dur != null).map(e => e.dur)).p95, p50: pct(d.filter(e => e.dur != null).map(e => e.dur)).p50 }); }
    const seg = k => { const m = new Map(); hit.forEach(e => { const v = e[k] || 'unknown'; m.set(v, (m.get(v) || 0) + 1); }); return [...m.entries()].map(([v, n]) => ({ v, n })).sort((x, y) => y.n - x.n); };
    const hours = Array.from({ length: 24 }, (_, h) => { const d = hit.filter(e => istHour(e.ts) === h && e.dur != null).map(e => e.dur); return { h, n: d.length, p50: pct(d).p50, p95: d.length >= 10 ? quantile(d, .95) : null }; });
    return { sel, n: hit.length, days, device: seg('device'), plan: seg('plan'), browser: seg('browser'), hours };
  }

  /* ---------------- anomalies ---------------- */
  const istHour = t => new Date(t + 5.5 * HOUR).getUTCHours();
  const startOfDay = t => { const x = t + 5.5 * HOUR; return x - (x % DAY) - 5.5 * HOUR; };
  function dailySeries(all, metric, to, days) {
    const out = [];
    for (let d = days - 1; d >= 0; d--) { const from = startOfDay(to) - d * DAY, ev = all.filter(e => e.ts >= from && e.ts < from + DAY); out.push({ day: from, ...metricOf(ev, metric) }); }
    return out;
  }
  function metricOf(ev, m) {
    if (m === 'error_rate') { const r = ev.filter(e => e.name === 'api_call' || e.name === 'page_view').length, x = ev.filter(e => e.name === 'js_error' || (e.name === 'api_call' && e.result === 'fail')).length; return { value: r ? x / r : null, n: r }; }
    if (m === 'p95_load_ms') { const d = ev.filter(e => e.name === 'page_load').map(e => e.dur); return { value: d.length >= 5 ? quantile(d, .95) : null, n: d.length }; }
    if (m === 'p95_lab_start_ms') { const d = ev.filter(e => e.name === 'lab_provision').map(e => e.dur); return { value: d.length >= 5 ? quantile(d, .95) : null, n: d.length }; }
    if (m === 'lab_demand') { const n = ev.filter(e => e.name === 'lab_started').length; return { value: n, n }; }
    if (m === 'payment_failure_rate') { const att = ev.filter(e => e.name === 'payment_attempt').length, f = ev.filter(e => e.name === 'payment_failed').length; return { value: att ? f / att : null, n: att }; }
    if (m === 'active_users') { const n = uniq(ev.filter(e => e.uid).map(e => e.uid)); return { value: n, n }; }
    if (m === 'checkout_conversion') { const fu = funnel(ev, 'checkout'); return { value: fu.conversion, n: fu.stages[0].users }; }
    return { value: null, n: 0 };
  }
  const ANOMALY_METRICS = [['error_rate', 'Error rate', 'up'], ['p95_load_ms', 'Page-load p95', 'up'], ['p95_lab_start_ms', 'Lab start p95', 'up'], ['payment_failure_rate', 'Payment failure rate', 'up'], ['lab_demand', 'Lab starts per day', 'both'], ['active_users', 'Active users per day', 'both']];
  function anomalies(all, to, cfg = DEFAULTS) {
    const A = cfg.anomaly, out = [];
    for (const [m, label, dir] of ANOMALY_METRICS) {
      const s = dailySeries(all, m, to, A.baselineDays + 1), today = s[s.length - 1], base = s.slice(0, -1).filter(x => x.value != null && x.n >= A.minDailySample);
      if (today.value == null || today.n < A.minDailySample) { out.push({ metric: m, label, status: 'insufficient', why: `Latest day has ${today.n} samples (needs ${A.minDailySample})` }); continue; }
      if (base.length < A.minBaselineDays) { out.push({ metric: m, label, status: 'insufficient', why: `Baseline has ${base.length} usable days (needs ${A.minBaselineDays})` }); continue; }
      const mean = base.reduce((a, x) => a + x.value, 0) / base.length, sd = Math.sqrt(base.reduce((a, x) => a + (x.value - mean) ** 2, 0) / base.length) || Math.abs(mean) * 0.05 || 1e-9;
      const z = (today.value - mean) / sd, rel = mean ? (today.value - mean) / Math.abs(mean) : null;
      const flagged = Math.abs(z) >= A.z && rel != null && Math.abs(rel) >= A.minRelChange && (dir === 'both' || (dir === 'up' ? z > 0 : z < 0));
      out.push({ metric: m, label, status: flagged ? 'anomaly' : 'normal', value: today.value, baseline: mean, z: round(z, 2), rel, day: today.day, n: today.n, baselineDays: base.length });
    }
    return out;
  }

  /* ---------------- forecast (seasonal naive by IST hour, backtested) ---------------- */
  function forecast(all, kind, to, cfg = DEFAULTS) {
    const name = kind === 'class' ? 'class_joined' : 'lab_started', ev = all.filter(e => e.name === name && e.ts < to);
    if (!ev.length) return { kind, status: 'insufficient', why: 'No ' + (kind === 'class' ? 'class joins' : 'lab starts') + ' recorded yet.' };
    const first = Math.min(...ev.map(e => e.ts)), days = Math.floor((to - first) / DAY);
    if (days < cfg.forecast.minHistoryDays) return { kind, status: 'insufficient', why: `Insufficient data for reliable forecast: ${days} days of history, ${cfg.forecast.minHistoryDays} needed.`, days };
    const prof = (fromT, toT) => { const h = Array(24).fill(0), nd = Math.max(1, Math.round((toT - fromT) / DAY)); ev.filter(e => e.ts >= fromT && e.ts < toT).forEach(e => h[istHour(e.ts)]++); return h.map(x => x / nd); };
    const train = prof(to - 28 * DAY, to - 7 * DAY), test = prof(to - 7 * DAY, to), mae = train.reduce((a, x, i) => a + Math.abs(x - test[i]), 0) / 24;
    const fc = prof(to - 28 * DAY, to), peak = fc.indexOf(Math.max(...fc));
    return { kind, status: 'ok', horizon: 'Next 7 days, by hour of day (IST)', method: 'Average of the last 28 days for each hour (seasonal naive)', assumptions: 'No new batches, events or price changes; demand repeats daily.',
      perHour: fc.map(x => round(x, 2)), peakHour: peak, peakPerDay: round(fc[peak], 2), mae: round(mae, 2), evaluation: 'Backtest: 21-day profile predicting the last 7 days, mean absolute error per hour', days };
  }

  /* ---------------- insight generation (evidence-bound) ---------------- */
  // Each insight cites metric ids and windows. A cause is offered only when a second metric supports it.
  function insights(all, f, cfg = DEFAULTS) {
    const out = [], ov = overview(all, f, cfg), fr = friction(all, f, cfg), an = anomalies(all, f.to, cfg), cur = applyFilters(all, f);
    const stamp = Date.now(), fresh = ov.freshness;
    const card = (o) => out.push({ id: 'IN-' + hash(o.key), freshness: fresh, analysedAt: stamp, period: { from: f.from, to: f.to }, status: 'New', ...o });
    for (const r of fr.slow) {
      if (r.p95 == null || r.prevP95 == null || r.change == null || r.change < 0.25) continue;
      const d = drill(all, f, { op: r.op }), peak = d.hours.filter(h => h.p95 != null).sort((x, y) => y.p95 - x.p95)[0], off = d.hours.filter(h => h.p95 != null && (!peak || h.h !== peak.h));
      const offMed = off.length ? quantile(off.map(h => h.p95), .5) : null;
      const hyp = []; if (peak && offMed && peak.p95 > offMed * 1.5) hyp.push({ text: `The slowdown is concentrated around ${peak.h}:00 IST, when p95 is ${fmtMs(peak.p95)} against ${fmtMs(offMed)} at other hours. Demand at peak time is a likely factor.`, evidence: `drill:${r.op}:hours` });
      const dev = d.device[0]; if (dev && d.n && dev.n / d.n > 0.8 && dev.v !== 'unknown') hyp.push({ text: `${Math.round(dev.n / d.n * 100)}% of samples come from ${dev.v} devices; check behaviour on that device type.`, evidence: `drill:${r.op}:device` });
      card({ key: 'slow:' + r.op, kind: 'latency', title: `${r.op} is ${Math.round(r.change * 100)}% slower than the previous period`, changed: `p95 rose from ${fmtMs(r.prevP95)} to ${fmtMs(r.p95)}.`,
        observed: `p95 ${fmtMs(r.p95)} (n=${r.n})`, baseline: `p95 ${fmtMs(r.prevP95)} in the previous period`, segment: segLabel(f), affected: uniq(cur.filter(e => e.uid && ((e.name === 'page_load' && 'Page load: ' + e.page === r.op) || (e.name === 'api_call' && 'API: ' + e.op === r.op) || (e.name === 'lab_provision' && 'Lab start: ' + (e.feature || 'lab') === r.op))).map(e => e.uid)),
        severity: r.change > 1 ? 'High' : 'Medium', priority: r.change > 1 ? 'P1' : 'P2', hypotheses: hyp, confidence: hyp.length >= 2 ? 'Medium' : hyp.length ? 'Low' : 'Not enough evidence',
        noCause: hyp.length ? '' : 'The data shows the slowdown but not its cause. No second metric moved with it.',
        action: hyp.length ? 'Inspect the slow hour and segment in the drill-down; check capacity and recent releases before changing anything.' : 'Open the drill-down and compare with deployments or provider status before acting.', evidence: [`friction.slow:${r.op}`, `period:${iso(f.from)}..${iso(f.to)}`] });
    }
    for (const fu of ov.funnels) {
      if (!fu.worst || fu.stages[0].users < 20 || fu.worst.drop < 0.3) continue;
      const missing = fu.instrumented.map((x, i) => x ? null : fu.stages[i].label).filter(Boolean);
      card({ key: 'funnel:' + fu.key, kind: 'funnel', title: `${Math.round(fu.worst.drop * 100)}% leave ${fu.title.toLowerCase()} at ${fu.worst.to}`, changed: `${fu.worst.lost} of ${fu.worst.lost + fu.stages.find(s => s.label === fu.worst.to).users} users who reached ${fu.worst.from} did not reach ${fu.worst.to}.`,
        observed: `Stage conversion ${Math.round((1 - fu.worst.drop) * 100)}%`, baseline: 'No target set; compare periods with the date filter', segment: segLabel(f), affected: fu.worst.lost, severity: fu.key === 'checkout' ? 'High' : 'Medium', priority: fu.key === 'checkout' ? 'P1' : 'P2',
        hypotheses: missing.length ? [{ text: `Stage${missing.length > 1 ? 's' : ''} ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not instrumented yet, so part of this drop may be missing data rather than real abandonment.`, evidence: `funnel:${fu.key}:instrumented` }] : [],
        confidence: missing.length ? 'Low' : 'Medium', noCause: missing.length ? '' : 'The funnel shows where users leave, not why. No error or latency metric is linked to this step in the period.',
        action: 'Check errors and latency on this step in the friction map, then review the step\'s copy and form.', evidence: [`funnel:${fu.key}`, `period:${iso(f.from)}..${iso(f.to)}`] });
    }
    for (const a of an.filter(x => x.status === 'anomaly')) card({ key: 'anom:' + a.metric, kind: 'anomaly', title: `${a.label} is unusual today`, changed: `${a.label} moved ${a.rel > 0 ? 'up' : 'down'} ${Math.round(Math.abs(a.rel) * 100)}% against the ${a.baselineDays}-day baseline (z = ${a.z}).`,
      observed: fmtMetric(a.metric, a.value) + ` (n=${a.n})`, baseline: fmtMetric(a.metric, a.baseline) + ` average over ${a.baselineDays} days`, segment: 'All users', affected: null, severity: Math.abs(a.z) > 5 ? 'High' : 'Medium', priority: 'P2', hypotheses: [], confidence: 'Not enough evidence',
      noCause: 'This is a statistical alert only. Look at the friction map for the same day before drawing a conclusion.', action: 'Open the friction map for today and compare segments.', evidence: [`anomaly:${a.metric}:${iso(a.day)}`] });
    for (const e of fr.errors.slice(0, 3)) if (e.users >= 5) card({ key: 'err:' + e.category, kind: 'errors', title: `${e.category} affected ${e.users} users`, changed: `${e.events} events in the period, most often at ${e.top.map(t => t.where).join(', ')}.`,
      observed: `${e.events} events, ${e.users} users`, baseline: 'See the drill-down trend', segment: segLabel(f), affected: e.users, severity: e.users >= 50 ? 'High' : 'Low', priority: e.users >= 50 ? 'P1' : 'P3', hypotheses: [], confidence: 'Not enough evidence', noCause: 'The cause is not visible in aggregate metrics.', action: 'Reproduce on the listed pages; check logs for the same window.', evidence: [`friction.errors:${e.category}`] });
    return out;
  }
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const fmtMs = ms => ms == null ? '–' : ms >= 1000 ? (ms / 1000).toFixed(1) + ' s' : ms + ' ms';
  const fmtMetric = (m, v) => v == null ? '–' : /rate|conversion/.test(m) ? (v * 100).toFixed(1) + '%' : /ms$/.test(m) ? fmtMs(Math.round(v)) : String(round(v, 1));
  const segLabel = f => ['role', 'plan', 'mode', 'batch', 'device', 'browser', 'region'].filter(k => f[k]).map(k => `${k}: ${f[k]}`).join(', ') || 'All users';
  function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36).toUpperCase(); }

  /* ---------------- ask the analyst: allowlisted intents only ---------------- */
  const INTENTS = [
    { id: 'dropoff', re: /drop|leave|abandon|funnel/i, plan: 'funnels(filters) → largest drop per journey' },
    { id: 'slow_labs', re: /lab.*(slow|start|long|latency)|(slow|long).*lab/i, plan: 'friction(filters).slow where op starts with "Lab start"' },
    { id: 'checkout', re: /checkout|payment|conversion|pay/i, plan: 'funnel(checkout) current vs previous period' },
    { id: 'errors', re: /error|crash|fail|broken/i, plan: 'friction(filters).errors ordered by affected users' },
    { id: 'peak', re: /peak|forecast|demand|capacity|sandbox/i, plan: 'forecast(lab) and forecast(class)' },
    { id: 'open', re: /unresolved|open|remain|still/i, plan: 'insight statuses not Resolved or Dismissed' },
    { id: 'time', re: /time|spend|engag/i, plan: 'timeByArea(filters)' }
  ];
  function ask(all, f, q, statuses = {}, cfg = DEFAULTS) {
    const it = INTENTS.find(x => x.re.test(q || ''));
    if (!it) return { intent: null, answer: 'I can answer questions about drop-offs, slow labs, checkout, errors, peak demand, open issues and time spent. Try one of the examples.', plan: 'none (question outside the allowed analytics)' };
    const online = /online/i.test(q) ? { mode: 'Online' } : /offline/i.test(q) ? { mode: 'Offline' } : {}, ff = { ...f, ...online };
    if (it.id === 'dropoff') { const fs = funnels(applyFilters(all, ff)); const lines = fs.map(x => x.worst ? `${x.title}: biggest drop ${x.worst.from} → ${x.worst.to}, ${Math.round(x.worst.drop * 100)}% (${x.worst.lost} users).` : `${x.title}: not enough data.`); return { intent: it.id, plan: it.plan + (online.mode ? ` with mode=${online.mode}` : ''), answer: lines.join(' '), cites: fs.map(x => 'funnel:' + x.key) }; }
    if (it.id === 'slow_labs') { const r = friction(all, ff, cfg).slow.filter(x => x.op.startsWith('Lab start')).slice(0, 5); return { intent: it.id, plan: it.plan, answer: r.length ? r.map(x => `${x.op}: p95 ${fmtMs(x.p95)}, median ${fmtMs(x.p50)} (n=${x.n})${x.note ? ' · ' + x.note : ''}`).join('. ') + '.' : 'No lab start timings were recorded in this period.', cites: r.map(x => 'friction.slow:' + x.op) }; }
    if (it.id === 'checkout') { const p = periods(ff), a = funnel(applyFilters(all, p.cur), 'checkout'), b = funnel(applyFilters(all, p.prev), 'checkout'); return { intent: it.id, plan: it.plan, answer: a.stages[0].users ? `Checkout to paid access is ${pc(a.conversion)} this period against ${b.stages[0].users ? pc(b.conversion) : 'no data'} before. Largest drop: ${a.worst ? a.worst.from + ' → ' + a.worst.to : 'none'}. ${a.instrumented.includes(false) ? 'Some stages are not instrumented yet, so the cause cannot be confirmed from data.' : 'The data shows where, not why; check the friction map for that step.'}` : 'No checkouts recorded in this period.', cites: ['funnel:checkout'] }; }
    if (it.id === 'errors') { const r = friction(all, ff, cfg).errors.slice(0, 5); return { intent: it.id, plan: it.plan, answer: r.length ? r.map(x => `${x.category}: ${x.users} users, ${x.events} events`).join('; ') + '.' : 'No errors recorded in this period.', cites: r.map(x => 'friction.errors:' + x.category) }; }
    if (it.id === 'peak') { const l = forecast(all, 'lab', ff.to, cfg), c = forecast(all, 'class', ff.to, cfg); const t = x => x.status === 'ok' ? `peak around ${x.peakHour}:00 IST, about ${x.peakPerDay} a day at that hour (backtest error ${x.mae})` : x.why; return { intent: it.id, plan: it.plan, answer: `Sandbox demand: ${t(l)}. Live-class demand: ${t(c)}.`, cites: ['forecast:lab', 'forecast:class'] }; }
    if (it.id === 'open') { const ins = insights(all, ff, cfg).filter(x => !['Resolved', 'Dismissed'].includes(statuses[x.id] || 'New')); return { intent: it.id, plan: it.plan, answer: ins.length ? ins.map(x => `${x.title} (${statuses[x.id] || 'New'})`).join('; ') + '.' : 'No open insights.', cites: ins.map(x => x.id) }; }
    const t = timeByArea(applyFilters(all, ff)); return { intent: it.id, plan: it.plan, answer: t.total ? t.rows.filter(r => r.ms).sort((x, y) => y.ms - x.ms).map(r => `${r.area} ${Math.round(r.share * 100)}%`).join(', ') + '.' : 'No time-on-page recorded in this period.', cites: ['timeByArea'] };
  }
  const pc = x => x == null ? '–' : Math.round(x * 100) + '%';

  /* ---------------- alert rules ---------------- */
  function evaluateRules(all, f, rules, cfg = DEFAULTS) {
    const ev = applyFilters(all, f), h = headline(ev), fu = funnel(ev, 'checkout');
    const val = { error_rate: h.errorRate, p95_load_ms: h.load.p95, checkout_conversion: fu.stages[0].users >= 10 ? fu.conversion : null };
    return rules.filter(r => r.on).map(r => { const v = val[r.metric]; const fired = v != null && (r.op === '>' ? v > r.value : v < r.value); return { rule: r, value: v, fired, why: v == null ? 'Not enough data to evaluate' : '' }; });
  }

  /* ---------------- synthetic dataset with known answers (dev and demo only) ---------------- */
  // Deterministic: the same seed always gives the same events, so tests can assert exact numbers.
  function synthetic(now, seed = 7) {
    let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; const ev = []; let n = 0;
    const id = () => 'syn' + (n++).toString(36).padStart(8, '0'); const day0 = startOfDay(now) - 34 * DAY;
    const devs = ['desktop', 'mobile'], br = ['Chrome', 'Safari', 'Edge'];
    for (let d = 0; d < 35; d++) {
      const users = 40 + Math.round(rnd() * 10);
      for (let u = 0; u < users; u++) {
        const uid = 'u' + ((d * 7 + u) % 120), sid = `s${d}-${u}`, mobile = u % 3 === 0, hour = [10, 14, 18, 19, 20, 21][u % 6], t0 = day0 + d * DAY + hour * HOUR + u * 6e4;
        const base = { uid, sid, device: devs[mobile ? 1 : 0], browser: br[u % 3], plan: u % 4 === 0 ? 'paid' : 'free', mode: u % 2 ? 'Online' : 'Offline', role: 'student', synthetic: true, source: 'synthetic' };
        const E = (name, dt, x = {}) => ev.push({ id: id(), name, v: 1, ts: t0 + dt, rts: t0 + dt, purpose: EVENTS[name], ...base, ...x });
        E('page_view', 0, { page: 'index.html#home', area: 'Landing' }); E('page_load', 10, { page: 'index.html', dur: 900 + Math.round(rnd() * 900) + (mobile ? 800 : 0) });
        if (u % 2 === 0) { E('signup_completed', 6e4); if (u % 4 !== 2) E('onboarding_completed', 12e4); }
        if (u % 2 === 0 && u % 4 !== 2) {
          const slow = d >= 33 && hour >= 18; E('lab_provision', 13e4, { feature: 'OFF-05', dur: slow ? 9000 + Math.round(rnd() * 4000) : 2500 + Math.round(rnd() * 1500) });
          E('lab_started', 14e4, { feature: 'OFF-05' }); E('page_time', 15e4, { area: 'Labs and cyber range', dur: 18 * 6e4 }); if (u % 8 !== 4) { E('lab_checkpoint', 16e4, { feature: 'OFF-05' }); if (u % 16 !== 8) E('lab_completed', 17e4, { feature: 'OFF-05' }); }
        }
        if (u % 4 === 0) { E('checkout_started', 2e5); if (!mobile || u % 12 !== 0) { E('payment_attempt', 21e4, { method: 'UPI' }); if (u % 8 === 0) E('payment_failed', 22e4, { method: 'UPI', source: 'server' }); else { E('payment_verified', 22e4, { source: 'server' }); E('paid_access_granted', 23e4, { source: 'server' }); } } }
        E('page_view', 24e4, { page: 'academy.html#/academy/dashboard', area: 'Dashboard' }); E('page_time', 25e4, { area: 'Dashboard', dur: 4 * 6e4 });
        if (u % 3 === 1) E('page_time', 26e4, { area: 'Courses and LMS', dur: 12 * 6e4 }); if (u % 5 === 0) E('page_time', 27e4, { area: 'Lore Vault', dur: 5 * 6e4 });
        E('api_call', 28e4, { op: 'student.dashboard', dur: 180 + Math.round(rnd() * 200), result: u % 25 === 0 ? 'fail' : 'ok' });
        if (u % 30 === 0) E('js_error', 29e4, { page: 'academy.html', err: 'TypeError' });
      }
    }
    return ev;
  }

  const api = { SCHEMA_VERSION, EVENTS, SERVER_ONLY, DEFAULTS, AREAS, FUNNELS, validate, ingest, applyFilters, headline, overview, timeByArea, funnel, funnels, friction, drill, anomalies, forecast, insights, ask, evaluateRules, synthetic, quantile, pct, fmtMs, fmtMetric, startOfDay, istHour, INTENTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.InsightCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
