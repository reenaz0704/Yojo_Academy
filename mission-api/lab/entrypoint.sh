#!/bin/sh
# Publish this session's one-time checkpoint code (from the trusted backend) on the tmpfs, then run nginx.
printf '%s\n' "$LAB_CODE" > /usr/share/nginx/html/lab/code.txt
exec nginx -g 'daemon off;'
