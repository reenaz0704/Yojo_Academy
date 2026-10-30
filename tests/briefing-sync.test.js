const { chromium } = require('playwright');
// Mascot / dialogue sync for the intro briefing. Run with a static server on BASE (see login-flows.test.js).
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
  // sample the controller every animation frame
  const sample = ms => p.evaluate(ms => new Promise(r => { const out = []; const t0 = performance.now(); const f = () => { const s = YojoStory.state; const v = document.querySelector('#storyLayer .orbi-stage video.on'); out.push({ t: Math.round(performance.now() - t0), ...(s || {}), len: (s && s.text || '').length, playing: !!(v && !v.paused), mouth: !!document.querySelector('#storyLayer .sl-por.open') }); if (performance.now() - t0 < ms) requestAnimationFrame(f); else r(out); }; f(); }), ms);
  const LINES = [{ who: 'mascot', act: 'laptop', text: 'Agent, we have a crisis. An unknown force is attacking the world, city by city. Every mission you clear frees one city.' }, { who: 'mascot', act: 'point', text: 'This is your command bar.' }, { who: 'mascot', text: 'Third line for the replay test.' }];
  const start = (voice, kind = 'tour') => p.evaluate(([v, L, k]) => { YojoPrefs.voice = v; window.__done = null; YojoStory.play(L, { kind: k }).then(x => window.__done = x); }, [voice, LINES, kind]);

  // 1 text-only: one step drives caption, gesture and mouth together
  await start(false); let tl = await sample(5200);
  const sp = tl.filter(x => x.state === 'speaking'), first = sp[0] || {}, last = tl[tl.length - 1];
  ok('Line 1 starts in the wave, then holds the laptop for the rest of the line', first.act === 'wave' && sp.some(x => x.act === 'laptop') && sp.filter(x => x.act === 'laptop').every((x, k, a) => k === 0 || a[k - 1].t <= x.t) && !sp.some(x => x.t > first.t + 1500 && x.act !== 'laptop'), sp.map(x => x.act).filter((a, k, arr) => arr[k - 1] !== a).join('>'));
  ok('Captions only grow while Orbi is speaking', tl.every((x, k) => k === 0 || x.len >= tl[k - 1].len) && tl.filter(x => x.state === 'preparing').every(x => x.len === 0));
  ok('Mouth is open exactly while speaking', tl.every(x => x.state !== 'speaking' || x.mouth) && tl.every(x => x.state !== 'completed' || !x.mouth));
  ok('Line ends: full caption, Orbi back to idle, no further changes', last.state === 'completed' && last.len === LINES[0].text.length && last.act === 'idle');
  ok('Speaking never continues after the caption is complete', !tl.some(x => x.state === 'speaking' && x.len === LINES[0].text.length && tl.find(y => y.t > x.t + 700 && y.state === 'speaking')));

  // 2 Next mid-line completes the line instantly; the next press advances and resets
  await p.click('#storyLayer .sl-next'); await p.waitForTimeout(500); await p.click('#storyLayer .sl-next'); await p.waitForTimeout(150);
  let s = await S(p); ok('Next mid-line shows the full line and stops Orbi', s.state === 'completed' && s.text === LINES[1].text && s.act === 'idle', JSON.stringify(s));
  await p.click('#storyLayer .sl-next'); await p.waitForTimeout(250); s = await S(p);
  ok('Next after a finished line moves to the next step with a fresh caption', s.step === 'tour-2' && s.text.length < LINES[2].text.length, JSON.stringify(s));

  // 3 pause / resume
  await p.click('#storyLayer .sl-replay'); await p.waitForTimeout(350); await p.click('#storyLayer .sl-pause'); const a1 = await S(p); await p.waitForTimeout(700); const a2 = await S(p);
  const vp = await p.evaluate(() => document.querySelector('#storyLayer .orbi-stage video.on').paused);
  ok('Pause freezes caption, gesture and mouth together', a1.state === 'paused' && a1.text === a2.text && vp && !(await p.$('#storyLayer .sl-por.open')), `${a1.text.length}/${a2.text.length}`);
  await p.click('#storyLayer .sl-pause'); await p.waitForTimeout(400); const a3 = await S(p);
  ok('Resume continues from the same point', a3.state === 'speaking' || a3.state === 'completed' ? a3.text.length > a2.text.length && a3.text.startsWith(a2.text) : false, `${a2.text.length}->${a3.text.length}`);
  // 4 replay restarts the same step from the beginning
  await p.waitForTimeout(1500); await p.click('#storyLayer .sl-replay'); await p.waitForTimeout(120); s = await S(p);
  ok('Replay restarts the same line from the start', s.step === 'tour-2' && s.text.length < 6 && s.state !== 'completed', JSON.stringify(s));
  // 5 previous and rapid clicks
  await p.click('#storyLayer .sl-prev'); await p.waitForTimeout(100); s = await S(p); ok('Previous goes back one step', s.step === 'tour-1', s.step);
  for (let k = 0; k < 12; k++) await p.click('#storyLayer .sl-next', { delay: 0 }).catch(() => {});
  await p.waitForTimeout(600); s = await S(p);
  ok('Rapid clicks never overlap lines or skip past the end incorrectly', !s || (['tour-1', 'tour-2'].includes(s.step) && LINES.some(l => l.text.startsWith(s.text))), JSON.stringify(s));
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);

  // 6 voice on: voice (or its failure) drives the line; nothing keeps talking after exit
  await start(true, 'brief'); tl = await sample(6000);
  const st2 = [...new Set(tl.map(x => x.state))];
  ok('With voice on, the voice (or its fallback) drives the line to a full, in-sync finish', st2.includes('speaking') && tl.filter(x => x.state === 'completed').every(x => x.len === LINES[0].text.length && x.act === 'idle'), st2.join(','));
  ok('Briefing opens with the wave, gesture starts with the voice', (tl.find(x => x.state === 'speaking') || {}).act === 'wave');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  ok('Exit stops speech, timers and the layer', !(await p.evaluate(() => speechSynthesis.speaking)) && !(await S(p)) && await p.evaluate(() => window.__done === true));
  // 7 speech that fails is caught and the line still completes on the text clock
  await p.evaluate(() => { window.__realSpeak = speechSynthesis.speak.bind(speechSynthesis); speechSynthesis.speak = u => setTimeout(() => u.onerror && u.onerror({ error: 'synthesis-failed' }), 50); });
  await start(true); await p.waitForTimeout(400); s = await S(p);
  ok('Voice failure falls back without freezing Orbi', s.state === 'speaking' && s.act === 'wave' && await p.evaluate(() => document.getElementById('storyLayer').dataset.error === 'synthesis-failed'), JSON.stringify(s));
  await p.waitForTimeout(5000); s = await S(p); ok('...and the line still completes in sync', s.state === 'completed' && s.text === LINES[0].text && s.act === 'idle');
  await p.evaluate(() => { speechSynthesis.speak = window.__realSpeak; }); await p.keyboard.press('Escape');
  // 8 repeated briefings stay clean
  for (let r = 0; r < 3; r++) { await start(false); await p.waitForTimeout(150); await p.keyboard.press('Escape'); await p.waitForTimeout(100); }
  await start(false); tl = await sample(1600);
  ok('Repeated briefings start clean (no stale lines or callbacks)', tl.every(x => x.step === 'tour-0') && tl.some(x => x.state === 'speaking') && tl.every(x => LINES[0].text.startsWith(x.text || '')));
  await p.keyboard.press('Escape');
  // 9 mobile: controls fit on screen
  await p.setViewportSize({ width: 390, height: 780 }); await start(false); await p.waitForTimeout(400);
  const fit = await p.evaluate(() => [...document.querySelectorAll('#storyLayer .sl-actions .btn')].every(b => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }));
  ok('Mobile: all briefing controls are on screen', fit);
  ok('No page errors', !errs.length, errs.join(' | '));
  await br.close();
  for (const r of results) console.log(r[0], ' ', r[1], r[2] ? ' :: ' + r[2] : '');
  console.log(`\n${results.filter(r => r[0] === 'PASS').length}/${results.length} passed`);
})().catch(e => { console.log('CRASH', e); process.exit(1); });
