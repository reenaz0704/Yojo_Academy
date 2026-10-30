const { chromium } = require('playwright');
// Training Grid LMS: every sidebar page and its main actions. Run with a static server on BASE (see login-flows.test.js).
const B = process.env.BASE || 'http://localhost:8765/';
const results = []; const ok = (n, c, x = '') => results.push([c ? 'PASS' : 'FAIL', n, x]);
const S = p => p.evaluate(() => YojoStory.state);
(async () => {
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const ctx = await br.newContext({ viewport: { width: 1280, height: 860 } }); const page = await ctx.newPage();
  const errs = []; ctx.on('page', p => p.on('pageerror', e => errs.push(e.message)));
  await page.goto(B + 'login.html'); await page.evaluate(() => YojoDemo.reset()); await page.goto(B + 'login.html');
  await page.click('[data-gate=yes]'); await page.click('#gateGo');
  await page.fill('#sl-id', 'riya.sharma@students.yojo.demo'); await page.click('#slForm button[type=submit]');
  const code = await page.evaluate(e => (YojoDemo.mailbox.find(m => m.to === e && m.code) || {}).code, 'riya.sharma@students.yojo.demo');
  const [pg] = await Promise.all([ctx.waitForEvent('page', { timeout: 15000 }).catch(() => null), (async () => { await page.fill('.otp input >> nth=0', code); await page.click('#otpGo'); await page.waitForTimeout(800); const b = await page.$('#enterMain'); if (b) await b.click(); })()]);
  const p = pg || page; p.on('pageerror', e => errs.push(e.message)); await p.waitForLoadState(); for (let i = 0; i < 40 && !(await S(p)); i++) await p.waitForTimeout(250);
  for (let i = 0; i < 30 && await S(p); i++) { await p.keyboard.press('Escape'); await p.waitForTimeout(200); }
  await p.waitForTimeout(1500);
  await p.waitForTimeout(800);
  const V = () => p.textContent('.lms-main'), go = async k => { await p.click(`.lms-side a[href="#/lms/${k}"]`); await p.waitForTimeout(250); };
  const shot = process.env.SHOTS;
  // free plan first: locked pages, free content, upgrade
  await p.evaluate(() => { me.stats.plan = 'free'; delete me.stats.batch; location.hash = '#/lms/attendance'; }); await p.waitForTimeout(300);
  ok('Sidebar has 7 sections, no My Plan, Ops Calendar under Deployment Record', (await p.evaluate(() => [...document.querySelectorAll('.lms-side a[href^="#/lms/"]')].map(a => a.getAttribute('href').split('/')[2]).join(','))) === 'attendance,calendar,trainer,week,learning,assessments,placement' && !(await p.$('.lms-side a[href="#/lms/plan"]')));
  ok('Free: attendance is locked with an upgrade link', !!(await p.$('.lms-lock')) && !!(await p.$('.lms-lock a[href="#/courses"]')));
  await go('learning'); await p.click('[data-f="camptab:queued"]'); await p.waitForTimeout(150); ok('Free: Queued Campaigns shows free course to start and locked premium courses', /Start course/.test(await V()) && (await p.$$('.q-card.locked')).length >= 3 && /Upgrade/.test(await V()));
  await p.click('[data-f="queue:locked"]'); await p.waitForTimeout(150); ok('Free: Locked filter shows only locked courses', (await p.$$('.q-card')).length === (await p.$$('.q-card.locked')).length);
  await p.click('[data-f="camptab:active"]'); await p.waitForTimeout(150); ok('Free: Active Campaigns shows the self-paced course', /Cybersecurity Foundations/.test(await V()) && /Certificate: Premium/.test(await V()));
  // paid plan: every page
  await p.evaluate(() => { me.stats.plan = 'paid'; me.stats.batch = 'SOC-B7'; me.stats.lms = {}; location.hash = '#/lms/attendance'; }); await p.waitForTimeout(400);
  for (const [k] of [['attendance'], ['trainer'], ['week'], ['learning'], ['assessments'], ['placement'], ['calendar']]) {
    await go(k); const cur = await p.getAttribute('.lms-side a[aria-current="page"]', 'href');
    ok(`Sidebar opens ${k} and highlights it`, cur === `#/lms/${k}` && await p.getAttribute('.lms-main', 'data-page') === k && !(await p.$('.lms-lock')));
    if (shot) await p.screenshot({ path: `${shot}/lms-${k}.png`, fullPage: true });
  }
  await go('attendance');
  const nums = await p.evaluate(() => [...document.querySelectorAll('.ov-stat b')].map(b => b.textContent));
  ok('Overview cards come from the attendance data (present + absent = total, no Late)', (() => { const n = nums.slice(1, 3).map(t => t.split('/').map(x => parseInt(x))); return n[0][0] + n[1][0] === n[0][1]; })() && !/late/i.test(await p.textContent('.ov-stats')), nums.join(' | '));
  ok('Overview has ring, weekly bars and both buttons', !!(await p.$('.ov-chart .lms-ring')) && (await p.$$('.ov-col')).length >= 1 && !!(await p.$('a[href="#/lms/calendar"]')) && !!(await p.$('[data-do="report"]')));
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 4000 }).catch(() => null), p.click('[data-do="report"]')]);
  ok('Download report saves a CSV', !!dl && /attendance-\d{4}-\d{2}\.csv/.test(dl.suggestedFilename()));
  // calendar
  await go('calendar');
  ok('Calendar month view shows every day of the month', (await p.$$('.cal-grid.month .cal-cell')).length >= 28);
  const t1 = await p.textContent('.cal-title'); await p.click('[data-do="cal-next"]'); await p.waitForTimeout(150); const t2 = await p.textContent('.cal-title'); await p.click('[data-do="cal-prev"]'); await p.click('[data-do="cal-prev"]'); await p.waitForTimeout(150);
  ok('Calendar previous / next move the month', t1 !== t2 && (await p.textContent('.cal-title')) !== t1);
  ok('Previous month shows attendance marks', (await p.$$('.cal-att.p')).length > 3);
  await p.click('.cal-cell:has(.cal-att) >> nth=2'); await p.waitForTimeout(150);
  ok('Selecting a date shows its sessions and attendance', /present|absent/i.test(await p.textContent('.cal-detail')) && !/\blate\b/i.test(await p.textContent('.lms-main')));
  await p.click('[data-do="cal-today"]'); await p.waitForTimeout(150); ok('Today button returns to the current month', (await p.textContent('.cal-title')) === t1 && !!(await p.$('.cal-cell.today')));
  await p.click('[data-f="calview:week"]'); await p.waitForTimeout(150); ok('Week view shows 7 days', (await p.$$('.cal-grid.week .cal-cell')).length === 7);
  await p.click('[data-f="calview:day"]'); await p.waitForTimeout(150); ok('Day view shows the day detail only', !(await p.$('.cal-grid')) && !!(await p.$('.cal-detail')));
  await p.click('[data-f="calview:month"]'); await p.waitForTimeout(150);
  const pills = async () => (await p.$$('.cal-pill.t-lab')).length; const before = await pills(); await p.click('[data-calf="lab"]'); await p.waitForTimeout(150);
  ok('Labs filter hides lab sessions', before > 0 && await pills() === 0);
  // handler
  await go('trainer'); ok('My Handler shows trainer profile, certs, experience, availability', /Vikram Rao/.test(await V()) && /CISSP/.test(await V()) && /11 years/.test(await V()) && /Availability/.test(await V()));
  await p.click('[data-do="msg"]'); await p.fill('#msgTx', 'Can we review my SIEM rule?'); await p.click('#msgGo'); await p.waitForTimeout(200);
  ok('Message trainer stores and lists the message', /review my SIEM rule/.test(await V()));
  await p.click('[data-do="book"]'); await p.click('[data-slot] >> nth=0'); await p.waitForTimeout(200);
  ok('Booking a one-to-one adds it to upcoming mentor sessions', /1-to-1 with Vikram Rao|Waiting for trainer/.test(await V()));
  // week
  await go('week'); ok('This Week shows Mon to Sun with status chips and next class', (await p.$$('.wk-day')).length === 7 && /Upcoming|Live|Completed/.test(await V()));
  const w1 = await p.textContent('.cal-title'); await p.click('[data-do="wk-next"]'); await p.waitForTimeout(150); ok('Week navigation and Today work', (await p.textContent('.cal-title')) !== w1 && (await p.click('[data-do="wk-today"]'), await p.waitForTimeout(150), (await p.textContent('.cal-title')) === w1));
  await p.click('[data-f="wkmode:list"]'); await p.waitForTimeout(150); ok('List view toggle works', !(await p.$('.wk-grid')) && (await p.$$('.ov-class')).length > 0); await p.click('[data-f="wkmode:grid"]');
  // campaigns
  await go('week'); await go('learning'); ok('Active Campaigns lists enrolled mission cards', (await p.$$('.mc-card')).length === 4 && /Continue learning/.test(await V()));
  await p.click('[data-f="camp:done"]'); await p.waitForTimeout(150); ok('Completed filter shows completed courses with certificate', (await p.$$('.mc-card')).length === 1 && /Certificate ready/.test(await V()));
  // challenges
  await go('assessments'); ok('Incoming Challenges shows pending cards with deadline, duration and marks', (await p.$$('.ch-card')).length >= 5 && /Duration/.test(await V()) && /Marks/.test(await V()));
  ok('Urgent deadlines are highlighted', (await p.$$('.ch-card.urgent, .ch-card.soon')).length >= 2);
  await p.click('[data-do="start"] >> nth=0'); await p.click('#goA'); await p.waitForTimeout(150); ok('Start challenge turns into Continue', /Continue/.test(await V()));
  await p.click('[data-do="submit"]'); await p.click('#subA'); await p.waitForTimeout(150); await p.click('[data-f="chal:submitted"]'); await p.waitForTimeout(150);
  ok('Submitting moves it to Submitted', (await p.$$('.ch-card')).length === 2);
  await p.click('[data-f="chal:completed"]'); await p.waitForTimeout(150); ok('Completed filter shows scores', /Score 18 \/ 20/.test(await V()));
  // queue
  await go('learning'); await p.click('[data-f="camptab:queued"]'); await p.waitForTimeout(150); await p.click('[data-f="queue:all"]'); await p.waitForTimeout(150); ok('Queued Campaigns shows details, prerequisites and actions', /Prerequisites/.test(await V()) && /Resume course/.test(await V()) && /Start course/.test(await V()));
  await p.click('[data-do="startc"] >> nth=0'); await p.waitForTimeout(150); await p.click('[data-f="queue:progress"]'); await p.waitForTimeout(150); ok('Start course moves it to In progress', (await p.$$('.q-card')).length === 2);
  // placement
  await go('placement'); const sc = await p.textContent('.pm-top .ov-big');
  await p.click('[data-do="pm"][data-k="resume"]'); await p.waitForTimeout(150);
  ok('Placement shows overall score and it updates when a step is done', /% career-ready/.test(sc) && (await p.textContent('.pm-top .ov-big')) !== sc && (await p.$$('.pm-rings .ov-pr')).length === 4);
  // mobile
  await p.setViewportSize({ width: 390, height: 844 }); for (const k of ['attendance', 'calendar', 'week']) { await p.evaluate(k => location.hash = '#/lms/' + k, k); await p.waitForTimeout(250); if (shot) await p.screenshot({ path: `${shot}/lms-m-${k}.png`, fullPage: true }); }
  ok('Mobile: no horizontal scroll on LMS pages', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  ok('No page errors', !errs.length, errs.join(' | '));
  await br.close();
  for (const r of results) console.log(r[0], ' ', r[1], r[2] ? ' :: ' + r[2] : '');
  console.log(`\n${results.filter(r => r[0] === 'PASS').length}/${results.length} passed`);
})().catch(e => { console.log('CRASH', e); process.exit(1); });
