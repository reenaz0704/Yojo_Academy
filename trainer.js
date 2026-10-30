/* Yojo Trainer console: shell, router and the 11 module pages.
   Data comes only from TrainerAPI (trainer-data.js), which stands in for the server. */
(() => {
  'use strict';
  const API = window.TrainerAPI, DAY = 864e5;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fD = t => new Date(t).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
  const fT = t => new Date(t).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const fDT = t => `${fD(t)}, ${fT(t)}`;
  const ago = t => { const m = Math.round((Date.now() - t) / 6e4); return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  const toLocalInput = t => { const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const initials = n => n.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

  /* ---------------- session guard ---------------- */
  let session = null, user = null;
  const LIVE = window.YojoLiveTrainer; // set by trainer-live.js when the real API answers (session from GET /me)
  if (LIVE && LIVE.user) user = { email: LIVE.user.email, name: LIVE.user.displayName || LIVE.user.email, role: 'trainer', status: 'active', capability: LIVE.user.capability === 'trainer_mentor' ? 'Trainer + Mentor' : 'Trainer', batches: '' };
  if (!LIVE) try { // one-time hand-off from the login popup, valid for 2 minutes
    const h = JSON.parse(localStorage.getItem('yojo_demo_staff_handoff')); localStorage.removeItem('yojo_demo_staff_handoff');
    if (h && h.role === 'trainer' && Date.now() - h.at < 120000) sessionStorage.setItem('yojo_demo_session', JSON.stringify({ email: h.email, role: 'trainer', at: Date.now() }));
  } catch {}
  if (!LIVE) try { session = JSON.parse(sessionStorage.getItem('yojo_demo_session')); const db = JSON.parse(localStorage.getItem('yojo_demo_db_v1')); user = db && session && db.users.find(u => u.email === session.email); } catch {}
  if (!user || user.role !== 'trainer' || user.status !== 'active') {
    document.body.innerHTML = `<main style="min-height:100vh;display:grid;place-items:center;padding:1rem"><div class="card" style="max-width:440px;text-align:center;display:grid;gap:.8rem"><span class="eyebrow">Trainer console</span><h1>Sign in as a trainer</h1>
      <p class="note">${user ? 'This account is not an active trainer. Students and admins cannot open the trainer console.' : 'Your session has ended or you are not signed in.'}</p><a class="btn btn-primary" href="login.html">Go to login</a></div></main>`;
    return;
  }
  const isMentor = /Mentor/.test(user.capability || '');
  API.setSession({ email: user.email, name: user.name.replace(/\s*\(Trainer\)/, ''), capability: user.capability || 'Trainer', batches: (user.batches || '').split(',').map(s => s.trim()).filter(Boolean) });
  window.TrainerMFA.secret = user.mfaSecret;
  const ME = API.me();
  $('#app').hidden = false;
  // live: the sidebar note says where the data comes from (it said "Demo data" before the backend existed)
  if (LIVE) { const db = $('.demo-badge'); if (db) db.innerHTML = '<b>Live data.</b> Connected to the Yojo API on this computer (development).'; }
  const paintAvatar = (name, photo) => { const b = $('#avBtn'); b.innerHTML = photo ? `<img src="${photo}" alt="">` : esc(initials(name)); $('#who').textContent = `${name} · ${ME.capability}`; };
  paintAvatar(ME.name, ((user.trainerProfile || {}).photo) || '');
  $('#who').textContent = `${ME.name} · ${ME.capability}`;
  
  /* ---------------- UI helpers ---------------- */
  function toast(msg, bad) { const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.setAttribute('role', bad ? 'alert' : 'status'); t.textContent = msg; $('#toasts').append(t); setTimeout(() => t.remove(), 4200); }
  function modal(title, body, { wide, foot = '' } = {}) {
    const o = document.createElement('div'); o.className = 'overlay';
    o.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-h"><h2>${esc(title)}</h2><button class="btn btn-sm x" data-x aria-label="Close">Close</button></div><div class="mb">${body}</div>${foot ? `<div class="modal-f">${foot}</div>` : ''}</div>`;
    const close = () => { o.remove(); document.removeEventListener('keydown', k); }; const k = e => { if (e.key === 'Escape') close(); };
    o.addEventListener('click', e => { if (e.target === o || e.target.closest('[data-x]')) close(); }); document.addEventListener('keydown', k);
    document.body.append(o); setTimeout(() => (o.querySelector('input,textarea,select,button.btn-primary') || o.querySelector('button'))?.focus(), 30);
    o.close = close; return o;
  }
  // ask for a reason or an MFA code; resolves to the value or null
  function ask(title, { label = 'Reason', mfa = false, placeholder = '', text = '', ok = 'Confirm' } = {}) {
    return new Promise(res => {
      const m = modal(title, `<form class="form" id="askF">${text ? `<p class="note">${text}</p>` : ''}
        <label>${mfa ? 'Authenticator code (6 digits)' : esc(label)}${mfa ? '<input id="askV" inputmode="numeric" maxlength="6" autocomplete="one-time-code">' : `<textarea id="askV" placeholder="${esc(placeholder)}"></textarea>`}</label>
        ${mfa ? `<p class="mfa-demo">Demo authenticator code right now: <b id="mfaNow">${window.TrainerMFA.code()}</b></p>` : ''}<p class="err" id="askE"></p></form>`,
        { foot: `<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="askF" type="submit">${esc(ok)}</button>` });
      let done = false; const fin = v => { if (!done) { done = true; res(v); } };
      const iv = mfa && setInterval(() => { const n = $('#mfaNow', m); if (n) n.textContent = window.TrainerMFA.code(); else clearInterval(iv); }, 1000);
      $('#askF', m).addEventListener('submit', e => { e.preventDefault(); const v = $('#askV', m).value.trim(); if (!v || (mfa && !/^\d{6}$/.test(v))) { $('#askE', m).textContent = mfa ? 'Enter the 6-digit code.' : 'This is required.'; return; } fin(v); m.close(); });
      const obs = new MutationObserver(() => { if (!m.isConnected) { fin(null); obs.disconnect(); } }); obs.observe(document.body, { childList: true });
    });
  }
  const chip = (txt, c) => `<span class="chip ${c || ''}">${esc(txt)}</span>`;
  const FLAGC = { OK: 'g', WATCH: 'a', LOW: 'r', 'AT RISK': 'r' };
  const flagChip = f => chip(f, FLAGC[f]);
  const pbar = (v, cls) => `<span class="pbar ${cls || (v >= 75 ? '' : v >= 60 ? 'amber' : 'red')}"><i style="--w:${Math.max(0, Math.min(100, v))}%"></i><span>${v}%</span></span>`;
  const tip = t => `<span class="tip" tabindex="0" data-tip="${esc(t)}" aria-label="${esc(t)}">i</span>`;
  const empty = (t, s = '') => `<div class="empty"><b>${esc(t)}</b>${esc(s)}</div>`;
  const tbl = (head, rows, cls = 'cards') => `<div class="tw ${cls}"><table class="tbl"><thead><tr>${head.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td data-l="${esc(head[i].replace(/<[^>]+>/g, ''))}" class="${i ? '' : 'first'}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const csv = (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; document.body.append(a); a.click(); a.remove(); };
  const fail = e => { toast(e.message || 'Something went wrong.', true); };

  /* ---------------- nav + router ---------------- */
  const MODS = [['dashboard', 'Dashboard'], ['batches', 'My Batches'], ['students', 'Students'], ['classes', 'Classes'], ['attendance', 'Attendance'], ['content', 'Content'], ['assessments', 'Assessments'], ['labs', 'Lab Monitor'], ['mentoring', 'Mentoring'], ['messages', 'Messages'], ['feedback', 'My Feedback']]
    .filter(([k]) => k !== 'mentoring' || isMentor || LIVE); // live: any trainer can open slots and take bookings
  // City Command theme: each module is a part of the city the trainer leads
  const CIVIC = { dashboard: ['Overview', 'M4 21h16M6 21V10l6-5 6 5v11M10 21v-5h4v5'], batches: ['Groups you teach', 'M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3zM9 4v13M15 7v13'], students: ['Learner profiles', 'M16 20v-2a4 4 0 0 0-8 0v2M12 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M20 20v-1.5a3 3 0 0 0-2.5-3M4 20v-1.5a3 3 0 0 1 2.5-3'],
    classes: ['Schedule', 'M4 5h16v11H4zM8 20h8M12 16v4'], attendance: ['Mark and review', 'M9 4h6v3H9zM6 6h12v15H6zM9 12l2 2 4-4'], content: ['Courses and lessons', 'M4 5h16v4H4zM5 9v11h14V9M10 13h4'], assessments: ['Tests and grading', 'M12 3v18M5 7h14M5 7l-2 6a3 3 0 0 0 6 0zM19 7l-2 6a3 3 0 0 0 6 0z'],
    labs: ['Lab progress', 'M12 2l3 7 7 .5-5.5 4.5 2 7-6.5-4-6.5 4 2-7L2 9.5 9 9z'], mentoring: ['1-to-1 sessions', 'M7 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M17 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M2 20a5 5 0 0 1 10 0M12 20a5 5 0 0 1 10 0'],
    messages: ['Inbox', 'M4 5h16v11H8l-4 4z'], feedback: ['Ratings', 'M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z'] };
  $('#nav').innerHTML = MODS.map(([k, l]) => `<a href="#/trainer/${k}" data-mod="${k}"><span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${CIVIC[k][1]}"/></svg></span><span class="lb">${l}</span><span class="sub">${CIVIC[k][0]}</span><span class="cnt" hidden></span></a>`).join('');
  $('#menuBtn').onclick = () => $('#side').classList.toggle('open');
  const view = $('#view');
  let H = {}; // click handlers for the current page, keyed by data-act
  view.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && H[b.dataset.act]) { e.preventDefault(); H[b.dataset.act](b, e); } });
  view.addEventListener('change', e => { const b = e.target.closest('[data-chg]'); if (b && H[b.dataset.chg]) H[b.dataset.chg](b, e); });
  view.addEventListener('input', e => { const b = e.target.closest('[data-inp]'); if (b && H[b.dataset.inp]) H[b.dataset.inp](b, e); });
  function setCrumb(parts) { $('#crumb').innerHTML = parts.map((p, i) => i < parts.length - 1 && p[1] ? `<a href="${p[1]}">${esc(p[0])}</a><span class="sep">›</span>` : `<span>${esc(p[0])}</span>`).join(''); document.title = `${parts[parts.length - 1][0]} | Yojo Trainer`; }
  async function page(crumb, fn) {
    H = {}; setCrumb(crumb);
    view.innerHTML = `<div class="grid g4">${'<div class="skel"></div>'.repeat(4)}</div><div class="skel" style="height:240px"></div>`;
    view.setAttribute('aria-busy', 'true');
    try { await fn(); }
    catch (e) { view.innerHTML = `<div class="errbox" role="alert"><div><b>${e.code === 403 ? 'Access denied' : 'Could not load this page'}</b><p class="note">${esc(e.message)}</p></div>${e.code === 403 ? '<a class="btn btn-sm" href="#/trainer/dashboard">Back to dashboard</a>' : '<button class="btn btn-sm" id="retry">Try again</button>'}</div>`; $('#retry')?.addEventListener('click', route); }
    view.removeAttribute('aria-busy');
  }
  const PAGES = {};
  function route() {
    const parts = location.hash.replace(/^#\/?/, '').split('#')[0].split('/');
    if (parts[0] !== 'trainer' || !parts[1]) { location.replace('#/trainer/dashboard'); return; }
    const mod = parts[1], arg = decodeURIComponent(parts[2] || ''), arg2 = decodeURIComponent(parts[3] || '');
    $$('#nav a').forEach(a => a.toggleAttribute('aria-current', a.dataset.mod === mod) || a.removeAttribute('aria-current'));
    $$('#nav a').forEach(a => a.dataset.mod === mod ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
    $('#side').classList.remove('open');
    if (mod === 'mentoring' && !isMentor && !LIVE) return page([['Mentoring']], async () => { const e = new Error('Mentoring is shown only to trainers with the Mentor capability. A Platform Admin sets it.'); e.code = 403; throw e; });
    (PAGES[mod] || PAGES.notfound)(arg, arg2);
    window.scrollTo(0, 0); refreshBell();
  }
  addEventListener('hashchange', route);

  /* ---------------- bell + profile ---------------- */
  async function refreshBell() {
    if (LIVE) return LIVE.bell && LIVE.bell();
    try { const n = await API.notifications(); const un = n.filter(x => !x.read).length; const b = $('#bellCnt'); b.hidden = !un; b.textContent = un;
      $('#bellPop').innerHTML = `<div style="display:flex;align-items:center;padding:.3rem .5rem .5rem"><b>Notifications</b>${n.length ? '<button class="btn btn-xs" id="markRead" style="margin-left:auto">Mark all read</button>' : ''}</div>` +
        (n.length ? n.map(x => `<a class="notif ${x.read ? 'read' : ''}" href="${x.href}"><i class="${x.kind}"></i><span>${esc(x.text)}<br><small class="note">${{ red: 'At risk', amber: 'Warning / due', blue: 'Message' }[x.kind] || ''}</small></span></a>`).join('') : '<p class="note" style="padding:.5rem">You are all caught up.</p>');
      $('#markRead')?.addEventListener('click', async e => { e.stopPropagation(); await API.markNotifsRead(); refreshBell(); });
      const cnt = { messages: n.filter(x => x.id.startsWith('msg-') && !x.read).length, attendance: n.filter(x => x.id.startsWith('clr-') && !x.read).length };
      $$('#nav a').forEach(a => { const c = a.querySelector('.cnt'); const v = cnt[a.dataset.mod]; c.hidden = !v; c.textContent = v || ''; });
    } catch {}
  }
  const togglePop = (btn, pop) => { btn.addEventListener('click', e => { e.stopPropagation(); const open = pop.hidden; $$('.pop').forEach(p => p.hidden = true); pop.hidden = !open; btn.setAttribute('aria-expanded', open); }); };
  togglePop($('#bellBtn'), $('#bellPop')); togglePop($('#avBtn'), $('#avPop'));
  document.addEventListener('click', e => { if (!e.target.closest('.pop')) $$('.pop').forEach(p => p.hidden = true); });
  $('#avPop').innerHTML = `<div style="padding:.4rem .6rem .6rem"><b>${esc(ME.name)}</b><br><small class="note">${esc(ME.email)}</small><br><small class="note">Batches: ${esc(ME.batches.join(', ') || 'none')}</small></div>
    <a href="#/trainer/profile">My profile</a><a href="#/trainer/profile/security">Password and security</a>${LIVE ? '' : '<button class="pi" id="auditBtn">My audit log</button><button class="pi" id="resetBtn">Reset demo data</button>'}<button class="pi" id="outBtn" style="color:var(--red)">Log out</button>`;
  const signOut = async () => { sessionStorage.removeItem('yojo_demo_session'); if (LIVE) await LIVE.logout(); location.href = 'login.html'; };
  $('#outBtn').onclick = signOut;
  if (!LIVE) {
  $('#resetBtn').onclick = () => { API.reset(); toast('Demo data reset.'); route(); };
  $('#auditBtn').onclick = async () => { const a = await API.audit(); modal('My audit log', a.length ? tbl(['When', 'Action', 'Target', 'Detail'], a.map(x => [fDT(x.at), esc(x.action), esc(x.target), esc(x.detail)])) : empty('Nothing recorded yet'), { wide: true }); };
  }
  setInterval(refreshBell, 30000);
  // the student portal (another tab) changed shared data: update the bell, and refresh read-only pages
  addEventListener('storage', e => { if (e.key !== 'yojo_trainer_demo_v2') return; refreshBell();
    const mod = location.hash.split('/')[2]; if (['dashboard', 'mentoring', 'messages', 'batches', 'students'].includes(mod) && !document.querySelector('.overlay') && !view.contains(document.activeElement)) route(); });
  // staff idle timeout: 30 minutes
  let last = Date.now(); ['click', 'keydown', 'mousemove', 'touchstart'].forEach(ev => addEventListener(ev, () => last = Date.now(), { passive: true }));
  // the 30-minute inactivity sign-out was removed for demos (owner, 30 Oct; OI-63): yojo-api.js keeps the session alive

  /* ======================= 1. DASHBOARD ======================= */
  PAGES.dashboard = () => page([['Dashboard']], async () => {
    const [batches, students, classes, asm, clr, threads, lects, ment] = await Promise.all([API.batches(), API.students(), API.classes(), API.assessments(), API.clearances(), API.threads(),
      Promise.all(ME.batches.map(b => API.lectures(b))).then(a => a.flat()), isMentor ? API.mentoring() : Promise.resolve({ requests: [] })]);
    const now = Date.now();
    const todayCls = classes.filter(c => sameDay(c.start, now) && c.status !== 'draft');
    const toMark = lects.filter(l => l.status === 'held' && !l.markedAt && l.start < now);
    const grading = asm.filter(a => !a.auto).map(a => ({ ...a, left: a.subs.filter(s => s.state !== 'Published').length })).filter(a => a.left);
    const attention = students.filter(s => s.flags.length);
    const mentorToday = ment.requests.filter(r => sameDay(r.when, now) && r.status === 'Accepted');
    const pendClr = clr.filter(c => c.status === 'Pending');
    const sched = [...todayCls.map(c => ({ t: c.start, kind: 'class', c })), ...ment.requests.filter(r => sameDay(r.when, now) && ['Accepted', 'Requested'].includes(r.status)).map(r => ({ t: r.when, kind: 'mentor', r }))].sort((a, b) => a.t - b.t);
    const upcoming = classes.filter(c => c.start > now && !sameDay(c.start, now) && ['upcoming', 'holiday', 'cancelled'].includes(c.status)).sort((a, b) => a.start - b.start).slice(0, 3);
    const unread = threads.filter(t => t.unread).length;
    const tile = (n, label, cls, href, sub) => `<a class="stat ${cls}" href="${href}"><b>${n}</b><span>${label}</span><small>${sub}</small></a>`;
    const cityIdx = batches.length ? Math.round(batches.reduce((a, b) => a + b.piAvg * b.students, 0) / Math.max(1, batches.reduce((a, b) => a + b.students, 0))) : 0;
    const threat = attention.filter(s => s.flag === 'AT RISK').length > 1 ? ['Elevated', 'r'] : attention.length ? ['Guarded', 'a'] : ['Secure', 'g'];
    const leaves = await API.leaves(), pendLv = leaves.filter(v => v.status === 'Pending');
    const todo = [
      ...toMark.map(l => ({ c: 'amber', t: `Mark attendance: ${l.topic}`, s: `${l.batch} · ${fD(l.start)}`, href: `#/trainer/attendance/${l.batch}/${l.id}`, b: 'Mark' })),
      ...pendLv.map(v => ({ c: 'amber', t: `Leave request from ${v.name}`, s: `${v.days} day${v.days === 1 ? '' : 's'} from ${fD(v.from)} · ${v.reason}`, href: '#/trainer/attendance#leave', b: 'Review' })),
      ...grading.map(a => ({ c: a.due < now - 3 * DAY ? 'red' : 'amber', t: `Grade: ${a.title}`, s: `${a.batch} · ${a.left} left to grade`, href: '#/trainer/assessments', b: 'Grade' })),
      ...pendClr.map(c => ({ c: 'amber', t: `Absence clearance from ${c.name}`, s: `${c.lecture} · watched ${c.watch}%`, href: '#/trainer/attendance#clear', b: 'Review' })),
      ...threads.filter(t => t.unread).map(t => ({ c: 'blue', t: `Message from ${t.name}`, s: t.subject, href: `#/trainer/messages/${t.id}`, b: 'Reply' }))];
    view.innerHTML = `
      <section class="cityhero simple"><div class="sky" aria-hidden="true">${SKYLINE}</div>
        <div class="welcome"><span class="greet">${(h => h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening')(new Date().getHours())}</span><h1>Welcome, ${esc(ME.name.replace(/\s*\(Trainer\)/, ''))}</h1></div>
        <div class="shield"><div class="ring" style="--v:${cityIdx}"><b>${cityIdx}<small>AVG INDEX</small></b></div><span>Average Performance Index ${tip('Average Performance Index (0 to 100) of all students in your batches.')}</span></div></section>
      <div class="grid g4 dash-tiles">
        ${tile(todayCls.filter(c => c.status === 'upcoming' || c.status === 'past').length, 'Classes today', 'cyan', '#/trainer/classes', todayCls.length ? `Next at ${fT(todayCls[0].start)}` : 'No class today')}
        ${tile(toMark.length, 'Attendance to mark', toMark.length ? 'amber' : 'green', '#/trainer/attendance', toMark.length ? 'Lectures waiting' : 'All marked')}
        ${tile(grading.reduce((a, x) => a + x.left, 0), 'Papers to grade', grading.some(a => a.due < now - 3 * DAY) ? 'red' : 'amber', '#/trainer/assessments', `${grading.length} assessments`)}
        ${tile(attention.length, 'Students to check on', attention.length ? 'red' : 'green', '#/trainer/batches', 'Low attendance or index')}
      </div>
      <div class="dash dash-simple">
        <section class="card s6"><div class="card-h"><h2>Today</h2><div class="r"><a class="btn btn-sm" href="#/trainer/classes">All classes</a></div></div>
          <div class="list">${sched.length ? sched.map(x => x.kind === 'class' ? schedRow(x.c) : `<div class="li blue"><span class="t">${fT(x.t)}</span><div class="grow"><b>${esc(x.r.type)} with ${esc(x.r.name)}</b><span class="note">${x.r.dur} min</span></div><a class="btn btn-sm btn-blue" href="#/trainer/mentoring">${x.r.status === 'Accepted' ? 'Join' : 'Review'}</a></div>`).join('') : empty('Nothing scheduled today')}</div></section>
        <section class="card s6"><div class="card-h"><h2>To do</h2><div class="r">${chip(todo.length ? todo.length + ' items' : 'All done', todo.length ? 'a' : 'g')}</div></div>
          <div class="list">${todo.length ? todo.slice(0, 6).map(x => `<div class="li ${x.c}"><div class="grow"><b>${esc(x.t)}</b><span class="note">${esc(x.s)}</span></div><a class="btn btn-xs btn-primary" href="${x.href}">${x.b}</a></div>`).join('') + (todo.length > 6 ? `<p class="note">and ${todo.length - 6} more in the bell</p>` : '') : empty('Nothing waiting for you')}</div></section>
        <section class="card s12"><div class="card-h"><h2>Students to check on</h2><div class="r"><a class="btn btn-sm" href="#/trainer/batches">My batches</a></div></div>
          <div class="list">${attention.length ? attention.sort((a, b) => a.pi - b.pi).slice(0, 5).map(s => `<div class="li ${s.flag === 'WATCH' ? 'amber' : 'red'}"><div class="grow"><b>${esc(s.name)} <span class="note">· ${esc(s.batch)}</span></b><span class="note">${s.flags.map(f => esc(f.text)).join(' · ')}</span></div>${flagChip(s.flag)}<a class="btn btn-xs" href="#/trainer/students/${s.id}">View student</a><button class="btn btn-xs btn-danger" data-act="esc" data-id="${s.id}">Escalate</button></div>`).join('') : empty('All students are on track')}</div></section>
      </div>`;
    H.esc = escalateBtn;
    H.start = startClass;
  });
  function schedRow(c) {
    if (c.status === 'holiday' || c.status === 'cancelled') return `<div class="li grey"><span class="t">${fD(c.start)}</span><div class="grow"><b>No class</b><span class="note">${esc(c.status === 'holiday' ? c.topic : `${c.topic} cancelled: ${c.reason || ''}`)} · ${c.batch}</span></div>${chip(c.status === 'holiday' ? 'Holiday' : 'Cancelled', '')}</div>`;
    const noLink = c.mode === 'Online' && !c.hasLink;
    return `<div class="li ${noLink ? 'amber' : 'green'}"><span class="t">${sameDay(c.start, Date.now()) ? fT(c.start) : fD(c.start)}</span><div class="grow"><b>${esc(c.topic)}</b><span class="note">${esc(courseName(c.courseId))} · ${c.batch} · ${c.mode}${c.mode === 'Direct' ? ' · ' + esc(c.room) : ''}</span></div>${noLink ? chip('No join link', 'a') : chip(c.mode, c.mode === 'Online' ? 'c' : 'g')}${c.status === 'upcoming' ? `<button class="btn btn-xs btn-primary" data-act="start" data-id="${c.id}" ${noLink ? 'disabled title="Add a join link first"' : ''}>Start class</button>` : ''}</div>`;
  }
  const CITY = 'Hyderabad';
  const SKYLINE = `<svg viewBox="0 0 1200 120" preserveAspectRatio="none"><defs><linearGradient id="sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E8B54A" stop-opacity=".55"/><stop offset="1" stop-color="#E8B54A" stop-opacity=".05"/></linearGradient></defs>
    <path fill="url(#sk)" d="M0 120V92h40V70h30v22h20V55h18l6-14 6 14h18v65h10V80h40V62h22V40h10l8-18 8 18h10v80h20V72h34V58h26v62h18V84h30V48h12V30h6V48h12v72h22V66h40V90h26V60l30-20 30 20v60h20V78h44V52h18v68h24V88h36V62h14V36h8l6-12 6 12h8v84h22V70h40V94h30V58h26v62h24V76h40V54h20V40h6v14h20v66h30V82h44V64h26v56h20V90h40V68h30v52z"/>
    <g fill="#F5D58A" opacity=".55">${Array.from({ length: 70 }, (_, i) => `<rect x="${(i * 173) % 1180 + 8}" y="${60 + (i * 37) % 50}" width="3" height="4"/>`).join('')}</g></svg>`;
  const COURSE_NAMES = { 'C-SOC': 'SOC Analyst (Blue Team)', 'C-FND': 'Cyber Foundations' };
  const courseName = id => COURSE_NAMES[id] || id;
  async function startClass(b) {
    const c = (await API.classes()).find(x => x.id === b.dataset.id);
    if (c.mode === 'Direct') { toast(`Class started in ${c.room}. Mark attendance before it ends.`); return; }
    try { const link = await API.joinLink(c.id); window.open(link, '_blank', 'noopener'); toast('Opening the private class link. Attendance prompt appears 30 minutes before the end.'); } catch (e) { fail(e); }
  }
  async function escalateBtn(b) { const r = await ask('Escalate to Student Mgmt admin', { label: 'What is the concern?', placeholder: 'Attendance has dropped for three weeks; not replying to messages.', text: 'This notifies the Student Mgmt admin bell and starts a mentor check-in. Trainers never contact guardians directly.', ok: 'Escalate' }); if (!r) return; try { await API.escalate(b.dataset.id, r); toast('Escalated to the Student Mgmt admin.'); } catch (e) { fail(e); } }
  const batchCard = b => `<div class="card bcard"><div class="card-h" style="margin:0"><h3>${esc(b.id)}</h3><div class="r">${b.flagged ? chip(b.flagged + ' flagged', 'r') : chip('All OK', 'g')}</div></div><p class="note">${esc(b.course)} · ${b.mode} · ${b.slot}</p>
    <div class="kv"><span>Students<b>${b.students}</b></span><span>Attendance avg<b style="color:${b.attAvg < 75 ? 'var(--red)' : 'var(--green)'}">${b.attAvg}%</b></span><span>Index avg<b style="color:var(--quantum)">${b.piAvg}</b></span><span>Flagged<b style="color:${b.flagged ? 'var(--red)' : 'var(--green)'}">${b.flagged}</b></span></div>
    <a class="btn btn-sm btn-primary" href="#/trainer/batches/${b.id}">Open roster</a></div>`;

  /* ======================= 2. MY BATCHES ======================= */
  const RS = { q: '', sort: 'flag', filter: 'All' };
  PAGES.batches = (bid) => bid ? roster(bid) : page([['My Batches']], async () => {
    const bs = await API.batches();
    view.innerHTML = `<div class="card-h"><h1>My batches</h1><div class="r">${chip(bs.length + ' assigned', 'g')}</div></div>
      ${bs.length ? `<div class="grid g3">${bs.map(batchCard).join('')}</div>` : `<div class="card">${empty('No batches assigned yet', 'A Student Mgmt admin assigns batches to you.')}</div>`}
      <p class="hidden-note">You see only batches assigned to you. A student removed from a batch disappears from your roster at once.</p>`;
  });
  const roster = bid => page([['My Batches', '#/trainer/batches'], [bid]], async () => {
    const [bs, ss] = await Promise.all([API.batches(), API.students(bid)]);
    const b = bs.find(x => x.id === bid);
    const draw = () => {
      const order = { 'AT RISK': 0, LOW: 1, WATCH: 2, OK: 3 };
      let rows = ss.filter(s => s.name.toLowerCase().includes(RS.q.toLowerCase()) && (RS.filter === 'All' || s.flag === RS.filter));
      rows.sort(RS.sort === 'flag' ? (x, y) => order[x.flag] - order[y.flag] || x.pi - y.pi : RS.sort === 'name' ? (x, y) => x.name.localeCompare(y.name) : RS.sort === 'att' ? (x, y) => x.att.pct - y.att.pct : (x, y) => x.pi - y.pi);
      $('#rosterT').innerHTML = rows.length ? tbl(['Student', 'Attended', '%', 'Index', 'Labs', 'Quiz avg', 'Flag', 'View'], rows.map(s => [
        `<b>${esc(s.name)}</b><br><small class="note">${s.id}</small>`, `${s.att.attended} / ${s.att.held}`, pbar(s.att.pct), `<b>${s.pi}</b>`, `${s.labs} of 15`, s.quiz, `${flagChip(s.flag)}`, `<a href="#/trainer/students/${s.id}">Open</a>`])) : empty('No students match', 'Try another search or filter.');
    };
    view.innerHTML = `<div class="grid g4">
        <div class="stat green"><b>${b.students}</b><span>Students</span></div><div class="stat ${b.attAvg < 75 ? 'red' : 'green'}"><b>${b.attAvg}%</b><span>Attendance avg</span></div>
        <div class="stat blue"><b>${b.piAvg}</b><span>Index avg ${tip('Performance Index 0-100 = Attendance 20% + Labs 30% + Courses and assessments 35% + Leaderboard and XP 15% [provisional].')}</span></div><div class="stat red"><b>${b.flagged}</b><span>Flagged</span></div></div>
      <div class="toolbar"><input type="search" placeholder="Search student in ${esc(bid)}…" aria-label="Search student" data-inp="q" value="${esc(RS.q)}">
        <label style="display:flex;align-items:center;gap:.4rem">Sort <select data-chg="sort"><option value="flag">Flag</option><option value="name">Name</option><option value="att">Attendance</option><option value="pi">Index</option></select></label>
        <label style="display:flex;align-items:center;gap:.4rem">Filter <select data-chg="filter">${['All', 'OK', 'WATCH', 'LOW', 'AT RISK'].map(f => `<option ${RS.filter === f ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
        <button class="btn btn-sm r" data-act="export">Export progress</button></div>
      <div id="rosterT"></div>
      <p class="hidden-note">Not shown to trainers: fees, payments, dues, guardian phone, other batches, lab flags and answers. The export has progress fields only and is audited.</p>`;
    $('[data-chg=sort]').value = RS.sort; draw();
    H.q = el => { RS.q = el.value; draw(); }; H.sort = el => { RS.sort = el.value; draw(); }; H.filter = el => { RS.filter = el.value; draw(); };
    H.export = async () => { try { csv(`${bid}-progress.csv`, await API.exportCsv(bid)); toast('Progress CSV exported. This export is recorded in the audit log.'); } catch (e) { fail(e); } };
  });

  /* ======================= 3. STUDENTS (360) ======================= */
  PAGES.students = (sid, tab) => sid ? student360(sid, tab || 'overview') : page([['Students']], async () => {
    const ss = await API.students();
    view.innerHTML = `<div class="card-h"><h1>Students</h1><div class="r"><input type="search" placeholder="Search your students…" aria-label="Search students" data-inp="q" style="width:260px"></div></div><div id="stT"></div>`;
    const draw = q => { const r = ss.filter(s => s.name.toLowerCase().includes(q.toLowerCase())); $('#stT').innerHTML = r.length ? tbl(['Student', 'Batch', 'Path', 'Attendance', 'Index', 'Flag', ''], r.map(s => [`<b>${esc(s.name)}</b>`, s.batch, s.path, pbar(s.att.pct), `<b>${s.pi}</b>`, flagChip(s.flag), `<a class="btn btn-xs" href="#/trainer/students/${s.id}">Student 360</a>`])) : empty('No students found'); };
    draw(''); H.q = el => draw(el.value);
  });
  const student360 = (sid, tab) => page([['Students', '#/trainer/students'], ['…']], async () => {
    const s = await API.student(sid);
    setCrumb([['Students', '#/trainer/students'], [s.name]]);
    const TABS = [['overview', 'Overview'], ['attendance', 'Attendance'], ['labs', 'Labs'], ['courses', 'Courses + Assessments'], ['remarks', 'Remarks'], ['placement', 'Placement']];
    const piC = s.pi >= 60 ? 'var(--green)' : s.pi >= 40 ? 'var(--amber)' : 'var(--red)';
    const band = s.pi >= 80 ? 'Excelling' : s.pi >= 60 ? 'On track' : s.pi >= 40 ? 'Needs support' : 'At risk';
    const comps = [['Attendance', 20], ['Labs', 30], ['Courses + Assessments', 35], ['Leaderboard + XP', 15]];
    const missed = s.assessments.filter(a => a.state === 'Missed');
    const body = {
      overview: `<div class="grid g2"><section class="card"><div class="card-h"><h3>Performance Index components ${tip('Same figure as the admin report. Computed nightly. [provisional weights]')}</h3></div>
          <div class="comp">${comps.map(([k, w]) => `<div><span>${k} (${w}%)</span>${pbar(s.comp[k], 'blue')}<b>${s.comp[k]}</b></div>`).join('')}</div></section>
        <section class="card"><div class="card-h"><h3>Rule-based flags</h3></div><div class="list">${s.flags.length ? s.flags.map(f => `<div class="li ${f.code === 'WATCH' ? 'amber' : 'red'}">${chip(f.code, f.code === 'WATCH' ? 'a' : 'r')}<span>${esc(f.text)}</span></div>`).join('') : `<div class="li green">${chip('OK', 'g')}<span>No flags. On track.</span></div>`}</div>
          <div class="toolbar" style="margin-top:.8rem"><button class="btn btn-sm btn-danger" data-act="esc" data-id="${s.id}">Escalate</button></div></section>
        <section class="card"><div class="card-h"><h3>Learning progress</h3></div><div class="comp"><div><span>Labs</span>${pbar(s.labsPct, 'blue')}<b>${s.labs}/15</b></div><div><span>Quiz average</span>${pbar(s.quiz, 'blue')}<b>${s.quiz}</b></div><div><span>Lectures attended</span>${pbar(s.att.pct)}<b>${s.att.attended}/${s.att.held}</b></div></div></section>
        <section class="card"><div class="card-h"><h3>Missed assessments and recent activity</h3></div><div class="list">${missed.map(a => `<div class="li red">${chip('Missed', 'r')}<span>${esc(a.title)} · due ${fD(a.due)}</span></div>`).join('')}${s.activity.map(a => `<div class="li"><span class="t">${ago(a.at)}</span><span>${esc(a.text)}</span></div>`).join('')}</div></section></div>`,
      attendance: `<section class="card"><div class="card-h"><h3>Lecture attendance</h3><div class="r">${chip(`P ${s.att.P}`, 'g')}${chip(`L ${s.att.L}`, 'a')}${chip(`A ${s.att.A}`, 'r')}${chip(`E ${s.att.E}`, 'b')}</div></div>
        ${tbl(['Lecture', 'Date', 'Topic', 'Mark'], s.lectures.map(l => [`#${l.n}`, fD(l.start), esc(l.topic), l.status !== 'held' ? '<span class="mark H">–</span> No class' : l.mark ? `<span class="mark ${l.mark}">${l.mark}</span> ${{ P: 'Present', A: 'Absent', L: 'Late', E: 'Excused' }[l.mark]}` : '<span class="note">Not marked</span>']))}</section>`,
      labs: `<section class="card"><div class="card-h"><h3>Labs and checkpoints</h3></div><p class="note" style="margin-bottom:.6rem">Flags, answer keys and solutions are never shown to trainers.</p>${tbl(['Lab', 'Status', 'Checkpoints', 'Time', 'Hint level'], s.labRuns.map(l => [l.m, labChip(l.state), `${l.cp}/${l.cpTotal}`, l.mins ? l.mins + ' min' : '–', l.hint]))}</section>`,
      courses: `<section class="card"><div class="card-h"><h3>Courses and assessments</h3></div>${tbl(['Assessment', 'Type', 'Due', 'State', 'Score'], s.assessments.map(a => [esc(a.title), a.type, fD(a.due), chip(a.state, a.state === 'Missed' ? 'r' : a.state === 'Published' || a.state === 'Auto-graded' ? 'g' : 'a'), a.score ?? '–']))}</section>`,
      remarks: remarksTab(s),
      placement: `<section class="card"><div class="card-h"><h3>Placement readiness</h3></div><div class="grid g4">
        <div class="stat ${s.resume ? 'green' : 'amber'}"><b>${s.resume ? 'Yes' : 'No'}</b><span>Resume</span></div><div class="stat blue"><b>${s.mocks} of 3</b><span>Mock interviews</span></div>
        <div class="stat ${s.portfolio ? 'green' : 'amber'}"><b>${s.portfolio ? 'Yes' : 'No'}</b><span>Portfolio</span></div><div class="stat cyan"><b style="font-size:1.2rem">${esc(s.internship)}</b><span>Internship (admin-managed)</span></div></div>
        <p class="note" style="margin-top:.8rem">Internship matching is done by admins; trainers see status only.</p></section>`
    };
    view.innerHTML = `<section class="card"><div class="s360"><div class="av">${initials(s.name)}</div><div style="display:grid;gap:.25rem"><h1>${esc(s.name)}</h1>
        <div class="toolbar">${chip(s.batch, 'c')}${chip(s.path + ' path', 'b')}${chip('Level: ' + s.rank, 'p')}${flagChip(s.flag)}</div><span class="note">${s.id} · last active ${ago(s.lastActive)}</span></div>
        <div class="pi-ring" style="--v:${s.pi};--c:${piC}"><b>${s.pi}<small>INDEX</small></b></div><div style="display:grid;gap:.2rem"><b>${band}</b><span class="note">Performance Index</span></div></div></section>
      <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" aria-selected="${k === tab}" data-act="tab" data-t="${k}">${l}</button>`).join('')}</div>
      <div>${body[tab] || body.overview}</div>
      <div class="hidden-note">Not shown to trainers: fees, payments, dues, guardian phone, other batches, lab flags and answers. Need to reach the guardian? <button class="btn btn-xs" data-act="guardian">Ask admin to contact guardian</button></div>`;
    H.tab = b => location.hash = `#/trainer/students/${sid}/${b.dataset.t}`;
    H.esc = escalateBtn;
    H.guardian = async () => { const r = await ask('Ask admin to contact guardian', { label: 'Why should the admin contact the guardian?', text: 'This opens a Support request. Guardian contact details are never shown to trainers.', ok: 'Send request' }); if (!r) return; try { await API.askGuardian(sid, r); toast('Support request sent to the admin.'); } catch (e) { fail(e); } };
    H.saveRemark = async () => { const kind = $('input[name=rk]:checked').value, text = $('#rmText').value, id = $('#rmText').dataset.edit; try { await API.addRemark(sid, kind, text, id || null); toast(`${kind} saved.`); student360(sid, 'remarks'); } catch (e) { fail(e); } };
    H.editRemark = b => { const r = s.remarks.find(x => x.id === b.dataset.id); $('#rmText').value = r.text; $('#rmText').dataset.edit = r.id; $(`input[name=rk][value="${r.kind}"]`).checked = true; $('#rmText').focus(); };
    H.hist = b => { const r = s.remarks.find(x => x.id === b.dataset.id); modal('Edit history', r.history.length ? tbl(['Saved', 'Earlier text'], r.history.map(h => [fDT(h.at), esc(h.text)])) : empty('No earlier versions')); };
  });
  function remarksTab(s) {
    return `<div class="grid g2"><section class="card"><div class="card-h"><h3>Add remark</h3></div><div class="form">
        <div class="toolbar"><label style="display:flex;gap:.4rem;align-items:center"><input type="radio" name="rk" value="Remark" checked>Remark (in student report)</label><label style="display:flex;gap:.4rem;align-items:center"><input type="radio" name="rk" value="Private note">Private note ${tip('Visible only to you and the Platform Admin. Never printed for parents.')}</label></div>
        <textarea id="rmText" placeholder="Factual comment, e.g. Completed DEF-03 without hints."></textarea><div class="toolbar"><button class="btn btn-primary btn-sm" data-act="saveRemark">Save remark</button><span class="note">Entries cannot be deleted. An edit keeps history.</span></div></div></section>
      <section class="card"><div class="card-h"><h3>Remarks and notes</h3></div><div class="list">${s.remarks.length ? s.remarks.slice().reverse().map(r => `<div class="li ${r.kind === 'Remark' ? 'green' : 'blue'}"><div class="grow"><b>${esc(r.text)}</b><span class="note">${r.kind} · ${esc(r.author)} · ${fDT(r.at)}${r.history.length ? ' · edited' : ''}</span></div>${r.author === ME.name ? `<button class="btn btn-xs" data-act="editRemark" data-id="${r.id}">Edit</button>` : ''}<button class="btn btn-xs" data-act="hist" data-id="${r.id}">History</button></div>`).join('') : empty('No remarks yet')}</div></section></div>`;
  }
  const labChip = st => chip(st, { Done: 'g', 'In Progress': 'b', Stuck: 'r', 'Not Started': '' }[st]);

  /* ======================= 4. CLASSES ======================= */
  let classTab = 'upcoming';
  PAGES.classes = (arg) => page([['Classes']], async () => {
    const [cls, courses] = await Promise.all([API.classes(), API.courses()]);
    const now = Date.now();
    const groups = { upcoming: cls.filter(c => ['upcoming', 'holiday', 'cancelled'].includes(c.status) && c.start > now - 2 * 36e5).sort((a, b) => a.start - b.start), past: cls.filter(c => c.status === 'past').sort((a, b) => b.start - a.start), drafts: cls.filter(c => c.status === 'draft') };
    const missing = groups.upcoming.filter(c => c.status === 'upcoming' && c.mode === 'Online' && !c.hasLink);
    view.innerHTML = `<div class="card-h"><h1>Classes</h1><div class="r"><button class="btn btn-primary" data-act="new">+ Schedule class</button></div></div>
      ${missing.length ? `<div class="warn" role="alert"><b>${missing.length} online class${missing.length > 1 ? 'es have' : ' has'} no join link:</b> ${missing.map(c => `${esc(c.topic)} (${fD(c.start)})`).join(', ')}. Students cannot join until you add one.</div>` : ''}
      <div class="tabs" role="tablist">${[['upcoming', 'Upcoming'], ['past', 'Past'], ['drafts', 'Drafts']].map(([k, l]) => `<button role="tab" aria-selected="${classTab === k}" data-act="ctab" data-t="${k}">${l} (${groups[k].length})</button>`).join('')}</div>
      <div class="grid g3">${groups[classTab].map(classCard).join('') || `<div class="card" style="grid-column:1/-1">${empty('Nothing here', classTab === 'drafts' ? 'Saved drafts appear here.' : '')}</div>`}</div>
      <p class="note">Students get reminders one day and one hour before each class. Join links are private: only members of that batch can open them, from 15 minutes before the start.</p>`;
    H.ctab = b => { classTab = b.dataset.t; PAGES.classes(); };
    H.new = () => classForm(null, courses);
    H.edit = b => classForm(cls.find(c => c.id === b.dataset.id), courses);
    H.start = startClass;
    H.link = async b => { const v = await ask('Add private join link', { label: 'Join link', placeholder: 'https://meet.google.com/…', ok: 'Save link' }); if (!v) return; try { await API.setClassLink(b.dataset.id, v); toast('Join link saved privately.'); PAGES.classes(); } catch (e) { fail(e); } };
    H.cancel = async b => { const v = await ask('Cancel class', { text: 'The batch gets an Important notice about the change.', placeholder: 'Reason shown to the batch', ok: 'Cancel class' }); if (!v) return; try { await API.cancelClass(b.dataset.id, v); toast('Class cancelled and the batch notified.'); PAGES.classes(); } catch (e) { fail(e); } };
    H.ics = b => { const c = cls.find(x => x.id === b.dataset.id); const f = t => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''); csvLike(`${c.id}.ics`, `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:${c.id}@yojo\nDTSTART:${f(c.start)}\nDTEND:${f(c.start + c.durMin * 6e4)}\nSUMMARY:${c.topic} (${c.batch})\nLOCATION:${c.mode === 'Direct' ? c.room : 'Online (link in Yojo)'}\nEND:VEVENT\nEND:VCALENDAR`); };
    if (arg === 'new') classForm(null, courses);
  });
  const csvLike = (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/calendar' })); a.download = name; document.body.append(a); a.click(); a.remove(); };
  function classCard(c) {
    const off = c.status === 'holiday' || c.status === 'cancelled', noLink = c.status === 'upcoming' && c.mode === 'Online' && !c.hasLink;
    return `<div class="card ccard" style="${off ? 'opacity:.75' : ''}"><div class="card-h" style="margin:0"><span class="note mono">${fD(c.start)} · ${off ? '' : fT(c.start)}</span><div class="r">${off ? chip(c.status === 'holiday' ? 'Holiday · No class' : 'Cancelled · No class', '') : c.status === 'draft' ? chip('Draft', 'a') : chip(c.mode, c.mode === 'Online' ? 'c' : 'g')}</div></div>
      <h3>${esc(c.topic)}</h3><p class="note">${esc(courseName(c.courseId))} · ${c.batch}${c.durMin ? ` · ${c.durMin} min` : ''}</p>
      ${c.concepts.length ? `<div class="meta">${c.concepts.map(x => chip(x, 'p')).join('')}</div>` : ''}
      ${c.status === 'cancelled' ? `<p class="note">${esc(c.reason || '')}</p>` : ''}
      ${!off ? `<p class="note">${c.mode === 'Online' ? (c.hasLink ? '<span class="ok">● Private join link set</span>' : '<span style="color:var(--amber)">▲ No join link</span>') : '📍 ' + esc(c.room || 'Room not set')}${c.recording ? ' · Recording available' : ''}</p>` : ''}
      <div class="toolbar">${c.status === 'upcoming' ? `<button class="btn btn-sm btn-primary" data-act="start" data-id="${c.id}" ${noLink ? 'disabled' : ''}>Start class</button>${noLink ? `<button class="btn btn-sm" data-act="link" data-id="${c.id}">Add join link</button>` : ''}<button class="btn btn-sm" data-act="ics" data-id="${c.id}">Add to calendar</button><button class="btn btn-sm btn-danger" data-act="cancel" data-id="${c.id}">Cancel</button>` : ''}
        ${c.status === 'draft' ? `<button class="btn btn-sm btn-primary" data-act="edit" data-id="${c.id}">Edit and schedule</button>` : ''}${c.status === 'past' ? `<a class="btn btn-sm" href="#/trainer/attendance/${c.batch}">Attendance</a>` : ''}</div></div>`;
  }
  function classForm(c, courses) {
    c = c || { batch: ME.batches[0], courseId: '', topic: '', start: Date.now() + DAY, durMin: 90, mode: 'Online', room: '', concepts: [] };
    const mine = courses.filter(x => x.batches.some(b => ME.batches.includes(b)) || x.mine);
    const m = modal(c.id ? 'Edit class' : 'Schedule class', `<form class="form" id="clF">
      <div class="row2"><label>Course<select id="cfC">${mine.map(x => `<option value="${x.id}" ${x.id === c.courseId ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select></label>
        <label>Assigned batch<select id="cfB">${ME.batches.map(b => `<option ${b === c.batch ? 'selected' : ''}>${b}</option>`).join('')}</select></label></div>
      <label>Topic<input id="cfT" value="${esc(c.topic)}" placeholder="e.g. Threat hunting with Sigma"></label>
      <div class="row3"><label>Date and time<input id="cfS" type="datetime-local" value="${toLocalInput(c.start)}"></label><label>Duration (min)<input id="cfD" type="number" min="15" step="15" value="${c.durMin}"></label>
        <label>Mode<select id="cfM"><option value="Online" ${c.mode === 'Online' ? 'selected' : ''}>Online</option><option value="Direct" ${c.mode === 'Direct' ? 'selected' : ''}>Direct / Offline</option></select></label></div>
      <label id="cfLw">Private join link<input id="cfL" placeholder="https://meet.google.com/… (stored privately)"></label>
      <label id="cfRw">Physical room<input id="cfR" value="${esc(c.room || '')}" placeholder="Lab 2, Hyderabad centre"></label>
      <label>Concept lectures covered (comma separated)<input id="cfK" value="${esc(c.concepts.join(', '))}" placeholder="Sigma rule syntax, Hunting queries"></label>
      <p class="note">Reminders go to the batch one day and one hour before the class.</p><p class="err" id="cfE"></p></form>`,
      { wide: true, foot: `<button class="btn" data-act2="draft">Save draft</button><button class="btn btn-primary" data-act2="go">Schedule class</button>` });
    const sync = () => { const on = $('#cfM', m).value === 'Online'; $('#cfLw', m).hidden = !on; $('#cfRw', m).hidden = on; }; $('#cfM', m).onchange = sync; sync();
    m.addEventListener('click', async e => { const a = e.target.closest('[data-act2]'); if (!a) return;
      const rec = { id: c.id, courseId: $('#cfC', m).value, batch: $('#cfB', m).value, topic: $('#cfT', m).value.trim(), start: new Date($('#cfS', m).value).getTime(), durMin: +$('#cfD', m).value, mode: $('#cfM', m).value, link: $('#cfL', m).value.trim(), room: $('#cfR', m).value.trim(), concepts: $('#cfK', m).value.split(',').map(s => s.trim()).filter(Boolean) };
      try { await API.saveClass(rec, a.dataset.act2 === 'draft'); m.close(); toast(a.dataset.act2 === 'draft' ? 'Draft saved.' : `Class scheduled. ${rec.mode === 'Online' && !rec.link ? 'Add a join link before the class.' : 'Reminders are set.'}`); classTab = a.dataset.act2 === 'draft' ? 'drafts' : 'upcoming'; location.hash = '#/trainer/classes'; PAGES.classes(); }
      catch (err) { $('#cfE', m).textContent = err.message; } });
  }

  /* ======================= 5. ATTENDANCE ======================= */
  PAGES.attendance = (batch, lid) => page([['Attendance']], async () => {
    batch = ME.batches.includes(batch) ? batch : ME.batches[0];
    if (!batch) { view.innerHTML = `<div class="card">${empty('No batches assigned yet')}</div>`; return; }
    const [lects, students, clr, courses, lvs] = await Promise.all([API.lectures(batch), API.students(batch), API.clearances(), API.courses(), API.leaves()]);
    const leaves = lvs.filter(v => v.batch === batch), LV_CHIP = { Pending: 'a', Approved: 'g', Rejected: 'r', Withdrawn: '' };
    const held = lects.filter(l => l.status !== 'cancelled');
    const pick = lects.find(l => l.id === lid) || lects.filter(l => l.status === 'held').find(l => !l.markedAt) || lects.filter(l => l.status === 'held').slice(-1)[0];
    const cfg = API.cfg();
    const course = courses.find(c => c.id === pick.courseId);
    const age = (Date.now() - pick.start) / 36e5, windowOpen = age <= cfg.editWindowH || !pick.markedAt, readOnly = pick.locked || !windowOpen || pick.status !== 'held';
    const marks = { ...pick.marks };
    const sugg = s => { const j = pick.joinLog[s.id]; if (!j) return 'A'; return j.joinedMin <= cfg.joinWithinMin && j.pct >= cfg.joinStayPct ? 'P' : 'A'; };
    const allConcepts = (course ? course.modules.flatMap(m => m.lessons.filter(l => l.concept).map(l => l.title)) : []);
    const coveredAll = new Set(lects.flatMap(l => l.conceptsCovered.map(x => x.replace(' (concept)', ''))));
    const recent = lects.filter(l => l.status !== 'cancelled').slice(-6);
    view.innerHTML = `<div class="card-h"><h1>Lecture attendance</h1><div class="r">${chip(`Edit window ${cfg.editWindowH} h`, '')}${chip(`Required ${cfg.attendanceMin}%`, 'a')}</div></div>
      <div class="card toolbar">
        <label style="flex:1;min-width:180px">Course<select disabled><option>${esc(course ? course.title : pick.courseId)}</option></select></label>
        <label style="flex:1;min-width:140px">Batch<select data-chg="batch">${ME.batches.map(b => `<option ${b === batch ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
        <label style="flex:2;min-width:220px">Lecture<select data-chg="lect">${held.map(l => `<option value="${l.id}" ${l.id === pick.id ? 'selected' : ''}>#${l.n} · ${fD(l.start)} · ${esc(l.topic)}${l.status === 'holiday' ? ' (no class)' : l.markedAt ? '' : ' (not marked)'}</option>`).join('')}</select></label></div>
      ${pick.status !== 'held' ? `<div class="card">${empty('No class', `${pick.holidayName || 'Holiday'}: this lecture cannot be marked and is left out of percentages.`)}</div>` : `
      <div class="dash">
      <section class="card s8"><div class="card-h"><div><h2>#${pick.n} ${esc(pick.topic)}</h2><p class="note">${fDT(pick.start)} · ${pick.durMin} min · Join log: ${Object.values(pick.joinLog).filter(Boolean).length} of ${students.length} joined</p></div>
          <div class="r">${pick.locked ? chip('Locked', 'b') : !windowOpen ? chip('Edit window closed', 'a') : pick.markedAt ? chip('Marked', 'g') : chip('Not marked', 'a')}</div></div>
        ${readOnly && !pick.locked && pick.status === 'held' ? `<div class="warn" style="margin-bottom:.7rem">The ${cfg.editWindowH}-hour window has passed. Changes now go to the Student Mgmt admin with a reason.</div>` : ''}
        ${tbl(['Student', 'Joined', 'Class attended', 'Suggested', 'Final'], students.map(s => { const j = pick.joinLog[s.id]; const sg = sugg(s); return [
          `<b>${esc(s.name)}</b>`, j ? `+${j.joinedMin} min` : '<span class="note">No join</span>', j ? pbar(j.pct, j.pct >= 75 ? '' : 'amber') : '–', `<span class="mark ${sg}">${sg}</span>`,
          `<div class="seg" role="group" aria-label="Attendance for ${esc(s.name)}" data-sid="${s.id}">${['P', 'A'].map(v => `<button type="button" data-v="${v}" aria-pressed="${(marks[s.id] || '') === v}" ${readOnly ? 'disabled' : ''} data-act="mark" title="${{ P: 'Present', A: 'Absent' }[v]}">${{ P: 'Present', A: 'Absent' }[v]}</button>`).join('')}</div>`]; }))}
        <div class="toolbar" style="margin-top:.8rem"><button class="btn btn-sm" data-act="allP" ${readOnly ? 'disabled' : ''}>Mark all present</button><button class="btn btn-sm" data-act="useSugg" ${readOnly ? 'disabled' : ''}>Use suggestions</button>
          <span class="r toolbar"><button class="btn btn-sm" data-act="log">Change log</button><button class="btn btn-sm btn-primary" data-act="save" ${readOnly ? 'disabled' : ''}>Save attendance</button><button class="btn btn-sm btn-blue" data-act="lock" ${pick.locked || !pick.markedAt ? 'disabled' : ''}>Lock lecture (MFA)</button></span></div>
        <p class="note" style="margin-top:.5rem">Suggestion: P if joined within ${cfg.joinWithinMin} min and stayed ${cfg.joinStayPct}% of the class [provisional], otherwise A. P = Present, A = Absent.</p></section>
      <section class="card s4"><div class="card-h"><h3>Concepts covered</h3></div><div class="list">${pick.concepts.map(k => `<label class="li" style="display:flex"><input type="checkbox" class="cc" value="${esc(k)}" ${pick.conceptsCovered.includes(k) ? 'checked' : ''} ${readOnly ? 'disabled' : ''}> ${esc(k.replace(' (concept)', ''))}</label>`).join('')}</div>
        <div style="margin-top:1rem"><p class="note">Course syllabus coverage</p>${pbar(allConcepts.length ? Math.round(allConcepts.filter(k => coveredAll.has(k)).length / allConcepts.length * 100) : 0, 'blue')}
        <div class="list" style="margin-top:.5rem">${allConcepts.map(k => `<div class="li" style="padding:.35rem .6rem">${coveredAll.has(k) ? chip('Covered', 'g') : chip('Planned', '')}<span class="note">${esc(k)}</span></div>`).join('')}</div></div></section>
      </div>`}
      <section class="card"><div class="card-h"><h2>Lecture register</h2><div class="r">${chip('Last six lectures', '')}</div></div>
        ${tbl(['Student', ...recent.map(l => `#${l.n} ${fD(l.start).split(',')[1] || ''}`), 'Overall'], students.map(s => [`<b>${esc(s.name)}</b>`, ...recent.map(l => l.status !== 'held' ? '<span class="mark H" title="No class">–</span>' : l.marks[s.id] ? `<span class="mark ${l.marks[s.id]}">${l.marks[s.id]}</span>` : '<span class="note">·</span>'), `${pbar(s.att.pct)}${s.att.pct < cfg.attendanceMin ? ' ' + chip('LOW', 'r') : ''}`]), '')}</section>
      <section class="card" id="leave"><div class="card-h"><h2>Leave requests</h2><div class="r">${chip(leaves.filter(v => v.status === 'Pending').length + ' waiting', leaves.some(v => v.status === 'Pending') ? 'a' : 'g')}</div></div>
        ${leaves.length ? tbl(['Student', 'Dates', 'Reason', 'Status', 'Action'], leaves.map(v => [`<b>${esc(v.name)}</b>`, `${fD(v.from)}${v.days > 1 ? ' to ' + fD(v.to) : ''}<br><small class="note">${v.days} day${v.days === 1 ? '' : 's'}</small>`, esc(v.reason), chip(v.status, LV_CHIP[v.status] || '') + (v.reason && v.status === 'Rejected' ? '' : ''),
          v.status === 'Pending' ? `<div class="toolbar"><button class="btn btn-xs btn-primary" data-act="lv" data-d="Approved" data-id="${v.id}">Approve</button><button class="btn btn-xs btn-danger" data-act="lv" data-d="Rejected" data-id="${v.id}">Reject</button></div>` : '<span class="note">Done</span>'])) : empty('No leave requests', 'Students ask for leave from their LMS. Requests show here and in your bell.')}
        <p class="note" style="margin-top:.5rem">The student is told your decision in their LMS notifications.</p></section>
      <section class="card" id="clear"><div class="card-h"><h2>Absence clearance queue</h2><div class="r">${chip(`Needs ${cfg.clearanceWatchPct}% of recording [provisional]`, 'a')}</div></div>
        ${clr.filter(c => c.batch === batch).length ? tbl(['Student', 'Missed lecture', 'Concepts', 'Recording watched', 'Status', 'Action'], clr.filter(c => c.batch === batch).map(c => [`<b>${esc(c.name)}</b><br><small class="note">${esc(c.note)}</small>`, `${esc(c.lecture)}<br><small class="note">${fD(c.date)}</small>`, c.concepts.map(x => esc(x.replace(' (concept)', ''))).join(', '), pbar(c.watch, c.watch >= c.minWatch ? '' : 'amber'), chip(c.status, c.status === 'Approved' ? 'g' : c.status === 'Pending' ? 'a' : c.status === 'Rejected' ? 'r' : 'b'),
          c.status === 'Pending' ? `<div class="toolbar"><button class="btn btn-xs btn-primary" data-act="clr" data-d="Approved" data-id="${c.id}" ${c.watch < c.minWatch ? `disabled title="Needs ${c.minWatch}% watched"` : ''}>Approve</button><button class="btn btn-xs btn-danger" data-act="clr" data-d="Rejected" data-id="${c.id}">Reject</button><button class="btn btn-xs" data-act="clr" data-d="Info requested" data-id="${c.id}">Ask for info</button></div>` : '–'])) : empty('No clearance requests for this batch')}
        <p class="note" style="margin-top:.5rem">Approve changes Absent to Present. One record feeds the student LMS, the admin register and the student report.</p></section>`;
    H.batch = el => location.hash = `#/trainer/attendance/${el.value}`;
    H.lect = el => location.hash = `#/trainer/attendance/${batch}/${el.value}`;
    const paint = () => $$('.seg[data-sid]').forEach(g => $$('button', g).forEach(b => b.setAttribute('aria-pressed', marks[g.dataset.sid] === b.dataset.v)));
    H.mark = b => { marks[b.closest('.seg').dataset.sid] = b.dataset.v; paint(); };
    H.allP = () => { students.forEach(s => marks[s.id] = 'P'); paint(); };
    H.useSugg = () => { students.forEach(s => marks[s.id] = sugg(s)); paint(); };
    H.save = async (b, e, mfa) => {
      if (students.some(s => !marks[s.id])) return toast('Mark every student before saving.', true);
      const cc = $$('.cc:checked').map(x => x.value);
      try { await API.saveAttendance(pick.id, marks, cc, mfa); toast('Attendance saved. The student LMS, admin register and report update from this record.'); PAGES.attendance(batch, pick.id); }
      catch (err) { if (err.code === 'MFA') { const code = await ask('Confirm with MFA', { mfa: true, text: err.message }); if (code && window.TrainerMFA.ok(code)) H.save(b, e, code); else if (code) toast('That authenticator code is not right.', true); } else fail(err); }
    };
    H.lock = async () => { const code = await ask('Lock lecture', { mfa: true, text: 'Locking stops further edits by you. Later changes go to the Student Mgmt admin with a reason.', ok: 'Lock lecture' }); if (!code) return; try { await API.lockLecture(pick.id, code); toast('Lecture locked.'); PAGES.attendance(batch, pick.id); } catch (e) { fail(e); } };
    H.log = async () => { const l = await API.attendanceEdits(pick.id); modal('Attendance change log', l.length ? tbl(['When', 'Student', 'Old', 'New', 'By', 'Reason'], l.map(x => [fDT(x.at), esc(window.TrainerDemo.name(x.sid)), x.old, x.new, esc(x.who), esc(x.reason)])) : empty('No changes recorded yet'), { wide: true }); };
    H.clr = async b => { const d = b.dataset.d; let r = ''; if (d !== 'Approved') { r = await ask(d === 'Rejected' ? 'Reject clearance' : 'Ask for more information', { placeholder: d === 'Rejected' ? 'Reason shown to the student' : 'What do you need from the student?', ok: d === 'Rejected' ? 'Reject' : 'Send' }); if (!r) return; }
      try { await API.decideClearance(b.dataset.id, d, r); toast(d === 'Approved' ? 'Absence cleared: marked Present.' : d === 'Rejected' ? 'Rejected. The student gets a bell message.' : 'Request for information sent.'); PAGES.attendance(batch, pick.id); } catch (e) { fail(e); } };
    H.lv = async b => { const d = b.dataset.d; let r = ''; if (d === 'Rejected') { r = await ask('Reject leave', { placeholder: 'Reason shown to the student', ok: 'Reject' }); if (!r) return; }
      try { await API.decideLeave(b.dataset.id, d, r); toast(d === 'Approved' ? 'Leave approved. The student has been told.' : 'Leave rejected. The student has been told.'); PAGES.attendance(batch, pick.id); } catch (e) { fail(e); } };
    if (location.hash.endsWith('#leave')) setTimeout(() => $('#leave')?.scrollIntoView({ behavior: 'smooth' }), 50);
    if (location.hash.endsWith('#clear')) setTimeout(() => $('#clear')?.scrollIntoView({ behavior: 'smooth' }), 50);
  });

  /* ======================= 6. CONTENT (course builder) ======================= */
  let contentTab = 'All Courses';
  const LTYPES = ['Video', 'PDF', 'Slides', 'Document', 'Link', 'Quiz', 'Lab', 'Live Class'];
  const FR = window.TrainerFiles.FILE_RULES;
  const stChip = s => chip(s, { Published: 'g', Draft: 'a', Unpublished: 'r', Ready: 'b' }[s]);
  PAGES.content = (cid, sub) => cid === 'new' ? courseForm() : cid ? (sub === 'manage' ? manageCourse(cid) : sub === 'enrolled' ? enrolledPage(cid) : builder(cid)) : page([['Content']], async () => {
    const cs = await API.courses();
    const f = { 'All Courses': () => true, Published: c => c.status === 'Published', Draft: c => c.status === 'Draft', Unpublished: c => c.status === 'Unpublished' };
    const list = cs.filter(f[contentTab]);
    view.innerHTML = `<div class="card-h"><h1>Course builder</h1><div class="r"><a class="btn btn-primary" href="#/trainer/content/new">+ New course</a></div></div>
      <div class="tabs" role="tablist">${Object.keys(f).map(k => `<button role="tab" aria-selected="${k === contentTab}" data-act="tab" data-t="${k}">${k} (${cs.filter(f[k]).length})</button>`).join('')}</div>
      <div class="grid g3">${list.map(c => `<div class="card ccard"><div class="cover">${esc(c.track.slice(0, 3).toUpperCase())}</div><div class="meta">${stChip(c.status)}${c.pendingDraft ? chip('Draft changes', 'a') : ''}${chip(c.mine ? 'Owner' : c.coEditor === 'trainer' ? 'Co-editor' : 'Read only', c.mine ? 'g' : 'b')}</div>
        <h3>${esc(c.title)}</h3><p class="note">${esc(c.track)} · ${esc(c.level)} · ${esc(c.duration)} · Owner: ${c.mine ? 'You' : esc(c.owner)}</p>
        <div class="kv" style="grid-template-columns:repeat(3,1fr)"><span>Modules<b>${c.modules.length}</b></span><span>Lessons<b>${c.modules.reduce((a, m) => a + m.lessons.length, 0)}</b></span><span>Enrolled<b>${c.enrolled}</b></span></div>
        <p class="note">Batch: ${c.batches.join(', ') || 'Not assigned'}${c.version ? ` · v${c.version}` : ''}</p>
        <div class="toolbar">${c.mine || c.coEditor === 'trainer' ? `<a class="btn btn-sm btn-primary" href="#/trainer/content/${c.id}">Edit</a><a class="btn btn-sm" href="#/trainer/content/${c.id}/manage">Manage</a>` : ''}<a class="btn btn-sm" href="#/trainer/content/${c.id}/enrolled">Students</a></div></div>`).join('') || `<div class="card" style="grid-column:1/-1">${empty('No courses here')}</div>`}</div>`;
    H.tab = b => { contentTab = b.dataset.t; PAGES.content(); };
  });
  function courseForm() {
    return page([['Content', '#/trainer/content'], ['New course']], async () => {
      view.innerHTML = `<section class="card" style="max-width:820px"><div class="card-h"><h1>Create course</h1></div><form class="form" id="ncF">
        <label>Course title<input id="ncT" required placeholder="e.g. Intro to Threat Hunting"></label>
        <div class="row3"><label>Track<select id="ncTr"><option>Defensive</option><option>Offensive</option><option>GRC</option><option>Foundations</option></select></label><label>Level<select id="ncL"><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select></label><label>Duration<input id="ncD" placeholder="4 weeks"></label></div>
        <label>Description<textarea id="ncDe"></textarea></label><label>Learning outcomes (one per line)<textarea id="ncO"></textarea></label>
        <div class="row2"><label>Cover image (optional)<input id="ncCv" type="file" accept="image/*"></label><label>Owner<input value="${esc(ME.name)} (you)" disabled></label></div>
        <fieldset style="border:1px solid var(--border);border-radius:10px;padding:.7rem"><legend class="note">Assign to batches</legend><div class="toolbar">${ME.batches.map(b => `<label style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" class="ncB" value="${b}">${b}</label>`).join('')}</div></fieldset>
        <p class="note">The course starts as Draft, visible only to you, co-editors and Content admins.</p><p class="err" id="ncE"></p>
        <div class="toolbar"><a class="btn" href="#/trainer/content">Cancel</a><button class="btn btn-primary" type="submit">Create and open builder</button></div></form></section>`;
      $('#ncF').addEventListener('submit', async e => { e.preventDefault();
        try { const id = await API.saveCourse({ title: $('#ncT').value, track: $('#ncTr').value, level: $('#ncL').value, duration: $('#ncD').value || 'Self-paced', desc: $('#ncDe').value, outcomes: $('#ncO').value.split('\n').filter(Boolean), batches: $$('.ncB:checked').map(x => x.value), cover: $('#ncCv').files[0]?.name || '' });
          toast('Course created as Draft.'); location.hash = `#/trainer/content/${id}`; } catch (err) { $('#ncE').textContent = err.message; } });
    });
  }
  let selLesson = null;
  const builder = cid => page([['Content', '#/trainer/content'], ['…']], async () => {
    const c = await API.course(cid);
    setCrumb([['Content', '#/trainer/content'], [c.title]]);
    const editable = c.owner === 'trainer' || c.coEditor === 'trainer';
    let dirty = false;
    const findL = id => { for (const m of c.modules) { const l = m.lessons.find(x => x.id === id); if (l) return [m, l]; } return []; };
    const draw = () => {
      const [, L] = findL(selLesson);
      view.innerHTML = `<div class="card-h"><div><h1>${esc(c.title)}</h1><p class="note">${esc(c.track)} · ${esc(c.level)} · ${esc(c.duration)} · Batches: ${c.batches.join(', ') || 'none'}</p></div>
          <div class="r">${stChip(c.status)}${c.status === 'Published' ? chip('Edits save as a new draft version', 'a') : ''}<button class="btn btn-sm" data-act="preview">Preview as student</button><a class="btn btn-sm" href="#/trainer/content/${cid}/manage">Manage course</a><button class="btn btn-sm btn-primary" data-act="saveDraft" ${editable ? '' : 'disabled'}>Save draft${dirty ? ' •' : ''}</button></div></div>
        <div class="dash"><section class="card s7"><div class="card-h"><h2>Course › Modules › Lessons</h2><div class="r"><button class="btn btn-sm" data-act="addMod" ${editable ? '' : 'disabled'}>+ Add module</button></div></div>
          <div class="builder">${c.modules.map((m, mi) => `<div class="mod" draggable="${editable}" data-mod="${m.id}"><div class="mod-h"><span class="drag" title="Drag to reorder" aria-hidden="true">⠿</span><span class="note mono">M${mi + 1}</span><input value="${esc(m.title)}" data-inp="modTitle" data-id="${m.id}" aria-label="Module title" ${editable ? '' : 'disabled'}>
              <button class="btn btn-xs" data-act="mvMod" data-id="${m.id}" data-d="-1" aria-label="Move module up">↑</button><button class="btn btn-xs" data-act="mvMod" data-id="${m.id}" data-d="1" aria-label="Move module down">↓</button><button class="btn btn-xs" data-act="addLes" data-id="${m.id}" ${editable ? '' : 'disabled'}>+ Add lesson</button></div>
            <div class="lessons" data-mod="${m.id}">${m.lessons.map(l => `<div class="les ${l.id === selLesson ? 'sel' : ''}" draggable="${editable}" data-les="${l.id}" data-act="sel" data-id="${l.id}" tabindex="0"><span class="drag" aria-hidden="true">⠿</span><div class="grow"><b>${esc(l.title)}</b><br><small class="note">${l.type}${l.concept ? ' · CONCEPT' : ''}${l.file ? ` · ${esc(l.file.name)}` : ''}</small></div>${l.file && l.file.scan !== 'Clean' ? chip(l.file.scan, l.file.scan === 'Infected' ? 'r' : 'a') : ''}${l.file && l.file.proc !== 'Ready' ? chip(l.file.proc, 'a') : ''}${stChip(l.status)}</div>`).join('') || '<p class="note">No lessons yet. Add one or drag one here.</p>'}</div></div>`).join('') || empty('No modules yet', 'Add your first module.')}</div></section>
          <section class="card s5">${L ? lessonPanel(L, editable) : empty('Select a lesson', 'Pick a lesson to edit its settings and upload content.')}</section></div>`;
      bindDnD();
    };
    function lessonPanel(l, ed) {
      const f = l.file, dis = ed ? '' : 'disabled';
      return `<div class="card-h"><h2>Lesson settings</h2><div class="r">${stChip(l.status)}</div></div><div class="form">
        <label>Title<input data-inp="lf" data-k="title" value="${esc(l.title)}" ${dis}></label>
        <div class="row2"><label>Lesson type<select data-chg="lf" data-k="type" ${dis}>${LTYPES.map(t => `<option ${t === l.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <label>Status<select data-chg="lf" data-k="status" ${dis}>${['Draft', 'Ready'].concat(l.status === 'Published' ? ['Published'] : []).map(t => `<option ${t === l.status ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
        <label>Release date and time<input type="datetime-local" data-chg="lf" data-k="release" value="${l.release ? toLocalInput(l.release) : ''}" ${dis}></label>
        <div class="toolbar"><label style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" data-chg="lfb" data-k="concept" ${l.concept ? 'checked' : ''} ${dis}>Concept lecture tag</label>
          <label style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" data-chg="lfb" data-k="batchOnly" ${l.batchOnly ? 'checked' : ''} ${dis}>Batch only</label>
          <label style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" data-chg="lfb" data-k="dl" ${l.dl ? 'checked' : ''} ${dis}>Allow downloads</label></div>
        ${['Quiz', 'Lab', 'Live Class'].includes(l.type) ? `<p class="info">${l.type === 'Lab' ? 'Labs are linked from the lab catalog. Lab flags and answers are never visible here.' : l.type === 'Quiz' ? 'Attach a quiz from Assessments. Answer keys stay on the server.' : 'Live classes are scheduled under Classes.'}</p>` :
        `<div class="upl"><b>Content</b>${f && !window.TrainerFiles.fileFits(l.type, f.name) ? `<p class="warn">${esc(f.name)} is not a ${l.type} file. Upload a ${FR[l.type].label.split(' up to')[0]} or change the lesson type.</p>` : ''}${f ? `<div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap"><span>${esc(f.name)}</span><span class="note">${f.sizeMB >= 1024 ? (f.sizeMB / 1024).toFixed(1) + ' GB' : f.sizeMB + ' MB'}</span>${chip('Scan: ' + f.scan, f.scan === 'Clean' ? 'g' : f.scan === 'Infected' ? 'r' : 'a')}${chip(l.type === 'Video' ? 'Video: ' + f.proc : f.proc, f.proc === 'Ready' ? 'g' : 'a')}</div>
            <div class="prog" aria-label="Upload progress"><i style="--w:${f.progress}%"></i></div><span class="note">${f.progress < 100 ? `Uploading ${f.progress}%` : 'Uploaded'}</span>` : '<span class="note">No content yet.</span>'}
          ${l.type === 'Link' ? `<label>URL<input data-inp="lf" data-k="url" value="${esc(l.url || '')}" placeholder="https://" ${dis}></label>` : `<label class="btn btn-sm" style="display:inline-flex;width:max-content;cursor:pointer">Upload ${l.type.toLowerCase()}<input type="file" data-chg="upload" hidden accept="${FR[l.type].ext.map(e => '.' + e).join(',')}" ${dis}></label>
          <span class="note">This ${l.type} lesson accepts: ${FR[l.type].label}.</span>`}</div>`}
        <div class="toolbar"><button class="btn btn-sm btn-danger" data-act="delLes" ${dis}>Remove lesson</button></div></div>`;
    }
    const touch = () => { dirty = true; const b = $('[data-act=saveDraft]'); if (b) b.textContent = 'Save draft •'; };
    H.sel = b => { selLesson = b.dataset.id; draw(); };
    H.addMod = () => { c.modules.push({ id: 'M' + Date.now(), title: `Module ${c.modules.length + 1}`, lessons: [] }); touch(); draw(); };
    H.addLes = b => { const m = c.modules.find(x => x.id === b.dataset.id); const l = { id: 'LS-' + Date.now(), title: 'New lesson', type: 'Video', concept: false, status: 'Draft', file: null, release: null, batchOnly: true, dl: false }; m.lessons.push(l); selLesson = l.id; touch(); draw(); };
    H.mvMod = b => { const i = c.modules.findIndex(x => x.id === b.dataset.id), j = i + +b.dataset.d; if (j < 0 || j >= c.modules.length) return; [c.modules[i], c.modules[j]] = [c.modules[j], c.modules[i]]; touch(); draw(); };
    H.modTitle = el => { c.modules.find(x => x.id === el.dataset.id).title = el.value; touch(); };
    H.lf = el => { const [, l] = findL(selLesson); const k = el.dataset.k; l[k] = k === 'release' ? (el.value ? new Date(el.value).getTime() : null) : el.value; if (k === 'type' && l.file && !window.TrainerFiles.fileFits(l.type, l.file.name)) { toast(`${l.file.name} does not fit a ${l.type} lesson, so it was removed. Upload a matching file.`, true); l.file = null; l.status = 'Draft'; } if (k === 'title') { const t = $(`.les[data-les="${l.id}"] b`); if (t) t.textContent = el.value; } touch(); if (el.tagName === 'SELECT') draw(); };
    H.lfb = el => { const [, l] = findL(selLesson); l[el.dataset.k] = el.checked; touch(); draw(); };
    H.delLes = () => { const [m] = findL(selLesson); m.lessons = m.lessons.filter(x => x.id !== selLesson); selLesson = null; touch(); draw(); };
    H.upload = el => {
      const file = el.files[0]; if (!file) return; const [, l] = findL(selLesson); const mb = +(file.size / 1048576).toFixed(1), rule = FR[l.type], isVid = l.type === 'Video';
      el.value = '';
      if (!rule) return toast(`${l.type} lessons do not take uploads.`, true);
      if (!window.TrainerFiles.fileFits(l.type, file.name) || (file.type && !rule.mime.test(file.type))) return toast(`"${file.name}" is not a ${l.type} file. This lesson accepts ${rule.label}.`, true);
      if (mb > rule.maxMB) return toast(`Too large: ${rule.label}.`, true);
      l.file = { name: file.name, sizeMB: mb, scan: 'Waiting', proc: isVid ? 'Waiting' : 'Ready', progress: 0 }; l.status = 'Draft'; touch(); draw();
      const t = setInterval(() => { if (l.file.progress < 100) l.file.progress = Math.min(100, l.file.progress + 20); else if (l.file.scan !== 'Clean') l.file.scan = l.file.scan === 'Waiting' ? 'Scanning' : /eicar/i.test(file.name) ? 'Infected' : 'Clean'; else if (l.file.proc !== 'Ready') l.file.proc = l.file.proc === 'Waiting' ? 'Processing' : 'Ready'; else { clearInterval(t); l.status = 'Ready'; toast(`${file.name} uploaded, scanned and ready.`); } if (selLesson === l.id || true) draw(); if (l.file.scan === 'Infected') { clearInterval(t); toast('Virus scan failed. The file is blocked.', true); } }, 450);
    };
    H.saveDraft = async () => { try { await API.saveCourse({ id: c.id, modules: c.modules }); dirty = false; toast(c.status === 'Published' ? 'Saved as a new draft version. Publish the update from Manage course.' : 'Draft saved.'); draw(); } catch (e) { fail(e); } };
    H.preview = () => previewAsStudent(c);
    function bindDnD() {
      let drag = null;
      $$('.les[draggable=true]').forEach(el => { el.addEventListener('dragstart', e => { drag = { kind: 'les', id: el.dataset.les }; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.stopPropagation(); }); el.addEventListener('dragend', () => el.classList.remove('dragging')); });
      $$('.mod[draggable=true]').forEach(el => { el.addEventListener('dragstart', e => { if (drag) return; drag = { kind: 'mod', id: el.dataset.mod }; el.classList.add('dragging'); }); el.addEventListener('dragend', () => { el.classList.remove('dragging'); drag = null; }); });
      $$('.lessons').forEach(z => { z.addEventListener('dragover', e => { if (drag && drag.kind === 'les') { e.preventDefault(); z.classList.add('drop-over'); } }); z.addEventListener('dragleave', () => z.classList.remove('drop-over'));
        z.addEventListener('drop', e => { e.preventDefault(); z.classList.remove('drop-over'); if (!drag || drag.kind !== 'les') return; const [from, l] = findL(drag.id); from.lessons = from.lessons.filter(x => x.id !== l.id);
          const to = c.modules.find(m => m.id === z.dataset.mod), after = [...z.querySelectorAll('.les')].find(n => e.clientY < n.getBoundingClientRect().top + n.offsetHeight / 2);
          const idx = after ? to.lessons.findIndex(x => x.id === after.dataset.les) : -1; idx < 0 ? to.lessons.push(l) : to.lessons.splice(idx, 0, l); drag = null; touch(); draw(); }); });
      $$('.mod').forEach(z => { z.addEventListener('dragover', e => { if (drag && drag.kind === 'mod') e.preventDefault(); }); z.addEventListener('drop', e => { if (!drag || drag.kind !== 'mod') return; e.preventDefault(); const i = c.modules.findIndex(m => m.id === drag.id), j = c.modules.findIndex(m => m.id === z.dataset.mod); const [mm] = c.modules.splice(i, 1); c.modules.splice(j, 0, mm); drag = null; touch(); draw(); }); });
    }
    draw();
  });
  function previewAsStudent(c) {
    modal(`Preview as student: ${c.title}`, `<p class="info">Preview only. No progress or attendance is recorded.</p><div class="list" style="margin-top:.8rem">${c.modules.map((m, i) => `<div class="card"><h3>Module ${i + 1}: ${esc(m.title)}</h3><div class="list" style="margin-top:.5rem">${m.lessons.map(l => { const hidden = l.release && l.release > Date.now(); return `<div class="li">${chip(l.type, 'c')}<div class="grow"><b>${esc(l.title)}</b><span class="note">${hidden ? 'Opens ' + fDT(l.release) : l.status === 'Published' || l.status === 'Ready' ? 'Available' : 'Not visible yet (draft)'}${l.dl ? ' · Download allowed' : ''}</span></div>${l.concept ? chip('Concept', 'p') : ''}</div>`; }).join('') || '<p class="note">Empty module</p>'}</div></div>`).join('')}</div>`, { wide: true });
  }
  const manageCourse = cid => page([['Content', '#/trainer/content'], ['…'], ['Manage']], async () => {
    const [c, r] = await Promise.all([API.course(cid), API.readiness(cid)]);
    setCrumb([['Content', '#/trainer/content'], [c.title, `#/trainer/content/${cid}`], ['Manage']]);
    const ed = c.owner === 'trainer' || c.coEditor === 'trainer';
    view.innerHTML = `<div class="card-h"><div><h1>Manage course</h1><p class="note">${esc(c.title)} · v${c.version || 0} · ${stChip(c.status)} ${c.pendingDraft ? chip('Unpublished draft changes', 'a') : ''}</p></div>
        <div class="r"><button class="btn btn-sm" data-act="preview">Preview as student</button><a class="btn btn-sm" href="#/trainer/content/${cid}">Open builder</a><a class="btn btn-sm" href="#/trainer/content/${cid}/enrolled">Enrolled students</a></div></div>
      ${c.status === 'Unpublished' && c.unpublishReason ? `<div class="warn">Unpublished: ${esc(c.unpublishReason)}</div>` : ''}
      <div class="dash"><section class="card s6"><div class="card-h"><h2>Publish readiness</h2><div class="r">${r.ok ? chip('Ready to publish', 'g') : chip('Blocked', 'r')}</div></div>
        <div class="checks">${r.checks.map(x => `<div>${x.ok ? chip('Pass', 'g') : chip('Fail', 'r')}<span>${esc(x.label)}</span></div>`).join('')}</div>
        <div class="toolbar" style="margin-top:1rem"><a class="btn btn-sm" href="#/trainer/content/${cid}">Save draft (in builder)</a>
          <button class="btn btn-sm btn-primary" data-act="publish" ${r.ok && ed && (c.status !== 'Published' || c.pendingDraft) ? '' : 'disabled'}>${c.status === 'Published' ? 'Publish update' : 'Publish'}</button>
          <button class="btn btn-sm btn-danger" data-act="unpub" ${c.status === 'Published' && ed ? '' : 'disabled'}>Unpublish</button></div>
        ${!r.ok ? '<p class="note" style="margin-top:.5rem">Publishing stays off until every check passes, including uploads still processing or failing the virus scan.</p>' : ''}</section>
      <section class="card s6"><div class="card-h"><h2>Edit history and versions</h2></div>${c.versions.length ? tbl(['Version', 'Status', 'Author', 'When', 'Changes', ''], c.versions.map(v => [`<b>v${v.v}</b>`, stChip(v.status), esc(v.author), fDT(v.at), esc(v.summary), `<div class="toolbar">${v.snapshot ? `<button class="btn btn-xs" data-act="cmp" data-v="${v.v}">Compare</button><button class="btn btn-xs" data-act="restore" data-v="${v.v}" ${ed ? '' : 'disabled'}>Restore as draft</button>` : '<span class="note">–</span>'}</div>`])) : empty('No versions yet', 'Each publish creates a numbered version.')}</section></div>`;
    // catalog listing and FAQs: shown on the public course page and in the student LMS once the course is published
    const CATS = ['Cybersecurity Fundamentals', 'Defensive Security and SOC', 'Offensive Security and Ethical Hacking', 'Security Testing', 'Cloud Security', 'Governance, Risk and Compliance (GRC)', 'Digital Forensics and Incident Response', 'Cyber Forensics', 'AI and Cybersecurity', 'Capture the Flag (CTF)', 'Networking', 'Communication Skills', 'Career Readiness'];
    const FMT = ['Instructor-led', 'Self-paced', 'Lab-based'];
    let faqs = (c.faqs || []).map(x => ({ ...x }));
    const faqRows = () => faqs.map((f, i) => `<div class="card" style="padding:.7rem;margin-bottom:.5rem"><label>Question<input data-fq="${i}" value="${esc(f.q)}" ${ed ? '' : 'disabled'}></label><label>Answer<textarea data-fa="${i}" rows="2" ${ed ? '' : 'disabled'}>${esc(f.a)}</textarea></label>${ed ? `<button class="btn btn-xs" data-act="faqDel" data-i="${i}">Remove</button>` : ''}</div>`).join('') || '<p class="note">No FAQs written by the course team yet.</p>';
    view.insertAdjacentHTML('beforeend', `<section class="card" style="margin-top:1rem" id="catCard"><div class="card-h"><h2>Catalog listing and FAQs</h2><div class="r">${c.status === 'Published' ? chip('Live on the course page', 'g') : chip('Hidden until published', 'a')}</div></div>
      <p class="note">These details show on the public course page and in the student LMS. Leave a field empty to hide it. FAQs for learning goals, prerequisites, format, labs, duration, access and certificate are built from these fields; add your own below.</p>
      <form class="form" id="catF"><div class="grid g2"><label>Category<select name="category" ${ed ? '' : 'disabled'}>${CATS.concat(CATS.includes(c.category) ? [] : [c.category]).map(x => `<option ${x === c.category ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
        <label>Access<select name="access" ${ed ? '' : 'disabled'}><option value="paid" ${c.access !== 'free' ? 'selected' : ''}>Paid (needs enrolment)</option><option value="free" ${c.access === 'free' ? 'selected' : ''}>Free</option></select></label></div>
        <fieldset style="border:0;padding:0;margin:.4rem 0"><legend class="note">Format</legend>${FMT.map(x => `<label style="display:inline-flex;gap:.3rem;margin-right:1rem"><input type="checkbox" name="format" value="${x}" ${(c.format || []).includes(x) ? 'checked' : ''} ${ed ? '' : 'disabled'}>${x}</label>`).join('')}
        <label style="display:inline-flex;gap:.3rem"><input type="checkbox" name="featured" ${c.featured ? 'checked' : ''} ${ed ? '' : 'disabled'}>Featured on the landing page</label></fieldset>
        <label>Overview<textarea name="overview" rows="2" ${ed ? '' : 'disabled'}>${esc(c.overview || '')}</textarea></label>
        <div class="grid g2"><label>Who it is for<input name="audience" value="${esc(c.audience || '')}" ${ed ? '' : 'disabled'}></label><label>Prerequisites<input name="prerequisites" value="${esc(c.prerequisites || '')}" ${ed ? '' : 'disabled'}></label></div>
        <div class="grid g2"><label>Certificate (leave empty if none)<input name="certificate" value="${esc(c.certificate || '')}" ${ed ? '' : 'disabled'}></label><label>Hands-on labs and projects (one per line)<textarea name="labs" rows="3" ${ed ? '' : 'disabled'}>${esc((c.labs || []).join('\n'))}</textarea></label></div>
        <h3 style="margin-top:.8rem">FAQs written by the course team</h3><div id="faqRows">${faqRows()}</div>
        ${ed ? '<div class="toolbar"><button type="button" class="btn btn-sm" data-act="faqAdd">+ Add FAQ</button><button type="submit" class="btn btn-sm btn-primary">Save listing and FAQs</button></div>' : '<p class="note">Read only: you do not own or co-edit this course.</p>'}<p class="err" id="catE" role="alert"></p></form></section>`);
    const syncFaq = () => { faqs = faqs.map((f, i) => ({ q: ($(`[data-fq="${i}"]`) || {}).value ?? f.q, a: ($(`[data-fa="${i}"]`) || {}).value ?? f.a })); };
    H.faqAdd = () => { syncFaq(); faqs.push({ q: '', a: '' }); $('#faqRows').innerHTML = faqRows(); };
    H.faqDel = b => { syncFaq(); faqs.splice(+b.dataset.i, 1); $('#faqRows').innerHTML = faqRows(); };
    $('#catF').addEventListener('submit', async e => { e.preventDefault(); syncFaq(); const f = e.target, bt = f.querySelector('[type=submit]'); $('#catE').textContent = ''; bt.disabled = true;
      try { await API.saveCatalog(cid, { category: f.category.value, access: f.access.value, featured: f.featured.checked, format: [...f.querySelectorAll('[name=format]:checked')].map(x => x.value), overview: f.overview.value, audience: f.audience.value, prerequisites: f.prerequisites.value, certificate: f.certificate.value, labs: f.labs.value, faqs });
        toast('Listing and FAQs saved. The course page and the student LMS show them now.'); manageCourse(cid); } catch (x) { $('#catE').textContent = x.message; bt.disabled = false; } });
    H.preview = () => previewAsStudent(c);
    H.publish = async () => { const s = await ask(c.status === 'Published' ? 'Publish update' : 'Publish course', { label: 'Summary of changes', placeholder: 'e.g. Added module 3 on hunting', ok: 'Publish' }); if (!s) return; try { await API.publish(cid, s); toast('Published. Students in the assigned batches get a bell message.'); manageCourse(cid); } catch (e) { fail(e); } };
    H.unpub = async () => { const s = await ask('Unpublish course', { text: 'The reason is shown to the batch. Progress, grades and attendance are kept. The batch is told in-app and by email.', placeholder: 'Reason shown to the batch', ok: 'Unpublish' }); if (!s) return; try { await API.unpublish(cid, s); toast('Unpublished. The batch got a "Course paused" notice.'); manageCourse(cid); } catch (e) { fail(e); } };
    H.restore = async b => { try { await API.restoreVersion(cid, +b.dataset.v); toast(`v${b.dataset.v} restored as a draft. Review it in the builder, then publish.`); manageCourse(cid); } catch (e) { fail(e); } };
    H.cmp = b => { const v = c.versions.find(x => x.v === +b.dataset.v); const old = JSON.parse(v.snapshot); const titles = ms => ms.flatMap(m => [m.title, ...m.lessons.map(l => '  ' + l.title)]);
      const a = titles(old), n = titles(c.modules); modal(`Compare v${v.v} with current draft`, `<div class="grid g2"><div><b>v${v.v}</b><pre class="note">${a.map(x => (n.includes(x) ? '  ' : '− ') + esc(x)).join('\n')}</pre></div><div><b>Current</b><pre class="note">${n.map(x => (a.includes(x) ? '  ' : '+ ') + esc(x)).join('\n')}</pre></div></div>`, { wide: true }); };
  });
  const enrolledPage = cid => page([['Content', '#/trainer/content'], ['…'], ['Enrolled students']], async () => {
    const [c, e] = await Promise.all([API.course(cid), API.enrolled(cid)]);
    setCrumb([['Content', '#/trainer/content'], [c.title, `#/trainer/content/${cid}/manage`], ['Enrolled students']]);
    view.innerHTML = `<div class="card-h"><h1>Enrolled students</h1><div class="r">${chip(e.rows.length + ' in your batches', 'g')}${e.otherBatches ? chip(`${e.otherBatches} in other batches`, '') : ''}</div></div>
      ${e.rows.length ? tbl(['Student', 'Batch', 'Course progress', 'Lectures attended', 'Last active', 'Flag'], e.rows.map(r => [`<a href="#/trainer/students/${r.id}"><b>${esc(r.name)}</b></a>`, r.batch, pbar(r.progress, 'blue'), r.lectures, ago(r.lastActive), flagChip(r.flag)])) : `<div class="card">${empty('No students from your batches', 'Assign a batch to this course to see them here.')}</div>`}
      <p class="hidden-note">Contact, guardian and financial details are hidden. Students of other batches show as a count only.</p>`;
  });

  /* ======================= 7. ASSESSMENTS ======================= */
  PAGES.assessments = (aid, sid) => aid === 'new' ? newAssessment() : aid ? (sid ? gradeView(aid, sid) : assessmentView(aid)) : page([['Assessments']], async () => {
    const as = await API.assessments(); const now = Date.now(), cfg = API.cfg();
    const st = a => a.state === 'Draft' ? ['Draft', 'a'] : a.auto ? ['Auto-graded', 'g'] : a.subs.every(s => s.state === 'Published') && a.subs.length ? ['Graded', 'g'] : a.due < now - cfg.gradingTurnaroundDays * DAY ? ['Grading overdue', 'r'] : a.due < now ? ['To grade', 'a'] : ['Open', 'b'];
    const upcoming = as.filter(a => a.due > now).sort((a, b) => a.due - b.due);
    view.innerHTML = `<div class="card-h"><h1>Assessments</h1><div class="r">${chip(`Grading turnaround ${cfg.gradingTurnaroundDays} days [provisional]`, '')}<a class="btn btn-primary" href="#/trainer/assessments/new">+ Create assessment</a></div></div>
      ${tbl(['Assessment', 'Type', 'Course · Batch', 'Due', 'Submissions', 'Grading', ''], as.map(a => { const sub = a.auto ? (a.submitted || 0) : a.subs.length, done = a.subs.filter(s => s.state === 'Published').length, [t, c] = st(a);
        return [`<b>${esc(a.title)}</b>`, chip(a.type, a.type === 'Exam' ? 'p' : a.type === 'Quiz' ? 'c' : 'b'), `${esc(courseName(a.courseId))}<br><small class="note">${a.batch}</small>`, `${fD(a.due)}${a.due > now && a.due - now < 2 * DAY ? ' ' + chip('Due soon', 'a') : ''}`, pbar(Math.round(sub / a.enrolled * 100), 'blue') + `<small class="note"> ${sub}/${a.enrolled}</small>`, a.auto ? '<span class="note">No action</span>' : `${chip(t, c)}<br><small class="note">${done}/${a.subs.length} published</small>`, a.auto ? '' : `<a class="btn btn-xs btn-primary" href="#/trainer/assessments/${a.id}">Open</a>`]; }))}
      <section class="card"><div class="card-h"><h3>Upcoming deadlines</h3></div><div class="list">${upcoming.map(a => `<div class="li ${a.due - now < 2 * DAY ? 'amber' : 'green'}"><span class="t">${fD(a.due)}</span><span>${esc(a.title)} · ${a.batch}</span></div>`).join('') || empty('No upcoming deadlines')}</div></section>`;
  });
  function newAssessment() {
    return page([['Assessments', '#/trainer/assessments'], ['Create']], async () => {
      const [qb, courses] = await Promise.all([API.qbank(), API.courses()]);
      const mine = courses.filter(c => c.mine || c.coEditor === 'trainer');
      view.innerHTML = `<section class="card" style="max-width:900px"><div class="card-h"><h1>Create assessment</h1></div><form class="form" id="naF">
        <div class="row3"><label>Title<input id="naT" placeholder="Quiz 4: Phishing"></label><label>Type<select id="naY"><option>Quiz</option><option>Assignment</option><option>Exam</option></select></label><label>Batch<select id="naB">${ME.batches.map(b => `<option>${b}</option>`).join('')}</select></label></div>
        <div class="row3"><label>Course<select id="naC">${mine.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join('')}</select></label><label>Link to lesson or module<select id="naL"></select></label><label>Opens<input id="naO" type="datetime-local" value="${toLocalInput(Date.now())}"></label></div>
        <label>Due date<input id="naD" type="datetime-local" value="${toLocalInput(Date.now() + 7 * DAY)}"></label>
        <fieldset style="border:1px solid var(--border);border-radius:10px;padding:.7rem"><legend class="note">Questions from the Content Admin's question bank</legend><div class="list">${qb.map(q => `<label class="li" style="display:flex"><input type="checkbox" class="naQ" value="${q.id}">${chip(q.topic, 'c')}<span>${esc(q.text)}</span></label>`).join('')}</div>
          <p class="note" style="margin-top:.5rem">You can pick questions but not edit the bank. Correct answers and keys stay on the server. New questions are written in Assessment Mgmt (Content admin).</p></fieldset>
        <p class="err" id="naE"></p><div class="toolbar"><a class="btn" href="#/trainer/assessments">Cancel</a><button class="btn" type="button" id="naDraft">Save draft</button><button class="btn btn-primary" type="submit">Publish to batch</button></div></form></section>`;
      const fillL = async () => { const c = await API.course($('#naC').value); if (!$('#naL')) return; $('#naL').innerHTML = c.modules.flatMap(m => [`<option value="${m.id}">End of module: ${esc(m.title)}</option>`, ...m.lessons.map(l => `<option value="${l.id}">Lesson: ${esc(l.title)}</option>`)]).join(''); };
      $('#naC').onchange = fillL; fillL();
      const go = async draft => { try { await API.createAssessment({ title: $('#naT').value.trim(), type: $('#naY').value, batch: $('#naB').value, courseId: $('#naC').value, lesson: $('#naL').value, open: new Date($('#naO').value).getTime(), due: new Date($('#naD').value).getTime(), questions: $$('.naQ:checked').map(x => x.value), state: draft ? 'Draft' : 'Open' }); toast(draft ? 'Assessment saved as draft.' : 'Assessment published to the batch.'); location.hash = '#/trainer/assessments'; } catch (e) { $('#naE').textContent = e.message; } };
      $('#naF').addEventListener('submit', e => { e.preventDefault(); go(false); }); $('#naDraft').onclick = () => go(true);
    });
  }
  const assessmentView = aid => page([['Assessments', '#/trainer/assessments'], ['…']], async () => {
    const a = (await API.assessments()).find(x => x.id === aid); if (!a) { const e = new Error('This assessment is not in your batches.'); e.code = 403; throw e; }
    setCrumb([['Assessments', '#/trainer/assessments'], [a.title]]);
    view.innerHTML = `<div class="card-h"><div><h1>${esc(a.title)}</h1><p class="note">${a.type} · ${a.batch} · due ${fDT(a.due)}</p></div></div>
      ${a.subs.length ? tbl(['Student', 'Submitted', 'File', 'State', 'Score', ''], a.subs.map(s => [`<b>${esc(s.name)}</b>`, ago(s.submittedAt), `<span class="note">${esc(s.file)}</span>`, chip(s.state || 'To grade', { Published: 'g', Returned: 'b', Draft: 'a' }[s.state] || 'a'), s.published ? s.published.total : '–', `<a class="btn btn-xs btn-primary" href="#/trainer/assessments/${aid}/${s.sid}">${s.state === 'Published' ? 'Regrade' : 'Grade'}</a>`])) : `<div class="card">${empty('No submissions yet')}</div>`}`;
  });
  const gradeView = (aid, sid) => page([['Assessments', '#/trainer/assessments'], ['…'], ['Grade']], async () => {
    const a = (await API.assessments()).find(x => x.id === aid); const s = a && a.subs.find(x => x.sid === sid); if (!s) { const e = new Error('Submission not found in your batches.'); e.code = 403; throw e; }
    setCrumb([['Assessments', '#/trainer/assessments'], [a.title, `#/trainer/assessments/${aid}`], [s.name]]);
    const crit = a.rubric || ['Accuracy', 'Method', 'Clarity'];
    view.innerHTML = `<div class="dash"><section class="card s7"><div class="card-h"><h2>Submission: ${esc(s.name)}</h2><div class="r">${chip(s.state || 'To grade', s.state === 'Published' ? 'g' : 'a')}</div></div>
        <div class="upl" style="min-height:260px;align-content:start"><b>${esc(s.file)}</b><span class="note">Submitted ${fDT(s.submittedAt)}</span>
          <div style="margin-top:.6rem;padding:1rem;border-radius:10px;background:var(--bg-deep);font-size:.85rem;line-height:1.7"><b>File preview</b><br>1. Summary of findings…<br>2. Indicators observed (sender domain, headers, link mismatch)…<br>3. Recommended response…<br><span class="note">(Sample preview. In production the file viewer renders the uploaded PDF.)</span></div></div></section>
      <section class="card s5"><div class="card-h"><h2>Rubric</h2></div><div class="form">
        ${crit.map(c => `<div class="rub"><label for="r-${c}">${c} (0 to 5)</label><input id="r-${c}" class="rb" data-k="${c}" type="number" min="0" max="5" value="${s.rubric[c] ?? ''}" style="width:90px" data-inp="tot"></div>`).join('')}
        <div class="rub"><b>Total</b><b id="tot" style="font-size:1.3rem">0 / ${crit.length * 5}</b></div>
        <label>Trainer comments<textarea id="gc">${esc(s.comment)}</textarea></label>
        ${s.history.length ? `<p class="note">Regrade history: ${s.history.map(h => `${h.old} → (${esc(h.reason)})`).join('; ')}</p>` : ''}
        <div class="toolbar"><button class="btn btn-sm" data-act="g" data-a="Draft">Save draft</button><button class="btn btn-sm" data-act="g" data-a="Return">Return</button><button class="btn btn-sm btn-primary" data-act="g" data-a="Publish">Publish grade</button></div>
        <p class="note">Published grades and comments appear in the student's LMS and feed Courses + Assessments (35%) of the Performance Index. Publishing needs MFA; changing a published grade needs a reason.</p></div></section></div>`;
    const tot = () => { $('#tot').textContent = `${$$('.rb').reduce((x, i) => x + (+i.value || 0), 0)} / ${crit.length * 5}`; }; tot(); H.tot = tot;
    H.g = async b => {
      const rubric = {}; let bad = false; $$('.rb').forEach(i => { const v = +i.value; if (i.value === '' || v < 0 || v > 5) bad = true; rubric[i.dataset.k] = v; });
      if (bad && b.dataset.a !== 'Draft') return toast('Score every criterion from 0 to 5.', true);
      let reason = '', mfa = '';
      if (b.dataset.a === 'Publish') { if (s.published) { reason = await ask('Regrade a published score', { placeholder: 'Why is the grade changing?', ok: 'Continue' }); if (!reason) return; } mfa = await ask('Publish grade', { mfa: true, ok: 'Publish' }); if (!mfa) return; }
      try { await API.grade(aid, sid, { rubric, comment: $('#gc').value, mfa }, b.dataset.a, reason); toast(b.dataset.a === 'Publish' ? 'Grade published to the student LMS.' : b.dataset.a === 'Return' ? 'Returned to the student for changes.' : 'Draft saved.'); location.hash = `#/trainer/assessments/${aid}`; } catch (e) { fail(e); }
    };
  });

  /* ======================= 8. LAB MONITOR ======================= */
  PAGES.labs = batch => page([['Lab Monitor']], async () => {
    batch = ME.batches.includes(batch) ? batch : ME.batches[0];
    const d = await API.labs(batch), cfg = API.cfg();
    const count = st => d.rows.reduce((a, r) => a + r.labs.filter(l => l.state === st).length, 0);
    view.innerHTML = `<div class="card-h"><h1>Lab monitor</h1><div class="r">${chip('Read only', 'b')}<select data-chg="b" style="width:auto" aria-label="Batch">${ME.batches.map(b => `<option ${b === batch ? 'selected' : ''}>${b}</option>`).join('')}</select></div></div>
      <div class="grid g4"><div class="stat green"><b>${count('Done')}</b><span>Done</span></div><div class="stat blue"><b>${count('In Progress')}</b><span>In progress</span></div><div class="stat red"><b>${count('Stuck')}</b><span>Stuck ${tip(`Stuck = no checkpoint for ${cfg.stuckMinutes} minutes.`)}</span></div><div class="stat"><b>${count('Not Started')}</b><span>Not started</span></div></div>
      ${tbl(['Student', ...d.missions, ''], d.rows.map(r => [`<b>${esc(r.name)}</b>`, ...r.labs.map(l => `${labChip(l.state)}<br><small class="note">${l.cp}/${l.cpTotal} cp${l.mins ? ` · ${l.mins} min` : ''}${l.hint !== '-' ? ` · hint ${l.hint}` : ''}</small>`), `<button class="btn btn-xs" data-act="nudge" data-id="${r.id}" data-n="${esc(r.name)}">Send nudge</button>`]))}
      <p class="hidden-note">You see state, checkpoints, time and hint level (L1 to L4). Lab flags, answer keys, solutions and other batches are never shown. You can suggest labs; lab configuration stays with admins.</p>`;
    H.b = el => location.hash = `#/trainer/labs/${el.value}`;
    H.nudge = async b => { const t = await ask(`Nudge ${b.dataset.n}`, { label: 'Message (bell notification)', placeholder: 'Try re-reading the log source hint for checkpoint 3. You are close!', ok: 'Send nudge' }); if (!t) return; try { await API.nudge(b.dataset.id, t); toast('Nudge sent to the student\'s bell.'); } catch (e) { fail(e); } };
  });

  /* ======================= 9. MENTORING ======================= */
  PAGES.mentoring = () => page([['Mentoring']], async () => {
    const [m, students] = await Promise.all([API.mentoring(), API.students()]);
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], slots = ['10:00', '12:00', '15:00', '16:00', '17:00', '18:00'];
    const av = JSON.parse(JSON.stringify(m.avail));
    const st = { Requested: 'a', Accepted: 'b', Completed: 'g', Declined: 'r', 'Time proposed': 'a', 'No-show': 'r', 'Cancelled by student': '' };
    const counts = { Resume: students.filter(s => s.resume).length, 'Mock interviews': students.filter(s => s.mocks >= 3).length, Portfolio: students.filter(s => s.portfolio).length, Internship: students.filter(s => s.internship !== 'Not started').length };
    const assurance = students.filter(s => s.att.pct < 75 || s.missed > 0);
    view.innerHTML = `<div class="card-h"><h1>Mentoring</h1><div class="r">${chip('Mentor capability', 'b')}</div></div>
      <section class="card"><div class="card-h"><h2>Requests and sessions</h2></div>${tbl(['Student', 'Type', 'Proposed', 'Duration', 'Status', 'Actions'], m.requests.sort((a, b) => a.when - b.when).map(r => [`<b>${esc(r.name)}</b>`, esc(r.type) + (r.note ? `<br><small class="note">"${esc(r.note)}"</small>` : ''), fDT(r.when), r.dur + ' min', chip(r.status, st[r.status]),
        r.status === 'Requested' ? `<div class="toolbar"><button class="btn btn-xs btn-primary" data-act="acc" data-id="${r.id}">Accept</button><button class="btn btn-xs" data-act="prop" data-id="${r.id}">Propose time</button><button class="btn btn-xs btn-danger" data-act="dec" data-id="${r.id}">Decline</button></div>` : r.status === 'Accepted' ? `<div class="toolbar"><button class="btn btn-xs btn-blue" data-act="join" data-id="${r.id}">Join</button><button class="btn btn-xs" data-act="done" data-id="${r.id}">Mark completed</button>${r.type === 'Mock interview' ? `<button class="btn btn-xs" data-act="mock" data-sid="${r.sid}" data-role="${esc(r.role || '')}">Score interview</button>` : ''}</div>` : '–']))}</section>
      <div class="dash"><section class="card s6"><div class="card-h"><h2>Weekly availability</h2><div class="r"><button class="btn btn-sm btn-primary" data-act="saveAv">Save availability</button></div></div>
        <div class="avail"><span></span>${days.map(d => `<span class="h">${d}</span>`).join('')}${slots.map(t => `<span class="h" style="text-align:left">${t}</span>${days.map(d => `<button data-act="slot" data-d="${d}" data-t="${t}" aria-pressed="${(av[d] || []).includes(t)}" aria-label="${d} ${t}">${(av[d] || []).includes(t) ? 'Open' : ''}</button>`).join('')}`).join('')}</div>
        <p class="note" style="margin-top:.5rem">Students book 1-to-1 sessions and mock interviews into open slots.</p></section>
      <section class="card s6"><div class="card-h"><h2>Mock interview workspace</h2></div><div class="list">${m.mocks.map(x => `<div class="li ${x.state === 'Published' ? 'green' : 'amber'}"><div class="grow"><b>${esc(x.name)} · ${esc(x.role)}</b><span class="note">${Object.entries(x.scores).map(([k, v]) => `${k} ${v}/5`).join(' · ')}</span></div>${chip(x.state, x.state === 'Published' ? 'g' : 'a')}${x.state !== 'Published' ? `<button class="btn btn-xs" data-act="mock" data-mid="${x.id}">Edit</button>` : ''}</div>`).join('') || empty('No mock interviews yet')}</div>
        <button class="btn btn-sm" data-act="mock" style="margin-top:.7rem">+ New mock interview</button><p class="note" style="margin-top:.5rem">Feedback stays private until published. Scores never appear on the public leaderboard.</p></section></div>
      <section class="card"><div class="card-h"><h2>Placement readiness</h2><div class="r">${chip(students.length + ' students', '')}</div></div>
        <div class="grid g4">${Object.entries(counts).map(([k, v]) => `<div class="stat blue"><b>${v} / ${students.length}</b><span>${k}${k === 'Mock interviews' ? ' (3 done)' : ''}</span></div>`).join('')}</div>
        ${assurance.length ? `<div class="warn" style="margin-top:.8rem"><b>Assurance conditions at risk:</b> ${assurance.map(s => `${esc(s.name)} (${s.att.pct < 75 ? `attendance ${s.att.pct}%` : ''}${s.att.pct < 75 && s.missed ? ', ' : ''}${s.missed ? `${s.missed} assessment missed` : ''})`).join('; ')}.</div>` : ''}
        <p class="note" style="margin-top:.5rem">Internship matching is handled by admins. Trainers see status only.</p></section>`;
    const act = async (id, status, extra) => { try { await API.mentorAct(id, status, extra); toast(`Session ${status.toLowerCase()}.`); PAGES.mentoring(); } catch (e) { fail(e); } };
    H.acc = b => act(b.dataset.id, 'Accepted');
    H.done = b => act(b.dataset.id, 'Completed');
    H.dec = async b => { const r = await ask('Decline request', { placeholder: 'Reason shown to the student', ok: 'Decline' }); if (r) act(b.dataset.id, 'Declined', { reason: r }); };
    H.prop = b => { const mm = modal('Propose another time', `<form class="form" id="ptF"><label>New date and time<input id="ptV" type="datetime-local" value="${toLocalInput(Date.now() + DAY)}"></label></form>`, { foot: `<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="ptF">Send proposal</button>` }); $('#ptF', mm).addEventListener('submit', e => { e.preventDefault(); mm.close(); act(b.dataset.id, 'Time proposed', { when: new Date($('#ptV', mm).value).getTime() }); }); };
    H.join = () => toast('Opening the private mentoring room.');
    H.slot = b => { const d = b.dataset.d, t = b.dataset.t; av[d] = av[d] || []; const i = av[d].indexOf(t); i < 0 ? av[d].push(t) : av[d].splice(i, 1); b.setAttribute('aria-pressed', i < 0); b.textContent = i < 0 ? 'Open' : ''; };
    H.saveAv = async () => { try { await API.setAvail(av); toast('Availability saved.'); } catch (e) { fail(e); } };
    H.mock = b => mockForm(m.mocks.find(x => x.id === b.dataset.mid) || { sid: b.dataset.sid || '', role: b.dataset.role || '', scores: {}, notes: '' }, students);
  });
  function mockForm(x, students) {
    const cats = ['Technical', 'Communication', 'Problem Solving', 'Confidence'];
    const mm = modal('Mock interview', `<form class="form" id="mkF"><div class="row2"><label>Candidate<select id="mkS">${students.map(s => `<option value="${s.id}" ${s.id === x.sid ? 'selected' : ''}>${esc(s.name)} · ${s.batch}</option>`).join('')}</select></label><label>Target role<input id="mkR" value="${esc(x.role)}" placeholder="SOC Analyst L1"></label></div>
      ${cats.map(c => `<div class="rub"><span>${c}</span><div class="seg" role="radiogroup" aria-label="${c}" data-c="${c}">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-n="${n}" aria-pressed="${x.scores[c] === n}">${n}</button>`).join('')}</div></div>`).join('')}
      <label>Notes<textarea id="mkN">${esc(x.notes)}</textarea></label><p class="note">Private until published. Publishing updates the student's "Mock interviews n of 3".</p><p class="err" id="mkE"></p></form>`,
      { wide: true, foot: `<button class="btn" data-m="0">Save draft</button><button class="btn btn-primary" data-m="1">Publish to student</button>` });
    const scores = { ...x.scores };
    mm.addEventListener('click', async e => { const n = e.target.closest('.seg[data-c] button'); if (n) { const g = n.parentElement; scores[g.dataset.c] = +n.dataset.n; $$('button', g).forEach(bb => bb.setAttribute('aria-pressed', bb === n)); return; }
      const s = e.target.closest('[data-m]'); if (!s) return; const pub = s.dataset.m === '1';
      if (pub && cats.some(c => !scores[c])) { $('#mkE', mm).textContent = 'Score all four categories before publishing.'; return; }
      try { await API.saveMock({ id: x.id, sid: $('#mkS', mm).value, role: $('#mkR', mm).value, scores, notes: $('#mkN', mm).value }, pub); mm.close(); toast(pub ? 'Published to the student.' : 'Draft saved privately.'); PAGES.mentoring(); } catch (err) { $('#mkE', mm).textContent = err.message; } });
  }

  /* ======================= 10. MESSAGES ======================= */
  PAGES.messages = (tid) => page([['Messages']], async () => {
    const [th, an] = await Promise.all([API.threads(), API.announcements()]);
    const compose = tid === 'compose', sel = th.find(t => t.id === tid) || (!compose && th[0]);
    if (sel && sel.unread) API.readThread(sel.id).then(refreshBell);
    view.innerHTML = `<div class="card-h"><h1>Messages</h1><div class="r">${chip(th.filter(t => t.unread).length + ' unread', 'b')}<a class="btn btn-primary btn-sm" href="#/trainer/messages/compose">Post to batch</a></div></div>
      <div class="dash"><section class="card s5"><div class="card-h"><h2>Inbox</h2></div><div class="list">${th.map(t => `<a class="li ${t.unread ? 'blue' : ''}" href="#/trainer/messages/${t.id}" style="color:var(--text);text-decoration:none;${sel && t.id === sel.id ? 'border-color:var(--green)' : ''}"><div class="grow"><b>${esc(t.name)} <span class="note">· ${t.batch}</span> ${t.unread ? chip('Unread', 'b') : ''}</b><span>${esc(t.subject)}</span><span class="note">${esc(t.msgs[t.msgs.length - 1].text.slice(0, 70))}… · ${ago(t.msgs[t.msgs.length - 1].at)}</span></div></a>`).join('') || empty('No messages yet')}</div></section>
      <section class="card s7">${compose ? composer() : sel ? `<div class="card-h"><div><h2>${esc(sel.subject)}</h2><p class="note">${esc(sel.name)} · ${sel.batch}</p></div><div class="r"><button class="btn btn-sm btn-danger" data-act="escT" data-id="${sel.id}">Escalate to support</button></div></div>
        <div class="thread">${sel.msgs.map(m => `<div class="bub ${m.from === 'trainer' ? 'me' : ''}">${esc(m.text)}<br><small class="note">${m.from === 'trainer' ? 'You' : esc(sel.name)} · ${ago(m.at)}</small></div>`).join('')}</div>
        <div class="form" style="margin-top:.8rem"><textarea id="rpl" placeholder="Reply… (no lab answers, no personal data requests)"></textarea><div class="toolbar"><button class="btn btn-primary btn-sm" data-act="reply" data-id="${sel.id}">Reply</button><span class="note">Target reply time: 2 working days [provisional]</span></div></div>` : empty('Select a conversation')}</section></div>
      <section class="card"><div class="card-h"><h2>Announcement history</h2></div>${an.length ? tbl(['Sent', 'Batch', 'Type', 'Message', 'Channels', 'Delivery'], an.map(a => [fDT(a.at), a.batch, chip(a.type, 'b'), esc(a.text), a.channels.join(', '), `${a.delivered} delivered · ${a.read} read`])) : empty('Nothing sent yet')}</section>`;
    H.reply = async b => { try { await API.reply(b.dataset.id, $('#rpl').value); toast('Reply sent.'); PAGES.messages(b.dataset.id); } catch (e) { fail(e); } };
    H.escT = async b => { try { await API.escalateThread(b.dataset.id); toast('Escalated to Support.'); } catch (e) { fail(e); } };
    H.preview = () => { const a = annData(); if (!a.text.trim()) return toast('Write the announcement first.', true); modal('Preview before sending', `<div class="li blue" style="display:block"><b>Message from trainer · ${esc(ME.name)}</b><p style="margin-top:.4rem">${esc(a.text)}</p><small class="note">${a.batch} · ${a.type} · ${a.channels.join(' + ')}</small></div>`); };
    H.send = async () => { try { await API.announce(annData()); toast('Sent to the batch. This send is audited.'); location.hash = '#/trainer/messages'; } catch (e) { fail(e); } };
  });
  const annData = () => ({ batch: $('#anB').value, type: $('#anT').value, text: $('#anX').value, channels: $$('.anC:checked').map(x => x.value) });
  const composer = () => `<div class="card-h"><h2>Post to batch</h2></div><div class="form">
      <div class="row2"><label>Batch (your own only)<select id="anB">${ME.batches.map(b => `<option>${b}</option>`).join('')}</select></label>
        <label>Message type<select id="anT"><option>Class update</option><option>Reminder</option><option>Resource</option><option>General</option><option disabled>Important (admin only)</option><option disabled>Holiday notice (admin only)</option><option disabled>Festival wishes (admin only)</option></select></label></div>
      <label>Announcement<textarea id="anX" placeholder="Bring your lab notes to Thursday's class."></textarea></label>
      <div class="toolbar"><label style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" class="anC" value="In-app" checked>In-app</label><label style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" class="anC" value="Email" checked>Email</label><span class="note">WhatsApp copies stay with admins.</span></div>
      <div class="toolbar"><button class="btn btn-sm" data-act="preview">Preview before sending</button><button class="btn btn-sm btn-primary" data-act="send">Send</button></div>
      <p class="note">Platform-wide announcements, holiday notices, festival wishes and Important notices need a Content or Platform admin.</p></div>`;

  /* ======================= 11. MY FEEDBACK ======================= */
  const FB = { month: 'All', batch: 'All', type: 'All' };
  PAGES.feedback = () => page([['My Feedback']], async () => {
    const [fb, bs, as, ment] = await Promise.all([API.feedback(FB), API.batches(), API.assessments(), isMentor ? API.mentoring() : Promise.resolve({ requests: [] })]);
    const cfg = API.cfg(), cur = fb.months[fb.months.length - 1];
    const piAvg = bs.length ? Math.round(bs.reduce((a, b) => a + b.piAvg, 0) / bs.length) : 0;
    const done = ment.requests.filter(r => r.status === 'Completed').length + cur[5];
    const card = (v, label, t, cls) => `<div class="stat ${cls}"><b>${v}</b><span>${label} ${tip(t)}</span></div>`;
    view.innerHTML = `<div class="card-h"><h1>My feedback and performance</h1><div class="r">${chip('Private to you and the Platform Admin', 'b')}</div></div>
      <div class="grid g5">${card(fb.rating != null ? fb.rating + ' / 5' : '—', 'Session rating', `Average of anonymous module ratings. Shown only when at least ${cfg.feedbackMinResponses} replies exist [provisional].`, 'cyan')}
        ${card(piAvg, 'Avg batch Performance Index', 'Average Performance Index across your batches.', 'blue')}
        ${card(cur[3] + '%', 'Attendance marked on time', 'Share of lectures marked within 24 hours.', cur[3] >= 90 ? 'green' : 'amber')}
        ${card(cur[4] + ' d', 'Grading turnaround', `Average days from due date to published grade. Target ${cfg.gradingTurnaroundDays} days [provisional].`, cur[4] <= cfg.gradingTurnaroundDays ? 'green' : 'amber')}
        ${card(done, 'Mentor sessions completed', 'This month.', 'blue')}</div>
      <div class="toolbar card"><label style="display:flex;gap:.4rem;align-items:center">Month<select data-chg="f" data-k="month">${['All', ...fb.months.map(m => m[0])].map(m => `<option ${FB.month === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <label style="display:flex;gap:.4rem;align-items:center">Batch<select data-chg="f" data-k="batch">${['All', ...ME.batches].map(m => `<option ${FB.batch === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <label style="display:flex;gap:.4rem;align-items:center">Type<select data-chg="f" data-k="type">${['All', 'Module', 'Live class'].map(m => `<option ${FB.type === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label></div>
      ${fb.hiddenBatches.length ? `<div class="info">Ratings for ${fb.hiddenBatches.join(', ')} are hidden until ${cfg.feedbackMinResponses} responses arrive. This keeps feedback anonymous.</div>` : ''}
      <div class="dash"><section class="card s6"><div class="card-h"><h2>Rating trend</h2></div><div class="spark">${fb.months.map(m => `<div><span>${m[1]}</span><i style="height:${(m[1] - 3) * 50}px"></i><span>${m[0]}</span></div>`).join('')}</div></section>
        <section class="card s6"><div class="card-h"><h2>Recent months</h2></div>${tbl(['Month', 'Rating', 'Avg index', 'On-time marking', 'Turnaround'], fb.months.slice().reverse().map(m => [m[0], m[1], m[2], m[3] + '%', m[4] + ' d']), '')}</section></div>
      <section class="card"><div class="card-h"><h2>Anonymous student comments</h2></div><div class="list">${fb.comments.length ? fb.comments.map(c => `<div class="li"><div class="grow"><b>"${esc(c.text)}"</b><span class="note">${c.batch} · ${c.type} · ${c.month} · ${'★'.repeat(c.rating)}</span></div></div>`).join('') : empty('No comments to show', 'Comments appear once a batch reaches the minimum number of responses.')}</div></section>
      <p class="note">These figures are for coaching and batch planning. They are never on the public leaderboard, never shown to students, and do not drive automatic pay or employment decisions.</p>`;
    H.f = el => { FB[el.dataset.k] = el.value; PAGES.feedback(); };
  });

  /* ======================= MY PROFILE ======================= */
  PAGES.profile = tab => page([['My profile']], async () => {
    const pr = await API.profile(); tab = tab === 'security' ? 'security' : 'details';
    let photo = pr.photo || '';
    view.innerHTML = `<section class="card"><div class="s360"><div class="av" id="pfAv">${photo ? `<img src="${photo}" alt="">` : initials(pr.name)}</div><div style="display:grid;gap:.25rem"><h1>${esc(pr.name)}</h1>
        <div class="toolbar">${chip(pr.capability, 'gold')}${chip('Batches: ' + (pr.batches || 'none'), 'b')}${chip(pr.mfa ? 'Authenticator on' : 'Authenticator off', pr.mfa ? 'g' : 'r')}</div><span class="note">${esc(pr.email)}</span></div></div></section>
      <div class="tabs" role="tablist"><button role="tab" aria-selected="${tab === 'details'}" data-act="ptab" data-t="">Profile details</button><button role="tab" aria-selected="${tab === 'security'}" data-act="ptab" data-t="security">Password and security</button></div>
      ${tab === 'details' ? `<section class="card" style="max-width:900px"><form class="form" id="pfF">
        <div class="toolbar" style="align-items:center"><div class="av-lg" id="pfPrev">${photo ? `<img src="${photo}" alt="Profile photo">` : initials(pr.name)}</div>
          <label class="btn btn-sm" style="cursor:pointer;display:inline-flex;width:max-content">Upload photo<input type="file" id="pfPhoto" accept="image/png,image/jpeg,image/webp" hidden></label>
          <button class="btn btn-sm btn-danger" type="button" id="pfRm" ${photo ? '' : 'hidden'}>Remove photo</button><span class="note">JPG, PNG or WebP. It is resized to 256 px.</span></div>
        <div class="row2"><label>Full name<input id="pf-name" value="${esc(pr.name)}" autocomplete="name"></label><label>Job title<input id="pf-title" value="${esc(pr.title || '')}" placeholder="Senior SOC Trainer"></label></div>
        <div class="row2"><label>Work email<input value="${esc(pr.email)}" disabled></label><label>Phone<input id="pf-phone" value="${esc(pr.phone || '')}" inputmode="tel" placeholder="+91 98765 43210"></label></div>
        <div class="row2"><label>Specialisation<input id="pf-specialisation" value="${esc(pr.specialisation || '')}" placeholder="SOC, DFIR, Cloud security"></label><label>Years of experience<input id="pf-experience" type="number" min="0" max="50" value="${esc(pr.experience || '')}"></label></div>
        <div class="row2"><label>Certifications<input id="pf-certifications" value="${esc(pr.certifications || '')}" placeholder="CEH, CompTIA Security+"></label><label>Languages<input id="pf-languages" value="${esc(pr.languages || '')}" placeholder="English, Hindi, Telugu"></label></div>
        <label>LinkedIn profile<input id="pf-linkedin" value="${esc(pr.linkedin || '')}" placeholder="https://www.linkedin.com/in/…"></label>
        <label>About me (shown to your students)<textarea id="pf-bio" maxlength="600">${esc(pr.bio || '')}</textarea></label>
        <p class="note">Your email, role and batches are set by a Platform Admin. Students see your name, photo, title, specialisation, certifications and About me.</p>
        <p class="err" id="pfE"></p><div class="toolbar"><button class="btn btn-primary" type="submit">Save changes</button><a class="btn" href="#/trainer/dashboard">Cancel</a></div></form></section>`
      : `<div class="grid g2"><section class="card"><div class="card-h"><h2>${pr.hasPassword ? 'Change password' : 'Set a password'}</h2></div><form class="form" id="pwF">
          ${pr.hasPassword ? '<label>Current password<input id="pw-cur" type="password" autocomplete="current-password"></label>' : '<p class="note">You sign in with an email code and your authenticator. You can also set a password.</p>'}
          <label>New password<input id="pw-new" type="password" autocomplete="new-password"></label><label>Confirm new password<input id="pw-cf" type="password" autocomplete="new-password"></label>
          <div class="checks" id="pwRules"></div>
          <label>Authenticator code<input id="pw-code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></label><p class="mfa-demo">Demo authenticator code right now: <b id="mfaNow2">${window.TrainerMFA.code()}</b></p>
          <p class="err" id="pwE"></p><button class="btn btn-primary" type="submit">${pr.hasPassword ? 'Change password' : 'Set password'}</button>
          ${pr.pwChangedAt ? `<p class="note">Last changed ${fDT(pr.pwChangedAt)}.</p>` : ''}</form></section>
        <section class="card"><div class="card-h"><h2>Sign-in security</h2></div><div class="list">
          <div class="li ${pr.mfa ? 'green' : 'red'}">${chip(pr.mfa ? 'On' : 'Off', pr.mfa ? 'g' : 'r')}<div class="grow"><b>Authenticator app (MFA)</b><span class="note">Required for trainers. Asked again for grade publishing, attendance locks and password changes.</span></div></div>
          <div class="li">${chip('30 min', 'b')}<div class="grow"><b>Automatic sign-out</b><span class="note">You are signed out after 30 minutes without activity.</span></div></div>
          <div class="li"><div class="grow"><b>Lost your authenticator?</b><span class="note">A Platform Admin can reset it after checking your identity.</span></div></div></div></section></div>`}`;
    H.ptab = b => location.hash = '#/trainer/profile' + (b.dataset.t ? '/' + b.dataset.t : '');
    if (tab === 'details') {
      const setPhoto = v => { photo = v; $('#pfPrev').innerHTML = v ? `<img src="${v}" alt="Profile photo">` : initials(pr.name); $('#pfRm').hidden = !v; };
      $('#pfPhoto').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return toast('Use a JPG, PNG or WebP image.', true); if (f.size > 5e6) return toast('Use an image under 5 MB.', true);
        const img = new Image(); img.onload = () => { const c = document.createElement('canvas'), k = 256; c.width = c.height = k; const m = Math.min(img.width, img.height); c.getContext('2d').drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, k, k); setPhoto(c.toDataURL('image/jpeg', .85)); URL.revokeObjectURL(img.src); };
        img.onerror = () => toast('That image could not be read.', true); img.src = URL.createObjectURL(f); });
      $('#pfRm').onclick = () => setPhoto('');
      $('#pfF').addEventListener('submit', async e => { e.preventDefault(); const f = { photo }; ['name', 'title', 'phone', 'specialisation', 'experience', 'certifications', 'languages', 'linkedin', 'bio'].forEach(k => f[k] = $('#pf-' + k).value.trim());
        try { await API.saveProfile(f); paintAvatar(f.name, photo); $('#avPop b').textContent = f.name; toast('Profile saved.'); PAGES.profile(); } catch (err) { $('#pfE').textContent = err.message; } });
    } else {
      const rules = [[v => v.length >= 10, 'At least 10 characters'], [v => /[A-Z]/.test(v) && /[a-z]/.test(v), 'Upper- and lower-case letters'], [v => /\d/.test(v), 'A number'], [v => /[^A-Za-z0-9]/.test(v), 'A symbol']];
      const paint = () => { const v = $('#pw-new').value; $('#pwRules').innerHTML = rules.map(([f, l]) => `<div>${f(v) ? chip('Yes', 'g') : chip('No', '')}<span>${l}</span></div>`).join(''); }; paint(); $('#pw-new').addEventListener('input', paint);
      const iv = setInterval(() => { const n = $('#mfaNow2'); if (n) n.textContent = window.TrainerMFA.code(); else clearInterval(iv); }, 1000);
      $('#pwF').addEventListener('submit', async e => { e.preventDefault(); const nw = $('#pw-new').value;
        if (nw !== $('#pw-cf').value) { $('#pwE').textContent = 'The two new passwords do not match.'; return; }
        try { await API.changePassword($('#pw-cur') ? $('#pw-cur').value : '', nw, $('#pw-code').value.trim()); toast(pr.hasPassword ? 'Password changed.' : 'Password set.'); PAGES.profile('security'); } catch (err) { $('#pwE').textContent = err.message; } });
    }
  });

  PAGES.notfound = () => page([['Not found']], async () => { view.innerHTML = `<div class="card">${empty('This page does not exist')}<div style="text-align:center"><a class="btn btn-primary" href="#/trainer/dashboard">Go to dashboard</a></div></div>`; });

  /* ======================= LIVE MODE (trainer-live.js signed the trainer in) =======================
     Pages with a server API read and write real data through LIVE.api. Pages without one say so instead of showing
     demo students next to real ones. Numbers come from the server: attendance marks, graded attempts, cleared labs. */
  if (LIVE && LIVE.user) {
    const L = LIVE.api;
    const t = x => (x ? new Date(x).getTime() : 0);
    const FLAG = r => r.flags.length ? (r.flags.includes('Low attendance') || r.flags.length > 1 ? 'AT RISK' : 'WATCH') : 'OK';
    const num = v => (v === null || v === undefined ? '–' : v);
    const notLive = (title, what) => page([[title]], async () => {
      view.innerHTML = `<div class="card-h"><h1>${esc(title)}</h1></div><div class="card">${empty('Not connected to the server yet', what)}</div>`;
    });
    // 428 (reason required) → ask once and retry with the reason
    const withReason = async (fn, title) => {
      try { return await fn(); } catch (e) {
        if (e.status !== 428) throw e;
        const r = await ask(title, { label: 'Reason (shown in the audit log)', ok: 'Save with reason' });
        if (!r) return null;
        return fn(r);
      }
    };
    let BATCHES = null;
    const batches = async () => (BATCHES = BATCHES || await L.batches());
    const overviews = async () => Promise.all((await batches()).map(b => L.overview(b.id)));
    const allRows = async () => (await overviews()).flatMap(o => o.students.map(s => ({ ...s, batch: o.batch.code, batchId: o.batch.id })));

    batches().then(bs => { ME.batches = bs.map(b => b.code); const p = $('#avPop small.note:nth-of-type(2)'); if (p) p.textContent = 'Batches: ' + (ME.batches.join(', ') || 'none'); }).catch(() => {});

    LIVE.bell = async () => {
      try {
        const n = await L.notifications(), b = $('#bellCnt'); b.hidden = !n.unread; b.textContent = n.unread;
        const href = x => x.link ? x.link.replace(/^#\//, '#/trainer/') : '#/trainer/dashboard';
        $('#bellPop').innerHTML = `<div style="display:flex;align-items:center;padding:.3rem .5rem .5rem"><b>Notifications</b>${n.unread ? '<button class="btn btn-xs" id="markRead" style="margin-left:auto">Mark all read</button>' : ''}</div>` +
          (n.items.length ? n.items.map(x => `<a class="notif ${x.readAt ? 'read' : ''}" href="${esc(href(x))}" data-nid="${x.id}"><i class="${x.kind === 'message' ? 'blue' : 'amber'}"></i><span>${esc(x.title)}<br><small class="note">${ago(t(x.createdAt))}</small></span></a>`).join('') : '<p class="note" style="padding:.5rem">You are all caught up.</p>');
        $('#markRead')?.addEventListener('click', async e => { e.stopPropagation(); await L.readAll(); LIVE.bell(); });
        $$('#bellPop [data-nid]').forEach(a => a.addEventListener('click', () => L.read(a.dataset.nid).then(LIVE.bell, () => {})));
        const unreadMsgs = n.items.filter(x => x.kind === 'message' && !x.readAt).length;
        $$('#nav a').forEach(a => { const c = a.querySelector('.cnt'); const v = a.dataset.mod === 'messages' ? unreadMsgs : 0; c.hidden = !v; c.textContent = v || ''; });
      } catch {}
    };

    /* ---- Dashboard ---- */
    PAGES.dashboard = () => page([['Dashboard']], async () => {
      const [d, ovs, ses] = await Promise.all([L.dashboard(), overviews(), L.sessions()]);
      const now = Date.now();
      const rows = ovs.flatMap(o => o.students.map(s => ({ ...s, batch: o.batch.code })));
      const attention = rows.filter(r => r.flags.length);
      const idx = rows.map(r => r.performanceIndex).filter(v => v !== null);
      const cityIdx = idx.length ? Math.round(idx.reduce((a, b) => a + b, 0) / idx.length) : 0;
      const today = ses.filter(s => sameDay(t(s.startsAt), now) && s.state !== 'cancelled');
      const toMark = ses.filter(s => s.state === 'completed' && s.countsForAttendance && !s.marked);
      const tile = (n, label, cls, href, sub) => `<a class="stat ${cls}" href="${href}"><b>${n}</b><span>${label}</span><small>${sub}</small></a>`;
      const p = d.pending;
      const todo = [
        ...toMark.map(s => ({ c: 'amber', t: `Mark attendance: ${s.title}`, s: `${s.batch.code} · ${fD(s.startsAt)}`, href: `#/trainer/attendance/${s.id}`, b: 'Mark' })),
        ...(p.leave ? [{ c: 'amber', t: `${p.leave} leave request${p.leave === 1 ? '' : 's'} waiting`, s: 'Approve or decline with a note', href: '#/trainer/attendance', b: 'Review' }] : []),
        ...(p.toGrade ? [{ c: 'amber', t: `${p.toGrade} submission${p.toGrade === 1 ? '' : 's'} to grade`, s: 'Assessments you created', href: '#/trainer/assessments', b: 'Grade' }] : []),
        ...(p.bookings ? [{ c: 'blue', t: `${p.bookings} session request${p.bookings === 1 ? '' : 's'}`, s: 'Students booked your slots', href: '#/trainer/mentoring', b: 'Review' }] : []),
        ...(p.placementReviews ? [{ c: 'blue', t: `${p.placementReviews} placement review${p.placementReviews === 1 ? '' : 's'}`, s: 'Resumes, portfolio projects, milestones', href: '#/trainer/mentoring', b: 'Review' }] : []),
        ...(p.unreadMessages ? [{ c: 'blue', t: `${p.unreadMessages} unread message${p.unreadMessages === 1 ? '' : 's'}`, s: 'From your students', href: '#/trainer/messages', b: 'Reply' }] : []),
        ...(p.mentoringOutcomes ? [{ c: 'blue', t: `${p.mentoringOutcomes} mentoring outcome${p.mentoringOutcomes === 1 ? '' : 's'} to record`, s: 'Sessions that took place', href: '#/trainer/mentoring', b: 'Record' }] : []),
        ...(p.openRequests ? [{ c: 'blue', t: `${p.openRequests} request${p.openRequests === 1 ? '' : 's'} with the admin`, s: 'Escalations or guardian contact you asked for', href: '#/trainer/students', b: 'View' }] : [])];
      view.innerHTML = `
        <section class="cityhero simple"><div class="sky" aria-hidden="true">${SKYLINE}</div>
          <div class="welcome"><span class="greet">${(h => h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening')(new Date().getHours())}</span><h1>Welcome, ${esc(ME.name)}</h1></div>
          <div class="shield"><div class="ring" style="--v:${cityIdx}"><b>${idx.length ? cityIdx : '–'}<small>AVG INDEX</small></b></div><span>Average Performance Index ${tip('Average of your students’ index: attendance 20%, quiz average 40%, labs cleared 40% (Yojo setting). Parts without data are left out.')}</span></div></section>
        <div class="grid g4 dash-tiles">
          ${tile(today.length, 'Sessions today', 'cyan', '#/trainer/classes', today.length ? `Next at ${fT(today[0].startsAt)}` : 'Nothing today')}
          ${tile(toMark.length, 'Attendance to mark', toMark.length ? 'amber' : 'green', '#/trainer/attendance', toMark.length ? 'Sessions waiting' : 'All marked')}
          ${tile(p.toGrade, 'Papers to grade', p.toGrade ? 'amber' : 'green', '#/trainer/assessments', 'Submitted, not graded')}
          ${tile(attention.length, 'Students to check on', attention.length ? 'red' : 'green', '#/trainer/batches', 'Attendance, activity or quizzes')}
        </div>
        <div class="dash dash-simple">
          <section class="card s6"><div class="card-h"><h2>Today</h2><div class="r"><a class="btn btn-sm" href="#/trainer/classes">All sessions</a></div></div>
            <div class="list">${today.length ? today.map(s => `<div class="li ${s.state === 'live' ? 'green' : ''}"><span class="t">${fT(s.startsAt)}</span><div class="grow"><b>${esc(s.title)}</b><span class="note">${esc(s.batch.code)} · ${esc(s.type)}${s.room ? ' · ' + esc(s.room) : ''}</span></div>${s.joinUrl ? `<a class="btn btn-xs btn-primary" href="${esc(s.joinUrl)}" target="_blank" rel="noopener">Join link</a>` : chip(s.state, s.state === 'live' ? 'g' : '')}</div>`).join('') : empty('Nothing scheduled today')}</div></section>
          <section class="card s6"><div class="card-h"><h2>To do</h2><div class="r">${chip(todo.length ? todo.length + ' items' : 'All done', todo.length ? 'a' : 'g')}</div></div>
            <div class="list">${todo.length ? todo.slice(0, 8).map(x => `<div class="li ${x.c}"><div class="grow"><b>${esc(x.t)}</b><span class="note">${esc(x.s)}</span></div><a class="btn btn-xs btn-primary" href="${x.href}">${x.b}</a></div>`).join('') : empty('Nothing waiting for you')}</div></section>
          <section class="card s12"><div class="card-h"><h2>Students to check on</h2><div class="r"><a class="btn btn-sm" href="#/trainer/batches">My batches</a></div></div>
            <div class="list">${attention.length ? attention.slice(0, 6).map(r => `<div class="li ${FLAG(r) === 'WATCH' ? 'amber' : 'red'}"><div class="grow"><b>${esc(r.name)} <span class="note">· ${esc(r.batch)}</span></b><span class="note">${(r.flagReasons || r.flags).map(esc).join(' · ')}</span></div>${flagChip(FLAG(r))}<a class="btn btn-xs" href="#/trainer/students/${r.studentId}">View student</a></div>`).join('') : empty(rows.length ? 'All students are on track' : 'No students in your batches yet')}</div></section>
        </div>`;
    });

    /* ---- My Batches ---- */
    PAGES.batches = bid => bid ? liveRoster(bid) : page([['My Batches']], async () => {
      const [bs, ovs] = await Promise.all([batches(), overviews()]);
      const card = (b, o) => `<div class="card bcard"><div class="card-h" style="margin:0"><h3>${esc(b.code)}</h3><div class="r">${o.summary.flagged ? chip(o.summary.flagged + ' flagged', 'r') : chip('All OK', 'g')}</div></div><p class="note">${esc(b.course ? b.course.title : b.name)} · ${esc(b.mode || '')} · ${esc(b.status)}</p>
        <div class="kv"><span>Students<b>${o.summary.students}</b></span><span>Attendance avg<b style="color:${(o.summary.attendanceAvg ?? 100) < o.requiredAttendancePct ? 'var(--red)' : 'var(--green)'}">${o.summary.attendanceAvg === null ? '–' : o.summary.attendanceAvg + '%'}</b></span><span>Index avg<b style="color:var(--quantum)">${num(o.summary.performanceAvg)}</b></span><span>Flagged<b style="color:${o.summary.flagged ? 'var(--red)' : 'var(--green)'}">${o.summary.flagged}</b></span></div>
        <a class="btn btn-sm btn-primary" href="#/trainer/batches/${b.id}">Open roster</a></div>`;
      view.innerHTML = `<div class="card-h"><h1>My batches</h1><div class="r">${chip(bs.length + ' assigned', 'g')}</div></div>
        ${bs.length ? `<div class="grid g3">${bs.map((b, i) => card(b, ovs[i])).join('')}</div>` : `<div class="card">${empty('No batches assigned yet', 'A Platform Admin assigns batches to you.')}</div>`}
        <p class="hidden-note">You see only batches assigned to you. A student removed from a batch disappears from your roster at once.</p>`;
    });
    const liveRoster = bid => page([['My Batches', '#/trainer/batches'], ['…']], async () => {
      const o = await L.overview(bid);
      setCrumb([['My Batches', '#/trainer/batches'], [o.batch.code]]);
      const ss = o.students.map(r => ({ ...r, flag: FLAG(r) }));
      const draw = () => {
        const order = { 'AT RISK': 0, WATCH: 1, OK: 2 };
        let rows = ss.filter(s => s.name.toLowerCase().includes(RS.q.toLowerCase()) && (RS.filter === 'All' || s.flag === RS.filter));
        rows.sort(RS.sort === 'flag' ? (x, y) => order[x.flag] - order[y.flag] : RS.sort === 'name' ? (x, y) => x.name.localeCompare(y.name) : RS.sort === 'att' ? (x, y) => (x.attendance.pct ?? 101) - (y.attendance.pct ?? 101) : (x, y) => (x.performanceIndex ?? 101) - (y.performanceIndex ?? 101));
        $('#rosterT').innerHTML = rows.length ? tbl(['Student', 'Attended', '%', 'Index', 'Labs', 'Quiz avg', 'Flag', 'View'], rows.map(s => [
          `<b>${esc(s.name)}</b><br><small class="note">${esc(s.code || '')}</small>`, `${s.attendance.counts.present + s.attendance.counts.late} / ${s.attendance.counts.present + s.attendance.counts.late + s.attendance.counts.absent}`,
          s.attendance.pct === null ? '–' : pbar(s.attendance.pct), `<b>${num(s.performanceIndex)}</b>`, `${s.labsCleared} of ${s.labsTotal}`, num(s.quizAvg), flagChip(s.flag) + (s.flags.length ? `<br><small class="note">${s.flags.map(esc).join(', ')}</small>` : ''), `<a href="#/trainer/students/${s.studentId}">Open</a>`])) : empty('No students match', 'Try another search or filter.');
      };
      view.innerHTML = `<div class="grid g4">
          <div class="stat green"><b>${o.summary.students}</b><span>Students</span></div><div class="stat ${(o.summary.attendanceAvg ?? 100) < o.requiredAttendancePct ? 'red' : 'green'}"><b>${o.summary.attendanceAvg === null ? '–' : o.summary.attendanceAvg + '%'}</b><span>Attendance avg</span></div>
          <div class="stat blue"><b>${num(o.summary.performanceAvg)}</b><span>Index avg ${tip(o.rules.performanceIndex)}</span></div><div class="stat red"><b>${o.summary.flagged}</b><span>Flagged</span></div></div>
        <div class="toolbar"><input type="search" placeholder="Search student in ${esc(o.batch.code)}…" aria-label="Search student" data-inp="q" value="${esc(RS.q)}">
          <label style="display:flex;align-items:center;gap:.4rem">Sort <select data-chg="sort"><option value="flag">Flag</option><option value="name">Name</option><option value="att">Attendance</option><option value="pi">Index</option></select></label>
          <label style="display:flex;align-items:center;gap:.4rem">Filter <select data-chg="filter">${['All', 'OK', 'WATCH', 'AT RISK'].map(f => `<option ${RS.filter === f ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
          <button class="btn btn-sm r" data-act="export">Export progress</button></div>
        <div id="rosterT"></div>
        <p class="hidden-note">Flags: attendance under ${o.requiredAttendancePct}%, no activity for ${o.rules.inactiveDays} days, or quiz average under ${o.rules.quizFlagPct}%. Not shown to trainers: fees, payments, guardian details, other batches, lab flags and answers.</p>`;
      $('[data-chg=sort]').value = RS.sort; draw();
      H.q = el => { RS.q = el.value; draw(); }; H.sort = el => { RS.sort = el.value; draw(); }; H.filter = el => { RS.filter = el.value; draw(); };
      H.export = () => {
        const rows = [['Student code', 'Name', 'Batch', 'Attendance %', 'Performance Index', 'Labs cleared', 'Quiz avg', 'XP', 'Flags']].concat(ss.map(s => [s.code || '', s.name, o.batch.code, num(s.attendance.pct), num(s.performanceIndex), s.labsCleared, num(s.quizAvg), s.xp, s.flags.join('; ')]));
        csv(`${o.batch.code}-progress.csv`, rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'));
        toast('Progress CSV saved from the figures on screen.');
      };
    });

    /* ---- Students ---- */
    PAGES.students = (sid, tab) => sid ? liveStudent(sid, tab || 'overview') : page([['Students']], async () => {
      const ss = await allRows();
      view.innerHTML = `<div class="card-h"><h1>Students</h1><div class="r"><input type="search" placeholder="Search your students…" aria-label="Search students" data-inp="q" style="width:260px"></div></div><div id="stT"></div>`;
      const draw = q => { const r = ss.filter(s => s.name.toLowerCase().includes(q.toLowerCase())); $('#stT').innerHTML = r.length ? tbl(['Student', 'Batch', 'Attendance', 'Index', 'XP', 'Flag', ''], r.map(s => [`<b>${esc(s.name)}</b>`, esc(s.batch), s.attendance.pct === null ? '–' : pbar(s.attendance.pct), `<b>${num(s.performanceIndex)}</b>`, s.xp, flagChip(FLAG(s)), `<a class="btn btn-xs" href="#/trainer/students/${s.studentId}">Open</a>`])) : empty(ss.length ? 'No students found' : 'No students in your batches yet'); };
      draw(''); H.q = el => draw(el.value);
    });
    const liveStudent = (sid, tab) => page([['Students', '#/trainer/students'], ['…']], async () => {
      const [d, rows] = await Promise.all([L.student(sid), allRows()]);
      const s = rows.find(r => r.studentId === sid) || { performanceIndex: null, performanceParts: [], flags: [], flagReasons: [], xp: 0, labsCleared: 0, labsTotal: 0, quizAvg: null, quizzesGraded: 0 };
      setCrumb([['Students', '#/trainer/students'], [d.student.name]]);
      const pi = s.performanceIndex, piC = pi === null ? 'var(--muted)' : pi >= 60 ? 'var(--green)' : pi >= 40 ? 'var(--amber)' : 'var(--red)';
      const TABS = [['overview', 'Overview'], ['attendance', 'Attendance'], ['labs', 'Labs'], ['assessments', 'Assessments'], ['mentoring', 'Mentoring'], ['remarks', 'Remarks'], ['placement', 'Placement']];
      const MK = { present: ['P', 'Present'], late: ['L', 'Late'], absent: ['A', 'Absent'], excused: ['E', 'Excused'] };
      const LAB = { cleared: ['Cleared', 'g'], in_progress: ['In progress', 'b'], not_started: ['Not started', ''] };
      const c = d.attendance.counts;
      const body = {
        overview: `<div class="grid g2"><section class="card"><div class="card-h"><h3>Performance Index ${tip('Attendance 20%, quiz average 40%, labs cleared 40% (Yojo setting). Parts without data are left out.')}</h3></div><div class="comp">
            <div><span>Attendance (20%)</span>${d.attendance.pct === null ? '<span class="note">No marked sessions</span>' : pbar(d.attendance.pct)}<b>${num(d.attendance.pct)}</b></div>
            <div><span>Quiz average (40%) · ${s.quizzesGraded} graded</span>${s.quizAvg === null ? '<span class="note">Nothing graded yet</span>' : pbar(s.quizAvg, 'blue')}<b>${num(s.quizAvg)}</b></div>
            <div><span>Labs cleared (40%)</span>${pbar(s.labsTotal ? Math.round(100 * s.labsCleared / s.labsTotal) : 0, 'blue')}<b>${s.labsCleared}/${s.labsTotal}</b></div>
            <div><span>XP</span><span></span><b>${s.xp}</b></div></div></section>
          <section class="card"><div class="card-h"><h3>Flags</h3></div><div class="list">${(s.flagReasons || []).length ? s.flagReasons.map(f => `<div class="li red">${chip('Flag', 'r')}<span>${esc(f)}</span></div>`).join('') : `<div class="li green">${chip('OK', 'g')}<span>No flags. On track.</span></div>`}</div>
            <p class="note" style="margin-top:.6rem">Flags are informational. Nothing happens automatically; escalate only if you think the admin should act.</p>
            <div class="toolbar" style="margin-top:.6rem"><button class="btn btn-sm btn-danger" data-act="sEsc">Escalate to admin</button><button class="btn btn-sm" data-act="sMsg">Message student</button></div></section></div>`,
        attendance: `<section class="card"><div class="card-h"><h3>Sessions in your batches</h3><div class="r">${chip(`P ${c.present}`, 'g')}${chip(`L ${c.late}`, 'a')}${chip(`A ${c.absent}`, 'r')}${chip(`E ${c.excused}`, 'b')}${chip(`Not marked ${c.unmarked}`, '')}</div></div>
          ${d.attendance.sessions.length ? tbl(['Date', 'Session', 'Batch', 'Mark'], d.attendance.sessions.map(x => [fDT(x.startsAt), esc(x.title) + (x.countsForAttendance ? '' : ' <span class="note">(not counted)</span>'), esc(x.batch), x.mark ? `<span class="mark ${MK[x.mark][0]}">${MK[x.mark][0]}</span> ${MK[x.mark][1]}` : '<span class="note">Not marked</span>'])) : empty('No sessions held yet')}</section>`,
        labs: `<section class="card"><div class="card-h"><h3>Labs and steps</h3></div><p class="note" style="margin-bottom:.6rem">From the student’s own verified lab records. Flags, answers and hint texts are never shown to trainers.</p>
          ${tbl(['Lab', 'Status', 'Steps', 'Hints used', 'Last activity', ''], d.labs.map(l => [`<b>${esc(l.title)}</b><br><small class="note">${esc(l.code)}</small>`, chip(LAB[l.state][0], LAB[l.state][1]), `${l.stepsDone}/${l.steps}`, l.hintsUsed, l.lastActivity ? ago(t(l.lastActivity)) : '–', l.state === 'in_progress' ? `<button class="btn btn-xs" data-act="sNudge" data-m="${esc(l.code)}">Nudge</button>` : '']))}</section>`,
        assessments: `<section class="card"><div class="card-h"><h3>Assessments</h3></div>${d.assessments.length ? tbl(['Assessment', 'Attempt', 'Submitted', 'Status', 'Score'], d.assessments.map(a => [`<b>${esc(a.title)}</b><br><small class="note">${esc(a.kind)}${a.dueAt ? ' · due ' + fD(a.dueAt) : ''}</small>`, a.attempt, a.submittedAt ? fDT(a.submittedAt) + (a.late ? ' ' + chip('Late', 'a') : '') : '–', chip(a.status.replace('_', ' '), a.status === 'graded' ? 'g' : a.status === 'returned' ? 'a' : 'b'), a.score === null ? '–' : `${a.score}/${a.maxMarks} ${a.passed ? chip('Pass', 'g') : chip('Below pass', 'r')}`])) : empty('No attempts yet')}</section>`,
        mentoring: `<section class="card"><div class="card-h"><h3>Sessions with you</h3></div>${d.mentoring.length ? tbl(['When', 'Purpose', 'Status', 'Outcome', 'Follow-up'], d.mentoring.map(m => [fDT(m.startsAt), esc(m.purpose.replace('_', ' ')), chip(m.status, m.status === 'completed' ? 'g' : m.status === 'pending' ? 'a' : ''), esc(m.outcome || '–'), esc(m.followUp || '–')])) : empty('No sessions with you yet')}</section>`,
        remarks: `<div class="grid g2"><section class="card"><div class="card-h"><h3>Add remark</h3></div><div class="form">
            <div class="toolbar"><label style="display:flex;gap:.4rem;align-items:center"><input type="radio" name="rk" value="remark" checked>Remark ${tip('Seen by the student’s trainers and the Platform Admin, and in the admin student report.')}</label><label style="display:flex;gap:.4rem;align-items:center"><input type="radio" name="rk" value="private_note">Private note ${tip('Visible only to you and the Platform Admin.')}</label></div>
            <textarea id="rmText" maxlength="2000" placeholder="Factual comment, e.g. Completed INT-01 without hints."></textarea><div class="toolbar"><button class="btn btn-primary btn-sm" data-act="sRem">Save</button><span class="note">Entries cannot be deleted. An edit keeps the earlier text.</span></div></div></section>
          <section class="card"><div class="card-h"><h3>Remarks and notes</h3></div><div class="list">${d.remarks.length ? d.remarks.map(r => `<div class="li ${r.kind === 'remark' ? 'green' : 'blue'}"><div class="grow"><b>${esc(r.text)}</b><span class="note">${r.kind === 'remark' ? 'Remark' : 'Private note'} · ${esc(r.author || '')} · ${fDT(r.createdAt)}${r.history.length ? ' · edited' : ''}</span></div>${r.mine ? `<button class="btn btn-xs" data-act="sEdit" data-id="${r.id}">Edit</button>` : ''}${r.history.length ? `<button class="btn btn-xs" data-act="sHist" data-id="${r.id}">History</button>` : ''}</div>`).join('') : empty('No remarks yet')}</div></section></div>`,
        placement: `<section class="card"><div class="card-h"><h3>Placement readiness</h3><div class="r">${chip(d.placement.overall + '%', 'b')}</div></div><div class="grid g4">
          <div class="stat ${d.placement.resume === 'approved' ? 'green' : 'amber'}"><b style="font-size:1.1rem">${esc(d.placement.resume.replace('_', ' '))}</b><span>Resume</span></div>
          <div class="stat blue"><b>${d.placement.mocks} of ${d.placement.mockTarget}</b><span>Mock interviews${d.placement.communicationAvg === null ? '' : ` · communication ${d.placement.communicationAvg}/5`}</span></div>
          <div class="stat ${d.placement.portfolioApproved ? 'green' : 'amber'}"><b>${d.placement.portfolioApproved}</b><span>Approved projects</span></div>
          <div class="stat cyan"><b>${d.placement.internshipPct}%</b><span>Internship milestones</span></div></div></section>`
      };
      const open = d.requests.filter(r => r.status === 'open');
      view.innerHTML = `<section class="card"><div class="s360"><div class="av">${initials(d.student.name)}</div><div style="display:grid;gap:.25rem"><h1>${esc(d.student.name)}</h1>
          <div class="toolbar">${d.batches.map(b => chip(b.code, 'c')).join('')}${flagChip(FLAG(s))}${open.length ? chip(open.length + ' open request' + (open.length === 1 ? '' : 's'), 'a') : ''}</div><span class="note">${esc(d.student.code || '')} · ${s.lastActive ? 'last active ' + ago(t(s.lastActive)) : 'no activity yet'}</span></div>
          <div class="pi-ring" style="--v:${pi ?? 0};--c:${piC}"><b>${num(pi)}<small>INDEX</small></b></div><div style="display:grid;gap:.2rem"><span class="note">From: ${s.performanceParts.length ? s.performanceParts.join(', ') : 'no data yet'}</span></div></div></section>
        <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" aria-selected="${k === tab}" data-act="sTab" data-t="${k}">${l}</button>`).join('')}</div>
        <div>${body[tab] || body.overview}</div>
        ${d.requests.length ? `<section class="card"><div class="card-h"><h3>Requests to the admin</h3></div><div class="list">${d.requests.map(r => `<div class="li ${r.status === 'open' ? 'amber' : 'green'}"><div class="grow"><b>${esc(r.code)} · ${r.kind === 'escalation' ? 'Escalation' : 'Contact guardian'}</b><span class="note">${esc(r.reason)} · ${esc(r.raisedBy || '')} · ${fDT(r.createdAt)}</span>${r.resolution ? `<span class="note">Admin: ${esc(r.resolution)}</span>` : ''}</div>${chip(r.status, r.status === 'open' ? 'a' : 'g')}</div>`).join('')}</div></section>` : ''}
        <div class="hidden-note">${esc(d.hidden)} Need to reach the guardian? <button class="btn btn-xs" data-act="sGuard">Ask admin to contact guardian</button></div>`;
      const again = (msg, t2) => { toast(msg); liveStudent(sid, t2 || tab); };
      H.sTab = b => location.hash = `#/trainer/students/${sid}/${b.dataset.t}`;
      H.sEsc = async () => { const r = await ask('Escalate to the Platform Admin', { label: 'What is the concern?', placeholder: 'Attendance has dropped for three weeks; not replying to messages.', text: 'The admin is notified and resolves it with a note you will see here.', ok: 'Escalate' }); if (!r) return; try { await L.raise(sid, { kind: 'escalation', reason: r }); again('Escalated to the Platform Admin.'); } catch (e) { fail(e); } };
      H.sGuard = async () => { const r = await ask('Ask admin to contact guardian', { label: 'Why should the admin contact the guardian?', text: 'Guardian contact details are never shown to trainers; the admin makes the contact.', ok: 'Send request' }); if (!r) return; try { await L.raise(sid, { kind: 'guardian_contact', reason: r }); again('Request sent to the admin.'); } catch (e) { fail(e); } };
      H.sMsg = () => newMessage(sid);
      H.sNudge = async b => { const msg = await ask('Nudge about ' + b.dataset.m, { label: 'Short note (optional, shown to the student)', placeholder: 'Stuck on the second step? Re-read the briefing.', ok: 'Send nudge' }); if (msg === null) return; try { await L.nudge({ studentId: sid, missionCode: b.dataset.m, message: msg || undefined }); toast('Nudge sent to the student.'); } catch (e) { fail(e); } };
      H.sRem = async () => { const kind = $('input[name=rk]:checked').value, text = $('#rmText').value.trim(); if (text.length < 3) return toast('Write at least 3 characters.', true); try { await L.addRemark(sid, { kind, text }); again(kind === 'remark' ? 'Remark saved.' : 'Private note saved.', 'remarks'); } catch (e) { fail(e); } };
      H.sEdit = b => { const r = d.remarks.find(x => x.id === b.dataset.id); const m = modal('Edit remark', `<form class="form" id="reF"><textarea id="reT" maxlength="2000">${esc(r.text)}</textarea><p class="note">The earlier text is kept in the history.</p><p class="err" id="reE"></p></form>`, { foot: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="reF" type="submit">Save</button>' });
        $('#reF', m).addEventListener('submit', async e => { e.preventDefault(); try { await L.editRemark(r.id, $('#reT', m).value.trim()); m.close(); again('Remark updated.', 'remarks'); } catch (x) { $('#reE', m).textContent = x.message; } }); };
      H.sHist = b => { const r = d.remarks.find(x => x.id === b.dataset.id); modal('Edit history', tbl(['Saved', 'Earlier text'], r.history.map(h => [fDT(h.at), esc(h.text)]))); };
    });
    // New message to a student of my batches (also used from the Messages page)
    const newMessage = async presel => {
      const ss = await allRows();
      const m = modal('New message', `<form class="form" id="nmF"><label>Student<select id="nmS">${ss.map(x => `<option value="${x.studentId}" ${x.studentId === presel ? 'selected' : ''}>${esc(x.name)} · ${esc(x.batch)}</option>`).join('')}</select></label>
        <label>Subject<input id="nmT" maxlength="150"></label><label>Message<textarea id="nmB" maxlength="4000" placeholder="No lab answers, no personal data requests"></textarea></label><p class="err" id="nmE"></p></form>`, { foot: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="nmF" type="submit">Send</button>' });
      $('#nmF', m).addEventListener('submit', async e => { e.preventDefault(); try { const r = await L.startConversation({ studentId: $('#nmS', m).value, subject: $('#nmT', m).value.trim(), body: $('#nmB', m).value.trim() }); m.close(); toast('Message sent. The student is notified.'); location.hash = '#/trainer/messages/' + r.id; } catch (x) { $('#nmE', m).textContent = x.message; } });
    };

    /* ---- Classes (sessions) ---- */
    PAGES.classes = () => page([['Classes']], async () => {
      const [ses, bs] = await Promise.all([L.sessions(), batches()]);
      const up = ses.filter(s => s.state === 'upcoming' || s.state === 'live'), past = ses.filter(s => s.state === 'completed' || s.state === 'cancelled').reverse();
      const list = classTab === 'past' ? past : up;
      const row = s => [fDT(s.startsAt), `<b>${esc(s.title)}</b><br><small class="note">${esc(s.type)}${s.countsForAttendance ? '' : ' · not counted for attendance'}</small>`, esc(s.batch.code),
        s.state === 'cancelled' ? chip('Cancelled', '') + `<br><small class="note">${esc(s.cancelReason || '')}</small>` : chip(s.state, s.state === 'live' ? 'g' : s.state === 'upcoming' ? 'c' : ''),
        s.room ? esc(s.room) : s.joinUrl ? `<a href="${esc(s.joinUrl)}" target="_blank" rel="noopener">Join link</a>` : '<span class="note">No room or link</span>',
        s.state === 'upcoming' || s.state === 'live' ? `<button class="btn btn-xs" data-act="link" data-id="${s.id}">Set link</button> <button class="btn btn-xs btn-danger" data-act="cancel" data-id="${s.id}">Cancel</button>` : s.state === 'completed' && s.countsForAttendance ? `<a class="btn btn-xs btn-primary" href="#/trainer/attendance/${s.id}">${s.marked ? 'Attendance' : 'Mark'}</a>` : ''];
      view.innerHTML = `<div class="card-h"><h1>Classes and sessions</h1><div class="r"><button class="btn btn-primary btn-sm" data-act="new" ${bs.length ? '' : 'disabled title="No batch assigned"'}>Schedule session</button></div></div>
        <div class="tabs" role="tablist"><button role="tab" aria-selected="${classTab !== 'past'}" data-act="tab" data-t="upcoming">Upcoming (${up.length})</button><button role="tab" aria-selected="${classTab === 'past'}" data-act="tab" data-t="past">Past 30 days (${past.length})</button></div>
        <section class="card">${list.length ? tbl(['When', 'Session', 'Batch', 'State', 'Room / link', ''], list.map(row)) : empty(classTab === 'past' ? 'No past sessions' : 'Nothing scheduled', 'Schedule a session for one of your batches.')}</section>`;
      H.tab = b => { classTab = b.dataset.t; PAGES.classes(); };
      H.link = async b => { const v = await ask('Join link', { label: 'https meeting link (leave as it is to keep the current one)', placeholder: 'https://meet.example.com/abc', ok: 'Save link' }); if (!v) return; try { await L.updateSession(b.dataset.id, { joinUrl: v }); toast('Join link saved.'); PAGES.classes(); } catch (e) { fail(e); } };
      H.cancel = async b => { const r = await ask('Cancel this session', { label: 'Reason (shown to the batch)', ok: 'Cancel session' }); if (!r) return; try { await L.updateSession(b.dataset.id, { cancelReason: r }); toast('Session cancelled.'); PAGES.classes(); } catch (e) { fail(e); } };
      H.new = () => {
        const m = modal('Schedule a session', `<form class="form" id="nsF">
          <div class="row2"><label>Batch<select id="nsB">${bs.map(b => `<option value="${b.id}">${esc(b.code)} · ${esc(b.name)}</option>`).join('')}</select></label>
            <label>Type<select id="nsT"><option value="class">Class</option><option value="lab">Lab</option><option value="mentor">Mentor hour</option><option value="quiz">Quiz</option></select></label></div>
          <label>Title<input id="nsTi" maxlength="150" placeholder="Log analysis basics"></label>
          <div class="row2"><label>Starts<input id="nsS" type="datetime-local" value="${toLocalInput(Date.now() + DAY)}"></label><label>Length (minutes)<input id="nsD" type="number" min="15" max="480" value="60"></label></div>
          <div class="row2"><label>Room (for in-person)<input id="nsR" maxlength="120"></label><label>Join link (https, for online)<input id="nsJ" placeholder="https://"></label></div>
          <label style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" id="nsC" checked>Counts for attendance</label><p class="err" id="nsE"></p></form>`,
          { foot: '<button class="btn" data-x>Close</button><button class="btn btn-primary" form="nsF" type="submit">Schedule</button>' });
        $('#nsF', m).addEventListener('submit', async e => {
          e.preventDefault();
          const start = new Date($('#nsS', m).value), mins = +$('#nsD', m).value || 60;
          const body = { batchId: $('#nsB', m).value, type: $('#nsT', m).value, title: $('#nsTi', m).value.trim(), startsAt: start.toISOString(), endsAt: new Date(start.getTime() + mins * 6e4).toISOString(), countsForAttendance: $('#nsC', m).checked };
          if ($('#nsR', m).value.trim()) body.room = $('#nsR', m).value.trim();
          if ($('#nsJ', m).value.trim()) body.joinUrl = $('#nsJ', m).value.trim();
          try { await L.createSession(body); m.close(); toast('Session scheduled.'); classTab = 'upcoming'; PAGES.classes(); } catch (x) { $('#nsE', m).textContent = x.message; }
        });
      };
    });

    /* ---- Attendance + leave ---- */
    const MK = { present: 'P', late: 'L', absent: 'A', excused: 'E' };
    PAGES.attendance = sid => sid ? liveMark(sid) : page([['Attendance']], async () => {
      const [ses, lv] = await Promise.all([L.sessions(), L.leave()]);
      const held = ses.filter(s => s.state === 'completed' && s.countsForAttendance && s.status !== 'cancelled').reverse();
      const pend = lv.filter(v => v.status === 'pending');
      view.innerHTML = `<div class="card-h"><h1>Attendance</h1><div class="r">${chip(held.filter(s => !s.marked).length + ' to mark', held.some(s => !s.marked) ? 'a' : 'g')}</div></div>
        <section class="card"><div class="card-h"><h2>Sessions (last 30 days)</h2></div>${held.length ? tbl(['Date', 'Session', 'Batch', 'Marked', ''], held.map(s => [fDT(s.startsAt), esc(s.title), esc(s.batch.code), s.marked ? chip(s.marked + ' marked', 'g') : chip('Not marked', 'a'), `<a class="btn btn-xs btn-primary" href="#/trainer/attendance/${s.id}">${s.marked ? 'Review' : 'Mark'}</a>`])) : empty('No sessions to mark', 'Sessions appear here once they end.')}</section>
        <section class="card" id="leave"><div class="card-h"><h2>Leave requests</h2><div class="r">${chip(pend.length + ' pending', pend.length ? 'a' : 'g')}</div></div>
          ${lv.length ? tbl(['Student', 'Dates', 'Reason', 'Status', ''], lv.map(v => [`<b>${esc(v.student || '')}</b>`, v.fromDay === v.toDay ? esc(v.fromDay) : `${esc(v.fromDay)} to ${esc(v.toDay)}`, esc(v.reason), chip(v.status, v.status === 'approved' ? 'g' : v.status === 'pending' ? 'a' : ''), v.status === 'pending' ? `<button class="btn btn-xs btn-primary" data-act="lvOk" data-id="${v.id}">Approve</button> <button class="btn btn-xs" data-act="lvNo" data-id="${v.id}">Decline</button>` : esc(v.decisionNote || '')])) : empty('No leave requests')}
          <p class="note">Approved leave is shown on the roster; it never marks a student present or excused by itself.</p></section>`;
      H.lvOk = async b => { try { await L.decideLeave(b.dataset.id, true); toast('Leave approved. The student is notified.'); PAGES.attendance(); } catch (e) { fail(e); } };
      H.lvNo = async b => { const r = await ask('Decline leave', { label: 'Note for the student', ok: 'Decline' }); if (!r) return; try { await L.decideLeave(b.dataset.id, false, r); toast('Leave declined. The student is notified.'); PAGES.attendance(); } catch (e) { fail(e); } };
    });
    const liveMark = sid => page([['Attendance', '#/trainer/attendance'], ['…']], async () => {
      const r = await L.roster(sid);
      setCrumb([['Attendance', '#/trainer/attendance'], [r.session.title]]);
      const opt = (st, m) => ['present', 'late', 'absent', 'excused'].map(k => `<label style="display:inline-flex;gap:.25rem;align-items:center;margin-right:.5rem"><input type="radio" name="m-${st.id}" value="${k}" ${m === k ? 'checked' : ''}><span class="mark ${MK[k]}">${MK[k]}</span></label>`).join('');
      view.innerHTML = `<div class="card-h"><div><h1>${esc(r.session.title)}</h1><p class="note">${fDT(r.session.startsAt)} · ${esc(r.session.type)}</p></div><div class="r"><button class="btn btn-sm" data-act="all">All present</button><button class="btn btn-sm btn-primary" data-act="save">Save attendance</button></div></div>
        <section class="card">${r.students.length ? tbl(['Student', 'Mark', 'Note'], r.students.map(st => [`<b>${esc(st.name || '')}</b><br><small class="note">${esc(st.code || '')}</small>${st.approvedLeave ? ' ' + chip('Approved leave', 'b') : ''}`, opt(st, st.mark), `<input class="anote" data-id="${st.id}" maxlength="300" value="${esc(st.note || '')}" aria-label="Note">`])) : empty('No students enrolled')}</section>
        <p class="hidden-note">P present · L late · A absent · E excused. You can change marks for 7 days after the session; a change needs a reason and is kept in the history.</p>`;
      H.all = () => $$('input[type=radio][value=present]').forEach(i => { i.checked = true; });
      H.save = async () => {
        const marks = r.students.map(st => { const c = $(`input[name="m-${st.id}"]:checked`); const n = $(`.anote[data-id="${st.id}"]`).value.trim(); return c ? { studentId: st.id, mark: c.value, ...(n ? { note: n } : {}) } : null; }).filter(Boolean);
        if (!marks.length) return toast('Mark at least one student.', true);
        try { const done = await withReason(reason => L.mark(sid, marks, reason), 'Changing saved marks'); if (done !== null) { toast('Attendance saved.'); liveMark(sid); } } catch (e) { fail(e); }
      };
    });

    /* ---- Assessments ---- */
    PAGES.assessments = () => page([['Assessments']], async () => {
      const [as, bs] = await Promise.all([L.assessments(), batches()]);
      const st = a => chip(a.status, a.status === 'published' ? 'g' : a.status === 'draft' ? 'a' : '');
      view.innerHTML = `<div class="card-h"><h1>Assessments</h1><div class="r">${chip(as.length + ' total', 'b')}<button class="btn btn-primary btn-sm" data-act="aNew">New assessment</button></div></div>
        <section class="card">${as.length ? tbl(['Assessment', 'Kind', 'Due', 'Status', 'Results', 'Attempts', ''], as.map(a => [`<b>${esc(a.title)}</b><br><small class="note">${esc(a.code)} · pass ${a.passMarks}/${a.maxMarks}</small>`, esc(a.kind), a.dueAt ? fDT(a.dueAt) : '–', st(a),
          a.resultsRelease === 'manual' ? (a.releasedAt ? chip('Released', 'g') : chip('Held', 'a')) : esc(a.resultsRelease.replace('_', ' ')), a._count.attempts,
          `<button class="btn btn-xs btn-primary" data-act="subs" data-id="${a.id}">Submissions</button> ${a.format === 'questions' ? `<button class="btn btn-xs" data-act="aQs" data-id="${a.id}">Questions (${a._count.questions})</button> ` : ''}<button class="btn btn-xs" data-act="aRep" data-id="${a.id}">Report</button> <button class="btn btn-xs" data-act="aExt" data-id="${a.id}">Extend</button> ${a.status === 'draft' ? `<button class="btn btn-xs" data-act="pub" data-id="${a.id}">Publish</button>` : a.status === 'published' ? `<button class="btn btn-xs" data-act="close" data-id="${a.id}">Close</button>` : ''} ${a.resultsRelease === 'manual' && !a.releasedAt ? `<button class="btn btn-xs" data-act="rel" data-id="${a.id}">Release results</button>` : ''}`])) : empty('No assessments for your batches yet', bs.length ? 'Assessments created for your batches or their courses appear here.' : 'A Platform Admin assigns batches to you.')}</section>
        <p class="hidden-note">Scores reach students only when results are released. Changing a saved grade needs a reason and is kept in the grade history. Questions can change only until the first student starts. Answer keys are never sent to students.</p>`;
      const act = async (fn, msg) => { try { await fn(); toast(msg); PAGES.assessments(); } catch (e) { fail(e); } };
      H.pub = b => act(() => L.setAssessmentStatus(b.dataset.id, 'published'), 'Published to the batch.');
      H.close = b => act(() => L.setAssessmentStatus(b.dataset.id, 'closed'), 'Closed. No new submissions.');
      H.rel = b => act(() => L.release(b.dataset.id), 'Results released. Graded students are notified.');
      H.aNew = async () => {
        const cs = await L.courses(), bs2 = await batches();
        if (!cs.length) return toast('No course is linked to your batches yet. A Platform Admin links one.', true);
        const m = modal('New assessment', `<form class="form" id="naF"><div class="row2"><label>Course<select id="naC">${cs.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join('')}</select></label><label>Batch<select id="naB"><option value="">Every batch running the course</option>${bs2.map(b => `<option value="${b.id}" data-c="${b.courseId || ''}">${esc(b.code)}</option>`).join('')}</select></label></div>
          <div class="row2"><label>Title<input id="naT" maxlength="150"></label><label>Code<input id="naK" maxlength="40" placeholder="Q-SOC-3"></label></div>
          <div class="row2"><label>Kind<select id="naKi"><option value="quiz">Quiz</option><option value="assignment">Assignment</option><option value="practical">Practical</option><option value="exam">Exam</option><option value="lab_challenge">Lab challenge</option></select></label><label>Format<select id="naF2"><option value="questions">Questions (auto-graded)</option><option value="text">Written answer</option><option value="lab_result">Lab result</option></select></label></div>
          <div class="row2"><label>Max marks<input id="naM" type="number" min="1" max="1000" value="10"></label><label>Pass marks<input id="naP" type="number" min="0" max="1000" value="5"></label></div>
          <div class="row2"><label>Due (optional)<input id="naD" type="datetime-local"></label><label>Results<select id="naR"><option value="immediate">Shown at once</option><option value="after_due">After the due date</option><option value="manual">When I release them</option></select></label></div>
          <label>Instructions<textarea id="naI" maxlength="5000"></textarea></label><p class="note">Created as a draft. Add questions, then publish.</p><p class="err" id="naE"></p></form>`, { wide: true, foot: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="naF" type="submit">Create draft</button>' });
        $('#naF', m).addEventListener('submit', async e => {
          e.preventDefault();
          const due = $('#naD', m).value, o = { courseId: $('#naC', m).value, title: $('#naT', m).value.trim(), code: $('#naK', m).value.trim(), kind: $('#naKi', m).value, format: $('#naF2', m).value, maxMarks: +$('#naM', m).value, passMarks: +$('#naP', m).value, resultsRelease: $('#naR', m).value, instructions: $('#naI', m).value.trim() || undefined };
          if ($('#naB', m).value) o.batchId = $('#naB', m).value; if (due) o.dueAt = new Date(due).toISOString();
          try { const a = await L.createAssessment(o); m.close(); toast('Draft created.'); if (o.format === 'questions') questionEditor(a.id); else PAGES.assessments(); } catch (x) { $('#naE', m).textContent = x.message; }
        });
      };
      // Question editor: single choice, multiple choice or short text; the answer key stays on the server for students.
      const questionEditor = async id => {
        const a = await L.assessment(id);
        const KIND = { single: 'Single choice', multi: 'Multiple choice', short_text: 'Short text' };
        const keyText = q => q.kind === 'short_text' ? q.answerKey.join(' / ') : [].concat(q.answerKey).map(i => q.options[i]).join(', ');
        const m = modal(`Questions: ${a.title}`, `<div class="list">${a.questions.length ? a.questions.map((q, i) => `<div class="li"><div class="grow"><b>${i + 1}. ${esc(q.prompt)}</b><span class="note">${KIND[q.kind]} · ${q.marks} mark${q.marks === 1 ? '' : 's'}${q.options.length ? ' · ' + q.options.map(esc).join(' | ') : ''}</span><span class="note">Answer: ${esc(keyText(q))}</span></div><button class="btn btn-xs btn-danger" data-dq="${q.id}">Remove</button></div>`).join('') : empty('No questions yet')}</div>
          <form class="form" id="qF" style="margin-top:1rem"><h3>Add a question</h3><div class="row2"><label>Type<select id="qK"><option value="single">Single choice</option><option value="multi">Multiple choice</option><option value="short_text">Short text</option></select></label><label>Marks<input id="qM" type="number" min="0" max="100" value="1"></label></div>
          <label>Question<textarea id="qP" maxlength="2000"></textarea></label><label id="qOl">Options (one per line, up to 10)<textarea id="qO" rows="4"></textarea></label>
          <label>Correct answer <span class="note" id="qH">number of the correct option, e.g. 2</span><input id="qA"></label><p class="err" id="qE"></p><div class="toolbar"><button class="btn btn-primary btn-sm" type="submit">Add question</button></div></form>`, { wide: true });
        const kSel = $('#qK', m), hint = { single: 'number of the correct option, e.g. 2', multi: 'numbers of all correct options, e.g. 1, 3', short_text: 'accepted answers, separated by commas' };
        kSel.addEventListener('change', () => { $('#qH', m).textContent = hint[kSel.value]; $('#qOl', m).hidden = kSel.value === 'short_text'; });
        m.addEventListener('click', async e => { const d2 = e.target.closest('[data-dq]'); if (!d2) return; try { await L.deleteQuestion(d2.dataset.dq); m.close(); questionEditor(id); } catch (x) { fail(x); } });
        $('#qF', m).addEventListener('submit', async e => {
          e.preventDefault();
          const kind = kSel.value, opts = $('#qO', m).value.split('\n').map(x => x.trim()).filter(Boolean), raw = $('#qA', m).value.trim();
          let key;
          if (kind === 'short_text') key = raw.split(',').map(x => x.trim()).filter(Boolean);
          else { const n = raw.split(',').map(x => parseInt(x, 10) - 1).filter(x => x >= 0 && x < opts.length); key = kind === 'single' ? n[0] : n; }
          if (kind !== 'short_text' && opts.length < 2) return ($('#qE', m).textContent = 'Give at least two options.');
          if (key === undefined || (Array.isArray(key) && !key.length)) return ($('#qE', m).textContent = 'Give the correct answer.');
          try { await L.addQuestion(id, { kind, prompt: $('#qP', m).value.trim(), options: kind === 'short_text' ? [] : opts, answerKey: key, marks: +$('#qM', m).value, sortOrder: a.questions.length + 1 }); m.close(); toast('Question added.'); questionEditor(id); } catch (x) { $('#qE', m).textContent = x.message; }
        });
        m.addEventListener('click', e => { if (e.target.closest('[data-x]') && /^#\/trainer\/assessments\/?$/.test(location.hash)) PAGES.assessments(); });
      };
      H.aQs = b => questionEditor(b.dataset.id);
      H.aRep = async b => { try { const r = await L.report(b.dataset.id); modal('Assessment report', `<div class="grid g4">${[['Waiting to grade', r.submitted], ['Students graded', r.graded], ['Average', r.average === null ? '–' : r.average + '/' + r.maxMarks], ['Pass rate', r.passRatePct === null ? '–' : r.passRatePct + '%']].map(x => `<div class="stat blue"><b>${esc(String(x[1]))}</b><span>${x[0]}</span></div>`).join('')}</div><p class="note" style="margin-top:.6rem">${esc(r.rule)}</p>`); } catch (e) { fail(e); } };
      H.aExt = async b => {
        const ss = await allRows();
        const m = modal('Extend the deadline for a student', `<form class="form" id="exF"><label>Student<select id="exS">${ss.map(x => `<option value="${x.studentId}">${esc(x.name)} · ${esc(x.batch)}</option>`).join('')}</select></label><label>New due date<input id="exD" type="datetime-local" value="${toLocalInput(Date.now() + 2 * DAY)}"></label><label>Reason<input id="exR" maxlength="300"></label><p class="err" id="exE"></p></form>`, { foot: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="exF" type="submit">Extend</button>' });
        $('#exF', m).addEventListener('submit', async e => { e.preventDefault(); try { await L.extend(b.dataset.id, { studentId: $('#exS', m).value, dueAt: new Date($('#exD', m).value).toISOString(), reason: $('#exR', m).value.trim() }); m.close(); toast('Deadline extended for that student.'); } catch (x) { $('#exE', m).textContent = x.message; } });
      };
      H.subs = async b => {
        const a = as.find(x => x.id === b.dataset.id);
        try {
          const subs = await L.submissions(a.id);
          const m = modal(`Submissions: ${a.title}`, subs.length ? tbl(['Student', 'Submitted', 'State', 'Score', 'Answer', ''], subs.map(s => [`<b>${esc((s.student && s.student.name) || '')}</b><br><small class="note">${esc((s.student && s.student.code) || '')}</small>`, s.submittedAt ? fDT(s.submittedAt) : '–', chip(s.status, s.status === 'graded' ? 'g' : s.status === 'returned' ? 'a' : 'b'), s.score === null ? '–' : `${s.score}/${a.maxMarks}`,
            s.textResponse ? `<small>${esc(s.textResponse.slice(0, 160))}${s.textResponse.length > 160 ? '…' : ''}</small>` : s.labRef ? esc(s.labRef) : '<span class="note">Auto-graded answers</span>', `<button class="btn btn-xs btn-primary" data-g="${s.id}">${s.score === null ? 'Grade' : 'Change'}</button>`])) : empty('No submissions yet'), { wide: true });
          m.addEventListener('click', async e => {
            const g = e.target.closest('[data-g]'); if (!g) return;
            const s = subs.find(x => x.id === g.dataset.g);
            const f = modal('Grade submission', `<form class="form" id="gF"><label>Score (0 to ${a.maxMarks})<input id="gS" type="number" min="0" max="${a.maxMarks}" value="${s.score ?? ''}"></label>
              <label>Feedback for the student<textarea id="gFb" maxlength="4000">${esc(s.feedback || '')}</textarea></label>
              <label style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" id="gR">Return for revision</label><p class="err" id="gE"></p></form>`,
              { foot: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="gF" type="submit">Save grade</button>' });
            $('#gF', f).addEventListener('submit', async ev => {
              ev.preventDefault();
              const body = { score: +$('#gS', f).value, feedback: $('#gFb', f).value.trim() || undefined, returnForRevision: $('#gR', f).checked };
              try { const r = await withReason(reason => L.grade(s.id, reason ? { ...body, reason } : body), 'Changing a saved grade'); if (r !== null) { f.close(); m.close(); toast('Grade saved.'); PAGES.assessments(); } } catch (x) { $('#gE', f).textContent = x.message; }
            });
          });
        } catch (e) { fail(e); }
      };
    });

    /* ---- Lab Monitor: step progress per student from verified lab records, stuck alerts, nudges ---- */
    PAGES.labs = bid => page([['Lab Monitor']], async () => {
      const [r, bs] = await Promise.all([L.labs(bid || ''), batches()]);
      const ms = r.missions.filter(m => m.steps > 0);
      const cell = l => l.state === 'cleared' ? '<span class="chip g" title="Cleared">✓</span>' : l.state === 'stuck' ? `<span class="chip r" title="Stuck">${l.stepsDone}/${l.steps}</span>` : l.state === 'in_progress' ? `<span class="chip b" title="In progress${l.hintsUsed ? ', ' + l.hintsUsed + ' hint(s)' : ''}">${l.stepsDone}/${l.steps}</span>` : '<span class="note">–</span>';
      const stuck = r.students.reduce((n, s) => n + s.stuck.length, 0);
      view.innerHTML = `<div class="card-h"><h1>Lab Monitor</h1><div class="r">${stuck ? chip(stuck + ' stuck', 'r') : chip('No one stuck', 'g')}<select data-chg="lmB" aria-label="Batch"><option value="">All my batches</option>${bs.map(b => `<option value="${b.id}" ${b.id === bid ? 'selected' : ''}>${esc(b.code)}</option>`).join('')}</select></div></div>
        <section class="card">${r.students.length ? `<div class="tw"><table class="tbl"><thead><tr><th>Student</th><th>Cleared</th>${ms.map(m => `<th title="${esc(m.title)}">${esc(m.code)}</th>`).join('')}<th></th></tr></thead><tbody>${r.students.map(s => `<tr><td class="first"><b>${esc(s.name)}</b><br><small class="note">${esc(s.batches.join(', '))}</small></td><td>${s.cleared}/${ms.length}</td>${ms.map(m => `<td>${cell(s.labs.find(l => l.code === m.code))}</td>`).join('')}<td>${s.labs.some(l => l.state === 'in_progress' || l.state === 'stuck') ? `<button class="btn btn-xs" data-act="lmN" data-id="${s.studentId}">Nudge</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('No students in your batches yet')}</section>
        <p class="hidden-note">Numbers are steps done out of the lab’s steps. Stuck: ${esc(r.rules.stuck)} ${esc(r.rules.hidden)} Live container status stays inside the lab service.</p>`;
      H.lmB = el => location.hash = '#/trainer/labs/' + el.value;
      H.lmN = b => {
        const s = r.students.find(x => x.studentId === b.dataset.id), open = s.labs.filter(l => l.state === 'in_progress' || l.state === 'stuck');
        const m = modal('Nudge ' + s.name, `<form class="form" id="nuF"><label>Lab<select id="nuL">${open.map(l => `<option value="${esc(l.code)}">${esc((ms.find(x => x.code === l.code) || {}).title || l.code)} · ${l.stepsDone}/${l.steps}${l.state === 'stuck' ? ' · stuck' : ''}</option>`).join('')}</select></label><label>Short note (optional)<textarea id="nuM" maxlength="500" placeholder="Stuck on a step? Re-read the briefing, then ask me."></textarea></label><p class="note">The student gets an in-app notification. One nudge per lab per day.</p><p class="err" id="nuE"></p></form>`, { foot: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="nuF" type="submit">Send nudge</button>' });
        $('#nuF', m).addEventListener('submit', async e => { e.preventDefault(); try { await L.nudge({ studentId: s.studentId, missionCode: $('#nuL', m).value, message: $('#nuM', m).value.trim() || undefined }); m.close(); toast('Nudge sent.'); } catch (x) { $('#nuE', m).textContent = x.message; } });
      };
    });

    /* ---- Mentoring: bookings, slots, mock results, placement reviews ---- */
    PAGES.mentoring = () => page([['Mentoring']], async () => {
      const [rq, sl, rv] = await Promise.all([L.requests(), L.slots(), L.reviews()]);
      const now = Date.now();
      const PUR = { doubt: 'Doubt session', mentoring: 'Mentoring', mock_interview: 'Mock interview' };
      const reqAct = r => r.status === 'pending' ? `<button class="btn btn-xs btn-primary" data-act="rqOk" data-id="${r.id}">Approve</button> <button class="btn btn-xs" data-act="rqProp" data-id="${r.id}">New time</button> <button class="btn btn-xs" data-act="rqNo" data-id="${r.id}">Decline</button>`
        : r.purpose === 'mock_interview' && r.status === 'approved' && t(r.endsAt) < now ? `<button class="btn btn-xs btn-primary" data-act="mock" data-id="${r.id}">Record result</button>`
        : r.purpose !== 'mock_interview' && (r.status === 'approved' || r.status === 'completed') && t(r.startsAt) < now && !r.outcome ? `<button class="btn btn-xs btn-primary" data-act="outc" data-id="${r.id}">Record outcome</button>`
        : r.outcome ? `<small>${esc(r.outcome)}${r.followUp ? `<br><span class="note">Follow-up: ${esc(r.followUp)}</span>` : ''}</small>` : esc(r.decisionNote || '');
      const items = [...rv.resumes.map(x => ({ k: 'Resume', id: x.userId, who: x.userId, t: x.headline || 'Resume', sid: x.userId })), ...rv.projects.map(x => ({ k: 'Project', id: x.id, t: x.title, sid: x.userId })), ...rv.milestones.map(x => ({ k: 'Milestone', id: x.milestoneId, t: x.milestone.title, sid: x.userId, url: x.evidenceUrl }))];
      const names = new Map((await allRows()).map(s => [s.studentId, s.name]));
      view.innerHTML = `<div class="card-h"><h1>Mentoring</h1><div class="r">${chip(rq.filter(r => r.status === 'pending').length + ' requests', 'b')}<button class="btn btn-primary btn-sm" data-act="slot">Add open slot</button></div></div>
        <section class="card"><div class="card-h"><h2>Session requests</h2></div>${rq.length ? tbl(['When', 'Student', 'Purpose', 'Note', 'Status', ''], rq.map(r => [fDT(r.proposedStart || r.startsAt), `<b>${esc(r.student || '')}</b>`, PUR[r.purpose] || esc(r.purpose), esc(r.note || ''), chip(r.status, r.status === 'approved' || r.status === 'completed' ? 'g' : r.status === 'pending' || r.status === 'proposed' ? 'a' : ''), reqAct(r)])) : empty('No requests yet', 'Students book your open slots from their Training Grid.')}</section>
        <section class="card"><div class="card-h"><h2>Your open slots</h2></div>${sl.length ? tbl(['Starts', 'Ends', 'Kind', 'Booked', ''], sl.map(s => [fDT(s.startsAt), fT(s.endsAt), s.kind === 'mock_interview' ? 'Mock interview' : '1-to-1', s.requests.length ? chip(s.requests.length + ' booked', 'b') : '–', s.requests.length ? '' : `<button class="btn btn-xs btn-danger" data-act="rmSlot" data-id="${s.id}">Remove</button>`])) : empty('No open slots', 'Add a slot so students can book you.')}</section>
        <section class="card"><div class="card-h"><h2>Placement reviews</h2><div class="r">${chip(items.length + ' waiting', items.length ? 'a' : 'g')}</div></div>${items.length ? tbl(['Student', 'Item', 'Title', ''], items.map((x, i) => [`<b>${esc(names.get(x.sid) || '')}</b>`, x.k, esc(x.t) + (x.url ? ` · <a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">evidence</a>` : ''), `<button class="btn btn-xs btn-primary" data-act="rvOk" data-i="${i}">Approve</button> <button class="btn btn-xs" data-act="rvNo" data-i="${i}">Send back</button>`])) : empty('Nothing to review')}</section>`;
      const done = msg => { toast(msg); PAGES.mentoring(); };
      H.rqOk = async b => { try { await L.decideRequest(b.dataset.id, { decision: 'approve' }); done('Approved. The student is notified.'); } catch (e) { fail(e); } };
      H.rqNo = async b => { const r = await ask('Decline request', { label: 'Note for the student', ok: 'Decline' }); if (!r) return; try { await L.decideRequest(b.dataset.id, { decision: 'reject', note: r }); done('Declined.'); } catch (e) { fail(e); } };
      H.rqProp = async b => {
        const m = modal('Propose another time', `<form class="form" id="pF"><label>New start<input id="pS" type="datetime-local" value="${toLocalInput(Date.now() + DAY)}"></label><label>Note<input id="pN" maxlength="300"></label><p class="err" id="pE"></p></form>`, { foot: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="pF" type="submit">Propose</button>' });
        $('#pF', m).addEventListener('submit', async e => { e.preventDefault(); try { await L.decideRequest(b.dataset.id, { decision: 'propose', proposedStart: new Date($('#pS', m).value).toISOString(), note: $('#pN', m).value.trim() || undefined }); m.close(); done('New time sent to the student.'); } catch (x) { $('#pE', m).textContent = x.message; } });
      };
      H.slot = () => {
        const m = modal('Add an open slot', `<form class="form" id="sF"><div class="row2"><label>Starts<input id="sS" type="datetime-local" value="${toLocalInput(Date.now() + DAY)}"></label><label>Length (minutes)<input id="sD" type="number" min="15" max="240" value="30"></label></div>
          <label>Kind<select id="sK"><option value="one_to_one">1-to-1 (doubts, mentoring)</option><option value="mock_interview">Mock interview</option></select></label><p class="err" id="sE"></p></form>`, { foot: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="sF" type="submit">Add slot</button>' });
        $('#sF', m).addEventListener('submit', async e => { e.preventDefault(); const s = new Date($('#sS', m).value); try { await L.addSlot({ startsAt: s.toISOString(), endsAt: new Date(s.getTime() + (+$('#sD', m).value || 30) * 6e4).toISOString(), kind: $('#sK', m).value }); m.close(); done('Slot added. Students can book it now.'); } catch (x) { $('#sE', m).textContent = x.message; } });
      };
      H.rmSlot = async b => { try { await L.removeSlot(b.dataset.id); done('Slot removed.'); } catch (e) { fail(e); } };
      H.outc = b => {
        const m = modal('Session outcome', `<form class="form" id="oF"><label>What was covered<textarea id="oO" maxlength="2000"></textarea></label><label>Agreed follow-up (optional)<input id="oU" maxlength="1000" placeholder="Write two Sigma rules by Friday"></label><p class="note">Seen by you and the Platform Admin. The session is marked completed.</p><p class="err" id="oE"></p></form>`, { foot: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="oF" type="submit">Save outcome</button>' });
        $('#oF', m).addEventListener('submit', async e => { e.preventDefault(); try { await L.outcome(b.dataset.id, { outcome: $('#oO', m).value.trim(), followUp: $('#oU', m).value.trim() || undefined }); m.close(); done('Outcome saved.'); } catch (x) { $('#oE', m).textContent = x.message; } });
      };
      H.mock = b => {
        const sc = id => `<select id="${id}">${[1, 2, 3, 4, 5].map(n => `<option ${n === 3 ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
        const m = modal('Mock interview result', `<form class="form" id="mF"><div class="row2"><label>Technical (1-5)${sc('mT')}</label><label>Communication (1-5)${sc('mC')}</label></div><label>Problem solving (1-5)${sc('mP')}</label>
          <label style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" id="mOk">Passed</label><label>Feedback for the student<textarea id="mF2" maxlength="2000"></textarea></label><p class="err" id="mE"></p></form>`, { foot: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="mF" type="submit">Save result</button>' });
        $('#mF', m).addEventListener('submit', async e => { e.preventDefault(); try { await L.mockResult(b.dataset.id, { technical: +$('#mT', m).value, communication: +$('#mC', m).value, problemSolving: +$('#mP', m).value, passed: $('#mOk', m).checked, feedback: $('#mF2', m).value.trim() }); m.close(); done('Result recorded. It counts toward placement readiness.'); } catch (x) { $('#mE', m).textContent = x.message; } });
      };
      const review = async (i, ok) => {
        const x = items[+i];
        const fb = ok ? '' : await ask('Send back', { label: 'What should the student change?', ok: 'Send back' });
        if (!ok && !fb) return;
        try {
          if (x.k === 'Resume') await L.reviewResume(x.sid, ok ? { approve: true } : { approve: false, feedback: fb });
          else if (x.k === 'Project') await L.reviewProject(x.id, ok ? { approve: true } : { approve: false, feedback: fb });
          else await L.verifyMilestone(x.sid, x.id, ok ? { done: true } : { done: false, note: fb });
          done(ok ? 'Approved.' : 'Sent back with your note.');
        } catch (e) { fail(e); }
      };
      H.rvOk = b => review(b.dataset.i, true); H.rvNo = b => review(b.dataset.i, false);
    });

    /* ---- Messages ---- */
    PAGES.messages = cid => page([['Messages']], async () => {
      const [th, an, bs] = await Promise.all([L.conversations(), L.announcements().catch(() => []), L.batches().catch(() => [])]);
      const sel = th.find(x => x.id === cid) || th[0];
      const conv = sel ? await L.thread(sel.id) : null;
      if (sel && sel.unread) LIVE.bell();
      view.innerHTML = `<div class="card-h"><h1>Messages</h1><div class="r">${chip(th.filter(x => x.unread).length + ' unread', 'b')}<button class="btn btn-primary btn-sm" data-act="newMsg">New message</button></div></div>
        <div class="dash"><section class="card s5"><div class="card-h"><h2>Inbox</h2></div><div class="list">${th.map(x => `<a class="li ${x.unread && (!sel || x.id !== sel.id) ? 'blue' : ''}" href="#/trainer/messages/${x.id}" style="color:var(--text);text-decoration:none;${sel && x.id === sel.id ? 'border-color:var(--green)' : ''}"><div class="grow"><b>${esc(x.with || '')}</b><span>${esc(x.subject)}</span><span class="note">${esc(x.preview.slice(0, 70))} · ${ago(t(x.lastMessageAt))}</span></div></a>`).join('') || empty('No messages yet', 'Students in your batches can message you from their Academy.')}</div></section>
        <section class="card s7">${conv ? `<div class="card-h"><div><h2>${esc(conv.subject)}</h2><p class="note">${esc(sel.with || '')}</p></div></div>
          <div class="thread">${conv.messages.map(m => `<div class="bub ${m.mine ? 'me' : ''}">${esc(m.body)}<br><small class="note">${m.mine ? 'You' : esc(sel.with || '')} · ${ago(t(m.at))}</small></div>`).join('')}</div>
          <div class="form" style="margin-top:.8rem"><textarea id="rpl" maxlength="4000" placeholder="Reply… (no lab answers, no personal data requests)"></textarea><div class="toolbar"><button class="btn btn-primary btn-sm" data-act="reply" data-id="${conv.id}">Reply</button></div></div>` : empty('Select a conversation')}</section></div>
        <div class="dash" style="margin-top:1rem"><form class="card s5 form" data-sub="ann"><h2>Post to batch</h2>
          ${bs.length ? `<label>Batch<select id="anB">${bs.map(b => `<option value="${b.id}">${esc(b.code)} · ${esc(b.name)}</option>`).join('')}</select></label>
          <label>Title<input id="anT" maxlength="150" placeholder="e.g. Bring your SIEM login tonight"></label><label>Message<textarea id="anM" rows="3" maxlength="2000"></textarea></label>
          <button class="btn btn-primary btn-sm" type="submit">Post announcement</button><p class="err" id="anE" role="alert"></p>
          <p class="note">Students of the batch get it in their bell and under “Trainer announcements” in My Handler. Every post is audited.</p>` : '<p class="note">You do not lead a batch yet.</p>'}</form>
          <section class="card s7"><div class="card-h"><h2>Announcement history</h2><div class="r">${chip(an.length + ' posted', 'b')}</div></div>
            <div class="list">${an.length ? an.map(a => `<div class="li"><div class="grow"><b>${esc(a.title)}</b><span>${esc(a.body)}</span><span class="note">${esc(a.batch)} · ${a.recipients} student${a.recipients === 1 ? '' : 's'} · ${ago(t(a.at))}</span></div></div>`).join('') : empty('No announcements yet')}</div></section></div>`;
      H.ann = async () => { const o = { title: $('#anT').value.trim(), body: $('#anM').value.trim() }; $('#anE').textContent = '';
        if (o.title.length < 3 || !o.body) { $('#anE').textContent = 'Write a title (3+ characters) and a message.'; return; }
        try { const r = await L.announce($('#anB').value, o); toast(`Posted to ${r.batch}: ${r.recipients} student${r.recipients === 1 ? '' : 's'}.`); PAGES.messages(cid); } catch (e) { $('#anE').textContent = e.message; } };
      H.reply = async b => { const v = $('#rpl').value.trim(); if (!v) return toast('Write a reply first.', true); try { await L.reply(b.dataset.id, v); toast('Reply sent.'); PAGES.messages(b.dataset.id); } catch (e) { fail(e); } };
      H.newMsg = () => newMessage(null);
    });

    /* ---- Content: modules, lessons and FAQs of courses my batches run (publish, price and access stay admin-only) ---- */
    const LTYPES = ['concept', 'video', 'document', 'slides', 'quiz', 'lab', 'live_class', 'resource'];
    // OI-48: every edit or delete says why (a reason from the list, plus a comment; the comment is required for "Other").
    const REASONS = [['content_correction', 'Content correction'], ['outdated', 'Outdated content'], ['duplicate', 'Duplicate'], ['restructure', 'Restructuring the course'], ['other', 'Other']];
    const reasonFields = () => `<div class="row2"><label>Reason for this change<select id="rsC"><option value="">Choose a reason…</option>${REASONS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
      <label>Comment <span class="note" id="rsH">(optional)</span><textarea id="rsN" rows="2" maxlength="500" placeholder="What changed and why"></textarea></label></div>`;
    const bindReason = m => { const s = $('#rsC', m); s.addEventListener('change', () => { $('#rsH', m).textContent = s.value === 'other' ? '(required)' : '(optional)'; }); };
    const readReason = m => {
      const reasonCode = $('#rsC', m).value, reasonNote = $('#rsN', m).value.trim();
      if (!reasonCode) return 'Choose a reason for this change.';
      if (reasonCode === 'other' && reasonNote.length < 5) return 'For "Other", describe the reason (at least 5 characters).';
      return reasonNote ? { reasonCode, reasonNote } : { reasonCode };
    };
    // A small dialog for a rename or a delete; resolves to { title?, reasonCode, reasonNote? } or null.
    const askChange = (title, { text = '', newTitle = null, ok = 'Confirm' } = {}) => new Promise(res => {
      const m = modal(title, `<form class="form" id="rsF">${text ? `<p class="note">${esc(text)}</p>` : ''}${newTitle !== null ? `<label>New title<input id="rsT" maxlength="150" value="${esc(newTitle)}"></label>` : ''}${reasonFields()}<p class="err" id="rsE"></p></form>`,
        { foot: `<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="rsF" type="submit">${esc(ok)}</button>` });
      bindReason(m);
      let done = false; const fin = v => { if (!done) { done = true; res(v); } };
      $('#rsF', m).addEventListener('submit', e => {
        e.preventDefault();
        const t = newTitle !== null ? $('#rsT', m).value.trim() : null;
        if (newTitle !== null && t.length < 2) { $('#rsE', m).textContent = 'Enter a title.'; return; }
        const why = readReason(m); if (typeof why === 'string') { $('#rsE', m).textContent = why; return; }
        fin(t !== null ? Object.assign({ title: t }, why) : why); m.close();
      });
      const obs = new MutationObserver(() => { if (!m.isConnected) { fin(null); obs.disconnect(); } }); obs.observe(document.body, { childList: true });
    });
    /* ---- Course builder (owner, 29 Oct): trainers create and publish their own courses. Once published, a trainer's
       edit or delete waits for a Platform Admin (change request); price and free/paid access stay admin-only. ---- */
    const TRACKS = ['Defensive', 'Offensive', 'GRC', 'Foundations'];
    const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
    const ST = { published: ['Published', 'g'], draft: ['Draft', 'a'], unpublished: ['Unpublished', 'r'], archived: ['Archived', ''] };
    const stChipL = st => chip((ST[st] || [st])[0], (ST[st] || [])[1]);
    const ROLE = { owner: ['Owner', 'g'], co_editor: ['Co-editor', 'b'], batch: ['Batch trainer', ''] };
    const roleChip = r => chip(ROLE[r][0], ROLE[r][1]);
    const KINDS = { 'file.add': 'Upload a file', 'file.delete': 'Remove a file', 'course.cover': 'Change the cover image', 'course.patch': 'Edit course details', 'course.unpublish': 'Unpublish', 'module.add': 'Add module', 'module.patch': 'Edit module', 'module.delete': 'Delete module', 'lesson.add': 'Add lesson', 'lesson.patch': 'Edit lesson', 'lesson.delete': 'Delete lesson', 'faq.add': 'Add FAQ', 'faq.patch': 'Edit FAQ', 'faq.delete': 'Delete FAQ' };
    // a change to a published course comes back as { pending, code, message }: say so instead of "saved"
    const doneMsg = (r, ok) => r && r.pending ? `${r.code}: ${r.message}` : ok;
    let liveTab = 'all';
    /* Uploads (owner, 29 Oct): the trainer picks a "type of content"; only matching files are sent, and the server checks
       each one again (extension, MIME, real file bytes, size). Folders keep their paths; hidden/system files are skipped. */
    const fileUrl = id => window.YojoAPI.base + '/files/' + id;
    const fmtSize = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
    const isSys = p => p.split('/').some(x => x.startsWith('.') || x === '__MACOSX' || /^(thumbs\.db|desktop\.ini)$/i.test(x));
    const coverStyle = id => id ? ` style="background:center/cover no-repeat url('${fileUrl(id)}');color:transparent"` : '';
    // every file inside a dropped folder, with its path (DataTransfer entries API)
    const dropped = async dt => {
      const out = [], walk = (en, path) => new Promise(res => {
        if (en.isFile) en.file(f => { out.push([f, path + f.name]); res(); }, () => res());
        else if (en.isDirectory) { const rd = en.createReader(), all = [];
          const next = () => rd.readEntries(async es => { if (!es.length) { for (const x of all) await walk(x, path + en.name + '/'); res(); } else { all.push(...es); next(); } }, () => res()); next(); }
        else res();
      });
      const ents = [...(dt.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
      if (ents.length) { for (const en of ents) await walk(en, ''); return out; }
      return [...dt.files].map(f => [f, f.name]);
    };
    // sends files one by one with a progress bar each; resolves to { ok, pending, refused, skipped }
    const sendFiles = async (cid, kind, list, rules, why, box) => {
      const rule = rules.find(r => r.kind === kind), sum = { ok: 0, pending: 0, refused: 0, skipped: 0 };
      box.innerHTML = list.map(([f, path], i) => `<div class="li" id="upR${i}"><div class="grow"><b>${esc(path)}</b><span class="note">${fmtSize(f.size)}</span></div><span class="pbar blue"><i style="--w:0%"></i><span>0%</span></span><span class="note" data-st>Waiting</span></div>`).join('');
      for (let i = 0; i < list.length; i++) {
        const [f, path] = list[i], row = $('#upR' + i, box), st = $('[data-st]', row), bar = $('.pbar i', row), pct = $('.pbar span', row);
        const ext = (f.name.match(/\.([a-z0-9]+)$/i) || [])[1]; const e2 = ext ? ext.toLowerCase() : '';
        const no = msg => { st.innerHTML = chip(msg, 'r'); sum.refused++; };
        if (isSys(path)) { st.innerHTML = chip('Skipped (hidden or system file)', ''); sum.skipped++; continue; }
        if (!rule.ext.includes(e2)) { no(`${rule.label} accepts ${rule.ext.map(x => '.' + x).join(', ')}`); continue; }
        if (f.size > rule.maxMb * 1048576) { no(`Too large (max ${rule.maxMb} MB)`); continue; }
        const fd = new FormData(); fd.append('kind', kind); fd.append('relPath', path); if (why) { fd.append('reasonCode', why.reasonCode); if (why.reasonNote) fd.append('reasonNote', why.reasonNote); }
        fd.append('file', f, f.name); st.textContent = 'Uploading';
        try {
          const r = await window.YojoAPI.upload('/trainer/courses/' + cid + '/files', fd, p => { bar.style.setProperty('--w', p + '%'); pct.textContent = p + '%'; });
          bar.style.setProperty('--w', '100%'); pct.textContent = '100%';
          if (r.pending) { st.innerHTML = chip(r.code + ' waiting for approval', 'a'); sum.pending++; } else { st.innerHTML = chip('Uploaded', 'g'); sum.ok++; }
        } catch (x) { no(x.message); }
      }
      return sum;
    };
    PAGES.content = (cid, sub) => cid === 'new' ? liveNew() : cid ? (sub === 'manage' ? liveManage(cid) : sub === 'enrolled' ? liveStudents(cid) : liveCourse(cid)) : page([['Content']], async () => {
      const r = await L.courses(), cs = r.items;
      const TABS = [['all', 'All Courses'], ['published', 'Published'], ['draft', 'Draft'], ['unpublished', 'Unpublished']];
      const list = cs.filter(c => liveTab === 'all' || c.status === liveTab);
      view.innerHTML = `<div class="card-h"><h1>Course builder</h1><div class="r"><a class="btn btn-primary" href="#/trainer/content/new">+ New course</a></div></div>
        <div class="tabs" role="tablist">${TABS.map(([k, t]) => `<button role="tab" aria-selected="${k === liveTab}" data-act="tab" data-t="${k}">${t} (${r.counts[k] || 0})</button>`).join('')}</div>
        <div class="grid g3">${list.map(c => `<div class="card ccard"><div class="cover"${coverStyle(c.coverFileId)}>${esc(String(c.track).slice(0, 3).toUpperCase())}</div><div class="meta">${stChipL(c.status)}${roleChip(c.role)}${c.pendingChanges ? chip(c.pendingChanges + ' waiting for approval', 'a') : ''}</div>
          <h3>${esc(c.title)}</h3><p class="note">${esc(c.track)}${c.level ? ' · ' + esc(c.level) : ''}${c.duration ? ' · ' + esc(c.duration) : ''} · Owner: ${esc(c.owner)}</p>
          <div class="kv" style="grid-template-columns:repeat(3,1fr)"><span>Modules<b>${c._count.modules}</b></span><span>Lessons<b>${c._count.lessons}</b></span><span>Enrolled<b>${c.enrolled}</b></span></div>
          <p class="note">Batch: ${esc(c.batches.join(', ') || 'Not assigned')} · v${c.version}</p>
          <div class="toolbar"><a class="btn btn-sm btn-primary" href="#/trainer/content/${c.id}">Edit</a>${c.role !== 'batch' ? `<a class="btn btn-sm" href="#/trainer/content/${c.id}/manage">Manage</a>` : ''}<a class="btn btn-sm" href="#/trainer/content/${c.id}/enrolled">Students</a></div></div>`).join('') || `<div class="card" style="grid-column:1/-1">${empty('No courses here', liveTab === 'all' ? 'Create a course with “+ New course”, or ask a Platform Admin to link a course to your batch.' : '')}</div>`}</div>
        <p class="hidden-note">Drafts are visible only to you, your co-editors and Content admins. You can publish your own courses; after that, every edit or delete is sent to a Platform Admin for approval and the live course stays as it is until approved. Price and free or paid access are set by a Platform Admin.</p>`;
      H.tab = b => { liveTab = b.dataset.t; PAGES.content(); };
    });

    const liveNew = () => page([['Content', '#/trainer/content'], ['New course']], async () => {
      const bs = await L.courseBatches();
      view.innerHTML = `<section class="card" style="max-width:820px"><div class="card-h"><h1>Create course</h1></div><form class="form" id="ncF">
        <label>Course title<input id="ncT" required maxlength="150" placeholder="e.g. Intro to Threat Hunting"></label>
        <div class="row3"><label>Track<select id="ncTr">${TRACKS.map(t => `<option>${t}</option>`).join('')}</select></label><label>Level<select id="ncL">${LEVELS.map(t => `<option>${t}</option>`).join('')}</select></label><label>Duration<input id="ncD" maxlength="40" placeholder="4 weeks"></label></div>
        <label>Description<textarea id="ncDe" maxlength="400"></textarea></label><label>Learning outcomes (one per line)<textarea id="ncO"></textarea></label>
        <div class="row2"><label>Cover image (optional)<input id="ncCv" type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"><small class="note">PNG, JPG or WebP, up to 2 MB. Without one, the card shows the track banner.</small></label><label>Owner<input value="${esc(ME.name)} (you)" disabled></label></div>
        <fieldset style="border:1px solid var(--border);border-radius:10px;padding:.7rem"><legend class="note">Assign to batches</legend><div class="toolbar">${bs.map(b => `<label style="display:flex;gap:.4rem;align-items:center" ${b.course ? `title="Runs ${esc(b.course.title)}"` : ''}><input type="checkbox" class="ncB" value="${b.id}" ${b.course ? 'disabled' : ''}>${esc(b.code)}${b.course ? ` <small class="note">(runs ${esc(b.course.title)})</small>` : ''}</label>`).join('') || '<span class="note">You do not lead a batch yet.</span>'}</div>
          <small class="note">A batch runs one course. To move a batch that already runs a course, ask a Platform Admin.</small></fieldset>
        <p class="note">The course starts as Draft, visible only to you, co-editors and Content admins.</p><p class="err" id="ncE" role="alert"></p>
        <div class="toolbar"><a class="btn" href="#/trainer/content">Cancel</a><button class="btn btn-primary" type="submit">Create and open builder</button></div></form></section>`;
      $('#ncF').addEventListener('submit', async e => {
        e.preventDefault(); const bt = e.target.querySelector('[type=submit]'); bt.disabled = true; $('#ncE').textContent = '';
        const o = { title: $('#ncT').value.trim(), track: $('#ncTr').value, level: $('#ncL').value, batchIds: $$('.ncB:checked').map(x => x.value) };
        const d = $('#ncD').value.trim(); if (d) o.duration = d;
        const de = $('#ncDe').value.trim(); if (de) o.summary = de;
        const oc = $('#ncO').value.split('\n').map(x => x.trim()).filter(Boolean); if (oc.length) o.outcomes = oc;
        const cv = $('#ncCv').files[0];
        if (cv && (!/\.(png|jpe?g|webp)$/i.test(cv.name) || cv.size > 2 * 1048576)) { $('#ncE').textContent = 'Cover image: PNG, JPG or WebP up to 2 MB.'; bt.disabled = false; return; }
        try { const c = await L.createCourse(o);
          if (cv) { const fd = new FormData(); fd.append('kind', 'cover'); fd.append('file', cv, cv.name);
            try { await window.YojoAPI.upload('/trainer/courses/' + c.id + '/files', fd); } catch (x) { toast('Course created, but the cover image was refused: ' + x.message, true); } }
          toast('Course created as Draft.'); location.hash = `#/trainer/content/${c.id}`; }
        catch (x) { $('#ncE').textContent = x.message; bt.disabled = false; }
      });
    });

    const liveManage = cid => page([['Content', '#/trainer/content'], ['…'], ['Manage']], async () => {
      const [c, bs] = await Promise.all([L.course(cid), L.courseBatches()]);
      setCrumb([['Content', '#/trainer/content'], [c.title, `#/trainer/content/${cid}`], ['Manage']]);
      const ed = c.role !== 'batch', pub = c.status === 'published', own = c.role === 'owner';
      const free = bs.filter(b => !b.course);
      view.innerHTML = `<div class="card-h"><div><h1>Manage course</h1><p class="note">${esc(c.title)} · v${c.version} · ${stChipL(c.status)} ${roleChip(c.role)}</p></div>
          <div class="r"><a class="btn btn-sm" href="#/trainer/content/${cid}">Open builder</a><a class="btn btn-sm" href="#/trainer/content/${cid}/enrolled">Enrolled students</a></div></div>
        ${pub ? '<div class="warn">This course is published. Your edits and deletes are sent to a Platform Admin; students keep seeing the live version until the change is approved.</div>' : ''}
        <div class="dash"><section class="card s6"><div class="card-h"><h2>Publishing</h2><div class="r">${stChipL(c.status)}</div></div>
          <p class="note">${pub ? 'Students of the assigned batches can open it. Unpublishing takes it offline for them, so it needs a Platform Admin’s approval.' : 'Publish when it has a description or at least one published lesson. Students of the assigned batches get a bell message.'}</p>
          <div class="toolbar" style="margin-top:.6rem">${pub ? `<button class="btn btn-sm btn-danger" data-act="unpub" ${ed ? '' : 'disabled'}>Request unpublish</button>` : `<button class="btn btn-sm btn-primary" data-act="pub" ${ed ? '' : 'disabled'}>Publish</button>`}</div>
          <p class="note" style="margin-top:.5rem">Price and free or paid access: set by a Platform Admin.</p></section>
        <section class="card s6"><div class="card-h"><h2>Change requests</h2><div class="r">${chip(c.changeRequests.filter(x => x.status === 'pending').length + ' waiting', 'a')}</div></div>
          ${c.changeRequests.length ? `<div class="list">${c.changeRequests.map(x => `<div class="li ${x.status === 'pending' ? 'amber' : 'red'}"><div class="grow"><b>${esc(x.code)} · ${esc(KINDS[x.kind] || x.kind)}</b><span class="note">${x.status === 'pending' ? 'Waiting for a Platform Admin' : 'Rejected' + (x.decisionNote ? ': ' + esc(x.decisionNote) : '')} · ${fDT(new Date(x.createdAt).getTime())}</span></div>${chip(x.status === 'pending' ? 'Pending' : 'Rejected', x.status === 'pending' ? 'a' : 'r')}</div>`).join('')}</div>` : empty('No change requests', 'Edits of a published course show here until a Platform Admin decides.')}</section></div>
        <section class="card" style="margin-top:1rem"><div class="card-h"><h2>Course details</h2></div><form class="form" id="mdF">
          <label>Course title<input name="title" maxlength="150" value="${esc(c.title)}" ${ed ? '' : 'disabled'}></label>
          <div class="row3"><label>Track<select name="track" ${ed ? '' : 'disabled'}>${TRACKS.map(t => `<option ${t === c.track ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label>Level<select name="level" ${ed ? '' : 'disabled'}>${LEVELS.map(t => `<option ${t === c.level ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label>Duration<input name="duration" maxlength="40" value="${esc(c.duration || '')}" ${ed ? '' : 'disabled'}></label></div>
          <label>Description<textarea name="summary" maxlength="400" ${ed ? '' : 'disabled'}>${esc(c.summary || '')}</textarea></label>
          <label>Learning outcomes (one per line)<textarea name="outcomes" ${ed ? '' : 'disabled'}>${esc((c.outcomes || []).join('\n'))}</textarea></label>
          ${pub && ed ? reasonFields() : ''}<p class="err" id="mdE" role="alert"></p>
          ${ed ? `<div class="toolbar"><button class="btn btn-sm btn-primary" type="submit">${pub ? 'Send for approval' : 'Save details'}</button></div>` : '<p class="note">Read only: only the owner and co-editors change the course details.</p>'}</form></section>
        <section class="card" style="margin-top:1rem"><div class="card-h"><h2>Cover image</h2></div><div class="row2">
            <div class="ccard"><div class="cover"${coverStyle(c.coverFileId)}>${esc(String(c.track).slice(0, 3).toUpperCase())}</div></div>
            ${ed ? `<form class="form" id="cvF"><label>New cover (PNG, JPG or WebP, up to 2 MB)<input id="cvI" type="file" accept=".png,.jpg,.jpeg,.webp"></label>${pub ? '<p class="note">Published course: the new cover waits for a Platform Admin.</p>' : ''}<p class="err" id="cvE"></p><button class="btn btn-sm" type="submit">Upload cover</button></form>` : '<p class="note">Only the owner and co-editors change the cover.</p>'}</div></section>
        <div class="grid g2" style="margin-top:1rem"><section class="card"><div class="card-h"><h2>Batches</h2></div>
            <div class="list">${c.batches.length ? c.batches.map(b => `<div class="li"><div class="grow"><b>${esc(b.code)}</b><span class="note">${esc(b.name)} · ${esc(b.status)}</span></div>${ed && !pub && bs.some(x => x.id === b.id) ? `<button class="btn btn-xs" data-act="unB" data-id="${b.id}">Remove</button>` : ''}</div>`).join('') : empty('Not assigned')}</div>
            ${ed ? (free.length ? `<div class="toolbar" style="margin-top:.6rem"><select id="adB" aria-label="Batch to assign">${free.map(b => `<option value="${b.id}">${esc(b.code)}</option>`).join('')}</select><button class="btn btn-sm" data-act="addB">Assign batch</button></div>` : '<p class="note">All your batches already run a course. A Platform Admin can move a batch.</p>') : ''}</section>
          <section class="card"><div class="card-h"><h2>Co-editors</h2></div>
            <div class="list">${c.coEditors.length ? c.coEditors.map(u => `<div class="li"><div class="grow"><b>${esc(u.name)}</b><span class="note">${esc(u.email)}</span></div>${own ? `<button class="btn btn-xs" data-act="rmCo" data-id="${u.id}">Remove</button>` : ''}</div>`).join('') : empty('No co-editors')}</div>
            ${own ? '<form class="toolbar" id="coF" style="margin-top:.6rem"><input id="coE" type="email" placeholder="trainer@yojosolutions.com" aria-label="Trainer email" style="flex:1"><button class="btn btn-sm" type="submit">Add co-editor</button></form>' : '<p class="note">Only the owner adds co-editors.</p>'}</section></div>`;
      const again = msg => { toast(msg); liveManage(cid); };
      if (pub && ed) bindReason(view);
      if (ed) $('#mdF').addEventListener('submit', async e => {
        e.preventDefault(); const f = e.target; $('#mdE').textContent = '';
        const o = {}, put = (k, v, cur) => { if (v !== cur) o[k] = v; };
        put('title', f.title.value.trim(), c.title); put('track', f.track.value, c.track); put('level', f.level.value, c.level);
        put('duration', f.duration.value.trim(), c.duration || ''); put('summary', f.summary.value.trim(), c.summary || '');
        const oc = f.outcomes.value.split('\n').map(x => x.trim()).filter(Boolean); if (oc.join('\n') !== (c.outcomes || []).join('\n')) o.outcomes = oc;
        if (!Object.keys(o).length) { $('#mdE').textContent = 'Nothing changed.'; return; }
        if (pub) { const why = readReason(view); if (typeof why === 'string') { $('#mdE').textContent = why; return; } Object.assign(o, why); }
        try { again(doneMsg(await L.patchCourse(cid, o), 'Details saved.')); } catch (x) { $('#mdE').textContent = x.message; }
      });
      if (ed) $('#cvF').addEventListener('submit', async e => {
        e.preventDefault(); const f = $('#cvI').files[0]; $('#cvE').textContent = '';
        if (!f) { $('#cvE').textContent = 'Choose an image.'; return; }
        if (!/\.(png|jpe?g|webp)$/i.test(f.name) || f.size > 2 * 1048576) { $('#cvE').textContent = 'PNG, JPG or WebP up to 2 MB.'; return; }
        let why = null; if (pub) { why = await askChange('Change the cover image', { ok: 'Send for approval' }); if (!why) return; }
        const fd = new FormData(); fd.append('kind', 'cover'); if (why) { fd.append('reasonCode', why.reasonCode); if (why.reasonNote) fd.append('reasonNote', why.reasonNote); } fd.append('file', f, f.name);
        try { const r = await window.YojoAPI.upload('/trainer/courses/' + cid + '/files', fd); again(r.pending ? doneMsg(r) : 'Cover image updated.'); } catch (x) { $('#cvE').textContent = x.message; }
      });
      H.pub = async () => { try { await L.publishCourse(cid); again('Published. Students of the assigned batches get a bell message.'); } catch (e) { fail(e); } };
      H.unpub = async () => { const why = await askChange('Request unpublish', { text: 'A Platform Admin approves this before students lose access. Progress, grades and attendance are kept.', ok: 'Send for approval' }); if (!why) return; try { again(doneMsg(await L.unpublishCourse(cid, why), 'Unpublished.')); } catch (e) { fail(e); } };
      H.addB = async () => { try { await L.assignBatches(cid, [$('#adB').value]); again('Batch assigned.'); } catch (e) { fail(e); } };
      H.unB = async b => { try { await L.unassignBatch(cid, b.dataset.id); again('Batch removed from this course.'); } catch (e) { fail(e); } };
      H.rmCo = async b => { try { await L.removeCoEditor(cid, b.dataset.id); again('Co-editor removed.'); } catch (e) { fail(e); } };
      if (own) $('#coF').addEventListener('submit', async e => { e.preventDefault(); try { const u = await L.addCoEditor(cid, $('#coE').value.trim()); again(`${u.name} can now edit this course.`); } catch (x) { fail(x); } });
    });

    const liveStudents = cid => page([['Content', '#/trainer/content'], ['…'], ['Enrolled students']], async () => {
      const [c, e] = await Promise.all([L.course(cid), L.courseStudents(cid)]);
      setCrumb([['Content', '#/trainer/content'], [c.title, `#/trainer/content/${cid}`], ['Enrolled students']]);
      view.innerHTML = `<div class="card-h"><h1>Enrolled students</h1><div class="r">${chip(e.rows.length + ' in your batches', 'g')}${e.otherBatches ? chip(`${e.otherBatches} in other batches`, '') : ''}</div></div>
        ${e.rows.length ? tbl(['Student', 'Batch', 'Course progress', 'Status', 'Last active'], e.rows.map(r => [`<a href="#/trainer/students/${r.id}"><b>${esc(r.name)}</b></a><br><small class="note">${esc(r.code)}</small>`, esc(r.batch), pbar(r.progress, 'blue'), esc(r.status), r.lastActive ? ago(new Date(r.lastActive).getTime()) : '<span class="note">Not started</span>'])) : `<div class="card">${empty('No students from your batches', 'Assign one of your batches to this course to see them here.')}</div>`}
        <p class="hidden-note">Progress counts the ${e.publishedLessons} published lesson${e.publishedLessons === 1 ? '' : 's'}. Contact, guardian and financial details are hidden. Students of other batches show as a count only.</p>`;
    });

    const liveCourse = cid => page([['Content', '#/trainer/content'], ['…']], async () => {
      const [c, fl] = await Promise.all([L.course(cid), L.files(cid).catch(() => null)]);
      setCrumb([['Content', '#/trainer/content'], [c.title]]);
      const lessonRow = l => `<div class="li ${l.status === 'published' ? 'green' : ''}"><div class="grow"><b>${esc(l.title)}</b><span class="note">${esc(l.type)} · ${esc(l.status)}${l.durationMin ? ' · ' + l.durationMin + ' min' : ''}</span></div><button class="btn btn-xs" data-act="eLes" data-id="${l.id}">Edit</button><button class="btn btn-xs btn-danger" data-act="dLes" data-id="${l.id}">Delete</button></div>`;
      const pubd = c.status === 'published', pend = c.changeRequests.filter(x => x.status === 'pending').length;
      view.innerHTML = `<div class="card-h"><div><h1>${esc(c.title)}</h1><p class="note">${esc(c.code)} · v${c.version} · ${stChipL(c.status)} ${roleChip(c.role)} · Batches: ${esc(c.batches.map(b => b.code).join(', ') || 'not assigned')}</p></div><div class="r">${c.role !== 'batch' ? `<a class="btn btn-sm" href="#/trainer/content/${cid}/manage">Manage</a>` : ''}<a class="btn btn-sm" href="#/trainer/content/${cid}/enrolled">Students</a><button class="btn btn-primary btn-sm" data-act="aMod">Add module</button></div></div>
        ${pubd ? `<div class="warn">Published: every edit or delete you make here is sent to a Platform Admin for approval (with your reason). Students see the live version until it is approved.${pend ? ` ${pend} change${pend === 1 ? '' : 's'} waiting.` : ''}</div>` : ''}
        ${c.modules.length ? c.modules.map(m => `<section class="card"><div class="card-h"><h2>${esc(m.title)}</h2><div class="r"><button class="btn btn-xs" data-act="aLes" data-id="${m.id}">Add lesson</button><button class="btn btn-xs" data-act="rMod" data-id="${m.id}">Rename</button><button class="btn btn-xs btn-danger" data-act="dMod" data-id="${m.id}">Delete</button></div></div>
          <div class="list">${m.lessons.length ? m.lessons.map(lessonRow).join('') : empty('No lessons yet')}</div></section>`).join('') : `<div class="card">${empty('No modules yet', 'Add a module, then add lessons to it.')}</div>`}
        <section class="card" id="upPanel"><div class="card-h"><h2>Course files</h2><div class="r">${fl && fl.storage ? chip('Storage: ' + fl.storage, 'b') : chip('Storage not connected (OI-45)', 'r')}</div></div>
          ${fl && fl.storage ? `<div class="row2"><label>Type of content<select id="upK">${fl.kinds.filter(k => k.kind !== 'cover').map(k => `<option value="${k.kind}">${esc(k.label)}</option>`).join('')}</select></label><p class="note" id="upH" style="align-self:end"></p></div>
          <div id="upZ" tabindex="0" style="border:2px dashed var(--border);border-radius:12px;padding:1.2rem;text-align:center;margin:.6rem 0"><b>Drag files or a folder here</b><p class="note">or</p>
            <div class="toolbar" style="justify-content:center"><label class="btn btn-sm">Upload files<input id="upF" type="file" multiple hidden></label><label class="btn btn-sm">Upload folder<input id="upD" type="file" webkitdirectory directory multiple hidden></label></div></div>
          ${pubd ? '<p class="note">This course is published: uploads wait for a Platform Admin. Give a reason first.</p>' + reasonFields() : ''}
          <div class="list" id="upList"></div><p class="note" id="upSum"></p>
          <h3 style="margin-top:.8rem">Files in this course</h3>
          <div class="list">${fl.items.filter(f => f.kind !== 'cover').length ? fl.items.filter(f => f.kind !== 'cover').map(f => `<div class="li ${f.status === 'pending' ? 'amber' : ''}"><div class="grow"><b>${esc(f.relPath)}</b><span class="note">${esc((fl.kinds.find(k => k.kind === f.kind) || {}).label || f.kind)} · ${fmtSize(f.sizeBytes)} · ${f.status === 'pending' ? 'waiting for approval' : 'active'} · scan pending (OI-45)</span></div><a class="btn btn-xs" target="_blank" rel="noopener" href="${fileUrl(f.id)}">Open</a><button class="btn btn-xs btn-danger" data-act="rmF" data-id="${f.id}">Remove</button></div>`).join('') : empty('No files yet', 'Uploaded files can be attached to lessons.')}</div>
          <p class="hidden-note">${esc(fl.scan)} Executables and scripts are never accepted.</p>` : `<p class="note">${fl ? 'File storage is not connected on this server (OPEN-ITEMS OI-45).' : 'Could not load the files.'}</p>`}</section>
        <section class="card"><div class="card-h"><h2>FAQs</h2><div class="r"><button class="btn btn-xs btn-primary" data-act="aFaq">Add FAQ</button></div></div>
          <div class="list">${c.faqs.length ? c.faqs.map(f => `<div class="li ${f.published ? 'green' : ''}"><div class="grow"><b>${esc(f.question)}</b><span class="note">${esc(f.answer)}</span></div>${chip(f.published ? 'Shown' : 'Hidden', f.published ? 'g' : '')}<button class="btn btn-xs" data-act="eFaq" data-id="${f.id}">Edit</button><button class="btn btn-xs btn-danger" data-act="dFaq" data-id="${f.id}">Delete</button></div>`).join('') : empty('No FAQs yet')}</div></section>
        <p class="hidden-note">Lessons marked published are visible to enrolled students once the course is published. A module or lesson that students have progress in cannot be deleted; unpublish the lesson instead.</p>`;
      const again = msg => { toast(msg); liveCourse(cid); };
      const files = fl && fl.storage ? fl.items.filter(f => f.kind !== 'cover' && f.status === 'active') : [];
      if (fl && fl.storage) {
        const k = $('#upK'), hint = () => { const r = fl.kinds.find(x => x.kind === k.value); $('#upH').textContent = `Accepts ${r.ext.map(x => '.' + x).join(', ')} · up to ${r.maxMb} MB each`; $('#upF').accept = r.ext.map(x => '.' + x).join(','); };
        k.addEventListener('change', hint); hint(); if (pubd) bindReason($('#upPanel'));
        const go = async list => {
          if (!list.length) return;
          let why = null; if (pubd) { why = readReason($('#upPanel')); if (typeof why === 'string') { toast(why, true); return; } }
          const s2 = await sendFiles(cid, k.value, list, fl.kinds, why, $('#upList'));
          $('#upSum').textContent = `${s2.ok} uploaded · ${s2.pending} waiting for approval · ${s2.refused} refused · ${s2.skipped} skipped`;
          if (s2.ok || s2.pending) setTimeout(() => liveCourse(cid), 2500);
        };
        $('#upF').addEventListener('change', e => go([...e.target.files].map(f => [f, f.name])));
        $('#upD').addEventListener('change', e => go([...e.target.files].map(f => [f, f.webkitRelativePath || f.name])));
        const z = $('#upZ');
        z.addEventListener('dragover', e => { e.preventDefault(); z.style.borderColor = 'var(--gold, #E8B04B)'; });
        z.addEventListener('dragleave', () => { z.style.borderColor = ''; });
        z.addEventListener('drop', async e => { e.preventDefault(); z.style.borderColor = ''; go(await dropped(e.dataTransfer)); });
      }
      H.rmF = async b => { const f = fl.items.find(x => x.id === b.dataset.id); const why = pubd ? await askChange('Remove file', { text: f.relPath, ok: 'Send for approval' }) : (confirm('Remove ' + f.relPath + '? Lessons using it lose the file.') ? {} : null); if (!why) return;
        try { const r = await L.removeFile(b.dataset.id, why); again(r && r.pending ? doneMsg(r) : 'File removed.'); } catch (e) { fail(e); } };
      const lessonForm = (l, onSave) => {
        const m = modal(l ? 'Edit lesson' : 'Add lesson', `<form class="form" id="lF"><label>Title<input id="lT" maxlength="200" value="${esc(l ? l.title : '')}"></label>
          <div class="row2"><label>Type<select id="lY">${LTYPES.map(x => `<option ${l && l.type === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label>Status<select id="lS"><option value="draft">Draft</option><option value="published" ${l && l.status === 'published' ? 'selected' : ''}>Published</option></select></label></div>
          <div class="row2"><label>Length (minutes)<input id="lD" type="number" min="1" max="1000" value="${l && l.durationMin ? l.durationMin : ''}"></label><label>Content link (https)<input id="lU" value="${esc(l && l.contentUrl ? l.contentUrl : '')}" placeholder="https://"></label></div>
          ${files.length ? `<label>Attached file<select id="lFi"><option value="">No file</option>${files.map(f => `<option value="${f.id}" ${l && l.fileKey === f.id ? 'selected' : ''}>${esc(f.relPath)}</option>`).join('')}</select></label>` : ''}
          <label>Text (plain text, shown to students)<textarea id="lB" rows="6" maxlength="20000">${esc(l && l.body ? l.body : '')}</textarea></label>${l || pubd ? reasonFields() : ''}<p class="err" id="lE"></p></form>`,
          { wide: true, foot: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="lF" type="submit">Save</button>' });
        if (l || pubd) bindReason(m);
        $('#lF', m).addEventListener('submit', async e => {
          e.preventDefault();
          const why = l || pubd ? readReason(m) : {}; if (typeof why === 'string') { $('#lE', m).textContent = why; return; }
          const o = Object.assign({ title: $('#lT', m).value.trim(), type: $('#lY', m).value, status: $('#lS', m).value }, why);
          const d = +$('#lD', m).value; if (d) o.durationMin = d;
          const u = $('#lU', m).value.trim(); if (u) o.contentUrl = u;
          const b = $('#lB', m).value; if (b.trim()) o.body = b;
          const fi = $('#lFi', m); if (fi) { const v = fi.value || null; if (v !== ((l && l.fileKey) || null)) o.fileId = v; }
          try { const r = await onSave(o); m.close(); again(doneMsg(r, 'Lesson saved.')); } catch (x) { $('#lE', m).textContent = x.message; }
        });
      };
      const faqForm = (f, onSave) => {
        const m = modal(f ? 'Edit FAQ' : 'Add FAQ', `<form class="form" id="fF"><label>Question<input id="fQ" maxlength="300" value="${esc(f ? f.question : '')}"></label><label>Answer<textarea id="fA" maxlength="3000">${esc(f ? f.answer : '')}</textarea></label>
          <label style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" id="fP" ${f && f.published ? 'checked' : ''}>Show on the course page</label>${f || pubd ? reasonFields() : ''}<p class="err" id="fE"></p></form>`,
          { foot: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" form="fF" type="submit">Save</button>' });
        if (f || pubd) bindReason(m);
        $('#fF', m).addEventListener('submit', async e => { e.preventDefault(); const why = f || pubd ? readReason(m) : {}; if (typeof why === 'string') { $('#fE', m).textContent = why; return; } try { const r = await onSave(Object.assign({ question: $('#fQ', m).value.trim(), answer: $('#fA', m).value.trim(), published: $('#fP', m).checked }, why)); m.close(); again(doneMsg(r, 'FAQ saved.')); } catch (x) { $('#fE', m).textContent = x.message; } });
      };
      const lessons = c.modules.flatMap(m => m.lessons);
      H.aMod = async () => {
        // published course: the new module waits for approval, so it needs a reason like any other change (OI-48)
        const o = pubd ? await askChange('Add module', { newTitle: '', ok: 'Send for approval', text: 'This course is published: a Platform Admin approves new modules.' }) : await ask('Add module', { label: 'Module title', ok: 'Add' }).then(t => t ? { title: t } : null);
        if (!o) return; try { again(doneMsg(await L.addModule(cid, Object.assign({ sortOrder: c.modules.length + 1 }, o)), 'Module added.')); } catch (e) { fail(e); } };
      H.rMod = async b => { const cur = c.modules.find(x => x.id === b.dataset.id); const o = await askChange('Rename module', { newTitle: cur ? cur.title : '', ok: 'Save' }); if (!o) return; try { again(doneMsg(await L.patchModule(b.dataset.id, o), 'Module renamed.')); } catch (e) { fail(e); } };
      H.dMod = async b => { const why = await askChange('Delete module', { text: 'This deletes the module and its lessons.', ok: 'Delete' }); if (!why) return; try { again(doneMsg(await L.deleteModule(b.dataset.id, why), 'Module deleted.')); } catch (e) { fail(e); } };
      H.aLes = b => lessonForm(null, o => L.addLesson(b.dataset.id, o));
      H.eLes = b => lessonForm(lessons.find(x => x.id === b.dataset.id), o => L.patchLesson(b.dataset.id, o));
      H.dLes = async b => { const why = await askChange('Delete lesson', { ok: 'Delete' }); if (!why) return; try { again(doneMsg(await L.deleteLesson(b.dataset.id, why), 'Lesson deleted.')); } catch (e) { fail(e); } };
      H.aFaq = () => faqForm(null, o => L.addFaq(cid, o));
      H.eFaq = b => faqForm(c.faqs.find(x => x.id === b.dataset.id), o => L.patchFaq(b.dataset.id, o));
      H.dFaq = async b => { const why = await askChange('Delete FAQ', { ok: 'Delete' }); if (!why) return; try { again(doneMsg(await L.deleteFaq(b.dataset.id, why), 'FAQ deleted.')); } catch (e) { fail(e); } };
    });
    PAGES.feedback = (pg, rt) => page([['My Feedback']], async () => {
      const page2 = +pg || 1, r = await L.feedback(page2, +rt || 0), S = r.summary;
      const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
      view.innerHTML = `<div class="card-h"><h1>My Feedback</h1><div class="r"><select data-chg="fbR" aria-label="Filter by rating"><option value="">All ratings</option>${[5, 4, 3, 2, 1].map(n => `<option value="${n}" ${+rt === n ? 'selected' : ''}>${n} star${n === 1 ? '' : 's'}</option>`).join('')}</select></div></div>
        <div class="grid g2"><section class="card"><div class="card-h"><h3>Average rating</h3></div><div style="display:flex;gap:1rem;align-items:center"><b style="font-size:2.4rem">${S.average === null ? '–' : S.average}</b><span class="note">${S.count} rating${S.count === 1 ? '' : 's'} from students</span></div></section>
          <section class="card"><div class="card-h"><h3>By rating</h3></div><div class="comp">${S.byRating.map(x => `<div><span>${x.rating} ★</span>${pbar(S.count ? Math.round(100 * x.count / S.count) : 0, 'blue')}<b>${x.count}</b></div>`).join('')}</div></section></div>
        <section class="card"><div class="card-h"><h3>Comments</h3></div>${r.items.length ? `<div class="list">${r.items.map(x => `<div class="li"><div class="grow"><b style="color:var(--amber)">${stars(x.rating)}</b><span>${x.comment ? esc(x.comment) : '<span class="note">No comment</span>'}</span><span class="note">${esc(x.context.title)}${x.context.batch ? ' · ' + esc(x.context.batch) : ''}${x.context.startsAt ? ' · ' + fD(x.context.startsAt) : ''} · rated ${ago(t(x.at))}</span></div></div>`).join('')}</div>` : empty('No feedback yet', 'Students can rate a class or a mentoring session they attended, once each (they may change their rating).')}
          ${r.total > r.pageSize ? `<div class="toolbar" style="margin-top:.8rem">${page2 > 1 ? `<a class="btn btn-sm" href="#/trainer/feedback/${page2 - 1}/${rt || ''}">Previous</a>` : ''}${page2 * r.pageSize < r.total ? `<a class="btn btn-sm" href="#/trainer/feedback/${page2 + 1}/${rt || ''}">Next</a>` : ''}</div>` : ''}</section>
        <p class="hidden-note">${esc(r.privacy)}</p>`;
      H.fbR = el => location.hash = '#/trainer/feedback/1/' + el.value;
    });
    PAGES.profile = () => page([['My profile']], async () => {
      const u = LIVE.user, p = u.staffProfile || {};
      view.innerHTML = `<div class="card-h"><h1>My profile</h1></div><section class="card"><div class="kv">
          <span>Name<b>${esc(p.displayName || u.displayName || '')}</b></span><span>Email<b>${esc(u.email)}</b></span><span>Capability<b>${esc(ME.capability)}</b></span><span>Batches<b>${esc(ME.batches.join(', ') || 'none')}</b></span></div>
        <p class="note" style="margin-top:.8rem">To change your password, sign out and use “Forgot password” on the sign-in page; your authenticator code is asked for. Editing the trainer profile from this console is not connected yet.</p></section>`;
    });
  }

  window.TrainerUI = { route };
  route();
})();
