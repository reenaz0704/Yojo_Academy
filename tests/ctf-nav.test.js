const { chromium } = require('playwright');
// Landing-page CTF navigation: Try Now / Register / Login, guards, ?next=, expired session, Back/Forward, refresh, mobile.
const B = process.env.BASE || 'http://localhost:8765/';
const res = []; const ok = (n, c) => res.push([c ? 'PASS' : 'FAIL', n]);
(async () => { let br; try {
  br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  for (const vp of [{ width: 1366, height: 900, tag: 'desktop' }, { width: 390, height: 844, tag: 'mobile' }]) {
    const ctx = await br.newContext({ viewport: vp }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    const pages = []; ctx.on('page', x => pages.push(x));
    const settle = async () => { await p.waitForLoadState(); await p.waitForTimeout(450); };
    const T = vp.tag + ': ';
    await p.goto(B + 'index.html'); await p.evaluate(() => { localStorage.removeItem('yojo_ctf_registrations'); sessionStorage.clear(); });
    await p.goto(B + 'index.html#ctf'); await settle();
    ok(T + 'Direct link to the landing CTF section works', /index\.html#ctf$/.test(p.url()) && await p.isVisible('#ctfRegInline a[data-ctf-nav=register]') && !(await p.$('#ctfRegInline a[data-ctf-nav=try]')) && !/Try Now/i.test(await p.textContent('#ctfRegInline')));
    ok(T + 'CTF links open in the same tab', await p.$$eval('#ctfRegInline a', as => as.every(a => !a.target)));
    // Register
    await p.click('#ctfRegInline a[data-ctf-nav=register]'); await settle();
    ok(T + 'Register goes to ctf-register.html', /ctf-register\.html$/.test(p.url()));
    await p.click('#ctfBox button[type=submit]'); await p.waitForTimeout(200);
    ok(T + 'Empty registration shows a clear error', /add|enter|please/i.test(await p.textContent('#ctfBox .err')));
    await p.goBack(); await settle();
    ok(T + 'Back returns to the landing CTF section', /index\.html#ctf$/.test(p.url()) && await p.isVisible('#ctfRegInline'));
    await p.goForward(); await settle();
    ok(T + 'Forward returns to the register page', /ctf-register\.html$/.test(p.url()));
    await p.goBack(); await settle();
    // Login
    await p.click('#ctfRegInline a[data-ctf-nav=login]'); await settle();
    ok(T + 'Login goes to ctf-login.html', /ctf-login\.html\?next=ctf-dashboard\.html$/.test(p.url()) && await p.isVisible('#ctfBox [name=username]'));
    await p.reload(); await settle();
    ok(T + 'Refreshing the login page keeps it', /ctf-login\.html/.test(p.url()) && await p.isVisible('#ctfBox [name=username]'));
    await p.goto(B + 'index.html#ctf'); await settle();
    await p.goto(B + 'ctf-dashboard.html'); await settle();
    ok(T + 'Opening the dashboard when signed out goes to login', /ctf-login\.html\?next=ctf-dashboard\.html$/.test(p.url()) && !/Welcome/.test(await p.textContent('#ctfBox')));
    // register a player through the real form
    await p.goto(B + 'ctf-register.html'); await settle();
    const F = '#ctfBox';
    await p.fill('#r-name', 'Ravi Kumar'); await p.fill('#r-mail', 'ravi.' + vp.tag + '@example.com'); await p.fill('#r-phone', '+91 9876543210'); await p.fill('#r-inst', 'ABC Tech');
    const sel = await p.$$(F + ' select'); for (const s of sel) { const v = await s.$$eval('option', o => (o.find(x => x.value) || {}).value); if (v) await s.selectOption(v); }
    await p.fill(F + ' [name=username]', 'ravi_' + vp.tag[0]); await p.fill(F + ' [name=password]', 'Str0ng!pass9'); const pw2 = await p.$(F + ' [name=password2]'); if (pw2) await pw2.fill('Str0ng!pass9');
    for (const c of await p.$$(F + ' input[type=checkbox]')) await c.check();
    await p.click(F + ' button[type=submit]'); await p.waitForTimeout(1200);
    await p.waitForFunction(() => /^\d{6}$/.test((document.querySelector('#demoTotp') || {}).textContent || ''), null, { timeout: 5000 });
    await p.fill(F + ' [name=code]', await p.textContent('#demoTotp')); await p.click(F + ' button[type=submit]'); await p.waitForTimeout(500);
    ok(T + 'Registration success state with a login button', /You are in/.test(await p.textContent(F)) && !!(await p.$(F + ' a[href^="ctf-login.html?next=ctf-dashboard.html"]')));
    await p.click(F + ' a[href^="ctf-login.html"]'); await settle();
    await p.fill(F + ' [name=password]', 'Str0ng!pass9'); await p.click(F + ' button[type=submit]'); await p.waitForTimeout(1200);
    await p.fill(F + ' [name=otp]', await p.textContent('#demoOtp')); await p.click(F + ' button[type=submit]'); await p.waitForTimeout(500);
    await p.waitForFunction(() => /^\d{6}$/.test((document.querySelector('#demoTotp') || {}).textContent || ''));
    await p.fill(F + ' [name=totp]', await p.textContent('#demoTotp'));
    const [tab] = await Promise.all([ctx.waitForEvent('page'), p.click(F + ' button[type=submit]')]); await tab.waitForLoadState(); await tab.waitForTimeout(500);
    ok(T + 'Successful login opens the CTF dashboard in a new tab', /ctf-dashboard\.html$/.test(tab.url()) && /Welcome, Ravi/.test(await tab.textContent(F)));
    ok(T + 'Login tab says the CTF opened in a new tab', /opened in a new tab/.test(await p.textContent(F)) && /ctf-login\.html/.test(p.url()));
    await tab.close(); pages.length = 0;
    await p.goto(B + 'ctf-dashboard.html'); await settle();
    await p.reload(); await settle();
    ok(T + 'Refreshing the dashboard keeps the player signed in', /Welcome, Ravi/.test(await p.textContent(F)));
    // already signed in
    await p.goto(B + 'ctf-login.html?next=ctf-dashboard.html'); await settle();
    ok(T + 'Login page skips straight to the dashboard when signed in', /ctf-dashboard\.html$/.test(p.url()));
    await p.goto(B + 'ctf-login.html?next=https%3A%2F%2Fevil.example%2F'); await settle();
    ok(T + 'Unsafe ?next= cannot send the player off-site', /^http:\/\/localhost:8765\/ctf-dashboard\.html$/.test(p.url()));
    await p.goto(B + 'ctf-register.html'); await settle();
    ok(T + 'Register page skips to the dashboard when signed in', /ctf-dashboard\.html$/.test(p.url()));
    await p.goto(B + 'index.html#ctf'); await settle();
    ok(T + 'Signed in, the CTF section offers Go to My CTF', await p.isVisible('#ctfRegInline a[data-ctf-nav=mine]'));
    await p.goto(B + 'ctf-dashboard.html'); await settle();
    // expired session
    await p.evaluate(() => { const s = JSON.parse(sessionStorage.getItem('yojo_ctf_session')); s.exp = Date.now() - 1000; sessionStorage.setItem('yojo_ctf_session', JSON.stringify(s)); });
    await p.reload(); await settle();
    ok(T + 'Expired session goes to login with an explanation, no loop', /ctf-login\.html\?next=ctf-dashboard\.html&why=expired$/.test(p.url()) && /expired/i.test(await p.textContent(F)));
    await p.waitForTimeout(800);
    ok(T + 'Login page stays put after expiry (no redirect loop)', /ctf-login\.html/.test(p.url()));
    ok(T + 'No new tabs opened', pages.length === 0);
    ok(T + 'No page errors', !errs.length);
    await ctx.close();
  }
} catch (e) { ok('test run: ' + e.message.split('\n')[0], false); } finally { br && await br.close(); }
  res.forEach(r => console.log(r[0], ' ', r[1])); const f = res.filter(r => r[0] === 'FAIL').length; console.log(`\n${res.length - f} passed, ${f} failed`); process.exit(f ? 1 : 0); })();
