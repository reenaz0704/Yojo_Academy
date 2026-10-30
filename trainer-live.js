/* Yojo Trainer console: LIVE mode. Loaded instead of trainer.js; it decides whether the real API is reachable and then
   loads trainer.js. With the API and a signed-in trainer (GET /me, cookie session, MFA done at login),
   window.YojoLiveTrainer carries the user and the server calls below, and trainer.js swaps in its live pages.
   Without the API the console stays in demo mode exactly as before. */
(function () {
  'use strict';
  var api = window.YojoAPI;
  function boot() { var s = document.createElement('script'); s.src = 'trainer.js'; document.body.appendChild(s); }
  if (!api) return boot();

  var get = api.get, post = api.post, patch = api.patch;
  var put = function (p, b) { return api.raw('PUT', p, b || {}); };
  var del = function (p) { return api.raw('DELETE', p); };
  var day = function (offset) { return new Date(Date.now() + 5.5 * 36e5 + offset * 864e5).toISOString().slice(0, 10); }; // IST date

  var calls = {
    dashboard: function () { return get('/trainer/dashboard'); },
    batches: function () { return get('/trainer/batches').then(function (r) { return r.items; }); },
    overview: function (id) { return get('/trainer/batches/' + id + '/overview'); },
    // Sessions from 30 days back to 31 days ahead (the server allows 62 days per call).
    sessions: function () { return get('/trainer/sessions?from=' + day(-30) + '&to=' + day(31)); },
    createSession: function (o) { return post('/trainer/sessions', o); },
    updateSession: function (id, o) { return patch('/trainer/sessions/' + id, o); },
    roster: function (id) { return get('/trainer/sessions/' + id + '/attendance'); },
    mark: function (id, marks, reason) { return put('/trainer/sessions/' + id + '/attendance', reason ? { marks: marks, reason: reason } : { marks: marks }); },
    leave: function () { return get('/trainer/leave-requests'); },
    decideLeave: function (id, approve, note) { return post('/trainer/leave-requests/' + id + '/decide', note ? { approve: approve, note: note } : { approve: approve }); },
    requests: function () { return get('/trainer/session-requests'); },
    decideRequest: function (id, o) { return post('/trainer/session-requests/' + id + '/decide', o); },
    slots: function () { return get('/trainer/slots'); },
    addSlot: function (o) { return post('/trainer/slots', o); },
    removeSlot: function (id) { return del('/trainer/slots/' + id); },
    mockResult: function (id, o) { return post('/trainer/session-requests/' + id + '/mock-result', o); },
    conversations: function () { return get('/trainer/conversations'); },
    thread: function (id) { return get('/trainer/conversations/' + id); },
    reply: function (id, body) { return post('/trainer/conversations/' + id + '/messages', { body: body }); },
    assessments: function () { return get('/trainer/assessments'); },
    setAssessmentStatus: function (id, status) { return post('/trainer/assessments/' + id + '/status', { status: status }); },
    release: function (id) { return post('/trainer/assessments/' + id + '/release'); },
    submissions: function (id) { return get('/trainer/assessments/' + id + '/submissions'); },
    grade: function (attemptId, o) { return post('/trainer/attempts/' + attemptId + '/grade', o); },
    reviews: function () { return get('/trainer/placement/reviews'); },
    reviewResume: function (studentId, o) { return post('/trainer/resumes/' + studentId + '/review', o); },
    reviewProject: function (id, o) { return post('/trainer/portfolio/' + id + '/review', o); },
    verifyMilestone: function (studentId, milestoneId, o) { return post('/trainer/milestones/' + studentId + '/' + milestoneId + '/verify', o); },
    courses: function () { return get('/trainer/courses'); },
    course: function (id) { return get('/trainer/courses/' + id); },
    // course builder (owner, 29 Oct): create, details, publish, batches, co-editors, students
    courseBatches: function () { return get('/trainer/course-batches'); },
    createCourse: function (o) { return post('/trainer/courses', o); },
    patchCourse: function (id, o) { return patch('/trainer/courses/' + id, o); },
    publishCourse: function (id) { return post('/trainer/courses/' + id + '/publish', {}); },
    unpublishCourse: function (id, why) { return post('/trainer/courses/' + id + '/unpublish', why); },
    assignBatches: function (id, ids) { return post('/trainer/courses/' + id + '/batches', { batchIds: ids }); },
    unassignBatch: function (id, bid) { return api.raw('DELETE', '/trainer/courses/' + id + '/batches/' + bid); },
    addCoEditor: function (id, email) { return post('/trainer/courses/' + id + '/co-editors', { email: email }); },
    removeCoEditor: function (id, uid) { return api.raw('DELETE', '/trainer/courses/' + id + '/co-editors/' + uid); },
    courseStudents: function (id) { return get('/trainer/courses/' + id + '/students'); },
    files: function (id) { return get('/trainer/courses/' + id + '/files'); },
    announcements: function () { return get('/trainer/announcements'); },
    announce: function (batchId, o) { return post('/trainer/batches/' + batchId + '/announcements', o); },
    removeFile: function (fid, why) { return api.raw('DELETE', '/trainer/files/' + fid, why && why.reasonCode ? why : {}); },
    addModule: function (cid, o) { return post('/trainer/courses/' + cid + '/modules', o); },
    patchModule: function (id, o) { return patch('/trainer/modules/' + id, o); },
    deleteModule: function (id, why) { return api.raw('DELETE', '/trainer/modules/' + id, why); },
    addLesson: function (mid, o) { return post('/trainer/modules/' + mid + '/lessons', o); },
    patchLesson: function (id, o) { return patch('/trainer/lessons/' + id, o); },
    deleteLesson: function (id, why) { return api.raw('DELETE', '/trainer/lessons/' + id, why); },
    addFaq: function (cid, o) { return post('/trainer/courses/' + cid + '/faqs', o); },
    patchFaq: function (id, o) { return patch('/trainer/faqs/' + id, o); },
    deleteFaq: function (id, why) { return api.raw('DELETE', '/trainer/faqs/' + id, why); },
    // trainer desk (26 Oct): student 360, remarks, admin requests, Lab Monitor, new messages, outcomes, feedback
    student: function (id) { return get('/trainer/students/' + id); },
    addRemark: function (sid, o) { return post('/trainer/students/' + sid + '/remarks', o); },
    editRemark: function (id, text) { return patch('/trainer/remarks/' + id, { text: text }); },
    raise: function (sid, o) { return post('/trainer/students/' + sid + '/requests', o); },
    labs: function (bid) { return get('/trainer/labs' + (bid ? '?batchId=' + bid : '')); },
    nudge: function (o) { return post('/trainer/labs/nudge', o); },
    startConversation: function (o) { return post('/trainer/conversations', o); },
    outcome: function (id, o) { return post('/trainer/session-requests/' + id + '/outcome', o); },
    feedback: function (page, rating) { return get('/trainer/feedback?page=' + (page || 1) + (rating ? '&rating=' + rating : '')); },
    assessment: function (id) { return get('/trainer/assessments/' + id); },
    createAssessment: function (o) { return post('/trainer/assessments', o); },
    addQuestion: function (id, o) { return post('/trainer/assessments/' + id + '/questions', o); },
    deleteQuestion: function (id) { return del('/trainer/questions/' + id); },
    extend: function (id, o) { return post('/trainer/assessments/' + id + '/extensions', o); },
    report: function (id) { return get('/trainer/assessments/' + id + '/report'); },
    notifications: function () { return get('/me/notifications?limit=30'); },
    readAll: function () { return post('/me/notifications/read-all'); },
    read: function (id) { return post('/me/notifications/' + id + '/read'); },
  };

  api.available().then(function (ok) {
    if (!ok) return boot();
    return api.init().then(function () { return api.me(); }).then(function (me) {
      window.YojoLiveTrainer = {
        user: me.role === 'trainer' && me.sessionScope === 'full' ? me : null,
        api: calls,
        logout: function () { return api.logout().catch(function () {}); },
      };
    }, function () { window.YojoLiveTrainer = { user: null, api: calls, logout: function () { return Promise.resolve(); } }; }).then(boot);
  });
})();
