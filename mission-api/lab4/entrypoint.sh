#!/bin/sh
# Stage the site on the tmpfs and personalise it with this session's reference, then drop the variable.
set -e
mkdir -p /tmp/www
cp -r /site/. /tmp/www/
sed "s/__FLAG__/$LAB_CODE/g" /site/index.html > /tmp/www/index.html
unset LAB_CODE
exec nginx -g 'daemon off;'
