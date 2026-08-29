#!/usr/bin/env python3
# Local dev server that sends `Cache-Control: no-store` on every response, so the
# browser never hands back a stale editor/index.html from its HTTP disk cache —
# the recurring stale-code trap (a hard reload / SW-clear alone didn't dislodge
# it; see project_editor_playframe). Same-machine dev use only; production is
# served by the real host, not this.
#
# Usage: python3 dev-nocache-server.py [PORT] [DIR]
import sys, os, json, datetime, http.server, socketserver, functools

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8097
DIR  = sys.argv[2] if len(sys.argv) > 2 else '.'


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    # Force revalidation on everything so edits go live on a plain reload.
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()

    # POST /_freeze  → write the page's diagnostic to bug-reports/ and name it back.
    # WHY THIS EXISTS: the person testing this game plays it with his eyes and hands,
    # not with a JavaScript console. A freeze has to be reportable by clicking the
    # thing on screen; the machine does the capture. Dev server only — production
    # never sees this endpoint.
    def do_POST(self):
        if self.path != '/_freeze':
            self.send_error(404); return
        try:
            n = int(self.headers.get('Content-Length') or 0)
            body = self.rfile.read(n)
            outdir = os.path.join(DIR, 'bug-reports')
            os.makedirs(outdir, exist_ok=True)
            name = 'freeze-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S') + '.json'
            with open(os.path.join(outdir, name), 'wb') as f:
                f.write(body)
            msg = json.dumps({'saved': 'bug-reports/' + name}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)
            print('freeze report saved: bug-reports/' + name)
        except Exception as e:                      # never take the dev server down over a report
            self.send_error(500, str(e))


Handler = functools.partial(NoCacheHandler, directory=DIR)
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('', PORT), Handler) as httpd:
    print(f'no-cache dev server on http://localhost:{PORT} serving {DIR}')
    httpd.serve_forever()
