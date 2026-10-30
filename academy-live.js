/* Yojo Student Academy: LIVE mode. Loaded before academy.html's main script.
   - No API reachable: window.YojoAcademyLive.ready resolves false and the page runs in demo mode exactly as before.
   - API reachable: the page waits for this file. With a signed-in student it builds `me` from the server and replaces
     the demo views with server data: XP and rank, the streak and its keep/reset decision, daily patches, weekly ops,
     trophies, the league board, missions and hints, Intel blogs and the notification bell. Without a student session
     it resolves 'signed-out' and the page shows its sign-in gate.
   The server is the only authority for XP, streaks and hint charges; nothing here changes them locally. */
(function () {
  'use strict';
  var api = window.YojoAPI;
  var openedAt = location.hash; // demo scripts may change the hash before sign-in finishes (old mission links)
  var domReady = new Promise(function (res) { if (document.readyState !== 'loading') res(); else document.addEventListener('DOMContentLoaded', res); });
  if (!api) { window.YojoAcademyLive = { ready: Promise.resolve(false) }; return; }
  // An uploaded lesson file (29 Oct): the API checks access again on every download (GET /files/:id).
  function lessonFile(f) {
    var esc2 = function (x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var name = '<b>' + esc2(f.name) + '</b>' + (f.sizeMb ? ' (' + f.sizeMb + ' MB)' : '');
    if (!f.available || !f.url) return '<p>File: ' + name + '</p><p class="note">File downloads need file storage, which is not connected yet.</p>';
    var src = api.base + f.url, ext = (String(f.name).split('.').pop() || '').toLowerCase();
    if (/^(mp4|m4v|webm|mov)$/.test(ext)) return '<video controls preload="metadata" style="width:100%;max-height:60vh;border-radius:10px;background:#000" src="' + esc2(src) + '"></video><p class="note">' + name + '</p>';
    if (/^(png|jpe?g|webp|gif)$/.test(ext)) return '<img alt="' + esc2(f.name) + '" style="max-width:100%;border-radius:10px" src="' + esc2(src) + '">';
    return '<p>File: ' + name + ' <a class="btn btn-sm" target="_blank" rel="noopener" href="' + esc2(src) + '">' + (ext === 'pdf' ? 'Open' : 'Download') + '</a></p>';
  }

  var ready = api.available().then(function (ok) {
    if (!ok) return false;
    return api.init().then(function () { return api.me(); }).then(function (u) {
      if (u.role !== 'student' || u.sessionScope !== 'full') return 'signed-out';
      return Promise.all([load(), domReady]).then(function (x) { install(u, x[0]); return true; });
    }, function () { return domReady.then(function () { return 'signed-out'; }); });
  });
  window.YojoAcademyLive = { ready: ready };

  var get = api.get, post = api.post;
  var put = function (p, b) { return api.raw('PUT', p, b || {}); };
  var del = function (p) { return api.raw('DELETE', p); };
  function load() {
    return Promise.all([get('/student/dashboard'), get('/me/notifications?limit=30'), get('/student/missions')]).then(function (x) {
      return { dash: x[0], notes: x[1], missions: x[2] };
    });
  }

  function install(u, data) {
    var L = { dash: null, notes: null, missions: null, user: u }, batchName = null, STORY_KEY = 'yojo_story_' + u.id;
    var errMsg = function (e) { return (e && e.message) || 'Something went wrong. Try again.'; };
    var when = function (t) { var d = new Date(t), m = Math.round((Date.now() - d) / 6e4); return m < 60 ? Math.max(1, m) + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); };
    var fmt = function (n) { return Number(n || 0).toLocaleString('en-IN'); };
    var sp = u.studentProfile || {};

    function apply(d) {
      L.dash = d.dash; L.notes = d.notes; L.missions = d.missions;
      var x = d.dash;
      me = {
        live: true, email: u.email, id: x.profile.code, name: x.profile.name,
        profile: Object.assign({}, me && me.profile, { name: x.profile.name, institution: sp.institutionName || '' }),
        category: x.profile.path, provisional: x.profile.provisional, scores: x.powerLevels || { Offensive: 0, Defensive: 0, GRC: 0 },
        showOnBoard: sp.showOnBoard !== false, notifs: [], scrolls: [], story: (me && me.live && me.story) || loadStory(),
        stats: {
          xp: x.xp.total, weekXp: x.xp.thisWeek, streak: x.streak.current, longest: x.streak.longest, freezes: 0,
          cleared: d.missions.items.filter(function (m) { return m.state === 'cleared'; }).map(function (m) { return m.code; }),
          progress: {}, plan: x.profile.plan, batch: batchName, days: x.streak.last28.map(function (z) { return z.active; }), lastActive: x.streak.lastQualifiedDay,
        },
      };
    }
    function refresh() { return load().then(function (d) { apply(d); }); }
    // Story-mode progress (intro tour seen, briefings shown) is a per-browser display preference, not learning data.
    function loadStory() { try { return JSON.parse(localStorage.getItem(STORY_KEY)) || undefined; } catch (e) { return undefined; } }
    apply(data);

    /* ---- the server owns XP, streaks and storage ---- */
    saveDb = function () { try { if (me && me.story) localStorage.setItem(STORY_KEY, JSON.stringify(me.story)); } catch (e) {} }; // nothing else is stored locally
    addXp = function () {};
    earnStreak = function () {};
    logout = function () { api.logout().catch(function () {}).then(function () { location.href = 'index.html'; }); };
    var rerender = function () { refresh().then(route, function (e) { toast(errMsg(e)); }); };

    /* ---- header and bell ---- */
    renderHeader = function () {
      $('#hXp').textContent = fmt(me.stats.xp); $('#hSt').textContent = me.stats.streak + (me.stats.streak === 1 ? ' day' : ' days');
      $('#avBtn').textContent = (me.profile.name || 'A')[0].toUpperCase();
      var un = L.notes.unread;
      $('#bellCount').hidden = !un; $('#bellCount').textContent = un > 9 ? '9+' : un;
      $('#bellBtn').setAttribute('aria-label', 'Notifications, ' + un + ' unread');
    };
    var KIND = { booking: 'message', leave: 'message', message: 'message', grade: 'academy', blog: 'academy', certificate: 'academy', broadcast: 'important', system: 'academy' };
    bellPanel = function () {
      var list = L.notes.items.slice(0, 8);
      $('#bellPop').innerHTML = '<div class="row" style="margin-bottom:.5rem"><b>Notifications</b>' + (L.notes.unread ? '<button class="btn btn-sm" id="markAll">Mark all read</button>' : '') + '</div>' +
        '<div class="list">' + (list.length ? list.map(function (n) {
          return '<div class="notif k-' + (n.important ? 'important' : KIND[n.kind] || 'academy') + ' ' + (n.readAt ? '' : 'unread') + '" data-n="' + n.id + '" tabindex="0" role="button"><div class="row"><b style="font-size:.88rem">' + esc(n.title) + '</b><span class="note">' + when(n.createdAt) + '</span></div>' + (n.important ? '<span class="chip a" style="justify-self:start">Important</span>' : '') + '</div>';
        }).join('') : '<p class="note">You are all caught up.</p>') + '</div>';
      var all = $('#markAll'); if (all) all.addEventListener('click', function () { post('/me/notifications/read-all').then(function () { return get('/me/notifications?limit=30'); }).then(function (n) { L.notes = n; renderHeader(); bellPanel(); }); });
      $$('[data-n]', $('#bellPop')).forEach(function (el) { var open = function () { openNotif(el.dataset.n); }; el.addEventListener('click', open); el.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(); }); });
    };
    openNotif = function (id) {
      var n = L.notes.items.find(function (x) { return x.id === id; }); if (!n) return;
      if (!n.readAt) { n.readAt = new Date().toISOString(); L.notes.unread = Math.max(0, L.notes.unread - 1); post('/me/notifications/' + id + '/read').catch(function () {}); }
      renderHeader(); closePops();
      var go = n.link ? '<a class="btn btn-primary btn-sm" href="' + esc(n.link) + '" data-close>Open</a>' : '<button class="btn btn-primary btn-sm" data-close>Got it</button>';
      modal('<span class="chip ' + (n.important ? 'a' : 'b') + '" style="justify-self:start">' + (n.important ? 'Important' : esc(n.kind)) + '</span><h2>' + esc(n.title) + '</h2><p class="note">' + new Date(n.createdAt).toLocaleString('en-IN') + '</p>' + (n.body ? '<p>' + esc(n.body) + '</p>' : '') +
        '<div class="row" style="justify-content:flex-start">' + go + '</div>');
    };

    /* ---- streak: the server opens the break after 48 h and decides keep/reset once ---- */
    streakCheck = function () {
      var p = L.dash.streak.pendingDecision; if (!p) return;
      var ov = modal('<h2>🔥 You missed your streak</h2><p class="note">You were away for ' + p.awayDays + ' day' + (p.awayDays === 1 ? '' : 's') + ', so your ' + p.streakLength + '-day streak has broken.</p>' +
        '<div class="list" style="margin:.8rem 0"><div class="item"><span><b>Keep my ' + p.streakLength + '-day streak</b><br><span class="note">Give up ' + p.keepCostPct + '% of your XP: ' + fmt(p.xpNow) + ' → ' + fmt(p.xpAfterKeep) + ' XP (−' + fmt(p.keepCostXp) + ')</span></span><button class="btn btn-amber btn-sm" id="stKeep">Keep streak (−' + fmt(p.keepCostXp) + ' XP)</button></div>' +
        '<div class="item"><span><b>Start again</b><br><span class="note">Keep all your XP. The streak goes back to 0.</span></span><button class="btn btn-sm" id="stReset">Reset streak</button></div></div>' +
        '<p class="note">' + esc(L.dash.streak.rule) + '</p><p class="note" id="stErr" style="color:var(--red)"></p>');
      var decide = function (d) {
        $$('#stKeep,#stReset', ov).forEach(function (b) { b.disabled = true; });
        post('/student/streak/decision', { breakId: p.breakId, decision: d }).then(function () {
          ov.remove(); toast(d === 'keep' ? 'Streak kept. −' + fmt(p.keepCostXp) + ' XP' : 'Streak reset to 0'); rerender();
        }, function (e) { $('#stErr', ov).textContent = errMsg(e); $$('#stKeep,#stReset', ov).forEach(function (b) { b.disabled = false; }); });
      };
      $('#stKeep', ov).addEventListener('click', function () { decide('keep'); });
      $('#stReset', ov).addEventListener('click', function () { decide('reset'); });
      ov.addEventListener('click', function (e) { if (e.target === ov || e.target.closest('[data-close]')) e.stopImmediatePropagation(); }, true); // a choice is required
    };

    /* ---- daily patches and weekly ops ---- */
    questList = function () {
      var d = L.dash.daily;
      return '<div class="list">' + d.items.map(function (q) {
        return '<div class="item ' + (q.claimed ? 'done' : '') + '"><span>' + (q.done ? '✅' : '⬜') + ' ' + esc(q.title) + '</span>' + (q.claimed ? '<span class="chip g">Claimed</span>' : q.done ? '<button class="btn btn-sm btn-primary" data-claim="' + q.key + '">Claim +' + q.xp + ' XP</button>' : '<span class="mono note">+' + q.xp + ' XP</span>') + '</div>';
      }).join('') + '</div>';
    };
    bindQuests = function () {
      $$('[data-claim]').forEach(function (b) {
        b.addEventListener('click', function () {
          b.disabled = true;
          post('/student/daily/' + b.dataset.claim + '/claim').then(function (r) { toast('Quest reward claimed' + (r && r.xp ? ': +' + r.xp + ' XP' : '')); rerender(); }, function (e) { b.disabled = false; toast(errMsg(e)); });
        });
      });
    };
    fieldOps = function () {
      return '<div class="fops">' + L.dash.weekly.ops.map(function (o) {
        return '<div class="item" style="display:grid;gap:.45rem"><div class="row"><b>' + esc(o.title) + '</b><span class="mono note">' + o.progress + '/' + o.target + ' · ' + (o.paid ? 'Paid' : '+' + o.xp + ' XP') + '</span></div><div class="bar"><i style="width:' + (100 * o.progress / o.target) + '%"></i></div></div>';
      }).join('') + '</div>';
    };
    var endsAt = function (iso) { var ms = new Date(iso) - Date.now(), d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5); return d + 'd ' + h + 'h'; };
    var DIV = { bronze: '🥉 Bronze', silver: '🥈 Silver', gold: '🥇 Gold', platinum: '💠 Platinum', diamond: '💎 Diamond' };

    /* ---- dashboard ---- */
    var liveCourses = [];
    vDashboard = function () {
      var x = L.dash, s = me.stats, r = x.xp.rank, cat = path();
      var op = x.activeOperation, recent = x.recentVictories;
      $('#view').innerHTML =
        '<div class="grid g12">' +
        '<section class="card s12 hero" aria-label="Welcome" style="--faction-glow:' + FCOL[cat] + '55;--faction-col:' + FCOL[cat] + '"><div class="prof"><div class="av">' + esc(first()[0]) + '</div><div>' +
          '<span class="callsign">AGENT // ' + esc(String(me.id || 'RECRUIT').toUpperCase()) + ' // ' + esc(FACTIONS[cat].toUpperCase()) + '</span><h1>Welcome back, ' + esc(first()) + '</h1>' +
          '<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.45rem;align-items:center"><span class="pathbadge ' + (cat === 'Foundations' ? 'GRC' : cat) + '" id="pathBadge">Your path: ' + esc(PATHS[cat]) + ' · ' + esc(FACTIONS[cat]) + (me.provisional ? ' (provisional)' : '') + '</span><span class="chip b" style="display:inline-flex;align-items:center;gap:.4rem">' + insignia(r.name) + esc(r.name) + '</span></div></div></div>' +
          '<div style="min-width:min(320px,100%);flex:1;max-width:420px"><div class="row note"><span>' + fmt(s.xp) + ' XP</span><span>' + (r.next ? fmt(r.next.xp) + ' XP to ' + esc(r.next.name) : 'Top rank') + '</span></div>' +
          '<div class="bar" style="margin:.35rem 0 .8rem"><i style="width:' + r.progressPct + '%"></i></div>' + (op ? '<a class="btn btn-primary" href="#/academy/missions">▶ Continue mission: ' + esc(op.title) + '</a>' : '') + '</div>' + emblem(cat) + '</section>' +
        '<section class="s12 tiles" aria-label="Stats"><div class="tile"><span class="note">⚡ Total XP</span><b>' + fmt(x.tiles.totalXp) + '</b></div><div class="tile"><span class="note">🔥 Win streak</span><b>' + x.tiles.streakDays + ' ' + (x.tiles.streakDays === 1 ? 'day' : 'days') + '</b></div>' +
          '<div class="tile"><span class="note">🎯 Free ops cleared</span><b>' + x.tiles.labsCleared + ' / ' + x.tiles.freeLabsTotal + '</b></div>' +
          '<div class="tile ' + (s.plan === 'paid' ? '' : 'locked') + '"><span class="note">🏆 Campaigns won</span><b>' + x.tiles.campaignsWon + '</b>' + (s.plan === 'paid' ? '' : '<span class="lock chip a"><svg class="i"><use href="#i-lock"/></svg>Paid plan only</span>') + '</div></section>' +
        '<section class="card s6"><h3>Active operation</h3>' + (op ? '<div class="item"><div><span class="chip b">' + esc(op.code) + '</span> <b>' + esc(op.title) + '</b><p class="note">Started ' + new Date(op.startedAt).toLocaleDateString('en-IN') + '</p></div><a class="btn btn-sm btn-primary" href="#/academy/missions">Open</a></div>' : '<p class="note">No mission in progress. <a href="#/academy/missions">Pick one</a>.</p>') + '</section>' +
        '<section class="card s6"><h3>Daily patches <span class="note">Reset at midnight IST</span></h3>' + questList(true) + '</section>' +
        '<section class="card s12"><h3>Weekly field ops <span class="note">Ends in ' + endsAt(x.weekly.endsAt) + '</span></h3>' + fieldOps() + '</section>' +
        '<section class="card s4"><h3>Streak · last 28 days</h3><div class="cal">' + s.days.map(function (d) { return '<i class="' + (d ? 'on' : '') + '"></i>'; }).join('') + '</div><p class="note" style="margin-top:.6rem">Current ' + s.streak + ' · Longest ' + s.longest + (x.streak.graceEndsAt && !x.streak.todayCounts ? ' · keep it by ' + new Date(x.streak.graceEndsAt).toLocaleString('en-IN', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '') + '</p></section>' +
        '<section class="card s4"><h3>Power levels <a class="note" href="#/academy/career">Career path &gt;</a></h3>' + ['Offensive', 'Defensive', 'GRC'].map(function (k) { var v = me.scores[k] || 0; return '<div class="meter"><div class="row note"><span>' + k + (me.category === k ? ' · primary' : '') + '</span><span>' + v + '</span></div><div class="bar"><i class="' + k + '" style="width:' + v + '%"></i></div></div>'; }).join('') + '</section>' +
        '<section class="card s4"><h3>Weekly league</h3><div style="display:grid;gap:.3rem"><b style="font:700 1.4rem var(--f-display);color:var(--amber)">' + (DIV[x.league.division] || esc(x.league.division)) + (x.league.rank ? ' #' + x.league.rank : '') + '</b><span class="note">' + fmt(x.league.weekXp) + ' XP this week · Ends in ' + endsAt(x.league.endsAt) + '</span><a class="btn btn-sm" href="#/academy/leaderboard">Rankings</a></div></section>' +
        '<section class="card s6"><h3>Trophy case <span class="note">' + x.trophies.earned + ' of ' + x.trophies.total + ' earned</span></h3><div class="badges">' + x.trophies.items.map(function (t) { return '<span class="' + (t.earned ? '' : 'off') + '" title="' + esc(t.title) + (t.earned ? '' : ' (locked)') + '" aria-label="' + esc(t.title) + '">' + esc(t.icon) + '</span>'; }).join('') + '</div></section>' +
        '<section class="card s6"><h3>Recent victories</h3>' + (recent.length ? '<div class="list">' + recent.map(function (v) { return '<div class="item"><span>' + esc(v.title) + '</span><span class="mono" style="color:var(--amber)">+' + v.xp + ' XP</span></div>'; }).join('') + '</div>' : '<p class="note">No victories yet. Clear a lab to earn your first.</p>') + '</section>' +
        '<section class="card s12"><h3>Campaigns in the Cyber Arsenal <a class="note" href="#/courses">View all courses &gt;</a></h3><div class="courses" id="dCourses">' + liveCourses.slice(0, 4).map(courseCard).join('') + '</div>' +
          (s.plan === 'paid' ? '' : '<div class="item" style="margin-top:1rem"><span><b>Go Premium</b> <span class="note">Premium labs, courses and certificates</span></span><a class="btn btn-amber btn-sm" href="#/courses">See plans</a></div>') + '</section>' +
        '</div>';
      bindQuests();
      if (!liveCourses.length) get('/student/courses').then(function (c) { liveCourses = c.items; var el = $('#dCourses'); if (el) el.innerHTML = liveCourses.slice(0, 4).map(courseCard).join('') || '<p class="note">No courses published yet.</p>'; }, function () {});
    };
    myWeekRank = function () { return L.dash.league.rank || 0; };

    /* ---- leaderboard ---- */
    // OI-51: the weekly league in plain words, with the student's division ladder and where they stand this week.
    var ZONE = {
      promotion: ['g', '⬆ Promotion zone', 'You are in the top places. Keep it up to move up on Monday.'],
      safe: ['b', '● Safe', 'You stay in this division if the week ended now.'],
      demotion: ['r', '⬇ Demotion zone', 'Earn a little more XP this week to climb out before Monday.'],
      not_started: ['', 'Not started this week', 'Earn any XP this week to join the race in your division.'],
    };
    function leagueCard(b) {
      var L = b.league, z = ZONE[L.zone] || ZONE.safe;
      var ladder = L.divisions.map(function (d) { return '<span class="chip ' + (d.mine ? 'a' : '') + '" style="' + (d.mine ? 'font-weight:700' : 'opacity:.7') + '">' + (DIV[d.id] || esc(d.name)) + '</span>'; }).join('<span class="note">→</span>');
      var line = (L.promoteTop ? 'Top ' + L.promoteTop + ' move up' : 'Top division: nobody moves higher') + ' · ' + (L.demoteBottom ? 'bottom ' + L.demoteBottom + ' move down (only when more than ' + (L.promoteTop + L.demoteBottom) + ' are racing)' : 'nobody moves lower');
      return '<div class="card" style="margin-bottom:1rem;background:linear-gradient(135deg,rgba(255,176,0,.14),rgba(255,176,0,.02))">' +
        '<div class="row" style="flex-wrap:wrap;gap:.5rem"><b style="color:var(--amber)">' + (DIV[L.division] || esc(L.divisionName)) + ' League</b><span class="chip ' + z[0] + '">' + z[1] + '</span><span class="note">Ends in ' + endsAt(b.endsAt) + ' · ' + L.players + ' racing this week</span></div>' +
        '<p class="note" style="margin:.4rem 0">' + esc(z[2]) + ' ' + esc(line) + '.</p>' +
        '<div class="row" style="flex-wrap:wrap;gap:.3rem;align-items:center">' + ladder + '</div>' +
        '<details style="margin-top:.6rem"><summary class="note" style="cursor:pointer">How the league works</summary><ul class="note" style="margin:.4rem 0 0 1rem">' + L.guide.map(function (g) { return '<li>' + esc(g) + '</li>'; }).join('') + '</ul></details></div>';
    }
    vLeaderboard = function () {
      $('#view').innerHTML = '<p class="note">Loading rankings…</p>';
      get('/student/leaderboard?tab=' + lbTab).then(function (b) {
        var rows = b.rows, top = rows.slice(0, 3);
        $('#view').innerHTML = '<div class="row" style="flex-wrap:wrap"><h1>Hunter Rankings</h1><label class="note" style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" id="showMe" ' + (b.showOnBoard ? 'checked' : '') + '> Show me on leaderboard</label></div>' +
          '<div class="filters" role="tablist" style="margin-top:.8rem">' + [['week', 'This week'], ['all', 'All time'], ['college', 'My college']].map(function (t) { return '<button role="tab" aria-pressed="' + (t[0] === lbTab) + '" data-lb="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>' +
          (b.league ? leagueCard(b) : '') +
          (rows.length ? '<div class="podium2">' + [[top[1], 2], [top[0], 1], [top[2], 3]].map(function (z) { var r = z[0], n = z[1]; return r ? '<div class="pd pd' + n + ' ' + (r.me ? 'me' : '') + '"><div class="pd-av">' + esc(r.name[0]) + '</div><div class="pd-medal">' + ['', '🥇', '🥈', '🥉'][n] + '</div><b>' + esc(r.name) + '</b><span class="mono note">' + fmt(r.xp) + ' XP</span><div class="pd-base"><span>' + n + '</span></div></div>' : '<div></div>'; }).join('') + '</div>' : '') +
          '<div class="card">' + (rows.length ? '<table class="lb">' + rows.map(function (r) { return '<tr class="' + (r.me ? 'me' : '') + '"><td class="mono" style="width:3rem">#' + r.rank + '</td><td>' + esc(r.name) + '</td><td class="mono" style="text-align:right">' + fmt(r.xp) + ' XP</td></tr>'; }).join('') + '</table>' : '<p class="note">' + esc(b.tab === 'college' && !b.division && !rows.length && b.rule ? b.rule : 'No one has earned XP on this board yet.') + '</p>') +
          (b.me && b.me.rank > 50 ? '<p class="note">You are #' + b.me.rank + ' with ' + fmt(b.me.xp) + ' XP.</p>' : '') +
          '<p class="note" style="margin-top:.8rem">' + esc(b.rule) + '</p></div>';
        $$('[data-lb]').forEach(function (x) { x.addEventListener('click', function () { lbTab = x.dataset.lb; vLeaderboard(); }); });
        $('#showMe').addEventListener('change', function (e) { api.patch('/me', { showOnBoard: e.target.checked }).then(function () { sp.showOnBoard = e.target.checked; vLeaderboard(); }, function (er) { toast(errMsg(er)); e.target.checked = !e.target.checked; }); });
      }, function (e) { $('#view').innerHTML = '<p class="note">' + esc(errMsg(e)) + '</p>'; });
    };

    /* ---- missions: the server catalog; XP and hint charges only through the server ---- */
    var CAT = function (c) { return c === 'Foundations' ? 'p' : catChip(c); };
    drawMissions = function () {
      var q = mSearch.toLowerCase(), list = L.missions.items.filter(function (m) { return (mFilter === 'All' || m.category === mFilter) && (!q || (m.title + m.description + m.code).toLowerCase().indexOf(q) >= 0); });
      var ST = { cleared: ['Cleared', 'g'], in_progress: ['In progress', 'b'], locked: ['Locked', 'a'], available: ['', ''] };
      $('#mGridLive').innerHTML = list.map(function (m) {
        var st = ST[m.state] || ['', ''];
        return '<div class="mission ' + (m.state === 'cleared' ? 'cleared' : '') + '" data-mid="' + esc(m.code) + '" data-cat="' + esc(m.category) + '"><div class="row"><span class="chip ' + CAT(m.category) + '">' + esc(m.code) + '</span>' + (st[0] ? '<span class="chip ' + st[1] + '">' + st[0] + '</span>' : m.category === me.category ? '<span class="chip g">Recommended</span>' : '') + (m.premium ? '<span class="chip a">Premium</span>' : '') + '</div>' +
          '<b>' + esc(m.title) + '</b><span class="note">' + esc(m.description || '') + '</span><div class="row note"><span>' + esc(m.difficulty || '') + (m.estMinutes ? ' · ' + esc(m.estMinutes) + ' min' : '') + '</span><span class="mono" style="color:var(--amber)">' + (m.state === 'cleared' ? 'Replay 0 XP' : '+' + m.xp + ' XP') + '</span></div>' +
          '<button class="btn btn-sm ' + (m.state === 'cleared' ? '' : 'btn-primary') + '" data-open-mission="' + esc(m.code) + '" ' + (m.state === 'locked' ? 'disabled' : '') + '>' + (m.state === 'cleared' ? 'Details' : m.state === 'in_progress' ? '▶ Resume' : m.state === 'locked' ? (m.lockedReason === 'premium' ? 'Paid plan only' : 'Clear earlier missions') : '▶ Deploy') + '</button></div>';
      }).join('') || '<p class="note">No missions match.</p>';
      bindMissionOpeners();
      // Practice missions (owner, 24 Oct): the in-browser engines stay playable as a demo until the mission service is
      // linked server to server. They talk to mission-api only; nothing they do reaches the XP ledger, streak or league.
      var demo = $('#mGrid'); if (demo) { demo.innerHTML = ''; if (window.M1) [window.M1, window.M2, window.M3, window.M4, window.M5, window.M6, window.M7, window.M8, window.M9].forEach(function (m) { if (m) m.card(); }); }
    };
    var DEMO_CHIP = '<span class="chip a" data-demo-chip>Demo — XP not saved</span>';
    new MutationObserver(function () {
      $$('#mGrid > .mission').forEach(function (c) { var r = c.querySelector('.row'); if (r && !r.querySelector('[data-demo-chip]')) r.insertAdjacentHTML('beforeend', DEMO_CHIP); });
    }).observe(document.getElementById('view'), { childList: true, subtree: true });
    var demoToast = toast;
    toast = function (m) { return demoToast(/^#\/academy\/mission\//.test(location.hash) && /XP/.test(m) ? m + ' (demo, not saved)' : m); };
    ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9'].forEach(function (k) {
      var m = window[k]; if (!m || !m.view) return;
      var v = m.view;
      m.view = function () { var r = v.apply(this, arguments); var el = $('#view'); if (el && !el.querySelector('[data-demo-banner]')) el.insertAdjacentHTML('afterbegin', '<div class="card" data-demo-banner style="border-color:var(--amber);margin-bottom:1rem"><b>Practice mission (demo).</b> <span class="note">XP shown here is not saved to your Academy XP, streak, daily patches or league until the mission service is linked to the Academy server.</span></div>'); return r; };
    });
    vMissions = function () {
      var off = !L.missions.providerAvailable && L.missions.items.some(function (m) { return m.provider !== 'native'; });
      $('#view').innerHTML = '<div class="row" style="flex-wrap:wrap;margin-bottom:.4rem"><div><h1>Incident Response</h1><p class="note">Drop into safe, isolated cyber ranges. XP is paid once, after the server verifies your answer.</p></div><span class="pathbadge ' + (path() === 'Foundations' ? 'GRC' : path()) + '">Your path: ' + esc(PATHS[path()]) + '</span></div>' +
        (off ? '<div class="card" style="border-color:var(--amber)"><b>Mission service offline.</b> <span class="note">The lab service that runs these missions is not connected to the Academy server yet, so missions cannot be started from here. Your XP, streak and hints are safe.</span></div>' : '') +
        '<div class="filters" role="group" aria-label="Filter missions">' + ['All', 'Foundations', 'Offensive', 'Defensive', 'GRC'].map(function (f) { return '<button aria-pressed="' + (f === mFilter) + '" data-f="' + f + '">' + f + '</button>'; }).join('') +
        '<span style="margin-left:auto;display:flex;align-items:center;gap:.4rem"><svg class="i"><use href="#i-search"/></svg><input id="mSearch" placeholder="Search missions" aria-label="Search missions" value="' + esc(mSearch) + '"></span></div><div class="missions" id="mGridLive"></div>' +
        '<h2 style="margin-top:1.4rem">Practice missions <span class="chip a">Demo — XP not saved</span></h2><p class="note">Playable practice labs. Their XP is not added to your Academy XP, streak, daily patches or league yet.</p><div class="missions" id="mGrid"></div>';
      $$('[data-f]').forEach(function (b) { b.addEventListener('click', function () { mFilter = b.dataset.f; vMissions(); }); });
      $('#mSearch').addEventListener('input', function (e) { mSearch = e.target.value; drawMissions(); });
      drawMissions();
    };
    openMission = function (code) {
      var ov = modal('<p class="note">Loading mission…</p>');
      var draw = function (m) {
        var h = m.hints, cleared = m.state === 'cleared', active = !!m.attempt;
        var cost = h.nextCostPct === null ? null : h.basis === 'total_xp' ? Math.round(me.stats.xp * h.nextCostPct / 100) + ' XP now (' + h.nextCostPct + '% of your total XP)' : h.nextCostPct + '% of this mission’s reward (' + Math.round(m.xp * h.nextCostPct / 100) + ' XP less when you clear it)';
        ov.querySelector('.modal').innerHTML = '<div class="row"><span class="chip ' + CAT(m.category) + '">' + esc(m.code) + ' · ' + esc(m.category) + '</span><button class="btn btn-sm" data-close>Close</button></div><h2>' + esc(m.title) + '</h2><p class="note">' + esc(m.description || '') + '</p>' +
          '<div class="list"><div class="item"><span>Reward</span><span class="mono" style="color:var(--amber)">' + (cleared ? 'Cleared · replay 0 XP' : '+' + h.rewardIfClearedNow + ' XP' + (h.rewardIfClearedNow < m.xp ? ' (after hints)' : '')) + '</span></div>' +
          (active ? '<div class="item"><span>Attempt</span><span class="note">' + m.attempt.submissions + (m.attempt.maxSubmissions ? ' of ' + m.attempt.maxSubmissions : '') + ' answers sent</span></div>' : '') + '</div>' +
          '<h3 style="margin-top:.8rem">Hints <span class="note">' + h.used.length + ' of ' + Math.min(3, h.available) + ' used</span></h3>' +
          (h.used.length ? '<div class="list">' + h.used.map(function (x) { return '<div class="item" style="display:grid;gap:.2rem"><b>Hint ' + x.n + '</b><span>' + esc(x.text) + '</span><span class="note">Cost ' + x.pct + '%' + (x.xpCost ? ' · −' + x.xpCost + ' XP' : ' of the reward') + '</span></div>'; }).join('') + '</div>' : '<p class="note">' + (h.available ? 'Up to 3 hints. Hint 1 costs 5%, hint 2 costs 10%, hint 3 costs 15%.' : 'This mission has no hints.') + '</p>') +
          (!cleared && active && cost ? '<button class="btn btn-sm" id="mHint">Reveal hint ' + (h.used.length + 1) + ' · costs ' + esc(cost) + '</button>' : '') +
          (!cleared && active && m.provider === 'native' ? '<form id="mF" class="row" style="margin-top:.8rem"><input name="f" placeholder="Your answer or flag" aria-label="Answer" style="flex:1" maxlength="200"><button class="btn btn-primary btn-sm">Submit</button></form>' : '') +
          '<p class="note" id="mErr" style="color:var(--red)"></p>' +
          (!cleared && !active ? '<button class="btn btn-primary" id="mStart">▶ Deploy</button>' : '') +
          '<p class="note">Labs run in a sandbox with no internet. XP is paid once, from a verified answer. Replays give 0 XP. A hint is charged once and is not refunded by a retry.</p>';
        var err = function (e) { $('#mErr', ov).textContent = errMsg(e); };
        var st = $('#mStart', ov); if (st) st.addEventListener('click', function () { st.disabled = true; post('/student/missions/' + encodeURIComponent(code) + '/attempts').then(reload, function (e) { st.disabled = false; err(e); }); });
        var hb = $('#mHint', ov); if (hb) hb.addEventListener('click', function () {
          if (!confirm('Reveal hint ' + (h.used.length + 1) + '? It costs ' + cost + '.')) return;
          hb.disabled = true; post('/student/missions/' + encodeURIComponent(code) + '/hints').then(function (r) { toast('Hint ' + r.n + ' revealed' + (r.xpCost ? ': −' + r.xpCost + ' XP' : '')); refresh().then(renderHeader); reload(); }, function (e) { hb.disabled = false; err(e); });
        });
        var f = $('#mF', ov); if (f) f.addEventListener('submit', function (e) {
          e.preventDefault(); var v = f.f.value.trim(); if (!v) return;
          post('/student/missions/' + encodeURIComponent(code) + '/submit', { flag: v }).then(function (r) {
            ov.remove(); toast('Objective cleared' + (r.xp ? ': +' + r.xp + ' XP' : ' (replay, 0 XP)')); rerender();
          }, function (e2) { err(e2); if (e2.status === 422) reload(); });
        });
      };
      var reload = function () { get('/student/missions/' + encodeURIComponent(code)).then(draw, function (e) { ov.querySelector('.modal').innerHTML = '<p class="note">' + esc(errMsg(e)) + '</p><button class="btn btn-sm" data-close>Close</button>'; }); };
      reload();
    };

    /* ---- Labs (24 Oct): server-verified steps. Cards → lab page (#/academy/lab/<code>) with briefing, step checklist,
       quiz or answer, hints with their cost shown first, and an honest lab-environment panel. Only labs whose flag is
       still checked by the separate lab service keep a "Demo — XP not saved" practice card. ---- */
    var LAB_DEMO = { 'INFO-01': 'M4', 'DIR-01': 'M8', 'IMG-01': 'M9' }; // per-session flags: demo until the lab service is linked
    var LESSON_OF = { 'INT-01': 'M1', 'REC-01': 'M2' };
    var STATE = { cleared: ['Cleared', 'g'], in_progress: ['In progress', 'b'], locked: ['Locked', 'a'], available: ['Available', ''] };
    var labDetails = {};
    var labCard = function (m) {
      var d = labDetails[m.code], st = STATE[m.state] || ['', ''];
      var steps = d ? d.steps : [], done = steps.filter(function (s) { return s.done; }).length;
      var hints = d ? d.hints.used.length : 0, hmax = d ? Math.min(3, d.hints.available) : 0;
      return '<div class="mission ' + (m.state === 'cleared' ? 'cleared' : '') + '" data-cat="' + esc(m.category) + '"><div class="row"><span class="chip ' + CAT(m.category) + '">' + esc(m.code) + '</span><span class="chip ' + st[1] + '">' + st[0] + '</span>' + (m.premium ? '<span class="chip a">Premium</span>' : '') + '</div>' +
        '<b>' + esc(m.title) + '</b><span class="note">' + esc(m.description || '') + '</span>' +
        '<div class="row note"><span>' + esc(m.difficulty || '') + (m.estMinutes ? ' · ' + esc(m.estMinutes) + ' min' : '') + '</span><span class="mono" style="color:var(--amber)">' + (m.state === 'cleared' ? 'Cleared' : '+' + m.xp + ' XP') + '</span></div>' +
        (steps.length ? '<div class="bar" aria-label="Steps done"><i style="width:' + Math.round(100 * done / steps.length) + '%"></i></div><div class="row note"><span>Steps ' + done + '/' + steps.length + '</span><span>' + (hmax ? 'Hints ' + hints + '/' + hmax : 'No hints') + '</span></div>' : '') +
        (m.provider !== 'native' ? '<span class="note">' + (m.serviceAvailable ? 'Live lab environment' : 'Lab environment offline · answers still checked') + '</span>' : '') +
        '<a class="btn btn-sm ' + (m.state === 'cleared' ? '' : 'btn-primary') + '" href="#/academy/lab/' + encodeURIComponent(m.code) + '"' + (m.state === 'locked' ? ' aria-disabled="true"' : '') + '>' + (m.state === 'cleared' ? 'Review' : m.state === 'in_progress' ? '▶ Continue' : m.state === 'locked' ? (m.lockedReason === 'premium' ? 'Paid plan only' : 'Clear earlier labs') : '▶ Open lab') + '</a></div>';
    };
    drawMissions = function () {
      var q = mSearch.toLowerCase(), list = L.missions.items.filter(function (m) { return (mFilter === 'All' || m.category === mFilter) && (!q || (m.title + m.description + m.code).toLowerCase().indexOf(q) >= 0); });
      $('#mGridLive').innerHTML = list.map(labCard).join('') || '<p class="note">No labs match.</p>';
      // practice cards only while the lab service is not linked; once it is, every lab is checked by the server
      var demo = $('#mGrid'), linked = L.missions.providerAvailable; $$('[data-practice]').forEach(function (x) { x.hidden = linked; });
      if (demo && !linked) { demo.innerHTML = ''; Object.keys(LAB_DEMO).forEach(function (c) { var mm = window[LAB_DEMO[c]]; if (mm) mm.card(); }); }
    };
    vMissions = function () {
      $('#view').innerHTML = '<div class="row" style="flex-wrap:wrap;margin-bottom:.4rem"><div><h1>Incident Response</h1><p class="note">Labs in safe, isolated ranges. Every answer is checked on the server and XP is paid once per step.</p></div><span class="pathbadge ' + (path() === 'Foundations' ? 'GRC' : path()) + '">Your path: ' + esc(PATHS[path()]) + '</span></div>' +
        '<div class="filters" role="group" aria-label="Filter labs">' + ['All', 'Foundations', 'Offensive', 'Defensive', 'GRC'].map(function (f) { return '<button aria-pressed="' + (f === mFilter) + '" data-f="' + f + '">' + f + '</button>'; }).join('') +
        '<span style="margin-left:auto;display:flex;align-items:center;gap:.4rem"><svg class="i"><use href="#i-search"/></svg><input id="mSearch" placeholder="Search labs" aria-label="Search labs" value="' + esc(mSearch) + '"></span></div>' +
        '<div class="missions" id="mGridLive"><p class="note">Loading labs…</p></div>' +
        '<h2 data-practice style="margin-top:1.4rem">Practice labs <span class="chip a">Demo — XP not saved</span></h2><p data-practice class="note">These three hide a different flag for every student, which only the lab service can check. Until it is linked to the Academy server they run as practice: their XP is not added to your Academy XP, streak, daily patches or league.</p><div class="missions" id="mGrid" data-practice></div>';
      $$('[data-f]').forEach(function (b) { b.addEventListener('click', function () { mFilter = b.dataset.f; vMissions(); }); });
      $('#mSearch').addEventListener('input', function (e) { mSearch = e.target.value; drawMissions(); });
      Promise.all(L.missions.items.map(function (m) { return get('/student/missions/' + encodeURIComponent(m.code)).then(function (d) { labDetails[m.code] = d; }, function () {}); })).then(drawMissions);
    };
    openMission = function (code) { location.hash = '#/academy/lab/' + encodeURIComponent(code); };

    var vLab = function (code) {
      $('#view').innerHTML = '<p class="note">Loading lab…</p>';
      get('/student/missions/' + encodeURIComponent(code)).then(function (m) {
        labDetails[code] = m;
        if (m.provider === 'native') return drawLab(m, null);
        return get('/student/missions/' + encodeURIComponent(code) + '/lab').then(function (env) { drawLab(m, env); }, function () { drawLab(m, { available: false, status: 'offline' }); });
      }, function (e) { $('#view').innerHTML = '<p class="note">' + esc(errMsg(e)) + '</p><a class="btn btn-sm" href="#/academy/missions">← All labs</a>'; });
    };
    var labUrlText = '&lt;your lab URL&gt;';
    var bodyHtml = function (text) { return esc(text).replace(/\{LAB_URL\}/g, function () { return labUrlText; }).split(/\n\s*\n/).map(function (p) { return /^\d+\. /m.test(p) ? '<ol style="display:grid;gap:.35rem;padding-left:1.2rem">' + p.split('\n').map(function (l) { return '<li>' + l.replace(/^\d+\. /, '') + '</li>'; }).join('') + '</ol>' : '<p>' + p.replace(/\n/g, '<br>') + '</p>'; }).join(''); };
    var drawLab = function (m, env) {
      var code = m.code;
      labUrlText = env && env.status === 'active' && env.url ? '<code>' + esc(env.url) + '</code>' : '&lt;your lab URL&gt;';
      var steps = m.steps, done = steps.filter(function (s) { return s.done; }).length, active = !!m.attempt, cleared = m.state === 'cleared';
      var next = steps.find(function (s) { return !s.done; });
      var h = m.hints, hmax = Math.min(3, h.available);
      var cost = h.nextCostPct === null ? null : h.basis === 'total_xp' ? Math.round(me.stats.xp * h.nextCostPct / 100) + ' XP now (' + h.nextCostPct + '% of your total XP)' : h.nextCostPct + '% of this lab’s remaining reward';
      var stepIcon = function (s) { return s.done ? '✅' : s === next && active ? '▶' : '⬜'; };
      var lesson = LESSON_OF[code] && window[LESSON_OF[code]] && window[LESSON_OF[code]].LESSON;
      var stepPanel = function (s) {
        if (!active && !s.done) return '';
        if (s.kind === 'read') {
          var content = lesson ? lesson.map(function (sec) { return '<details class="item" style="display:block"><summary><b>' + esc(sec[0]) + '</b></summary><div style="margin-top:.5rem">' + sec[1] + '</div></details>'; }).join('') : bodyHtml(s.body);
          return '<div class="list">' + content + '</div>' + (s.done ? '<p class="note">✅ Read' + (s.xpAwarded ? ' · +' + s.xpAwarded + ' XP' : '') + '</p>' : '<button class="btn btn-primary btn-sm" data-read="' + s.n + '">I have read this' + (s.xp ? ' · +' + s.xp + ' XP' : '') + '</button>');
        }
        if (s.kind === 'quiz') {
          return (s.done ? '<p class="note">Scored attempt: ' + s.score + '/' + s.maxScore + ' · +' + (s.xpAwarded || 0) + ' XP. You can practise again (no XP).</p>' : '<p class="note">' + s.perCorrectXp + ' XP for each correct answer on your first attempt.</p>') +
            '<form id="lq' + s.n + '" style="display:grid;gap:.7rem">' + s.questions.map(function (q, i) { return '<fieldset class="item" style="display:grid;gap:.3rem"><legend><b>' + (i + 1) + '. ' + esc(q.prompt) + '</b></legend>' + q.options.map(function (o, k) { return '<label class="note" style="display:flex;gap:.4rem"><input type="radio" name="' + esc(q.id) + '" value="' + k + '"> ' + esc(o) + '</label>'; }).join('') + '<span class="note" data-res="' + esc(q.id) + '"></span></fieldset>'; }).join('') +
            '<button class="btn btn-primary btn-sm">' + (s.done ? 'Check again (practice)' : 'Submit answers') + '</button></form>';
        }
        return s.done ? '<p class="note">✅ Accepted' + (s.xpAwarded ? ' · +' + s.xpAwarded + ' XP' : '') + '</p>' :
          '<form id="la' + s.n + '" class="row" style="gap:.5rem"><input name="a" placeholder="' + esc(s.placeholder || 'Your answer') + '" aria-label="' + esc(s.title) + '" style="flex:1" maxlength="500"><button class="btn btn-primary btn-sm">Submit</button></form>' +
          (s.answerFormat === 'session_flag' ? '<p class="note">Each student gets their own flag, checked by the lab service.</p>' : '') + (s.tries ? '<p class="note">' + s.tries + ' wrong ' + (s.tries === 1 ? 'try' : 'tries') + ' so far.</p>' : '');
      };
      $('#view').innerHTML = '<div class="grid g12"><section class="card s12 hero"><div><a class="note" href="#/academy/missions">← All labs</a><span class="callsign" style="display:block;margin-top:.4rem">' + esc(m.code) + ' // ' + esc(m.category.toUpperCase()) + ' // ' + esc((m.difficulty || '').toUpperCase()) + '</span><h1>' + esc(m.title) + '</h1><p class="note">' + esc(m.description || '') + '</p>' +
          '<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.5rem"><span class="chip ' + (STATE[m.state] || ['', ''])[1] + '">' + (STATE[m.state] || [m.state])[0] + '</span><span class="chip">' + (cleared ? 'Replay pays 0 XP' : 'Reward now +' + h.rewardIfClearedNow + ' XP') + '</span>' + (m.estMinutes ? '<span class="chip">' + esc(m.estMinutes) + ' min</span>' : '') + '</div></div>' +
          '<div style="min-width:min(280px,100%)"><div class="row note"><span>Progress</span><span>' + done + '/' + steps.length + ' steps</span></div><div class="bar" style="margin:.35rem 0 .8rem"><i style="width:' + Math.round(100 * done / Math.max(1, steps.length)) + '%"></i></div>' +
          (active ? '' : m.state === 'locked' ? '<p class="note">' + (m.lockedReason === 'premium' ? 'This lab needs the paid plan.' : 'Clear the earlier labs first.') + '</p>' : '<button class="btn btn-primary" id="labStart">' + (cleared ? '↻ Replay (0 XP)' : done ? '▶ Continue' : '▶ Start lab') + '</button>') + '</div></section>' +
        '<section class="card s8"><h3>Steps</h3><div class="list">' + steps.map(function (s) { return '<div class="item" style="display:block"><div class="row"><b>' + stepIcon(s) + ' Step ' + s.n + ': ' + esc(s.title) + '</b><span class="mono note">' + (s.done ? (s.xpAwarded ? '+' + s.xpAwarded + ' XP' : 'Done') : s.xp ? '+' + s.xp + ' XP' : '') + '</span></div><div style="margin-top:.6rem">' + stepPanel(s) + '</div></div>'; }).join('') + '</div><p class="note" id="labErr" style="color:var(--red)"></p></section>' +
        '<aside class="s4" style="display:grid;gap:1rem;align-content:start">' +
          (m.provider !== 'native' ? '<section class="card"><h3>Lab environment</h3>' + (!env || !env.available ? '<p class="note">Offline: the live lab service is not connected to the Academy server yet, so your own target cannot be started from here. Your answers are still checked on the server.</p>' :
            env.status === 'active' ? '<p><span class="chip g">Running</span></p><p class="note">Your own target: <a href="' + esc(env.url) + '" target="_blank" rel="noopener noreferrer">' + esc(env.url) + '</a></p><div class="row" style="justify-content:flex-start;gap:.5rem"><a class="btn btn-primary btn-sm" href="' + esc(env.url) + '" target="_blank" rel="noopener noreferrer">Open target</a><button class="btn btn-sm" id="labStop">Stop lab</button></div><p class="note">Idle labs stop on their own after 30 minutes.</p>' :
            (active ? '<p class="note">Start your own isolated target. It gets its own address and a flag only you can find.</p><button class="btn btn-primary btn-sm" id="labEnv">▶ Start lab environment</button>' : '<p class="note">Start the lab first.</p>')) + '</section>' : '') +
          '<section class="card"><h3>Hints <span class="note">' + h.used.length + '/' + hmax + '</span></h3>' +
            (h.used.length ? '<div class="list">' + h.used.map(function (x) { return '<div class="item" style="display:grid;gap:.2rem"><b>Hint ' + x.n + '</b><span>' + esc(x.text) + '</span><span class="note">Cost ' + x.pct + '%' + (x.xpCost ? ' · −' + x.xpCost + ' XP' : ' of the reward') + '</span></div>'; }).join('') + '</div>' : '') +
            (hmax ? (!cleared && active && cost ? '<button class="btn btn-sm" id="labHint">Reveal hint ' + (h.used.length + 1) + '…</button>' : '<p class="note">' + (cleared ? 'Lab cleared.' : !active ? 'Start the lab to use hints.' : 'No hints left.') + '</p>') + '<p class="note">Hint 1 costs 5%, hint 2 costs 10%, hint 3 costs 15%. A hint is charged once.</p>' : '<p class="note">This lab has no hints.</p>') + '</section></aside></div>';
      var err = function (e) { $('#labErr').textContent = errMsg(e); };
      var after = function (r, msg) { toast(msg); if (r && r.cleared) toast('Lab cleared!'); refresh().then(renderHeader, function () {}); vLab(code); };
      var st = $('#labStart'); if (st) st.addEventListener('click', function () { st.disabled = true; post('/student/missions/' + encodeURIComponent(code) + '/attempts').then(function () { vLab(code); }, function (e) { st.disabled = false; err(e); }); });
      $$('[data-read]').forEach(function (b) { b.addEventListener('click', function () { b.disabled = true; post('/student/missions/' + encodeURIComponent(code) + '/steps/' + b.dataset.read + '/read').then(function (r) { after(r, r.xp ? 'Step done: +' + r.xp + ' XP' : 'Step done'); }, function (e) { b.disabled = false; err(e); }); }); });
      steps.forEach(function (s) {
        var qf = $('#lq' + s.n); if (qf) qf.addEventListener('submit', function (e) {
          e.preventDefault(); var ans = s.questions.map(function (q) { var c = qf.querySelector('input[name="' + q.id + '"]:checked'); return c ? +c.value : -1; });
          if (ans.indexOf(-1) >= 0) return err({ message: 'Answer every question first.' });
          post('/student/missions/' + encodeURIComponent(code) + '/steps/' + s.n + '/quiz', { answers: ans }).then(function (r) {
            if (r.scored) return after(r, 'Score ' + r.score + '/' + r.total + (r.xp ? ': +' + r.xp + ' XP' : ''));
            r.correct.forEach(function (ok, i) { var el = qf.querySelector('[data-res="' + s.questions[i].id + '"]'); if (el) el.textContent = ok ? '✅ Correct' : '❌ Not quite'; });
            toast('Practice: ' + r.score + '/' + r.total + ' (no XP)');
          }, err);
        });
        var af = $('#la' + s.n); if (af) af.addEventListener('submit', function (e) {
          e.preventDefault(); var v = af.a.value.trim(); if (!v) return;
          post('/student/missions/' + encodeURIComponent(code) + '/steps/' + s.n + '/answer', { answer: v }).then(function (r) { after(r, 'Correct' + (r.xp ? ': +' + r.xp + ' XP' : '')); }, function (e2) { err(e2); if (e2.status === 422 && e2.problem && e2.problem.code === 'WRONG_ANSWER') setTimeout(function () { vLab(code); }, 1200); });
        });
      });
      var le = $('#labEnv'); if (le) le.addEventListener('click', function () { le.disabled = true; le.textContent = 'Starting…'; post('/student/missions/' + encodeURIComponent(code) + '/lab/start').then(function () { toast('Lab environment running'); vLab(code); }, function (e) { le.disabled = false; le.textContent = '▶ Start lab environment'; err(e); }); });
      var ls = $('#labStop'); if (ls) ls.addEventListener('click', function () { ls.disabled = true; post('/student/missions/' + encodeURIComponent(code) + '/lab/stop').then(function () { toast('Lab stopped'); vLab(code); }, function (e) { ls.disabled = false; err(e); }); });
      var hb = $('#labHint'); if (hb) hb.addEventListener('click', function () {
        var ov = modal('<h2>Reveal hint ' + (h.used.length + 1) + '?</h2><p>It costs <b>' + esc(cost) + '</b>.</p><p class="note">The cost is charged once and is not refunded by a retry.</p><div class="row" style="justify-content:flex-start;gap:.5rem"><button class="btn btn-primary btn-sm" id="hOk">Reveal hint</button><button class="btn btn-sm" data-close>Cancel</button></div>');
        $('#hOk', ov).addEventListener('click', function () { this.disabled = true; post('/student/missions/' + encodeURIComponent(code) + '/hints').then(function (r) { ov.remove(); after(null, 'Hint ' + r.n + ' revealed' + (r.xpCost ? ': −' + r.xpCost + ' XP' : '')); }, function (e) { ov.remove(); err(e); }); });
      });
    };
    window.YojoAcademyLive.lab = vLab;

    /* ---- Intel: published blogs, reactions, comments, own drafts sent for review ---- */
    var blogCard = function (b) { return { id: b.slug, t: b.title, a: b.author, m: b.readingMinutes, likes: b.reactions, views: b.views, comments: b.comments, body: [b.excerpt], at: new Date(b.publishedAt) }; };
    var feed = [], tops = [], mine = [];
    vLore = function (id) {
      if (id) return readBlog(id);
      $('#view').innerHTML = '<p class="note">Loading Intel…</p>';
      Promise.all([get('/intel/blogs?limit=50'), get('/intel/blogs/top'), get('/student/blogs')]).then(function (x) {
        feed = x[0].items.map(blogCard); tops = x[1].items.map(blogCard); mine = x[2];
        $('#view').innerHTML = '<div class="bl-wrap"><div class="bl-main"><h1>Intel</h1><p class="note">Blogs written by fellow agents about what they learned.</p>' +
          '<div class="bl-search"><svg class="i"><use href="#i-search"/></svg><input id="lvQ" placeholder="Search blogs by name" aria-label="Search blogs by name" value="' + esc(lvQ) + '"></div><div id="lvList" class="bl-feed"></div></div>' +
          '<aside class="bl-side"><h3>Top blogs</h3><ol class="bl-top">' + tops.map(function (b, i) { return '<li><span class="bl-n">0' + (i + 1) + '</span><a href="#/academy/lore-vault/' + encodeURIComponent(b.id) + '"><span class="bl-au"><i>' + esc(b.a[0]) + '</i>' + esc(b.a) + '</span><b>' + esc(b.t) + '</b>' + blogStats(b) + '</a></li>'; }).join('') + '</ol>' +
          '<div class="bl-write"><b>Share what you learned</b><p class="note">Every blog is checked by an admin before it goes live.</p><div class="row" style="justify-content:flex-start"><button class="btn btn-primary btn-sm" id="forge">Write a blog</button><button class="btn btn-sm" id="mine">My blogs (' + mine.length + ')</button></div></div></aside></div>';
        $('#lvQ').addEventListener('input', function (e) { lvQ = e.target.value; drawLore(); });
        $('#forge').addEventListener('click', function () { forgeScroll(); }); $('#mine').addEventListener('click', myScrolls);
        drawLore();
      }, function (e) { $('#view').innerHTML = '<p class="note">' + esc(errMsg(e)) + '</p>'; });
    };
    drawLore = function () {
      var q = lvQ.trim().toLowerCase(), l = feed.filter(function (b) { return !q || b.t.toLowerCase().indexOf(q) >= 0; });
      $('#lvList').innerHTML = l.map(function (b) { return '<article class="bl-card"><a href="#/academy/lore-vault/' + encodeURIComponent(b.id) + '"><span class="bl-au"><i>' + esc(b.a[0]) + '</i>' + esc(b.a) + ' · ' + blogDate(b.at) + '</span><h2>' + esc(b.t) + '</h2><p class="note">' + esc(b.body[0]) + '</p><span class="bl-meta"><span class="note">' + b.m + ' min read</span>' + blogStats(b) + '</span></a></article>'; }).join('') ||
        '<p class="note">' + (feed.length ? 'No blogs match “' + esc(lvQ) + '”.' : 'No blogs published yet. Be the first to write one.') + '</p>';
    };
    readBlog = function (slug) {
      $('#subnav').hidden = true; $('#view').innerHTML = '<p class="note">Loading…</p>';
      get('/intel/blogs/' + encodeURIComponent(slug)).then(function (b) {
        $('#view').innerHTML = '<article class="bl-read"><a class="note bl-back" href="#/academy/lore-vault">← All blogs</a><h1>' + esc(b.title) + '</h1>' +
          '<div class="bl-by"><i>' + esc(b.author[0]) + '</i><span><b>' + esc(b.author) + '</b><span class="note">' + b.readingMinutes + ' min read · ' + blogDate(new Date(b.publishedAt)) + '</span></span></div>' +
          '<div class="bl-bar">' + blogStats({ likes: b.reactions, views: b.views, comments: b.comments }) + '<button class="btn btn-sm ' + (b.reacted ? '' : 'btn-primary') + '" id="blLike">' + (b.reacted ? '👏 Liked' : '👏 Like') + '</button><button class="btn btn-sm" id="blRep">Report</button></div>' +
          '<div class="bl-body">' + b.body.split(/\n\s*\n/).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</div>' +
          '<section class="bl-comments"><h3>Comments (' + b.comments.length + ')</h3><form id="blC" class="row"><input name="c" placeholder="Add a comment" aria-label="Add a comment" style="flex:1" maxlength="1000"><button class="btn btn-sm btn-primary">Post</button></form>' +
          '<div class="list" style="margin-top:.8rem">' + b.comments.map(function (c) { return '<div class="item" style="display:grid;gap:.2rem"><b>' + esc(c.author) + '</b><span class="note">' + esc(c.body) + '</span></div>'; }).join('') + '</div></section></article>';
        refresh().then(renderHeader, function () {}); // the "read a blog" patch is recorded by the server
        $('#blLike').addEventListener('click', function () { (b.reacted ? del('/intel/blogs/' + b.id + '/reaction') : put('/intel/blogs/' + b.id + '/reaction')).then(function () { readBlog(slug); }, function (e) { toast(errMsg(e)); }); });
        $('#blRep').addEventListener('click', function () { var r = prompt('What is wrong with this blog? (at least 5 characters)'); if (!r) return; post('/intel/reports', { blogId: b.id, reason: r }).then(function () { toast('Reported. An admin will check it.'); }, function (e) { toast(errMsg(e)); }); });
        $('#blC').addEventListener('submit', function (e) { e.preventDefault(); var t = e.target.c.value.trim(); if (!t) return; post('/intel/blogs/' + b.id + '/comments', { body: t }).then(function () { readBlog(slug); }, function (er) { toast(errMsg(er)); }); });
      }, function () { location.hash = '#/academy/lore-vault'; });
    };
    forgeScroll = function (draft) {
      var ov = modal('<div class="row"><h2>' + (draft ? 'Edit your blog' : 'Write a blog') + '</h2><span class="chip">' + (draft ? esc(draft.status.replace('_', ' ')) : 'Draft') + '</span></div>' + (draft && draft.reviewNote ? '<p class="note">Reviewer: ' + esc(draft.reviewNote) + '</p>' : '') +
        '<form id="fs" style="display:grid;gap:.7rem" novalidate><input name="t" placeholder="Title" aria-label="Title" maxlength="150" value="' + esc(draft ? draft.title : '') + '"><textarea name="b" rows="9" placeholder="Write your blog... Leave a blank line between paragraphs." aria-label="Body"></textarea>' +
        '<label class="note" style="display:flex;gap:.5rem"><input type="checkbox" name="own"> This is my own work and has no lab flags or private data.</label><p id="fsErr" class="note" style="color:var(--red)"></p>' +
        '<div class="row"><button type="button" class="btn btn-sm" data-close>Cancel</button><button type="button" class="btn btn-sm" id="fsSave">Save draft</button><button class="btn btn-primary btn-sm">Send for review</button></div></form>');
      if (draft) ov.querySelector('textarea[name=b]').value = draft.body || '';
      var id = draft ? draft.id : null;
      var save = function (f) {
        var body = { title: f.t.value.trim(), body: f.b.value.trim() };
        if (!body.title || !body.body) return Promise.reject({ message: 'Add a title and the text of your blog.' });
        return (id ? api.patch('/student/blogs/' + id, body) : post('/student/blogs', body)).then(function (r) { id = r.id || id; return id; });
      };
      var f = $('#fs', ov);
      $('#fsSave', ov).addEventListener('click', function () { save(f).then(function () { ov.remove(); toast('Draft saved.'); vLore(); }, function (e) { $('#fsErr', ov).textContent = errMsg(e); }); });
      f.addEventListener('submit', function (e) {
        e.preventDefault(); if (!f.own.checked) return ($('#fsErr', ov).textContent = 'Confirm this is your own work.');
        save(f).then(function (bid) { return post('/student/blogs/' + bid + '/submit', { ownWork: true }); }).then(function () { ov.remove(); toast('Sent for review. An admin will check it.'); vLore(); }, function (er) { $('#fsErr', ov).textContent = errMsg(er); });
      });
    };
    var BST = { draft: ['Draft', ''], in_review: ['In review', 'a'], changes_requested: ['Changes requested', 'a'], published: ['Live', 'g'], rejected: ['Not accepted', 'r'], unpublished: ['Unpublished', ''] };
    myScrolls = function () {
      var ov = modal('<div class="row"><h2>My blogs</h2><button class="btn btn-sm" data-close>Close</button></div>' + (mine.length ? '<div class="list">' + mine.map(function (s) {
        var st = BST[s.status] || [s.status, ''];
        return '<div class="item"><span><b>' + esc(s.title) + '</b><br><span class="note">' + (s.reviewNote ? 'Reviewer: ' + esc(s.reviewNote) : 'Updated ' + new Date(s.updatedAt).toLocaleDateString('en-IN')) + '</span></span><span class="chip ' + st[1] + '">' + st[0] + '</span>' + (s.status === 'draft' || s.status === 'changes_requested' ? '<button class="btn btn-xs" data-edit="' + s.id + '">Edit</button>' : '') + '</div>';
      }).join('') + '</div>' : '<p class="note">No blogs yet. Write your first one.</p>'));
      $$('[data-edit]', ov).forEach(function (b) { b.addEventListener('click', function () { var d = mine.find(function (x) { return x.id === b.dataset.edit; }); ov.remove(); forgeScroll(d); }); });
    };

    /* ---- Cyber Arsenal: courses, access, lessons and progress from the server ---- */
    var catalog = [], plan = 'free';
    var uiCourse = function (c) {
      var lessons = c.modules.reduce(function (a, m) { return a.concat(m.lessons); }, []);
      var done = lessons.filter(function (l) { return l.done; }).length;
      return Object.assign({}, c, {
        desc: c.summary || '', overview: c.overview || c.summary || '', image: c.imageUrl || '', addedAt: c.publishedAt, plan: plan,
        format: c.format || [], outcomes: c.outcomes || [], labs: c.labs || [], prerequisites: c.prerequisites || '', audience: c.audience || '', certificate: c.certificate ? c.certificate.name : '',
        faqs: (c.faqs || []).map(function (f) { return { q: f.question, a: f.answer, src: 'owner' }; }),
        state: c.state === 'locked' ? 'locked' : c.state, done: done, lessonCount: lessons.length, moduleCount: c.modules.length, pct: lessons.length ? Math.round(100 * done / lessons.length) : 0, enrolled: 0,
      });
    };
    var loadCatalog = function () {
      return get('/student/courses').then(function (r) {
        plan = r.plan;
        return Promise.all(r.items.map(function (c) { return get('/student/courses/' + encodeURIComponent(c.slug)); }));
      }).then(function (all) { catalog = all.map(uiCourse); liveCourses = catalog; return catalog; });
    };
    var demoCourses = vCourses;
    myCatalog = function () { return catalog; };
    vCourses = function (slug) {
      $('#view').innerHTML = '<div class="cx"><p class="note">Loading courses…</p></div>';
      loadCatalog().then(function () { demoCourses(slug); }, function (e) { $('#view').innerHTML = '<div class="cx"><div class="cx-empty" role="alert">' + esc(errMsg(e)) + '</div></div>'; });
    };
    var PENDING = { prerequisite: 'Finish the prerequisite course first.', payment: 'This course needs the paid plan.', approval: 'Your paid access is waiting for admin approval.', batch_assignment: 'An admin will add you to a batch for this course.' };
    document.addEventListener('click', function (e) {
      if (!/^#\/courses/.test(location.hash)) return;
      var b = e.target.closest('#acRoot [data-cx="lesson"], #goPaid'); if (!b) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (b.id === 'goPaid') {
        b.disabled = true;
        post('/public/submissions', { type: 'course_enrolment', topic: 'Paid plan access' }).then(function (r) { toast(r.duplicate ? 'You already asked for paid access (' + r.reference + '). An admin will contact you.' : 'Request sent (' + r.reference + '). An admin approves paid access.'); }, function (er) { toast(errMsg(er)); }).then(function () { b.disabled = false; });
        return;
      }
      var lid = b.dataset.id.split('|')[1], slug = (location.hash.split('/')[2] || '').split('?')[0];
      get('/student/lessons/' + lid).then(function (l) {
        var ov = modal('<div class="row"><h2>' + esc(l.title) + '</h2><button class="btn btn-sm" data-close>Close</button></div><p class="note">' + esc(l.type) + (l.durationMin ? ' · ' + l.durationMin + ' min' : '') + '</p>' +
          (l.body ? l.body.split(/\n\s*\n/).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') : '') +
          (l.contentUrl ? '<p><a class="btn btn-sm" href="' + esc(l.contentUrl) + '" target="_blank" rel="noopener noreferrer">Open ' + esc(l.type) + '</a></p>' : '') +
          (l.file ? lessonFile(l.file) : '') +
          (l.completion === 'manual' ? '<button class="btn btn-primary btn-sm" id="lsDone">Mark as complete</button>' : '<p class="note">This lesson completes when the server records your ' + esc(l.completion) + ' result.</p>') + '<p class="note" id="lsErr" style="color:var(--red)"></p>');
        var d = $('#lsDone', ov); if (d) d.addEventListener('click', function () {
          d.disabled = true;
          post('/student/lessons/' + lid + '/complete').then(function () { ov.remove(); toast('Lesson marked complete.'); refresh().then(renderHeader, function () {}); vCourses(slug); }, function (er) { d.disabled = false; $('#lsErr', ov).textContent = errMsg(er); });
        });
      }, function (er) { toast(er && er.problem && er.problem.details && PENDING[er.problem.details.pendingReason] || errMsg(er)); });
    }, true);

    /* ---- Training Grid (academy-lms.js): every page reads the server; actions write to it ---- */
    if (window.PAGES_LMS_READY !== false && typeof vLms === 'function' && typeof PAGES === 'object') {
      var demoLms = vLms, grid = null;
      var istDay = function (off) { return new Date(Date.now() + 5.5 * 36e5 + (off || 0) * 864e5).toISOString().slice(0, 10); };
      var dt = function (t) { return new Date(t).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); };
      var dd = function (t) { return new Date(t).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); };
      var slot = function (id, fill) { setTimeout(function () { var el = document.getElementById(id); if (el) fill(el); }, 0); return '<div id="' + id + '"><p class="note">Loading…</p></div>'; };
      var fail = function (el) { return function (e) { el.innerHTML = '<p class="note">' + esc(errMsg(e)) + '</p>'; }; };
      var MARK = { present: ['Present', 'g'], late: ['Late', 'a'], absent: ['Absent', 'r'], excused: ['Excused', 'b'] };
      var noBatchMsg = '<section class="card"><p class="note">You are not in a batch yet. An admin adds you to a batch when you enrol in a trainer-led course.</p></section>';
      var loadGrid = function () { return get('/student/trainer').then(function (t) { grid = t; batchName = t.batches.length ? t.batches[0].name : null; me.stats.batch = batchName; return t; }); };
      vLms = function (sub) {
        if (grid) return demoLms(sub);
        $('#view').innerHTML = '<p class="note">Loading Training Grid…</p>';
        loadGrid().then(function () { demoLms(sub); }, function (e) { $('#view').innerHTML = '<p class="note">' + esc(errMsg(e)) + '</p>'; });
      };
      rerender = function () { grid = null; vLms(location.hash.split('/')[2]); };
      var act = function (p, msg) { return p.then(function () { toast(msg); rerender(); }, function (e) { toast(errMsg(e)); }); };

      PAGES.attendance = function () {
        return head('Deployment Record', '📅 Attendance Overview') + slot('lmsAtt', function (el) {
          get('/student/attendance').then(function (a) {
            var ok = a.pct === null || a.pct >= a.requiredPct, mine = grid.leave;
            el.innerHTML = '<div class="ov-stats"><div class="ov-stat hero ' + (ok ? '' : 'bad') + '"><span class="ov-ic">%</span><div><span class="ov-lbl">Last 90 days</span><b>' + (a.pct === null ? '–' : a.pct + '%') + '</b></div><span class="ov-delta">Required ' + a.requiredPct + '%</span></div>' +
              ['present', 'late', 'absent', 'excused'].map(function (k) { return '<div class="ov-stat ' + MARK[k][1] + '"><div><span class="ov-lbl">' + MARK[k][0] + '</span><b>' + a.counts[k] + '</b></div></div>'; }).join('') + '</div>' +
              '<section class="card"><h3>By course</h3>' + (a.byCourse.length ? '<div class="list">' + a.byCourse.map(function (c) { return '<div class="item"><span>' + esc(c.course) + ' <span class="note">· ' + c.sessions + ' marked sessions</span></span><b>' + (c.pct === null ? '–' : c.pct + '%') + '</b></div>'; }).join('') + '</div>' : '<p class="note">No marked sessions yet.</p>') + '</section>' +
              '<section class="card"><h3>Sessions</h3>' + (a.sessions.length ? '<div class="list">' + a.sessions.slice().reverse().slice(0, 30).map(function (s) { var m = s.mark ? MARK[s.mark] : ['Not marked', '']; return '<div class="item"><span>' + dt(s.startsAt) + ' · <b>' + esc(s.title) + '</b> <span class="note">' + esc(s.type) + (s.course ? ' · ' + esc(s.course) : '') + '</span></span><span class="chip ' + m[1] + '">' + m[0] + '</span></div>'; }).join('') + '</div>' : (grid.batches.length ? '<p class="note">No sessions have ended yet.</p>' : noBatchMsg)) +
              '<p class="note" style="margin-top:.6rem">' + esc(a.rule) + '</p></section>' +
              '<section class="card"><h3>Leave requests</h3><form id="lvF" class="row" style="flex-wrap:wrap;gap:.5rem"><label class="note">From <input type="date" name="f" min="' + istDay(0) + '" required></label><label class="note">To <input type="date" name="t" min="' + istDay(0) + '" required></label><input name="r" placeholder="Reason (at least a few words)" style="flex:1;min-width:200px" maxlength="500" required><button class="btn btn-sm btn-primary">Request leave</button></form>' +
              (mine.length ? '<div class="list" style="margin-top:.6rem">' + mine.map(function (l) { return '<div class="item"><span>' + esc(l.fromDay) + (l.toDay !== l.fromDay ? ' to ' + esc(l.toDay) : '') + ' · ' + esc(l.reason) + (l.decisionNote ? '<br><span class="note">Trainer: ' + esc(l.decisionNote) + '</span>' : '') + '</span><span class="chip ' + (l.status === 'approved' ? 'g' : l.status === 'pending' ? 'a' : '') + '">' + esc(l.status) + '</span>' + (l.status === 'pending' ? '<button class="btn btn-xs" data-lw="' + l.id + '">Withdraw</button>' : '') + '</div>'; }).join('') + '</div>' : '') +
              '<p class="note">Approved leave never marks you present; your trainer still records each session.</p></section>';
            $('#lvF', el).addEventListener('submit', function (e) { e.preventDefault(); var f = e.target; act(post('/student/leave-requests', { from: f.f.value, to: f.t.value, reason: f.r.value.trim() }), 'Leave requested. Your trainer decides.'); });
            $$('[data-lw]', el).forEach(function (b) { b.addEventListener('click', function () { act(post('/student/leave-requests/' + b.dataset.lw + '/withdraw'), 'Leave request withdrawn.'); }); });
          }, fail(el));
        });
      };

      PAGES.calendar = function () {
        var from = istDay(-7), to = istDay(45);
        return head('Ops Calendar', '🗂️ Calendar') + slot('lmsCal', function (el) {
          get('/student/calendar?from=' + from + '&to=' + to).then(function (c) {
            var days = {}; c.events.forEach(function (e) { var k = new Date(new Date(e.startsAt).getTime() + 5.5 * 36e5).toISOString().slice(0, 10); (days[k] = days[k] || []).push(e); });
            c.holidays.forEach(function (h) { (days[h.day] = days[h.day] || []).push({ holiday: h.name }); });
            var keys = Object.keys(days).sort();
            el.innerHTML = '<section class="card"><p class="note">' + esc(from) + ' to ' + esc(to) + ' · IST</p>' + (keys.length ? keys.map(function (k) {
              return '<h3 style="margin-top:.8rem">' + dd(k + 'T12:00:00+05:30') + '</h3><div class="list">' + days[k].map(function (e) {
                if (e.holiday) return '<div class="item"><span>🎉 Holiday: ' + esc(e.holiday) + '</span></div>';
                var m = e.attendance ? MARK[e.attendance] : null;
                return '<div class="item"><span>' + new Date(e.startsAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) + ' · <b>' + esc(e.title) + '</b> <span class="note">' + esc(e.type) + (e.course ? ' · ' + esc(e.course) : '') + (e.trainer ? ' · ' + esc(e.trainer) : '') + '</span></span>' + (m ? '<span class="chip ' + m[1] + '">' + m[0] + '</span>' : '<span class="chip">' + esc(e.status) + '</span>') + '</div>';
              }).join('') + '</div>';
            }).join('') : (grid.batches.length ? '<p class="note">Nothing scheduled in this period.</p>' : noBatchMsg)) + '</section>';
          }, fail(el));
        });
      };

      PAGES.week = function () {
        return head('This Week', '🗓️ This week') + slot('lmsWeek', function (el) {
          get('/student/schedule').then(function (w) {
            el.innerHTML = (w.next ? '<section class="card"><h3>Next up</h3><div class="item"><span><b>' + esc(w.next.title) + '</b> <span class="note">' + esc(w.next.type) + ' · ' + dt(w.next.startsAt) + '</span></span></div></section>' : '') +
              '<section class="card"><h3>Week of ' + esc(w.weekStart) + '</h3>' + (w.events.length ? '<div class="list">' + w.events.map(function (e) {
                return '<div class="item"><span>' + dt(e.startsAt) + ' · <b>' + esc(e.title) + '</b> <span class="note">' + esc(e.type) + (e.room ? ' · ' + esc(e.room) : '') + '</span></span>' + (e.joinUrl ? '<a class="btn btn-sm btn-primary" href="' + esc(e.joinUrl) + '" target="_blank" rel="noopener noreferrer">Join</a>' : '<span class="chip">' + esc(e.status) + '</span>') + '</div>';
              }).join('') + '</div>' : (grid.batches.length ? '<p class="note">Nothing scheduled this week.</p>' : noBatchMsg)) + '<p class="note" style="margin-top:.6rem">' + esc(w.joinRule) + '</p></section>';
          }, fail(el));
        });
      };

      PAGES.learning = function () {
        return head('Campaigns', '📘 My courses') + slot('lmsLearn', function (el) {
          get('/student/courses?view=mine').then(function (r) {
            el.innerHTML = r.items.length ? '<div class="list">' + r.items.map(function (c) {
              var p = c.progress || { done: 0, total: 0 }, pct = p.total ? Math.round(100 * p.done / p.total) : 0;
              return '<section class="card"><div class="row"><b>' + esc(c.title) + '</b><span class="chip ' + (c.state === 'enrolled' ? 'g' : 'b') + '">' + esc(c.state) + '</span></div><div class="row note"><span>' + p.done + ' of ' + p.total + ' lessons</span><span>' + pct + '%</span></div><div class="bar"><i style="width:' + pct + '%"></i></div><a class="btn btn-sm btn-primary" style="margin-top:.6rem" href="#/courses/' + encodeURIComponent(c.slug) + '">' + (p.done ? 'Continue' : 'Start') + '</a></section>';
            }).join('') + '</div>' : '<section class="card"><p class="note">You have not started a course yet. <a href="#/courses">Browse courses</a>.</p></section>';
          }, fail(el));
        });
      };

      PAGES.trainer = function () {
        var g = grid, PUR = { doubt: 'Doubt session', mentoring: 'Mentoring', mock_interview: 'Mock interview' };
        if (!g.trainers.length) return head('My Handler', '🧑‍🏫 My trainer') + (g.batches.length ? '<section class="card"><p class="note">Your batch has no active trainer right now. An admin will assign one.</p></section>' : noBatchMsg);
        var html = head('My Handler', '🧑‍🏫 My trainer') + g.trainers.map(function (t) {
          return '<section class="card"><div class="row"><div><h3>' + esc(t.name) + '</h3><p class="note">' + esc(t.role) + (t.title ? ' · ' + esc(t.title) : '') + (t.speciality ? ' · ' + esc(t.speciality) : '') + '</p></div><button class="btn btn-sm" data-msg="' + t.id + '">Message</button></div>' +
            (t.certifications.length ? '<p class="note">Certifications: ' + t.certifications.map(esc).join(', ') + (t.certificationsVerified ? ' <span class="chip g">Verified</span>' : ' <span class="chip">Not verified yet</span>') + '</p>' : '') +
            '<p class="note">Batches: ' + t.batches.map(esc).join(', ') + '</p><h4 style="margin-top:.6rem">Open slots</h4>' +
            (t.openSlots.length ? '<div class="list">' + t.openSlots.map(function (s) { return '<div class="item"><span>' + dt(s.startsAt) + ' <span class="note">' + (s.kind === 'mock_interview' ? 'Mock interview' : '1-to-1') + '</span></span><button class="btn btn-xs btn-primary" data-book="' + s.id + '" data-kind="' + s.kind + '">Book</button></div>'; }).join('') + '</div>' : '<p class="note">No open slots in the next two weeks.</p>') + '</section>';
        }).join('') +
          // Trainer announcements ("Post to batch" in the trainer console, restored 29 Oct)
          slot('lmsAnn', function (el) {
            get('/student/announcements').then(function (a) {
              el.innerHTML = '<section class="card"><h3>Trainer announcements</h3>' + (a.length ? '<div class="list">' + a.map(function (x) {
                return '<div class="item" style="display:grid;gap:.2rem"><b>' + esc(x.title) + '</b><span>' + esc(x.body || '') + '</span><span class="note">' + dt(x.at) + '</span></div>';
              }).join('') + '</div>' : '<p class="note">No announcements from your trainer yet.</p>') + '</section>';
            }, fail(el));
          }) +
          '<section class="card"><h3>My bookings</h3>' + (g.requests.length ? '<div class="list">' + g.requests.map(function (r) {
            return '<div class="item"><span>' + dt(r.proposedStart || r.startsAt) + ' · ' + (PUR[r.purpose] || esc(r.purpose)) + (r.decisionNote ? '<br><span class="note">Trainer: ' + esc(r.decisionNote) + '</span>' : '') + '</span><span class="chip ' + (r.status === 'approved' ? 'g' : r.status === 'pending' || r.status === 'proposed' ? 'a' : '') + '">' + esc(r.status === 'proposed' ? 'new time proposed' : r.status) + '</span>' +
              (r.status === 'proposed' ? '<button class="btn btn-xs btn-primary" data-resp="' + r.id + '" data-ok="1">Accept</button><button class="btn btn-xs" data-resp="' + r.id + '" data-ok="0">Decline</button>' : '') + (r.status === 'pending' || r.status === 'approved' ? '<button class="btn btn-xs" data-cancel="' + r.id + '">Cancel</button>' : '') + '</div>';
          }).join('') + '</div>' : '<p class="note">No bookings yet.</p>') + '</section>' +
          '<section class="card"><h3>Messages</h3>' + (g.conversations.length ? '<div class="list">' + g.conversations.map(function (c) { return '<div class="item" style="cursor:pointer" data-thread="' + c.id + '"><span><b>' + esc(c.subject) + '</b> <span class="note">· ' + esc(c.with || '') + '</span><br><span class="note">' + esc(c.preview) + '</span></span>' + (c.unread ? '<span class="chip b">' + c.unread + ' new</span>' : '') + '</div>'; }).join('') + '</div>' : '<p class="note">No messages yet.</p>') + '</section>';
        // Rate your sessions: classes you attended and mentoring sessions you had, any time; one rating each, changeable (anonymous to the trainer)
        html += slot('lmsFb', function (el) {
          var draw = function () {
            get('/student/feedback').then(function (f) {
              el.innerHTML = '<section class="card"><h3>Rate your sessions</h3><p class="note">Your trainer sees the rating and comment, not your name. Each session has one rating from you, and you can change it.</p>' +
                (f.rateable.length ? '<div class="list">' + f.rateable.map(function (r, i) {
                  return '<div class="item" style="display:grid;gap:.4rem"><span><b>' + esc(r.title) + '</b> <span class="note">· ' + dt(r.at) + (r.trainer ? ' · ' + esc(r.trainer) : '') + '</span></span>' +
                    '<form data-fb="' + i + '" class="row" style="flex-wrap:wrap;gap:.4rem"><span role="radiogroup" aria-label="Rating">' + [1, 2, 3, 4, 5].map(function (n) { return '<label style="cursor:pointer"><input type="radio" name="r" value="' + n + '" style="margin-right:.15rem">' + n + '★</label>'; }).join(' ') + '</span>' +
                    '<input name="c" maxlength="1000" placeholder="Comment (optional)" style="flex:1;min-width:180px"><button class="btn btn-xs btn-primary">Send</button></form></div>';
                }).join('') + '</div>' : '<p class="note">Nothing to rate right now.</p>') +
                (f.given.length ? '<h4 style="margin-top:.8rem">You rated</h4><div class="list">' + f.given.slice(0, 10).map(function (g, i) { return '<div class="item"><span>' + esc(g.about || 'Session') + ' <span class="note">· ' + dt(g.at) + '</span></span><span><b style="color:var(--amber)">' + '★'.repeat(g.rating) + '</b> <button class="btn btn-xs" data-fbc="' + i + '">Change</button></span></div>'; }).join('') + '</div>' : '') + '</section>';
              $$('[data-fbc]', el).forEach(function (b) { b.addEventListener('click', function () {
                var g = f.given[+b.dataset.fbc];
                var ov = modal('<div class="row"><h2>Change your rating</h2><button class="btn btn-sm" data-close>Close</button></div><form id="fbcF" style="display:grid;gap:.6rem"><span role="radiogroup" aria-label="Rating">' + [1, 2, 3, 4, 5].map(function (n) { return '<label style="cursor:pointer"><input type="radio" name="r" value="' + n + '"' + (n === g.rating ? ' checked' : '') + '>' + n + '★</label>'; }).join(' ') + '</span><input name="c" maxlength="1000" placeholder="Comment (optional)" value="' + esc(g.comment || '') + '"><button class="btn btn-primary btn-sm">Save</button></form>');
                $('#fbcF', ov).addEventListener('submit', function (e) {
                  e.preventDefault(); var v = e.target.querySelector('input[name=r]:checked'), body = { rating: +v.value };
                  if (e.target.c.value.trim()) body.comment = e.target.c.value.trim();
                  if (g.sessionId) body.sessionId = g.sessionId; else body.sessionRequestId = g.sessionRequestId;
                  post('/student/feedback', body).then(function () { ov.remove(); toast('Rating updated.'); draw(); }, function (er) { toast(errMsg(er)); });
                });
              }); });
              $$('[data-fb]', el).forEach(function (form) { form.addEventListener('submit', function (e) {
                e.preventDefault(); var r = f.rateable[+form.dataset.fb], v = form.querySelector('input[name=r]:checked');
                if (!v) return toast('Choose 1 to 5 stars first.');
                var body = { rating: +v.value }; if (form.c.value.trim()) body.comment = form.c.value.trim();
                if (r.kind === 'class') body.sessionId = r.sessionId; else body.sessionRequestId = r.sessionRequestId;
                post('/student/feedback', body).then(function () { toast('Thanks! Your rating was sent.'); draw(); }, function (er) { toast(errMsg(er)); });
              }); });
            }, function (e) { el.innerHTML = '<p class="note">' + esc(errMsg(e)) + '</p>'; });
          };
          draw();
        });
        setTimeout(function () {
          var main = $('.lms-main'); if (!main) return;
          $$('[data-book]', main).forEach(function (b) { b.addEventListener('click', function () {
            var purpose = b.dataset.kind === 'mock_interview' ? 'mock_interview' : (confirm('Book this as a mentoring session? (Cancel books it as a doubt session.)') ? 'mentoring' : 'doubt');
            act(post('/student/session-requests', { slotId: b.dataset.book, purpose: purpose }), 'Booking sent. Your trainer will confirm it.');
          }); });
          $$('[data-cancel]', main).forEach(function (b) { b.addEventListener('click', function () { act(post('/student/session-requests/' + b.dataset.cancel + '/cancel'), 'Booking cancelled.'); }); });
          $$('[data-resp]', main).forEach(function (b) { b.addEventListener('click', function () { act(post('/student/session-requests/' + b.dataset.resp + '/respond', { accept: b.dataset.ok === '1' }), b.dataset.ok === '1' ? 'New time accepted.' : 'New time declined.'); }); });
          $$('[data-msg]', main).forEach(function (b) { b.addEventListener('click', function () {
            var ov = modal('<div class="row"><h2>Message your trainer</h2><button class="btn btn-sm" data-close>Close</button></div><form id="cF" style="display:grid;gap:.6rem"><input name="s" placeholder="Subject" maxlength="150" required><textarea name="b" rows="5" placeholder="Your message (no lab answers or flags)" maxlength="4000" required></textarea><p class="note" id="cE" style="color:var(--red)"></p><button class="btn btn-primary btn-sm">Send</button></form>');
            $('#cF', ov).addEventListener('submit', function (e) { e.preventDefault(); post('/student/conversations', { staffId: b.dataset.msg, subject: e.target.s.value.trim(), body: e.target.b.value.trim() }).then(function () { ov.remove(); toast('Message sent.'); rerender(); }, function (er) { $('#cE', ov).textContent = errMsg(er); }); });
          }); });
          $$('[data-thread]', main).forEach(function (row) { row.addEventListener('click', function () { openThread(row.dataset.thread); }); });
        }, 0);
        return html;
      };
      var openThread = function (id) {
        get('/student/conversations/' + id).then(function (c) {
          var ov = modal('<div class="row"><h2>' + esc(c.subject) + '</h2><button class="btn btn-sm" data-close>Close</button></div><div class="list" style="max-height:50vh;overflow:auto">' + c.messages.map(function (m) { return '<div class="item" style="display:grid;gap:.2rem;' + (m.mine ? 'border-color:var(--cyan,#22d3ee)' : '') + '"><b>' + (m.mine ? 'You' : 'Trainer') + '</b><span>' + esc(m.body) + '</span><span class="note">' + dt(m.at) + '</span></div>'; }).join('') + '</div>' +
            '<form id="rF" class="row" style="margin-top:.6rem"><input name="b" placeholder="Reply" style="flex:1" maxlength="4000" required><button class="btn btn-primary btn-sm">Send</button></form>');
          $('#rF', ov).addEventListener('submit', function (e) { e.preventDefault(); post('/student/conversations/' + id + '/messages', { body: e.target.b.value.trim() }).then(function () { ov.remove(); openThread(id); }, function (er) { toast(errMsg(er)); }); });
        }, function (e) { toast(errMsg(e)); });
      };

      PAGES.assessments = function () {
        return head('Incoming Challenges', '📝 Assessments') + slot('lmsAsm', function (el) {
          get('/student/assessments').then(function (r) {
            var ST = { pending: ['To do', 'a'], in_progress: ['In progress', 'b'], returned: ['Returned', 'a'], submitted: ['Submitted', 'b'], completed: ['Completed', 'g'], missed: ['Missed', 'r'], closed: ['Closed', ''] };
            el.innerHTML = '<div class="ov-stats">' + [['To do', r.counts.pending, 'a'], ['Due soon', r.counts.due_soon, 'r'], ['Submitted', r.counts.submitted, 'b'], ['Completed', r.counts.completed, 'g']].map(function (x) { return '<div class="ov-stat ' + x[2] + '"><div><span class="ov-lbl">' + x[0] + '</span><b>' + x[1] + '</b></div></div>'; }).join('') + '</div>' +
              '<section class="card">' + (r.items.length ? '<div class="list">' + r.items.map(function (a) {
                var st = ST[a.status] || [a.status, ''];
                return '<div class="item"><span><b>' + esc(a.title) + '</b> <span class="note">' + esc(a.kind) + (a.course ? ' · ' + esc(a.course) : '') + (a.dueAt ? ' · due ' + dt(a.dueAt) : '') + (a.dueSoon ? ' · due soon' : '') + '</span>' + (a.score !== null ? '<br><span class="note">Score ' + a.score + '/' + a.maxMarks + (a.passed ? ' · passed' : ' · not passed') + '</span>' : '') + '</span><span class="chip ' + st[1] + '">' + st[0] + '</span><button class="btn btn-xs btn-primary" data-asm="' + a.id + '">Open</button></div>';
              }).join('') + '</div>' : '<p class="note">No assessments for your courses yet.</p>') + '<p class="note" style="margin-top:.6rem">Due soon means ' + esc(r.dueSoonRule) + '. Scores appear when your trainer releases results.</p></section>';
            $$('[data-asm]', el).forEach(function (b) { b.addEventListener('click', function () { openAssessment(b.dataset.asm); }); });
          }, fail(el));
        });
      };
      var openAssessment = function (id) {
        get('/student/assessments/' + id).then(function (a) {
          var canStart = ['pending', 'in_progress', 'returned'].indexOf(a.status) >= 0;
          var ov = modal('<div class="row"><h2>' + esc(a.title) + '</h2><button class="btn btn-sm" data-close>Close</button></div><p class="note">' + esc(a.kind) + ' · ' + a.maxMarks + ' marks, pass ' + a.passMarks + (a.durationMin ? ' · ' + a.durationMin + ' min' : '') + (a.dueAt ? ' · due ' + dt(a.dueAt) : '') + ' · attempts ' + a.attempts.length + '/' + a.attemptsAllowed + '</p>' +
            (a.instructions ? '<p>' + esc(a.instructions) + '</p>' : '') +
            (a.attempts.length ? '<div class="list">' + a.attempts.map(function (x) { return '<div class="item" style="display:grid;gap:.2rem"><span>Attempt ' + x.number + ' · ' + esc(x.status) + (x.late ? ' · late' : '') + (x.score !== null ? ' · ' + x.score + '/' + a.maxMarks : '') + '</span>' + (x.feedback ? '<span class="note">Feedback: ' + esc(x.feedback) + '</span>' : '') + '</div>'; }).join('') + '</div>' : '') +
            '<div id="aBody"></div><p class="note" id="aErr" style="color:var(--red)"></p>' + (canStart ? '<button class="btn btn-primary btn-sm" id="aStart">' + (a.status === 'in_progress' ? 'Resume' : 'Start attempt') + '</button>' : ''));
          var st = $('#aStart', ov); if (st) st.addEventListener('click', function () {
            st.disabled = true;
            post('/student/assessments/' + id + '/attempts').then(function (t) {
              st.remove();
              var body = $('#aBody', ov);
              body.innerHTML = '<form id="aF" style="display:grid;gap:.8rem;margin-top:.6rem">' + (t.format === 'questions' ? t.questions.map(function (q, i) {
                var opts = q.options || [];
                return '<fieldset class="card"><legend>' + (i + 1) + '. ' + esc(q.prompt) + ' <span class="note">(' + q.marks + ')</span></legend>' + (q.kind === 'short_text' ? '<input name="q-' + q.id + '" maxlength="500">' : opts.map(function (o, k) { return '<label class="note" style="display:flex;gap:.4rem"><input type="' + (q.kind === 'multi' ? 'checkbox' : 'radio') + '" name="q-' + q.id + '" value="' + k + '"> ' + esc(o) + '</label>'; }).join('')) + '</fieldset>';
              }).join('') : t.format === 'lab_result' ? '<label>Lab you cleared (code)<input name="lab" maxlength="50" placeholder="e.g. INT-01"></label>' : '<label>Your answer<textarea name="txt" rows="8" maxlength="20000"></textarea></label>') +
                (t.expiresAt ? '<p class="note">Time ends ' + dt(t.expiresAt) + '.</p>' : '') + '<button class="btn btn-primary btn-sm">Submit</button></form>';
              $('#aF', ov).addEventListener('submit', function (e) {
                e.preventDefault(); var f = e.target, payload = {};
                if (t.format === 'questions') { payload.answers = {}; t.questions.forEach(function (q) {
                  if (q.kind === 'short_text') { var v = f['q-' + q.id].value.trim(); if (v) payload.answers[q.id] = v; }
                  else { var ch = $$('input[name="q-' + q.id + '"]:checked', f).map(function (x) { return +x.value; }); if (ch.length) payload.answers[q.id] = q.kind === 'multi' ? ch : ch[0]; }
                }); }
                else if (t.format === 'lab_result') payload.labRef = f.lab.value.trim(); else payload.text = f.txt.value;
                post('/student/attempts/' + t.attemptId + '/submit', payload).then(function (res) { ov.remove(); toast(res && res.status === 'graded' && res.score !== null && res.score !== undefined ? 'Submitted. Score ' + res.score + '.' : 'Submitted. Your trainer will grade it.'); rerender(); }, function (er) { $('#aErr', ov).textContent = errMsg(er); });
              });
            }, function (e) { st.disabled = false; $('#aErr', ov).textContent = errMsg(e); });
          });
        }, function (e) { toast(errMsg(e)); });
      };

      // Resume built from the sign-up details (locked) and the career quiz / chosen team (owner, 29 Oct)
      var TEAMN = { Offensive: 'Red Team', Defensive: 'Blue Team', GRC: 'Green Team' };
      var resumeBody = function (rv) {
        var ed = rv.education || {}, cp = rv.careerPath || {}, q = cp.quiz;
        var sec = function (t, body) { return body ? '<h4 style="margin:.9rem 0 .3rem;text-transform:uppercase;letter-spacing:.08em;font-size:.78rem;opacity:.75">' + t + '</h4>' + body : ''; };
        return '<div style="display:grid;gap:.2rem"><b style="font-size:1.25rem">' + esc(rv.name || '') + '</b>' + (rv.headline ? '<span>' + esc(rv.headline) + '</span>' : '') +
          '<span class="note">' + [rv.email, rv.phone, rv.city].filter(Boolean).map(esc).join(' · ') + '</span></div>' +
          sec('Career objective', rv.objective ? '<p>' + esc(rv.objective) + '</p>' : '') +
          sec('Education', ed.level || ed.stream || ed.institution ? '<p>' + [ed.level, ed.stream].filter(Boolean).map(esc).join(', ') + (ed.institution ? '<br>' + esc(ed.institution) : '') + (ed.gradYear ? ' · graduating ' + ed.gradYear : '') + (ed.cgpa ? ' · CGPA ' + ed.cgpa : '') + '</p>' : '') +
          sec('Skills', (rv.skills || []).length ? '<p>' + rv.skills.map(esc).join(' · ') + '</p>' : '') +
          sec('Certifications', (rv.certifications || []).length || (rv.yojoCertificates || []).length ? '<p>' + (rv.certifications || []).map(esc).concat((rv.yojoCertificates || []).map(function (c) { return esc(c.course) + ' (Yojo, ' + esc(c.code) + ')'; })).join(' · ') + '</p>' : '') +
          sec('Career path', cp.path || q ? '<p>' + (cp.path ? '<b>' + esc(cp.path) + ' (' + esc(cp.team || TEAMN[cp.path] || '') + ')</b>' : 'Not chosen yet') +
            (q ? '<br><span class="note">Career quiz: Offensive ' + q.percentages.Offensive + '% · Defensive ' + q.percentages.Defensive + '% · GRC ' + q.percentages.GRC + '% (suggested ' + esc(q.suggested) + ')</span>' : '') + '</p>' : '') +
          sec('Hands-on labs', '<p>' + (rv.labsCleared || 0) + ' Yojo labs cleared</p>') +
          sec('Projects', (rv.projects || []).filter(function (p) { return p.status === 'approved'; }).map(function (p) { return '<p><b>' + esc(p.title) + '</b>' + (p.description ? '<br>' + esc(p.description) : '') + '</p>'; }).join(''));
      };
      var resumeDoc = function (rv) {
        return '<div class="card" style="background:var(--surface-2,rgba(255,255,255,.03));margin-top:.6rem">' + resumeBody(rv) + '</div>' +
          '<p class="note" style="margin-top:.5rem">🔒 ' + esc(rv.locked || 'Details from sign-up are locked.') + ' <button type="button" class="btn btn-xs" id="rsPrint">Print / Save as PDF</button></p>';
      };
      var printResume = function (rv) {
        var w = window.open('', '_blank'); if (!w) { toast('Allow pop-ups to print your resume.'); return; }
        w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Resume · ' + esc(rv.name || '') + '</title><style>body{font:14px/1.5 Segoe UI,Arial,sans-serif;color:#111;max-width:760px;margin:32px auto;padding:0 24px}h4{color:#0b3d91}.note{color:#555}p{margin:.2rem 0 .4rem}</style></head><body>' + resumeBody(rv) + '</body></html>');
        w.document.close(); w.focus(); setTimeout(function () { w.print(); }, 300);
      };
      PAGES.resume = function () {
        return head('My Resume', '📄 Built from your sign-up details') + slot('lmsRes', function (el) {
          get('/student/resume').then(function (r) {
            var rv = r.resume || r;
            el.innerHTML = '<section class="card">' + resumeDoc(rv) +
              '<form id="rhF" class="row" style="gap:.5rem;margin-top:.6rem;flex-wrap:wrap"><input name="h" placeholder="Headline, e.g. Aspiring SOC analyst" maxlength="120" value="' + esc(rv.headline || '') + '" style="flex:1;min-width:220px"><button class="btn btn-sm">Save headline</button></form>' +
              '<p class="note" style="margin-top:.5rem">Your trainer reviews the resume from Placement Mission (Premium). PDF files need a PDF service, which is not connected yet; use Print / Save as PDF.</p></section>';
            $('#rsPrint', el).addEventListener('click', function () { printResume(rv); });
            $('#rhF', el).addEventListener('submit', function (e) { e.preventDefault(); act(put('/student/resume', { headline: e.target.h.value.trim() || undefined }), 'Headline saved.'); });
          }, fail(el));
        });
      };
      PAGES.placement = function () {
        return head('Placement Mission', '🎯 Placement readiness') + slot('lmsPl', function (el) {
          Promise.all([get('/student/placement'), get('/student/resume'), get('/student/portfolio')]).then(function (x) {
            var o = x[0], r = x[1], pf = x[2], P = o.parts, RS = { not_submitted: 'Not sent', submitted: 'In review', approved: 'Approved', changes_requested: 'Changes requested' };
            var rv = r.resume || r;
            el.innerHTML = '<div class="ov-stats"><div class="ov-stat hero"><div><span class="ov-lbl">Readiness</span><b>' + o.overall + '%</b></div></div>' + [['Resume', P.resume.pct], ['Mock interview + communication', P.mock.pct], ['Internship', P.internship.pct], ['Portfolio', P.portfolio.pct]].map(function (k) { return '<div class="ov-stat"><div><span class="ov-lbl">' + k[0] + '</span><b>' + k[1] + '%</b></div></div>'; }).join('') + '</div>' +
              '<section class="card"><h3>Resume <span class="chip">' + esc(RS[P.resume.status] || P.resume.status) + '</span></h3>' + (P.resume.feedback ? '<p class="note">Trainer: ' + esc(P.resume.feedback) + '</p>' : '') +
              resumeDoc(rv) +
              '<form id="rsF" style="display:grid;gap:.5rem;margin-top:.8rem"><input name="h" placeholder="Headline, e.g. Aspiring SOC analyst" maxlength="120" value="' + esc(rv.headline || '') + '"><textarea name="o" rows="3" placeholder="Career objective" maxlength="600" hidden>' + esc(rv.objective || '') + '</textarea><input name="s" hidden value="' + esc((rv.skills || []).join(', ')) + '"><input name="c" hidden placeholder="Certifications, separated by commas" value="' + esc((rv.certifications || []).join(', ')) + '">' +
              '<div class="row" style="justify-content:flex-start;gap:.5rem"><button class="btn btn-sm">Save</button><button type="button" class="btn btn-sm btn-primary" id="rsSub">Send for review</button></div></form><p class="note">' + (r.pdf && !r.pdf.available ? 'PDF download needs a PDF service, which is not connected yet.' : '') + '</p></section>' +
              '<section class="card"><h3>Portfolio <span class="note">' + P.portfolio.approved + ' of ' + P.portfolio.target + ' approved</span></h3>' + (pf.length ? '<div class="list">' + pf.map(function (p) { return '<div class="item"><span><b>' + esc(p.title) + '</b>' + (p.feedback ? '<br><span class="note">Trainer: ' + esc(p.feedback) + '</span>' : '') + '</span><span class="chip ' + (p.status === 'approved' ? 'g' : 'a') + '">' + esc(p.status) + '</span>' + (p.status === 'draft' || p.status === 'changes_requested' ? '<button class="btn btn-xs btn-primary" data-pfs="' + p.id + '">Send for review</button>' : '') + '</div>'; }).join('') + '</div>' : '') +
              '<form id="pfF" style="display:grid;gap:.5rem;margin-top:.6rem"><input name="t" placeholder="Project title" maxlength="120" required><textarea name="d" rows="3" placeholder="What you built and what you learned (at least a few lines)" maxlength="2000"></textarea><input name="u" placeholder="Repository link (https://)"><button class="btn btn-sm">Add project</button></form></section>' +
              '<section class="card"><h3>Mock interviews <span class="note">' + P.mock.done + ' of ' + P.mock.target + ' done' + (P.mock.booked ? ' · ' + P.mock.booked + ' booked' : '') + '</span></h3>' + (P.mock.results.length ? '<div class="list">' + P.mock.results.map(function (m) { return '<div class="item"><span>' + dd(m.at) + ' · technical ' + m.technical + '/5 · communication ' + m.communication + '/5 · problem solving ' + m.problemSolving + '/5<br><span class="note">' + esc(m.feedback) + '</span></span><span class="chip ' + (m.passed ? 'g' : 'a') + '">' + (m.passed ? 'Passed' : 'Keep going') + '</span></div>'; }).join('') + '</div>' : '<p class="note">Book a mock interview slot on the My Handler page.</p>') + '</section>' +
              '<section class="card"><h3>Internship milestones</h3>' + (P.internship.milestones.length ? '<div class="list">' + P.internship.milestones.map(function (m) { return '<div class="item"><span><b>' + esc(m.title) + '</b>' + (m.note ? '<br><span class="note">' + esc(m.note) + '</span>' : '') + '</span><span class="chip ' + (m.status === 'done' ? 'g' : m.status === 'submitted' ? 'b' : '') + '">' + esc(m.status) + '</span>' + (m.status !== 'done' && m.status !== 'submitted' ? '<button class="btn btn-xs" data-ms="' + m.id + '">Submit</button>' : '') + '</div>'; }).join('') + '</div>' : '<p class="note">No milestones set yet.</p>') + '</section>';
            var split = function (v) { return v.split(',').map(function (s) { return s.trim(); }).filter(Boolean); };
            var pr = $('#rsPrint', el); if (pr) pr.addEventListener('click', function () { printResume(rv); });
            var rsBody = function (f) { return { headline: f.h.value.trim() || undefined, objective: f.o.value.trim() || undefined, skills: split(f.s.value), certifications: split(f.c.value) }; };
            $('#rsF', el).addEventListener('submit', function (e) { e.preventDefault(); act(put('/student/resume', rsBody(e.target)), 'Resume saved.'); });
            $('#rsSub', el).addEventListener('click', function () { var f = $('#rsF', el); put('/student/resume', rsBody(f)).then(function () { return act(post('/student/resume/submit'), 'Resume sent for review.'); }, function (e) { toast(errMsg(e)); }); });
            $('#pfF', el).addEventListener('submit', function (e) { e.preventDefault(); var f = e.target, b = { title: f.t.value.trim() }; if (f.d.value.trim()) b.description = f.d.value.trim(); if (f.u.value.trim()) b.repoUrl = f.u.value.trim(); act(post('/student/portfolio', b), 'Project added.'); });
            $$('[data-pfs]', el).forEach(function (b) { b.addEventListener('click', function () { act(post('/student/portfolio/' + b.dataset.pfs + '/submit'), 'Project sent for review.'); }); });
            $$('[data-ms]', el).forEach(function (b) { b.addEventListener('click', function () { var u = prompt('Link to your evidence (https://), or leave empty'); if (u === null) return; act(post('/student/milestones/' + b.dataset.ms + '/submit', u.trim() ? { evidenceUrl: u.trim() } : {}), 'Milestone sent to your trainer.'); }); });
          }, fail(el));
        });
      };
    }

    /* ---- Career-path quiz (#/academy/career): optional 15 scenarios; the student always picks the path ---- */
    var TRACK = { Offensive: ['Offensive (Red Team)', 'Find weaknesses before attackers do'], Defensive: ['Defensive (Blue Team)', 'Detect, respond and keep systems running'], GRC: ['GRC (Green Team)', 'Rules, risk and compliance that prevent attacks'] };
    var cq = { i: 0, answers: [] };
    var pathPicker = function (suggested, current) {
      return '<div class="list" style="margin-top:.6rem">' + ['Offensive', 'Defensive', 'GRC'].map(function (t) {
        return '<div class="item"><span><span class="pathbadge ' + t + '">' + esc(TRACK[t][0]) + '</span> <span class="note">' + esc(TRACK[t][1]) + '</span>' + (t === suggested ? ' <span class="chip g">Suggested</span>' : '') + (t === current ? ' <span class="chip b">Current</span>' : '') + '</span><button class="btn btn-sm ' + (t === suggested ? 'btn-primary' : '') + '" data-path="' + t + '">' + (t === current ? 'Keep' : 'Choose') + '</button></div>';
      }).join('') + '</div>';
    };
    var bindPaths = function (root) {
      $$('[data-path]', root).forEach(function (b) {
        b.addEventListener('click', function () {
          $$('[data-path]', root).forEach(function (x) { x.disabled = true; });
          post('/student/career-path', { path: b.dataset.path }).then(function () {
            toast('Your path: ' + TRACK[b.dataset.path][0]);
            var first = !me.category; // first choice: reload so the story layer and its intro start with the path set
            if (first) { location.hash = '#/academy/dashboard'; location.reload(); return; }
            refresh().then(function () { location.hash = '#/academy/dashboard'; route(); });
          }, function (e) { toast(errMsg(e)); $$('[data-path]', root).forEach(function (x) { x.disabled = false; }); });
        });
      });
    };
    var bars = function (p) {
      return ['Offensive', 'Defensive', 'GRC'].map(function (t) { return '<div class="meter"><div class="row note"><span>' + esc(TRACK[t][0]) + '</span><span>' + p[t] + '%</span></div><div class="bar"><i class="' + t + '" style="width:' + p[t] + '%"></i></div></div>'; }).join('');
    };
    var vCareer = function () {
      $('#subnav').hidden = true;
      $('#view').innerHTML = '<p class="note">Loading…</p>';
      get('/student/career-quiz').then(function (s) {
        var r = s.result, pending = r && !r.skipped && !r.chosenPath;
        if (pending) return careerResult(r, s);
        $('#view').innerHTML = '<div class="grid g12"><section class="card s12 hero"><div><span class="callsign">CAREER PATH // OPTIONAL</span><h1>' + (s.path ? 'Your career path' : 'Find your cyber career path') + '</h1>' +
          '<p class="note" style="max-width:62ch">' + esc(s.rules.optional) + ' ' + s.rules.questions + ' real-life scenarios, about 5 minutes. Each answer leans towards Offensive, Defensive or GRC; you get a percentage for each.</p>' +
          (s.path ? '<p style="margin-top:.6rem">Current path: <span class="pathbadge ' + s.path + '">' + esc(TRACK[s.path][0]) + '</span></p>' : '') + '</div></section>' +
          (r && !r.skipped ? '<section class="card s6"><h3>Your last result <span class="note">' + new Date(r.at).toLocaleDateString('en-IN') + '</span></h3>' + bars(r.percentages) + '<p class="note">Suggested: ' + esc(TRACK[r.suggested][0]) + (r.tiedWith.length ? ' (tied with ' + r.tiedWith.map(function (t) { return TRACK[t][0]; }).join(', ') + ')' : '') + '</p></section>' : '') +
          '<section class="card ' + (r && !r.skipped ? 's6' : 's12') + '"><h3>Take the quiz</h3>' + (s.canTake ? '<p class="note">Answer honestly; there are no right or wrong answers.</p><button class="btn btn-primary" id="cqStart">▶ Start the ' + s.rules.questions + ' questions</button>' : '<p class="note">You can take it again on ' + new Date(s.retakeAt).toLocaleDateString('en-IN') + ' (once every ' + s.rules.retakeDays + ' days).</p>') + '</section>' +
          '<section class="card s12"><h3>' + (s.path ? 'Change your path' : 'Or skip the quiz and choose your path') + '</h3>' + pathPicker(null, s.path) + '</section></div>';
        var st = $('#cqStart'); if (st) st.addEventListener('click', function () { cq = { i: 0, answers: [], qs: s.questions }; careerQuestion(); });
        bindPaths($('#view'));
      }, function (e) { $('#view').innerHTML = '<p class="note">' + esc(errMsg(e)) + '</p>'; });
    };
    var careerQuestion = function () {
      var q = cq.qs[cq.i], n = cq.qs.length;
      $('#view').innerHTML = '<section class="card" style="max-width:760px;margin:0 auto"><div class="row note"><span>Question ' + (cq.i + 1) + ' of ' + n + '</span><span>' + Math.round(100 * cq.i / n) + '%</span></div><div class="bar" style="margin:.4rem 0 1rem"><i style="width:' + (100 * cq.i / n) + '%"></i></div>' +
        '<h2 style="line-height:1.35">' + esc(q.scenario) + '</h2><div class="list" style="margin-top:1rem">' + q.options.map(function (o) {
          return '<button type="button" class="item" data-opt="' + esc(o.id) + '" style="text-align:left;cursor:pointer;width:100%;' + (cq.answers[cq.i] === o.id ? 'border-color:var(--neon,#00f0ff)' : '') + '"><span>' + esc(o.text) + '</span></button>';
        }).join('') + '</div><div class="row" style="margin-top:1rem"><button class="btn btn-sm" id="cqBack" ' + (cq.i ? '' : 'disabled') + '>← Back</button><a class="note" href="#/academy/career" id="cqQuit">Leave the quiz</a></div><p class="note" id="cqErr" style="color:var(--red)"></p></section>';
      $$('[data-opt]').forEach(function (b) {
        b.addEventListener('click', function () {
          cq.answers[cq.i] = b.dataset.opt;
          if (cq.i < n - 1) { cq.i++; return careerQuestion(); }
          $$('[data-opt]').forEach(function (x) { x.disabled = true; });
          post('/student/career-quiz', { answers: cq.answers }).then(function (r) { get('/student/career-quiz').then(function (s) { careerResult(r, s); }); }, function (e) { $('#cqErr').textContent = errMsg(e); $$('[data-opt]').forEach(function (x) { x.disabled = false; }); });
        });
      });
      $('#cqBack').addEventListener('click', function () { if (cq.i) { cq.i--; careerQuestion(); } });
      $('#cqQuit').addEventListener('click', function (e) { e.preventDefault(); vCareer(); });
    };
    var careerResult = function (r, s) {
      $('#view').innerHTML = '<div class="grid g12"><section class="card s12 hero"><div><span class="callsign">CAREER PATH // RESULT</span><h1>You lean towards ' + esc(TRACK[r.suggested][0]) + '</h1>' +
        '<p class="note">' + (r.tiedWith.length ? 'It is a tie with ' + r.tiedWith.map(function (t) { return esc(TRACK[t][0]); }).join(' and ') + ', so pick the one that interests you most. ' : '') + 'This is a suggestion, not a test result. Keep it or choose the path you are most interested in.</p></div></section>' +
        '<section class="card s6"><h3>Your mix</h3>' + bars(r.percentages) + '<p class="note">' + esc(s.rules.scoring) + '</p></section>' +
        '<section class="card s6"><h3>Choose your path</h3>' + pathPicker(r.suggested, s.path) + '</section></div>';
      bindPaths($('#view'));
    };
    var demoRoute = route;
    // Old mission links (lab sites' "Submit Solution" buttons, bookmarks) open the server lab page. The three practice
    // labs keep their demo page while the lab service is not linked.
    var OLD_SLUG = { intro: 'INT-01', recon: 'REC-01', fingerprint: 'WEB-01', information: 'INFO-01', domain: 'DOM-01', subdomains: 'SUB-01', endpoints: 'END-01', directory: 'DIR-01', metadata: 'IMG-01' };
    route = function () { if (!me.category && u.origin === 'signup' && !/^#\/academy\/career/.test(location.hash)) { location.hash = '#/academy/career'; return; }
      var old = location.hash.match(/^#\/academy\/mission\/([a-z]+)/);
      if (old && OLD_SLUG[old[1]] && (L.missions.providerAvailable || !LAB_DEMO[OLD_SLUG[old[1]]])) { location.replace('#/academy/lab/' + OLD_SLUG[old[1]]); return; } if (/^#\/academy\/lab\//.test(location.hash)) { var lc = decodeURIComponent((location.hash.match(/^#\/academy\/lab\/([^/?#]+)/) || [])[1] || ''); $$('[data-main]').forEach(function (a) { a.dataset.main === 'academy' ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); }); var sn = $('#subnav'); sn.hidden = false; sn.innerHTML = '<span class="crumb">Cyber Command &gt;</span>' + ACADEMY_TABS.map(function (t) { return '<a href="#/academy/' + t[0] + '"' + (t[0] === 'missions' ? ' aria-current="page"' : '') + '>' + t[1] + '</a>'; }).join(''); renderHeader(); scrollTo(0, 0); return vLab(lc); } if (/^#\/academy\/career/.test(location.hash)) { $$('[data-main]').forEach(function (a) { a.removeAttribute('aria-current'); }); renderHeader(); return vCareer(); } return demoRoute(); };
    // academy.html registered the original route for hashchange; swap it so the path check runs on every navigation.
    removeEventListener('hashchange', demoRoute);
    addEventListener('hashchange', function () { route(); });
    window.YojoAcademyLive.career = vCareer;
    window.YojoAcademyLive.origin = u.origin; // only self-signed-up students are sent to the career page first

    /* ---- boot ---- */
    if (/^#\/academy\/mission\//.test(openedAt) && location.hash !== openedAt) location.replace(openedAt);
    window.YojoAcademyLive.refresh = refresh;
    window.YojoAcademyLive.state = L;
  }
})();
