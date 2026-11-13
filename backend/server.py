"""Owned desktop backend: authenticated loopback service and parent-pipe lifetime.
The parent sends one JSON boot record on stdin. EOF always terminates this process,
including during scientific imports. No image data or credentials are logged.
"""
import json
import os
import sys
import threading
import hmac


def main():
    boot = json.loads(sys.stdin.readline())
    token = boot.get('token', '')
    if len(token) < 32:
        raise ValueError('Missing desktop session credential')

    def watch_parent():
        for line in sys.stdin:
            if line.strip() == 'shutdown':
                os._exit(0)
        os._exit(0)
    threading.Thread(target=watch_parent, daemon=True).start()

    from flask import request, abort, jsonify
    from werkzeug.serving import make_server, WSGIRequestHandler
    from microscopy_app import app
    app.server.config['MAX_CONTENT_LENGTH'] = 256 * 1024 * 1024

    @app.server.before_request
    def authorize():
        if request.host != host[0]:
            abort(403)
        supplied = request.headers.get('X-SurveyApps-Key', '')
        if not hmac.compare_digest(supplied, token):
            abort(403)
        origin = request.headers.get('Origin')
        if origin and origin not in ('surveyapps://app', 'http://' + host[0]):
            abort(403)

    @app.server.after_request
    def secure(response):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Content-Security-Policy'] = (
            "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
            "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
            "font-src 'self' data:; connect-src 'self'; frame-ancestors surveyapps://app; "
            "object-src 'none'; base-uri 'self'")
        return response

    @app.server.get('/health')
    def health():
        return jsonify(status='ready', service='SurveyApps!')

    class QuietHandler(WSGIRequestHandler):
        def log_request(self, *args, **kwargs):
            pass

    host = ['']
    # Port zero is atomically bound by the OS; never reserve then release a port.
    # One request at a time preserves the upstream module's single-session state.
    server = make_server('127.0.0.1', 0, app.server, threaded=False, request_handler=QuietHandler)
    host[0] = f'127.0.0.1:{server.server_port}'
    print(json.dumps({'event': 'ready', 'port': server.server_port}), flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
