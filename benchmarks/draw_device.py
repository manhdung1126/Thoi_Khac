"""Temporary LAN server for human Draw measurements; never exhibition storage.

Run: .venv/bin/python benchmarks/draw_device.py
Stop with Ctrl+C. Export results before stopping: temporary drawings are deleted.
"""
import argparse
import os
import re
import secrets
import signal
import socket
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def instrument_source(source):
    """Response-only decorators, like browser.mjs. Fail loudly on source drift."""
    replacements = [
        ("canvas.addEventListener('pointerdown',event=>{", """
audit.bindCanvas(canvas,()=>({strokes:strokes.length,undo:undo.length,redo:redo.length,busy}));
render=audit.wrap(render,'render');
renderActive=audit.wrap(renderActive,'render_active');
changed=audit.wrap(changed,'changed');
persist=audit.wrap(persist,'draft');
updateButtons=audit.wrap(updateButtons,'ui');
finish=audit.finish(finish,()=>active);
request=audit.request(request);
canvas.addEventListener('pointerdown',event=>{"""),
        ("JSON.stringify(submissionPayload(strokes))", "audit.measure('submit_payload_json',()=>JSON.stringify(audit.measure('submit_payload_transform',()=>submissionPayload(strokes))))"),
        ("strokes=[];undo=[];redo=[];active=null;erasing=false;render();selectPen();changed();status('Đã khắc", "audit.measure('clear_after_submit',()=>{strokes=[];undo=[];redo=[];active=null;erasing=false;render();selectPen();changed();});status('Đã khắc"),
    ]
    for before, after in replacements:
        if source.count(before) != 1:
            raise ValueError(f'Draw audit anchor changed: {before}')
        source = source.replace(before, after)
    alpha = 'context.getImageData(0,0,canvas.width,canvas.height).data.some((v,i)=>i%4===3&&v>0)'
    if source.count(alpha) != 2:
        raise ValueError('Draw alpha-check audit anchors changed')
    source = source.replace(alpha, "audit.alphaCheck(audit.measure('canvas_readback',()=>context.getImageData(0,0,canvas.width,canvas.height)).data,(v,i)=>i%4===3&&v>0)")
    return "import {startAudit} from '/__draw_audit__/device-audit.js';\nconst audit=startAudit();\n" + source


def create_test_app(directory):
    # Set before importing main: its default app also must never open live data.
    previous = os.environ.get('CLOUD_STORAGE_DIR')
    os.environ['CLOUD_STORAGE_DIR'] = str(directory)
    try:
        from backend.app.main import create_app
    finally:
        if previous is None:
            os.environ.pop('CLOUD_STORAGE_DIR', None)
        else:
            os.environ['CLOUD_STORAGE_DIR'] = previous
    from starlette.responses import Response
    app = create_app(directory)
    draw = ROOT / 'frontend' / 'draw'
    measured_source = instrument_source((draw / 'app.js').read_text())
    html = (draw / 'index.html').read_text()
    html, count = re.subn(r'src="app\.js\?[^\"]+"', 'src="app.js?perf=1"', html)
    if count != 1:
        raise ValueError('Draw audit module entry changed')
    html = html.replace('<title>', '<title>[TEST] ')

    @app.middleware('http')
    async def audit_response(request, call_next):
        path = request.url.path
        if path == '/__draw_audit__/device-audit.js':
            return Response((ROOT / 'benchmarks' / 'device-audit.js').read_text(), media_type='text/javascript', headers={'Cache-Control': 'no-store'})
        if request.query_params.get('perf') == '1':
            if path in ('/draw/', '/draw/index.html'):
                return Response(html, media_type='text/html', headers={'Cache-Control': 'no-store'})
            if path == '/draw/app.js':
                return Response(measured_source, media_type='text/javascript', headers={'Cache-Control': 'no-store'})
        return await call_next(request)
    return app


def lan_address():
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as connection:
        connection.connect(('192.0.2.1', 9))  # Routing lookup; no UDP payload sent.
        return connection.getsockname()[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', help='LAN interface IP; default: current routed interface')
    parser.add_argument('--port', type=int, default=0, help='Default: OS-selected unused port; never 8000')
    args = parser.parse_args()
    if args.port == 8000:
        parser.error('Port 8000 is reserved for the exhibition server.')
    import uvicorn
    with tempfile.TemporaryDirectory(prefix='cos-device-audit-') as directory:
        os.environ['CLOUD_STORAGE_DIR'] = directory
        os.environ['CLOUD_ADMIN_PIN'] = f'{secrets.randbelow(1000000):06d}'
        app = create_test_app(directory)
        host = args.host or lan_address()
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind((host, args.port)); listener.listen(128)
            port = listener.getsockname()[1]
            print(f'\nDRAW DEVICE AUDIT — temporary storage only\nhttp://{host}:{port}/draw/?perf=1\n'
                  f'Normal comparison: http://{host}:{port}/draw/\n'
                  f'Temporary admin PIN: {os.environ["CLOUD_ADMIN_PIN"]}\n'
                  f'Storage: {directory}\nExport results, then Ctrl+C to stop and remove test drawings.\n', flush=True)
            # Uvicorn re-raises SIGTERM after shutdown. Turn that into a Python
            # exception so TemporaryDirectory also cleans up on session stop.
            previous = signal.signal(signal.SIGTERM, signal.default_int_handler)
            try:
                uvicorn.Server(uvicorn.Config(app, host=host, port=port)).run(sockets=[listener])
            except KeyboardInterrupt:
                pass
            finally:
                signal.signal(signal.SIGTERM, previous)


if __name__ == '__main__':
    main()
