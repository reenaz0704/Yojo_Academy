/* Yojo Admin console: LIVE mode. Loaded instead of admin.js; it decides whether the real API is reachable and then
   loads admin.js. With the API: the signed-in admin comes from GET /me (cookie session, MFA done at login), and the
   AdminAPI methods listed below are replaced with server calls. Every other module still runs on demo data
   (admin-data.js) until its API exists. Without the API the console stays in demo mode exactly as before. */
(function () {
  'use strict';
  var api = window.YojoAPI, A = window.AdminAPI;
  function boot() { var s = document.createElement('script'); s.src = 'admin.js'; document.body.appendChild(s); }
  if (!api || !A) return boot();

  var ORIGIN = { signup: 'Website sign-up', yojo: 'Yojo (added by admin)', ctf: 'CTF registration', invite: 'Staff invite' };
  var CAP = { trainer: 'Trainer', trainer_mentor: 'Trainer + Mentor' };
  var STATUS = { active: 'active', invited: 'invited', suspended: 'suspended', locked: 'suspended', pending_verification: 'invited' };
  var fail = function (e) { var x = new Error((e && e.problem && e.problem.message) || (e && e.message) || 'Request failed'); x.status = e && e.status; throw x; };

  // Pages through GET /admin/users (max 100 per call) up to `max` rows.
  function users(view, max) {
    var out = [];
    var page = function (cursor) {
      var q = { view: view, limit: 100 }; if (cursor) q.cursor = cursor;
      return api.admin.users(q).then(function (r) {
        out = out.concat(r.items || []);
        return r.nextCursor && out.length < max ? page(r.nextCursor) : out;
      });
    };
    return page();
  }

  function installLive(me) {
    window.YojoLiveAdmin = {
      user: { email: me.email, name: me.displayName || me.email, role: 'admin', adminRole: 'platform', status: 'active', mfaSecret: 'LIVEMFAATLOGIN22' },
      logout: function () { return api.logout().catch(function () {}); },
    };
    var demoSummary = A.summary;
    A.totalUsers = function () {
      return Promise.all([api.admin.totalUsers(), users('all', 1000)]).then(function (x) {
        var t = x[0], b = t.breakdown, rows = x[1].filter(function (u) { return u.role === 'student' || u.role === 'participant'; });
        return {
          total: b.students + b.ctfOnly, free: b.free, paid: b.paid, ctf: b.ctf, ctfAlsoUsers: b.ctfLinkedStudents, live: true,
          rows: rows.map(function (u) {
            return {
              id: u.code || u.id, name: u.name || u.email, email: u.email,
              type: u.role === 'participant' ? 'CTF' : u.plan === 'paid' ? 'Paid' : 'Free',
              alsoUser: u.role === 'student' && u.ctf, where: ORIGIN[u.origin] || u.origin || '', institution: u.institution || '',
            };
          }),
        };
      }, fail);
    };
    // Dashboard tiles: user counts from the server; the approval queue is still demo data.
    A.summary = function () {
      return Promise.all([api.admin.totalUsers(), demoSummary()]).then(function (x) {
        var b = x[0].breakdown;
        return Object.assign({}, x[1], { total: b.students, free: b.free, paid: b.paid });
      }, fail);
    };
    A.staff = function () {
      return Promise.all([users('trainers', 500), users('admins', 500), users('invited', 500)]).then(function (x) {
        var rows = x[0].concat(x[1]).map(function (u) {
          return { email: u.email, name: u.name || u.email, role: u.role === 'admin' ? 'Platform Admin' : CAP[u.capability] || 'Trainer', status: STATUS[u.status] || u.status, batches: '' };
        });
        x[2].forEach(function (i) { rows.push({ email: i.email, name: i.email, role: i.role === 'admin' ? 'Platform Admin' : CAP[i.capability] || 'Trainer', status: 'invited', batches: '' }); });
        return rows;
      }, fail);
    };
    // Student Management (audit 29 Oct): the list, the student record and its audit rows come from the server. The
    // record's IDs in the address bar are student codes (U-20417); codes map back to the server's IDs here.
    var CODE = {};
    var PATHN = { Offensive: 'Offensive', Defensive: 'Defensive', GRC: 'GRC' };
    function reports(max) {
      var out = [];
      var page = function (cursor) {
        return api.get('/admin/student-reports' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '')).then(function (r) {
          out = out.concat(r.items || []);
          return r.nextCursor && out.length < max ? page(r.nextCursor) : out;
        });
      };
      return page();
    }
    A.batchCodes = function () { return api.admin.batches().then(function (b) { return (b.items || b).map(function (x) { return x.code; }); }, function () { return []; }); };
    A.students = function (f) {
      f = f || {};
      return Promise.all([reports(2000), users('students', 2000)]).then(function (x) {
        var plan = {}; x[1].forEach(function (u) { plan[u.id] = u.plan; });
        var q = String(f.q || '').toLowerCase();
        return x[0].map(function (s) {
          CODE[s.code] = s.id;
          return {
            id: s.code, name: s.name || s.email, email: s.email, institution: s.institution || '–', path: PATHN[s.path] || 'Not chosen',
            plan: plan[s.id] === 'paid' ? 'paid' : 'free', enrol: s.batches.length ? 'Enrolled' : 'Not enrolled', batch: s.batches.join(', ') || '–',
            mode: '–', att: null, ctf: false,
          };
        }).filter(function (r) {
          return (!q || (r.name + ' ' + r.email + ' ' + r.id).toLowerCase().indexOf(q) >= 0) && (!f.path || r.path === f.path) &&
            (!f.plan || r.plan === f.plan) && (!f.batch || r.batch.split(', ').indexOf(f.batch) >= 0);
        });
      }, fail);
    };
    var idOf = function (code) { return CODE[code] ? Promise.resolve(CODE[code]) : api.admin.users({ view: 'students', q: code, limit: 5 }).then(function (r) { var u = (r.items || []).find(function (x) { return x.code === code; }); if (!u) throw new Error('No student with that ID.'); CODE[code] = u.id; return u.id; }); };
    A.student = function (code) {
      return idOf(code).then(function (id) { return Promise.all([api.get('/admin/student-reports/' + id), api.admin.user(id)]); }).then(function (x) {
        var r = x[0], u = x[1], p = r.profile, att = r.attendance || {}, cnt = att.counts || {}, g = r.gamification || {}, pl = r.placement || {};
        var held = (cnt.present || 0) + (cnt.late || 0) + (cnt.absent || 0) + (cnt.excused || 0);
        var quiz = (r.assessments || []).filter(function (a) { return a.score != null && a.maxMarks; }).map(function (a) { return { percent: 100 * a.score / a.maxMarks }; });
        return {
          name: p.name || p.email, web: true, // the server record has no admin-editable profile fields yet
          tabs: ['Profile', 'Progress', 'Labs', 'Audit'],
          institution: p.institution || '', batch: (r.enrolments || []).map(function (e) { return e.batch; }).join(', '),
          path: (r.careerPath && r.careerPath.path) || '', plan: u.plan === 'paid' ? 'Paid' : 'Free', enrol: (r.enrolments || []).length ? 'Enrolled' : 'Not enrolled', mode: '',
          profile: {
            'Student ID': p.code, Email: p.email, Phone: p.phone || '–', Institution: p.institution || '–', City: p.city || '–', Education: p.education || '–',
            'Signed up via': ORIGIN[p.origin] || p.origin, Status: p.status, Joined: new Date(p.joinedAt).toLocaleDateString('en-IN'),
            'Last sign-in': p.lastLogin ? new Date(p.lastLogin).toLocaleString('en-IN') : 'Never',
            Plan: u.plan === 'paid' ? 'Paid' : 'Free', Batches: (r.enrolments || []).map(function (e) { return e.batch + (e.course ? ' (' + e.course + ')' : ''); }).join(', ') || 'None',
          },
          resume: pl && pl.parts ? { done: (pl.parts.resume || {}).pct === 100, education: p.education || '', skills: '', objective: '' } : null,
          progress: {
            pi: '–', band: 'Full index in Student report', missed: (r.assessments || []).filter(function (a) { return a.status === 'missed'; }).length, att: { pct: att.pct != null ? att.pct : 0, P: (cnt.present || 0) + (cnt.late || 0), held: held },
            labs: (r.labs || {}).cleared || 0, xp: g.xp || 0, quiz: quiz.length ? Math.round(quiz.reduce(function (a, b) { return a + b.percent; }, 0) / quiz.length) + '%' : '–', lectures: [],
          },
          labs: ((r.labs || {}).recent || []).map(function (l) { return { m: l.code, state: 'Done', cp: 1, cpTotal: 1, mins: 0 }; }),
          dues: null, payments: [], subId: null,
        };
      }, fail);
    };
    // Dashboard search (audit 29 Oct): real users by name, email or user ID
    A.search = function (q) {
      return api.admin.users({ view: 'students', q: q, limit: 8 }).then(function (r) {
        return (r.items || []).map(function (u) { CODE[u.code] = u.id; return { id: u.code, name: u.name || u.email, email: u.email, plan: u.plan === 'paid' ? 'Paid' : 'Free', batch: '', match: 'name, email or ID' }; });
      }, fail);
    };
    var demoAudit = A.audit;
    A.audit = function (q) {
      if (!q || !q.target) return demoAudit(q);
      return idOf(q.target).then(function (id) { return api.get('/admin/audit?limit=100'); }).then(function (r) {
        var id = CODE[q.target];
        return (r.items || []).filter(function (x) { return x.targetId === id; }).map(function (x) { return { at: x.at, who: x.actorRole + (x.adminRole ? ' (' + x.adminRole + ')' : ''), action: x.action, detail: x.reason || '' }; });
      }, fail);
    };
    // Trainer invite by email (POST /admin/staff/invites). Batches are linked by ID on the server; the demo's free-text
    // batch names are not sent.
    A.createTrainer = function (f) {
      var cap = /mentor/i.test(f.capability || '') ? 'trainer_mentor' : 'trainer';
      return api.admin.invite({ email: String(f.email || '').trim().toLowerCase(), role: 'trainer', capability: cap }).catch(fail);
    };
  }

  api.available().then(function (ok) {
    if (!ok) return boot();
    return api.init().then(function () { return api.me(); }).then(function (me) {
      if (me.role === 'admin' && me.sessionScope === 'full') installLive(me);
      else window.YojoLiveAdmin = { user: null, logout: function () { return api.logout().catch(function () {}); } };
    }, function () { window.YojoLiveAdmin = { user: null, logout: function () { return Promise.resolve(); } }; }).then(boot);
  });
})();
