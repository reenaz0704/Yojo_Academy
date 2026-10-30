/* =====================================================================
   Yojo Cyber Academy: STORY MODE for academy.html
   - Cast (Orbi the guide and the cities under attack) with portraits
   - Dialogue engine: portrait, name plate, typewriter text, spotlight pointer
   - First visit: Orbi's guided tour
   - Every mission: Orbi's briefing on a city under attack by the unknown force, and a victory scene
   - World Breach Map: cities turn green as missions are cleared
   Portraits: drop images into assets/characters/<id>.png (see README there).
   Until an image exists, an original emblem portrait is drawn instead.
   Loaded after academy.html and academy-game.js; reuses their globals.
   ===================================================================== */
(function story() {
  // In live mode a new student first chooses a career path; the story (and its intro tour) starts after that.
  if (typeof me === 'undefined' || !me || document.getElementById('app').hidden || (me.live && !me.category)) {
    // Live mode: academy-live.js signs the student in after this file has loaded, so start once that is done.
    if (window.YojoAcademyLive && !story.waiting) { story.waiting = true; window.YojoAcademyLive.ready.then(r => { if (r === true) setTimeout(story, 0); }); }
    return;
  }
  const IMG_DIR = 'assets/characters/';
  const NO_IMG = window.__yojoNoImg = new Set();  // ids whose image file is missing

  /* ---------------- cast ---------------- */
  // glyph = small original emblem used when no image file is present
  const CAST = {
    // mouth: lip line and jaw box in fractions of the image, for lip-sync; voice: speech settings
    // Orbi is the only guide; every city under attack by the unknown force is a mission
    mascot:    { name: 'Orbi', title: 'Your Cyber Guide', side: 'ally', col: '#2E8BFF', glyph: 'star4', voice: { pitch: 1.35, rate: 1.05 } },
    tokyo:     { name: 'Tokyo', title: 'Japan', side: 'city', col: '#FF4D6D', emoji: '🗼' },
    paris:     { name: 'Paris', title: 'France', side: 'city', col: '#7B61FF', emoji: '🥐' },
    newyork:   { name: 'New York', title: 'USA', side: 'city', col: '#3FA9F5', emoji: '🗽' },
    london:    { name: 'London', title: 'United Kingdom', side: 'city', col: '#E53935', emoji: '🎡' },
    dubai:     { name: 'Dubai', title: 'UAE', side: 'city', col: '#F5A623', emoji: '🏙️' },
    delhi:     { name: 'New Delhi', title: 'India', side: 'city', col: '#FF9933', emoji: '🕌' },
    singapore: { name: 'Singapore', title: 'Singapore', side: 'city', col: '#EF3340', emoji: '🦁' },
    sydney:    { name: 'Sydney', title: 'Australia', side: 'city', col: '#00B4D8', emoji: '🌉' },
    rio:       { name: 'Rio de Janeiro', title: 'Brazil', side: 'city', col: '#2ECC71', emoji: '⛰️' },
    cairo:     { name: 'Cairo', title: 'Egypt', side: 'city', col: '#D4A017', emoji: '🔺' },
    berlin:    { name: 'Berlin', title: 'Germany', side: 'city', col: '#9E9E9E', emoji: '🐻' },
    toronto:   { name: 'Toronto', title: 'Canada', side: 'city', col: '#FF3B30', emoji: '🍁' },
    seoul:     { name: 'Seoul', title: 'South Korea', side: 'city', col: '#1E88E5', emoji: '🏯' },
    mumbai:    { name: 'Mumbai', title: 'India', side: 'city', col: '#00BFA5', emoji: '🌊' },
    capetown:  { name: 'Cape Town', title: 'South Africa', side: 'city', col: '#8BC34A', emoji: '🏔️' }
  };
  const GLYPHS = {
    shield: '<circle cx="50" cy="50" r="30" fill="none" stroke="#fff" stroke-width="5"/><circle cx="50" cy="50" r="19" fill="none" stroke="#fff" stroke-width="5"/><path d="M50 38l3.5 8h8.5l-7 5 2.7 8.5L50 54l-7.7 5.5L45 51l-7-5h8.5z" fill="#fff"/>',
    reactor: '<circle cx="50" cy="50" r="26" fill="none" stroke="#fff" stroke-width="4"/><circle cx="50" cy="50" r="12" fill="#bff"/><path d="M50 24v10M50 66v10M24 50h10M66 50h10M32 32l7 7M61 61l7 7M68 32l-7 7M32 68l7-7" stroke="#fff" stroke-width="3"/>',
    hourglass: '<path d="M34 26h32L50 50l16 24H34l16-24z" fill="#fff"/>',
    bolt: '<path d="M55 20L34 54h14l-5 26 23-36H52z" fill="#fff"/>',
    saber: '<rect x="46" y="18" width="8" height="46" rx="4" fill="#fff"/><rect x="43" y="62" width="14" height="20" rx="2" fill="#ccd"/><path d="M43 67h14M43 72h14" stroke="#556" stroke-width="2"/>',
    falcon: '<circle cx="50" cy="50" r="26" fill="none" stroke="#fff" stroke-width="5"/><path d="M50 24v-6M62 46h16v8H62z" stroke="#fff" stroke-width="5" fill="#fff"/><circle cx="50" cy="50" r="7" fill="#fff"/>',
    droid: '<path d="M30 52a20 20 0 0140 0z" fill="#fff"/><rect x="30" y="54" width="40" height="22" rx="3" fill="#fff"/><circle cx="50" cy="42" r="5" fill="#123"/><path d="M36 62h28" stroke="#123" stroke-width="3"/>',
    helmet: '<path d="M26 60c0-22 10-36 24-36s24 14 24 36l-8 14H34z" fill="#111" stroke="#fff" stroke-width="3"/><path d="M36 48h28l-6 8H42z" fill="#fff"/><path d="M50 58v14M44 64l6 8 6-8" stroke="#fff" stroke-width="3" fill="none"/>',
    gauntlet: '<rect x="34" y="40" width="32" height="34" rx="6" fill="#d9a520"/><path d="M36 40V26M44 40V22M52 40V22M60 40V26" stroke="#d9a520" stroke-width="7" stroke-linecap="round"/><circle cx="40" cy="52" r="3" fill="#f33"/><circle cx="50" cy="52" r="3" fill="#36f"/><circle cx="60" cy="52" r="3" fill="#3f6"/><circle cx="50" cy="63" r="4" fill="#fd3"/>',
    horns: '<path d="M30 70V44c0-10 6-16 14-18M70 70V44c0-10-6-16-14-18" stroke="#ffd54f" stroke-width="6" fill="none"/><path d="M38 30L26 12M62 30l12-18" stroke="#ffd54f" stroke-width="6" stroke-linecap="round"/><circle cx="50" cy="56" r="12" fill="#fff"/>',
    eye: '<path d="M22 50c10-16 46-16 56 0-10 16-46 16-56 0z" fill="none" stroke="#fff" stroke-width="4"/><circle cx="50" cy="50" r="9" fill="#f33"/>',
    skull: '<path d="M30 46a20 20 0 0140 0v10l-6 6v8H36v-8l-6-6z" fill="#fff"/><circle cx="42" cy="48" r="5" fill="#600"/><circle cx="58" cy="48" r="5" fill="#600"/><path d="M50 54l-3 6h6z" fill="#600"/>',
    star4: '<path d="M50 16l8 26 26 8-26 8-8 26-8-26-26-8 26-8z" fill="#fff"/><circle cx="50" cy="50" r="6" fill="#00F0FF"/>'
  };
  function emblemSvg(c) {
    return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="pg-${c.glyph}${c.col.slice(1)}" cx="50%" cy="35%" r="70%"><stop offset="0" stop-color="${c.col}"/><stop offset="1" stop-color="#05080F"/></radialGradient></defs>
      <path d="M50 3l42 24v46L50 97 8 73V27z" fill="url(#pg-${c.glyph}${c.col.slice(1)})" stroke="${c.col}" stroke-width="2"/>${c.emoji ? `<text x="50" y="64" text-anchor="middle" font-size="42">${c.emoji}</text>` : (GLYPHS[c.glyph] || '')}</svg>`;
  }
  // Orbi in dialogues: one transparent clip per gesture, cross-faded so Orbi moves freely between them.
  // Each clip plays forward then back, so it always ends on the frame it started with.
  const ACTS = ['idle', 'hello', 'wave', 'explain', 'point', 'talk', 'laptop', 'think', 'analyze', 'thumbsup', 'wink', 'celebrate', 'cheer', 'intro'];
  // the guided tour has one recorded clip per step: Orbi's own voice, lip-sync and gestures (cutout video + audio track)
  const TOUR_CLIPS = Array.from({ length: 12 }, (_, k) => 'tour' + k);
  ACTS.push(...TOUR_CLIPS);
  // Opus where the browser plays it, AAC (Safari) otherwise
  const VOICE_EXT = (() => { try { return new Audio().canPlayType('audio/ogg; codecs=opus') ? '.ogg' : '.m4a'; } catch { return '.m4a'; } })();
  // situations: Orbi strings the clips of a mood together while speaking, then settles into idle
  const MOODS = { greet: ['hello', 'wave'], explain: ['explain', 'point', 'talk', 'laptop'], think: ['think', 'analyze'], alarm: ['analyze', 'think'], encourage: ['thumbsup', 'wink'], playful: ['wink', 'thumbsup'], celebrate: ['celebrate', 'cheer', 'thumbsup'], idle: ['idle'] };
  // how each emotion shows: gestures (above), a small emote over Orbi's head and the colour of the glow behind Orbi
  const EMOTE = { greet: ['👋', '#2E8BFF'], explain: ['', '#00F0FF'], think: ['🤔', '#9D7BFF'], alarm: ['⚠️', '#FF4D4D'], encourage: ['👍', '#2EFF6A'], playful: ['😉', '#FF7AD9'], celebrate: ['🎉', '#FFC83D'] };
  // reads one sentence and picks the emotion that fits it
  function emotionOf(t) {
    if (/^(run|tamper|hunt|show|break|triage|read|build|analyse|write|draft|list|map|score|collect)\b/i.test(t)) return 'explain';  // instructions: calm and focused
    if (/hehe|boop|tickles|psst/i.test(t)) return 'playful';
    if (/secured|saved|is safe|safe again|woohoo|outstanding|brilliant|amazing|proud|well (done|fought)|great (work|hunting)|good (work|hunting)|passes|lights? up|back on|moving again|breathing again|dancing|on the run|unmasked|caught them|exposed|blocked at|panel found|mapped and solid|audit ready|scorecard done|policy in place|timeline filed|noise sorted|asset accounted/i.test(t)) return 'celebrate';
    if (/^(hi|hello|hey|welcome)\b|good luck|meet me|i'm off|heading out|i'm orbi/i.test(t)) return 'greet';
    if (/crisis|trouble|hijack|attack|gone dark|frozen|flood|hammer|drowning|forged|misus|scattered|targeting|probing|\bhit\b|breach(?! map)|under the unknown force|misinformation|weak login|careless|whispering|nobody knows|automated guesses|trick|invaders|never sleep/i.test(t)) return 'alarm';
    if (/\?|you can't protect|don't even know|claims? controls|wondering|let me think/i.test(t)) return 'think';
    if (/you can|keeps?\b|reward|bonus|claim|fill it|promoted|you'll|turn (it )?on|switch off|never reuse|check the|patch early|best friend|good luck|recommended|every mission you clear|frees one city|turn the whole map/i.test(t)) return 'encourage';
    return 'explain';
  }
  // splits a line into sentences, each with its own emotion, so Orbi's face and gesture change as the line goes on
  function emotionSegments(text, fixed) {
    const parts = text.match(/[^.!?]+[.!?]*["')]*\s*/g) || [text];
    let at = 0;
    return parts.map(p => { const seg = { at, emo: fixed || emotionOf(p.trim()) }; at += p.length; return seg; })
      .filter((g, i, a) => i === 0 || g.emo !== a[i - 1].emo);
  }
  const MOOD_OF = {}; Object.entries(MOODS).forEach(([m, l]) => l.forEach(c => { MOOD_OF[c] = MOOD_OF[c] || m; }));
  window.__orbiFallback = v => {
    const st = v.closest('.orbi-stage'); if (!st || st.dataset.fb) return; st.dataset.fb = '1';
    const i = new Image(); i.alt = CAST.mascot.name; i.className = 'orbi-still'; i.onload = () => i.closest('.sl-por')?.classList.add('has-img'); i.src = IMG_DIR + 'mascot.png';
    st.querySelectorAll('video').forEach(x => x.remove()); st.appendChild(i);
  };
  function orbiStage(cls = '') {
    return `<div class="orbi-stage ${cls}" data-act="idle">${ACTS.map(a => `<video data-act="${a}" class="${a === 'idle' ? 'on' : ''}" src="${IMG_DIR}orbi-${a}.webm" muted playsinline preload="${/^tour/.test(a) ? 'none' : 'auto'}" aria-hidden="true" onloadeddata="this.closest('.sl-por')?.classList.add('has-img');if(this.classList.contains('on'))this.play().catch(()=>{})" onended="window.__orbiNext(this)" onerror="window.__orbiFallback(this)"></video>`).join('')}</div>`;
  }
  function orbiVideo() {
    const c = CAST.mascot;
    return `<div class="portrait p-${c.side} orbi-por" style="--pc:${c.col}" title="Click Orbi" role="button" tabindex="0" aria-label="${c.name}, click to interact">${orbiStage()}${emblemSvg(c)}<span class="orbi-quip" hidden></span><span class="orbi-emote" aria-hidden="true"></span></div>`;
  }
  // cross-fade to one clip and play it from the start
  function showClip(st, clip) {
    st.dataset.act = clip;
    st.querySelectorAll('video').forEach(v => {
      const on = v.dataset.act === clip;
      if (on && v.classList.contains('on') && !v.paused) { v.loop = clip === 'idle' || (st._lineClip === clip && !/^tour/.test(clip)); return; }
      if (on) { v.loop = clip === 'idle' || (st._lineClip === clip && !/^tour/.test(clip)); try { v.currentTime = 0; } catch {} v.playbackRate = st._rate && st._list && st._list[0] === clip ? st._rate : 1; v.play().catch(() => {}); }
      else if (v.classList.contains('on')) setTimeout(() => { if (!v.classList.contains('on')) v.pause(); }, 650);
      v.classList.toggle('on', on);
    });
  }
  // when a clip finishes: keep going through the mood while Orbi is busy, otherwise settle into idle
  window.__orbiNext = v => {
    const st = v.closest('.orbi-stage'); if (!st || !v.classList.contains('on')) return;
    if (/^tour/.test(v.dataset.act)) return; // recorded tour clips hold the pose they end on
    const list = st._list || ['idle'];
    if (st._busy || (st._hold && Date.now() < st._hold)) {
      // pick a different gesture of the same feeling, so a long line never repeats the same move back to back
      let j = list.length > 1 ? Math.floor(Math.random() * (list.length - 1)) : 0; if (list.length > 1 && j >= (st._idx || 0)) j++;
      st._idx = j; showClip(st, list[j]);
    }
    else showClip(st, 'idle');
  };
  // show an emotion on the dialogue Orbi: gestures, emote and glow
  function feel(por, emo) {
    const st = por.querySelector('.orbi-stage'); if (!st || st.dataset.mood === emo) return;
    setAct(por, emo);
    const e = EMOTE[emo]; if (!e) return;
    por.style.setProperty('--pc', e[1]); const op = por.querySelector('.orbi-por'); if (op) op.dataset.emo = emo;
    const em = por.querySelector('.orbi-emote'); if (em) em.textContent = ''; if (em && e[0]) { em.textContent = e[0]; em.classList.remove('emo-pop'); void em.offsetWidth; em.classList.add('emo-pop'); }
  }
  // gesture rules: cheering only when a lab or course is cleared; pointing when explaining one specific thing
  // (a highlighted block, or a line marked act:'point'); holding the laptop when explaining anything important
  function pickGesture(ln, kind, emo) {
    if (kind === 'victory' || ln.win) return 'cheer';
    const a = ACTS.includes(ln.act) ? ln.act : null;
    if (a === 'intro' || /^tour\d+$/.test(a)) return a;
    if (a === 'hello' || a === 'wave' || a === 'think' || a === 'thumbsup' || a === 'wink') return a;
    if (a === 'point' || ln.target) return 'point';
    if (emo === 'greet') return 'hello';
    if (emo === 'encourage' || emo === 'playful' || emo === 'celebrate') return 'thumbsup';
    return 'laptop';
  }
  // the strongest feeling anywhere in the line decides its single gesture
  function lineEmotion(text) {
    const found = (text.match(/[^.!?]+[.!?]*/g) || [text]).map(x => emotionOf(x.trim()));
    return ['celebrate', 'alarm', 'greet', 'think', 'encourage', 'playful'].find(e => found.includes(e)) || 'explain';
  }
  // set Orbi's situation: a mood (greet, explain, think, encourage, celebrate, idle) or a single gesture to start with
  function setAct(root, act, holdMs = 0) {
    const st = root && (root.classList?.contains('orbi-stage') ? root : root.querySelector('.orbi-stage')); if (!st) return;
    const mood = MOODS[act] ? act : MOOD_OF[act]; if (!mood) return;
    const list = MOODS[mood].slice(); if (!MOODS[act]) list.unshift(...list.splice(list.indexOf(act), 1));
    st._list = list; st._idx = 0; st.dataset.mood = mood; if (holdMs) st._hold = Date.now() + holdMs;
    showClip(st, list[0]);
  }
  // image if present in assets/characters/<id>.png, else emblem
  function portrait(id, talk) {
    const c = CAST[id], m = talk && c.mouth;
    // talking portraits get a second copy of the lower face (the "jaw") that drops while speaking
    const jaw = m ? `<img class="jaw" src="${IMG_DIR}${id}.png" alt="" aria-hidden="true" style="clip-path:inset(${(m.y * 100).toFixed(1)}% ${((1 - m.x - m.w / 2) * 100).toFixed(1)}% ${((1 - m.y - m.h) * 100).toFixed(1)}% ${((m.x - m.w / 2) * 100).toFixed(1)}%)" onerror="this.remove()">` : '';
    const img = NO_IMG.has(id) ? '' : `<img src="${IMG_DIR}${id}.png" alt="${c.name}" onload="this.closest('.sl-por')?.classList.add('has-img')" onerror="window.__yojoNoImg&&window.__yojoNoImg.add('${id}');this.parentNode.querySelector('.jaw')?.remove();this.remove()">${jaw}`;
    return `<div class="portrait p-${c.side}" style="--pc:${c.col}">${img}${emblemSvg(c)}</div>`;
  }

  /* ---------------- story: The Unknown Force Data Siege ---------------- */
  // An unknown force is attacking the world, hijacking the world's data. Each mission frees one city.
  // Orbi briefs every mission, explains the city's situation, then heads off on its own mission.
  // [briefer, city, briefing lines, victory lines]
  const STORY = {
    'OFF-01': ['mascot', 'tokyo', [['mascot', "Agent, Tokyo has gone dark. The unknown force slipped into its rail control network and nobody knows which doors they opened."], ['mascot', "Run a safe recon scan, map every service, and send me the picture. Then we shut their doors one by one."]], [['mascot', "Tokyo's trains are moving again! Clean recon is how every rescue starts."]]],
    'OFF-02': ['mascot', 'paris', [['mascot', "Paris is in trouble. The unknown force forged a session cookie and walked straight into the city's payment vault."], ['mascot', "Tamper with the cookie in the lab, prove the app trusts it blindly, and we lock them out."]], [['mascot', "Paris is breathing again. Remember this one: never trust what the client sends."]]],
    'OFF-03': ['mascot', 'newyork', [['mascot', "New York's stock exchange is frozen. The unknown force hid their control panel on paths nobody links to."], ['mascot', "Hunt the hidden directories and find that panel before markets open."]], [['mascot', "Panel found and pulled! Wall Street is trading again. Great hunting, Agent."]]],
    'OFF-04': ['mascot', 'london', [['mascot', "London's city records sit behind an old login, and the unknown force is slipping through its careless code."], ['mascot', "Show how a single quote breaks the query, then tell me how to fix it properly."]], [['mascot', "London is safe. Now patch it with parameterised queries so it never happens again."]]],
    'OFF-05': ['mascot', 'dubai', [['mascot', "Dubai's smart towers are run by one weak login: default passwords and no lockout. The unknown force loves that."], ['mascot', "Break the authentication in the lab, then rebuild it with lockout, strong rules and MFA."]], [['mascot', "Dubai's skyline lights up again, and its gate is rebuilt the right way."]]],
    'DEF-01': ['mascot', 'delhi', [['mascot', "New Delhi's SOC is drowning. The unknown force is flooding the alert queue so the real attack slips past."], ['mascot', "Triage the queue with a calm head: severity first, then source, then time."]], [['mascot', "Noise sorted, real threats found. New Delhi's defenders can see again."]]],
    'DEF-02': ['mascot', 'singapore', [['mascot', "Singapore's port login server is being hammered with thousands of automated guesses a minute."], ['mascot', "Read the auth logs, find the source of the brute force, and block it before one guess lands."]], [['mascot', "Blocked at the gate! Ships are moving through Singapore again."]]],
    'DEF-03': ['mascot', 'sydney', [['mascot', "The unknown force is whispering hidden signals through Sydney's network. The SIEM sees them, but no rule fires."], ['mascot', "Build a detection rule in the SIEM sandbox. Next time their signal shows up, we will know."]], [['mascot', "Your rule caught them red-handed. Sydney's harbour lights are back on."]]],
    'DEF-04': ['mascot', 'rio', [['mascot', "Rio is getting forged mail that claims to come from the city treasury. Classic unknown-force trick."], ['mascot', "Analyse the headers, prove the mail is forged, and warn everyone in the city."]], [['mascot', "Phishing exposed and everyone warned. Rio is dancing again!"]]],
    'DEF-05': ['mascot', 'cairo', [['mascot', "The unknown force hit Cairo's national archive last night. All we have left are the system logs."], ['mascot', "Write the incident timeline: what happened, when, how, and what we did about it."]], [['mascot', "Timeline filed. Cairo's history is safe, and the attackers left more evidence than they think."]]],
    'GRC-01': ['mascot', 'berlin', [['mascot', "Berlin's government laptops are being misused, and there is no acceptable use policy to stop it."], ['mascot', "Draft that policy. Clear rules, properly worded, so the unknown force has nowhere to hide."]], [['mascot', "Policy in place. Berlin just closed the attackers' playground."]]],
    'GRC-02': ['mascot', 'toronto', [['mascot', "The unknown force is targeting Toronto assets the city doesn't even know it has. You can't protect what you can't see."], ['mascot', "List every asset and rate how critical it is. Then we know exactly what to guard."]], [['mascot', "Every asset accounted for. Toronto is secured, eh!"]]],
    'GRC-03': ['mascot', 'seoul', [['mascot', "Seoul claims controls it never built, and the unknown force is probing every gap."], ['mascot', "Map the controls to ISO 27001 and find the gaps before the attackers do."]], [['mascot', "Mapped and solid. Seoul has no gaps left to exploit."]]],
    'GRC-04': ['mascot', 'mumbai', [['mascot', "Mumbai's banks are being told half their risks don't matter. That's the unknown force's misinformation."], ['mascot', "Score five risks by likelihood and impact and pick a treatment for each."]], [['mascot', "Risk scorecard done. Mumbai's markets are calm again."]]],
    'GRC-05': ['mascot', 'capetown', [['mascot', "An auditor lands in Cape Town tomorrow, and the unknown force has scattered the city's evidence everywhere."], ['mascot', "Collect every piece of evidence the audit needs, neatly labelled."]], [['mascot', "Audit ready! Cape Town passes with flying colours."]]]
  };
  const VILLAINS = ['tokyo', 'paris', 'newyork', 'london', 'dubai', 'delhi', 'singapore', 'sydney', 'rio', 'cairo', 'berlin', 'toronto', 'seoul', 'mumbai', 'capetown'];
  const CAMPAIGN_ARCS = {
    'Cybersecurity Foundations': ['mascot', 'All', 'Basic training. Learn the basics before the unknown force find you.'],
    'Junior Penetration Tester': ['mascot', 'tokyo', 'Think like the invaders to free Tokyo, Paris and New York.'],
    'SOC Analyst': ['mascot', 'delhi', 'Hold the SOC watchtower from New Delhi to Singapore.'],
    'GRC Analyst': ['mascot', 'berlin', 'Shut the attackers out with policy and audit, from Berlin to Cape Town.'],
    'Web Application Security': ['mascot', 'paris', 'Every web app the unknown force touch turns into a trap. Make them safe.'],
    'Cloud Security Essentials': ['mascot', 'dubai', 'The unknown force rides the cloud. Lock down every bucket and key.']
  };

  /* ---------------- settings ---------------- */
  const st = me.story = me.story || { introDone: false, briefed: {}, won: {} };
  const persist = () => { try { saveDb(); } catch {} };
  // intro: play the husky's tour when entering through the portal; voice: spoken lines; mascot: the husky spy
  const prefs = me.settings = Object.assign({ intro: true, voice: true, mascot: true }, me.settings || {});
  window.YojoPrefs = prefs;

  /* ---------------- voice + lip-sync ---------------- */
  const synth = window.speechSynthesis;
  let voices = [];
  const loadVoices = () => { try { voices = synth ? synth.getVoices() : []; } catch { voices = []; } };
  loadVoices(); if (synth) synth.onvoiceschanged = loadVoices;
  function pickVoice() {
    const en = voices.filter(v => /^en/i.test(v.lang));
    return en.find(v => /male|daniel|david|george|guy|alex|fred|ryan/i.test(v.name) && !/female/i.test(v.name)) || en.find(v => /en-(US|GB|IN)/i.test(v.lang)) || en[0] || null;
  }
  let mouthTimer = null;
  function mouth(open) { document.querySelector('#storyLayer .sl-por')?.classList.toggle('open', !!open); }
  // Orbi's video only plays while a line is being spoken, so the mouth moves with the voice
  // while Orbi speaks, the gestures of the line's mood keep flowing; when the voice stops, Orbi finishes the move and settles into idle
  const stage = () => document.querySelector('#storyLayer .sl-por .orbi-stage');
  let wordTimer = null;
  function talkStart() { const st = stage(); if (!st) return; st._busy = true; if (st.dataset.act === 'idle' && st._list && st._list[0] !== 'idle') showClip(st, st._list[st._idx || 0]); }
  function talkStop() { clearTimeout(mouthTimer); clearTimeout(wordTimer); mouthTimer = null; mouth(false); const st = stage(); if (st) { st._busy = false; endLine(st); } }
  // the line's gesture loops seamlessly (no restart at full stops); once the line is over it finishes its pass and settles into idle
  function endLine(st) {
    clearTimeout(st._endT);
    st._endT = setTimeout(() => { if (st._busy) return; const c = st._lineClip; st._lineClip = null; const v = c && st.querySelector(`video[data-act="${c}"]`); if (v) v.loop = false; }, Math.max(0, (st._hold || 0) - Date.now()));
  }
  function onWord() { talkStart(); }
  function hush() { try { synth && synth.cancel(); } catch {} talkStop(); }
  // speaks a line; the mouth moves with the words (word boundaries), or with the typing when voice is off
  function say(text, who) {
    hush();
    if (!prefs.voice || !synth || typeof SpeechSynthesisUtterance === 'undefined') {
      // no voice: animate for about as long as the line takes to read
      talkStart(); mouthTimer = setTimeout(talkStop, Math.min(9000, 1200 + text.length * 45)); return false;
    }
    const u = new SpeechSynthesisUtterance(text.replace(/\*[^*]+\*/g, ''));
    const v = pickVoice(); if (v) u.voice = v;
    Object.assign(u, { pitch: 1, rate: 1 }, CAST[who].voice || {});
    u.onstart = talkStart; u.onend = talkStop; 
    // speech failed (no voices installed, blocked): still animate Orbi for about the length of the line
    u.onerror = e => { if (/interrupted|canceled/.test(e.error)) return; talkStop(); talkStart(); mouthTimer = setTimeout(talkStop, Math.min(9000, 1200 + text.length * 45)); };
    try { synth.speak(u); } catch { return false; }
    // some browsers never fire onstart: check shortly after and animate anyway
    mouthTimer = setTimeout(() => { if (synth.speaking) talkStart(); else { talkStart(); mouthTimer = setTimeout(talkStop, Math.min(9000, 1200 + text.length * 45)); } }, 600);
    return true;
  }
  window.YojoVoice = { say, hush };

  /* ---------------- dialogue engine ---------------- */
  let scene = null;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function ensureLayer() {
    let L = document.getElementById('storyLayer');
    if (L) return L;
    L = document.createElement('div'); L.id = 'storyLayer';
    L.innerHTML = `<div class="sl-dim"></div><div class="sl-ring" hidden><span class="sl-arrow">▼</span></div>
      <div class="sl-box" role="dialog" aria-modal="true" aria-live="polite">
        <div class="sl-por"></div>
        <div class="sl-body"><div class="sl-name"><b></b><small></small></div><p class="sl-text"></p>
          <div class="sl-actions"><span class="sl-step mono"></span><button type="button" class="btn btn-sm btn-ghost sl-mute" aria-label="Voice on or off"></button><button type="button" class="btn btn-sm btn-ghost sl-skip">Skip</button><button type="button" class="btn btn-sm btn-ghost sl-replay" aria-label="Replay this line" title="Replay line (R)">↻</button><button type="button" class="btn btn-sm btn-ghost sl-pause" aria-label="Pause or resume" title="Pause (P)">❚❚ Pause</button><button type="button" class="btn btn-sm btn-ghost sl-prev" aria-label="Previous line">◂ Previous</button><button type="button" class="btn btn-sm btn-primary sl-next">Next ▸</button></div></div>
      </div>`;
    document.body.appendChild(L);
    return L;
  }
  function place(el) {
    const ring = document.querySelector('#storyLayer .sl-ring'), dim = document.querySelector('#storyLayer .sl-dim');
    const box = document.querySelector('#storyLayer .sl-box'), L = document.getElementById('storyLayer');
    if (!el) { ring.hidden = true; dim.classList.remove('cut'); box.classList.remove('top', 'bottom'); L.classList.remove('compact'); return; }
    const r = el.getBoundingClientRect(), pad = 2;
    ring.hidden = false; dim.classList.add('cut');
    Object.assign(ring.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    // keep the dialogue clear of the highlighted element
    // the dialogue always stays in the centre of the page
    L.classList.add('compact');
  }
  // which gesture Orbi uses on a line when the line does not name one
  function autoAct(ln, i, total, kind) {
    if (kind === 'victory') return 'celebrate';
    if (kind === 'brief') return i === 0 ? 'think' : 'explain';
    if (i === 0 || i === total - 1) return 'greet';
    if (/\?/.test(ln.text)) return 'think';
    return 'explain';
  }
  // click Orbi during a dialogue: a wink and a quick reaction, then back to the line
  const QUIPS = ['Hehe, that tickles! 🐾', 'Focus, Agent! The unknown force never sleeps.', 'Yes? I\'m right here with you.', 'Boop! Cyber guide on duty.', 'Psst. Every mission saves a city.'];
  function bindOrbiClick(por) {
    const p = por.querySelector('.orbi-por'); if (!p) return;
    const react = () => {
      const st = p.querySelector('.orbi-stage'), back = st && st._list ? st._list.slice() : ['explain'], backHold = st && st._hold, q = p.querySelector('.orbi-quip');
      setAct(por, 'wink', 2400);
      q.textContent = QUIPS[Math.floor(Math.random() * QUIPS.length)]; q.hidden = false;
      clearTimeout(p._qt); p._qt = setTimeout(() => { q.hidden = true; if (st) { st._list = back; st._idx = 0; st._hold = backHold; showClip(st, st._lineClip || 'idle'); } }, 2600);
    };
    p.addEventListener('click', react); p.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); react(); } });
  }
  // ---- briefing timing: the only place dialogue timing is configured ----
  const BRIEF = {
    readCps: 34,      // caption reveal speed with voice off (characters per second)
    speechCps: 14.5,  // expected speaking speed, used to reveal captions between word-boundary events
    holdMs: 450,      // pause after a text-only line finishes before Orbi settles
    introWaveMs: 1000,// the first line of a briefing or the tour opens with a wave
    startTimeoutMs: 1500 // speech that never starts within this is treated as failed
  };
  // one structured step per dialogue line; the dialogue box, voice and Orbi are all driven from it
  function toStep(ln, i, kind) {
    const emo = ln.emo || (ln.act && MOOD_OF[ln.act]) || (kind === 'victory' ? 'celebrate' : kind === 'brief' ? (i === 0 ? 'alarm' : 'explain') : lineEmotion(ln.text));
    return {
      id: `${kind || 'line'}-${i}`, text: ln.text, audio: ln.audio || null, speaker: ln.who, durationMs: ln.duration || null, marks: ln.marks || null,
      expression: emo, animation: ln.who === 'mascot' ? pickGesture(ln, kind, emo) : null,
      gesture: ln.who === 'mascot' && !/^(intro|tour)/.test(ln.act || '') && (kind === 'brief' || kind === 'tour') && i === 0 ? 'wave' : null,
      route: ln.route, action: ln.action, target: ln.target
    };
  }
  // lines: [{who, text, target?, route?, action?, act?, audio?, duration?}]
  function play(lines, opts = {}) {
    return new Promise(resolve => {
      if (scene) scene.end(true);
      hush();
      const L = ensureLayer(); L.classList.add('on'); L.dataset.kind = opts.kind || '';
      const por = L.querySelector('.sl-por'), nm = L.querySelector('.sl-name b'), tt = L.querySelector('.sl-name small'), tx = L.querySelector('.sl-text'),
        nx = L.querySelector('.sl-next'), pv = L.querySelector('.sl-prev'), sk = L.querySelector('.sl-skip'), pz = L.querySelector('.sl-pause'), rp = L.querySelector('.sl-replay'),
        stepEl = L.querySelector('.sl-step'), box = L.querySelector('.sl-box');
      const steps = lines.map((ln, k) => toStep(ln, k, opts.kind));
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      // controller state: everything below belongs to exactly one active step, identified by `gen`
      let i = -1, gen = 0, state = 'idle', cur = null, target = null, lastWho = null;
      let shown = 0, spokenTo = 0, raf = 0, clockT = 0, clockAcc = 0, mode = 'clock', utter = null, audio = null;
      const timers = new Set();
      const later = (fn, ms, tok) => { const t = setTimeout(() => { timers.delete(t); if (tok === gen) fn(); }, ms); timers.add(t); };
      const orbi = () => por.querySelector('.orbi-stage');
      const onResize = () => place(target);
      function setState(s) {
        state = s; L.dataset.state = s;
        pz.disabled = !(s === 'speaking' || s === 'paused'); pz.textContent = s === 'paused' ? '▶ Resume' : '❚❚ Pause';
        pz.setAttribute('aria-pressed', s === 'paused');
        tx.setAttribute('aria-busy', s === 'speaking' || s === 'preparing');
      }
      const render = n => { shown = Math.min(cur.text.length, Math.max(shown, n)); tx.textContent = reduced ? cur.text : cur.text.slice(0, shown); };
      // ---- Orbi follows the step: attention pose while preparing, the line's gesture while speaking, idle when done ----
      function mascotPrepare(step) {
        const st = orbi(); if (!st) return;
        st._lineClip = null; st._rate = 0; st._list = ['idle']; st._hold = 0;
        if (/^tour/.test(step.animation || '')) { showClip(st, step.animation); const v = st.querySelector('video.on'); if (v) { v.preload = 'auto'; v.pause(); try { v.currentTime = 0; } catch {} } }
        else if (st.dataset.act !== 'idle') showClip(st, 'idle');
        const e = EMOTE[step.expression]; if (e) { por.style.setProperty('--pc', e[1]); const op = por.querySelector('.orbi-por'); if (op) op.dataset.emo = step.expression; }
      }
      function mascotSpeak(step, tok) {
        const st = orbi(); mouth(true); if (!st || !step.animation) return;
        st.dataset.mood = step.expression; st._list = [step.animation];
        if (step.gesture) {
          showClip(st, step.gesture);
          // the wave lasts introWaveMs from when it is actually on screen, then the line's gesture loops to the end
          const w = st.querySelector(`video[data-act="${step.gesture}"]`);
          const go = () => later(() => { st._lineClip = step.animation; showClip(st, step.animation); }, BRIEF.introWaveMs, tok);
          if (w && w.paused && w.readyState < 3) { let once = false; const f = () => { if (!once) { once = true; if (tok === gen) go(); } }; w.addEventListener('playing', f, { once: true }); later(f, 800, tok); } else go();
        } else { st._lineClip = step.animation; showClip(st, step.animation); }
      }
      function mascotRest() { mouth(false); const st = orbi(); if (!st) return; if (/^tour/.test(st.dataset.act || '')) { st._lineClip = null; st._list = [st.dataset.act]; const v = st.querySelector('video.on'); if (v) { v.loop = false; v.pause(); } return; } st._lineClip = null; st._list = ['idle']; st._hold = 0; showClip(st, 'idle'); }
      function mascotHold(paused) { mouth(!paused); const st = orbi(); if (!st) return; const v = st.querySelector('video.on'); if (v) paused ? v.pause() : v.play().catch(() => {}); }
      // ---- timing sources: audio file > speech synthesis > text clock (one drives the step at a time) ----
      function tick(now) {
        if (state !== 'speaking') { raf = 0; return; }
        const el = clockAcc + (now - clockT) / 1000;
        if (mode === 'clock') {
          const total = cur.durationMs ? cur.durationMs / 1000 : cur.text.length / BRIEF.readCps;
          render(Math.ceil(cur.text.length * Math.min(1, el / total)));
          if (el >= total) { raf = 0; const tok = gen; later(() => finish(tok), BRIEF.holdMs, tok); return; }
        } else if (mode === 'speech') {
          // between word boundaries, reveal at speaking pace, but never past the end before the voice finishes
          render(Math.min(cur.text.length - 1, Math.max(spokenTo, Math.floor(el * BRIEF.speechCps))));
        } else if (mode === 'audio' && audio && cur.marks) {
          // recorded voice: each word appears when Orbi says it (word timings taken from the clip)
          const t = audio.currentTime, mk = cur.marks; let c = 0;
          for (let k = 0; k < mk.length; k++) { if (t >= mk[k][0]) c = mk[k][1]; else { const a = mk[k - 1] || [0, 0]; c = Math.floor(a[1] + (mk[k][1] - a[1]) * Math.max(0, t - a[0]) / Math.max(.01, mk[k][0] - a[0])); break; } }
          render(c);
          // keep the lip-sync video locked to the voice
          const v = orbi()?.querySelector('video.on'); if (v && /^tour/.test(v.dataset.act) && !audio.paused && Math.abs(v.currentTime - t) > .2) { try { v.currentTime = t; } catch {} }
        }
        raf = requestAnimationFrame(tick);
      }
      function startClock(m) { mode = m; clockT = performance.now(); if (!raf) raf = requestAnimationFrame(tick); }
      function beginSpeaking(tok) { if (tok !== gen || state !== 'preparing') return; setState('speaking'); mascotSpeak(cur, tok); clockAcc = 0; startClock(mode); }
      function speak(step, tok) {
        if (step.audio) {
          const a = audio = new Audio(step.audio); a.preload = 'auto'; a.muted = !prefs.voice; // muted clips still play silently so the text and the mascot stay in time
          a.onplaying = () => { if (tok !== gen) return; mode = 'audio'; if (state === 'preparing') beginSpeaking(tok); };
          a.ontimeupdate = () => { if (tok === gen && a.duration && !step.marks) render(Math.floor(step.text.length * a.currentTime / a.duration)); };
          a.onended = () => finish(tok);
          a.onerror = () => { if (tok !== gen) return; audio = null; fallback(tok, 'audio failed'); };
          mode = 'audio'; a.play().catch(() => a.onerror && a.onerror());
          return;
        }
        if (!prefs.voice || !synth || typeof SpeechSynthesisUtterance === 'undefined') { mode = 'clock'; beginSpeaking(tok); return; }
        const u = utter = new SpeechSynthesisUtterance(step.text.replace(/\*[^*]+\*/g, ''));
        const v = pickVoice(); if (v) u.voice = v;
        Object.assign(u, { pitch: 1, rate: 1 }, CAST[step.speaker].voice || {});
        mode = 'speech'; spokenTo = 0;
        u.onstart = () => beginSpeaking(tok);
        u.onboundary = e => { if (tok !== gen || e.name === 'sentence') return; const m = /\S+/.exec(step.text.slice(e.charIndex)); spokenTo = e.charIndex + (m ? m[0].length : 0); render(spokenTo); };
        u.onend = () => finish(tok);
        u.onerror = e => { if (tok !== gen || /interrupted|canceled/.test(e.error)) return; fallback(tok, e.error); };
        try { synth.cancel(); synth.speak(u); } catch { fallback(tok, 'speak threw'); return; }
        // speech that never starts (no voices, autoplay blocked) falls back to the text clock
        later(() => { if (state === 'preparing') fallback(tok, 'speech did not start'); }, BRIEF.startTimeoutMs, tok);
        // and speech that never reports its end (a known browser bug) is closed after a generous limit
        later(() => { if (state === 'speaking' && mode === 'speech') finish(tok); }, (step.text.length / BRIEF.speechCps) * 2500 + 4000, tok);
      }
      // a failed voice or audio file keeps the line going on the text clock from where it got to
      function fallback(tok, why) {
        if (tok !== gen) return;
        const was = state; stopVoice(); L.dataset.error = why; setState('error');
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        mode = 'clock'; clockAcc = shown / BRIEF.readCps; setState(was === 'paused' ? 'paused' : 'speaking');
        // Orbi is already mid-gesture if the line had started; otherwise the gesture starts now
        if (was === 'preparing') mascotSpeak(cur, tok);
        if (state === 'speaking') startClock('clock');
      }
      function stopVoice() {
        if (utter) { utter.onstart = utter.onend = utter.onerror = utter.onboundary = null; utter = null; }
        try { synth && synth.cancel(); } catch {}
        if (audio) { audio.onplaying = audio.onended = audio.onerror = audio.ontimeupdate = null; audio.pause(); audio = null; }
      }
      // cancel everything that belongs to the current step: timers, frame loop, voice, audio
      function cancel() { gen++; timers.forEach(clearTimeout); timers.clear(); if (raf) cancelAnimationFrame(raf); raf = 0; stopVoice(); }
      function finish(tok) {
        if (tok !== gen || state === 'completed') return;
        cancel(); render(cur.text.length); tx.textContent = cur.text; mascotRest(); setState('completed');
      }
      // ---- step lifecycle ----
      async function run(k) {
        cancel(); const tok = gen; i = k;
        if (i >= steps.length) { self.end(false); return; }
        if (i < 0) i = 0;
        cur = steps[i]; const c = CAST[cur.speaker];
        setState('transitioning'); delete L.dataset.error;
        mouth(false); const os = orbi(); if (os) mascotRest();
        if (cur.route && location.hash !== cur.route) { location.hash = cur.route; await sleep(260); if (tok !== gen) return; }
        if (cur.action) { cur.action(); await sleep(120); if (tok !== gen) return; }
        target = typeof cur.target === 'function' ? cur.target() : cur.target ? document.querySelector(cur.target) : null;
        if (target) { target.scrollIntoView({ block: 'center', behavior: 'instant' }); await sleep(120); if (tok !== gen) return; }
        place(target);
        if (target) later(() => place(target), 380, tok);
        if (cur.speaker !== lastWho) { por.classList.remove('has-img'); por.innerHTML = cur.speaker === 'mascot' ? orbiVideo() : portrait(cur.speaker); if (cur.speaker === 'mascot') bindOrbiClick(por); por.classList.remove('sl-pop', 'exit'); void por.offsetWidth; por.classList.add('sl-pop'); }
        lastWho = cur.speaker;
        box.dataset.side = c.side; box.style.setProperty('--pc', c.col); box.dataset.step = cur.id;
        nm.textContent = c.name; tt.textContent = c.title;
        stepEl.textContent = `${i + 1} / ${steps.length}`;
        pv.disabled = i === 0;
        nx.textContent = i === steps.length - 1 ? (opts.finalLabel || 'Got it ▸') : 'Next ▸';
        shown = 0; spokenTo = 0; clockAcc = 0; tx.textContent = '';
        setState('preparing'); mascotPrepare(cur);
        speak(cur, tok);
      }
      // Next while a line is still playing completes that line first; the next press moves on
      // Next always moves to the next line (it used to only finish the current line on the first press, which looked like a dead button)
      function next() { if (state === 'transitioning') return; run(i + 1); }
      function prev() { if (i > 0) run(i - 1); }
      function replay() { run(i); }
      function pause() {
        if (state === 'speaking') {
          setState('paused'); if (raf) { cancelAnimationFrame(raf); raf = 0; } clockAcc += (performance.now() - clockT) / 1000;
          try { if (mode === 'speech') synth.pause(); } catch {} if (audio) audio.pause(); mascotHold(true);
        } else if (state === 'paused') {
          setState('speaking'); try { if (mode === 'speech') synth.resume(); } catch {} if (audio) audio.play().catch(() => {}); mascotHold(false); startClock(mode);
        }
      }
      function onKey(e) {
        if (!L.classList.contains('on')) return;
        if (e.key === 'Escape') { e.stopImmediatePropagation(); self.end(false); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); prev(); }
        else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); e.stopImmediatePropagation(); pause(); }
        else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); e.stopImmediatePropagation(); replay(); }
        else if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') { if (e.target.closest && e.target.closest('.sl-actions') && e.key !== 'ArrowRight') return; e.preventDefault(); e.stopImmediatePropagation(); next(); }
      }
      const self = scene = {
        get state() { return state; }, get step() { return cur && cur.id; },
        end(silent) {
          cancel(); mouth(false); setState('idle'); L.classList.remove('on'); place(null); removeEventListener('resize', onResize); removeEventListener('keydown', onKey, true);
          nx.onclick = sk.onclick = pv.onclick = pz.onclick = rp.onclick = mu.onclick = null; if (scene === self) scene = null; resolve(!silent);
        }
      };
      const mu = L.querySelector('.sl-mute');
      const muteLbl = () => { mu.textContent = prefs.voice ? '🔊' : '🔇'; mu.title = prefs.voice ? 'Mute voice' : 'Turn voice on'; mu.setAttribute('aria-pressed', !prefs.voice); };
      muteLbl();
      // muting keeps the line going on the text clock; turning the voice on replays the line with voice
      mu.onclick = () => { prefs.voice = !prefs.voice; persist(); muteLbl(); if (audio) { audio.muted = !prefs.voice; return; } if (prefs.voice) { if (state !== 'completed') replay(); } else if (mode === 'speech' && (state === 'speaking' || state === 'paused' || state === 'preparing')) fallback(gen, 'muted'); };
      nx.onclick = next; pv.onclick = prev; pz.onclick = pause; rp.onclick = replay; sk.onclick = () => self.end(false);
      sk.textContent = opts.skipLabel || 'Skip';
      addEventListener('resize', onResize); addEventListener('keydown', onKey, true);
      run(0); setTimeout(() => nx.focus(), 50);
    });
  }
  window.YojoStory = { play, CAST, STORY, BRIEF, get state() { return scene ? { state: scene.state, step: scene.step, text: document.querySelector('#storyLayer .sl-text')?.textContent, act: document.querySelector('#storyLayer .orbi-stage')?.dataset.act } : null; } };

  /* ---------------- intro: Orbi's guided tour ---------------- */
  const sec = title => () => [...document.querySelectorAll('#view .card h3')].find(h => h.textContent.toLowerCase().includes(title))?.closest('.card');
  const n = () => first();
  const fac = () => FACTIONS[path()];
  const openSettings = () => window.YojoSettings && window.YojoSettings.open();
  const closeSettings = () => window.YojoSettings && window.YojoSettings.close();
  function tourLines() {
    const D = '#/academy/dashboard';
    return [
      { who: 'mascot', act: 'tour0', audio: IMG_DIR + 'orbi-tour0' + VOICE_EXT, marks: [[0.19,0],[0.36,2],[0.91,8],[2.59,22],[2.71,27],[2.75,29],[3.42,36],[4.47,90],[4.62,93],[5.05,98],[5.42,105],[5.72,113],[5.82,117],[6.14,123],[6.7,133],[6.99,138],[7.09,141],[7.27,146],[7.42,150],[7.74,157],[8.15,167],[8.37,173],[8.93,186],[9.01,190],[9.43,202],[9.91,209],[9.91,210]], route: D, action: closeSettings, text: "Hi Agent! I'm Orbi. We have a crisis: an unknown force is hijacking the world's data, city by city. Every mission you clear frees one. Let me show you around in twelve quick steps. Watch the highlighted blocks!" },
      { who: 'mascot', act: 'tour1', audio: IMG_DIR + 'orbi-tour1' + VOICE_EXT, marks: [[0.1,0],[0.29,4],[0.41,7],[0.51,12],[0.88,20],[1.18,24],[1.56,31],[1.88,39],[1.97,42],[2.08,47],[2.49,52],[2.69,57],[3.07,66],[3.39,74],[3.52,79],[4.07,88],[4.6,96],[4.82,105],[5.2,111],[5.93,125],[6.2,131],[6.57,138],[7.3,144],[8.26,155],[8.66,163],[8.76,167],[9.23,175],[9.42,179],[9.51,182],[9.57,186],[9.91,192],[9.91,193]], route: D, target: 'header.app', text: "This is your command bar. CYBER COMMAND is your base, the TRAINING GRID is your LMS with courses, and the CYBER ARSENAL holds every course. Your XP, streak, alerts and profile sit on the right." },
      { who: 'mascot', act: 'tour2', audio: IMG_DIR + 'orbi-tour2' + VOICE_EXT, marks: [[0.05,0],[0.36,5],[0.71,13],[0.89,17],[1.25,22],[1.68,28],[2.76,41],[3.15,51],[3.72,60],[4.2,68],[4.79,77],[5.36,84],[5.95,92],[6.15,96],[6.51,103],[7.54,109],[8.74,133],[9.16,144],[9.27,149],[9.7,155],[9.7,156]], route: D, target: '#subnav', text: "Cyber Command has five rooms: SOC Console, Incident Response, Hunter Rankings, Daily Patches and Threat Intel, where agents write and share what they learn." },
      { who: 'mascot', act: 'tour3', audio: IMG_DIR + 'orbi-tour3' + VOICE_EXT, marks: [[0.03,0],[0.88,15],[1.25,19],[1.5,25],[1.6,30],[2.41,45],[2.78,50],[3.7,59],[4.09,69],[4.4,74],[4.58,79],[4.95,87],[6.5,111],[6.59,114],[6.74,118],[7.2,127],[7.49,132],[7.74,139],[8.02,145],[8.26,151],[8.35,155],[8.68,164],[8.91,169],[9.14,179],[9.46,184],[9.83,192],[9.83,193]], route: D, target: '.hero', text: "Your agent card. It shows your callsign, your unit and your clearance rank. The glowing bar is your XP. Fill it to get promoted. The button below takes you straight back into your last mission." },
      { who: 'mascot', act: 'tour4', audio: IMG_DIR + 'orbi-tour4' + VOICE_EXT, marks: [[0.08,0],[0.22,4],[0.54,12],[1.05,18],[1.51,25],[2.57,36],[3.56,54],[4.2,68],[5.4,81],[5.68,87],[5.85,92],[6.31,101],[6.7,106],[7.09,111],[7.37,115],[7.67,120],[8.14,129],[8.18,131],[8.47,135],[8.76,141],[8.87,146],[9.19,153],[9.67,159],[9.67,160]], route: D, target: '.tiles', text: "Your mission stats: total XP, streak, missions cleared and campaigns won. XP only comes from verified work, and one real activity a day keeps your streak alive." },
      { who: 'mascot', act: 'tour5', audio: IMG_DIR + 'orbi-tour5' + VOICE_EXT, marks: [[0.41,0],[0.49,3],[0.86,9],[1.17,16],[1.49,20],[2.27,29],[2.65,36],[2.74,40],[3.01,45],[3.15,48],[3.31,52],[3.69,60],[4.21,66],[4.78,72],[5.11,80],[5.25,84],[5.69,90],[6.72,102],[7.17,107],[8.05,113],[8.63,127],[9.09,133],[9.09,134]], route: D, target: '#villainBoard', text: "The World Breach Map. Fifteen cities are held by the unknown force. Each mission you clear secures one city. Turn the whole map green!" },
      { who: 'mascot', act: 'tour6', audio: IMG_DIR + 'orbi-tour6' + VOICE_EXT, marks: [[0.09,0],[1.09,13],[1.65,20],[1.99,26],[2.54,32],[2.96,38],[3.27,42],[3.43,46],[3.87,52],[5.27,63],[5.65,67],[5.96,73],[6.26,79],[6.39,84],[6.97,91],[9.94,92]], route: D, target: sec('daily patches'), text: "Daily Patches: three small tasks every day for bonus XP. Finish one, then claim your reward." },
      { who: 'mascot', act: 'tour7', audio: IMG_DIR + 'orbi-tour7' + VOICE_EXT, marks: [[0.03,0],[0.39,8],[1.0,17],[1.63,24],[1.96,29],[2.08,32],[2.11,34],[2.46,40],[2.61,43],[2.95,47],[3.04,50],[3.07,52],[3.5,57],[4.05,67],[4.5,73],[4.88,78],[5.12,83],[5.26,87],[5.61,110],[5.73,114],[5.88,119],[6.21,124],[6.31,128],[6.61,135],[7.3,147],[7.69,153],[8.08,161],[8.3,166],[9.16,183],[9.42,190],[9.53,194],[9.95,201]], route: '#/academy/missions', target: '#mGrid', text: "INCIDENT RESPONSE. Every card is a hands-on lab in a safe, isolated range, and each one saves a city. Missions for your unit are marked Recommended. I'll explain each city's situation before you go in." },
      { who: 'mascot', act: 'tour8', audio: IMG_DIR + 'orbi-tour8' + VOICE_EXT, marks: [[0.03,0],[0.28,6],[0.92,15],[1.77,23],[2.18,31],[2.27,34],[2.53,40],[2.97,47],[3.51,54],[3.94,59],[4.25,63],[4.68,69],[4.95,74],[5.12,77],[5.68,97],[6.42,102],[6.54,106],[6.85,111],[6.94,116],[7.24,121],[7.52,125],[7.91,130],[8.18,131]], route: '#/academy/leaderboard', target: () => document.querySelector('.podium')?.closest('.card') || document.querySelector('.podium'), text: "Hunter Rankings. Weekly leagues of about thirty agents. The top seven move up a league every week. You can hide your name any time." },
      { who: 'mascot', act: 'tour9', audio: IMG_DIR + 'orbi-tour9' + VOICE_EXT, marks: [[0.22,0],[0.43,4],[0.78,11],[0.89,14],[0.93,16],[1.49,25],[1.57,28],[1.83,33],[2.34,42],[2.52,47],[2.65,51],[3.03,59],[3.51,65],[3.9,71],[4.22,78],[5.42,100],[6.07,113],[6.65,123],[6.75,127],[7.45,140],[7.88,145],[8.25,154],[8.47,159],[8.6,162],[8.85,167],[9.24,179],[9.86,189]], route: '#/courses', target: '.courses', text: "Each course is a campaign to free a region from the unknown force. Free agents get the labs; premium unlocks full campaigns and certificates. The Training Grid is open on the free plan too." },
      { who: 'mascot', act: 'tour10', audio: IMG_DIR + 'orbi-tour10' + VOICE_EXT, marks: [[0.18,0],[0.54,3],[0.91,9],[1.42,17],[1.82,22],[2.72,30],[2.83,33],[2.95,37],[3.05,42],[3.5,47],[4.22,56],[4.84,64],[5.39,73],[5.67,77],[7.45,88],[7.59,91],[7.95,99],[8.39,108],[8.57,112],[8.8,116],[8.8,117]], route: D, target: '#avBtn', action: () => { closeSettings(); }, text: "Now, your profile menu. Inside it you will find Settings, Replay briefing and Log out. I am opening Settings for you." },
      { who: 'mascot', act: 'tour11', audio: IMG_DIR + 'orbi-tour11' + VOICE_EXT, marks: [[0.04,0],[0.23,4],[0.3,7],[0.41,11],[0.74,19],[1.16,33],[1.47,38],[1.99,46],[2.18,50],[3.01,68],[3.53,78],[3.58,80],[3.71,85],[4.27,99],[4.53,105],[5.4,119],[5.55,123],[5.77,128],[5.9,131],[6.22,137],[6.41,140],[6.54,143],[6.73,147],[7.47,157],[7.6,161],[7.69,164],[7.98,170],[8.09,174],[8.4,181],[8.83,188],[9.25,194],[9.47,199],[9.87,206],[9.87,207]], route: D, action: openSettings, target: () => document.querySelector('#ySettings .ys-intro'), text: "This is the setting I want you to know. Switch off \"Intro and guided tour\" and I will not greet you again at login. You can turn my voice on or off here. I'm off to track the attack signal. Good luck, Agent!" }
    ];
  }
  async function runIntro(force) {
    // first login always; after that only when entering through the portal with the intro setting on
    if (!force && st.introDone && !(window.__yojoPortalEntry && prefs.intro)) return;
    await play(tourLines(), { kind: 'tour', finalLabel: 'Start my first operation ▸', skipLabel: 'Skip tour' });
    closeSettings();
    st.introDone = true; persist();
    location.hash = '#/academy/missions';
  }
  window.replayBriefing = () => runIntro(true);

  /* ---------------- Orbi dock: talk to Orbi from any page ---------------- */
  const PAGE_HELP = {
    'academy/dashboard': [['#villainBoard', 'point', 'This is your SOC Console. The World Breach Map shows which cities the unknown force still control. Green means secured.'], ['.tiles', 'explain', 'Your stats sit up here: XP, streak and missions cleared. Clear a mission to turn another city green.']],
    'academy/missions': [['#mGrid', 'explain', 'Incident Response. Each card is a hands-on lab that frees one city. Open a card and I\'ll brief you on what the attackers did there.']],
    'academy/leaderboard': [[null, 'thumbsup', 'Hunter Rankings. Each week you race the students in your own division. The top seven move up a division when the week closes; open How the league works for the full rules.']],
    'academy/lore-vault': [[null, 'analyze', 'Intel. Agents write blogs on what they learn. Open any blog to read it full page, and see the top blogs on the right.']],
    'lms': [['.lms-side', 'point', 'The Training Grid is your LMS. Pick any section from this sidebar: attendance, your trainer, this week, your courses, assessments, pending courses, placement and the calendar. Sections with a lock open on the Premium plan.']],
    'courses': [['#csGrid', 'point', 'The Cyber Arsenal. Browse every course, open View Course for the syllabus, and open FAQs on any card for answers about that course.']]
  };
  const TIPS = ['Never reuse passwords. One leak, and the unknown force try it everywhere.', 'Check the sender\'s real address before you click any link in an email.', 'Turn on MFA. A stolen password alone won\'t get the attackers in.', 'Patch early. Most breaches use bugs that already have a fix.', 'Logs are your best friend. When something feels off, read them first.'];
  function helpLines() {
    const key = location.hash.replace(/^#\/?/, '') || 'academy/dashboard';
    const rows = PAGE_HELP[key] || PAGE_HELP[Object.keys(PAGE_HELP).find(k => key.startsWith(k))] || [[null, 'talk', 'I\'m here whenever you need me. Head to Incident Response to save your next city!']];
    return rows.map(([t, act, text]) => ({ who: 'mascot', target: t, act, text }));
  }
  function nextMission() {
    const id = Object.keys(STORY).find(k => !me.stats.cleared.includes(k));
    if (!id) return play([{ who: 'mascot', act: 'cheer', win: true, text: `Every city is secured, Agent ${n()}! The unknown force is on the run. I'm proud of you.` }], { kind: 'help' });
    const c = CAST[STORY[id][1]];
    play([{ who: 'mascot', act: 'analyze', text: `Next signal: ${c.name}, ${c.title}. ${STORY[id][2][0][1]}` }, { who: 'mascot', act: 'thumbsup', text: 'Want me to take you there? I\'ll brief you on the way in.' }],
      { kind: 'help', finalLabel: `Go to ${c.name} ▸`, skipLabel: 'Not now' }).then(go => { if (go && typeof window.openMission === 'function') { location.hash = '#/academy/missions'; setTimeout(() => window.openMission(id), 300); } });
  }
  // Orbi's chat answers: a small built-in knowledge base for the prototype (the full build swaps this for the AI support bot)
  const KB = [
    [/^(hi|hello|hey|yo|namaste)\b/i, () => `Hi Agent ${n()}! Ask me about labs, the Training Grid, your plan, or any cyber question.`],
    [/attendance|absent|present|late|calendar/i, () => 'Your attendance lives in the Training Grid under Deployment Record. You need at least 75 percent. The Ops Calendar shows present, absent and no-class days, with recordings for any class you missed.'],
    [/trainer|mentor|1.?to.?1|one.?to.?one|book/i, () => 'Open My Handler in the Training Grid. You will see your trainer, their certifications and your mentor, plus buttons to message them or book a one-to-one. This is part of the Premium plan.'],
    [/assessment|quiz|exam|assignment|deadline|due/i, () => 'Incoming Challenges in the Training Grid lists your quizzes, assignments and exams. Anything due within three days turns red, so start with those.'],
    [/placement|resume|interview|internship|portfolio|job/i, () => 'Placement Mission in the Training Grid tracks four parts: your resume, mock interviews with communication skill, internship milestones and portfolio projects. Your trainer reviews each one.'],
    [/free|premium|paid|plan|upgrade|price|fee|cost/i, () => 'The Free plan gives you a few labs with XP, streaks, the leaderboard and a view of the LMS. Premium unlocks all labs, every course, a trainer and mentor, graded assessments and Yojo certificates. Open My Plan in the Training Grid to compare.'],
    [/lms|training grid|course|module|certificate/i, () => 'The Training Grid is your LMS. Pick a section from the sidebar: attendance, trainer, this week, your courses, assessments, pending courses, placement and the calendar.'],
    [/lab|mission|city|cities|incident/i, () => 'Labs are in Incident Response. Each one is a safe, isolated range, and clearing it secures a city on the World Breach Map.'],
    [/xp|streak|leaderboard|rank|league|quest/i, () => 'You earn XP from verified labs, quizzes, lessons and daily patches. One real activity a day keeps your streak alive. In the weekly league the top seven of your division move up.'],
    [/blog|threat intel|scroll|read/i, () => 'Intel is where agents share blogs about what they learn. Open any blog to read it, and reading one counts toward your daily patch.'],
    [/phish/i, () => 'Phishing tricks you into clicking or sharing secrets. Check the real sender address, hover before you click, and never enter a password from an email link.'],
    [/password|mfa|2fa|otp/i, () => 'Use a long, unique password for every site and keep them in a password manager. Turn on multi-factor authentication so a stolen password alone is useless.'],
    [/malware|virus|ransom/i, () => 'Malware is software built to harm. Keep systems patched, do not run unknown attachments, and keep offline backups so ransomware cannot hold you hostage.'],
    [/thank/i, () => `Any time, Agent ${n()}! Go save another city.`]
  ];
  // Page-aware help: questions are matched against the current page's topics first, then the general list.
  function answer(q) {
    const c = ctx(), own = (c.kb || []).find(([re]) => re.test(q)), hit = own || KB.find(([re]) => re.test(q));
    return hit ? hit[1]() : `I am not sure about that one yet. On ${c.title} you can ask: ${c.examples}. Or ask about a cyber topic like phishing or passwords.`;
  }

  /* ---- Orbi follows the page: greeting, quick replies and help change with the section the student is on.
     Live mode reads the student's own data from the existing APIs (nothing is invented; missing data = no line). ---- */
  const live = () => !!(window.YojoAcademyLive && window.YojoAcademyLive.state && window.YojoAPI);
  const CTX = [
    { re: /^academy\/(lab|missions)/, key: 'labs', title: 'Incident Response', examples: 'how labs work, hints, what XP a lab gives',
      quick: [['🎯 Which lab next?', 'next'], ['💡 How do hints work?', 'say', 'Each practical lab has three hints. Opening one lowers the XP that lab pays (5, 10, then 15 percent), so try the step first and use a hint when you are stuck.'], ['🧪 How do lab steps work?', 'say', 'Labs are split into steps: read the briefing, start your own isolated lab, find the answer and submit it. Every step you complete is saved.']],
      kb: [[/hint/i, () => 'Hints cost a share of the lab\'s XP: 5, 10 and 15 percent for the first, second and third. Your progress is never lost by opening one.'], [/start|launch|environment|offline/i, () => 'Open a lab, then press Start lab. You get your own isolated copy. If it says the environment is offline, the lab service is down for now; try again later.']],
      facts: () => window.YojoAPI.get('/student/missions').then(r => { const a = r.items.find(m => m.state === 'in_progress') || r.items.find(m => m.state === 'available'); const done = r.items.filter(m => m.state === 'cleared').length; return a ? `You have cleared ${done} of ${r.items.length} labs. ${a.state === 'in_progress' ? 'You are in the middle of' : 'Next up:'} ${a.title}.` : `You have cleared ${done} of ${r.items.length} labs.`; }) },
    { re: /^academy\/leaderboard/, key: 'leaderboard', title: 'Hunter Rankings', examples: 'how divisions work, how to move up',
      quick: [['🏆 How do I move up?', 'say', 'Earn XP during the week. When the week closes on Monday, the top seven in your division move up one division. If you earn nothing that week you simply stay.'], ['🙈 Hide me from the board', 'say', 'Untick "Show me on leaderboard" at the top of this page. You still see your own rank; others see you hidden.']],
      kb: [[/division|bronze|silver|gold|platinum|diamond|demot|promot/i, () => 'There are five divisions: Bronze, Silver, Gold, Platinum and Diamond. Top seven move up each week; the bottom five move down only when more than twelve people in the division earned XP that week.']],
      facts: () => window.YojoAPI.get('/student/leaderboard?tab=week').then(b => { const L = b.league; if (!L) return ''; const z = { promotion: 'you are in the promotion zone', safe: 'you are safe', demotion: 'you are in the demotion zone', not_started: 'you have not earned XP this week yet' }[L.zone]; return `You are in the ${L.divisionName} division and ${z}.`; }) },
    { re: /^academy\/lore-vault/, key: 'intel', title: 'Intel', examples: 'how to write a blog, what counts for the daily patch',
      quick: [['✍️ How do I write a blog?', 'say', 'Open Intel and choose Write. Your trainer reviews the post before it is published for others.'], ['📖 Does reading count?', 'say', 'Yes. Reading a blog counts toward the Read part of your daily patch.']], kb: [] },
    { re: /^academy\/career/, key: 'career', title: 'Career path', examples: 'what the quiz does, how to change my path',
      quick: [['🧭 What is this quiz?', 'say', 'Fifteen short scenarios, five for each track: Defensive, Offensive and GRC. Your answers suggest a starting path. It is optional and there are no wrong answers.'], ['🔁 Can I change my path?', 'say', 'Yes, any time from this page. You can retake the quiz once every 30 days.']],
      kb: [[/track|defensive|offensive|grc/i, () => 'Defensive is about detecting and responding to attacks, Offensive about finding weaknesses in authorised tests, and GRC about policies, risk and audits.']],
      facts: () => window.YojoAPI.get('/student/career-quiz').then(s => s.done && s.result ? `Your last result suggested ${s.result.primary}.` : '') },
    { re: /^lms\/(attendance|calendar)/, key: 'attendance', title: 'Deployment Record', examples: 'the attendance rule, missed classes, leave',
      quick: [['📅 What is the rule?', 'say', 'Your attendance is counted over the last 90 days of marked sessions. Late counts as attended; ask your trainer about excused absences.'], ['🙋 I missed a class', 'say', 'Check the Ops Calendar for a recording, and send a leave request to your trainer if you knew in advance.']],
      kb: [], facts: () => window.YojoAPI.get('/student/attendance').then(a => a.pct === null ? 'No sessions have been marked for you yet.' : `Your attendance is ${a.pct} percent; the required level is ${a.requiredPct} percent.`) },
    { re: /^lms\/assessments/, key: 'assessments', title: 'Incoming Challenges', examples: 'deadlines, scores, retakes',
      quick: [['⏰ What is due soon?', 'facts'], ['📊 When do I see scores?', 'say', 'Your trainer releases results after grading. Until then the assessment shows as Submitted.']],
      kb: [[/score|mark|result|grade/i, () => 'Scores appear when your trainer releases them. If a grade is changed later, the reason is kept in the history.']],
      facts: () => window.YojoAPI.get('/student/assessments').then(r => { const due = r.items.filter(a => a.status === 'pending' || a.status === 'in_progress' || a.status === 'returned'); const soon = due.filter(a => a.dueSoon); return due.length ? `You have ${due.length} assessment${due.length === 1 ? '' : 's'} to do${soon.length ? ', ' + soon.length + ' due soon. Start with ' + soon[0].title : '. First: ' + due[0].title}.` : 'Nothing is waiting for you right now.'; }) },
    { re: /^lms\/placement/, key: 'placement', title: 'Placement Mission', examples: 'how readiness is counted, mock interviews',
      quick: [['📈 How is readiness counted?', 'say', 'Four parts at 25 percent each: resume, mock interview with communication skill, internship milestones and portfolio projects. Your trainer verifies each one.'], ['🎤 Book a mock interview', 'say', 'Open My Handler in the Training Grid and book one of your trainer\'s mock-interview slots.']],
      kb: [], facts: () => window.YojoAPI.get('/student/placement').then(o => `Your readiness is ${o.overall} percent. Resume ${o.parts.resume.pct}, mock interview ${o.parts.mock.pct}, internship ${o.parts.internship.pct}, portfolio ${o.parts.portfolio.pct}.`) },
    { re: /^lms\/(learning|week)/, key: 'learning', title: 'My learning', examples: 'what to study this week, lesson progress',
      quick: [['📚 What should I study?', 'say', 'Open This Week for your scheduled sessions, then continue the course with the lowest progress.'], ['✅ How is a lesson completed?', 'say', 'Some lessons complete when you mark them done, others when you pass their quiz or clear their lab.']], kb: [] },
    { re: /^lms/, key: 'lms', title: 'the Training Grid', examples: 'attendance, your trainer, assessments, placement',
      quick: [['🗺️ What is in here?', 'help'], ['👩‍🏫 Contact my trainer', 'say', 'Open My Handler in the sidebar to message your trainer or book a one-to-one slot.']], kb: [] },
    { re: /^courses/, key: 'courses', title: 'the Cyber Arsenal', examples: 'how to enrol, certificates, course FAQs',
      quick: [['🎓 How do certificates work?', 'say', 'A certificate is issued when you complete all the required lessons of a course.'], ['❓ Course questions', 'say', 'Open FAQs on any course card for answers about that course.']], kb: [] },
    { re: /^academy\/?(dashboard)?$|^$/, key: 'dashboard', title: 'your SOC Console', examples: 'XP, streaks, daily patches, the breach map',
      quick: [['🎯 What should I do next?', 'next'], ['🔥 How do streaks work?', 'say', 'Do one real activity a day, such as a lesson, a lab step or reading a blog. Miss a day and you have a short grace window to keep the streak.']],
      kb: [[/patch|daily/i, () => 'Daily patches are three small goals: learn, lab and read. Each one pays a little XP once a day.']],
      facts: () => window.YojoAPI.get('/student/dashboard').then(d => `You have ${d.xp.total} XP (${d.xp.rank && d.xp.rank.name ? d.xp.rank.name : 'rank pending'}) and a ${d.tiles.streakDays}-day streak. ${d.tiles.labsCleared} labs cleared.`) },
  ];
  const GENERAL = { key: 'general', title: 'this page', examples: 'labs, attendance, assessments, placement', quick: [['🎯 What should I do next?', 'next']], kb: [] };
  function ctx() { const h = location.hash.replace(/^#\/?/, ''); return CTX.find(c => c.re.test(h)) || GENERAL; }
  const factCache = {};
  function facts(c) {
    if (!c.facts || !live()) return Promise.resolve('');
    const hit = factCache[c.key]; if (hit && Date.now() - hit.at < 60000) return Promise.resolve(hit.text);
    return c.facts().then(t => { factCache[c.key] = { at: Date.now(), text: t || '' }; return t || ''; }, () => '');
  }
  function buildDock() {
    if (document.getElementById('orbiDock')) return;
    const d = document.createElement('div'); d.id = 'orbiDock';
    d.innerHTML = `<div class="od-chat" hidden role="dialog" aria-label="Chat with Orbi"><div class="od-head"><b>Orbi · cyber support</b><button type="button" class="od-x" aria-label="Close chat">✕</button></div>
        <div class="od-log" aria-live="polite"></div>
        <div class="od-quick"></div>
        <form class="od-form"><input type="text" placeholder="Type your question…" aria-label="Your question" autocomplete="off"><button type="submit" class="btn btn-primary btn-sm">Send</button></form></div>
      <button type="button" class="od-btn" aria-label="Chat with Orbi" aria-expanded="false">${orbiStage()}<span class="od-ping">Ask Orbi</span></button>`;
    document.body.appendChild(d);
    const btn = d.querySelector('.od-btn'), chat = d.querySelector('.od-chat'), log = d.querySelector('.od-log'), form = d.querySelector('.od-form'), inp = form.querySelector('input');
    const add = (who, text) => { const m = document.createElement('div'); m.className = 'od-msg ' + who; m.textContent = text; log.appendChild(m); log.scrollTop = log.scrollHeight; return m; };
    // Orbi replies in text and voice, holding the laptop gesture for as long as the answer lasts
    const reply = text => {
      const m = add('orbi', ''); let k = 0; const ms = Math.max(2500, text.length * (prefs.voice ? 68 : 45));
      setAct(d, 'laptop', ms); say(text, 'mascot');
      const t = setInterval(() => { k += 2; m.textContent = text.slice(0, k); log.scrollTop = log.scrollHeight; if (k >= text.length) clearInterval(t); }, 18);
    };
    const quick = d.querySelector('.od-quick');
    const renderQuick = () => {
      const c = ctx();
      quick.innerHTML = c.quick.map((x, i) => `<button type="button" class="btn btn-sm" data-od="q${i}">${x[0]}</button>`).join('') +
        '<button type="button" class="btn btn-sm" data-od="help">🔍 Explain this page</button><button type="button" class="btn btn-sm" data-od="tip">🛡️ Cyber tip</button><button type="button" class="btn btn-sm" data-od="tour">🧭 Replay the tour</button>';
      return c;
    };
    // greeting for the page the student is on, with one line from their own data when signed in
    const greet = () => { const c = renderQuick(); facts(c).then(f => reply(`Hi ${n()}! You are on ${c.title}. ${f ? f + ' ' : ''}Ask me anything about it, or tap a quick option.`)); };
    let lastKey = null;
    window.addEventListener('hashchange', () => { const c = ctx(); if (c.key === lastKey) return; lastKey = c.key; renderQuick(); if (!chat.hidden) greet(); });
    btn.addEventListener('mouseenter', () => { if (chat.hidden && d.querySelector('.orbi-stage').dataset.mood !== 'greet') setAct(d, 'hello', 1500); });
    const close = () => { chat.hidden = true; btn.setAttribute('aria-expanded', 'false'); hush(); };
    btn.addEventListener('click', () => {
      if (!chat.hidden) return close();
      chat.hidden = false; btn.setAttribute('aria-expanded', 'true');
      const c = ctx(); if (!log.children.length || c.key !== lastKey) { lastKey = c.key; greet(); } else setAct(d, 'wave', 1500);
      setTimeout(() => inp.focus(), 50);
    });
    d.querySelector('.od-x').addEventListener('click', close);
    // Live mode (academy-live.js signed in): free questions go to the server's assistant endpoint. No assistant service is
    // connected yet, so Orbi says that plainly and only offers the built-in help text, labelled as such.
    const ask = q => window.YojoAcademyLive && window.YojoAcademyLive.state && window.YojoAPI
      ? window.YojoAPI.post('/student/assistant/messages', { message: q }).then(r => (r && r.reply) || answer(q), () => 'I cannot chat freely yet: Orbi is not connected to an AI assistant. From the built-in help for ' + ctx().title + ': ' + answer(q))
      : Promise.resolve(answer(q));
    form.addEventListener('submit', e => { e.preventDefault(); const q = inp.value.trim(); if (!q) return; inp.value = ''; add('me', q); ask(q).then(t => setTimeout(() => reply(t), 350)); });
    quick.addEventListener('click', e => {
      const k = e.target.closest('[data-od]')?.dataset.od; if (!k) return;
      const qi = /^q(\d+)$/.exec(k);
      if (qi) {
        const x = ctx().quick[+qi[1]]; if (!x) return;
        if (x[1] === 'say') { add('me', x[0].replace(/^\S+\s/, '')); setTimeout(() => reply(x[2]), 300); return; }
        if (x[1] === 'facts') { add('me', x[0].replace(/^\S+\s/, '')); facts(ctx()).then(f => reply(f || (live() ? 'I could not read that right now. Try again in a moment.' : 'Sign in to see your own data here.'))); return; }
        if (x[1] === 'go') { close(); location.hash = x[2]; return; }
        if (x[1] === 'help') { close(); play(helpLines(), { kind: 'help', finalLabel: 'Thanks, Orbi ▸' }); return; }
        if (x[1] === 'next') { close(); nextMission(); return; }
        return;
      }
      close();
      if (k === 'help') play(helpLines(), { kind: 'help', finalLabel: 'Thanks, Orbi ▸' });
      else if (k === 'next') nextMission();
      else if (k === 'tip') play([{ who: 'mascot', act: 'laptop', text: TIPS[Math.floor(Math.random() * TIPS.length)] }], { kind: 'help', finalLabel: 'Got it ▸' });
      else if (k === 'tour') runIntro(true);
    });
    document.addEventListener('click', e => { if (!d.contains(e.target) && !chat.hidden) close(); });
    d.hidden = !prefs.mascot;
  }
  window.YojoMascot = window.YojoMascot || { toggle(on) { const d = document.getElementById('orbiDock'); if (d) d.hidden = !on; } };
  buildDock();

  /* ---------------- mission briefings and victories ---------------- */
  if (typeof window.openMission === 'function') {
    const origOpen = window.openMission;
    window.openMission = async function (id) {
      const s = STORY[id];
      if (s && !st.briefed[id] && !me.stats.cleared.includes(id)) {
        await play(s[2].map(([who, text]) => ({ who, text })), { kind: 'brief', finalLabel: 'Accept mission ▸', skipLabel: 'Skip briefing' });
        st.briefed[id] = true; persist();
      }
      origOpen(id);
      decorateMissionModal(id);
    };
  }
  function decorateMissionModal(id) {
    const s = STORY[id], m = document.querySelector('.overlay .modal'); if (!s || !m) return;
    const [hero, vil] = [CAST[s[0]], CAST[s[1]]];
    const strip = document.createElement('div'); strip.className = 'vs-strip';
    strip.innerHTML = `<div class="vs-side">${portrait(s[0])}<span><small>Briefed by</small><b>${hero.name}</b></span></div><div class="vs">VS</div><div class="vs-side r"><span><small>City under attack</small><b>${vil.name}</b></span>${portrait(s[1])}</div>`;
    m.insertBefore(strip, m.children[1] || null);
    const rb = document.createElement('button'); rb.type = 'button'; rb.className = 'btn btn-sm'; rb.textContent = '▶ Replay briefing';
    rb.addEventListener('click', () => { document.querySelector('.overlay')?.remove(); play(s[2].map(([who, text]) => ({ who, text })), { kind: 'brief', finalLabel: 'Back to mission ▸' }).then(() => window.openMission(id)); });
    m.appendChild(rb);
  }
  if (typeof window.completeMission === 'function') {
    const origDone = window.completeMission;
    window.completeMission = function (m) {
      const was = me.stats.cleared.includes(m.id);
      origDone(m);
      const s = STORY[m.id];
      if (s && !was) {
        st.won[m.id] = true; persist();
        setTimeout(() => {
          const vil = s[1], left = villainHp(vil);
          const saved = VILLAINS.filter(v => villainHp(v).left === 0).length;
          const extra = left.left === 0 ? [{ who: s[0], act: 'cheer', win: true, text: `${CAST[vil].name} is SECURED! That makes ${saved} of ${VILLAINS.length} cities saved. I'm heading out to scout the next attack signal. Meet me at the next city, Agent!` }] : [];
          play([...s[3].map(([who, text]) => ({ who, text })), ...extra], { kind: 'victory', finalLabel: 'Continue ▸' });
        }, 3000);
      }
    };
  }

  /* ---------------- World Breach Map + campaign arcs ---------------- */
  function villainHp(v) {
    const ids = Object.keys(STORY).filter(k => STORY[k][1] === v);
    const left = ids.filter(k => !me.stats.cleared.includes(k)).length;
    return { total: ids.length, left };
  }
  function decorate() {
    const view = document.getElementById('view');
    const hero = view.querySelector('.hero');
    if (hero && !document.getElementById('villainBoard')) {
      const card = document.createElement('section'); card.className = 'card s12'; card.id = 'villainBoard';
      card.innerHTML = `<h3>World Breach Map <span class="note">Clear a mission to free each city from the unknown force</span></h3><div class="villains">${VILLAINS.map(v => {
        const h = villainHp(v), pct = h.total ? Math.round(100 * (h.total - h.left) / h.total) : 0, c = CAST[v];
        return `<div class="villain city ${h.left === 0 ? 'secured' : ''}" style="--pc:${c.col}">${portrait(v)}<div class="vinfo"><b>${c.name}</b><small>${h.left === 0 ? '✔ SECURED' : `⚠ Breached · ${c.title}`}</small><div class="bar ${h.left === 0 ? 'blade-green' : 'blade-red'}"><i style="width:${pct}%"></i></div></div></div>`;
      }).join('')}</div>`;
      const tiles = view.querySelector('.tiles');
      tiles ? tiles.after(card) : view.querySelector('.grid')?.appendChild(card);
    }
    view.querySelectorAll('.mission[data-mid]').forEach(el => {
      if (el.querySelector('.m-vs')) return;
      const s = STORY[el.dataset.mid]; if (!s) return;
      const t = document.createElement('div'); t.className = 'm-vs';
      t.innerHTML = `${portrait(s[1])}<span><small>Save</small> <b>${CAST[s[1]].name}</b></span>`;
      el.querySelector('b')?.after(t);
    });
    view.querySelectorAll('.course').forEach(el => {
      if (el.querySelector('.arc')) return;
      const nm = el.querySelector('.bd b')?.textContent.trim(); const a = CAMPAIGN_ARCS[nm]; if (!a) return;
      const d = document.createElement('p'); d.className = 'arc note';
      d.innerHTML = `<b style="color:${CAST[a[0]].col}">${CAST[a[0]].name}</b>${a[1] !== 'All' ? ` · free <b style="color:${CAST[a[1]].col}">${CAST[a[1]].name}</b>` : ''} · ${a[2]}`;
      el.querySelector('.bd b').after(d);
    });
  }
  const vObs = new MutationObserver(() => { vObs.disconnect(); decorate(); vObs.observe(document.getElementById('view'), { childList: true, subtree: true }); });
  vObs.observe(document.getElementById('view'), { childList: true, subtree: true });
  decorate();

  /* ---------------- Settings panel + profile menu entries ---------------- */
  async function sha256(t) { try { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); } catch { return 'plain:' + t; } }
  const PROFILE_FIELDS = [['name', 'Full name'], ['phone', 'Phone'], ['city', 'City'], ['institution', 'College or institution'], ['eduLevel', 'Education level'], ['stream', 'Stream'], ['gradYear', 'Graduation year'], ['skills', 'Skills'], ['certs', 'Certifications'], ['objective', 'Career objective']];
  function settingsOpen(tab) {
    let p = document.getElementById('ySettings');
    if (!p) {
      p = document.createElement('div'); p.id = 'ySettings'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Settings');
      const row = (k, cls, title, sub) => `<label class="ys-row ${cls}"><span><b>${title}</b><small>${sub}</small></span><input type="checkbox" data-pref="${k}" role="switch"><i class="ys-sw"></i></label>`;
      p.innerHTML = `<div class="ys-card"><div class="ys-head"><b>⚙ Settings</b><button type="button" class="btn btn-sm btn-ghost ys-x" aria-label="Close">✕</button></div>
        <div class="ys-tabs" role="tablist"><button type="button" data-ys="prefs" role="tab">Preferences</button><button type="button" data-ys="profile" role="tab">Edit profile</button><button type="button" data-ys="pw" role="tab">Password</button></div>
        <div class="ys-pane" data-pane="prefs">${row('intro', 'ys-intro', 'Intro and guided tour', 'Orbi greets you and shows you around when you enter. Turn off to see it only on your first login.')}
        ${row('voice', 'ys-voice', 'Character voice', 'Characters speak their lines out loud.')}
        ${row('mascot', 'ys-mascot', 'Orbi helper button', 'Show Orbi in the corner of every page. Click Orbi to explain the page, suggest your next mission or share a cyber tip.')}
        <div class="ys-foot"><button type="button" class="btn btn-sm" id="ysReplay">▶ Replay briefing now</button></div></div>
        <form class="ys-pane ys-form" data-pane="profile" id="ysProf" novalidate>${PROFILE_FIELDS.map(([k, l]) => `<label>${l}${k === 'objective' ? `<textarea name="${k}" rows="2"></textarea>` : `<input name="${k}">`}</label>`).join('')}<label>Email<input value="${me.email}" disabled title="Your login email cannot be changed here"></label><button class="btn btn-primary btn-sm">Save profile</button><p class="ys-msg"></p></form>
        <form class="ys-pane ys-form" data-pane="pw" id="ysPw" novalidate><label class="ys-cur">Current password<input type="password" name="cur" autocomplete="current-password"></label><label>New password<input type="password" name="pw" autocomplete="new-password"></label><label>Confirm new password<input type="password" name="pw2" autocomplete="new-password"></label><small class="note">At least 8 characters with a letter and a number. You can still log in with the email code.</small><button class="btn btn-primary btn-sm">Change password</button><p class="ys-msg"></p></form></div>`;
      document.body.appendChild(p);
      p.querySelector('.ys-x').onclick = settingsClose;
      p.addEventListener('click', e => { if (e.target === p) settingsClose(); const t = e.target.closest('[data-ys]'); if (t) showTab(t.dataset.ys); });
      p.querySelectorAll('[data-pref]').forEach(c => c.addEventListener('change', () => {
        prefs[c.dataset.pref] = c.checked; persist();
        if (c.dataset.pref === 'voice' && !c.checked) hush();
        if (c.dataset.pref === 'mascot' && window.YojoMascot) window.YojoMascot.toggle(c.checked);
        toast(`${c.closest('label').querySelector('b').textContent}: ${c.checked ? 'on' : 'off'}`);
      }));
      p.querySelector('#ysReplay').onclick = () => { settingsClose(); runIntro(true); };
      p.querySelector('#ysProf').addEventListener('submit', e => { e.preventDefault(); const f = e.target, msg = f.querySelector('.ys-msg');
        if (!f.name.value.trim()) { msg.textContent = 'Your name cannot be empty.'; return; }
        if (f.phone.value.trim() && !/^[+\d][\d\s-]{6,}$/.test(f.phone.value.trim())) { msg.textContent = 'Enter a valid phone number.'; return; }
        PROFILE_FIELDS.forEach(([k]) => { me.profile[k] = f[k].value.trim(); }); persist(); msg.textContent = '';
        toast('Profile saved.'); if (typeof renderHeader === 'function') renderHeader(); if (typeof route === 'function') route(); });
      p.querySelector('#ysPw').addEventListener('submit', async e => { e.preventDefault(); const f = e.target, msg = f.querySelector('.ys-msg'), a = me.auth = me.auth || {};
        if (a.pw && (await sha256(f.cur.value)) !== a.pw) { msg.textContent = 'Your current password is not right.'; return; }
        if (f.pw.value.length < 8 || !/[a-z]/i.test(f.pw.value) || !/\d/.test(f.pw.value)) { msg.textContent = 'Use at least 8 characters with a letter and a number.'; return; }
        if (f.pw.value !== f.pw2.value) { msg.textContent = 'The two new passwords do not match.'; return; }
        a.pw = await sha256(f.pw.value); a.pwAt = new Date().toISOString(); persist(); f.reset(); msg.textContent = ''; fillPw(); toast('Password changed.'); });
    }
    function fillPw() { const has = !!(me.auth && me.auth.pw); p.querySelector('.ys-cur').hidden = !has; p.querySelector('#ysPw button').textContent = has ? 'Change password' : 'Set password'; }
    function showTab(t) { p.querySelectorAll('[data-ys]').forEach(b => b.setAttribute('aria-selected', b.dataset.ys === t)); p.querySelectorAll('[data-pane]').forEach(x => x.hidden = x.dataset.pane !== t); }
    p.querySelectorAll('[data-pref]').forEach(c => { c.checked = !!prefs[c.dataset.pref]; });
    const pf = p.querySelector('#ysProf'); PROFILE_FIELDS.forEach(([k]) => { pf[k].value = me.profile[k] || ''; }); pf.querySelector('.ys-msg').textContent = '';
    fillPw(); showTab(['profile', 'pw'].includes(tab) ? tab : 'prefs');
    p.classList.add('on');
  }
  function settingsClose() { document.getElementById('ySettings')?.classList.remove('on'); }
  window.YojoSettings = { open: settingsOpen, close: settingsClose };
  document.getElementById('avBtn').addEventListener('click', () => setTimeout(() => {
    const pop = document.getElementById('avPop'); if (pop.hidden || pop.querySelector('#avTour')) return;
    const list = pop.querySelector('.list') || pop;
    const st_ = document.createElement('button'); st_.className = 'btn btn-sm'; st_.id = 'avSettings'; st_.textContent = '⚙ Settings';
    st_.addEventListener('click', () => { pop.hidden = true; settingsOpen(); });
    const b = document.createElement('button'); b.className = 'btn btn-sm'; b.id = 'avTour'; b.textContent = '▶ Replay briefing';
    b.addEventListener('click', () => { pop.hidden = true; runIntro(true); });
    list.prepend(b); list.prepend(st_);
  }, 0));

  /* ---------------- start ---------------- */
  if (window.__yojoPortalEntry) addEventListener('yojo:portal-done', () => setTimeout(runIntro, 3000), { once: true });
  else setTimeout(runIntro, 600);
})();
