/* =====================================================================
   Yojo Cyber Academy: game layer for academy.html
   - Portal entry animation (academy.html?portal=1)
   - Game banners: mission complete, rank up, bounty claimed
   - Energy blades ignite whenever a view renders
   Loaded after academy.html's main script; it reuses its globals.
   ===================================================================== */
(function () {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- banners ---------- */
  function sparks(color) {
    if (reduced) return;
    const cx = innerWidth / 2, cy = innerHeight / 2;
    for (let i = 0; i < 40; i++) {
      const s = document.createElement('i'); s.className = 'spark';
      const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 260;
      s.style.cssText = `left:${cx}px;top:${cy}px;background:${color};box-shadow:0 0 8px ${color};--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px`;
      document.body.appendChild(s); setTimeout(() => s.remove(), 1300);
    }
  }
  function bigBanner(kicker, title, sub, color = '#FFC93C') {
    const b = document.createElement('div'); b.className = 'bigbanner'; b.setAttribute('role', 'status');
    b.innerHTML = `<div class="inner" style="--bcol:${color}"><div class="k">${kicker}</div><h2>${title}</h2>${sub ? `<div class="xp">${sub}</div>` : ''}</div>`;
    document.body.appendChild(b); sparks(color); setTimeout(() => b.remove(), 2900);
  }
  window.bigBanner = bigBanner;

  // themed toasts: rewrite common messages in game voice
  const VOICE = [
    [/^Quest reward claimed/, '★ Bounty collected'],
    [/^Sent to Guild Review/, '📜 Scroll sent to the Guild. Stand by for review'],
    [/^Request sent\. An admin approves paid access/, '🛰️ Request beamed to command. Awaiting admin approval'],
    [/^Daily Ops: scroll read/, '★ Bounty progress: scroll read'],
    [/^Message sent to your trainer/, '📡 Transmission sent to your commander'],
    [/^1-to-1 request sent/, '📡 1-to-1 briefing requested']
  ];
  const baseToast = window.toast;
  window.toast = function (m) {
    if (/^Objective cleared/.test(m)) return;  // the mission-complete banner covers it
    for (const [re, t] of VOICE) if (re.test(m)) return baseToast(t);
    baseToast(m);
  };

  // mission complete + rank up
  if (typeof window.completeMission === 'function') {
    const orig = window.completeMission;
    window.completeMission = function (m) {
      const before = rankOf(me.stats.xp).name;
      orig(m);
      const col = { Offensive: '#FF2E2E', Defensive: '#2E8BFF', GRC: '#2EFF6A' }[m.cat] || '#FFC93C';
      bigBanner('OPERATION ' + m.id, 'MISSION COMPLETE', `+${m.xp} XP`, col);
      const after = rankOf(me.stats.xp).name;
      if (after !== before) setTimeout(() => bigBanner('PROMOTION EARNED', 'RANK UP', after.toUpperCase(), '#FFC93C'), 3000);
    };
  }

  /* ---------- ignite energy blades on every render ---------- */
  const view = document.getElementById('view');
  if (view) new MutationObserver(() => document.querySelectorAll('#view .bar i:not(.ignite)').forEach(i => i.classList.add('ignite')))
    .observe(view, { childList: true, subtree: true });

  /* ---------- portal entry ---------- */
  // Plays for every student entering through sign-in (academy.html?portal=1): existing students right after login,
  // new students after the quiz and team. Owner, 29 Oct: with the "Portal Transition" audio; the portal lasts as long
  // as the audio (4.44 s), and the text reveals are paced across it.
  const q = new URLSearchParams(location.search);
  if (q.get('portal') !== '1' || reduced) return;
  history.replaceState(null, '', location.pathname + location.hash);
  window.__yojoPortalEntry = true; // academy-story.js waits for 'yojo:portal-done' before the husky's briefing
  const app = document.getElementById('app');
  if (!app) return;
  const MUTE_KEY = 'yojo.portalMuted';
  const muted = () => { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; } };
  const audio = new Audio('assets/audio/portal.mp3'); audio.preload = 'auto';
  const AUDIO_S = 4.44;

  // live mode shows #app only after the server sign-in check; wait for it (demo mode has it shown already)
  const whenShown = () => new Promise(res => {
    if (!app.hidden) return res(true);
    const mo = new MutationObserver(() => { if (!app.hidden) { mo.disconnect(); res(true); } });
    mo.observe(app, { attributes: true, attributeFilter: ['hidden'] });
    setTimeout(() => { mo.disconnect(); res(!app.hidden); }, 15000);
  });
  whenShown().then(shown => { if (shown) portal(); else dispatchEvent(new Event('yojo:portal-done')); });

  function portal() {
    const name = (typeof first === 'function') ? first() : 'Agent';
    const cat = (typeof path === 'function') ? path() : '';
    const fac = (typeof FACTIONS !== 'undefined' && FACTIONS[cat]) || '';
    const p = document.createElement('div'); p.id = 'portal'; p.setAttribute('role', 'status'); p.setAttribute('aria-label', 'Entering the Academy');
    p.innerHTML = `<canvas></canvas><div class="ring"></div><div class="ring r2"></div><div class="core"></div>
      <div class="ptxt"><small>YOJO CYBER ACADEMY · ACCESS PORTAL</small><b>THE DIGITAL WORLD NEEDS DEFENDERS.</b><span class="l2">Every threat is a challenge. Every defender makes a difference.</span><hr><em>YOUR MISSION BEGINS HERE.</em></div>
      <div class="pgate" hidden><button class="btn btn-primary" type="button">▶ Begin mission</button><small>Welcome, ${esc(name)}. Sound on.</small></div>
      <button class="btn btn-sm btn-ghost sound-portal" type="button" aria-pressed="${!muted()}">${muted() ? '🔇 Sound off' : '🔊 Sound on'}</button>
      <button class="btn btn-sm btn-ghost skip-portal" type="button">Skip ▸</button>`;
    p.style.setProperty('--pd', AUDIO_S + 's');
    p.classList.add('wait');
    document.body.appendChild(p);
    app.style.visibility = 'hidden';

    // hyperspace star streaks
    const cv = p.querySelector('canvas'), ctx = cv.getContext('2d');
    const fit = () => { cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio; };
    fit(); addEventListener('resize', fit);
    const stars = Array.from({ length: 420 }, () => ({ x: (Math.random() - .5) * 2, y: (Math.random() - .5) * 2, z: Math.random() }));
    let t0 = performance.now(), raf, started = false, done = false, timer;
    function frame(t) {
      const el = started ? (t - t0) / 1000 : 0, speed = 0.004 + Math.min(el, 3) * 0.02;
      const w = cv.width, h = cv.height, cx = w / 2, cy = h / 2;
      ctx.fillStyle = 'rgba(2,4,10,.35)'; ctx.fillRect(0, 0, w, h);
      for (const s of stars) {
        const pz = s.z; s.z -= speed; if (s.z <= 0.01) { s.x = (Math.random() - .5) * 2; s.y = (Math.random() - .5) * 2; s.z = 1; continue; }
        const sx = cx + s.x / s.z * cx, sy = cy + s.y / s.z * cy, px = cx + s.x / pz * cx, py = cy + s.y / pz * cy;
        ctx.strokeStyle = `hsla(${185 + s.x * 80},100%,${60 + (1 - s.z) * 40}%,${1 - s.z})`; ctx.lineWidth = (1 - s.z) * 3 * devicePixelRatio;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(sx, sy); ctx.stroke();
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    const finish = function () {
      if (done) return; done = true; clearTimeout(timer);
      try { audio.pause(); } catch {}
      p.classList.add('out'); app.style.visibility = ''; app.classList.add('arrive');
      setTimeout(() => { cancelAnimationFrame(raf); p.remove(); dispatchEvent(new Event('yojo:portal-done')); bigBanner('TRANSMISSION RECEIVED', 'WELCOME, AGENT', fac ? fac.toUpperCase() : '', '#00F0FF'); }, 700);
    };
    // the animation and the audio start together; the portal ends when the audio ends (timer as a backstop)
    const run = function () {
      if (started) return; started = true; t0 = performance.now();
      const d = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : AUDIO_S;
      p.style.setProperty('--pd', d + 's');
      p.querySelector('.pgate').hidden = true; p.classList.remove('wait'); p.classList.add('go');
      audio.addEventListener('ended', finish, { once: true });
      timer = setTimeout(finish, d * 1000 + 400);
    };
    const start = function () {
      if (muted()) return run();
      audio.currentTime = 0;
      const pr = audio.play();
      if (pr && pr.then) pr.then(run, () => {
        // the browser blocked sound without a click in this tab: one click starts the sound and the portal together
        const g = p.querySelector('.pgate'); g.hidden = false;
        g.querySelector('button').focus();
      });
      else run();
    };
    p.querySelector('.pgate button').addEventListener('click', () => { audio.play().catch(() => {}); run(); });
    p.querySelector('.sound-portal').addEventListener('click', e => {
      const off = !muted();
      try { localStorage.setItem(MUTE_KEY, off ? '1' : '0'); } catch {}
      audio.muted = off; e.currentTarget.textContent = off ? '🔇 Sound off' : '🔊 Sound on'; e.currentTarget.setAttribute('aria-pressed', String(!off));
      if (!off && started && audio.paused) audio.play().catch(() => {});
    });
    p.querySelector('.skip-portal').addEventListener('click', finish);
    addEventListener('keydown', e => { if (e.key === 'Escape') finish(); }, { once: true });
    audio.muted = muted();
    start();
  }
})();
