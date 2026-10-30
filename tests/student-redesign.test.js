const { chromium } = require('playwright');
// Student-side redesign: progress bars, Cyber Arsenal, Intel blogs, podium, dashboard, LMS placement, settings, streak rule.
// Run with a static server on BASE (see login-flows.test.js). SHOT=<dir> saves screenshots.
const B = process.env.BASE || 'http://localhost:8765/', shot = process.env.SHOT;
const results = []; const ok = (n, c, x = '') => results.push([c ? 'PASS' : 'FAIL', n, x]);
(async () => {
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const errs = [];
  async function login(email) {
    const ctx = await br.newContext({ viewport: { width: 1360, height: 900 } }); const page = await ctx.newPage();
    ctx.on('page', p => p.on('pageerror', e => errs.push(e.message)));
    await page.goto(B + 'login.html'); await page.evaluate(() => YojoDemo.reset()); await page.goto(B + 'login.html');
    await page.click('[data-gate=yes]'); await page.click('#gateGo');
    await page.fill('#sl-id', email); await page.click('#slForm button[type=submit]');
    const code = await page.evaluate(e => (YojoDemo.mailbox.find(m => m.to === e && m.code) || {}).code, email);
    const [pg] = await Promise.all([ctx.waitForEvent('page', { timeout: 15000 }).catch(() => null), (async () => { await page.fill('.otp input >> nth=0', code); await page.click('#otpGo'); await page.waitForTimeout(800); const b = await page.$('#enterMain'); if (b) await b.click(); })()]);
    const p = pg || page; p.on('pageerror', e => errs.push(e.message)); await p.waitForLoadState();
    // turn the intro tour off so it does not cover the pages
    for (let i = 0; i < 40 && !(await p.evaluate(() => !!(window.YojoStory && YojoStory.state))); i++) await p.waitForTimeout(250);
    for (let i = 0; i < 30 && await p.evaluate(() => !!(window.YojoStory && YojoStory.state)); i++) { await p.keyboard.press('Escape'); await p.waitForTimeout(200); }
    await p.evaluate(() => { YojoPrefs.intro = false; YojoPrefs.mascot = false; saveDb(); });
    return p;
  }
  const go = async (p, h) => { await p.evaluate(h => { location.hash = h; }, h); await p.waitForTimeout(350); };
  const snap = async (p, n) => { if (shot) await p.screenshot({ path: `${shot}/${n}.png`, fullPage: true }); };

  const p = await login('riya.sharma@students.yojo.demo');
  // dashboard
  await go(p, '#/academy/dashboard');
  const sub = await p.textContent('#subnav');
  ok('Academy tabs: Daily Patches tab removed, Threat Intel renamed to Intel', !/Daily Patches/.test(sub) && /Intel/.test(sub) && !/Threat Intel/.test(sub), sub);
  ok('Dashboard has Daily patches and Weekly field ops', /Daily patches/i.test(await p.textContent('#view')) && /Weekly field ops/i.test(await p.textContent('#view')));
  ok('Dashboard no longer shows the resume', !(await p.$('#dashResume')) && !/Your resume/.test(await p.textContent('#view')));
  const hilt = await p.evaluate(() => { const b = document.querySelector('.bar'); const s = getComputedStyle(b, '::before'); return { left: s.left, bg: s.backgroundImage }; });
  ok('Progress bars no longer use the lightsaber hilt', hilt.left !== '-30px' && !/rgb\(215, 220, 228\)/.test(hilt.bg), JSON.stringify(hilt));
  await snap(p, 'dashboard');
  await go(p, '#/academy/daily-ops'); ok('Old Daily Patches link lands on the dashboard', (await p.evaluate(() => location.hash)) === '#/academy/dashboard');
  // leaderboard podium
  await go(p, '#/academy/leaderboard');
  const pod = await p.evaluate(() => ['.pd1', '.pd2', '.pd3'].map(s => { const e = document.querySelector('.podium2 ' + s + ' .pd-base').getBoundingClientRect(); const c = document.querySelector('.podium2 ' + s).getBoundingClientRect(); return { top: Math.round(e.top), h: Math.round(e.height), x: Math.round(c.left) }; }));
  ok('Podium: #1 is highest and in the middle, #2 and #3 a step lower', pod[0].h > pod[1].h && pod[1].h > pod[2].h && pod[0].top < pod[1].top && pod[1].x < pod[0].x && pod[0].x < pod[2].x, JSON.stringify(pod));
  await snap(p, 'leaderboard');
  // Intel
  await go(p, '#/academy/lore-vault');
  ok('Intel has no category filters', !(await p.$('[data-lv]')) && !/\bOffensive\b.*\bDefensive\b.*\bGRC\b/.test(await p.textContent('#view')));
  const top = await p.$$eval('.bl-top li', l => l.map(x => x.textContent));
  ok('Top blogs: at least 5, each with likes, views, comments and the writer', top.length >= 5 && top.every(t => /👏/.test(t) && /👁/.test(t) && /💬/.test(t)), top.length);
  await p.fill('#lvQ', 'linux'); await p.waitForTimeout(150);
  ok('Search finds blogs by name', (await p.$$('.bl-card')).length === 1 && /Linux/.test(await p.textContent('.bl-card')));
  await p.fill('#lvQ', ''); await p.waitForTimeout(150);
  await snap(p, 'intel');
  await p.click('.bl-card a >> nth=0'); await p.waitForTimeout(400);
  const read = await p.evaluate(() => ({ h: location.hash, art: !!document.querySelector('.bl-read'), side: !!document.querySelector('.bl-side'), sub: document.getElementById('subnav').hidden, w: document.querySelector('.bl-read')?.getBoundingClientRect().width }));
  ok('Opening a blog shows it full page', /lore-vault\/b0/.test(read.h) && read.art && !read.side && read.sub, JSON.stringify(read));
  await p.click('#blLike'); await p.waitForTimeout(200); ok('Like button works', /Liked/.test(await p.textContent('#blLike')));
  await p.fill('#blC input', 'Great tips!'); await p.click('#blC button'); await p.waitForTimeout(200); ok('Comment is posted', /Great tips!/.test(await p.textContent('.bl-comments')));
  await snap(p, 'intel-read');
  // Courses, free plan
  await go(p, '#/courses');
  ok('Cyber Arsenal: hero, search, course cards and FAQ (free plan)', !!(await p.$('.ac-hero')) && !!(await p.$('#csQ')) && (await p.$$('.ac-card')).length === 6 && (await p.$$('.faq details')).length >= 6 && !/My courses/.test(await p.textContent('#view')));
  await p.click('[data-cc="GRC"]'); await p.waitForTimeout(200); ok('Category tabs filter the courses', (await p.$$('#csGrid .ac-card')).length === 1);
  await p.click('[data-cc="All"]'); await p.waitForTimeout(200);
  await p.click('[data-cd="SOC Analyst"]'); await p.waitForTimeout(200); ok('View details opens syllabus and course FAQ', /Syllabus/.test(await p.textContent('.modal')) && (await p.$$('.modal .faq details')).length === 4); await p.keyboard.press('Escape');
  await snap(p, 'courses-free');
  // LMS rename
  await go(p, '#/lms/learning'); ok('Campaigns tab is called My learning', /My learning/.test(await p.textContent('.lms-main')) && !/Courses I am learning/i.test(await p.textContent('.lms-main')));
  // settings
  await p.evaluate(() => YojoSettings.open('profile')); await p.waitForTimeout(200);
  await p.fill('#ysProf [name=city]', 'Pune'); await p.click('#ysProf button'); await p.waitForTimeout(200);
  ok('Settings: profile edit saves', (await p.evaluate(() => me.profile.city)) === 'Pune');
  await p.click('[data-ys="pw"]'); await p.fill('#ysPw [name=pw]', 'short'); await p.fill('#ysPw [name=pw2]', 'short'); await p.click('#ysPw button'); await p.waitForTimeout(200);
  ok('Settings: weak password is refused', /8 characters/.test(await p.textContent('#ysPw .ys-msg')));
  await p.fill('#ysPw [name=pw]', 'Agent2026x'); await p.fill('#ysPw [name=pw2]', 'Agent2026x'); await p.click('#ysPw button'); await p.waitForTimeout(300);
  ok('Settings: password set (stored hashed)', await p.evaluate(() => !!me.auth.pw && me.auth.pw !== 'Agent2026x'));
  await p.fill('#ysPw [name=cur]', 'wrong'); await p.fill('#ysPw [name=pw]', 'Agent2027y'); await p.fill('#ysPw [name=pw2]', 'Agent2027y'); await p.click('#ysPw button'); await p.waitForTimeout(300);
  ok('Settings: changing needs the current password', /current password/.test(await p.textContent('#ysPw .ys-msg')));
  await snap(p, 'settings'); await p.evaluate(() => YojoSettings.close());
  // streak rule
  const xp0 = await p.evaluate(() => { me.stats.lastActive = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10); delete me.stats.streakChoice; saveDb(); return me.stats.xp; });
  await p.reload(); await p.waitForTimeout(1500);
  ok('Missed streak asks to give up 10% XP or reset', !!(await p.$('#stKeep')) && !!(await p.$('#stReset')));
  await snap(p, 'streak');
  const st0 = await p.evaluate(() => me.stats.streak);
  await p.click('#stKeep'); await p.waitForTimeout(300);
  const after = await p.evaluate(() => ({ xp: me.stats.xp, st: me.stats.streak }));
  ok('Keeping the streak costs 10% of XP and keeps the count', after.xp === xp0 - Math.round(xp0 * 0.1) && after.st === st0, JSON.stringify(after));
  const st1 = await p.evaluate(() => { const q = questState(); q.learn = true; saveDb(); return me.stats.streak; });
  await go(p, '#/academy/dashboard'); await p.click('[data-claim="learn"]'); await p.waitForTimeout(300);
  ok('Streak goes up only when XP is earned (claiming a daily patch)', (await p.evaluate(() => me.stats.streak)) === st1 + 1);
  await p.click('[data-claim]').catch(() => {}); await p.waitForTimeout(200);
  ok('Streak does not go up twice on the same day', (await p.evaluate(() => me.stats.streak)) === st1 + 1);

  // paid student
  // the same student moves to the paid plan (as when an admin approves the payment)
  const q = p; await q.evaluate(() => { me.stats.plan = 'paid'; me.stats.batch = 'SOC-B7'; me.notifs = me.notifs || []; saveDb(); }); await q.reload(); await q.waitForTimeout(1500);
  for (let i = 0; i < 20 && await q.evaluate(() => !!(window.YojoStory && YojoStory.state)); i++) { await q.keyboard.press('Escape'); await q.waitForTimeout(200); }
  await go(q, '#/courses');
  const ctext = await q.textContent('#view');
  ok('Paid plan: My courses shows their enrolled courses', /My courses/.test(ctext) && (await q.$$('.ac-sec:nth-of-type(2) .ac-card')).length >= 1);
  const faqQ = await q.$$eval('.faq summary', l => l.map(x => x.textContent));
  ok('Paid plan: FAQs only cover courses they did not join', faqQ.length > 0 && !faqQ.some(t => /SOC Analyst|Web Application Security|Cybersecurity Foundations/.test(t)), faqQ.join(' | '));
  await snap(q, 'courses-paid');
  await go(q, '#/lms/placement');
  ok('Placement Mission has the resume and portfolio projects', !!(await q.$('[data-do="openresume"]')) && (await q.$$('.pf-item')).length >= 1);
  await q.click('[data-do="pf-add"]'); await q.waitForTimeout(200);
  await q.fill('#pfF [name=title]', 'Ransomware drill write-up'); await q.fill('#pfF [name=skills]', 'EDR, forensics'); await q.fill('#pfF [name=desc]', 'Contained a simulated ransomware outbreak.'); await q.fill('#pfF [name=github]', 'github.com/arjun/ransom-drill');
  await q.click('#pfF button'); await q.waitForTimeout(300);
  ok('Portfolio project saved with skills, title, description and GitHub', /Ransomware drill write-up/.test(await q.textContent('.pf-list')));
  await snap(q, 'placement');
  await q.click('[data-do="openresume"]'); await q.waitForTimeout(200);
  const link = await q.$eval('.modal a[href*="github.com/arjun/ransom-drill"]', a => a.href).catch(() => null);
  ok('Resume shows the GitHub link as a hyperlink', link === 'https://github.com/arjun/ransom-drill', link);
  await q.keyboard.press('Escape');
  await go(q, '#/lms/attendance'); ok('Attendance shows Present and Absent only', !/\bLate\b/.test(await q.textContent('.lms-main')));
  await go(q, '#/lms/calendar'); ok('Calendar legend has no Late', !/\bLate\b/.test(await q.textContent('.lms-main')));

  ok('No page errors', !errs.length, errs.join(' | '));
  await br.close();
  results.forEach(r => console.log(r[0] + '  ' + r[1] + (r[0] === 'FAIL' && r[2] ? '  -> ' + r[2] : '')));
  const f = results.filter(r => r[0] === 'FAIL').length; console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0);
})();
