"""Owned desktop backend: authenticated loopback service and parent-pipe lifetime.
The parent sends one JSON boot record on stdin. EOF always terminates this process,
including during scientific imports. No image data or credentials are logged.
"""
import faulthandler
import hmac
import json
import multiprocessing
import os
import sys
import threading
import time

_BOOT_T0 = time.monotonic()
_TRACE_BOOT = os.environ.get('SURVEYAPPS_TRACE_BOOT') == '1'


def _trace(stage):
    if _TRACE_BOOT:
        elapsed = time.monotonic() - _BOOT_T0
        os.write(2, f'[boot +{elapsed:.3f}s] {stage}\n'.encode('utf-8'))


_trace('module_loaded')


def main():
    for stream, kwargs in (
        (sys.stdin, {'encoding': 'utf-8'}),
        (sys.stdout, {'encoding': 'utf-8', 'line_buffering': True}),
        (sys.stderr, {'encoding': 'utf-8', 'line_buffering': True}),
    ):
        if stream is not None and hasattr(stream, 'reconfigure'):
            try:
                stream.reconfigure(**kwargs)
            except Exception:
                pass

    _trace('waiting_stdin_boot')
    boot = json.loads(sys.stdin.readline())
    _trace('received_boot_json')
    token = boot.get('token', '')
    if len(token) < 32:
        raise ValueError('Missing desktop session credential')

    def watch_parent():
        while True:
            line = sys.stdin.readline()
            if not line or line.strip() == 'shutdown':
                os._exit(0)
    threading.Thread(target=watch_parent, daemon=True).start()
    _trace('watch_parent_started')

    if _TRACE_BOOT:
        faulthandler.dump_traceback_later(15, repeat=True, file=sys.stderr)

    from flask import request, abort, jsonify
    from werkzeug.serving import make_server, WSGIRequestHandler
    _trace('importing_microscopy_app')
    from microscopy_app import app
    _trace('imported_microscopy_app')
    if _TRACE_BOOT:
        faulthandler.cancel_dump_traceback_later()
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
    _trace('creating_server')
    server = make_server('127.0.0.1', 0, app.server, threaded=False, request_handler=QuietHandler)
    host[0] = f'127.0.0.1:{server.server_port}'
    _trace(f'ready_port_{server.server_port}')
    print(json.dumps({'event': 'ready', 'port': server.server_port}), flush=True)
    server.serve_forever()


if __name__ == '__main__':
    _trace('main_guard')
    multiprocessing.freeze_support()
    main()
