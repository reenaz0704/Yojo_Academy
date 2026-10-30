#!/bin/sh
# Stage the site on the tmpfs, point the Submit Solution button at the Academy, publish the training feed for the target domain.
set -e
mkdir -p /tmp/www/feed
cp -r /site/. /tmp/www/
for f in /tmp/www/*.html; do sed -i "s|__ACADEMY_URL__|$ACADEMY_URL|g" "$f"; done
printf '%s\n' "$SUBDOMAINS" | tr ',' '\n' | sed "s/\$/.$TARGET_DOMAIN/" > "/tmp/www/feed/$TARGET_DOMAIN.txt"
exec nginx -g 'daemon off;'
