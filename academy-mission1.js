/* Missions 1-3 front end. One engine, one config per mission. Uses academy.html globals: me, saveDb, $, $$, esc, toast, modal, addXp, renderHeader.
   All XP, quiz grading are decided by mission-api; this file only renders and relays. */
function makeMission(CFG) {
  const API = window.YOJO_M1_API || `http://${location.hostname}:8100`;
  let MAX = CFG.MAX;  // practical missions take the configured reward from the server
  const PRACTICAL = CFG.KIND === 'practical';
  const { ID, BASE, XPK, LESSON, SLUG, TITLE, DESC, LEVEL, MINS, LESSON_XP, PER_Q, KEYWORDS } = CFG;
  const pct = x => Math.min(100, Math.round(100 * (x || 0) / MAX));
  const CID = CFG.CARD;
  const st = { tab: 'lesson', sec: 0, mission: null, prog: null, sess: null, answers: [], qi: 0, result: null, busy: false, offline: false, token: null };
  async function http(path, opts = {}, retry = true) {
    if (!st.token) {
      const r = await fetch(API + BASE+'/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: me.email, name: me.name || '' }) });
      if (!r.ok) throw { status: r.status };
      st.token = (await r.json()).token;
    }
    const r = await fetch(API + path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + st.token } });
    if (r.status === 401 && retry) { st.token = null; return http(path, opts, false); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw { status: r.status, msg: typeof data.detail === 'string' ? data.detail : 'Something went wrong.' };
    return data;
  }
  const post = (p, b) => http(p, { method: 'POST', body: JSON.stringify(b || {}) });
  const failMsg = e => e && e.msg ? e.msg : 'Could not reach the mission service. Check your connection and try again.';

  /* Backend is the only XP authority; the local profile just mirrors what it confirmed. */
  function sync(p) {
    st.prog = p; const s = me.stats, prev = s[XPK] || 0;
    const gain = p.xp - prev;
    if (gain > 0) { addXp(gain); s[XPK] = p.xp; }
    if (p.completed && !s.cleared.includes(ID)) s.cleared.push(ID);
    saveDb(); renderHeader();
    if (gain > 0) flashXp(gain);  // same tick as the header total, only after the server confirmed
  }
  /* "+N XP" pops up on the top-bar XP chip at the moment its total changes */
  function flashXp(n) {
    const el = $('#hXp'), chip = el && (el.closest('.stat-chip') || el.parentElement); if (!chip || !chip.animate) return;
    chip.style.position = 'relative';
    const f = document.createElement('span'); f.textContent = '+' + n + ' XP'; f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:absolute;left:50%;top:100%;transform:translateX(-50%);color:var(--amber);font:700 .8rem var(--f-mono);pointer-events:none;white-space:nowrap;z-index:50';
    chip.appendChild(f);
    f.animate([{ opacity: 0, transform: 'translate(-50%,-6px)' }, { opacity: 1, transform: 'translate(-50%,6px)', offset: .25 }, { opacity: 0, transform: 'translate(-50%,22px)' }], { duration: 1800 }).onfinish = () => f.remove();
    chip.animate([{ boxShadow: '0 0 0 0 rgba(255,176,0,.7)' }, { boxShadow: '0 0 0 8px rgba(255,176,0,0)' }], { duration: 900 });
  }
  async function load() {
    try {
      const d = await http(BASE+'/mission'); st.mission = d; st.offline = false; MAX = d.max_xp || MAX; sync(d.progress);
      if (!PRACTICAL && !st.answers.length) st.answers = Array(d.questions.length).fill(null);
      if (PRACTICAL) st.sess = await http(BASE+'/session/current').catch(() => null);
    } catch (e) { st.offline = true; }
  }
  const todo = p => [!p.lesson_completed && 'finish the lesson', !p.quiz_scored && 'take the quiz'].filter(Boolean).join(', ') || 'nothing';

  const live = () => st.sess && st.sess.status === 'active';

  function status() {
    const p = st.prog; if (!p) return '<span class="chip">Not started</span>';
    return p.completed ? '<span class="chip g">Completed</span>' : (p.lesson_completed || p.quiz_scored || p.attempts || live()) ? '<span class="chip b">In progress</span>' : '<span class="chip">Not started</span>';
  }
  /* ---- mission card on the Missions page ---- */
  async function card() {
    const grid = $('#mGrid'); if (!grid || (typeof mFilter !== 'undefined' && mFilter !== 'All')) return;
    const q = (typeof mSearch !== 'undefined' ? mSearch : '').toLowerCase();
    if (q && !KEYWORDS.includes(q)) return;
    const el = document.createElement('div'); el.id = CID+'Card'; grid.append(el); $$('#mGrid > p.note').forEach(x => x.remove());
    const draw = () => {
      const p = st.prog || {}, done = p.completed;
      el.className = 'mission' + (done ? ' cleared' : '');
      el.innerHTML = `<div class="row"><span class="chip b">${ID}</span><span class="chip g">Free &amp; Premium</span>${status()}</div><b>${TITLE}</b>
        <span class="note">${DESC}</span>
        <div class="row note"><span>${LEVEL} · ${MINS} min</span><span class="mono" style="color:var(--amber)">${p.xp || 0}/${MAX} XP</span></div>
        <div class="bar" aria-label="Mission progress"><i style="width:${pct(p.xp)}%"></i></div>
        ${st.offline ? '<span class="note" style="color:var(--red)">Mission service offline. Retry shortly.</span>' : ''}
        <div class="row"><button class="btn btn-sm btn-primary" id="${CID}Start" ${st.busy ? 'disabled' : ''}>${PRACTICAL ? (st.busy && !CFG.START_OPENS_PAGE ? 'Starting…' : live() ? '▶ Resume' : done ? 'Replay (0 XP)' : '▶ Start') : done ? 'Replay (0 XP)' : p.xp ? '▶ Resume' : '▶ Start'}</button>${PRACTICAL && live() ? `<button class="btn btn-sm btn-amber" id="${CID}Stop" ${st.busy ? 'disabled' : ''}>■ Stop</button>` : ''}<button class="btn btn-sm" id="${CID}Info">Info</button></div>`;
      $('#'+CID+'Start', el).onclick = async () => {
        if (!PRACTICAL || CFG.START_OPENS_PAGE || live() || done) { location.hash = '#/academy/mission/' + SLUG; return; }  // Replay and Resume open the mission page
        if (await startSession(draw)) location.href = st.sess.url;  // redirect to the assigned lab target
      };
      const sb = $('#'+CID+'Stop', el); if (sb) sb.onclick = () => stopSession(draw);
      $('#'+CID+'Info', el).onclick = info;
    };
    draw(); if (!st.mission) { await load(); if (el.isConnected) draw(); }
  }
  function info() {
    if (PRACTICAL) return modal(`<div class="row"><span class="chip b">${ID} · ${LEVEL}</span><button class="btn btn-sm" data-close>Close</button></div><h2>${TITLE}</h2>
      <p class="note">${CFG.INFO_DESC}</p>
      <div class="list"><div class="item"><span>Duration</span><b>${MINS} minutes</b></div><div class="item"><span>Type</span><b>Hands-on practical</b></div><div class="item"><span>Reward</span><b class="mono" style="color:var(--amber)">${MAX} XP, paid once</b></div></div>
      <p class="note"><b>You will be able to:</b> ${CFG.OBJECTIVES}</p>
      <p class="note"><b>To complete:</b> ${CFG.INFO_TODO}</p>
      <p class="note">Open to free and premium learners.</p>`);
    modal(`<div class="row"><span class="chip b">${ID} · ${LEVEL}</span><button class="btn btn-sm" data-close>Close</button></div><h2>${TITLE}</h2>
      <p class="note">${CFG.INFO_DESC}</p>
      <div class="list"><div class="item"><span>Duration</span><b>${MINS} minutes</b></div><div class="item"><span>Theory lesson</span><b class="mono" style="color:var(--amber)">+${LESSON_XP} XP</b></div><div class="item"><span>${CFG.QN}-question quiz</span><b class="mono" style="color:var(--amber)">+${PER_Q} XP each (${CFG.QN * PER_Q})</b></div><div class="item"><span>Maximum</span><b class="mono" style="color:var(--amber)">${MAX} XP</b></div></div>
      <p class="note"><b>You will be able to:</b> ${CFG.OBJECTIVES}</p>
      <p class="note"><b>To complete:</b> finish the lesson and take the quiz.</p>
      <p class="note">Open to free and premium learners. XP is paid once, by the server. Quiz retries are practice only.</p>`);
  }
  let counting = false;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  /* Start Lab: a visible 5→1 countdown, then open the lab in a new tab (opened on click so the browser allows it). */
  async function launchWithCountdown(redraw) {
    if (st.busy || counting) return; counting = true;
    const tab = window.open('', '_blank', 'noopener');
    const ov = document.createElement('div'); ov.className = 'overlay'; ov.setAttribute('role', 'status'); ov.setAttribute('aria-live', 'assertive');
    ov.innerHTML = `<div class="modal" style="text-align:center;gap:.4rem;max-width:300px"><p class="note" style="margin:0;letter-spacing:.1em;text-transform:uppercase">Launching lab</p>
      <div id="m1Count" style="font:700 4.5rem/1 var(--f-mono,monospace);color:var(--amber);background:var(--grad);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent">5</div>
      <p class="note" id="m1CountMsg" style="margin:0">Preparing your container…</p></div>`;
    document.body.appendChild(ov);
    const started = startSession(redraw);  // provisions the container while the countdown runs
    for (let n = 5; n >= 1; n--) { const el = $('#m1Count', ov); if (el) el.textContent = n; await sleep(1000); }
    const msg = $('#m1CountMsg', ov); if (msg) msg.textContent = 'Almost ready…';
    const ok = await started;
    ov.remove(); counting = false;
    if (ok && st.sess && st.sess.url) { if (tab && !tab.closed) tab.location = st.sess.url; else window.open(st.sess.url, '_blank', 'noopener'); }
    else if (tab && !tab.closed) tab.close();
  }
  async function startSession(redraw) {
    if (st.busy) return false; st.busy = true; redraw && redraw(); let ok = false;
    try { st.sess = await post(BASE+'/session/start'); ok = true; }
    catch (e) { toast(failMsg(e)); }
    st.busy = false; redraw && redraw(); return ok;
  }
  async function stopSession(redraw) {
    if (st.busy || !st.sess) return; st.busy = true; redraw && redraw();
    try { st.sess = await post(BASE+'/session/stop', { session_id: st.sess.session_id }); toast('Lab session stopped.'); }
    catch (e) { toast(failMsg(e)); }
    st.busy = false; redraw && redraw();
  }
  /* ---- practical mission page (lab target + submission form) ---- */
  function drawPractical() {
    const p = st.prog || { xp: 0 }, s = st.sess, active = live();
    const state = st.busy ? 'Working…' : active ? 'Lab ready' : !s || s.status === 'none' ? 'Not started' : { stopped: 'Stopped', expired: 'Session expired', failed: 'Failed to start', starting: 'Starting…' }[s.status] || s.status;
    $('#view').innerHTML = `<div class="row" style="flex-wrap:wrap;margin-bottom:.4rem"><div><a class="note" href="#/academy/missions">← Missions</a><h1>${TITLE}</h1><p class="note">${ID} · ${LEVEL} · ${MINS} min · Hands-on</p></div><div style="display:grid;gap:.3rem;justify-items:end">${status()}<span class="mono" style="color:var(--amber)">${p.xp}/${MAX} XP</span></div></div>
      <div class="bar" aria-label="Mission XP"><i style="width:${pct(p.xp)}%"></i></div>
      <div class="row note" style="margin:.5rem 0;flex-wrap:wrap" aria-label="Mission steps"><span>${active || p.completed || p.attempts ? '✅' : '⬜'} Start lab</span><span>${p.attempts || p.completed ? '✅' : '⬜'} Submit answer</span><span>${p.completed ? '✅' : '⬜'} Solved</span></div>
      ${st.offline ? '<div class="card" role="alert"><b>Mission service offline.</b> <span class="note">Starting the lab and submitting need the server.</span> <button class="btn btn-sm" id="m1Retry">Retry</button></div>' : ''}
      <section class="card" style="display:grid;gap:.8rem;margin-top:.8rem"><div class="row"><h2>Target lab</h2><span class="chip ${active ? 'g' : ''}" role="status">${state}</span></div>
        ${s && s.status === 'expired' ? '<p class="note" role="alert">Your lab session expired. Start a new one: your progress and earned XP are kept.</p>' : ''}
        ${typeof CFG.INSTR === 'function' ? CFG.INSTR(st.mission || {}, st.sess) : CFG.INSTR}
        ${active ? `<div class="item" style="display:grid;gap:.2rem"><b>Your target</b><code>${esc(s.url)}</code><span class="note">Only this URL is in scope.</span></div>` : ''}
        <div class="row">${active ? `<a class="btn btn-primary" href="${esc(s.url)}" id="m3Open" target="_blank" rel="noopener">Open target</a><button class="btn btn-amber" id="m3Stop" ${st.busy ? 'disabled' : ''}>■ Stop lab</button>` : `<button class="btn btn-primary" id="m3Start" ${st.busy ? 'disabled' : ''}>${st.busy ? 'Starting…' : '▶ Start lab'}</button>`}</div></section>
      <section class="card" style="display:grid;gap:.6rem;margin-top:.8rem"><h2>${CFG.FORM.title}</h2>
        ${p.completed ? '<div class="item"><span>✅ Mission completed</span><span class="chip g">XP already awarded</span></div>' : ''}
        <form id="m3Form" style="display:grid;gap:.5rem" aria-label="${CFG.FORM.button}">
          <label for="m3Ans"><b>${CFG.FORM.label}</b> <span class="note">${CFG.FORM.note}</span></label>
          ${CFG.FORM.hint ? `<p class="note" style="margin:0">💡 <b>Hint:</b> ${CFG.FORM.hint}</p>` : ''}
          <div class="row"><input id="m3Ans" autocomplete="off" spellcheck="false" maxlength="200" placeholder="${CFG.FORM.placeholder}" value="${esc(st.answerText || '')}" style="flex:1;min-width:0"><button class="btn btn-primary" type="submit" ${st.busy || !active ? 'disabled' : ''}>${st.busy ? 'Checking…' : CFG.FORM.button}</button></div>
          ${!active ? '<span class="note">Start the lab to submit.</span>' : ''}
          <div id="m3Result" role="status" class="note">${st.feedback ? st.feedback : ''}</div></form></section>`;
    const rb = $('#m1Retry'); if (rb) rb.onclick = view;
    const a = $('#m3Start'), b = $('#m3Stop'), o = $('#m3Open'), f = $('#m3Form'), inp = $('#m3Ans');
    if (a) a.onclick = () => launchWithCountdown(drawPractical);
    if (b) b.onclick = () => stopSession(drawPractical);
    if (inp) inp.oninput = () => { st.answerText = inp.value; };
    f.onsubmit = async e => {
      e.preventDefault(); const answer = inp.value.trim(); if (!answer || st.busy || !live()) return;
      st.answerText = answer; st.busy = true; st.feedback = ''; drawPractical();
      try {
        const r = await post(BASE+'/submit', { session_id: st.sess.session_id, answer }); sync(r.progress);
        st.feedback = r.accepted ? (r.awarded ? `✅ ${esc(r.message)} Mission completed: +${r.awarded} XP.` : `✅ ${esc(r.message)} You already completed this mission, so no extra XP.`) : `❌ ${esc(r.message)} ${CFG.RETRY}`;
        if (r.accepted) st.answerText = '';
      } catch (x) {
        st.feedback = `⚠️ ${esc(failMsg(x))} Your answer is kept, you can retry.`;
        if (x && x.status === 410) { try { st.sess = await http(BASE+'/session/current'); } catch (_) {} }
      }
      st.busy = false; drawPractical();
    };
  }
  /* Coming back from the target (Back button, other tab, bfcache): re-read the session so the page never shows a stale lab state */
  if (PRACTICAL) {
    const refresh = async () => {
      if (location.hash !== '#/academy/mission/' + SLUG || st.busy) return;
      try {
        const cur = await http(BASE+'/session/current'), old = st.sess || {};
        if (cur.status !== old.status || cur.session_id !== old.session_id) { st.sess = cur; st.prog = (await http(BASE+'/progress')); drawPractical(); }
      } catch (_) { /* offline: keep what is shown */ }
    };
    addEventListener('pageshow', e => { if (e.persisted) refresh(); });
    addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  }
  /* ---- mission page ---- */
  async function view() {
    $('#view').innerHTML = '<p class="note" role="status">Loading mission…</p>';
    await load(); render();
  }
  function render() {
    if (PRACTICAL) return drawPractical();
    const p = st.prog || { xp: 0 }, tabs = [['lesson', 'Lesson'], ['quiz', 'Quiz']];
    $('#view').innerHTML = `<div class="row" style="flex-wrap:wrap;margin-bottom:.4rem"><div><a class="note" href="#/academy/missions">← Missions</a><h1>${TITLE}</h1><p class="note">${ID} · ${LEVEL} · ${MINS} min</p></div><div style="display:grid;gap:.3rem;justify-items:end">${status()}<span class="mono" style="color:var(--amber)">${p.xp}/${MAX} XP</span></div></div>
      <div class="bar" aria-label="Mission XP"><i style="width:${pct(p.xp)}%"></i></div>
      <div class="row note" style="margin:.5rem 0;flex-wrap:wrap" aria-label="Mission steps"><span>${p.lesson_completed ? '✅' : '⬜'} Lesson</span><span>${p.quiz_scored ? '✅' : '⬜'} Quiz</span></div>
      ${st.offline ? '<div class="card" role="alert"><b>Mission service offline.</b> <span class="note">You can read the lesson, but completing it and taking the quiz need the server.</span> <button class="btn btn-sm" id="m1Retry">Retry</button></div>' : ''}
      <div class="filters" role="tablist" aria-label="Mission sections" style="margin:.8rem 0">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${k === st.tab}" aria-pressed="${k === st.tab}" data-m1t="${k}">${l}</button>`).join('')}</div><div id="m1Body"></div>`;
    $$('[data-m1t]').forEach(b => b.onclick = () => { st.tab = b.dataset.m1t; render(); });
    const rb = $('#m1Retry'); if (rb) rb.onclick = view;
    ({ lesson: drawLesson, quiz: drawQuiz }[st.tab])();
  }
  function drawLesson() {
    const p = st.prog || {}, i = st.sec, [t, body] = LESSON[i], last = i === LESSON.length - 1;
    $('#m1Body').innerHTML = `<section class="card" style="display:grid;gap:.8rem"><div class="row"><span class="chip">Section ${i + 1} of ${LESSON.length}</span>${p.lesson_completed ? '<span class="chip g">Lesson completed</span>' : ''}</div>
      <div class="filters" role="group" aria-label="Lesson sections">${LESSON.map((s, k) => `<button data-sec="${k}" aria-pressed="${k === i}" aria-label="Section ${k + 1}: ${s[0]}">${k + 1}</button>`).join('')}</div>
      <h2>${t}</h2>${body}
      <div class="row"><button class="btn" id="m1Prev" ${i ? '' : 'disabled'}>← Back</button>
      ${last ? `<button class="btn btn-primary" id="m1Done" ${st.busy || p.lesson_completed ? 'disabled' : ''}>${p.lesson_completed ? 'Lesson completed · XP already awarded' : `Mark Lesson Completed (+${LESSON_XP} XP)`}</button>` : '<button class="btn btn-primary" id="m1Next">Next →</button>'}</div></section>`;
    $$('[data-sec]').forEach(b => b.onclick = () => { st.sec = +b.dataset.sec; drawLesson(); });
    const pv = $('#m1Prev'), nx = $('#m1Next'), dn = $('#m1Done');
    if (pv) pv.onclick = () => { st.sec--; drawLesson(); }; if (nx) nx.onclick = () => { st.sec++; drawLesson(); };
    if (dn) dn.onclick = async () => {
      if (st.busy) return; st.busy = true; drawLesson();
      try { const r = await post(BASE+'/lesson/complete'); sync(r.progress); toast(r.awarded ? `Lesson completed: +${r.awarded} XP` : 'Lesson already completed. No extra XP.'); st.offline = false; }
      catch (e) { toast(failMsg(e)); }
      st.busy = false; render();
    };
  }
  function drawQuiz() {
    const m = st.mission, p = st.prog || {};
    if (!m) { $('#m1Body').innerHTML = '<section class="card"><p class="note">The quiz needs the mission service. Retry once it is back.</p></section>'; return; }
    if (st.result) return drawResult();
    const q = m.questions[st.qi], n = m.questions.length, answered = st.answers.filter(a => a !== null).length;
    $('#m1Body').innerHTML = `<section class="card" style="display:grid;gap:.8rem"><div class="row"><span class="chip">Question ${st.qi + 1} of ${n}</span><span class="note">${answered}/${n} answered</span></div>
      ${p.quiz_scored ? '<p class="note">Your scored attempt is done. Retries are practice and award no XP.</p>' : ''}
      <fieldset style="border:0;padding:0;margin:0;display:grid;gap:.5rem"><legend><h2 style="font-size:1.05rem">${esc(q.q)}</h2></legend>
      ${q.options.map((o, k) => `<label class="item" style="cursor:pointer;${st.answers[st.qi] === k ? 'border-color:var(--quantum)' : ''}"><span><input type="radio" name="m1q" value="${k}" ${st.answers[st.qi] === k ? 'checked' : ''}> ${esc(o)}</span></label>`).join('')}</fieldset>
      <div class="row"><button class="btn" id="m1QP" ${st.qi ? '' : 'disabled'}>← Previous</button>
      ${st.qi < n - 1 ? '<button class="btn btn-primary" id="m1QN">Next →</button>' : `<button class="btn btn-primary" id="m1Sub" ${answered < n || st.busy ? 'disabled' : ''}>Submit quiz</button>`}</div></section>`;
    $$('[name=m1q]').forEach(r => r.onchange = () => { st.answers[st.qi] = +r.value; drawQuiz(); const f = $('[name=m1q]:checked'); f && f.focus(); });
    const a = $('#m1QP'), b = $('#m1QN'), s = $('#m1Sub');
    if (a) a.onclick = () => { st.qi--; drawQuiz(); }; if (b) b.onclick = () => { st.qi++; drawQuiz(); };
    if (s) s.onclick = async () => {
      st.busy = true; drawQuiz();
      try { st.result = await post(BASE+'/quiz/submit', { answers: st.answers }); sync(st.result.progress); st.offline = false; }
      catch (e) { toast(failMsg(e) + ' Your answers are kept. Try again.'); }  // answers stay in st.answers
      st.busy = false; render();
    };
  }
  function drawResult() {
    const r = st.result, p = r.progress;
    $('#m1Body').innerHTML = `<section class="card" style="display:grid;gap:.8rem" role="status"><h2>Score: ${r.score}/${r.total}</h2>
      <p>${r.scored_attempt ? `Quiz XP earned: <b class="mono" style="color:var(--amber)">+${r.awarded} XP</b>` : 'Practice attempt. No XP awarded; your XP was already paid on the first scored attempt.'}</p>
      <p>Mission XP: <b class="mono" style="color:var(--amber)">${p.xp}/${MAX}</b> ${p.completed ? '<span class="chip g">Mission completed</span>' : `<span class="chip b">Still to do: ${todo(p)}</span>`}</p>
      <div class="list">${r.review.map(v => `<div class="item" style="display:grid;gap:.15rem"><span>${v.correct ? '✅' : '❌'} <b>${esc(st.mission.questions[v.id].q)}</b></span>
        <span class="note">Your answer: ${esc(st.mission.questions[v.id].options[v.your_answer])}${v.correct ? '' : ' · Correct: ' + esc(st.mission.questions[v.id].options[v.correct_answer])}</span><span class="note">${esc(v.why)}</span></div>`).join('')}</div>
      <div class="row"><button class="btn btn-primary" id="m1Retry2">Practice again</button><a class="btn" href="#/academy/missions">Back to missions</a></div></section>`;
    $('#m1Retry2').onclick = () => { st.result = null; st.answers = Array(st.mission.questions.length).fill(null); st.qi = 0; render(); };
  }
  return { card, view, LESSON };
}

/* ---- Mission 3 · Web Technology Fingerprinting (practical: lab target + backend-checked answer; the answer is never in this file) ---- */
window.M3 = makeMission({ KIND: 'practical', START_OPENS_PAGE: true, ID: 'WEB-01', BASE: '/api/m3', XPK: 'm3xp', MAX: 50, SLUG: 'fingerprint', CARD: 'm3', TITLE: 'Web Technology Fingerprinting',
  DESC: 'Identify the technologies powering a web application using Wappalyzer and submit them for validation.', LEVEL: 'Beginner', MINS: '15-25',
  KEYWORDS: 'web technology fingerprinting wappalyzer recon',
  INFO_DESC: 'Identify the technologies powering a web application using Wappalyzer and submit the detected technologies for validation.',
  OBJECTIVES: 'use a browser extension to fingerprint a website · tell servers, languages and frameworks apart · report only what you actually observed.',
  INFO_TODO: 'press Start to open your lab target, inspect it with Wappalyzer, come back here and submit the technologies you found. The server checks your answer.',
  RETRY: 'Check Wappalyzer again and retry.',
  FORM: { title: 'Submit solution', label: 'Detected Technologies', note: 'Enter the technologies Wappalyzer detected for the web server and application, separated by commas.', hint: 'there are 3 technologies. Enter them in alphabetical order (A to Z).', placeholder: 'e.g. Alpha, Bravo, Charlie', button: 'Submit Solution' },
  INSTR: `<ol style="display:grid;gap:.35rem;padding-left:1.2rem"><li>Press <b>Start lab</b>. You are sent to your own target website.</li>
          <li>Install the <b>Wappalyzer</b> browser extension (Chrome, Edge or Firefox store) and pin it to the toolbar. If it is installed but quiet, allow it on this site in the extension's permissions.</li>
          <li>With the target open, click the Wappalyzer icon and read the technologies it lists.</li>
          <li>Come back to this page with your browser's Back button, or close the target tab if you opened it from here. Your lab keeps running.</li>
          <li>Enter the technologies you found and press <b>Submit Solution</b>.</li></ol>
        <p class="note"><b>Alternative if you cannot install Wappalyzer:</b> run <code>curl -I</code> on the target URL below and read the response headers, and view the page source. Same target, same answer.</p>` });

/* ---- Mission 4 · Information Gathering (practical: find the flag in the target's page source; the flag is made per session on the server) ---- */
window.M4 = makeMission({ KIND: 'practical', START_OPENS_PAGE: true, ID: 'INFO-01', BASE: '/api/m4', XPK: 'm4xp', MAX: 50, SLUG: 'information', CARD: 'm4', TITLE: 'Information Gathering',
  DESC: 'Find information a website exposes by accident in its own source code, and submit the flag you discover.', LEVEL: 'Beginner', MINS: '20-30',
  KEYWORDS: 'information gathering source code disclosure flag web',
  INFO_DESC: 'Learn how information can be exposed unintentionally through client-side source code. Inspect your target website, find the hidden flag and submit it for validation.',
  OBJECTIVES: 'view a page\'s HTML source in the browser · read comments and other client-side details · explain why leftover developer notes are a risk.',
  INFO_TODO: 'press Start to open your target website, inspect its source, find the flag, come back here and submit it. Flag format: YOJO_information_disclose_&lt;number&gt;.',
  RETRY: 'Look at the page source again and retry.',
  FORM: { title: 'Submit flag', label: 'Flag', note: 'Paste the flag exactly as you found it. Format: YOJO_information_disclose_&lt;number&gt;', hint: '', placeholder: 'YOJO_information_disclose_000000', button: 'Submit Flag' },
  INSTR: `<ol style="display:grid;gap:.35rem;padding-left:1.2rem"><li>Press <b>Start lab</b>. You are sent to your own target website.</li>
          <li>Explore the site like any visitor: the pages, the menu, the footer.</li>
          <li>Open the page's source: right-click and choose <b>View Page Source</b>, or press <code>Ctrl+U</code> (<code>Cmd+Option+U</code> on Mac). Developer tools (<code>F12</code>) also work.</li>
          <li>Read through the HTML, including comments, and look for an internal reference that matches the flag format.</li>
          <li>Come back to this page with your browser's Back button and submit the flag.</li></ol>` });

/* ---- Mission 5 · Domain Expiration Intelligence (practical: investigate a domain with WHOIS/RDAP; the verified date is server-side only) ---- */
window.M5 = makeMission({ KIND: 'practical', START_OPENS_PAGE: true, ID: 'DOM-01', BASE: '/api/m5', XPK: 'm5xp', MAX: 50, SLUG: 'domain', CARD: 'm5', TITLE: 'Domain Expiration Intelligence',
  DESC: 'Use WHOIS or RDAP to find when a company domain registration expires, and learn why that matters.', LEVEL: 'Beginner', MINS: '20-30',
  KEYWORDS: 'domain expiration intelligence whois rdap osint',
  INFO_DESC: 'Understand domain registration expiration dates, how to find them with WHOIS or RDAP, and why renewing a domain matters for security.',
  OBJECTIVES: 'look up a domain in WHOIS or RDAP · find the expiration date in the record · explain what can go wrong when a domain expires.',
  INFO_TODO: 'press Start, then Start lab to open your briefing page, look up the target domain with a WHOIS or RDAP service, come back here and submit the expiration date.',
  RETRY: 'Try again.',
  FORM: { title: 'Submit answer', label: 'Domain expiration date', note: 'Format YYYY-MM-DD works best (for example 2030-01-31). Other clear formats such as 31-01-2030 are accepted.', hint: '', placeholder: 'YYYY-MM-DD', button: 'Submit Answer' },
  INSTR: `<div class="item" style="display:grid;gap:.2rem"><b>Scenario: Domain Expiration Investigation</b><span>You are performing a domain intelligence assessment for <b>YOJO Solutions</b>. Find when the company's domain registration expires and submit that date.</span><span>Target domain: <code>yojosolutions.com</code> &nbsp;·&nbsp; Official website: <code>https://www.yojosolutions.com/</code></span></div>
        <p class="note">If a lookup service is down, try another one from the briefing page, or run <code>whois yojosolutions.com</code> in a terminal. This is a read-only investigation: never try to renew, transfer or change a domain.</p>` });

/* ---- Mission 6 · Subdomain Enumeration (practical: run Subfinder in the lab terminal against a controlled dataset; the count is checked server-side) ---- */
window.M6 = makeMission({ KIND: 'practical', START_OPENS_PAGE: true, ID: 'SUB-01', BASE: '/api/m6', XPK: 'm6xp', MAX: 50, SLUG: 'subdomains', CARD: 'm6', TITLE: 'Subdomain Enumeration',
  DESC: 'Use Subfinder to discover the subdomains of an authorized target and count the unique results.', LEVEL: 'Beginner', MINS: '20-30',
  KEYWORDS: 'subdomain enumeration subfinder recon osint',
  INFO_DESC: 'Learn how subdomain enumeration works with Subfinder-style passive discovery and why it matters during authorized reconnaissance. The lab uses a controlled training dataset, run from your own terminal, so everyone reaches the same, verifiable result.',
  OBJECTIVES: 'run subdomain enumeration against an authorized target from your own terminal · read and count unique results · explain why enumerating subdomains matters in recon.',
  INFO_TODO: 'press Start, then Start lab to open the target company website, run the lab helper in your own terminal against the target, count the unique subdomains, come back here (the Submit Solution button on the site brings you back) and submit the number.',
  RETRY: 'Try again.',
  FORM: { title: 'Submit answer', label: 'Number of unique subdomains', note: 'Enter a whole number.', hint: '', placeholder: 'e.g. 7', button: 'Submit Answer' },
  INSTR: (m, s) => { const d = esc(m.target_domain || '<target>'), u = s && s.status === 'active' ? esc(s.url.replace(/\/$/, '')) : '&lt;your lab URL&gt;';
    return `<div class="item" style="display:grid;gap:.2rem"><b>Scenario: Subdomain Enumeration Assessment</b><span>You are performing an authorized reconnaissance exercise for YOJO Solutions. Discover the subdomains of the assigned target with Subfinder, count the unique subdomains and submit the total.</span><span>Target domain: <code>${d}</code></span><span class="note">This is a controlled simulation: you run the lab's helper in your own terminal and it answers from a fixed training dataset, not live public sources.</span></div>
        <ol style="display:grid;gap:.35rem;padding-left:1.2rem"><li>Press <b>Start lab</b> to open the target company website.</li>
          <li>In your own terminal, fetch the helper: <code>curl -fsS ${u}/tools/subfinder.sh -o subfinder-lab.sh</code> (a short script you can read first; it makes one request to your lab).</li>
          <li>Run the enumeration: <code>sh subfinder-lab.sh -d ${d} -silent</code></li>
          <li>Count each subdomain once. Handy: <code>sh subfinder-lab.sh -d ${d} -silent | sort -u | wc -l</code></li>
          <li>Enter the number below, or press <b>Submit Solution</b> on the target website to come back here.</li></ol>
        <p class="note">If the lab or helper is unavailable, stop the lab and start it again. The helper only works for the target above.</p>`; } });

/* ---- Mission 7 · Endpoint Discovery (practical: real Katana from the student's terminal against their own lab site; count checked server-side) ---- */
window.M7 = makeMission({ KIND: 'practical', START_OPENS_PAGE: true, ID: 'END-01', BASE: '/api/m7', XPK: 'm7xp', MAX: 50, SLUG: 'endpoints', CARD: 'm7', TITLE: 'Endpoint Discovery',
  DESC: 'Crawl a training website with Katana and count the unique endpoints it discovers.', LEVEL: 'Beginner', MINS: '20-30',
  KEYWORDS: 'endpoint discovery katana crawler web recon',
  INFO_DESC: 'Learn how to discover website endpoints with Katana and how endpoint discovery builds an inventory of a web application attack surface.',
  OBJECTIVES: 'run a web crawler against an authorized target · read and de-duplicate its output · explain why an endpoint inventory matters.',
  INFO_TODO: 'press Start, then Start lab to open your training website, run Katana against your lab URL from your own terminal, count the unique endpoints and submit the number.',
  RETRY: 'Try again.',
  FORM: { title: 'Submit answer', label: 'Number of unique endpoints', note: 'Count every unique URL Katana prints, including the homepage.', hint: '', placeholder: 'e.g. 5', button: 'Submit Answer' },
  INSTR: (m, s) => { const u = s && s.status === 'active' ? esc(s.url) : '&lt;your lab URL&gt;';
    return `<div class="item" style="display:grid;gap:.2rem"><b>Scenario: Web Endpoint Discovery Assessment</b><span>You are performing an authorized web reconnaissance assessment. Explore your assigned training website with Katana, identify the endpoints the crawler discovers and submit the total number of unique endpoints.</span><span>Target URL: <code>${u}</code></span></div>
        <ol style="display:grid;gap:.35rem;padding-left:1.2rem"><li>Press <b>Start lab</b>. Your training website gets its own address (shown above once it is running).</li>
          <li>In your own terminal (for example Kali) run: <code>katana -u ${u} -silent</code></li>
          <li>Count each unique URL once, <b>including the homepage</b>: <code>katana -u ${u} -silent | sort -u | wc -l</code></li>
          <li>Enter the number below and press <b>Submit Answer</b>.</li></ol>
        <p class="note">Katana is a web crawler: it follows the links on pages it can reach. Only crawl this lab URL. If Katana cannot connect, stop the lab and start it again, and check you used the current URL.</p>`; } });

/* ---- Mission 8 · Hidden Directory Discovery (practical: directory enumeration finds /s3r3ct; per-session flag checked server-side) ---- */
window.M8 = makeMission({ KIND: 'practical', START_OPENS_PAGE: true, ID: 'DIR-01', BASE: '/api/m8', XPK: 'm8xp', MAX: 50, SLUG: 'directory', CARD: 'm8', TITLE: 'Hidden Directory Discovery',
  DESC: 'Find a web directory that is not linked anywhere, using directory enumeration, and submit the flag inside it.', LEVEL: 'Beginner', MINS: '20-30',
  KEYWORDS: 'hidden directory discovery brute force gobuster feroxbuster enumeration web',
  INFO_DESC: 'Learn how directory brute-forcing finds unlinked web paths, and why exposed directories should be reviewed during an authorized assessment.',
  OBJECTIVES: 'run a directory enumeration tool against an authorized target · read HTTP status codes · explain why unlinked directories are a risk.',
  INFO_TODO: 'press Start, then Start lab to open your target website, enumerate its directories from your own terminal, open the hidden directory, read the flag and submit it here.',
  RETRY: 'Open the hidden directory again and check the flag.',
  FORM: { title: 'Submit flag', label: 'Flag', note: 'Paste the flag from the hidden directory. Format: YOJO_directory_bruteforcing_&lt;number&gt;', hint: '', placeholder: 'YOJO_directory_bruteforcing_000000', button: 'Submit Flag' },
  INSTR: (m, s) => { const u = s && s.status === 'active' ? esc(s.url) : '&lt;your lab URL&gt;';
    return `<div class="item" style="display:grid;gap:.2rem"><b>Hint:</b> <span>Find the hidden directory…</span><span>Target URL: <code>${u}</code></span></div>
        <ol style="display:grid;gap:.35rem;padding-left:1.2rem"><li>Press <b>Start lab</b>. Your target website opens; it looks ordinary, with no link to the hidden directory.</li>
          <li>In your own terminal, run a directory enumeration tool against your lab URL. A wordlist is served at <code>${u}tools/wordlist.txt</code>. For example, with gobuster:<br><code>gobuster dir -u ${u} -w wordlist.txt</code></li>
          <li>Look for a path that returns HTTP <b>200</b> or <b>301/302</b> while most return 404. Open it in your browser.</li>
          <li>Read the flag inside that directory (try its <code>flag.txt</code>), then paste it below and press <b>Submit Flag</b>.</li></ol>
        <p class="note">Only enumerate this lab URL. If the tool cannot connect, stop the lab and start it again, and check you used the current URL.</p>`; } });

/* ---- Mission 9 · Image Metadata Analysis (practical: ExifTool on product images; per-session flag in one image's metadata) ---- */
window.M9 = makeMission({ KIND: 'practical', START_OPENS_PAGE: true, ID: 'IMG-01', BASE: '/api/m9', XPK: 'm9xp', MAX: 50, SLUG: 'metadata', CARD: 'm9', TITLE: 'Image Metadata Analysis',
  DESC: 'Inspect product images with ExifTool and find the flag hidden in an image\'s metadata.', LEVEL: 'Beginner', MINS: '20-30',
  KEYWORDS: 'image metadata analysis exif exiftool osint forensics',
  INFO_DESC: 'Learn how image files can carry metadata beyond what you see, and how to read it with ExifTool to find information that was not meant to be shared.',
  OBJECTIVES: 'read EXIF and other image metadata · tell visible content from embedded metadata · explain why metadata can leak sensitive information.',
  INFO_TODO: 'press Start, then Start lab to open the shopping site, download the product images, inspect their metadata with ExifTool from your own terminal, find the flag and submit it here.',
  RETRY: 'Check the image metadata again.',
  FORM: { title: 'Submit flag', label: 'Flag', note: 'Paste the flag you found in an image\'s metadata. Format: YOJO_image_metadata_&lt;number&gt;', hint: '', placeholder: 'YOJO_image_metadata_000000', button: 'Submit Flag' },
  INSTR: (m, s) => { const u = s && s.status === 'active' ? esc(s.url) : '&lt;your lab URL&gt;';
    return `<div class="item" style="display:grid;gap:.2rem"><b>Image metadata</b><span>Image files can carry hidden metadata (EXIF) such as a camera model, GPS location, or a text comment, separate from what the picture shows. One product image on this store hides a flag in its metadata.</span><span>Target URL: <code>${u}</code></span></div>
        <ol style="display:grid;gap:.35rem;padding-left:1.2rem"><li>Press <b>Start lab</b>. Your YOJO Shopping store opens with several product images.</li>
          <li>Download the images to a folder, for example:<br><code>for i in $(seq -w 1 10); do wget -q ${u}images/product-$i.jpg; done</code></li>
          <li>Inspect their metadata with <b>ExifTool</b> (pre-installed on Kali):<br><code>exiftool -Comment -ImageDescription *.jpg</code></li>
          <li>One image's <code>Comment</code> field holds the flag. Paste it below and press <b>Submit Flag</b>.</li></ol>
        <p class="note">Only inspect images from this lab URL. If an image will not download, stop the lab and start it again, and check you used the current URL.</p>`; } });

/* academy.html boots before this file loads: redraw if the first route needed Mission 1 */

window.M1 = makeMission({ ID: 'INT-01', BASE: '/api/m1', XPK: 'm1xp', MAX: 100, SLUG: 'intro', CARD: 'm1', TITLE: 'Introduction to Cybersecurity',
  DESC: 'Learn the CIA triad, common threats, security domains, essential tools and career paths.', LEVEL: 'Beginner', MINS: '20-30', LESSON_XP: 20, PER_Q: 10, QN: 8,
  KEYWORDS: 'introduction to cybersecurity cia triad threats tools careers',
  INFO_DESC: 'Learn the fundamentals of cybersecurity, the CIA triad, common cyber threats, security domains, essential tools, and career paths.',
  OBJECTIVES: 'explain the CIA triad · tell threats from vulnerabilities and risks · recognise common attacks · compare security domains · name key tools and roles.',
  LESSON: (() => {
    return [
    ['Introduction to Cybersecurity', `<p><b>Cybersecurity</b> is the practice of protecting systems, networks and data from harm. It matters because almost everything we do, from banking to messaging, runs on computers.</p>
      <div class="list"><div class="item"><span><b>Assets</b> · data, devices, accounts, networks, people's trust</span></div><div class="item"><span><b>Threat</b> · something that could cause harm (a criminal, malware)</span></div><div class="item"><span><b>Vulnerability</b> · a weakness (an unpatched app, a weak password)</span></div><div class="item"><span><b>Risk</b> · the chance a threat uses a vulnerability, times the damage</span></div><div class="item"><span><b>Attack</b> · a deliberate attempt to exploit a weakness</span></div></div>
      <p><b>Everyday examples:</b> a phone lock screen, two-step login on email, software updates, a padlock in your browser.</p><p>Organizations hold customer data and run services people depend on, so they need professionals who prevent, detect and respond to attacks.</p>`],
    ['CIA Triad', `<p>Three goals guide almost every security decision.</p><div class="list">
      <div class="item"><span><b>Confidentiality</b> · only authorized people can see information. <i>Example: only HR can open salary files.</i></span></div>
      <div class="item"><span><b>Integrity</b> · information stays accurate and is not changed without permission. <i>Example: nobody can edit the amount of a bank transaction.</i></span></div>
      <div class="item"><span><b>Availability</b> · systems and data work when needed. <i>Example: a company website stays up for real customers.</i></span></div></div>
      <p><b>Quick difference:</b> Confidentiality = who can look. Integrity = is it correct. Availability = can I use it.</p>`],
    ['Common Threats', `<div class="list">${[
      ['Phishing', 'Fake messages that trick you into giving data or clicking.', 'A fake bank email asking you to log in.', 'Check the sender and link; use MFA.'],
      ['Malware', 'Software built to harm or spy.', 'A cracked app that installs a keylogger.', 'Install software only from trusted sources; keep antivirus on.'],
      ['Ransomware', 'Malware that locks files and demands payment.', 'A hospital losing access to records.', 'Keep offline backups and patch systems.'],
      ['Password attacks', 'Guessing or stealing passwords.', 'Trying common passwords on many accounts.', 'Long unique passwords and MFA.'],
      ['Social engineering', 'Manipulating people instead of machines.', 'A caller pretending to be IT support.', 'Verify identity through a second channel.'],
      ['SQL injection', 'Sending database commands through input fields.', 'Typing a quote and extra SQL into a login box.', 'Use parameterized queries.'],
      ['Cross-site scripting (XSS)', 'Injecting scripts into pages other users view.', 'A comment containing a script that runs in readers\' browsers.', 'Encode output and validate input.'],
      ['Denial-of-service', 'Overwhelming a service so real users cannot use it.', 'Huge fake traffic taking a shop offline.', 'Rate limiting and traffic filtering.'],
      ['Data breach', 'Unauthorized exposure of stored data.', 'A leaked customer database.', 'Encrypt data and limit access.'],
      ['Insider threat', 'Harm from someone with legitimate access.', 'An employee copying files before leaving.', 'Least privilege and activity monitoring.']
    ].map(([n, w, e, p]) => `<div class="item" style="display:grid;gap:.15rem"><b>${n}</b><span>${w}</span><span class="note">Example: ${e}</span><span class="note">Prevention: ${p}</span></div>`).join('')}</div>`],
    ['Cybersecurity Domains', `<div class="list">
      <div class="item" style="display:grid;gap:.15rem"><b>Offensive Security</b><span>Authorized penetration testing, vulnerability assessment, ethical hacking and security testing. The goal is to find weaknesses before criminals do.</span></div>
      <div class="item" style="display:grid;gap:.15rem"><b>Defensive Security</b><span>Security monitoring in a Security Operations Center (SOC), incident detection and response, threat hunting and log analysis.</span></div>
      <div class="item" style="display:grid;gap:.15rem"><b>Governance, Risk and Compliance (GRC)</b><span>Security policies, risk assessment and management, compliance requirements and audits.</span></div></div>
      <p><b>Together:</b> GRC sets the rules and priorities, offensive teams test whether they hold, and defensive teams watch and respond every day.</p>`],
    ['Common Tools', `<p class="note">You do not need to install these for this mission. Just know what they are for.</p><div class="list">${[
      ['Nmap', 'Network discovery and port scanning.', 'Penetration testers, network admins'],
      ['Burp Suite', 'Testing web applications by inspecting and modifying requests.', 'Web penetration testers'],
      ['Wireshark', 'Capturing and analyzing network traffic.', 'SOC analysts, incident responders'],
      ['Metasploit Framework', 'Authorized security testing of known weaknesses.', 'Penetration testers'],
      ['Nessus', 'Scanning systems for known vulnerabilities.', 'Security engineers, consultants'],
      ['Splunk', 'Collecting and searching security logs for monitoring.', 'SOC analysts, threat hunters'],
      ['Kali Linux', 'A Linux distribution packed with security-testing tools.', 'Penetration testers, students']
    ].map(([n, w, r]) => `<div class="item" style="display:grid;gap:.15rem"><b>${n}</b><span>${w}</span><span class="note">Used by: ${r}</span></div>`).join('')}</div>`],
    ['Career Paths', `<div class="list">${[
      ['Penetration Tester', 'Runs authorized attacks to find weaknesses.', 'Networking, web security, Nmap, Burp Suite'],
      ['SOC Analyst', 'Watches alerts and logs and triages possible incidents.', 'Log analysis, SIEM, Splunk, Wireshark'],
      ['Incident Responder', 'Contains and investigates a breach, then helps recover.', 'Forensics basics, malware triage, communication'],
      ['Security Engineer', 'Builds and maintains security controls and tooling.', 'Linux, cloud, scripting, vulnerability scanning'],
      ['GRC Analyst', 'Manages policies, risk assessments and audits.', 'Risk frameworks, documentation, compliance'],
      ['Security Consultant', 'Advises organizations on improving their security.', 'Broad technical skills, reporting, client communication']
    ].map(([n, w, s]) => `<div class="item" style="display:grid;gap:.15rem"><b>${n}</b><span>${w}</span><span class="note">Skills: ${s}</span></div>`).join('')}</div>`]
  ];
  })() });

/* ---- Mission 2 · Reconnaissance Fundamentals ---- */
const REC_ROWS = (rows) => `<div class="list">${rows.map(([n, ...cols]) => `<div class="item" style="display:grid;gap:.15rem"><b>${n}</b>${cols.map(c => `<span>${c}</span>`).join('')}</div>`).join('')}</div>`;
window.M2 = makeMission({ ID: 'REC-01', BASE: '/api/m2', XPK: 'm2xp', MAX: 50, SLUG: 'recon', CARD: 'm2', TITLE: 'Reconnaissance Fundamentals',
  DESC: 'Learn how professionals gather information about an authorized target, passive vs active recon, common tools and scope.', LEVEL: 'Beginner', MINS: '20-30', LESSON_XP: 20, PER_Q: 5, QN: 6,
  KEYWORDS: 'reconnaissance fundamentals recon passive active nmap whois scope osint',
  INFO_DESC: 'Learn how security professionals gather information about an authorized target, distinguish passive and active reconnaissance, understand common tools, and follow defined testing scope.',
  OBJECTIVES: 'explain why reconnaissance comes first · separate passive from active methods · pick a suitable tool · stay inside written scope · document observations without overstating them.',
  LESSON: [
    ['What Is Reconnaissance?', `<p><b>Reconnaissance</b> (recon) means gathering information about a target before and during a security assessment. Testers do it first so they understand what an organization exposes publicly, its <b>attack surface</b>, and can plan safe, focused work.</p>
      <div class="list"><div class="item"><span><b>Collecting information</b> · learning what exists (domains, services, technologies)</span></div><div class="item"><span><b>Exploiting a vulnerability</b> · using a weakness to gain access or cause an effect. Recon does <i>not</i> include this.</span></div></div>
      <p><b>Where it fits:</b> in an authorized penetration test, recon comes right after agreeing scope and before vulnerability assessment and testing.</p>
      <p class="note"><b>Important:</b> finding a system during recon does not mean you may test it. Permission and scope decide what is allowed.</p>`],
    ['Passive Reconnaissance', `<p><b>Passive recon</b> collects information from public or otherwise authorized sources <i>without directly probing</i> the target's infrastructure.</p>
      ${REC_ROWS([['Public websites and documentation', 'Product pages, help docs and technology descriptions.'], ['Search engines', 'Indexed pages, documents and mentions of the organization.'], ['Public DNS and historical DNS', 'Records that show hostnames and mail or hosting providers, and how they changed.'], ['WHOIS or RDAP', 'Domain registration details, where available (often redacted for privacy).'], ['Certificate Transparency logs', 'Public records of TLS certificates that can reveal hostnames.'], ['Public code repositories', 'Open-source projects that may mention technologies or internal naming.'], ['Job postings and technology docs', 'Hints about which products and platforms a company uses.'], ['Archived pages (Wayback Machine)', 'Older versions of public pages.']])}
      <p><b>Benefits:</b> low impact, rarely noticed, good for planning. <b>Limits:</b> sources can be incomplete, outdated or wrong. <b>Privacy:</b> people's names and emails may appear in public data; collect only what the engagement needs.</p>`],
    ['Active Reconnaissance', `<p><b>Active recon</b> means interacting directly with a target system to learn about it. Beginner examples, always against an explicitly authorized target:</p>
      <div class="list"><div class="item"><span>Checking that an authorized host is reachable</span></div><div class="item"><span>A limited port scan of a permitted lab target</span></div><div class="item"><span>Identifying exposed services inside the approved scope</span></div><div class="item"><span>Reading a test web server's HTTP response headers</span></div></div>
      <p><b>Tools:</b> Nmap, curl, browser developer tools and WhatWeb (where appropriate).</p>
      <p class="note"><b>Care needed:</b> active checks can create logs, trigger alerts, load a service, or cross an authorization boundary if done carelessly. Only ever practise on systems you own or have explicit written permission to test.</p>`],
    ['Passive vs. Active', REC_ROWS([['Target contacted directly?', 'Passive: no. Active: yes.'], ['Typical sources', 'Passive: public records, search, archives. Active: the target\'s own hosts and services.'], ['Advantages', 'Passive: low impact, easy to start. Active: current, precise answers.'], ['Limitations', 'Passive: may be stale or incomplete. Active: can disturb services.'], ['Detection', 'Passive: usually not seen by the target. Active: may appear in logs and alerts.'], ['Common tools', 'Passive: search engines, RDAP, Wayback, CT search. Active: Nmap, curl, WhatWeb.'], ['Authorization', 'Passive still needs care with privacy and rules. Active needs explicit permission and defined scope.']]) + `<p class="note">Passive is not automatically risk-free, and active is not automatically malicious. What matters is the source, method, permission and scope.</p>`],
    ['Common Recon Tools', REC_ROWS([
      ['Nmap', 'Host discovery and port/service enumeration. Reveals open ports and service names. Beginner use: check which port a lab web server listens on. Limits: results can be filtered or inaccurate; scanning needs authorization.'],
      ['WHOIS / RDAP', 'Domain registration information. Reveals registrar and dates, sometimes contacts. Beginner use: see when a domain was registered. Limits: often redacted. Privacy: avoid collecting personal data you do not need.'],
      ['WhatWeb', 'Identifies web technologies. Reveals servers, frameworks and versions. Beginner use: fingerprint a lab site. Limits: guesses can be wrong; it contacts the target, so it is active.'],
      ['curl', 'Sends HTTP requests and shows responses. Reveals headers, redirects, status codes. Beginner use: <code>curl -I</code> on a lab server. Limits: sees only what the server returns; needs permission.'],
      ['Wayback Machine', 'Archived public pages. Reveals old content and paths. Beginner use: compare an old page with today\'s. Limits: archives are incomplete and may be outdated.'],
      ['Certificate Transparency search', 'Searches publicly logged TLS certificates. Reveals hostnames. Beginner use: list names that had certificates. Limits: a name found is not proof it is live or in scope.'],
      ['Search engines', 'Find publicly indexed information. Reveals pages, documents and mentions. Beginner use: check what an organization publishes. Limits: results are incomplete; respect privacy.']
    ]) + '<p class="note">You do not need to install any of these for this mission.</p>'],
    ['Scope and Responsible Recon', `<div class="list"><div class="item"><span><b>Scope</b> · the written list of assets and activities you are authorized to test, agreed with the owner.</span></div><div class="item"><span><b>Written permission</b> · protects you and the client; verbal "okay" is not enough.</span></div><div class="item"><span><b>In-scope / out-of-scope</b> · only listed assets are in scope; everything else is out.</span></div></div>
      <p><b>Name vocabulary:</b> a <b>domain</b> is a name like <code>example.test</code>; a <b>subdomain</b> is a name under it, such as <code>app.example.test</code>; a <b>hostname</b> is the name of a specific machine or service; an <b>IP address</b> is its network address.</p>
      <p>Discovering a new hostname does <b>not</b> authorize testing it. Keep request rates low, avoid unnecessary requests, respect availability and organizational policies, record findings accurately without overstating them, and <b>stop and ask</b> if a target is outside scope.</p>
      <div class="item" style="display:grid;gap:.15rem"><b>Illustrative example (fictional)</b><span>Scope document: only <code>app.example.test</code> and the lab-provided IP address are in scope. You also see <code>admin.example.test</code> in a certificate log: it is not listed, so you note it and ask the client. This is not authorization to test any real domain.</span></div>`],
    ['Recon Workflow', `<ol style="display:grid;gap:.35rem;padding-left:1.2rem"><li>Confirm written authorization and scope.</li><li>Identify the approved target assets.</li><li>Collect relevant public information.</li><li>Record domain, DNS, certificate and technology observations.</li><li>Perform only the active checks the scope allows.</li><li>Validate observations and remove false positives.</li><li>Document evidence, timestamps and limitations.</li><li>Report findings responsibly.</li></ol>
      <div class="item" style="display:grid;gap:.2rem"><b>Example notes for a fictional company, Example Lab Corp</b>
        <span class="note">2026-10-21 10:02 · Scope confirmed: app.example.test + lab IP (ticket #12).</span>
        <span class="note">10:15 · Passive: certificate log lists app.example.test (observed). admin.example.test also listed (out of scope, reported to client).</span>
        <span class="note">10:40 · Active (allowed): <code>curl -I</code> shows <i>Server: nginx</i> (observed). Likely nginx (assumption, unverified).</span>
        <span class="note">Limits: CT logs and headers can be incomplete or misleading.</span></div>`]
  ] });

/* academy.html boots before this file loads: redraw if the first route needed a mission */
if (/#\/academy\/mission/.test(location.hash) && window.route) route();
