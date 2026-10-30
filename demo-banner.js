/* Shows a clear "Demo data" banner on the Admin, Trainer and Student pages whenever they are NOT showing live server
   data, with the reason and what to do. Live mode is decided by admin-live.js / trainer-live.js / academy-live.js;
   this file only reads their result. Usage: <script src="demo-banner.js" data-page="admin|trainer|academy"></script> */
(function () {
  'use strict';
  var me = document.currentScript, page = (me && me.dataset.page) || '';
  var api = window.YojoAPI;

  function isLive() {
    if (page === 'admin') return Promise.resolve(!!(window.YojoLiveAdmin && window.YojoLiveAdmin.user));
    if (page === 'trainer') return Promise.resolve(!!(window.YojoLiveTrainer && window.YojoLiveTrainer.user));
    if (page === 'academy') return (window.YojoAcademyLive && window.YojoAcademyLive.ready || Promise.resolve(false)).then(function (r) { return r === true; }, function () { return false; });
    return Promise.resolve(true);
  }

  function show(reason) {
    if (document.getElementById('yojoDemoBanner')) return;
    var b = document.createElement('div');
    b.id = 'yojoDemoBanner'; b.setAttribute('role', 'status');
    b.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:9999;max-width:min(680px,calc(100vw - 24px));' +
      'display:flex;gap:.7rem;align-items:center;flex-wrap:wrap;padding:.6rem .9rem;border-radius:12px;font:500 13px/1.4 system-ui,Segoe UI,sans-serif;' +
      'background:#1a1406;color:#ffe2a3;border:1px solid #f5b301;box-shadow:0 10px 30px rgba(0,0,0,.45)';
    var where = page === 'admin' || page === 'trainer' ? 'Employee' : 'Student';
    b.innerHTML = '<b style="color:#f5b301">Demo data</b><span style="flex:1;min-width:200px">' + reason + '</span>' +
      (reason.indexOf('sign in') >= 0 ? '<a href="login.html" style="color:#111;background:#f5b301;padding:.3rem .7rem;border-radius:8px;text-decoration:none;font-weight:700">Sign in (' + where + ')</a>' : '') +
      '<button type="button" aria-label="Hide" style="background:none;border:0;color:#ffe2a3;cursor:pointer;font-size:16px">✕</button>';
    b.querySelector('button').onclick = function () { b.remove(); };
    document.body.appendChild(b);
  }

  function check() {
    isLive().then(function (live) {
      if (live) return;
      if (location.protocol === 'file:') return show('This page was opened as a file, so it cannot reach the server. Open it through http://localhost:8000/ or VS Code Live Server ("Go Live"), then sign in.');
      if (!api) return show('The connection script did not load.');
      api.available().then(function (ok) {
        show(ok ? 'You are not signed in, so this page shows sample data. Please sign in to see live data and the newest features.'
                : 'The Yojo server is not running, so this page shows sample data. In VS Code run the task "Yojo: Start everything", then sign in.');
      });
    });
  }
  // the live scripts decide within a moment of loading; check after the page has settled
  if (document.readyState === 'complete') setTimeout(check, 1500); else window.addEventListener('load', function () { setTimeout(check, 1500); });
})();
