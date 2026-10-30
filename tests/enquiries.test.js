const { chromium } = require('playwright');
// Mentorship, Internship and Contact forms on the public site reach the admin LMS (Enquiries).
const B = process.env.BASE || 'http://localhost:8765/';
const res = []; const ok = (n, c) => res.push([c ? 'PASS' : 'FAIL', n]);
(async () => { let br; try {
  br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const ctx = await br.newContext({ viewport: { width: 1366, height: 900 } }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(B + 'index.html'); await p.evaluate(() => localStorage.removeItem('yojo_enquiries'));
  const open = async pg => { await p.goto('about:blank'); await p.goto(B + 'index.html#' + pg); await p.waitForTimeout(700); };
  const submit = async f => { await p.click(`form[data-form=${f}] button[type=submit]`); await p.waitForTimeout(300); };
  const done = f => p.isVisible(`form[data-form=${f}] .ok`);
  await open('mentorship');
  await p.fill('#m-name', 'Ananya Rao'); await p.fill('#m-phone', '12'); await p.check('#m-ok'); await submit('mentor');
  ok('Mentorship: bad phone shows an error and is not saved', /valid phone/.test(await p.textContent('form[data-form=mentor] .enq-err')) && !(await done('mentor')));
  await p.fill('#m-phone', '+91 9876500001'); await submit('mentor');
  ok('Mentorship form submits', await done('mentor'));
  await open('internships');
  await p.fill('#i-name', 'Karthik Varma'); await p.fill('form[data-form=intern] #i-mail', 'karthik@example.com'); await p.fill('#i-why', 'I want to build detections.'); await submit('intern');
  ok('Internship form submits', await done('intern'));
  await open('contact');
  await p.fill('#c-name', 'Sai Teja'); await p.fill('#c-phone', '+91 9876500002'); await p.fill('#c-mail', 'sai@example.com'); await p.fill('#c-msg', 'Batch timings?'); await p.check('#c-ok'); await submit('contact');
  ok('Contact form submits', await done('contact'));
  await p.goto(B + 'login.html?stay=1'); await p.evaluate(() => sessionStorage.setItem('yojo_demo_session', JSON.stringify({ email: 'platform.admin@yojo.demo', role: 'admin', at: Date.now() })));
  await p.goto(B + 'admin.html#/admin/enquiries'); await p.waitForTimeout(1000);
  const V = await p.textContent('#view');
  ok('Admin sidebar has Enquiries', await p.isVisible('#nav a[data-mod=enquiries]'));
  ok('All three submissions reach the admin LMS', /Ananya Rao/.test(V) && /Karthik Varma/.test(V) && /Sai Teja/.test(V) && /Batch timings\?/.test(V) && /detections/.test(V));
  ok('Each shows which form it came from', /Mentorship[\s\S]*Internship[\s\S]*Contact Us/.test(V));
  await p.selectOption('[data-chg=ty]', 'intern'); await p.waitForTimeout(200);
  ok('Filter by form works', /Karthik/.test(await p.textContent('#eList')) && !/Ananya/.test(await p.textContent('#eList')));
  await p.click('#eList [data-act=st][data-s=Contacted]'); await p.waitForTimeout(800);
  ok('Admin can mark an enquiry contacted', /Contacted/.test(await p.textContent('#eList')) && await p.evaluate(() => JSON.parse(localStorage.getItem('yojo_enquiries')).some(r => r.status === 'Contacted')));
  ok('No page errors', !errs.length);
} catch (e) { ok('test run: ' + e.message.split('\n').slice(0,5).join(' / '), false); } finally { br && await br.close(); }
  res.forEach(r => console.log(r[0], ' ', r[1])); const f = res.filter(r => r[0] === 'FAIL').length; console.log(`\n${res.length - f} passed, ${f} failed`); process.exit(f ? 1 : 0); })();
