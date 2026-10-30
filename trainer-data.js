/* Yojo Trainer console: DEMO DATA + SIMULATED SERVER.
   There is no backend in this prototype. Everything the trainer pages read comes through
   TrainerAPI below, which plays the part of the server: it applies the access rules from the
   design document (own batches only, hidden fields stripped, audit on every sensitive action).
   All names, numbers and dates are SAMPLES. Replace TrainerAPI with real HTTP calls; the pages
   only depend on its method names and return shapes. */
(() => {
  'use strict';
  const KEY = 'yojo_trainer_demo_v2';
  const DAY = 864e5, now = () => Date.now();
  const d0 = new Date(); d0.setHours(0, 0, 0, 0); const T0 = d0.getTime();
  const at = (days, hh = 0, mm = 0) => T0 + days * DAY + (hh * 60 + mm) * 6e4;
  const CFG = { // [PROVISIONAL] values from the design document, kept configurable
    attendanceMin: 75, clearanceWatchPct: 80, editWindowH: 48, gradingTurnaroundDays: 3,
    feedbackMinResponses: 5, stuckMinutes: 30, noLabDays: 14, missedAssessFlag: 2,
    joinWithinMin: 10, joinStayPct: 75, uploadMaxMB: 50, videoMaxGB: 2
  };

  // each lesson type accepts only its own kind of file [sizes PROVISIONAL]
  const FILE_RULES = {
    Video: { ext: ['mp4'], mime: /^video\/mp4$/, maxMB: 2048, label: 'MP4 video up to 2 GB' },
    PDF: { ext: ['pdf'], mime: /^application\/pdf$/, maxMB: 50, label: 'PDF up to 50 MB' },
    Slides: { ext: ['ppt', 'pptx'], mime: /presentation|powerpoint/, maxMB: 50, label: 'PowerPoint (PPT or PPTX) up to 50 MB' },
    Document: { ext: ['doc', 'docx', 'txt', 'rtf', 'odt'], mime: /word|text\/plain|rtf|opendocument\.text/, maxMB: 50, label: 'Word, TXT, RTF or ODT up to 50 MB' }
  };
  const extOf = n => (String(n).split('.').pop() || '').toLowerCase();
  const fileFits = (type, name) => !!FILE_RULES[type] && FILE_RULES[type].ext.includes(extOf(name));
  /* ---------------- seed ---------------- */
  function seed() {
    const P = (n, b, path, rank, pattern, labs, quiz, xp, extra = {}) => ({ id: 'U-' + (20400 + n), name: extra.name, loginEmail: extra.loginEmail || '', batch: b, path, rank, pattern, labs, quiz, xp,
      lastLabDays: extra.lastLabDays ?? 1, missed: extra.missed ?? 0, lastActive: now() - (extra.idleH ?? 3) * 36e5,
      resume: !!extra.resume, mocks: extra.mocks ?? 0, portfolio: !!extra.portfolio, internship: extra.internship || 'Not started',
      // fields the server must never send to a trainer:
      guardianPhone: '+91 98' + (10000000 + n * 7919), email: `student${n}@mail.demo`, phone: '+91 90' + (10000000 + n * 3571), feeDue: n % 3 ? 0 : 12000 });
    const students = [
      P(17, 'SOC-B7', 'Defensive', 'Cyber Apprentice', 'PPPPPPPPLP', 12, 74, 70, { name: 'Riya Sharma', loginEmail: 'riya.sharma@students.yojo.demo', resume: true, mocks: 2, portfolio: true, internship: 'Applied' }),
      P(18, 'SOC-B7', 'Defensive', 'Recruit', 'PPPLPPAPPP', 9, 69, 52, { name: 'Arjun K.', loginEmail: 'arjun.k@students.yojo.demo', resume: true, mocks: 1 }),
      P(19, 'SOC-B7', 'Offensive', 'Recruit', 'PAPAPPAPLA', 7, 58, 40, { name: 'Neha P.', missed: 1, lastLabDays: 4, mocks: 0 }),
      P(20, 'SOC-B7', 'Defensive', 'Security Operative', 'PPPPPPPPPP', 14, 82, 88, { name: 'Sai V.', resume: true, mocks: 3, portfolio: true, internship: 'Matched' }),
      P(21, 'SOC-B7', 'GRC', 'Recruit', 'AAPALAPAAP', 2, 41, 18, { name: 'Dev K.', missed: 2, lastLabDays: 16, idleH: 200 }),
      P(22, 'SOC-B7', 'Defensive', 'Cyber Apprentice', 'PPLPPPPPPA', 10, 71, 61, { name: 'Meera J.', resume: true, mocks: 1, portfolio: true }),
      P(23, 'SOC-B7', 'Offensive', 'Cyber Apprentice', 'PPPPAPPPPP', 11, 77, 66, { name: 'Kabir S.', mocks: 2 }),
      P(24, 'SOC-B7', 'Defensive', 'Recruit', 'PPAPPLPPAP', 8, 63, 45, { name: 'Ananya R.', resume: true }),
      P(31, 'FND-B3', 'Defensive', 'Recruit', 'PPPPPPPP', 6, 72, 50, { name: 'Rahul M.', resume: true }),
      P(32, 'FND-B3', 'GRC', 'Recruit', 'PAPPPAPP', 5, 66, 38, { name: 'Pooja N.' }),
      P(33, 'FND-B3', 'Offensive', 'Recruit', 'PPPAAAPA', 3, 49, 22, { name: 'Imran T.', missed: 2, lastLabDays: 15 }),
      P(34, 'FND-B3', 'Defensive', 'Cyber Apprentice', 'PPPPPPPL', 8, 80, 72, { name: 'Lakshmi V.', resume: true, mocks: 1 }),
      P(35, 'FND-B3', 'Defensive', 'Recruit', 'PPLPPPPP', 6, 70, 47, { name: 'Tanvi G.' }),
      // another trainer's batch: must never reach this console
      P(51, 'OPS-B2', 'Offensive', 'Recruit', 'PPPPPPPP', 9, 70, 60, { name: 'Other Batch Student' })
    ];
    const batches = [
      { id: 'SOC-B7', course: 'SOC Analyst (Blue Team)', courseId: 'C-SOC', trainer: 'trainer', slot: '6:30 PM', mode: 'Online' },
      { id: 'FND-B3', course: 'Cyber Foundations', courseId: 'C-FND', trainer: 'trainer', slot: '10:00 AM', mode: 'Direct' },
      { id: 'OPS-B2', course: 'Offensive Ops', courseId: 'C-OPS', trainer: 'someone.else', slot: '7:00 PM', mode: 'Online' }
    ];
    const topicsSOC = ['SIEM fundamentals', 'Log sources and parsing', 'Windows event IDs', 'Alert triage', 'Phishing analysis', 'Network IOC hunting', 'Detection rules (Sigma)', 'Incident timeline', 'Threat intel feeds', 'Log Analysis'];
    const topicsFND = ['How networks work', 'Linux basics', 'Users and permissions', 'Web basics', 'Passwords and hashing', 'Encryption 101', 'OWASP Top 10 tour', 'Security mindset'];
    const lectures = [];
    const mkLect = (batch, topics, startDay, hh) => topics.forEach((tp, k) => {
      const day = startDay + k * 2 - topics.length * 2, id = `${batch}-L${k + 1}`;
      const hol = batch === 'SOC-B7' && k === 5;
      const marks = {}, joinLog = {};
      if (!hol) students.filter(s => s.batch === batch).forEach(s => { const m = s.pattern[k] || 'P'; marks[s.id] = m; joinLog[s.id] = m === 'A' ? null : { joinedMin: m === 'L' ? 14 : 2, pct: m === 'L' ? 70 : 92 + (s.id.charCodeAt(6) % 8) }; });
      const latest = k === topics.length - 1;
      lectures.push({ id, batch, courseId: batch === 'SOC-B7' ? 'C-SOC' : 'C-FND', n: k + 1, topic: tp, start: at(day, hh), durMin: 90, status: hol ? 'holiday' : 'held',
        holidayName: hol ? 'Gandhi Jayanti' : '', concepts: [`${tp} (concept)`], conceptsCovered: latest ? [] : [`${tp} (concept)`],
        marks: latest ? {} : marks, joinLog, markedAt: latest ? null : at(day, hh + 2), locked: k < topics.length - 3, recording: !hol ? `rec-${id}` : null });
    });
    mkLect('SOC-B7', topicsSOC, 0, 18.5); mkLect('FND-B3', topicsFND, 1, 10);
    // the most recent SOC lecture (today-ish) is not marked yet; give it a join log for the suggestion
    const classes = [
      { id: 'CL-1', batch: 'SOC-B7', courseId: 'C-SOC', topic: 'Threat hunting with Sigma', start: at(0, 18, 30), durMin: 90, mode: 'Online', link: 'https://meet.demo/soc-b7-' + Math.random().toString(36).slice(2, 8), room: '', concepts: ['Sigma rule syntax', 'Hunting queries'], status: 'upcoming' },
      { id: 'CL-2', batch: 'FND-B3', courseId: 'C-FND', topic: 'Firewalls and ports', start: at(1, 10, 0), durMin: 90, mode: 'Direct', link: '', room: 'Lab 2, Hyderabad centre', concepts: ['Ports and services'], status: 'upcoming' },
      { id: 'CL-3', batch: 'SOC-B7', courseId: 'C-SOC', topic: 'Malware triage basics', start: at(2, 18, 30), durMin: 90, mode: 'Online', link: '', room: '', concepts: ['Static triage'], status: 'upcoming' },
      { id: 'CL-4', batch: 'FND-B3', courseId: 'C-FND', topic: 'Holiday: Diwali', start: at(4, 10, 0), durMin: 0, mode: 'Direct', link: '', room: '', concepts: [], status: 'holiday' },
      { id: 'CL-5', batch: 'SOC-B7', courseId: 'C-SOC', topic: 'Cloud logs (moved)', start: at(5, 18, 30), durMin: 90, mode: 'Online', link: 'https://meet.demo/soc-b7-x', room: '', concepts: ['CloudTrail'], status: 'cancelled', reason: 'Trainer travelling; moved to next week' },
      { id: 'CL-6', batch: 'SOC-B7', courseId: 'C-SOC', topic: 'Report writing for SOC', start: at(9, 18, 30), durMin: 60, mode: 'Online', link: '', room: '', concepts: ['Incident reports'], status: 'draft' }
    ];
    lectures.filter(l => l.status === 'held').slice(-4).forEach((l, k) => classes.push({ id: 'PC-' + l.id, batch: l.batch, courseId: l.courseId, topic: l.topic, start: l.start, durMin: 90, mode: l.batch === 'SOC-B7' ? 'Online' : 'Direct', link: l.batch === 'SOC-B7' ? 'https://meet.demo/past' : '', room: l.batch === 'FND-B3' ? 'Lab 2, Hyderabad centre' : '', concepts: l.concepts, status: 'past', recording: l.recording }));
    const L = (title, type, extra = {}) => ({ id: 'LS-' + Math.random().toString(36).slice(2, 8), title, type, concept: !!extra.concept, status: extra.status || 'Published', file: extra.file || null, release: extra.release || null, batchOnly: true, dl: !!extra.dl });
    const f = (name, mb, scan = 'Clean', proc = 'Ready') => ({ name, sizeMB: mb, scan, proc, progress: 100 });
    const courses = [
      { id: 'C-SOC', title: 'SOC Analyst (Blue Team)', track: 'Defensive', level: 'Intermediate', duration: '12 weeks', owner: 'Content Admin', coEditor: 'trainer', batches: ['SOC-B7'], status: 'Published', version: 4, desc: 'Monitor, detect and respond like a real SOC analyst.', outcomes: ['Triage alerts in a SIEM', 'Write detection rules', 'Build an incident timeline'],
        modules: [
          { id: 'M1', title: 'SIEM and logs', lessons: [L('SIEM fundamentals', 'Video', { concept: true, file: f('siem-intro.mp4', 420) }), L('Log sources cheat sheet', 'PDF', { file: f('log-sources.pdf', 3.2), dl: true }), L('Quiz: SIEM basics', 'Quiz')] },
          { id: 'M2', title: 'Detection and triage', lessons: [L('Alert triage', 'Slides', { concept: true, file: f('triage.pptx', 11) }), L('DEF-02 Log Detective', 'Lab'), L('Live: Sigma rules', 'Live Class', { concept: true })] }
        ],
        versions: [{ v: 4, status: 'Published', author: 'Vikram Rao (Trainer)', at: now() - 6 * DAY, summary: 'Added Sigma live class to module 2' }, { v: 3, status: 'Published', author: 'Content Admin', at: now() - 30 * DAY, summary: 'New triage slides' }] },
      { id: 'C-FND', title: 'Cyber Foundations', track: 'Foundations', level: 'Beginner', duration: '8 weeks', owner: 'trainer', coEditor: '', batches: ['FND-B3'], status: 'Published', version: 2, desc: 'Networks, Linux and the security mindset.', outcomes: ['Explain how networks work', 'Use Linux safely'],
        modules: [{ id: 'M1', title: 'Networks', lessons: [L('How networks work', 'Video', { concept: true, file: f('networks.mp4', 610) }), L('Ports and services', 'Document', { concept: true, file: f('ports.docx', 1.4) })] }],
        versions: [{ v: 2, status: 'Published', author: 'Vikram Rao (Trainer)', at: now() - 12 * DAY, summary: 'Linux module reordered' }] },
      { id: 'C-DFIR', title: 'Intro to Digital Forensics', track: 'Defensive', level: 'Intermediate', duration: '4 weeks', owner: 'trainer', coEditor: '', batches: [], status: 'Draft', version: 0, desc: 'Disk and memory forensics for beginners.', outcomes: ['Image a disk', 'Find artefacts'],
        modules: [{ id: 'M1', title: 'Evidence handling', lessons: [L('Chain of custody', 'Video', { status: 'Draft', concept: true, file: f('custody.mp4', 380, 'Clean', 'Processing') }), L('Imaging lab files', 'Document', { status: 'Draft', file: { name: 'imaging-guide.docx', sizeMB: 4.8, scan: 'Scanning', proc: 'Ready', progress: 100 } })] }],
        versions: [] },
      { id: 'C-CLOUD', title: 'Cloud Security Primer', track: 'Defensive', level: 'Beginner', duration: '3 weeks', owner: 'trainer', coEditor: '', batches: ['SOC-B7'], status: 'Unpublished', version: 1, unpublishReason: 'Updating for the new AWS console', desc: 'Shared responsibility and cloud logging.', outcomes: ['Explain shared responsibility'],
        modules: [{ id: 'M1', title: 'Basics', lessons: [L('Shared responsibility', 'Video', { concept: true, file: f('shared.mp4', 300) })] }],
        versions: [{ v: 1, status: 'Unpublished', author: 'Vikram Rao (Trainer)', at: now() - 3 * DAY, summary: 'Unpublished: Updating for the new AWS console' }] },
      { id: 'C-OPS', title: 'Offensive Ops', track: 'Offensive', level: 'Advanced', duration: '12 weeks', owner: 'someone.else', coEditor: '', batches: ['OPS-B2'], status: 'Published', version: 3, desc: '', outcomes: [], modules: [], versions: [] }
    ];
    const qbank = [ // question text only; answer keys stay on the server and are never sent
      ['Q-101', 'SIEM', 'Which Windows event ID records a failed logon?'], ['Q-102', 'SIEM', 'What does normalisation mean in a SIEM?'], ['Q-103', 'Triage', 'List three signs of a phishing email.'],
      ['Q-104', 'Triage', 'Order these alerts by severity.'], ['Q-105', 'Detection', 'Write a Sigma rule for PowerShell download cradles.'], ['Q-106', 'Detection', 'What is a false positive?'],
      ['Q-201', 'Networks', 'Which port does HTTPS use by default?'], ['Q-202', 'Linux', 'What does chmod 640 allow?']
    ].map(([id, topic, text]) => ({ id, topic, text }));
    const sub = (sid, state, score, file) => ({ sid, state, file: file || `${sid}-submission.pdf`, submittedAt: now() - 2 * DAY, rubric: score ? { Accuracy: score, Method: score - 1, Clarity: score } : {}, comment: score ? 'Good structure.' : '', published: state === 'Published' ? { total: score * 3 + 1, at: now() - DAY } : null, history: [] });
    const assessments = [
      { id: 'AS-1', title: 'Quiz 3: Log Analysis', type: 'Quiz', courseId: 'C-SOC', batch: 'SOC-B7', due: at(1, 23, 59), open: at(-3), questions: ['Q-101', 'Q-102'], lesson: 'M1', auto: true, subs: [] , submitted: 6 },
      { id: 'AS-2', title: 'Assignment: Phishing report', type: 'Assignment', courseId: 'C-SOC', batch: 'SOC-B7', due: at(-2, 23, 59), open: at(-9), questions: ['Q-103'], lesson: 'M2', rubric: ['Accuracy', 'Method', 'Clarity'],
        subs: [sub('U-20417', 'Published', 4), sub('U-20418', 'Draft', 3), sub('U-20420'), sub('U-20422'), sub('U-20423', 'Returned', 3)] },
      { id: 'AS-3', title: 'Mid-term exam: Detection', type: 'Exam', courseId: 'C-SOC', batch: 'SOC-B7', due: at(-5, 23, 59), open: at(-6), questions: ['Q-104', 'Q-105', 'Q-106'], lesson: 'M2', rubric: ['Accuracy', 'Method', 'Clarity'],
        subs: [sub('U-20417'), sub('U-20418'), sub('U-20420'), sub('U-20422'), sub('U-20423'), sub('U-20424')] },
      { id: 'AS-4', title: 'Assignment: Network map', type: 'Assignment', courseId: 'C-FND', batch: 'FND-B3', due: at(4, 23, 59), open: at(-1), questions: ['Q-201'], lesson: 'M1', rubric: ['Accuracy', 'Method', 'Clarity'], subs: [sub('U-20431'), sub('U-20434')] },
      { id: 'AS-5', title: 'Draft: Linux permissions quiz', type: 'Quiz', courseId: 'C-FND', batch: 'FND-B3', due: at(8, 23, 59), open: at(6), questions: ['Q-202'], lesson: 'M1', auto: true, state: 'Draft', subs: [] }
    ];
    const missions = ['DEF-01', 'DEF-02', 'DEF-03', 'DEF-04', 'DEF-05'];
    const labs = {};
    students.forEach((s, i) => { labs[s.id] = missions.map((m, k) => {
      const done = k < Math.floor(s.labs / 3), cur = k === Math.floor(s.labs / 3);
      if (done) return { m, state: 'Done', cp: 5, cpTotal: 5, mins: 40 + k * 7, hint: 'L' + (1 + (i + k) % 3), lastCpMin: 0 };
      if (cur && s.lastLabDays < 5) { const stuck = s.name === 'Neha P.' || s.name === 'Arjun K.'; return { m, state: 'In Progress', cp: 2, cpTotal: 5, mins: stuck ? 52 : 18, hint: stuck ? 'L3' : 'L1', lastCpMin: stuck ? 41 : 6 }; }
      return { m, state: 'Not Started', cp: 0, cpTotal: 5, mins: 0, hint: '-', lastCpMin: 0 };
    }); });
    const mentoring = {
      requests: [
        { id: 'MR-1', sid: 'U-20417', type: 'Mock interview', when: at(0, 16, 0), dur: 45, status: 'Accepted', role: 'SOC Analyst L1' },
        { id: 'MR-2', sid: 'U-20419', type: '1-to-1 doubt clearing', when: at(1, 17, 0), dur: 30, status: 'Requested' },
        { id: 'MR-3', sid: 'U-20422', type: 'Career guidance', when: at(2, 15, 30), dur: 30, status: 'Requested' },
        { id: 'MR-4', sid: 'U-20420', type: 'Mock interview', when: at(-1, 16, 0), dur: 45, status: 'Completed', role: 'SOC Analyst L1' },
        { id: 'MR-5', sid: 'U-20434', type: '1-to-1 doubt clearing', when: at(0, 12, 0), dur: 30, status: 'Accepted' }
      ],
      avail: { Mon: ['16:00', '17:00'], Wed: ['15:00', '16:00', '17:00'], Fri: ['16:00'] },
      mocks: [{ id: 'MK-1', sid: 'U-20420', role: 'SOC Analyst L1', scores: { Technical: 4, Communication: 4, 'Problem Solving': 5, Confidence: 4 }, notes: 'Strong triage logic.', state: 'Published', at: now() - DAY }]
    };
    const threads = [
      { id: 'TH-1', sid: 'U-20419', subject: 'Stuck on DEF-02 checkpoint 3', unread: true, msgs: [{ from: 'student', text: 'I keep getting no results in the SIEM search. Can you point me in the right direction?', at: now() - 2 * 36e5 }] },
      { id: 'TH-2', sid: 'U-20417', subject: 'Resume review', unread: true, msgs: [{ from: 'student', text: 'I uploaded my resume, could you look at the projects section?', at: now() - 5 * 36e5 }] },
      { id: 'TH-3', sid: 'U-20432', subject: 'Missed Tuesday class', unread: false, msgs: [{ from: 'student', text: 'I was ill on Tuesday, is the recording up?', at: now() - 26 * 36e5 }, { from: 'trainer', text: 'Yes, it is on the past class card. Watch it and request clearance.', at: now() - 25 * 36e5 }] }
    ];
    const announcements = [{ id: 'AN-1', batch: 'SOC-B7', type: 'Class update', text: 'Bring your lab notes to Thursday\'s class.', channels: ['In-app', 'Email'], at: now() - 3 * DAY, delivered: 8, read: 6 }];
    const latestSOC = lectures.filter(l => l.batch === 'SOC-B7' && l.status === 'held');
    const clearances = [
      { id: 'CR-1', sid: 'U-20419', lectureId: latestSOC[latestSOC.length - 3].id, watch: 86, status: 'Pending', note: 'Was travelling for a family function.' },
      { id: 'CR-2', sid: 'U-20421', lectureId: latestSOC[latestSOC.length - 4].id, watch: 35, status: 'Pending', note: 'Network issue.' },
      { id: 'CR-3', sid: 'U-20433', lectureId: lectures.filter(l => l.batch === 'FND-B3')[4].id, watch: 92, status: 'Pending', note: 'Hospital appointment.' }
    ];
    const feedback = {
      months: [['May', 4.2, 61, 88, 2.4, 3], ['Jun', 4.3, 63, 91, 2.1, 4], ['Jul', 4.1, 62, 85, 2.9, 5], ['Aug', 4.4, 65, 94, 2.2, 4], ['Sep', 4.5, 66, 96, 1.9, 6], ['Oct', 4.4, 64, 92, 2.3, 3]],
      byBatch: { 'SOC-B7': { responses: 7, rating: 4.4 }, 'FND-B3': { responses: 3, rating: 4.7 } },
      comments: [
        { batch: 'SOC-B7', type: 'Module', text: 'The SIEM walkthrough was really clear. More hunting practice please.', rating: 5, month: 'Oct' },
        { batch: 'SOC-B7', type: 'Module', text: 'Classes sometimes overrun by 15 minutes.', rating: 4, month: 'Oct' },
        { batch: 'SOC-B7', type: 'Live class', text: 'Loved the live triage demo.', rating: 5, month: 'Sep' },
        { batch: 'FND-B3', type: 'Module', text: 'Linux part went a bit fast.', rating: 4, month: 'Oct' }
      ]
    };
    return { cfg: CFG, students, batches, lectures, classes, courses, qbank, assessments, missions, labs, mentoring, threads, announcements, clearances, feedback,
      remarks: [{ id: 'RM-1', sid: 'U-20417', kind: 'Remark', text: 'Consistently helps peers in lab sessions.', author: 'Vikram Rao (Trainer)', at: now() - 8 * DAY, history: [] }],
      support: [], audit: [], notifRead: [] };
  }

  let db; try { db = JSON.parse(localStorage.getItem(KEY)); } catch {}
  if (!db || !db.students) { db = seed(); }
  // attendance is Present / Absent only: older Late and Excused marks count as Present
  const tidy = d => { d.lectures.forEach(l => Object.keys(l.marks).forEach(k => { if (l.marks[k] === 'L' || l.marks[k] === 'E') l.marks[k] = 'P'; })); d.leaves = d.leaves || []; catalogTidy(d); return d; };

  /* ---------------- course catalog (one source for the landing page, course pages and the student LMS) ----------------
     Each course carries its public listing fields next to its curriculum. Only fields set here are ever shown:
     an empty value means the page leaves that detail out. Labs listed come from the Yojo training-programme PDF. */
  const CATALOG_FIELDS = {
    'C-FND': { slug: 'cyber-foundations', category: 'Cybersecurity Fundamentals', format: ['Instructor-led', 'Self-paced'], access: 'free', featured: true, prerequisites: 'None', audience: 'Beginners starting in cybersecurity.', overview: 'Networks, Linux and the security mindset. The starting point for every Yojo path.' },
    'C-SOC': { slug: 'soc-analyst', category: 'Defensive Security and SOC', format: ['Instructor-led', 'Lab-based'], access: 'paid', featured: true, certificate: 'Yojo completion certificate', previewLessons: ['SIEM fundamentals'],
      labs: ['Wazuh/Splunk SIEM deployment', 'Real-time alert triage simulation', 'Forensic timeline with Autopsy and Volatility', 'Ransomware IR war room'] },
    'C-OPS': { slug: 'offensive-ops', category: 'Offensive Security and Ethical Hacking', format: ['Instructor-led'], access: 'paid', certificate: 'Yojo completion certificate' },
    'C-DFIR': { slug: 'intro-digital-forensics', category: 'Digital Forensics and Incident Response', format: ['Instructor-led'], access: 'paid' },
    'C-CLOUD': { slug: 'cloud-security-primer', category: 'Cloud Security', format: ['Instructor-led'], access: 'paid',
      labs: ['Exposed S3 bucket discovery', 'AWS GuardDuty and Azure Sentinel monitoring', 'Cloud IAM privilege escalation detection'] }
  };
  // courses on the public "Courses we offer" list that had no record yet; curriculum is added by the course owner
  const CATALOG_NEW = [
    ['C-CEH', 'ceh-v13', 'CEH v13 (Certified Ethical Hacker)', 'Offensive Security and Ethical Hacking', 'Ethical hacking training on the CEH v13 track with hands-on labs.', ['Personal lab setup (VirtualBox/VMware)', 'Nmap port scanning and service detection', 'OWASP exploitation on DVWA and Juice Shop', 'Password auditing with Hashcat and John'], true],
    ['C-VAPT', 'vapt', 'VAPT (Vulnerability Assessment and Penetration Testing)', 'Offensive Security and Ethical Hacking', 'Find, exploit and report vulnerabilities across networks, web apps and APIs.', ['Enterprise network pentest project', 'REST and GraphQL API pentest', 'Active Directory attack and defense (BloodHound)', 'Final VAPT report with CVSS v3.1'], true],
    ['C-IR', 'incident-response', 'Incident Response', 'Digital Forensics and Incident Response', 'Detect, contain and recover from security incidents.', [], false],
    ['C-SIEM', 'siem', 'SIEM', 'Defensive Security and SOC', 'Collect, correlate and act on security logs with a SIEM.', [], false],
    ['C-CISA', 'cisa', 'CISA (Certified Information Systems Auditor)', 'Governance, Risk and Compliance (GRC)', 'Information systems audit, control and assurance.', ['IT audit planning walkthrough', 'Access-control review exercise', 'Risk register and control testing'], false],
    ['C-GRC', 'grc', 'GRC', 'Governance, Risk and Compliance (GRC)', 'Governance, risk management and compliance for security teams.', [], false],
    ['C-CISM', 'cism', 'CISM (Certified Information Security Manager)', 'Governance, Risk and Compliance (GRC)', 'Managing an information security programme.', [], false],
    ['C-NET', 'networking-security-fundamentals', 'Networking and Security Fundamentals', 'Networking', 'How networks work and how to defend them.', ['Command-line network diagnostics', 'Wireshark traffic investigation', 'Subnetting and VLSM lab', 'DNS record analyzer project'], false],
    ['C-CCNA', 'ccna-advanced-networking', 'CCNA / Advanced Networking', 'Networking', 'Routing, switching and enterprise networking.', [], false],
    // Defensive Security and SOC (owner, 30 Oct). The 8th field adds listing details; curriculum is added by the course owner.
    ['C-CTI', 'threat-intelligence', 'Threat Intelligence', 'Defensive Security and SOC',
      'Turn raw threat data into intelligence your SOC can act on: collect from open and commercial feeds, analyse adversary tactics with MITRE ATT&CK, and share indicators that stop attacks early.',
      ['Build a threat feed pipeline with MISP and OpenCTI', 'Enrich IOCs (IPs, domains, hashes) with VirusTotal and AbuseIPDB', 'Map a real campaign to MITRE ATT&CK techniques', 'Write and share a threat intelligence report (TLP)'], false,
      { image: 'assets/courses/threat-intelligence.svg', level: 'Intermediate', duration: '6 weeks', format: ['Instructor-led', 'Lab-based'],
        overview: 'Learn the intelligence lifecycle (direction, collection, processing, analysis, dissemination), the difference between strategic, operational and tactical intel, and how analysts use the Diamond Model, the Cyber Kill Chain and MITRE ATT&CK to track threat actors.',
        audience: 'SOC analysts, incident responders and blue-team learners who want to get ahead of attackers.', prerequisites: 'Networking basics and SOC fundamentals (Yojo SOC Analyst or equivalent).',
        outcomes: ['Run the threat intelligence lifecycle end to end', 'Collect, normalise and score indicators of compromise', 'Profile threat actors and campaigns with MITRE ATT&CK', 'Produce clear intel reports for SOC, IR and leadership'] }],
    ['C-HUNT', 'threat-hunting', 'Threat Hunting', 'Defensive Security and SOC',
      'Go looking for attackers before alerts fire. Form hypotheses, query endpoint and network telemetry, and turn every hunt into a new detection rule.',
      ['Hypothesis-driven hunt in Splunk / Elastic', 'Endpoint hunting with Sysmon and Velociraptor', 'Find lateral movement and persistence in Windows logs', 'Turn a hunt finding into a Sigma detection rule'], false,
      { image: 'assets/courses/threat-hunting.svg', level: 'Advanced', duration: '6 weeks', format: ['Instructor-led', 'Lab-based'],
        overview: 'Proactive defence for experienced analysts: hunting methodology (hypothesis, investigate, uncover, inform), baselining normal behaviour, hunting with ATT&CK techniques, and measuring hunt maturity with the Hunting Maturity Model.',
        audience: 'SOC analysts (L2/L3) and detection engineers ready to move beyond alert triage.', prerequisites: 'SIEM experience and Windows/Linux log analysis (Yojo SIEM or SOC Analyst recommended).',
        outcomes: ['Write testable hunt hypotheses from threat intel', 'Query endpoint and network data to find hidden activity', 'Separate anomalies from normal behaviour with baselines', 'Convert findings into detections and lessons learned'] }],
    ['C-MAL', 'malware-analysis', 'Malware Analysis', 'Defensive Security and SOC',
      'Take malicious files apart safely. Analyse samples statically and in a sandbox, read their behaviour, extract indicators and write YARA rules to catch the next variant.',
      ['Set up an isolated malware analysis lab (FLARE VM, REMnux)', 'Static analysis: strings, PE headers, packers and imports', 'Dynamic analysis with Process Monitor, Wireshark and a sandbox', 'Write YARA rules from a real sample family'], false,
      { image: 'assets/courses/malware-analysis.svg', level: 'Advanced', duration: '8 weeks', format: ['Instructor-led', 'Lab-based'],
        overview: 'From triage to reverse engineering: safe lab handling, file and PE structure, behavioural analysis of ransomware, droppers and infostealers, an introduction to disassembly with Ghidra, and reporting indicators the SOC can block.',
        audience: 'SOC, incident response and DFIR learners who handle suspicious files.', prerequisites: 'Comfort with Windows internals and the command line; basic scripting helps.',
        outcomes: ['Handle live malware safely in an isolated lab', 'Identify a sample’s purpose with static and dynamic analysis', 'Extract IOCs and map behaviour to MITRE ATT&CK', 'Write YARA rules and a clear malware analysis report'] }],
    // Offensive, GRC, Cyber Forensics and Communication Skills (owner, 30 Oct)
    ["C-WAPT", "wapt", "WAPT (Web Application Penetration Testing)", "Offensive Security and Ethical Hacking", "Attack web applications the way real testers do: map the app, find OWASP Top 10 flaws, exploit them safely and write a report developers can fix from.", ["Recon and mapping with Burp Suite", "SQL injection and XSS on deliberately vulnerable apps", "Broken access control and IDOR hunting", "Authentication and session attacks", "Professional WAPT report with CVSS scores"], false, {"level": "Intermediate", "duration": "8 weeks", "overview": "A full web pentest methodology based on the OWASP Web Security Testing Guide: information gathering, configuration and identity testing, authentication, authorisation, session management, input validation, business logic and client-side testing.", "audience": "Learners moving into application security or bug bounty.", "prerequisites": "HTTP basics and Linux command line (Yojo Cyber Foundations or equivalent).", "outcomes": ["Test a web app end to end with the OWASP WSTG", "Find and safely exploit OWASP Top 10 vulnerabilities", "Use Burp Suite like a professional tester", "Write findings with impact, CVSS and fixes"], "format": ["Instructor-led", "Lab-based"], "image": "assets/courses/wapt.svg"}],
    ["C-MAPT", "mapt", "MAPT (Mobile Application Penetration Testing)", "Offensive Security and Ethical Hacking", "Test Android and iOS apps for insecure storage, weak crypto, broken authentication and leaky APIs, following the OWASP Mobile Application Security standard.", ["Android lab setup with an emulator, ADB and Burp", "Decompile and review an APK with JADX and MobSF", "Bypass SSL pinning and root detection with Frida", "Find insecure local storage and hard-coded secrets", "Intercept and attack the app’s backend API"], false, {"level": "Advanced", "duration": "8 weeks", "overview": "Static and dynamic mobile testing against the OWASP MASVS and MASTG: app architecture, data storage, cryptography, authentication, network communication, platform interaction, code quality and resilience.", "audience": "Pentesters and developers who test or build mobile apps.", "prerequisites": "Web application testing basics (WAPT recommended).", "outcomes": ["Set up an Android and iOS testing lab", "Analyse apps statically and at runtime", "Test against OWASP MASVS controls", "Report mobile findings with clear fixes"], "format": ["Instructor-led", "Lab-based"], "image": "assets/courses/mapt.svg"}],
    ["C-API", "api-testing", "API Security Testing", "Offensive Security and Ethical Hacking", "Break and secure REST and GraphQL APIs: find broken object level authorisation, weak authentication, excessive data exposure and missing rate limits.", ["Map an API from its OpenAPI spec and traffic", "BOLA / IDOR testing with Postman and Burp", "JWT and OAuth token attacks", "GraphQL introspection and query abuse", "Rate-limit and mass-assignment testing"], false, {"level": "Intermediate", "duration": "6 weeks", "overview": "API testing built on the OWASP API Security Top 10 (2023): object and function level authorisation, authentication, property-level exposure, resource consumption, SSRF, misconfiguration and inventory management.", "audience": "Pentesters, QA engineers and backend developers.", "prerequisites": "HTTP and JSON basics; web testing experience helps.", "outcomes": ["Discover and document undocumented endpoints", "Test every OWASP API Top 10 risk", "Attack and harden token-based authentication", "Automate API security checks in a pipeline"], "format": ["Instructor-led", "Lab-based"], "image": "assets/courses/api-testing.svg"}],
    ["C-SCR", "source-code-review", "Secure Source Code Review", "Offensive Security and Ethical Hacking", "Find vulnerabilities by reading code: trace untrusted input to dangerous functions, combine manual review with SAST tools and explain fixes to developers.", ["Manual review of a vulnerable Java / Python app", "Taint tracing from input to sink", "SAST scanning with Semgrep and SonarQube", "Triage false positives and rate severity", "Secure code review report with fix examples"], false, {"level": "Advanced", "duration": "6 weeks", "overview": "A secure code review method aligned with the OWASP Code Review Guide and ASVS: threat-led review planning, input handling, authentication and session code, cryptography, error handling, secrets in code and supply-chain risk.", "audience": "Pentesters, AppSec engineers and developers.", "prerequisites": "Reading code in at least one language (Java, Python, JavaScript or PHP).", "outcomes": ["Plan a risk-based code review", "Spot injection, auth and crypto flaws in code", "Use SAST tools without drowning in noise", "Write fixes developers can apply"], "format": ["Instructor-led", "Lab-based"], "image": "assets/courses/source-code-review.svg"}],
    ["C-ISO", "iso-standards", "ISO Standards: ISO 27001, ISO 31000:2018, ISO 22301", "Governance, Risk and Compliance (GRC)", "Three standards in one track: build an information security management system (ISO 27001), manage risk the ISO way (ISO 31000:2018) and keep the business running through disruption (ISO 22301).", ["Define ISMS scope and write a Statement of Applicability", "Risk assessment and treatment plan to ISO 31000", "Business impact analysis and continuity plan (ISO 22301)", "Internal audit checklist and mock certification audit"], false, {"level": "Intermediate", "duration": "8 weeks", "overview": "ISO/IEC 27001:2022 clauses 4-10 and Annex A controls; ISO 31000:2018 principles, framework and risk process; ISO 22301:2019 business continuity management. Includes how certification audits work and how the three standards fit together.", "audience": "GRC analysts, auditors, IT managers and anyone preparing an organisation for certification.", "prerequisites": "Basic IT and security awareness.", "outcomes": ["Plan and document an ISO 27001 ISMS", "Run risk assessments using ISO 31000", "Build a business continuity plan to ISO 22301", "Prepare evidence for a certification audit"], "format": ["Instructor-led", "Lab-based"], "image": "assets/courses/iso-standards.svg"}],
    ["C-TPRM", "tprm", "TPRM (Third-Party Risk Management)", "Governance, Risk and Compliance (GRC)", "Control the risk that vendors and partners bring: tier suppliers, run security assessments, review evidence and monitor them through the contract lifecycle.", ["Build a vendor inventory and risk-tiering model", "Run a security questionnaire (SIG Lite / CAIQ style)", "Review a SOC 2 report and ISO certificate", "Write contract security clauses and an exit plan"], false, {"level": "Intermediate", "duration": "5 weeks", "overview": "The third-party lifecycle: planning and due diligence, inherent and residual risk, assessment methods, contract controls, continuous monitoring, fourth-party risk and offboarding, mapped to ISO 27001 and NIST supplier controls.", "audience": "GRC, procurement and security teams that manage vendors.", "prerequisites": "Basic risk management concepts.", "outcomes": ["Tier vendors by inherent risk", "Assess and score supplier security", "Read assurance reports critically", "Monitor vendors and handle offboarding"], "format": ["Instructor-led", "Lab-based"], "image": "assets/courses/tprm.svg"}],
    ["C-RISK", "risk-management", "Cyber Risk Management", "Governance, Risk and Compliance (GRC)", "Identify, assess and treat cyber risk in business language: build a risk register, score likelihood and impact, and report risk that leaders can act on.", ["Build a risk register for a sample company", "Qualitative and quantitative (FAIR-style) risk scoring", "Risk heat map and treatment plan", "Board-ready risk report"], false, {"level": "Beginner", "duration": "5 weeks", "overview": "Risk concepts (asset, threat, vulnerability, likelihood, impact), risk appetite and tolerance, assessment methods from ISO 31000, NIST SP 800-30 and FAIR, risk treatment options and key risk indicators.", "audience": "Anyone starting in GRC, and technical staff who report risk to management.", "prerequisites": "None.", "outcomes": ["Run a structured risk assessment", "Score risk consistently", "Choose and track risk treatments", "Communicate risk to leadership"], "format": ["Instructor-led", "Lab-based"], "image": "assets/courses/risk-management.svg"}],
    ["C-HIPAA", "hipaa", "HIPAA Compliance", "Governance, Risk and Compliance (GRC)", "Protect health information under the US HIPAA Privacy, Security and Breach Notification Rules, from PHI mapping to safeguards and breach response.", ["Map where PHI lives and flows", "HIPAA security risk analysis", "Administrative, physical and technical safeguards checklist", "Breach notification scenario walk-through"], false, {"level": "Intermediate", "duration": "4 weeks", "overview": "Covered entities and business associates, the Privacy Rule, the Security Rule safeguards, Business Associate Agreements, the Breach Notification Rule and how HIPAA audits and penalties work.", "audience": "GRC and security staff working with healthcare clients.", "prerequisites": "Basic security concepts.", "outcomes": ["Identify PHI and who must protect it", "Run a HIPAA security risk analysis", "Map safeguards to the Security Rule", "Handle a breach under the notification rule"], "format": ["Instructor-led", "Lab-based"], "image": "assets/courses/hipaa.svg"}],
    ["C-HITRUST", "hitrust", "HITRUST CSF", "Governance, Risk and Compliance (GRC)", "Prepare an organisation for HITRUST certification: understand the CSF, choose the right assessment (e1, i1, r2), map controls and collect evidence.", ["Scope an assessment and pick e1, i1 or r2", "Map existing controls to the HITRUST CSF", "Maturity scoring of policies, procedures and implementation", "Evidence collection and readiness gap report"], false, {"level": "Advanced", "duration": "5 weeks", "overview": "The HITRUST CSF structure, how it harmonises HIPAA, ISO 27001, NIST and PCI DSS, assessment types, the maturity model, the MyCSF workflow and the path from readiness to validated assessment.", "audience": "GRC professionals in healthcare and health-tech.", "prerequisites": "HIPAA or ISO 27001 knowledge recommended.", "outcomes": ["Choose the right HITRUST assessment", "Map controls across frameworks", "Score control maturity", "Build a readiness plan"], "format": ["Instructor-led", "Lab-based"], "image": "assets/courses/hitrust.svg"}],
    ["C-PCI", "pci-dss", "PCI DSS v4.0", "Governance, Risk and Compliance (GRC)", "Secure cardholder data and pass PCI DSS v4.0: scope the environment, apply the 12 requirements and prepare a Report on Compliance or SAQ.", ["Scope a cardholder data environment and segmentation", "Gap assessment against the 12 requirements", "Choose the right SAQ for a merchant", "Evidence pack for a QSA assessment"], false, {"level": "Intermediate", "duration": "5 weeks", "overview": "PCI DSS v4.0 goals and 12 requirements, scoping and segmentation, compensating and customised controls, merchant and service-provider levels, SAQs versus RoC, and the role of QSAs and ASVs.", "audience": "GRC, security and payments teams.", "prerequisites": "Basic networking and security concepts.", "outcomes": ["Scope the cardholder data environment", "Assess all 12 PCI DSS requirements", "Pick the right validation path", "Prepare evidence for assessors"], "format": ["Instructor-led", "Lab-based"], "image": "assets/courses/pci-dss.svg"}],
    ["C-NIST", "nist-framework", "NIST Cybersecurity Framework", "Governance, Risk and Compliance (GRC)", "Use NIST CSF 2.0 and SP 800-53 to measure and improve a security programme: build current and target profiles and plan the gaps.", ["Current and target profile for a sample company", "Map controls to NIST SP 800-53", "Implementation tier assessment", "Prioritised improvement roadmap"], false, {"level": "Intermediate", "duration": "5 weeks", "overview": "NIST CSF 2.0 functions (Govern, Identify, Protect, Detect, Respond, Recover), categories, profiles and tiers; SP 800-53 control families; and how NIST maps to ISO 27001 and other frameworks.", "audience": "GRC analysts, security managers and consultants.", "prerequisites": "Basic security concepts.", "outcomes": ["Explain the six CSF 2.0 functions", "Build current and target profiles", "Map controls to SP 800-53", "Turn gaps into a roadmap"], "format": ["Instructor-led", "Lab-based"], "image": "assets/courses/nist-framework.svg"}],
    ["C-GDPR", "gdpr", "GDPR (EU Data Protection)", "Governance, Risk and Compliance (GRC)", "Handle personal data lawfully under the EU GDPR: lawful bases, data subject rights, records of processing, DPIAs, transfers and breach notification.", ["Data mapping and record of processing activities", "Data protection impact assessment (DPIA)", "Data subject access request walk-through", "72-hour breach notification exercise"], false, {"level": "Intermediate", "duration": "4 weeks", "overview": "GDPR principles, lawful bases, consent, rights of individuals, controller and processor duties, DPOs, privacy by design, international transfers, breach notification and enforcement.", "audience": "Privacy, GRC and security professionals working with EU data.", "prerequisites": "None.", "outcomes": ["Apply GDPR principles and lawful bases", "Run a DPIA", "Handle data subject requests", "Respond to a personal data breach"], "format": ["Instructor-led", "Lab-based"], "image": "assets/courses/gdpr.svg"}],
    ["C-DPDP", "dpdp-act", "DPDP Act 2023 (India)", "Governance, Risk and Compliance (GRC)", "Comply with India’s Digital Personal Data Protection Act, 2023: consent and notices, duties of data fiduciaries, rights of data principals and breach reporting.", ["Consent notice and consent manager flow", "Personal data inventory for an Indian company", "Data principal rights and grievance handling", "Breach reporting to the Data Protection Board"], false, {"level": "Beginner", "duration": "3 weeks", "overview": "Scope of the DPDP Act 2023, lawful processing and legitimate uses, notices and consent, children’s data, Significant Data Fiduciaries, rights and duties of data principals, cross-border transfer, the Data Protection Board and penalties, compared with GDPR.", "audience": "Anyone handling personal data of people in India.", "prerequisites": "None.", "outcomes": ["Explain who the Act applies to", "Design valid notices and consent", "Handle data principal requests", "Prepare for breach reporting"], "format": ["Instructor-led", "Lab-based"], "image": "assets/courses/dpdp-act.svg"}],
    ["C-EFI", "email-fraud-investigation", "Email Fraud Investigation", "Cyber Forensics", "Investigate phishing and business email compromise: read email headers, check SPF, DKIM and DMARC, trace the sender and preserve evidence that holds up.", ["Email header analysis and hop tracing", "SPF, DKIM and DMARC verification", "BEC case: trace the fraudulent payment request", "Phishing kit and malicious link analysis", "Evidence preservation and investigation report"], false, {"level": "Intermediate", "duration": "4 weeks", "overview": "How email works (SMTP, MX, headers), spoofing and look-alike domains, BEC and invoice fraud patterns, authentication records, link and attachment analysis, mailbox forensics, and reporting to banks and cyber-crime cells.", "audience": "SOC analysts, fraud investigators and IT teams.", "prerequisites": "Basic networking and email concepts.", "outcomes": ["Read and interpret full email headers", "Prove whether an email was spoofed", "Reconstruct a BEC fraud timeline", "Preserve and report email evidence"], "format": ["Instructor-led", "Lab-based"], "image": "assets/courses/email-fraud-investigation.svg"}],
    ["C-CFOR", "computer-forensics", "Computer Forensics", "Cyber Forensics", "Acquire, analyse and report on evidence from Windows and Linux computers with a sound chain of custody, from disk images to memory and timelines.", ["Forensic disk imaging and hash verification (FTK Imager)", "Windows artifact analysis with Autopsy", "Memory forensics with Volatility", "Super-timeline of a security incident", "Court-ready forensic report"], false, {"level": "Intermediate", "duration": "8 weeks", "overview": "Forensic process and chain of custody, file systems (NTFS, ext4), Windows artifacts (registry, event logs, prefetch, browser history), deleted file recovery, memory analysis, timeline building and expert reporting.", "audience": "Incident responders, investigators and SOC analysts.", "prerequisites": "Windows and Linux basics.", "outcomes": ["Acquire evidence without altering it", "Recover and interpret system artifacts", "Analyse memory images", "Write a defensible forensic report"], "format": ["Instructor-led", "Lab-based"], "image": "assets/courses/computer-forensics.svg"}],
    ["C-MFOR", "mobile-forensics", "Mobile Forensics", "Cyber Forensics", "Extract and analyse evidence from Android and iOS devices: messages, call logs, locations and app data, with the right acquisition method for each case.", ["Logical and file-system extraction from Android", "iOS backup analysis", "Chat and app data recovery (WhatsApp, Telegram)", "Location history and timeline reconstruction", "Mobile forensic case report"], false, {"level": "Advanced", "duration": "6 weeks", "overview": "Mobile device storage and security, acquisition types (logical, file system, physical), handling locked devices, SQLite and app artifacts, cloud evidence, and legal considerations, using open tools such as ALEAPP and iLEAPP.", "audience": "Investigators, DFIR analysts and law-enforcement support teams.", "prerequisites": "Computer forensics basics recommended.", "outcomes": ["Pick the right acquisition method", "Extract and parse app artifacts", "Rebuild a device timeline", "Report mobile evidence clearly"], "format": ["Instructor-led", "Lab-based"], "image": "assets/courses/mobile-forensics.svg"}],
    ["C-COMM", "communication-skills", "Communication Skills and Interview Preparation", "Communication Skills", "Get interview-ready for cyber security roles: answer HR and technical questions with confidence, walk through your resume and projects, and practise in mock interviews.", ["Resume and LinkedIn walk-through with feedback", "HR interview practice: tell me about yourself, strengths, salary", "Technical interview drills (SOC, VAPT, GRC questions)", "STAR-method answers to scenario questions", "Group discussion and recorded mock interview"], false, {"level": "Beginner", "duration": "4 weeks", "format": ["Instructor-led", "Self-paced"], "overview": "Professional communication for security careers: clear speaking and writing, explaining technical findings to non-technical people, email and report etiquette, body language, handling pressure questions, group discussions and the full interview cycle from application to offer.", "audience": "Students and job seekers preparing for cyber security interviews.", "prerequisites": "None.", "outcomes": ["Introduce yourself and your projects confidently", "Answer HR and technical questions with the STAR method", "Explain security issues to non-technical people", "Perform well in mock interviews and group discussions"], "image": "assets/courses/communication-skills.svg"}]
  ];
  function catalogTidy(d) {
    const T = now();
    const ak = d.students.find(x => x.id === 'U-20418'); if (ak && !ak.loginEmail) ak.loginEmail = 'arjun.k@students.yojo.demo'; // demo paid student, linked to batch SOC-B7
    CATALOG_NEW.forEach(([id, slug, title, category, desc, labs, featured, extra], i) => { if (d.courses.some(c => c.id === id)) return;
      d.courses.push({ id, title, track: category, level: '', duration: '', owner: 'Content Admin', coEditor: 'trainer', batches: [], status: 'Published', version: 1, desc, outcomes: [], modules: [], versions: [{ v: 1, status: 'Published', author: 'Content Admin', at: T - (40 - i) * DAY, summary: 'Listed in the catalog' }],
        slug, category, format: ['Instructor-led'], access: 'paid', featured, labs, certificate: 'Yojo completion certificate', addedAt: T - (40 - i) * DAY, faqs: [], ...(extra || {}) }); });
    d.courses.forEach(c => { if (c.id === 'C-VAPT' && c.category === 'Security Testing') { c.category = 'Offensive Security and Ethical Hacking'; c.track = c.category; } });
    if (!d.courses.some(c => c.id === 'C-CTF')) d.courses.push({ id: 'C-CTF', title: 'CTF Starter: Warm-up Flags', track: 'CTF', level: 'Beginner', duration: '', owner: 'Content Admin', coEditor: 'trainer', batches: [], status: 'Published', version: 1,
      desc: 'Four warm-up Capture the Flag challenges you can solve in the browser.', outcomes: ['Decode Base64 and hex data', 'Recognise ROT13', 'Read HTTP response headers'],
      modules: [{ id: 'M1', title: 'Warm-up flags', lessons: [['Crypto-100: Not encryption'], ['Forensics-100: Hex dump'], ['OSINT-100: Thirteen steps'], ['Web-100: Check the headers']].map(([t], k) => ({ id: 'LS-ctf' + k, title: t, type: 'Lab', concept: false, status: 'Published', file: null, url: 'index.html#ctf', release: null, batchOnly: false, dl: false })) }],
      versions: [{ v: 1, status: 'Published', author: 'Content Admin', at: T - 5 * DAY, summary: 'Listed in the catalog' }],
      slug: 'ctf-starter', category: 'Capture the Flag (CTF)', format: ['Lab-based', 'Self-paced'], access: 'free', featured: false, labs: [], certificate: '', prerequisites: 'None', audience: 'Anyone curious about CTFs.', addedAt: T - 5 * DAY, faqs: [] });
    const IMG = { 'C-FND': 'cyber-foundations', 'C-SOC': 'soc-analyst', 'C-OPS': 'offensive-ops', 'C-CEH': 'ceh-v13', 'C-VAPT': 'vapt', 'C-IR': 'incident-response', 'C-SIEM': 'siem', 'C-CISM': 'cism', 'C-GRC': 'grc', 'C-CTF': 'ctf-starter', 'C-CISA': 'cisa', 'C-CCNA': 'ccna', 'C-NET': 'networking' }; // course banners in assets/courses
    d.courses.forEach(c => { if (!c.image && IMG[c.id]) c.image = 'assets/courses/' + IMG[c.id] + '.jpg'; });
    d.courses.forEach(c => { const f = CATALOG_FIELDS[c.id];
      if (f && !c.slug) { Object.assign(c, { labs: [], certificate: '', faqs: [], featured: false, ...f }); if (f.previewLessons) c.modules.forEach(m => m.lessons.forEach(l => { if (f.previewLessons.includes(l.title)) l.preview = true; })); delete c.previewLessons; }
      if (!c.slug) c.slug = String(c.title || c.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!c.category) c.category = c.track || 'Cybersecurity Fundamentals';
      if (!c.access) c.access = 'paid'; c.format = c.format || []; c.labs = c.labs || []; c.faqs = c.faqs || [];
      if (!c.addedAt) c.addedAt = ((c.versions || []).slice(-1)[0] || {}).at || T - 60 * DAY; });
  }
  tidy(db);
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  save();

  /* ---------------- simulated server ---------------- */
  let me = null; // the signed-in trainer from the demo session
  const deny = m => { const e = new Error(m); e.code = 403; throw e; };
  const lag = v => new Promise((r, j) => setTimeout(() => { try { reload(); r(typeof v === 'function' ? v() : v); } catch (e) { j(e); } }, 120 + Math.random() * 160));
  const clone = o => JSON.parse(JSON.stringify(o));
  const myBatchIds = () => me ? me.batches : [];
  const ownBatch = b => myBatchIds().includes(b) || deny('This batch is not assigned to you.');
  const studentOk = sid => { const s = db.students.find(x => x.id === sid); if (!s) deny('Student not found.'); ownBatch(s.batch); return s; };
  const audit = (action, target, detail = '') => { db.audit.unshift({ at: now(), who: me.email, action, target, detail }); save(); };
  const PUBLIC = ['id', 'name', 'batch', 'path', 'rank', 'labs', 'quiz', 'xp', 'lastLabDays', 'missed', 'lastActive', 'resume', 'mocks', 'portfolio', 'internship'];
  const strip = s => { const o = {}; PUBLIC.forEach(k => o[k] = s[k]); return o; }; // guardian, phone, email, fees never leave the server

  function attendanceOf(sid, batch) {
    const ls = db.lectures.filter(l => l.batch === batch && l.status === 'held' && l.marks[sid]);
    const held = ls.length, cnt = c => ls.filter(l => l.marks[sid] === c).length;
    const attended = cnt('P') + cnt('L') + cnt('E');
    return { held, P: cnt('P'), A: cnt('A'), L: cnt('L'), E: cnt('E'), attended, pct: held ? Math.round(attended / held * 100) : 100 };
  }
  function enrich(s) {
    const att = attendanceOf(s.id, s.batch);
    const labsPct = Math.round(s.labs / 15 * 100);
    const pi = Math.round(att.pct * .2 + labsPct * .3 + s.quiz * .35 + s.xp * .15);
    const flags = [];
    if (att.pct < db.cfg.attendanceMin) flags.push({ code: 'LOW', text: `Attendance ${att.pct}% (below ${db.cfg.attendanceMin}%)` });
    if (pi < 40) flags.push({ code: 'AT RISK', text: `Performance Index ${pi} (below 40)` });
    else if (pi < 60) flags.push({ code: 'WATCH', text: `Performance Index ${pi} (40 to 59)` });
    if (s.lastLabDays >= db.cfg.noLabDays) flags.push({ code: 'NO LAB', text: `No lab activity for ${s.lastLabDays} days` });
    if (s.missed >= db.cfg.missedAssessFlag) flags.push({ code: 'MISSED', text: `${s.missed} assessments missed` });
    const flag = flags.find(f => f.code === 'AT RISK') ? 'AT RISK' : flags.find(f => f.code === 'LOW') ? 'LOW' : flags.length ? 'WATCH' : 'OK';
    return { ...strip(s), att, labsPct, pi, comp: { Attendance: att.pct, Labs: labsPct, 'Courses + Assessments': s.quiz, 'Leaderboard + XP': s.xp }, flags, flag };
  }
  const myStudents = () => db.students.filter(s => myBatchIds().includes(s.batch)).map(enrich);
  const courseVisible = c => c.owner === 'trainer' || c.coEditor === 'trainer' || c.batches.some(b => myBatchIds().includes(b));
  const name = sid => (db.students.find(s => s.id === sid) || {}).name || sid;

  function notifications() {
    const n = [];
    myStudents().filter(s => s.att.pct < db.cfg.attendanceMin).forEach(s => n.push({ id: 'att-' + s.id, kind: 'red', text: `${s.name}: attendance ${s.att.pct}% is below ${db.cfg.attendanceMin}%`, href: `#/trainer/students/${s.id}` }));
    db.threads.filter(t => t.unread && myBatchIds().includes((db.students.find(s => s.id === t.sid) || {}).batch)).forEach(t => n.push({ id: 'msg-' + t.id, kind: 'blue', text: `New message from ${name(t.sid)}: ${t.subject}`, href: '#/trainer/messages' }));
    db.clearances.filter(c => c.status === 'Pending' && myBatchIds().includes((db.students.find(s => s.id === c.sid) || {}).batch)).forEach(c => n.push({ id: 'clr-' + c.id, kind: 'amber', text: `Absence clearance request from ${name(c.sid)}`, href: '#/trainer/attendance' }));
    db.leaves.filter(v => v.status === 'Pending' && myBatchIds().includes((db.students.find(s => s.id === v.sid) || {}).batch)).forEach(v => n.push({ id: 'lv-' + v.id, kind: 'amber', text: `Leave request from ${name(v.sid)}: ${v.days} day${v.days === 1 ? '' : 's'} from ${new Date(v.from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`, href: '#/trainer/attendance#leave' }));
    db.assessments.filter(a => myBatchIds().includes(a.batch) && !a.auto && a.subs.some(s => s.state !== 'Published')).forEach(a => { const dueIn = (a.due - now()) / DAY; if (dueIn <= 2) n.push({ id: 'grd-' + a.id, kind: dueIn < -db.cfg.gradingTurnaroundDays ? 'red' : 'amber', text: `${a.title}: grading ${dueIn < 0 ? 'overdue' : 'due soon'}`, href: '#/trainer/assessments' }); });
    db.classes.filter(c => myBatchIds().includes(c.batch) && c.status === 'upcoming' && c.mode === 'Online' && !c.link && c.start - now() < 2 * DAY).forEach(c => n.push({ id: 'lnk-' + c.id, kind: 'amber', text: `${c.topic} (${c.batch}) has no join link yet`, href: '#/trainer/classes' }));
    return n.map(x => ({ ...x, read: db.notifRead.includes(x.id) }));
  }

  const API = {
    cfg: () => clone(db.cfg),
    setSession(u) { me = u; },
    me: () => me,
    reset() { db = seed(); save(); },
    notifications: () => lag(notifications),
    markNotifsRead: () => lag(() => { db.notifRead = notifications().map(n => n.id); save(); }),
    batches: () => lag(() => db.batches.filter(b => myBatchIds().includes(b.id)).map(b => {
      const ss = myStudents().filter(s => s.batch === b.id), avg = k => ss.length ? Math.round(ss.reduce((a, s) => a + k(s), 0) / ss.length) : 0;
      return { ...b, students: ss.length, attAvg: avg(s => s.att.pct), piAvg: avg(s => s.pi), flagged: ss.filter(s => s.flag !== 'OK').length };
    })),
    students: (batch) => lag(() => { if (batch) ownBatch(batch); return myStudents().filter(s => !batch || s.batch === batch); }),
    student: sid => lag(() => {
      const s = studentOk(sid); audit('view student record', sid);
      const e = enrich(s);
      const lects = db.lectures.filter(l => l.batch === s.batch).map(l => ({ id: l.id, n: l.n, topic: l.topic, start: l.start, status: l.status, mark: l.marks[sid] || null }));
      const asm = db.assessments.filter(a => a.batch === s.batch).map(a => { const su = a.subs.find(x => x.sid === sid); return { id: a.id, title: a.title, type: a.type, due: a.due, state: a.auto ? (a.state === 'Draft' ? 'Not open' : 'Auto-graded') : su ? su.state || 'Submitted' : a.due < now() ? 'Missed' : 'Pending', score: su && su.published ? su.published.total : null }; });
      const remarks = db.remarks.filter(r => r.sid === sid && (r.kind === 'Remark' || r.author === me.name));
      return { ...e, lectures: lects, labRuns: clone(db.labs[sid] || []), assessments: asm, remarks: clone(remarks), activity: [
        { at: s.lastActive, text: 'Last active on the platform' }, { at: now() - s.lastLabDays * DAY, text: 'Last lab activity' }] };
    }),
    addRemark: (sid, kind, text, editId) => lag(() => {
      studentOk(sid); if (!text.trim()) throw new Error('Write the remark first.');
      if (editId) { const r = db.remarks.find(x => x.id === editId && x.author === me.name); if (!r) deny('You can only edit your own entries.'); r.history.push({ text: r.text, at: r.at }); r.text = text; r.at = now(); audit('edit ' + kind.toLowerCase(), sid); }
      else { db.remarks.push({ id: 'RM-' + now(), sid, kind, text, author: me.name, at: now(), history: [] }); audit('add ' + kind.toLowerCase(), sid); }
      save();
    }),
    escalate: (sid, reason) => lag(() => { studentOk(sid); db.support.push({ at: now(), sid, kind: 'Escalation', reason, to: 'Student Mgmt admin' }); audit('escalate student', sid, reason); save(); }),
    askGuardian: (sid, reason) => lag(() => { studentOk(sid); if (!reason.trim()) throw new Error('Give a reason for the admin.'); db.support.push({ at: now(), sid, kind: 'Contact guardian', reason, to: 'Support admin' }); audit('ask admin to contact guardian', sid, reason); save(); }),
    exportCsv: batch => lag(() => {
      ownBatch(batch); audit('export progress CSV', batch);
      const rows = [['Student ID', 'Name', 'Batch', 'Attended', 'Attendance %', 'Performance Index', 'Labs', 'Quiz avg', 'Flag']];
      myStudents().filter(s => s.batch === batch).forEach(s => rows.push([s.id, s.name, s.batch, `${s.att.attended}/${s.att.held}`, s.att.pct, s.pi, `${s.labs} of 15`, s.quiz, s.flag]));
      return rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    }),
    /* classes */
    classes: () => lag(() => clone(db.classes.filter(c => myBatchIds().includes(c.batch))).map(c => ({ ...c, hasLink: !!c.link, link: undefined }))),
    joinLink: id => lag(() => { const c = db.classes.find(x => x.id === id); ownBatch(c.batch); audit('open join link', id); return c.link; }),
    saveClass: (c, draft) => lag(() => {
      ownBatch(c.batch); if (!draft) { if (!c.topic || !c.start) throw new Error('Topic, date and time are required.'); if (c.mode === 'Direct' && !c.room) throw new Error('Add the room for a Direct class.'); }
      const hol = db.classes.find(x => x.status === 'holiday' && x.batch === c.batch && new Date(x.start).toDateString() === new Date(c.start).toDateString());
      if (hol && !draft) throw new Error('That day is a holiday for this batch. Pick another date.');
      const ex = c.id && db.classes.find(x => x.id === c.id);
      const rec = { ...c, id: c.id || 'CL-' + now(), status: draft ? 'draft' : 'upcoming', reminders: draft ? [] : ['1 day before', '1 hour before'] };
      if (ex && !c.link) rec.link = ex.link;
      if (ex) Object.assign(ex, rec); else db.classes.push(rec);
      audit(draft ? 'save class draft' : 'schedule class', rec.id, c.topic); save(); return rec.id;
    }),
    setClassLink: (id, link) => lag(() => { const c = db.classes.find(x => x.id === id); ownBatch(c.batch); c.link = link; audit('set join link', id); save(); }),
    cancelClass: (id, reason) => lag(() => { const c = db.classes.find(x => x.id === id); ownBatch(c.batch); if (!reason.trim()) throw new Error('A reason is required.'); c.status = 'cancelled'; c.reason = reason; audit('cancel class', id, reason); save(); }),
    /* attendance */
    lectures: batch => lag(() => { ownBatch(batch); return clone(db.lectures.filter(l => l.batch === batch)); }),
    saveAttendance: (lid, marks, concepts, mfa) => lag(() => {
      const l = db.lectures.find(x => x.id === lid); ownBatch(l.batch);
      if (l.status !== 'held') throw new Error('Holidays and cancelled lectures cannot be marked.');
      if (l.locked) deny('This lecture is locked. Ask the Student Mgmt admin to change it, with a reason.');
      const age = (now() - l.start) / 36e5;
      if (age > db.cfg.editWindowH && l.markedAt) deny(`The ${db.cfg.editWindowH}-hour edit window has passed. Send the change to Student Mgmt with a reason.`);
      if (age > 24 && l.markedAt && !mfa) { const e = new Error('Re-enter your authenticator code to edit attendance after 24 hours.'); e.code = 'MFA'; throw e; }
      Object.entries(marks).forEach(([sid, v]) => { const old = l.marks[sid]; if (old !== v) { db.attendanceEdits = db.attendanceEdits || []; db.attendanceEdits.push({ lid, sid, old: old || '-', new: v, who: me.email, at: now(), reason: old ? 'Trainer correction' : 'First marking' }); } l.marks[sid] = v; });
      l.conceptsCovered = concepts; l.markedAt = l.markedAt || now(); audit('save attendance', lid); save();
    }),
    lockLecture: (lid, code) => lag(() => { const l = db.lectures.find(x => x.id === lid); ownBatch(l.batch); if (!window.TrainerMFA.ok(code)) { const e = new Error('That authenticator code is not right.'); e.code = 'MFA'; throw e; } if (!l.markedAt) throw new Error('Save attendance before locking.'); l.locked = true; audit('lock lecture (MFA)', lid); save(); }),
    attendanceEdits: lid => lag(() => clone((db.attendanceEdits || []).filter(e => e.lid === lid))),
    clearances: () => lag(() => db.clearances.filter(c => myBatchIds().includes((db.students.find(s => s.id === c.sid) || {}).batch)).map(c => { const l = db.lectures.find(x => x.id === c.lectureId); return { ...clone(c), name: name(c.sid), lecture: l.topic, concepts: l.concepts, date: l.start, batch: l.batch, minWatch: db.cfg.clearanceWatchPct }; })),
    leaves: () => lag(() => db.leaves.filter(v => myBatchIds().includes((db.students.find(s => s.id === v.sid) || {}).batch)).map(v => ({ ...clone(v), name: name(v.sid), batch: db.students.find(s => s.id === v.sid).batch })).sort((a, b) => b.at - a.at)),
    decideLeave: (id, decision, reason = '') => lag(() => {
      const v = db.leaves.find(x => x.id === id); if (!v) throw new Error('Leave request not found.'); studentOk(v.sid);
      if (decision === 'Rejected' && !reason.trim()) throw new Error('Give the student a reason.');
      v.status = decision; v.reasonT = reason; v.decidedAt = now();
      notify(v.sid, decision === 'Approved' ? 'Leave approved' : 'Leave not approved', `${v.days} day${v.days === 1 ? '' : 's'} from ${new Date(v.from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}${reason ? ': ' + reason : ''}`);
      audit('leave ' + decision.toLowerCase(), v.sid, reason); save();
    }),
    decideClearance: (id, decision, reason) => lag(() => {
      const c = db.clearances.find(x => x.id === id); studentOk(c.sid);
      if (decision === 'Approved' && c.watch < db.cfg.clearanceWatchPct) throw new Error(`Approval needs ${db.cfg.clearanceWatchPct}% of the recording watched; this student has watched ${c.watch}%.`);
      if (decision !== 'Approved' && !reason.trim()) throw new Error('A reason is required.');
      c.status = decision; c.reason = reason;
      if (decision === 'Approved') { const l = db.lectures.find(x => x.id === c.lectureId); db.attendanceEdits = db.attendanceEdits || []; db.attendanceEdits.push({ lid: l.id, sid: c.sid, old: l.marks[c.sid], new: 'P', who: me.email, at: now(), reason: 'Absence cleared (recording watched)' }); l.marks[c.sid] = 'P'; }
      audit('absence clearance ' + decision.toLowerCase(), c.sid, reason); save();
    }),
    /* content */
    courses: () => lag(() => db.courses.filter(courseVisible).map(c => ({ ...clone(c), mine: c.owner === 'trainer', enrolled: db.students.filter(s => c.batches.includes(s.batch)).length }))),
    course: id => lag(() => { const c = db.courses.find(x => x.id === id); if (!c || !courseVisible(c)) deny('You do not own or co-edit this course.'); return clone(c); }),
    saveCourse: c => lag(() => {
      if (!c.id && (!c.title || !c.title.trim())) throw new Error('Course title is required.');
      (c.batches || []).forEach(ownBatch);
      let ex = db.courses.find(x => x.id === c.id);
      if (ex) { if (!courseVisible(ex) || (ex.owner !== 'trainer' && ex.coEditor !== 'trainer')) deny('Read only: you do not own or co-edit this course.');
        if (ex.status === 'Published') ex.pendingDraft = true;
        Object.assign(ex, c); }
      else { ex = { modules: [], versions: [], version: 0, status: 'Draft', owner: 'trainer', coEditor: '', ...c, id: 'C-' + now() }; db.courses.push(ex); }
      audit('save course draft', ex.id); save(); return ex.id;
    }),
    saveCatalog: (id, f) => lag(() => { const c = db.courses.find(x => x.id === id);
      if (!c || (c.owner !== 'trainer' && c.coEditor !== 'trainer')) deny('Read only: you do not own or co-edit this course.');
      if (!['free', 'paid'].includes(f.access)) throw new Error('Choose Free or Paid.'); if (!String(f.category || '').trim()) throw new Error('Choose a category.');
      const faqs = (f.faqs || []).map(x => ({ q: String(x.q || '').trim(), a: String(x.a || '').trim() })).filter(x => x.q || x.a);
      if (faqs.some(x => !x.q || !x.a)) throw new Error('Each FAQ needs a question and an answer.');
      Object.assign(c, { category: f.category.trim(), access: f.access, featured: !!f.featured, format: (f.format || []).filter(Boolean), overview: String(f.overview || '').trim(), audience: String(f.audience || '').trim(),
        prerequisites: String(f.prerequisites || '').trim(), certificate: String(f.certificate || '').trim(), labs: String(f.labs || '').split('\n').map(x => x.trim()).filter(Boolean), faqs });
      audit('edit course listing and FAQs', id, faqs.length + ' FAQs'); save(); }),
    courseFaqs: id => lag(() => { const c = db.courses.find(x => x.id === id); if (!c || !courseVisible(c)) deny('Not your course.'); return courseFaqs(c); }),
    readiness: id => lag(() => readiness(db.courses.find(x => x.id === id))),
    publish: (id, summary) => lag(() => {
      const c = db.courses.find(x => x.id === id); if (!c || (c.owner !== 'trainer' && c.coEditor !== 'trainer')) deny('Not your course.');
      const r = readiness(c); if (!r.ok) throw new Error('Publishing is blocked until every check passes.');
      c.modules.forEach(m => m.lessons.forEach(l => l.status = 'Published'));
      db.students.filter(x => c.batches.includes(x.batch)).forEach(x => notify(x.id, 'New course content', `${c.title} is now available in your LMS.`));
      c.version = (c.version || 0) + 1; c.status = 'Published'; c.pendingDraft = false; c.unpublishReason = '';
      c.versions.unshift({ v: c.version, status: 'Published', author: me.name, at: now(), summary: summary || 'Published', snapshot: JSON.stringify(c.modules) });
      audit('publish course v' + c.version, id); save();
    }),
    unpublish: (id, reason) => lag(() => {
      const c = db.courses.find(x => x.id === id); if (!c || (c.owner !== 'trainer' && c.coEditor !== 'trainer')) deny('Not your course.');
      if (!reason.trim()) throw new Error('A reason is required. It is shown to the batch.');
      c.status = 'Unpublished'; c.unpublishReason = reason; c.versions.unshift({ v: c.version, status: 'Unpublished', author: me.name, at: now(), summary: 'Unpublished: ' + reason });
      db.announcements.unshift(...c.batches.map(b => ({ id: 'AN-' + now() + b, batch: b, type: 'Course paused', text: `${c.title} is paused: ${reason}. Your progress, grades and attendance are kept.`, channels: ['In-app', 'Email'], at: now(), delivered: db.students.filter(s => s.batch === b).length, read: 0, system: true })));
      audit('unpublish course', id, reason); save();
    }),
    restoreVersion: (id, v) => lag(() => { const c = db.courses.find(x => x.id === id); const ver = c.versions.find(x => x.v === v); if (ver && ver.snapshot) c.modules = JSON.parse(ver.snapshot); c.pendingDraft = true; if (c.status === 'Published') c.status = 'Published'; audit('restore version as draft', id, 'v' + v); save(); }),
    enrolled: id => lag(() => { const c = db.courses.find(x => x.id === id); if (!c || !courseVisible(c)) deny('Not your course.');
      const mine = myStudents().filter(s => c.batches.includes(s.batch)); const others = db.students.filter(s => c.batches.includes(s.batch) && !myBatchIds().includes(s.batch)).length;
      return { rows: mine.map(s => ({ id: s.id, name: s.name, batch: s.batch, progress: coursePct(c, s.id), lectures: `${s.att.attended}/${s.att.held}`, lastActive: s.lastActive, flag: s.flag })), otherBatches: others }; }),
    /* assessments */
    qbank: () => lag(() => clone(db.qbank)),
    assessments: () => lag(() => clone(db.assessments.filter(a => myBatchIds().includes(a.batch))).map(a => ({ ...a, enrolled: db.students.filter(s => s.batch === a.batch).length, subs: a.subs.map(s => ({ ...s, name: name(s.sid) })) }))),
    createAssessment: a => lag(() => { ownBatch(a.batch); if (!a.title || !a.questions.length) throw new Error('Add a title and pick at least one question.'); if (!a.due) throw new Error('Set a due date.');
      const rec = { ...a, id: 'AS-' + now(), subs: [], rubric: a.type === 'Quiz' ? null : ['Accuracy', 'Method', 'Clarity'], auto: a.type === 'Quiz' }; db.assessments.push(rec); audit('create assessment', rec.id, a.title); save(); return rec.id; }),
    grade: (aid, sid, data, action, reason) => lag(() => {
      const a = db.assessments.find(x => x.id === aid); ownBatch(a.batch); const s = a.subs.find(x => x.sid === sid);
      if (s.published && action === 'Publish' && !reason) { const e = new Error('Changing a published grade needs a reason.'); e.code = 'REASON'; throw e; }
      if (action === 'Publish' && !window.TrainerMFA.ok(data.mfa)) { const e = new Error('Publishing a grade needs your authenticator code.'); e.code = 'MFA'; throw e; }
      if (s.published && action === 'Publish') s.history.push({ old: s.published.total, reason, at: now() });
      s.rubric = data.rubric; s.comment = data.comment; s.state = action === 'Publish' ? 'Published' : action === 'Return' ? 'Returned' : 'Draft';
      if (action === 'Publish') s.published = { total: Object.values(data.rubric).reduce((x, y) => x + (+y || 0), 0), max: Object.keys(data.rubric).length * 5, at: now() };
      if (action !== 'Draft') notify(sid, action === 'Publish' ? 'Grade published' : 'Work returned for changes', `${a.title}${action === 'Publish' ? ': ' + s.published.total + ' / ' + s.published.max : ''}${data.comment ? ' · ' + data.comment : ''}`);
      audit(`grade ${s.state.toLowerCase()}`, `${aid}/${sid}`, reason || ''); save();
    }),
    /* labs */
    labs: batch => lag(() => { ownBatch(batch); return { missions: db.missions, rows: db.students.filter(s => s.batch === batch).map(s => ({ id: s.id, name: s.name, labs: (db.labs[s.id] || []).map(x => ({ ...x, state: x.state === 'In Progress' && x.lastCpMin >= db.cfg.stuckMinutes ? 'Stuck' : x.state })) })) }; }),
    nudge: (sid, text) => lag(() => { studentOk(sid); notify(sid, 'Nudge from your trainer', text); save(); audit('send nudge', sid, text); }),
    /* mentoring */
    mentoring: () => lag(() => { if (!/Mentor/.test(me.capability)) deny('Mentoring needs the Mentor capability.'); const m = clone(db.mentoring); m.requests = m.requests.filter(r => myBatchIds().includes((db.students.find(s => s.id === r.sid) || {}).batch)).map(r => ({ ...r, name: name(r.sid) })); m.mocks.forEach(x => x.name = name(x.sid)); return m; }),
    mentorAct: (id, status, extra = {}) => lag(() => { const r = db.mentoring.requests.find(x => x.id === id); studentOk(r.sid); if (status === 'Declined' && !(extra.reason || '').trim()) throw new Error('Give a reason when declining.'); Object.assign(r, { status, ...extra }); notify(r.sid, 'Session ' + status.toLowerCase(), `${r.type}: ${status}${extra.reason ? ' (' + extra.reason + ')' : ''}${extra.when ? ' · new time ' + new Date(extra.when).toLocaleString('en-IN') : ''}`); audit('mentoring ' + status.toLowerCase(), r.sid); save(); }),
    setAvail: av => lag(() => { db.mentoring.avail = av; audit('update availability', me.email); save(); }),
    saveMock: (m, publish) => lag(() => { studentOk(m.sid); let ex = db.mentoring.mocks.find(x => x.id === m.id); if (!ex) { ex = { ...m, id: 'MK-' + now() }; db.mentoring.mocks.push(ex); } else Object.assign(ex, m);
      ex.state = publish ? 'Published' : 'Draft'; ex.at = now(); if (publish) { const s = db.students.find(x => x.id === m.sid); s.mocks = Math.min(3, (s.mocks || 0) + 1); }
      audit(publish ? 'publish mock interview' : 'save mock draft', m.sid); save(); }),
    /* messages */
    threads: () => lag(() => db.threads.filter(t => myBatchIds().includes((db.students.find(s => s.id === t.sid) || {}).batch)).map(t => ({ ...clone(t), name: name(t.sid), batch: db.students.find(s => s.id === t.sid).batch }))),
    reply: (tid, text) => lag(() => { const t = db.threads.find(x => x.id === tid); studentOk(t.sid); if (!text.trim()) throw new Error('Write a reply first.'); t.msgs.push({ from: 'trainer', text, at: now() }); t.unread = false; t.studentUnread = true; notify(t.sid, 'Reply from your trainer', t.subject); audit('reply to student', t.sid); save(); }),
    readThread: tid => lag(() => { const t = db.threads.find(x => x.id === tid); t.unread = false; save(); }),
    escalateThread: tid => lag(() => { const t = db.threads.find(x => x.id === tid); db.support.push({ at: now(), sid: t.sid, kind: 'Message escalation', reason: t.subject, to: 'Support admin' }); audit('escalate thread', tid); save(); }),
    announcements: () => lag(() => clone(db.announcements.filter(a => myBatchIds().includes(a.batch)))),
    announce: a => lag(() => {
      ownBatch(a.batch);
      if (['Important', 'Holiday notice', 'Festival wishes', 'Platform-wide'].includes(a.type)) deny(`${a.type} needs a Content or Platform admin.`);
      if (!a.text.trim()) throw new Error('Write the announcement first.'); if (!a.channels.length) throw new Error('Pick at least one delivery channel.');
      const rec = { ...a, id: 'AN-' + now(), at: now(), from: me.name, delivered: db.students.filter(s => s.batch === a.batch).length, read: 0 }; db.announcements.unshift(rec); db.students.filter(s => s.batch === a.batch).forEach(s => notify(s.id, 'Message from trainer', a.text)); audit('post to batch', a.batch, a.type); save();
    }),
    /* feedback */
    feedback: (f = {}) => lag(() => { const fb = clone(db.feedback); const bs = f.batch && f.batch !== 'All' ? [f.batch] : myBatchIds();
      const resp = bs.reduce((a, b) => a + ((fb.byBatch[b] || {}).responses || 0), 0);
      const shown = bs.filter(b => (fb.byBatch[b] || {}).responses >= db.cfg.feedbackMinResponses);
      const rating = shown.length ? +(shown.reduce((a, b) => a + fb.byBatch[b].rating * fb.byBatch[b].responses, 0) / shown.reduce((a, b) => a + fb.byBatch[b].responses, 0)).toFixed(1) : null;
      return { ...fb, responses: resp, rating, hiddenBatches: bs.filter(b => !shown.includes(b)), comments: fb.comments.filter(c => bs.includes(c.batch) && (!f.month || f.month === 'All' || c.month === f.month) && (!f.type || f.type === 'All' || c.type === f.type)).filter(c => shown.includes(c.batch)) }; }),
    audit: () => lag(() => clone(db.audit.slice(0, 50))),
    /* profile: lives on the staff account (login database), only the trainer's own record */
    profile: () => lag(() => { const u = staffUser(); return { email: u.email, name: u.name.replace(/\s*\(Trainer\)/, ''), capability: u.capability, batches: u.batches, mfa: !!u.mfaSecret, hasPassword: !!u.pwHash, pwChangedAt: u.pwChangedAt || null, ...(u.trainerProfile || {}) }; }),
    saveProfile: f => lag(() => {
      const name = (f.name || '').trim(); if (name.length < 2) throw new Error('Enter your full name.');
      if (f.phone && !/^\+?[0-9 ()-]{8,16}$/.test(f.phone)) throw new Error('Enter a valid phone number.');
      if (f.linkedin && !/^https:\/\//.test(f.linkedin)) throw new Error('The LinkedIn link must start with https://');
      if (f.photo && f.photo.length > 1.5e6) throw new Error('The photo is too large. Use an image under 1 MB.');
      const keep = ['title', 'phone', 'specialisation', 'experience', 'certifications', 'languages', 'bio', 'linkedin', 'photo'];
      editStaff(u => { u.name = name; u.trainerProfile = Object.fromEntries(keep.map(k => [k, f[k] ?? (u.trainerProfile || {})[k] ?? ''])); });
      me.name = name; audit('update profile', me.email); }),
    changePassword: (cur, next, code) => lag(() => {
      const u = staffUser();
      if (u.pwHash && hash(cur) !== u.pwHash) throw new Error('Your current password is not right.');
      const rules = [[next.length >= 10, 'at least 10 characters'], [/[A-Z]/.test(next), 'an upper-case letter'], [/[a-z]/.test(next), 'a lower-case letter'], [/\d/.test(next), 'a number'], [/[^A-Za-z0-9]/.test(next), 'a symbol']];
      const miss = rules.filter(r => !r[0]).map(r => r[1]); if (miss.length) throw new Error('The new password needs ' + miss.join(', ') + '.');
      if (u.pwHash && hash(next) === u.pwHash) throw new Error('Choose a password you have not used before.');
      if (!window.TrainerMFA.ok(code)) { const e = new Error('That authenticator code is not right.'); e.code = 'MFA'; throw e; }
      editStaff(x => { x.pwHash = hash(next); x.pwChangedAt = now(); }); audit('change password (MFA)', me.email); })

  };
  const LOGIN_DB = 'yojo_demo_db_v1';
  const staffUser = () => { const d = JSON.parse(localStorage.getItem(LOGIN_DB) || '{}'); const u = (d.users || []).find(x => x.email === me.email); if (!u) deny('Account not found.'); return u; };
  const editStaff = fn => { const d = JSON.parse(localStorage.getItem(LOGIN_DB)); const u = d.users.find(x => x.email === me.email); fn(u); localStorage.setItem(LOGIN_DB, JSON.stringify(d)); };
  // demo only: a real server stores passwords with a slow salted hash (bcrypt or argon2), never in the browser
  const hash = t => { let h = 2166136261; for (const c of 'yojo:' + t) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
  function coursePct(c, sid) { const ls = c.modules.flatMap(m => m.lessons).filter(l => l.status === 'Published'); const done = (db.progress || {})[sid] || {}; return ls.length ? Math.round(ls.filter(l => done[l.id]).length / ls.length * 100) : 0; }
  const notify = (sid, kind, text) => { db.studentNotes = db.studentNotes || {}; (db.studentNotes[sid] = db.studentNotes[sid] || []).unshift({ id: 'N' + now() + Math.random().toString(36).slice(2, 5), kind, text, at: now(), read: false }); };
  function readiness(c) {
    const lessons = c.modules.flatMap(m => m.lessons), needsFile = l => !!FILE_RULES[l.type];
    const checks = [
      ['At least one module', c.modules.length > 0],
      ['Every module has a lesson', c.modules.length > 0 && c.modules.every(m => m.lessons.length)],
      ['Every file lesson has content', lessons.every(l => !needsFile(l) || l.file)],
      ['Every file matches its lesson type', lessons.every(l => !l.file || !FILE_RULES[l.type] || fileFits(l.type, l.file.name))],
      ['Every link lesson has a web address', lessons.every(l => l.type !== 'Link' || /^https:\/\//.test(l.url || ''))],
      ['No upload still processing', lessons.every(l => !l.file || (l.file.proc === 'Ready' && l.file.progress >= 100))],
      ['Every upload passed the virus scan', lessons.every(l => !l.file || l.file.scan === 'Clean')],
      ['A batch is assigned', c.batches.length > 0]
    ].map(([label, ok]) => ({ label, ok }));
    return { checks, ok: checks.every(x => x.ok) };
  }
  window.TrainerAPI = API;

  /* ---------------- student side of the same server ----------------
     The student LMS (academy.html) calls these with the signed-in student's email.
     A student only ever reaches their own record, their own batch and its trainer. */
  const loginDb = () => { try { return JSON.parse(localStorage.getItem('yojo_demo_db_v1')) || { users: [] }; } catch { return { users: [] }; } };
  const reload = () => { try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && d.students) db = tidy(d); } catch {} };
  function studentFor(email, name) { reload(); return db.students.find(s => email && s.loginEmail === email) || db.students.find(s => name && s.name.toLowerCase() === String(name).toLowerCase()) || null; }
  function trainerOf(batch) {
    const u = loginDb().users.find(x => x.role === 'trainer' && x.status === 'active' && (x.batches || '').split(',').map(t => t.trim()).includes(batch));
    if (!u) return null; const p = u.trainerProfile || {};
    return { name: u.name.replace(/\s*\(Trainer\)/, ''), title: p.title || 'Trainer', specialisation: p.specialisation ?? 'SOC operations and Blue Team defence', certifications: p.certifications ?? 'CEH, CISSP, GCIH', experience: p.experience ?? '11', bio: p.bio || '', photo: p.photo || '', languages: p.languages ?? 'English, Hindi', mentor: /Mentor/.test(u.capability || '') };
  }
  const SLOTDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const Bridge = {
    link(email, name) { const s = studentFor(email, name); if (!s) return null; return { sid: s.id, name: s.name, batch: s.batch, trainer: trainerOf(s.batch) }; },
    slots(sid) { // next open slots from the trainer's weekly availability, skipping booked ones
      reload(); const s = db.students.find(x => x.id === sid); if (!s) return [];
      const taken = db.mentoring.requests.filter(r => ['Requested', 'Accepted', 'Time proposed'].includes(r.status)).map(r => r.when), out = [];
      for (let d = 1; d <= 14 && out.length < 8; d++) { const day = new Date(T0 + d * DAY); const k = Object.keys(SLOTDAYS).find(x => SLOTDAYS[x] === day.getDay());
        (db.mentoring.avail[k] || []).slice().sort().forEach(t => { const [h, m] = t.split(':').map(Number); const w = T0 + d * DAY + (h * 60 + m) * 6e4; if (!taken.includes(w) && out.length < 8) out.push(w); }); }
      return out;
    },
    book(sid, type, when, note) {
      reload(); const s = db.students.find(x => x.id === sid); if (!s) throw new Error('Not linked to a batch.');
      if (!Bridge.slots(sid).includes(when)) throw new Error('That slot is no longer free. Pick another.');
      const r = { id: 'MR-' + now(), sid, type, when, dur: type === 'Mock interview' ? 45 : 30, status: 'Requested', note: note || '', role: type === 'Mock interview' ? 'SOC Analyst L1' : '' };
      db.mentoring.requests.push(r); save(); return r.id;
    },
    sessions(sid) { reload(); return clone(db.mentoring.requests.filter(r => r.sid === sid)).sort((a, b) => a.when - b.when); },
    respond(sid, id, accept) { reload(); const r = db.mentoring.requests.find(x => x.id === id && x.sid === sid); if (!r || r.status !== 'Time proposed') return; r.status = accept ? 'Accepted' : 'Declined'; if (!accept) r.reason = 'Student declined the new time'; save(); },
    cancel(sid, id) { reload(); const r = db.mentoring.requests.find(x => x.id === id && x.sid === sid); if (r && ['Requested', 'Accepted', 'Time proposed'].includes(r.status)) { r.status = 'Cancelled by student'; save(); } },
    threads(sid) { reload(); return clone(db.threads.filter(t => t.sid === sid)); },
    message(sid, subject, text, tid) {
      reload(); if (!text.trim()) throw new Error('Type a message first.');
      let t = tid && db.threads.find(x => x.id === tid && x.sid === sid);
      if (t) t.msgs.push({ from: 'student', text, at: now() }); else { t = { id: 'TH-' + now(), sid, subject: subject || 'Question', unread: true, msgs: [{ from: 'student', text, at: now() }] }; db.threads.unshift(t); }
      t.unread = true; t.studentUnread = false; save(); return t.id;
    },
    readThreads(sid) { reload(); db.threads.filter(t => t.sid === sid).forEach(t => t.studentUnread = false); save(); },
    courses(sid) { // published courses of the student's batch, published lessons whose release time has come
      reload(); const s = db.students.find(x => x.id === sid); if (!s) return [];
      const done = (db.progress || {})[sid] || {};
      return db.courses.filter(c => c.status === 'Published' && c.batches.includes(s.batch)).map(c => ({ id: c.id, title: c.title, track: c.track, level: c.level, owner: c.owner === 'trainer' ? (trainerOf(s.batch) || {}).name : c.owner, pct: coursePct(c, sid),
        modules: c.modules.map(m => ({ title: m.title, lessons: m.lessons.filter(l => l.status === 'Published').map(l => ({ id: l.id, title: l.title, type: l.type, concept: l.concept, dl: l.dl, url: l.url || '', file: l.file ? { name: l.file.name, sizeMB: l.file.sizeMB } : null, locked: !!(l.release && l.release > now()), release: l.release, done: !!done[l.id] })) })).filter(m => m.lessons.length) }));
    },
    complete(sid, lessonId) { reload(); const c = db.courses.find(x => x.status === 'Published' && x.modules.some(m => m.lessons.some(l => l.id === lessonId && l.status === 'Published'))); const s = db.students.find(x => x.id === sid);
      if (!c || !s || !c.batches.includes(s.batch)) throw new Error('This lesson is not in your batch.'); db.progress = db.progress || {}; (db.progress[sid] = db.progress[sid] || {})[lessonId] = now(); s.lastActive = now(); save(); },
    requestLeave(sid, from, to, reason) {
      reload(); const s = db.students.find(x => x.id === sid); if (!s) throw new Error('Not linked to a batch.');
      const f = new Date(from).setHours(0, 0, 0, 0), t = new Date(to || from).setHours(0, 0, 0, 0);
      if (!from || isNaN(f)) throw new Error('Pick the first day of leave.'); if (t < f) throw new Error('The last day cannot be before the first day.');
      if (!(reason || '').trim()) throw new Error('Tell your trainer why you need leave.');
      const v = { id: 'LV-' + now(), sid, from: f, to: t, days: Math.round((t - f) / DAY) + 1, reason: reason.trim(), status: 'Pending', at: now() };
      db.leaves.unshift(v); save(); return v.id;
    },
    leaves(sid) { reload(); return clone(db.leaves.filter(v => v.sid === sid)); },
    cancelLeave(sid, id) { reload(); const v = db.leaves.find(x => x.id === id && x.sid === sid); if (v && v.status === 'Pending') { v.status = 'Withdrawn'; save(); } },
    notes(sid) { reload(); return clone((db.studentNotes || {})[sid] || []); },
    readNotes(sid) { reload(); ((db.studentNotes || {})[sid] || []).forEach(n => n.read = true); save(); },
    announcements(sid) { reload(); const s = db.students.find(x => x.id === sid); return s ? clone(db.announcements.filter(a => a.batch === s.batch)) : []; },
    grades(sid) { reload(); return db.assessments.filter(a => a.subs.some(x => x.sid === sid && (x.state === 'Published' || x.state === 'Returned'))).map(a => { const x = a.subs.find(y => y.sid === sid); return { title: a.title, state: x.state, total: x.published ? x.published.total : null, max: x.published ? x.published.max || (a.rubric || []).length * 5 : null, comment: x.comment }; }); }
  };

  /* ---------------- course catalog API (public pages + student LMS) ----------------
     The server decides what each caller may see. Public calls get listing fields and the curriculum outline
     (titles only). Lesson files, links, labs and assessments come only from lesson(), which checks entitlement:
     a free course, a preview lesson, or enrolment in a batch the course runs in. A Paid plan alone is not enrolment. */
  const PLAN_LABEL = { free: 'Free', paid: 'Paid' };
  const pubLessons = c => c.modules.map(m => ({ id: m.id, title: m.title, lessons: m.lessons.filter(l => l.status === 'Published').map(l => ({ id: l.id, title: l.title, type: l.type, preview: !!l.preview })) })).filter(m => m.lessons.length || c.modules.length === 1);
  function courseFaqs(c) { // answers are built only from what the course record says; owner-written FAQs are added on top
    const lessons = c.modules.flatMap(m => m.lessons).filter(l => l.status === 'Published'), labs = c.labs.length ? c.labs : lessons.filter(l => l.type === 'Lab').map(l => l.title);
    const out = [];
    const add = (q, a) => { if (a) out.push({ q, a, src: 'course' }); };
    add('What will I learn?', c.outcomes.length ? c.outcomes.join('. ') + '.' : c.overview || '');
    add('Who is this course for?', c.audience || (c.level ? `${c.level} learners.` : ''));
    add('What prerequisites are required?', c.prerequisites || '');
    add('Is the course self-paced or instructor-led?', c.format.length ? c.format.join(' and ') + '.' : '');
    add('Are hands-on labs included?', labs.length ? 'Yes: ' + labs.join(', ') + '.' : '');
    add('How long does the course take?', c.duration || '');
    add('What access does my current plan provide?', c.access === 'free' ? 'This is a free course. Every published lesson is open to any signed-in student, on the Free or the Paid plan.'
      : 'This course is part of the paid programme. Full lessons, labs and assessments open once you are enrolled in a batch that runs it. A Paid plan does not unlock every course on its own.' + (lessons.some(l => l.preview) ? ' Preview lessons are open to every signed-in student.' : ''));
    add('Is a certificate available?', c.certificate ? c.certificate + ' when you complete the course.' : '');
    (c.faqs || []).filter(f => f.q && f.a).forEach(f => { const i = out.findIndex(x => x.q.toLowerCase() === f.q.trim().toLowerCase()); const row = { q: f.q.trim(), a: f.a.trim(), src: 'owner' }; if (i >= 0) out[i] = row; else out.push(row); });
    return out;
  }
  const trainerName = c => { const b = c.batches[0]; const t = b && trainerOf(b); return t ? t.name : ''; };
  function pub(c) {
    const lessons = c.modules.flatMap(m => m.lessons).filter(l => l.status === 'Published');
    return { id: c.id, slug: c.slug, title: c.title, desc: c.desc || '', overview: c.overview || c.desc || '', category: c.category, level: c.level || '', duration: c.duration || '', format: c.format.slice(), access: c.access,
      featured: !!c.featured, outcomes: c.outcomes.slice(), prerequisites: c.prerequisites || '', audience: c.audience || '', labs: c.labs.length ? c.labs.slice() : lessons.filter(l => l.type === 'Lab').map(l => l.title),
      certificate: c.certificate || '', image: c.image || '', addedAt: c.addedAt, trainer: trainerName(c), modules: pubLessons(c), moduleCount: c.modules.length, lessonCount: lessons.length,
      enrolled: db.students.filter(s => c.batches.includes(s.batch)).length, faqs: courseFaqs(c) };
  }
  const published = () => db.courses.filter(c => c.status === 'Published');
  const userRec = email => loginDb().users.find(u => u.email === email) || null;
  function entitlement(c, email) { // server-side: the plan and the batch come from the stored records, never from the page
    const u = userRec(email); if (!u || u.role !== 'student') return { state: 'guest', plan: '' };
    const plan = u.stats && u.stats.plan === 'paid' ? 'paid' : 'free', s = studentFor(email);
    if (s && c.batches.includes(s.batch) && (c.access === 'free' || plan === 'paid')) return { state: 'enrolled', plan, sid: s.id };
    if (c.access === 'free') return { state: 'free', plan, sid: s && s.id };
    return { state: 'locked', plan, sid: s && s.id };
  }
  const Courses = {
    list() { reload(); return published().map(pub); },
    get(slug) { reload(); const c = published().find(x => x.slug === slug || x.id === slug); return c ? pub(c) : null; },
    categories() { reload(); return [...new Set(published().map(c => c.category))]; },
    forStudent(email) { reload(); return published().map(c => { const e = entitlement(c, email), p = pub(c), done = e.sid ? (db.progress || {})[e.sid] || {} : (db.publicProgress || {})[email] || {};
      const open = e.state === 'enrolled' || e.state === 'free';
      p.state = e.state; p.plan = e.plan;
      p.modules.forEach(m => m.lessons.forEach(l => { l.open = open || l.preview; l.done = !!done[l.id]; }));
      p.done = p.modules.reduce((a, m) => a + m.lessons.filter(l => l.done).length, 0); p.pct = p.lessonCount ? Math.round(100 * p.done / p.lessonCount) : 0;
      return p; }); },
    lesson(email, courseId, lessonId) { // the only call that returns lesson content
      reload(); const c = published().find(x => x.id === courseId), l = c && c.modules.flatMap(m => m.lessons).find(x => x.id === lessonId && x.status === 'Published');
      if (!c || !l) throw Object.assign(new Error('Lesson not found.'), { code: 404 });
      const e = entitlement(c, email);
      if (e.state === 'guest') throw Object.assign(new Error('Sign in as a student to open lessons.'), { code: 401 });
      if (!(e.state === 'enrolled' || e.state === 'free' || l.preview)) throw Object.assign(new Error(c.access === 'paid' ? 'This lesson opens after you enrol in this course.' : 'Not available.'), { code: 403 });
      return { id: l.id, title: l.title, type: l.type, url: l.url || '', file: l.file ? { name: l.file.name, sizeMB: l.file.sizeMB } : null, dl: !!l.dl };
    },
    complete(email, courseId, lessonId) { Courses.lesson(email, courseId, lessonId); const e = entitlement(db.courses.find(x => x.id === courseId), email);
      if (e.sid) { db.progress = db.progress || {}; (db.progress[e.sid] = db.progress[e.sid] || {})[lessonId] = now(); }
      else { db.publicProgress = db.publicProgress || {}; (db.publicProgress[email] = db.publicProgress[email] || {})[lessonId] = now(); }
      save(); },
    PLAN_LABEL
  };
  window.YojoCourses = Courses;
  window.YojoBridge = Bridge;
  window.TrainerFiles = { FILE_RULES, fileFits, extOf };
  window.TrainerDemo = { name, CFG: db.cfg, at, DAY };
})();
