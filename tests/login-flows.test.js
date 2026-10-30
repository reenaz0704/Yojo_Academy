const { chromium } = require('playwright');
// Run: python3 -m http.server 8765 --directory website  then  node website/tests/login-flows.test.js (needs playwright)
const B = process.env.BASE || 'http://localhost:8765/';
const results = []; let errors = [];
const ok = (name, cond, extra = '') => { results.push([cond ? 'PASS' : 'FAIL', name, extra]); };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // the analytics consent banner is tested in insight-ctf.test.js; answer it up front so it does not cover buttons here
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('yojo_consent_v1')) localStorage.setItem('yojo_consent_v1', JSON.stringify({ analytics: false, v: 1 })); } catch {} });
  const page = await ctx.newPage();
  page.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push(r.status() + ' ' + r.url()); });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|404/.test(m.text())) errors.push(m.text()); });


  const popups = []; ctx.on('page', pg => popups.push(pg));
  // answer all 18 questions leaning to one path: puzzles correct, scenarios pick that path, scale 5 for that path else 1
  const doQuiz = async cat => {
    const KEYS = [2, 1, 2, 1, 0, 0, 1], MAP = [['O','D','G'],['D','O','G'],['O','D','G'],['O','D','G'],['O','D','G']], SCALE = ['O','D','G','O','D'], c = cat[0];
    await page.click('#qStart');
    for (let i = 0; i < 18; i++) {
      let a;
      if (i < 7) a = KEYS[i]; else if (i < 12) a = MAP[i - 7].indexOf(c); else if (i < 17) a = SCALE[i - 12] === c ? 5 : 1; else a = c === 'O' ? 1 : 0;
      await page.click(`[data-a="${a}"]`); await page.click('#qNext');
    }
    await page.waitForSelector('#enterMain');
  };
  const storyOn = pg => pg.evaluate(() => !!document.getElementById('storyLayer')?.classList.contains('on')).catch(() => false);
  const skipStory = async (pg, until) => { for (let i = 0; i < 40; i++) { if (await storyOn(pg)) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(250); } else if (!until || await until()) return; else await pg.waitForTimeout(250); } };
  const introDone = pg => () => pg.evaluate(() => !!(me.story && me.story.introDone));
  const lastPopup = async (keepStory) => { await page.waitForTimeout(400); const pg = popups[popups.length - 1]; if (!pg) return null; await pg.waitForLoadState(); await pg.waitForTimeout(300); await pg.keyboard.press('Escape'); await pg.waitForTimeout(900); if (!keepStory) { await skipStory(pg, introDone(pg)); await pg.goto(pg.url().split('#')[0] + '#/academy/dashboard'); await pg.waitForTimeout(300); } return pg; };
  const fresh = async (q = '') => { await page.goto(B + 'login.html' + q); await page.evaluate(() => { YojoDemo.reset(); }); await page.goto(B + 'login.html' + q); };
  const otpFor = e => page.evaluate(e => (YojoDemo.mailbox.find(m => m.to === e && m.code) || {}).code, e);
  const totpFor = e => page.evaluate(e => { const u = YojoDemo.db.users.find(x => x.email === e); return YojoDemo.totp(u.mfaSecret); }, e);
  const fillOtp = async code => { await page.fill('.otp input >> nth=0', code); await page.click('#otpGo'); };
  const text = () => page.textContent('#flow');
  const sess = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('yojo_demo_session')));

  // 0 TOTP RFC 6238 vector
  await fresh();
  ok('TOTP matches RFC 6238 test vector', await page.evaluate(() => YojoDemo.totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000)) === '287082');

  // 1 Existing Yojo student, complete + category -> main page
  await page.click('[data-gate=yes]'); await page.click('#gateGo');
  await page.fill('#sl-id', 'riya.sharma@students.yojo.demo'); await page.click('#slForm button[type=submit]');
  ok('Resend disabled for 30 s', await page.isDisabled('#resend'));
  await fillOtp(await otpFor('riya.sharma@students.yojo.demo'));
  ok('Riya (Yojo, complete) sees her category', /Welcome back, Riya/.test(await text()) && /Your path: Defensive/.test(await text()));
  { const pg = await lastPopup(true);
    for (let i = 0; i < 20 && !(await storyOn(pg)); i++) await pg.waitForTimeout(250);
    await pg.waitForTimeout(600);
    ok('Story: Orbi greets the agent and starts the tour', await storyOn(pg) && /Orbi/i.test(await pg.textContent('#storyLayer .sl-name')));
    ok('Story: no Captain America or Commander in this version', !/Captain America|Commander/i.test(await pg.textContent('#storyLayer')));
    await skipStory(pg, introDone(pg)); ok('Story: intro is remembered after the tour', await introDone(pg)());
    await pg.goto(pg.url().split('#')[0] + '#/academy/dashboard'); await pg.waitForTimeout(400);
    const t = pg ? await pg.textContent('body') : '';
    ok('Existing student: Academy opens in a new tab with category', pg && /academy\.html/.test(pg.url()) && /Welcome back, Riya/.test(t) && /Defensive \(Blue Team\)/.test(t));
    ok('Academy shows Dashboard, Leaderboard, LMS, Courses', /Dashboard/.test(t) && /Leaderboard/.test(t) && /LMS/.test(t) && /Courses/.test(t));
    await pg.click('a[href="#/academy/leaderboard"]'); await pg.waitForTimeout(200); ok('Leaderboard highlights you', /Riya \(you\)/.test(await pg.textContent('#view')));
    await pg.click('a[data-main="lms"]'); await pg.waitForTimeout(200); ok('Free student LMS shows the section sidebar', (await pg.$$('.lms-side a[href^="#/lms/"]')).length === 7 && /Free Operative/.test(await pg.textContent('#view')));
    ok('Free plan: trainer section is locked with an upgrade link', await (async () => { await pg.click('.lms-side a[href="#/lms/trainer"]'); await pg.waitForTimeout(200); return /Premium/.test(await pg.textContent('.lms-main')) && !!(await pg.$('.lms-lock')); })());
    ok('Sidebar has no My Plan section', !(await pg.$('.lms-side a[href="#/lms/plan"]')));
    await pg.click('#orbiDock .od-btn'); ok('Orbi dock opens a chat', await pg.isVisible('#orbiDock .od-chat'));
    await pg.fill('#orbiDock .od-form input', 'how is my attendance tracked?'); await pg.press('#orbiDock .od-form input', 'Enter'); await pg.waitForTimeout(1500);
    ok('Orbi answers a typed question in the chat', /75 percent/.test(await pg.textContent('#orbiDock .od-log')));
    await pg.click('[data-od="help"]'); await pg.waitForTimeout(500);
    ok('Orbi explains the current page with a gesture clip', await storyOn(pg) && !!(await pg.$('#storyLayer .orbi-stage video.on[data-act="laptop"], #storyLayer .orbi-stage video.on[data-act="point"]')));
    await pg.click('#storyLayer .orbi-por', { force: true }); ok('Clicking Orbi shows a reaction', await pg.isVisible('#storyLayer .orbi-quip'));
    await skipStory(pg);
    await pg.click('#bellBtn'); ok('Notification bell lists messages', /Mark all read/.test(await pg.textContent('#bellPop')));
    await pg.click('a[href="#/academy/missions"]').catch(()=>{}); await pg.goto(pg.url().split('#')[0] + '#/academy/missions'); await pg.waitForTimeout(200);
    const before = await pg.evaluate(() => +document.querySelector('#hXp').textContent.replace(/,/g, ''));
    await pg.click('[data-mid="DEF-03"] [data-open-mission]'); await pg.waitForTimeout(400);
    ok('Story: opening a mission plays the Orbi city briefing', await storyOn(pg) && /Orbi/i.test(await pg.textContent('#storyLayer .sl-name')));
    await skipStory(pg); ok('Story: briefing hands over to the mission with a VS strip', /City under attack/i.test(await pg.textContent('.vs-strip')));
    await pg.click('#clearLab');
    const after = await pg.evaluate(() => +document.querySelector('#hXp').textContent.replace(/,/g, ''));
    ok('Clearing a mission awards XP', after === before + 100, `${before}->${after}`);
    await pg.waitForTimeout(3400); ok('Story: victory scene plays after clearing', await storyOn(pg));
    await skipStory(pg); await pg.goto(pg.url().split('#')[0] + '#/academy/dashboard'); await pg.waitForTimeout(400);
    ok('Story: World Breach Map on dashboard', !!(await pg.$('#villainBoard .villain')));
    await pg.click('#avBtn'); await pg.click('#avSettings'); ok('Settings opens from the profile menu', await pg.isVisible('#ySettings .ys-intro'));
    await pg.click('#ySettings .ys-intro'); ok('Intro can be switched off', await pg.evaluate(() => me.settings.intro === false));
    await pg.click('#ySettings .ys-x');
    await pg.close(); }
  await page.reload(); ok('Session survives reload', /Welcome back, Riya/.test(await text()));
  await page.click('[data-logout]'); ok('Logout returns to login', /Are you already part of Yojo/.test(await text()));

  // 2 Student ID login
  await page.click('[data-gate=yes]'); await page.click('#gateGo');
  await page.fill('#sl-id', 'U-20417'); await page.click('#slForm button[type=submit]');
  await fillOtp(await otpFor('riya.sharma@students.yojo.demo'));
  ok('Login with student ID U-20417', /Welcome back, Riya/.test(await text()));

  // 3 Wrong OTP x3 -> locked; expiry
  await fresh(); await page.click('[data-gate=yes]'); await page.click('#gateGo');
  await page.fill('#sl-id', 'riya.sharma@students.yojo.demo'); await page.click('#slForm button[type=submit]');
  const real = await otpFor('riya.sharma@students.yojo.demo'); const wrong = real === '111111' ? '222222' : '111111';
  await fillOtp(wrong); ok('Wrong OTP shows 2 tries left', /2 tries left/.test(await text()));
  await fillOtp(wrong); await fillOtp(wrong);
  ok('3 wrong tries locks code', /Too many wrong tries/.test(await text()) && await page.isDisabled('#otpGo'));
  await page.evaluate(() => YojoDemo.advance(31000)); await page.waitForTimeout(700);
  await page.click('#resend'); const c2 = await otpFor('riya.sharma@students.yojo.demo');
  await page.evaluate(() => YojoDemo.advance(5 * 60 * 1000 + 1000));
  await fillOtp(c2); ok('OTP expires after 5 minutes', /expired/.test(await text()));

  // 4 Unknown Yojo student + staff on student tab
  await fresh(); await page.click('[data-gate=yes]'); await page.click('#gateGo');
  await page.fill('#sl-id', 'ghost@students.yojo.demo'); await page.click('#slForm button[type=submit]');
  ok('Unknown Yojo student rejected', /could not find a Yojo student/.test(await text()));
  await page.fill('#sl-id', 'trainer@yojo.demo'); await page.click('#slForm button[type=submit]');
  ok('Staff email on Student tab rejected', /employee account/.test(await text()));

  // 5 Existing Yojo, incomplete profile -> missing fields only -> main
  await page.fill('#sl-id', 'arjun.k@students.yojo.demo'); await page.click('#slForm button[type=submit]');
  await fillOtp(await otpFor('arjun.k@students.yojo.demo'));
  const missCount = await page.locator('#missForm .field').count();
  ok('Arjun (incomplete) sees only missing fields', /Profile incomplete/.test(await text()) && missCount === 8 && !(await page.$('#f-name')), `fields=${missCount}`);
  await page.click('#missForm button[type=submit]'); ok('Missing form validates', /required/.test(await text()));
  const fillMap = { city: 'Pune, MH', stream: 'IT', institution: 'Yojo Solutions', gradYear: '2026', skills: 'Bash, Nmap', objective: 'Pentester' };
  for (const [k, v] of Object.entries(fillMap)) await page.fill(`#f-${k}`, v);
  await page.selectOption('#f-eduLevel', 'B.Tech / B.E.'); await page.selectOption('#f-year', '4th');
  if (await page.$('#f-dob')) await page.fill('#f-dob', '2003-07-02');
  await page.click('#missForm button[type=submit]');
  ok('Arjun skips quiz, category shown', /Welcome back, Arjun/.test(await text()) && /Offensive/.test(await text()));
  { const pg = await lastPopup(); await pg.goto(pg.url().split('#')[0] + '#/lms'); await pg.waitForTimeout(200); ok('Paid student LMS shows batch + attendance', /SOC-B7/.test(await pg.textContent('#view')) && /attendance/i.test(await pg.textContent('#view')));
    await pg.goto(pg.url().split('#')[0] + '#/lms/calendar'); await pg.waitForTimeout(200); ok('Paid LMS calendar shows days and missed-class recordings', (await pg.$$('.cal-grid.month .cal-cell')).length >= 28); await pg.close(); }

  // 6 Existing Yojo, no category -> quiz -> result -> main
  await page.click('[data-logout]'); await page.click('[data-gate=yes]'); await page.click('#gateGo');
  await page.fill('#sl-id', 'neha.p@students.yojo.demo'); await page.click('#slForm button[type=submit]');
  await fillOtp(await otpFor('neha.p@students.yojo.demo'));
  ok('Neha (no category) goes to questionnaire', /Find your path/.test(await text()));
  await doQuiz('GRC'); ok('Quiz result: GRC primary', /GRC \(Green Team\)/.test(await page.textContent('#resPrimary')));
  await page.click('#enterMain');
  { const pg = await lastPopup(); ok('Neha: Academy opens in new tab with GRC path', pg && /Your path: GRC/.test(await pg.textContent('#view'))); await pg.close(); }

  // 7 New learner sign-up
  await fresh(); await page.click('[data-gate=no]'); await page.click('#gateGo');
  await page.click('#suForm button[type=submit]');
  ok('Empty sign-up shows errors', /Fix these to continue/.test(await text()));
  const fillSignup = async (email, dob = '2002-05-10', extra = {}) => {
    if (await page.getAttribute('#f-email','readonly') === null) await page.fill('#f-email', email); await page.fill('#f-name', extra.name || 'Demo Learner'); await page.fill('#f-dob', dob);
    await page.dispatchEvent('#f-dob', 'change');
    await page.fill('#f-phone', '9876543210'); await page.fill('#f-city', 'Visakhapatnam, AP');
    await page.selectOption('#f-eduLevel', 'B.Sc / BCA'); await page.fill('#f-stream', 'Computer Science');
    if (!(await page.getAttribute('#f-institution', 'readonly') !== null)) await page.fill('#f-institution', 'Demo College');
    await page.selectOption('#f-year', '2nd'); await page.fill('#f-gradYear', '2028');
    await page.fill('#f-skills', 'Linux, Python'); await page.fill('#f-objective', 'SOC analyst');
  };
  await fillSignup('new.learner@gmail.demo');
  await page.click('#suForm button[type=submit]');
  ok('Terms acceptance required', /Accept the Terms/.test(await text()));
  await page.check('#f-terms'); await page.click('#suForm button[type=submit]');
  await fillOtp(await otpFor('new.learner@gmail.demo'));
  ok('New learner after OTP goes to questionnaire', /Find your path/.test(await text()));
  const nu = await page.evaluate(() => YojoDemo.db.users.find(u => u.email === 'new.learner@gmail.demo'));
  ok('Consent stored with version + time, marketing off', nu && nu.consent.version.includes('T&C') && !!nu.consent.at && nu.consent.marketing === false);
  await doQuiz('Offensive'); ok('New learner quiz result: Offensive', /Offensive \(Red Team\)/.test(await page.textContent('#resPrimary')));
  await page.click('#enterMain');
  { const pg = await lastPopup(); const t = await pg.textContent('#view'); ok('New learner: Academy in new tab, 0 XP start, Offensive', /Welcome back, Demo/.test(t) && /Your path: Offensive/.test(t)); await pg.close(); }

  // 8 Duplicate email
  await page.click('[data-logout]'); await page.click('[data-gate=no]'); await page.click('#gateGo');
  await fillSignup('new.learner@gmail.demo'); await page.check('#f-terms'); await page.click('#suForm button[type=submit]');
  ok('Duplicate email rejected', /already exists/.test(await text()));

  // 9 Under 18 -> guardian required
  await fresh(); await page.click('[data-gate=no]'); await page.click('#gateGo');
  await fillSignup('minor.learner@gmail.demo', '2011-01-01'); await page.check('#f-terms');
  ok('Guardian section appears for under 18', await page.isVisible('#guardianSet'));
  await page.click('#suForm button[type=submit]');
  ok('Guardian + parental consent required', /Guardian name is required/.test(await text()) && /Parental consent/.test(await text()));
  await page.fill('#f-gName', 'Mr. Demo'); await page.selectOption('#f-gRel', 'Father'); await page.fill('#f-gPhone', '9123456780');
  await page.check('input[name=parental]'); await page.click('#suForm button[type=submit]');
  await fillOtp(await otpFor('minor.learner@gmail.demo'));
  ok('Minor sign-up completes', /Find your path/.test(await text()));

  // 10 Institution student: domain must match
  await fresh(); await page.click('[data-gate=no]'); await page.click('#gateGo');
  await page.click('[data-origin=institution]');
  await page.selectOption('#f-inst', 'ABC Institute');
  await page.dispatchEvent('#f-inst', 'change');
  await fillSignup('student@gmail.demo'); await page.check('#f-terms'); await page.click('#suForm button[type=submit]');
  ok('Institution email mismatch rejected', /must end with @abc-institute.demo/.test(await text()));
  await page.fill('#f-email', 'student@abc-institute.demo'); await page.click('#suForm button[type=submit]');
  await fillOtp(await otpFor('student@abc-institute.demo'));
  const iu = await page.evaluate(() => YojoDemo.db.users.find(u => u.email === 'student@abc-institute.demo'));
  ok('Institution student created with institution', iu && iu.origin === 'institution' && iu.institution === 'ABC Institute' && /Find your path/.test(await text()));

  // 11 Google sign-up + Google login
  await fresh(); await page.click('[data-gate=no]'); await page.click('#gateGo');
  await page.click('#gBtn'); await page.fill('#gOther input', 'g.user@gmail.demo'); await page.click('#gOther button');
  ok('Google sign-up locks verified email', (await page.inputValue('#f-email')) === 'g.user@gmail.demo' && (await page.getAttribute('#f-email', 'readonly')) !== null);
  await fillSignup('ignored', '2001-01-01', { name: 'G User' });
  await page.check('#f-terms'); await page.click('#suForm button[type=submit]');
  ok('Google sign-up skips OTP, goes to questionnaire', /Find your path/.test(await text()));
  // 12 Returning (non-Yojo) login
  await page.click('[data-logout]'); await page.click('#toLogin');
  await page.fill('#sl-id', 'g.user@gmail.demo'); await page.click('#slForm button[type=submit]');
  await fillOtp(await otpFor('g.user@gmail.demo'));
  ok('Returning signed-up learner logs in via OTP', /Find your path/.test(await text()));

  await fresh(); await page.click('[data-gate=yes]'); await page.click('#gateGo');
  await page.click('#gBtn'); await page.click('.acc[data-e="riya.sharma@students.yojo.demo"]');
  ok('Google login (Yojo account) lands on main', /Welcome back, Riya/.test(await text()));

  // ---------- EMPLOYEE ----------
  const staffLogin = async (tab, email) => {
    await fresh(tab === 'admin' ? '?stay=1' : ''); await page.click('#tab-employee'); await page.click('#tab-' + tab);
    await page.fill('#st-mail', email); await page.click('#stForm button[type=submit]');
    const c = await otpFor(email); if (c) await fillOtp(c); return c;
  };
  await fresh(); await page.click('#tab-employee');
  ok('Employee tab shows Trainer + Admin sub-tabs', await page.isVisible('#tab-trainer') && await page.isVisible('#tab-admin'));
  await page.fill('#st-mail', 'someone@gmail.demo'); await page.click('#stForm button[type=submit]');
  ok('Non-organisation email rejected', /Only organisation emails/.test(await text()));

  // unknown staff: no email sent
  await page.fill('#st-mail', 'nobody@yojo.demo'); await page.click('#stForm button[type=submit]');
  ok('Unknown staff email: no OTP sent (no account enumeration)', !(await otpFor('nobody@yojo.demo')) && /If this is a staff account/.test(await text()));

  await staffLogin('trainer', 'trainer@yojo.demo');
  ok('Trainer asked for authenticator code', /Authenticator code/.test(await text()));
  await page.fill('#totp', '000000'); await page.click('#totpForm button[type=submit]');
  ok('Wrong TOTP rejected', /Wrong or expired code/.test(await text()));
  await page.fill('#totp', await totpFor('trainer@yojo.demo'));
  const [tp] = await Promise.all([ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null), page.click('#totpForm button[type=submit]')]);
  if (tp) { await tp.waitForLoadState(); await tp.waitForSelector('#nav a', { timeout: 8000 }).catch(() => {}); }
  ok('Trainer console opens in a new tab (not inside the login popup)', !!tp && /trainer\.html#\/trainer\/dashboard/.test(tp.url()) && (await tp.$$('#nav a')).length === 11 && /login\.html/.test(page.url()) && /Open Trainer Console/.test(await text()), tp && tp.url());
  ok('New tab carries the trainer session', !!tp && (await tp.evaluate(() => JSON.parse(sessionStorage.getItem('yojo_demo_session')).email)) === 'trainer@yojo.demo' && (await tp.evaluate(() => localStorage.getItem('yojo_demo_staff_handoff'))) === null);
  if (tp) await tp.close();
  await page.goto(B + 'login.html?stay=1'); await page.waitForTimeout(400);
  await page.evaluate(() => YojoDemo.advance(31 * 60 * 1000)); await page.waitForTimeout(5600);
  ok('Staff idle 30 min logs out', /30 minutes of inactivity/.test(await text()));

  await staffLogin('trainer', 'platform.admin@yojo.demo');
  ok('Admin account on Trainer tab blocked', /Use the Admin tab/.test(await text()));
  await staffLogin('trainer', 'suspended.trainer@yojo.demo');
  ok('Suspended trainer blocked', /suspended/.test(await text()));
  await staffLogin('trainer', 'expired.trainer@yojo.demo');
  ok('Expired invite blocked', /invite has expired/.test(await text()));

  // invited trainer first login
  await staffLogin('trainer', 'new.trainer@yojo.demo');
  ok('Invited trainer starts authenticator setup', /Step 1 of 4/.test(await text()));
  const key = (await page.textContent('#setupKey')).replace(/\s/g, '');
  await page.fill('#fl-code', await page.evaluate(k => YojoDemo.totp(k), key)); await page.click('#fl1 button[type=submit]');
  await page.click('#fl2 button[type=submit]'); ok('Policies required', /Both policies/.test(await text()));
  await page.check('input[name=coc]'); await page.check('input[name=dp]'); await page.click('#fl2 button[type=submit]');
  await page.fill('#p-sp', 'SOC, DFIR'); await page.check('input[name=av][value=Mon]'); await page.click('#fl3 button[type=submit]');
  await page.waitForTimeout(600);
  ok('Invited trainer reaches console after 4 steps', /Open Trainer Console/.test(await text()));
  for (const pp of ctx.pages()) if (pp !== page) await pp.close();
  await page.goto(B + 'login.html?stay=1'); await page.waitForTimeout(400);
  await page.click('[data-logout]'); await page.click('#tab-employee'); await page.click('#tab-trainer');
  await page.fill('#st-mail', 'new.trainer@yojo.demo'); await page.click('#stForm button[type=submit]');
  await fillOtp(await page.evaluate(() => YojoDemo.mailbox.find(m => m.to === 'new.trainer@yojo.demo' && m.code).code));
  ok('Second login asks MFA (no setup again)', /Authenticator code/.test(await text()));

  // admin console opens in a new tab, with the admin session handed over
  await page.goto(B + 'login.html'); await page.waitForTimeout(300); await page.evaluate(() => { sessionStorage.clear(); }); await page.goto(B + 'login.html?role=employee&as=admin'); await page.waitForTimeout(400);
  await page.fill('#st-mail', 'platform.admin@yojo.demo'); await page.click('#stForm button[type=submit]');
  await fillOtp(await page.evaluate(() => YojoDemo.mailbox.find(m => m.to === 'platform.admin@yojo.demo' && m.code).code));
  await page.fill('#totp', await totpFor('platform.admin@yojo.demo'));
  { const [ap] = await Promise.all([ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null), page.click('#totpForm button[type=submit]')]);
    if (ap) { await ap.waitForLoadState(); await ap.waitForSelector('#nav a', { timeout: 8000 }).catch(() => {}); }
    ok('Admin console opens in a new tab (not inside the login popup)', !!ap && /admin\.html#\/admin\/dashboard/.test(ap.url()) && (await ap.$$('#nav a')).length === 13 && /Open Admin Console/.test(await text()), ap && ap.url());
    ok('New tab carries the admin session', !!ap && (await ap.evaluate(() => JSON.parse(sessionStorage.getItem('yojo_demo_session')).email)) === 'platform.admin@yojo.demo');
    if (ap) await ap.close(); }
  await page.click('[data-logout]'); await page.goto(B + 'login.html?stay=1'); await page.waitForTimeout(400);

  // admins
  const expect = { platform: ['Y', 'Y', 'Y', 'Y', 'Y', 'Y'], payment: ['-', 'R', '-', 'R', '-', 'R'], content: ['Y', 'R', 'Y', 'R', 'Y', 'R'], support: ['-', 'Y', 'R', 'R', '-', '-'] };
  for (const r of Object.keys(expect)) {
    const em = `${r}.admin@yojo.demo`;
    await staffLogin('admin', em);
    await page.fill('#totp', await totpFor(em)); await page.click('#totpForm button[type=submit]');
    const acc = await page.$$eval('[data-access]', els => els.map(e => e.dataset.access));
    ok(`${r} admin console + access matrix`, /Admin console/.test(await text()) && JSON.stringify(acc) === JSON.stringify(expect[r]), acc.join(''));
  }
  ok('Only Platform admin sees create-trainer (support has none)', !(await page.$('#ctForm')));

  // platform admin creates trainer -> invite -> first login
  await staffLogin('admin', 'platform.admin@yojo.demo');
  await page.fill('#totp', await totpFor('platform.admin@yojo.demo')); await page.click('#totpForm button[type=submit]');
  await page.fill('#ct-n', 'Demo Trainer'); await page.fill('#ct-e', 'demo.trainer@yojo.demo'); await page.fill('#ct-b', 'SOC-B9');
  await page.click('#ctForm button[type=submit]');
  ok('Platform admin invites trainer', /Invite sent/.test(await text()) && await page.evaluate(() => YojoDemo.mailbox.some(m => m.to === 'demo.trainer@yojo.demo')));
  await page.click('[data-logout]'); await page.click('#tab-employee'); await page.click('#tab-trainer');
  await page.fill('#st-mail', 'demo.trainer@yojo.demo'); await page.click('#stForm button[type=submit]');
  await fillOtp(await otpFor('demo.trainer@yojo.demo'));
  ok('Newly invited trainer gets first-login setup', /Step 1 of 4/.test(await text()));

  // Google Workspace
  await fresh(); await page.click('#tab-employee'); await page.click('#tab-admin');
  await page.click('#gBtn'); await page.click('.acc[data-e="someone@gmail.demo"]');
  ok('Personal Google rejected for staff', /organisation Google Workspace/.test(await text()));
  await page.click('#gBtn'); await page.click('.acc[data-e="content.admin@yojo.demo"]');
  ok('Google Workspace admin goes to MFA', /Email verified with Google Workspace/.test(await text()));

  // Request access
  await fresh(); await page.click('#tab-employee'); await page.click('#reqAccess');
  await page.fill('#ra-n', 'Demo Staff'); await page.fill('#ra-e', 'demo.staff@yojo.demo'); await page.fill('#ra-w', 'New SOC trainer');
  await page.click('#raForm button[type=submit]');
  ok('Request access recorded', /Request sent/.test(await text()) && await page.evaluate(() => YojoDemo.db.requests.length === 1));

  // index.html wiring
  await page.goto(B + 'index.html'); await page.click('header [data-open=auth]'); await page.waitForSelector('#authPop iframe');
  ok('Website Login / Sign up button opens login popup', /login\.html\?embed=1/.test(await page.getAttribute('#authPop iframe', 'src')));
  await page.goto(B + 'login.html?mode=signup'); await page.evaluate(() => sessionStorage.clear()); await page.goto(B + 'login.html?mode=signup');
  ok('?mode=signup opens sign-up form', /Create new account/.test(await page.textContent('#card')));

  // screenshots + mobile
  await fresh(); await page.screenshot({ path: './desk-student.png', fullPage: true });
  await page.click('#tab-employee'); await page.screenshot({ path: './desk-employee.png' });
  const m = await browser.newPage({ viewport: { width: 375, height: 800 } });
  await m.goto(B + 'login.html?mode=signup');
  const sw = await m.evaluate(() => document.documentElement.scrollWidth);
  ok('No horizontal scroll at 375px', sw <= 375, 'scrollWidth=' + sw);
  await m.screenshot({ path: './mobile-signup.png' });

  ok('No JS errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  for (const r of results) console.log(r.join('  '));
  console.log(`\n${results.filter(r => r[0] === 'PASS').length}/${results.length} passed`);
})().catch(e => { console.error('CRASH', e); for (const r of results) console.log(r.join('  ')); process.exit(1); });
