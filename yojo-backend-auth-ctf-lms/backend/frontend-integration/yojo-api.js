/*
 * Yojo API client for the static pages (login.html, ctf-login.html, ctf-register.html, admin pages).
 * Cookie sessions + CSRF double submit. No tokens are stored in localStorage.
 * Usage: <script src="yojo-api.js"></script>  then  YojoAPI.student.sendOtp({ email })
 * Set window.YOJO_API_BASE before loading to point at another host. Default: same origin /api/v1, except local
 * development where the pages are served from another localhost port (http://localhost:8000) and the API runs on
 * http://localhost:3000 (same site, so the SameSite=Lax cookies still flow; CORS must allow the page origin).
 */
(function (w) {
  'use strict';
  var loc = w.location || {};
  var localDev = (loc.hostname === 'localhost' || loc.hostname === '127.0.0.1') && loc.port !== '3000';
  var BASE = (w.YOJO_API_BASE !== undefined ? w.YOJO_API_BASE : localDev ? loc.protocol + '//' + loc.hostname + ':3000' : '') + '/api/v1';
  var csrf = '';

  function readCookie(n) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }
  function token() {
    return csrf || readCookie('__Host-yc') || readCookie('yc');
  }

  /** Every error is problem+json: { code, message, field, needs, details, requestId }. */
  function call(method, path, body, headers, retried) {
    var h = { Accept: 'application/json' };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (method !== 'GET') h['X-CSRF-Token'] = token();
    for (var k in headers || {}) h[k] = headers[k];
    return fetch(BASE + path, {
      method: method,
      credentials: 'include',
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(function (r) {
      if (r.status === 204) return null;
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (j && j.csrfToken) csrf = j.csrfToken;
        // Stale CSRF token (e.g. after logout cleared the cookie): fetch a fresh one and retry once.
        if (r.status === 403 && j && j.code === 'CSRF_INVALID' && method !== 'GET' && !retried) {
          csrf = '';
          return call('GET', '/auth/csrf').then(function () { return call(method, path, body, headers, true); });
        }
        if (!r.ok) { var e = new Error(j.message || 'Request failed'); e.status = r.status; e.problem = j; throw e; }
        return j;
      });
    });
  }
  var get = function (p) { return call('GET', p); };
  var post = function (p, b, h) { return call('POST', p, b || {}, h); };

  /** Call once on page load, before any POST. */
  function init() { return get('/auth/csrf'); }

  /** Returns true when the API answers; pages keep their demo mode when it does not. */
  var avail = null;
  function available() {
    if (avail) return avail;
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, 2500);
    avail = fetch(BASE + '/health/live', { credentials: 'include', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.ok; }, function () { return false; })
      .then(function (ok) { clearTimeout(t); return ok; });
    return avail;
  }
  var patch = function (p, b, h) { return call('PATCH', p, b || {}, h); };

  w.YojoAPI = {
    init: init,
    available: available,
    base: BASE,
    raw: call,
    get: get,
    post: post,
    patch: patch,
    student: {
      // gate 'yojo' = "Are you a Yojo student?" YES (identifier = Yojo email or student ID)
      // gate 'open' = NO path (email); verify answers next: 'signup' with a signupTicket, or 'done'
      sendOtp: function (o) { return post('/auth/student/otp', o); },
      verifyOtp: function (challengeId, code, gate) { return post('/auth/student/verify', { challengeId: challengeId, code: code, gate: gate }); },
      google: function (idToken, gate) { return post('/auth/google', { idToken: idToken, gate: gate }); },
      // { signupTicket, name, institutionId | institutionName, city?, dob?, consents:{terms,privacy,aup,marketing?,parental?}, guardian? }
      signup: function (o) { return post('/auth/signup', o); },
      missingFields: function () { return get('/me/missing-fields'); },
      updateMe: function (o) { return patch('/me', o); },
      entitlements: function () { return get('/me/entitlements'); },
    },
    staff: {
      login: function (email, password) { return post('/auth/staff/login', { email: email, password: password }); },
      totp: function (challengeId, code, recoveryCode) { return post('/auth/staff/totp', { challengeId: challengeId, code: code, recoveryCode: recoveryCode }); },
      acceptInvite: function (token, password) { return post('/auth/invite/accept', { token: token, password: password }); },
      onboarding: function () { return get('/auth/staff/onboarding'); },
      mfaSetup: function () { return post('/auth/staff/mfa-setup'); },
      mfaConfirm: function (code) { return post('/auth/staff/mfa-confirm', { code: code }); },
      policy: function (o) { return post('/auth/staff/policy', o); },
      profile: function (o) { return post('/auth/staff/profile', o); },
      requestAccess: function (o) { return post('/auth/staff/access-request', o); },
      stepUp: function (code) { return post('/auth/step-up', { code: code }); },
      mfaReenrol: function (token, password) { return post('/auth/staff/mfa-reenrol', { token: token, password: password }); },
      forgotPassword: function (email) { return post('/auth/password/forgot', { email: email }); },
      resetPassword: function (o) { return post('/auth/password/reset', o); },
    },
    ctf: {
      sendRegisterOtp: function (email) { return post('/ctf/register/otp', { email: email }); },
      // { challengeId, code, username, password, consents:{ctf_rules:true, ctf_contact}, institution?, city?, level?, phone? }
      register: function (o) { return post('/ctf/register', o); },
      login: function (username, password, next) { return post('/ctf/login', { username: username, password: password, next: next }); },
      loginOtp: function (challengeId, code) { return post('/ctf/login/otp', { challengeId: challengeId, code: code }); },
      loginTotp: function (ticket, code, recoveryCode) { return post('/ctf/login/totp', { ticket: ticket, code: code, recoveryCode: recoveryCode }); },
      me: function () { return get('/ctf/me'); },
      mfaSetup: function () { return post('/ctf/mfa/setup'); },
      mfaConfirm: function (code) { return post('/ctf/mfa/confirm', { code: code }); },
      forgot: function (usernameOrEmail) { return post('/ctf/password/forgot', { usernameOrEmail: usernameOrEmail }); },
      reset: function (token, newPassword, code) { return post('/ctf/password/reset', { token: token, newPassword: newPassword, code: code }); },
    },
    me: function () { return get('/me'); },
    // After sign-out the session's CSRF token is gone: fetch a pre-session token so the page can sign in again.
    logout: function () { return post('/auth/logout').then(function () { csrf = ''; return init(); }); },
    logoutAll: function () { return post('/auth/logout-all').then(function (r) { csrf = ''; return init().then(function () { return r; }); }); },
    sessions: function () { return get('/auth/sessions'); },
    admin: {
      // view: all|students|free|paid|ctf|trainers|admins|pending_verification|pending_onboarding|invited|suspended
      users: function (q) { return get('/admin/users?' + new URLSearchParams(q || {}).toString()); },
      user: function (id) { return get('/admin/users/' + id); },
      totalUsers: function () { return get('/admin/total-users'); },
      setStatus: function (id, status, reason, stepUpCode) { return call('PATCH', '/admin/users/' + id + '/status', { status: status, reason: reason }, stepUpCode ? { 'X-Step-Up-Code': stepUpCode } : {}); },
      revokeSessions: function (id, reason) { return post('/admin/users/' + id + '/sessions/revoke', { reason: reason }); },
      provisionStudent: function (o) { return post('/admin/students', o); },
      grantEntitlement: function (id, o, stepUpCode) { return post('/admin/students/' + id + '/entitlements', o, { 'X-Step-Up-Code': stepUpCode }); },
      revokeEntitlement: function (id, entId, reason, stepUpCode) { return post('/admin/students/' + id + '/entitlements/' + entId + '/revoke', { reason: reason }, { 'X-Step-Up-Code': stepUpCode }); },
      batches: function () { return get('/admin/batches'); },
      createBatch: function (o) { return post('/admin/batches', o); },
      enrol: function (studentId, batchId) { return post('/admin/students/' + studentId + '/enrolments', { batchId: batchId }); },
      invite: function (o) { return post('/admin/staff/invites', o); },
    },
    trainer: {
      batches: function () { return get('/trainer/batches'); },
      batchStudents: function (id) { return get('/trainer/batches/' + id + '/students'); },
    },
  };
})(window);
