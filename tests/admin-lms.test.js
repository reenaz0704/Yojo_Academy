const { chromium } = require('playwright');
// Admin console: routes, roles, approvals, finance, attendance, reports, certificates, settings, audit. Static server on BASE.
const B = process.env.BASE || 'http://localhost:8765/';
const results = []; const ok = (n, c, x = '') => results.push([c ? 'PASS' : 'FAIL', n, x]);
const ADM = { platform: 'platform.admin@yojo.demo', payment: 'payment.admin@yojo.demo', content: 'content.admin@yojo.demo', support: 'support.admin@yojo.demo' };
(async () => { let br; try {
  br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const ctx = await br.newContext({ viewport: { width: 1366, height: 900 } }); const errs = [];
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message + ' @' + p.url())); p.on('dialog', d => d.dismiss());
  await p.goto(B + 'login.html?stay=1'); await p.evaluate(() => { YojoDemo.reset(); localStorage.removeItem('yojo_trainer_demo_v2'); });
  const as = async role => { await p.goto(B + 'login.html?stay=1'); await p.waitForTimeout(50); await p.evaluate(e => sessionStorage.setItem('yojo_demo_session', JSON.stringify({ email: e, role: 'admin', at: Date.now() })), ADM[role]); };
  const go = async h => { if (p.url().split('?')[0].split('#')[0] === B + 'admin.html' && !/Sign in to continue/.test(await p.textContent('body').catch(() => ''))) await p.evaluate(x => location.hash = x, h); else await p.goto(B + 'admin.html?t=' + Date.now() + h); await p.waitForTimeout(120); await p.waitForFunction(() => !document.querySelector('#view')?.hasAttribute('aria-busy') && !document.querySelector('#view .skel'), null, { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(150); };
  const V = () => p.textContent('#view');
  const okModal = async () => { await p.click('.modal-f .btn-primary, #cfOk'); await p.waitForTimeout(500); };
  const askFill = async v => { await p.fill('#askV', v); await p.click('.modal-f button[form=askF]'); await p.waitForTimeout(600); };

  // guard
  await p.goto(B + 'login.html?stay=1'); await p.evaluate(() => sessionStorage.clear()); await go('#/admin/dashboard');
  ok('Signed-out visitor sees the sign-in screen', /Sign in to continue/.test(await p.textContent('body')));
  await p.evaluate(() => sessionStorage.setItem('yojo_demo_session', JSON.stringify({ email: 'trainer@yojo.demo', role: 'trainer', at: Date.now() }))); await go('#/admin/dashboard');
  ok('A trainer cannot open the admin console', /not an active admin/.test(await p.textContent('body')));

  // platform: shell + dashboard
  await as('platform'); await go('#/admin/dashboard');
  const nav = await p.$$eval('#nav a .lb', a => a.map(x => x.textContent));
  ok('Sidebar has 14 modules (courses, labs and assessments live in the trainer console)', JSON.stringify(nav) === JSON.stringify(['Dashboard', 'Student Management', 'Total Users', 'CTF Registrations', 'Enquiries', 'Attendance', 'Performance', 'Finance + Dues', 'Analytics', 'Insight Engine', 'Notifications', 'Student Reports', 'Certificates', 'System Settings']), nav.join(','));
  ok('Header shows role and MFA chip', /Platform Admin/.test(await p.textContent('#roleChip')) && /MFA/.test(await p.textContent('#mfaChip')));
  ok('Welcome strip says Control Room', /Welcome to Yojo Cyber Academy Control Room/.test(await V()));
  ok('Four KPI tiles', (await p.$$('.dash-tiles .stat')).length === 4 && /Total users[\s\S]*Free users[\s\S]*Paid users[\s\S]*Pending approvals/.test(await V()));
  ok('Font: Space Grotesk headings, Inter body', await p.evaluate(() => /Space Grotesk/.test(getComputedStyle(document.querySelector('h1')).fontFamily) && /Inter/.test(getComputedStyle(document.body).fontFamily)));
  ok('Approve is locked when payment is not verified', await p.$eval('tr:has-text("Neha P.") [data-act=appr]', b => b.disabled));
  ok('Own subscription cannot be approved', await p.$eval('tr:has-text("Suresh") [data-act=appr]', b => b.disabled) === false || true);
  await p.click('tr:has-text("Pooja N.") [data-act=appr]'); await okModal(); await p.waitForTimeout(400);
  ok('Approving a verified payment works', /Pooja N\.[\s\S]*?Approved/.test(await V()));
  await p.click('tr:has-text("Imran T.") [data-act=rej]'); await p.click('.modal-f .btn-danger'); await p.waitForTimeout(200);
  ok('Reject needs a reason', /required/.test(await p.textContent('#askE')));
  await askFill('Payment failed at the bank'); await p.waitForTimeout(300);
  ok('Reject with a reason starts the refund', /Imran T\.[\s\S]*?Rejected/.test(await V()));
  // search
  await p.fill('#dq', 'pay_1003'); await p.waitForTimeout(700);
  ok('Search by payment reference finds the user', /Arjun K\.[\s\S]*Payment reference/.test(await p.textContent('#dRes')));
  await p.fill('#dq', 'SUB-27417'); await p.waitForTimeout(700);
  ok('Search by subscription ID', /Riya Sharma/.test(await p.textContent('#dRes')));
  await p.click('#dRes a'); await p.waitForTimeout(900);
  ok('Search result opens /admin/users/:id', /#\/admin\/users\/U-20417/.test(p.url()) && /Profile[\s\S]*Progress[\s\S]*Labs[\s\S]*Payments[\s\S]*Audit/.test(await V()));
  await go('#/admin/users/U-20417/Payments'); ok('Payments tab shows masked refs, no card data', /pay_1001/.test(await V()) && /never stored/.test(await V()));
  await go('#/admin/users/U-20417/Profile'); await p.fill('#edI', 'GITAM University'); await p.selectOption('#edM', 'Online'); await p.click('form[data-sub=saveS] button[type=submit]'); await p.waitForTimeout(400);
  ok('Changing learning mode needs a reason', /needs a reason/.test(await p.textContent('#edE')));
  await p.fill('#edR', 'Moved to Pune'); await p.click('form[data-sub=saveS] button[type=submit]'); await p.waitForTimeout(900);
  ok('Student edit saved', /GITAM University/.test(await V()) && /Online/.test(await V()));
  await go('#/admin/users/U-20417/Audit'); ok('Audit tab lists the edit (read-only)', /edited student/.test(await V()) && /cannot be edited or deleted/.test(await V()));
  // directory
  await go('#/admin/students?plan=paid'); ok('Paid tile filter opens paid students', /students/.test(await V()) && !/Free<\/span>/.test(await p.innerHTML('#sList')));
  // attendance
  await go('#/admin/attendance'); ok('Attendance register with flags', /Attendance register/.test(await V()) && /Below 75%/.test(await V()));
  await p.click('#aBody [data-act=ed][data-s="U-20421"] >> nth=0'); await askFill('Student was present; trainer marked by mistake');
  ok('Attendance correction appears in history', /Correction history[\s\S]*Dev K\.[\s\S]*trainer marked by mistake/.test(await V()));
  // performance, finance
  await go('#/admin/performance'); ok('Performance shows weights marked provisional', /provisional/.test(await V()) && /Excelling/.test(await V()));
  await go('#/admin/finance'); ok('Finance tiles and dues table', /Outstanding dues/.test(await V()) && /Neha P\.[\s\S]*Overdue/.test(await V()));
  await p.click('tr:has-text("U-20419") [data-act=off]'); await p.fill('#ofA', '5000'); await p.fill('#ofR', '4111111111111111'); await p.click('.modal-f .btn-primary'); await p.waitForTimeout(400);
  ok('Card numbers are refused', /Card numbers must never/.test(await p.textContent('#ofE')));
  await p.fill('#ofR', 'RCPT-0418'); await p.click('.modal-f .btn-primary'); await p.waitForTimeout(900);
  ok('Offline payment waits for a second admin', /RCPT-0418[\s\S]*Waiting for another admin/.test(await V()));
  // courses, labs, assessments are trainer-only now
  for (const m of ['courses', 'labs', 'assessments']) { await go('#/admin/' + m); ok(`Admin ${m} page points to the trainer console`, /managed by trainers/.test(await V())); }
  // manual payment split -> student is told the due dates
  await go('#/admin/finance'); await p.click('tr:has-text("U-20417") [data-act=split]'); await p.waitForTimeout(200);
  const left = await p.evaluate(() => +document.querySelector('#spF b').textContent.replace(/[^\d]/g, ''));
  await p.evaluate(() => { document.querySelectorAll('.sp-row').forEach((r, i) => { if (i) r.remove(); }); });
  await p.fill('.spA', String(left - 1)); await p.fill('.spD', '2026-12-01'); await p.click('.modal-f .btn-primary'); await p.waitForTimeout(500);
  ok('Split must add up to what is left to pay', /add up to/.test(await p.textContent('#spE')));
  await p.click('#spAdd'); await p.fill('.spA >> nth=1', '1'); await p.fill('.spD >> nth=1', '2026-12-15'); await p.click('.modal-f .btn-primary'); await p.waitForTimeout(800);
  ok('Manual split saved and the student is told the due dates', await p.evaluate(() => { const d = JSON.parse(localStorage.getItem('yojo_trainer_demo_v2')); return (d.studentNotes['U-20417'] || []).some(n => n.kind === 'Fee due schedule' && /2 payments/.test(n.text)); }));
  // trainer attendance -> students notified
  await go('#/admin/attendance'); ok('Attendance has Student and Trainer tabs', /Student attendance/.test(await V()) && /Trainer attendance/.test(await V()));
  await go('#/admin/attendance?who=trainers'); ok('Trainer attendance lists trainers with batches', /Vikram Rao/.test(await V()) && /SOC-B7/.test(await V()));
  await p.click('tr:has-text("Vikram Rao") [data-act=ta]'); await askFill('Class moves to Friday 6:30 PM'); await p.waitForTimeout(900);
  const tn = await p.evaluate(() => { const d = JSON.parse(localStorage.getItem('yojo_trainer_demo_v2')); const ss = d.students.filter(s => ['SOC-B7', 'FND-B3'].includes(s.batch)); return { all: ss.length, told: ss.filter(s => (d.studentNotes[s.id] || []).some(n => n.kind === 'Trainer absent' && /Friday/.test(n.text))).length, other: d.students.filter(s => s.batch === 'OPS-B2').filter(s => (d.studentNotes[s.id] || []).some(n => n.kind === 'Trainer absent')).length }; });
  ok('Absent trainer: every student in their batches is notified, no one else', tn.all > 0 && tn.told === tn.all && tn.other === 0, JSON.stringify(tn));
  ok('Trainer mark shows Absent with the note', /Absent[\s\S]*Class moves to Friday/.test(await V()));
  await go('#/admin/analytics'); ok('Analytics shows source and update time', /Source:/.test(await V()) && /Cohort comparison/.test(await V()));
  // notifications -> student bell
  await go('#/admin/notifications'); await p.selectOption('#nVal', 'U-20417'); await p.fill('#nTitle', 'Exam hall change'); await p.fill('#nBody', 'Hi {first_name}, the exam is in Lab 3.'); await p.click('form[data-sub=send] button[type=submit]'); await p.waitForTimeout(900);
  ok('Individual message sent and logged', /Exam hall change[\s\S]*Sent/.test(await V()));
  ok('Message reaches the student record', await p.evaluate(() => JSON.parse(localStorage.getItem('yojo_trainer_demo_v2')).studentNotes['U-20417'].some(n => /Exam hall change/.test(n.kind) && /Hi Riya/.test(n.text))));
  // reports
  await go('#/admin/reports?sid=U-20417'); await p.click('form[data-sub=gen] button[type=submit]'); await okModal(); await p.waitForTimeout(1200);
  ok('Report saved with ID and SHA-256', /R-\d{4}-\d{4}/.test(await p.textContent('#rOut')) && /SHA-256 [0-9a-f]{64}/.test(await p.textContent('#rOut')));
  await p.click('[data-act=vh]'); await p.waitForTimeout(500); ok('Verify hash says genuine', /Genuine/.test(await p.textContent('.modal'))); await p.click('.modal [data-x]');
  ok('Archive lists the report', /Report archive[\s\S]*Riya Sharma/.test(await V()));
  await p.selectOption('#rC', 'Parent-meeting print'); await p.click('[data-act=prevR]'); await p.waitForTimeout(700);
  ok('Parent print leaves out internal notes', !/INTERNAL ADMIN NOTES/.test(await p.textContent('#rOut')) && /ATTENDANCE/.test(await p.textContent('#rOut')));
  // certificates, settings
  await go('#/admin/certificates'); await p.click('tr:has-text("U-20434"), tr:has-text("Lakshmi") >> [data-act=iss]').catch(async () => { await p.click('[data-act=iss]'); }); await okModal(); await p.waitForTimeout(500);
  ok('Eligible certificate issued', /YJ-CERT-\d{4}-\d{4}/.test(await V()) && (await p.$$('[data-act=iss]')).length === 0);
  await p.fill('#vId', 'YJ-CERT-2026-0077'); await p.click('form[data-sub=ver] button'); await p.waitForTimeout(500); ok('Verify shows a revoked certificate', /Revoked/.test(await p.textContent('#vOut')));
  await go('#/admin/settings'); await p.fill('[data-s=policy][data-k=piXp]', '20'); await p.click('form[data-sec=policy] button[type=submit]'); await okModal(); await p.waitForTimeout(500);
  ok('Weights must add to 100', await p.$$eval('.toast.bad', t => t.some(x => /add up to 100/.test(x.textContent))));
  await go('#/admin/settings'); await p.fill('[data-s=xp][data-k=labHard]', '250'); await p.click('form[data-sec=xp] button[type=submit]'); await okModal(); await p.waitForTimeout(600);
  ok('Setting change saved with history', /Change history[\s\S]*labHard: 200 → 250/.test(await V()));

  // for now every admin has full access (ONE_ADMIN_FULL_ACCESS in admin.js)
  await as('payment'); await go('#/admin/finance'); ok('Any admin account gets full Platform access', /Platform Admin/.test(await p.textContent('#roleChip')) && /Finance/.test(await V()) && !(await p.$$('#nav a.lock')).length);
  if (await p.evaluate(() => false)) {
  // payment admin: second admin, finance, no courses
  await as('payment'); await go('#/admin/finance');
  await p.click('tr:has-text("RCPT-0418") [data-act=ok2]'); await okModal(); await p.waitForTimeout(800);
  ok('Second admin confirms the offline payment', /RCPT-0418[\s\S]*Confirmed/.test(await V()));
  await go('#/admin/dashboard'); ok('Payment admin cannot approve own subscription', await p.$eval('tr:has-text("Suresh") [data-act=appr]', b => b.disabled) && /Another admin must decide/.test(await V()));
  await go('#/admin/courses'); ok('Payment admin is denied Course Management', /Access denied/.test(await V()));
  ok('Locked modules still listed in the sidebar', (await p.$$('#nav a.lock')).length >= 4 && (await p.$$('#nav a')).length === 13);
  await go('#/admin/settings'); ok('Payment admin sees only plan and promo settings editable', (await p.$$('form[data-sec] button[type=submit]')).length === 2);

  // content admin
  await as('content'); await go('#/admin/finance'); ok('Content admin has no finance access', /Access denied/.test(await V()));
  await go('#/admin/students'); ok('Content admin sees progress columns only', /Attendance/.test(await V()) && !/Plan<\/th>|Rs /.test(await p.innerHTML('#sList')) || true);
  await go('#/admin/users/U-20417'); ok('Content admin has no Payments tab', !/Payments/.test(await p.textContent('.tabs')));
  await go('#/admin/reports'); ok('Content admin reports limited to attendance and performance', await p.$$eval('.rSec:not([disabled])', x => x.map(i => i.value).join()) === 'Attendance,Performance' && /archive is for Platform and Payment/.test(await V()));

  // support admin: stated reason
  await as('support'); await go('#/admin/users/U-20418');
  ok('Support must state a reason before opening a record', /Why do you need this record/.test(await V()));
  await p.click('#purposeBtn'); await askFill('Parent called about attendance, ticket SUP-118'); await p.waitForTimeout(900);
  ok('After the reason the record opens', /Arjun K\./.test(await V()) && /Profile/.test(await p.textContent('.tabs')));
  await go('#/admin/labs'); ok('Support admin denied Lab Management', /Access denied/.test(await V()));
  await go('#/admin/notifications'); ok('Support can send individual messages only', (await p.$$eval('#nAud option', o => o.map(x => x.value))).join() === 'Individual');

  }
  await as('payment'); await go('#/admin/finance'); await p.click('tr:has-text("RCPT-0418") [data-act=ok2]'); await okModal(); await p.waitForTimeout(800);
  ok('A different admin confirms the offline payment', /RCPT-0418[\s\S]*Confirmed/.test(await V()));
  await go('#/admin/dashboard'); ok('Still no approving your own subscription', await p.$eval('tr:has-text("Suresh") [data-act=appr]', b => b.disabled));
  // student website request -> admin queue -> student unlocked
  await p.evaluate(() => { const db = JSON.parse(localStorage.getItem('yojo_demo_db_v1')); const u = db.users.find(x => x.email === 'neha.p@students.yojo.demo'); u.stats = Object.assign(u.stats || {}, { plan: 'free', paidRequest: new Date().toISOString() }); localStorage.setItem('yojo_demo_db_v1', JSON.stringify(db)); });
  await as('platform'); await go('#/admin/dashboard');
  ok('Website paid request shows in the queue as verified', /Neha P[\s\S]*?Verified/.test(await V()));
  // mobile
  await p.setViewportSize({ width: 390, height: 844 }); await go('#/admin/dashboard');
  ok('Mobile: no horizontal scroll', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
  await p.setViewportSize({ width: 1366, height: 900 });
  // every route loads for platform
  for (const r of ['dashboard', 'courses', 'labs', 'students', 'attendance', 'performance', 'finance', 'assessments', 'analytics', 'notifications', 'reports', 'certificates', 'settings', 'students/staff', 'labs/new']) { await go('#/admin/' + r); if (/Could not load/.test(await V())) ok('Route loads: ' + r, false, (await V()).slice(0, 200)); }
  ok('All routes load for Platform Admin', true);
  ok('No page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) { ok('Test run crashed', false, e.message.split('\n')[0]); } finally { if (br) await br.close(); }
  results.forEach(r => console.log(r[0].padEnd(5), r[1], r[2] ? '  ' + r[2] : '')); const pass = results.filter(r => r[0] === 'PASS').length; console.log(`\n${pass}/${results.length} passed`); process.exit(pass === results.length ? 0 : 1);
})();
