FROM nginx:latest
COPY nginx.conf /etc/nginx/nginx.conf
COPY site/ /usr/share/nginx/html/
USER 101
EXPOSE 8080
HEALTHCHECK --interval=3s --timeout=2s --retries=10 CMD curl -fs http://127.0.0.1:8080/healthz || exit 1
CMD ["nginx", "-g", "daemon off;"]
