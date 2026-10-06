"""Exhibition API: durable state, server-generated SVG drawings and one live stage."""
import asyncio
import copy
import hashlib
import hmac
import io
import json
import math
import os
import secrets
import tempfile
import threading
import time
import warnings
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError
from backend.app import led, ending

ROOT = Path(__file__).resolve().parents[1]
VECTOR_LIMIT = 2 * 1024 * 1024
SNAPSHOT_LIMIT = 10 * 1024 * 1024


class FrontendFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        # Revalidate code, including conditional 304 replies. Keep image/font caching.
        if Path(path).suffix in ('', '.html', '.js', '.css'):
            response.headers['Cache-Control'] = 'no-cache'
        return response


def identifier(value):
    try:
        return UUID(str(value)).hex
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(422, "Mã không hợp lệ.")


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def decode_png(data, *, crop=True, limit=SNAPSHOT_LIMIT):
    if len(data) > limit:
        raise HTTPException(413, "Ảnh vượt quá dung lượng cho phép.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                if image.format != "PNG":
                    raise ValueError("not PNG")
                if image.width > 4096 or image.height > 4096 or image.width * image.height > 8_400_000:
                    raise HTTPException(413, "Ảnh có kích thước quá lớn (tối đa 4096px và 8,4 triệu pixel).")
                image.verify()
            with Image.open(io.BytesIO(data)) as image:
                image.load()
                rgba = image.convert("RGBA")
            bounds = rgba.getchannel("A").getbbox()
            if not bounds:
                raise HTTPException(422, "Ảnh trống. Hãy vẽ một nét trước khi gửi.")
            if crop:
                left, top, right, bottom = bounds
                rgba = rgba.crop((max(0, left - 10), max(0, top - 10), min(rgba.width, right + 10), min(rgba.height, bottom + 10)))
            clean = Image.new("RGBA", rgba.size)
            clean.paste(rgba)
            output = io.BytesIO()
            clean.save(output, format="PNG")
            return output.getvalue(), clean.width, clean.height
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(422, "PNG không hợp lệ hoặc bị hỏng. Hãy xuất lại ảnh.")


def new_page(state):
    page = {"id": uuid4().hex, "name": f"Trang {len(state['pages']) + 1:02d}", "items": []}
    led.ensure_cells(page)
    state["pages"].append(page)
    state["current_page_id"] = page["id"]
    return page


def current_page(state):
    return next(page for page in state["pages"] if page["id"] == state["current_page_id"])


def page_by_id(state, page_id):
    page = next((page for page in state["pages"] if page["id"] == identifier(page_id)), None)
    if page is None:
        raise HTTPException(404, "Không tìm thấy trang.")
    return page


def add_item(state, drawing_id):
    led.assign(current_page(state), drawing_id, paused=state['settings']['paused'] or bool(state.get('ending')))


class Store:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.path = self.directory / "state.json"
        self.tokens = set()
        self.login_attempts = {}
        self.ending_ready = {}
        if self.path.exists():
            # A corrupt state is an explicit startup error, never a silent reset.
            self.state = json.loads(self.path.read_text())
        else:
            self.state = {"revision": 0, "settings": {"rotation_seconds": 8, "paused": False, "led_fade": 1.2}, "pages": [], "current_page_id": "", "drawings": [], "snapshots": [], "submissions": {}}
            new_page(self.state)
            for path in sorted((self.directory / "drawings").glob("*.svg"), key=lambda value: value.stat().st_mtime):
                if path.is_symlink():
                    continue
                try:
                    drawing_id = identifier(path.stem)
                    if path.stem != drawing_id:
                        continue
                    vector_path = self.directory / "vectors" / f"{drawing_id}.json"
                    vectors = led.validate_vectors(vector_path.read_text())
                    if not vectors:
                        continue
                    self.state["drawings"].append({"id": drawing_id, "image_path": f"/api/drawings/{drawing_id}", "vector_path": f"/api/strokes/{drawing_id}", "created_at": path.stat().st_mtime, "width": 720, "height": 720, "deleted": False, "favorite": False})
                    add_item(self.state, drawing_id)
                except (HTTPException, OSError, UnicodeError):
                    continue
            self.commit(self.state)
        # One-time migration from pre-LED states into the finalized cell schema.
        changed = False
        settings = self.state.setdefault("settings", {})
        finalized = {
            "rotation_seconds": settings.get("rotation_seconds", 8),
            "paused": settings.get("paused", False),
            "led_fade": settings.get("led_fade", 1.2),
        }
        if settings != finalized:
            self.state["settings"] = finalized
            changed = True
        if self.state.pop("saves", None) is not None:
            changed = True
        now = time.time()
        created = {d['id']: d.get('created_at', now) for d in self.state['drawings']}
        for page in self.state["pages"]:
            if "cells" not in page:
                led.ensure_cells(page)
                changed = True
            for cell in page['cells']:
                if cell.get('active') and cell.get('shown_at') is None:
                    # Recover independent phases from original arrivals for legacy data.
                    cell['shown_at'] = now - ((now - created.get(cell['active'], now)) % finalized['rotation_seconds'])
                    changed = True
            if (page['id'] != self.state['current_page_id'] or finalized['paused']) and 'timer_paused_at' not in page:
                page['timer_paused_at'] = now
                changed = True
        for drawing in self.state["drawings"]:
            if "favorite" not in drawing:
                drawing["favorite"] = False
                changed = True
        if changed:
            self.commit(self.state)
        (self.directory / "favorites").mkdir(exist_ok=True)
        for drawing in self.state["drawings"]:
            source = self.directory / "drawings" / f"{drawing['id']}.svg"
            target = self.directory / "favorites" / source.name
            if drawing.get("favorite") and source.is_file() and not target.exists():
                atomic_write(target, source.read_bytes())

    def commit(self, state):
        atomic_write(self.path, json.dumps(state, ensure_ascii=False, allow_nan=False).encode())
        self.state = state

    def public(self):
        with self.lock:
            state = copy.deepcopy(self.state)
            # Items are a derived presentation view; keep persisted cell queues
            # and independent carousel clocks unchanged when geometry changes.
            for page in state['pages']:
                led.sync_items(page)
            state.pop("submissions", None)
            state["server_time"] = time.time()
            if state.get("ending"):
                active = state["ending"]
                active["ready_displays"] = [client for client, seen in self.ending_ready.get(active["id"], {}).items() if time.time() - seen < 45]
                if active.get("start_time") and state["server_time"] >= active["start_time"] + active["duration"]:
                    active["phase"] = "LOCKED"
            return state

    def mutate(self, callback):
        with self.lock:
            state = copy.deepcopy(self.state)
            result = callback(state)
            now = time.time()
            for page in state['pages']:
                running = page['id'] == state['current_page_id'] and not state['settings']['paused'] and not state.get('ending')
                if not running:
                    page.setdefault('timer_paused_at', now)
                elif 'timer_paused_at' in page:
                    paused_at = page.pop('timer_paused_at')
                    for cell in page['cells']:
                        if cell.get('shown_at') is not None:
                            cell['shown_at'] += now - max(paused_at, cell['shown_at'])
            state["revision"] += 1
            self.commit(state)
            return result

    def drawing(self, state, drawing_id, active=True):
        drawing = next((item for item in state["drawings"] if item["id"] == drawing_id), None)
        if not drawing or (active and drawing["deleted"]):
            raise HTTPException(404, "Không tìm thấy nét vẽ.")
        return drawing

    def upload(self, submission_id, vectors):
        vector_bytes = json.dumps(vectors, separators=(',', ':')).encode()
        digest = hashlib.sha256(vector_bytes).hexdigest()
        with self.lock:
            previous = self.state["submissions"].get(submission_id)
            if previous:
                if previous["digest"] != digest:
                    raise HTTPException(409, "Mã lần gửi đã dùng cho nội dung khác.")
                return copy.deepcopy(self.drawing(self.state, previous["id"], active=False)), False
            drawing_id = uuid4().hex
            image_path = self.directory / "drawings" / f"{drawing_id}.svg"
            vector_path = self.directory / 'vectors' / f'{drawing_id}.json'
            drawing = {"id": drawing_id, "image_path": f"/api/drawings/{drawing_id}", "vector_path": f'/api/strokes/{drawing_id}', "created_at": time.time(), "width": 720, "height": 720, "deleted": False, "favorite": False}
            def save(state):
                state["drawings"].append(drawing)
                state["submissions"][submission_id] = {"id": drawing_id, "digest": digest}
                add_item(state, drawing_id)
            try:
                atomic_write(image_path, led.svg_document(vectors))
                atomic_write(vector_path, vector_bytes)
                self.mutate(save)
            except Exception:
                for path in (image_path, vector_path):
                    # Attempt both cleanups without masking the original storage error.
                    with suppress(OSError):
                        path.unlink(missing_ok=True)
                raise
            return drawing, True

    def rotate(self):
        with self.lock:
            settings = self.state["settings"]
            if settings['paused'] or self.state.get('ending'):
                return False
            now = time.time()
            page = current_page(self.state)
            if not any(len(cell['drawing_ids']) > 1 and now - cell.get('shown_at', now) >= settings['rotation_seconds'] for cell in page.get('cells', [])):
                return False
            self.mutate(lambda state: led.rotate(current_page(state), settings['rotation_seconds'], now))
            return True


class BodyLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in {"POST", "PATCH", "PUT"}:
            return await self.app(scope, receive, send)
        path = scope["path"]
        limit = {"/api/drawings": VECTOR_LIMIT, "/api/snapshots": SNAPSHOT_LIMIT + 65536, "/api/ending/prepare": 256 * 1024}.get(path, 65536)
        headers = dict(scope["headers"])
        try:
            length = int(headers.get(b"content-length", b"0"))
        except ValueError:
            length = limit + 1
        if length > limit:
            return await JSONResponse({"detail": "Tệp gửi lên quá lớn."}, 413)(scope, receive, send)
        count = 0
        async def limited_receive():
            nonlocal count
            message = await receive()
            count += len(message.get("body", b""))
            if count > limit:
                raise HTTPException(413, "Tệp gửi lên quá lớn.")
            return message
        await self.app(scope, limited_receive, send)


def create_app(storage_path=None):
    store = Store(storage_path or os.getenv("CLOUD_STORAGE_DIR", ROOT / "storage"))
    connections = set()

    async def broadcast():
        async def notify(connection):
            try:
                await asyncio.wait_for(connection.send_json({"type": "state_changed", "revision": store.state["revision"]}), 2)
            except (RuntimeError, OSError, TimeoutError, WebSocketDisconnect):
                connections.discard(connection)
        await asyncio.gather(*(notify(connection) for connection in list(connections)))

    @asynccontextmanager
    async def lifespan(app):
        async def tick():
            while True:
                await asyncio.sleep(.5)
                try:
                    if store.rotate():
                        await broadcast()
                except OSError:
                    pass  # State remains the last successfully persisted version.
        worker = asyncio.create_task(tick())
        yield
        worker.cancel()
        with suppress(asyncio.CancelledError):
            await worker
        for connection in list(connections):
            with suppress(RuntimeError, OSError):
                await connection.close()

    app = FastAPI(title="Cloud of Strokes", version="1.0.0", lifespan=lifespan)
    app.state.store = store
    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(CORSMiddleware, allow_origins=["http://127.0.0.1:4173", "http://localhost:4173"], allow_methods=["*"], allow_headers=["*"])

    @app.exception_handler(OSError)
    async def storage_error(request, exception):
        return JSONResponse({"detail": "Không thể lưu dữ liệu. Kiểm tra dung lượng hoặc quyền ghi trên máy server."}, 507)

    def require_admin(request):
        token = request.headers.get("authorization", "").removeprefix("Bearer ")
        if token not in store.tokens:
            raise HTTPException(401, "Hãy đăng nhập bàn điều khiển.")

    async def body_object(request):
        try:
            body = await request.json()
        except (ValueError, UnicodeDecodeError):
            raise HTTPException(422, "Dữ liệu không hợp lệ.")
        if not isinstance(body, dict):
            raise HTTPException(422, "Dữ liệu phải là một đối tượng.")
        return body

    @app.get("/api/health")
    def health():
        return {"status": "ok", "service": "cloud-of-strokes-api"}

    @app.get("/api/state")
    def state():
        return store.public()

    @app.post("/api/admin/login")
    async def login(request: Request):
        body = await body_object(request)
        address = request.client.host if request.client else "local"
        recent = [timestamp for timestamp in store.login_attempts.get(address, []) if time.time() - timestamp < 60]
        if len(recent) >= 10:
            raise HTTPException(429, "Thử lại sau một phút.")
        if not hmac.compare_digest(str(body.get("pin", "")), os.getenv("CLOUD_ADMIN_PIN", "2468")):
            store.login_attempts[address] = recent + [time.time()]
            raise HTTPException(401, "Mã quản lý chưa đúng.")
        token = secrets.token_urlsafe(32)
        store.tokens.add(token)
        return {"token": token}

    @app.post("/api/drawings", status_code=201)
    async def upload(submission_id: str = Form(...), strokes: str = Form(...)):
        vectors = led.validate_vectors(strokes)
        if not vectors:
            raise HTTPException(422, "Bản vẽ phải có ít nhất một nét hợp lệ.")
        result, created = store.upload(identifier(submission_id), vectors)
        if created:
            await broadcast()
        return {**result, "replayed": not created}

    @app.get("/api/drawings")
    def drawings():
        return [drawing for drawing in store.public()["drawings"] if not drawing["deleted"]]

    @app.get('/api/strokes/{drawing_id}')
    def drawing_vectors(drawing_id: str):
        drawing_id = identifier(drawing_id)
        store.drawing(store.state, drawing_id, active=False)
        path = store.directory / 'vectors' / f'{drawing_id}.json'
        if not path.is_file() or path.is_symlink():
            raise HTTPException(404, 'Hình cũ không có dữ liệu đường nét.')
        return FileResponse(path, media_type='application/json')

    @app.get("/api/drawings/{drawing_id}")
    def drawing_file(drawing_id: str):
        drawing_id = identifier(drawing_id)
        store.drawing(store.state, drawing_id, active=False)
        path = store.directory / "drawings" / f"{drawing_id}.svg"
        if not path.is_file() or path.is_symlink():
            raise HTTPException(404, "Không tìm thấy ảnh.")
        return FileResponse(path, media_type="image/svg+xml", headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})

    @app.get("/api/media/{filename}")
    def media_file(filename: str):
        known = {Path(item["image_path"]).name for item in store.state["snapshots"]}
        if filename not in known:
            raise HTTPException(404, "Không tìm thấy tệp.")
        path = store.directory / "snapshots" / filename
        if not path.is_file() or path.is_symlink():
            raise HTTPException(404, "Không tìm thấy tệp.")
        return FileResponse(path)

    @app.get("/api/favorites/{drawing_id}")
    def favorite_file(drawing_id: str):
        drawing_id = identifier(drawing_id)
        path = store.directory / "favorites" / f"{drawing_id}.svg"
        if not path.is_file() or path.is_symlink():
            raise HTTPException(404, "Không tìm thấy bản SVG yêu thích.")
        return FileResponse(path, media_type="image/svg+xml", filename=f"{drawing_id}.svg")

    @app.post("/api/snapshots", status_code=201)
    async def snapshot(request: Request, snapshot: UploadFile = File(...), name: str = Form("Khoảnh khắc"), layout: str = Form("")):
        require_admin(request)
        try:
            data = await snapshot.read(SNAPSHOT_LIMIT + 1)
        finally:
            await snapshot.close()
        clean, width, height = decode_png(data, crop=False, limit=SNAPSHOT_LIMIT)
        snapshot_id = uuid4().hex
        item = {"id": snapshot_id, "name": name.strip()[:80] or "Khoảnh khắc", "image_path": f"/api/media/{snapshot_id}.png", "created_at": time.time()}
        try:
            selected = json.loads(layout) if layout else None
            if selected is not None and (not isinstance(selected, list) or len(selected) != 27 or any(x is not None and not isinstance(x, str) for x in selected)):
                raise ValueError()
        except (ValueError, TypeError):
            raise HTTPException(422, "Bố cục cần đủ 27 ô.")
        atomic_write(store.directory / "snapshots" / f"{snapshot_id}.png", clean)
        def save_moment(state):
            ids = selected if selected is not None else [c["active"] for c in current_page(state)["cells"]]
            active_page = state["current_page_id"]
            page = new_page(state)
            page["name"] = item["name"]
            state["current_page_id"] = active_page
            for index, drawing_id in enumerate(ids):
                if drawing_id is not None:
                    drawing_id = identifier(drawing_id)
                    store.drawing(state, drawing_id)
                    led.assign(page, drawing_id, index)
            item["page_id"] = page["id"]
            state["snapshots"].append(item)
        try:
            store.mutate(save_moment)
        except Exception:
            (store.directory / "snapshots" / f"{snapshot_id}.png").unlink(missing_ok=True)
            raise
        await broadcast()
        return item

    @app.post("/api/ending/prepare")
    async def prepare_ending(request: Request):
        require_admin(request)
        body = await body_object(request)
        request_id = identifier(body.get("request_id"))
        def prepare(state):
            if state.get("ending", {}).get("request_id") == request_id:
                return
            ending.prepare(state, body, store.directory)
            state["ending"]["request_id"] = request_id
        store.mutate(prepare)
        await broadcast()
        return store.public()

    @app.post("/api/ending/{ending_id}/ready")
    async def ready_ending(ending_id: str, request: Request):
        # Display reports readiness only; it cannot start/reset an exhibition.
        body = await body_object(request)
        client_id = identifier(body.get("client_id"))
        with store.lock:
            active = store.state.get("ending")
            if not active or active["id"] != identifier(ending_id):
                raise HTTPException(409, "Ending đã thay đổi.")
            clients = store.ending_ready.setdefault(active["id"], {})
            expired = [key for key, seen in clients.items() if time.time() - seen >= 45]
            for key in expired:
                clients.pop(key)
            if body.get("ready") is True:
                if len(clients) >= 32 and client_id not in clients:
                    raise HTTPException(429, "Quá nhiều màn chiếu.")
                clients[client_id] = time.time()
            else:
                clients.pop(client_id, None)
        await broadcast()
        return {"ok": True}

    @app.post("/api/ending/{ending_id}/start")
    async def start_ending(ending_id: str, request: Request):
        require_admin(request)
        def start(state):
            active = state.get("ending")
            if not active or active["id"] != identifier(ending_id):
                raise HTTPException(409, "Ending đã thay đổi.")
            if active.get("start_time") is not None:
                return
            if not any(time.time() - seen < 45 for seen in store.ending_ready.get(active["id"], {}).values()):
                raise HTTPException(409, "Mở Display và đợi màn chiếu tải đủ nét trước khi bắt đầu.")
            active["phase"] = "CONVERGE"
            active["start_time"] = time.time() + 2
        store.mutate(start)
        await broadcast()
        return store.public()

    @app.post("/api/ending/{ending_id}/reset")
    async def reset_ending(ending_id: str, request: Request):
        require_admin(request)
        def reset(state):
            active = state.get("ending")
            if active and active["id"] != identifier(ending_id):
                raise HTTPException(409, "Ending đã thay đổi.")
            state.pop("ending", None)
        store.mutate(reset)
        store.ending_ready.clear()
        await broadcast()
        return store.public()

    @app.api_route("/api/{operation:path}", methods=["POST", "PATCH", "DELETE"])
    async def control(operation: str, request: Request):
        require_admin(request)
        body = await body_object(request) if request.method != "DELETE" else {}
        parts = operation.split("/")
        files_to_delete = []
        def change(state):
            active_ending = state.get("ending")
            if active_ending and ((parts[0] == "pages" and parts[-1] == "activate") or
                (parts[0] == "pages" and len(parts) == 2 and request.method == "DELETE" and parts[1] == active_ending["page_id"])):
                raise HTTPException(409, "Quay lại Normal trước khi chuyển hoặc xóa trang đang Ending.")
            if operation == "settings" and request.method == "PATCH":
                settings = state["settings"]
                for key, value in body.items():
                    if key == "rotation_seconds":
                        if type(value) is not int or not 2 <= value <= 120:
                            raise HTTPException(422, "Chu kỳ từ 2 đến 120 giây.")
                    elif key == "paused":
                        if type(value) is not bool:
                            raise HTTPException(422, "Giá trị tạm dừng không hợp lệ.")
                    elif key == "led_fade":
                        if type(value) not in (int, float) or not math.isfinite(value) or not .2 <= value <= 1.8:
                            raise HTTPException(422, "Thời gian chuyển ảnh phải từ 0,2 đến 1,8 giây.")
                    else:
                        raise HTTPException(422, "Thiết lập không được hỗ trợ.")
                    settings[key] = value
            elif operation == "pages" and request.method == "POST":
                active_page = state["current_page_id"]
                new_page(state)
                state["current_page_id"] = active_page
            elif len(parts) == 2 and parts[0] == "pages" and request.method == "DELETE":
                page_id = identifier(parts[1])
                index = next((i for i, page in enumerate(state["pages"]) if page["id"] == page_id), None)
                if index is None:
                    raise HTTPException(404, "Không tìm thấy trang.")
                if len(state["pages"]) <= 1:
                    raise HTTPException(409, "Cần giữ ít nhất một trang trình chiếu.")
                state["pages"].pop(index)
                if state["current_page_id"] == page_id:
                    state["current_page_id"] = state["pages"][min(index, len(state["pages"]) - 1)]["id"]
                for moment in state["snapshots"]:
                    if moment.get("page_id") == page_id:
                        moment.pop("page_id")
            elif len(parts) == 2 and parts[0] == "pages" and request.method == "PATCH":
                page_id = identifier(parts[1])
                name = body.get("name")
                if not isinstance(name, str) or not name.strip() or len(name.strip()) > 80:
                    raise HTTPException(422, "Tên trang cần từ 1 đến 80 ký tự.")
                page = next((p for p in state["pages"] if p["id"] == page_id), None)
                if page is None:
                    raise HTTPException(404, "Không tìm thấy trang.")
                page["name"] = name.strip()
                for moment in state["snapshots"]:
                    if moment.get("page_id") == page_id:
                        moment["name"] = page["name"]
            elif len(parts) == 3 and parts[0] == "pages" and parts[2] == "activate":
                page_id = identifier(parts[1])
                if not any(page["id"] == page_id for page in state["pages"]):
                    raise HTTPException(404, "Không tìm thấy trang.")
                state["current_page_id"] = page_id
            elif len(parts) == 3 and parts[0] == "pages" and parts[2] == "items" and request.method == "POST":
                drawing_id = identifier(body.get("drawing_id"))
                store.drawing(state, drawing_id)
                led.assign(page_by_id(state, parts[1]), drawing_id, body.get("cell_id"), state["settings"]["paused"])
            elif len(parts) == 4 and parts[0] == "pages" and parts[2] == "cells" and request.method == "PATCH":
                if not parts[3].isdigit() or not 0 <= int(parts[3]) < 27:
                    raise HTTPException(422, "Ô không hợp lệ.")
                cell = page_by_id(state, parts[1])["cells"][int(parts[3])]
                drawing_id = identifier(body.get("drawing_id"))
                if drawing_id not in cell["drawing_ids"]:
                    raise HTTPException(404, "Hình không còn trong danh sách của ô.")
                cell["active"] = drawing_id
                cell["shown_at"] = time.time()
                led.sync_items(page_by_id(state, parts[1]))
            elif len(parts) == 4 and parts[0] == "pages" and parts[2] == "items" and request.method == "DELETE":
                led.remove(page_by_id(state, parts[1]), identifier(parts[3]))
            elif operation == "items" and request.method == "POST":
                drawing_id = identifier(body.get("drawing_id"))
                store.drawing(state, drawing_id)
                led.assign(current_page(state), drawing_id, body.get("cell_id"), state["settings"]["paused"])
            elif len(parts) == 2 and parts[0] == 'cells' and request.method == 'PATCH':
                if not parts[1].isdigit() or not 0 <= int(parts[1]) < 27:
                    raise HTTPException(422, 'Ô không hợp lệ.')
                page = current_page(state)
                led.ensure_cells(page)
                cell = page['cells'][int(parts[1])]
                drawing_id = identifier(body.get('drawing_id'))
                if drawing_id not in cell['drawing_ids']:
                    raise HTTPException(404, 'Hình không còn trong danh sách của ô.')
                cell['active'] = drawing_id
                cell['shown_at'] = time.time()
                led.sync_items(page)
            elif len(parts) == 2 and parts[0] == "items":
                drawing_id = identifier(parts[1])
                page = current_page(state)
                if request.method != "DELETE":
                    raise HTTPException(405)
                led.remove(page, drawing_id)
            elif len(parts) in {2, 3} and parts[0] == "drawings":
                drawing_id = identifier(parts[1])
                drawing = store.drawing(state, drawing_id, active=False)
                if len(parts) == 3 and parts[2] == "favorite" and request.method == "PATCH":
                    if type(body.get("favorite")) is not bool:
                        raise HTTPException(422, "Trạng thái yêu thích không hợp lệ.")
                    if body["favorite"]:
                        source = store.directory / "drawings" / f"{drawing_id}.svg"
                        target = store.directory / "favorites" / source.name
                        if not target.exists():
                            if not source.is_file():
                                raise HTTPException(404, "Không tìm thấy SVG gốc.")
                            atomic_write(target, source.read_bytes())
                    else:
                        files_to_delete.append(store.directory / "favorites" / f"{drawing_id}.svg")
                    drawing["favorite"] = body["favorite"]
                elif len(parts) == 3 and parts[2] == "restore" and request.method == "POST":
                    drawing["deleted"] = False
                elif len(parts) == 3 and parts[2] == "purge" and request.method == "DELETE":
                    if drawing_id in ending.protected_ids(state):
                        raise HTTPException(409, "Nét đang thuộc bộ Ending. Quay lại Normal trước khi xóa vĩnh viễn.")
                    if not drawing["deleted"]:
                        raise HTTPException(409, "Hãy đưa nét vẽ vào thùng rác trước khi xóa vĩnh viễn.")
                    for page in state["pages"]:
                        led.remove(page, drawing_id)
                    state["submissions"] = {key: value for key, value in state["submissions"].items() if value.get("id") != drawing_id}
                    state["drawings"].remove(drawing)
                    files_to_delete.extend([
                        store.directory / "drawings" / f"{drawing_id}.svg",
                        store.directory / "vectors" / f"{drawing_id}.json",
                    ])
                elif len(parts) == 2 and request.method == "DELETE":
                    drawing["deleted"] = True
                    for page in state["pages"]:
                        led.remove(page, drawing_id)
                else:
                    raise HTTPException(404)
            elif len(parts) == 2 and parts[0] == "snapshots" and request.method == "DELETE":
                snapshot_id = identifier(parts[1])
                snapshot = next((item for item in state["snapshots"] if item["id"] == snapshot_id), None)
                if not snapshot:
                    raise HTTPException(404, "Không tìm thấy ảnh bố cục.")
                page_id = snapshot.get("page_id")
                if state.get("ending", {}).get("page_id") == page_id:
                    raise HTTPException(409, "Khoảnh khắc đang dùng cho Ending. Quay lại Normal trước.")
                if page_id and page_id == state["current_page_id"]:
                    raise HTTPException(409, "Hãy chuyển sang trang khác trước khi xóa khoảnh khắc đang chiếu.")
                if page_id:
                    state["pages"] = [p for p in state["pages"] if p["id"] != page_id]
                state["snapshots"].remove(snapshot)
                files_to_delete.append(store.directory / "snapshots" / f"{snapshot_id}.png")
            else:
                raise HTTPException(404, "Chức năng không tồn tại.")
        store.mutate(change)
        for path in files_to_delete:
            with suppress(FileNotFoundError):
                path.unlink()
        await broadcast()
        return store.public()

    @app.websocket("/ws/display")
    async def websocket(connection: WebSocket):
        origin = connection.headers.get("origin", "")
        expected = {f"http://{connection.headers.get('host')}", f"https://{connection.headers.get('host')}", "http://127.0.0.1:4173", "http://localhost:4173"}
        if origin not in expected:
            await connection.close(code=1008)
            return
        await connection.accept()
        connections.add(connection)
        try:
            while True:
                await connection.receive_text()
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            connections.discard(connection)

    app.mount("/", FrontendFiles(directory=ROOT.parent / "frontend", html=True), name="frontend")
    return app


app = create_app()
