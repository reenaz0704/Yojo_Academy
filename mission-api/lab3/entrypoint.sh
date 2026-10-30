#!/bin/sh
node /app/server.js &
exec httpd -DFOREGROUND -f /etc/apache2/httpd.conf
