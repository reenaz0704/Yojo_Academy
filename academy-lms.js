/* Yojo Cyber Academy · Training Grid (Student LMS)
   One data model feeds every sidebar page, so the overview, calendar, week, campaigns, challenges,
   queue and placement pages always agree. Uses globals from academy.html: me, saveDb, $, $$, esc, toast, modal, MISSIONS. */

/* ---------- sidebar ---------- */
const LMS_SECTIONS = [
  ['attendance', '📅', 'Deployment Record', 'Attendance', true],
  ['calendar', '🗂️', 'Ops Calendar', 'Attendance calendar', true],
  ['trainer', '🧑‍🏫', 'My Handler', 'My Trainer', true],
  ['week', '🗓️', 'This Week', 'Live classes, labs, quizzes', false],
  ['learning', '📘', 'Campaigns', 'Courses learning and pending', false],
  ['assessments', '📝', 'Incoming Challenges', 'Assessments pending', true],
  ['placement', '🎯', 'Placement Mission', 'Placement readiness', true],
  ['resume', '📄', 'My Resume', 'Built from your sign-up details', false]
];

/* ---------- reference data (what the trainer / admin set up for the batch) ---------- */
const LMS_REQUIRED = 75;
const LMS_BATCH_START = new Date(2026, 7, 3); // 3 Aug 2026
const LMS_TRAINER = { name: 'Vikram Rao', initials: 'VR', role: 'Senior SOC Trainer', spec: 'SOC operations and Blue Team defence', certs: ['CEH', 'CISSP', 'GCIH'], years: 11, avail: 'Mon to Fri · 4:00 to 6:00 PM IST', slots: ['Tue · 5:00 PM', 'Thu · 4:30 PM', 'Sat · 11:00 AM'] };
const LMS_MENTOR = { name: 'Anita Das', initials: 'AD', role: 'Threat Hunting Mentor', spec: 'Threat hunting and incident response', certs: ['GCFA', 'OSCP'], years: 8, avail: 'Thursdays · 5:00 PM IST' };
const LMS_ANNOUNCE = [
  ['Today', 'Bring your SIEM sandbox login to tonight\'s Log Analysis class.'],
  ['2 days ago', 'Quiz 3 covers modules 3 and 4. Practice quiz is open in Incoming Challenges.'],
  ['Last week', 'Great work on the phishing drill, batch. Average score 84%.']
];
const LMS_FEEDBACK = [
  ['Phishing case report', 'Clear timeline and good IOC list. Add the mail-header evidence next time.', 'A-'],
  ['Brute-force lab', 'Fast detection. Your Sigma rule needed one more filter for service accounts.', 'B+'],
  ['Mock triage drill', 'Calm prioritisation. Explain your severity choices out loud.', 'A']
];
const LMS_HOLIDAYS = { '01-26': 'Republic Day', '08-15': 'Independence Day', '10-02': 'Gandhi Jayanti', '11-09': 'Diwali', '12-25': 'Christmas' };
const LMS_TOPICS = ['Log Analysis', 'Alert Triage', 'Detection Rules', 'Threat Intelligence', 'Network Forensics', 'Endpoint Telemetry', 'Malware Basics', 'Incident Handling', 'Cloud Logging'];
const LMS_LABS = ['SIEM Sandbox', 'Brute-force Hunt', 'Phishing Triage', 'PCAP Deep Dive', 'EDR Alert Lab', 'Ransomware Drill', 'Web Log Review', 'Cloud Trail Hunt', 'Forensic Analysis'];
const LMS_ENROLLED = [
  { id: 'soc', c: 'SOC Analyst', ic: '🛡️', acc: 'g', by: 'Vikram Rao', diff: 'Intermediate', done: 4, total: 6, mod: 'Module 5 · Detection Rules' },
  { id: 'web', c: 'Web Application Security', ic: '🌐', acc: 'b', by: 'Karan Mehta', diff: 'Intermediate', done: 3, total: 7, mod: 'Module 4 · Session Attacks' },
  { id: 'ir', c: 'Incident Response', ic: '⚠️', acc: 'p', by: 'Anita Das', diff: 'Advanced', done: 2, total: 8, mod: 'Module 3 · Containment' },
  { id: 'fnd', c: 'Cybersecurity Foundations', ic: '🔐', acc: 'c', by: 'Vikram Rao', diff: 'Beginner', done: 6, total: 6, mod: 'Completed' }
];
const LMS_ASSESS = [
  { id: 'a1', k: 'Quiz', t: 'Quiz 3: Log Analysis', c: 'SOC Analyst', diff: 'Easy', due: 2, min: 30, marks: 20 },
  { id: 'a2', k: 'Lab challenge', t: 'Write a SIEM detection rule', c: 'SOC Analyst', diff: 'Medium', due: 1, min: 60, marks: 40 },
  { id: 'a3', k: 'Assignment', t: 'Phishing case report', c: 'SOC Analyst', diff: 'Medium', due: 5, min: 90, marks: 50 },
  { id: 'a4', k: 'Practical', t: 'Incident triage practical', c: 'Incident Response', diff: 'Hard', due: 9, min: 120, marks: 100 },
  { id: 'a5', k: 'Exam', t: 'Module 4 exam', c: 'SOC Analyst', diff: 'Hard', due: 12, min: 90, marks: 100 },
  { id: 'a6', k: 'Assignment', t: 'Web recon report', c: 'Web Application Security', diff: 'Medium', due: -3, min: 60, marks: 50, st: 'submitted' },
  { id: 'a7', k: 'Quiz', t: 'Quiz 2: Networking basics', c: 'Cybersecurity Foundations', diff: 'Easy', due: -6, min: 20, marks: 20, st: 'completed', score: 18 }
];
const LMS_QUEUE = [
  { id: 'q-fnd', c: 'Cybersecurity Foundations', ic: '🔐', free: true, by: 'Vikram Rao', diff: 'Beginner', hrs: 20, pre: 'None', d: 'Networks, operating systems and the security mindset. The free starting point.' },
  { id: 'q-jpt', c: 'Junior Penetration Tester', ic: '🗡️', by: 'Karan Mehta', diff: 'Intermediate', hrs: 45, pre: 'Cybersecurity Foundations', d: 'Recon, exploitation and reporting in isolated ranges.', start: 'Starts 3 Nov' },
  { id: 'q-grc', c: 'GRC Analyst', ic: '📋', by: 'Sai Varma', diff: 'Beginner', hrs: 30, pre: 'None', d: 'Policies, risk registers, ISO 27001 controls and audit readiness.' },
  { id: 'q-cloud', c: 'Cloud Security Essentials', ic: '☁️', by: 'Neha Pillai', diff: 'Intermediate', hrs: 24, pre: 'SOC Analyst module 3', d: 'Identity, logging and storage security on major cloud platforms.' },
  { id: 'q-web', c: 'Web Application Security', ic: '🌐', by: 'Karan Mehta', diff: 'Intermediate', hrs: 28, pre: 'Cybersecurity Foundations', d: 'OWASP Top 10 hands-on, from injection to broken access control.', resume: true }
];

/* ---------- helpers ---------- */
const DAY = 864e5;
const d0 = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dkey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addD = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const monStart = d => addD(d0(d), -((d.getDay() + 6) % 7));
const fmtD = (d, o = { weekday: 'short', day: 'numeric', month: 'short' }) => d.toLocaleDateString('en-GB', o);
const hhmm = m => { const h = Math.floor(m / 60), mm = m % 60; return `${(h + 11) % 12 + 1}:${String(mm).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const hash = s => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const isPaid = () => me.stats.plan === 'paid' || !!me.stats.batch;
function lmsState() {
  const s = me.stats.lms = me.stats.lms || {};
  s.asg = s.asg || {}; s.booked = s.booked || []; s.msgs = s.msgs || []; s.queue = s.queue || {};
  return s;
}
function lmsSave() { try { saveDb(); } catch {} }

/* ---------- schedule + attendance: generated from the batch timetable, attendance marked for past sessions ---------- */
function holidayOn(d) { return LMS_HOLIDAYS[dkey(d).slice(5)] || null; }
function sessionsOn(d) {
  d = d0(d); const wd = d.getDay(); if (wd === 0 || wd === 6 || d < LMS_BATCH_START || holidayOn(d)) return [];
  const wk = Math.floor((d - LMS_BATCH_START) / (7 * DAY)), topic = LMS_TOPICS[wk % LMS_TOPICS.length], lab = LMS_LABS[wk % LMS_LABS.length];
  const T = LMS_TRAINER.name, M = LMS_MENTOR.name, k = dkey(d);
  const L = [];
  if (wd === 1) L.push({ type: 'class', title: `${topic} (live)`, course: 'SOC Analyst', who: T, s: 1110, e: 1230 });
  if (wd === 2) L.push({ type: 'lab', title: `Lab: ${lab}`, course: 'SOC Analyst', who: T, s: 1110, e: 1230 });
  if (wd === 3) L.push({ type: 'class', title: `${topic}, part 2 (live)`, course: 'SOC Analyst', who: T, s: 1110, e: 1230 });
  if (wd === 4) { L.push({ type: 'mentor', title: 'Mentor session', course: 'Incident Response', who: M, s: 1020, e: 1065 }); L.push({ type: 'class', title: 'Web Security (live)', course: 'Web Application Security', who: 'Karan Mehta', s: 1110, e: 1230 }); }
  if (wd === 5) L.push(wk % 2 ? { type: 'quiz', title: `Weekly quiz: ${topic}`, course: 'SOC Analyst', who: T, s: 1110, e: 1170 } : { type: 'class', title: `${topic} review (live)`, course: 'SOC Analyst', who: T, s: 1110, e: 1230 });
  const now = new Date(), nowM = now.getHours() * 60 + now.getMinutes(), today = d0(now);
  return L.map((x, j) => {
    const id = `${k}-${j}`, past = d < today || (+d === +today && nowM >= x.e), live = +d === +today && nowM >= x.s && nowM < x.e;
    let att = null;
    if (past && x.type !== 'mentor') { const h = hash(id); att = h % 13 === 0 ? 'absent' : 'present'; /* attendance is Present or Absent only */ }
    return { ...x, id, date: d, status: live ? 'live' : past ? 'completed' : 'upcoming', att, rec: att === 'absent' };
  });
}
function assessments() {
  const st = lmsState(), today = d0(new Date());
  return LMS_ASSESS.map(a => {
    const status = st.asg[a.id] || a.st || 'pending', due = addD(today, a.due), left = Math.round((due - today) / DAY);
    return { ...a, status, dueDate: due, left, soon: (status === 'pending' || status === 'started') && left <= 3 };
  });
}
function eventsOn(d) {
  const ev = sessionsOn(d).slice();
  const st = lmsState();
  st.booked.filter(b => b.date === dkey(d)).forEach(b => ev.push({ type: 'mentor', title: `1-to-1 with ${b.who}`, who: b.who, course: 'Booked by you', s: b.s, e: b.s + 30, status: d0(d) < d0(new Date()) ? 'completed' : 'upcoming', id: 'b' + b.date + b.s, att: null }));
  assessments().filter(a => +a.dueDate === +d0(d)).forEach(a => ev.push({ type: 'assessment', title: `Due: ${a.t}`, course: a.c, who: LMS_TRAINER.name, s: 1439, e: 1439, status: a.status, id: a.id, att: null }));
  return ev.map(e => e.date ? e : { ...e, date: d0(d) }).sort((a, b) => a.s - b.s);
}
function monthStats(ref = new Date()) {
  const y = ref.getFullYear(), m = ref.getMonth(), days = new Date(y, m + 1, 0).getDate(), out = { present: 0, absent: 0, total: 0, weeks: [], byCourse: {} };
  for (let i = 1; i <= days; i++) {
    const d = new Date(y, m, i), w = Math.floor((i - 1 + (new Date(y, m, 1).getDay() + 6) % 7) / 7);
    sessionsOn(d).filter(x => x.att).forEach(x => {
      out.total++; out[x.att]++;
      (out.weeks[w] = out.weeks[w] || { att: 0, all: 0 }).all++; if (x.att !== 'absent') out.weeks[w].att++;
      const c = out.byCourse[x.course] = out.byCourse[x.course] || { att: 0, all: 0, who: x.who }; c.all++; if (x.att !== 'absent') c.att++;
    });
  }
  out.attended = out.present; out.pct = out.total ? Math.round(100 * out.attended / out.total) : 0;
  out.weeks = out.weeks.map((w, k) => w && { label: 'W' + (k + 1), pct: Math.round(100 * w.att / w.all) }).filter(Boolean);
  return out;
}
function nextSession(types = ['class', 'lab', 'mentor', 'quiz']) {
  for (let i = 0; i < 21; i++) { const e = eventsOn(addD(new Date(), i)).find(x => types.includes(x.type) && x.status !== 'completed'); if (e) return e; }
  return null;
}
function portfolio() {
  if (!me.portfolio) me.portfolio = [
    { title: 'Brute-force detection lab', skills: 'SIEM, Sigma rules, log analysis', desc: 'Detected a password-spraying attack in auth logs and wrote a Sigma rule that alerts on it.', github: 'github.com/' + (me.profile.name || 'agent').split(' ')[0].toLowerCase() + '/bruteforce-detection' },
    { title: 'Phishing email analysis', skills: 'Email headers, SPF/DKIM/DMARC', desc: 'Traced a forged email through its headers and wrote an incident note for the team.', github: '' },
    { title: 'Home SOC lab', skills: 'Wazuh, Linux, networking', desc: 'Built a small SOC at home with a SIEM, two endpoints and test alerts.', github: '' }
  ];
  return me.portfolio;
}
function placement() {
  const st = lmsState();
  const items = [
    { k: 'resume', t: 'Resume', p: st.resumeDone ? 100 : 75, note: st.resumeDone ? 'Reviewed by trainer' : 'Add your SOC lab projects', col: 'var(--green)' },
    { k: 'mock', t: 'Mock interviews', p: Math.round(100 * (1 + (st.mockBooked ? 1 : 0)) / 3), note: `${1 + (st.mockBooked ? 1 : 0)} of 3 done`, col: 'var(--quantum)' },
    { k: 'intern', t: 'Internship prep', p: 40, note: 'Applications open 1 Nov', col: 'var(--amber)' },
    { k: 'portfolio', t: 'Portfolio', p: Math.min(100, 20 * portfolio().filter(x => x.title).length), note: `${portfolio().filter(x => x.title).length} of 5 projects`, col: 'var(--purple)' }
  ];
  return { items, overall: Math.round(items.reduce((a, b) => a + b.p, 0) / items.length) };
}

/* ---------- shared bits ---------- */
const ring = (p, col, size = 120, w = 10, label = p + '%') => `<svg class="lms-ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${label}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - w}" fill="none" stroke="var(--bg-deep)" stroke-width="${w}"/><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - w}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="${(2 * Math.PI * (size / 2 - w) * p / 100).toFixed(1)} 999" transform="rotate(-90 ${size / 2} ${size / 2})"/><text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" fill="var(--text)" font-family="var(--f-display)" font-weight="700" font-size="${size / 4.6}">${label}</text></svg>`;
const head = (sec, title, extra = '') => `<div class="ov-head"><div><a class="ov-crumb" href="#/lms/attendance">← Training Grid</a><span class="ov-crumb"> / ${sec}</span><h2>${title}</h2></div>${extra}</div>`;
const filters = (name, opts, cur) => `<div class="lms-filters" role="tablist">${opts.map(([k, l, n]) => `<button type="button" role="tab" class="lms-f ${k === cur ? 'on' : ''}" aria-selected="${k === cur}" data-f="${name}:${k}">${l}${n != null ? ` <b>${n}</b>` : ''}</button>`).join('')}</div>`;
const TYPE = { class: ['🔴', 'Live class', 'c'], lab: ['🧪', 'Lab', 'g'], mentor: ['🤝', 'Mentor', 'p'], quiz: ['📝', 'Quiz', 'a'], assessment: ['⏰', 'Assessment', 'r'] };
const STATUS = s => s === 'live' ? '<span class="chip g lms-live">● Live</span>' : s === 'completed' ? '<span class="chip">Completed</span>' : '<span class="chip b">Upcoming</span>';
function lmsLock(title, what) {
  return `${head(title, title)}<section class="card lms-lock"><h3>${title} <span class="chip a">🔒 Premium</span></h3>
    <div class="lms-blur" aria-hidden="true"><div class="item"><span>████████████</span><span class="note">██████</span></div><div class="item"><span>██████████</span><span class="note">████</span></div><div class="item"><span>███████████████</span><span class="note">██████</span></div></div>
    <p class="note" style="margin:.8rem 0">${what} unlocks with the Premium Operative plan: a trainer-led batch, mentor, live classes and graded progress.</p>
    <a class="btn btn-amber btn-sm" href="#/courses">See Premium plans</a></section>`;
}
const UI = { cal: { view: 'month', cur: null, sel: null, f: { att: true, cls: true, lab: true, asg: true } }, weekOff: 0, weekMode: 'grid', camp: 'all', campTab: 'active', chal: 'pending', queue: 'all' };

/* ---------- pages ---------- */
const PAGES = {
  // demo mode: the live Academy (academy-live.js) replaces this with the server-built resume
  resume() {
    const p = (me && me.profile) || {};
    return `<div class="lms-head"><div><h1>My Resume</h1><p class="note">Built from your sign-up details</p></div></div>
      <section class="card"><b style="font-size:1.2rem">${esc(p.name || '')}</b><p class="note">${esc([me && me.email, p.phone, p.city].filter(Boolean).join(' · '))}</p>
      ${p.objective ? `<p>${esc(p.objective)}</p>` : ''}${p.skills ? `<p class="note">Skills: ${esc(p.skills)}</p>` : ''}
      ${me && me.category ? `<p class="note">Career path: ${esc(me.category)}</p>` : ''}</section>`;
  },
  attendance() {
    const m = monthStats(), d = m.pct - LMS_REQUIRED, ok = m.pct >= LMS_REQUIRED;
    const stat = (cls, ic, lbl, v, of) => `<div class="ov-stat ${cls}"><span class="ov-ic">${ic}</span><div><span class="ov-lbl">${lbl}</span><b>${v}${of != null ? `<small> / ${of}</small>` : ''}</b></div></div>`;
    const next = nextSession(), ch = assessments().filter(a => a.status === 'pending').sort((a, b) => a.left - b.left)[0], pl = placement();
    const byType = {}; for (let i = 1; i <= new Date().getDate(); i++) sessionsOn(new Date(new Date().getFullYear(), new Date().getMonth(), i)).forEach(x => byType[x.type] = (byType[x.type] || 0) + 1);
    return `${head('Deployment Record', '📅 Attendance Overview', `<span class="chip ${ok ? 'g' : 'r'}">● ${ok ? 'Above required' : 'Below required'}</span>`)}
      <div class="ov-stats">
        <div class="ov-stat hero ${ok ? '' : 'bad'}"><span class="ov-ic">%</span><div><span class="ov-lbl">This month</span><b>${m.pct}%</b></div><span class="ov-delta">${d >= 0 ? '▲ +' : '▼ '}${d} pts</span></div>
        ${stat('g', '👥', 'Present', m.present, m.total)}${stat('r', '✕', 'Absent', m.absent, m.total)}
        <div class="ov-stat b"><span class="ov-ic">🎯</span><div><span class="ov-lbl">Required</span><b>${LMS_REQUIRED}%</b><div class="bar ov-mini"><i style="width:${LMS_REQUIRED}%"></i></div></div></div>
      </div>
      <section class="card ov-chart"><div class="ov-sum">${ring(m.pct, ok ? 'var(--green)' : 'var(--red)')}<div><b class="ov-big">${m.attended} / ${m.total} sessions</b><p class="note">attended in ${fmtD(new Date(), { month: 'long' })} so far</p><p class="ov-up" style="color:${ok ? 'var(--green)' : 'var(--red)'}">${d >= 0 ? '▲' : '▼'} ${Math.abs(d)} percentage points <span class="note">${d >= 0 ? 'above' : 'below'} target (${m.pct}% vs ${LMS_REQUIRED}% required)</span></p>
          <div class="ov-month">${[['class', 'Live classes'], ['lab', 'Labs'], ['quiz', 'Quizzes'], ['mentor', 'Mentor']].map(([k, l]) => `<span><b>${byType[k] || 0}</b><small>${l}</small></span>`).join('')}</div></div></div>
        <div class="ov-bars"><span class="ov-lbl">Weekly attendance</span><div class="ov-cols">${m.weeks.map(w => `<div class="ov-col"><span>${w.pct}%</span><i style="height:${Math.max(6, w.pct - 25)}%" class="${w.pct < LMS_REQUIRED ? 'bad' : w.pct < 90 ? 'lo' : ''}"></i><small>${w.label}</small></div>`).join('') || '<p class="note">No sessions yet this month.</p>'}</div></div>
        <div class="ov-acts"><a class="btn btn-primary btn-sm" href="#/lms/calendar">📅 View full calendar</a><button class="btn btn-sm" data-do="report">⬇ Download report</button></div></section>
      <div class="ov-two">
        <section class="card"><h3>This Week <a class="ov-link" href="#/lms/week">View all →</a></h3><div class="list">${weekEvents(0).filter(e => e.status !== 'completed' && e.type !== 'assessment').slice(0, 3).map(classRow).join('') || '<p class="note">No more sessions this week.</p>'}</div></section>
        <section class="card"><h3>Active Campaigns <a class="ov-link" href="#/lms/learning">View all →</a></h3><div class="list">${LMS_ENROLLED.filter(c => c.done < c.total).map(c => `<a class="ov-course ${c.acc}" href="#/lms/learning"><span class="ov-ic">${c.ic}</span><span class="ov-what"><span class="row"><b>${c.c}</b><b class="ov-pct">${Math.round(100 * c.done / c.total)}%</b></span><small class="note">${c.done} / ${c.total} modules completed</small><span class="bar"><i style="width:${100 * c.done / c.total}%"></i></span></span></a>`).join('')}</div></section>
      </div>
      <section class="card ov-foot">${ch ? `<div class="ov-chal"><span class="ov-lbl" style="color:var(--amber)">⚡ Upcoming challenge</span><a class="ov-chal-row" href="#/lms/assessments"><span class="ov-ic">💻</span><span><b>${esc(ch.t)}</b><small class="note">${ch.k} · ${ch.c}</small></span><span class="ov-timer"><small class="note">Due in</small><b>${ch.left} day${ch.left === 1 ? '' : 's'}</b></span><span class="chip ${ch.diff === 'Hard' ? 'r' : ch.diff === 'Medium' ? 'a' : 'g'}">${ch.diff}</span></a></div>` : '<div class="note">No pending challenges.</div>'}
        <a class="ov-place" href="#/lms/placement"><span><span class="ov-lbl">🎯 Placement Mission</span><small class="note">Readiness ${pl.overall}%. Get career-ready with these goals.</small></span>${pl.items.filter(x => x.k !== 'intern').map(x => `<span class="ov-pr">${ring(x.p, x.col, 64, 6)}<small>${x.t}</small></span>`).join('')}</a></section>
      ${next ? `<p class="note">Next session: <b>${esc(next.title)}</b> · ${fmtD(next.date)} · ${hhmm(next.s)}</p>` : ''}`;
  },
  calendar() {
    const c = UI.cal; c.cur = c.cur || d0(new Date()); c.sel = c.sel || dkey(new Date());
    const show = e => (e.type === 'class' || e.type === 'mentor') ? c.f.cls : e.type === 'lab' ? c.f.lab : c.f.asg;
    const dot = d => { const s = sessionsOn(d).filter(x => x.att); if (!c.f.att || !s.length) return ''; const a = s.some(x => x.att === 'absent') ? 'a' : 'p'; return `<i class="cal-att ${a}" title="${{ a: 'Absent', p: 'Present' }[a]}"></i>`; };
    const pill = e => `<span class="cal-pill t-${e.type}" title="${esc(e.title)}">${TYPE[e.type][0]} ${esc(e.title.replace(/ \(live\)/, ''))}</span>`;
    const today = dkey(new Date());
    let grid = '', title = '';
    if (c.view === 'month') {
      const y = c.cur.getFullYear(), m = c.cur.getMonth(), first = new Date(y, m, 1), lead = (first.getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
      title = fmtD(first, { month: 'long', year: 'numeric' });
      grid = `<div class="cal-grid month">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<span class="cal-h">${d}</span>`).join('')}${'<span class="cal-x"></span>'.repeat(lead)}${Array.from({ length: days }, (_, i) => { const d = new Date(y, m, i + 1), k = dkey(d), ev = eventsOn(d).filter(show), hol = holidayOn(d); return `<button type="button" class="cal-cell ${k === c.sel ? 'sel' : ''} ${k === today ? 'today' : ''} ${hol ? 'hol' : ''}" data-day="${k}" aria-label="${fmtD(d)}${hol ? ', holiday' : ''}, ${ev.length} events"><span class="cal-n">${i + 1}</span>${dot(d)}${hol ? `<span class="cal-pill t-hol">🎉 ${hol}</span>` : ''}${ev.slice(0, 2).map(pill).join('')}${ev.length > 2 ? `<small class="note">+${ev.length - 2} more</small>` : ''}</button>`; }).join('')}</div>`;
    } else if (c.view === 'week') {
      const s = monStart(c.cur); title = `${fmtD(s, { day: 'numeric', month: 'short' })} – ${fmtD(addD(s, 6), { day: 'numeric', month: 'short', year: 'numeric' })}`;
      grid = `<div class="cal-grid week">${Array.from({ length: 7 }, (_, i) => { const d = addD(s, i), k = dkey(d), ev = eventsOn(d).filter(show), hol = holidayOn(d); return `<button type="button" class="cal-cell ${k === c.sel ? 'sel' : ''} ${k === today ? 'today' : ''} ${hol ? 'hol' : ''}" data-day="${k}"><span class="cal-n">${fmtD(d)}</span>${dot(d)}${hol ? `<span class="cal-pill t-hol">🎉 ${hol}</span>` : ''}${ev.map(e => `${pill(e)}<small class="note">${e.type === 'assessment' ? 'Due today' : hhmm(e.s)}</small>`).join('') || (hol ? '' : '<small class="note">No sessions</small>')}</button>`; }).join('')}</div>`;
    } else { title = fmtD(c.cur, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); c.sel = dkey(c.cur); grid = ''; }
    const sd = fromKey(c.sel), sev = eventsOn(sd).filter(show), shol = holidayOn(sd);
    const detail = `<section class="card cal-detail"><h3>${fmtD(sd, { weekday: 'long', day: 'numeric', month: 'long' })}${shol ? ' <span class="chip a">Holiday</span>' : ''}</h3>
      ${shol ? `<p class="note">${shol}: no classes.</p>` : ''}${sev.map(e => `<div class="cal-ev t-${e.type}"><span class="cal-time">${e.type === 'assessment' ? 'Due' : hhmm(e.s)}</span><span class="ov-what"><b>${TYPE[e.type][0]} ${esc(e.title)}</b><small class="note">${esc(e.course)} · ${esc(e.who)}${e.type !== 'assessment' ? ` · ${hhmm(e.s)} – ${hhmm(e.e)}` : ''}</small></span>${e.att ? `<span class="chip ${{ present: 'g', absent: 'r' }[e.att]}">${e.att}</span>` : e.type === 'assessment' ? `<a class="btn btn-sm" href="#/lms/assessments">Open</a>` : STATUS(e.status)}${e.rec ? `<button class="btn btn-sm" data-do="rec" data-t="${esc(e.title)}">▶ Recording</button>` : ''}</div>`).join('') || (shol ? '' : '<p class="note">No sessions on this day.</p>')}</section>`;
    const m = monthStats(c.cur), courses = Object.entries(m.byCourse);
    return `${head('Ops Calendar', '🗂️ Ops Calendar', `<span class="chip g">${m.pct}% attendance in ${fmtD(c.cur, { month: 'short' })}</span>`)}
      <section class="card cal-bar"><div class="cal-nav"><button class="btn btn-sm" data-do="cal-prev" aria-label="Previous">◂</button><button class="btn btn-sm" data-do="cal-today">Today</button><button class="btn btn-sm" data-do="cal-next" aria-label="Next">▸</button><b class="cal-title">${title}</b></div>
        ${filters('calview', [['month', 'Month'], ['week', 'Week'], ['day', 'Day']], c.view)}
        <div class="lms-filters">${[['att', 'Attendance'], ['cls', 'Classes'], ['lab', 'Labs'], ['asg', 'Assessments']].map(([k, l]) => `<label class="lms-chk"><input type="checkbox" data-calf="${k}" ${c.f[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div></section>
      <div class="cal-wrap ${c.view}">${grid ? `<section class="card">${grid}<div class="lms-legend"><span><i class="cal-att p"></i>Present</span><span><i class="cal-att a"></i>Absent</span><span><i class="lg t-hol"></i>Holiday</span><span><i class="lg t-class"></i>Live class</span><span><i class="lg t-lab"></i>Lab</span><span><i class="lg t-assessment"></i>Assessment due</span></div></section>` : ''}${detail}</div>
      <section class="card"><h3>Per-course attendance · ${fmtD(c.cur, { month: 'long' })}</h3><div class="list">${courses.map(([n, x]) => `<div class="item" style="display:grid;gap:.4rem"><div class="row"><b>${esc(n)}</b><span class="note">Trainer ${esc(x.who)} · ${Math.round(100 * x.att / x.all)}% (${x.att}/${x.all})</span></div><div class="bar"><i style="width:${100 * x.att / x.all}%"></i></div></div>`).join('') || '<p class="note">No sessions recorded this month.</p>'}</div></section>`;
  },
  trainer() {
    const L = typeof trainerLink === 'function' && trainerLink();
    if (L && L.trainer) return linkedHandler(L);
    const st = lmsState(), mentorUp = [];
    for (let i = 0; i < 28 && mentorUp.length < 4; i++) eventsOn(addD(new Date(), i)).filter(e => e.type === 'mentor' && e.status !== 'completed').forEach(e => mentorUp.push(e));
    const card = (p, main) => `<section class="card hd-card ${main ? 'main' : ''}"><div class="hd-top"><span class="hd-av">${p.initials}</span><div><span class="ov-lbl">${main ? 'Assigned trainer' : 'Mentor'}</span><b class="hd-name">${p.name}</b><span class="note">${p.role}</span></div><span class="chip g">● Available</span></div>
      <div class="hd-facts"><span><small class="ov-lbl">Specialisation</small>${p.spec}</span><span><small class="ov-lbl">Experience</small>${p.years} years</span><span><small class="ov-lbl">Availability</small>${p.avail}</span></div>
      <div class="hd-certs">${p.certs.map(c => `<span class="chip b">🏅 ${c}</span>`).join('')}</div>
      ${main ? '<div class="hd-acts"><button class="btn btn-primary btn-sm" data-do="msg">✉ Message trainer</button><button class="btn btn-sm" data-do="book">📅 Book one-to-one session</button></div>' : ''}</section>`;
    return `${head('My Handler', '🧑‍🏫 My Handler')}
      <div class="hd-grid">${card(LMS_TRAINER, true)}${card(LMS_MENTOR, false)}</div>
      <div class="ov-two">
        <section class="card"><h3>Upcoming mentor sessions</h3><div class="list">${mentorUp.map(e => `<div class="ov-class p"><span class="ov-day"><b>${fmtD(e.date, { weekday: 'short' })}</b><small>${fmtD(e.date, { day: 'numeric', month: 'short' })}</small></span><span class="ov-what"><small class="note">${hhmm(e.s)} – ${hhmm(e.e)}</small><b>${esc(e.title)}</b><small class="note">${esc(e.who)}</small></span>${STATUS(e.status)}</div>`).join('') || '<p class="note">No mentor sessions booked. Use Book one-to-one session.</p>'}</div></section>
        <section class="card"><h3>Trainer announcements</h3><div class="list">${LMS_ANNOUNCE.map(([w, t]) => `<div class="item"><span>📣 ${esc(t)}</span><span class="note">${w}</span></div>`).join('')}</div></section>
      </div>
      <div class="ov-two">
        <section class="card"><h3>Recent feedback</h3><div class="list">${LMS_FEEDBACK.map(([t, f, g]) => `<div class="item" style="display:grid;gap:.25rem"><div class="row"><b>${t}</b><span class="chip g">${g}</span></div><span class="note">${esc(f)}</span></div>`).join('')}</div></section>
        <section class="card"><h3>Your messages</h3><div class="list">${st.msgs.slice(-4).reverse().map(m => `<div class="item" style="display:grid;gap:.25rem"><div class="row"><b>To ${esc(m.to)}</b><span class="note">${esc(m.at)}</span></div><span class="note">${esc(m.text)}</span><span class="chip" style="justify-self:start">Sent · reply within 24 h</span></div>`).join('') || '<p class="note">No messages yet. Your trainer usually replies within a day.</p>'}</div></section>
      </div>`;
  },
  week() {
    const evs = weekEvents(UI.weekOff), s = monStart(addD(new Date(), UI.weekOff * 7)), nx = nextSession();
    const days = Array.from({ length: 7 }, (_, i) => addD(s, i)), tk = dkey(new Date());
    const card = e => `<div class="wk-card t-${e.type} ${nx && e.id === nx.id ? 'next' : ''} ${e.status}">${nx && e.id === nx.id ? '<span class="wk-next">Next up</span>' : ''}<span class="note">${hhmm(e.s)} – ${hhmm(e.e)}</span><b>${TYPE[e.type][0]} ${esc(e.title)}</b><small class="note">${esc(e.course)} · ${esc(e.who)}</small><div class="row">${STATUS(e.status)}${e.status === 'live' || (nx && e.id === nx.id && e.type !== 'quiz') ? `<button class="btn btn-sm ${e.status === 'live' ? 'btn-primary' : ''}" data-do="join" data-t="${esc(e.title)}">${e.status === 'live' ? 'Join session' : 'Join link'}</button>` : ''}</div></div>`;
    const paid = isPaid();
    const body = !paid ? `<section class="card"><h3>This Week · self-paced</h3><div class="list"><div class="item"><span>🧪 Clear 1 free lab</span><a class="btn btn-sm" href="#/academy/missions">Go</a></div><div class="item"><span>📖 Read 1 blog in Intel</span><a class="btn btn-sm" href="#/academy/lore-vault">Go</a></div><div class="item"><span>📝 Take the practice quiz</span><span class="note">Free</span></div></div><div class="lms-blur-row"><span class="chip a">🔒 Premium</span><span class="note">Live classes, labs, mentor sessions and quizzes with your batch appear here on Premium.</span></div></section>`
      : UI.weekMode === 'grid' ? `<div class="wk-grid">${days.map(d => { const k = dkey(d), ev = evs.filter(e => dkey(e.date) === k && e.type !== 'assessment'), hol = holidayOn(d); return `<section class="wk-day ${k === tk ? 'today' : ''}"><header><b>${fmtD(d, { weekday: 'short' })}</b><small>${fmtD(d, { day: 'numeric', month: 'short' })}</small></header>${hol ? `<div class="wk-card t-hol"><b>🎉 ${hol}</b><small class="note">No classes</small></div>` : ''}${ev.map(card).join('') || (hol ? '' : '<p class="note wk-empty">No sessions</p>')}</section>`; }).join('')}</div>`
        : `<section class="card"><div class="list">${evs.filter(e => e.type !== 'assessment').map(e => classRow(e)).join('') || '<p class="note">No sessions this week.</p>'}</div></section>`;
    return `${head('This Week', '🗓️ This Week · mission schedule', paid ? `<span class="chip b">Batch ${esc(me.stats.batch || 'SOC-B7')}</span>` : '')}
      ${paid ? `<section class="card cal-bar"><div class="cal-nav"><button class="btn btn-sm" data-do="wk-prev" aria-label="Previous week">◂</button><button class="btn btn-sm" data-do="wk-today">Today</button><button class="btn btn-sm" data-do="wk-next" aria-label="Next week">▸</button><b class="cal-title">${fmtD(s, { day: 'numeric', month: 'short' })} – ${fmtD(addD(s, 6), { day: 'numeric', month: 'short' })}</b></div>${filters('wkmode', [['grid', 'Week view'], ['list', 'List view']], UI.weekMode)}
        ${nx ? `<span class="note">Next class: <b>${esc(nx.title)}</b>, ${fmtD(nx.date)} ${hhmm(nx.s)}</span>` : ''}</section>` : ''}${body}`;
  },
  learning() {
    const tabs = filters('camptab', [['active', '📘 My learning'], ['queued', '📦 Courses pending']], UI.campTab);
    if (UI.campTab === 'queued') return `${head('Campaigns', '📦 Campaigns · courses pending')}${tabs}${PAGES.pending(true)}`;
    const paid = isPaid(), done = MISSIONS.filter(m => me.stats.cleared.includes(m.id)).length;
    const list = paid ? LMS_ENROLLED : [{ id: 'fnd', c: 'Cybersecurity Foundations', ic: '🔐', acc: 'c', by: 'Self-paced with Orbi', diff: 'Beginner', done: Math.min(6, Math.floor(done / 2)), total: 6, mod: `${done} free labs cleared`, free: true }];
    const f = UI.camp, shown = list.filter(c => f === 'all' || (f === 'done' ? c.done >= c.total : c.done < c.total));
    const cert = c => c.free ? '<span class="chip a">🎓 Certificate: Premium</span>' : c.done >= c.total ? '<span class="chip g">🎓 Certificate ready</span>' : `<span class="chip">🎓 Unlocks at 100%</span>`;
    const L = typeof trainerLink === 'function' && trainerLink();
    return `${head('Campaigns', '📘 Campaigns · My learning')}${tabs}${L && paid ? trainerContent(L) : ''}
      ${filters('camp', [['all', 'All', list.length], ['prog', 'In progress', list.filter(c => c.done < c.total).length], ['done', 'Completed', list.filter(c => c.done >= c.total).length]], f)}
      <div class="mc-grid">${shown.map(c => { const p = Math.round(100 * c.done / c.total); return `<section class="card mc-card ${c.acc}"><div class="mc-top"><span class="mc-ic">${c.ic}</span><div><b>${c.c}</b><small class="note">Instructor: ${esc(c.by)}</small></div><span class="chip ${c.diff === 'Advanced' ? 'r' : c.diff === 'Intermediate' ? 'a' : 'g'}">${c.diff}</span></div>
        <div class="row"><span class="note">${c.done} / ${c.total} modules · ${esc(c.mod)}</span><b class="ov-pct">${p}%</b></div><div class="bar"><i style="width:${p}%"></i></div>
        <div class="row">${cert(c)}<button class="btn btn-sm ${p < 100 ? 'btn-primary' : ''}" data-do="continue" data-t="${esc(c.c)}">${p < 100 ? '▶ Continue learning' : 'Review course'}</button></div></section>`; }).join('') || '<section class="card"><p class="note">Nothing here yet.</p></section>'}</div>
      ${paid ? '' : '<div class="lms-blur-row"><span class="chip a">🔒 Premium</span><span class="note">Trainer-led courses and certificates unlock with Premium. <a href="#/courses">See plans</a></span></div>'}`;
  },
  assessments() {
    const all = assessments(), f = UI.chal;
    const pick = { pending: a => a.status === 'pending' || a.status === 'started', soon: a => a.soon, submitted: a => a.status === 'submitted', completed: a => a.status === 'completed' };
    const shown = all.filter(pick[f]).sort((a, b) => a.left - b.left);
    const btn = a => a.status === 'pending' ? `<button class="btn btn-sm btn-primary" data-do="start" data-id="${a.id}">▶ Start challenge</button>` : a.status === 'started' ? `<button class="btn btn-sm btn-amber" data-do="submit" data-id="${a.id}">Continue</button>` : a.status === 'submitted' ? '<span class="chip b">Awaiting grade</span>' : `<span class="chip g">Score ${a.score} / ${a.marks}</span>`;
    return `${head('Incoming Challenges', '📝 Incoming Challenges', `<span class="chip ${all.some(a => a.soon) ? 'r' : 'g'}">${all.filter(a => a.soon).length} due soon</span>`)}
      ${filters('chal', [['pending', 'Pending', all.filter(pick.pending).length], ['soon', 'Due soon', all.filter(pick.soon).length], ['submitted', 'Submitted', all.filter(pick.submitted).length], ['completed', 'Completed', all.filter(pick.completed).length]], f)}
      <div class="mc-grid">${shown.map(a => `<section class="card ch-card ${a.soon ? (a.left <= 1 ? 'urgent' : 'soon') : ''}"><div class="mc-top"><span class="chip ${{ Quiz: 'b', Exam: 'p', Assignment: 'g', 'Lab challenge': 'c', Practical: 'a' }[a.k] || 'b'}">${a.k}</span><span class="chip ${a.diff === 'Hard' ? 'r' : a.diff === 'Medium' ? 'a' : 'g'}">${a.diff}</span></div>
        <b class="ch-t">${esc(a.t)}</b><small class="note">${esc(a.c)}</small>
        <div class="ch-meta"><span><small class="ov-lbl">Deadline</small><b class="lms-due ${a.soon ? (a.left <= 1 ? 'urgent' : 'soon') : ''}">${a.left < 0 ? fmtD(a.dueDate) : a.left === 0 ? 'Today' : `${a.left} day${a.left === 1 ? '' : 's'}`}</b></span><span><small class="ov-lbl">Duration</small><b>${a.min} min</b></span><span><small class="ov-lbl">Marks</small><b>${a.status === 'completed' ? `${a.score}/${a.marks}` : a.marks}</b></span></div>
        <div class="row">${a.soon ? `<span class="note lms-due ${a.left <= 1 ? 'urgent' : 'soon'}">⚠ ${a.left <= 1 ? 'Urgent' : 'Due soon'}</span>` : '<span></span>'}${btn(a)}</div></section>`).join('') || `<section class="card lms-empty"><b>🎉 Nothing here</b><p class="note">${f === 'pending' || f === 'soon' ? 'No assessments pending. Your trainer will post the next one here.' : 'Nothing in this list yet.'}</p></section>`}</div>`;
  },
  pending(inner) {
    const paid = isPaid(), st = lmsState();
    const items = LMS_QUEUE.map(q => { const locked = !paid && !q.free, status = locked ? 'locked' : st.queue[q.id] === 'started' || q.resume && paid ? 'progress' : 'new'; return { ...q, locked, status }; }).filter(q => paid ? q.id !== 'q-fnd' : true);
    const f = UI.queue, shown = items.filter(q => f === 'all' || q.status === f);
    const act = q => q.locked ? `<a class="btn btn-sm btn-amber" href="#/courses">⭐ Upgrade</a>` : q.status === 'progress' ? `<button class="btn btn-sm btn-primary" data-do="resume" data-t="${esc(q.c)}">▶ Resume course</button>` : `<button class="btn btn-sm btn-primary" data-do="startc" data-id="${q.id}">Start course</button>`;
    return `${inner ? '' : head('Campaigns', '📦 Courses pending')}
      ${filters('queue', [['all', 'All', items.length], ['new', 'Not started', items.filter(q => q.status === 'new').length], ['progress', 'In progress', items.filter(q => q.status === 'progress').length], ['locked', 'Locked', items.filter(q => q.status === 'locked').length]], f)}
      <div class="mc-grid">${shown.map(q => `<section class="card mc-card q-card ${q.locked ? 'locked' : ''}"><div class="mc-top"><span class="mc-ic">${q.ic}</span><div><b>${q.c}</b><small class="note">Instructor: ${esc(q.by)}</small></div>${q.locked ? '<span class="chip a">🔒 Premium</span>' : q.free ? '<span class="chip g">Free</span>' : q.status === 'progress' ? '<span class="chip b">In progress</span>' : '<span class="chip">Enrolled · not started</span>'}</div>
        <p class="note">${esc(q.d)}</p>
        <div class="ch-meta"><span><small class="ov-lbl">Difficulty</small><b>${q.diff}</b></span><span><small class="ov-lbl">Duration</small><b>${q.hrs} h</b></span><span><small class="ov-lbl">Prerequisites</small><b>${esc(q.pre)}</b></span></div>
        <div class="row"><button class="btn btn-sm" data-do="details" data-id="${q.id}">View details</button>${act(q)}</div></section>`).join('') || '<section class="card lms-empty"><p class="note">No courses in this list.</p></section>'}</div>`;
  },
  placement() {
    const pl = placement(), st = lmsState(), weak = 'Cloud logging and detection engineering';
    const acts = [
      ['resume', '📄', 'Improve your resume', st.resumeDone ? 'Done: trainer reviewed your resume.' : 'Add your SOC lab projects and certifications, then send it for review.', st.resumeDone ? 'done' : 'todo', st.resumeDone ? 'Reviewed' : 'Send for review'],
      ['mock', '🎤', 'Interview practice', st.mockBooked ? 'Mock interview 2 booked with your trainer.' : 'Book your next mock interview with your trainer.', st.mockBooked ? 'done' : 'todo', st.mockBooked ? 'Booked' : 'Book mock interview'],
      ['gap', '🧭', 'Skill-gap analysis', `From your assessment scores, focus next on ${weak}.`, 'todo', 'See gap report'],
      ['project', '🗂️', 'Complete a portfolio project', `${portfolio().filter(x => x.title).length} of 5 projects added. Add each project below with its skills and GitHub link.`, portfolio().filter(x => x.title).length >= 5 ? 'done' : 'todo', 'Add project'],
      ['intern', '💼', 'Internship preparation', 'Applications open 1 Nov. Finish your resume and 2 mock interviews first.', 'todo', 'View checklist']
    ];
    const steps = acts.filter(a => a[4] === 'todo').slice(0, 3);
    return `${head('Placement Mission', '🎯 Placement Mission', '<span class="chip g">Assurance track: on</span>')}
      <section class="card pm-top"><div class="ov-sum">${ring(pl.overall, 'var(--green)', 140, 12)}<div><span class="ov-lbl">Overall readiness</span><b class="ov-big">${pl.overall}% career-ready</b><p class="note">Average of resume, mock interviews, internship prep and portfolio.</p></div></div>
        <div class="pm-rings">${pl.items.map(x => `<div class="ov-pr">${ring(x.p, x.col, 84, 7)}<b>${x.t}</b><small>${x.note}</small></div>`).join('')}</div></section>
      <div class="mc-grid">${acts.map(([k, ic, t, d, s, b]) => `<section class="card mc-card pm-card ${s}"><div class="mc-top"><span class="mc-ic">${ic}</span><div><b>${t}</b></div><span class="chip ${s === 'done' ? 'g' : 'a'}">${s === 'done' ? '✓ Complete' : 'To do'}</span></div><p class="note">${d}</p><div class="row"><span></span><button class="btn btn-sm ${s === 'done' ? '' : 'btn-primary'}" data-do="pm" data-k="${k}" ${s === 'done' ? 'disabled' : ''}>${b}</button></div></section>`).join('')}</div>
      <section class="card pm-resume"><div class="row" style="flex-wrap:wrap"><span><h3 style="margin:0">📄 My resume</h3><span class="note">Built from your sign-up details and the projects below. GitHub links are clickable in the resume.</span></span><span class="row"><button class="btn btn-sm" data-do="editprof">Edit profile details</button><button class="btn btn-sm btn-primary" data-do="openresume">Open resume</button></span></div></section>
      <section class="card"><div class="row"><h3 style="margin:0">🗂️ Portfolio projects</h3><button class="btn btn-sm btn-primary" data-do="pf-add">+ Add project</button></div>
        <div class="pf-list">${portfolio().map((x, i) => `<div class="item pf-item" style="display:grid;gap:.35rem"><div class="row"><b>${esc(x.title || 'Untitled project')}</b><span class="row" style="gap:.4rem"><button class="btn btn-sm" data-do="pf-edit" data-i="${i}">Edit</button><button class="btn btn-sm" data-do="pf-del" data-i="${i}">Remove</button></span></div><span class="note">${esc(x.desc || '')}</span><span class="note"><b>Skills:</b> ${esc(x.skills || '–')}</span>${x.github ? `<a class="note" href="${esc(/^https?:/.test(x.github) ? x.github : 'https://' + x.github)}" target="_blank" rel="noopener">🔗 ${esc(x.github)}</a>` : '<span class="note">No GitHub link yet</span>'}</div>`).join('') || '<p class="note">No projects yet. Add your first one.</p>'}</div></section>
      <section class="card"><h3>Recommended next steps</h3><ol class="pm-steps">${steps.map(a => `<li><b>${a[2]}</b><span class="note">${a[3]}</span></li>`).join('')}</ol></section>`;
  }
};

/* rows shared by the overview and the week list */
function weekEvents(off) { const s = monStart(addD(new Date(), off * 7)); return Array.from({ length: 7 }, (_, i) => eventsOn(addD(s, i)).map(e => ({ ...e, date: addD(s, i) }))).flat(); }
function classRow(e) {
  const c = { class: 'g', lab: 'b', mentor: 'p', quiz: 'p' }[e.type] || 'b', today = dkey(e.date) === dkey(new Date());
  return `<div class="ov-class ${c}"><span class="ov-day"><b>${fmtD(e.date, { weekday: 'short' })}</b><small>${today ? 'Today' : dkey(e.date) === dkey(addD(new Date(), 1)) ? 'Tomorrow' : fmtD(e.date, { day: 'numeric', month: 'short' })}</small></span><span class="ov-what"><small class="note">${hhmm(e.s)} – ${hhmm(e.e)}</small><b>${esc(e.title)}</b><small class="note">${esc(e.course)} · ${TYPE[e.type][1]}</small></span>${STATUS(e.status)}</div>`;
}

/* ---------- actions ---------- */
function lmsAct(el) {
  const st = lmsState(), k = el.dataset.do;
  if (k === 'report') {
    const m = monthStats(), rows = [['Date', 'Session', 'Course', 'Trainer', 'Status']];
    const ref = new Date(); for (let i = 1; i <= new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate(); i++) sessionsOn(new Date(ref.getFullYear(), ref.getMonth(), i)).filter(x => x.att).forEach(x => rows.push([dkey(x.date), x.title, x.course, x.who, x.att]));
    rows.push([], ['Attendance', `${m.pct}%`, `${m.attended}/${m.total}`, `Required ${LMS_REQUIRED}%`]);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' }));
    a.download = `attendance-${dkey(ref).slice(0, 7)}.csv`; document.body.appendChild(a); a.click(); a.remove(); toast('Attendance report downloaded.'); return;
  }
  if (k === 'cal-prev' || k === 'cal-next') { const c = UI.cal, s = k === 'cal-prev' ? -1 : 1; c.cur = c.view === 'month' ? new Date(c.cur.getFullYear(), c.cur.getMonth() + s, 1) : addD(c.cur, s * (c.view === 'week' ? 7 : 1)); if (c.view !== 'month') c.sel = dkey(c.cur); return rerender(); }
  if (k === 'cal-today') { UI.cal.cur = d0(new Date()); UI.cal.sel = dkey(new Date()); return rerender(); }
  if (k === 'wk-prev' || k === 'wk-next') { UI.weekOff += k === 'wk-prev' ? -1 : 1; return rerender(); }
  if (k === 'wk-today') { UI.weekOff = 0; return rerender(); }
  if (k === 'join') return toast(`Opening the class room for ${el.dataset.t}.`);
  if (k === 'rec') return toast(`Playing the recording: ${el.dataset.t}.`);
  if (k === 'continue' || k === 'resume') return toast(`Resuming ${el.dataset.t} where you left off.`);
  const L = typeof trainerLink === 'function' && trainerLink();
  if (L && L.trainer && ['msg', 'book', 'tmsg', 'lesson', 'sess-yes', 'sess-no', 'sess-cancel', 'leave', 'leave-x'].includes(k)) return linkedAct(k, el, L);
  if (k === 'msg') {
    const ov = modal(`<div class="row"><h2>Message ${LMS_TRAINER.name}</h2><button class="btn btn-sm" data-close>Close</button></div><label class="note" for="msgTx" style="display:block;margin-top:.8rem">Your message</label><textarea id="msgTx" rows="4" style="width:100%;margin:.4rem 0 .8rem"></textarea><button class="btn btn-primary btn-sm" id="msgGo">Send</button>`);
    $('#msgGo', ov).addEventListener('click', () => { const t = $('#msgTx', ov).value.trim(); if (!t) return toast('Type a message first.'); st.msgs.push({ to: LMS_TRAINER.name, text: t, at: fmtD(new Date()) }); lmsSave(); ov.remove(); toast('Message sent to your trainer.'); rerender(); });
    return;
  }
  if (k === 'book') {
    const opts = []; for (let i = 1; i < 10 && opts.length < 4; i++) { const d = addD(new Date(), i); if (d.getDay() && d.getDay() < 6 && !holidayOn(d)) opts.push([dkey(d), 960 + (opts.length % 2) * 30, LMS_TRAINER.name]); }
    const ov = modal(`<div class="row"><h2>Book a one-to-one</h2><button class="btn btn-sm" data-close>Close</button></div><p class="note" style="margin:.6rem 0">${LMS_TRAINER.name} · ${LMS_TRAINER.avail}</p><div class="list">${opts.map(([d, s]) => `<button class="btn btn-sm" data-slot="${d}|${s}">${fmtD(fromKey(d))} · ${hhmm(s)}</button>`).join('')}</div>`);
    $$('[data-slot]', ov).forEach(x => x.addEventListener('click', () => { const [d, s] = x.dataset.slot.split('|'); st.booked.push({ date: d, s: +s, who: LMS_TRAINER.name }); lmsSave(); ov.remove(); toast(`One-to-one booked: ${x.textContent}`); rerender(); }));
    return;
  }
  if (k === 'start') {
    const a = LMS_ASSESS.find(x => x.id === el.dataset.id);
    const ov = modal(`<div class="row"><h2>${esc(a.t)}</h2><button class="btn btn-sm" data-close>Close</button></div><p class="note" style="margin:.6rem 0">${a.k} · ${a.min} minutes · ${a.marks} marks. The timer starts when you begin.</p><button class="btn btn-primary btn-sm" id="goA">Begin</button>`);
    $('#goA', ov).addEventListener('click', () => { st.asg[a.id] = 'started'; lmsSave(); ov.remove(); toast('Challenge started. Continue any time before the deadline.'); rerender(); });
    return;
  }
  if (k === 'submit') {
    const a = LMS_ASSESS.find(x => x.id === el.dataset.id);
    const ov = modal(`<div class="row"><h2>${esc(a.t)}</h2><button class="btn btn-sm" data-close>Close</button></div><p class="note" style="margin:.6rem 0">In progress. Submit when you are done; your trainer grades it.</p><button class="btn btn-primary btn-sm" id="subA">Submit</button>`);
    $('#subA', ov).addEventListener('click', () => { st.asg[a.id] = 'submitted'; lmsSave(); ov.remove(); toast('Submitted for grading.'); rerender(); });
    return;
  }
  if (k === 'startc') { st.queue[el.dataset.id] = 'started'; lmsSave(); toast('Course started. Find it under In progress.'); return rerender(); }
  if (k === 'details') { const q = LMS_QUEUE.find(x => x.id === el.dataset.id); modal(`<div class="row"><h2>${q.ic} ${q.c}</h2><button class="btn btn-sm" data-close>Close</button></div><p style="margin:.6rem 0">${esc(q.d)}</p><p class="note">Instructor ${q.by} · ${q.diff} · ${q.hrs} hours · Prerequisites: ${q.pre}${q.start ? ' · ' + q.start : ''}</p>`); return; }
  if (k === 'openresume') return showResume();
  if (k === 'editprof') return window.YojoSettings && window.YojoSettings.open('profile');
  if (k === 'pf-add') return pfEdit(-1);
  if (k === 'pf-edit') return pfEdit(+el.dataset.i);
  if (k === 'pf-del') { portfolio().splice(+el.dataset.i, 1); lmsSave(); toast('Project removed.'); return rerender(); }
  if (k === 'pm') {
    const key = el.dataset.k;
    if (key === 'resume') { st.resumeDone = true; lmsSave(); toast('Resume sent to your trainer for review.'); return rerender(); }
    if (key === 'mock') { st.mockBooked = true; lmsSave(); toast('Mock interview booked.'); return rerender(); }
    if (key === 'gap') return modal(`<div class="row"><h2>Skill-gap report</h2><button class="btn btn-sm" data-close>Close</button></div><div class="list" style="margin-top:.8rem">${[['Log analysis', 86], ['Detection engineering', 58], ['Cloud logging', 44], ['Incident reporting', 79]].map(([t, p]) => `<div class="item" style="display:grid;gap:.3rem"><div class="row"><b>${t}</b><span class="note">${p}%</span></div><div class="bar"><i style="width:${p}%"></i></div></div>`).join('')}</div>`);
    if (key === 'project') return pfEdit(-1);
    return toast('Internship checklist opened.');
  }
}
function pfEdit(i) {
  const x = i >= 0 ? portfolio()[i] : { title: '', skills: '', desc: '', github: '' };
  const ov = modal(`<div class="row"><h2>${i >= 0 ? 'Edit project' : 'Add a project'}</h2><button class="btn btn-sm" data-close>Close</button></div>
    <form id="pfF" style="display:grid;gap:.6rem;margin-top:.6rem" novalidate>
      <label class="note">Title<input name="title" value="${esc(x.title)}" style="width:100%;margin-top:.25rem" placeholder="e.g. SIEM detection lab"></label>
      <label class="note">Skills used<input name="skills" value="${esc(x.skills)}" style="width:100%;margin-top:.25rem" placeholder="e.g. Splunk, Sigma, Python"></label>
      <label class="note">Description<textarea name="desc" rows="3" style="width:100%;margin-top:.25rem" placeholder="What you built and what it shows">${esc(x.desc)}</textarea></label>
      <label class="note">GitHub link<input name="github" value="${esc(x.github)}" style="width:100%;margin-top:.25rem" placeholder="github.com/you/project"></label>
      <p class="note" id="pfE" style="color:#f87171"></p><button class="btn btn-primary btn-sm" style="justify-self:start">Save project</button></form>`);
  $('#pfF', ov).addEventListener('submit', e => { e.preventDefault(); const f = e.target, v = { title: f.title.value.trim(), skills: f.skills.value.trim(), desc: f.desc.value.trim(), github: f.github.value.trim() };
    if (!v.title) return $('#pfE', ov).textContent = 'Add a project title.';
    if (v.github && !/^(https?:\/\/)?(www\.)?github\.com\/[\w.-]+/i.test(v.github)) return $('#pfE', ov).textContent = 'Use a GitHub link, like github.com/you/project.';
    if (i >= 0) portfolio()[i] = v; else portfolio().push(v); lmsSave(); ov.remove(); toast('Project saved. It now shows on your resume.'); rerender(); });
}
/* ---------- live link to the trainer portal (YojoBridge in trainer-data.js) ---------- */
const SESS_CHIP = { Requested: ['a', 'Waiting for trainer'], Accepted: ['g', 'Confirmed'], 'Time proposed': ['a', 'New time proposed'], Declined: ['r', 'Declined'], Completed: ['', 'Completed'], 'Cancelled by student': ['', 'Cancelled'], 'No-show': ['r', 'Missed'] };
const when = t => new Date(t).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
function linkedHandler(L) {
  const t = L.trainer, ss = YojoBridge.sessions(L.sid), th = YojoBridge.threads(L.sid), an = YojoBridge.announcements(L.sid).slice(0, 4), gr = YojoBridge.grades(L.sid);
  YojoBridge.readThreads(L.sid);
  const av = t.photo ? `<img src="${t.photo}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : esc(t.name.split(' ').map(w => w[0]).join('').slice(0, 2));
  return `${head('My Handler', '🧑‍🏫 My Handler')}
    <div class="hd-grid"><section class="card hd-card main"><div class="hd-top"><span class="hd-av" style="overflow:hidden">${av}</span><div><span class="ov-lbl">Assigned trainer · Batch ${esc(L.batch)}</span><b class="hd-name">${esc(t.name)}</b><span class="note">${esc(t.title)}</span></div><span class="chip g">● Linked live</span></div>
      <div class="hd-facts"><span><small class="ov-lbl">Specialisation</small>${esc(t.specialisation || 'Not added yet')}</span><span><small class="ov-lbl">Experience</small>${t.experience ? esc(t.experience) + ' years' : '–'}</span><span><small class="ov-lbl">Languages</small>${esc(t.languages || '–')}</span></div>
      ${t.certifications ? `<div class="hd-certs">${t.certifications.split(',').map(c => `<span class="chip b">🏅 ${esc(c.trim())}</span>`).join('')}</div>` : ''}${t.bio ? `<p class="note">${esc(t.bio)}</p>` : ''}
      <p class="note"><b>Availability:</b> ${(() => { const sl = YojoBridge.slots(L.sid); return sl.length ? `${sl.length} open slots in the next 2 weeks · next ${esc(when(sl[0].at || sl[0]))}` : 'No open slots right now, send a message instead'; })()}</p>
      <div class="hd-acts"><button class="btn btn-primary btn-sm" data-do="msg">✉ Message trainer</button><button class="btn btn-sm" data-do="book">📅 Book a session</button><button class="btn btn-sm" data-do="leave">🗓 Request leave</button></div></section>
    <section class="card" id="leaveCard"><h3>My leave requests</h3><div class="list">${(() => { const lv = YojoBridge.leaves(L.sid); const LC = { Pending: ['a', 'Waiting for trainer'], Approved: ['g', 'Approved'], Rejected: ['r', 'Not approved'], Withdrawn: ['', 'Withdrawn'] };
      const d = t => new Date(t).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
      return lv.length ? lv.map(v => `<div class="item" style="display:grid;gap:.3rem"><div class="row"><b>${d(v.from)}${v.days > 1 ? ' to ' + d(v.to) : ''} · ${v.days} day${v.days === 1 ? '' : 's'}</b><span class="chip ${LC[v.status][0]}">${LC[v.status][1]}</span></div><span class="note">${esc(v.reason)}</span>${v.status === 'Rejected' && v.decidedAt ? `<span class="note">Trainer: ${esc(v.reasonT || '')}</span>` : ''}${v.status === 'Pending' ? `<div class="row" style="justify-content:flex-start"><button class="btn btn-sm" data-do="leave-x" data-id="${v.id}">Withdraw</button></div>` : ''}</div>`).join('') : '<p class="note">Need a day off? Use Request leave and your trainer gets it straight away.</p>'; })()}</div></section>
    <section class="card"><h3>My session requests</h3><div class="list">${ss.length ? ss.map(r => { const [c, lbl] = SESS_CHIP[r.status] || ['', r.status]; return `<div class="item" style="display:grid;gap:.35rem"><div class="row"><b>${esc(r.type)}</b><span class="chip ${c}">${lbl}</span></div><span class="note">${when(r.when)} · ${r.dur} min${r.reason ? ' · ' + esc(r.reason) : ''}</span>
      ${r.status === 'Time proposed' ? `<div class="row" style="justify-content:flex-start"><button class="btn btn-primary btn-sm" data-do="sess-yes" data-id="${r.id}">Accept new time</button><button class="btn btn-sm" data-do="sess-no" data-id="${r.id}">Decline</button></div>` : ['Requested', 'Accepted'].includes(r.status) && r.when > Date.now() ? `<button class="btn btn-sm" style="justify-self:start" data-do="sess-cancel" data-id="${r.id}">Cancel request</button>` : ''}</div>`; }).join('') : '<p class="note">No requests yet. Book a session with your trainer.</p>'}</div></section></div>
    <div class="ov-two">
      <section class="card"><h3>Messages with your trainer</h3><div class="list">${th.length ? th.map(x => `<div class="item" style="display:grid;gap:.3rem"><div class="row"><b>${esc(x.subject)}</b>${x.studentUnread ? '<span class="chip g">New reply</span>' : ''}</div>${x.msgs.slice(-3).map(m => `<span class="note"><b>${m.from === 'trainer' ? esc(t.name) : 'You'}:</b> ${esc(m.text)}</span>`).join('')}<button class="btn btn-sm" style="justify-self:start" data-do="tmsg" data-id="${x.id}" data-s="${esc(x.subject)}">Reply</button></div>`).join('') : '<p class="note">No messages yet.</p>'}</div></section>
      <section class="card"><h3>From your trainer</h3><div class="list">${an.map(a => `<div class="item"><span>📣 ${esc(a.text)}</span><span class="note">${new Date(a.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span></div>`).join('') || '<p class="note">No announcements yet.</p>'}
        ${gr.map(g => `<div class="item" style="display:grid;gap:.2rem"><div class="row"><b>${esc(g.title)}</b><span class="chip ${g.state === 'Published' ? 'g' : 'a'}">${g.state === 'Published' ? `${g.total} / ${g.max}` : 'Returned for changes'}</span></div>${g.comment ? `<span class="note">${esc(g.comment)}</span>` : ''}</div>`).join('')}</div></section>
    </div>`;
}
const LTYPE_IC = { Video: '🎬', PDF: '📄', Slides: '📊', Document: '📝', Link: '🔗', Quiz: '❓', Lab: '🧪', 'Live Class': '🔴' };
function trainerContent(L) {
  const cs = YojoBridge.courses(L.sid);
  if (!cs.length) return '';
  return `<section class="card" id="trContent"><h3>Course content from your trainer <span class="chip g" style="margin-left:.4rem">Live</span></h3><div class="list">${cs.map(c => `<details class="item" style="display:block" ${cs.length === 1 ? 'open' : ''}><summary class="row" style="cursor:pointer"><b>${esc(c.title)}</b><span class="note">${c.pct}% complete</span></summary>
    <div class="bar" style="margin:.4rem 0"><i style="width:${c.pct}%"></i></div>${c.modules.map(m => `<div style="margin:.5rem 0"><small class="ov-lbl">${esc(m.title)}</small><div class="list" style="margin-top:.3rem">${m.lessons.map(l => `<div class="item"><span>${LTYPE_IC[l.type] || '•'} ${esc(l.title)} <small class="note">· ${l.type}${l.concept ? ' · Concept' : ''}</small></span>${l.locked ? `<span class="chip">Opens ${when(l.release)}</span>` : `<span class="row" style="gap:.4rem">${l.done ? '<span class="chip g">✓ Done</span>' : ''}<button class="btn btn-sm ${l.done ? '' : 'btn-primary'}" data-do="lesson" data-c="${c.id}" data-id="${l.id}">${l.done ? 'Open again' : 'Open'}</button></span>`}</div>`).join('')}</div></div>`).join('')}</details>`).join('')}</div></section>`;
}
function linkedAct(k, el, L) {
  const t = L.trainer;
  if (k === 'msg' || k === 'tmsg') {
    const reply = k === 'tmsg';
    const ov = modal(`<div class="row"><h2>${reply ? 'Reply to' : 'Message'} ${esc(t.name)}</h2><button class="btn btn-sm" data-close>Close</button></div>
      ${reply ? `<p class="note">${esc(el.dataset.s)}</p>` : '<label class="note" for="msgSub" style="display:block;margin-top:.8rem">Subject</label><input id="msgSub" style="width:100%;margin:.3rem 0" placeholder="e.g. Stuck on a lab checkpoint">'}
      <label class="note" for="msgTx" style="display:block;margin-top:.6rem">Your message</label><textarea id="msgTx" rows="4" style="width:100%;margin:.4rem 0 .8rem"></textarea><button class="btn btn-primary btn-sm" id="msgGo">Send</button><p class="note" style="margin-top:.5rem">Your trainer replies within 2 working days.</p>`);
    $('#msgGo', ov).addEventListener('click', () => { try { YojoBridge.message(L.sid, reply ? '' : ($('#msgSub', ov).value.trim() || 'Question'), $('#msgTx', ov).value.trim(), reply ? el.dataset.id : null); ov.remove(); toast('Message sent to your trainer.'); rerender(); } catch (e) { toast(e.message); } });
    return;
  }
  if (k === 'book') {
    const slots = YojoBridge.slots(L.sid);
    const types = ['1-to-1 doubt clearing', 'Career guidance'].concat(t.mentor ? ['Mock interview'] : []);
    const ov = modal(`<div class="row"><h2>Book a session with ${esc(t.name)}</h2><button class="btn btn-sm" data-close>Close</button></div>
      <label class="note" for="bkT" style="display:block;margin-top:.8rem">Session type</label><select id="bkT" style="width:100%;margin:.3rem 0">${types.map(x => `<option>${x}</option>`).join('')}</select>
      <label class="note" for="bkN" style="display:block;margin-top:.5rem">What do you need help with?</label><textarea id="bkN" rows="2" style="width:100%;margin:.3rem 0"></textarea>
      <p class="note" style="margin:.5rem 0">Open slots from your trainer's weekly availability:</p><div class="list">${slots.map(w => `<button class="btn btn-sm" data-slot="${w}">${when(w)}</button>`).join('') || '<p class="note">No open slots in the next two weeks. Send a message instead.</p>'}</div>`);
    $$('[data-slot]', ov).forEach(x => x.addEventListener('click', () => { try { YojoBridge.book(L.sid, $('#bkT', ov).value, +x.dataset.slot, $('#bkN', ov).value.trim()); ov.remove(); toast('Request sent. Your trainer will confirm it.'); rerender(); } catch (e) { toast(e.message); } }));
    return;
  }
  if (k === 'leave') {
    const today = new Date().toISOString().slice(0, 10);
    const ov = modal(`<div class="row"><h2>Request leave from ${esc(t.name)}</h2><button class="btn btn-sm" data-close>Close</button></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-top:.8rem"><label class="note">First day<input type="date" id="lvF" min="${today}" value="${today}" style="width:100%;margin-top:.3rem"></label><label class="note">Last day<input type="date" id="lvT" min="${today}" value="${today}" style="width:100%;margin-top:.3rem"></label></div>
      <label class="note" for="lvR" style="display:block;margin-top:.6rem">Reason</label><textarea id="lvR" rows="3" style="width:100%;margin:.3rem 0 .8rem" placeholder="e.g. Family function, medical appointment"></textarea>
      <button class="btn btn-primary btn-sm" id="lvGo">Send to trainer</button><p class="note" id="lvE" style="color:#f87171;margin-top:.5rem"></p>`);
    $('#lvGo', ov).addEventListener('click', () => { try { YojoBridge.requestLeave(L.sid, $('#lvF', ov).value, $('#lvT', ov).value, $('#lvR', ov).value); ov.remove(); toast('Leave request sent to your trainer.'); rerender(); } catch (e) { $('#lvE', ov).textContent = e.message; } });
    return;
  }
  if (k === 'leave-x') { YojoBridge.cancelLeave(L.sid, el.dataset.id); toast('Leave request withdrawn.'); return rerender(); }
  if (k === 'sess-yes' || k === 'sess-no') { YojoBridge.respond(L.sid, el.dataset.id, k === 'sess-yes'); toast(k === 'sess-yes' ? 'New time accepted.' : 'Declined.'); return rerender(); }
  if (k === 'sess-cancel') { YojoBridge.cancel(L.sid, el.dataset.id); toast('Request cancelled.'); return rerender(); }
  if (k === 'lesson') {
    const c = YojoBridge.courses(L.sid).find(x => x.id === el.dataset.c), l = c && c.modules.flatMap(m => m.lessons).find(x => x.id === el.dataset.id); if (!l) return;
    const body = l.type === 'Link' ? `<a class="btn btn-sm" href="${esc(l.url)}" target="_blank" rel="noopener">Open link ↗</a>` : l.file ? `<div class="item"><span>${LTYPE_IC[l.type]} ${esc(l.file.name)}</span><span class="note">${l.file.sizeMB} MB</span></div><p class="note">${l.type === 'Video' ? 'The video player opens here.' : 'The document viewer opens here.'} ${l.dl ? 'Download allowed.' : 'View only (no download).'}</p>` : `<p class="note">${l.type === 'Live Class' ? 'Join from This Week when the class starts.' : l.type === 'Lab' ? 'Open this lab from Incident Response.' : 'Open the quiz from Incoming Challenges.'}</p>`;
    const ov = modal(`<div class="row"><h2>${LTYPE_IC[l.type] || ''} ${esc(l.title)}</h2><button class="btn btn-sm" data-close>Close</button></div><p class="note" style="margin:.4rem 0 .8rem">${esc(c.title)} · ${l.type}</p>${body}
      <div class="row" style="justify-content:flex-start;margin-top:1rem">${l.done ? '<span class="chip g">✓ Completed</span>' : '<button class="btn btn-primary btn-sm" id="lsDone">Mark as complete</button>'}</div>`);
    $('#lsDone', ov)?.addEventListener('click', () => { try { YojoBridge.complete(L.sid, l.id); ov.remove(); toast('Lesson complete. Your trainer sees your progress.'); rerender(); } catch (e) { toast(e.message); } });
  }
}
function rerender() { vLms(location.hash.split('/')[2]); }

/* ---------- entry: route #/lms/<section> ---------- */
function vLms(sub) {
  if (sub === 'pending') { UI.campTab = 'queued'; sub = 'learning'; } else if (sub === 'learning' && vLms._last !== 'learning') UI.campTab = 'active';
  vLms._last = sub;
  const paid = isPaid(), key = LMS_SECTIONS.some(x => x[0] === sub) ? sub : 'attendance', sec = LMS_SECTIONS.find(x => x[0] === key);
  const side = `<nav class="lms-side card" aria-label="Training Grid sections"><b class="lms-plan ${paid ? 'paid' : ''}">${paid ? '⭐ Premium Operative' : 'Free Operative'}</b>
    ${LMS_SECTIONS.map(([k, ic, t, sm, prem]) => `<a href="#/lms/${k}" ${k === key ? 'aria-current="page"' : ''}><span class="ic">${ic}</span><span><b>${t}</b><small>${sm}</small></span>${prem && !paid ? '<span class="lk" title="Premium">🔒</span>' : '<span class="lk">›</span>'}</a>`).join('')}
    ${paid ? '' : '<a class="btn btn-amber btn-sm lms-up" href="#/courses">⭐ Upgrade to Premium</a>'}</nav>`;
  const body = sec[4] && !paid ? lmsLock(sec[2], sec[3]) : PAGES[key]();
  $('#view').innerHTML = `<h1>Training Grid <span class="note" style="font-size:.8rem">· Student LMS</span></h1><p class="note" style="margin:.3rem 0 1rem">${paid ? (() => { const nx = nextSession(['class', 'lab', 'quiz']); return `Batch ${esc(me.stats.batch || 'SOC-B7')} · Mon-Fri 6:30-8:30 PM IST${nx ? ` · Next class: ${dkey(nx.date) === dkey(new Date()) ? 'Today' : fmtD(nx.date)} ${hhmm(nx.s)}` : ''}`; })() : 'Free plan: self-paced labs and the full LMS layout. Sections marked 🔒 unlock with Premium.'}</p>
    <div class="lms">${side}<div class="lms-main" data-page="${key}">${body}</div></div>`;
  const main = $('.lms-main');
  main.addEventListener('click', e => {
    const f = e.target.closest('[data-f]'); if (f) { const [n, v] = f.dataset.f.split(':'); if (n === 'calview') { UI.cal.view = v; if (v !== 'month') UI.cal.cur = fromKey(UI.cal.sel || dkey(new Date())); } else if (n === 'wkmode') UI.weekMode = v; else if (n === 'camptab') UI.campTab = v; else UI[n] = v; return rerender(); }
    const day = e.target.closest('[data-day]'); if (day) { UI.cal.sel = day.dataset.day; rerender(); return; }
    const a = e.target.closest('[data-do]'); if (a) lmsAct(a);
  });
  main.addEventListener('change', e => { const c = e.target.closest('[data-calf]'); if (c) { UI.cal.f[c.dataset.calf] = c.checked; rerender(); } });
}
