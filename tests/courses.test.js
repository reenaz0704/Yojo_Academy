const { chromium } = require('playwright');
// Course catalog: landing page, course pages, plan-aware student LMS, trainer FAQ edits, access rules, mobile.
const B = process.env.BASE || 'http://localhost:8765/';
const res = []; const ok = (n, c, x = '') => res.push([c ? 'PASS' : 'FAIL', n, x]);
const STU = { free: 'riya.sharma@students.yojo.demo', paid: 'arjun.k@students.yojo.demo' };
(async () => { let br; try {
  br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const ctx = await br.newContext({ viewport: { width: 1366, height: 900 } }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message + ' @' + p.url()));
  const fresh = async u => { await p.goto('about:blank'); await p.goto(B + u); await p.waitForTimeout(1300); };
  await fresh('login.html?stay=1'); await p.evaluate(() => { YojoDemo.reset(); localStorage.removeItem('yojo_trainer_demo_v2'); localStorage.removeItem('yojo_enquiries'); localStorage.removeItem('yojo_demo_shared_session'); sessionStorage.clear(); });

  // ---------- landing page (guest) ----------
  await fresh('index.html#training');
  const H = '#coursesSec';
  ok('1. Section header, text and Explore All Courses button', /TRAIN\. DEFEND\. MASTER THE DIGITAL WORLD\./.test(await p.textContent(H)) && /hands-on cybersecurity training, guided learning paths/.test(await p.textContent(H)) && await p.isVisible(H + ' a[href="#courses"]'));
  const pubN = await p.evaluate(() => YojoCourses.list().length);
  ok('1. Landing lists published courses only (drafts and unpublished hidden)', /13 courses/.test(await p.textContent('#cxHome .cx-count')) && pubN === 13 && !/Intro to Digital Forensics|Cloud Security Primer/.test(await p.textContent('#cxHome')));
  ok('1. Cards show title, category, Free/Paid badge and real details only', /SOC Analyst \(Blue Team\)/.test(await p.textContent('#cxHome')) && /12 weeks/.test(await p.textContent('#cxHome .cx-feat')) && !/★|learners\)|rating/i.test(await p.textContent('#cxHome')));
  const chips = await p.$$eval('#cxHome [data-cx-cat]', b => b.map(x => x.textContent));
  ok('2. Only categories that have courses are offered', chips.includes('Capture the Flag (CTF)') && !chips.includes('Cloud Security') && !chips.includes('AI and Cybersecurity'), chips.join('|'));
  await p.click('#cxHome [data-cx-cat="Governance, Risk and Compliance (GRC)"]');
  ok('2. Category filter works', /3 courses in Governance/.test(await p.textContent('#cxHome .cx-count')) && (await p.$$('#cxHome .cx-card')).length === 3);
  await p.click('#cxHome [data-cx-cat=""]'); await p.click('#cxHome [data-cx-tab=free]');
  ok('2. Free courses tab works', (await p.$$eval('#cxHome .cx-card h3', h => h.map(x => x.textContent))).join() === 'Cyber Foundations,CTF Starter: Warm-up Flags');
  await p.click('#cxHome [data-cx-tab=all]');
  // FAQ inside a card, keyboard
  await p.focus('#cxHome .cx-card .cx-faqs > summary'); await p.keyboard.press('Enter');
  ok('4/12. Card FAQ opens with the keyboard and lists questions', await p.$eval('#cxHome .cx-card .cx-faqs', d => d.open) && (await p.$$('#cxHome .cx-card .cx-faqs[open] .cx-faq details')).length > 0);
  // navigation to details
  await p.click('#cxHome [data-course="ceh-v13"] a.cx-btn'); await p.waitForTimeout(1300);
  ok('3. View Course opens the right details page', /#course\/ceh-v13$/.test(p.url()) && /CEH v13/.test(await p.textContent('#cxDetail h1')) && /Home[\s\S]*Courses/.test(await p.textContent('#cxDetail .cx-crumb')));
  ok('E. Details page: overview, labs, access, FAQ, related, actions', ['Hands-on labs and projects', 'Course access and pricing', 'Frequently asked questions', 'Related courses'].every(t => p.textContent('#cxDetail').then ? true : true) && /Hands-on labs and projects[\s\S]*Course access and pricing[\s\S]*Frequently asked questions[\s\S]*Related courses/.test(await p.textContent('#cxDetail')) && await p.isVisible('#cxDetail a[href="#contact"]'));
  ok('E. Missing curriculum is stated, not invented', /curriculum outline for this course has not been published yet/.test(await p.textContent('#cxDetail')));
  await p.goBack(); await p.waitForTimeout(1300);
  ok('5. Back returns to Training', /#training$/.test(p.url()) && await p.isVisible('#cxHome'));
  await p.goForward(); await p.waitForTimeout(1300);
  ok('5. Forward returns to the course', /#course\/ceh-v13$/.test(p.url()) && /CEH v13/.test(await p.textContent('#cxDetail h1')));
  await p.reload(); await p.waitForTimeout(1300);
  ok('5. Refresh on a course URL works', /CEH v13/.test(await p.textContent('#cxDetail h1')));
  await fresh('index.html#course/no-such-course');
  ok('5. Unknown course shows a clear not-available state', /not available/.test(await p.textContent('#cxDetail')));
  await fresh('index.html#course/intro-digital-forensics');
  ok('Draft course URL is not public', /not available/.test(await p.textContent('#cxDetail')));
  await fresh('index.html#courses');
  await p.fill('#cxAll .cx-search', 'vapt'); await p.waitForTimeout(150);
  ok('Explore All page lists everything and searches', /1 course/.test(await p.textContent('#cxAll .cx-count')) && /VAPT/.test(await p.textContent('#cxAll')));
  const landSoc = await p.evaluate(() => YojoCourses.get('soc-analyst').faqs.map(f => f.q + f.a).join('|'));

  // ---------- 11. unauthorized access to lesson content ----------
  const leak = await p.evaluate(() => JSON.stringify(YojoCourses.list()));
  ok('11. Public catalog carries no lesson files or links', !/"file"|"url"|\.mp4|\.pdf|meet\.demo/.test(leak));
  ok('11. Guests cannot open a lesson', await p.evaluate(() => { const c = YojoCourses.get('soc-analyst'), l = c.modules[0].lessons[1]; try { YojoCourses.lesson('', c.id, l.id); return false; } catch (e) { return e.code === 401; } }));

  // ---------- free-plan student ----------
  // the first-login tour and pop-ups are not under test here
  const asStudent = async (email, hash) => {
    await p.evaluate(e => { localStorage.setItem('yojo_demo_shared_session', JSON.stringify({ email: e, role: 'student' })); const db = JSON.parse(localStorage.getItem('yojo_demo_db_v1')), u = db.users.find(x => x.email === e); u.story = Object.assign({ briefed: {}, won: {} }, u.story, { introDone: true }); localStorage.setItem('yojo_demo_db_v1', JSON.stringify(db)); }, email);
    await fresh('academy.html'); await p.evaluate(h => location.hash = h, hash); await p.waitForTimeout(900);
    await p.evaluate(() => { document.querySelectorAll('.overlay, #storyLayer').forEach(o => o.remove()); document.body.style.overflow = ''; });
  };
  await asStudent(STU.free, '#/courses');
  const n = await p.$$eval('#csGrid .cx-card', x => x.length), nf = await p.$$eval('#csGrid .cx-card .cx-faqs', x => x.length);
  ok('4. Free student sees every published course with its FAQ', n === 13 && nf === 13 && /Your plan: Free/.test(await p.textContent('#view')), `${n}/${nf}`);
  await p.click('#csGrid [data-course="soc-analyst"] .cx-faqs > summary');
  ok('4. FAQ expands inside the catalog (no page change)', /#\/courses$/.test(p.url()) && await p.isVisible('#csGrid [data-course="soc-analyst"] .cx-faq details'));
  ok('4. Paid courses offer View Plans on the Free plan, not Enroll', await p.isVisible('#csGrid [data-course="ceh-v13"] [data-cx=plans]') && !(await p.$('#csGrid [data-cx=enrol]')));
  const lmsSoc = await p.evaluate(e => YojoCourses.forStudent(e).find(c => c.slug === 'soc-analyst').faqs.map(f => f.q + f.a).join('|'), STU.free);
  ok('9. Course FAQs match between the landing page and the LMS', lmsSoc === landSoc);
  await p.evaluate(() => location.hash = '#/courses/soc-analyst'); await p.waitForTimeout(800);
  ok('5. Free student: preview lesson opens, the rest stay locked', (await p.$$('#view [data-cx=lesson]')).length === 1 && (await p.$$eval('#view .cx-les', l => l.filter(x => /Locked/.test(x.textContent)).length)) >= 5);
  ok('5/11. Free student is refused protected lesson content by the server', await p.evaluate(e => { const c = YojoCourses.forStudent(e).find(x => x.slug === 'soc-analyst'), l = c.modules[0].lessons[1]; try { YojoCourses.lesson(e, c.id, l.id); return false; } catch (x) { return x.code === 403; } }, STU.free));
  await p.click('#view [data-cx=lesson]'); await p.waitForTimeout(300);
  ok('5. Preview lesson opens for the free student', /SIEM fundamentals/.test(await p.textContent('.overlay')));
  await p.click('.overlay [data-close]');
  await p.evaluate(() => location.hash = '#/courses/cyber-foundations'); await p.waitForTimeout(800);
  ok('4. Free course is fully open on the Free plan', (await p.$$('#view [data-cx=lesson]')).length === 2 && !(await p.$$eval('#view .cx-les', l => l.some(x => /Locked/.test(x.textContent)))));

  // ---------- paid-plan student ----------
  await asStudent(STU.paid, '#/courses');
  ok('6. Paid student sees My courses with progress and next action', /My courses/.test(await p.textContent('#view')) && /SOC Analyst/.test(await p.textContent('#view .cx-grid')) && /lessons done/.test(await p.textContent('#view .cx-grid')) && /Pending modules/.test(await p.textContent('#view .cx-grid')) && /(Start|Continue) Learning/.test(await p.textContent('#view .cx-grid')));
  ok('7. Other courses still show with FAQs and Enroll Now', (await p.$$('#csGrid .cx-card')).length === 12 && (await p.$$('#csGrid .cx-faqs')).length === 12 && await p.isVisible('#csGrid [data-course="ceh-v13"] [data-cx=enrol]'));
  ok('8. A Paid plan does not unlock every course', await p.evaluate(e => { const l = YojoCourses.forStudent(e); const ceh = l.find(c => c.slug === 'ceh-v13'), soc = l.find(c => c.slug === 'soc-analyst'); return ceh.state === 'locked' && soc.state === 'enrolled'; }, STU.paid));
  await p.click('#csGrid [data-course="ceh-v13"] [data-cx=enrol]'); await p.waitForTimeout(200);
  ok('7. Enroll Now sends an enrolment request', await p.evaluate(() => JSON.parse(localStorage.getItem('yojo_enquiries') || '[]').some(x => x.type === 'course' && /CEH/.test(x.interest))));
  const before = await p.evaluate(e => YojoCourses.forStudent(e).find(c => c.slug === 'soc-analyst').pct, STU.paid);
  await p.click('#view .cx-grid a.cx-btn.pri'); await p.waitForTimeout(900);
  ok('6. Continue Learning opens the course with every lesson open', /#\/courses\/soc-analyst/.test(p.url()) && !(await p.$$eval('#view .cx-les', l => l.some(x => /Locked/.test(x.textContent)))));
  await p.click('#view [data-cx=lesson].pri'); await p.waitForTimeout(300); await p.click('#lsDone'); await p.waitForTimeout(500);
  const after = await p.evaluate(e => YojoCourses.forStudent(e).find(c => c.slug === 'soc-analyst').pct, STU.paid);
  ok('6. Completing a lesson moves progress', after > before, `${before} -> ${after}`);

  // ---------- 10. trainer edits FAQ and listing ----------
  await p.evaluate(() => { localStorage.removeItem('yojo_demo_shared_session'); sessionStorage.setItem('yojo_demo_session', JSON.stringify({ email: 'trainer@yojo.demo', role: 'trainer', at: Date.now() })); });
  await fresh('trainer.html#/trainer/content/C-SOC/manage'); await p.waitForTimeout(800);
  ok('10. Trainer sees the listing and FAQ editor', await p.isVisible('#catF'));
  await p.click('#catF [data-act=faqAdd]'); await p.fill('#catF [data-fq="0"]', 'Is the batch online?'); await p.fill('#catF [data-fa="0"]', 'Yes, SOC-B7 meets online at 6:30 PM.');
  await p.click('#catF [type=submit]'); await p.waitForTimeout(900);
  ok('10. Trainer FAQ saves', !(await p.textContent('#catE').catch(() => '')));
  await p.click('#catF [data-act=faqAdd]'); await p.fill('#catF [data-fq="1"]', 'Question with no answer'); await p.click('#catF [type=submit]'); await p.waitForTimeout(700);
  ok('FAQ editor refuses a question without an answer', /question and an answer/.test(await p.textContent('#catE')));
  await fresh('index.html#course/soc-analyst');
  ok('10. Trainer FAQ appears on the public course page', /Is the batch online\?/.test(await p.textContent('#cxDetail')) && /Added by the course team/.test(await p.textContent('#cxDetail')));
  await p.evaluate(() => sessionStorage.clear());
  await asStudent(STU.free, '#/courses');
  ok('9/10. Same FAQ appears in the student LMS', /Is the batch online\?/.test(await p.$eval('#csGrid [data-course="soc-analyst"]', e => e.textContent)));
  await p.evaluate(() => { localStorage.removeItem('yojo_demo_shared_session'); sessionStorage.setItem('yojo_demo_session', JSON.stringify({ email: 'platform.admin@yojo.demo', role: 'admin', at: Date.now() })); });
  await fresh('admin.html#/admin/enquiries');
  ok('Enrolment request reaches the admin Enquiries page', /Course enrolment/.test(await p.textContent('#view')) && /CEH v13/.test(await p.textContent('#view')));
  ok('No page errors', !errs.length, errs.join(' | '));
  await ctx.close();

  // ---------- 12. mobile ----------
  const m = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const mp = await m.newPage();
  await mp.goto(B + 'index.html#training'); await mp.waitForTimeout(1300);
  ok('12. Mobile: no sideways scroll, one card per row', await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1) && await mp.$$eval('#cxHome .cx-card', c => c.length > 1 && c[0].getBoundingClientRect().left === c[1].getBoundingClientRect().left));
  await mp.tap('#cxHome [data-cx-tab=labs]'); await mp.waitForTimeout(150);
  ok('12. Mobile: tabs and filters work by touch', /course/.test(await mp.textContent('#cxHome .cx-count')) && await mp.$eval('#cxHome [data-cx-tab=labs]', b => b.getAttribute('aria-selected') === 'true'));
  await mp.goto(B + 'index.html#course/soc-analyst'); await mp.waitForTimeout(1300);
  ok('12. Mobile: course page fits the screen', await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1) && /SOC Analyst/.test(await mp.textContent('#cxDetail h1')));
  await m.close();
} catch (e) { ok('test run: ' + e.message.split('\n').slice(0, 3).join(' / '), false); } finally { br && await br.close(); }
  res.forEach(r => console.log(r[0], ' ', r[1], r[0] === 'FAIL' && r[2] ? '  ' + r[2] : '')); const f = res.filter(r => r[0] === 'FAIL').length; console.log(`\n${res.length - f} passed, ${f} failed`); process.exit(f ? 1 : 0); })();
