FROM node:20-alpine AS deps
WORKDIR /app
COPY app/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM httpd:2.4-alpine
COPY --from=deps /usr/local/bin/node /usr/local/bin/node
COPY --from=deps /usr/lib/libstdc++.so.6* /usr/lib/libgcc_s.so.1 /usr/lib/
COPY --from=deps /app/node_modules /app/node_modules
COPY app/server.js /app/server.js
COPY app/public /app/public
COPY httpd.conf /etc/apache2/httpd.conf
COPY --chmod=755 entrypoint.sh /entrypoint.sh
USER 101:101
EXPOSE 8080
HEALTHCHECK --interval=3s --timeout=2s --retries=10 CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/entrypoint.sh"]
