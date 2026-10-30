const { chromium } = require('playwright');
// Student LMS <-> Trainer portal, both ways, in two tabs of one browser. Run with a static server on BASE.
const B = process.env.BASE || 'http://localhost:8765/';
const results = []; const ok = (n, c, x = '') => results.push([c ? 'PASS' : 'FAIL', n, x]);
(async () => { let br; try {
  br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const ctx = await br.newContext({ viewport: { width: 1366, height: 900 } }); const errs = [];
  const st = await ctx.newPage(); st.on('pageerror', e => errs.push('student: ' + e.message));
  await st.goto(B + 'login.html?stay=1');
  await st.evaluate(() => { YojoDemo.reset(); localStorage.removeItem('yojo_trainer_demo_v2'); const db = JSON.parse(localStorage.getItem('yojo_demo_db_v1')); const u = db.users.find(x => x.email === 'riya.sharma@students.yojo.demo');
    u.settings = Object.assign(u.settings || {}, { intro: false }); localStorage.setItem('yojo_demo_db_v1', JSON.stringify(db)); localStorage.setItem('yojo_demo_shared_session', JSON.stringify({ email: u.email, at: Date.now() })); });
  await st.goto(B + 'academy.html#/lms/trainer'); await st.waitForTimeout(1200);
  for (let i = 0; i < 30 && await st.evaluate(() => !!(window.YojoStory && YojoStory.state)); i++) { await st.keyboard.press('Escape'); await st.waitForTimeout(200); }
  await st.evaluate(() => { me.stats.plan = 'paid'; me.stats.batch = 'SOC-B7'; saveDb(); location.hash = '#/lms/learning'; location.hash = '#/lms/trainer'; }); await st.waitForTimeout(600);
  const SV = () => st.textContent('.lms-main');
  ok('Student sees the real assigned trainer, linked live', /Vikram Rao/.test(await SV()) && /Linked live/.test(await SV()));

  const tr = await ctx.newPage(); tr.on('pageerror', e => errs.push('trainer: ' + e.message));
  await tr.goto(B + 'login.html?stay=1'); await tr.evaluate(() => sessionStorage.setItem('yojo_demo_session', JSON.stringify({ email: 'trainer@yojo.demo', role: 'trainer', at: Date.now() })));
  const tgo = async h => { await tr.goto(B + 'trainer.html' + h); await tr.waitForFunction(() => !document.querySelector('#view .skel'), null, { timeout: 8000 }).catch(() => {}); await tr.waitForTimeout(300); };
  const TV = () => tr.textContent('#view');

  // trainer profile -> student
  await tgo('#/trainer/profile'); await tr.fill('#pf-title', 'Lead SOC Trainer'); await tr.fill('#pf-specialisation', 'Threat hunting'); await tr.click('#pfF button[type=submit]'); await tr.waitForTimeout(900);
  await st.bringToFront(); await st.evaluate(() => rerender()); await st.waitForTimeout(300);
  ok('Trainer profile changes show on the student page', /Lead SOC Trainer/.test(await SV()) && /Threat hunting/.test(await SV()));

  // student books -> trainer receives
  await st.click('[data-do=book]'); await st.waitForSelector('[data-slot]');
  await st.selectOption('#bkT', '1-to-1 doubt clearing'); await st.fill('#bkN', 'Need help with Sigma rules');
  await st.click('[data-slot] >> nth=0'); await st.waitForTimeout(400);
  ok('Student books a session from the trainer availability', /Waiting for trainer/.test(await SV()));
  await tgo('#/trainer/mentoring');
  ok('Trainer receives the booking with the student note', /Riya Sharma/.test(await TV()) && /Need help with Sigma rules/.test(await TV()));
  await tr.click('tr:has-text("Need help with Sigma rules") [data-act=prop]'); await tr.click('.modal-f .btn-primary'); await tr.waitForTimeout(800);
  await st.evaluate(() => rerender()); await st.waitForTimeout(300);
  ok('Trainer proposes a new time; the student sees it', /New time proposed/.test(await SV()));
  await st.click('[data-do=sess-yes]'); await st.waitForTimeout(300);
  ok('Student accepts the new time', /Confirmed/.test(await SV()));
  await tgo('#/trainer/mentoring');
  ok('Trainer sees the session confirmed', /Need help with Sigma rules[\s\S]*Accepted/.test(await TV()));

  // messages both ways
  await st.click('[data-do=msg]'); await st.fill('#msgSub', 'Lab DEF-03 question'); await st.fill('#msgTx', 'Which log source should I use?'); await st.click('#msgGo'); await st.waitForTimeout(400);
  await tgo('#/trainer/messages');
  ok('Trainer inbox gets the student message (unread)', /Lab DEF-03 question/.test(await TV()));
  const tid = await tr.evaluate(() => JSON.parse(localStorage.getItem('yojo_trainer_demo_v2')).threads.find(t => t.subject === 'Lab DEF-03 question').id);
  await tgo('#/trainer/messages/' + tid); await tr.fill('#rpl', 'Use the Windows Security log.'); await tr.click('[data-act=reply]'); await tr.waitForTimeout(800);
  await st.evaluate(() => rerender()); await st.waitForTimeout(300);
  ok('Student sees the trainer reply', /Use the Windows Security log/.test(await SV()));
  ok('Student bell gets a reply notification', await st.evaluate(() => me.notifs.some(n => /Reply from your trainer/.test(n.t))));

  // trainer content -> student, student progress -> trainer
  await tgo('#/trainer/content/new'); await tr.fill('#ncT', 'Sigma Rules Workshop'); await tr.check('.ncB[value=SOC-B7]'); await tr.click('#ncF button[type=submit]'); await tr.waitForTimeout(900);
  await tr.click('[data-act=addMod]'); await tr.click('[data-act=addLes]'); await tr.selectOption('[data-chg=lf][data-k=type]', 'PDF'); await tr.waitForTimeout(150);
  await tr.fill('[data-inp=lf][data-k=title]', 'Sigma cheat sheet');
  await tr.setInputFiles('[data-chg=upload]', { name: 'sigma.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(4096) }); await tr.waitForTimeout(4200);
  await tr.click('[data-act=saveDraft]'); await tr.waitForTimeout(900);
  const cid = tr.url().split('/').pop();
  await tgo(`#/trainer/content/${cid}/manage`); await tr.click('[data-act=publish]'); await tr.fill('#askV', 'First release'); await tr.click('.modal-f .btn-primary'); await tr.waitForTimeout(900);
  await st.evaluate(() => { location.hash = '#/lms/learning'; }); await st.waitForTimeout(500);
  ok('Published trainer content appears in the student LMS', /Course content from your trainer/.test(await SV()) && /Sigma Rules Workshop/.test(await SV()) && /Sigma cheat sheet/.test(await SV()));
  ok('Student bell announces the new content', await st.evaluate(() => me.notifs.some(n => /New course content/.test(n.t))));
  const lid = await st.evaluate(() => YojoBridge.courses(YojoBridge.link(me.email).sid).find(c => c.title === 'Sigma Rules Workshop').modules[0].lessons[0].id);
  await st.evaluate(() => { document.querySelectorAll('#trContent details').forEach(d => d.open = true); });
  await st.click(`[data-do=lesson][data-id="${lid}"]`); await st.waitForSelector('#lsDone'); await st.click('#lsDone'); await st.waitForTimeout(400);
  ok('Student completes a lesson', /100% complete/.test(await SV()));
  await tgo(`#/trainer/content/${cid}/enrolled`);
  ok('Trainer sees the student progress', /Riya Sharma[\s\S]*100%/.test(await TV()));
  ok('Draft lessons stay hidden from students', await st.evaluate(() => !YojoBridge.courses(YojoBridge.link(me.email).sid).some(c => c.title === 'Intro to Digital Forensics')));

  // leave: student -> trainer -> student
  await st.evaluate(() => { location.hash = '#/lms/trainer'; }); await st.waitForTimeout(400);
  await st.click('[data-do=leave]'); await st.waitForSelector('#lvR'); await st.click('#lvGo'); await st.waitForTimeout(150);
  ok('Leave needs a reason', /why you need leave/.test(await st.textContent('#lvE')));
  await st.fill('#lvR', 'Family function'); await st.click('#lvGo'); await st.waitForTimeout(400);
  ok('Student sees the leave request waiting', /My leave requests[\s\S]*Waiting for trainer/.test(await SV()));
  await tgo('#/trainer/attendance/SOC-B7');
  ok('Trainer gets the leave request on the attendance page', /Leave requests[\s\S]*Riya Sharma[\s\S]*Family function/.test(await TV()));
  ok('Trainer bell shows the leave request', await tr.evaluate(async () => (await TrainerAPI.notifications()).some(n => /Leave request from Riya Sharma/.test(n.text))));
  ok('Attendance has only Present and Absent', await tr.evaluate(() => [...document.querySelectorAll('.seg[data-sid] button')].every(b => ['P', 'A'].includes(b.dataset.v))));
  await tr.click('#leave [data-act=lv][data-d=Approved]'); await tr.waitForTimeout(800);
  await st.evaluate(() => rerender()); await st.waitForTimeout(300);
  ok('Student sees the leave approved and gets a notification', /My leave requests[\s\S]*Approved/.test(await SV()) && await st.evaluate(() => me.notifs.some(n => /Leave approved/.test(n.t))));

  // announcements and grades -> student
  await tgo('#/trainer/messages/compose'); await tr.fill('#anX', 'Extra lab hour on Saturday.'); await tr.click('[data-act=send]'); await tr.waitForTimeout(900);
  await tgo('#/trainer/assessments/AS-2/U-20418'); // not Riya: student must not see others' grades
  await tgo('#/trainer/assessments/AS-3/U-20417'); for (const k of ['Accuracy', 'Method', 'Clarity']) await tr.fill(`#r-${k}`, '5'); await tr.fill('#gc', 'Excellent detection logic.');
  await tr.click('[data-act=g][data-a=Publish]'); await tr.fill('#askV', await tr.evaluate(() => TrainerMFA.code())); await tr.click('.modal-f .btn-primary'); await tr.waitForTimeout(900);
  await st.evaluate(() => { location.hash = '#/lms/trainer'; }); await st.waitForTimeout(500);
  ok('Student sees the batch announcement', /Extra lab hour on Saturday/.test(await SV()));
  ok('Student sees the published grade and comment', /Mid-term exam: Detection[\s\S]*15 \/ 15/.test(await SV()) && /Excellent detection logic/.test(await SV()));
  ok('Student never sees other students\' grades', !/Phishing report[\s\S]*Draft/.test(await SV()));

  // live update across tabs without reload
  await st.bringToFront(); await st.evaluate(() => { location.hash = '#/lms/trainer'; });
  await tr.evaluate(() => { const d = JSON.parse(localStorage.getItem('yojo_trainer_demo_v2')); d.announcements.unshift({ id: 'AN-live', batch: 'SOC-B7', type: 'Reminder', text: 'Live update check', channels: ['In-app'], at: Date.now(), delivered: 8, read: 0 }); localStorage.setItem('yojo_trainer_demo_v2', JSON.stringify(d)); });
  await st.waitForTimeout(600);
  ok('Student page updates live when the trainer tab changes data', /Live update check/.test(await SV()));
  ok('No page errors', !errs.length, errs.join(' | '));
  } catch (e) { ok('Test run crashed', false, e.message.split('\n')[0]); }
  results.forEach(r => console.log(r[0].padEnd(5), r[1], r[0] === 'FAIL' ? r[2] : ''));
  console.log(`\n${results.filter(r => r[0] === 'PASS').length}/${results.length} passed`);
  await br.close();
})();
