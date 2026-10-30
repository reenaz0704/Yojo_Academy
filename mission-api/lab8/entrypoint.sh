#!/bin/sh
set -e
mkdir -p /tmp/www/s3r3ct
cp -r /site/. /tmp/www/
printf '%s\n' "$LAB_CODE" > /tmp/www/s3r3ct/flag.txt
cat > /tmp/www/s3r3ct/index.html <<HTML
<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Internal</title></head>
<body><h1>Internal staging area</h1><p>This folder is not meant to be public. Reference: $LAB_CODE</p>
<p>See also <a href="flag.txt">flag.txt</a>.</p></body></html>
HTML
unset LAB_CODE
exec nginx -g 'daemon off;'
