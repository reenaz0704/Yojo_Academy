// Yojo Coffee Roasters website: a small Express app (behind Apache httpd) serving static pages.
const express = require('express'), path = require('path');
const app = express();
const pub = path.join(__dirname, 'public');
app.use(express.urlencoded({ extended: false, limit: '4kb' }));
app.get('/healthz', (req, res) => res.type('text').send('ok'));
app.post(['/contact', '/subscribe'], (req, res) => res.redirect(303, '/thanks.html'));
app.use(express.static(pub, { extensions: ['html'] }));
app.listen(3000, '127.0.0.1');
