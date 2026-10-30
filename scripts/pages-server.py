"""Local pages server for development: serves a folder on 127.0.0.1 and tells browsers never to reuse an old copy,
so every edit shows on a normal refresh. Usage: python pages_server.py <folder> [port]"""
import functools, http.server, sys

root = sys.argv[1]
port = int(sys.argv[2]) if len(sys.argv) > 2 else 8000


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()


http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(NoCache, directory=root)).serve_forever()
