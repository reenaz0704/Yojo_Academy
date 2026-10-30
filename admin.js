/* Yojo Admin console: shell, router and the 13 module pages (PDF pages 17-21, 28, 32, 35, 40).
   Data comes only from AdminAPI (admin-data.js), which stands in for the server and enforces the access matrix. */
(() => {
  'use strict';
  const API = window.AdminAPI, DAY = 864e5;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TZ = 'Asia/Kolkata';
  const fD = t => new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ });
  const fDT = t => new Date(t).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: TZ });
  const rs = n => n == null ? '<span class="note">Hidden for your role</span>' : 'Rs ' + Number(n).toLocaleString('en-IN');
  const initials = n => String(n).split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const iso = t => new Date(t).toISOString().slice(0, 10);

  /* ---------------- session guard (MFA happened at login) ---------------- */
  let user = null;
  const LIVE = window.YojoLiveAdmin; // set by admin-live.js when the real API answers (session from GET /me)
  if (LIVE) user = LIVE.user;
  else try { const h = JSON.parse(localStorage.getItem('yojo_demo_staff_handoff')); if (h && h.role === 'admin') { localStorage.removeItem('yojo_demo_staff_handoff'); if (Date.now() - h.at < 120000) sessionStorage.setItem('yojo_demo_session', JSON.stringify({ email: h.email, role: 'admin', at: Date.now() })); } } catch {}
  if (!LIVE) try { const s = JSON.parse(sessionStorage.getItem('yojo_demo_session')); const db = JSON.parse(localStorage.getItem('yojo_demo_db_v1')); user = db && s && db.users.find(u => u.email === s.email); } catch {}
  if (!user || user.role !== 'admin' || user.status !== 'active' || !user.mfaSecret) {
    document.body.innerHTML = `<main style="min-height:100vh;display:grid;place-items:center;padding:1rem"><div class="card denied"><span class="eyebrow">Admin console</span><h1>Sign in to continue</h1>
      <p class="note">${user ? 'This account is not an active admin. Students and trainers cannot open the admin console.' : 'Your session has ended or you are not signed in. Admins sign in with an organisation email, a one-time code and an authenticator (MFA).'}</p><a class="btn btn-primary" href="login.html?role=employee&as=admin">Go to admin login</a></div></main>`;
    return;
  }
  // For now one admin runs everything: every admin account gets full Platform Admin access.
  // Set ONE_ADMIN_FULL_ACCESS to false to switch the Payment, Content and Support limits back on.
  const ONE_ADMIN_FULL_ACCESS = true;
  API.setSession({ email: user.email, name: user.name, role: ONE_ADMIN_FULL_ACCESS ? 'platform' : user.adminRole });
  window.AdminMFA.secret = user.mfaSecret;
  const ME = API.me(), ROLE = ME.role;
  $('#app').hidden = false;
  $('#roleChip').textContent = ME.roleName; $('#avBtn').textContent = initials(ME.name.replace(/\(.*\)/, ''));

  /* ---------------- UI helpers ---------------- */
  function toast(msg, bad) { const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.setAttribute('role', bad ? 'alert' : 'status'); t.textContent = msg; $('#toasts').append(t); setTimeout(() => t.remove(), 4500); }
  function modal(title, body, { wide, foot = '' } = {}) {
    const o = document.createElement('div'); o.className = 'overlay';
    o.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-h"><h2>${esc(title)}</h2><button class="btn btn-sm x" data-x aria-label="Close">Close</button></div><div class="modal-b">${body}</div>${foot ? `<div class="modal-f">${foot}</div>` : ''}</div>`;
    const close = () => { o.remove(); document.removeEventListener('keydown', k); }; const k = e => { if (e.key === 'Escape') close(); };
    o.addEventListener('click', e => { if (e.target === o || e.target.closest('[data-x]')) close(); }); document.addEventListener('keydown', k);
    document.body.append(o); setTimeout(() => (o.querySelector('input,textarea,select,button.btn-primary') || o.querySelector('button'))?.focus(), 30);
    o.close = close; return o;
  }
  function ask(title, { label = 'Reason', mfa = false, placeholder = '', text = '', ok = 'Confirm', danger = false, optional = false } = {}) {
    return new Promise(res => {
      const m = modal(title, `<form class="form" id="askF">${text ? `<p class="note">${text}</p>` : ''}
        <label>${mfa ? 'Authenticator code (6 digits)' : esc(label)}${mfa ? '<input id="askV" inputmode="numeric" maxlength="6" autocomplete="one-time-code">' : `<textarea id="askV" placeholder="${esc(placeholder)}"></textarea>`}</label>
        ${mfa ? `<p class="mfa-demo">Demo authenticator code right now: <b id="mfaNow" class="mono">${window.AdminMFA.code()}</b></p>` : ''}<p class="err" id="askE" role="alert"></p></form>`,
        { foot: `<button class="btn" data-x>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" form="askF" type="submit">${esc(ok)}</button>` });
      let done = false; const fin = v => { if (!done) { done = true; res(v); } };
      const iv = mfa && setInterval(() => { const n = $('#mfaNow', m); if (n) n.textContent = window.AdminMFA.code(); else clearInterval(iv); }, 1000);
      $('#askF', m).addEventListener('submit', e => { e.preventDefault(); const v = $('#askV', m).value.trim(); if ((!v && !optional) || (mfa && !/^\d{6}$/.test(v))) { $('#askE', m).textContent = mfa ? 'Enter the 6-digit code.' : 'This is required.'; return; } fin(v || ' '); m.close(); });
      const obs = new MutationObserver(() => { if (!m.isConnected) { fin(null); obs.disconnect(); } }); obs.observe(document.body, { childList: true });
    });
  }
  const confirmBox = (title, text, ok = 'Confirm', danger) => new Promise(res => { const m = modal(title, `<p>${text}</p>`, { foot: `<button class="btn" data-x>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="cfOk">${esc(ok)}</button>` }); let d = false; $('#cfOk', m).onclick = () => { d = true; m.close(); res(true); }; const obs = new MutationObserver(() => { if (!m.isConnected) { if (!d) res(false); obs.disconnect(); } }); obs.observe(document.body, { childList: true }); });
  const chip = (t, c) => `<span class="chip ${c || ''}">${esc(t)}</span>`;
  const STC = { 'Awaiting approval': 'a', Approved: 'g', Rejected: 'r', 'Info requested': 'b', Verified: 'g', 'Not verified': 'a', Failed: 'r', Paid: 'g', 'Due soon': 'a', Overdue: 'r', 'Partly paid': 'b', Due: '', Published: 'g', Draft: '', Unpublished: 'a', Scheduled: 'b', Active: 'g', Completed: '', Issued: 'g', Eligible: 'b', 'Not eligible': '', Revoked: 'r', Sent: 'g', 'Awaiting second admin': 'a', Recalled: '', Confirmed: 'g', OK: 'g', Excelling: 'g', 'On track': 'g', 'Needs attention': 'a', 'At risk': 'r', paid: 'g', free: '' };
  const st = s => chip(s === 'paid' ? 'Paid' : s === 'free' ? 'Free' : s, STC[s] ?? '');
  const pbar = (v, cls) => `<span class="pbar ${cls || (v >= 75 ? '' : v >= 60 ? 'amber' : 'red')}"><i style="--w:${Math.max(0, Math.min(100, v))}%"></i><span>${v}%</span></span>`;
  const tip = t => `<span class="tip" tabindex="0" data-tip="${esc(t)}" aria-label="${esc(t)}">i</span>`;
  const empty = (t, s = '') => `<div class="empty"><b>${esc(t)}</b>${esc(s)}</div>`;
  const tbl = (head, rows, cls = 'cards') => `<div class="tw ${cls}"><table class="tbl"><thead><tr>${head.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td data-l="${esc(String(head[i]).replace(/<[^>]+>/g, ''))}" class="${i ? '' : 'first'}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const bars = rows => `<div class="bars">${rows.map(r => `<div class="r"><span>${esc(r.label)}</span><span class="b" role="img" aria-label="${esc(r.label)}: ${r.v}${r.unit || '%'}"><i class="${r.c || ''}" style="width:${Math.max(0, Math.min(100, r.w ?? r.v))}%"></i></span><b>${r.v}${r.unit ?? '%'}</b></div>`).join('')}</div>`;
  const csv = (name, rows) => { const text = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; document.body.append(a); a.click(); a.remove(); };
  const fail = e => toast(e.message || 'Something went wrong.', true);
  const gap = t => `<div class="gap-note"><b>Backend needed:</b> ${esc(t)}</div>`;
  const pageSize = 8;
  const pager = (n, p, act) => n > pageSize ? `<div class="pager">Page ${p + 1} of ${Math.ceil(n / pageSize)}<button class="btn btn-xs" data-act="${act}" data-p="${p - 1}" ${p ? '' : 'disabled'}>Previous</button><button class="btn btn-xs" data-act="${act}" data-p="${p + 1}" ${(p + 1) * pageSize >= n ? 'disabled' : ''}>Next</button></div>` : '';

  /* ---------------- nav + router ---------------- */
  const MODS = [
    ['dashboard', 'Dashboard', 'dashboard', 'M4 13h7V4H4zM13 20h7v-9h-7zM13 4v5h7V4zM4 20h7v-5H4z'],
    ['students', 'Student Management', 'students', 'M16 20v-2a4 4 0 0 0-8 0v2M12 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M20 20v-1.5a3 3 0 0 0-2.5-3M4 20v-1.5a3 3 0 0 1 2.5-3'],
    ['total', 'Total Users', 'totalUsers', 'M3 20v-1a5 5 0 0 1 10 0v1M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M15 20v-1a4 4 0 0 1 6-3.5M17.5 11a2.5 2.5 0 1 0 0-5'],
    ['ctf', 'CTF Registrations', 'ctf', 'M5 21V4M5 4h11l-2 4 2 4H5'],
    ['enquiries', 'Enquiries', 'enquiries', 'M4 5h16v11H8l-4 4zM8 9h8M8 12h5'],
    ['attendance', 'Attendance', 'attendance', 'M8 3v3M16 3v3M4 7h16v13H4zM8 13l2.5 2.5L16 11'],
    ['performance', 'Performance', 'performance', 'M4 19V5M4 19h16M8 15l3-4 3 2 5-6'],
    ...(LIVE && LIVE.user ? [
      ['courses', 'Courses', 'courses', 'M4 5h16v4H4zM5 9v11h14V9M10 13h4'],
      ['labs', 'Labs', 'labs', 'M9 3h6M10 3v6L5 19a1.5 1.5 0 0 0 1.3 2h11.4a1.5 1.5 0 0 0 1.3-2l-5-10V3'],
      ['assessments', 'Assessments', 'assessments', 'M9 4h6v3H9zM6 6h12v15H6zM9 12l2 2 4-4'],
      ['blogs', 'Intel Review', 'blogs', 'M5 4h11l3 3v13H5zM8 9h8M8 13h8M8 17h5M15 4v4h4'],
    ] : []),
    ['finance', 'Finance + Dues', 'finance', 'M3 6h18v12H3zM3 10h18M7 15h3'],
    ['analytics', 'Analytics', 'analytics', 'M5 20V10M12 20V4M19 20v-7'],
    ['insights', 'Insight Engine', 'insights', 'M12 3a6 6 0 0 0-3.5 10.9V17h7v-3.1A6 6 0 0 0 12 3M9.5 21h5', '#/admin/analytics/insights'],
    ['notifications', 'Notifications', 'notifications', 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0'],
    ['reports', 'Student Reports', 'reports', 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7'],
    ['certificates', 'Certificates', 'certificates', 'M12 15a5 5 0 1 0 0-10 5 5 0 0 0 0 10M9 14l-2 7 5-3 5 3-2-7'],
    ['settings', 'System Settings', 'settings', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19 12l2-1-1-3-2 .3-1.5-1.5.3-2-3-1-1 2h-2l-1-2-3 1 .3 2L6.3 8.3 4.3 8 3.3 11l2 1v0l-2 1 1 3 2-.3 1.5 1.5-.3 2 3 1 1-2h2l1 2 3-1-.3-2 1.5-1.5 2 .3 1-3z']
  ];
  // multipage: CTF Registrations is its own file (admin-ctf.html); every other module stays in admin.html
  const ON_CTF = document.body.dataset.page === 'ctf';
  const fileFor = k => k === 'ctf' ? 'admin-ctf.html' : 'admin.html';
  const hrefFor = (k, href) => { const h = href || '#/admin/' + k; return fileFor(k) === (ON_CTF ? 'admin-ctf.html' : 'admin.html') ? h : fileFor(k) + h; };
  $('#nav').innerHTML = MODS.map(([k, l, perm, d, href]) => { href = hrefFor(k, href); const lk = API.can(perm) === '-'; return `<a href="${href || '#/admin/' + k}" data-mod="${k}" class="${lk ? 'lock' : ''}" ${lk ? 'title="Not available for your role"' : ''}><span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg></span><span class="lb">${l}</span>${lk ? '<span class="lockic" aria-label="No access">🔒</span>' : '<span class="cnt" hidden></span>'}</a>`; }).join('');
  $('#menuBtn').onclick = () => $('#side').classList.toggle('open');
  const setCompact = on => { document.body.classList.toggle('compact', on); $('#compactBtn').setAttribute('aria-pressed', on); try { localStorage.setItem('yojo_admin_compact', on ? '1' : ''); } catch {} };
  try { setCompact(!!localStorage.getItem('yojo_admin_compact')); } catch {}
  $('#compactBtn').onclick = () => setCompact(!document.body.classList.contains('compact'));
  const view = $('#view');
  let H = {};
  view.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && H[b.dataset.act]) { e.preventDefault(); H[b.dataset.act](b, e); } });
  view.addEventListener('change', e => { const b = e.target.closest('[data-chg]'); if (b && H[b.dataset.chg]) H[b.dataset.chg](b, e); });
  view.addEventListener('input', e => { const b = e.target.closest('[data-inp]'); if (b && H[b.dataset.inp]) H[b.dataset.inp](b, e); });
  view.addEventListener('submit', e => { const f = e.target.closest('form[data-sub]'); if (f && H[f.dataset.sub]) { e.preventDefault(); H[f.dataset.sub](f, e); } });
  function setCrumb(parts) { $('#crumb').innerHTML = [['Admin', '#/admin/dashboard'], ...parts].map((p, i, a) => i < a.length - 1 && p[1] ? `<a href="${p[1]}">${esc(p[0])}</a><span class="sep">›</span>` : `<span aria-current="page">${esc(p[0])}</span>`).join(''); document.title = `${parts[parts.length - 1][0]} | Yojo Admin`; }
  async function page(crumb, fn) {
    H = {}; setCrumb(crumb);
    view.innerHTML = `<div class="grid g4">${'<div class="skel"></div>'.repeat(4)}</div><div class="skel" style="height:240px"></div>`;
    view.setAttribute('aria-busy', 'true');
    try { await fn(); }
    catch (e) {
      if (e.code === 428) { view.innerHTML = `<div class="card denied"><span class="eyebrow">Stated reason required</span><h1>Why do you need this record?</h1><p class="note">${esc(e.message)} Your reason is saved in the audit log.</p><button class="btn btn-primary" id="purposeBtn">State a reason</button></div>`; $('#purposeBtn').onclick = async () => { const id = location.hash.split('/')[3] || (new URLSearchParams(location.hash.split('?')[1] || '')).get('sid'); const r = await ask('Reason to view this student', { placeholder: 'e.g. Parent called about attendance (ticket SUP-118)' }); if (!r) return; try { await API.statePurpose(id, r); route(); } catch (x) { fail(x); } }; }
      else view.innerHTML = `<div class="${e.code === 403 ? 'card denied' : 'errbox'}" role="alert"><div><span class="eyebrow">${e.code === 403 ? 'Access denied' : 'Could not load this page'}</span><h2 style="margin:.4rem 0">${e.code === 403 ? 'This module is not part of your role' : 'Something went wrong'}</h2><p class="note">${esc(e.message)}</p></div>${e.code === 403 ? `<p class="note">You are signed in as <b>${esc(ME.roleName)}</b>. Ask a Platform Admin if you need access.</p><a class="btn btn-sm" href="#/admin/dashboard">Back to dashboard</a>` : '<button class="btn btn-sm" id="retry">Try again</button>'}</div>`;
      $('#retry')?.addEventListener('click', route);
    }
    view.removeAttribute('aria-busy');
  }
  const P = {};
  // Demo: these live in the trainer console. Live (Yojo API): admins manage them here too (owner, 24 Oct).
  const TRAINER_ONLY = LIVE && LIVE.user ? {} : { courses: 'Course Management', labs: 'Lab Management', assessments: 'Assessments' };
  function route() {
    const [path, qs] = location.hash.replace(/^#\/?/, '').split('?'); const parts = path.split('#')[0].split('/');
    if (parts[0] !== 'admin' || !parts[1]) { location.replace(ON_CTF ? '#/admin/ctf' : '#/admin/dashboard'); return; }
    let mod = parts[1]; if (mod === 'users') mod = 'students';
    if ((mod === 'ctf') !== ON_CTF) { location.replace(fileFor(mod) + location.hash); return; }
    if (mod === 'analytics' && (parts[2] === 'insights' || parts[2] === 'friction')) mod = 'insights';
    // course, lab and assessment management now live only in the trainer console
    if (TRAINER_ONLY[mod]) { H = {}; setCrumb([[TRAINER_ONLY[mod]]]); $$('#nav a').forEach(a => a.removeAttribute('aria-current')); view.innerHTML = `<div class="card denied"><span class="eyebrow">Moved to the trainer console</span><h1>${TRAINER_ONLY[mod]} is managed by trainers</h1><p class="note">Courses, labs and assessments are created and run from the Trainer LMS. The admin console keeps students, attendance, performance, finance, reports and settings.</p><a class="btn btn-primary" href="#/admin/dashboard">Back to the dashboard</a></div>`; return; }
    const arg = decodeURIComponent(parts[2] || ''), arg2 = decodeURIComponent(parts[3] || '');
    $$('#nav a').forEach(a => a.dataset.mod === mod ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
    $('#side').classList.remove('open');
    (P[mod] || P.notfound)(arg, arg2, new URLSearchParams(qs || ''));
    window.scrollTo(0, 0); refreshBell(); view.focus({ preventScroll: true });
  }
  addEventListener('hashchange', route);

  /* ---------------- header: bell, search, profile ---------------- */
  async function refreshBell() {
    try { const n = await API.alerts(); const un = n.filter(x => !x.read).length; const b = $('#bellCnt'); b.hidden = !un; b.textContent = un;
      $('#bellPop').innerHTML = `<div style="display:flex;align-items:center;padding:.3rem .5rem .5rem"><b>Alerts</b>${n.length ? '<button class="btn btn-xs" id="markRead" style="margin-left:auto">Mark all read</button>' : ''}</div><div style="max-height:60vh;overflow:auto">` +
        (n.length ? n.map(x => `<a class="notif ${x.read ? 'read' : ''}" href="${x.href}"><i class="${x.kind}"></i><span>${esc(x.text)}<br><small class="note">${{ red: 'Below required level', amber: 'Due or waiting for you', blue: 'Approval' }[x.kind] || ''}</small></span></a>`).join('') : '<p class="note" style="padding:.5rem">Nothing needs you right now.</p>') + '</div>';
      $('#markRead')?.addEventListener('click', async e => { e.stopPropagation(); await API.readAlerts(); refreshBell(); });
      const cnt = { dashboard: n.filter(x => x.id.startsWith('ap-') && !x.read).length, finance: n.filter(x => /^(due|off)-/.test(x.id) && !x.read).length, notifications: n.filter(x => x.id.startsWith('bc-') && !x.read).length, insights: n.filter(x => x.id.startsWith('ins-') && !x.read).length };
      $$('#nav a .cnt').forEach(c => { const v = cnt[c.closest('a').dataset.mod]; c.hidden = !v; c.textContent = v || ''; });
    } catch {}
  }
  const togglePop = (btn, pop) => { btn.addEventListener('click', e => { e.stopPropagation(); const open = pop.hidden; $$('.pop').forEach(p => p.hidden = true); pop.hidden = !open; btn.setAttribute('aria-expanded', open); }); };
  togglePop($('#bellBtn'), $('#bellPop')); togglePop($('#avBtn'), $('#avPop'));
  document.addEventListener('click', e => { if (!e.target.closest('.pop') && !e.target.closest('.gsearch') && !e.target.closest('.bigsearch')) $$('.pop').forEach(p => p.hidden = true); });
  $('#avPop').innerHTML = `<div style="padding:.4rem .6rem .6rem"><b>${esc(ME.name)}</b><br><small class="note">${esc(ME.email)}</small><br>${chip(ME.roleName, 'b')} ${chip('MFA on', 'g')}</div>
    <button class="pi" id="auditBtn">My audit log</button><button class="pi" id="gapBtn">What needs a real backend</button><button class="pi" id="outBtn" style="color:var(--red)">Sign out</button>`;
  const signOut = async () => { sessionStorage.removeItem('yojo_demo_session'); if (LIVE) await LIVE.logout(); location.href = 'login.html'; };
  $('#outBtn').onclick = signOut;
  $('#auditBtn').onclick = async () => { const a = await API.audit(); modal('My audit log (read-only)', a.length ? tbl(['When', 'Action', 'Target', 'Detail'], a.slice(0, 60).map(x => [fDT(x.at), esc(x.action), `<span class="mono">${esc(x.target)}</span>`, esc(x.detail)])) + '<p class="note" style="margin-top:.6rem">Audit rows cannot be edited or deleted.</p>' : empty('Nothing recorded yet'), { wide: true }); };
  $('#gapBtn').onclick = () => modal('What needs a real backend', `<p class="note">This console runs on demo data in the browser. The screens and rules are done; these parts must come from the server before launch:</p><ul>${API.gaps().map(g => `<li>${esc(g)}</li>`).join('')}</ul>`, { wide: true });
  function wireSearch(input, pop) {
    let tm; input.addEventListener('input', () => { clearTimeout(tm); const q = input.value.trim(); if (q.length < 2) { pop.hidden = true; return; }
      pop.hidden = false; pop.innerHTML = '<p class="note" style="padding:.5rem">Searching…</p>';
      tm = setTimeout(async () => { try { const r = await API.search(q); pop.innerHTML = r.length ? r.map(x => `<a href="#/admin/users/${encodeURIComponent(x.id)}"><b>${esc(x.name)} ${st(x.plan)}</b><small class="note"><span class="mono">${esc(x.id)}</span> · ${esc(x.email)}${x.batch ? ' · ' + esc(x.batch) : ''} · matched ${esc(x.match)}</small></a>`).join('') : '<p class="note" style="padding:.5rem">No users match. Try a name, email, user ID, subscription ID or payment reference.</p>'; }
        catch (e) { pop.innerHTML = `<p class="note" style="padding:.5rem;color:var(--red)">${esc(e.message)}</p>`; } }, 250); });
    input.closest('form')?.addEventListener('submit', e => { e.preventDefault(); const a = pop.querySelector('a'); if (a) location.hash = a.getAttribute('href'); });
    input.addEventListener('keydown', e => { if (e.key === 'Escape') pop.hidden = true; });
  }
  if (API.can('userSearch') !== '-') wireSearch($('#gq'), $('#gRes')); else { $('#gSearch').hidden = true; }
  setInterval(refreshBell, 30000);
  addEventListener('storage', e => { if (e.key !== 'yojo_trainer_demo_v2' && e.key !== 'yojo_demo_db_v1') return; refreshBell(); const mod = location.hash.split('/')[2]; if (['dashboard', 'attendance', 'finance'].includes(mod) && !document.querySelector('.overlay') && !view.contains(document.activeElement)) route(); });
  let last = Date.now(); ['click', 'keydown', 'mousemove', 'touchstart'].forEach(ev => addEventListener(ev, () => last = Date.now(), { passive: true }));
  // the 30-minute inactivity sign-out was removed for demos (owner, 30 Oct; OI-63): yojo-api.js keeps the session alive

  /* ======================= 1. DASHBOARD ======================= */
  P.dashboard = () => page([['Dashboard']], async () => {
    const [sum, ov] = await Promise.all([API.summary(), API.overview()]);
    const queueOk = API.can('approve') !== '-' || API.can('finance') !== '-';
    const [queue, alerts] = await Promise.all([queueOk ? API.approvals() : Promise.resolve(null), API.alerts()]);
    const now = new Date();
    const tile = (n, label, href, sub, cls) => `<a class="stat ${cls}" href="${href}"><b>${n}</b><span>${label}</span><small>${sub}</small></a>`;
    view.innerHTML = `
      <section class="ctrl"><div><span class="eyebrow">Admin Console</span><h1>Welcome to Yojo Cyber Academy Control Room</h1>
        <div class="meta">${chip(ME.roleName, 'b')}${chip('MFA verified', 'g')}<span class="note">Signed in as ${esc(ME.name)}</span></div></div>
        <div class="clock" id="clock">${now.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: TZ })}<small>${now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ })} · IST</small></div></section>
      <form class="bigsearch" role="search" id="dSearch"><label class="sr" for="dq">Search users</label><input id="dq" placeholder="Search a user by name, email, user ID, subscription ID or payment reference" ${API.can('userSearch') === '-' ? 'disabled' : ''}><button class="btn btn-primary" type="submit">Search</button><div class="pop" id="dRes" hidden></div></form>
      <div class="grid g4 dash-tiles">
        ${tile(sum.total, 'Total users', '#/admin/students', 'Everyone with a student account', 'cyan')}
        ${tile(sum.free, 'Free users', '#/admin/students?plan=free', 'On the free plan', 'blue')}
        ${tile(sum.paid, 'Paid users', '#/admin/students?plan=paid', 'Paid access approved', 'green')}
        ${tile(sum.pending, 'Pending approvals', '#/admin/dashboard#queue', `Target: within ${sum.targetH} h [provisional]`, sum.pending ? 'amber' : 'green')}
      </div>
      <div class="dash dash-simple">
        <section class="card s12" id="queue"><div class="card-h"><h2>Paid-access approval queue</h2><div class="r">${LIVE && LIVE.user ? chip('Demo — needs payment provider', 'r') : ''}${queue ? chip(queue.filter(q => q.status === 'Awaiting approval').length + ' waiting', 'a') : ''}</div></div>
          ${LIVE && LIVE.user ? '<p class="warn">Sample requests: paid access is approved here once the payment provider verifies payments (OPEN-ITEMS OI-58). Approving a sample changes nothing on the server.</p>' : ''}
          ${queue ? (queue.length ? tbl(['Student', 'Plan', 'Amount', 'Payment', 'Reference', 'Requested', 'Status', 'Actions'], queue.map(q => {
            const can = API.can('approve') !== '-', open = q.status === 'Awaiting approval' || q.status === 'Info requested', verified = q.payStatus === 'Verified';
            return [`<b>${esc(q.name)}</b>${q.own ? '<br><small class="note">Your own subscription</small>' : ''}`, esc(q.plan), rs(q.amount), `${st(q.payStatus)}<br><small class="note">${esc(q.signature)}</small>`, `<span class="mono">${esc(q.ref)}</span>`, fDT(q.at), st(q.status) + (q.reason ? `<br><small class="note">${esc(q.reason)}</small>` : ''),
              can && open ? `<div class="toolbar"><button class="btn btn-xs btn-primary" data-act="appr" data-id="${q.id}" ${!verified || q.own ? 'disabled' : ''} title="${q.own ? 'You cannot approve your own subscription' : !verified ? 'Locked until payment is verified' : 'Approve paid access'}">Approve</button><button class="btn btn-xs btn-danger" data-act="rej" data-id="${q.id}" ${q.own ? 'disabled' : ''}>Reject</button><button class="btn btn-xs" data-act="info" data-id="${q.id}" ${q.own ? 'disabled' : ''}>Request info</button></div>${!verified ? '<small class="note">Locked: payment not verified</small>' : q.own ? '<small class="note">Another admin must decide</small>' : ''}` : can ? '<span class="note">Decided</span>' : '<span class="note">View only</span>'];
          })) : empty('No paid-access requests', 'New requests appear here after the payment gateway verifies a payment.')) : '<p class="note">The approval queue is for Platform and Payment admins.</p>'}
          <p class="panel-note">Approve works only after the server verifies the payment. Paid features unlock only when the approval is saved. Reject needs a reason and starts the refund. You cannot approve your own subscription. Target: decided within ${sum.targetH} hours (an operational target, not a guarantee).</p></section>
        <section class="card s6"><div class="card-h"><h2>Needs your attention</h2><div class="r">${LIVE && LIVE.user ? chip('Samples', 'r') : ''}${chip(alerts.length + ' alerts', alerts.length ? 'a' : 'g')}</div></div>
          ${LIVE && LIVE.user ? '<p class="note">Sample alerts. Real pending work is in the bell, Course Management → Change requests, Intel Review and Student Reports → Requests from trainers.</p>' : ''}
          <div class="list">${alerts.length ? alerts.slice(0, 7).map(a => `<a class="li ${a.kind}" href="${a.href}" style="color:var(--text);text-decoration:none"><div class="grow"><b>${esc(a.text)}</b></div></a>`).join('') + (alerts.length > 7 ? `<p class="note">and ${alerts.length - 7} more in the bell</p>` : '') : empty('Nothing needs you right now')}</div></section>
        <section class="card s6"><div class="card-h"><h2>Operational overview</h2></div>
          <p class="note" style="margin-bottom:.4rem">Users: free and paid</p><div class="split" role="img" aria-label="${sum.free} free and ${sum.paid} paid users"><i style="width:${sum.total ? sum.free / sum.total * 100 : 0}%;background:#3B82F6"></i><i style="width:${sum.total ? sum.paid / sum.total * 100 : 0}%;background:#34D399"></i></div>
          <div class="legend"><span style="--c:#3B82F6">Free ${sum.free}</span><span style="--c:#34D399">Paid ${sum.paid}</span></div>
          <div style="margin-top:1rem">${bars([{ label: 'Lab completion', v: ov.labs.all ? Math.round(ov.labs.done / ov.labs.all * 100) : 0 }, { label: 'Attendance avg', v: ov.attAvg, c: ov.attAvg < 75 ? 'amber' : '' }, { label: 'Performance Index avg', v: ov.piAvg, unit: '', c: 'blue' }, { label: 'Assessments graded', v: ov.assess.submitted ? Math.round(ov.assess.graded / ov.assess.submitted * 100) : 0 }])}</div>
          ${ov.dues ? `<p class="note" style="margin-top:.8rem">Dues: ${rs(ov.dues.outstanding)} outstanding · ${ov.dues.overdue} students overdue · <a href="#/admin/finance">Open Finance</a></p>` : ''}
          <p class="note" style="margin-top:.4rem">${LIVE && LIVE.user ? 'Free and paid users come from the server. Lab, attendance, index and dues bars are samples until their reports are connected here.' : 'Computed from the shared demo record at ' + fDT(Date.now()) + '.'}</p></section>
      </div>`;
    if (API.can('userSearch') !== '-') wireSearch($('#dq'), $('#dRes'));
    const ck = setInterval(() => { const c = $('#clock'); if (!c) return clearInterval(ck); c.firstChild.textContent = new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: TZ }); }, 30000);
    const decide = async (id, d, reason) => { try { await API.decide(id, d, reason); toast(d === 'Approved' ? 'Approved. Paid access is now active and the student was told.' : d === 'Rejected' ? 'Rejected. The refund has started and the student was told.' : 'Request for information sent.'); P.dashboard(); } catch (e) { fail(e); } };
    H.appr = async b => { if (await confirmBox('Approve paid access', 'This unlocks paid labs, courses and certificates for this student. The decision is audited.', 'Approve')) decide(b.dataset.id, 'Approved'); };
    H.rej = async b => { const r = await ask('Reject paid access', { placeholder: 'Reason shown to the student (feeds the refund)', ok: 'Reject', danger: true }); if (r) decide(b.dataset.id, 'Rejected', r); };
    H.info = async b => { const r = await ask('Request more information', { placeholder: 'What do you need from the student?', ok: 'Send' }); if (r) decide(b.dataset.id, 'Info', r); };
    if (location.hash.endsWith('#queue')) setTimeout(() => $('#queue')?.scrollIntoView({ behavior: 'smooth' }), 60);
  });

  /* ======================= 2. COURSE MANAGEMENT ======================= */
  const LTYPES = ['Video', 'PDF', 'Slides', 'Document', 'Link', 'Quiz', 'Lab', 'Live Class'];
  P.courses = (id, sub) => {
    if (id) return courseDetail(id, sub);
    return page([['Course Management']], async () => {
      const f = { q: '', track: '', level: '', status: '' }; const render = async () => {
        const c = await API.courses(f);
        $('#cList').innerHTML = c.length ? `<div class="grid g3">${c.map(x => `<article class="card ccard"><div class="row" style="display:flex;justify-content:space-between;gap:.5rem;align-items:start"><h3>${esc(x.title)}</h3>${st(x.status)}</div>
          <p class="note">${esc(x.desc || 'No description yet')}</p><p class="note">${esc(x.track)} · ${esc(x.level)} · ${esc(x.duration || 'Duration not set')}</p>
          <p class="note">${x.modules} modules · ${x.lessons} lessons · v${x.version} · Owner: ${esc(x.owner)}</p><p class="note">Updated ${x.updated ? fDT(x.updated) : 'never'}</p>
          <div class="toolbar"><a class="btn btn-sm btn-primary" href="#/admin/courses/${x.id}">Open builder</a></div></article>`).join('')}</div>` : empty('No courses match these filters');
      };
      view.innerHTML = `<div class="card-h"><h1>Course Management</h1><div class="r"><button class="btn btn-primary" data-act="new">Create course</button></div></div>
        <div class="card toolbar"><label style="flex:2;min-width:200px">Search<input data-inp="q" placeholder="Course title"></label>
          <label>Track<select data-chg="track"><option value="">All</option><option>Defensive</option><option>Offensive</option><option>GRC</option><option>Foundations</option></select></label>
          <label>Level<select data-chg="level"><option value="">All</option><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select></label>
          <label>Status<select data-chg="status"><option value="">All</option><option>Draft</option><option>Published</option><option>Unpublished</option></select></label></div>
        <div id="cList"></div>`;
      let tm; H.q = el => { clearTimeout(tm); tm = setTimeout(() => { f.q = el.value; render(); }, 200); };
      ['track', 'level', 'status'].forEach(k => H[k] = el => { f[k] = el.value; render(); });
      H.new = () => { const m = modal('Create course', `<form class="form" id="ncF"><label>Title<input id="ncT" maxlength="80"></label><label>Description<textarea id="ncD"></textarea></label>
        <div class="row3"><label>Track<select id="ncTr"><option>Defensive</option><option>Offensive</option><option>GRC</option><option>Foundations</option></select></label><label>Level<select id="ncL"><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select></label><label>Duration<input id="ncDu" placeholder="e.g. 6 weeks"></label></div><p class="err" id="ncE"></p></form>`,
        { foot: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="ncF" type="submit">Create draft</button>' });
        $('#ncF', m).onsubmit = async e => { e.preventDefault(); try { const id = await API.saveCourse(null, { title: $('#ncT', m).value, desc: $('#ncD', m).value, track: $('#ncTr', m).value, level: $('#ncL', m).value, duration: $('#ncDu', m).value }); m.close(); toast('Draft course created.'); location.hash = '#/admin/courses/' + id; } catch (x) { $('#ncE', m).textContent = x.message; } }; };
      await render();
    });
  };
  function courseDetail(id) {
    return page([['Course Management', '#/admin/courses'], ['Course builder']], async () => {
      const c = await API.course(id); const FR = (window.TrainerFiles || {}).FILE_RULES || {};
      const paint = async () => {
        const rd = await API.readiness(id).catch(() => ({ checks: [], ok: false }));
        view.innerHTML = `<div class="card-h"><div><h1>${esc(c.title)}</h1><p class="note">${esc(c.track)} · ${esc(c.level)} · v${c.version} ${st(c.status)} ${c.dirty ? chip('Unpublished changes', 'a') : ''}</p></div>
          <div class="r toolbar"><button class="btn" data-act="preview">Preview as student</button><button class="btn" data-act="save">Save draft</button>${c.status === 'Published' ? '<button class="btn btn-danger" data-act="unpub">Unpublish</button>' : ''}<button class="btn btn-primary" data-act="pub" ${rd.ok ? '' : 'disabled title="Fix the readiness checks first"'}>Publish${c.status === 'Published' ? ' new version' : ''}</button></div></div>
          ${c.unpublishReason && c.status === 'Unpublished' ? `<div class="warn">Unpublished: ${esc(c.unpublishReason)}</div>` : ''}
          <div class="dash"><section class="card s8"><h2>Course details</h2><form class="form" id="cdF" style="margin-top:.6rem"><label>Title<input id="cdT" value="${esc(c.title)}"></label><label>Description<textarea id="cdD">${esc(c.desc)}</textarea></label>
            <div class="row3"><label>Track<select id="cdTr">${['Defensive', 'Offensive', 'GRC', 'Foundations'].map(x => `<option ${x === c.track ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label>Level<select id="cdL">${['Beginner', 'Intermediate', 'Advanced'].map(x => `<option ${x === c.level ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label>Duration<input id="cdDu" value="${esc(c.duration)}"></label></div></form>
            <h2 style="margin-top:1.2rem">Modules and lessons</h2><p class="note">Course → Modules → Lessons. Each lesson type accepts only its own kind of file.</p>
            <div id="mods">${c.modules.map((m, mi) => `<div class="card" style="margin-top:.7rem"><div class="card-h"><label style="flex:1">Module ${mi + 1}<input data-inp="mt" data-m="${mi}" value="${esc(m.title)}"></label><button class="btn btn-xs" data-act="addL" data-m="${mi}">Add lesson</button><button class="btn btn-xs btn-danger" data-act="delM" data-m="${mi}">Remove module</button></div>
              ${m.lessons.length ? tbl(['Lesson', 'Type', 'Content', 'Status', ''], m.lessons.map((l, li) => [`<input data-inp="lt" data-m="${mi}" data-l="${li}" value="${esc(l.title)}" aria-label="Lesson title">`,
                `<select data-chg="ly" data-m="${mi}" data-l="${li}" aria-label="Lesson type">${LTYPES.map(t => `<option ${t === l.type ? 'selected' : ''}>${t}</option>`).join('')}</select>`,
                FR[l.type] ? (l.file ? `<span class="mono">${esc(l.file.name)}</span><br>${chip('Scan: ' + l.file.scan, l.file.scan === 'Clean' ? 'g' : l.file.scan === 'Scanning' ? 'a' : 'r')} ${chip(l.file.proc, l.file.proc === 'Ready' ? 'g' : 'a')}${window.TrainerFiles && !window.TrainerFiles.fileFits(l.type, l.file.name) ? '<br><small style="color:var(--red)">File does not match this lesson type</small>' : ''}` : '') + `<label class="btn btn-xs" style="margin-top:.3rem">Upload ${esc(l.type)}<input type="file" hidden accept="${FR[l.type].ext.map(x => '.' + x).join(',')}" data-chg="up" data-m="${mi}" data-l="${li}"></label><br><small class="note">${esc(FR[l.type].label)}</small>`
                  : l.type === 'Link' ? `<input data-inp="lu" data-m="${mi}" data-l="${li}" value="${esc(l.url || '')}" placeholder="https://" aria-label="Link address">` : `<span class="note">${l.type === 'Quiz' ? 'Built in Assessments' : l.type === 'Lab' ? 'Linked from Lab Management' : 'Scheduled by the trainer'}</span>`,
                st(l.status || 'Draft'), `<button class="btn btn-xs" data-act="delL" data-m="${mi}" data-l="${li}">Remove</button>`]), '') : '<p class="note">No lessons yet.</p>'}</div>`).join('')}</div>
            <button class="btn" data-act="addM" style="margin-top:.8rem">Add module</button></section>
          <aside class="s4" style="display:grid;gap:1rem;align-content:start"><section class="card"><h3>Publish readiness</h3><div class="list">${rd.checks.map(k => `<div class="li ${k.ok ? 'green' : 'red'}"><span>${k.ok ? '✓' : '✗'} ${esc(k.label)}</span></div>`).join('')}</div><p class="note" style="margin-top:.5rem">A lesson cannot be published while its upload is processing or failed the scan. Publishing creates a new version; learner progress and grades are kept.</p></section>
            <section class="card"><h3>Version history</h3>${c.versions.length ? `<div class="list">${c.versions.map(v => `<div class="li"><div class="grow"><b>v${v.v} · ${esc(v.status)}</b><span class="note">${esc(v.summary)} · ${esc(v.author)} · ${fDT(v.at)}</span></div></div>`).join('')}</div>` : '<p class="note">Not published yet.</p>'}</section>
            ${gap('Media service for virus scan and video processing. In the demo, uploads are scanned instantly.')}</aside></div>`;
      };
      const pull = () => { c.title = $('#cdT').value; c.desc = $('#cdD').value; c.track = $('#cdTr').value; c.level = $('#cdL').value; c.duration = $('#cdDu').value; };
      const saveIt = async quiet => { pull(); await API.saveCourse(id, { title: c.title, desc: c.desc, track: c.track, level: c.level, duration: c.duration, modules: c.modules }); if (!quiet) toast('Draft saved.'); };
      const L = b => c.modules[+b.dataset.m].lessons[+b.dataset.l];
      H.mt = b => { c.modules[+b.dataset.m].title = b.value; }; H.lt = b => { L(b).title = b.value; }; H.lu = b => { L(b).url = b.value.trim(); };
      H.ly = async b => { const l = L(b); l.type = b.value; if (l.file && window.TrainerFiles && !window.TrainerFiles.fileFits(l.type, l.file.name)) { toast(`Removed ${l.file.name}: it is not a ${l.type} file.`, true); l.file = null; } pull(); await paint(); };
      H.up = async b => { const file = b.files[0]; if (!file) return; const l = L(b), r = FR[l.type]; const ext = (file.name.split('.').pop() || '').toLowerCase();
        if (!r.ext.includes(ext)) return toast(`${file.name} is not a ${l.type} file. This lesson accepts: ${r.label}.`, true);
        if (file.size / 1048576 > r.maxMB) return toast(`${file.name} is larger than ${r.label}.`, true);
        l.file = { name: file.name, sizeMB: +(file.size / 1048576).toFixed(1), scan: 'Clean', proc: 'Ready', progress: 100 }; l.status = 'Draft'; pull(); await paint(); toast('Uploaded and scanned (demo).'); };
      H.addM = async () => { pull(); c.modules.push({ id: 'M' + (c.modules.length + 1), title: 'New module', lessons: [] }); await paint(); };
      H.delM = async b => { if (!await confirmBox('Remove module', 'Remove this module and its lessons from the draft? Published versions keep their content.', 'Remove', true)) return; pull(); c.modules.splice(+b.dataset.m, 1); await paint(); };
      H.addL = async b => { pull(); c.modules[+b.dataset.m].lessons.push({ id: 'LS-' + Math.random().toString(36).slice(2, 8), title: 'New lesson', type: 'Video', status: 'Draft', file: null, concept: false }); await paint(); };
      H.delL = async b => { pull(); c.modules[+b.dataset.m].lessons.splice(+b.dataset.l, 1); await paint(); };
      H.save = async () => { try { await saveIt(); await paint(); } catch (e) { fail(e); } };
      H.pub = async () => { try { await saveIt(true); const s = await ask('Publish course', { label: 'Change summary', placeholder: 'What changed in this version?', ok: 'Publish' }); if (!s) return; await API.publish(id, s); toast('Published. Enrolled students were told.'); courseDetail(id); } catch (e) { fail(e); } };
      H.unpub = async () => { const r = await ask('Unpublish course', { placeholder: 'Reason (kept in version history)', ok: 'Unpublish', danger: true }); if (!r) return; try { await API.unpublish(id, r); toast('Course unpublished.'); courseDetail(id); } catch (e) { fail(e); } };
      H.preview = () => { pull(); modal('Preview as student', `<h2>${esc(c.title)}</h2><p class="note">${esc(c.desc)}</p>${c.modules.map((m, i) => `<h3 style="margin-top:.8rem">Module ${i + 1}: ${esc(m.title)}</h3><ul>${m.lessons.filter(l => l.status !== 'Draft' || true).map(l => `<li>${esc(l.title)} <span class="note">(${esc(l.type)}${l.status === 'Draft' ? ', draft: hidden until published' : ''})</span></li>`).join('')}</ul>`).join('')}`, { wide: true }); };
      await paint();
    });
  }

  /* ======================= 3. LAB MANAGEMENT ======================= */
  P.labs = (id) => id ? labDetail(id) : page([['Lab Management']], async () => {
    const f = {}; const render = async () => { const l = await API.labs(f);
      $('#lList').innerHTML = l.length ? tbl(['Lab', 'Category', 'Difficulty', 'Path', 'Courses', 'Status', 'Environment', ''], l.map(x => [`<b>${esc(x.title)}</b><br><span class="mono note">${esc(x.id)}</span>`, esc(x.category), esc(x.difficulty), esc(x.path), esc(x.courses.join(', ') || '–'), st(x.status), '<span class="note">Not connected</span>', `<a class="btn btn-xs" href="#/admin/labs/${x.id}">Configure</a>`])) : empty('No labs match these filters'); };
    view.innerHTML = `<div class="card-h"><h1>Lab Management</h1><div class="r"><a class="btn btn-primary" href="#/admin/labs/new">Create lab</a></div></div>
      <div class="card toolbar"><label style="flex:2;min-width:200px">Search<input data-inp="q" placeholder="Lab title or ID"></label>
        <label>Category<select data-chg="category"><option value="">All</option><option>SIEM</option><option>Email security</option><option>Recon</option><option>Web</option><option>GRC</option></select></label>
        <label>Difficulty<select data-chg="difficulty"><option value="">All</option><option>Easy</option><option>Medium</option><option>Hard</option></select></label>
        <label>Status<select data-chg="status"><option value="">All</option><option>Draft</option><option>Published</option><option>Unpublished</option></select></label></div>
      <div id="lList"></div>${gap('Cyber-range API. Environment health and start or stop controls come from the isolated lab plane; this demo stores configuration only and never pretends a range is running.')}`;
    let tm; H.q = el => { clearTimeout(tm); tm = setTimeout(() => { f.q = el.value; render(); }, 200); };
    ['category', 'difficulty', 'status'].forEach(k => H[k] = el => { f[k] = el.value; render(); });
    await render();
  });
  function labDetail(id) {
    const isNew = id === 'new';
    return page([['Lab Management', '#/admin/labs'], [isNew ? 'Create lab' : id]], async () => {
      const l = isNew ? { id: '', title: '', category: 'SIEM', difficulty: 'Easy', path: 'Defensive', status: 'Draft', courses: [], env: { image: '', timeoutMin: 90, network: 'Isolated per student', maxSeats: 60 }, flags: [], hints: [], courseList: (await API.courses()).map(c => ({ id: c.id, title: c.title })) } : await API.lab(id);
      const secrets = API.can('labSecrets') !== '-';
      view.innerHTML = `<div class="card-h"><div><h1>${isNew ? 'Create lab' : esc(l.title)}</h1>${isNew ? '' : `<p class="note"><span class="mono">${esc(l.id)}</span> ${st(l.status)}</p>`}</div>
        <div class="r toolbar">${isNew ? '' : l.status === 'Published' ? '<button class="btn btn-danger" data-act="unpub">Unpublish</button>' : '<button class="btn" data-act="pubL">Publish</button>'}</div></div>
        <form class="dash" data-sub="saveL" novalidate><section class="card s8"><h2>Lab configuration</h2><div class="form" style="margin-top:.6rem">
          <div class="row2">${isNew ? '<label>Lab ID<input id="lbId" placeholder="DEF-06" class="mono"></label>' : ''}<label>Title<input id="lbT" value="${esc(l.title)}"></label></div>
          <div class="row3"><label>Category<input id="lbC" value="${esc(l.category)}"></label><label>Difficulty<select id="lbD">${['Easy', 'Medium', 'Hard'].map(x => `<option ${x === l.difficulty ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label>Learning path<select id="lbP">${['Defensive', 'Offensive', 'GRC'].map(x => `<option ${x === l.path ? 'selected' : ''}>${x}</option>`).join('')}</select></label></div>
          <fieldset class="card"><legend>Linked courses</legend>${l.courseList.map(c => `<label class="chk"><input type="checkbox" class="lbCo" value="${c.id}" ${l.courses.includes(c.id) ? 'checked' : ''}> ${esc(c.title)}</label>`).join('')}</fieldset>
          <h3>Environment settings</h3><div class="row3"><label>Image<input id="lbI" class="mono" value="${esc(l.env.image)}"></label><label>Session timeout (min)<input id="lbTo" type="number" min="15" max="240" value="${l.env.timeoutMin}"></label><label>Max seats<input id="lbS" type="number" min="1" value="${l.env.maxSeats}"></label></div>
          <p class="note">Network: ${esc(l.env.network)} (fixed by the cyber-range isolation rules).</p>
          <h3>Hints</h3><textarea id="lbH" placeholder="One hint per line">${esc(l.hints.join('\n'))}</textarea>
          <div class="toolbar"><button class="btn btn-primary" type="submit">Save lab</button><a class="btn" href="#/admin/labs">Cancel</a></div><p class="err" id="lbE" role="alert"></p></div></section>
        <aside class="s4" style="display:grid;gap:1rem;align-content:start"><section class="card"><h3>Flags and answers</h3>${secrets ? `<p class="note">Stored on the server only. Never sent to students, trainers or analytics.</p>
          <div class="list" id="flagList">${l.flags.length ? l.flags.map(f => `<div class="li"><span>Checkpoint ${f.cp}</span><span class="mono">${esc(f.value)}</span></div>`).join('') : '<p class="note">No flags yet.</p>'}</div>
          <div class="toolbar" style="margin-top:.6rem">${isNew ? '' : '<button class="btn btn-sm" type="button" data-act="reveal">Show flags (MFA)</button>'}<button class="btn btn-sm" type="button" data-act="setFlags">Set flags</button></div>` : '<p class="note">Your role cannot see flags or answers.</p>'}</section>
          ${gap('Environment health, start and stop come from the cyber-range API. Not connected in this demo.')}</aside></form>`;
      let newFlags = null;
      H.reveal = async () => { const code = await ask('Confirm with MFA', { mfa: true, text: 'Viewing flags is audited.' }); if (!code) return; try { const f = await API.revealFlags(id, code); $('#flagList').innerHTML = f.map(x => `<div class="li"><span>Checkpoint ${x.cp}</span><span class="mono">${esc(x.value)}</span></div>`).join(''); } catch (e) { fail(e); } };
      H.setFlags = async () => { const v = await ask('Set flags', { label: 'One flag per line, in checkpoint order', placeholder: 'FLAG{...}', ok: 'Use these flags' }); if (!v) return; newFlags = v.split('\n').map(s => s.trim()).filter(Boolean); $('#flagList').innerHTML = newFlags.map((x, k) => `<div class="li"><span>Checkpoint ${k + 1}</span><span class="mono">••••••••</span></div>`).join('') + '<p class="note">Saved when you press Save lab.</p>'; };
      H.saveL = async () => { try { const nid = await API.saveLab(isNew ? null : id, { id: isNew ? $('#lbId').value.trim().toUpperCase() : id, title: $('#lbT').value.trim(), category: $('#lbC').value.trim(), difficulty: $('#lbD').value, path: $('#lbP').value, courses: $$('.lbCo:checked').map(x => x.value), hints: $('#lbH').value.split('\n').map(s => s.trim()), env: { image: $('#lbI').value.trim(), timeoutMin: $('#lbTo').value, maxSeats: +$('#lbS').value }, newFlags });
        toast('Lab saved.'); location.hash = '#/admin/labs/' + nid; if (!isNew) labDetail(nid); } catch (e) { $('#lbE').textContent = e.message; } };
      H.pubL = async () => { if (!await confirmBox('Publish lab', 'Students on the linked path will see this lab.', 'Publish')) return; try { await API.labStatus(id, 'Published'); toast('Lab published.'); labDetail(id); } catch (e) { fail(e); } };
      H.unpub = async () => { const r = await ask('Unpublish lab', { ok: 'Unpublish', danger: true }); if (!r) return; try { await API.labStatus(id, 'Unpublished', r); toast('Lab unpublished.'); labDetail(id); } catch (e) { fail(e); } };
    });
  }

  /* ======================= 4. STUDENT MANAGEMENT ======================= */
  P.students = (id, sub, qs) => id === 'staff' ? staffPage() : id ? studentDetail(id, sub) : page([['Student Management']], async () => {
    const f = { q: '', path: '', plan: qs.get('plan') || '', batch: '', mode: '' }; let pg = 0;
    const render = async () => { const rows = await API.students(f); const show = rows.slice(pg * pageSize, pg * pageSize + pageSize);
      const head = ['Student', 'Institution', 'Path', 'Plan', 'Enrolment', 'Batch / mode'].concat(rows.some(r => r.att != null) ? ['Attendance', 'Index'] : []).concat(['']);
      $('#sList').innerHTML = `<p class="note" style="margin:.4rem 0">${rows.length} students${LIVE && LIVE.user ? ' (live) · open one for the profile, progress, labs and audit' : ' · paid users and CTF registrants. Free users are in <a href="#/admin/total">Total Users</a>'}.</p>` + (rows.length ? tbl(head, show.map(r => [`<b>${esc(r.name)}</b><br><span class="mono note">${esc(r.id)}</span>`, esc(r.institution), esc(r.path), (r.plan === 'ctf' ? chip('CTF', 'b') : st(r.plan)) + (r.planName && r.plan === 'paid' ? `<br><small class="note">${esc(r.planName)}</small>` : ''), st(r.enrol === 'Active' ? 'Active' : r.enrol), `${esc(r.batch)}<br><small class="note">${esc(r.mode)}</small>`]
        .concat(r.att != null ? [pbar(r.att), `<b>${r.pi}</b>`] : rows.some(x => x.att != null) ? ['<span class="note">–</span>', '<span class="note">–</span>'] : []).concat([r.ctf ? '<a class="btn btn-xs" href="#/admin/ctf">Open</a>' : `<a class="btn btn-xs" href="#/admin/users/${r.id}">Open</a>`]))) + pager(rows.length, pg, 'pg') : empty('No students match these filters')); };
    view.innerHTML = `<div class="card-h"><h1>Student Management</h1><div class="r">${ROLE === 'platform' ? '<a class="btn" href="#/admin/students/staff">Staff accounts</a>' : ''}</div></div>
      ${ROLE !== 'platform' ? `<p class="note" style="margin-bottom:.6rem">${ROLE === 'payment' ? 'Payment admins see plan and payment context only.' : ROLE === 'content' ? 'Content admins see learning progress only.' : 'Support admins state a reason before opening a record.'}</p>` : ''}
      <div class="card toolbar"><label style="flex:2;min-width:200px">Search<input data-inp="q" placeholder="Name, email or user ID"></label>
        <label>Path<select data-chg="path"><option value="">All</option><option>Offensive</option><option>Defensive</option><option>GRC</option></select></label>
        <label>Plan<select data-chg="plan"><option value="">All</option><option value="paid" ${f.plan === 'paid' ? 'selected' : ''}>Paid</option><option value="ctf" ${f.plan === 'ctf' ? 'selected' : ''}>CTF registered</option></select></label>
        <label>Batch<select data-chg="batch" id="sBatch"><option value="">All</option>${(LIVE && LIVE.user ? [] : ['SOC-B7', 'FND-B3', 'OPS-B2']).map(b => `<option>${b}</option>`).join('')}</select></label>
        ${LIVE && LIVE.user ? '' : '<label>Mode<select data-chg="mode"><option value="">All</option><option>Online</option><option>Offline</option></select></label>'}</div><div id="sList"></div>`;
    if (LIVE && LIVE.user && API.batchCodes) API.batchCodes().then(cs => { const sel = $('#sBatch'); if (sel) sel.insertAdjacentHTML('beforeend', cs.map(c => `<option>${esc(c)}</option>`).join('')); });
    let tm; H.q = el => { clearTimeout(tm); tm = setTimeout(() => { f.q = el.value; pg = 0; render(); }, 200); };
    ['path', 'plan', 'batch', 'mode'].forEach(k => H[k] = el => { f[k] = el.value; pg = 0; render(); });
    H.pg = b => { pg = +b.dataset.p; render(); };
    await render();
  });
  function studentDetail(id, tab) {
    return page([['Student Management', '#/admin/students'], [id]], async () => {
      const s = await API.student(id); tab = s.tabs.includes(tab) ? tab : s.tabs[0];
      const body = async () => {
        if (tab === 'Profile') { const edit = ['platform', 'support'].includes(ROLE) && !s.web;
          return `<dl class="kv2">${Object.entries(s.profile).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
            ${s.resume ? `<h3 style="margin-top:1rem">Resume</h3><dl class="kv2"><dt>Status</dt><dd>${s.resume.done ? 'Done' : 'Not yet'}</dd><dt>Education</dt><dd>${esc(s.resume.education || '–')}</dd><dt>Skills</dt><dd>${esc(s.resume.skills || '–')}</dd><dt>Objective</dt><dd>${esc(s.resume.objective || '–')}</dd></dl>` : ''}
            ${edit ? `<form class="form card" data-sub="saveS" style="margin-top:1rem"><h3>Edit details</h3><div class="row2"><label>Institution<input id="edI" value="${esc(s.institution)}"></label><label>City<input id="edC" value="${esc(s.profile.City || '')}"></label></div>
              ${ROLE === 'platform' ? `<div class="row2"><label>Learning mode<select id="edM"><option ${s.mode === 'Offline' ? 'selected' : ''}>Offline</option><option ${s.mode === 'Online' ? 'selected' : ''}>Online</option></select></label><label>Reason (needed to change the mode)<input id="edR"></label></div><label>Internal admin note<textarea id="edN">${esc(s.note || '')}</textarea></label>` : ''}
              <div class="toolbar"><button class="btn btn-primary" type="submit">Save</button><button class="btn" type="button" data-act="cancelS">Cancel</button></div><p class="err" id="edE" role="alert"></p></form>` : ''}`; }
        if (tab === 'Progress') { const p = s.progress; return `<div class="grid g4"><div class="stat blue"><b>${p.pi}</b><span>Performance Index</span><small>${esc(p.band)}</small></div><div class="stat ${p.att.pct < 75 ? 'red' : 'green'}"><b>${p.att.pct}%</b><span>Attendance</span><small>${p.att.P} of ${p.att.held} classes</small></div><div class="stat cyan"><b>${p.labs}/15</b><span>Labs</span><small>${p.xp} XP</small></div><div class="stat"><b>${p.quiz}</b><span>Quiz average</span><small>${p.missed} missed</small></div></div>
          <h3 style="margin-top:1rem">Recent lectures</h3>${tbl(['Lecture', 'Date', 'Mark'], p.lectures.map(l => [`#${l.n} ${esc(l.topic)}`, fD(l.start), l.mark ? `<span class="mark ${l.mark}">${l.mark === 'P' ? 'Present' : 'Absent'}</span>` : '<span class="note">Not marked</span>']))}`; }
        if (tab === 'Labs') return s.labs.length ? tbl(['Lab', 'State', 'Checkpoints', 'Time'], s.labs.map(l => [`<span class="mono">${esc(l.m)}</span>`, st(l.state === 'Done' ? 'Completed' : l.state), `${l.cp} / ${l.cpTotal}`, l.mins + ' min'])) + '<p class="note" style="margin-top:.5rem">Flags and answers are never shown here.</p>' : empty('No lab activity');
        if (tab === 'Payments') return `${s.dues ? `<div class="grid g4"><div class="stat"><b>${rs(s.dues.total)}</b><span>Fee total</span><small>${esc(s.dues.plan)}</small></div><div class="stat green"><b>${rs(s.dues.paid)}</b><span>Paid</span></div><div class="stat ${s.dues.due ? 'amber' : 'green'}"><b>${rs(s.dues.due)}</b><span>Due</span><small>${s.dues.next ? 'next ' + fD(s.dues.next.due) : 'nothing due'}</small></div><div class="stat">${st(s.dues.status)}<span>Status</span></div></div>` : '<p class="note">No fee plan on record.</p>'}
          <h3 style="margin-top:1rem">Payments</h3>${s.payments.length ? tbl(['Date', 'Amount', 'Method', 'Reference', 'Status'], s.payments.map(p => [fDT(p.at), rs(p.amount), esc(p.method), `<span class="mono">${esc(p.ref)}</span>`, st(p.status)])) : empty('No payments')}<p class="note" style="margin-top:.5rem">Card numbers, CVV and UPI PIN are never stored or shown. Subscription: <span class="mono">${esc(s.subId || 'none')}</span></p>`;
        if (tab === 'Audit') { const a = await API.audit({ target: id }); return a.length ? tbl(['When', 'Who', 'Action', 'Detail'], a.map(x => [fDT(x.at), esc(x.who), esc(x.action), esc(x.detail)])) + '<p class="note" style="margin-top:.5rem">Read-only. Audit rows cannot be edited or deleted.</p>' : empty('No admin actions recorded for this student yet'); }
        return '';
      };
      view.innerHTML = `<section class="card"><div class="idhead"><span class="av">${esc(initials(s.name))}</span><div style="flex:1"><h1>${esc(s.name)}</h1><p class="note"><span class="mono">${esc(id)}</span>${s.batch ? ' · ' + esc(s.batch) : ''}${s.path ? ' · ' + esc(s.path) : ''}${s.institution ? ' · ' + esc(s.institution) : ''}</p></div>
        <div class="toolbar">${st(s.plan)}${s.enrol ? st(s.enrol) : ''}${s.mode ? chip(s.mode, 'b') : ''}${API.can('reports') !== '-' && !s.web ? `<a class="btn btn-sm" href="#/admin/reports?sid=${id}">Student report</a>` : ''}</div></div></section>
        <div class="tabs" role="tablist" style="margin:1rem 0">${s.tabs.map(t => `<button role="tab" aria-selected="${t === tab}" data-act="tab" data-t="${t}">${t}</button>`).join('')}</div><section class="card" id="tabBody" role="tabpanel">${await body()}</section>`;
      H.tab = b => { location.hash = `#/admin/users/${id}/${b.dataset.t}`; };
      H.cancelS = () => studentDetail(id, 'Profile');
      H.saveS = async () => { try { const f = { institution: $('#edI').value, city: $('#edC').value }; if (ROLE === 'platform') Object.assign(f, { mode: $('#edM').value, reason: $('#edR').value, note: $('#edN').value }); const ch = await API.saveStudent(id, f); toast('Saved: ' + ch.join(', ')); studentDetail(id, 'Profile'); } catch (e) { $('#edE').textContent = e.message; } };
    });
  }
  function staffPage() {
    return page([['Student Management', '#/admin/students'], ['Staff accounts']], async () => {
      const s = await API.staff();
      view.innerHTML = `<div class="card-h"><h1>Staff accounts</h1></div><div class="dash"><section class="card s7">${tbl(['Name', 'Email', 'Role', 'Batches', 'Status'], s.map(x => [esc(x.name), `<span class="mono">${esc(x.email)}</span>`, esc(x.role), esc(x.batches || '–'), st(x.status === 'active' ? 'Active' : x.status)]))}</section>
        <form class="card s5 form" data-sub="ct"><h2>Create trainer account</h2><label>Full name<input id="ctN"></label><label>Organisation email<input id="ctE" type="email" placeholder="name@yojo.demo"></label><label>Capability<select id="ctC"><option>Trainer</option><option>Trainer + Mentor</option></select></label><label>Batches<input id="ctB" placeholder="SOC-B7, FND-B3"></label><button class="btn btn-primary" type="submit">Send invite (valid 72 h)</button><p class="err" id="ctErr" role="alert"></p><p class="note">The trainer finishes MFA set-up and the code of conduct on first login.</p></form></div>`;
      H.ct = async () => { try { await API.createTrainer({ name: $('#ctN').value, email: $('#ctE').value, capability: $('#ctC').value, batches: $('#ctB').value }); toast('Invite created.'); staffPage(); } catch (e) { $('#ctErr').textContent = e.message; } };
    });
  }

  /* ======================= 5. ATTENDANCE ======================= */
  P.attendance = (_, __, qs) => qs.get('who') === 'trainers' ? trainerAtt(qs) : page([['Attendance']], async () => {
    const f = { batch: qs.get('batch') || '', from: '', to: '', q: '', status: '' };
    const render = async () => { const d = await API.attendance(f); f.batch = d.batch;
      const held = d.lectures.filter(l => l.status === 'held').slice(-8);
      $('#aBody').innerHTML = `<div class="grid g4"><div class="stat"><b>${d.rows.length}</b><span>Students</span></div><div class="stat ${d.rows.filter(r => r.flag !== 'OK').length ? 'red' : 'green'}"><b>${d.rows.filter(r => r.flag !== 'OK').length}</b><span>Below ${d.required}%</span></div><div class="stat blue"><b>${d.rows.length ? Math.round(d.rows.reduce((a, r) => a + r.pct, 0) / d.rows.length) : 0}%</b><span>Average</span></div><div class="stat"><b>${d.lectures.filter(l => l.status === 'held').length}</b><span>Classes held</span></div></div>
        <section class="card" style="margin-top:1rem"><div class="card-h"><h2>Attendance register</h2><div class="r"><button class="btn btn-sm" data-act="exp">Export CSV</button></div></div>
          ${d.rows.length ? tbl(['Student', ...held.map(l => `#${l.n}<br><small>${fD(l.start).slice(0, 6)}</small>`), 'Attended', '%', 'Flag'], d.rows.map(r => [`<b>${esc(r.name)}</b><br><span class="mono note">${r.id}</span>`, ...held.map(l => { const m = l.marks[r.id]; return d.canEdit ? `<button class="mark ${m || ''}" data-act="ed" data-l="${l.id}" data-s="${r.id}" data-m="${m || ''}" title="Change mark (needs a reason)" aria-label="${esc(r.name)}, lecture ${l.n}: ${m === 'P' ? 'Present' : m === 'A' ? 'Absent' : 'not marked'}. Change">${m || '·'}</button>` : `<span class="mark ${m || ''}">${m || '·'}</span>`; }), `${r.P} / ${r.held}`, pbar(r.pct), st(r.flag === 'OK' ? 'OK' : 'At risk').replace('At risk', esc(r.flag))]), '') : empty('No students match')}
          <p class="note" style="margin-top:.5rem">P = Present, A = Absent. Holidays are left out of percentages. ${d.canEdit ? 'Click a mark to correct it with a reason.' : 'Your role can view but not change attendance.'} This is the same record the trainer marks and the student report uses.</p></section>
        <section class="card" style="margin-top:1rem"><h2>Correction history</h2>${d.edits.length ? tbl(['When', 'Student', 'Lecture', 'Change', 'By', 'Reason'], d.edits.map(e => [fDT(e.at), esc(e.name), esc(e.lecture), `${esc(e.old)} → ${esc(e.new)}`, esc(e.who), esc(e.reason)])) : empty('No corrections in this range')}</section>`;
      H.exp = () => { csv(`attendance-${d.batch}.csv`, [['Student ID', 'Name', 'Attended', 'Held', 'Percent', 'Flag'], ...d.rows.map(r => [r.id, r.name, r.P, r.held, r.pct, r.flag])]); toast('CSV downloaded.'); };
      return d; };
    const d0 = await API.attendance(f);
    view.innerHTML = `<div class="card-h"><h1>Attendance</h1><div class="r">${chip('Required ' + d0.required + '%', 'a')}</div></div>${attTabs('students')}
      <div class="card toolbar"><label>Batch<select data-chg="batch">${d0.batches.map(b => `<option ${b === d0.batch ? 'selected' : ''}>${b}</option>`).join('')}</select></label><label>From<input type="date" data-chg="from"></label><label>To<input type="date" data-chg="to"></label>
        <label style="flex:1;min-width:160px">Student<input data-inp="q" placeholder="Search student"></label><label>Show<select data-chg="status"><option value="">Everyone</option><option value="low">Below required level</option></select></label></div><div id="aBody"></div>`;
    let tm; H.q = el => { clearTimeout(tm); tm = setTimeout(() => { f.q = el.value; render(); }, 200); };
    ['batch', 'from', 'to', 'status'].forEach(k => H[k] = el => { f[k] = el.value; render(); });
    H.ed = async b => { const cur = b.dataset.m, next = cur === 'P' ? 'A' : 'P';
      const r = await ask(`Change to ${next === 'P' ? 'Present' : 'Absent'}`, { placeholder: 'Reason for the correction (kept in the history)', ok: 'Save change', text: `Current mark: ${cur === 'P' ? 'Present' : cur === 'A' ? 'Absent' : 'not marked'}.` }); if (!r) return;
      try { await API.editAttendance(b.dataset.l, b.dataset.s, next, r); toast('Attendance corrected. Trainer, student and report views use this record.'); render(); } catch (e) { fail(e); } };
    await render();
  });

  const attTabs = cur => `<div class="tabs" role="tablist" style="margin-bottom:1rem"><a role="tab" class="btn btn-sm ${cur === 'students' ? 'btn-primary' : ''}" aria-selected="${cur === 'students'}" href="#/admin/attendance">Student attendance</a> <a role="tab" class="btn btn-sm ${cur === 'trainers' ? 'btn-primary' : ''}" aria-selected="${cur === 'trainers'}" href="#/admin/attendance?who=trainers">Trainer attendance</a></div>`;
  function trainerAtt(qs) {
    return page([['Attendance', '#/admin/attendance'], ['Trainers']], async () => {
      const date = qs.get('date') || new Date().toISOString().slice(0, 10), d = await API.trainerAttendance({ date });
      view.innerHTML = `<div class="card-h"><h1>Attendance</h1></div>${attTabs('trainers')}
        <div class="card toolbar"><label>Date<input type="date" data-chg="tdate" value="${d.date}"></label><p class="note" style="flex:1">Mark each trainer for the day. When a trainer is marked Absent, every student in their batches gets a notification with your note.</p></div>
        <section class="card" style="margin-top:1rem"><h2>Trainers on ${fD(new Date(d.date).getTime())}</h2>${tbl(['Trainer', 'Batches', 'Students', 'Today', 'This month', ''], d.rows.map(r => [`<b>${esc(r.name)}</b>`, r.batches.map(esc).join('<br>'), r.students, r.mark ? st(r.mark === 'P' ? 'Present' : 'Absent') + (r.reason ? `<br><small class="note">${esc(r.reason)}</small>` : '') : '<span class="note">Not marked</span>', `${r.P} P · ${r.A} A · ${r.pct}%`,
          d.canEdit ? `<div class="toolbar"><button class="btn btn-xs ${r.mark === 'P' ? 'btn-primary' : ''}" data-act="tp" data-t="${r.tid}" data-n="${esc(r.name)}">Present</button><button class="btn btn-xs ${r.mark === 'A' ? 'btn-danger' : ''}" data-act="ta" data-t="${r.tid}" data-n="${esc(r.name)}">Absent</button></div>` : '']))}
          <p class="note" style="margin-top:.5rem">P = Present, A = Absent.</p></section>
        <section class="card" style="margin-top:1rem"><h2>Recent trainer marks</h2>${d.history.length ? tbl(['Date', 'Trainer', 'Mark', 'Note', 'Students notified', 'By'], d.history.map(x => [esc(x.date), esc(x.name), st(x.status === 'P' ? 'Present' : 'Absent'), esc(x.reason || '–'), x.notified || '–', esc(x.by)])) : empty('No trainer marks yet')}</section>`;
      H.tdate = el => { location.hash = '#/admin/attendance?who=trainers&date=' + el.value; };
      H.tp = async b => { try { await API.markTrainer(b.dataset.t, d.date, 'P'); toast(`${b.dataset.n} marked Present.`); trainerAtt(qs); } catch (e) { fail(e); } };
      H.ta = async b => { const r = await ask(`Mark ${b.dataset.n} absent`, { placeholder: 'Note for the students, e.g. Class moves to Friday 6:30 PM', text: 'Every student in this trainer\'s batches is notified with this note.', ok: 'Mark absent and notify', danger: true }); if (!r) return;
        try { const n = await API.markTrainer(b.dataset.t, d.date, 'A', r); toast(`${b.dataset.n} marked Absent. ${n} students notified.`); trainerAtt(qs); } catch (e) { fail(e); } };
    });
  }

  /* ======================= 6. PERFORMANCE ======================= */
  P.performance = (sid) => page([['Performance']], async () => {
    const f = { batch: '' }; const render = async () => { const d = await API.performance(f);
      $('#pBody').innerHTML = `<div class="grid g4"><div class="stat blue"><b>${d.avg.pi}</b><span>Average Performance Index</span></div><div class="stat"><b>${d.avg.att}%</b><span>Attendance avg</span></div><div class="stat cyan"><b>${d.avg.labs}%</b><span>Labs avg</span></div><div class="stat"><b>${d.avg.quiz}</b><span>Courses and assessments avg</span></div></div>
        <div class="dash" style="margin-top:1rem"><section class="card s6"><h2>How the index is made</h2>${bars(Object.entries(d.weights).map(([k, v]) => ({ label: k, v, w: v * 2.5, c: 'blue' })))}<p class="note" style="margin-top:.5rem">Weights are configurable in System Settings and still <b>provisional</b> until the owner approves them. The index guides mentoring; it never decides fees, grades, attendance or placement on its own.</p></section>
          <section class="card s6"><h2>Attendance trend (last lectures)</h2>${bars(d.trend.filter(t => t.pct != null).map(t => ({ label: t.label, v: t.pct, c: t.pct < 75 ? 'amber' : '' })))}</section></div>
        <section class="card" style="margin-top:1rem"><h2>Students</h2>${tbl(['Student', 'Batch', 'Index', 'Band', 'Attendance (20)', 'Labs (30)', 'Courses (35)', 'XP (15)', ''], d.rows.sort((a, b) => a.pi - b.pi).map(r => [`<b>${esc(r.name)}</b>`, esc(r.batch), `<b>${r.pi}</b>`, st(r.band), pbar(r.att.pct), pbar(r.labsPct), pbar(r.quiz), `${r.xp}`, `<a class="btn btn-xs" href="#/admin/users/${r.id}/Progress">Progress</a>`]))}
          <p class="note" style="margin-top:.5rem">Bands: Excelling 80+, On track 60 to 79, Needs attention 40 to 59, At risk below 40. Colours always come with a text label.</p></section>`;
      return d; };
    const d0 = await API.performance(f);
    view.innerHTML = `<div class="card-h"><h1>Performance</h1></div><div class="card toolbar"><label>Batch<select data-chg="batch"><option value="">All batches</option>${d0.batches.map(b => `<option>${b}</option>`).join('')}</select></label></div><div id="pBody"></div>`;
    H.batch = el => { f.batch = el.value; render(); };
    await render();
  });

  /* ======================= 7. FINANCE + DUES ======================= */
  P.finance = () => page([['Finance + Dues']], async () => {
    const d = await API.finance();
    const act = d.canAct;
    view.innerHTML = `<div class="card-h"><h1>Finance + Dues</h1><div class="r">${LIVE && LIVE.user ? chip('Demo — needs payment provider', 'r') : ''}${d.restricted ? chip('View only for your role', 'a') : ''}</div></div>
      ${LIVE && LIVE.user ? '<p class="warn">Everything on this page is sample data. Fees, payments, dues and reminders arrive with the payment provider (OPEN-ITEMS OI-58); nothing here is saved to the server.</p>' : ''}
      <div class="grid g4"><div class="stat green"><b>${rs(d.collected)}</b><span>Collected (verified)</span></div><div class="stat amber"><b>${rs(d.outstanding)}</b><span>Outstanding dues</span></div><div class="stat red"><b>${d.overdue}</b><span>Overdue students</span></div><div class="stat"><b>${d.offline.filter(o => o.status === 'Awaiting second admin').length}</b><span>Waiting for a second admin</span></div></div>
      <section class="card" style="margin-top:1rem"><div class="card-h"><h2>Fee plans and dues</h2><div class="r"><label class="sr" for="fq">Search</label><input id="fq" data-inp="fq" placeholder="Search student"></div></div><div id="fRows"></div></section>
      <section class="card" style="margin-top:1rem" id="second"><h2>Second-admin confirmations</h2><p class="note">Offline payments and manual payment overrides need a second admin. The admin who recorded it cannot confirm it.</p>
        ${d.offline.length ? tbl(['Recorded', 'Student', 'What', 'Amount', 'Reference', 'Recorded by', 'Status', ''], d.offline.map(o => [fDT(o.at), esc(o.name), esc(o.kind) + (o.note ? `<br><small class="note">${esc(o.note)}</small>` : ''), rs(o.amount), `<span class="mono">${esc(o.ref)}</span>`, esc(o.byName), st(o.status) + (o.second ? `<br><small class="note">by ${esc(o.second)}</small>` : ''),
          o.status === 'Awaiting second admin' && act ? (o.mine ? '<span class="note">Waiting for another admin</span>' : `<div class="toolbar"><button class="btn btn-xs btn-primary" data-act="ok2" data-id="${o.id}">Confirm</button><button class="btn btn-xs btn-danger" data-act="no2" data-id="${o.id}">Reject</button></div>`) : ''])) : empty('Nothing waiting')}</section>
      <section class="card" style="margin-top:1rem"><h2>Payment history</h2>${tbl(['Date', 'Student', 'Plan', 'Amount', 'Method', 'Reference', 'Verification', ''], d.payments.map(p => [fDT(p.at), esc(p.name), esc(p.plan), rs(p.amount), esc(p.method), `<span class="mono">${esc(p.ref)}</span>`, st(p.status) + `<br><small class="note">${esc(p.signature)}</small>`, act && p.status !== 'Verified' ? `<button class="btn btn-xs" data-act="ovr" data-id="${p.id}">Manual override</button>` : '']))}
        <p class="note" style="margin-top:.5rem">Payments come from the hosted gateway (Card, UPI, Razorpay). Card numbers, CVV and UPI PIN are never collected, stored or shown. Reminders go out 7 and 3 days before the due date, on the day, and at +3 and +7 days overdue [provisional].</p></section>
      ${gap('Payment gateway webhook and signature verification. Payments in this demo are sample records.')}`;
    const rows = (q = '') => { const r = d.rows.filter(x => x.name.toLowerCase().includes(q.toLowerCase()));
      $('#fRows').innerHTML = tbl(['Student', 'Plan', 'Total', 'Paid', 'Due', 'Next due', 'Status', 'Reminders', ''], r.map(x => [`<b>${esc(x.name)}</b><br><span class="mono note">${x.sid}</span>`, esc(x.plan) + `<br><small class="note">${esc(x.mode || '')}</small>`, rs(x.total), rs(x.paid), `<b>${rs(x.due)}</b>`, x.next ? fD(x.next.due) : '–', st(x.status) + (x.overdueDays ? `<br><small class="note">${x.overdueDays} days</small>` : ''), x.reminders,
        `<div class="toolbar"><button class="btn btn-xs" data-act="inst" data-s="${x.sid}">Instalments</button>${act && x.due ? `<button class="btn btn-xs" data-act="split" data-s="${x.sid}">Split payment</button><button class="btn btn-xs" data-act="rem" data-s="${x.sid}">Send reminder</button><button class="btn btn-xs btn-primary" data-act="off" data-s="${x.sid}">Record payment</button>` : ''}</div>`])); };
    rows(); H.fq = el => rows(el.value);
    H.split = b => { const x = d.rows.find(r => r.sid === b.dataset.s), open = x.instalments.filter(i => !i.paidAt), day = t => new Date(t).toISOString().slice(0, 10);
      const line = (a = '', due = '') => `<div class="row2 sp-row"><label>Amount (Rs)<input type="number" min="1" class="spA" value="${a}"></label><label>Due date<input type="date" class="spD" value="${due}"></label></div>`;
      const m = modal(`Split payment: ${x.name}`, `<form class="form" id="spF"><p class="note">Left to pay: <b>${rs(x.due)}</b>. Set each payment by hand. The student is notified of every amount and due date.</p><div id="spRows">${(open.length ? open : [{}]).map(i => line(i.amount || '', i.due ? day(i.due) : '')).join('')}</div>
        <button type="button" class="btn btn-sm" id="spAdd">+ Add a payment</button><p class="note" id="spSum"></p><p class="err" id="spE" role="alert"></p></form>`, { foot: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="spF" type="submit">Save and notify student</button>' });
      const sum = () => { const t = [...m.querySelectorAll('.spA')].reduce((a, i) => a + (+i.value || 0), 0); $('#spSum', m).textContent = `Total of payments: ${rs(t)} of ${rs(x.due)}`; };
      $('#spAdd', m).onclick = () => { $('#spRows', m).insertAdjacentHTML('beforeend', line()); sum(); }; m.addEventListener('input', sum); sum();
      $('#spF', m).onsubmit = async e => { e.preventDefault(); const parts = [...m.querySelectorAll('.sp-row')].map(r => ({ amount: $('.spA', r).value, due: $('.spD', r).value }));
        try { await API.splitFee(x.sid, parts); m.close(); toast('Payment split saved. The student was told the due dates.'); P.finance(); } catch (z) { $('#spE', m).textContent = z.message; } }; };
    H.inst = b => { const x = d.rows.find(r => r.sid === b.dataset.s); modal(`${x.name}: instalments`, tbl(['#', 'Amount', 'Due', 'Paid on', 'Method', 'Reference'], x.instalments.map(i => [i.n, rs(i.amount), fD(i.due), i.paidAt ? fD(i.paidAt) : st(i.due < Date.now() ? 'Overdue' : 'Due'), esc(i.method || '–'), `<span class="mono">${esc(i.ref || '–')}</span>`])) + `<h3 style="margin-top:1rem">Reminder history</h3>${x.reminderLog.length ? tbl(['When', 'By', 'Kind'], x.reminderLog.map(r => [fDT(r.at), esc(r.by), esc(r.kind)])) : '<p class="note">No reminders sent.</p>'}`, { wide: true }); };
    H.rem = async b => { if (!await confirmBox('Send due reminder', 'The student gets a reminder in the bell (email in the full build).', 'Send reminder')) return; try { await API.remind(b.dataset.s); toast('Reminder sent.'); P.finance(); } catch (e) { fail(e); } };
    H.off = b => { const x = d.rows.find(r => r.sid === b.dataset.s); const m = modal(`Record offline payment: ${x.name}`, `<form class="form" id="ofF"><div class="row2"><label>Amount (Rs)<input id="ofA" type="number" min="1" max="${x.due}" value="${x.next ? x.next.amount : ''}"></label><label>Method<select id="ofM"><option>Cash</option><option>Bank transfer</option><option>Cheque</option><option>UPI (offline)</option></select></label></div>
      <label>Receipt or reference number<input id="ofR" class="mono"></label><label>Evidence note<input id="ofN" placeholder="e.g. receipt book 4, page 18"></label><p class="note">A second admin must confirm before the dues change. Never enter card numbers.</p><p class="err" id="ofE" role="alert"></p></form>`, { foot: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="ofF" type="submit">Record for confirmation</button>' });
      $('#ofF', m).onsubmit = async e => { e.preventDefault(); try { await API.recordOffline(x.sid, { amount: $('#ofA', m).value, method: $('#ofM', m).value, ref: $('#ofR', m).value, note: $('#ofN', m).value }); m.close(); toast('Recorded. Waiting for a second admin.'); P.finance(); } catch (z) { $('#ofE', m).textContent = z.message; } }; };
    H.ovr = async b => { const r = await ask('Manual payment override', { placeholder: 'Why the gateway result is wrong, with evidence', text: 'This marks the payment verified only after a second admin confirms.', ok: 'Request override' }); if (!r) return; try { await API.overridePayment(b.dataset.id, r); toast('Override requested. A second admin must confirm.'); P.finance(); } catch (e) { fail(e); } };
    H.ok2 = async b => { if (!await confirmBox('Confirm as second admin', 'You confirm you checked the evidence. This is audited under your name.', 'Confirm')) return; try { await API.secondAdmin(b.dataset.id, true); toast('Confirmed.'); P.finance(); } catch (e) { fail(e); } };
    H.no2 = async b => { const r = await ask('Reject', { ok: 'Reject', danger: true }); if (!r) return; try { await API.secondAdmin(b.dataset.id, false, r); toast('Rejected.'); P.finance(); } catch (e) { fail(e); } };
    if (location.hash.endsWith('#second')) setTimeout(() => $('#second')?.scrollIntoView({ behavior: 'smooth' }), 60);
  });

  /* ======================= 8. ASSESSMENTS ======================= */
  P.assessments = () => page([['Assessments']], async () => {
    const f = {}; let d = await API.assessments(f);
    const render = async () => { d = await API.assessments(f);
      $('#asRows').innerHTML = d.rows.length ? tbl(['Title', 'Type', 'Course / batch', 'Opens', 'Due', 'State', 'Questions', 'Submitted', 'Graded', 'Average'], d.rows.map(r => [`<b>${esc(r.title)}</b><br><span class="mono note">${r.id}</span>`, esc(r.type), `${esc(r.course)}<br><small class="note">${esc(r.batch)}</small>`, fDT(r.open), fDT(r.due), st(r.state), r.questions, r.submitted, r.graded, r.avg == null ? '–' : r.avg])) : empty('No assessments match'); };
    view.innerHTML = `<div class="card-h"><h1>Assessments</h1><div class="r">${d.canEdit ? '<button class="btn btn-primary" data-act="newA">Create assessment</button>' : chip('View only for your role', 'a')}</div></div>
      <div class="card toolbar"><label style="flex:2;min-width:180px">Search<input data-inp="q" placeholder="Title"></label><label>Type<select data-chg="type"><option value="">All</option><option>Quiz</option><option>Assignment</option><option>Exam</option></select></label>
        <label>State<select data-chg="state"><option value="">All</option><option>Draft</option><option>Scheduled</option><option>Active</option><option>Completed</option></select></label><label>Course<select data-chg="course"><option value="">All</option>${d.courses.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join('')}</select></label></div>
      <div id="asRows"></div>
      ${d.canEdit ? `<section class="card" style="margin-top:1rem"><div class="card-h"><h2>Question bank</h2><div class="r"><button class="btn btn-sm" data-act="addQ">Add question</button></div></div>${tbl(['ID', 'Topic', 'Question'], d.bank.map(q => [`<span class="mono">${q.id}</span>`, esc(q.topic), esc(q.text)]))}<p class="note" style="margin-top:.5rem">Correct answers and answer keys stay on the server and are never sent to this page.</p></section>` : ''}`;
    let tm; H.q = el => { clearTimeout(tm); tm = setTimeout(() => { f.q = el.value; render(); }, 200); };
    ['type', 'state', 'course'].forEach(k => H[k] = el => { f[k] = el.value; render(); });
    H.addQ = async () => { const m = modal('Add question', `<form class="form" id="aqF"><label>Topic<input id="aqT"></label><label>Question<textarea id="aqQ"></textarea></label><label>Answer key<input id="aqK" placeholder="Sent to the server only"></label><p class="err" id="aqE"></p></form>`, { foot: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="aqF" type="submit">Add</button>' });
      $('#aqF', m).onsubmit = async e => { e.preventDefault(); try { await API.addQuestion($('#aqT', m).value, $('#aqQ', m).value); m.close(); toast('Question added. The answer key is stored on the server.'); P.assessments(); } catch (x) { $('#aqE', m).textContent = x.message; } }; };
    H.newA = () => { const t0 = new Date(Date.now() + DAY); const loc = t => { const x = new Date(t); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
      const m = modal('Create assessment', `<form class="form" id="naF"><label>Title<input id="naT"></label><div class="row3"><label>Type<select id="naY"><option>Quiz</option><option>Assignment</option><option>Exam</option></select></label><label>Course<select id="naC">${d.courses.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join('')}</select></label><label>Batch<select id="naB">${d.batches.map(b => `<option>${b}</option>`).join('')}</select></label></div>
        <div class="row2"><label>Opens<input id="naO" type="datetime-local" value="${loc(t0)}"></label><label>Due<input id="naD" type="datetime-local" value="${loc(+t0 + 3 * DAY)}"></label></div>
        <fieldset class="card"><legend>Questions</legend>${d.bank.map(q => `<label class="chk"><input type="checkbox" class="naQ" value="${q.id}"> <span class="mono">${q.id}</span> ${esc(q.text)}</label>`).join('')}</fieldset><label class="chk"><input type="checkbox" id="naDr"> Save as draft</label><p class="err" id="naE" role="alert"></p></form>`, { wide: true, foot: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="naF" type="submit">Create</button>' });
      $('#naF', m).onsubmit = async e => { e.preventDefault(); try { await API.saveAssessment({ title: $('#naT', m).value, type: $('#naY', m).value, courseId: $('#naC', m).value, batch: $('#naB', m).value, open: $('#naO', m).value, due: $('#naD', m).value, questions: $$('.naQ:checked', m).map(x => x.value), draft: $('#naDr', m).checked }); m.close(); toast('Assessment created.'); P.assessments(); } catch (x) { $('#naE', m).textContent = x.message; } }; };
    await render();
  });

  /* ======================= 9. ANALYTICS ======================= */
  P.analytics = () => page([['Analytics']], async () => {
    const d = await API.analytics();
    view.innerHTML = `<div class="card-h"><div><h1>Analytics</h1><p class="note">Source: ${esc(d.source)} · updated ${fDT(d.updated)}</p></div><div class="r toolbar"><button class="btn btn-sm" data-act="ex" data-k="users">Export summary CSV</button>${d.finance ? '<button class="btn btn-sm" data-act="ex" data-k="finance">Export finance CSV</button>' : ''}</div></div>
      <div class="grid g4"><div class="stat cyan"><b>${d.users.total}</b><span>Users</span></div><div class="stat blue"><b>${d.users.free}</b><span>Free</span></div><div class="stat green"><b>${d.users.paid}</b><span>Paid</span></div><div class="stat"><b>${d.activity.activeWeek}</b><span>Active this week</span><small>${d.activity.idle} idle 7+ days</small></div></div>
      <div class="dash" style="margin-top:1rem">
        <section class="card s6"><h2>Learning paths</h2>${bars(d.byPath.map(x => ({ label: x.label, v: x.n, unit: '', w: x.n / Math.max(1, d.users.total) * 100 })))}</section>
        ${d.bands ? `<section class="card s6"><h2>Performance bands</h2>${bars(d.bands.map(x => ({ label: x.label, v: x.n, unit: '', w: x.n / Math.max(1, d.users.total) * 100, c: x.label === 'At risk' ? 'red' : x.label === 'Needs attention' ? 'amber' : '' })))}</section>` : ''}
        ${d.cohorts ? `<section class="card s12"><h2>Cohort comparison</h2>${tbl(['Batch', 'Students', 'Attendance', 'Index', 'Labs avg'], d.cohorts.map(c => [esc(c.batch), c.n, pbar(c.att), `<b>${c.pi}</b>`, c.labs + ' of 15']))}</section>` : ''}
        <section class="card s6"><h2>Assessment activity</h2>${bars(d.assessments.map(a => ({ label: a.title, v: a.subs, unit: ' sub', w: a.subs * 10 })))}</section>
        ${d.finance ? `<section class="card s6"><h2>Payments and dues</h2><dl class="kv2"><dt>Collected</dt><dd>${rs(d.finance.collected)}</dd><dt>Outstanding</dt><dd>${rs(d.finance.outstanding)}</dd><dt>Overdue students</dt><dd>${d.finance.overdue}</dd></dl></section>` : ''}
      </div><p class="note" style="margin-top:1rem">Analytics never show passwords, OTPs, card data, UPI PINs, lab flags, assessment answers or private messages. Exports follow your role and are audited.</p>
      ${gap('An analytics service with history (trends over months). Figures here are computed live from the demo record, so there is no history yet.')}`;
    H.ex = async b => { try { await API.exportAnalytics(b.dataset.k); if (b.dataset.k === 'finance') csv('finance-summary.csv', [['Collected', 'Outstanding', 'Overdue'], [d.finance.collected, d.finance.outstanding, d.finance.overdue]]);
      else csv('yojo-summary.csv', [['Metric', 'Value'], ['Users', d.users.total], ['Free', d.users.free], ['Paid', d.users.paid], ...d.byPath.map(x => ['Path ' + x.label, x.n]), ...(d.cohorts || []).map(c => ['Cohort ' + c.batch + ' attendance', c.att])]); toast('Export downloaded and audited.'); } catch (e) { fail(e); } };
  });

  /* ======================= 10. NOTIFICATIONS ======================= */
  P.notifications = () => page([['Notifications']], async () => {
    const d = await API.notifications(); const y = new Date();
    const kinds = d.canBroadcast ? ['Individual', 'All students', 'Batch', 'Course', 'Institution'] : ['Individual'];
    const monthCal = () => { const first = new Date(y.getFullYear(), y.getMonth(), 1), days = new Date(y.getFullYear(), y.getMonth() + 1, 0).getDate(), pad = (first.getDay() + 6) % 7;
      return `<div class="cal" aria-label="Holiday calendar for ${y.toLocaleString('en-IN', { month: 'long' })}">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => `<div class="x note">${x}</div>`).join('')}${'<div class="x"></div>'.repeat(pad)}${Array.from({ length: days }, (_, i) => { const ds = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`; const h = d.holidays.find(x => x.date === ds); return `<div class="${h ? (h.kind === 'Holiday' ? 'h' : 'f') : ''}"><b>${i + 1}</b>${h ? `<br><small>${esc(h.name)}</small>` : ''}</div>`; }).join('')}</div>`; };
    view.innerHTML = `<div class="card-h"><h1>Notifications</h1></div>
      <div class="dash"><form class="card s7 form" data-sub="send" novalidate><h2>${d.canBroadcast ? 'Compose a message or broadcast' : 'Send an individual message'}</h2>
        <div class="row2"><label>Audience<select id="nAud" data-chg="aud">${kinds.map(k => `<option>${k}</option>`).join('')}</select></label><label id="nValW">Student<select id="nVal"></select></label></div>
        <label>Type<select id="nType">${(d.canBroadcast ? ['Announcement', 'Festival wish', 'Birthday wish', 'Holiday notice', 'Dues reminder', 'Custom'] : ['Custom', 'Dues reminder', 'Announcement']).map(x => `<option>${x}</option>`).join('')}</select></label>
        <label>Title<input id="nTitle" maxlength="90"></label><label>Message (use {first_name})<textarea id="nBody" rows="4"></textarea></label>
        <div class="row2"><fieldset class="card"><legend>Delivery</legend><label class="chk"><input type="checkbox" checked disabled> In-app bell (always)</label><label class="chk"><input type="checkbox" class="nCh" value="Email"> Email</label><label class="chk"><input type="checkbox" class="nCh" value="WhatsApp"> WhatsApp</label><label class="chk"><input type="checkbox" id="nImp"> Mark as Important</label><label class="chk"><input type="checkbox" id="nCal"> Add to LMS calendar</label></fieldset>
          <label>Send at (leave empty for now)<input type="datetime-local" id="nWhen"></label></div>
        <p class="note" id="nCount">Recipients: 1</p><div class="toolbar"><button class="btn" type="button" data-act="prev">Preview as student</button><button class="btn btn-primary" type="submit">Send</button></div><p class="err" id="nErr" role="alert"></p>
        <p class="note">Broadcasts to ${d.threshold} or more students need a second admin [provisional]. Messages cannot contain card data, other students' scores or internal notes. Every send is audited.</p></form>
        <aside class="s5" style="display:grid;gap:1rem;align-content:start"><section class="card"><h2>Holiday calendar</h2>${monthCal()}<div class="legend"><span style="--c:rgba(96,165,250,.6)">Holiday (no class)</span><span style="--c:rgba(196,181,253,.6)">Festival</span></div>
          ${d.canBroadcast ? '<button class="btn btn-sm" data-act="addH" style="margin-top:.6rem">Add holiday or festival</button>' : ''}<p class="note" style="margin-top:.5rem">Today's birthdays: ${d.birthdaysToday.length ? esc(d.birthdaysToday.join(', ')) : 'none'}. Wishes go out only by a configured rule or an admin's action.</p></section>
          <section class="card"><h2>Wish templates</h2><form class="form" data-sub="tpl"><label>Birthday<textarea id="tB" ${d.canBroadcast ? '' : 'disabled'}>${esc(d.templates.birthday)}</textarea></label><label>Festival<textarea id="tF" ${d.canBroadcast ? '' : 'disabled'}>${esc(d.templates.festival)}</textarea></label>${d.canBroadcast ? '<button class="btn btn-sm" type="submit">Save templates</button>' : ''}</form></section>
          ${gap('Email and WhatsApp delivery. In the demo every message reaches the student bell only.')}</aside></div>
      <section class="card" style="margin-top:1rem"><h2>Delivery log</h2>${d.log.length ? tbl(['Sent', 'Title', 'Audience', 'Type', 'Channels', 'Delivered', 'Read', 'Status', ''], d.log.map(n => [fDT(n.at), esc(n.title), esc(n.audience), esc(n.type), esc(n.channels.join(', ')), `${n.delivered} / ${n.count}`, `${n.read} / ${n.count}`, st(n.status) + `<br><small class="note">${esc(n.by)}</small>`,
        n.status === 'Awaiting second admin' && d.canBroadcast && n.byEmail !== ME.email ? `<button class="btn btn-xs btn-primary" data-act="bcOk" data-id="${n.id}">Approve as second admin</button>` : n.status === 'Sent' || n.status === 'Scheduled' ? `<button class="btn btn-xs" data-act="recall" data-id="${n.id}">Recall unread</button>` : ''])) : empty('Nothing sent yet')}</section>`;
    const fillVal = async () => { const k = $('#nAud').value, sel = $('#nVal'), w = $('#nValW');
      w.hidden = k === 'All students'; w.firstChild.textContent = k === 'Individual' ? 'Student' : k;
      sel.innerHTML = k === 'Individual' ? d.students.map(s => `<option value="${s.id}">${esc(s.name)} (${s.batch})</option>`).join('') : k === 'Batch' ? d.batches.map(b => `<option>${b}</option>`).join('') : k === 'Course' ? (await API.courses().catch(() => [])).map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join('') || '<option value="C-SOC">SOC Analyst</option>' : k === 'Institution' ? ['ABC Institute of Tech', 'Yojo Solutions', 'Vizag College of Engineering', 'GITAM University'].map(x => `<option>${x}</option>`).join('') : '';
      count(); };
    const aud = () => ({ kind: $('#nAud').value, value: $('#nVal').value });
    const count = async () => { const n = await API.audienceSize(aud()); if ($('#nCount')) $('#nCount').textContent = `Recipients: ${n}${n >= d.threshold && aud().kind !== 'Individual' ? ' (needs a second admin)' : ''}`; };
    H.aud = fillVal; $('#nVal').addEventListener('change', count); await fillVal();
    H.prev = () => modal('Preview as student', `<div class="notif"><i class="${$('#nImp').checked ? 'amber' : 'blue'}"></i><span><b>${esc($('#nTitle').value || 'Title')}</b><br>${esc(($('#nBody').value || 'Message').replace(/\{first_name\}/g, 'Riya'))}<br><small class="note">From Yojo Admin · now</small></span></div>`);
    H.send = async () => { const n = await API.audienceSize(aud()); if (n > 1 && !await confirmBox('Send broadcast', `Send "${esc($('#nTitle').value)}" to ${n} students?`, 'Send')) return;
      try { const r = await API.send({ aud: aud(), type: $('#nType').value, title: $('#nTitle').value, body: $('#nBody').value, channels: $$('.nCh:checked').map(x => x.value), important: $('#nImp').checked, calendar: $('#nCal').checked, when: $('#nWhen').value });
        toast(r === 'Sent' ? 'Sent. It is in the students’ bell now.' : r === 'Scheduled' ? 'Scheduled.' : 'Waiting for a second admin to approve.'); P.notifications(); } catch (e) { $('#nErr').textContent = e.message; } };
    H.tpl = async () => { try { await API.saveTemplates({ birthday: $('#tB').value, festival: $('#tF').value }); toast('Templates saved.'); } catch (e) { fail(e); } };
    H.addH = () => { const m = modal('Add to holiday calendar', `<form class="form" id="hF"><label>Date<input type="date" id="hD"></label><label>Name<input id="hN"></label><label>Kind<select id="hK"><option>Holiday</option><option>Festival</option></select></label><p class="err" id="hE"></p></form>`, { foot: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="hF" type="submit">Add</button>' });
      $('#hF', m).onsubmit = async e => { e.preventDefault(); try { await API.addHoliday({ date: $('#hD', m).value, name: $('#hN', m).value, kind: $('#hK', m).value }); m.close(); toast('Added.'); P.notifications(); } catch (x) { $('#hE', m).textContent = x.message; } }; };
    H.bcOk = async b => { if (!await confirmBox('Approve broadcast', 'You approve this broadcast as the second admin.', 'Approve and send')) return; try { await API.approveBroadcast(b.dataset.id); toast('Broadcast sent.'); P.notifications(); } catch (e) { fail(e); } };
    H.recall = async b => { if (!await confirmBox('Recall message', 'Removes the message from students who have not read it yet.', 'Recall', true)) return; try { await API.recall(b.dataset.id); toast('Recalled where unread.'); P.notifications(); } catch (e) { fail(e); } };
  });

  /* ======================= 11. STUDENT REPORTS ======================= */
  const sha256 = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const repHtml = r => `<div class="rep print-me"><div class="hd"><div><b>YOJO SOLUTIONS · STUDENT REPORT</b><br><small>Cyber Security &amp; IT Consulting · Confidential: organisation record</small></div><div style="text-align:right"><small>Report <b>${esc(r.id || 'Preview (not saved)')}</b> · v${r.version || 1}<br>${esc(r.copy || '')}<br>Period ${esc(r.period || '')}<br>${r.at ? 'Generated ' + fDT(r.at) + ' by ' + esc(r.by) : ''}</small></div></div>
    <h3>${esc(r.snapshot.student.name)} · <span class="mono">${esc(r.snapshot.student.id)}</span></h3><p>${esc(r.snapshot.student.batch)} · ${esc(r.snapshot.student.course || '')} · ${esc(r.snapshot.student.path)}</p>
    ${Object.entries(r.snapshot.sections).map(([k, v], i) => `<h3>${i + 1}. ${esc(k.toUpperCase())}</h3><dl class="kv2">${Object.entries(v).map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}</dl>`).join('')}
    ${r.hash ? `<p style="margin-top:1rem;font-size:.8rem">SHA-256 <span class="mono">${esc(r.hash)}</span> · Immutable snapshot. Corrections create a new version.</p>` : ''}</div>`;
  P.reports = (_, __, qs) => page([['Student Reports']], async () => {
    const studs = (await API.students({}).catch(() => [])); const archive = API.can('reportArchive') !== '-' ? await API.reports() : null; const allowed = { platform: API.REPORT_SECTIONS, payment: ['Financial details and dues'], content: ['Attendance', 'Performance'], support: ['Profile and guardian', 'Attendance'] }[ROLE];
    const pre = qs.get('sid') || ''; let last = null, base = null;
    view.innerHTML = `<div class="card-h"><h1>Student Reports</h1></div>
      <div class="dash"><form class="card s5 form" data-sub="gen" novalidate><h2>Report builder</h2><label>Student<select id="rS">${studs.map(s => `<option value="${s.id}" ${s.id === pre ? 'selected' : ''}>${esc(s.name)} (${s.id})</option>`).join('')}</select></label>
        <div class="row2"><label>From<input type="date" id="rF" value="${iso(Date.now() - 30 * DAY)}"></label><label>To<input type="date" id="rT" value="${iso(Date.now())}"></label></div>
        <label>Purpose<select id="rP"><option>Parent meeting</option><option>Dues review</option><option>Mentor review</option><option>Placement review</option></select></label>
        <fieldset class="card"><legend>Sections to include</legend>${API.REPORT_SECTIONS.map(x => `<label class="chk"><input type="checkbox" class="rSec" value="${x}" ${allowed.includes(x) ? 'checked' : 'disabled'}> ${x}${allowed.includes(x) ? '' : ' <small class="note">(not for your role)</small>'}${x === 'Internal admin notes' ? ' <small class="note">(organisation copy only)</small>' : ''}</label>`).join('')}</fieldset>
        <label>Copy<select id="rC"><option>Organisation copy (full)</option><option>Parent-meeting print</option></select></label>
        <div class="toolbar"><button class="btn" type="button" data-act="prevR">Preview</button><button class="btn btn-primary" type="submit">Generate and save to records</button></div><p class="err" id="rE" role="alert"></p>
        <p class="note">Reports are never sent to guardians automatically. A link or email goes out only on a written request from the guardian. Every generate, view and download is audited.</p></form>
        <section class="card s7"><div class="card-h"><h2>Report</h2><div class="r toolbar" id="rActs"></div></div><div id="rOut"><p class="note">Pick a student and press Preview or Generate.</p></div></section></div>
      ${archive ? `<section class="card" style="margin-top:1rem"><div class="card-h"><h2>Report archive</h2><div class="r"><input data-inp="af" placeholder="Filter by student, purpose or ID" aria-label="Filter archive"></div></div><div id="arch"></div></section>` : '<p class="note" style="margin-top:1rem">The organisation archive is for Platform and Payment admins.</p>'}`;
    const form = () => ({ from: $('#rF').value, to: $('#rT').value, purpose: $('#rP').value, copy: $('#rC').value, sections: $$('.rSec:checked').map(x => x.value) });
    const acts = r => { $('#rActs').innerHTML = r.id ? `<button class="btn btn-sm" data-act="pdf">Download PDF</button><button class="btn btn-sm" data-act="print">Print</button><button class="btn btn-sm" data-act="vh">Verify hash</button>${archive ? '<button class="btn btn-sm" data-act="nv">Create new version</button>' : ''}` : ''; };
    const show = r => { last = r; $('#rOut').innerHTML = repHtml(r); acts(r); };
    const renderArch = (q = '') => { if (!archive) return; const rows = archive.filter(r => (r.id + r.name + r.purpose).toLowerCase().includes(q.toLowerCase()));
      $('#arch').innerHTML = rows.length ? tbl(['Report ID', 'Student', 'Period', 'Purpose', 'Copy', 'Generated by', 'Version', ''], rows.map(r => [`<span class="mono">${esc(r.id)}</span>`, esc(r.name), esc(r.period), esc(r.purpose), esc(r.copy), `${esc(r.by)}<br><small class="note">${fDT(r.at)}</small>`, 'v' + r.version, `<button class="btn btn-xs" data-act="openR" data-id="${esc(r.id)}">Open</button>`])) : empty('No saved reports yet', 'Generated reports are kept here as frozen snapshots.'); };
    renderArch(); H.af = el => renderArch(el.value);
    H.prevR = async () => { try { const snap = await API.reportData($('#rS').value, form()); const f = form(); show({ snapshot: snap, copy: f.copy, period: `${f.from} to ${f.to}` }); } catch (e) { if (e.code === 428) { const r = await ask('Reason to view this student', { placeholder: 'e.g. Parent meeting booked for Friday' }); if (r) { await API.statePurpose($('#rS').value, r); H.prevR(); } } else ($('#rE') || {}).textContent = e.message; } };
    H.gen = async () => { ($('#rE') || {}).textContent = ''; const f = form(); if (!await confirmBox('Generate report', 'This saves a frozen, signed snapshot to the organisation records. It cannot be edited or deleted later.', 'Generate and save')) return;
      try { const sid = $('#rS').value, snap = await API.reportData(sid, f); const hash = await sha256(JSON.stringify(snap)); if (base) f.baseId = base; const id = await API.saveReport(sid, f, snap, hash); base = null; toast('Report saved: ' + id);
        const r = archive ? await API.report(id) : { id, version: 1, snapshot: snap, hash, at: Date.now(), by: ME.name, copy: f.copy, period: `${f.from} to ${f.to}` }; show(r); if (archive) { archive.unshift(r); renderArch(); } } catch (e) { if (e.code === 428) { const r = await ask('Reason to view this student', { placeholder: 'e.g. Parent meeting booked for Friday' }); if (r) { await API.statePurpose($('#rS').value, r); H.gen(); } } else ($('#rE') || {}).textContent = e.message; } };
    H.openR = async b => { try { show(await API.report(b.dataset.id)); $('#rOut').scrollIntoView({ behavior: 'smooth' }); } catch (e) { fail(e); } };
    H.vh = async () => { const h = await sha256(JSON.stringify(last.snapshot)); const ok = h === last.hash; await API.logReportUse(last.id, 'verified hash of'); modal('Verify hash', `<p>${ok ? chip('Genuine', 'g') : chip('Does not match', 'r')}</p><p class="note">Stored: <span class="mono">${esc(last.hash)}</span><br>Computed now: <span class="mono">${esc(h)}</span></p>`); };
    const printIt = async what => { await API.logReportUse(last.id, what); const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print or save as PDF.', true);
      w.document.write(`<!doctype html><title>${esc(last.id)}</title><style>body{font:14px/1.5 Inter,Arial,sans-serif;color:#111;margin:2rem}.kv2{display:grid;grid-template-columns:200px 1fr;gap:.3rem 1rem}dt{color:#555}dd{margin:0}h3{border-bottom:1px solid #ccc;margin:1rem 0 .3rem}.hd{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:.5rem}.mono{font-family:monospace;word-break:break-all}</style>${repHtml(last)}<script>print()<\/script>`); w.document.close(); };
    H.pdf = () => printIt('downloaded'); H.print = () => printIt('printed');
    H.nv = () => { base = last.id; $('#rS').value = last.sid || last.snapshot.student.id; toast('Adjust the builder and press Generate: it saves as the next version. The old version stays unchanged.'); $('#rS').focus(); };
  });

  /* ======================= 12. CERTIFICATES ======================= */
  P.certificates = () => page([['Certificates']], async () => {
    const c = await API.certificates();
    view.innerHTML = `<div class="card-h"><h1>Certificates</h1></div>
      <div class="dash"><section class="card s8">${tbl(['Student', 'Course', 'Completion', 'Assessments', 'Status', 'Certificate ID', ''], c.map((x, i) => [esc(x.name), esc(x.course), pbar(x.completion), esc(x.assess), st(x.status) + (x.reason ? `<br><small class="note">${esc(x.reason)}</small>` : '') + (x.issuedAt ? `<br><small class="note">Issued ${fD(x.issuedAt)}</small>` : ''), x.id ? `<span class="mono">${esc(x.id)}</span>` : '–',
          x.status === 'Eligible' ? `<button class="btn btn-xs btn-primary" data-act="iss" data-i="${i}">Issue</button>` : x.status === 'Issued' ? `<button class="btn btn-xs btn-danger" data-act="rev" data-i="${i}">Revoke</button>` : '']))}
        <p class="note" style="margin-top:.5rem">A certificate is issued only when the course is 100% complete and its assessments are passed. Paying alone never qualifies.</p></section>
        <form class="card s4 form" data-sub="ver"><h2>Verify a certificate</h2><label>Certificate ID<input id="vId" class="mono" placeholder="YJ-CERT-2026-0091"></label><button class="btn btn-primary" type="submit">Verify</button><div id="vOut"></div></form></div>`;
    H.iss = async b => { if (!await confirmBox('Issue certificate', 'The student is notified and the certificate can be verified publicly by its ID.', 'Issue')) return; try { const id = await API.issueCert(+b.dataset.i); toast('Issued ' + id); P.certificates(); } catch (e) { fail(e); } };
    H.rev = async b => { const r = await ask('Revoke certificate', { placeholder: 'Reason (shown on verification)', ok: 'Revoke', danger: true }); if (!r) return; try { await API.revokeCert(+b.dataset.i, r); toast('Revoked.'); P.certificates(); } catch (e) { fail(e); } };
    H.ver = async () => { const r = await API.verifyCert($('#vId').value); $('#vOut').innerHTML = r.found ? `<p>${st(r.status)} ${esc(r.name)} · ${esc(r.course)}${r.issuedAt ? ' · issued ' + fD(r.issuedAt) : ''}${r.reason ? `<br><small class="note">${esc(r.reason)}</small>` : ''}</p>` : '<p style="color:var(--red)">No certificate with that ID.</p>'; };
  });

  /* ======================= 13. SYSTEM SETTINGS ======================= */
  const SET_DESC = { plans: ['Plans and subscription', 'Plan names and prices shown at checkout. Prices are provisional until the owner sets them.'], xp: ['XP rules', 'XP a student earns for each action.'], ai: ['AI support limits', 'Daily questions the help bot answers per person.'], promos: ['Promotions', 'Launch offer and promo code.'], maintenance: ['Maintenance mode', 'Shows a notice and pauses student logins.'], policy: ['Rules and thresholds', 'Required attendance, Performance Index weights (must add to 100), broadcast approval threshold and the approval target. All provisional.'] };
  P.settings = () => page([['System Settings']], async () => {
    const s = await API.settings();
    const field = (sec, k, v) => typeof v === 'boolean' ? `<label class="chk"><input type="checkbox" data-s="${sec}" data-k="${k}" ${v ? 'checked' : ''}> ${esc(k)}</label>` : `<label>${esc(k)}<input data-s="${sec}" data-k="${k}" value="${esc(v)}" ${typeof v === 'number' ? 'type="number" min="0"' : ''}></label>`;
    view.innerHTML = `<div class="card-h"><h1>System Settings</h1></div>
      <div class="grid g2">${Object.keys(SET_DESC).filter(k => s.allowed.includes(k) || ROLE === 'platform').map(sec => { const ok = s.allowed.includes(sec); return `<form class="card form" data-sub="sv" data-sec="${sec}"><h2>${SET_DESC[sec][0]} ${/PROVISIONAL|provisional/.test(SET_DESC[sec][1] + JSON.stringify(s.values[sec])) ? chip('Provisional', 'a') : ''}</h2><p class="note">${SET_DESC[sec][1]}</p>
        <fieldset ${ok ? '' : 'disabled'} style="border:0;padding:0;margin:0;display:grid;gap:.6rem">${Object.entries(s.values[sec]).map(([k, v]) => field(sec, k, v)).join('')}</fieldset>${ok ? '<button class="btn btn-primary" type="submit">Save</button>' : '<p class="note">View only for your role.</p>'}</form>`; }).join('')}</div>
      <section class="card" style="margin-top:1rem"><h2>Change history</h2>${s.log.length ? tbl(['When', 'By', 'Section', 'Changes'], s.log.map(l => [fDT(l.at), esc(l.by), esc(l.section), esc(l.changes.join('; '))])) : empty('No changes yet')}</section>`;
    H.sv = async f => { const sec = f.dataset.sec, vals = {}; $$(`[data-s="${sec}"]`, f).forEach(i => { vals[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? Number(i.value) : i.value; });
      if (!await confirmBox('Save settings', `Save changes to ${SET_DESC[sec][0]}? This affects the live platform and is audited.`, 'Save')) return;
      try { const ch = await API.saveSettings(sec, vals); toast('Saved: ' + ch.join('; ')); P.settings(); } catch (e) { fail(e); } };
  });

  /* ======================= ENQUIRIES (Mentorship, Internship, Contact) ======================= */
  P.enquiries = () => page([['Enquiries']], async () => {
    const rows = await API.enquiries(); let q = '', ty = '', stF = '';
    const TY = { mentor: 'Mentorship', intern: 'Internship', contact: 'Contact Us', course: 'Course enrolment' };
    const fD = t => { const d = new Date(t); return isNaN(d) ? esc(t || '') : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
    const render = () => { const xs = rows.filter(r => (!ty || r.type === ty) && (!stF || r.status === stF) && (!q || (r.name + r.email + r.phone + r.interest + r.message + r.id).toLowerCase().includes(q)));
      $('#eList').innerHTML = `<p class="note" style="margin:.4rem 0">${xs.length} of ${rows.length} enquiries</p>` + (xs.length ? tbl(['Name', 'Form', 'Contact', 'Interested in', 'Details', 'Received', 'Status', ''], xs.map(r => [`<b>${esc(r.name)}</b><br><span class="mono note">${esc(r.id)}</span>`, chip(TY[r.type] || r.type, r.type === 'intern' ? 'g' : r.type === 'mentor' ? 'b' : ''), `${esc(r.email || '')}<br><small class="note">${esc(r.phone || '')}</small>`, esc(r.interest || ''), (r.when ? `Preferred: ${fD(r.when)}<br>` : '') + `<small class="note">${esc(r.message || '')}</small>`, fD(r.at), chip(r.status || 'New', r.status === 'Closed' ? '' : r.status === 'Contacted' ? 'g' : 'b'),
        API.can('enquiries') === 'Y' ? `<button class="btn btn-xs" data-act="st" data-s="Contacted" data-id="${esc(r.id)}" ${r.status === 'Contacted' ? 'disabled' : ''}>Contacted</button> <button class="btn btn-xs" data-act="st" data-s="Closed" data-id="${esc(r.id)}" ${r.status === 'Closed' ? 'disabled' : ''}>Close</button>` : ''])) : empty(rows.length ? 'No enquiries match' : 'No enquiries yet', rows.length ? '' : ' Submissions from the Mentorship, Internship and Contact Us forms appear here.')); };
    const n = t => rows.filter(r => r.type === t).length;
    view.innerHTML = `<div class="card-h"><h1>Enquiries</h1><div class="r"><button class="btn" data-act="exp" ${rows.length ? '' : 'disabled'}>Export CSV</button></div></div>
      <div class="grid g4"><div class="stat blue"><b>${rows.length}</b><span>Total</span><small>${rows.filter(r => r.status === 'New').length} new</small></div><div class="stat"><b>${n('mentor')}</b><span>Mentorship</span></div><div class="stat green"><b>${n('intern')}</b><span>Internship</span></div><div class="stat"><b>${n('contact')}</b><span>Contact Us</span></div></div>
      <div class="card toolbar" style="margin-top:1rem"><label style="flex:2;min-width:200px">Search<input data-inp="q" placeholder="Name, email, phone or ID"></label><label>Form<select data-chg="ty"><option value="">All</option><option value="mentor">Mentorship</option><option value="intern">Internship</option><option value="contact">Contact Us</option><option value="course">Course enrolment</option></select></label><label>Status<select data-chg="sf"><option value="">All</option><option>New</option><option>Contacted</option><option>Closed</option></select></label></div><div id="eList"></div>
      ${gap("A real backend stores enquiries and notifies the team. Here they are kept in this browser.")}`;
    H.q = b => { q = b.value.trim().toLowerCase(); render(); }; H.ty = b => { ty = b.value; render(); }; H.sf = b => { stF = b.value; render(); };
    H.st = async b => { try { await API.enquiryStatus(b.dataset.id, b.dataset.s); toast('Marked ' + b.dataset.s.toLowerCase() + '.'); route(); } catch (e) { fail(e); } };
    H.exp = () => csv('enquiries.csv', [['ID', 'Form', 'Name', 'Email', 'Phone', 'Interested in', 'Preferred time', 'Message', 'Received', 'Status']].concat(rows.map(r => [r.id, TY[r.type] || r.type, r.name, r.email, r.phone, r.interest, r.when, r.message, r.at, r.status])));
    render();
  });

  /* Enquiries with the Yojo API (admin-live.js signed the admin in): the server inbox for every website form.
     Filters, search and paging run on the server; status moves are checked there (the buttons only offer allowed ones). */
  if (LIVE && LIVE.user) P.enquiries = () => page([['Enquiries']], async () => {
    const api = window.YojoAPI;
    const ST = { new: ['New', 'b'], reviewing: ['Reviewing', 'b'], assigned: ['Assigned', 'b'], in_progress: ['In progress', 'a'], waiting_for_user: ['Waiting for visitor', 'a'], resolved: ['Resolved', 'g'], closed: ['Closed', ''], rejected: ['Rejected', 'r'] };
    const FORMS = { contact: 'Contact Us', mentorship_session: 'Mentorship', internship_application: 'Internship', course_enrolment: 'Course enrolment' };
    const stc = s => chip(ST[s] ? ST[s][0] : s, ST[s] ? ST[s][1] : '');
    const f = { q: '', type: '', status: 'open', assignee: '', from: '', to: '' }; let cursors = [null], pg = 0, tm;
    const qs = extra => new URLSearchParams(Object.fromEntries(Object.entries({ ...f, ...extra }).filter(([, v]) => v))).toString();
    const [m, admins] = await Promise.all([api.get('/admin/submissions/metrics'), api.admin.users({ view: 'admins', limit: 100 }).then(r => r.items, () => [])]);
    view.innerHTML = `<div class="card-h"><h1>Enquiries</h1><div class="r"><button class="btn" data-act="exp">Export CSV</button></div></div>
      <div class="grid g4"><div class="stat blue"><b>${m.open}</b><span>Open</span><small>${m.byStatus.new || 0} new</small></div><div class="stat"><b>${m.unassigned}</b><span>Unassigned</span><small>open, no owner</small></div><div class="stat ${m.overdue ? 'red' : 'green'}"><b>${m.overdue}</b><span>Overdue</span><small>no reply after 24 h</small></div><div class="stat cyan"><b>${m.averageResolutionHours == null ? '–' : m.averageResolutionHours + ' h'}</b><span>Avg. resolution</span><small>${m.resolvedCount} resolved · ${m.total} total</small></div></div>
      <div class="card toolbar" style="margin-top:1rem"><label style="flex:2;min-width:200px">Search<input data-inp="q" placeholder="ENQ-1001, name, email or phone"></label>
        <label>Form<select data-chg="type"><option value="">All</option>${Object.entries(FORMS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label>Status<select data-chg="status"><option value="open" selected>Open</option><option value="">All</option>${Object.entries(ST).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select></label>
        <label>Owner<select data-chg="assignee"><option value="">Anyone</option><option value="me">Me</option><option value="none">Unassigned</option></select></label>
        <label>From<input type="date" data-chg="from"></label><label>To<input type="date" data-chg="to"></label></div><div id="eList"></div>`;
    const load = async () => {
      $('#eList').innerHTML = '<p class="note">Loading…</p>';
      try {
        const r = await api.get('/admin/submissions?' + qs({ limit: pageSize, cursor: cursors[pg] || '' }));
        cursors[pg + 1] = r.nextCursor;
        $('#eList').innerHTML = `<p class="note" style="margin:.4rem 0">${r.total} enquiries</p>` + (r.items.length ? tbl(['Enquiry', 'Form', 'Contact', 'Received', 'Status', 'Owner', ''], r.items.map(x => [
          `<b>${esc(x.name)}</b><br><span class="mono note">${esc(x.reference)}</span>`, `${chip(x.typeLabel, x.type === 'internship_application' ? 'g' : x.type === 'mentorship_session' ? 'b' : '')}<br><small class="note">${esc(x.topic || '')}</small>`,
          `${esc(x.email || '')}<br><small class="note">${esc(x.phone || '')}</small>`, fDT(x.createdAt), stc(x.status) + (x.overdue ? ' ' + chip('Overdue', 'r') : ''), esc(x.assignee ? x.assignee.name : '–'),
          `<button class="btn btn-xs" data-act="open" data-id="${esc(x.id)}">Open</button>`])) : empty('No enquiries match', ' Change the filters, or wait for new website submissions.'))
          + (pg || r.nextCursor ? `<div class="pager">Page ${pg + 1}<button class="btn btn-xs" data-act="prev" ${pg ? '' : 'disabled'}>Previous</button><button class="btn btn-xs" data-act="next" ${r.nextCursor ? '' : 'disabled'}>Next</button></div>` : '');
      } catch (e) { $('#eList').innerHTML = `<div class="errbox" role="alert">${esc(e.message)}</div>`; }
    };
    const reset = () => { cursors = [null]; pg = 0; load(); };
    ['type', 'status', 'assignee'].forEach(k => H[k] = el => { f[k] = el.value; reset(); });
    H.from = el => { f.from = el.value ? new Date(el.value + 'T00:00:00+05:30').toISOString() : ''; reset(); };
    H.to = el => { f.to = el.value ? new Date(el.value + 'T23:59:59+05:30').toISOString() : ''; reset(); };
    H.q = el => { clearTimeout(tm); tm = setTimeout(() => { f.q = el.value.trim().length >= 2 ? el.value.trim() : ''; reset(); }, 300); };
    H.next = () => { pg++; load(); }; H.prev = () => { pg = Math.max(0, pg - 1); load(); };
    H.exp = async () => { try { const r = await fetch(api.base + '/admin/submissions/export?' + qs({}), { credentials: 'include' }); if (!r.ok) throw new Error('Export failed (' + r.status + ').'); const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'enquiries.csv'; document.body.append(a); a.click(); a.remove(); toast('Export downloaded. It is recorded in the audit log.'); } catch (e) { fail(e); } };
    H.open = b => openOne(b.dataset.id);
    const openOne = async id => {
      let d; try { d = await api.get('/admin/submissions/' + id); } catch (e) { return fail(e); }
      const kv = (k, v) => v ? `<tr><th scope="row">${esc(k)}</th><td>${v}</td></tr>` : '';
      const NEXT = { reviewing: 'Start review', in_progress: 'In progress', waiting_for_user: 'Waiting for visitor', resolved: 'Resolve', closed: 'Close', rejected: 'Reject' };
      const mo = modal(`${d.reference} · ${d.typeLabel}`, `<table class="tbl kv">${kv('Status', stc(d.status) + (d.overdue ? ' ' + chip('Overdue', 'r') : ''))}${kv('Name', esc(d.name))}${kv('Email', esc(d.email || ''))}${kv('Phone', esc(d.phone || ''))}${kv('Topic', esc(d.topic || ''))}
          ${kv('Preferred time', d.answers && d.answers.preferredAt ? fDT(d.answers.preferredAt) : '')}${kv('Message', esc(d.message || ''))}${kv('Received', fDT(d.createdAt) + (d.sourcePage ? ` <small class="note">from ${esc(d.sourcePage)}</small>` : ''))}
          ${kv('Consent', d.consent ? `${esc(d.consent.kind)} · version ${esc(d.consent.version)} · ${fDT(d.consent.at)}` : (d.linkedUser ? 'Signed-in student request' : ''))}${kv('Linked account', d.linkedUser ? 'Yes (signed in when sending)' : '')}</table>
        <div class="form" style="margin-top:1rem"><label>Owner<select id="eAs"><option value="">Unassigned</option>${admins.map(a => `<option value="${esc(a.id)}" ${d.assignee && d.assignee.id === a.id ? 'selected' : ''}>${esc(a.name || a.email)}</option>`).join('')}</select></label>
          <div style="display:flex;gap:.4rem;flex-wrap:wrap">${d.allowedNext.map(s => `<button class="btn btn-sm ${['rejected', 'closed'].includes(s) ? '' : 'btn-primary'}" data-to="${s}">${NEXT[s] || s}</button>`).join('') || '<span class="note">No further status changes.</span>'}</div>
          <label>Internal note (staff only, never shown to the visitor)<textarea id="eNote" maxlength="2000"></textarea></label><button class="btn btn-sm" id="eNoteGo">Add note</button>
          <div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:end"><label>Contact attempt<select id="eCh"><option value="phone">Phone</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="other">Other</option></select></label><label>Outcome<select id="eOut"><option value="reached">Reached</option><option value="no_answer">No answer</option><option value="left_message">Left message</option><option value="wrong_number">Wrong number</option><option value="bounced">Email bounced</option></select></label><button class="btn btn-sm" id="eTry">Log attempt</button></div></div>
        <h3 style="margin-top:1rem">Notes</h3>${d.notes.length ? d.notes.map(n => `<p><small class="note">${fDT(n.at)} · ${esc(n.author ? n.author.name : '')}</small><br>${esc(n.body)}</p>`).join('') : '<p class="note">No notes yet.</p>'}
        <h3>History</h3><ul class="note">${d.history.map(h => `<li>${fDT(h.at)} · ${esc(h.actor ? h.actor.name : 'Visitor')} · ${esc(h.kind === 'status' ? `${h.from} → ${h.to}` : h.kind === 'assigned' ? 'assigned to ' + (h.assignee ? h.assignee.name : '') : h.kind === 'contact_attempt' ? `contact attempt (${h.detail.channel}, ${h.detail.outcome})` : h.kind)}${h.detail && h.detail.reason ? ' · ' + esc(h.detail.reason) : ''}</li>`).join('')}</ul>`, { wide: true });
      const again = () => { mo.close(); load(); openOne(id); };
      const act = async fn => { try { await fn(); again(); } catch (e) { fail(e); } };
      $('#eAs', mo).addEventListener('change', e => act(() => api.post(`/admin/submissions/${id}/assign`, { assigneeId: e.target.value || null })));
      $$('[data-to]', mo).forEach(b => b.addEventListener('click', async () => {
        const to = b.dataset.to, final = ['resolved', 'closed', 'rejected'].includes(to) || ['resolved', 'closed', 'rejected'].includes(d.status);
        const reason = final ? await ask(NEXT[to] || to, { label: 'Reason or resolution (kept in the history)', placeholder: 'Shared batch timings by phone.' }) : null;
        if (final && !reason) return;
        act(() => api.post(`/admin/submissions/${id}/status`, { from: d.status, status: to, ...(reason ? { reason: reason.trim() } : {}) }));
      }));
      $('#eNoteGo', mo).addEventListener('click', () => { const v = $('#eNote', mo).value.trim(); if (v) act(() => api.post(`/admin/submissions/${id}/notes`, { body: v })); });
      $('#eTry', mo).addEventListener('click', () => act(() => api.post(`/admin/submissions/${id}/contact-attempts`, { channel: $('#eCh', mo).value, outcome: $('#eOut', mo).value })));
    };
    load();
  });

  /* ======================= CTF REGISTRATIONS ======================= */
  // one registrant on its own page: #/admin/ctf/<id>
  /* Attendance, Performance and Notifications with the Yojo API. Batch figures come from GET /admin/lms/batches/:id/overview
     (recorded attendance marks, graded attempts, cleared labs); a broadcast goes to one batch or every active student. */
  if (LIVE && LIVE.user) {
    const api = window.YojoAPI;
    const lbatches = () => api.admin.batches().then(r => r.items);
    const ov = id => api.get('/admin/lms/batches/' + id + '/overview');
    const nz = v => (v === null || v === undefined ? '–' : v);
    const batchPage = (title, body) => (_, __, qs) => page([[title]], async () => {
      const bs = await lbatches();
      if (!bs.length) { view.innerHTML = `<div class="card-h"><h1>${title}</h1></div><div class="card">${empty('No batches yet', 'Create a batch in Student Management first.')}</div>`; return; }
      const sel = (qs && qs.get('batch')) || bs[0].id;
      view.innerHTML = `<div class="card-h"><h1>${title}</h1></div><div class="card toolbar"><label>Batch<select data-chg="batch">${bs.map(b => `<option value="${b.id}" ${b.id === sel ? 'selected' : ''}>${esc(b.code)} · ${esc(b.name)}</option>`).join('')}</select></label></div><div id="lBody"></div>`;
      const render = async id => { $('#lBody').innerHTML = '<div class="skel" style="height:200px"></div>'; body(await ov(id)); };
      H.batch = el => render(el.value);
      await render(sel);
    });
    P.attendance = batchPage('Attendance', d => {
      const low = d.students.filter(r => r.attendance.pct !== null && r.attendance.pct < d.requiredAttendancePct);
      $('#lBody').innerHTML = `<div class="grid g4"><div class="stat"><b>${d.summary.students}</b><span>Students</span></div><div class="stat ${low.length ? 'red' : 'green'}"><b>${low.length}</b><span>Below ${d.requiredAttendancePct}%</span></div><div class="stat blue"><b>${d.summary.attendanceAvg === null ? '–' : d.summary.attendanceAvg + '%'}</b><span>Attendance avg</span></div><div class="stat"><b>${d.requiredAttendancePct}%</b><span>Required</span></div></div>
        <section class="card" style="margin-top:1rem"><div class="card-h"><h2>Attendance register</h2><div class="r"><button class="btn btn-sm" data-act="exp">Export CSV</button></div></div>
          ${d.students.length ? tbl(['Student', 'Present', 'Late', 'Absent', 'Excused', '%', 'Flag'], d.students.map(r => [`<b>${esc(r.name || '')}</b><br><span class="mono note">${esc(r.code || '')}</span>`, r.attendance.counts.present, r.attendance.counts.late, r.attendance.counts.absent, r.attendance.counts.excused, r.attendance.pct === null ? '–' : pbar(r.attendance.pct), r.attendance.pct !== null && r.attendance.pct < d.requiredAttendancePct ? chip('Low', 'r') : chip('OK', 'g')])) : empty('No students in this batch')}
          <p class="note" style="margin-top:.5rem">Attended (present or late) ÷ marked sessions that count. Excused and unmarked sessions are left out. Trainers mark sessions in their console; corrections need a reason and are kept in the history.</p></section>`;
      H.exp = () => { csv(`attendance-${d.batch.code}.csv`, [['Student code', 'Name', 'Present', 'Late', 'Absent', 'Excused', 'Percent'], ...d.students.map(r => [r.code || '', r.name || '', r.attendance.counts.present, r.attendance.counts.late, r.attendance.counts.absent, r.attendance.counts.excused, nz(r.attendance.pct)])]); toast('CSV downloaded.'); };
    });
    // Trainer attendance next to student attendance (owner, 30 Oct)
    const studentAtt = P.attendance;
    const attTabs = who => `<div class="toolbar" role="tablist" aria-label="Attendance of" style="margin:.2rem 0 1rem"><a role="tab" aria-selected="${who === 'students'}" class="btn btn-sm ${who === 'students' ? 'btn-primary' : ''}" href="#/admin/attendance">Students</a><a role="tab" aria-selected="${who === 'trainers'}" class="btn btn-sm ${who === 'trainers' ? 'btn-primary' : ''}" href="#/admin/attendance?who=trainers">Trainers</a></div>`;
    const TST = { present: ['Present', 'g'], absent: ['Absent', 'r'], leave: ['Leave', 'a'], half_day: ['Half day', 'b'] };
    const SRC = { admin: 'Marked by admin', classes: 'From class records', not_marked: 'Classes held, not marked', scheduled: 'Classes scheduled', no_classes: 'No classes' };
    const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
    const trainerAtt = qs => page([['Attendance'], ['Trainers']], async () => {
      const day = (qs && qs.get('day')) || istToday();
      const [d, sm] = await Promise.all([api.get('/admin/trainer-attendance?day=' + day), api.get('/admin/trainer-attendance/summary?days=30')]);
      view.innerHTML = `<div class="card-h"><h1>Attendance</h1></div>${attTabs('trainers')}
        <div class="card toolbar"><label>Date<input type="date" id="taDay" value="${day}" max="${istToday()}"></label>${d.holiday ? chip('Holiday: ' + d.holiday, 'a') : ''}</div>
        <div class="grid g4" style="margin-top:1rem"><div class="stat green"><b>${d.summary.present}</b><span>Present</span></div><div class="stat red"><b>${d.summary.absent}</b><span>Absent</span></div><div class="stat amber"><b>${d.summary.leave + d.summary.halfDay}</b><span>Leave / half day</span></div><div class="stat"><b>${d.summary.notMarked}</b><span>Classes held, not marked</span></div></div>
        <section class="card" style="margin-top:1rem"><div class="card-h"><h2>Trainers on ${esc(day)}</h2></div>
          ${d.trainers.length ? tbl(['Trainer', 'Batches', 'Classes', 'Status', 'Mark'], d.trainers.map(t => [
            `<b>${esc(t.name)}</b><br><span class="mono note">${esc(t.code || '')}</span>`, esc(t.batches.join(', ') || '–'),
            t.sessions ? `${t.sessionsMarked} of ${t.sessions} with attendance taken` : '<span class="note">None</span>',
            (t.status ? chip(TST[t.status][0], TST[t.status][1]) : '<span class="note">Not marked</span>') + `<br><small class="note">${SRC[t.source] || ''}${t.markedBy ? ' · ' + esc(t.markedBy) : ''}${t.note ? ' · ' + esc(t.note) : ''}</small>`,
            `<form class="toolbar" data-sub="taMark" data-id="${t.id}" data-cur="${t.source === 'admin' ? t.status : ''}"><select name="s" aria-label="Status">${Object.entries(TST).map(([k, v]) => `<option value="${k}" ${t.status === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select><input name="n" maxlength="300" placeholder="${t.source === 'admin' ? 'Reason for the change' : 'Note (optional)'}" value=""><button class="btn btn-xs btn-primary" type="submit">Save</button></form>`]))
          : empty('No trainers yet')}
          <p class="note" style="margin-top:.5rem">A day without a mark shows “present” when the trainer took attendance in a class that day. Changing a saved mark needs a reason. Every mark is audited.</p></section>
        <section class="card" style="margin-top:1rem"><div class="card-h"><h2>Last ${sm.days} days</h2><div class="r"><button class="btn btn-sm" data-act="taExp">Export CSV</button></div></div>
          ${sm.trainers.length ? tbl(['Trainer', 'Present', 'of which from classes', 'Absent', 'Leave', 'Half day', 'Class days not marked'], sm.trainers.map(t => [`<b>${esc(t.name)}</b>`, t.present, t.presentFromClasses, t.absent, t.leave, t.halfDay, t.classDaysNotMarked])) : empty('No trainers yet')}</section>`;
      $('#taDay').onchange = e => { location.hash = '#/admin/attendance?who=trainers&day=' + e.target.value; };
      H.taMark = async f => {
        const body = { trainerId: f.dataset.id, day, status: f.s.value, note: f.n.value.trim() || undefined };
        if (f.dataset.cur && f.dataset.cur !== body.status && !body.note) { toast('Write a reason for changing the mark.', true); return; }
        try { await api.raw('PUT', '/admin/trainer-attendance', body); toast('Saved.'); trainerAtt(qs); } catch (e) { fail(e); }
      };
      H.taExp = () => csv(`trainer-attendance-${sm.days}d.csv`, [['Trainer', 'Present', 'From classes', 'Absent', 'Leave', 'Half day', 'Class days not marked'], ...sm.trainers.map(t => [t.name, t.present, t.presentFromClasses, t.absent, t.leave, t.halfDay, t.classDaysNotMarked])]);
    });
    P.attendance = (a, b, qs) => qs && qs.get('who') === 'trainers' ? trainerAtt(qs)
      : Promise.resolve(studentAtt(a, b, qs)).then(() => { const h = view.querySelector('.card-h'); if (h && !view.querySelector('[aria-label="Attendance of"]')) h.insertAdjacentHTML('afterend', attTabs('students')); });
    P.performance = batchPage('Performance', d => {
      const avg = k => { const v = d.students.map(k).filter(x => x !== null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : '–'; };
      const labsAvg = avg(r => (r.labsTotal ? Math.round((100 * r.labsCleared) / r.labsTotal) : null));
      $('#lBody').innerHTML = `<div class="grid g4"><div class="stat blue"><b>${nz(d.summary.performanceAvg)}</b><span>Average Performance Index</span></div><div class="stat"><b>${d.summary.attendanceAvg === null ? '–' : d.summary.attendanceAvg + '%'}</b><span>Attendance avg</span></div><div class="stat cyan"><b>${labsAvg}${labsAvg === '–' ? '' : '%'}</b><span>Labs cleared avg</span></div><div class="stat"><b>${avg(r => r.quizAvg)}</b><span>Quiz avg</span></div></div>
        <section class="card" style="margin-top:1rem"><h2>Students</h2>${d.students.length ? tbl(['Student', 'Index', 'Attendance', 'Labs', 'Quiz avg', 'XP', 'Flags'], d.students.slice().sort((a, b) => (a.performanceIndex ?? 101) - (b.performanceIndex ?? 101)).map(r => [`<b>${esc(r.name || '')}</b>`, `<b>${nz(r.performanceIndex)}</b>`, r.attendance.pct === null ? '–' : pbar(r.attendance.pct), `${r.labsCleared}/${r.labsTotal}`, nz(r.quizAvg), r.xp, r.flags.length ? r.flags.map(f => chip(f, 'r')).join(' ') : chip('OK', 'g')])) : empty('No students in this batch')}
          <p class="note" style="margin-top:.5rem">${esc(d.rules.performanceIndex)} Flags: attendance under ${d.requiredAttendancePct}%, no activity for ${d.rules.inactiveDays} days, quiz average under ${d.rules.quizFlagPct}%. The index guides mentoring; it never decides fees, grades or access.</p></section>`;
    });
    // System Settings from the server (audit 29 Oct): each section is versioned (If-Match); policy, plans and auth
    // also ask for a fresh authenticator code. Numbers, switches and text are edited as fields; lists as JSON.
    const SDESC = { plans: 'Plan names and prices shown at checkout (prices stay 0 until the owner sets them).', xp: 'XP a student earns for each verified activity.', ai: 'Daily message caps for the Orbi assistant.', promos: 'Promo codes.', maintenance: 'Maintenance banner for the whole platform.', policy: 'Attendance minimum, Performance Index weights and approval targets.', auth: 'One-time codes, staff lockout and step-up timing.', gamification: 'Daily patches, weekly ops, streak rules, hint costs and ranks.' };
    const STEP = ['policy', 'plans', 'auth'];
    const flat = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => v && typeof v === 'object' && !Array.isArray(v) ? flat(v, pre + k + '.') : [[pre + k, v]]);
    const setPath = (o, path, v) => { const ks = path.split('.'); let t = o; ks.slice(0, -1).forEach(k => { t = t[k]; }); t[ks[ks.length - 1]] = v; };
    P.settings = () => page([['System Settings']], async () => {
      const r = await api.get('/admin/settings'), secs = Object.keys(r.sections);
      const hist = (await Promise.all(secs.map(sec => api.get('/admin/settings/' + sec + '/history').then(h => (h.items || []).map(x => ({ ...x, section: sec })), () => [])))).flat().sort((a, b) => new Date(b.at || b.createdAt) - new Date(a.at || a.createdAt)).slice(0, 20);
      const field = (sec, k, v) => typeof v === 'boolean' ? `<label class="chk"><input type="checkbox" data-s="${sec}" data-k="${k}" data-t="b" ${v ? 'checked' : ''}> ${esc(k)}</label>`
        : Array.isArray(v) ? `<label>${esc(k)} <span class="note">(list, JSON)</span><textarea data-s="${sec}" data-k="${k}" data-t="j" rows="${Math.min(10, 2 + v.length)}" class="mono">${esc(JSON.stringify(v))}</textarea></label>`
        : `<label>${esc(k)}<input data-s="${sec}" data-k="${k}" data-t="${typeof v === 'number' ? 'n' : v === null ? 'z' : 's'}" value="${esc(v === null ? '' : v)}" ${typeof v === 'number' ? 'type="number"' : ''} ${v === null ? 'placeholder="not set"' : ''}></label>`;
      view.innerHTML = `<div class="card-h"><h1>System Settings</h1>${chip('Live', 'g')}</div>
        <div class="grid g2">${secs.map(sec => `<form class="card form" data-sub="sv" data-sec="${sec}"><h2>${esc(sec[0].toUpperCase() + sec.slice(1))} ${STEP.includes(sec) ? chip('Authenticator code needed', 'a') : ''}</h2><p class="note">${esc(SDESC[sec] || '')} · version ${r.sections[sec].version}</p>
          <fieldset style="border:0;padding:0;margin:0;display:grid;gap:.6rem">${flat(r.sections[sec].value).map(([k, v]) => field(sec, k, v)).join('')}</fieldset><button class="btn btn-primary" type="submit">Save</button></form>`).join('')}</div>
        <section class="card" style="margin-top:1rem"><h2>Change history</h2>${hist.length ? tbl(['When', 'Section', 'Version', 'Changes'], hist.map(h => [fDT(h.at || h.createdAt), esc(h.section), esc(h.version ?? ''), `<span class="note">${esc(JSON.stringify(h.diff || h.changes || h.value || '').slice(0, 200))}</span>`])) : empty('No changes yet')}</section>`;
      H.sv = async f => {
        const sec = f.dataset.sec, val = JSON.parse(JSON.stringify(r.sections[sec].value));
        try { $$(`[data-s="${sec}"]`, f).forEach(i => { const t = i.dataset.t; setPath(val, i.dataset.k, t === 'b' ? i.checked : t === 'n' ? Number(i.value) : t === 'j' ? JSON.parse(i.value) : t === 'z' ? (i.value.trim() === '' ? null : (isNaN(+i.value) ? i.value : Number(i.value))) : i.value); }); }
        catch { toast('A list is not valid JSON.', true); return; }
        let code = null;
        if (STEP.includes(sec)) { code = await ask('Confirm with your authenticator', { mfa: true, label: 'Authenticator code', ok: 'Save' }); if (!code) return; }
        else if (!await confirmBox('Save settings', `Save ${esc(sec)}? This affects the live platform and is audited.`, 'Save')) return;
        try { await api.raw('PUT', '/admin/settings/' + sec, { value: val }, Object.assign({ 'If-Match': '"' + r.sections[sec].version + '"' }, code ? { 'X-Step-Up-Code': code } : {})); toast('Saved.'); P.settings(); } catch (e) { fail(e); }
      };
    });
    P.notifications = () => page([['Notifications']], async () => {
      const bs = await lbatches();
      view.innerHTML = `<div class="card-h"><h1>Notifications</h1></div>
        <form class="card form" data-sub="send" novalidate><h2>Broadcast to students</h2>
          <div class="row2"><label>Audience<select id="nAud"><option value="batch">One batch</option><option value="all">All active students</option></select></label><label id="nValW">Batch<select id="nVal">${bs.map(b => `<option value="${b.id}">${esc(b.code)} · ${esc(b.name)}</option>`).join('')}</select></label></div>
          <label>Title<input id="nTitle" maxlength="150"></label><label>Message<textarea id="nBody" rows="4" maxlength="2000"></textarea></label>
          <label class="chk"><input type="checkbox" id="nImp"> Important (also emailed to students who allow it)</label>
          <div class="toolbar"><button class="btn btn-primary" type="submit">Send</button></div><p class="err" id="nErr" role="alert"></p>
          <p class="note">Every message reaches the student bell; important ones are also emailed (title and link only). A broadcast that reaches more students than the policy limit needs a second admin, which is not built for broadcasts yet, so it is refused. Every send is audited.</p></form>
        <form class="card form" data-sub="dm" novalidate style="margin-top:1rem"><h2>Message one student</h2>
          <div class="row2"><label style="position:relative">Student<input id="dmQ" placeholder="Search name, email or student ID" autocomplete="off"><div class="pop" id="dmRes" hidden></div></label>
            <label>Category<select id="dmCat"><option value="fee_dues">Fee dues</option><option value="attendance">Attendance</option><option value="academic">Academic</option><option value="general">General</option></select></label></div>
          <p class="note" id="dmWho">No student chosen yet.</p>
          <label>Subject<input id="dmT" maxlength="150" placeholder="e.g. Fee instalment due on 5 Nov"></label><label>Message<textarea id="dmB" rows="3" maxlength="2000"></textarea></label>
          <label class="chk"><input type="checkbox" id="dmImp"> Important (also emailed once the mail provider is connected)</label>
          <div class="toolbar"><button class="btn btn-primary" type="submit">Send to this student</button></div><p class="err" id="dmE" role="alert"></p>
          <p class="note">The student sees it in their bell. Every message is audited with its category.</p></form>
        <section class="card" style="margin-top:1rem"><div class="card-h"><h2>Sent to individual students</h2></div><div id="dmList"></div></section>
        <section class="card" style="margin-top:1rem"><div class="card-h"><h2>Holiday calendar</h2></div><div id="hList"></div>
          <form class="toolbar" data-sub="hAdd" style="margin-top:.6rem"><label>Date<input id="hDay" type="date"></label><label style="flex:1">Name<input id="hName" maxlength="80" placeholder="e.g. Diwali"></label><button class="btn btn-sm" type="submit">Add holiday</button></form>
          <p class="note">No classes are scheduled on these days, and students see them on their Ops Calendar.</p><p class="err" id="hErr" role="alert"></p></section>
        ${gap('Scheduled sends, recalls, wish templates and WhatsApp are not connected yet (they need the messaging providers).')}`;
      const CATN = { fee_dues: 'Fee dues', attendance: 'Attendance', academic: 'Academic', general: 'General' };
      let dmTo = null;
      const dmHist = async () => { const h = await api.get('/admin/notifications/direct'); $('#dmList').innerHTML = h.length ? tbl(['When', 'Student', 'Category', 'Subject', 'By'], h.map(x => [fDT(x.at), `<span class="mono">${esc(x.student)}</span>`, chip(CATN[x.category] || x.category, x.category === 'fee_dues' ? 'a' : 'b') + (x.important ? ' ' + chip('Important', 'r') : ''), esc(x.title), esc(x.by)])) : empty('No individual messages yet'); };
      await dmHist();
      let dmT;
      $('#dmQ').addEventListener('input', e => { clearTimeout(dmT); const q = e.target.value.trim(); if (q.length < 2) { $('#dmRes').hidden = true; return; }
        dmT = setTimeout(async () => { try { const r = await api.admin.users({ view: 'students', q, limit: 8 }); const it = r.items || [];
          $('#dmRes').hidden = false; $('#dmRes').innerHTML = it.length ? it.map(u => `<a href="#" data-pick="${u.id}" data-l="${esc((u.name || u.email) + ' · ' + u.code)}"><b>${esc(u.name || u.email)}</b><small class="note"><span class="mono">${esc(u.code)}</span> · ${esc(u.email)}</small></a>`).join('') : '<p class="note" style="padding:.5rem">No student found</p>';
        } catch (x) { $('#dmRes').innerHTML = `<p class="note" style="padding:.5rem">${esc(x.message)}</p>`; } }, 250); });
      $('#dmRes').addEventListener('click', e => { const a = e.target.closest('[data-pick]'); if (!a) return; e.preventDefault(); dmTo = a.dataset.pick; $('#dmWho').innerHTML = 'To: <b>' + esc(a.dataset.l) + '</b>'; $('#dmQ').value = ''; $('#dmRes').hidden = true; });
      H.dm = async () => { $('#dmE').textContent = '';
        const body = { studentId: dmTo, category: $('#dmCat').value, title: $('#dmT').value.trim(), body: $('#dmB').value.trim(), important: $('#dmImp').checked };
        if (!dmTo) { $('#dmE').textContent = 'Choose a student first.'; return; }
        if (body.title.length < 3 || !body.body) { $('#dmE').textContent = 'Write a subject (3+ characters) and a message.'; return; }
        try { await api.post('/admin/notifications/direct', body); toast('Message sent to the student.'); $('#dmT').value = ''; $('#dmB').value = ''; await dmHist(); } catch (e) { $('#dmE').textContent = e.message; } };
      const hol = async () => { const hs = await api.get('/admin/holidays'); $('#hList').innerHTML = hs.length ? tbl(['Date', 'Holiday', ''], hs.map(h => [esc(h.day), esc(h.name), `<button class="btn btn-xs btn-danger" data-act="hDel" data-d="${esc(h.day)}">Remove</button>`])) : empty('No holidays added'); };
      await hol();
      H.hAdd = async () => { $('#hErr').textContent = ''; try { await api.post('/admin/holidays', { day: $('#hDay').value, name: $('#hName').value.trim() }); toast('Holiday added.'); await hol(); } catch (e) { $('#hErr').textContent = e.message; } };
      H.hDel = async b => { if (!await confirmBox('Remove holiday', 'Remove ' + b.dataset.d + ' from the calendar?', 'Remove')) return; try { await api.raw('DELETE', '/admin/holidays/' + b.dataset.d); toast('Holiday removed.'); await hol(); } catch (e) { fail(e); } };
      $('#nAud').onchange = () => { $('#nValW').hidden = $('#nAud').value === 'all'; };
      H.send = async () => {
        const all = $('#nAud').value === 'all';
        const body = { title: $('#nTitle').value.trim(), body: $('#nBody').value.trim(), important: $('#nImp').checked, ...(all ? { allStudents: true } : { batchId: $('#nVal').value }) };
        if (!await confirmBox('Send broadcast', `Send "${esc(body.title)}" to ${all ? 'every active student' : 'this batch'}?`, 'Send')) return;
        try { const r = await api.post('/admin/notifications/broadcast', body); toast(`Sent to ${r.recipients} student${r.recipients === 1 ? '' : 's'}.`); P.notifications(); } catch (e) { $('#nErr').textContent = e.message; }
      };
    });
  }

  /* Courses, Labs and Assessments with the Yojo API: admin management through the same endpoints the trainer console
     uses for content (validation and audit on the server). Missions keep their answer as a salted hash; it is set,
     never shown. */
  if (LIVE && LIVE.user) {
    const api = window.YojoAPI;
    const put = (p, b) => api.raw('PUT', p, b || {}), del = p => api.raw('DELETE', p);
    const STC2 = { draft: 'a', published: 'g', unpublished: '', archived: '', retired: '', closed: '' };
    const s2 = s => chip(s, STC2[s] ?? '');
    const CATS = ['Cybersecurity Fundamentals', 'Defensive Security and SOC', 'Offensive Security and Ethical Hacking', 'Governance, Risk and Compliance (GRC)', 'Cyber Forensics', 'Communication Skills'];
    const LT = ['concept', 'video', 'document', 'slides', 'quiz', 'lab', 'live_class', 'resource'];
    const rupees = p => p == null ? '–' : '₹' + (p / 100).toLocaleString('en-IN');
    const form = (id, fields) => `<form class="form" id="${id}">${fields}<p class="err" id="${id}E"></p></form>`;
    const sub = (m, id, fn) => $('#' + id, m).addEventListener('submit', async e => { e.preventDefault(); try { await fn(e.target); } catch (x) { $('#' + id + 'E', m).textContent = x.message; } });

    /* ---- Courses ---- */
    // Change requests (owner, 29 Oct): a trainer's edit or delete on a published course, waiting for a Platform Admin
    const CC_FIELD = { title: 'Title', category: 'Category', level: 'Level', duration: 'Duration', summary: 'Description', outcomes: 'Outcomes', type: 'Type', status: 'Status', body: 'Text', contentUrl: 'Link', durationMin: 'Minutes', question: 'Question', answer: 'Answer', published: 'Shown', sortOrder: 'Order', name: 'File', kind: 'Type of content' };
    const ccWhat = x => { const p = x.payload || {}, ks = Object.keys(p).filter(k => CC_FIELD[k]);
      return (ks.length ? ks.map(k => `<span class="note">${CC_FIELD[k]}: </span>${esc(String(Array.isArray(p[k]) ? p[k].join(' · ') : p[k]).slice(0, 160))}`).join('<br>') : '<span class="note">–</span>') + (p.fileId ? `<br><a class="btn btn-xs" target="_blank" rel="noopener" href="${window.YojoAPI.base}/files/${p.fileId}">Open file</a>` : ''); };
    const changeQueue = cr => { const it = cr.items || [];
      return `<section class="card" style="margin-bottom:1rem"><div class="card-h"><h2>Change requests</h2><div class="r">${chip(it.length + ' waiting', it.length ? 'a' : 'g')}</div></div>
        ${it.length ? tbl(['Request', 'Course', 'Change', 'Reason', 'Trainer', 'Sent', ''], it.map(x => [`<b class="mono">${esc(x.code)}</b><br>${esc(x.kindLabel)}`, `<a href="#/admin/courses/${x.course.id}">${esc(x.course.title)}</a><br><span class="note mono">${esc(x.course.code)} · v${x.course.version}</span>`, ccWhat(x), `${esc(x.reasonLabel)}${x.reasonNote ? '<br><span class="note">' + esc(x.reasonNote) + '</span>' : ''}`, esc(x.requestedBy || ''), fDT(x.createdAt),
          `<div class="toolbar"><button class="btn btn-xs btn-primary" data-act="ccOk" data-id="${x.id}">Approve</button><button class="btn btn-xs btn-danger" data-act="ccNo" data-id="${x.id}" data-code="${esc(x.code)}">Reject</button></div>`])) : empty('Nothing waiting', 'Edits of published courses by trainers show here.')}</section>`; };
    P.courses = (id) => id ? liveCourseAdmin(id) : page([['Course Management']], async () => {
      const [cs, cr] = await Promise.all([api.get('/admin/courses'), api.get('/admin/course-changes').catch(() => ({ items: [], counts: {} }))]); const f = { q: '', status: '' };
      const draw = () => { const rows = cs.filter(c => (!f.status || c.status === f.status) && (!f.q || (c.title + c.code).toLowerCase().includes(f.q.toLowerCase())));
        $('#cList').innerHTML = rows.length ? tbl(['Course', 'Category', 'Access', 'Status', 'Lessons', 'Batches', 'Certificates', 'Updated', ''], rows.map(c => [`<b>${esc(c.title)}</b><br><span class="mono note">${esc(c.code)} · v${c.version}</span>`, esc(c.category), c.access === 'paid' ? chip('Paid', 'a') : chip('Free', 'g'), s2(c.status), c._count.lessons, c._count.batches, c._count.certificates, fDT(c.updatedAt), `<a class="btn btn-xs btn-primary" href="#/admin/courses/${c.id}">Open</a>`])) : empty('No courses match', cs.length ? 'Try another filter.' : 'Create the first course.'); };
      view.innerHTML = `<div class="card-h"><h1>Course Management</h1><div class="r"><button class="btn btn-primary" data-act="new">Create course</button></div></div>
        ${changeQueue(cr)}
        <div class="card toolbar"><label style="flex:2;min-width:200px">Search<input data-inp="q" placeholder="Title or code"></label><label>Status<select data-chg="status"><option value="">All</option>${['draft', 'published', 'unpublished', 'archived'].map(s => `<option>${s}</option>`).join('')}</select></label></div><div id="cList"></div>
        <p class="note" style="margin-top:.6rem">Trainers create courses and publish their own (owner, 29 Oct). Once a course is published, a trainer's edit or delete waits in "Change requests" above until you approve or reject it. Price and free/paid access are set here only.</p>`;
      H.q = el => { f.q = el.value; draw(); }; H.status = el => { f.status = el.value; draw(); }; draw();
      H.ccOk = async b => { try { const r = await api.post('/admin/course-changes/' + b.dataset.id + '/decide', { approve: true }); toast(r.code + ' approved: the change is live and the course version went up.'); P.courses(); } catch (e) { fail(e); } };
      H.ccNo = async b => { const note = await ask('Reject change ' + b.dataset.code, { label: 'Note for the trainer', placeholder: 'What should change before it can go live?', ok: 'Reject', danger: true }); if (!note) return;
        try { await api.post('/admin/course-changes/' + b.dataset.id + '/decide', { approve: false, note: note }); toast(b.dataset.code + ' rejected. The trainer gets your note.'); P.courses(); } catch (e) { fail(e); } };
      H.new = () => { const m = modal('Create course', form('ncF', `<div class="row2"><label>Code<input name="code" placeholder="SOC-101" class="mono"></label><label>Web address (slug)<input name="slug" placeholder="soc-analyst-basics" class="mono"></label></div>
          <label>Title<input name="title" maxlength="150"></label><label>Category<select name="category">${CATS.map(c => `<option>${c}</option>`).join('')}</select></label>
          <div class="row2"><label>Access<select name="access"><option value="free">Free</option><option value="paid">Paid</option></select></label><label>Level<select name="level"><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select></label></div>
          <label>Summary<textarea name="summary" maxlength="500"></textarea></label>`), { foot: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="ncF" type="submit">Create draft</button>' });
        sub(m, 'ncF', async t => { const r = await api.post('/admin/courses', { code: t.code.value.trim().toUpperCase(), slug: t.slug.value.trim().toLowerCase(), title: t.title.value.trim(), category: t.category.value, access: t.access.value, level: t.level.value, summary: t.summary.value.trim() }); m.close(); toast('Draft course created.'); location.hash = '#/admin/courses/' + r.id; }); };
    });
    const liveCourseAdmin = id => page([['Course Management', '#/admin/courses'], ['…']], async () => {
      const [c, ch] = await Promise.all([api.get('/admin/courses/' + id), api.get('/admin/courses/' + id + '/changes').catch(() => ({ items: [] }))]);
      setCrumb([['Course Management', '#/admin/courses'], [c.title]]);
      // OI-48: trainer edits and deletes with the reason each trainer gave
      const WHAT = { module_added: 'Added a module', module_updated: 'Edited a module', module_deleted: 'Deleted a module', lesson_added: 'Added a lesson', lesson_updated: 'Edited a lesson', lesson_deleted: 'Deleted a lesson', faq_added: 'Added an FAQ', faq_updated: 'Edited an FAQ', faq_deleted: 'Deleted an FAQ' };
      const changes = `<section class="card"><h3>Trainer changes</h3>${ch.items.length ? `<div class="list">${ch.items.slice(0, 30).map(x => `<div class="li ${/deleted/.test(x.action) ? 'red' : ''}"><div class="grow"><b>${esc(WHAT[x.action] || x.action)}</b><span class="note">${esc(x.by || 'Trainer')} · ${fDT(x.at)}</span>${x.reasonLabel ? `<span class="note">Reason: ${esc(x.reasonLabel)}${x.reasonNote ? ' · ' + esc(x.reasonNote) : ''}</span>` : ''}</div></div>`).join('')}</div>` : '<p class="note">No trainer has changed this course yet.</p>'}</section>`;
      const again = msg => { toast(msg); liveCourseAdmin(id); };
      const lessons = c.modules.flatMap(m => m.lessons);
      view.innerHTML = `<div class="card-h"><div><h1>${esc(c.title)}</h1><p class="note"><span class="mono">${esc(c.code)}</span> · v${c.version} ${s2(c.status)} · ${c.access === 'paid' ? 'Paid ' + rupees(c.pricePaise) : 'Free'}</p></div>
          <div class="r toolbar">${c.status === 'published' ? '<button class="btn btn-danger" data-act="cst" data-s="unpublished">Unpublish</button>' : '<button class="btn btn-primary" data-act="cst" data-s="published">Publish</button>'}${c.status !== 'archived' ? '<button class="btn" data-act="cst" data-s="archived">Archive</button>' : ''}</div></div>
        <div class="dash"><section class="card s8"><h2>Course details</h2>${form('cdF', `<label>Title<input name="title" value="${esc(c.title)}" maxlength="150"></label><label>Summary<textarea name="summary" maxlength="500">${esc(c.summary || '')}</textarea></label><label>Overview<textarea name="overview" maxlength="5000">${esc(c.overview || '')}</textarea></label>
            <div class="row3"><label>Category<select name="category">${CATS.map(x => `<option ${x === c.category ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label>Level<input name="level" value="${esc(c.level || '')}"></label><label>Duration<input name="duration" value="${esc(c.duration || '')}" placeholder="8 weeks"></label></div>
            <div class="row3"><label>Access<select name="access"><option value="free" ${c.access === 'free' ? 'selected' : ''}>Free</option><option value="paid" ${c.access === 'paid' ? 'selected' : ''}>Paid</option></select></label><label>Price (₹, paid only)<input name="price" type="number" min="0" step="1" value="${c.pricePaise != null ? c.pricePaise / 100 : ''}"></label><label>Certificate name<input name="certificate" value="${esc(c.certificate || '')}" placeholder="Leave empty for none"></label></div>
            <div class="toolbar"><button class="btn btn-primary" type="submit">Save details</button></div>`)}
          <h2 style="margin-top:1.2rem">Modules and lessons</h2>${c.modules.length ? c.modules.map(m => `<div class="card" style="margin-top:.7rem"><div class="card-h"><h3>${esc(m.title)}</h3><div class="r"><button class="btn btn-xs" data-act="aLes" data-id="${m.id}">Add lesson</button><button class="btn btn-xs" data-act="rMod" data-id="${m.id}">Rename</button><button class="btn btn-xs btn-danger" data-act="dMod" data-id="${m.id}">Delete</button></div></div>
            ${m.lessons.length ? tbl(['Lesson', 'Type', 'Status', ''], m.lessons.map(l => [esc(l.title), esc(l.type), s2(l.status), `<button class="btn btn-xs" data-act="eLes" data-id="${l.id}">Edit</button> <button class="btn btn-xs btn-danger" data-act="dLes" data-id="${l.id}">Delete</button>`])) : '<p class="note">No lessons yet.</p>'}</div>`).join('') : '<p class="note">No modules yet.</p>'}
          <button class="btn" data-act="aMod" style="margin-top:.8rem">Add module</button></section>
          <aside class="s4" style="display:grid;gap:1rem;align-content:start"><section class="card"><h3>Batches running it</h3>${c.batches.length ? `<div class="list">${c.batches.map(b => `<div class="li"><span>${esc(b.code)} · ${esc(b.name)}</span>${s2(b.status)}</div>`).join('')}</div>` : '<p class="note">No batch runs this course yet. Link it when you create or edit a batch.</p>'}</section>
            <section class="card"><div class="card-h"><h3>FAQs</h3><div class="r"><button class="btn btn-xs" data-act="aFaq">Add</button></div></div>${c.faqs.length ? `<div class="list">${c.faqs.map(f => `<div class="li"><div class="grow"><b>${esc(f.question)}</b><span class="note">${esc(f.answer)}</span></div>${chip(f.published ? 'Shown' : 'Hidden', f.published ? 'g' : '')}<button class="btn btn-xs" data-act="eFaq" data-id="${f.id}">Edit</button><button class="btn btn-xs btn-danger" data-act="dFaq" data-id="${f.id}">Delete</button></div>`).join('')}</div>` : '<p class="note">No FAQs yet.</p>'}</section>
            ${changes}
            ${gap('Lesson file uploads need object storage, which is not connected yet; lessons use text and https links.')}</aside></div>`;
      sub(view, 'cdF', async t => { const price = t.price.value.trim(); await api.patch('/admin/courses/' + id, { title: t.title.value.trim(), summary: t.summary.value.trim(), overview: t.overview.value.trim(), category: t.category.value, level: t.level.value.trim() || undefined, duration: t.duration.value.trim() || undefined, access: t.access.value, pricePaise: t.access.value === 'paid' && price ? Math.round(+price * 100) : null, certificate: t.certificate.value.trim() || null }); again('Course saved.'); });
      H.cst = async b => { const s = b.dataset.s; if (!await confirmBox(s === 'published' ? 'Publish course' : s === 'archived' ? 'Archive course' : 'Unpublish course', s === 'published' ? 'Students with access will see the published lessons.' : 'Students will no longer see this course.', 'Confirm', s !== 'published')) return; try { await api.post(`/admin/courses/${id}/status`, { status: s }); again('Status changed to ' + s + '.'); } catch (e) { fail(e); } };
      const lessonForm = (l, save) => { const m = modal(l ? 'Edit lesson' : 'Add lesson', form('lF', `<label>Title<input name="title" maxlength="200" value="${esc(l ? l.title : '')}"></label>
          <div class="row3"><label>Type<select name="type">${LT.map(x => `<option ${l && l.type === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label>Status<select name="status"><option value="draft">draft</option><option value="published" ${l && l.status === 'published' ? 'selected' : ''}>published</option></select></label><label>Minutes<input name="dur" type="number" min="1" max="1000" value="${l && l.durationMin || ''}"></label></div>
          <label>Content link (https)<input name="url" value="${esc(l && l.contentUrl || '')}"></label><label>Text<textarea name="body" rows="6" maxlength="20000">${esc(l && l.body || '')}</textarea></label>
          <label class="chk"><input type="checkbox" name="preview" ${l && l.preview ? 'checked' : ''}> Free preview (visible before enrolment)</label>`), { wide: true, foot: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="lF" type="submit">Save</button>' });
        sub(m, 'lF', async t => { const o = { title: t.title.value.trim(), type: t.type.value, status: t.status.value, preview: t.preview.checked }; if (+t.dur.value) o.durationMin = +t.dur.value; if (t.url.value.trim()) o.contentUrl = t.url.value.trim(); if (t.body.value.trim()) o.body = t.body.value; await save(o); m.close(); again('Lesson saved.'); }); };
      const faqForm = (f, save) => { const m = modal(f ? 'Edit FAQ' : 'Add FAQ', form('fF', `<label>Question<input name="q" maxlength="300" value="${esc(f ? f.question : '')}"></label><label>Answer<textarea name="a" maxlength="3000">${esc(f ? f.answer : '')}</textarea></label><label class="chk"><input type="checkbox" name="p" ${f && f.published ? 'checked' : ''}> Show on the course page</label>`), { foot: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="fF" type="submit">Save</button>' });
        sub(m, 'fF', async t => { await save({ question: t.q.value.trim(), answer: t.a.value.trim(), published: t.p.checked }); m.close(); again('FAQ saved.'); }); };
      H.aMod = async () => { const t = await ask('Add module', { label: 'Module title', ok: 'Add' }); if (!t) return; try { await api.post(`/admin/courses/${id}/modules`, { title: t, sortOrder: c.modules.length + 1 }); again('Module added.'); } catch (e) { fail(e); } };
      H.rMod = async b => { const t = await ask('Rename module', { label: 'New title', ok: 'Save' }); if (!t) return; try { await api.patch('/admin/modules/' + b.dataset.id, { title: t }); again('Module renamed.'); } catch (e) { fail(e); } };
      H.dMod = async b => { if (!await confirmBox('Delete module', 'Delete this module and its lessons? Not possible once students have progress in it.', 'Delete', true)) return; try { await del('/admin/modules/' + b.dataset.id); again('Module deleted.'); } catch (e) { fail(e); } };
      H.aLes = b => lessonForm(null, o => api.post(`/admin/modules/${b.dataset.id}/lessons`, o));
      H.eLes = b => lessonForm(lessons.find(x => x.id === b.dataset.id), o => api.patch('/admin/lessons/' + b.dataset.id, o));
      H.dLes = async b => { if (!await confirmBox('Delete lesson', 'Not possible once students have progress in it; unpublish it instead.', 'Delete', true)) return; try { await del('/admin/lessons/' + b.dataset.id); again('Lesson deleted.'); } catch (e) { fail(e); } };
      H.aFaq = () => faqForm(null, o => api.post(`/admin/courses/${id}/faqs`, o));
      H.eFaq = b => faqForm(c.faqs.find(x => x.id === b.dataset.id), o => api.patch('/admin/faqs/' + b.dataset.id, o));
      H.dFaq = async b => { if (!await confirmBox('Delete FAQ', 'Remove this FAQ?', 'Delete', true)) return; try { await del('/admin/faqs/' + b.dataset.id); again('FAQ deleted.'); } catch (e) { fail(e); } };
    });

    /* ---- Labs (missions) ---- */
    P.labs = (code) => code ? liveLab(code) : page([['Lab Management']], async () => {
      const [ms, cities] = await Promise.all([api.get('/admin/missions'), api.get('/admin/cities')]);
      view.innerHTML = `<div class="card-h"><h1>Lab Management</h1><div class="r"><button class="btn btn-primary" data-act="new">Create mission</button></div></div>
        <section class="card">${ms.length ? tbl(['Mission', 'Category', 'XP', 'Runs on', 'Answer', 'Hints', 'Attempts', 'Status', ''], ms.map(m => [`<b>${esc(m.title)}</b><br><span class="mono note">${esc(m.code)}</span>`, esc(m.category), m.xpReward, m.provider === 'native' ? 'Academy server' : 'Mission service', m.provider === 'native' ? (m.hasFlag ? chip('Set (hashed)', 'g') : chip('Not set', 'r')) : '<span class="note">In mission service</span>', m._count.hints, m._count.attempts, s2(m.status), `<a class="btn btn-xs btn-primary" href="#/admin/labs/${encodeURIComponent(m.code)}">Open</a>`])) : empty('No missions yet')}</section>
        ${gap('Missions that run in the mission service (mission-api) cannot be started from the Academy until it is linked server to server (OPEN-ITEMS OI-43). Native missions check answers on this server.')}`;
      H.new = () => { const m = modal('Create mission', form('nmF', `<div class="row2"><label>Code<input name="code" class="mono" placeholder="DEF-06"></label><label>XP reward<input name="xp" type="number" min="0" max="10000" value="50"></label></div>
          <label>Title<input name="title" maxlength="150"></label><label>Description<textarea name="desc" maxlength="2000"></textarea></label>
          <div class="row3"><label>Category<select name="cat"><option>Foundations</option><option>Offensive</option><option>Defensive</option><option>GRC</option></select></label><label>Difficulty<input name="diff" placeholder="Easy"></label><label>Minutes<input name="mins" placeholder="20-30"></label></div>
          <div class="row2"><label>City on the map<select name="city"><option value="">None</option>${cities.map(c => `<option value="${esc(c.code)}">${esc(c.name)}</option>`).join('')}</select></label><label>Runs on<select name="prov"><option value="native">Academy server (answer checked here)</option><option value="mission-api">Mission service</option></select></label></div>
          <label class="chk"><input type="checkbox" name="prem"> Paid plan only</label>`), { wide: true, foot: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="nmF" type="submit">Create draft</button>' });
        sub(m, 'nmF', async t => { const b = { code: t.code.value.trim().toUpperCase(), title: t.title.value.trim(), description: t.desc.value.trim(), category: t.cat.value, xpReward: +t.xp.value, premium: t.prem.checked, provider: t.prov.value, status: 'draft' }; if (t.diff.value.trim()) b.difficulty = t.diff.value.trim(); if (t.mins.value.trim()) b.estMinutes = t.mins.value.trim(); if (t.city.value) b.cityCode = t.city.value; await api.post('/admin/missions', b); m.close(); toast('Mission created as a draft.'); location.hash = '#/admin/labs/' + encodeURIComponent(b.code); }); };
    });
    const liveLab = code => page([['Lab Management', '#/admin/labs'], [code]], async () => {
      const [m, done] = await Promise.all([api.get('/admin/missions/' + encodeURIComponent(code)), api.get(`/admin/missions/${encodeURIComponent(code)}/completions`)]);
      const again = msg => { toast(msg); liveLab(code); };
      const hint = n => (m.hints.find(h => h.n === n) || {}).text || '';
      view.innerHTML = `<div class="card-h"><div><h1>${esc(m.title)}</h1><p class="note"><span class="mono">${esc(m.code)}</span> ${s2(m.status)} · ${m.provider === 'native' ? 'Academy server' : 'Mission service'}</p></div>
          <div class="r toolbar">${m.status === 'published' ? '<button class="btn btn-danger" data-act="mst" data-s="retired">Retire</button>' : '<button class="btn btn-primary" data-act="mst" data-s="published">Publish</button>'}</div></div>
        <div class="dash"><section class="card s8"><h2>Mission</h2>${form('mF', `<label>Title<input name="title" value="${esc(m.title)}" maxlength="150"></label><label>Description<textarea name="desc" maxlength="2000">${esc(m.description || '')}</textarea></label>
            <div class="row3"><label>XP reward<input name="xp" type="number" min="0" max="10000" value="${m.xpReward}"></label><label>Difficulty<input name="diff" value="${esc(m.difficulty || '')}"></label><label>Max wrong answers per attempt<input name="maxs" type="number" min="1" max="200" value="${m.maxSubmissions}"></label></div>
            <label class="chk"><input type="checkbox" name="prem" ${m.premium ? 'checked' : ''}> Paid plan only</label><div class="toolbar"><button class="btn btn-primary" type="submit">Save</button></div>`)}
          <h2 style="margin-top:1.2rem">Hints (up to 3)</h2><p class="note">Students pay 5%, 10% and 15% of the reward for hints 1, 2 and 3 (setting gamification.hintPcts).</p>
          ${[1, 2, 3].map(n => `<form class="form" data-sub="hint${n}" style="margin-top:.5rem"><label>Hint ${n}<textarea name="t" maxlength="1000">${esc(hint(n))}</textarea></label><div class="toolbar"><button class="btn btn-sm">Save hint ${n}</button></div></form>`).join('')}</section>
          <aside class="s4" style="display:grid;gap:1rem;align-content:start"><section class="card"><h3>Answer</h3>${m.provider === 'native' ? `<p class="note">Stored as a salted hash. It cannot be shown again, only replaced.</p><p>${m.hasFlag ? chip('Answer set', 'g') : chip('No answer yet', 'r')}</p><button class="btn btn-sm" data-act="flag">${m.hasFlag ? 'Replace answer' : 'Set answer'}</button>` : '<p class="note">Answers for this mission are checked by the mission service.</p>'}</section>
            <section class="card"><h3>Completions (${done.length})</h3>${done.length ? `<div class="list">${done.slice(0, 15).map(d => `<div class="li"><span class="mono">${esc(d.userId.slice(0, 8))}…</span><span class="note">${fDT(d.completedAt)} · +${d.xpAwarded ?? 0} XP</span></div>`).join('')}</div>` : '<p class="note">Nobody has cleared it yet.</p>'}</section></aside></div>`;
      sub(view, 'mF', async t => { const b = { title: t.title.value.trim(), description: t.desc.value.trim(), xpReward: +t.xp.value, premium: t.prem.checked, maxSubmissions: +t.maxs.value }; if (t.diff.value.trim()) b.difficulty = t.diff.value.trim(); await api.patch('/admin/missions/' + encodeURIComponent(code), b); again('Mission saved.'); });
      [1, 2, 3].forEach(n => { H['hint' + n] = async f => { try { await put(`/admin/missions/${encodeURIComponent(code)}/hints`, { n, text: f.t.value.trim() }); again(`Hint ${n} saved.`); } catch (e) { fail(e); } }; });
      H.mst = async b => { const s = b.dataset.s; if (s === 'published' && m.provider === 'native' && !m.hasFlag) return toast('Set the answer before publishing.', true); if (!await confirmBox(s === 'published' ? 'Publish mission' : 'Retire mission', s === 'published' ? 'Students will see it in Incident Response.' : 'Students will no longer see it; completions and XP stay.', 'Confirm', s !== 'published')) return; try { await api.patch('/admin/missions/' + encodeURIComponent(code), { status: s }); again('Mission ' + s + '.'); } catch (e) { fail(e); } };
      H.flag = async () => { const v = await ask('Set the answer', { label: 'Exact answer or flag (stored as a salted hash; it cannot be shown again)', ok: 'Save answer' }); if (!v) return; try { await put(`/admin/missions/${encodeURIComponent(code)}/flag`, { flag: v }); again('Answer saved (hashed).'); } catch (e) { fail(e); } };
    });

    /* ---- Assessments ---- */
    P.assessments = (aid) => aid ? liveAssessment(aid) : page([['Assessments']], async () => {
      const [as, cs, bs] = await Promise.all([api.get('/admin/assessments'), api.get('/admin/courses'), api.admin.batches().then(r => r.items)]);
      const cname = new Map(cs.map(c => [c.id, c.title]));
      view.innerHTML = `<div class="card-h"><h1>Assessments</h1><div class="r"><button class="btn btn-primary" data-act="new" ${cs.length ? '' : 'disabled title="Create a course first"'}>Create assessment</button></div></div>
        <section class="card">${as.length ? tbl(['Assessment', 'Course', 'Kind', 'Due', 'Status', 'Questions', 'Attempts', ''], as.map(a => [`<b>${esc(a.title)}</b><br><span class="mono note">${esc(a.code)} · pass ${a.passMarks}/${a.maxMarks}</span>`, esc(cname.get(a.courseId) || ''), esc(a.kind), a.dueAt ? fDT(a.dueAt) : '–', s2(a.status), a._count.questions, a._count.attempts, `<a class="btn btn-xs btn-primary" href="#/admin/assessments/${a.id}">Open</a>`])) : empty('No assessments yet')}</section>`;
      H.new = () => { const m = modal('Create assessment', form('naF', `<div class="row2"><label>Course<select name="course">${cs.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join('')}</select></label><label>Batch (optional)<select name="batch"><option value="">Every batch running the course</option>${bs.map(b => `<option value="${b.id}">${esc(b.code)}</option>`).join('')}</select></label></div>
          <div class="row2"><label>Code<input name="code" class="mono" placeholder="Q-SOC-1"></label><label>Title<input name="title" maxlength="150"></label></div>
          <div class="row3"><label>Kind<select name="kind">${['quiz', 'assignment', 'lab_challenge', 'practical', 'exam'].map(k => `<option>${k}</option>`).join('')}</select></label><label>Answer format<select name="format"><option value="questions">Questions (auto-graded)</option><option value="text">Written answer</option><option value="lab_result">Lab result</option><option value="file">File</option></select></label><label>Results<select name="rel"><option value="manual">Released by staff</option><option value="immediate">Immediately</option><option value="after_due">After the deadline</option></select></label></div>
          <div class="row3"><label>Max marks<input name="max" type="number" min="1" max="1000" value="10"></label><label>Pass marks<input name="pass" type="number" min="0" max="1000" value="6"></label><label>Due<input name="due" type="datetime-local"></label></div>`), { wide: true, foot: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="naF" type="submit">Create draft</button>' });
        sub(m, 'naF', async t => { const b = { courseId: t.course.value, code: t.code.value.trim().toUpperCase(), title: t.title.value.trim(), kind: t.kind.value, format: t.format.value, resultsRelease: t.rel.value, maxMarks: +t.max.value, passMarks: +t.pass.value }; if (t.batch.value) b.batchId = t.batch.value; if (t.due.value) b.dueAt = new Date(t.due.value).toISOString(); const r = await api.post('/admin/assessments', b); m.close(); toast('Draft created.'); location.hash = '#/admin/assessments/' + r.id; }); };
    });
    const liveAssessment = aid => page([['Assessments', '#/admin/assessments'], ['…']], async () => {
      const [a, subs, rep] = await Promise.all([api.get('/admin/assessments/' + aid), api.get(`/admin/assessments/${aid}/submissions`), api.get(`/admin/assessments/${aid}/report`)]);
      setCrumb([['Assessments', '#/admin/assessments'], [a.title]]);
      const again = msg => { toast(msg); liveAssessment(aid); };
      const key = q => q.kind === 'short_text' ? (q.answerKey || []).join(' / ') : [].concat(q.answerKey).map(i => (q.options || [])[i]).join(', ');
      view.innerHTML = `<div class="card-h"><div><h1>${esc(a.title)}</h1><p class="note"><span class="mono">${esc(a.code)}</span> ${s2(a.status)} · ${esc(a.kind)} · ${esc(a.format)} · pass ${a.passMarks}/${a.maxMarks}${a.dueAt ? ' · due ' + fDT(a.dueAt) : ''}</p></div>
          <div class="r toolbar">${a.status === 'draft' ? '<button class="btn btn-primary" data-act="ast" data-s="published">Publish</button>' : a.status === 'published' ? '<button class="btn" data-act="ast" data-s="closed">Close</button>' : ''}${a.resultsRelease === 'manual' && !a.releasedAt ? '<button class="btn" data-act="rel">Release results</button>' : ''}</div></div>
        <div class="grid g4"><div class="stat"><b>${rep.submitted}</b><span>Waiting to grade</span></div><div class="stat green"><b>${rep.graded}</b><span>Graded</span></div><div class="stat blue"><b>${rep.average ?? '–'}</b><span>Average score</span></div><div class="stat ${rep.passRatePct != null && rep.passRatePct < 50 ? 'red' : ''}"><b>${rep.passRatePct == null ? '–' : rep.passRatePct + '%'}</b><span>Pass rate</span></div></div>
        <p class="note">${esc(rep.rule)}</p>
        ${a.format === 'questions' ? `<section class="card" style="margin-top:1rem"><div class="card-h"><h2>Questions (${a.questions.length})</h2><div class="r">${a.status === 'draft' ? '<button class="btn btn-sm" data-act="addQ">Add question</button>' : ''}</div></div>${a.questions.length ? tbl(['#', 'Question', 'Kind', 'Answer key', 'Marks'], a.questions.map((q, i) => [i + 1, esc(q.prompt) + (q.options && q.options.length ? `<br><small class="note">${q.options.map(esc).join(' · ')}</small>` : ''), esc(q.kind), `<span class="mono">${esc(key(q))}</span>`, q.marks])) : '<p class="note">No questions yet.</p>'}<p class="note">Answer keys are shown to staff only; students never receive them.</p></section>` : ''}
        <section class="card" style="margin-top:1rem"><h2>Submissions</h2>${subs.length ? tbl(['Student', 'Submitted', 'State', 'Score', ''], subs.map(s => [`<b>${esc((s.student && s.student.name) || '')}</b><br><span class="mono note">${esc((s.student && s.student.code) || '')}</span>`, s.submittedAt ? fDT(s.submittedAt) : '–', s2(s.status), s.score == null ? '–' : `${s.score}/${a.maxMarks}`, `<button class="btn btn-xs" data-act="grade" data-id="${s.id}">${s.score == null ? 'Grade' : 'Change'}</button>`])) : empty('No submissions yet')}</section>`;
      H.ast = async b => { try { await api.post(`/admin/assessments/${aid}/status`, { status: b.dataset.s }); again('Status changed.'); } catch (e) { fail(e); } };
      H.rel = async () => { if (!await confirmBox('Release results', 'Students see their scores and feedback, and graded students are notified.', 'Release')) return; try { await api.post(`/admin/assessments/${aid}/release`); again('Results released.'); } catch (e) { fail(e); } };
      H.addQ = () => { const m = modal('Add question', form('qF', `<label>Question<textarea name="p" maxlength="2000"></textarea></label><label>Kind<select name="k"><option value="single">One correct option</option><option value="multi">Several correct options</option><option value="short_text">Short text answer</option></select></label>
          <label>Options (one per line; for choice questions)<textarea name="o" rows="4"></textarea></label><label>Answer key<input name="key" placeholder="Choice: option numbers from 1, e.g. 2 or 1,3. Text: accepted answers separated by |"></label><label>Marks<input name="marks" type="number" min="0" max="100" value="1"></label>`), { wide: true, foot: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="qF" type="submit">Add</button>' });
        sub(m, 'qF', async t => { const k = t.k.value, opts = t.o.value.split('\n').map(x => x.trim()).filter(Boolean), raw = t.key.value.trim();
          const answerKey = k === 'short_text' ? raw.split('|').map(x => x.trim()).filter(Boolean) : k === 'single' ? (+raw - 1) : raw.split(',').map(x => +x.trim() - 1);
          await api.post(`/admin/assessments/${aid}/questions`, { kind: k, prompt: t.p.value.trim(), ...(k === 'short_text' ? {} : { options: opts }), answerKey, marks: +t.marks.value, sortOrder: a.questions.length + 1 }); m.close(); again('Question added.'); }); };
      H.grade = b => { const s = subs.find(x => x.id === b.dataset.id); const m = modal('Grade submission', form('gF', `${s.textResponse ? `<div class="card"><p>${esc(s.textResponse)}</p></div>` : s.labRef ? `<p>Lab: <b class="mono">${esc(s.labRef)}</b></p>` : ''}<label>Score (0 to ${a.maxMarks})<input name="sc" type="number" min="0" max="${a.maxMarks}" value="${s.score ?? ''}"></label><label>Feedback<textarea name="fb" maxlength="4000">${esc(s.feedback || '')}</textarea></label><label class="chk"><input type="checkbox" name="ret"> Return for revision</label>${s.score != null ? '<label>Reason for changing the grade<input name="why" maxlength="300"></label>' : ''}`), { wide: true, foot: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="gF" type="submit">Save grade</button>' });
        sub(m, 'gF', async t => { const body = { score: +t.sc.value, returnForRevision: t.ret.checked }; if (t.fb.value.trim()) body.feedback = t.fb.value.trim(); if (t.why && t.why.value.trim()) body.reason = t.why.value.trim(); await api.post(`/admin/attempts/${s.id}/grade`, body); m.close(); again('Grade saved.'); }); };
    });
  }

  /* Analytics, Insight Engine, Student reports and Certificates with the Yojo API. Every figure comes from stored
     records with its definition; insights are fixed rules (not AI); empty data shows as empty, never as a sample. */
  if (LIVE && LIVE.user) {
    const api = window.YojoAPI;
    const nz = v => (v === null || v === undefined ? '–' : v);
    const TR = ['Offensive', 'Defensive', 'GRC'];

    /* ---- Analytics ---- */
    P.analytics = () => page([['Analytics']], async () => {
      const d = await api.get('/admin/lms/analytics'); const D = d.definitions;
      const tile = (v, label, cls, def) => `<div class="stat ${cls || ''}"><b>${v}</b><span>${label}</span>${def ? `<small class="note">${esc(def)}</small>` : ''}</div>`;
      const max = Math.max(1, d.students.total);
      view.innerHTML = `<div class="card-h"><div><h1>Analytics</h1><p class="note">Computed from the live records · ${fDT(d.generatedAt)}</p></div><div class="r toolbar"><button class="btn btn-sm" data-act="ex">Export summary CSV</button></div></div>
        <div class="grid g4">${tile(d.students.total, 'Active students', 'cyan')}${tile(d.students.free, 'Free', 'blue')}${tile(d.students.paid, 'Paid', 'green')}${tile(d.students.newLast30Days, 'Joined in the last 30 days')}</div>
        <p class="note">${esc(D.students)}</p>
        <div class="grid g4" style="margin-top:1rem">${tile(d.engagement.activeLast7Days, 'Active in the last 7 days', 'green')}${tile(d.engagement.xpAwardedLast7Days.toLocaleString('en-IN'), 'XP awarded, last 7 days', 'blue')}${tile(d.engagement.studentsWithStreak, 'Students with a streak')}${tile(d.learning.certificatesValid, 'Valid certificates', 'cyan')}</div>
        <div class="dash" style="margin-top:1rem">
          <section class="card s6"><h2>Career paths</h2>${bars(Object.entries(d.paths).map(([k, n]) => ({ label: k, v: n, unit: '', w: 100 * n / max })))}<p class="note">${esc(D.paths)}</p></section>
          <section class="card s6"><h2>Career-path quiz</h2>${bars([['Taken', d.careerQuiz.taken], ['Skipped (picked a path)', d.careerQuiz.skipped], ['Not done', d.careerQuiz.none]].map(([k, n]) => ({ label: k, v: n, unit: '', w: 100 * n / max })))}
            <p class="note">Average result of those who took it: ${TR.map(t => `${t} ${nz(d.careerQuiz.averagePercentages[t])}${d.careerQuiz.averagePercentages[t] == null ? '' : '%'}`).join(' · ')}</p><p class="note">${esc(D.careerQuiz)}</p></section>
          <section class="card s6"><h2>Learning</h2><dl class="kv2"><dt>Published courses</dt><dd>${d.learning.coursesPublished}</dd><dt>Active enrolments</dt><dd>${d.learning.activeEnrolments}</dd><dt>Lessons completed, last 30 days</dt><dd>${d.learning.lessonsCompletedLast30Days}</dd><dt>Students by origin</dt><dd>${Object.entries(d.students.byOrigin).map(([k, n]) => `${esc(k)} ${n}`).join(' · ') || '–'}</dd></dl></section>
          <section class="card s6"><h2>Labs cleared</h2>${d.labs.length ? bars(d.labs.slice(0, 10).map(l => ({ label: l.code, v: l.clears, unit: '', w: 100 * l.clears / Math.max(...d.labs.map(x => x.clears)) }))) : '<p class="note">No lab has been cleared yet.</p>'}<p class="note">${esc(D.labs)}</p></section>
          <section class="card s12"><h2>Assessments</h2>${d.assessments.length ? tbl(['Assessment', 'Submissions', 'Graded', 'Pass rate'], d.assessments.map(a => [`<a href="#/admin/assessments/${a.id}">${esc(a.title)}</a>`, a.submissions, a.graded, a.passRate == null ? '–' : pbar(a.passRate)])) : empty('No published assessments yet')}<p class="note">${esc(D.assessments)}</p></section>
          <section class="card s12"><h2>Batches</h2>${d.cohorts.length ? tbl(['Batch', 'Students', 'Attendance avg', 'Performance avg', 'Flagged'], d.cohorts.map(c => [`<b>${esc(c.batch)}</b> <span class="note">${esc(c.name)}</span>`, c.students, c.attendanceAvg == null ? '–' : pbar(c.attendanceAvg), nz(c.performanceAvg), c.flagged ? chip(c.flagged, 'r') : chip('0', 'g')])) : empty('No active batches')}<p class="note">${esc(D.cohorts)}</p></section>
        </div>
        <p class="note" style="margin-top:1rem">Analytics never show passwords, codes, payment data, lab answers or private messages.</p>
        ${gap('Trends over months need stored daily snapshots; these figures are computed live, so there is no history yet. Payments are not connected, so no revenue figures.')}`;
      H.ex = () => { csv('yojo-analytics.csv', [['Metric', 'Value'], ['Active students', d.students.total], ['Free', d.students.free], ['Paid', d.students.paid], ['Joined last 30 days', d.students.newLast30Days], ['Active last 7 days', d.engagement.activeLast7Days], ['XP awarded last 7 days', d.engagement.xpAwardedLast7Days], ...Object.entries(d.paths).map(([k, n]) => ['Path ' + k, n]), ['Quiz taken', d.careerQuiz.taken], ['Quiz skipped', d.careerQuiz.skipped], ['Quiz not done', d.careerQuiz.none], ...d.cohorts.map(c => ['Batch ' + c.batch + ' attendance %', c.attendanceAvg ?? ''])]); toast('CSV downloaded.'); };
    });

    /* ---- Insight Engine: rule-based ---- */
    LIVE.insightsPage = () => page([['Insight Engine']], async () => {
      const r = await api.get('/admin/lms/insights');
      const SEV = { High: 'r', Medium: 'a', Low: 'b' };
      const live = r.insights.filter(i => i.count), quiet = r.insights.filter(i => !i.count);
      view.innerHTML = `<div class="card-h"><div><h1>Insight Engine</h1><p class="note">${esc(r.note)} · ${fDT(r.generatedAt)}</p></div><div class="r">${chip('Rule-based', 'b')}</div></div>
        ${live.length ? live.map(i => `<article class="card" style="margin-bottom:.8rem"><div class="card-h"><h3 style="margin:0">${esc(i.label)}</h3><div class="r">${chip(i.severity, SEV[i.severity])}${chip(i.count + (i.count === 1 ? ' match' : ' matches'))}</div></div>
            <p class="note"><b>Rule:</b> ${esc(i.definition)}</p>
            <div class="list">${i.items.map(x => `<div class="li"><div class="grow"><b>${x.link ? `<a href="${esc(x.link)}">${esc(x.label)}</a>` : esc(x.label)}</b><span class="note">${esc(x.detail)}</span></div></div>`).join('')}</div>${i.count > i.items.length ? `<p class="note">and ${i.count - i.items.length} more</p>` : ''}</article>`).join('') : `<div class="card">${empty('Nothing needs attention', 'No rule matched any record right now.')}</div>`}
        <section class="card" style="margin-top:1rem"><h3>Rules with no matches</h3><div class="list">${quiet.map(i => `<div class="li"><div class="grow"><b>${esc(i.label)}</b><span class="note">${esc(i.definition)}</span></div>${chip('0', 'g')}</div>`).join('') || '<p class="note">Every rule has matches.</p>'}</div></section>
        ${gap('Page-usage analytics (sessions, load times, friction, journeys) need an event-collection service on the server; the browser demo kept them locally. An AI insight feed is not connected and is not simulated here.')}`;
    });

    /* ---- Student reports ---- */
    const quizCell = q => q.status === 'taken' ? `${TR.map(t => `${t[0]} ${q.percentages[t]}%`).join(' · ')}<br><small class="note">suggested ${esc(q.suggested)}</small>` : q.status === 'skipped' ? chip('Skipped', '') : '<span class="note">Not done</span>';
    P.reports = (sid, _a, qs) => (sid || (qs && qs.get('sid'))) ? liveReport(sid || qs.get('sid')) : page([['Student Reports']], async () => {
      const bs = await api.admin.batches().then(x => x.items);
      const f = { q: '', path: '', quiz: '', batchId: '' }; let cur = null, tm;
      const render = async () => {
        const qs2 = new URLSearchParams(Object.entries(f).filter(([, v]) => v)); if (cur) qs2.set('cursor', cur);
        const r = await api.get('/admin/student-reports?' + qs2.toString());
        $('#rList').innerHTML = `<p class="note">${r.total} student${r.total === 1 ? '' : 's'}</p>` + (r.items.length ? tbl(['Student', 'Batch', 'Path', 'Career quiz', 'XP', 'Streak', 'Last active', ''], r.items.map(s => [`<b>${esc(s.name || s.email)}</b><br><span class="mono note">${esc(s.code)} · ${esc(s.origin)}</span>`, esc(s.batches.join(', ') || '–'), s.path ? chip(s.path, s.path === 'Offensive' ? 'r' : s.path === 'Defensive' ? 'b' : 'g') : '<span class="note">Not chosen</span>', quizCell(s.quiz), s.xp, s.streak, s.lastActive ? fDT(s.lastActive) : '–', `<a class="btn btn-xs btn-primary" href="#/admin/reports/${s.id}">Report</a>`])) : empty('No students match these filters'))
          + (r.nextCursor ? `<div class="toolbar"><button class="btn btn-sm" data-act="more" data-c="${esc(r.nextCursor)}">Next page</button></div>` : '');
      };
      view.innerHTML = `<div class="card-h"><h1>Student Reports</h1></div>
        <div class="card toolbar"><label style="flex:2;min-width:200px">Search<input data-inp="q" placeholder="Name, email or student ID"></label>
          <label>Path<select data-chg="path"><option value="">All</option>${TR.map(t => `<option>${t}</option>`).join('')}</select></label>
          <label>Career quiz<select data-chg="quiz"><option value="">All</option><option value="taken">Taken</option><option value="skipped">Skipped</option><option value="none">Not done</option></select></label>
          <label>Batch<select data-chg="batchId"><option value="">All</option>${bs.map(b => `<option value="${b.id}">${esc(b.code)}</option>`).join('')}</select></label></div>
        <div id="rqOpen"></div><div id="rList"></div><p class="note" style="margin-top:.6rem">Opening a full report is recorded in the audit log.</p>`;
      api.get('/admin/student-requests?status=open').then(q => { const el = $('#rqOpen'); if (el && q.items.length) el.innerHTML = `<section class="card" style="margin-bottom:1rem"><div class="card-h"><h2>Open requests from trainers</h2><div class="r">${chip(q.items.length + ' open', 'a')}</div></div>${tbl(['Request', 'Student', 'Raised by', 'When', ''], q.items.map(x => [`<b>${esc(x.code)}</b> · ${x.kind === 'escalation' ? 'Escalation' : 'Contact guardian'}<br><small class="note">${esc(x.reason)}</small>`, esc(x.student || ''), esc(x.raisedBy || ''), fDT(x.createdAt), `<a class="btn btn-xs btn-primary" href="#/admin/reports/${x.studentId}">Open report</a>`]))}</section>`; }, () => {});
      H.q = el => { clearTimeout(tm); tm = setTimeout(() => { f.q = el.value.trim(); cur = null; render(); }, 250); };
      ['path', 'quiz', 'batchId'].forEach(k => H[k] = el => { f[k] = el.value; cur = null; render(); });
      H.more = b => { cur = b.dataset.c; render(); };
      await render();
    });
    const liveReport = id => page([['Student Reports', '#/admin/reports'], ['…']], async () => {
      const r = await api.get('/admin/student-reports/' + id), p = r.profile, cp = r.careerPath, g = r.gamification, a = r.attendance, pl = r.placement;
      setCrumb([['Student Reports', '#/admin/reports'], [p.name || p.email]]);
      const latest = cp.history[0];
      view.innerHTML = `<div class="card-h"><div><h1>${esc(p.name || p.email)}</h1><p class="note"><span class="mono">${esc(p.code)}</span> · ${esc(p.email)} · ${esc(p.origin)} · joined ${fD(p.joinedAt)}${p.lastLogin ? ' · last sign-in ' + fDT(p.lastLogin) : ''}</p></div><div class="r"><button class="btn btn-sm" data-act="print">Print</button></div></div>
        <div class="grid g4"><div class="stat cyan"><b>${g.xp.toLocaleString('en-IN')}</b><span>XP · ${esc(g.rank.name)}</span></div><div class="stat"><b>${g.streak.current}</b><span>Streak (longest ${g.streak.longest})</span></div><div class="stat ${a.pct != null && a.pct < a.requiredPct ? 'red' : 'green'}"><b>${a.pct == null ? '–' : a.pct + '%'}</b><span>Attendance (needs ${a.requiredPct}%)</span></div><div class="stat blue"><b>${pl.overall}%</b><span>Placement readiness</span></div></div>
        <div class="dash" style="margin-top:1rem">
          <section class="card s6"><h2>Career path</h2><p>Current path: ${cp.path ? chip(cp.path, 'b') : '<span class="note">Not chosen yet</span>'}</p>
            ${latest ? (latest.skipped ? `<p class="note">Quiz skipped on ${fD(latest.at)}; chose ${esc(latest.chosenPath || '–')}.</p>` : `${bars(TR.map(t => ({ label: t, v: latest.percentages[t], w: latest.percentages[t] })))}<p class="note">Quiz on ${fD(latest.at)} · suggested ${esc(latest.suggested)}${latest.tiedWith.length ? ' (tied with ' + latest.tiedWith.map(esc).join(', ') + ')' : ''} · chose ${esc(latest.chosenPath || 'not yet')}${latest.chosenAt ? ' on ' + fD(latest.chosenAt) : ''}</p>`) : '<p class="note">Career-path quiz not taken.</p>'}
            ${cp.history.length > 1 ? `<details><summary>History (${cp.history.length})</summary>${tbl(['Date', 'Result', 'Suggested', 'Chosen'], cp.history.map(h => [fD(h.at), h.skipped ? 'Skipped' : TR.map(t => `${t[0]} ${h.percentages[t]}%`).join(' · '), esc(h.suggested || '–'), esc(h.chosenPath || '–')]))}</details>` : ''}
            ${cp.olderQuestionnaire ? `<p class="note">Earlier 18-question questionnaire: ${esc(cp.olderQuestionnaire.primary)} (${TR.map(t => `${t[0]} ${cp.olderQuestionnaire.scores[t]}`).join(' · ')}).</p>` : ''}</section>
          <section class="card s6"><h2>Enrolments and courses</h2>${r.enrolments.length ? tbl(['Batch', 'Course', 'Status'], r.enrolments.map(e => [esc(e.batch), esc(e.course || '–'), esc(e.status)])) : '<p class="note">Not in a batch.</p>'}
            ${r.courses.length ? tbl(['Course', 'State', 'Progress'], r.courses.map(c => [esc(c.title), esc(c.state), c.progress ? `${c.progress.done}/${c.progress.total}` : '–'])) : ''}
            ${r.certificates.length ? `<p class="note">Certificates: ${r.certificates.map(c => esc((c.course && c.course.title) || c.code) + (c.revokedAt ? ' (revoked)' : '')).join(', ')}</p>` : ''}</section>
          <section class="card s6"><h2>Attendance</h2><dl class="kv2">${['present', 'late', 'absent', 'excused', 'unmarked'].map(k => `<dt>${k}</dt><dd>${a.counts[k]}</dd>`).join('')}</dl>${a.byCourse.length ? bars(a.byCourse.map(c => ({ label: c.course, v: c.pct ?? 0, w: c.pct ?? 0, c: (c.pct ?? 100) < a.requiredPct ? 'amber' : '' }))) : ''}</section>
          <section class="card s6"><h2>Assessments</h2>${(r.assessments.items || r.assessments).length ? tbl(['Assessment', 'Score', 'Result'], (r.assessments.items || r.assessments).map(x => [esc(x.title), x.score == null ? '–' : `${x.score}/${x.maxMarks}`, x.passed == null ? '–' : x.passed ? chip('Passed', 'g') : chip('Not passed', 'r')])) : '<p class="note">No released results yet.</p>'}</section>
          <section class="card s6"><h2>Labs</h2><p>${r.labs.cleared} cleared</p>${r.labs.recent.length ? `<div class="list">${r.labs.recent.map(l => `<div class="li"><span class="mono">${esc(l.code)}</span><span class="note">${fDT(l.at)}</span></div>`).join('')}</div>` : ''}</section>
          <section class="card s6"><h2>Requests from trainers</h2>${r.requests.length ? `<div class="list">${r.requests.map(q => `<div class="li ${q.status === 'open' ? 'amber' : 'green'}"><div class="grow"><b>${esc(q.code)} · ${q.kind === 'escalation' ? 'Escalation' : 'Contact the guardian'}</b><span class="note">${esc(q.reason)} · ${esc(q.raisedBy || '')} · ${fDT(q.createdAt)}</span>${q.resolution ? `<span class="note">Resolved: ${esc(q.resolution)}</span>` : ''}</div>${q.status === 'open' ? `<button class="btn btn-xs btn-primary" data-act="rqRes" data-id="${q.id}">Resolve</button>` : chip('resolved', 'g')}</div>`).join('')}</div>` : '<p class="note">No requests about this student.</p>'}</section>
          <section class="card s6"><h2>Trainer remarks</h2>${r.remarks.length ? `<div class="list">${r.remarks.map(m => `<div class="li ${m.kind === 'remark' ? 'green' : 'blue'}"><div class="grow"><b>${esc(m.text)}</b><span class="note">${m.kind === 'remark' ? 'Remark' : 'Private note'} · ${esc(m.author)} · ${fDT(m.createdAt)}${m.history.length ? ' · edited ' + m.history.length + '×' : ''}</span></div></div>`).join('')}</div>` : '<p class="note">No remarks yet.</p>'}</section>
          <section class="card s6"><h2>Placement</h2><dl class="kv2"><dt>Resume</dt><dd>${pl.parts.resume.pct}% (${esc(pl.parts.resume.status)})</dd><dt>Mock interviews</dt><dd>${pl.parts.mock.done} of ${pl.parts.mock.target} (${pl.parts.mock.pct}%)</dd><dt>Communication skill</dt><dd>${pl.parts.mock.communicationAvg == null ? 'No interview yet' : pl.parts.mock.communicationAvg + ' / 5 (' + pl.parts.mock.communicationPct + '%)'}</dd><dt>Portfolio</dt><dd>${pl.parts.portfolio.approved} of ${pl.parts.portfolio.target} approved</dd><dt>Internship</dt><dd>${pl.parts.internship.pct}%</dd></dl></section>
        </div>`;
      H.print = () => window.print();
      H.rqRes = async b => { const t2 = await ask('Resolve request', { label: 'What did you do? (the trainer sees this)', ok: 'Resolve' }); if (!t2) return; try { await api.post(`/admin/student-requests/${b.dataset.id}/resolve`, { resolution: t2 }); toast('Resolved. The trainer is notified.'); liveReport(id); } catch (e) { fail(e); } };
    });

    /* ---- Intel Review: students' blogs from the Academy Intel section (review, approve, request changes, reject) ---- */
    const BST = { in_review: ['In review', 'a'], changes_requested: ['Changes requested', 'b'], published: ['Published', 'g'], rejected: ['Rejected', 'r'], unpublished: ['Unpublished', ''] };
    let blogTab = 'in_review';
    P.blogs = (tab) => page([['Intel Review']], async () => {
      if (tab && BST[tab]) blogTab = tab;
      const [rows, n, reps] = await Promise.all([api.get('/admin/blogs?status=' + blogTab), api.get('/admin/blogs/counts'), api.get('/admin/content-reports').catch(() => [])]);
      let q = '';
      view.innerHTML = `<div class="card-h"><div><h1>Intel Review</h1><p class="note">Blogs students write in the Academy Intel section. Only published blogs are visible to other students.</p></div><div class="r">${n.in_review ? chip(n.in_review + ' waiting', 'a') : chip('Queue clear', 'g')}</div></div>
        <div class="tabs" role="tablist">${Object.entries(BST).map(([k, [l]]) => `<button role="tab" aria-selected="${k === blogTab}" data-act="bTab" data-t="${k}">${l} (${n[k]})</button>`).join('')}</div>
        <div class="card toolbar"><label style="flex:1;min-width:220px">Search<input data-inp="bQ" placeholder="Title, author, student ID or tag"></label></div>
        <section class="card" id="bList"></section>
        ${reps.length ? `<section class="card"><div class="card-h"><h2>Reported by students</h2><div class="r">${chip(reps.length + ' open', 'r')}</div></div>${tbl(['Reported', 'What', 'Reason', ''], reps.map(r => [fDT(r.createdAt), r.blogId ? 'A blog' : 'A comment', esc(r.reason), `<button class="btn btn-xs" data-act="bRep" data-id="${r.id}">Resolve</button>`]))}</section>` : ''}
        <p class="hidden-note">Approve publishes the blog and notifies the student. Request changes and Reject need a note, which the student sees. Every decision is kept in the blog's history and the audit log.</p>`;
      const draw = () => {
        const f = rows.filter(b => !q || [b.title, b.author, b.authorCode, ...(b.tags || [])].join(' ').toLowerCase().includes(q));
        $('#bList').innerHTML = f.length ? tbl(['Blog', 'Author', 'Sent for review', 'Reading', ''], f.map(b => [`<b>${esc(b.title)}</b>${b.tags.length ? `<br>${b.tags.map(t => chip('#' + t, '')).join(' ')}` : ''}${b.reviewNote ? `<br><small class="note">Note: ${esc(b.reviewNote)}</small>` : ''}`, `${esc(b.author || '–')}<br><small class="note mono">${esc(b.authorCode || '')}</small>`, b.submittedAt ? fDT(b.submittedAt) : '–', b.readingMinutes + ' min', `<button class="btn btn-xs btn-primary" data-act="bOpen" data-id="${b.id}">${blogTab === 'in_review' ? 'Review' : 'Open'}</button>`])) : empty(blogTab === 'in_review' ? 'Nothing waiting for review' : 'No blogs here', q ? 'Try another search.' : '');
      };
      draw();
      H.bQ = el => { q = el.value.trim().toLowerCase(); draw(); };
      H.bTab = b => { location.hash = '#/admin/blogs/' + b.dataset.t; };
      const decide = async (id, decision, m) => {
        let note;
        if (decision !== 'approve') {
          note = await ask(decision === 'reject' ? 'Reject this blog' : 'Request changes', { label: decision === 'reject' ? 'Reason (the student sees this)' : 'What should the student change? (they see this)', ok: decision === 'reject' ? 'Reject' : 'Send back', danger: decision === 'reject' });
          if (!note) return;
        }
        try { await api.post(`/admin/blogs/${id}/decision`, note ? { decision, note } : { decision }); m.close(); toast({ approve: 'Published. The student is notified.', request_changes: 'Sent back to the student with your note.', reject: 'Rejected. The student sees your reason.' }[decision]); P.blogs(); } catch (e) { fail(e); }
      };
      H.bOpen = async btn => {
        const b = rows.find(x => x.id === btn.dataset.id), hist = await api.get(`/admin/blogs/${b.id}/history`).catch(() => []);
        const ACT = { submitted: 'Sent for review', approve: 'Approved', request_changes: 'Changes requested', reject: 'Rejected', unpublished: 'Unpublished' };
        const actions = b.status === 'in_review'
          ? '<button class="btn" data-x>Close</button><button class="btn btn-danger" data-bd="reject">Reject</button><button class="btn" data-bd="request_changes">Request changes</button><button class="btn btn-primary" data-bd="approve">Approve and publish</button>'
          : b.status === 'published' ? '<button class="btn" data-x>Close</button><button class="btn btn-danger" data-bd="unpublish">Unpublish</button>' : '<button class="btn" data-x>Close</button>';
        const m = modal(b.title, `<p class="note">${esc(b.author || '')} <span class="mono">${esc(b.authorCode || '')}</span> · ${chip(BST[b.status][0], BST[b.status][1])} · ${b.readingMinutes} min read${b.submittedAt ? ' · sent ' + fDT(b.submittedAt) : ''}</p>
          ${b.tags.length ? `<p>${b.tags.map(t => chip('#' + t, '')).join(' ')}</p>` : ''}
          <div class="card" style="white-space:pre-wrap;max-height:50vh;overflow:auto;line-height:1.55">${esc(b.body)}</div>
          ${hist.length ? `<details style="margin-top:.8rem"><summary class="note">History (${hist.length})</summary><div class="list">${hist.map(h => `<div class="li"><span class="t">${fDT(h.at)}</span><div class="grow"><b>${esc(ACT[h.action] || h.action)}</b>${h.note ? `<span class="note">${esc(h.note)}</span>` : ''}</div></div>`).join('')}</div></details>` : ''}`, { wide: true, foot: actions });
        m.addEventListener('click', async e => {
          const d = e.target.closest('[data-bd]'); if (!d) return;
          if (d.dataset.bd !== 'unpublish') return decide(b.id, d.dataset.bd, m);
          const r = await ask('Unpublish this blog', { label: 'Reason (kept in the history)', ok: 'Unpublish', danger: true }); if (!r) return;
          try { await api.post(`/admin/blogs/${b.id}/unpublish`, { reason: r }); m.close(); toast('Unpublished. Students no longer see it.'); P.blogs(); } catch (x) { fail(x); }
        });
      };
      H.bRep = async b => { const r = await ask('Resolve report', { label: 'What did you do?', ok: 'Resolve' }); if (!r) return; try { await api.post(`/admin/content-reports/${b.dataset.id}/resolve`, { reason: r }); toast('Report resolved.'); P.blogs(); } catch (e) { fail(e); } };
    });

    /* ---- Certificates ---- */
    P.certificates = () => page([['Certificates']], async () => {
      const cs = await api.get('/admin/courses'); const f = { q: '', status: '', courseId: '' }; let tm;
      const render = async () => {
        const rows = await api.get('/admin/certificates?' + new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString());
        $('#ctList').innerHTML = rows.length ? tbl(['Code', 'Student', 'Course', 'Issued', 'Status', ''], rows.map(c => [`<span class="mono">${esc(c.code)}</span>`, `<b>${esc(c.student.name || '')}</b><br><span class="note">${esc(c.student.email || '')}</span>`, esc(c.course), `${fD(c.issuedAt)}<br><span class="note">by ${esc(c.issuedBy || '–')}</span>`, c.revokedAt ? chip('Revoked', 'r') + `<br><span class="note">${esc(c.revokeReason || '')}</span>` : chip('Valid', 'g'), c.revokedAt ? '' : `<button class="btn btn-xs btn-danger" data-act="rev" data-c="${esc(c.code)}">Revoke</button>`])) : empty('No certificates match');
      };
      view.innerHTML = `<div class="card-h"><h1>Certificates</h1><div class="r toolbar"><button class="btn" data-act="ver">Verify a code</button><button class="btn btn-primary" data-act="issue">Issue certificate</button></div></div>
        <div class="card toolbar"><label style="flex:2;min-width:200px">Search<input data-inp="q" placeholder="Code, student name or email"></label><label>Status<select data-chg="status"><option value="">All</option><option value="valid">Valid</option><option value="revoked">Revoked</option></select></label>
          <label>Course<select data-chg="courseId"><option value="">All</option>${cs.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join('')}</select></label></div><div id="ctList"></div>
        <p class="note" style="margin-top:.6rem">A certificate can be issued only when the student has completed every required lesson of a course that offers one. Anyone can check a code at the public verify link.</p>
        ${gap('Certificate PDFs need a PDF service, which is not connected yet.')}`;
      H.q = el => { clearTimeout(tm); tm = setTimeout(() => { f.q = el.value.trim(); render(); }, 250); };
      H.status = el => { f.status = el.value; render(); }; H.courseId = el => { f.courseId = el.value; render(); };
      H.rev = async b => { const r = await ask('Revoke certificate ' + b.dataset.c, { label: 'Reason (kept with the certificate)', ok: 'Revoke', danger: true }); if (!r) return; try { await api.post(`/admin/certificates/${encodeURIComponent(b.dataset.c)}/revoke`, { reason: r }); toast('Certificate revoked.'); render(); } catch (e) { fail(e); } };
      H.ver = async () => { const c = await ask('Verify a certificate', { label: 'Certificate code', ok: 'Verify' }); if (!c) return; try { const v = await api.get('/certificates/' + encodeURIComponent(c.trim()) + '/verify'); modal('Certificate ' + v.code, `<p>${v.valid ? chip('Valid', 'g') : chip('Revoked', 'r')}</p><dl class="kv2"><dt>Holder</dt><dd>${esc(v.holder)}</dd><dt>Course</dt><dd>${esc(v.course)}</dd><dt>Issued</dt><dd>${fD(v.issuedAt)}</dd>${v.revokedAt ? `<dt>Revoked</dt><dd>${fD(v.revokedAt)}</dd>` : ''}</dl>`); } catch (e) { fail(e); } };
      H.issue = () => { const m = modal('Issue certificate', `<form class="form" id="icF"><label>Student (search by name or email)<input id="icQ" placeholder="Type at least 3 letters"></label><select id="icS" size="5" style="width:100%"></select>
          <label>Course<select id="icC">${cs.filter(c => c.status === 'published').map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join('')}</select></label><p class="err" id="icE"></p></form>`, { foot: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="icF" type="submit">Issue</button>' });
        let t2; $('#icQ', m).addEventListener('input', e => { clearTimeout(t2); const q = e.target.value.trim(); if (q.length < 3) return; t2 = setTimeout(async () => { const r = await api.get('/admin/student-reports?q=' + encodeURIComponent(q)); $('#icS', m).innerHTML = r.items.map(s => `<option value="${s.id}">${esc(s.name || '')} · ${esc(s.email)}</option>`).join(''); }, 250); });
        $('#icF', m).addEventListener('submit', async e => { e.preventDefault(); const userId = $('#icS', m).value; if (!userId) { $('#icE', m).textContent = 'Pick a student.'; return; } try { const c = await api.post('/admin/certificates', { userId, courseId: $('#icC', m).value }); m.close(); toast('Certificate ' + c.code + ' issued. The student is notified.'); render(); } catch (x) { $('#icE', m).textContent = x.message; } }); };
      await render();
    });
  }

  P.ctfOne = id => page([['CTF Registrations', '#/admin/ctf'], [id]], async () => {
    const r = (await API.ctfRegistrations()).find(x => x.id === id);
    if (!r) { view.innerHTML = empty('Registration not found', ' It may have been removed.') + '<p><a class="btn" href="#/admin/ctf">Back to CTF Registrations</a></p>'; return; }
    const fD = t => { const d = new Date(t); return isNaN(d) ? esc(t || '') : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
    const row = (k, v) => `<tr><th style="text-align:left;width:34%">${k}</th><td>${v}</td></tr>`;
    const logins = r.logins || [];
    view.innerHTML = `<div class="card-h"><h1>${esc(r.name)}</h1><div class="r">${API.can('ctf') === 'Y' ? '<button class="btn btn-primary" data-act="edit">Edit details</button> ' : ''}<a class="btn" href="#/admin/ctf">Back to all registrations</a></div></div>
      <div class="grid g4"><div class="stat blue"><b>${logins.length}</b><span>Logins</span></div><div class="stat"><b>${r.lastLogin ? fD(r.lastLogin) : '–'}</b><span>Last login</span></div><div class="stat green"><b>${esc(r.status || 'Registered')}</b><span>Status</span></div><div class="stat"><b>${r.mfa ? 'On' : 'Off'}</b><span>Authenticator</span></div></div>
      <div class="card" style="margin-top:1rem"><h2>Registration details</h2><table class="tbl">${row('ID', `<span class="mono">${esc(r.id)}</span>`)}${row('Username', r.username ? '@' + esc(r.username) : '–')}${row('Email', esc(r.email || 'Hidden for your role'))}${row('Phone', esc(r.phone || '–'))}${row('Institution', esc(r.institution || '–'))}${row('City', esc(r.city || '–'))}${row('Level', esc(r.level || '–'))}${row('Event', esc(r.event || ''))}${row('Registered', fD(r.at))}${row('Source', esc(r.source || ''))}</table></div>
      <div class="card" style="margin-top:1rem"><h2>Login history</h2>${logins.length ? `<table class="tbl"><tr><th style="text-align:left">#</th><th style="text-align:left">When</th></tr>${logins.slice().reverse().map((t, i) => `<tr><td>${logins.length - i}</td><td>${fD(t && t.at || t)}</td></tr>`).join('')}</table>` : '<p class="note">Not logged in yet.</p>'}</div>`;

    const LV = ['Beginner (first CTF)', 'Intermediate (played a few)', 'Advanced (ranked before)'];
    H = { edit: () => { const m = modal('Edit registration', `<form class="form" id="ctfEd" novalidate>
        <label>Full name<input name="name" value="${esc(r.name || '')}" required></label>
        <label>Phone<input name="phone" inputmode="tel" value="${esc(r.phone || '')}" required></label>
        <label>College or company<input name="institution" value="${esc(r.institution || '')}" required></label>
        <label>City<input name="city" value="${esc(r.city || '')}"></label>
        <label>Experience level<select name="level">${LV.concat(LV.includes(r.level) || !r.level ? [] : [r.level]).map(l => `<option ${l === r.level ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <p class="note">Email, username and password can't be changed here. The change is recorded in the audit log.</p><p class="err" role="alert" style="color:#F87171"></p>
        <div style="display:flex;gap:.5rem;justify-content:flex-end"><button type="button" class="btn" data-x>Cancel</button><button class="btn btn-primary" type="submit">Save changes</button></div></form>`);
      const f = m.querySelector('#ctfEd');
      f.addEventListener('submit', async e => { e.preventDefault(); const b = f.querySelector('[type=submit]'); b.disabled = true; b.textContent = 'Saving…';
        try { const n = await API.ctfEdit(r.id, Object.fromEntries(new FormData(f))); m.close(); toast(n ? 'Registration updated.' : 'Nothing changed.'); route(); }
        catch (x) { f.querySelector('.err').textContent = x.message || 'Could not save.'; b.disabled = false; b.textContent = 'Save changes'; } }); } };
  });
  P.ctf = id => id ? P.ctfOne(id) : page([['CTF Registrations']], async () => {
    const rows = await API.ctfRegistrations(); let q = '', lv = '';
    const fD2 = t => { const d = new Date(t); return isNaN(d) ? esc(t) : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
    const render = () => { const xs = rows.filter(r => (!q || (r.name + r.email + r.institution + r.id + (r.team || '') + (r.members || []).join(' ')).toLowerCase().includes(q)) && (!lv || r.level === lv));
      $('#cList').innerHTML = `<p class="note" style="margin:.4rem 0">${xs.length} of ${rows.length} registrations</p>` + (xs.length ? tbl(['Registrant', 'Contact', 'Institution / city', 'Level', 'Logins', 'Registered', 'Status', ''], xs.map(r => [`<a href="#/admin/ctf/${encodeURIComponent(r.id)}"><b>${esc(r.name)}</b></a><br><span class="mono note">${esc(r.id)}${r.username ? ' · @' + esc(r.username) : ''}</span>`, r.email ? `${esc(r.email)}<br><small class="note">${esc(r.phone || '')}</small>` : '<span class="note">Hidden for your role</span>', `${esc(r.institution || '')}<br><small class="note">${esc(r.city || '')}</small>`, esc(r.level || ''), ((r.logins || []).length ? `<b>${r.logins.length}</b><br><small class="note">last ${fD2(r.lastLogin)}</small>` : '<span class="note">Not logged in yet</span>') + (r.mfa ? '<br><small class="note">Authenticator on</small>' : ''), `${fD2(r.at)}<br><small class="note">${esc(r.source || '')}</small>`, chip(r.status || 'Registered', r.status === 'Cancelled' ? 'r' : r.status === 'Confirmed' ? 'g' : 'b'),
        API.can('ctf') === 'Y' ? `<button class="btn btn-xs" data-act="conf" data-id="${esc(r.id)}" ${r.status === 'Confirmed' ? 'disabled' : ''}>Confirm</button> <button class="btn btn-xs" data-act="canc" data-id="${esc(r.id)}" ${r.status === 'Cancelled' ? 'disabled' : ''}>Cancel</button>` : ''])) : empty(rows.length ? 'No registrations match' : 'No CTF registrations yet', rows.length ? '' : ' Registrations from the CTF page on the website appear here.')); };
    const lvls = [...new Set(rows.map(r => r.level).filter(Boolean))];
    view.innerHTML = `<div class="card-h"><h1>CTF Registrations</h1><div class="r">${LIVE && LIVE.user ? chip('Demo — admin CTF API not built yet', 'r') : ''}<button class="btn" data-act="exp" ${rows.length ? '' : 'disabled'}>Export CSV</button></div></div>
      ${LIVE && LIVE.user ? '<p class="warn">Sample registrations. Real CTF sign-ups are counted in Total Users (CTF); the admin list with confirm and cancel needs its API (OPEN-ITEMS).</p>' : ''}
      <div class="grid g4"><div class="stat blue"><b>${rows.length}</b><span>Registered</span><small>${esc(rows[0] ? rows[0].event : 'Yojo Winter CTF')}</small></div><div class="stat"><b>${rows.filter(r => (r.logins || []).length).length}</b><span>Have logged in</span></div><div class="stat"><b>${rows.reduce((a, r) => a + (r.logins || []).length, 0)}</b><span>Total logins</span></div><div class="stat green"><b>${rows.filter(r => r.status === 'Confirmed').length}</b><span>Confirmed</span></div></div>
      <div class="card toolbar" style="margin-top:1rem"><label style="flex:2;min-width:200px">Search<input data-inp="q" placeholder="Name, email, team or ID"></label><label>Level<select data-chg="lv"><option value="">All</option>${lvls.map(l => `<option>${esc(l)}</option>`).join('')}</select></label></div><div id="cList"></div>
      <p class="note">Registrations come from the pop-up and the form at the end of the public CTF page. ${gap('A real backend stores registrations and sends the confirmation email. Here they are kept in this browser.')}</p>`;
    H.q = el => { q = el.value.trim().toLowerCase(); render(); }; H.lv = el => { lv = el.value; render(); };
    const setS = async (b, s) => { if (s === 'Cancelled' && !await confirmBox('Cancel registration', 'The registrant stays in the list with status Cancelled.', 'Cancel registration', true)) return; try { await API.ctfStatus(b.dataset.id, s); toast('Registration ' + s.toLowerCase() + '.'); route(); } catch (e) { fail(e); } };
    H.conf = b => setS(b, 'Confirmed'); H.canc = b => setS(b, 'Cancelled');
    H.exp = () => csv('ctf-registrations.csv', [['ID', 'Username', 'Name', 'Email', 'Phone', 'Institution', 'City', 'Level', 'Logins', 'Last login', 'Event', 'Registered', 'Status', 'Source']].concat(rows.map(r => [r.id, r.username, r.name, r.email, r.phone, r.institution, r.city, r.level, (r.logins || []).length, r.lastLogin ? new Date(r.lastLogin).toISOString() : '', r.event, r.at, r.status, r.source])));
    render();
  });

  /* ======================= TOTAL USERS ======================= */
  P.total = () => page([['Total Users']], async () => {
    const d = await API.totalUsers(); let t = '', q = '', pg = 0;
    const render = () => { const xs = d.rows.filter(r => (!t || r.type === t) && (!q || (r.name + r.email + r.id).toLowerCase().includes(q)));
      $('#tList').innerHTML = `<p class="note" style="margin:.4rem 0">${xs.length} users</p>` + (xs.length ? tbl(['User', 'Email', 'Type', 'Where they came from', 'Institution'], xs.slice(pg * pageSize, pg * pageSize + pageSize).map(r => [`<b>${esc(r.name)}</b><br><span class="mono note">${esc(r.id)}</span>`, esc(r.email), chip(r.type, r.type === 'Paid' ? 'g' : r.type === 'CTF' ? 'b' : '') + (r.alsoUser ? '<br><small class="note">Also has an account</small>' : ''), esc(r.where), esc(r.institution)])) + pager(xs.length, pg, 'pg') : empty('No users match')); };
    view.innerHTML = `<div class="card-h"><h1>Total Users</h1></div>
      <div class="grid g4"><div class="stat blue"><b>${d.total}</b><span>Total users</span><small>Free + paid + CTF</small></div><div class="stat"><b>${d.free}</b><span>Free</span></div><div class="stat green"><b>${d.paid}</b><span>Paid</span></div><div class="stat cyan"><b>${d.ctf}</b><span>CTF registered</span><small>${d.ctfAlsoUsers} also have an account</small></div></div>
      <div class="card toolbar" style="margin-top:1rem"><label style="flex:2;min-width:200px">Search<input data-inp="q" placeholder="Name, email or ID"></label><label>Type<select data-chg="t"><option value="">All</option><option>Free</option><option>Paid</option><option>CTF</option></select></label></div><div id="tList"></div>`;
    H.q = el => { q = el.value.trim().toLowerCase(); pg = 0; render(); }; H.t = el => { t = el.value; pg = 0; render(); }; H.pg = b => { pg = +b.dataset.p; render(); };
    render();
  });

  /* ======================= INSIGHT ENGINE (PDF pages 37-38) ======================= */
  const IC = window.InsightCore, fmtMs = ms => IC ? IC.fmtMs(ms) : ms;
  const insF = { days: 7 };
  const pc = (x, d = 0) => x == null ? '–' : (x * 100).toFixed(d) + '%';
  const delta = (x, good = 'down', pts) => { if (x == null) return '<small class="note">No previous data</small>'; const up = x > 0, bad = good === 'down' ? up : !up; return `<small style="color:var(--${Math.abs(x) < 0.005 ? 'muted' : bad ? 'red' : 'green'})">${up ? '▲' : x < 0 ? '▼' : '■'} ${pts ? (Math.abs(x) * 100).toFixed(1) + ' pts' : Math.round(Math.abs(x) * 100) + '%'} vs previous</small>`; };
  const dtime = t => t ? new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–';
  const insTabs = cur => `<div class="tabs" role="tablist" style="margin-bottom:1rem">${[['insights', 'Overview', '#/admin/analytics/insights'], ['friction', 'Friction and delay map', '#/admin/analytics/friction'], ['ai', 'AI insight feed', '#/admin/analytics/insights/ai']].map(([k, l, h]) => `<a role="tab" class="btn btn-sm ${cur === k ? 'btn-primary' : ''}" aria-selected="${cur === k}" href="${h}" style="margin-right:.3rem">${l}</a>`).join('')}</div>`;
  const insFilterBar = () => `<div class="card toolbar"><label>Period<select data-chg="fDays">${[[1, 'Last 24 hours'], [7, 'Last 7 days'], [14, 'Last 14 days'], [30, 'Last 30 days']].map(([v, l]) => `<option value="${v}" ${insF.days == v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    ${[['role', 'Role', ['student', 'guest', 'trainer']], ['plan', 'Plan', ['free', 'paid']], ['mode', 'Mode', ['Online', 'Offline']], ['device', 'Device', ['desktop', 'mobile', 'tablet']], ['browser', 'Browser', ['Chrome', 'Edge', 'Firefox', 'Safari']]].map(([k, l, o]) => `<label>${l}<select data-chg="f_${k}"><option value="">All</option>${o.map(v => `<option ${insF[k] === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>`).join('')}</div>`;
  function bindInsFilters(reload) { H.fDays = el => { insF.days = +el.value; reload(); }; ['role', 'plan', 'mode', 'device', 'browser'].forEach(k => H['f_' + k] = el => { if (el.value) insF[k] = el.value; else delete insF[k]; reload(); }); }
  async function insHeader(cur) {
    const m = await API.insightMeta(), syn = m.source === 'synthetic', stale = m.freshness && Date.now() - m.freshness > 6 * 36e5;
    return `<div class="card-h"><h1>Insight Engine</h1><div class="r">${API.can('insightAdmin') === 'Y' ? `<label class="note" style="display:flex;gap:.4rem;align-items:center">Data<select data-chg="src"><option value="live" ${syn ? '' : 'selected'}>Live events</option><option value="synthetic" ${syn ? 'selected' : ''}>Synthetic demo data</option></select></label>` : ''}<button class="btn" data-act="exportCsv">Export CSV</button><button class="btn" data-act="digest">Daily digest</button><button class="btn" data-act="weekly">Weekly report</button></div></div>
      ${syn ? `<div class="card" style="border-color:var(--amber);background:rgba(245,158,11,.08);margin-bottom:.8rem"><b style="color:var(--amber)">SYNTHETIC DEMO DATA.</b> These figures are generated for development and demos. They are not production analytics. Switch Data to Live events for real figures.</div>` : ''}
      ${insTabs(cur)}
      <p class="note" style="margin:.2rem 0 .6rem">Source: ${syn ? 'synthetic dataset (seed 7)' : 'events collected on this platform'} · ${m.events.toLocaleString('en-IN')} events · Last event ${dtime(m.freshness)}${stale ? ' <span class="chip a">Stale: no events in the last 6 hours</span>' : ''} · Your access: ${esc(m.scope)} · Retention ${esc(m.retention)}</p>${insFilterBar()}`;
  }
  function bindInsHeader(cur, reload) {
    bindInsFilters(reload);
    H.src = async el => { try { await API.setInsightSource(el.value); toast(el.value === 'synthetic' ? 'Showing synthetic demo data.' : 'Showing live events.'); route(); } catch (e) { fail(e); } };
    H.exportCsv = async () => { if (!await confirmBox('Export CSV', 'The export is saved in the audit log with your name and the period.', 'Export')) return; try { const rows = await API.insightExport(cur === 'friction' ? 'friction' : 'overview', insF); csv(`insights-${cur}-${insF.days}d.csv`, rows); toast('CSV exported. Logged in the audit trail.'); } catch (e) { fail(e); } };
    H.digest = async () => { try { const d = await API.insightDigest(insF); modal('Daily digest preview', `${d.source === 'synthetic' ? '<p class="chip a">SYNTHETIC DEMO DATA</p>' : ''}<p class="note">${esc(d.schedule)}</p><p>Last 24 hours: <b>${d.users}</b> users, error rate <b>${pc(d.errorRate, 1)}</b>, page-load p95 <b>${fmtMs(d.p95)}</b>.</p>${d.top.length ? '<ul>' + d.top.map(x => `<li>${esc(x.title)} · ${esc(x.severity)} · ${esc(x.status)}</li>`).join('') + '</ul>' : '<p class="note">No insights in the last 24 hours.</p>'}${gap('Sending this at 8:00 IST needs the scheduled job and the email service.')}`, { wide: true }); } catch (e) { fail(e); } };
    H.weekly = async () => { try { const f = { ...insF, days: 7 }, [o, fr, ins] = await Promise.all([API.insightOverview(f), API.insightFriction(f), API.insightFeed(f)]); const syn = API.insightSource() === 'synthetic';
      const w = window.open('', '_blank'); if (!w) { toast('Allow pop-ups to open the weekly report.', true); return; }
      w.document.write(`<!doctype html><title>Yojo weekly insight report</title><style>body{font:14px/1.5 system-ui,sans-serif;margin:32px;color:#111}h1{margin:0}table{border-collapse:collapse;width:100%;margin:8px 0 18px}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left}.syn{border:2px solid #b45309;color:#b45309;padding:8px;font-weight:700}</style>${syn ? '<p class="syn">SYNTHETIC DEMO DATA. NOT PRODUCTION ANALYTICS.</p>' : ''}<h1>Yojo weekly insight report</h1><p>${dtime(o.period.from)} to ${dtime(o.period.to)}</p>
        <h2>Headline</h2><table><tr><th>Unique users</th><td>${o.cur.users}</td><th>Average session</th><td>${fmtMs(o.cur.avgSessionMs)}</td></tr><tr><th>Error rate</th><td>${pc(o.cur.errorRate, 1)}</td><th>Page-load p95</th><td>${fmtMs(o.cur.load.p95)}</td></tr></table>
        <h2>Slowest operations (p95)</h2><table><tr><th>Operation</th><th>n</th><th>p50</th><th>p95</th></tr>${fr.slow.slice(0, 8).map(r => `<tr><td>${esc(r.op)}</td><td>${r.n}</td><td>${fmtMs(r.p50)}</td><td>${fmtMs(r.p95)}</td></tr>`).join('')}</table>
        <h2>Insights</h2><table><tr><th>Insight</th><th>Severity</th><th>Status</th></tr>${ins.map(x => `<tr><td>${esc(x.title)}</td><td>${esc(x.severity)}</td><td>${esc(x.status)}</td></tr>`).join('') || '<tr><td colspan=3>None</td></tr>'}</table><p><small>Use your browser's Print to save as PDF. Automatic weekly delivery needs the scheduled job and email service.</small></p><script>print()<\/script>`); w.document.close(); } catch (e) { fail(e); } };
  }
  // simple SVG charts in the console theme
  const svgBars = (rows, fmt) => { const max = Math.max(1, ...rows.map(r => r.v)); return `<svg viewBox="0 0 320 ${rows.length * 26}" width="100%" role="img" aria-label="Bar chart">${rows.map((r, i) => `<text x="0" y="${i * 26 + 15}" fill="var(--muted)" font-size="11">${esc(r.label)}</text><rect x="130" y="${i * 26 + 5}" height="14" rx="3" width="${Math.max(1, r.v / max * 140)}" fill="var(--${r.c || 'blue'})"/><text x="${134 + r.v / max * 140}" y="${i * 26 + 16}" fill="var(--text)" font-size="11">${fmt(r.v)}</text>`).join('')}</svg>`; };
  const spark = (pts, color = 'blue') => { const xs = pts.filter(p => p != null); if (xs.length < 2) return '<span class="note">Not enough points</span>'; const max = Math.max(...xs), min = Math.min(...xs), W = 300, Hh = 60; const P2 = pts.map((p, i) => p == null ? null : [i / (pts.length - 1) * W, Hh - 4 - ((p - min) / ((max - min) || 1)) * (Hh - 8)]).filter(Boolean);
    return `<svg viewBox="0 0 ${W} ${Hh}" width="100%" height="${Hh}" role="img" aria-label="Trend line"><polyline fill="none" stroke="var(--${color})" stroke-width="2" points="${P2.map(p => p.join(',')).join(' ')}"/></svg>`; };
  const funnelCard = fu => `<div class="card"><h3>${esc(fu.title)}</h3>${fu.stages[0].users ? fu.stages.map((s, i) => `<div style="margin:.35rem 0"><div style="display:flex;justify-content:space-between;font-size:.85rem"><span>${esc(s.label)}${fu.instrumented[i] ? '' : ' <span class="chip a" title="No events of this kind are recorded yet">Not instrumented</span>'}</span><b>${s.users}</b></div><span class="pbar"><i style="--w:${Math.round((s.fromStart || 0) * 100)}%"></i><span>${pc(s.fromStart)}</span></span>${i ? `<small class="note">${pc(s.fromPrev)} of the previous step</small>` : ''}</div>`).join('') + (fu.worst ? `<p class="note">Largest drop: ${esc(fu.worst.from)} → ${esc(fu.worst.to)} (${pc(fu.worst.drop)}, ${fu.worst.lost} users). Denominator: users who reached the previous step.</p>` : '') : empty('No users entered this journey in the period')}</div>`;
  const insEmpty = m => `<div class="card denied">${empty('No events in this period', ' ' + (m || 'Live collection starts when visitors use the website and academy. A Platform Admin can switch to the labelled synthetic dataset for a demo.'))}</div>`;

  P.insights = (arg, arg2) => {
    const cur = arg === 'friction' ? 'friction' : arg === 'insights' && arg2 === 'ai' ? 'ai' : arg === 'insights' ? 'insights' : null;
    if (!cur) { location.replace('#/admin/analytics/insights'); return; }
    const crumb = [['Insight Engine', '#/admin/analytics/insights'], [{ insights: 'Overview', friction: 'Friction and delay map', ai: 'AI insight feed' }[cur]]];
    const reload = () => P.insights(arg, arg2);
    return page(crumb, async () => {
      const head = await insHeader(cur);
      if (cur === 'insights') {
        const o = await API.insightOverview(insF), an = await API.insightAnomalies(insF);
        const ta = o.timeByArea;
        view.innerHTML = head + (!o.sample ? insEmpty() : `
          <div class="grid g4" style="margin-top:1rem"><div class="stat blue"><b>${o.cur.users}</b><span>Unique users</span>${delta(o.delta.users, 'up')}</div>
            <div class="stat"><b>${fmtMs(o.cur.avgSessionMs)}</b><span>Average session</span>${delta(o.delta.avgSessionMs, 'up')}</div>
            <div class="stat ${o.cur.errorRate > 0.05 ? 'red' : 'green'}"><b>${o.cur.errorRate == null ? '–' : pc(o.cur.errorRate, 1)}</b><span>Error rate</span>${o.cur.errorRate == null ? `<small class="note">Needs ${IC.DEFAULTS.minSampleRate} requests (has ${o.cur.requests})</small>` : delta(o.delta.errorRate, 'down', true)}</div>
            <div class="stat ${o.cur.load.p95 > 4000 ? 'amber' : 'cyan'}"><b>${fmtMs(o.cur.load.p95)}</b><span>Page-load p95</span>${o.cur.load.p95 == null ? `<small class="note">Needs ${IC.DEFAULTS.minSampleP95} loads (has ${o.cur.load.n})</small>` : delta(o.delta.p95, 'down')}</div></div>
          <p class="note">Period ${dtime(o.period.from)} to ${dtime(o.period.to)}, compared with the ${insF.days} days before. ${o.cur.sessions} sessions, ${o.sample.toLocaleString('en-IN')} events.</p>
          <div class="grid g2" style="margin-top:1rem"><div class="card"><h3>Time spent by area</h3>${ta.total ? svgBars(ta.rows.map(r => ({ label: r.area, v: Math.round(r.ms / 6e4), c: 'cyan' })), v => v + ' min') + `<p class="note">Total ${Math.round(ta.total / 6e4).toLocaleString('en-IN')} minutes of active time (only visitors who allowed analytics).</p>` : empty('No time-on-page recorded', ' Recorded only with analytics consent.')}</div>
            <div class="card"><h3>Anomalies today</h3>${an.anomalies.map(a => `<div class="li" style="display:flex;justify-content:space-between;gap:.5rem;padding:.3rem 0;border-bottom:1px solid var(--border)"><span>${esc(a.label)}</span>${a.status === 'anomaly' ? chip(`Unusual: ${IC.fmtMetric(a.metric, a.value)} vs ${IC.fmtMetric(a.metric, a.baseline)}`, 'r') : a.status === 'normal' ? chip('Normal', 'g') : `<small class="note">${esc(a.why)}</small>`}</div>`).join('')}
              <h3 style="margin-top:1rem">Demand forecast</h3>${an.forecast.map(x => `<p><b>${x.kind === 'lab' ? 'Sandbox (lab starts)' : 'Live classes'}:</b> ${x.status === 'ok' ? `peak around ${x.peakHour}:00 IST, about ${x.peakPerDay} per day at that hour. <small class="note">${esc(x.method)}. Backtest error ${x.mae} per hour. Assumes: ${esc(x.assumptions)}</small>` : esc(x.why.startsWith('Insufficient') ? x.why : 'Insufficient data for reliable forecast. ' + x.why)}</p>`).join('')}</div></div>
          <h2 style="margin:1.2rem 0 .6rem">Journeys</h2><div class="grid g3">${o.funnels.map(funnelCard).join('')}</div>`);
        bindInsHeader(cur, reload);
        if (API.can('insightAdmin') === 'Y') { view.insertAdjacentHTML('beforeend', `<div class="card" style="margin-top:1rem"><h3>Alert rules</h3><p class="note">A fired rule goes to the admin bell once, then waits for its cooldown before it can alert again.</p><div id="rules"></div></div><div class="card" style="margin-top:1rem"><h3>Individual timeline</h3><p class="note">Platform Admins only (Support with a stated reason). Users are pseudonymous IDs. Every view is audited.</p><div id="tl"></div></div>`); renderRules(); renderTl(); }
        return;
      }
      if (cur === 'friction') {
        const fr = await API.insightFriction(insF);
        view.innerHTML = head + (!fr.sample ? insEmpty() : `
          <div class="card" style="margin-top:1rem"><h3>Slow operations, ranked by p95</h3>${fr.slow.length ? tbl(['Operation', 'Samples', 'p50', 'p95', 'p99', 'Change in p95', ''], fr.slow.slice(0, 15).map(r => [esc(r.op), r.n, fmtMs(r.p50), r.p95 == null ? `<small class="note">${esc(r.note)}</small>` : `<b>${fmtMs(r.p95)}</b>`, r.p99 == null ? '<small class="note">n&lt;100</small>' : fmtMs(r.p99), r.change == null ? '<small class="note">–</small>' : delta(r.change, 'down'), `<button class="btn btn-xs" data-act="drill" data-op="${esc(r.op)}">Drill down</button>`])) : empty('No timed operations recorded')}</div>
          <div class="grid g2" style="margin-top:1rem"><div class="card"><h3>Errors and delivery failures</h3>${fr.errors.length ? tbl(['Category', 'Users', 'Events', 'Most often at'], fr.errors.map(e => [esc(e.category), `<b>${e.users}</b>`, e.events, e.top.map(t => `${esc(t.where)} (${t.n})`).join('<br>')])) : empty('No errors recorded')}</div>
            <div class="card"><h3>Exit and abandonment</h3>${fr.abandon.length ? fr.abandon.map(a => `<p><b>${esc(a.journey)}</b>: ${esc(a.step)} · ${pc(a.drop)} (${a.lost})</p>`).join('') : '<p class="note">No journeys with drop-offs.</p>'}<h4>Last page of a session</h4>${fr.exitPages.length ? fr.exitPages.map(p => `<div style="display:flex;justify-content:space-between"><span class="mono" style="font-size:.8rem">${esc(p.page)}</span><b>${p.sessions} (${pc(p.share)})</b></div>`).join('') : '<p class="note">No page views recorded.</p>'}</div></div><div id="drillBox"></div>`);
        bindInsHeader(cur, reload);
        H.drill = async b => { try { const d = await API.insightDrill(insF, { op: b.dataset.op });
          $('#drillBox').innerHTML = `<div class="card" style="margin-top:1rem"><div class="card-h"><h3>Drill-down: ${esc(d.sel.op)}</h3></div><p class="note">${d.n} samples. Daily p95 (blank where fewer than ${IC.DEFAULTS.minSampleP95} samples):</p>${spark(d.days.map(x => x.p95), 'amber')}
            <div class="grid g3"><div><h4>Device</h4>${d.device.map(x => `<div>${esc(x.v)}: <b>${x.n}</b></div>`).join('')}</div><div><h4>Plan</h4>${d.plan.map(x => `<div>${esc(x.v)}: <b>${x.n}</b></div>`).join('')}</div><div><h4>Median by hour (IST)</h4>${spark(d.hours.map(h => h.n >= 3 ? h.p50 : null), 'cyan')}</div></div></div>`; $('#drillBox').scrollIntoView({ behavior: 'smooth' }); } catch (e) { fail(e); } };
        return;
      }
      // AI insight feed
      const feed = await API.insightFeed(insF);
      const sevC = { High: 'r', Medium: 'a', Low: 'b' }, stC = { New: 'b', Investigating: 'a', 'Action Approved': 'p', Resolved: 'g', Dismissed: '' };
      view.innerHTML = head + `<div class="card" style="margin-top:1rem"><h3>Ask the analyst</h3><p class="note">Answers come from fixed, allowlisted queries over aggregates. No free-form SQL, and the analyst never changes anything. AI Gateway not connected: answers are rule-based.</p>
        <form data-sub="ask" class="toolbar"><input name="q" maxlength="300" placeholder="e.g. Where do online learners drop off?" style="flex:1;min-width:220px"><button class="btn btn-primary">Ask</button></form>
        <div class="toolbar">${['Where do online learners drop off?', 'Which labs are slow to start?', 'How is checkout converting?', 'What errors affect the most users?', 'When is peak sandbox demand?', 'Which issues are still open?'].map(x => `<button class="btn btn-xs" data-act="askEx">${x}</button>`).join('')}</div><div id="ans"></div></div>
        <h2 style="margin:1.2rem 0 .6rem">Insights (${feed.length})</h2>` + (feed.length ? feed.map(c => `<article class="card" style="margin-bottom:.8rem" data-id="${c.id}">
          <div class="card-h"><h3 style="margin:0">${esc(c.title)}</h3><div class="r">${c.synthetic ? chip('Synthetic', 'a') : ''}${chip(c.severity, sevC[c.severity])}${chip(c.priority)}${chip(c.status, stC[c.status])}</div></div>
          <p>${esc(c.changed)}</p>
          <div class="grid g4" style="font-size:.85rem"><div><small class="note">Observed</small><br>${esc(c.observed)}</div><div><small class="note">Baseline</small><br>${esc(c.baseline)}</div><div><small class="note">Period · segment</small><br>${dtime(c.period.from)} to ${dtime(c.period.to)} · ${esc(c.segment)}</div><div><small class="note">Affected users</small><br>${c.affected == null ? 'Not measured' : c.affected}</div></div>
          <h4>Possible causes</h4>${c.hypotheses.length ? '<ul>' + c.hypotheses.map(h => `<li>${esc(h.text)} <small class="note mono">[${esc(h.evidence)}]</small></li>`).join('') + '</ul>' : `<p class="note">${esc(c.noCause)}</p>`}
          <p><b>Confidence:</b> ${esc(c.confidence)} · <b>Suggested action:</b> ${esc(c.action)}</p>
          <p class="note">Data up to ${dtime(c.freshness)} · analysed ${dtime(c.analysedAt)}${c.statusBy ? ' · status set by ' + esc(c.statusBy) : ''}${c.ticket ? ` · Ticket <b class="mono">${esc(c.ticket.id)}</b>` : ''}</p>
          <div class="toolbar"><button class="btn btn-sm" data-act="ev" data-id="${c.id}">View evidence</button>${c.ticket ? '' : `<button class="btn btn-sm" data-act="tk" data-id="${c.id}">Create ticket</button>`}<label class="note">Status<select data-chg="stt" data-id="${c.id}">${['New', 'Investigating', 'Action Approved', 'Resolved', 'Dismissed'].map(s => `<option ${s === c.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label><button class="btn btn-sm" data-act="dis" data-id="${c.id}" ${c.status === 'Dismissed' ? 'disabled' : ''}>Dismiss</button></div></article>`).join('') : `<div class="card">${empty('No insights for this period', ' An insight appears only when a metric changes beyond its threshold with enough samples.')}</div>`);
      bindInsHeader(cur, reload);
      const byId = id => feed.find(x => x.id === id);
      const answer = async q => { $('#ans').innerHTML = '<div class="skel" style="height:60px"></div>'; try { const r = await API.insightAsk(insF, q); $('#ans').innerHTML = `<div class="card" style="margin-top:.6rem"><p>${esc(r.answer)}</p><p class="note mono">Query plan: ${esc(r.plan)}${r.cites && r.cites.length ? ' · Evidence: ' + esc(r.cites.join(', ')) : ''}</p></div>`; } catch (e) { fail(e); } };
      H.ask = f => { const q = f.q.value.trim(); if (q) answer(q); }; H.askEx = b => { view.querySelector('form[data-sub=ask] input').value = b.textContent; answer(b.textContent); };
      H.ev = b => { const c = byId(b.dataset.id); modal('Evidence', `<p class="note">Each item is a metric id and window you can reproduce in the overview or friction map.</p><ul>${c.evidence.concat(c.hypotheses.map(h => h.evidence)).map(e => `<li class="mono">${esc(e)}</li>`).join('')}</ul><p>Observed: ${esc(c.observed)}<br>Baseline: ${esc(c.baseline)}</p>`, { wide: true }); };
      H.tk = async b => { const c = byId(b.dataset.id); const m = modal('Create ticket', `<form class="form" id="tkF"><label>Title<input id="tkT" value="${esc(c.title)}" maxlength="140"></label><label>Owner<select id="tkO"><option>Engineering</option><option>Content team</option><option>Payments</option><option>Support</option></select></label><label style="display:flex;gap:.5rem;align-items:flex-start"><input type="checkbox" id="tkC"> I have checked the evidence and want a ticket created. Nothing on the platform changes automatically.</label><p class="err" id="tkE" role="alert"></p></form>`, { foot: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" id="tkOk">Create ticket</button>' });
        $('#tkOk', m).onclick = async () => { if (!$('#tkC', m).checked) { $('#tkE', m).textContent = 'Tick the confirmation to create the ticket.'; return; } try { const t = await API.createTicket(c, { title: $('#tkT', m).value, owner: $('#tkO', m).value, confirmed: true }); m.close(); toast('Ticket ' + t.id + ' created. Status set to Investigating.'); reload(); } catch (e) { $('#tkE', m).textContent = e.message; } }; };
      H.dis = async b => { const r = await ask('Dismiss insight', { label: 'Why is this not worth acting on?', ok: 'Dismiss' }); if (!r) return; try { await API.setInsightStatus(b.dataset.id, 'Dismissed', r); toast('Insight dismissed.'); reload(); } catch (e) { fail(e); } };
      H.stt = async el => { let note = ''; if (el.value === 'Dismissed') { note = await ask('Dismiss insight', { label: 'Why is this not worth acting on?', ok: 'Dismiss' }); if (!note) { reload(); return; } } try { await API.setInsightStatus(el.dataset.id, el.value, note); toast('Status: ' + el.value); reload(); } catch (e) { fail(e); reload(); } };
    });
  };
  // Live mode: rule-based insights from server records replace the browser-telemetry demo (set up above).
  if (LIVE && LIVE.insightsPage) P.insights = LIVE.insightsPage;
  async function renderRules() {
    const rules = await API.insightRules(); const box = $('#rules'); if (!box) return;
    box.innerHTML = tbl(['Rule', 'Threshold', 'Cooldown (hours)', 'On', ''], rules.map(r => [esc(r.label) + `<br><small class="note mono">${esc(r.id)} · ${esc(r.metric)} ${esc(r.op)}</small>`, `<input type="number" step="any" min="0" value="${r.value}" id="rv-${r.id}" style="width:7rem">`, `<input type="number" min="1" max="168" value="${r.cooldownH}" id="rc-${r.id}" style="width:5rem">`, `<input type="checkbox" id="ro-${r.id}" ${r.on ? 'checked' : ''}>`, `<button class="btn btn-xs" data-act="saveRule" data-id="${r.id}">Save</button>`]));
    H.saveRule = async b => { const id = b.dataset.id; try { await API.saveInsightRule(id, { value: $('#rv-' + id).value, cooldownH: $('#rc-' + id).value, on: $('#ro-' + id).checked }); toast('Rule saved. Logged in the audit trail.'); refreshBell(); } catch (e) { fail(e); } };
  }
  async function renderTl() {
    const box = $('#tl'); if (!box) return; const us = await API.insightUsers(insF);
    box.innerHTML = us.length ? `<div class="toolbar"><select id="tlU">${us.map(u => `<option value="${esc(u.uid)}">${esc(u.uid)} (${u.n} events)</option>`).join('')}</select><button class="btn btn-sm" data-act="tlOpen">Open timeline</button></div><div id="tlOut"></div>` : '<p class="note">No users in this period.</p>';
    H.tlOpen = async () => { const r = ROLE === 'platform' ? 'Platform admin review' : await ask('Reason to open this timeline'); if (!r) return; try { const ev = await API.insightTimeline($('#tlU').value, r); $('#tlOut').innerHTML = tbl(['Time', 'Event', 'Area', 'Detail'], ev.slice(-50).reverse().map(e => [dtime(e.ts), esc(e.name), esc(e.area || ''), esc([e.feature, e.page, e.dur != null ? fmtMs(e.dur) : '', e.result].filter(Boolean).join(' · '))])); } catch (e) { fail(e); } };
  }

  P.notfound = () => page([['Not found']], async () => { view.innerHTML = `<div class="card denied">${empty('This page does not exist')}<a class="btn btn-primary" href="#/admin/dashboard">Go to dashboard</a></div>`; });
  route();
})();
