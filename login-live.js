/* Yojo login.html: LIVE mode (real API) on top of the page's demo views.
   Loaded before the page script. When the Yojo API answers (YojoAPI.available()), it swaps the demo flows for API
   calls and turns the demo helpers off; when it does not, the page keeps its browser-only demo unchanged.
   Call order: backend/docs/AUTH-JOURNEYS.md. The server does every check; this file only shows its answers.
   Sessions are httpOnly cookies set by the API; nothing secret is kept in localStorage. */
(function () {
  'use strict';
  var api = window.YojoAPI;
  if (!api) return;

  window.YojoLiveReady = api.available().then(function (ok) {
    if (!ok) return false;
    return api.init().then(function () { install(); return true; }, function () { return false; });
  });

  function install() {
    window.YojoLive = true;
    CFG.DEMO = false;
    CFG.ORG_DOMAIN = 'yojosolutions.com'; // display only; the server enforces STAFF_EMAIL_DOMAINS
    var fab = $('#demoFab'), demo = $('#demo');
    if (fab) fab.hidden = true;
    if (demo) demo.hidden = true;
    // LOCAL DEVELOPMENT ONLY: the prototype's "Demo accounts & inbox" panel, now against the real server (owner, 29 Oct).
    // GET /dev/demo exists only when the API runs locally; it lists the demo people, the codes sent to *.demo
    // addresses and the demo staff authenticator keys (public demo values). Elsewhere it answers 404 and nothing shows.
    api.get('/dev/demo').then(function (d) {
      if (!d || !d.enabled || !fab || !demo) return;
      DEMO = d;
      if (S.role === 'employee' && $('#stForm')) viewStaffLogin(); // switch an open staff screen to the prototype flow
      var nf = fab.cloneNode(true); fab.replaceWith(nf); fab = nf; // drop the prototype's own toggle (it would undo ours)
      fab.hidden = false;
      var poll = null, tick = null;
      var paint = function () {
        var staff = d.accounts.filter(function (a) { return a.totpSecret; });
        demo.innerHTML =
          '<div style="display:flex;justify-content:space-between;align-items:center"><h3>Demo accounts</h3><span class="note">local only</span></div>' +
          '<div>' + d.accounts.map(function (a, i) {
            return '<div class="acct"><span><code>' + esc(a.email) + '</code><small>' + esc(a.name) + ' · ' + esc(a.note) + '</small></span><button class="btn btn-sm" data-dmu="' + i + '">Use</button></div>';
          }).join('') + '</div>' +
          '<p class="note">Demo sign-in is just the email: no code or authenticator to type (they are checked for you). Students: "Yes" for Riya or Neha (or the student ID), "No" for Arjun or any new *.demo email. ' +
          'Staff: Employee → Trainer or Admin → the email above → Sign in. Real accounts still use their codes.</p>' +
          '<div><h3>Inbox (OTP and emails)</h3><div style="display:grid;gap:.5rem;margin-top:.5rem">' + (d.inbox.length ? d.inbox.slice(0, 8).map(function (m) {
            return '<div class="mail"><small class="note">To ' + esc(m.to) + ' · ' + new Date(m.at).toLocaleTimeString() + '</small><b>' + esc(m.subject) + '</b>' +
              (m.code ? '<span class="otp-code" style="font:700 1.3rem var(--f-mono,monospace);letter-spacing:.2em">' + esc(m.code) + '</span>' : '') +
              (m.link ? '<a class="note" href="' + esc(m.link) + '">Open link</a>' : '') + '</div>';
          }).join('') : '<p class="note">No emails yet. Request a code and it appears here.</p>') + '</div></div>' +
          '<div><h3>Authenticator app</h3><div style="margin-top:.4rem">' + staff.map(function (a) {
            return '<div class="totp-row"><code class="note">' + esc(a.email) + '</code><b data-dmt="' + esc(a.totpSecret) + '">' + totp(a.totpSecret) + '</b></div>';
          }).join('') + '<p class="note" id="dmTick"></p></div></div>';
        $$('[data-dmu]', demo).forEach(function (b) { b.addEventListener('click', function () { useAccount(d.accounts[+b.dataset.dmu]); }); });
      };
      var useAccount = function (a) {
        if (a.role === 'student') {
          selectRole('student');
          if (a.studentNumber) { S.ctx.gate = 'yes'; viewStudentLogin('yojo'); var i1 = $('#sl-id'); if (i1) { i1.value = a.email; i1.focus(); } }
          else { S.ctx.gate = 'no'; S.ctx.signup = { origin: 'new', p: {}, email: a.email, google: false, ticket: null }; viewSignup(); var i2 = $('#f-email'); if (i2) { i2.value = a.email; } }
        } else {
          selectRole('employee', a.role);
          var e1 = $('#st-mail'), p1 = $('#st-pw'); if (e1) e1.value = a.email; if (p1) p1.value = d.staffPassword; if (p1) p1.focus();
        }
      };
      var refresh = function () { api.get('/dev/demo').then(function (x) { if (x && x.enabled) { d = x; DEMO = x; if (!demo.hidden) paint(); } }, function () {}); };
      fab.addEventListener('click', function () {
        demo.hidden = !demo.hidden; fab.setAttribute('aria-expanded', String(!demo.hidden));
        clearInterval(poll); clearInterval(tick);
        if (demo.hidden) return;
        paint(); refresh();
        poll = setInterval(refresh, 4000); // new codes show up within a few seconds
        tick = setInterval(function () {
          $$('[data-dmt]', demo).forEach(function (b) { b.textContent = totp(b.dataset.dmt); });
          var t = $('#dmTick'); if (t) t.textContent = 'Codes refresh in ' + (30 - Math.floor(now() / 1000) % 30) + ' s';
        }, 1000);
      });
    }, function () {});
    var CANON = { viewStudentLogin: viewStudentLogin, viewSignup: viewSignup, logout: logout };
    var DEMO = null; // the local demo directory (GET /dev/demo); null on any real server

    /* ---------- helpers ---------- */
    var busy = function (form, on) { $$('button', form).forEach(function (b) { b.disabled = on; }); };
    function msgOf(e) {
      if (e && e.problem && e.problem.message) return e.problem.message;
      if (e && e.status === 429) return 'Too many tries. Wait a minute and try again.';
      if (e && e.status) return 'Something went wrong (' + e.status + '). Try again.';
      return 'Cannot reach the Yojo server. Check your connection and try again.';
    }
    var show = function (sel, e) { var el = $(sel); if (el) el.innerHTML = alertBox('err', esc(msgOf(e))); };
    var phone = function (v) { v = String(v || '').trim(); return (v[0] === '+' ? '+' : '') + v.replace(/\D/g, ''); };
    var split = function (v) { return String(v || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); };
    var LIVE_SUBMIT = {};
    // Capture phase on document runs before the page's own submit handlers, so the demo handler never sees the event.
    document.addEventListener('submit', function (e) {
      var h = LIVE_SUBMIT[e.target && e.target.id];
      if (!h) return;
      e.preventDefault(); e.stopImmediatePropagation();
      h(e.target);
    }, true);
    function googleUnavailable(sel, kind) {
      return function (e) {
        e.stopImmediatePropagation();
        if (DEMO) return demoGoogle(kind || 'student');
        $(sel).innerHTML = alertBox('info', 'Google sign-in is not switched on yet. Use the email option.');
      };
    }
    // LOCAL DEMO ONLY: the prototype's "Sign in with Google" account picker. Google is not connected, so the chosen
    // account continues with the real email-code sign-in (existing Yojo students) or sign-up (new accounts).
    function demoGoogle(kind) {
      var was = CFG.DEMO; CFG.DEMO = true; // shows the DEMO label on the picker
      // only people who exist on this server: the prototype's other staff are left out of the picker
      var full = db; db = Object.assign({}, db, { users: db.users.filter(function (u) { return u.role === 'student' || DEMO.accounts.some(function (x) { return x.email === u.email; }); }) });
      googleChooser(kind, function (email) {
        if (kind === 'staff') { selectRole('employee', S.staff); return demoStaffStart(email); }
        var known = DEMO && DEMO.accounts.filter(function (a) { return a.email === email; })[0];
        selectRole('student');
        if (known && known.studentNumber) {
          S.ctx.gate = 'yes'; viewStudentLogin('yojo');
          $('#sl-id').value = email; $('#slForm').requestSubmit();
        } else {
          S.ctx.gate = 'no'; S.ctx.signup = { origin: 'new', p: {}, email: email, google: false, ticket: null }; viewSignup();
          $('#seErr').innerHTML = alertBox('info', 'Google account chosen (demo). We send a one-time code to ' + esc(email) + ' to verify it.');
        }
      });
      CFG.DEMO = was; db = full;
    }
    // LOCAL DEMO ONLY: the prototype's staff sign-in for the demo staff: email code (in the demo inbox) → authenticator.
    function demoStaffStart(email) {
      var send = function () { return api.post('/dev/demo/staff/otp', { email: email }); };
      send().then(function (sent) {
        liveOtp(email, sent, send, function (cid, code) { return Promise.resolve().then(function () { demoStaffTotp(email, cid, code); }); }, viewStaffLogin, true);
      }, function (e) {
        if (e && e.status === 404) { realStaffLogin(email); $('#stErr').innerHTML = alertBox('info', 'This is not a demo staff account. Sign in with your password and authenticator.'); return; }
        show('#stErr', e);
      });
    }
    function demoStaffTotp(email, cid, code) {
      // LOCAL DEMO ONLY (OI-63): the demo staff's authenticator code is generated here from the demo secret, so no MFA screen
      var acct = DEMO && DEMO.accounts.filter(function (a) { return a.email === email && a.totpSecret; })[0];
      if (acct && !demoStaffTotp.manual) {
        flow().innerHTML = '<div style="display:grid;gap:1rem;justify-items:center;padding:2rem 0"><svg style="width:48px;height:48px"><use href="#logo-mark"/></svg><p class="mono">Opening your console…</p></div>';
        Promise.resolve(totp(acct.totpSecret)).then(function (t) {
          return api.post('/dev/demo/staff/verify', { challengeId: cid, code: code, totp: t });
        }).then(function () { landStaffLive(); }, function () { demoStaffTotp.manual = true; demoStaffTotp(email, cid, code); demoStaffTotp.manual = false; });
        return;
      }
      flow().innerHTML = backBtn() + '<form id="dmTotpForm" novalidate><div><h3>Authenticator code (MFA)</h3><p class="note">Email step done. Enter the 6-digit code from your authenticator app (the demo panel shows it).</p></div>' +
        '<div class="field"><label for="totp">Authenticator code</label><input id="totp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6-digit code"></div>' +
        '<div id="totpErr"></div><button class="btn btn-primary btn-block" type="submit">Verify and continue</button></form>';
      bindBack(viewStaffLogin); $('#totp').focus();
      LIVE_SUBMIT.dmTotpForm = function (form) {
        var t = ($('#totp').value || '').trim();
        if (!/^\d{6}$/.test(t)) { $('#totpErr').innerHTML = alertBox('err', 'Enter the 6-digit code.'); return; }
        busy(form, true);
        api.post('/dev/demo/staff/verify', { challengeId: cid, code: code, totp: t }).then(function () { landStaffLive(); }, function (e) {
          busy(form, false);
          if (e && e.problem && e.problem.code === 'TOTP_INVALID') { $('#totp').value = ''; show('#totpErr', e); return; }
          viewStaffLogin(); $('#stErr').innerHTML = alertBox('err', esc(msgOf(e)) + ' Request a new code.');
        });
      };
    }

    /* ---------- one-time code screen (email OTP) ----------
       LOCAL DEMO ONLY (owner, 30 Oct; OI-63, remove before production): for demo accounts (*.demo addresses, or a demo
       student ID) the page reads the code from the local demo inbox and verifies it straight away, so sign-in is just
       "choose the email". The server still runs the full OTP check. Real accounts never get an inbox code, so they see
       the normal code screen. Nothing changes when the dev demo service is off (production). */
    function demoEmailOf(q) {
      if (!DEMO) return null;
      var a = DEMO.accounts.filter(function (x) { return x.email === q || x.studentNumber === q; })[0];
      if (a) return a.email;
      return /\.demo$/i.test(String(q || '')) ? q : null;
    }
    function demoInboxCode(email, since) {
      var tries = 0;
      return new Promise(function (res) {
        (function poll() {
          api.get('/dev/demo').then(function (d) {
            var m = (d.inbox || []).filter(function (x) { return x.to === email && x.code && Date.parse(x.at) >= since - 5000; })
              .sort(function (a, b) { return Date.parse(b.at) - Date.parse(a.at); })[0];
            if (m) return res(m.code);
            if (++tries < 8) setTimeout(poll, 400); else res(null);
          }, function () { res(null); });
        })();
      });
    }
    function liveOtp(email, sent, resend, verify, onBack, staffNote) {
      var to = demoEmailOf(email), since = Date.now() - 1000;
      if (!to) return liveOtpScreen(email, sent, resend, verify, onBack, staffNote);
      flow().innerHTML = '<div style="display:grid;gap:1rem;justify-items:center;padding:2rem 0"><svg style="width:48px;height:48px"><use href="#logo-mark"/></svg><p class="mono">Signing you in as ' + esc(to) + '…</p><p class="note">Demo sign-in: the one-time code is checked for you.</p></div>';
      demoInboxCode(to, since).then(function (code) {
        if (!code) return liveOtpScreen(email, sent, resend, verify, onBack, staffNote);
        return Promise.resolve(verify(sent.challengeId, code)).catch(function (e) {
          liveOtpScreen(email, sent, resend, verify, onBack, staffNote); show('#otpErr', e);
        });
      });
    }
    function liveOtpScreen(email, sent, resend, verify, onBack, staffNote) {
      var exp = Date.now() + (sent.expiresInSec || 300) * 1000, canAt = Date.now() + (sent.resendAfterSec || 30) * 1000;
      flow().innerHTML = backBtn() + '<form id="otpForm" novalidate>' +
        '<div><h3>Check your email</h3><p class="note">' + (staffNote ? 'If this account exists, we sent' : 'We sent') + ' a 6-digit code to <b style="color:var(--text)">' + esc(email) + '</b>.</p></div>' +
        '<div class="otp" role="group" aria-label="6-digit code">' + Array.from({ length: 6 }, function (_, i) { return '<input inputmode="numeric" autocomplete="' + (i ? 'off' : 'one-time-code') + '" maxlength="' + (i ? 1 : 6) + '" aria-label="Digit ' + (i + 1) + '">'; }).join('') + '</div>' +
        '<div class="otp-meta"><span id="otpExp"></span><span><button type="button" class="linkbtn" id="resend" disabled>Resend code</button> <span id="resendIn"></span></span></div>' +
        '<div id="otpErr"></div><button class="btn btn-primary btn-block" type="submit" id="otpGo">Verify</button></form>';
      bindBack(function () { clearInterval(S.otpTimer); onBack(); });
      var ins = $$('.otp input'); ins[0].focus();
      ins.forEach(function (inp, i) {
        inp.addEventListener('input', function () { var v = inp.value.replace(/\D/g, ''); if (v.length > 1) { v.split('').slice(0, 6 - i).forEach(function (d, j) { ins[i + j].value = d; }); ins[Math.min(5, i + v.length - 1)].focus(); return; } inp.value = v; if (v && ins[i + 1]) ins[i + 1].focus(); });
        inp.addEventListener('keydown', function (ev) { if (ev.key === 'Backspace' && !inp.value && ins[i - 1]) ins[i - 1].focus(); });
      });
      var tick = function () {
        var left = Math.max(0, exp - Date.now()), wait = Math.max(0, canAt - Date.now());
        $('#otpExp').textContent = left ? 'Expires in ' + Math.floor(left / 60000) + ':' + String(Math.floor(left / 1000) % 60).padStart(2, '0') : 'Code expired';
        $('#resend').disabled = wait > 0; $('#resendIn').textContent = wait > 0 ? 'in ' + Math.ceil(wait / 1000) + ' s' : '';
      };
      clearInterval(S.otpTimer); S.otpTimer = setInterval(function () { if (!document.body.contains($('#otpExp'))) return clearInterval(S.otpTimer); tick(); }, 500); tick();
      $('#resend').addEventListener('click', function () {
        resend().then(function (r) {
          sent = r; exp = Date.now() + (r.expiresInSec || 300) * 1000; canAt = Date.now() + (r.resendAfterSec || 30) * 1000;
          ins.forEach(function (x) { x.value = ''; }); ins[0].focus(); $('#otpGo').disabled = false;
          $('#otpErr').innerHTML = alertBox('info', 'A new code was sent. Older codes no longer work.'); tick();
        }, function (e) { show('#otpErr', e); });
      });
      LIVE_SUBMIT.otpForm = function (form) {
        var code = ins.map(function (x) { return x.value; }).join('');
        if (!/^\d{6}$/.test(code)) { $('#otpErr').innerHTML = alertBox('err', 'Enter all 6 digits.'); return; }
        busy(form, true);
        verify(sent.challengeId, code).then(function (r) { clearInterval(S.otpTimer); return r; }).catch(function (e) {
          busy(form, false); ins.forEach(function (x) { x.value = ''; }); ins[0].focus(); show('#otpErr', e);
        });
      };
    }

    /* ======================= STUDENT ======================= */
    viewStudentLogin = function (mode) {
      CANON.viewStudentLogin(mode);
      if (DEMO) { // demo: sign-in is just the email (OI-63)
        var go = $('#slForm button[type=submit]'); if (go) go.textContent = 'Sign in';
        $$('.or').forEach(function (o) { if (/OTP/.test(o.textContent)) o.textContent = 'OR SIGN IN WITH YOUR EMAIL'; });
      }
      var yojo = mode === 'yojo';
      $('#gBtn').addEventListener('click', googleUnavailable('#slErr', 'student'), true);
      LIVE_SUBMIT.slForm = function (form) {
        var q = $('#sl-id').value.trim(), err = function (m) { $('#sl-id').setAttribute('aria-invalid', 'true'); $('#slErr').innerHTML = alertBox('err', m); };
        if (!q) return err(yojo ? 'Enter your Yojo email or student ID.' : 'Enter your email.');
        if (!yojo && !isEmail(q)) return err('Enter a valid email address.');
        var body = yojo ? { identifier: q, gate: 'yojo' } : { email: q, gate: 'open', purpose: 'login' };
        var send = function () { return api.student.sendOtp(body); };
        busy(form, true);
        send().then(function (sent) {
          liveOtp(isEmail(q) ? q : 'the email on file for ' + q, sent, send, function (cid, code) {
            return api.student.verifyOtp(cid, code, yojo ? 'yojo' : 'open').then(function (r) {
              if (r.next === 'signup') {
                S.ctx.gate = 'no'; S.ctx.signup = { origin: 'new', p: {}, email: q, google: false, ticket: r.signupTicket };
                viewSignup(); $('#suErr').innerHTML = alertBox('info', r.upgrade === 'ctf'
                  ? 'This email has a Yojo CTF account. Your email is verified: add your student details to join the Academy on the same account. Your CTF login does not change.'
                  : 'No account exists for this email yet. Your email is verified: fill in your details to create one.');
                return;
              }
              afterStudentLogin();
            });
          }, function () { viewStudentLogin(mode); });
        }, function (e) { busy(form, false); show('#slErr', e); });
      };
    };

    // Institution student tab: the institution picked from the list, sent by name (the server has no list yet)
    var instPicked = function (form) { var x = form && form.elements.inst; return x && x.value ? x.options[x.selectedIndex].text.replace(/\s*\(@[^)]*\)\s*$/, '').trim() : undefined; };
    // "No" path (owner, 29 Oct): verify the email first. An existing account signs straight in, so nobody fills the
    // details again; only a new email gets the details form, once (the details are then saved and locked).
    function signupEmailStep(pre) {
      landingMode(false); setHead('Create new account', 'Your details also build your resume');
      flow().innerHTML = backBtn() + '<form id="seForm" novalidate><div><h3>Create your account</h3><p class="note">' + (DEMO ? 'Enter your email. Already have an account with it? You go straight in, with nothing to fill again.' : 'First we verify your email with a one-time code. Already have an account with it? You go straight in, with nothing to fill again.') + '</p></div>' +
        '<div class="field"><label for="se-e">Email</label><input id="se-e" type="email" autocomplete="email" placeholder="you@example.com" value="' + esc(pre || '') + '"></div>' +
        '<div id="seErr"></div><button class="btn btn-primary btn-block" type="submit">' + (DEMO ? 'Continue' : 'Send code') + '</button></form>' +
        '<div class="or" style="margin:1rem 0">OR</div><button class="btn google" type="button" id="gBtn">' + googleIcon() + 'Sign up with Google</button>';
      bindBack(viewGate);
      $('#gBtn').addEventListener('click', googleUnavailable('#seErr', 'student'), true);
      LIVE_SUBMIT.seForm = function (form) {
        var em = lc($('#se-e').value);
        if (!isEmail(em)) { $('#seErr').innerHTML = alertBox('err', 'Enter a valid email address.'); return; }
        var body = { email: em, gate: 'open', purpose: 'signup' }, send = function () { return api.student.sendOtp(body); };
        busy(form, true);
        send().then(function (sent) {
          liveOtp(em, sent, send, function (cid, code) {
            return api.student.verifyOtp(cid, code, 'open').then(function (r) {
              if (r.next === 'done') { toast('Welcome back: you already have an account.'); return afterStudentLogin(); }
              S.ctx.gate = 'no'; S.ctx.signup = { origin: (S.ctx.signup && S.ctx.signup.origin) || 'new', p: {}, email: em, google: false, ticket: r.signupTicket };
              viewSignup();
              $('#suErr').innerHTML = alertBox('info', r.upgrade === 'ctf'
                ? 'This email has a Yojo CTF account. Add your student details to join the Academy on the same account.'
                : 'Email verified. Fill in your details once: they are saved, locked and turned into your resume.');
            });
          }, function () { signupEmailStep(em); });
        }, function (e) { busy(form, false); show('#seErr', e); });
      };
    }

    viewSignup = function (prefill) {
      var su0 = S.ctx.signup;
      if (!(su0 && su0.ticket)) return signupEmailStep((prefill && prefill.email) || (su0 && su0.email));
      CANON.viewSignup(prefill);
      // The server has no institution list yet: every learner types an institution name (see OPEN-ITEMS).
      // "New Yojo learner | Institution student" stays as in the prototype; the institution is sent by name.
      if (S.ctx.signup && S.ctx.signup.ticket) $('#f-email').readOnly = true; // already verified by OTP
      var g = $('#gBtn'); if (g) g.addEventListener('click', googleUnavailable('#suErr', 'student'), true);
      LIVE_SUBMIT.suForm = function (form) {
        var su = S.ctx.signup, p = su.p, fd = new FormData(form), errs = [];
        if (!su.ticket) su.email = String(fd.get('email') || '').trim();
        [].concat(ALL_FIELDS, FIELDS.guardian).forEach(function (f) { if (fd.has(f.k)) p[f.k] = String(fd.get(f.k)).trim(); });
        p.parental = !!fd.get('parental');
        var email = lc(su.email), E = $('#f-email');
        E.setAttribute('aria-invalid', 'false');
        if (!isEmail(email)) { errs.push('Enter a valid email address.'); E.setAttribute('aria-invalid', 'true'); }
        var minor = age(p.dob) !== null && age(p.dob) < 18;
        errs.push.apply(errs, readFields(form, [].concat(FIELDS.basic, minor ? FIELDS.guardian : [], FIELDS.education, FIELDS.resume), p).errs);
        if (minor && !p.parental) errs.push('Parental consent is required for students under 18.');
        if (!form.elements.terms.checked) errs.push('Accept the Terms, Privacy and Acceptable Use policies to continue.');
        if (errs.length) { $('#suErr').innerHTML = alertBox('err', errs.length === 1 ? errs[0] : '<span>Fix these to continue:<br>• ' + Array.from(new Set(errs)).join('<br>• ') + '</span>'); var bad = $('[aria-invalid="true"]', form); if (bad) bad.focus(); return; }
        var marketing = form.elements.marketing.checked;
        var create = function (ticket) {
          var body = {
            signupTicket: ticket, name: p.name, institutionName: p.institution || instPicked(form), city: p.city || undefined, dob: p.dob || undefined,
            consents: { terms: true, privacy: true, aup: true, marketing: marketing, parental: minor ? true : undefined },
            guardian: minor ? { name: p.gName, relation: p.gRel, phone: phone(p.gPhone) } : undefined,
          };
          return api.student.signup(body).then(function () {
            var prof = { phone: phone(p.phone), eduLevel: p.eduLevel || undefined, stream: p.stream || undefined, objective: p.objective || undefined };
            if (/^\d{4}$/.test(p.gradYear)) prof.gradYear = +p.gradYear;
            if (/^\d+(\.\d{1,2})?$/.test(p.cgpa) && +p.cgpa <= 10) prof.cgpa = +p.cgpa;
            if (split(p.skills).length) prof.skills = split(p.skills);
            if (split(p.certs).length) prof.certifications = split(p.certs);
            Object.keys(prof).forEach(function (k) { if (prof[k] === undefined) delete prof[k]; });
            S.ctx.signup = null;
            window.YojoInsight && YojoInsight.track('signup_completed', { feature: 'new' });
            // Profile details are saved after the account exists; a failure here only leaves them for onboarding.
            return api.student.updateMe(prof).catch(function () {}).then(afterStudentLogin);
          });
        };
        if (su.ticket) { busy(form, true); create(su.ticket).catch(function (e) { busy(form, false); if (e.problem && e.problem.code === 'SIGNUP_TICKET_INVALID') su.ticket = null; show('#suErr', e); }); return; }
        var body = { email: email, gate: 'open', purpose: 'signup' }, send = function () { return api.student.sendOtp(body); };
        busy(form, true);
        send().then(function (sent) {
          liveOtp(email, sent, send, function (cid, code) {
            return api.student.verifyOtp(cid, code, 'open').then(function (r) {
              if (r.next === 'done') { toast('An account already exists for this email. You are now signed in.'); return afterStudentLogin(); }
              su.ticket = r.signupTicket;
              return create(r.signupTicket).catch(function (e) { viewSignup(); show('#suErr', e); });
            });
          }, function () { viewSignup(); });
        }, function (e) { busy(form, false); show('#suErr', e); });
      };
    };

    // Local mirror of the signed-in student for the page's quiz (the questionnaire has no server API yet).
    function mirror(me) {
      var u = findUser(me.email);
      if (!u) { u = { email: me.email, id: me.code, role: 'student', origin: me.origin, profile: {}, category: null, status: 'active' }; db.users.push(u); }
      var sp = me.studentProfile || {};
      u.profile = Object.assign({}, u.profile, { name: sp.name || me.displayName || '', dob: sp.dob ? String(sp.dob).slice(0, 10) : '', city: sp.city || '', phone: me.phone || '' });
      save(); return u;
    }
    function afterStudentLogin() {
      return api.me().then(function (me) {
        if (me.role !== 'student') return landStaffLive(me);
        var u = mirror(me);
        session = { email: me.email, role: 'student', at: now(), live: true }; store.sset(SESSION_KEY, session);
        store.set('yojo_demo_shared_session', { email: me.email, at: now() }); // read by academy.html (display only)
        return api.student.missingFields().then(function (m) {
          var need = (m.missing || []).map(function (k) { return k === 'certifications' ? 'certs' : k === 'guardian.name' ? 'gName' : k === 'guardian.relation' ? 'gRel' : k === 'guardian.phone' ? 'gPhone' : k; });
          var fields = [].concat(ALL_FIELDS, FIELDS.guardian).filter(function (f) { return need.indexOf(f.k) >= 0 && f.k !== 'institution'; });
          if (fields.some(function (f) { return f.req; })) return liveMissing(u, fields);
          // The career path lives on the server: the Academy asks for it first (optional 15-question quiz, or a direct pick).
          return api.get('/student/career-quiz').then(function (q) {
            u.category = q.path; save();
            // A new (self-signed-up) student with no quiz and no team yet: quiz or skip, then the team, once (server flag).
            if (q.required) return liveQuizGate(u, q);
            landStudent(u, true);
            if (!q.path) { var lp = $('#landPath'); if (lp) lp.innerHTML = 'Your path: not chosen yet. You can pick it, or take the career quiz, from your Academy.'; }
          });
        });
      }).catch(function (e) { flow().innerHTML = alertBox('err', esc(msgOf(e))); });
    }
    /* ---------- new student onboarding: career quiz (or skip) → team → portal (owner, 29 Oct) ---------- */
    var TEAM = { Offensive: ['Red Team', 'var(--off)', 'Offensive: ethical hacking, finding weaknesses before attackers do'], Defensive: ['Blue Team', 'var(--def)', 'Defensive: watching, detecting and stopping attacks'], GRC: ['Green Team', 'var(--grc)', 'GRC: policies, risk and audits that keep a company secure'] };
    function liveQuizGate(u, q) {
      landingMode(false); $('#tabsWrap').hidden = true;
      flow().innerHTML = '<div class="card-head"><svg><use href="#logo-mark"/></svg><div><h2>Find your path</h2><p class="note">A short quiz before your portal opens</p></div></div>' +
        '<div style="display:grid;gap:1rem"><ul class="note" style="margin:0;padding-left:1.1rem;display:grid;gap:.3rem">' +
        '<li><b style="color:var(--text)">' + q.rules.questions + ' real-life scenarios</b>, about 5 minutes</li>' +
        '<li><b style="color:var(--text)">No cyber knowledge needed</b>, no right or wrong answers</li>' +
        '<li>Result: <b style="color:var(--off)">Offensive</b>, <b style="color:var(--def)">Defensive</b> or <b style="color:var(--grc)">GRC</b>, then you pick your team</li>' +
        '<li>Asked once. You can retake it later from your Academy.</li></ul>' +
        '<button class="btn btn-primary btn-block" type="button" id="qStart">Start the quiz</button>' +
        '<button class="btn btn-ghost btn-block" type="button" id="qSkip">Skip the quiz and choose my team</button>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-logout>Log out</button></div>';
      var answers = [];
      $('#qStart').addEventListener('click', function () { liveQuestion(u, q, answers, 0); });
      $('#qSkip').addEventListener('click', function () { liveTeam(u, null); });
      bindLogout();
    }
    function liveQuestion(u, q, answers, i) {
      var qs = q.questions, x = qs[i];
      flow().innerHTML = '<div class="otp-meta"><span>Calibrating your mission board...</span><span style="color:var(--green)">' + (i + 1) + ' / ' + qs.length + '</span></div>' +
        '<div class="steps" aria-hidden="true" style="margin-top:.5rem">' + qs.map(function (_, k) { return '<i class="' + (k <= i ? 'on' : '') + '"></i>'; }).join('') + '</div>' +
        '<h2 style="font-size:1.15rem;margin:.8rem 0 1rem" id="qText">' + esc(x.scenario) + '</h2>' +
        '<div class="choice qopts" role="radiogroup" aria-labelledby="qText" style="grid-template-columns:1fr">' + x.options.map(function (o) {
          return '<button type="button" role="radio" data-a="' + esc(o.id) + '" aria-pressed="' + (answers[i] === o.id) + '" aria-checked="' + (answers[i] === o.id) + '"><span style="color:var(--text);font-size:.95rem">' + esc(o.text) + '</span></button>';
        }).join('') + '</div><div id="qErr" style="margin-top:.6rem"></div>' +
        '<div style="display:flex;gap:.5rem;justify-content:space-between;margin-top:1rem"><button class="btn btn-sm" type="button" id="qBack"' + (i ? '' : ' disabled') + '>Back</button>' +
        '<button class="btn btn-sm btn-primary" type="button" id="qNext">' + (i === qs.length - 1 ? 'See my result' : 'Next') + '</button></div>';
      $$('[data-a]').forEach(function (b) { b.addEventListener('click', function () {
        answers[i] = b.dataset.a; $$('[data-a]').forEach(function (y) { y.setAttribute('aria-pressed', String(y === b)); y.setAttribute('aria-checked', String(y === b)); }); $('#qErr').innerHTML = '';
      }); });
      $('#qBack').addEventListener('click', function () { liveQuestion(u, q, answers, i - 1); });
      $('#qNext').addEventListener('click', function () {
        if (!answers[i]) { $('#qErr').innerHTML = alertBox('info', 'Pick the answer closest to what you would do.'); return; }
        if (i < qs.length - 1) return liveQuestion(u, q, answers, i + 1);
        flow().innerHTML = '<div style="display:grid;gap:1rem;justify-items:center;padding:2rem 0"><svg style="width:56px;height:56px"><use href="#logo-mark"/></svg><p class="mono">Calculating your cyber profile...</p></div>';
        api.post('/student/career-quiz', { answers: answers }).then(function (r) { liveTeam(u, r); }, function (e) { liveQuestion(u, q, answers, i); show('#qErr', e); });
      });
    }
    function liveTeam(u, r) {
      var pick = r && r.suggested ? r.suggested : null;
      flow().innerHTML = '<div class="card-head"><svg><use href="#logo-mark"/></svg><div><h2>' + (r ? 'Your cyber profile is ready' : 'Choose your team') + '</h2><p class="note">' + (r ? 'Suggested from your answers. You choose.' : 'Pick the team you are most interested in.') + '</p></div></div>' +
        '<div style="display:grid;gap:1rem">' +
        (r ? '<div class="meters">' + ['Offensive', 'Defensive', 'GRC'].map(function (k) { return '<div class="meter"><div class="otp-meta"><span>' + k + ' (' + TEAM[k][0] + ')</span><span>' + r.percentages[k] + '%</span></div><div class="bar"><i style="width:' + r.percentages[k] + '%;background:' + TEAM[k][1] + '"></i></div></div>'; }).join('') + '</div>' +
          '<p class="note">Suggested: <b style="color:var(--text)">' + esc(r.suggested) + ' (' + TEAM[r.suggested][0] + ')</b>' + (r.tiedWith && r.tiedWith.length ? ' · tied with ' + esc(r.tiedWith.join(', ')) : '') + '</p>' : '') +
        '<div class="choice" role="radiogroup" aria-label="Your team" style="grid-template-columns:1fr">' + ['Offensive', 'Defensive', 'GRC'].map(function (k) {
          return '<button type="button" role="radio" data-team="' + k + '" aria-pressed="' + (pick === k) + '" aria-checked="' + (pick === k) + '"><b style="color:' + TEAM[k][1] + '">' + TEAM[k][0] + '</b><span class="note">' + esc(TEAM[k][2]) + '</span></button>';
        }).join('') + '</div><div id="tmErr"></div>' +
        '<button class="btn btn-primary btn-block" type="button" id="enterMain">Confirm team and enter Student Academy</button>' +
        '<p class="note">A starting point, not a lock-in. You can change your team later in your Academy.</p></div>';
      $$('[data-team]').forEach(function (b) { b.addEventListener('click', function () {
        pick = b.dataset.team; $$('[data-team]').forEach(function (y) { y.setAttribute('aria-pressed', String(y === b)); y.setAttribute('aria-checked', String(y === b)); });
      }); });
      $('#enterMain').addEventListener('click', function () {
        if (!pick) { $('#tmErr').innerHTML = alertBox('info', 'Pick a team to continue.'); return; }
        var w = openTab(ACADEMY_URL); // in the click itself, so the browser allows the new tab
        busy(flow(), true);
        api.post('/student/career-path', { path: pick }).then(function () {
          u.category = pick; save(); landStudent(u, false);
          var m = $('#landMsg'); if (m) m.textContent = w ? 'Your Student Academy opened in a new tab.' : 'Open your Student Academy in a new tab.';
        }, function (e) { busy(flow(), false); show('#tmErr', e); if (w) try { w.close(); } catch (x) {} });
      });
    }

    function liveMissing(u, fields) {
      landingMode(false); $('#tabsWrap').hidden = true;
      flow().innerHTML = '<div class="card-head"><svg><use href="#logo-mark"/></svg><div><h2>Welcome, ' + esc((u.profile.name || '').split(' ')[0] || 'Operative') + '</h2><p class="note">Profile incomplete. Fill in the missing details (about 3 min).</p></div></div>' +
        '<form id="missForm" novalidate>' + alertBox('warn', fields.length + ' ' + (fields.length === 1 ? 'detail is' : 'details are') + ' missing for your resume.') +
        '<div class="grid2">' + fields.map(function (f) { return fieldHTML(f, u.profile[f.k]); }).join('') + '</div><div id="missErr"></div>' +
        '<button class="btn btn-primary btn-block" type="submit">Save and continue</button></form>';
      LIVE_SUBMIT.missForm = function (form) {
        var r = readFields(form, fields, u.profile);
        if (r.errs.length) { $('#missErr').innerHTML = alertBox('err', r.errs[0]); return; }
        var o = r.out, body = {};
        ['name', 'dob', 'city', 'eduLevel', 'stream', 'objective'].forEach(function (k) { if (o[k]) body[k] = o[k]; });
        if (o.phone) body.phone = phone(o.phone);
        if (/^\d{4}$/.test(o.gradYear || '')) body.gradYear = +o.gradYear;
        if (/^\d+(\.\d{1,2})?$/.test(o.cgpa || '') && +o.cgpa <= 10) body.cgpa = +o.cgpa;
        if (o.skills) body.skills = split(o.skills);
        if (o.certs) body.certifications = split(o.certs);
        if (o.gName || o.gRel || o.gPhone) body.guardian = { name: o.gName, relation: o.gRel, phone: phone(o.gPhone) };
        busy(form, true);
        api.student.updateMe(body).then(afterStudentLogin, function (e) { busy(form, false); show('#missErr', e); });
      };
    }

    /* ======================= STAFF ======================= */
    viewStaffLogin = function () {
      if (!DEMO) return realStaffLogin();
      var tr = S.staff === 'trainer';
      setHead('Staff console access', tr ? 'Trainer login' : 'Admin login');
      flow().innerHTML = '<form id="stForm" novalidate>' +
        '<div class="field"><label for="st-mail">Organisation email</label><input id="st-mail" type="email" autocomplete="username" placeholder="' + (tr ? 'trainer' : 'platform.admin') + '@yojo.demo"></div>' +
        '<div id="stErr"></div><button class="btn btn-primary btn-block" type="submit">Sign in</button></form>' +
        '<div class="or" style="margin:1rem 0">OR</div><button class="btn google" type="button" id="gBtn">' + googleIcon() + 'Sign in with Google Workspace</button>' +
        '<p class="note" style="margin-top:1rem">Demo sign-in: enter the demo email and you are in (codes are checked for you). No public ' + (tr ? 'trainer' : 'admin') + ' sign-up: accounts are created by a Platform Admin. <button type="button" class="linkbtn" id="reqAccess">Request access</button></p>' +
        '<p class="note" style="margin-top:.4rem"><button type="button" class="linkbtn" id="usePw">Real staff account? Sign in with password</button></p>';
      $('#reqAccess').addEventListener('click', viewRequestAccess);
      $('#usePw').addEventListener('click', function () { realStaffLogin(); });
      $('#gBtn').addEventListener('click', googleUnavailable('#stErr', 'staff'), true);
      LIVE_SUBMIT.stForm = function (form) {
        var email = lc($('#st-mail').value);
        if (!isEmail(email)) { $('#stErr').innerHTML = alertBox('err', 'Enter your organisation email.'); return; }
        busy(form, true); demoStaffStart(email);
      };
    };
    var realStaffLogin = function (prefill) {
      var tr = S.staff === 'trainer';
      setHead('Staff console access', tr ? 'Trainer login' : 'Admin login');
      flow().innerHTML = '<form id="stForm" novalidate>' +
        '<div class="field"><label for="st-mail">Organisation email</label><input id="st-mail" type="email" autocomplete="username" placeholder="name@' + CFG.ORG_DOMAIN + '"></div>' +
        '<div class="field"><label for="st-pw">Password</label><input id="st-pw" type="password" autocomplete="current-password"></div>' +
        '<div id="stErr"></div><button class="btn btn-primary btn-block" type="submit">Continue</button></form>' +
        '<p class="note" style="margin-top:.6rem;text-align:right"><button type="button" class="linkbtn" id="forgot">Forgot password?</button></p>' +
        '<p class="note" style="margin-top:1rem">An authenticator (MFA) code is required after the password. No public ' + (tr ? 'trainer' : 'admin') + ' sign-up: accounts are created by invitation from a Platform Admin. <button type="button" class="linkbtn" id="reqAccess">Request access</button></p>';
      if (prefill) $('#st-mail').value = prefill;
      $('#reqAccess').addEventListener('click', viewRequestAccess);
      $('#forgot').addEventListener('click', viewForgot);
      LIVE_SUBMIT.stForm = function (form) {
        var email = lc($('#st-mail').value), pw = $('#st-pw').value;
        if (!isEmail(email) || !pw) { $('#stErr').innerHTML = alertBox('err', 'Enter your organisation email and password.'); return; }
        busy(form, true);
        api.staff.login(email, pw).then(function (r) {
          if (r.next === 'totp') return viewTotp({ challengeId: r.challengeId, role: S.staff }, 'password');
          liveOnboarding(r.onboarding);
        }, function (e) { busy(form, false); show('#stErr', e); });
      };
    };
    viewTotp = function (c) {
      var recovery = false;
      var draw = function () {
        flow().innerHTML = backBtn() + '<form id="totpForm" novalidate><div><h3>Authenticator code (MFA)</h3><p class="note">Password accepted. ' + (recovery ? 'Enter one of your recovery codes.' : 'Enter the 6-digit code from your authenticator app.') + '</p></div>' +
          '<div class="field"><label for="totp">' + (recovery ? 'Recovery code' : 'Authenticator code') + '</label><input id="totp" ' + (recovery ? 'autocomplete="off"' : 'inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6-digit code"') + ' class="mono"></div>' +
          '<div id="totpErr"></div><button class="btn btn-primary btn-block" type="submit">Verify and continue</button>' +
          '<p class="note" style="margin-top:.6rem;text-align:center"><button type="button" class="linkbtn" id="useRec">' + (recovery ? 'Use the authenticator app instead' : 'Lost your phone? Use a recovery code') + '</button></p></form>';
        bindBack(viewStaffLogin); $('#totp').focus();
        $('#useRec').addEventListener('click', function () { recovery = !recovery; draw(); });
      };
      draw();
      LIVE_SUBMIT.totpForm = function (form) {
        var v = $('#totp').value.trim();
        if (!recovery && !/^\d{6}$/.test(v)) { $('#totpErr').innerHTML = alertBox('err', 'Enter the 6-digit code.'); return; }
        busy(form, true);
        api.staff.totp(c.challengeId, recovery ? undefined : v, recovery ? v : undefined).then(function (r) {
          r.next === 'done' ? landStaffLive() : api.staff.onboarding().then(liveOnboarding);
        }, function (e) { busy(form, false); $('#totp').value = ''; show('#totpErr', e); });
      };
    };
    function viewForgot() {
      setHead('Reset your password', 'Staff accounts');
      flow().innerHTML = backBtn() + '<form id="fpForm" novalidate><div class="field"><label for="fp-e">Organisation email</label><input id="fp-e" type="email" autocomplete="username"></div><div id="fpErr"></div><button class="btn btn-primary btn-block" type="submit">Send reset link</button></form>';
      bindBack(viewStaffLogin);
      LIVE_SUBMIT.fpForm = function (form) {
        var em = lc($('#fp-e').value);
        if (!isEmail(em)) { $('#fpErr').innerHTML = alertBox('err', 'Enter your organisation email.'); return; }
        busy(form, true);
        api.staff.forgotPassword(em).then(function () {
          flow().innerHTML = alertBox('ok', 'If a staff account exists for this email, a reset link is on its way (valid 30 minutes).') + '<button class="btn btn-ghost btn-block" type="button" style="margin-top:1rem" id="again">Back to login</button>';
          $('#again').addEventListener('click', viewStaffLogin);
        }, function (e) { busy(form, false); show('#fpErr', e); });
      };
    }
    // 16 characters from the browser's secure random source, always with upper, lower, digit and symbol (server policy).
    function suggestPassword() {
      var sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*-_=+?'], all = sets.join('');
      var rnd = function (n) { var b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] % n; };
      var out = sets.map(function (x) { return x[rnd(x.length)]; });
      while (out.length < 16) out.push(all[rnd(all.length)]);
      for (var i = out.length - 1; i > 0; i--) { var j = rnd(i + 1), t = out[i]; out[i] = out[j]; out[j] = t; }
      return out.join('');
    }
    // Emailed links: login.html#invite=…, #reset=…, #mfa-reenrol=… (hash, so the token never reaches a server log)
    function viewTokenPassword(kind, token) {
      var titles = { invite: ['Accept your invitation', 'Choose a password for your staff account'], reset: ['Choose a new password', 'Staff accounts'], 'mfa-reenrol': ['Set up a new authenticator', 'Confirm your password first'] };
      landingMode(false); $('#tabsWrap').hidden = true; setHead(titles[kind][0], titles[kind][1]);
      var twoPw = kind !== 'mfa-reenrol';
      flow().innerHTML = '<form id="tkForm" novalidate><div><h3>' + titles[kind][0] + '</h3><p class="note">' + (twoPw ? 'At least 10 characters. Avoid common words and your name.' : 'Enter your current password.') + '</p></div>' +
        '<div class="field"><label for="tk-p1">' + (twoPw ? 'New password' : 'Password') + '</label><input id="tk-p1" type="password" autocomplete="' + (twoPw ? 'new-password' : 'current-password') + '"></div>' +
        (twoPw ? '<div class="field"><label for="tk-p2">Confirm password</label><input id="tk-p2" type="password" autocomplete="new-password"></div>' +
          '<p class="note" id="tkSuggestNote">Type your own password, or <button class="btn btn-ghost btn-sm" type="button" id="tkSuggest">suggest a strong one</button></p>' : '') +
        (kind === 'reset' ? '<div class="field"><label for="tk-c">Authenticator code (if you set one up)</label><input id="tk-c" inputmode="numeric" maxlength="6" class="mono" autocomplete="one-time-code"></div>' : '') +
        '<div id="tkErr"></div><button class="btn btn-primary btn-block" type="submit">Continue</button></form>';
      // OI-12: people choose their own password; a random one is only a suggestion they can take, change or ignore.
      if (twoPw) $('#tkSuggest').addEventListener('click', function () {
        var pw = suggestPassword();
        ['#tk-p1', '#tk-p2'].forEach(function (id) { $(id).value = pw; $(id).type = 'text'; });
        $('#tkSuggestNote').innerHTML = 'Suggested password filled in and shown. Save it in your password manager, or type your own instead. <button class="btn btn-ghost btn-sm" type="button" id="tkHide">Hide</button>';
        $('#tkHide').addEventListener('click', function () { ['#tk-p1', '#tk-p2'].forEach(function (id) { $(id).type = 'password'; }); });
      });
      LIVE_SUBMIT.tkForm = function (form) {
        var p1 = $('#tk-p1').value;
        if (twoPw && p1.length < 10) { $('#tkErr').innerHTML = alertBox('err', 'Use at least 10 characters.'); return; }
        if (twoPw && p1 !== $('#tk-p2').value) { $('#tkErr').innerHTML = alertBox('err', 'The two passwords do not match.'); return; }
        busy(form, true);
        var done = function (e) { busy(form, false); show('#tkErr', e); };
        if (kind === 'invite') api.staff.acceptInvite(token, p1).then(function (r) { liveOnboarding(r.onboarding); }, done);
        else if (kind === 'mfa-reenrol') api.staff.mfaReenrol(token, p1).then(function (r) { liveOnboarding(r.onboarding); }, done);
        else {
          var c = ($('#tk-c').value || '').trim();
          api.staff.resetPassword({ token: token, newPassword: p1, code: /^\d{6}$/.test(c) ? c : undefined }).then(function () {
            $('#tabsWrap').hidden = false; selectRole('employee', S.staff);
            $('#flow').insertAdjacentHTML('afterbegin', alertBox('ok', 'Password changed. Sign in with your new password.'));
          }, done);
        }
      };
    }

    /* Staff onboarding after invite acceptance: 1 authenticator (QR), 2 policies, 3 trainer profile (spec 10A) */
    function loadQr() {
      if (window.QRCode) return Promise.resolve(true);
      return new Promise(function (res) {
        var s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
        s.onload = function () { res(!!window.QRCode); }; s.onerror = function () { res(false); };
        document.head.appendChild(s);
      });
    }
    function liveOnboarding(state) {
      landingMode(false); $('#tabsWrap').hidden = true;
      if (!state || state.complete) return landStaffLive();
      var steps = ['mfa', 'policy', 'profile'], step = steps.filter(function (s) { return state.pending.indexOf(s) >= 0; })[0];
      var bar = '<div class="steps" aria-hidden="true">' + steps.map(function (s) { return '<i class="' + (state.pending.indexOf(s) < 0 || s === step ? 'on' : '') + '"></i>'; }).join('') + '</div>';
      var head = function (t, n) { return '<div><h3>' + t + '</h3><p class="note">' + n + '</p></div>'; };
      var fail = function (form, sel) { return function (e) { busy(form, false); show(sel, e); }; };
      if (step === 'mfa') {
        flow().innerHTML = bar + '<p class="note">Preparing your authenticator…</p>';
        api.staff.mfaSetup().then(function (m) {
          flow().innerHTML = bar + '<form id="fl1" novalidate>' + head('Set up your authenticator', 'Required for every staff sign-in') +
            '<p class="note">1. Open Google Authenticator, Microsoft Authenticator or similar.<br>2. Scan this QR code, or add the setup key by hand (time based).<br>3. Enter the 6-digit code it shows.</p>' +
            '<div id="qr" style="background:#fff;padding:10px;border-radius:10px;justify-self:start;width:max-content" aria-label="QR code for your authenticator app"></div>' +
            '<div class="secret" id="setupKey">' + esc(m.secret.replace(/(.{4})/g, '$1 ').trim()) + '</div>' +
            '<div class="field"><label for="fl-code">Code from your app</label><input id="fl-code" inputmode="numeric" maxlength="6" class="mono" placeholder="6-digit code" autocomplete="one-time-code"></div>' +
            '<div id="flErr"></div><button class="btn btn-primary btn-block" type="submit">Verify authenticator</button></form>';
          loadQr().then(function (ok) {
            var box = $('#qr'); if (!box) return;
            if (ok) new QRCode(box, { text: m.otpauthUri, width: 180, height: 180, correctLevel: QRCode.CorrectLevel.M });
            else box.outerHTML = '<p class="note">The QR code could not load. Type the setup key into your app instead.</p>';
          });
          LIVE_SUBMIT.fl1 = function (form) {
            var c = $('#fl-code').value.replace(/\D/g, '');
            if (c.length !== 6) { $('#flErr').innerHTML = alertBox('err', 'Enter the 6-digit code.'); return; }
            busy(form, true);
            api.staff.mfaConfirm(c).then(function (r) {
              flow().innerHTML = bar + '<div style="display:grid;gap:1rem">' + head('Save your recovery codes', 'Each code works once if you lose your phone. They are shown only now.') +
                '<pre class="secret mono" id="recCodes" style="white-space:pre-wrap">' + esc((r.recoveryCodes || []).join('\n')) + '</pre>' +
                '<label class="consent"><input type="checkbox" id="recOk">I saved these codes somewhere safe.</label><div id="recErr"></div>' +
                '<button class="btn btn-primary btn-block" type="button" id="recGo">Continue</button></div>';
              $('#recGo').addEventListener('click', function () {
                if (!$('#recOk').checked) { $('#recErr').innerHTML = alertBox('err', 'Confirm that you saved the recovery codes.'); return; }
                liveOnboarding(r.onboarding);
              });
            }, fail(form, '#flErr'));
          };
        }, function (e) { flow().innerHTML = alertBox('err', esc(msgOf(e))); });
      } else if (step === 'policy') {
        flow().innerHTML = bar + '<form id="fl2" novalidate>' + head('Policies', 'Read and accept both to open the console') +
          '<label class="consent"><input type="checkbox" name="coc">I accept the Staff Code of Conduct.</label>' +
          '<label class="consent"><input type="checkbox" name="dp">I accept the Student Data Handling Policy. I will see only the records my role allows, and every view of a student record is logged.</label>' +
          '<div id="flErr"></div><button class="btn btn-primary btn-block" type="submit">Accept and continue</button></form>';
        LIVE_SUBMIT.fl2 = function (form) {
          if (!form.coc.checked || !form.dp.checked) { $('#flErr').innerHTML = alertBox('err', 'Both policies must be accepted to open the console.'); return; }
          busy(form, true);
          api.staff.policy(state.policyVersions).then(function (r) { r.onboarding.complete ? landStaffLive() : liveOnboarding(r.onboarding); }, fail(form, '#flErr'));
        };
      } else {
        flow().innerHTML = bar + '<form id="fl3" novalidate>' + head('Your trainer profile', 'Students see your display name') +
          '<div class="field"><label for="p-dn">Display name <span class="req">*</span></label><input id="p-dn" name="dn"></div>' +
          '<div class="field"><label for="p-sp">Speciality (tags) <span class="req">*</span></label><input id="p-sp" name="sp" placeholder="SOC and Blue Team, Log analysis"></div>' +
          '<div class="field"><label for="p-ce">Certifications (comma separated)</label><input id="p-ce" name="ce" placeholder="CEH, CISSP"></div>' +
          '<div><span class="lbl">Weekly availability (1-to-1 and mock interviews)</span><div style="display:flex;gap:.8rem;flex-wrap:wrap;margin-top:.4rem">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(function (d) { return '<label class="consent"><input type="checkbox" name="av" value="' + d + '">' + d + '</label>'; }).join('') + '</div></div>' +
          '<div id="flErr"></div><button class="btn btn-primary btn-block" type="submit">Save and open console</button></form>';
        LIVE_SUBMIT.fl3 = function (form) {
          var dn = form.dn.value.trim(), sp = form.sp.value.trim();
          if (!dn || !sp) { $('#flErr').innerHTML = alertBox('err', 'Display name and speciality are required.'); return; }
          busy(form, true);
          api.staff.profile({ displayName: dn, speciality: sp, certifications: split(form.ce.value), availability: { days: $$('input[name=av]:checked', form).map(function (x) { return x.value; }) } })
            .then(function (r) { r.onboarding.complete ? landStaffLive() : liveOnboarding(r.onboarding); }, fail(form, '#flErr'));
        };
      }
    }

    function landStaffLive(meIn) {
      return (meIn ? Promise.resolve(meIn) : api.me()).then(function (me) {
        if (me.sessionScope === 'onboarding') return api.staff.onboarding().then(liveOnboarding);
        if (me.role === 'student') return afterStudentLogin();
        session = { email: me.email, role: me.role, at: now(), live: true }; store.sset(SESSION_KEY, session); lastActivity = now();
        landingMode(true);
        var admin = me.role === 'admin', url = admin ? ADMIN_URL : TRAINER_URL, stay = /[?&]stay=1/.test(location.search);
        var w = !stay ? openTab(url) : null; // the console opens in a new tab
        flow().innerHTML = '<div class="land-head"><div><span class="eyebrow">Employee · ' + (admin ? 'Admin' : 'Trainer') + ' console</span><h2 style="margin-top:.6rem">' + esc(admin ? 'Platform Admin' : 'Welcome, ' + (me.displayName || '')) + '</h2><p class="note">' + esc(me.displayName || '') + ' · ' + esc(me.email) + '</p></div></div>' +
          '<div style="display:grid;gap:1rem"><p class="note">' + (w ? 'Your console opened in a new tab.' : 'Open your console in a new tab.') + '</p>' +
          '<a class="btn btn-primary btn-block" href="' + url + '" target="_blank" rel="noopener" id="' + (admin ? 'openAdmin' : 'openTrainer') + '">Open ' + (admin ? 'Admin' : 'Trainer') + ' Console</a>' +
          '<button class="btn btn-ghost btn-sm" type="button" data-logout>Log out</button></div>';
        bindLogout();
      }).catch(function (e) { flow().innerHTML = alertBox('err', esc(msgOf(e))); });
    }

    LIVE_SUBMIT.raForm = function (form) {
      var n = $('#ra-n').value.trim(), em = lc($('#ra-e').value), w = $('#ra-w').value.trim();
      if (!n || w.length < 5) { $('#raErr').innerHTML = alertBox('err', 'Name and a reason (at least 5 characters) are required.'); return; }
      if (!isEmail(em)) { $('#raErr').innerHTML = alertBox('err', 'Use your organisation email.'); return; }
      busy(form, true);
      api.staff.requestAccess({ name: n, email: em, role: $('#ra-r').value, reason: w }).then(function () {
        flow().innerHTML = alertBox('ok', 'Request sent. A Platform Admin reviews it and, if approved, sends you an invite email (valid 72 hours).') + '<button class="btn btn-ghost btn-block" type="button" style="margin-top:1rem" id="again">Back to login</button>';
        $('#again').addEventListener('click', viewStaffLogin);
      }, function (e) { busy(form, false); show('#raErr', e); });
    };

    /* ---------- sessions ---------- */
    logout = function (msg) {
      api.logout().catch(function () {}).then(function () { CANON.logout(msg); });
    };
    land = function () {
      if (session && session.live) return api.me().then(function (me) { me.role === 'student' ? afterStudentLogin() : landStaffLive(me); }, function () { session = null; store.sset(SESSION_KEY, null); selectRole(S.role, S.staff); });
      session = null; store.sset(SESSION_KEY, null); selectRole(S.role, S.staff);
    };

    // Boot hook used by the page: emailed links first, then an existing API session.
    window.YojoLiveBoot = function () {
      var m = location.hash.match(/^#(invite|reset|mfa-reenrol)=([\w-]{20,100})$/);
      if (m) { history.replaceState(null, '', location.pathname + location.search); S.role = 'employee'; viewTokenPassword(m[1], m[2]); return true; }
      if (location.hash === '#join-academy') { // from the CTF dashboard (OI-14): sign in with the CTF email
        history.replaceState(null, '', location.pathname + location.search);
        selectRole('student'); viewStudentLogin('returning');
        $('#slErr').innerHTML = alertBox('info', 'Enter the email of your CTF account. We send a code to it, then you add your student details.');
        return true;
      }
      api.me().then(function (me) {
        if (me.role === 'student') afterStudentLogin(); else if (me.role === 'admin' || me.role === 'trainer') landStaffLive(me);
      }, function () { /* not signed in: the page already shows the login form */ });
      return false;
    };
  }
})();
