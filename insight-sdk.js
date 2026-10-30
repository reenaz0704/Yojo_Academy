/* Yojo Insight Engine: browser collector (design document pages 37-38).
   Records events through InsightCore.ingest, which validates, dedups and applies consent.
   Never records passwords, OTPs, card, CVV, UPI PIN, lab flags, answers, private messages or IP addresses:
   only the fields listed in InsightCore are kept, and field names that look like those values are rejected.
   In this demo the "server" is localStorage (yojo_analytics_v1). A production build posts the same events to /v1/events. */
(function () {
  'use strict';
  const C = window.InsightCore; if (!C) return;
  const KEY = 'yojo_analytics_v1', CONSENT = 'yojo_consent_v1', MAX = 20000, RETAIN_DAYS = 396; // 13 months [PROVISIONAL]
  const ls = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const rid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12)).replace(/[^A-Za-z0-9_-]/g, '');
  const h = s => { let x = 2166136261; for (const c of s) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return (x >>> 0).toString(36); };

  // pseudonymous ids: a signed-in user becomes u_<hash of email>; a visitor gets a random device id
  function session() {
    let s = null; try { s = JSON.parse(sessionStorage.getItem('yojo_demo_session')); } catch {}
    const db = ls.get('yojo_demo_db_v1'); const u = s && s.email && db && (db.users || []).find(x => x.email === s.email);
    if (!s || !s.email) { let a = ls.get('yojo_anon_id'); if (!a) { a = 'a_' + rid().slice(0, 16); ls.set('yojo_anon_id', a); } return { uid: a, role: 'guest' }; }
    const uid = 'u_' + h(String(s.email).toLowerCase()), anon = ls.get('yojo_anon_id');
    // link this device's visitor id to the account once, so a funnel can follow landing -> sign-up -> paid
    if (anon) { const al = ls.get('yojo_analytics_alias') || {}; if (al[anon] !== uid) { al[anon] = uid; ls.set('yojo_analytics_alias', al); } }
    return { uid: 'u_' + h(String(s.email).toLowerCase()), role: s.role || (u && u.role) || 'student', plan: u && u.stats && u.stats.plan === 'paid' ? 'paid' : (s.role === 'student' || (u && u.role === 'student')) ? 'free' : undefined, mode: u && u.profile && u.profile.mode || undefined };
  }
  let sid = sessionStorage.getItem('yojo_sid'); if (!sid) { sid = 's_' + rid().slice(0, 16); sessionStorage.setItem('yojo_sid', sid); }
  const consent = () => { const c = ls.get(CONSENT); return c ? c.analytics === true : null; };
  const ua = navigator.userAgent, device = /Mobi|Android|iPhone/i.test(ua) ? 'mobile' : /iPad|Tablet/i.test(ua) ? 'tablet' : 'desktop';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const net = navigator.connection && navigator.connection.effectiveType || undefined;
  const lang = (navigator.language || '').slice(0, 5);
  const page = () => location.pathname.split('/').pop() + (location.hash ? location.hash.replace(/\/[A-Z]{2,}-[\w-]+/g, '/:id').split('?')[0] : '');
  function area() {
    const p = (location.pathname.split('/').pop() || 'index.html') + location.hash;
    if (/admin|trainer/.test(p)) return 'Staff';
    if (/academy/.test(p)) return /lab|range|mission/i.test(p) ? 'Labs and cyber range' : /course|lesson|lms/i.test(p) ? 'Courses and LMS' : /class|live|record/i.test(p) ? 'Live and recorded classes' : /lore|blog|vault/i.test(p) ? 'Lore Vault' : 'Dashboard';
    if (/ctf/i.test(p)) return 'CTF'; if (/job/i.test(p)) return 'Job Hunter'; return 'Landing';
  }
  const stats = { accepted: 0, duplicate: 0, rejected: 0 };
  function send(list) {
    const store = ls.get(KEY) || [], cut = Date.now() - RETAIN_DAYS * 864e5;
    const kept = store.filter(e => e.ts >= cut && !e.synthetic);
    const r = C.ingest(kept, list, { consent: !!consent(), session: session() });
    stats.accepted += r.accepted; stats.duplicate += r.duplicate; stats.rejected += r.rejected.length;
    ls.set(KEY, kept.slice(-MAX)); return r;
  }
  function track(name, props = {}, opts = {}) {
    const s = session();
    const e = { id: opts.id || rid(), name, ts: Date.now(), uid: s.uid, sid, page: page(), area: props.area || area(), device, browser, net, lang, screen: innerWidth < 640 ? 'small' : innerWidth < 1100 ? 'medium' : 'large', ...props };
    return send([e]);
  }

  /* ---------------- consent banner ---------------- */
  function banner() {
    if (consent() !== null || document.getElementById('yojoConsent')) return;
    const b = document.createElement('div'); b.id = 'yojoConsent'; b.setAttribute('role', 'dialog'); b.setAttribute('aria-label', 'Analytics consent');
    b.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:9999;max-width:min(420px,calc(100vw - 32px));padding:14px 16px;border-radius:14px;background:rgba(10,16,30,.96);color:#e6f1ff;border:1px solid rgba(0,229,255,.35);box-shadow:0 10px 40px rgba(0,0,0,.5);font:14px/1.45 system-ui,sans-serif';
    b.innerHTML = '<b style="display:block;margin-bottom:4px">Help us improve Yojo</b>We measure how pages are used (pages, time, clicks, scroll) to find slow or confusing parts. We never record passwords, codes, payment details, lab answers or messages. Service health and payment records are kept either way.<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button type="button" data-c="1" style="padding:8px 14px;border-radius:10px;border:0;background:#00e5ff;color:#001018;font-weight:700;cursor:pointer">Allow analytics</button><button type="button" data-c="0" style="padding:8px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.3);background:transparent;color:inherit;cursor:pointer">Essential only</button></div>';
    b.addEventListener('click', e => { const t = e.target.closest('[data-c]'); if (!t) return; ls.set(CONSENT, { analytics: t.dataset.c === '1', at: new Date().toISOString(), v: 1 }); b.remove(); if (t.dataset.c === '1') track('page_view'); });
    document.body.append(b);
  }

  /* ---------------- automatic collection ---------------- */
  let shownAt = Date.now(), shownArea = area(), maxScroll = 0;
  function flushTime() { const dur = Date.now() - shownAt; if (dur > 1500 && dur < 6 * 36e5 && shownArea !== 'Staff') track('page_time', { area: shownArea, dur }); if (maxScroll) track('scroll_depth', { area: shownArea, value: maxScroll }); shownAt = Date.now(); shownArea = area(); maxScroll = 0; }
  function view() { if (area() !== 'Staff') track('page_view'); }
  addEventListener('hashchange', () => { flushTime(); view(); });
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushTime(); else shownAt = Date.now(); });
  addEventListener('scroll', () => { const d = document.documentElement, v = Math.round((scrollY + innerHeight) / Math.max(1, d.scrollHeight) * 100); if (v > maxScroll) maxScroll = Math.min(100, Math.round(v / 25) * 25); }, { passive: true });
  let clicks = []; addEventListener('click', e => {
    if (area() === 'Staff') return; const t = e.target.closest('a,button,[role=button],input,select,label,summary') ;
    const now = Date.now(); clicks = clicks.filter(c => now - c.t < 800 && Math.abs(c.x - e.clientX) < 30 && Math.abs(c.y - e.clientY) < 30); clicks.push({ t: now, x: e.clientX, y: e.clientY });
    if (clicks.length === 3) track('rage_click', { feature: t ? (t.id || t.tagName.toLowerCase()) : 'page' });
    if (!t) { if (e.target.closest('img,.card,h1,h2,h3,[class*=btn],[class*=chip]')) track('dead_click', { feature: e.target.tagName.toLowerCase() }); return; }
    const label = (t.dataset.track || t.id || t.getAttribute('href') || t.tagName.toLowerCase()).slice(0, 60);
    track('click', { feature: label });
  }, true);
  addEventListener('error', e => track('js_error', { err: (e.error && e.error.name) || 'Error', feature: (e.filename || '').split('/').pop() + ':' + (e.lineno || 0) }));
  addEventListener('unhandledrejection', e => track('js_error', { err: (e.reason && e.reason.name) || 'UnhandledRejection' }));
  function loadTiming() {
    const n = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    if (n && n.loadEventEnd > 0) track('page_load', { dur: Math.round(n.loadEventEnd - n.startTime), page: location.pathname.split('/').pop() || 'index.html' });
    else setTimeout(loadTiming, 300);
  }
  // time an async operation (an API call in production)
  async function time(op, fn) { const t = performance.now(); try { const r = await fn(); track('api_call', { op, dur: Math.round(performance.now() - t), result: 'ok' }); return r; } catch (x) { track('api_call', { op, dur: Math.round(performance.now() - t), result: 'fail' }); throw x; } }

  window.YojoInsight = { track, time, send, consent, stats, KEY, CONSENT, setConsent(v) { ls.set(CONSENT, { analytics: !!v, at: new Date().toISOString(), v: 1 }); }, session };
  const start = () => { banner(); view(); loadTiming(); };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
})();
