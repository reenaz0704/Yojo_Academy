/* Yojo public website (index.html): LIVE mode on top of the page's demo behaviour.
   When the Yojo API answers, the Mentorship, Internship and Contact forms are sent to POST /public/submissions and
   reach the Admin LMS Enquiries inbox; "Remind me" stores a reminder; #unsubscribe= links work; and content an admin
   has published (FAQ, testimonials, mentors, blog posts) replaces the built-in text. Without the API, the page keeps
   its demo behaviour. The page shows success only after the server has stored the request and given a reference. */
(function () {
  'use strict';
  var api = window.YojoAPI;
  if (!api) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var paras = function (t) { return String(t || '').split(/\n\s*\n/).map(function (p) { return '<p>' + esc(p.trim()).replace(/\n/g, '<br>') + '</p>'; }).join(''); };
  var live = null; // null = still checking, then true / false
  var ready = api.available().then(function (ok) { return ok ? api.init().then(function () { return true; }, function () { return false; }) : false; })
    .then(function (ok) { live = ok; if (ok) start(); return ok; });
  var track = function (n, p) { try { window.YojoInsight && YojoInsight.track(n, p); } catch (e) {} };
  function msgOf(e) {
    if (e && e.problem && e.problem.message) return e.problem.message;
    if (e && e.status === 429) return 'Too many requests from this connection. Wait a little and try again.';
    if (e && e.status) return 'Something went wrong on our side (' + e.status + '). Your details are still in the form; try again.';
    return 'We could not reach the server. Your details are still in the form; check your connection and try again.';
  }
  var newKey = function () { return (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)).replace(/[^\w-]/g, ''); };

  /* ---------- the three website forms ---------- */
  var FORM = {
    mentor: { type: 'mentorship_session', map: { name: 'm-name', phone: 'm-phone', topic: 'm-track', preferredAt: 'm-when', consent: 'm-ok' }, page: 'index.html#mentorship' },
    intern: { type: 'internship_application', map: { name: 'i-name', email: 'i-mail', topic: 'i-squad', message: 'i-why', consent: 'i-ok' }, page: 'index.html#internships' },
    contact: { type: 'contact', map: { name: 'c-name', phone: 'c-phone', email: 'c-mail', topic: 'c-topic', message: 'c-msg', consent: 'c-ok' }, page: 'index.html#contact' },
    // program pages (30 Oct): the topic carries the program and the internship, e.g. "Expert Professional · SOC Analyst Intern"
    program: { type: 'internship_application', map: { name: 'p-name', email: 'p-mail', topic: 'p-topic', message: 'p-why', consent: 'p-ok' }, page: 'index.html#program' },
  };
  function trapField(f) {
    if ($('input[name=website]', f)) return;
    // Spam trap: hidden from people and screen readers; bots that fill every field give themselves away.
    var w = document.createElement('div');
    w.setAttribute('aria-hidden', 'true');
    w.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden';
    w.innerHTML = '<label>Website<input name="website" tabindex="-1" autocomplete="off"></label>';
    f.appendChild(w);
  }
  $$('form[data-form]').forEach(function (f) { if (FORM[f.dataset.form]) { trapField(f); f.addEventListener('input', function () { delete f.dataset.idem; }); } });

  document.addEventListener('submit', function (e) {
    var f = e.target, cfg = f && f.dataset && FORM[f.dataset.form];
    if (!cfg || live === false) return; // demo handler runs
    e.preventDefault(); e.stopImmediatePropagation();
    if (live === null) { ready.then(function () { f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { cancelable: true })); }); return; }
    send(f, cfg);
  }, true);

  function send(f, cfg) {
    var ok = $('.ok', f), btn = $('button[type=submit]', f), er = $('.enq-err', f);
    if (!er) { er = document.createElement('p'); er.className = 'enq-err'; er.setAttribute('role', 'alert'); er.style.cssText = 'color:#F87171;margin:.4rem 0 0'; btn.before(er); }
    er.textContent = ''; ok.hidden = true;
    var val = function (id) { var el = f.querySelector('#' + id); return el ? (el.type === 'checkbox' ? el.checked : String(el.value || '').trim()) : undefined; };
    var body = { type: cfg.type, sourcePage: f.dataset.program ? cfg.page + '/' + f.dataset.program : cfg.page }, m = cfg.map;
    Object.keys(m).forEach(function (k) { var v = val(m[k]); if (v !== '' && v !== undefined) body[k] = v; });
    if (body.preferredAt) { var t = new Date(body.preferredAt); if (isNaN(t)) delete body.preferredAt; else body.preferredAt = t.toISOString(); }
    // program pages: the chosen duration and mode travel in the message (the enquiry's free-text field)
    if (f.dataset.form === 'program') body.message = ['Duration: ' + val('p-dur'), 'Mode: ' + val('p-mode')].join(' · ') + (body.message ? String.fromCharCode(10, 10) + body.message : '');
    var hp = $('input[name=website]', f); if (hp && hp.value) body.website = hp.value;
    var bad = [];
    if (!body.name || body.name.length < 2) bad.push('your full name');
    if (m.phone && !/^\+?[\d\s-]{10,20}$/.test(body.phone || '')) bad.push('a valid phone number');
    if (m.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email || '')) bad.push('a valid email');
    if (!body.consent) bad.push('your consent to be contacted');
    if (bad.length) { er.textContent = 'Please add ' + bad.join(', ') + '.'; return; }
    f.dataset.idem = f.dataset.idem || newKey(); // the same key on a retry, so a lost answer cannot create a second record
    btn.disabled = true; var label = btn.textContent; btn.textContent = 'Sending…';
    api.raw('POST', '/public/submissions', body, { 'Idempotency-Key': f.dataset.idem }).then(function (r) {
      btn.disabled = false; btn.textContent = label;
      ok.innerHTML = '<svg class="i"><use href="#i-check"/></svg>' + (r.duplicate ? 'We already have this request. ' : 'Received. ') +
        'Your reference is <b class="mono">' + esc(r.reference) + '</b>. ' + (cfg.type === 'internship_application' ? 'We will be in touch soon.' : 'Our team replies within one working day.');
      ok.hidden = false; delete f.dataset.idem; f.reset();
      track('enquiry_submitted', { feature: f.dataset.form });
    }, function (e) {
      btn.disabled = false; btn.textContent = label;
      er.textContent = msgOf(e);
      var field = e && e.problem && e.problem.field, id = field && m[field];
      if (id && f.querySelector('#' + id)) f.querySelector('#' + id).focus();
    });
  }

  /* ---------- "Remind me" on the CTF page ---------- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-remind]');
    if (!b || live === false) return; // demo behaviour
    e.preventDefault(); e.stopImmediatePropagation();
    ready.then(function (ok) { if (ok) remindForm(b); });
  }, true);
  function remindForm(b) {
    var slug = b.dataset.event; if (!slug) return;
    var box = document.createElement('form');
    box.className = 'remind-form'; box.noValidate = true; box.style.cssText = 'display:grid;gap:.45rem;margin-top:.4rem';
    box.innerHTML = '<label class="sr-only" for="rm-' + slug + '">Email</label><input id="rm-' + slug + '" type="email" placeholder="you@example.com" autocomplete="email" style="background:rgba(7,13,24,.7);border:1px solid var(--border);border-radius:10px;padding:.55rem .8rem;color:var(--text)">' +
      '<label class="consent" style="font-size:.8rem"><input type="checkbox" required>Email me about this event. I can unsubscribe any time.</label>' +
      '<div style="display:none"><input name="website" tabindex="-1" autocomplete="off"></div>' +
      '<p class="enq-err" role="alert" style="color:#F87171;margin:0;font-size:.82rem"></p>' +
      '<button class="btn btn-sm btn-primary" type="submit">Set reminder</button>';
    b.replaceWith(box);
    $('input[type=email]', box).focus();
    box.addEventListener('submit', function (ev) {
      ev.preventDefault(); ev.stopImmediatePropagation();
      var em = $('input[type=email]', box).value.trim(), ok = $('input[type=checkbox]', box).checked, er = $('.enq-err', box), go = $('button', box);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) { er.textContent = 'Enter a valid email.'; return; }
      if (!ok) { er.textContent = 'Tick the box so we may email you.'; return; }
      go.disabled = true;
      var body = { email: em, consent: true }, hp = $('input[name=website]', box).value; if (hp) body.website = hp;
      api.post('/public/events/' + encodeURIComponent(slug) + '/reminders', body).then(function () {
        box.outerHTML = '<p class="note" role="status" style="margin-top:.4rem">Reminder set. We sent a confirmation to ' + esc(em) + ' with an unsubscribe link.</p>';
        track('event_reminder', { feature: slug });
      }, function (e2) { go.disabled = false; er.textContent = msgOf(e2).replace(/ Your details are still in the form;/, ''); });
    }, true);
  }

  /* ---------- live start: unsubscribe links, events, published content ---------- */
  function unsubscribeFromLink() {
    var m = location.hash.match(/^#unsubscribe=([\w-]{20,100})$/);
    if (!m) return;
    history.replaceState(null, '', location.pathname + location.search + '#home'); // the token leaves the address bar
    api.post('/public/subscriptions/unsubscribe', { token: m[1] }).then(function (r) {
      notice('You will not get reminders for ' + (r.event || 'this event') + '.');
    }, function (e) { notice(msgOf(e)); });
  }
  function start() {
    unsubscribeFromLink();
    window.addEventListener('hashchange', unsubscribeFromLink);
    api.get('/public/events').then(function (r) {
      (r.items || []).forEach(function (ev) {
        var b = $('[data-remind][data-event="' + ev.slug + '"]'); if (!b) return;
        if (!ev.remindable) { b.disabled = true; b.textContent = 'Started'; }
        var meta = b.parentElement && $('.meta span', b.parentElement);
        if (meta && ev.startsAt) meta.textContent = new Date(ev.startsAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
      });
    }, function () {});
    content('faq', faq); content('testimonial', testimonials); content('mentor', mentors); content('post', posts);
  }
  function notice(text) {
    var n = document.createElement('div');
    n.setAttribute('role', 'status');
    n.style.cssText = 'position:fixed;left:50%;bottom:1.5rem;transform:translateX(-50%);z-index:300;max-width:min(92vw,520px);background:#0B1830;border:1px solid #39D98A;color:#E6EDF7;padding:.9rem 1.1rem;border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.5)';
    n.innerHTML = esc(text) + ' <button type="button" class="btn btn-sm" style="margin-left:.6rem">OK</button>';
    $('button', n).onclick = function () { n.remove(); };
    document.body.appendChild(n);
  }
  function content(kind, apply) {
    api.get('/public/content?kind=' + kind).then(function (r) { if (r.items && r.items.length) apply(r.items); }, function () {});
  }
  function faq(items) {
    var first = $('details.faq'); if (!first) return;
    var parent = first.parentElement;
    $$('details.faq', parent).forEach(function (d) { d.remove(); });
    parent.insertAdjacentHTML('beforeend', items.map(function (i) { return '<details class="faq"><summary>' + esc(i.title) + '</summary>' + paras(i.body) + '</details>'; }).join(''));
  }
  function testimonials(items) {
    var track_ = $('.stories .strack'); if (!track_) return;
    var colors = ['#39D98A', '#3B82F6', '#FFB000', '#F87171', '#A78BFA'];
    var fig = function (t, k) {
      var d = t.data || {}, ini = t.title.split(/\s+/).map(function (w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase();
      return '<figure class="story"><div class="ph" style="--c:' + colors[k % colors.length] + '"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="24" r="12" fill="currentColor" opacity=".9"/><path d="M8 62c2-14 12-22 24-22s22 8 24 22z" fill="currentColor" opacity=".9"/></svg><span>' + esc(ini) + '</span></div>' +
        '<blockquote>"' + esc(t.body) + '"</blockquote><figcaption><b>' + esc(t.title) + '</b><span>' + esc([d.role, d.city].filter(Boolean).join(', ')) + '</span></figcaption></figure>';
    };
    var once = items.map(fig).join('');
    track_.innerHTML = once + once; // the marquee scrolls a doubled track
  }
  function mentors(items) {
    if (!window.YojoSiteContent) return;
    window.YojoSiteContent.mentors(items.map(function (m) {
      var d = m.data || {};
      var ini = d.initials || m.title.split(/\s+/).map(function (w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase();
      return { n: esc(m.title), i: esc(ini), role: esc(d.role || ''), track: esc(d.track || ''), certs: (d.certs || []).map(esc),
        s: d.placed && d.rating && d.mockInterviews ? [esc(d.placed), esc(d.rating), esc(d.mockInterviews)] : null };
    }));
  }
  function posts(items) {
    if (!window.YojoSiteContent) return;
    var articles = {};
    var list = items.map(function (p) {
      var d = p.data || {}, id = 'c-' + p.slug;
      articles[id] = paras(p.body);
      return { id: id, t: esc(p.title), a: esc(d.author || ''), c: esc(d.category || 'Career'), min: Number(d.minutes) || 3, ex: esc(d.excerpt || ''), feat: !!d.featured };
    });
    window.YojoSiteContent.posts(list, articles);
  }

  window.YojoSiteLive = ready;
})();
