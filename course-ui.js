/* Shared course catalog components: cards, filters, FAQs and the course details page.
   Used by the landing page (index.html) and the student LMS (academy.html). Data comes from YojoCourses
   (trainer-data.js), so both pages show the same courses and the same FAQs. Nothing here decides access:
   the page passes in the actions, and lesson content only comes from YojoCourses.lesson(). */
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CAT = {
    'Cybersecurity Fundamentals': ['167,139,250', '<path d="M32 6l20 7v15c0 13-9 22-20 27C21 50 12 41 12 28V13z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M24 31l6 6 11-12" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>'],
    'Defensive Security and SOC': ['91,140,255', '<rect x="8" y="12" width="48" height="32" rx="4" fill="none" stroke="currentColor" stroke-width="3"/><path d="M14 36l9-10 7 6 12-14 8 8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M24 52h16" stroke="currentColor" stroke-width="3"/>'],
    'Offensive Security and Ethical Hacking': ['248,113,113', '<circle cx="32" cy="32" r="20" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="32" cy="32" r="9" fill="none" stroke="currentColor" stroke-width="3"/><path d="M32 4v12M32 48v12M4 32h12M48 32h12" stroke="currentColor" stroke-width="3"/>'],
    'Security Testing': ['255,138,76', '<path d="M22 8h20M26 8v16L12 50a4 4 0 0 0 4 6h32a4 4 0 0 0 4-6L38 24V8" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M18 42h28" stroke="currentColor" stroke-width="3"/>'],
    'Cloud Security': ['56,189,248', '<path d="M18 46a10 10 0 0 1 0-20 14 14 0 0 1 27-3 11 11 0 0 1 1 23z" fill="none" stroke="currentColor" stroke-width="3"/><rect x="26" y="32" width="12" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="2.5"/>'],
    'Governance, Risk and Compliance (GRC)': ['57,217,138', '<rect x="14" y="8" width="36" height="48" rx="4" fill="none" stroke="currentColor" stroke-width="3"/><path d="M22 20h20M22 30h20M22 40h12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>'],
    'Digital Forensics and Incident Response': ['244,114,182', '<circle cx="27" cy="27" r="15" fill="none" stroke="currentColor" stroke-width="3"/><path d="M38 38l16 16" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M20 27h14M27 20v14" stroke="currentColor" stroke-width="2.5"/>'],
    'AI and Cybersecurity': ['192,132,252', '<rect x="16" y="16" width="32" height="32" rx="6" fill="none" stroke="currentColor" stroke-width="3"/><path d="M24 8v8M40 8v8M24 48v8M40 48v8M8 24h8M8 40h8M48 24h8M48 40h8" stroke="currentColor" stroke-width="3"/>'],
    'Capture the Flag (CTF)': ['255,176,0', '<path d="M16 58V8" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/><path d="M18 10h30l-7 10 7 10H18" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>'],
    'Networking': ['45,212,191', '<circle cx="32" cy="14" r="6" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="14" cy="48" r="6" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="50" cy="48" r="6" fill="none" stroke="currentColor" stroke-width="3"/><path d="M29 19L17 43M35 19l12 24M20 48h24" stroke="currentColor" stroke-width="3"/>'],
    'Cyber Forensics': ['251,146,60', '<path d="M20 30a12 12 0 0 1 24 0v6M26 30a6 6 0 0 1 12 0v10M32 30v14M20 38v4M44 40v6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="42" cy="44" r="10" fill="none" stroke="currentColor" stroke-width="3"/><path d="M49 51l8 8" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>'],
    'Communication Skills': ['250,204,21', '<path d="M10 14h30a6 6 0 0 1 6 6v14a6 6 0 0 1-6 6H24l-10 8v-8h-4a6 6 0 0 1-6-6V20a6 6 0 0 1 6-6z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M50 26h4a6 6 0 0 1 6 6v12a6 6 0 0 1-6 6h-2v8l-9-8h-9" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>'],
    'Career Readiness': ['250,204,21', '<rect x="10" y="20" width="44" height="32" rx="4" fill="none" stroke="currentColor" stroke-width="3"/><path d="M24 20v-6h16v6M10 34h44" stroke="currentColor" stroke-width="3"/>']
  };
  const ORDER = Object.keys(CAT);
  const look = c => CAT[c] || ['91,140,255', CAT['Cybersecurity Fundamentals'][1]];
  const thumb = (c, cls = '') => { const [rgb, svg] = look(c.category);
    if (c.image) return `<div class="cx-th has-img ${cls}" style="--c:${rgb}"><img src="${esc(c.image)}" alt="" loading="lazy" decoding="async"><span class="cx-badge">${esc(c.category)}</span>${badge(c)}</div>`; // course banner, cropped to the card
    return `<div class="cx-th ${cls}" style="--c:${rgb};color:rgb(${rgb})"><svg viewBox="0 0 64 64" aria-hidden="true">${svg}</svg><span class="cx-badge">${esc(c.category)}</span>${badge(c)}</div>`; };
  const badge = c => c.state === 'enrolled' ? '<span class="cx-badge mine">Enrolled</span>' : `<span class="cx-badge ${c.access}">${c.access === 'free' ? 'Free' : 'Paid'}</span>`;
  const meta = c => { const m = [];
    if (c.level) m.push(c.level); if (c.duration) m.push(c.duration); if (c.format.length) m.push(c.format.join(' · '));
    if (c.lessonCount) m.push(`${c.moduleCount} module${c.moduleCount === 1 ? '' : 's'} · ${c.lessonCount} lesson${c.lessonCount === 1 ? '' : 's'}`);
    if (c.labs.length) m.push(`${c.labs.length} hands-on lab${c.labs.length === 1 ? '' : 's'}`);
    if (c.certificate) m.push('Certificate');
    return m.length ? `<div class="cx-meta">${m.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : ''; };
  const btn = a => a.href ? `<a class="cx-btn sm ${a.cls || ''}" href="${esc(a.href)}">${esc(a.label)}</a>` : `<button type="button" class="cx-btn sm ${a.cls || ''}" data-cx="${esc(a.act)}" data-id="${esc(a.id || '')}">${esc(a.label)}</button>`;

  // FAQ list. Native <details> works with keyboard (Enter/Space) and touch, and needs no script.
  function faq(list, empty = 'No FAQs have been added for this course yet. The course owner can add them from the trainer console.') {
    if (!list) return '<div class="cx-empty" role="status">Loading FAQs…</div>';
    if (!list.length) return `<div class="cx-empty">${esc(empty)}</div>`;
    return `<div class="cx-faq">${list.map(f => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p>${f.src === 'owner' ? '<small>Added by the course team</small>' : '<small>From the course details</small>'}</details>`).join('')}</div>`;
  }
  function progress(c) { if (c.state !== 'enrolled') return '';
    return `<div><div class="cx-row" style="justify-content:space-between;font-size:.82rem"><span class="cx-note">${c.done} of ${c.lessonCount} lessons done</span><b>${c.pct}%</b></div><div class="cx-bar"><i style="width:${c.pct}%"></i></div></div>`; }
  function card(c, o = {}) {
    return `<article class="cx-card" data-course="${esc(c.slug)}">${thumb(c)}<div class="cx-bd"><h3><a href="${esc(o.href(c))}" style="color:inherit;text-decoration:none">${esc(c.title)}</a></h3>${c.desc ? `<p>${esc(c.desc)}</p>` : '<p class="cx-note">Course details are being prepared.</p>'}${meta(c)}${progress(c)}</div>
      <div class="cx-acts">${o.actions(c).map(btn).join('')}</div>
      <details class="cx-faqs"><summary>FAQs (${c.faqs.length})</summary>${faq(c.faqs)}</details></article>`;
  }
  function featured(c, o) {
    return `<article class="cx-feat" data-course="${esc(c.slug)}">${thumb(c)}<div><div class="cx-bd"><span class="cx-note">Featured course</span><h3 style="font-size:1.35rem">${esc(c.title)}</h3><p>${esc(c.overview || c.desc)}</p>${meta(c)}</div>
      <div class="cx-acts">${o.actions(c).map(btn).join('')}</div></div></article>`;
  }

  const TABS = [
    ['all', 'All courses', l => l],
    ['featured', 'Featured', l => l.filter(c => c.featured)],
    ['trending', 'Trending', l => l.filter(c => c.enrolled > 0).sort((a, b) => b.enrolled - a.enrolled)],
    ['beginner', 'Beginner friendly', l => l.filter(c => c.level === 'Beginner')],
    ['labs', 'Hands-on labs', l => l.filter(c => c.labs.length)],
    ['free', 'Free courses', l => l.filter(c => c.access === 'free')],
    ['paid', 'Paid courses', l => l.filter(c => c.access === 'paid')],
    ['recent', 'Recently added', l => l.filter(c => Date.now() - c.addedAt < 60 * 864e5).sort((a, b) => b.addedAt - a.addedAt)]
  ];
  // catalog with category chips, tabs and (optionally) search. state survives re-renders on the same root.
  function catalog(root, o) {
    const st = root._cx = root._cx || { cat: '', tab: o.tab || 'all', q: '' };
    const all = o.courses, cats = ORDER.filter(k => all.some(c => c.category === k)).concat([...new Set(all.map(c => c.category))].filter(k => !ORDER.includes(k)));
    const tabs = TABS.filter(([k, , f]) => k === 'all' || f(all.slice()).length);
    if (!tabs.some(t => t[0] === st.tab)) st.tab = 'all';
    const draw = () => {
      let xs = tabs.find(t => t[0] === st.tab)[2](all.slice());
      if (st.cat) xs = xs.filter(c => c.category === st.cat);
      if (st.q) xs = xs.filter(c => (c.title + ' ' + c.desc + ' ' + c.category).toLowerCase().includes(st.q));
      const total = xs.length; const feat = o.feature && st.tab === 'all' && !st.cat && !st.q ? all.find(c => c.featured) : null;
      if (feat) xs = xs.filter(c => c !== feat);
      const shown = o.limit ? xs.slice(0, o.limit) : xs;
      root.querySelector('.cx-out').innerHTML = (feat ? featured(feat, o) : '') +
        `<p class="cx-count" role="status">${total} course${total === 1 ? '' : 's'}${st.cat ? ' in ' + esc(st.cat) : ''}${o.limit && xs.length > o.limit ? ` · showing ${o.limit}` : ''}</p>` +
        (shown.length ? `<div class="cx-grid">${shown.map(c => card(c, o)).join('')}</div>` : `<div class="cx-empty">No courses match these filters. <button type="button" class="cx-btn sm" data-cx-reset>Reset filters</button></div>`) +
        (o.more && xs.length > (o.limit || 1e9) ? `<div class="cx-row" style="justify-content:center;margin-top:1.2rem">${btn(o.more)}</div>` : '');
      root.querySelectorAll('[data-cx-cat]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cxCat === st.cat)));
      root.querySelectorAll('[data-cx-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.cxTab === st.tab)));
      o.onDraw && o.onDraw(root);
    };
    root.innerHTML = `<div class="cx-filters">${o.search ? `<div class="cx-row"><input class="cx-search" type="search" placeholder="Search courses" aria-label="Search courses" value="${esc(st.q)}"></div>` : ''}
      <div class="cx-chips" role="group" aria-label="Course categories"><button type="button" class="cx-chip" data-cx-cat="">All categories</button>${cats.map(k => `<button type="button" class="cx-chip" data-cx-cat="${esc(k)}">${esc(k)}</button>`).join('')}</div>
      <div class="cx-tabs" role="tablist" aria-label="Course lists">${tabs.map(([k, l]) => `<button type="button" class="cx-tab" role="tab" data-cx-tab="${k}">${l}</button>`).join('')}</div></div><div class="cx-out"></div>`;
    if (!root._cxBound) { root._cxBound = true;
      root.addEventListener('click', e => { const s = root._cx;
        const cb = e.target.closest('[data-cx-cat]'); if (cb) { s.cat = cb.dataset.cxCat; root._cxDraw(); return; }
        const tb = e.target.closest('[data-cx-tab]'); if (tb) { s.tab = tb.dataset.cxTab; root._cxDraw(); return; }
        if (e.target.closest('[data-cx-reset]')) { s.cat = ''; s.tab = 'all'; s.q = ''; const i = root.querySelector('.cx-search'); if (i) i.value = ''; root._cxDraw(); } });
      root.addEventListener('input', e => { if (e.target.classList.contains('cx-search')) { root._cx.q = e.target.value.trim().toLowerCase(); root._cxDraw(); } }); }
    root._cxDraw = draw; draw();
  }

  // course details page. o.crumbs: [[label, href]], o.actions(c), o.lessonAction(c, lesson) -> html, o.related, o.access(c) -> html
  function detail(c, o) {
    const sec = (t, body) => body ? `<section class="cx-sec"><h2>${t}</h2>${body}</section>` : '';
    const ul = xs => xs && xs.length ? `<ul>${xs.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
    const side = [['Category', c.category], ['Level', c.level], ['Duration', c.duration], ['Format', c.format.join(', ')], ['Lessons', c.lessonCount ? `${c.lessonCount} in ${c.moduleCount} module${c.moduleCount === 1 ? '' : 's'}` : ''], ['Certificate', c.certificate], ['Trainer', c.trainer]].filter(x => x[1]);
    const cur = c.modules.length && c.lessonCount ? c.modules.map((m, i) => `<details class="cx-mod" ${i === 0 ? 'open' : ''}><summary><span>${esc(m.title)}</span><span class="cx-note">${m.lessons.length} lesson${m.lessons.length === 1 ? '' : 's'}</span></summary>
        ${m.lessons.map(l => `<div class="cx-les ${l.done ? 'done' : ''}"><span>${l.done ? '<b>✓</b> ' : ''}${esc(l.title)} <span class="cx-note">${esc(l.type)}${l.preview ? ' · preview' : ''}</span></span>${o.lessonAction ? o.lessonAction(c, l) : ''}</div>`).join('')}</details>`).join('')
      : '<div class="cx-empty">The curriculum outline for this course has not been published yet.</div>';
    return `<div class="cx"><nav class="cx-crumb" aria-label="Breadcrumb">${o.crumbs.map(([l, h], i) => h ? `<a href="${esc(h)}">${esc(l)}</a><span aria-hidden="true">›</span>` : `<span aria-current="page">${esc(l)}</span>`).join('')}</nav>
      <div class="cx-dhead"><div>${badge(c)} <span class="cx-badge">${esc(c.category)}</span><h1>${esc(c.title)}</h1><p style="color:var(--cx-mu);line-height:1.6;margin:0">${esc(c.overview || c.desc || 'Course details are being prepared.')}</p>${progress(c) ? `<div style="margin-top:1rem;max-width:420px">${progress(c)}</div>` : ''}
        ${sec('What you will learn', ul(c.outcomes))}${sec('Prerequisites', c.prerequisites ? `<p style="color:var(--cx-mu)">${esc(c.prerequisites)}</p>` : '')}${sec('Who this course is for', c.audience ? `<p style="color:var(--cx-mu)">${esc(c.audience)}</p>` : '')}
        ${sec('Curriculum', cur)}${sec('Hands-on labs and projects', ul(c.labs))}
        ${sec('Course access and pricing', `<p style="color:var(--cx-mu);line-height:1.6">${o.access(c)}</p>`)}
        ${sec('Frequently asked questions', faq(c.faqs))}
        ${o.related && o.related.length ? sec('Related courses', `<div class="cx-grid">${o.related.map(r => card(r, o)).join('')}</div>`) : ''}</div>
      <aside class="cx-side" aria-label="Course summary">${thumb(c)}${side.length ? `<dl>${side.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}<div class="cx-row">${o.actions(c, true).map(btn).join('')}</div><a class="cx-note" href="${esc(o.back[1])}">← ${esc(o.back[0])}</a></aside></div></div>`;
  }
  const related = (c, all) => { const same = all.filter(x => x.id !== c.id && x.category === c.category); return same.concat(all.filter(x => x.id !== c.id && x.category !== c.category && x.access === c.access)).slice(0, 3); };
  window.CourseUI = { esc, card, faq, catalog, detail, related, thumb };
})();
