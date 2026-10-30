FROM python:3.12-slim
RUN pip install --no-cache-dir Pillow==11.0.0 && useradd -u 101 -m lab
COPY server.py /app/server.py
USER 101:101
EXPOSE 8080
HEALTHCHECK --interval=3s --timeout=2s --retries=15 CMD python3 -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8080/healthz',timeout=2)" || exit 1
CMD ["python3", "/app/server.py"]
