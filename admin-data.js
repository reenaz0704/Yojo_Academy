/* Yojo Admin console: DEMO DATA + SIMULATED SERVER.
   There is no backend in this prototype. AdminAPI plays the part of the server:
   - every call checks the admin sub-role against the access matrix (PDF pages 17, 21 and 40) and throws 403,
     so hiding a button is never the only control;
   - every sensitive action writes an append-only audit row (no edit or delete method exists);
   - it shares ONE record with the trainer console and the student LMS (attendance, courses, students,
     messages), stored under the trainer demo key, and the login database for accounts and plans.
   Names, amounts and dates are SAMPLES. Replace AdminAPI with real HTTP calls; pages depend only on
   its method names and return shapes. What a real server must add is listed in BACKEND_GAPS. */
(() => {
  'use strict';
  const KEY = 'yojo_trainer_demo_v2', LOGIN_KEY = 'yojo_demo_db_v1';
  const DAY = 864e5, now = () => Date.now();
  const d0 = new Date(); d0.setHours(0, 0, 0, 0); const T0 = d0.getTime();
  const at = (days, hh = 0, mm = 0) => T0 + days * DAY + (hh * 60 + mm) * 6e4;
  const clone = o => JSON.parse(JSON.stringify(o));
  const ROLES = { platform: 'Platform Admin', payment: 'Payment Admin', content: 'Content Admin', support: 'Support Admin' };

  /* ---------------- access matrix (Y full, R restricted to scope, - none) ---------------- */
  const M = (p, pay, c, s) => ({ platform: p, payment: pay, content: c, support: s });
  const MATRIX = {
    dashboard: M('Y', 'Y', 'Y', 'Y'),
    courses: M('Y', '-', 'Y', '-'),
    labs: M('Y', '-', 'Y', '-'),
    students: M('Y', 'R', 'R', 'Y'),
    attendance: M('Y', '-', 'R', 'R'),
    attendanceEdit: M('Y', '-', 'R', '-'),
    performance: M('Y', '-', 'R', 'R'),
    finance: M('Y', 'Y', '-', 'R'),
    financeAct: M('Y', 'Y', '-', '-'),
    assessments: M('Y', '-', 'Y', 'R'),
    analytics: M('Y', 'R', 'R', 'R'),
    notifications: M('Y', 'R', 'Y', 'R'),
    broadcast: M('Y', '-', 'R', '-'),
    reports: M('Y', 'R', 'R', 'R'),
    reportArchive: M('Y', 'R', '-', '-'),
    certificates: M('Y', '-', 'Y', '-'),
    blogs: M('Y', '-', 'Y', 'R'), // Intel Review: student blog moderation
    settings: M('Y', 'R', 'R', '-'),
    userSearch: M('Y', 'R', 'R', 'Y'),
    approve: M('Y', 'Y', '-', '-'),
    labSecrets: M('Y', '-', 'Y', '-'),
    ctf: M('Y', '-', 'R', 'Y'),
    enquiries: M('Y', '-', 'R', 'Y'),
    totalUsers: M('Y', 'R', 'R', 'Y'),
    // Insight Engine: Payment sees checkout and payment only; Content and Support see aggregates only
    insights: M('Y', 'R', 'R', 'R'),
    insightTimeline: M('Y', '-', '-', 'R'),
    insightAdmin: M('Y', '-', '-', '-')
  };
  // which report sections each role may include (PDF page 20 "Access")
  const REPORT_SECTIONS = ['Profile and guardian', 'Attendance', 'Performance', 'Financial details and dues', 'Placement readiness', 'Trainer and mentor remarks', 'Internal admin notes'];
  const REPORT_ALLOWED = { platform: REPORT_SECTIONS, payment: ['Financial details and dues'], content: ['Attendance', 'Performance'], support: ['Profile and guardian', 'Attendance'] };
  // which settings sections each role may change
  const SETTINGS_ALLOWED = { platform: ['plans', 'xp', 'ai', 'promos', 'maintenance', 'policy'], payment: ['plans', 'promos'], content: ['xp'], support: [] };

  const BACKEND_GAPS = [
    'Real server with role checks and audit storage (this demo runs in the browser; the rules are the same, but anyone can edit browser storage).',
    'Payment gateway webhook and signature check (Razorpay). Payments here are sample records.',
    'Cyber-range API for lab environments. Environment controls are configuration only; nothing is started.',
    'Media service for virus scan and video processing of uploads.',
    'Email and WhatsApp delivery. Messages here reach the in-app bell only.',
    'Object storage for frozen report PDFs. Reports are kept as snapshots in the demo store.',
    'Insight Engine: event endpoint (/v1/events), warehouse, scheduled jobs for the 8:00 IST digest and weekly PDF, email delivery, and a ticketing integration. Here events are kept in browser storage and jobs run when the page opens.',
    'AI Gateway for the insight analyst. The analyst here is rule-based and answers only allowlisted questions.'
  ];

  /* ---------------- storage ---------------- */
  let db = null;
  const reload = () => { try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; } if (!db || !db.students) throw err(503, 'The shared demo data is not loaded yet. Reload the page.'); if (!db.admin) db.admin = seedAdmin(db); return db; };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  const loginDb = () => { try { return JSON.parse(localStorage.getItem(LOGIN_KEY)) || { users: [] }; } catch { return { users: [] }; } };
  const saveLogin = l => { try { localStorage.setItem(LOGIN_KEY, JSON.stringify(l)); } catch {} };
  function err(code, msg) { const e = new Error(msg); e.code = code; return e; }

  /* ---------------- admin seed (added once to the shared record) ---------------- */
  function seedAdmin(d) {
    const inst = ['ABC Institute of Tech', 'Yojo Solutions', 'Vizag College of Engineering', 'GITAM University'];
    const accounts = {};
    d.students.forEach((s, i) => {
      const n = +s.id.slice(2);
      const paid = ['U-20417', 'U-20418', 'U-20420', 'U-20422', 'U-20423', 'U-20431', 'U-20434'].includes(s.id);
      accounts[s.id] = { plan: paid ? 'paid' : 'free', planName: paid ? (s.batch === 'FND-B3' ? 'Foundations' : 'SOC Analyst') : 'Free', subId: paid ? 'SUB-' + (7000 + n) : '', institution: inst[i % inst.length],
        enrol: 'Active', mode: i % 4 === 2 ? 'Online' : 'Offline', access: i % 4 === 2 ? 'Live + Recorded' : 'Class', registered: now() - (40 + i * 3) * DAY,
        dob: `200${3 + (i % 4)}-0${1 + (i % 9)}-1${i % 9}`, guardian: { name: 'Guardian of ' + s.name.split(' ')[0], rel: i % 2 ? 'Mother' : 'Father', phone: '+91 98' + String(10000000 + n * 7).slice(0, 8) },
        city: ['Hyderabad', 'Visakhapatnam', 'Pune', 'Chennai'][i % 4] };
    });
    const pay = (id, sid, amount, method, status, daysAgo, plan) => ({ id, sid, ref: 'pay_' + id.slice(-4).toLowerCase() + 'Xq' + sid.slice(-2), method, amount, status, at: now() - daysAgo * DAY, plan, signature: status === 'Verified' ? 'Signature verified' : status === 'Failed' ? 'Signature mismatch' : 'Waiting for gateway webhook' });
    const payments = [
      pay('PY-1001', 'U-20417', 10000, 'UPI', 'Verified', 40, 'SOC Analyst'), pay('PY-1002', 'U-20417', 6000, 'Card', 'Verified', 40, 'SOC Analyst'),
      pay('PY-1003', 'U-20418', 36000, 'Razorpay', 'Verified', 60, 'Annual'), pay('PY-1004', 'U-20420', 12000, 'UPI', 'Verified', 30, 'SOC Analyst'),
      pay('PY-1005', 'U-20432', 10000, 'UPI', 'Verified', 1, 'Foundations'), pay('PY-1006', 'U-20419', 10000, 'Card', 'Not verified', 0.3, 'GRC Analyst'),
      pay('PY-1007', 'U-20435', 12000, 'Razorpay', 'Verified', 0.6, 'Foundations'), pay('PY-1008', 'U-20433', 8000, 'UPI', 'Failed', 2, 'Foundations')
    ];
    const appr = (id, sid, plan, payId, daysAgo, extra = {}) => ({ id, sid, plan, payId, status: 'Awaiting approval', at: now() - daysAgo * DAY, ...extra });
    const approvals = [
      appr('AP-301', 'U-20432', 'Foundations', 'PY-1005', 1), appr('AP-302', 'U-20419', 'GRC Analyst', 'PY-1006', 0.3),
      appr('AP-303', 'U-20435', 'Foundations', 'PY-1007', 0.6), appr('AP-304', 'U-20433', 'Foundations', 'PY-1008', 2),
      // an admin's own purchase: the server refuses self-approval
      appr('AP-305', 'STAFF', 'SOC Analyst', 'PY-1009', 0.2, { staffEmail: 'payment.admin@yojo.demo', staffName: 'Suresh (Payment Admin)' })
    ];
    payments.push({ id: 'PY-1009', sid: 'STAFF', ref: 'pay_1009Xqsf', method: 'Card', amount: 24000, status: 'Verified', at: now() - 0.2 * DAY, plan: 'SOC Analyst', signature: 'Signature verified' });
    const inst2 = (n, amount, dueDays, paidDaysAgo, ref, method) => ({ n, amount, due: at(dueDays), paidAt: paidDaysAgo == null ? null : now() - paidDaysAgo * DAY, ref: ref || '', method: method || '' });
    const fees = {
      'U-20417': { plan: 'SOC Analyst', total: 24000, instalments: [inst2(1, 10000, -40, 40, 'pay_1001Xq17', 'UPI'), inst2(2, 6000, -40, 40, 'pay_1002Xq17', 'Card'), inst2(3, 8000, 4)], reminders: [] },
      'U-20418': { plan: 'Annual', total: 36000, instalments: [inst2(1, 36000, -60, 60, 'pay_1003Xq18', 'Razorpay')], reminders: [] },
      'U-20419': { plan: 'GRC Analyst', total: 20000, instalments: [inst2(1, 10000, -40, 40, 'pay_0990Xq19', 'UPI'), inst2(2, 10000, -25)], reminders: [{ at: now() - 22 * DAY, by: 'System', kind: 'Overdue +3 days' }] },
      'U-20420': { plan: 'SOC Analyst', total: 24000, instalments: [inst2(1, 12000, -30, 30, 'pay_1004Xq20', 'UPI'), inst2(2, 12000, 12)], reminders: [] },
      'U-20421': { plan: 'Foundations', total: 12000, instalments: [inst2(1, 8000, -20, 20, 'pay_0950Xq21', 'Cash (offline)'), inst2(2, 4000, -6)], reminders: [] },
      'U-20434': { plan: 'Foundations', total: 12000, instalments: [inst2(1, 12000, -15, 15, 'pay_0970Xq34', 'Card')], reminders: [] },
      'U-20431': { plan: 'Foundations', total: 12000, instalments: [inst2(1, 6000, -20, 20, 'pay_0960Xq31', 'UPI'), inst2(2, 6000, 2)], reminders: [] }
    };
    const LAB = (id, title, cat, diff, path, status, extra = {}) => ({ id, title, category: cat, difficulty: diff, path, status, courses: extra.courses || [], env: { image: extra.image || 'yojo/' + id.toLowerCase() + ':1.4', timeoutMin: 90, network: 'Isolated per student', maxSeats: 60 },
      flags: (extra.flags || ['FLAG{demo-' + id.toLowerCase() + '-1}']).map((f, k) => ({ cp: k + 1, value: f })), hints: extra.hints || ['Start with the alert time window.', 'Filter by event ID first.'], updated: now() - (extra.upd || 5) * DAY });
    const labs = [
      LAB('DEF-01', 'Log Detective: first alert', 'SIEM', 'Easy', 'Defensive', 'Published', { courses: ['C-SOC'] }),
      LAB('DEF-02', 'Log Detective: brute force', 'SIEM', 'Medium', 'Defensive', 'Published', { courses: ['C-SOC'], flags: ['FLAG{4625-burst}', 'FLAG{src-10.0.4.7}'] }),
      LAB('DEF-03', 'Phish Hunter', 'Email security', 'Medium', 'Defensive', 'Published', { courses: ['C-SOC'] }),
      LAB('OFF-01', 'Recon Basics', 'Recon', 'Easy', 'Offensive', 'Published', { courses: ['C-OPS'] }),
      LAB('OFF-05', 'Broken Login', 'Web', 'Hard', 'Offensive', 'Draft', { upd: 1 }),
      LAB('GRC-02', 'Risk Register Sprint', 'GRC', 'Easy', 'GRC', 'Unpublished', { upd: 9 })
    ];
    const certs = [
      { id: 'YJ-CERT-2026-0091', sid: 'U-20420', course: 'SOC Analyst (Blue Team)', completion: 100, assess: 'Passed', status: 'Issued', issuedAt: now() - 4 * DAY, by: 'Priya (Platform Admin)' },
      { id: '', sid: 'U-20434', course: 'Cyber Foundations', completion: 100, assess: 'Passed', status: 'Eligible' },
      { id: '', sid: 'U-20417', course: 'SOC Analyst (Blue Team)', completion: 64, assess: 'In progress', status: 'Not eligible' },
      { id: 'YJ-CERT-2026-0077', sid: 'U-20423', course: 'SOC Analyst (Blue Team)', completion: 100, assess: 'Passed', status: 'Revoked', issuedAt: now() - 20 * DAY, revokedAt: now() - 6 * DAY, reason: 'Issued against the wrong course version; reissue pending.', by: 'Priya (Platform Admin)' },
      { id: '', sid: 'U-20432', course: 'Cyber Foundations', completion: 100, assess: 'Pending grade', status: 'Not eligible' }
    ];
    const y = new Date().getFullYear();
    const holidays = [
      { date: `${y}-10-02`, name: 'Gandhi Jayanti', kind: 'Holiday' }, { date: `${y}-10-20`, name: 'Diwali', kind: 'Holiday' },
      { date: `${y}-11-05`, name: 'Guru Nanak Jayanti', kind: 'Festival' }, { date: `${y}-12-25`, name: 'Christmas', kind: 'Festival' }
    ];
    const log = [
      { id: 'NT-11', title: 'Fee reminder: instalment 2 of 3', audience: 'Individual, 6 students', type: 'Dues reminder', channels: ['In-app', 'Email'], at: now() - 2 * DAY, by: 'Suresh (Payment Admin)', count: 6, delivered: 6, read: 4, status: 'Sent' },
      { id: 'NT-10', title: 'Quiz 3 moved to Friday', audience: 'Batch SOC-B7', type: 'Announcement', channels: ['In-app'], at: now() - 3 * DAY, by: 'Meera (Content Admin)', count: 8, delivered: 8, read: 6, status: 'Sent' }
    ];
    const settings = {
      plans: { free: 'Free: 15 labs, XP, streak, leaderboard', soc: 'SOC Analyst: price set by admin [PROVISIONAL]', annual: 'Annual: price set by admin [PROVISIONAL]', live: 'Online live classes: Rs xx,xxx [set later]', recorded: 'Online recorded classes: Rs xx,xxx [set later]' },
      xp: { labEasy: 50, labMedium: 100, labHard: 200, dailyStreak: 10, quizPass: 40 },
      ai: { studentDaily: 30, staffDaily: 100 },
      promos: { launchOffer: 'Off', code: '' },
      maintenance: { on: false, message: 'Yojo Academy is under scheduled maintenance. Back soon.' },
      policy: { attendanceMin: d.cfg.attendanceMin, piAttendance: 20, piLabs: 30, piCourses: 35, piXp: 15, broadcastSecondAdmin: 200, approvalTargetH: 24 }
    };
    return { accounts, payments, approvals, fees, offline: [], labs, certs, holidays, log, templates: { birthday: 'Happy birthday, {first_name}! Wishing you a great year ahead. Team Yojo', festival: 'Happy {festival}, {first_name}! Warm wishes from Team Yojo.' },
      reports: [], notes: { 'U-20417': 'Parent asked about the fee schedule; call logged by Support.' }, settings, settingsLog: [], audit: [], purposes: {} };
  }

  /* ---------------- session ---------------- */
  let me = null;
  const can = (perm, role = me && me.role) => { const r = (MATRIX[perm] || {})[role]; return r === 'Y' ? 'Y' : r === 'R' ? 'R' : '-'; };
  const need = perm => { if (!me) throw err(401, 'Your session has ended. Sign in again.'); if (can(perm) === '-') throw err(403, `${ROLES[me.role]} cannot use this. The access matrix does not allow it.`); return can(perm); };
  const audit = (action, target = '', detail = '') => { db.admin.audit.unshift({ id: 'AU-' + now() + Math.random().toString(36).slice(2, 5), at: now(), who: me ? me.name : 'System', role: me ? ROLES[me.role] : 'System', action, target, detail }); };
  const lag = fn => new Promise((res, rej) => setTimeout(() => { try { reload(); res(fn()); } catch (e) { rej(e); } }, 90 + Math.random() * 140));
  const notifyStudent = (sid, kind, text) => { db.studentNotes = db.studentNotes || {}; (db.studentNotes[sid] = db.studentNotes[sid] || []).unshift({ id: 'N' + now() + Math.random().toString(36).slice(2, 5), kind, text, at: now(), read: false }); };

  /* ---------------- derived student data (same formula as the trainer console) ---------------- */
  function attOf(sid, batch, from = 0, to = Infinity) {
    const ls = db.lectures.filter(l => l.batch === batch && l.status === 'held' && l.marks[sid] && l.start >= from && l.start <= to);
    const P = ls.filter(l => l.marks[sid] === 'P').length, A = ls.filter(l => l.marks[sid] === 'A').length;
    return { held: ls.length, P, A, pct: ls.length ? Math.round(P / ls.length * 100) : 100 };
  }
  function perf(s) {
    const w = db.admin.settings.policy, att = attOf(s.id, s.batch), labsPct = Math.round(s.labs / 15 * 100);
    const pi = Math.round((att.pct * w.piAttendance + labsPct * w.piLabs + s.quiz * w.piCourses + s.xp * w.piXp) / 100);
    return { pi, att, labsPct, quiz: s.quiz, xp: s.xp, band: pi >= 80 ? 'Excelling' : pi >= 60 ? 'On track' : pi >= 40 ? 'Needs attention' : 'At risk' };
  }
  const dueOf = sid => { const f = db.admin.fees[sid]; if (!f) return null; const paid = f.instalments.filter(i => i.paidAt).reduce((a, i) => a + i.amount, 0), open = f.instalments.filter(i => !i.paidAt);
    const next = open.sort((a, b) => a.due - b.due)[0]; const overdue = open.filter(i => i.due < T0); const status = !open.length ? 'Paid' : overdue.length ? 'Overdue' : next.due - T0 <= 7 * DAY ? 'Due soon' : paid ? 'Partly paid' : 'Due';
    return { plan: f.plan, total: f.total, paid, due: f.total - paid, next, status, overdueDays: overdue.length ? Math.round((T0 - overdue[0].due) / DAY) : 0 }; };
  const TRAINER_NAMES = { trainer: 'Vikram Rao', 'someone.else': 'Karan Mehta' };
  const nameOf = sid => { const s = db.students.find(x => x.id === sid); return s ? s.name : sid; };
  const loginFor = s => { const l = loginDb(); return l.users.find(u => u.role === 'student' && (u.id === s.id || (s.loginEmail && u.email === s.loginEmail))); };
  // students who signed up on the website but are not yet in a batch also count as users
  function allUsers() {
    const l = loginDb(), ids = new Set(db.students.map(s => s.id));
    const extra = l.users.filter(u => u.role === 'student' && !(u.id && ids.has(u.id)) && !db.students.some(s => s.loginEmail === u.email)).map(u => ({ id: u.id || 'WEB-' + u.email.split('@')[0], name: (u.profile && u.profile.name) || u.email, email: u.email, batch: '', web: true, plan: u.stats && u.stats.plan === 'paid' ? 'paid' : 'free', path: u.category || '' }));
    return db.students.filter(s => s.batch !== 'STAFF').map(s => { const a = db.admin.accounts[s.id] || {}; const lu = loginFor(s); return { id: s.id, name: s.name, email: (lu && lu.email) || s.email, batch: s.batch, path: s.path, plan: lu && lu.stats && lu.stats.plan === 'paid' ? 'paid' : a.plan || 'free', planName: a.planName, subId: a.subId || '', institution: a.institution || '', enrol: a.enrol || 'Active', mode: a.mode || 'Offline' }; }).concat(extra);
  }
  // student paid-access requests sent from the website become approval rows with their payment
  function syncWebRequests() {
    const l = loginDb(); let changed = false;
    l.users.filter(u => u.role === 'student' && u.stats && u.stats.paidRequest && u.stats.plan !== 'paid').forEach(u => {
      const sid = u.id || 'WEB-' + u.email.split('@')[0];
      if (db.admin.approvals.some(a => a.sid === sid && a.status === 'Awaiting approval')) return;
      const payId = 'PY-W' + (db.admin.payments.length + 1);
      db.admin.payments.push({ id: payId, sid, ref: 'pay_web' + Math.random().toString(36).slice(2, 7), method: 'Razorpay', amount: 24000, status: 'Verified', at: new Date(u.stats.paidRequest).getTime() || now(), plan: 'SOC Analyst', signature: 'Signature verified (demo gateway)', web: u.email });
      db.admin.approvals.push({ id: 'AP-W' + (db.admin.approvals.length + 1), sid, plan: 'SOC Analyst', payId, status: 'Awaiting approval', at: new Date(u.stats.paidRequest).getTime() || now(), web: u.email, webName: (u.profile && u.profile.name) || u.email });
      changed = true;
    });
    if (changed) save();
  }
  const approvalRow = a => { const p = db.admin.payments.find(x => x.id === a.payId) || {}; const show = can('finance') !== '-' || can('approve') !== '-';
    return { ...clone(a), name: a.staffName || a.webName || nameOf(a.sid), amount: show ? p.amount : null, payStatus: p.status || 'Missing', ref: p.ref || '', method: p.method || '', signature: p.signature || '', own: !!(me && a.staffEmail === me.email) }; };

  /* ---------------- CTF registrations (from the public CTF page) ---------------- */
  const ENQ_KEY = 'yojo_enquiries';
  const enqs = () => { try { const a = JSON.parse(localStorage.getItem(ENQ_KEY)); return Array.isArray(a) ? a.filter(r => r && r.id) : []; } catch { return []; } };
  const CTF_KEY = 'yojo_ctf_registrations';
  const ctfRegs = () => { try { const a = JSON.parse(localStorage.getItem(CTF_KEY)); return Array.isArray(a) ? a.filter(r => r && r.email) : []; } catch { return []; } };
  const ctfRow = r => ({ id: r.id, name: r.name, email: r.email, institution: r.institution || '', path: 'CTF', plan: 'ctf', enrol: r.status || 'Registered', batch: r.event || 'CTF', mode: r.mode === 'Team' ? 'Team' + (r.team ? ': ' + r.team : '') : 'Solo', ctf: true });

  /* ---------------- Insight Engine store ---------------- */
  const IC = window.InsightCore, AN_KEY = 'yojo_analytics_v1';
  const insState = () => { const x = db.admin.insight = db.admin.insight || {}; x.source = x.source || 'live'; x.statuses = x.statuses || {}; x.tickets = x.tickets || []; x.rules = x.rules || (IC ? clone(IC.DEFAULTS.rules) : []); x.fired = x.fired || {}; x.exports = x.exports || []; return x; };
  let synthCache = null;
  function insightEvents() {
    if (!IC) throw err(503, 'The analytics module did not load.');
    const S = insState();
    if (S.source === 'synthetic') { if (!synthCache || Date.now() - synthCache.at > 36e5) synthCache = { at: Date.now(), ev: IC.synthetic(Date.now()) }; return synthCache.ev; }
    let ev = []; try { ev = JSON.parse(localStorage.getItem(AN_KEY)) || []; } catch {}
    let al = {}; try { al = JSON.parse(localStorage.getItem('yojo_analytics_alias')) || {}; } catch {}
    ev = ev.filter(e => !e.synthetic).map(e => al[e.uid] ? { ...e, uid: al[e.uid] } : e);
    return ev.concat(S.server || []);
  }
  // business events that only the server may record (payment and approval outcomes)
  function serverEvent(name, sid, extra = {}) { if (!IC) return; const S = insState(); S.server = S.server || [];
    const lu = loginDb().users.find(u => u.id === sid || ('WEB-' + (u.email || '').split('@')[0]) === sid); const uid = lu && lu.email ? 'u_' + fnv(lu.email.toLowerCase()) : 'srv_' + sid;
    const r = IC.ingest(S.server, [{ id: 'srv_' + name + '_' + sid + '_' + now(), name, ts: now(), uid, source: 'server', ...extra }], { now: now(), session: { uid, role: 'student', plan: name === 'paid_access_granted' ? 'paid' : 'free' } });
    if (S.server.length > 5000) S.server = S.server.slice(-5000); return r; }
  const fnv = s => { let x = 2166136261; for (const c of s) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return (x >>> 0).toString(36); };
  // what each role may see: Payment only checkout and payment events
  const PAY_EVENTS = new Set(['checkout_started', 'payment_attempt', 'payment_verified', 'payment_failed', 'paid_access_granted']);
  const scoped = ev => me.role === 'payment' ? ev.filter(e => PAY_EVENTS.has(e.name)) : ev;
  const insFilters = f => { const to = +f.to || Date.now(), days = Math.max(1, Math.min(90, +f.days || 7)); const o = { from: to - days * DAY, to }; ['role', 'plan', 'mode', 'batch', 'device', 'browser', 'region'].forEach(k => { if (f[k]) o[k] = f[k]; }); return o; };
  function insightAlerts() {
    if (!IC || can('insights') === '-') return [];
    const S = insState(); let ev; try { ev = scoped(insightEvents()); } catch { return []; }
    const res = IC.evaluateRules(ev, { from: now() - DAY, to: now() }, S.rules), out = []; let changed = false;
    res.forEach(r => { if (!r.fired) return; const last = S.fired[r.rule.id];
      // dedup + cooldown: the same rule keeps one alert id until its cooldown has passed
      if (!last || now() - last.at > r.rule.cooldownH * 36e5) { S.fired[r.rule.id] = { at: now(), value: r.value }; changed = true; }
      out.push({ id: 'ins-' + r.rule.id + '-' + S.fired[r.rule.id].at, kind: r.rule.severity === 'High' ? 'red' : 'amber', text: `Insight alert: ${r.rule.label} (now ${IC.fmtMetric(r.rule.metric, r.value)}, last 24 h${S.source === 'synthetic' ? ', SYNTHETIC data' : ''})`, href: '#/admin/analytics/insights' }); });
    if (changed) save(); return out;
  }

  /* ---------------- alerts for the admin bell ---------------- */
  function alerts() {
    const out = [], pol = db.admin.settings.policy;
    if (can('approve') !== '-') db.admin.approvals.filter(a => a.status === 'Awaiting approval').forEach(a => out.push({ id: 'ap-' + a.id, kind: 'blue', text: `Paid-access approval: ${approvalRow(a).name} (${a.plan})`, href: '#/admin/dashboard#queue' }));
    if (can('attendance') !== '-') db.students.forEach(s => { const a = attOf(s.id, s.batch); if (a.held && a.pct < pol.attendanceMin) out.push({ id: 'att-' + s.id, kind: 'red', text: `${s.name}: attendance ${a.pct}% is below ${pol.attendanceMin}%`, href: '#/admin/attendance' }); });
    if (can('finance') !== '-') Object.keys(db.admin.fees).forEach(sid => { const d = dueOf(sid); if (d && d.status === 'Overdue') out.push({ id: 'due-' + sid, kind: 'amber', text: `${nameOf(sid)}: Rs ${d.due.toLocaleString('en-IN')} overdue by ${d.overdueDays} days`, href: '#/admin/finance' }); });
    if (can('financeAct') !== '-') db.admin.offline.filter(o => o.status === 'Awaiting second admin' && o.by !== me.email).forEach(o => out.push({ id: 'off-' + o.id, kind: 'amber', text: `Second admin needed: ${o.kind} for ${nameOf(o.sid)}`, href: '#/admin/finance#second' }));
    if (can('broadcast') !== '-') db.admin.log.filter(n => n.status === 'Awaiting second admin' && n.byEmail !== me.email).forEach(n => out.push({ id: 'bc-' + n.id, kind: 'amber', text: `Second admin needed: broadcast "${n.title}" to ${n.count} students`, href: '#/admin/notifications' }));
    insightAlerts().forEach(a => out.push(a));
    const read = db.admin.readAlerts || {}; return out.map(x => ({ ...x, read: (read[me.email] || []).includes(x.id) }));
  }

  /* ---------------- the API ---------------- */
  const API = {
    ROLES, MATRIX, REPORT_SECTIONS, BACKEND_GAPS, can: p => can(p),
    setSession(s) { me = s; },
    me: () => me && clone({ ...me, roleName: ROLES[me.role] }),
    alerts: () => lag(() => alerts()),
    readAlerts: () => lag(() => { const r = db.admin.readAlerts = db.admin.readAlerts || {}; r[me.email] = alerts().map(a => a.id); save(); }),
    audit: (filter = {}) => lag(() => { need('dashboard'); const rows = db.admin.audit.filter(a => (!filter.target || a.target === filter.target)); return clone(me.role === 'platform' || filter.target ? rows : rows.filter(a => a.who === me.name)); }),
    gaps: () => clone(BACKEND_GAPS),

    /* dashboard */
    summary: () => lag(() => { syncWebRequests(); const u = allUsers(); return { total: u.length, free: u.filter(x => x.plan !== 'paid').length, paid: u.filter(x => x.plan === 'paid').length, pending: db.admin.approvals.filter(a => a.status === 'Awaiting approval').length, targetH: db.admin.settings.policy.approvalTargetH }; }),
    overview: () => lag(() => {
      const st = db.students.filter(s => s.batch !== 'OPS-B2' || true), ps = st.map(perf);
      const labsDone = st.reduce((a, s) => a + Object.values((db.labs || {})[s.id] || []).filter(l => l.state === 'Done').length, 0), labsAll = st.reduce((a, s) => a + ((db.labs || {})[s.id] || []).length, 0);
      const subs = db.assessments.flatMap(a => a.subs); const fin = can('finance') !== '-' ? Object.keys(db.admin.fees).map(dueOf) : null;
      const byBatch = [...new Set(st.map(s => s.batch))].map(b => { const xs = st.filter(s => s.batch === b).map(perf); return { batch: b, att: Math.round(xs.reduce((a, x) => a + x.att.pct, 0) / xs.length), pi: Math.round(xs.reduce((a, x) => a + x.pi, 0) / xs.length), n: xs.length }; });
      return { labs: { done: labsDone, all: labsAll }, courses: db.courses.map(c => ({ title: c.title, status: c.status, pct: (() => { const xs = st.filter(s => c.batches.includes(s.batch)); return xs.length ? Math.round(xs.reduce((a, s) => a + Math.min(100, s.quiz), 0) / xs.length * .8) : 0; })() })),
        assess: { submitted: subs.length, graded: subs.filter(s => s.state === 'Published').length, waiting: subs.filter(s => s.state !== 'Published').length }, byBatch,
        attAvg: Math.round(ps.reduce((a, p) => a + p.att.pct, 0) / ps.length), piAvg: Math.round(ps.reduce((a, p) => a + p.pi, 0) / ps.length),
        dues: fin && { outstanding: fin.reduce((a, d) => a + d.due, 0), collected: fin.reduce((a, d) => a + d.paid, 0), overdue: fin.filter(d => d.status === 'Overdue').length } };
    }),
    search: q => lag(() => {
      need('userSearch'); q = String(q || '').trim().toLowerCase(); if (q.length < 2) return [];
      const pays = db.admin.payments; const u = allUsers();
      return u.filter(x => [x.name, x.email, x.id, x.subId].some(v => v && String(v).toLowerCase().includes(q)) || (can('finance') !== '-' || can('approve') !== '-') && pays.some(p => p.sid === x.id && p.ref.toLowerCase().includes(q)))
        .slice(0, 8).map(x => ({ id: x.id, name: x.name, email: x.email, plan: x.plan, batch: x.batch, institution: x.institution || '', web: !!x.web, match: pays.find(p => p.sid === x.id && p.ref.toLowerCase().includes(q)) ? 'Payment reference' : x.subId && x.subId.toLowerCase().includes(q) ? 'Subscription ID' : x.id.toLowerCase().includes(q) ? 'User ID' : x.email.toLowerCase().includes(q) ? 'Email' : 'Name' }));
    }),
    approvals: () => lag(() => { if (can('approve') === '-' && can('finance') === '-') throw err(403, 'The approval queue is for Platform and Payment admins.'); syncWebRequests(); return db.admin.approvals.map(approvalRow).sort((a, b) => (a.status !== 'Awaiting approval') - (b.status !== 'Awaiting approval') || b.at - a.at); }),
    decide: (id, decision, reason = '') => lag(() => {
      need('approve'); const a = db.admin.approvals.find(x => x.id === id); if (!a) throw err(404, 'Request not found.'); if (a.status !== 'Awaiting approval' && a.status !== 'Info requested') throw err(409, 'This request is already ' + a.status.toLowerCase() + '.');
      if (a.staffEmail && a.staffEmail === me.email) throw err(403, 'You cannot approve or reject your own subscription. Another admin must decide.');
      const p = db.admin.payments.find(x => x.id === a.payId) || {};
      if (decision === 'Approved' && p.status !== 'Verified') throw err(409, 'Approve stays locked until the payment is verified on the server.');
      if (decision !== 'Approved' && !reason.trim()) throw err(400, 'A reason is required.');
      a.status = decision === 'Info' ? 'Info requested' : decision; a.decidedAt = now(); a.by = me.name; a.reason = reason;
      if (decision === 'Rejected') { a.refund = 'Refund started'; }
      if (decision === 'Approved') { if (db.admin.accounts[a.sid]) Object.assign(db.admin.accounts[a.sid], { plan: 'paid', planName: a.plan, subId: db.admin.accounts[a.sid].subId || 'SUB-' + (8000 + db.admin.approvals.indexOf(a)) });
        const l = loginDb(); const lu = l.users.find(u => u.role === 'student' && (u.id === a.sid || u.email === a.web)); if (lu) { lu.stats = lu.stats || {}; lu.stats.plan = 'paid'; delete lu.stats.paidRequest; saveLogin(l); } }
      if (db.students.some(s => s.id === a.sid)) notifyStudent(a.sid, decision === 'Approved' ? 'Paid access approved' : decision === 'Rejected' ? 'Paid access not approved' : 'More information needed', decision === 'Approved' ? `Your ${a.plan} plan is now active.` : reason);
      else if (a.web) { const l = loginDb(); const lu = l.users.find(u => u.email === a.web); if (lu && decision !== 'Approved') { lu.stats = lu.stats || {}; delete lu.stats.paidRequest; lu.notifs = lu.notifs || []; lu.notifs.unshift({ id: 'adm-' + now(), k: 'notice', t: decision === 'Rejected' ? 'Paid access not approved' : 'More information needed', b: reason, from: 'Yojo Admin', at: 'now', read: false }); saveLogin(l); } }
      if (decision === 'Approved') serverEvent('paid_access_granted', a.sid);
      audit('paid access ' + (decision === 'Info' ? 'info requested' : decision.toLowerCase()), a.sid, reason || a.plan); save();
    }),

    /* students */
    students: (f = {}) => lag(() => {
      const lvl = need('students'); let u = allUsers().filter(x => x.plan === 'paid');
      const paidEmails = new Set(u.map(x => (x.email || '').toLowerCase()));
      u = u.concat(ctfRegs().filter(r => !paidEmails.has(r.email.toLowerCase())).map(ctfRow));
      if (f.q) { const q = f.q.toLowerCase(); u = u.filter(x => (x.name + x.id + x.email).toLowerCase().includes(q)); }
      ['path', 'plan', 'batch', 'mode'].forEach(k => { if (f[k]) u = u.filter(x => x[k] === f[k]); });
      return u.map(x => { const s = db.students.find(y => y.id === x.id); const p = s && perf(s); const row = { id: x.id, name: x.name, institution: x.institution, path: x.path, plan: x.plan, enrol: x.enrol || (x.web ? 'Website sign-up' : ''), batch: x.batch, mode: x.mode, ctf: !!x.ctf, web: !!x.web };
        if (me.role !== 'payment' && p) { row.att = p.att.pct; row.pi = p.pi; }
        if (me.role === 'payment' || me.role === 'platform') row.planName = x.planName;
        return row; });
    }),
    student: id => lag(() => {
      need('students'); const s = db.students.find(x => x.id === id); const web = !s && allUsers().find(x => x.id === id);
      if (!s && !web) throw err(404, 'No student with that ID.');
      if (me.role === 'support' && !(db.admin.purposes[me.email] || {})[id]) throw err(428, 'Support admins state a reason before opening a student record.');
      if (web) return { id, name: web.name, web: true, email: web.email, plan: web.plan, tabs: ['Profile', 'Audit'], profile: { Email: web.email, Status: 'Signed up on the website, not in a batch yet', Path: web.path || 'Not chosen' } };
      const a = db.admin.accounts[id] || {}, p = perf(s), lu = loginFor(s), r = me.role;
      const tabs = ['Profile', 'Progress', 'Labs', 'Payments', 'Audit'].filter(t => t !== 'Payments' || can('finance') !== '-').filter(t => t !== 'Labs' || r !== 'payment').filter(t => t !== 'Progress' || r !== 'payment');
      const out = { id, name: s.name, batch: s.batch, path: s.path, rank: s.rank, plan: (lu && lu.stats && lu.stats.plan === 'paid') ? 'paid' : a.plan, planName: a.planName, subId: a.subId, enrol: a.enrol, mode: a.mode, access: a.access, institution: a.institution, tabs };
      out.profile = { Email: (lu && lu.email) || s.email, Institution: a.institution, City: a.city, 'Learning mode': `${a.mode} (${a.access})`, Registered: new Date(a.registered).toLocaleDateString('en-IN') };
      if (r !== 'payment') Object.assign(out.profile, { Phone: s.phone, 'Date of birth': a.dob });
      if (r === 'platform' || r === 'support') Object.assign(out.profile, { Guardian: `${a.guardian.name} (${a.guardian.rel})`, 'Guardian phone': a.guardian.phone });
      out.resume = { done: s.resume, education: lu && lu.profile ? `${lu.profile.eduLevel || ''} ${lu.profile.stream || ''}, ${lu.profile.institution || a.institution}`.trim() : a.institution, skills: lu && lu.profile ? lu.profile.skills || '' : '', objective: lu && lu.profile ? lu.profile.objective || '' : '' };
      if (tabs.includes('Progress')) out.progress = { pi: p.pi, band: p.band, att: p.att, labs: s.labs, quiz: s.quiz, xp: s.xp, missed: s.missed, mocks: s.mocks, internship: s.internship,
        lectures: db.lectures.filter(l => l.batch === s.batch && l.status === 'held').slice(-8).map(l => ({ n: l.n, topic: l.topic, start: l.start, mark: l.marks[id] || null })) };
      if (tabs.includes('Labs')) out.labs = clone((db.labs || {})[id] || []).map(l => ({ m: l.m, state: l.state, cp: l.cp, cpTotal: l.cpTotal, mins: l.mins }));
      if (tabs.includes('Payments')) { out.payments = db.admin.payments.filter(x => x.sid === id).map(x => ({ ...clone(x) })); out.dues = dueOf(id); out.fee = clone(db.admin.fees[id] || null); }
      if (r === 'platform') out.note = db.admin.notes[id] || '';
      audit('opened student record', id, r === 'support' ? 'Reason: ' + db.admin.purposes[me.email][id] : ''); save();
      return out;
    }),
    statePurpose: (id, reason) => lag(() => { if (!reason || reason.trim().length < 5) throw err(400, 'Give a short reason (at least 5 characters).'); (db.admin.purposes[me.email] = db.admin.purposes[me.email] || {})[id] = reason.trim(); audit('stated reason to view', id, reason); save(); }),
    saveStudent: (id, f) => lag(() => {
      if (!['platform', 'support'].includes(me.role)) throw err(403, 'Only Platform and Support admins edit student details.');
      const a = db.admin.accounts[id]; if (!a) throw err(404, 'Student not found.'); const changes = [];
      ['institution', 'city'].forEach(k => { if (f[k] != null && f[k] !== a[k]) { if (!String(f[k]).trim()) throw err(400, k + ' cannot be empty.'); changes.push(`${k}: ${a[k]} → ${f[k]}`); a[k] = f[k].trim(); } });
      if (f.mode && f.mode !== a.mode) { if (me.role !== 'platform') throw err(403, 'Only a Platform admin changes the learning mode.'); if (!(f.reason || '').trim()) throw err(400, 'Changing the learning mode needs a reason.'); changes.push(`mode: ${a.mode} → ${f.mode}`); a.mode = f.mode; a.access = f.mode === 'Online' ? 'Live + Recorded' : 'Class'; }
      if (f.note != null && me.role === 'platform') { db.admin.notes[id] = f.note; changes.push('internal note updated'); }
      if (!changes.length) throw err(400, 'Nothing changed.');
      audit('edited student', id, changes.join('; ') + (f.reason ? ' | Reason: ' + f.reason : '')); save(); return changes;
    }),
    createTrainer: f => lag(() => {
      if (me.role !== 'platform') throw err(403, 'Only a Platform admin creates staff accounts.');
      const l = loginDb(); const em = String(f.email || '').trim().toLowerCase();
      if (!f.name || !f.name.trim()) throw err(400, 'Name is required.'); if (!/^[^@\s]+@yojo\.demo$/.test(em)) throw err(400, 'Use an organisation email ending in @yojo.demo.');
      if (l.users.some(u => u.email === em)) throw err(409, 'That email already has an account.');
      l.users.push({ email: em, role: 'trainer', name: f.name.trim(), capability: f.capability || 'Trainer', batches: f.batches || '', status: 'invited', invitedAt: now(), mfaSecret: null, createdBy: me.email }); saveLogin(l);
      audit('created trainer invite', em, f.batches || ''); save();
    }),
    staff: () => lag(() => { if (me.role !== 'platform') throw err(403, 'Only a Platform admin manages staff.'); return loginDb().users.filter(u => u.role === 'trainer' || u.role === 'admin').map(u => ({ email: u.email, name: u.name, role: u.role === 'admin' ? ROLES[u.adminRole] : u.capability, status: u.status, batches: u.batches || '' })); }),

    /* attendance (same record the trainer marks and the student report reads) */
    attendance: (f = {}) => lag(() => {
      const lvl = need('attendance'); const pol = db.admin.settings.policy;
      const batches = [...new Set(db.students.map(s => s.batch))];
      const batch = f.batch || batches[0], from = f.from ? new Date(f.from).getTime() : 0, to = f.to ? new Date(f.to).getTime() + DAY - 1 : Infinity;
      let st = db.students.filter(s => s.batch === batch); if (f.q) st = st.filter(s => (s.name + s.id).toLowerCase().includes(f.q.toLowerCase()));
      const lect = db.lectures.filter(l => l.batch === batch && l.start >= from && l.start <= to);
      let rows = st.map(s => { const a = attOf(s.id, batch, from, to); return { id: s.id, name: s.name, ...a, flag: a.held && a.pct < pol.attendanceMin ? 'Below ' + pol.attendanceMin + '%' : 'OK' }; });
      if (f.status === 'low') rows = rows.filter(r => r.flag !== 'OK');
      const edits = (db.attendanceEdits || []).filter(e => lect.some(l => l.id === e.lid)).slice(-30).reverse().map(e => ({ ...e, name: nameOf(e.sid), lecture: (db.lectures.find(l => l.id === e.lid) || {}).topic }));
      return { batches, batch, required: pol.attendanceMin, canEdit: can('attendanceEdit') !== '-', lectures: lect.map(l => ({ id: l.id, n: l.n, topic: l.topic, start: l.start, status: l.status, holidayName: l.holidayName, marks: l.marks, locked: l.locked })), rows, edits };
    }),
    editAttendance: (lid, sid, mark, reason) => lag(() => {
      need('attendanceEdit'); const l = db.lectures.find(x => x.id === lid); if (!l) throw err(404, 'Lecture not found.'); if (l.status !== 'held') throw err(409, 'No class was held: nothing to mark.');
      if (!['P', 'A'].includes(mark)) throw err(400, 'Use Present or Absent.'); if (!(reason || '').trim()) throw err(400, 'A reason is required for every attendance change.');
      const old = l.marks[sid] || '-'; if (old === mark) throw err(400, 'That is already the recorded mark.');
      l.marks[sid] = mark; db.attendanceEdits = db.attendanceEdits || []; db.attendanceEdits.push({ lid, sid, old, new: mark, who: me.name + ' (' + ROLES[me.role] + ')', at: now(), reason });
      audit('attendance changed', sid, `${l.topic}: ${old} → ${mark}. ${reason}`); save();
    }),

    /* performance */
    performance: (f = {}) => lag(() => {
      need('performance'); const pol = db.admin.settings.policy; let st = db.students; if (f.batch) st = st.filter(s => s.batch === f.batch);
      const rows = st.map(s => ({ id: s.id, name: s.name, batch: s.batch, ...perf(s) })); const avg = k => Math.round(rows.reduce((a, r) => a + (k === 'att' ? r.att.pct : r[k]), 0) / Math.max(1, rows.length));
      const trend = db.lectures.filter(l => l.status === 'held' && (!f.batch || l.batch === f.batch)).slice(-8).map(l => { const ms = Object.values(l.marks); return { label: '#' + l.n + ' ' + l.batch, pct: ms.length ? Math.round(ms.filter(m => m === 'P').length / ms.length * 100) : null }; });
      return { weights: { Attendance: pol.piAttendance, Labs: pol.piLabs, 'Courses and assessments': pol.piCourses, 'Leaderboard and XP': pol.piXp }, rows, avg: { pi: avg('pi'), att: avg('att'), labs: avg('labsPct'), quiz: avg('quiz'), xp: avg('xp') }, batches: [...new Set(db.students.map(s => s.batch))], trend };
    }),

    /* trainer attendance: an absent trainer means the batch's students are told straight away */
    trainerAttendance: (f = {}) => lag(() => {
      need('attendance'); const day = f.date || new Date().toISOString().slice(0, 10), log = db.admin.trainerAtt = db.admin.trainerAtt || [];
      const ids = [...new Set(db.batches.map(b => b.trainer))];
      const rows = ids.map(tid => { const bs = db.batches.filter(b => b.trainer === tid), mine = log.filter(x => x.tid === tid), today = mine.find(x => x.date === day);
        const month = mine.filter(x => x.date.slice(0, 7) === day.slice(0, 7)), P = month.filter(x => x.status === 'P').length;
        return { tid, name: TRAINER_NAMES[tid] || tid, batches: bs.map(b => `${b.id} · ${b.slot}`), students: db.students.filter(s => bs.some(b => b.id === s.batch)).length, mark: today ? today.status : null, reason: today ? today.reason : '', P, A: month.length - P, pct: month.length ? Math.round(P / month.length * 100) : 100 }; });
      return { date: day, rows, canEdit: can('attendanceEdit') !== '-', history: log.slice(-20).reverse().map(x => ({ ...x, name: TRAINER_NAMES[x.tid] || x.tid })) };
    }),
    markTrainer: (tid, date, status, reason = '') => lag(() => {
      need('attendanceEdit'); if (!['P', 'A'].includes(status)) throw err(400, 'Use Present or Absent.');
      if (status === 'A' && !reason.trim()) throw err(400, 'Add a reason or a note for the students (for example: class moved to Friday).');
      const log = db.admin.trainerAtt = db.admin.trainerAtt || []; const old = log.find(x => x.tid === tid && x.date === date);
      const row = { tid, date, status, reason: reason.trim(), by: me.name, at: now(), notified: 0 };
      if (old) Object.assign(old, row); else log.push(row);
      const name = TRAINER_NAMES[tid] || tid, bs = db.batches.filter(b => b.trainer === tid), when = new Date(date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
      if (status === 'A' && (!old || old.status !== 'A')) {
        db.students.filter(s => bs.some(b => b.id === s.batch)).forEach(s => { notifyStudent(s.id, 'Trainer absent', `Your trainer ${name} is absent on ${when}. ${reason.trim()}`); row.notified++; });
      } else if (status === 'P' && old && old.status === 'A') {
        db.students.filter(s => bs.some(b => b.id === s.batch)).forEach(s => notifyStudent(s.id, 'Class is on', `Update: your trainer ${name} is available on ${when}. The class runs as planned.`));
      }
      if (old) old.notified = row.notified;
      audit('trainer attendance', name, `${date}: ${status === 'P' ? 'Present' : 'Absent'}${reason ? '. ' + reason : ''}${row.notified ? `. ${row.notified} students notified` : ''}`); save(); return row.notified;
    }),

    /* manual payment split: the admin sets each instalment; the student is told the new schedule */
    splitFee: (sid, parts) => lag(() => {
      need('financeAct'); const f = db.admin.fees[sid]; if (!f) throw err(404, 'No fee plan.');
      const paid = f.instalments.filter(i => i.paidAt), left = f.total - paid.reduce((a, i) => a + i.amount, 0);
      const ps = (parts || []).map(x => ({ amount: Math.round(+x.amount), due: new Date(x.due).getTime() })).filter(x => x.amount || x.due);
      if (!ps.length) throw err(400, 'Add at least one instalment.');
      if (ps.some(x => !(x.amount > 0))) throw err(400, 'Every instalment needs an amount above zero.');
      if (ps.some(x => !x.due || isNaN(x.due))) throw err(400, 'Every instalment needs a due date.');
      const sum = ps.reduce((a, x) => a + x.amount, 0); if (sum !== left) throw err(400, `The instalments add up to Rs ${sum.toLocaleString('en-IN')}, but Rs ${left.toLocaleString('en-IN')} is left to pay.`);
      ps.sort((a, b) => a.due - b.due);
      f.instalments = [...paid, ...ps.map((x, k) => ({ n: paid.length + k + 1, amount: x.amount, due: x.due }))]; f.manualSplit = { by: me.name, at: now() };
      const d = x => new Date(x).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      notifyStudent(sid, 'Fee due schedule', `Your fee is split into ${ps.length} payment${ps.length === 1 ? '' : 's'}: ${ps.map(x => `Rs ${x.amount.toLocaleString('en-IN')} due ${d(x.due)}`).join('; ')}.`);
      f.reminders.unshift({ at: now(), by: me.name, kind: 'Due schedule sent' });
      audit('fee split set manually', sid, ps.map(x => `Rs ${x.amount} by ${d(x.due)}`).join(', ')); save();
    }),

    /* finance */
    finance: () => lag(() => {
      const lvl = need('finance');
      const rows = Object.keys(db.admin.fees).map(sid => ({ sid, name: nameOf(sid), ...dueOf(sid), mode: (db.admin.accounts[sid] || {}).mode, reminders: db.admin.fees[sid].reminders.length, instalments: clone(db.admin.fees[sid].instalments), reminderLog: clone(db.admin.fees[sid].reminders) }));
      const pays = db.admin.payments.filter(p => p.sid !== 'STAFF').map(p => ({ ...clone(p), name: nameOf(p.sid) })).sort((a, b) => b.at - a.at);
      return { rows, payments: pays, offline: db.admin.offline.map(o => ({ ...clone(o), name: nameOf(o.sid), mine: o.by === me.email })), canAct: can('financeAct') !== '-', restricted: lvl === 'R',
        collected: pays.filter(p => p.status === 'Verified').reduce((a, p) => a + p.amount, 0), outstanding: rows.reduce((a, r) => a + r.due, 0), overdue: rows.filter(r => r.status === 'Overdue').length };
    }),
    remind: sid => lag(() => { need('financeAct'); const f = db.admin.fees[sid]; if (!f) throw err(404, 'No fee plan.'); const d = dueOf(sid); if (!d.due) throw err(409, 'Nothing is due.');
      f.reminders.unshift({ at: now(), by: me.name, kind: 'Manual reminder' }); notifyStudent(sid, 'Fee reminder', `Rs ${d.due.toLocaleString('en-IN')} is due${d.next ? ' by ' + new Date(d.next.due).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}. Pay from your account page.`);
      audit('sent due reminder', sid, 'Rs ' + d.due); save(); }),
    recordOffline: (sid, f) => lag(() => {
      need('financeAct'); const fee = db.admin.fees[sid]; if (!fee) throw err(404, 'No fee plan.'); const amt = Math.round(+f.amount);
      if (!(amt > 0)) throw err(400, 'Enter an amount above zero.'); if (amt > dueOf(sid).due) throw err(400, 'The amount is more than what is due.');
      if (!(f.ref || '').trim()) throw err(400, 'Enter the receipt or reference number.'); if (/\b\d{13,19}\b/.test(f.ref + ' ' + (f.note || ''))) throw err(400, 'Card numbers must never be entered. Use the receipt number.');
      const o = { id: 'OF-' + now(), sid, kind: 'Offline payment', amount: amt, method: f.method || 'Cash', ref: f.ref.trim(), note: f.note || '', by: me.email, byName: me.name, at: now(), status: 'Awaiting second admin' };
      db.admin.offline.unshift(o); audit('recorded offline payment (needs second admin)', sid, `Rs ${amt} ${o.method} ${o.ref}`); save(); }),
    overridePayment: (payId, reason) => lag(() => { need('financeAct'); const p = db.admin.payments.find(x => x.id === payId); if (!p) throw err(404, 'Payment not found.'); if (p.status === 'Verified') throw err(409, 'Already verified.');
      if (!(reason || '').trim()) throw err(400, 'A reason is required for a manual override.');
      db.admin.offline.unshift({ id: 'OV-' + now(), sid: p.sid, payId, kind: 'Manual payment override', amount: p.amount, method: p.method, ref: p.ref, note: reason, by: me.email, byName: me.name, at: now(), status: 'Awaiting second admin' });
      audit('requested manual payment override (needs second admin)', p.sid, `${p.ref}: ${reason}`); save(); }),
    secondAdmin: (id, ok, reason = '') => lag(() => {
      need('financeAct'); const o = db.admin.offline.find(x => x.id === id); if (!o) throw err(404, 'Not found.'); if (o.status !== 'Awaiting second admin') throw err(409, 'Already decided.');
      if (o.by === me.email) throw err(403, 'A different admin must confirm this. You recorded it.');
      if (!ok && !reason.trim()) throw err(400, 'A reason is required.');
      o.status = ok ? 'Confirmed' : 'Rejected'; o.second = me.name; o.decidedAt = now(); o.reason = reason;
      if (ok && o.kind === 'Offline payment') { const f = db.admin.fees[o.sid]; let left = o.amount; f.instalments.filter(i => !i.paidAt).sort((a, b) => a.due - b.due).forEach(i => { if (left >= i.amount) { left -= i.amount; Object.assign(i, { paidAt: now(), ref: o.ref, method: o.method + ' (offline)' }); } });
        if (left > 0) { const i = f.instalments.find(x => !x.paidAt); if (i) { f.instalments.push({ n: i.n + '-part', amount: left, due: i.due, paidAt: now(), ref: o.ref, method: o.method + ' (offline)' }); i.amount -= left; } }
        db.admin.payments.push({ id: 'PY-OF' + db.admin.payments.length, sid: o.sid, ref: o.ref, method: o.method + ' (offline)', amount: o.amount, status: 'Verified', at: now(), plan: f.plan, signature: 'Offline: confirmed by two admins' });
        notifyStudent(o.sid, 'Payment received', `Rs ${o.amount.toLocaleString('en-IN')} recorded. Receipt ${o.ref}.`); }
      if (ok && o.kind === 'Manual payment override') { const p = db.admin.payments.find(x => x.id === o.payId); p.status = 'Verified'; p.signature = 'Manual override by two admins'; }
      audit(`${o.kind.toLowerCase()} ${ok ? 'confirmed' : 'rejected'} by second admin`, o.sid, reason); save(); }),

    /* courses */
    courses: (f = {}) => lag(() => { need('courses'); let c = db.courses; if (f.q) c = c.filter(x => x.title.toLowerCase().includes(f.q.toLowerCase())); ['track', 'level', 'status'].forEach(k => { if (f[k]) c = c.filter(x => x[k] === f[k]); });
      return c.map(x => ({ id: x.id, title: x.title, desc: x.desc, track: x.track, level: x.level, duration: x.duration, status: x.status, version: x.version, owner: x.owner === 'trainer' ? 'Vikram Rao (Trainer)' : x.owner === 'someone.else' ? 'Another trainer' : x.owner, batches: x.batches, modules: x.modules.length, lessons: x.modules.reduce((a, m) => a + m.lessons.length, 0), updated: (x.versions[0] || {}).at || null })); }),
    course: id => lag(() => { need('courses'); const c = db.courses.find(x => x.id === id); if (!c) throw err(404, 'Course not found.'); return clone(c); }),
    saveCourse: (id, f) => lag(() => {
      need('courses'); let c = id && db.courses.find(x => x.id === id);
      if (!c) { if (!(f.title || '').trim()) throw err(400, 'A course title is required.'); c = { id: 'C-' + now().toString(36).toUpperCase(), title: '', desc: '', track: 'Defensive', level: 'Beginner', duration: '', owner: me.name, coEditor: '', batches: [], status: 'Draft', version: 0, outcomes: [], modules: [], versions: [] }; db.courses.push(c); audit('created course', c.id, f.title); }
      ['title', 'desc', 'track', 'level', 'duration'].forEach(k => { if (f[k] != null) c[k] = String(f[k]).trim(); }); if (!c.title) throw err(400, 'A course title is required.');
      if (f.batches) c.batches = f.batches; if (f.modules) c.modules = f.modules;
      c.dirty = c.status === 'Published'; audit('saved course draft', c.id, c.title); save(); return c.id; }),
    readiness: id => lag(() => { const c = db.courses.find(x => x.id === id); const ls = c.modules.flatMap(m => m.lessons); const F = window.TrainerFiles;
      const checks = [['Has a title and description', !!(c.title && c.desc)], ['At least one module with a lesson', ls.length > 0], ['No upload still processing', ls.every(l => !l.file || l.file.proc === 'Ready')], ['Every upload passed the virus scan', ls.every(l => !l.file || l.file.scan === 'Clean')],
        ['Every file matches its lesson type', ls.every(l => !l.file || !F || !F.FILE_RULES[l.type] || F.fileFits(l.type, l.file.name))], ['Every link lesson has a web address', ls.every(l => l.type !== 'Link' || /^https?:\/\//.test(l.url || ''))]].map(([label, ok]) => ({ label, ok }));
      return { checks, ok: checks.every(x => x.ok) }; }),
    publish: (id, summary) => lag(() => { need('courses'); const c = db.courses.find(x => x.id === id); if (!(summary || '').trim()) throw err(400, 'Write a change summary for this version.');
      const r = (() => { const ls = c.modules.flatMap(m => m.lessons); return ls.length && ls.every(l => !l.file || (l.file.proc === 'Ready' && l.file.scan === 'Clean')) && c.title && c.desc; })(); if (!r) throw err(409, 'Not ready: fix the readiness checks first (uploads still processing or failed the scan, or no lessons).');
      c.version += 1; c.status = 'Published'; c.dirty = false; c.modules.forEach(m => m.lessons.forEach(l => { if (l.status === 'Draft') l.status = 'Published'; }));
      c.versions.unshift({ v: c.version, status: 'Published', author: me.name, at: now(), summary }); c.batches.forEach(b => db.students.filter(s => s.batch === b).forEach(s => notifyStudent(s.id, 'New course content', `${c.title} v${c.version}: ${summary}`)));
      audit('published course v' + c.version, c.id, summary); save(); }),
    unpublish: (id, reason) => lag(() => { need('courses'); const c = db.courses.find(x => x.id === id); if (!(reason || '').trim()) throw err(400, 'A reason is required.'); c.status = 'Unpublished'; c.unpublishReason = reason; c.versions.unshift({ v: c.version, status: 'Unpublished', author: me.name, at: now(), summary: 'Unpublished: ' + reason }); audit('unpublished course', c.id, reason); save(); }),

    /* labs */
    labs: (f = {}) => lag(() => { need('labs'); let l = db.admin.labs; if (f.q) l = l.filter(x => (x.id + x.title).toLowerCase().includes(f.q.toLowerCase())); ['category', 'difficulty', 'status'].forEach(k => { if (f[k]) l = l.filter(x => x[k] === f[k]); });
      return l.map(x => { const o = clone(x); o.flags = o.flags.map(fl => ({ cp: fl.cp, value: '••••••••' })); return o; }); }),
    lab: id => lag(() => { need('labs'); const l = db.admin.labs.find(x => x.id === id); if (!l) throw err(404, 'Lab not found.'); const o = clone(l); o.flags = o.flags.map(fl => ({ cp: fl.cp, value: '••••••••' })); o.courseList = db.courses.map(c => ({ id: c.id, title: c.title })); return o; }),
    revealFlags: (id, code) => lag(() => { need('labSecrets'); if (!window.AdminMFA.ok(code)) throw err(401, 'That authenticator code is not right.'); const l = db.admin.labs.find(x => x.id === id); audit('viewed lab flags', id, 'MFA confirmed'); save(); return clone(l.flags); }),
    saveLab: (id, f) => lag(() => { need('labs'); let l = id && db.admin.labs.find(x => x.id === id);
      if (!l) { if (!/^[A-Z]{3}-\d{2}$/.test(f.id || '')) throw err(400, 'Lab ID looks like DEF-06 (three letters, dash, two digits).'); if (db.admin.labs.some(x => x.id === f.id)) throw err(409, 'That lab ID exists.'); l = { id: f.id, title: '', category: '', difficulty: 'Easy', path: 'Defensive', status: 'Draft', courses: [], env: { image: '', timeoutMin: 90, network: 'Isolated per student', maxSeats: 60 }, flags: [], hints: [], updated: now() }; db.admin.labs.push(l); audit('created lab', l.id); }
      if (!(f.title || l.title).trim()) throw err(400, 'A lab title is required.');
      ['title', 'category', 'difficulty', 'path'].forEach(k => { if (f[k] != null) l[k] = f[k]; }); if (f.courses) l.courses = f.courses; if (f.hints) l.hints = f.hints.filter(Boolean);
      if (f.env) { const t = +f.env.timeoutMin; if (!(t >= 15 && t <= 240)) throw err(400, 'Session timeout must be 15 to 240 minutes.'); Object.assign(l.env, f.env, { timeoutMin: t, network: 'Isolated per student' }); }
      if (f.newFlags && f.newFlags.length) { need('labSecrets'); l.flags = f.newFlags.map((v, k) => ({ cp: k + 1, value: v })); audit('changed lab flags', l.id, f.newFlags.length + ' checkpoints'); }
      l.updated = now(); audit('saved lab', l.id, l.title); save(); return l.id; }),
    labStatus: (id, status, reason = '') => lag(() => { need('labs'); const l = db.admin.labs.find(x => x.id === id); if (status === 'Unpublished' && !reason.trim()) throw err(400, 'A reason is required.'); if (status === 'Published' && !l.flags.length) throw err(409, 'Add at least one flag before publishing.'); l.status = status; l.reason = reason; l.updated = now(); audit((status === 'Published' ? 'published' : 'unpublished') + ' lab', id, reason); save(); }),

    /* assessments */
    assessments: (f = {}) => lag(() => { const lvl = need('assessments'); const st = a => a.state === 'Draft' ? 'Draft' : a.open > now() ? 'Scheduled' : a.due > now() ? 'Active' : 'Completed';
      let rows = db.assessments.map(a => ({ id: a.id, title: a.title, type: a.type, course: (db.courses.find(c => c.id === a.courseId) || {}).title || a.courseId, courseId: a.courseId, batch: a.batch, open: a.open, due: a.due, state: st(a), questions: a.questions.length, submitted: a.subs.length || a.submitted || 0, graded: a.subs.filter(s => s.state === 'Published').length,
        avg: lvl === 'Y' ? (() => { const g = a.subs.filter(s => s.published); return g.length ? Math.round(g.reduce((x, s) => x + s.published.total, 0) / g.length) : null; })() : null }));
      if (f.q) rows = rows.filter(r => r.title.toLowerCase().includes(f.q.toLowerCase())); if (f.state) rows = rows.filter(r => r.state === f.state); if (f.course) rows = rows.filter(r => r.courseId === f.course); if (f.type) rows = rows.filter(r => r.type === f.type);
      return { rows, canEdit: lvl === 'Y', bank: lvl === 'Y' ? clone(db.qbank) : [], courses: db.courses.map(c => ({ id: c.id, title: c.title })), batches: [...new Set(db.students.map(s => s.batch))] }; }),
    saveAssessment: f => lag(() => { if (need('assessments') !== 'Y') throw err(403, 'Support admins can view assessments but not change them.');
      if (!(f.title || '').trim()) throw err(400, 'A title is required.'); const open = new Date(f.open).getTime(), due = new Date(f.due).getTime(); if (!(open && due)) throw err(400, 'Set the open and due times.'); if (due <= open) throw err(400, 'The due time must be after the open time.');
      if (!f.questions || !f.questions.length) throw err(400, 'Pick at least one question from the bank.');
      const a = { id: 'AS-' + (db.assessments.length + 1) + now().toString(36).slice(-3), title: f.title.trim(), type: f.type, courseId: f.courseId, batch: f.batch, open, due, questions: f.questions, lesson: '', auto: f.type === 'Quiz', rubric: f.type === 'Quiz' ? undefined : ['Accuracy', 'Method', 'Clarity'], subs: [], state: f.draft ? 'Draft' : undefined };
      db.assessments.push(a); audit('created ' + f.type.toLowerCase(), a.id, a.title); save(); return a.id; }),
    addQuestion: (topic, text) => lag(() => { if (need('assessments') !== 'Y') throw err(403, 'Not allowed.'); if (!text.trim() || !topic.trim()) throw err(400, 'Topic and question are required.'); const q = { id: 'Q-' + (300 + db.qbank.length), topic, text }; db.qbank.push(q); audit('added question', q.id, '(answer key stored server-side)'); save(); }),

    /* analytics */
    analytics: (f = {}) => lag(() => { const lvl = need('analytics'); const u = allUsers(); const ps = db.students.map(s => ({ s, p: perf(s) }));
      const out = { updated: now(), source: 'Computed now from the shared demo record (no analytics service yet)', users: { total: u.length, free: u.filter(x => x.plan !== 'paid').length, paid: u.filter(x => x.plan === 'paid').length },
        byPath: ['Offensive', 'Defensive', 'GRC'].map(p => ({ label: p, n: db.students.filter(s => s.path === p).length })), bands: ['Excelling', 'On track', 'Needs attention', 'At risk'].map(b => ({ label: b, n: ps.filter(x => x.p.band === b).length })),
        cohorts: [...new Set(db.students.map(s => s.batch))].map(b => { const xs = ps.filter(x => x.s.batch === b); return { batch: b, n: xs.length, att: Math.round(xs.reduce((a, x) => a + x.p.att.pct, 0) / xs.length), pi: Math.round(xs.reduce((a, x) => a + x.p.pi, 0) / xs.length), labs: Math.round(xs.reduce((a, x) => a + x.s.labs, 0) / xs.length) }; }),
        activity: { activeWeek: db.students.filter(s => now() - s.lastActive < 7 * DAY).length, idle: db.students.filter(s => now() - s.lastActive >= 7 * DAY).length },
        assessments: db.assessments.map(a => ({ title: a.title, subs: a.subs.length || a.submitted || 0, graded: a.subs.filter(s => s.state === 'Published').length })) };
      if (can('finance') !== '-') { const fees = Object.keys(db.admin.fees).map(dueOf); out.finance = { collected: db.admin.payments.filter(p => p.status === 'Verified' && p.sid !== 'STAFF').reduce((a, p) => a + p.amount, 0), outstanding: fees.reduce((a, d) => a + d.due, 0), overdue: fees.filter(d => d.status === 'Overdue').length }; }
      if (me.role === 'payment') { delete out.bands; delete out.cohorts; }
      return out; }),
    exportAnalytics: kind => lag(() => { need('analytics'); if (kind === 'finance' && can('finance') === '-') throw err(403, 'Your role cannot export finance data.'); audit('exported analytics', kind); save(); }),

    /* notifications */
    notifications: () => lag(() => { need('notifications'); return { log: clone(db.admin.log), holidays: clone(db.admin.holidays), templates: clone(db.admin.templates), canBroadcast: can('broadcast') !== '-', threshold: db.admin.settings.policy.broadcastSecondAdmin,
      batches: [...new Set(db.students.map(s => s.batch))], students: db.students.map(s => ({ id: s.id, name: s.name, batch: s.batch })), birthdaysToday: Object.entries(db.admin.accounts).filter(([, a]) => a.dob && a.dob.slice(5) === new Date().toISOString().slice(5, 10)).map(([sid]) => nameOf(sid)) }; }),
    audienceSize: aud => lag(() => audience(aud).length),
    send: f => lag(() => {
      const lvl = need('notifications'); if (!(f.title || '').trim() || !(f.body || '').trim()) throw err(400, 'Title and message are required.');
      if (/\b\d{13,19}\b|cvv|upi pin/i.test(f.body)) throw err(400, 'Messages cannot contain card data or PINs.');
      if (f.aud.kind !== 'Individual' && can('broadcast') === '-') throw err(403, `${ROLES[me.role]} can send individual messages only.`);
      if (['Festival wish', 'Holiday notice'].includes(f.type) && can('broadcast') === '-') throw err(403, 'Wishes and holiday notices are sent by Platform or Content admins.');
      const ids = audience(f.aud); if (!ids.length) throw err(400, 'No students match that audience.');
      const n = { id: 'NT-' + now().toString(36), title: f.title.trim(), body: f.body.trim(), type: f.type, audience: audLabel(f.aud), channels: ['In-app'].concat(f.channels || []), at: f.when ? new Date(f.when).getTime() : now(), by: me.name, byEmail: me.email, count: ids.length, delivered: 0, read: 0, important: !!f.important, calendar: !!f.calendar, ids };
      const big = ids.length >= db.admin.settings.policy.broadcastSecondAdmin && f.aud.kind !== 'Individual';
      n.status = big ? 'Awaiting second admin' : n.at > now() + 6e4 ? 'Scheduled' : 'Sent';
      if (n.status === 'Sent') deliver(n);
      db.admin.log.unshift(n); audit(n.status === 'Sent' ? 'sent notification' : n.status === 'Scheduled' ? 'scheduled notification' : 'broadcast waiting for second admin', n.audience, n.title); save(); return n.status;
    }),
    approveBroadcast: id => lag(() => { need('broadcast'); const n = db.admin.log.find(x => x.id === id); if (n.byEmail === me.email) throw err(403, 'A different admin must approve this broadcast.'); n.status = 'Sent'; n.second = me.name; deliver(n); audit('approved broadcast as second admin', n.audience, n.title); save(); }),
    recall: id => lag(() => { need('notifications'); const n = db.admin.log.find(x => x.id === id); if (n.status === 'Sent' && n.read > 0 && !(n.ids || []).length) throw err(409, 'Already read; it cannot be recalled.'); (n.ids || []).forEach(sid => { const ns = (db.studentNotes || {})[sid] || []; const i = ns.findIndex(x => x.adminMsg === n.id && !x.read); if (i >= 0) ns.splice(i, 1); }); n.status = 'Recalled'; audit('recalled notification', n.audience, n.title); save(); }),
    saveTemplates: t => lag(() => { if (can('broadcast') === '-') throw err(403, 'Only Platform or Content admins edit templates.'); if (!/\{first_name\}/.test(t.birthday) || !/\{first_name\}/.test(t.festival)) throw err(400, 'Each template must contain {first_name}.'); db.admin.templates = t; audit('edited wish templates'); save(); }),
    addHoliday: h => lag(() => { if (can('broadcast') === '-') throw err(403, 'Only Platform or Content admins edit the holiday calendar.'); if (!h.date || !(h.name || '').trim()) throw err(400, 'Date and name are required.'); db.admin.holidays.push({ date: h.date, name: h.name.trim(), kind: h.kind }); db.admin.holidays.sort((a, b) => a.date.localeCompare(b.date)); audit('added to holiday calendar', h.date, h.name); save(); }),

    /* student reports */
    reportData: (sid, f) => lag(() => {
      need('reports'); const s = db.students.find(x => x.id === sid); if (!s) throw err(404, 'Student not found.');
      if (me.role === 'support' && !(db.admin.purposes[me.email] || {})[sid]) throw err(428, 'Support admins state a reason before generating a report.');
      const allowed = REPORT_ALLOWED[me.role]; const secs = (f.sections || []).filter(x => allowed.includes(x)); if (!secs.length) throw err(400, 'Pick at least one section you are allowed to include.');
      if (f.copy === 'Parent-meeting print') { const i = secs.indexOf('Internal admin notes'); if (i >= 0) secs.splice(i, 1); }
      const from = f.from ? new Date(f.from).getTime() : 0, to = f.to ? new Date(f.to).getTime() + DAY - 1 : now();
      const a = db.admin.accounts[sid] || {}, p = perf(s), att = attOf(sid, s.batch, from, to), d = dueOf(sid), lu = loginFor(s);
      const snap = { student: { id: sid, name: s.name, batch: s.batch, course: (db.batches.find(b => b.id === s.batch) || {}).course, plan: a.planName, path: s.path }, sections: {} };
      secs.forEach(k => {
        if (k === 'Profile and guardian') snap.sections[k] = { Institution: a.institution, City: a.city, 'Date of birth': a.dob, Guardian: `${a.guardian.name} (${a.guardian.rel})`, 'Guardian phone': a.guardian.phone, 'Learning mode': a.mode, Resume: s.resume ? 'Done' : 'Not yet', Education: lu && lu.profile ? `${lu.profile.eduLevel || ''} ${lu.profile.stream || ''}`.trim() || a.institution : a.institution };
        if (k === 'Attendance') snap.sections[k] = { Attended: `${att.P} of ${att.held} classes`, Percentage: att.pct + '%', Required: db.admin.settings.policy.attendanceMin + '% ' + (att.pct >= db.admin.settings.policy.attendanceMin ? 'MET' : 'NOT MET'), Absent: att.A, Lectures: db.lectures.filter(l => l.batch === s.batch && l.status === 'held' && l.start >= from && l.start <= to).map(l => `#${l.n} ${l.topic}: ${l.marks[sid] === 'P' ? 'Present' : l.marks[sid] === 'A' ? 'Absent' : 'Not marked'}`).join(' | ') };
        if (k === 'Performance') snap.sections[k] = { 'Performance Index': `${p.pi} (${p.band})`, Labs: `${s.labs} of 15, ${p.labsPct}%`, 'Courses and assessments': `quiz avg ${s.quiz}`, 'Leaderboard and XP': `${s.xp} / ${s.rank}`, Attendance: p.att.pct + '%' };
        if (k === 'Financial details and dues') snap.sections[k] = d ? { Plan: d.plan, 'Fee total': 'Rs ' + d.total.toLocaleString('en-IN'), Paid: 'Rs ' + d.paid.toLocaleString('en-IN'), Due: 'Rs ' + d.due.toLocaleString('en-IN') + (d.next ? ' by ' + new Date(d.next.due).toLocaleDateString('en-IN') : ''), Status: d.status, Payments: db.admin.payments.filter(x => x.sid === sid && x.status === 'Verified').map(x => `${new Date(x.at).toLocaleDateString('en-IN')} Rs ${x.amount} (${x.method}, ref ${x.ref})`).join(' | ') || 'None' } : { Plan: 'Free plan', Dues: 'None' };
        if (k === 'Placement readiness') snap.sections[k] = { Resume: s.resume ? 'Done' : 'Not yet', 'Mock interviews': `${s.mocks} of 3`, Internship: s.internship, Portfolio: s.portfolio ? 'Yes' : 'Not yet' };
        if (k === 'Trainer and mentor remarks') snap.sections[k] = { Remarks: (db.remarks || []).filter(r => r.sid === sid).map(r => r.text).join(' | ') || 'No remarks yet' };
        if (k === 'Internal admin notes') snap.sections[k] = { Notes: db.admin.notes[sid] || 'None' };
      });
      return snap;
    }),
    saveReport: (sid, f, snap, hash) => lag(() => { need('reports');
      const prev = db.admin.reports.filter(r => r.sid === sid && r.purpose === f.purpose && r.period === periodLabel(f)); const base = f.baseId && db.admin.reports.find(r => r.id === f.baseId);
      const rep = { id: base ? base.id.replace(/-v\d+$/, '') + '-v' + (prev.length + 1) : 'R-' + new Date().getFullYear() + '-' + String(db.admin.reports.length + 418).padStart(4, '0'), sid, name: nameOf(sid), period: periodLabel(f), purpose: f.purpose, copy: f.copy, sections: Object.keys(snap.sections), version: base ? (base.version + 1) : 1, at: now(), by: me.name, byRole: ROLES[me.role], hash, snapshot: snap };
      if (base) rep.replaces = base.id; db.admin.reports.unshift(Object.freeze(rep)); audit('generated student report', sid, `${rep.id} v${rep.version} (${f.copy})`); save(); return rep.id; }),
    reports: () => lag(() => { need('reportArchive'); const rows = db.admin.reports.map(r => ({ ...clone(r) })); return me.role === 'payment' ? rows.filter(r => r.sections.every(x => x === 'Financial details and dues')) : rows; }),
    report: id => lag(() => { need('reportArchive'); const r = db.admin.reports.find(x => x.id === id); if (!r) throw err(404, 'Report not found.'); audit('opened saved report', r.sid, r.id); save(); return clone(r); }),
    logReportUse: (id, what) => lag(() => { audit(what + ' report', id); save(); }),

    /* certificates */
    certificates: () => lag(() => { need('certificates'); return db.admin.certs.map(c => ({ ...clone(c), name: nameOf(c.sid) })); }),
    issueCert: idx => lag(() => { need('certificates'); const c = db.admin.certs[idx]; if (c.status !== 'Eligible') throw err(409, 'Only eligible students get a certificate: course 100% complete and assessments passed. Payment alone never qualifies.');
      c.id = 'YJ-CERT-' + new Date().getFullYear() + '-' + String(100 + idx + db.admin.certs.filter(x => x.id).length).padStart(4, '0'); c.status = 'Issued'; c.issuedAt = now(); c.by = me.name; notifyStudent(c.sid, 'Certificate issued', `${c.course}: certificate ${c.id}`); audit('issued certificate', c.sid, c.id); save(); return c.id; }),
    revokeCert: (idx, reason) => lag(() => { need('certificates'); const c = db.admin.certs[idx]; if (c.status !== 'Issued') throw err(409, 'Only issued certificates can be revoked.'); if (!(reason || '').trim()) throw err(400, 'A reason is required.'); c.status = 'Revoked'; c.revokedAt = now(); c.reason = reason; audit('revoked certificate', c.sid, c.id + ': ' + reason); save(); }),
    verifyCert: id => lag(() => { const c = db.admin.certs.find(x => x.id && x.id.toLowerCase() === String(id).trim().toLowerCase()); audit('verified certificate', id); save(); return c ? { found: true, status: c.status, name: nameOf(c.sid), course: c.course, issuedAt: c.issuedAt, reason: c.reason || '' } : { found: false }; }),

    /* settings */
    settings: () => lag(() => { need('settings'); return { values: clone(db.admin.settings), allowed: SETTINGS_ALLOWED[me.role], log: clone(db.admin.settingsLog.slice(0, 20)) }; }),
    saveSettings: (section, values) => lag(() => { need('settings'); if (!SETTINGS_ALLOWED[me.role].includes(section)) throw err(403, `${ROLES[me.role]} cannot change ${section} settings.`);
      const cur = db.admin.settings[section], changes = [];
      Object.keys(values).forEach(k => { let v = values[k]; if (typeof cur[k] === 'number') { v = Number(v); if (!Number.isFinite(v) || v < 0) throw err(400, `${k} must be a number of zero or more.`); } if (typeof cur[k] === 'boolean') v = !!v; if (cur[k] !== v) changes.push(`${k}: ${cur[k]} → ${v}`); cur[k] = v; });
      if (section === 'policy') { const s = cur.piAttendance + cur.piLabs + cur.piCourses + cur.piXp; if (s !== 100) throw err(400, `Performance Index weights must add up to 100 (now ${s}).`); if (cur.attendanceMin < 1 || cur.attendanceMin > 100) throw err(400, 'Required attendance must be 1 to 100.'); db.cfg.attendanceMin = cur.attendanceMin; }
      if (!changes.length) throw err(400, 'Nothing changed.');
      db.admin.settingsLog.unshift({ at: now(), by: me.name, section, changes }); audit('changed settings: ' + section, section, changes.join('; ')); save(); return changes; })
  };
  function audience(a) { const st = db.students; if (a.kind === 'All students') return st.map(s => s.id); if (a.kind === 'Batch') return st.filter(s => s.batch === a.value).map(s => s.id); if (a.kind === 'Institution') return st.filter(s => (db.admin.accounts[s.id] || {}).institution === a.value).map(s => s.id); if (a.kind === 'Individual') return st.some(s => s.id === a.value) ? [a.value] : []; if (a.kind === 'Course') { const c = db.courses.find(x => x.id === a.value); return c ? st.filter(s => c.batches.includes(s.batch)).map(s => s.id) : []; } return []; }
  const audLabel = a => a.kind === 'All students' ? 'All students' : a.kind === 'Individual' ? 'Individual: ' + nameOf(a.value) : `${a.kind}: ${a.value}`;
  function deliver(n) { n.ids.forEach(sid => { const first = nameOf(sid).split(' ')[0]; db.studentNotes = db.studentNotes || {}; (db.studentNotes[sid] = db.studentNotes[sid] || []).unshift({ id: 'N' + now() + Math.random().toString(36).slice(2, 5), adminMsg: n.id, kind: n.important ? 'Important: ' + n.title : n.title, text: n.body.replace(/\{first_name\}/g, first), at: now(), read: false }); }); n.delivered = n.ids.length; }
  const periodLabel = f => `${f.from || 'start'} to ${f.to || 'today'}`;
  Object.assign(API, {
    /* CTF registrations */
    ctfRegistrations: () => lag(() => { need('ctf'); const rows = ctfRegs().sort((a, b) => String(b.at).localeCompare(String(a.at)));
      return rows.map(r => me.role === 'content' ? { id: r.id, name: r.name, username: r.username, institution: r.institution, city: r.city, level: r.level, logins: r.logins, lastLogin: r.lastLogin, event: r.event, at: r.at, status: r.status, source: r.source } : (({ salt, pwHash, mfaSecret, ...x }) => ({ ...clone(x), mfa: !!mfaSecret }))(r)); }),
    ctfStatus: (id, status) => lag(() => { need('ctf'); if (can('ctf') !== 'Y') throw err(403, 'Only Platform and Support admins can change a registration.'); const all = ctfRegs(), r = all.find(x => x.id === id); if (!r) throw err(404, 'Registration not found.');
      r.status = status; localStorage.setItem(CTF_KEY, JSON.stringify(all)); audit('CTF registration ' + status.toLowerCase(), id, r.event); save(); }),
    ctfEdit: (id, f) => lag(() => { need('ctf'); if (can('ctf') !== 'Y') throw err(403, 'Only Platform and Support admins can edit a registration.'); const all = ctfRegs(), r = all.find(x => x.id === id); if (!r) throw err(404, 'Registration not found.');
      const v = { name: String(f.name || '').trim(), phone: String(f.phone || '').trim(), institution: String(f.institution || '').trim(), city: String(f.city || '').trim(), level: String(f.level || '').trim() };
      if (v.name.length < 2) throw err(400, 'Enter the full name.'); if (!/^\+?[\d\s-]{10,15}$/.test(v.phone)) throw err(400, 'Enter a valid phone number.'); if (!v.institution) throw err(400, 'Enter the college or company.'); if (!v.level) throw err(400, 'Choose the experience level.');
      const changed = Object.keys(v).filter(k => (r[k] || '') !== v[k]); if (!changed.length) return 0;
      Object.assign(r, v, { editedAt: new Date().toISOString() }); localStorage.setItem(CTF_KEY, JSON.stringify(all)); audit('CTF registration edited', id, 'Changed: ' + changed.join(', ')); save(); return changed.length; }),
    /* Mentorship, Internship and Contact form submissions from the public site */
    enquiries: () => lag(() => { need('enquiries'); return clone(enqs()).sort((a, b) => String(b.at).localeCompare(String(a.at))); }),
    enquiryStatus: (id, status) => lag(() => { need('enquiries'); if (can('enquiries') !== 'Y') throw err(403, 'Only Platform and Support admins can update an enquiry.'); if (!['New', 'Contacted', 'Closed'].includes(status)) throw err(400, 'Unknown status.');
      const all = enqs(), r = all.find(x => x.id === id); if (!r) throw err(404, 'Enquiry not found.'); r.status = status; localStorage.setItem(ENQ_KEY, JSON.stringify(all)); audit('enquiry ' + status.toLowerCase(), id, r.type); save(); }),
    /* every user: free, paid and CTF */
    totalUsers: () => lag(() => { need('totalUsers'); syncWebRequests(); const u = allUsers(), c = ctfRegs();
      const rows = u.map(x => ({ id: x.id, name: x.name, email: me.role === 'content' ? '' : x.email, type: x.plan === 'paid' ? 'Paid' : 'Free', where: x.web ? 'Website sign-up' : 'Batch ' + x.batch, institution: x.institution || '' }))
        .concat(c.map(r => ({ id: r.id, name: r.name, email: me.role === 'content' ? '' : r.email, type: 'CTF', where: r.event, institution: r.institution || '', alsoUser: u.some(x => (x.email || '').toLowerCase() === r.email.toLowerCase()) })));
      return { free: u.filter(x => x.plan !== 'paid').length, paid: u.filter(x => x.plan === 'paid').length, ctf: c.length, ctfAlsoUsers: rows.filter(r => r.alsoUser).length, total: rows.length, rows }; }),

    /* Insight Engine */
    insightSource: () => insState().source,
    setInsightSource: src => lag(() => { need('insightAdmin'); if (!['live', 'synthetic'].includes(src)) throw err(400, 'Unknown data source.'); insState().source = src; synthCache = null; audit('insight data source set to ' + src); save(); }),
    insightMeta: () => lag(() => { need('insights'); const S = insState(), ev = insightEvents(); let consent = null; try { consent = JSON.parse(localStorage.getItem('yojo_consent_v1')); } catch {}
      return { source: S.source, events: ev.length, freshness: ev.length ? Math.max(...ev.map(e => e.rts || e.ts)) : null, scope: me.role === 'payment' ? 'Checkout and payment only' : me.role === 'platform' ? 'All analytics' : 'Aggregates only', consent, retention: '13 months [PROVISIONAL]' }; }),
    insightOverview: f => lag(() => { need('insights'); return IC.overview(scoped(insightEvents()), insFilters(f)); }),
    insightFriction: f => lag(() => { need('insights'); return IC.friction(scoped(insightEvents()), insFilters(f)); }),
    insightDrill: (f, sel) => lag(() => { need('insights'); return IC.drill(scoped(insightEvents()), insFilters(f), sel); }),
    insightAnomalies: f => lag(() => { need('insights'); const ev = scoped(insightEvents()), ff = insFilters(f); return { anomalies: IC.anomalies(ev, ff.to), forecast: [IC.forecast(ev, 'lab', ff.to), IC.forecast(ev, 'class', ff.to)] }; }),
    insightFeed: f => lag(() => { need('insights'); const S = insState(); return IC.insights(scoped(insightEvents()), insFilters(f)).map(c => ({ ...c, status: S.statuses[c.id] ? S.statuses[c.id].status : 'New', statusBy: S.statuses[c.id] && S.statuses[c.id].by, ticket: S.tickets.find(t => t.insight === c.id) || null, synthetic: S.source === 'synthetic' })); }),
    setInsightStatus: (id, status, note = '') => lag(() => { need('insights'); if (!['New', 'Investigating', 'Action Approved', 'Resolved', 'Dismissed'].includes(status)) throw err(400, 'Unknown status.');
      if (status === 'Dismissed' && !note.trim()) throw err(400, 'Say why this insight is dismissed.'); if (status === 'Action Approved' && can('insightAdmin') === '-') throw err(403, 'Only a Platform Admin approves an action.');
      insState().statuses[id] = { status, by: me.name, at: now(), note }; audit('insight ' + status.toLowerCase(), id, note); save(); }),
    // a ticket is only created after the admin confirms; nothing is changed on the platform
    createTicket: (insight, { title, owner, confirmed }) => lag(() => { need('insights'); if (confirmed !== true) throw err(428, 'Confirm before a ticket is created.'); const S = insState();
      if (S.tickets.some(t => t.insight === insight.id)) throw err(409, 'A ticket already exists for this insight.');
      const t = { id: 'INS-T' + (100 + S.tickets.length + 1), insight: insight.id, title: String(title || insight.title).slice(0, 140), owner: owner || 'Unassigned', by: me.name, at: now(), evidence: insight.evidence, synthetic: S.source === 'synthetic' };
      S.tickets.push(t); S.statuses[insight.id] = { status: 'Investigating', by: me.name, at: now(), note: 'Ticket ' + t.id }; audit('insight ticket created', insight.id, t.id + ' · ' + t.title); save(); return clone(t); }),
    insightAsk: (f, q) => lag(() => { need('insights'); const S = insState(), st = {}; Object.keys(S.statuses).forEach(k => st[k] = S.statuses[k].status); const r = IC.ask(scoped(insightEvents()), insFilters(f), String(q || '').slice(0, 300), st); audit('insight analyst question', r.intent || 'refused', String(q || '').slice(0, 120)); save(); return r; }),
    insightRules: () => lag(() => { need('insights'); return clone(insState().rules); }),
    saveInsightRule: (id, patch) => lag(() => { need('insightAdmin'); const r = insState().rules.find(x => x.id === id); if (!r) throw err(404, 'Rule not found.'); const v = +patch.value, c = +patch.cooldownH;
      if (!(v >= 0) || !(c >= 1 && c <= 168)) throw err(400, 'Threshold must be a number and cooldown between 1 and 168 hours.'); Object.assign(r, { value: v, cooldownH: c, on: !!patch.on }); audit('insight rule changed', id, `${r.op} ${v}, cooldown ${c} h, ${r.on ? 'on' : 'off'}`); save(); }),
    insightTimeline: (uid, reason) => lag(() => { need('insightTimeline'); if (me.role !== 'platform' && !String(reason || '').trim()) throw err(428, 'State a reason to open an individual timeline.');
      const ev = insightEvents().filter(e => e.uid === uid).sort((a, b) => a.ts - b.ts).slice(-200); audit('insight timeline viewed', uid, reason || 'Platform admin'); save(); return ev.map(e => ({ ts: e.ts, name: e.name, area: e.area, page: e.page, feature: e.feature, dur: e.dur, result: e.result })); }),
    insightUsers: f => lag(() => { need('insightTimeline'); const ev = IC.applyFilters(insightEvents(), insFilters(f)), m = new Map(); ev.forEach(e => { if (e.uid) m.set(e.uid, (m.get(e.uid) || 0) + 1); }); return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([uid, n]) => ({ uid, n })); }),
    insightExport: (kind, f) => lag(() => { need('insights'); const ev = scoped(insightEvents()), ff = insFilters(f); let rows;
      if (kind === 'friction') { const fr = IC.friction(ev, ff); rows = [['Operation', 'Samples', 'p50 ms', 'p95 ms', 'p99 ms', 'Previous p95 ms', 'Note']].concat(fr.slow.map(r => [r.op, r.n, r.p50, r.p95, r.p99, r.prevP95, r.note])); }
      else { const o = IC.overview(ev, ff); rows = [['Metric', 'This period', 'Previous period'], ['Unique users', o.cur.users, o.prev.users], ['Sessions', o.cur.sessions, o.prev.sessions], ['Average session ms', o.cur.avgSessionMs, o.prev.avgSessionMs], ['Error rate', o.cur.errorRate, o.prev.errorRate], ['Page-load p95 ms', o.cur.load.p95, o.prev.load.p95]].concat(o.timeByArea.rows.map(r => ['Time in ' + r.area + ' ms', r.ms, r.prevMs])).concat(o.funnels.flatMap(fu => fu.stages.map(s => [fu.title + ': ' + s.label + ' users', s.users, '']))); }
      const S = insState(); if (S.source === 'synthetic') rows.unshift(['SYNTHETIC DEMO DATA - NOT PRODUCTION ANALYTICS']);
      S.exports.unshift({ at: now(), by: me.name, kind, days: f.days || 7 }); audit('insight CSV exported', kind, `${f.days || 7} days, ${S.source} data`); save(); return rows; }),
    insightDigest: f => lag(() => { need('insights'); const ev = scoped(insightEvents()), to = Date.now(), ff = { from: to - DAY, to }, o = IC.overview(ev, ff), ins = IC.insights(ev, ff), S = insState();
      return { schedule: 'Daily at 8:00 IST (needs the scheduled job and email service)', source: S.source, period: ff, users: o.cur.users, errorRate: o.cur.errorRate, p95: o.cur.load.p95, top: ins.slice(0, 5).map(x => ({ title: x.title, severity: x.severity, status: S.statuses[x.id] ? S.statuses[x.id].status : 'New' })) }; })
  });
  window.AdminAPI = API;
})();
