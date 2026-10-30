/* Public website → Internships → "Our programs" (owner, 30 Oct). Each program has its own page (#program/<slug>) that
   lists its internships with full details and an application form. Applications go to the same enquiry backend as the
   Internships page (POST /public/submissions via site-live.js), tagged with the program and the internship.
   DRAFT CONTENT (OPEN-ITEMS OI-65): programme structure, durations, modes, weekly hours, eligibility and selection steps
   were written for the demo and wait for Yojo to confirm. Fees, stipends, seat numbers and start dates are deliberately
   not shown until Yojo provides them. */
(function () {
  'use strict';
  var TRACK = { Offensive: 'var(--off, #F87171)', Defensive: 'var(--def, #5B8CFF)', GRC: 'var(--grc, #39D98A)', Forensics: '#FB923C', AI: '#C084FC' };
  // owner, 30 Oct: both modes, offline preferred (Vizag); online available
  var MODE = 'Offline (preferred) · Online available', SCHEDULE = 'Full-time offline or part-time online';
  var mo = function (n) { return n + (n === 1 ? ' month' : ' months'); };
  var CERT = 'Yojo internship completion certificate and a written reference on successful completion.';
  var PROGRAMS = [
    {
      slug: 'expert-professional', title: 'Expert Professional Program with Internship', short: 'Expert Professional',
      tagline: 'Industry training followed by a supervised internship on real security work.',
      overview: 'For graduates and working professionals who want a job-ready cyber security profile. You complete an intensive training track, then join a supervised internship squad where you work on real tickets, tools and deliverables with a mentor reviewing your work.',
      who: 'Graduates (any stream with IT interest), final-year students and working professionals moving into cyber security.',
      structure: ['Training track in your chosen area (Defensive, Offensive, GRC or Forensics)', 'Supervised internship with weekly reviews', 'Capstone deliverable presented to the team', 'Completion letter, reference and placement support'],
      length: 'Training, then an internship of 1, 3 or 6 months (3 or 6 for advanced roles).',
      internships: [
        { id: 'soc-analyst', title: 'SOC Analyst Intern', track: 'Defensive',
          summary: 'Monitor, triage and investigate security alerts in a SOC environment.',
          description: 'You work in a simulated and partner-backed security operations workflow: watching SIEM alerts, separating real threats from noise, investigating incidents and documenting them. Senior analysts review your triage notes every week.',
          tasks: ['Triage alerts in Splunk / Wazuh and escalate real incidents', 'Investigate phishing, brute-force and malware alerts end to end', 'Write and tune detection rules (Sigma) with a reviewer', 'Prepare incident reports and shift hand-over notes'],
          skills: ['SIEM operations', 'Alert triage and incident handling', 'Log analysis (Windows, Linux, network)', 'Detection engineering basics', 'Incident reporting'],
          eligibility: 'Completed the SOC / Defensive training track or equivalent knowledge of networking, Windows/Linux logs and SIEM basics.',
          months: [1, 3, 6] },
        { id: 'vapt', title: 'VAPT Intern', track: 'Offensive',
          summary: 'Assist on authorised vulnerability assessments and penetration tests.',
          description: 'Under a lead tester, you take part in scoped, authorised assessments of lab and partner staging environments: recon, vulnerability scanning, manual testing of web apps and networks, and writing findings that developers can act on.',
          tasks: ['Recon and scanning with Nmap, Nessus and Burp Suite', 'Manual testing for OWASP Top 10 web vulnerabilities', 'Validate and risk-rate findings with CVSS', 'Write findings and remediation advice for the final report'],
          skills: ['Web and network penetration testing', 'Burp Suite and Nmap', 'Vulnerability validation and CVSS', 'Professional report writing', 'Testing ethics and scope control'],
          eligibility: 'Completed the Offensive / VAPT training track, or proven skills in web testing and Linux. All testing is authorised and scoped.',
          months: [3, 6] },
        { id: 'grc-analyst', title: 'GRC Analyst Intern', track: 'GRC',
          summary: 'Support risk assessments, policies and audit preparation.',
          description: 'You join the GRC squad on client-style engagements: mapping controls to ISO 27001 and NIST, maintaining a risk register, drafting policies and collecting audit evidence. A GRC lead reviews every deliverable.',
          tasks: ['Run gap assessments against ISO 27001 Annex A', 'Maintain a risk register and treatment plans', 'Draft and review security policies and procedures', 'Collect and organise audit evidence'],
          skills: ['ISO 27001 and NIST CSF', 'Risk assessment', 'Policy writing', 'Audit preparation', 'Stakeholder communication'],
          eligibility: 'Completed the GRC training track or equivalent knowledge of ISO 27001, risk management and audit basics.',
          months: [1, 3, 6] },
        { id: 'forensics', title: 'Digital Forensics Intern', track: 'Forensics',
          summary: 'Help acquire and analyse digital evidence in investigations.',
          description: 'You support forensic case work on lab and anonymised case data: imaging disks, analysing Windows and mobile artifacts, building timelines and writing evidence reports with a proper chain of custody.',
          tasks: ['Acquire and verify disk and memory images', 'Analyse artifacts with Autopsy and Volatility', 'Rebuild incident timelines', 'Write forensic reports with chain of custody'],
          skills: ['Computer and mobile forensics', 'Memory analysis', 'Timeline building', 'Evidence handling', 'Forensic reporting'],
          eligibility: 'Completed the Cyber Forensics training track or equivalent Windows internals and forensics basics.',
          months: [3, 6] },
        { id: 'threat-intel', title: 'Threat Intelligence Intern', track: 'Defensive',
          summary: 'Track threats and publish intelligence briefs for the SOC.',
          description: 'You collect and analyse threat data from open sources, enrich indicators, map campaigns to MITRE ATT&CK and publish short weekly briefs that the SOC squad uses.',
          tasks: ['Collect and enrich IOCs from open feeds', 'Track phishing infrastructure and campaigns', 'Map activity to MITRE ATT&CK', 'Publish a weekly threat brief'],
          skills: ['Threat intelligence lifecycle', 'OSINT', 'MISP / OpenCTI basics', 'MITRE ATT&CK', 'Intelligence writing'],
          eligibility: 'Completed the Defensive training track; interest in research and writing.',
          months: [1, 3, 6] },
        { id: 'ai-security', title: 'AI Security Intern', track: 'AI',
          summary: 'Use machine learning for threat detection and test AI systems for security risks.',
          description: 'You work where AI meets cyber security: building simple ML models that flag suspicious logins and network activity, and testing AI and LLM-based applications for prompt injection, data leakage and model abuse, following the OWASP Top 10 for LLM Applications.',
          tasks: ['Prepare security log data for machine learning', 'Train and evaluate an anomaly-detection model for the SOC', 'Test an LLM chatbot for prompt injection and data leakage', 'Document AI security risks and mitigations'],
          skills: ['Python for security data', 'ML-based threat detection', 'LLM / AI application security', 'OWASP Top 10 for LLMs', 'Technical reporting'],
          eligibility: 'Basic Python and security fundamentals; completed the Defensive or AI and Cybersecurity track.',
          months: [3, 6] }
      ]
    },
    {
      slug: 'diploma-students', title: 'Diploma Program for Students', short: 'Diploma',
      tagline: 'A structured diploma with short internships for college students.',
      overview: 'For college and diploma students who want hands-on cyber security experience alongside their studies. You learn the foundations, practise in the cyber range and finish with a short internship that adds real work to your resume.',
      who: 'Diploma, undergraduate and postgraduate students (any year) with an interest in cyber security.',
      structure: ['Foundations: networking, Linux and security basics', 'Hands-on labs in the Yojo cyber range', 'Short internship in one track', 'Diploma certificate and resume review'],
      length: 'Internships of 1, 3 or 6 months, planned around the academic calendar.',
      internships: [
        { id: 'foundations', title: 'Cyber Security Foundations Intern', track: 'Defensive',
          summary: 'Your first internship: real security tasks for beginners.',
          description: 'A guided internship for students new to the field. You help with security awareness material, asset and vulnerability inventories, and basic log reviews, with a mentor checking in twice a week.',
          tasks: ['Build an asset and software inventory', 'Run basic vulnerability scans and summarise results', 'Review simple logs for suspicious activity', 'Create security awareness content'],
          skills: ['Security fundamentals', 'Networking basics', 'Linux command line', 'Documentation'],
          eligibility: 'Any student who has completed the Diploma foundations module.',
          months: [1, 3, 6] },
        { id: 'junior-soc', title: 'Junior SOC Intern', track: 'Defensive',
          summary: 'Learn how a SOC works by triaging alerts in the cyber range.',
          description: 'You practise SOC work in the Yojo cyber range: triaging alerts, following runbooks and writing short incident notes, reviewed by a SOC mentor.',
          tasks: ['Triage alerts using SOC runbooks', 'Investigate simulated phishing and brute-force attacks', 'Write incident notes', 'Present one investigation to the squad'],
          skills: ['SIEM basics', 'Alert triage', 'Incident notes', 'Teamwork'],
          eligibility: 'Diploma students who completed the Defensive labs.',
          months: [1, 3, 6] },
        { id: 'web-security', title: 'Web Security Intern', track: 'Offensive',
          summary: 'Test deliberately vulnerable web apps and report what you find.',
          description: 'You test intentionally vulnerable applications in the lab (no live targets), learn how OWASP Top 10 issues work, and write clear findings with fixes.',
          tasks: ['Test lab apps for OWASP Top 10 issues', 'Use Burp Suite to inspect and modify requests', 'Rate findings by severity', 'Write a short pentest-style report'],
          skills: ['Web security basics', 'Burp Suite', 'OWASP Top 10', 'Report writing'],
          eligibility: 'Diploma students who completed the Offensive labs.',
          months: [1, 3, 6] },
        { id: 'grc-documentation', title: 'GRC Documentation Intern', track: 'GRC',
          summary: 'Help write policies and compliance documents.',
          description: 'A gentle start in governance, risk and compliance: you help draft and format security policies, map simple controls and prepare checklists used in audits.',
          tasks: ['Draft security policies from templates', 'Map controls to ISO 27001 clauses', 'Prepare audit checklists', 'Keep a document register up to date'],
          skills: ['Policy writing', 'ISO 27001 basics', 'Compliance documentation', 'Attention to detail'],
          eligibility: 'Diploma students; no technical background needed.',
          months: [1, 3, 6] },
        { id: 'ai-cyber', title: 'AI for Cyber Security Intern', track: 'AI',
          summary: 'Learn how AI tools help defenders, with hands-on student projects.',
          description: 'A beginner-friendly internship on how AI is used in cyber security: using AI assistants safely in SOC work, classifying phishing emails with a simple model, and understanding the risks of AI tools.',
          tasks: ['Use AI assistants to speed up log and alert review (safely)', 'Build a simple phishing-email classifier', 'Compare AI tool outputs with manual analysis', 'Present an AI-in-security mini project'],
          skills: ['AI basics for security', 'Python notebooks', 'Phishing detection', 'Responsible AI use'],
          eligibility: 'Diploma students with basic computer skills; Python helps but is taught.',
          months: [1, 3, 6] }
      ]
    },
    {
      slug: 'grc-mentorship', title: 'Mentorship Program for GRC', short: 'GRC Mentorship',
      tagline: 'One-to-one mentoring with GRC practitioners and real compliance work.',
      overview: 'For people building a career in governance, risk and compliance. A GRC mentor guides you through ISO standards, risk and audit work, while you complete internship assignments that mirror real consulting engagements.',
      who: 'GRC beginners, auditors, IT and compliance professionals, and graduates from law, commerce or management backgrounds moving into cyber GRC.',
      structure: ['Weekly one-to-one sessions with a GRC mentor', 'Guided reading of ISO 27001, ISO 31000 and ISO 22301', 'Internship assignments on realistic company cases', 'Portfolio of GRC deliverables and interview preparation'],
      length: 'Mentoring with internships of 1, 3 or 6 months.',
      internships: [
        { id: 'iso-27001', title: 'ISO 27001 Implementation Intern', track: 'GRC',
          summary: 'Help a sample organisation build its ISMS.',
          description: 'You work through an ISO 27001 implementation for a realistic company case: defining scope, writing the Statement of Applicability, drafting core policies and preparing for an internal audit.',
          tasks: ['Define ISMS scope and context', 'Prepare the Statement of Applicability', 'Draft core ISMS policies', 'Run an internal audit checklist'],
          skills: ['ISO 27001:2022', 'ISMS documentation', 'Annex A controls', 'Internal audit'],
          eligibility: 'Enrolled in the GRC mentorship program.',
          months: [1, 3, 6] },
        { id: 'risk-assessment', title: 'Risk Assessment Intern', track: 'GRC',
          summary: 'Identify, score and treat information security risks.',
          description: 'Using ISO 31000:2018 and NIST SP 800-30, you assess risks for a case company, build a risk register and heat map, and recommend treatments to "management".',
          tasks: ['Identify assets, threats and vulnerabilities', 'Score likelihood and impact', 'Build a risk register and heat map', 'Present a treatment plan'],
          skills: ['ISO 31000:2018', 'Risk scoring', 'Risk reporting', 'Business communication'],
          eligibility: 'Enrolled in the GRC mentorship program.',
          months: [1, 3, 6] },
        { id: 'audit-support', title: 'Audit Support Intern', track: 'GRC',
          summary: 'Prepare evidence and checklists for compliance audits.',
          description: 'You support audit preparation across ISO 27001, PCI DSS and SOC 2 style controls: building checklists, requesting and organising evidence and tracking findings to closure.',
          tasks: ['Build audit checklists from control frameworks', 'Collect and index audit evidence', 'Track findings and corrective actions', 'Prepare an audit readiness summary'],
          skills: ['Audit methodology', 'Evidence management', 'PCI DSS and SOC 2 basics', 'Follow-up and reporting'],
          eligibility: 'Enrolled in the GRC mentorship program.',
          months: [1, 3, 6] },
        { id: 'business-continuity', title: 'Business Continuity Intern', track: 'GRC',
          summary: 'Plan how a business keeps running through disruption (ISO 22301).',
          description: 'You run a business impact analysis for a case company, define recovery objectives and draft a business continuity plan with a tabletop test.',
          tasks: ['Run a business impact analysis', 'Set RTO and RPO for key processes', 'Draft a business continuity plan', 'Facilitate a tabletop exercise'],
          skills: ['ISO 22301', 'Business impact analysis', 'Continuity planning', 'Exercise facilitation'],
          eligibility: 'Enrolled in the GRC mentorship program.',
          months: [1, 3, 6] },
        { id: 'privacy-compliance', title: 'Privacy Compliance Intern (GDPR / DPDP)', track: 'GRC',
          summary: 'Help a company comply with GDPR and India’s DPDP Act.',
          description: 'You map personal data for a case company, check notices and consent against GDPR and the DPDP Act 2023, and prepare a data protection impact assessment.',
          tasks: ['Build a personal data inventory', 'Review privacy notices and consent flows', 'Prepare a DPIA', 'Draft a breach response checklist'],
          skills: ['GDPR', 'DPDP Act 2023', 'Data mapping', 'DPIA'],
          eligibility: 'Enrolled in the GRC mentorship program.',
          months: [1, 3, 6] },
        { id: 'ai-governance', title: 'AI Governance Intern', track: 'GRC',
          summary: 'Help organisations use AI responsibly and compliantly.',
          description: 'You support AI governance work: inventorying AI systems, assessing AI risks with the NIST AI Risk Management Framework, mapping controls to ISO/IEC 42001 and checking obligations under emerging AI rules such as the EU AI Act.',
          tasks: ['Build an inventory of AI systems and their data', 'Run an AI risk assessment (NIST AI RMF)', 'Map controls to ISO/IEC 42001', 'Draft an acceptable-use policy for AI tools'],
          skills: ['AI governance', 'NIST AI RMF', 'ISO/IEC 42001', 'AI risk assessment', 'Policy writing'],
          eligibility: 'Enrolled in the GRC mentorship program.',
          months: [1, 3, 6] }
      ]
    }
  ];
  var SELECTION = ['Apply below with your details', 'Short screening call with the Yojo team', 'A small practical task in your track', 'Interview with the mentor and an offer letter'];

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var li = function (a) { return '<ul class="pg-list">' + a.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'; };
  var css = document.createElement('style');
  css.textContent = '.pg-card{display:flex;flex-direction:column;gap:.7rem;color:var(--text);text-decoration:none;transition:border-color .2s,transform .2s}a.pg-card:hover,a.pg-card:focus-visible{border-color:var(--green);transform:translateY(-2px)}' +
    '.pg-card .go{margin-top:auto;font:600 .85rem var(--f-mono,inherit);color:var(--green)}.pg-hero{display:grid;gap:1rem}.pg-hero h1{font-size:clamp(1.7rem,4vw,2.6rem)}' +
    '.pg-meta{display:flex;flex-wrap:wrap;gap:.5rem}.pg-pill{font:600 .78rem var(--f-mono,inherit);padding:.3rem .7rem;border-radius:999px;border:1px solid var(--glass-line,#2a3346);color:var(--muted,#9aa9c2)}' +
    '.pg-list{margin:.3rem 0 0 1.1rem;padding:0;display:grid;gap:.25rem;color:var(--muted,#c8d3e6)}.pg-intern{display:grid;gap:.6rem;align-content:start}.pg-intern h3{font-size:1.15rem}' +
    '.pg-track{font:700 .72rem var(--f-mono,inherit);letter-spacing:.08em;text-transform:uppercase}.pg-facts{display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem}' +
    '.pg-facts div{border:1px solid var(--glass-line,#2a3346);border-radius:10px;padding:.5rem .6rem}.pg-facts small{display:block;color:var(--muted,#9aa9c2);font-size:.72rem}.pg-facts b{font-size:.9rem}' +
    '.pg-mo{display:inline-block;margin:.15rem .3rem 0 0;padding:.1rem .45rem;border-radius:6px;border:1px solid var(--green);color:var(--green);font:700 .78rem var(--f-mono,inherit)}' +
    '.pg-intern details summary{cursor:pointer;color:var(--green);font-weight:600;list-style:none}.pg-intern details summary::-webkit-details-marker{display:none}.pg-intern details[open] summary{margin-bottom:.6rem}' +
    '.pg-det{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.pg-det h4{font-size:.85rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted,#9aa9c2);margin:0}' +
    '@media(max-width:760px){.pg-facts{grid-template-columns:1fr 1fr}.pg-det{grid-template-columns:1fr}}';
  document.head.appendChild(css);

  function internCard(p, x) {
    var col = TRACK[x.track] || 'var(--green)';
    return '<article class="card pg-intern" id="in-' + esc(x.id) + '" style="border-top:3px solid ' + col + '">' +
      '<span class="pg-track" style="color:' + col + '">' + esc(x.track) + '</span><h3>' + esc(x.title) + '</h3><p class="lead" style="font-size:.95rem">' + esc(x.summary) + '</p>' +
      '<div class="pg-facts"><div><small>Duration</small><b>' + x.months.map(function (m) { return '<span class="pg-mo">' + m + 'M</span>'; }).join('') + '</b></div><div><small>Mode</small><b>' + esc(MODE) + '</b></div><div><small>Schedule</small><b>' + esc(SCHEDULE) + '</b></div></div>' +
      '<details><summary>View details ▸</summary><p>' + esc(x.description) + '</p>' +
      '<div class="pg-det" style="margin-top:.8rem"><div><h4>What you will do</h4>' + li(x.tasks) + '</div><div><h4>Skills you gain</h4>' + li(x.skills) + '</div>' +
      '<div><h4>Eligibility</h4><p style="color:var(--muted,#c8d3e6);margin-top:.3rem">' + esc(x.eligibility) + '</p></div><div><h4>Certificate</h4><p style="color:var(--muted,#c8d3e6);margin-top:.3rem">' + esc(CERT) + '</p></div></div>' +
      '<h4 style="margin-top:.8rem;font-size:.85rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted,#9aa9c2)">Selection process</h4>' + li(SELECTION) +
      '<p class="note" style="margin-top:.6rem">Next batch dates announced soon.</p></details>' +
      '<div style="display:flex;gap:.6rem;flex-wrap:wrap"><button class="btn btn-primary btn-sm" type="button" data-apply="' + esc(x.id) + '">Apply</button></div></article>';
  }

  function render(slug) {
    var el = document.getElementById('pgDetail'); if (!el) return;
    var p = PROGRAMS.filter(function (x) { return x.slug === slug; })[0];
    if (!p) { el.innerHTML = '<p class="lead">This program was not found. <a href="#internships" data-go="internships">Back to internships</a></p>'; return; }
    document.title = p.title + ' · Yojo Cyber Academy';
    el.innerHTML = '<nav class="cx-crumb" aria-label="Breadcrumb"><a href="#home">Home</a><span aria-hidden="true">›</span><a href="#internships">Internships</a><span aria-hidden="true">›</span><span aria-current="page">' + esc(p.title) + '</span></nav>' +
      '<div class="pg-hero"><span class="eyebrow">Our programs</span><h1>' + esc(p.title) + '</h1><p class="lead">' + esc(p.tagline) + '</p>' +
      '<div class="pg-meta"><span class="pg-pill">' + p.internships.length + ' internships</span><span class="pg-pill">' + esc(p.length) + '</span><span class="pg-pill">Next batch dates announced soon</span></div></div>' +
      '<div class="grid g2" style="margin-top:1.6rem;align-items:start"><div class="card"><h2 style="font-size:1.2rem">About the program</h2><p style="margin-top:.5rem;color:var(--muted,#c8d3e6)">' + esc(p.overview) + '</p>' +
      '<h3 style="font-size:1rem;margin-top:1rem">Who it is for</h3><p style="margin-top:.3rem;color:var(--muted,#c8d3e6)">' + esc(p.who) + '</p></div>' +
      '<div class="card"><h2 style="font-size:1.2rem">How it works</h2>' + li(p.structure) + '<p class="note" style="margin-top:.8rem">Fees, stipends and batch dates are shared by the Yojo team when you apply.</p></div></div>' +
      '<div class="sec-head" style="margin-top:2.2rem"><span class="eyebrow">Internships in this program</span><h2>Choose your internship</h2></div>' +
      '<div class="grid g2" style="align-items:start">' + p.internships.map(function (x) { return internCard(p, x); }).join('') + '</div>' +
      '<div class="card" id="pgApply" style="margin-top:2rem;padding:clamp(1.2rem,3vw,2rem)"><span class="eyebrow">Apply</span><h3 style="font-size:1.4rem;margin:.6rem 0 1rem">Apply for ' + esc(p.short) + ' internships</h3>' +
      '<form class="form" data-form="program" data-program="' + esc(p.slug) + '"><div class="two"><div class="field"><label for="p-name">Full name</label><input id="p-name" required placeholder="Your name"></div>' +
      '<div class="field"><label for="p-mail">Email</label><input id="p-mail" type="email" required placeholder="you@example.com"></div></div>' +
      '<div class="field"><label for="p-topic">Internship</label><select id="p-topic">' + p.internships.map(function (x) { return '<option value="' + esc(p.short + ' · ' + x.title) + '" data-id="' + esc(x.id) + '" data-months="' + x.months.join(',') + '">' + esc(x.title) + '</option>'; }).join('') + '</select></div>' +
      '<div class="two"><div class="field"><label for="p-dur">Duration</label><select id="p-dur"></select></div><div class="field"><label for="p-mode">Mode</label><select id="p-mode"><option>Offline (preferred)</option><option>Online</option></select></div></div>' +
      '<div class="field"><label for="p-why">About you</label><textarea id="p-why" placeholder="Your college or experience, and why this internship."></textarea></div>' +
      '<label class="consent"><input type="checkbox" id="p-ok" required>I agree to be contacted by Yojo Solutions about my application.</label>' +
      '<button class="btn btn-primary" type="submit">Submit application</button><div class="ok" hidden><svg class="i"><use href="#i-check"/></svg>Application received. We will be in touch soon.</div></form></div>';
    var topic = document.getElementById('p-topic'), dsel = document.getElementById('p-dur');
    var fillDur = function () { var o = topic.selectedOptions[0]; dsel.innerHTML = o.dataset.months.split(',').map(function (m) { return '<option>' + mo(+m) + '</option>'; }).join(''); };
    topic.addEventListener('change', fillDur); fillDur();
    el.querySelectorAll('[data-apply]').forEach(function (b) {
      b.addEventListener('click', function () {
        var sel = document.getElementById('p-topic'), o = sel.querySelector('[data-id="' + b.dataset.apply + '"]');
        if (o) { sel.value = o.value; fillDur(); }
        document.getElementById('pgApply').scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(function () { document.getElementById('p-name').focus({ preventScroll: true }); }, 500);
      });
    });
  }
  // without the Yojo API (demo), the form only confirms on screen; with the API, site-live.js sends it first
  document.addEventListener('submit', function (e) {
    var f = e.target; if (!f || f.dataset.form !== 'program') return;
    e.preventDefault();
    if (!f.checkValidity()) { f.reportValidity(); return; }
    f.querySelector('.ok').hidden = false; f.reset();
  });
  window.YojoPrograms = { list: PROGRAMS, render: render };
  // opened straight on a program link: the router ran before this file loaded
  var h = decodeURIComponent((location.hash || '').slice(1));
  if (h.indexOf('program/') === 0) render(h.slice(8));
})();
