/* Yojo CTF: registration, login (username + password + email OTP) and session, shared by the ctf-*.html pages.
   Demo: records live in this browser (yojo_ctf_registrations) and the admin console reads the same list.
   Passwords are stored only as a salted PBKDF2 hash. The OTP is shown on screen because no email service is connected. */
(function () {
  'use strict';
  const KEY = 'yojo_ctf_registrations', SESSION = 'yojo_ctf_session', OTP = 'yojo_ctf_otp', EVENT = 'Yojo Winter CTF';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const all = () => { try { const a = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(a) ? a : []; } catch { return []; } };
  const saveAll = a => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch {} };
  const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  async function hashPw(pw, salt) {
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
    return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 120000, hash: 'SHA-256' }, k, 256));
  }
  /* ---------- authenticator app (TOTP, RFC 6238: SHA-1, 30 s, 6 digits), the same scheme as admin login ---------- */
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const b32random = (n = 16) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(x => B32[x & 31]).join(''); };
  const b32decode = s => { let bits = 0, val = 0; const out = []; for (const ch of s.toUpperCase()) { const i = B32.indexOf(ch); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return new Uint8Array(out); };
  async function totp(secret, t = Date.now()) {
    const c = Math.floor(t / 30000), msg = new Uint8Array(8), dv = new DataView(msg.buffer); dv.setUint32(0, Math.floor(c / 2 ** 32)); dv.setUint32(4, c >>> 0);
    const k = await crypto.subtle.importKey('raw', b32decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const h = new Uint8Array(await crypto.subtle.sign('HMAC', k, msg)), o = h[19] & 15;
    return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
  }
  const totpOk = async (secret, code) => { for (const s of [-1, 0, 1]) if (await totp(secret, Date.now() + s * 30000) === String(code).trim()) return true; return false; };
  // demo only: no phone app is paired, so the page shows the code the app would show
  const demoCode = (el, secret) => { const tick = async () => { if (!el.isConnected) return clearInterval(iv); el.textContent = await totp(secret); }; const iv = setInterval(tick, 1000); tick(); };
  const session = () => { try { const s = JSON.parse(sessionStorage.getItem(SESSION)); return s && s.exp > Date.now() ? s : null; } catch { return null; } };
  const me = () => { const s = session(); return s && all().find(r => r.id === s.id) || null; };
  // where to go after login: only our own CTF pages are allowed, so ?next= can never send someone off-site or into a loop
  const SAFE = ['ctf-dashboard.html'];
  const next = () => { const n = new URLSearchParams(location.search).get('next') || ''; return SAFE.includes(n) ? n : 'ctf-dashboard.html'; };
  const loginUrl = (extra = '') => 'ctf-login.html?next=' + encodeURIComponent(next()) + extra;
  const expired = () => { try { const s = JSON.parse(sessionStorage.getItem(SESSION)); if (s && !(s.exp > Date.now())) { sessionStorage.removeItem(SESSION); return true; } } catch {} return false; };
  const track = (n, p) => { try { window.YojoInsight && YojoInsight.track(n, p); } catch {} };

  /* ---------------- register ---------------- */
  function registerForm(box) {
    if (me()) { location.replace(next()); return; }
    box.innerHTML = `<form class="form" novalidate>
      <div class="two"><div class="field"><label for="r-name">Full name *</label><input id="r-name" name="name" autocomplete="name" placeholder="Sai Teja"></div>
      <div class="field"><label for="r-mail">Email *</label><input id="r-mail" name="email" type="email" autocomplete="email" placeholder="you@example.com"></div></div>
      <div class="two"><div class="field"><label for="r-phone">Phone *</label><input id="r-phone" name="phone" inputmode="tel" autocomplete="tel" placeholder="+91 98xxxxxxxx"></div>
      <div class="field"><label for="r-inst">College or company *</label><input id="r-inst" name="institution" placeholder="ABC Institute of Tech"></div></div>
      <div class="two"><div class="field"><label for="r-city">City</label><input id="r-city" name="city" placeholder="Visakhapatnam"></div>
      <div class="field"><label for="r-lvl">Experience *</label><select id="r-lvl" name="level"><option value="">Choose one</option><option>Beginner (first CTF)</option><option>Intermediate (played a few)</option><option>Advanced (ranked before)</option></select></div></div>
      <div class="two"><div class="field"><label for="r-user">Username *</label><input id="r-user" name="username" autocomplete="username" placeholder="packet_pirate"><span class="hint">3 to 20 letters, numbers or _</span></div>
      <div class="field"><label for="r-pw">Password *</label><input id="r-pw" name="password" type="password" autocomplete="new-password"><span class="hint">At least 8 characters, with a letter and a number</span></div></div>
      <div class="field"><label for="r-pw2">Confirm password *</label><input id="r-pw2" name="password2" type="password" autocomplete="new-password"></div>
      <label class="consent"><input type="checkbox" name="rules">I accept the CTF rules: attack only the targets on the board, no flag sharing, no attacks on the platform. *</label>
      <label class="consent"><input type="checkbox" name="contact">Yojo Solutions may contact me about this event. *</label>
      <p class="err" role="alert" aria-live="polite"></p>
      <button class="btn btn-primary" type="submit">Register for the CTF</button></form>`;
    const f = $('form', box);
    f.addEventListener('submit', async e => {
      e.preventDefault(); const v = k => (f[k].value || '').trim(), err = $('.err', f);
      const r = { name: v('name'), email: v('email').toLowerCase(), phone: v('phone'), institution: v('institution'), city: v('city'), level: v('level'), mode: 'Solo', team: '', size: 1, username: v('username').toLowerCase() };
      r.members = [];
      const pw = f.password.value, bad = [];
      if (r.name.length < 2) bad.push('your full name'); if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(r.email)) bad.push('a valid email'); if (!/^\+?[\d\s-]{10,15}$/.test(r.phone)) bad.push('a valid phone number');
      if (!r.institution) bad.push('your college or company'); if (!r.level) bad.push('your experience');       if (!/^[a-z0-9_]{3,20}$/.test(r.username)) bad.push('a username (3 to 20 letters, numbers or _)');
      if (pw.length < 8 || !/[a-z]/i.test(pw) || !/\d/.test(pw)) bad.push('a password of at least 8 characters with a letter and a number'); else if (pw !== f.password2.value) bad.push('the same password twice');
      if (!f.rules.checked) bad.push('acceptance of the CTF rules'); if (!f.contact.checked) bad.push('consent to be contacted');
      if (bad.length) { err.textContent = 'Please add ' + bad.join(', ') + '.'; return; }
      const list = all();
      if (list.some(x => x.email === r.email && x.event === EVENT)) { err.innerHTML = 'This email is already registered. <a href="${loginUrl()}">Log in instead</a>.'; return; }
      if (list.some(x => x.username === r.username)) { err.textContent = 'That username is taken. Try another.'; return; }
      const salt = Math.random().toString(36).slice(2) + Date.now().toString(36);
      Object.assign(r, { id: 'CTF-' + Date.now().toString(36).toUpperCase().slice(-6), event: EVENT, at: Date.now(), status: 'Registered', source: 'Register page', salt, pwHash: await hashPw(pw, salt) });
      enrol(box, r, () => { const l = all(); if (l.some(x => x.username === r.username || (x.email === r.email && x.event === EVENT))) return; l.unshift(r); saveAll(l); track('ctf_registered', { feature: 'ctf', result: 'ok' }); });
    });
  }
  function enrol(box, r, save) {
    const secret = b32random(), uri = `otpauth://totp/Yojo%20CTF:${encodeURIComponent(r.username)}?secret=${secret}&issuer=Yojo%20CTF`;
    box.innerHTML = `<div class="steps"><span class="on"></span><span class="on"></span></div><form class="form" novalidate>
      <h2 style="font-family:var(--f-display);margin:0">Set up your authenticator</h2>
      <p style="margin:0">Every CTF login asks for a code from an authenticator app (Google Authenticator, Microsoft Authenticator or Authy). In the app choose <b>Add account → Enter a setup key</b> and type this key:</p>
      <p class="mono" style="font-size:1.1rem;letter-spacing:.12em;word-break:break-all;margin:0"><b id="mfaKey">${secret.replace(/(.{4})/g, '$1 ').trim()}</b></p>
      <p class="hint" style="margin:0;word-break:break-all">Or use this link on your phone: ${esc(uri)}</p>
      <p class="demo">Demo: no phone app is paired, so the code your app would show is: <b class="mono" id="demoTotp">······</b></p>
      <div class="field"><label for="e-code">Code from the app</label><input id="e-code" name="code" class="otp" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
      <p class="err" role="alert" aria-live="polite"></p><button class="btn btn-primary" type="submit">Confirm and finish registration</button></form>`;
    demoCode($('#demoTotp', box), secret);
    const f = $('form', box); f.code.focus();
    f.addEventListener('submit', async e => { e.preventDefault(); const err = $('.err', f);
      if (!await totpOk(secret, f.code.value)) { err.textContent = 'That code does not match. Check the key in your app and try the newest code.'; return; }
      r.mfaSecret = secret; save(); registered(box, r); });
  }
  function registered(box, r) {
      box.innerHTML = `<div><span class="chip g">Registered</span><h2 style="font-family:var(--f-display)">You are in, ${esc(r.name.split(' ')[0])}.</h2>
        <p class="lead">Registration ID <b class="mono">${esc(r.id)}</b> for ${esc(EVENT)}. Your username is <b>${esc(r.username)}</b>.</p>
        <p class="hint">Authenticator set up. You will need it every time you log in.</p>
        <a class="btn btn-primary" href="${loginUrl('&u=' + encodeURIComponent(r.username))}">Log in to the CTF</a></div>`;
  }

  /* ---------------- login: username + password, then a one-time code to the registered email ---------------- */
  function loginForm(box) {
    const pre = new URLSearchParams(location.search).get('u') || '';
    const step1 = (msg = '') => {
      box.innerHTML = `<div class="steps"><span class="on"></span><span></span></div><form class="form" novalidate>
        <div class="field"><label for="l-user">Username</label><input id="l-user" name="username" autocomplete="username" value="${esc(pre)}"></div>
        <div class="field"><label for="l-pw">Password</label><input id="l-pw" name="password" type="password" autocomplete="current-password"></div>
        <p class="err" role="alert" aria-live="polite">${esc(msg)}</p><button class="btn btn-primary" type="submit">Continue</button></form>`;
      const f = $('form', box); (pre ? f.password : f.username).focus();
      f.addEventListener('submit', async e => {
        e.preventDefault(); const err = $('.err', f), u = f.username.value.trim().toLowerCase(), pw = f.password.value;
        if (!u || !pw) { err.textContent = 'Enter your username and password.'; return; }
        const r = all().find(x => x.username === u);
        // same message for an unknown user and a wrong password, so usernames cannot be probed
        if (!r || !r.pwHash || await hashPw(pw, r.salt) !== r.pwHash) { err.textContent = 'Username or password is incorrect.'; return; }
        if (r.status === 'Cancelled') { err.textContent = 'This registration was cancelled. Contact the CTF team.'; return; }
        sendOtp(r); step2(r);
      });
    };
    const sendOtp = r => { const code = String(Math.floor(100000 + Math.random() * 900000)); sessionStorage.setItem(OTP, JSON.stringify({ id: r.id, code, exp: Date.now() + 5 * 60e3, tries: 0 })); return code; };
    const mask = e => e.replace(/^(.).*(@.*)$/, (_, a, b) => a + '•••' + b);
    const step2 = r => {
      const o = JSON.parse(sessionStorage.getItem(OTP));
      box.innerHTML = `<div class="steps"><span class="on"></span><span class="on"></span></div><form class="form" novalidate>
        <p style="margin:0">We sent a 6-digit code to <b>${esc(mask(r.email))}</b>. It expires in 5 minutes.</p>
        <p class="demo">Demo: no email service is connected, so the code is shown here: <b class="mono" id="demoOtp">${o.code}</b></p>
        <div class="field"><label for="l-otp">One-time code</label><input id="l-otp" name="otp" class="otp" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
        <p class="err" role="alert" aria-live="polite"></p>
        <div class="row"><button class="btn btn-primary" type="submit">Verify and log in</button><button class="btn" type="button" data-resend>Send a new code</button><button class="btn" type="button" data-back>Back</button></div></form>`;
      const f = $('form', box); f.otp.focus();
      $('[data-back]', f).onclick = () => step1();
      $('[data-resend]', f).onclick = () => { sendOtp(r); step2(r); };
      f.addEventListener('submit', e => {
        e.preventDefault(); const err = $('.err', f), cur = JSON.parse(sessionStorage.getItem(OTP) || 'null');
        if (!cur || cur.id !== r.id || Date.now() > cur.exp) { err.textContent = 'This code has expired. Send a new code.'; return; }
        if (cur.tries >= 5) { sessionStorage.removeItem(OTP); err.textContent = 'Too many wrong codes. Send a new code.'; return; }
        if (f.otp.value.trim() !== cur.code) { cur.tries++; sessionStorage.setItem(OTP, JSON.stringify(cur)); err.textContent = `That code is not right. ${5 - cur.tries} tries left.`; return; }
        sessionStorage.removeItem(OTP);
        if (r.mfaSecret) { step3(r); return; }
        complete(r);
      });
    };
    const step3 = r => {
      let tries = 0;
      box.innerHTML = `<div class="steps"><span class="on"></span><span class="on"></span><span class="on"></span></div><form class="form" novalidate>
        <p style="margin:0">Email code verified. Now enter the 6-digit code from your <b>authenticator app</b>.</p>
        <p class="demo">Demo: no phone app is paired, so the code the app would show is: <b class="mono" id="demoTotp">······</b></p>
        <div class="field"><label for="l-totp">Authenticator code</label><input id="l-totp" name="totp" class="otp" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
        <p class="err" role="alert" aria-live="polite"></p><div class="row"><button class="btn btn-primary" type="submit">Verify and log in</button><button class="btn" type="button" data-back>Start again</button></div></form>`;
      demoCode($('#demoTotp', box), r.mfaSecret);
      const f = $('form', box); f.totp.focus(); $('[data-back]', f).onclick = () => step1();
      f.addEventListener('submit', async e => { e.preventDefault(); const err = $('.err', f);
        if (++tries > 5) { step1('Too many wrong authenticator codes. Log in again.'); return; }
        if (!await totpOk(r.mfaSecret, f.totp.value)) { err.textContent = `That code is not right. ${5 - tries} tries left.`; return; }
        complete(r); });
    };
    const complete = r => {
        const list = all(), rec = list.find(x => x.id === r.id); if (rec) { rec.logins = (rec.logins || []).concat(Date.now()).slice(-50); rec.lastLogin = Date.now(); saveAll(list); }
        sessionStorage.setItem(SESSION, JSON.stringify({ id: r.id, exp: Date.now() + 8 * 36e5 }));
        track('ctf_login', { feature: 'ctf', result: 'ok' });
        // the CTF opens in a new tab (the browser copies this tab's session to it); if pop-ups are blocked, open it here instead
        const w = window.open(next(), '_blank');
        if (!w) { location.replace(next()); return; }
        box.innerHTML = `<span class="chip g">Logged in</span><h2 style="font-family:var(--f-display);margin:.6rem 0">The CTF opened in a new tab</h2><p class="lead">If you don't see it, use the button below.</p><div class="row"><a class="btn btn-primary" href="${next()}" target="_blank" rel="noopener">Open My CTF</a><a class="btn" href="index.html#ctf">Back to the CTF page</a></div>`;
    };
    if (me()) { location.replace(next()); return; }
    const why = new URLSearchParams(location.search).get('why');
    step1(why === 'expired' ? 'Your session has expired. Please log in again.' : '');
  }

  /* ---------------- dashboard ---------------- */
  function dashboard(box) {
    const r = me(); if (!r) { location.replace('ctf-login.html?next=ctf-dashboard.html' + (expired() ? '&why=expired' : '')); return; }
    box.innerHTML = `<span class="chip g">${esc(r.status || 'Registered')}</span><h2 style="font-family:var(--f-display);margin:.6rem 0">Welcome, ${esc(r.name.split(' ')[0])}</h2>
      <dl><dt>Event</dt><dd>${esc(r.event)}</dd><dt>Registration ID</dt><dd class="mono">${esc(r.id)}</dd><dt>Username</dt><dd>${esc(r.username)}</dd><dt>Email</dt><dd>${esc(r.email)}</dd></dl>
      <p class="lead" style="margin-top:1rem">The challenge board opens when the event starts. The link and rules go to your email.</p>
      <div class="row"><a class="btn" href="index.html#ctf">About the CTF</a><button class="btn" type="button" id="ctfOut">Log out</button></div>`;
    $('#ctfOut').onclick = () => { sessionStorage.removeItem(SESSION); location.href = 'ctf-login.html'; };
  }

  /* ================= LIVE mode: the real API (backend/docs/AUTH-JOURNEYS.md, section B) =================
     Used when yojo-api.js is loaded and the API answers; otherwise the demo above runs unchanged. */
  const api = window.YojoAPI;
  const ready = api ? api.available().then(ok => ok && api.init().then(() => true, () => false)) : Promise.resolve(false);
  const msgOf = e => (e && e.problem && e.problem.message) || (e && e.status === 429 ? 'Too many tries. Wait a minute and try again.' : e && e.status ? `Something went wrong (${e.status}). Try again.` : 'Cannot reach the Yojo server. Check your connection and try again.');
  const busy = (f, on) => f.querySelectorAll('button').forEach(b => { b.disabled = on; });
  const LEVEL = { 'Beginner (first CTF)': 'beginner', 'Intermediate (played a few)': 'intermediate', 'Advanced (ranked before)': 'advanced' };
  const PAGE = { '/ctf/dashboard': 'ctf-dashboard.html' };
  const loadQr = () => window.QRCode ? Promise.resolve(true) : new Promise(res => { const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'; sc.onload = () => res(!!window.QRCode); sc.onerror = () => res(false); document.head.append(sc); });

  function liveRegister(box) {
    registerForm(box); // same form as the demo; the capture listener below replaces the demo submit
    const f = $('form', box), err = $('.err', f);
    if (!f) return;
    f.querySelector('#r-pw + .hint').textContent = 'At least 10 characters. Avoid common words and your username.';
    f.addEventListener('submit', e => {
      e.preventDefault(); e.stopImmediatePropagation();
      const v = k => (f[k].value || '').trim(), pw = f.password.value, bad = [];
      const r = { email: v('email').toLowerCase(), phone: v('phone').replace(/[^\d+ ]/g, ''), institution: v('institution'), city: v('city'), level: LEVEL[v('level')], username: v('username') };
      if (v('name').length < 2) bad.push('your full name'); if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(r.email)) bad.push('a valid email'); if (!/^\+?[\d ]{10,16}$/.test(r.phone)) bad.push('a valid phone number');
      if (!r.institution) bad.push('your college or company'); if (!r.level) bad.push('your experience'); if (!/^[A-Za-z0-9_]{3,24}$/.test(r.username)) bad.push('a username (3 to 24 letters, numbers or _)');
      if (pw.length < 10) bad.push('a password of at least 10 characters'); else if (pw !== f.password2.value) bad.push('the same password twice');
      if (!f.rules.checked) bad.push('acceptance of the CTF rules'); if (!f.contact.checked) bad.push('consent to be contacted');
      if (bad.length) { err.textContent = 'Please add ' + bad.join(', ') + '.'; return; }
      busy(f, true);
      api.ctf.sendRegisterOtp(r.email).then(sent => liveRegisterOtp(box, r, pw, f.contact.checked, sent), e2 => { busy(f, false); err.textContent = msgOf(e2); });
    }, true);
  }
  function liveRegisterOtp(box, r, pw, contact, sent) {
    box.innerHTML = `<div class="steps"><span class="on"></span><span></span></div><form class="form" novalidate>
      <p style="margin:0">We sent a 6-digit code to <b>${esc(r.email)}</b> to confirm it is yours. It expires in ${Math.round((sent.expiresInSec || 300) / 60)} minutes.</p>
      <div class="field"><label for="r-otp">Code from the email</label><input id="r-otp" name="otp" class="otp" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
      <p class="err" role="alert" aria-live="polite"></p>
      <div class="row"><button class="btn btn-primary" type="submit">Verify and register</button><button class="btn" type="button" data-resend>Send a new code</button><button class="btn" type="button" data-back>Back</button></div></form>`;
    const f = $('form', box), err = $('.err', f); f.otp.focus();
    $('[data-back]', f).onclick = () => liveRegister(box);
    $('[data-resend]', f).onclick = () => api.ctf.sendRegisterOtp(r.email).then(s2 => { sent = s2; err.textContent = 'A new code was sent. Older codes no longer work.'; }, e => { err.textContent = msgOf(e); });
    f.addEventListener('submit', e => {
      e.preventDefault(); const code = f.otp.value.trim();
      if (!/^\d{6}$/.test(code)) { err.textContent = 'Enter the 6-digit code.'; return; }
      busy(f, true);
      const body = { challengeId: sent.challengeId, code, username: r.username, password: pw, consents: { ctf_rules: true, ctf_contact: contact }, institution: r.institution, level: r.level, phone: r.phone };
      if (r.city.length >= 2) body.city = r.city;
      api.ctf.register(body).then(res => { track('ctf_registered', { feature: 'ctf', result: 'ok' }); liveEnrol(box, res); },
        e2 => { busy(f, false); err.textContent = msgOf(e2); });
    });
  }
  // Optional authenticator after registration (the CTF session is already open).
  function liveEnrol(box, res) {
    box.innerHTML = `<div class="steps"><span class="on"></span><span class="on"></span></div><div class="form">
      <span class="chip g">Registered</span><h2 style="font-family:var(--f-display);margin:0">You are in${res.linked ? ' (linked to your Yojo account)' : ''}.</h2>
      <p style="margin:0">Your username is <b>${esc(res.username)}</b>. Add an authenticator app now for a safer login (recommended), or skip it.</p>
      <p class="err" role="alert" aria-live="polite"></p>
      <div class="row"><button class="btn btn-primary" type="button" data-mfa>Set up authenticator</button><button class="btn" type="button" data-skip>Skip for now</button></div></div>`;
    $('[data-skip]', box).onclick = () => liveRegistered(box, res);
    $('[data-mfa]', box).onclick = () => api.ctf.mfaSetup().then(m => {
      box.innerHTML = `<form class="form" novalidate><h2 style="font-family:var(--f-display);margin:0">Set up your authenticator</h2>
        <p style="margin:0">Scan the QR code with Google Authenticator, Microsoft Authenticator or Authy, or choose <b>Enter a setup key</b> and type:</p>
        <div id="qr" style="background:#fff;padding:10px;border-radius:10px;width:max-content"></div>
        <p class="mono" style="font-size:1.1rem;letter-spacing:.12em;word-break:break-all;margin:0"><b id="mfaKey">${esc(m.secret.replace(/(.{4})/g, '$1 ').trim())}</b></p>
        <div class="field"><label for="e-code">Code from the app</label><input id="e-code" name="code" class="otp" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
        <p class="err" role="alert" aria-live="polite"></p><div class="row"><button class="btn btn-primary" type="submit">Confirm</button><button class="btn" type="button" data-skip>Skip for now</button></div></form>`;
      loadQr().then(ok => { const q = $('#qr', box); if (!q) return; if (ok) new QRCode(q, { text: m.otpauthUri, width: 180, height: 180 }); else q.remove(); });
      const f = $('form', box), err = $('.err', f); f.code.focus();
      $('[data-skip]', f).onclick = () => liveRegistered(box, res);
      f.addEventListener('submit', e => { e.preventDefault(); busy(f, true);
        api.ctf.mfaConfirm(f.code.value.trim()).then(c => {
          box.innerHTML = `<div class="form"><h2 style="font-family:var(--f-display);margin:0">Save your recovery codes</h2><p style="margin:0">Each works once if you lose your phone. They are shown only now.</p>
            <pre class="mono" id="recCodes" style="white-space:pre-wrap">${esc((c.recoveryCodes || []).join('\n'))}</pre><button class="btn btn-primary" type="button" data-go>I saved them</button></div>`;
          $('[data-go]', box).onclick = () => liveRegistered(box, res, true);
        }, e2 => { busy(f, false); err.textContent = msgOf(e2); }); });
    }, e => { $('.err', box).textContent = msgOf(e); });
  }
  function liveRegistered(box, res, mfa) {
    box.innerHTML = `<div><span class="chip g">Registered</span><h2 style="font-family:var(--f-display)">You are in.</h2>
      <p class="lead">Registered for ${esc(EVENT)} as <b>${esc(res.username)}</b>. You are signed in.</p>
      <p class="hint">${mfa ? 'Authenticator set up. You will need it every time you log in.' : 'You can add an authenticator later from My CTF.'}</p>
      <a class="btn btn-primary" href="${PAGE[res.redirect] || 'ctf-dashboard.html'}">Open My CTF</a></div>`;
  }

  function liveLogin(box) {
    const reset = location.hash.match(/^#ctf-reset=([\w-]{20,100})$/);
    if (reset) { history.replaceState(null, '', location.pathname + location.search); liveReset(box, reset[1]); return; }
    const pre = new URLSearchParams(location.search).get('u') || '';
    const step1 = (msg = '') => {
      box.innerHTML = `<div class="steps"><span class="on"></span><span></span></div><form class="form" novalidate>
        <div class="field"><label for="l-user">Username</label><input id="l-user" name="username" autocomplete="username" value="${esc(pre)}"></div>
        <div class="field"><label for="l-pw">Password</label><input id="l-pw" name="password" type="password" autocomplete="current-password"></div>
        <p class="err" role="alert" aria-live="polite">${esc(msg)}</p><div class="row"><button class="btn btn-primary" type="submit">Continue</button><button class="btn" type="button" data-forgot>Forgot password?</button></div></form>`;
      const f = $('form', box); (pre ? f.password : f.username).focus();
      $('[data-forgot]', f).onclick = () => liveForgot(box, f.username.value.trim());
      f.addEventListener('submit', e => {
        e.preventDefault(); const err = $('.err', f), u = f.username.value.trim(), pw = f.password.value;
        if (!u || !pw) { err.textContent = 'Enter your username and password.'; return; }
        busy(f, true);
        api.ctf.login(u, pw, '/ctf/dashboard').then(r => step2(r, u, pw), e2 => { busy(f, false); err.textContent = msgOf(e2); });
      });
    };
    const step2 = (r, u, pw) => {
      box.innerHTML = `<div class="steps"><span class="on"></span><span class="on"></span></div><form class="form" novalidate>
        <p style="margin:0">We sent a 6-digit code to <b>${esc(r.emailHint || 'your registered email')}</b>. It expires in 5 minutes.</p>
        <div class="field"><label for="l-otp">One-time code</label><input id="l-otp" name="otp" class="otp" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
        <p class="err" role="alert" aria-live="polite"></p>
        <div class="row"><button class="btn btn-primary" type="submit">Verify and log in</button><button class="btn" type="button" data-resend>Send a new code</button><button class="btn" type="button" data-back>Back</button></div></form>`;
      const f = $('form', box), err = $('.err', f); f.otp.focus();
      $('[data-back]', f).onclick = () => step1();
      $('[data-resend]', f).onclick = () => api.ctf.login(u, pw, '/ctf/dashboard').then(r2 => { r = r2; err.textContent = 'A new code was sent. Older codes no longer work.'; }, e => { err.textContent = msgOf(e); });
      f.addEventListener('submit', e => {
        e.preventDefault(); const code = f.otp.value.trim();
        if (!/^\d{6}$/.test(code)) { err.textContent = 'Enter the 6-digit code.'; return; }
        busy(f, true);
        api.ctf.loginOtp(r.challengeId, code).then(x => x.next === 'totp' ? step3(x.ticket) : complete(x), e2 => { busy(f, false); f.otp.value = ''; err.textContent = msgOf(e2); });
      });
    };
    const step3 = ticket => {
      box.innerHTML = `<div class="steps"><span class="on"></span><span class="on"></span><span class="on"></span></div><form class="form" novalidate>
        <p style="margin:0">Email code verified. Now enter the 6-digit code from your <b>authenticator app</b>, or one of your recovery codes.</p>
        <div class="field"><label for="l-totp">Authenticator or recovery code</label><input id="l-totp" name="totp" class="otp" autocomplete="one-time-code"></div>
        <p class="err" role="alert" aria-live="polite"></p><div class="row"><button class="btn btn-primary" type="submit">Verify and log in</button><button class="btn" type="button" data-back>Start again</button></div></form>`;
      const f = $('form', box), err = $('.err', f); f.totp.focus(); $('[data-back]', f).onclick = () => step1();
      f.addEventListener('submit', e => { e.preventDefault(); const v = f.totp.value.trim(), six = /^\d{6}$/.test(v); busy(f, true);
        api.ctf.loginTotp(ticket, six ? v : undefined, six ? undefined : v).then(complete, e2 => { busy(f, false); f.totp.value = ''; err.textContent = msgOf(e2); }); });
    };
    const complete = x => {
      track('ctf_login', { feature: 'ctf', result: 'ok' });
      const dest = PAGE[x.redirect] || 'ctf-dashboard.html', w = window.open(dest, '_blank');
      if (!w) { location.replace(dest); return; }
      box.innerHTML = `<span class="chip g">Logged in</span><h2 style="font-family:var(--f-display);margin:.6rem 0">The CTF opened in a new tab</h2><p class="lead">If you don't see it, use the button below.</p><div class="row"><a class="btn btn-primary" href="${dest}" target="_blank" rel="noopener">Open My CTF</a><a class="btn" href="index.html#ctf">Back to the CTF page</a></div>`;
    };
    api.ctf.me().then(() => location.replace('ctf-dashboard.html'), () => { const why = new URLSearchParams(location.search).get('why'); step1(why === 'expired' ? 'Your session has expired. Please log in again.' : ''); });
  }
  function liveForgot(box, pre) {
    box.innerHTML = `<form class="form" novalidate><h2 style="font-family:var(--f-display);margin:0">Reset your CTF password</h2>
      <div class="field"><label for="f-u">Username or email</label><input id="f-u" name="u" value="${esc(pre || '')}" autocomplete="username"></div>
      <p class="err" role="alert" aria-live="polite"></p><div class="row"><button class="btn btn-primary" type="submit">Send reset link</button><button class="btn" type="button" data-back>Back</button></div></form>`;
    const f = $('form', box); $('[data-back]', f).onclick = () => liveLogin(box);
    f.addEventListener('submit', e => { e.preventDefault(); const v = f.u.value.trim(); if (v.length < 3) { $('.err', f).textContent = 'Enter your username or email.'; return; } busy(f, true);
      api.ctf.forgot(v).then(() => { box.innerHTML = '<p class="lead">If a CTF account matches, a reset link is on its way (valid 30 minutes).</p><a class="btn" href="ctf-login.html">Back to login</a>'; }, e2 => { busy(f, false); $('.err', f).textContent = msgOf(e2); }); });
  }
  function liveReset(box, token) {
    box.innerHTML = `<form class="form" novalidate><h2 style="font-family:var(--f-display);margin:0">Choose a new password</h2>
      <div class="field"><label for="n-pw">New password</label><input id="n-pw" name="pw" type="password" autocomplete="new-password"><span class="hint">At least 10 characters</span></div>
      <div class="field"><label for="n-pw2">Confirm password</label><input id="n-pw2" name="pw2" type="password" autocomplete="new-password"></div>
      <div class="field"><label for="n-code">Authenticator code (if you set one up)</label><input id="n-code" name="code" class="otp" inputmode="numeric" maxlength="6"></div>
      <p class="err" role="alert" aria-live="polite"></p><button class="btn btn-primary" type="submit">Save new password</button></form>`;
    const f = $('form', box), err = $('.err', f);
    f.addEventListener('submit', e => { e.preventDefault();
      if (f.pw.value.length < 10) { err.textContent = 'Use at least 10 characters.'; return; } if (f.pw.value !== f.pw2.value) { err.textContent = 'The two passwords do not match.'; return; }
      busy(f, true); const c = f.code.value.trim();
      api.ctf.reset(token, f.pw.value, /^\d{6}$/.test(c) ? c : undefined).then(() => { box.innerHTML = '<p class="lead">Password changed. Log in with your new password.</p><a class="btn btn-primary" href="ctf-login.html">Log in</a>'; }, e2 => { busy(f, false); err.textContent = msgOf(e2); }); });
  }
  function liveDashboard(box) {
    api.ctf.me().then(m => {
      const reg = (m.registrations || [])[0] || {};
      box.innerHTML = `<span class="chip g">${esc(reg.status || 'registered')}</span><h2 style="font-family:var(--f-display);margin:.6rem 0">Welcome, ${esc(m.username || m.displayName || '')}</h2>
        <dl><dt>Event</dt><dd>${esc((reg.event && reg.event.name) || EVENT)}</dd><dt>Registration ID</dt><dd class="mono">${esc(reg.code || m.code || '')}</dd><dt>Username</dt><dd>${esc(m.username || '')}</dd><dt>Email</dt><dd>${esc(m.email || '')}</dd><dt>Authenticator</dt><dd>${m.mfaEnrolled ? 'Set up' : 'Not set up'}</dd></dl>
        <p class="lead" style="margin-top:1rem">The challenge board opens when the event starts. The link and rules go to your email.</p>
        ${m.lmsAccount ? '<p class="lead">Your account also has the Yojo Academy. <a href="login.html">Sign in to the Academy</a> (a separate sign-in).</p>'
          : '<p class="lead">Want to learn with Yojo too? <a href="login.html#join-academy">Join the Yojo Academy</a> with this same email: we send a code to it, you add a few student details, and the Academy is added to this account. Your CTF login stays the same.</p>'}
        <p class="err" role="alert" aria-live="polite"></p>
        <div class="row"><a class="btn" href="index.html#ctf">About the CTF</a>${m.mfaEnrolled ? '' : '<button class="btn" type="button" id="ctfMfa">Set up authenticator</button>'}<button class="btn" type="button" id="ctfOut">Log out</button></div>`;
      $('#ctfOut').onclick = () => api.logout().catch(() => {}).then(() => { location.href = 'ctf-login.html'; });
      const b = $('#ctfMfa'); if (b) b.onclick = () => liveEnrol(box, { username: m.username, redirect: '/ctf/dashboard' });
    }, e => { location.replace('ctf-login.html?next=ctf-dashboard.html' + (e && e.status === 401 ? '&why=expired' : '')); });
  }

  const pick = (live, demo) => box => { box.innerHTML = '<p class="hint">Loading…</p>'; ready.then(ok => (ok ? live : demo)(box)); };
  window.YojoCTF = { registerForm: pick(liveRegister, registerForm), loginForm: pick(liveLogin, loginForm), dashboard: pick(liveDashboard, dashboard), me, KEY, EVENT, live: ready };
})();
