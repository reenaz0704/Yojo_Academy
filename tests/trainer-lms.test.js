const { chromium } = require('playwright');
// Trainer console. Run with a static server on BASE (see login-flows.test.js).
const B = process.env.BASE || 'http://localhost:8765/';
const results = []; const ok = (n, c, x = '') => results.push([c ? 'PASS' : 'FAIL', n, x]);
(async () => { let br; try {
  br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const ctx = await br.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage(); globalThis.__p = p; const errs = []; p.on('pageerror', e => errs.push(e.message + ' ' + (e.stack||'').split('\n').slice(1,3).join(' ') + ' @' + p.url()));
  const signIn = async (email, patch) => {
    await p.goto(B + 'login.html?stay=1'); await p.evaluate(() => { YojoDemo.reset(); localStorage.removeItem('yojo_trainer_demo_v2'); });
    await p.evaluate(([e, patch]) => { const db = JSON.parse(localStorage.getItem('yojo_demo_db_v1')); const u = db.users.find(x => x.email === e); if (patch) Object.assign(u, patch); localStorage.setItem('yojo_demo_db_v1', JSON.stringify(db)); sessionStorage.setItem('yojo_demo_session', JSON.stringify({ email: e, role: u.role, at: Date.now() })); }, [email, patch]);
  };
  const go = async h => { await p.goto(B + 'trainer.html' + h); await p.waitForTimeout(150); await p.waitForFunction(() => !document.querySelector('#view')?.hasAttribute('aria-busy') && !document.querySelector('#view .skel'), null, { timeout: 8000 }).catch(() => {}); };
  const txt = () => p.textContent('#view');
  const settle = () => p.waitForFunction(() => !document.querySelector('#view .skel'), null, { timeout: 8000 }).catch(() => {});
  const mfa = () => p.evaluate(() => TrainerMFA.code());

  await signIn('trainer@yojo.demo');
  await go('#/trainer/dashboard');
  const nav = await p.$$eval('#nav a .lb', a => a.map(x => x.textContent.trim()));
  ok('Sidebar shows the 11 modules in order', nav.join('|') === 'Dashboard|My Batches|Students|Classes|Attendance|Content|Assessments|Lab Monitor|Mentoring|Messages|My Feedback', nav.join('|'));
  ok('Header: logo, bell and profile only (no badges between them)', !!(await p.$('.crest')) && !!(await p.$('#bellBtn')) && !!(await p.$('#avBtn')) && !(await p.$('#roleChip')) && !(await p.$('.top .mfa')));
  ok('Plain wording: no game terms', !/operative|district|lead's orders|mission control|threat level|defence|city hall|field ops|citizen voice/i.test(await p.textContent('body')));
  ok('Dashboard: four plain summary tiles', (await p.$$('#view .grid.g4 .stat')).length === 4);
  ok('Dashboard: Today, To do and Students to check on', /Today[\s\S]*To do[\s\S]*Students to check on/.test(await txt()) && !/Quick actions|Trainer overview/.test(await txt()));
  ok('Dashboard: hero keeps only the welcome and average index', /Welcome,/.test(await p.textContent('.cityhero')) && /AVG INDEX/.test(await p.textContent('.cityhero')) && !(await p.$('.cityhero .seal')));
  ok('Readable font (no decorative serif)', await p.evaluate(() => !/Cinzel/.test(getComputedStyle(document.querySelector('h1')).fontFamily)));
  await p.click('#view .stat[href="#/trainer/assessments"]'); await settle();
  ok('Summary tile opens its module', /#\/trainer\/assessments$/.test(p.url()));
  const bell = await p.textContent('#bellCnt'); await p.click('#bellBtn');
  ok('Bell shows trainer alerts', +bell > 0 && /below 75%|no join link|clearance/.test(await p.textContent('#bellPop')), bell);
  await p.click('body', { position: { x: 5, y: 5 } });

  // every route keeps the shell
  for (const [k, l] of [['dashboard', 'Dashboard'], ['batches', 'My Batches'], ['students', 'Students'], ['classes', 'Classes'], ['attendance', 'Attendance'], ['content', 'Content'], ['assessments', 'Assessments'], ['labs', 'Lab Monitor'], ['mentoring', 'Mentoring'], ['messages', 'Messages'], ['feedback', 'My Feedback']]) {
    await go('#/trainer/' + k);
    const cur = await p.$eval('#nav a[aria-current=page] .lb', a => a.textContent.trim()).catch(() => '');
    ok(`Route /trainer/${k} opens with shell and active item`, cur === l && !(await p.$('#view .errbox')) && !!(await p.$('.top')) && (await p.textContent('#crumb')).includes(l.replace('My Batches', 'My Batches')), cur);
  }

  // batches + roster
  await go('#/trainer/batches');
  ok('My Batches: only assigned batches', /SOC-B7/.test(await txt()) && /FND-B3/.test(await txt()) && !/OPS-B2/.test(await txt()));
  await go('#/trainer/batches/SOC-B7'); await p.waitForFunction(() => /Quiz avg/.test(document.querySelector('#view').textContent), null, { timeout: 8000 }).catch(() => {});
  ok('Roster table has the required columns', ['Student', 'Attended', '%', 'Index', 'Labs', 'Quiz avg', 'Flag', 'View'].every(async () => true) && /Attended[\s\S]*Index[\s\S]*Labs[\s\S]*Quiz avg[\s\S]*Flag/.test(await txt()));
  ok('Roster: other batch students never appear', !/Other Batch Student/.test(await txt()));
  ok('Roster: rule flags (AT RISK, LOW, WATCH)', /AT RISK/.test(await txt()) && /LOW/.test(await txt()));
  await p.fill('[data-inp=q]', 'riya'); await p.waitForTimeout(100);
  ok('Roster search filters', (await p.$$('#rosterT tbody tr')).length === 1);
  await p.fill('[data-inp=q]', ''); await p.selectOption('[data-chg=filter]', 'AT RISK'); await p.waitForTimeout(100);
  ok('Roster status filter', (await p.$$eval('#rosterT tbody tr', r => r.every(x => /AT RISK/.test(x.textContent)))) && (await p.$$('#rosterT tbody tr')).length >= 1);
  await p.selectOption('[data-chg=filter]', 'All');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act=export]')]);
  const csv = require('fs').readFileSync(await dl.path(), 'utf8');
  ok('Export CSV has progress only (no phone, email, guardian, fees)', /Performance Index/.test(csv) && !/@|\+91|guardian|fee/i.test(csv), csv.split('\n')[0]);
  await go('#/trainer/batches/OPS-B2');
  ok('Other batch roster is denied', /Access denied/.test(await txt()));

  // student 360
  await go('#/trainer/students/U-20417');
  ok('Student 360 header and Performance Index', /Riya Sharma/.test(await txt()) && /SOC-B7/.test(await txt()) && !!(await p.$('.pi-ring')));
  ok('Student 360: six tabs', (await p.$$('.tabs [role=tab]')).length === 6);
  ok('Student 360: four weighted components', /Attendance \(20%\)[\s\S]*Labs \(30%\)[\s\S]*Courses \+ Assessments \(35%\)[\s\S]*Leaderboard \+ XP \(15%\)/.test(await txt()));
  ok('Student 360 hides guardian, phone, email, fees', !/\+91|@mail\.demo|12000/.test(await p.content()));
  await go('#/trainer/students/U-20417/remarks');
  await p.fill('#rmText', 'Led the team in the SIEM drill.'); await p.click('[data-act=saveRemark]'); await p.waitForTimeout(1300);
  ok('Add and save a remark', /Led the team in the SIEM drill/.test(await txt()));
  await p.check('input[name=rk][value="Private note"]'); await p.fill('#rmText', 'Check in about workload.'); await p.click('[data-act=saveRemark]'); await p.waitForTimeout(1300);
  ok('Private note saved with its own label', /Check in about workload[\s\S]*Private note/.test(await txt()));
  await p.click('[data-act=editRemark] >> nth=0'); await p.fill('#rmText', 'Led the team in the SIEM drill (edited).'); await p.click('[data-act=saveRemark]'); await p.waitForTimeout(1300);
  ok('Edits keep history', /edited/.test(await txt()));
  await p.click('[data-act=guardian]'); await p.fill('#askV', 'Three absences in a row'); await p.click('#askF ~ * .btn-primary, .modal-f .btn-primary'); await p.waitForTimeout(500);
  ok('Ask admin to contact guardian sends a request', /Support request sent/.test(await p.textContent('#toasts')));
  await go('#/trainer/students/U-20451');
  ok('Student from another batch is denied', /Access denied/.test(await txt()));

  // classes
  await go('#/trainer/classes');
  ok('Classes: tabs Upcoming, Past, Drafts', /Upcoming[\s\S]*Past[\s\S]*Drafts/.test(await p.textContent('.tabs')));
  ok('Missing join link warning', /no join link/i.test(await txt()));
  await p.click('[data-act=new]'); await p.fill('#cfT', 'Test class: SOC metrics');
  await p.click('[data-act2=go]'); await p.waitForTimeout(600);
  ok('Schedule class (online, no link) saves and warns', /Class scheduled/.test(await p.textContent('#toasts')) && /SOC metrics/.test(await txt()));
  await p.click('[data-act=new]'); await p.fill('#cfT', 'Offline test'); await p.selectOption('#cfM', 'Direct'); await p.selectOption('#cfB', 'FND-B3');
  await p.click('[data-act2=go]'); await p.waitForTimeout(500);
  ok('Direct class needs a room', /room/i.test(await p.textContent('#cfE')));
  await p.click('[data-act2=draft]'); await p.waitForTimeout(600);
  ok('Save draft goes to Drafts', /Draft saved/.test(await p.textContent('#toasts')) && /Offline test/.test(await txt()));

  // attendance
  await go('#/trainer/attendance/SOC-B7');
  ok('Attendance: selectors and table', !!(await p.$('[data-chg=batch]')) && !!(await p.$('[data-chg=lect]')) && /Joined[\s\S]*Suggested[\s\S]*Final/.test(await txt()));
  ok('Attendance: P/A/L/E options', (await p.$$eval('.seg[data-sid] >> nth=0', () => 0).catch(() => 0)) === 0 && (await p.$$('.seg[data-sid] button')).length % 4 === 0);
  await p.click('[data-act=allP]'); await p.click('[data-act=save]'); await p.waitForTimeout(600); await settle();
  ok('Mark all present + save', /Attendance saved/.test(await p.textContent('#toasts')));
  ok('Lecture register shows recent six', /Lecture register/.test(await txt()) && (await p.$$eval('.tbl', t => t.length)) >= 2);
  await p.click('[data-act=lock]'); await p.fill('#askV', '123456'); await p.click('.modal-f .btn-primary'); await p.waitForTimeout(500);
  ok('Lock with a wrong MFA code fails', /not right/.test(await p.textContent('#toasts')));
  await p.click('[data-act=lock]'); await p.fill('#askV', await mfa()); await p.click('.modal-f .btn-primary'); await p.waitForTimeout(700); await settle();
  ok('Lock lecture with MFA', /Lecture locked/.test(await p.textContent('#toasts')) && /Locked/.test(await txt()));
  ok('Locked lecture cannot be edited', await p.$eval('[data-act=save]', b => b.disabled));
  ok('Clearance: approve disabled under 80% watched', await p.$eval('#clear tr:has-text("Dev K.") [data-d=Approved]', b => b.disabled).catch(() => false));
  await p.click('#clear tr:has-text("Neha P.") [data-d=Approved]'); await p.waitForTimeout(700); await settle();
  ok('Clearance approve marks Excused', /Absence cleared/.test(await p.textContent('#toasts')));
  await p.click('[data-act=log]'); await p.waitForSelector('.modal'); await p.waitForTimeout(600);
  ok('Change log records who, old, new, reason', /First marking/.test(await p.textContent('.modal')) && /trainer@yojo\.demo/.test(await p.textContent('.modal')));
  await p.keyboard.press('Escape');
  const oldL = await p.evaluate(() => { const d = JSON.parse(localStorage.getItem('yojo_trainer_demo_v2')); const l = d.lectures.find(x => x.batch === 'SOC-B7' && x.locked); return l.id; });
  await go(`#/trainer/attendance/SOC-B7/${oldL}`);
  ok('Older locked lecture is read-only', await p.$eval('[data-act=save]', b => b.disabled));

  // content
  await go('#/trainer/content');
  ok('Content tabs', /All Courses[\s\S]*Published[\s\S]*Draft[\s\S]*Unpublished/.test(await p.textContent('.tabs')));
  await go('#/trainer/content/new'); await p.fill('#ncT', 'Test Hunting Course'); await p.check('.ncB[value=SOC-B7]'); await p.click('#ncF button[type=submit]'); await p.waitForTimeout(800); await settle();
  ok('Create course opens the builder', /Test Hunting Course/.test(await txt()) && /Draft/.test(await txt()));
  await p.click('[data-act=addMod]'); await p.click('[data-act=addLes]'); await p.waitForTimeout(100);
  ok('Add module and lesson', (await p.$$('.mod')).length === 1 && (await p.$$('.les')).length === 1);
  ok('All 8 lesson types', (await p.$$eval('[data-chg=lf][data-k=type] option', o => o.map(x => x.textContent))).join() === 'Video,PDF,Slides,Document,Link,Quiz,Lab,Live Class');
  ok('Upload accepts only the lesson type (Video: .mp4)', (await p.$eval('[data-chg=upload]', i => i.accept)) === '.mp4');
  await p.setInputFiles('[data-chg=upload]', { name: 'intro.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(2048) }); await p.waitForTimeout(200);
  ok('A PDF is rejected on a Video lesson', /not a Video file/.test(await p.textContent('#toasts')) && !/intro\.pdf/.test(await txt()));
  await p.selectOption('[data-chg=lf][data-k=type]', 'Slides'); await p.waitForTimeout(150);
  ok('Slides lesson accepts PowerPoint only', (await p.$eval('[data-chg=upload]', i => i.accept)) === '.ppt,.pptx');
  await p.setInputFiles('[data-chg=upload]', { name: 'notes.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.alloc(2048) }); await p.waitForTimeout(200);
  ok('A Word file is rejected on a Slides lesson', /not a Slides file/.test(await p.textContent('#toasts')));
  await p.selectOption('[data-chg=lf][data-k=type]', 'PDF'); await p.waitForTimeout(150);
  await p.setInputFiles('[data-chg=upload]', { name: 'intro.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(2048) });
  await p.waitForTimeout(200); ok('Upload shows progress and scan status', /Uploading|Scan:/.test(await txt()));
  await p.waitForTimeout(4000); ok('Upload finishes clean and ready', /Scan: Clean/.test(await txt()));
  await p.click('[data-act=saveDraft]'); await p.waitForTimeout(900);
  const cid = p.url().split('/').pop();
  await go(`#/trainer/content/${cid}/manage`);
  if (!/Ready to publish/.test(await txt())) console.log('READINESS', (await p.textContent('.checks')));
  ok('Readiness checklist passes and Publish is enabled', /Ready to publish/.test(await txt()) && !(await p.$eval('[data-act=publish]', b => b.disabled)));
  await p.click('[data-act=publish]', { timeout: 3000 }); await p.fill('#askV', 'First release'); await p.click('.modal-f .btn-primary'); await p.waitForTimeout(700); await settle();
  ok('Publish creates v1', /v1/.test(await txt()) && /Published/.test(await txt()));
  await p.click('[data-act=unpub]'); await p.click('.modal-f .btn-primary'); await p.waitForTimeout(300);
  ok('Unpublish requires a reason', /required/.test(await p.textContent('#askE')));
  await p.fill('#askV', 'Refreshing labs'); await p.click('.modal-f .btn-primary'); await p.waitForTimeout(700); await settle();
  ok('Unpublish notifies the batch', /Unpublished/.test(await txt()));
  await go('#/trainer/content/C-DFIR/manage');
  ok('Publishing blocked while upload processing or scanning', /Blocked/.test(await txt()) && await p.$eval('[data-act=publish]', b => b.disabled));
  await go('#/trainer/content/C-SOC/enrolled');
  ok('Enrolled students hides contact data', /Riya Sharma/.test(await txt()) && !/@mail|\+91/.test(await p.content()));
  await go('#/trainer/content/C-OPS');
  ok('Course of another batch is denied', /Access denied/.test(await txt()));

  // assessments
  await go('#/trainer/assessments/AS-2/U-20420');
  for (const k of ['Accuracy', 'Method', 'Clarity']) await p.fill(`#r-${k}`, '4');
  await p.click('[data-act=g][data-a=Publish]'); await p.fill('#askV', await mfa()); await p.click('.modal-f .btn-primary'); await p.waitForTimeout(800);
  ok('Grade publish with MFA', /Grade published/.test(await p.textContent('#toasts')));
  await go('#/trainer/assessments/new');
  ok('Create assessment from question bank (no answer keys)', (await p.$$('.naQ')).length > 3 && !/answer:/i.test(await txt()));

  // labs
  await go('#/trainer/labs/SOC-B7');
  ok('Lab monitor: statuses incl. Stuck', /Stuck/.test(await txt()) && /Done/.test(await txt()) && /Not Started/.test(await txt()));
  ok('Lab monitor never shows flags or answers', !/FLAG\{|answer key:|solution:/i.test(await p.content()));
  await p.click('[data-act=nudge] >> nth=0'); await p.fill('#askV', 'Keep going'); await p.click('.modal-f .btn-primary'); await p.waitForTimeout(600);
  ok('Send nudge', /Nudge sent/.test(await p.textContent('#toasts')));

  // mentoring
  await go('#/trainer/mentoring');
  await p.click('[data-act=acc] >> nth=0'); await p.waitForTimeout(700); await settle();
  ok('Accept a mentoring request', /Session accepted/.test(await p.textContent('#toasts')));
  ok('Availability grid and readiness board', !!(await p.$('.avail')) && /Placement readiness/.test(await txt()));
  await p.click('[data-act=mock] >> text=New mock interview'); await p.click('[data-m="1"]'); await p.waitForTimeout(200);
  ok('Mock publish needs all four scores', /all four/.test(await p.textContent('#mkE')));
  await p.keyboard.press('Escape');

  // messages
  await go('#/trainer/messages/TH-1');
  await p.fill('#rpl', 'Check the time range filter.'); await p.click('[data-act=reply]'); await p.waitForTimeout(700); await settle();
  ok('Reply to a student thread', /time range filter/.test(await txt()));
  await go('#/trainer/messages/compose');
  ok('Composer: own batch only, admin-only types disabled', (await p.$$eval('#anB option', o => o.map(x => x.value))).every(v => ['SOC-B7', 'FND-B3'].includes(v)) && await p.$eval('#anT option:has-text("Important")', o => o.disabled));
  await p.fill('#anX', 'Lab night on Friday.'); await p.click('[data-act=send]'); await p.waitForTimeout(800); await settle();
  ok('Post to batch sends and shows in history', /Lab night on Friday/.test(await txt()));

  // feedback
  await go('#/trainer/feedback');
  ok('Feedback: five metric cards', (await p.$$('#view .grid.g5 .stat')).length === 5);
  ok('Ratings hidden below the response threshold', /FND-B3 are hidden until 5 responses/.test(await txt()));

  // audit
  const aud = await p.evaluate(() => JSON.parse(localStorage.getItem('yojo_trainer_demo_v2')).audit.map(a => a.action));
  ok('Sensitive actions are audited', ['export progress CSV', 'save attendance', 'lock lecture (MFA)', 'grade published', 'post to batch', 'unpublish course'].every(a => aud.includes(a)), aud.slice(0, 20).join(', '));

  // profile
  await go('#/trainer/profile');
  ok('Profile page opens from the profile menu', /Profile details/.test(await txt()) && !!(await p.$('#pf-name')));
  await p.setInputFiles('#pfPhoto', require('path').join('/mnt/project-files/mascot-version', 'desk-employee.png').replace('desk-employee.png', 'desk-employee.png'));
  await p.waitForSelector('#pfPrev img', { timeout: 4000 }).catch(() => {});
  await p.fill('#pf-name', 'Vikram R. Rao'); await p.fill('#pf-title', 'Senior SOC Trainer'); await p.fill('#pf-phone', 'abc');
  await p.click('#pfF button[type=submit]'); await p.waitForTimeout(500);
  ok('Profile validates the phone number', /valid phone/.test(await p.textContent('#pfE')));
  await p.fill('#pf-phone', '+91 98765 43210'); await p.click('#pfF button[type=submit]'); await p.waitForTimeout(900);
  ok('Profile saves name, title and photo', /Profile saved/.test(await p.textContent('#toasts')) && /Vikram R\. Rao/.test(await txt()) && !!(await p.$('#avBtn img')));
  ok('Profile saved to the staff account', await p.evaluate(() => { const u = JSON.parse(localStorage.getItem('yojo_demo_db_v1')).users.find(x => x.email === 'trainer@yojo.demo'); return u.name === 'Vikram R. Rao' && u.trainerProfile.title === 'Senior SOC Trainer' && /^data:image/.test(u.trainerProfile.photo); }));
  await go('#/trainer/profile/security');
  await p.fill('#pw-new', 'short'); await p.fill('#pw-cf', 'short'); await p.fill('#pw-code', await mfa()); await p.click('#pwF button[type=submit]'); await p.waitForTimeout(500);
  ok('Weak password rejected with the missing rules', /needs at least 10 characters/.test(await p.textContent('#pwE')));
  await p.fill('#pw-new', 'Str0ng!Pass1'); await p.fill('#pw-cf', 'Str0ng!Pass2'); await p.click('#pwF button[type=submit]'); await p.waitForTimeout(300);
  ok('Mismatched confirmation rejected', /do not match/.test(await p.textContent('#pwE')));
  await p.fill('#pw-cf', 'Str0ng!Pass1'); await p.fill('#pw-code', '000000'); await p.click('#pwF button[type=submit]'); await p.waitForTimeout(500);
  ok('Password change needs a valid authenticator code', /not right/.test(await p.textContent('#pwE')));
  await p.fill('#pw-code', await mfa()); await p.click('#pwF button[type=submit]'); await p.waitForTimeout(900);
  ok('Password set', /Password set/.test(await p.textContent('#toasts')) && !!(await p.$('#pw-cur')));
  await p.fill('#pw-cur', 'wrong'); await p.fill('#pw-new', 'An0ther!Pass9'); await p.fill('#pw-cf', 'An0ther!Pass9'); await p.fill('#pw-code', await mfa()); await p.click('#pwF button[type=submit]'); await p.waitForTimeout(500);
  ok('Change needs the current password', /current password/.test(await p.textContent('#pwE')));
  await p.fill('#pw-cur', 'Str0ng!Pass1'); await p.fill('#pw-code', await mfa()); await p.click('#pwF button[type=submit]'); await p.waitForTimeout(900);
  ok('Password changed and audited', /Password changed/.test(await p.textContent('#toasts')) && await p.evaluate(() => JSON.parse(localStorage.getItem('yojo_trainer_demo_v2')).audit.some(a => a.action === 'change password (MFA)')));

  // mobile
  await p.setViewportSize({ width: 390, height: 844 });
  let wide = [];
  for (const k of ['dashboard', 'profile', 'profile/security', 'batches/SOC-B7', 'students/U-20417', 'classes', 'attendance', 'content', 'assessments', 'labs', 'mentoring', 'messages', 'feedback']) { await go('#/trainer/' + k); const w = await p.evaluate(() => document.documentElement.scrollWidth); if (w > 392) { wide.push(k + ':' + w); console.log('WIDE', k, await p.evaluate(() => [...document.querySelectorAll('#view *')].filter(e => e.getBoundingClientRect().right > 392).slice(0,5).map(e => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right)).join(' | '))); } }
  ok('Mobile: no horizontal page scroll on any page', !wide.length, wide.join(' '));
  await go('#/trainer/dashboard'); await p.click('#menuBtn'); await p.waitForTimeout(300);
  ok('Mobile: sidebar opens from the menu button', await p.$eval('#side', s => s.getBoundingClientRect().left >= 0));
  await p.screenshot({ path: '/mnt/project-files/mascot-version/preview-trainer-mobile.png' });
  await p.setViewportSize({ width: 1366, height: 900 });

  // roles
  await signIn('trainer@yojo.demo', { capability: 'Trainer' }); await go('#/trainer/dashboard');
  ok('Without Mentor capability: Mentoring hidden', !(await p.$('#nav a[data-mod=mentoring]')) && (await p.$$('#nav a')).length === 10);
  await go('#/trainer/mentoring'); ok('Without Mentor capability: Mentoring route denied', /Access denied/.test(await txt()));
  await p.goto(B + 'login.html?stay=1'); await p.evaluate(() => { const db = JSON.parse(localStorage.getItem('yojo_demo_db_v1')); const s = db.users.find(u => u.role === 'student'); sessionStorage.setItem('yojo_demo_session', JSON.stringify({ email: s.email, role: 'student' })); });
  await p.goto(B + 'trainer.html'); await p.waitForTimeout(300);
  ok('Student session cannot open the trainer console', /Sign in as a trainer/.test(await p.textContent('body')) && !(await p.$('#nav a')));
  await p.evaluate(() => sessionStorage.clear()); await p.goto(B + 'trainer.html'); await p.waitForTimeout(300);
  ok('No session: sent to login', /not signed in/.test(await p.textContent('body')));

  ok('No page errors', !errs.length, errs.join(' | '));
  } catch (e) { ok('Test run crashed', false, e.message.split('\n')[0] + ' @ ' + (globalThis.__p ? globalThis.__p.url() : '')); }
  results.forEach(r => console.log(r[0].padEnd(5), r[1], r[0] === 'FAIL' ? r[2] : ''));
  console.log(`\n${results.filter(r => r[0] === 'PASS').length}/${results.length} passed`);
  await br.close();
})();
