import asyncio
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw
from starlette.websockets import WebSocketDisconnect
from backend.app.main import BodyLimitMiddleware, create_app, VECTOR_LIMIT


def png(color="red", empty=False, size=(120, 100)):
    image = Image.new("RGBA", size)
    if not empty:
        ImageDraw.Draw(image).line((20, 20, 90, 70), fill=color, width=5)
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


class MvpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="cos-tests-")
        self.app = create_app(self.temp.name)
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.auth = {"Authorization": "Bearer " + self.client.post("/api/admin/login", json={"pin": "2468"}).json()["token"]}

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.temp.cleanup()

    def upload(self, color="red", key=None, content=None):
        end = 120 if color == "red" else 180
        vectors = content or {"version": 1, "profile": "led-2px", "strokes": [{"erase": False, "width": 2, "points": [[20, 20], [end, 100]]}]}
        raw = vectors if isinstance(vectors, str) else json.dumps(vectors)
        return self.client.post("/api/drawings", data={"submission_id": key or uuid4().hex, "strokes": raw})

    def change(self, path, method="post", **body):
        response = getattr(self.client, method)(path, headers=self.auth, **({"json": body} if method != "delete" else {}))
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_server_generates_svg_and_idempotent_retry_survives_restart(self):
        key = uuid4().hex
        first = self.upload(key=key)
        self.assertEqual(first.status_code, 201)
        self.assertEqual(self.upload(key=key).json()["id"], first.json()["id"])
        self.assertTrue(self.upload(key=key).json()["replayed"])
        self.assertEqual(self.upload("blue", key).status_code, 409)
        image = self.client.get(first.json()["image_path"])
        self.assertEqual(image.headers["content-type"], "image/svg+xml")
        self.assertIn(b'<svg xmlns="http://www.w3.org/2000/svg"', image.content)
        self.assertIn(b'stroke="#FFD700"', image.content)
        second = TestClient(create_app(self.temp.name))
        result = second.post("/api/drawings", data={"submission_id": key, "strokes": json.dumps({"version": 1, "profile": "led-2px", "strokes": [{"erase": False, "width": 2, "points": [[20, 20], [120, 100]]}]})})
        self.assertEqual(result.json()["id"], first.json()["id"])
        self.assertEqual(len(second.get("/api/state").json()["drawings"]), 1)
        second.close()

    def test_missing_malformed_and_oversize_vectors_rejected(self):
        self.assertEqual(self.client.post("/api/drawings", data={"submission_id": uuid4().hex}).status_code, 422)
        self.assertEqual(self.upload(content="not-json").status_code, 422)
        response = self.client.post("/api/drawings", content=b"x" * (VECTOR_LIMIT + 1), headers={"content-type": "application/octet-stream"})
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.client.get("/api/drawings").json(), [])

    def test_chunked_body_is_bounded_before_full_read(self):
        consumed = []
        async def receive():
            consumed.append(1)
            return {"type": "http.request", "body": b"x" * (512 * 1024), "more_body": True}
        async def send(message):
            pass
        async def downstream(scope, receive, send):
            for _ in range(10):
                await receive()
        scope = {"type": "http", "method": "POST", "path": "/api/drawings", "headers": []}
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(BodyLimitMiddleware(downstream)(scope, receive, send))
        self.assertEqual(raised.exception.status_code, 413)
        self.assertEqual(len(consumed), 5)

    def test_unauthorized_control_and_rejected_origin(self):
        self.assertEqual(self.client.patch("/api/settings", json={"paused": True}).status_code, 401)
        self.assertEqual(self.client.post("/api/admin/login", json={"pin": "bad"}).status_code, 401)
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect("/ws/display", headers={"Origin": "https://other.example"}):
                pass

    def test_library_soft_delete_restore_and_scene_remove(self):
        drawing = self.upload().json()
        self.assertEqual(self.client.delete("/api/items/"+drawing["id"], headers=self.auth).status_code, 200)
        self.assertEqual(len(self.client.get("/api/drawings").json()), 1)
        self.change("/api/items", drawing_id=drawing["id"])
        self.assertEqual(self.client.delete("/api/drawings/"+drawing["id"], headers=self.auth).status_code, 200)
        state = self.client.get("/api/state").json()
        self.assertTrue(state["drawings"][0]["deleted"])
        self.assertEqual(state["pages"][0]["items"], [])
        self.change("/api/drawings/"+drawing["id"]+"/restore")
        self.assertEqual(len(self.client.get("/api/drawings").json()), 1)

    def test_favorite_is_persistent_metadata_without_copying_the_drawing(self):
        drawing = self.upload().json()
        self.assertFalse(drawing["favorite"])
        state = self.change(f"/api/drawings/{drawing['id']}/favorite", "patch", favorite=True)
        self.assertTrue(state["drawings"][0]["favorite"])
        self.assertEqual(len(state["drawings"]), 1)
        restarted = TestClient(create_app(self.temp.name))
        self.assertTrue(restarted.get("/api/state").json()["drawings"][0]["favorite"])
        restarted.close()
        self.assertEqual(self.client.patch(f"/api/drawings/{drawing['id']}/favorite", json={"favorite": "yes"}, headers=self.auth).status_code, 422)

    def test_trash_can_permanently_delete_drawing_and_files(self):
        key = uuid4().hex
        drawing = self.upload(key=key).json()
        drawing_id = drawing["id"]
        self.assertEqual(self.client.delete(f"/api/drawings/{drawing_id}/purge", headers=self.auth).status_code, 409)
        self.client.delete(f"/api/drawings/{drawing_id}", headers=self.auth).raise_for_status()
        response = self.client.delete(f"/api/drawings/{drawing_id}/purge", headers=self.auth)
        self.assertEqual(response.status_code, 200, response.text)
        state = self.client.get("/api/state").json()
        self.assertFalse(any(item["id"] == drawing_id for item in state["drawings"]))
        self.assertFalse(any(value.get("id") == drawing_id for value in self.app.state.store.state["submissions"].values()))
        self.assertEqual(self.client.get(drawing["image_path"]).status_code, 404)
        self.assertFalse((Path(self.temp.name) / "drawings" / f"{drawing_id}.svg").exists())
        self.assertFalse((Path(self.temp.name) / "vectors" / f"{drawing_id}.json").exists())

    def test_snapshot_create_and_delete(self):
        response = self.client.post("/api/snapshots", headers=self.auth, files={"snapshot": ("shot.png", png(size=(1920,1080)), "image/png")}, data={"name": "Test"})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(self.client.get(response.json()["image_path"]).status_code, 200)
        snapshot = response.json()
        self.assertEqual(self.client.delete(f"/api/snapshots/{snapshot['id']}", headers=self.auth).status_code, 200)
        self.assertEqual(self.client.get(snapshot["image_path"]).status_code, 404)
        self.assertFalse((Path(self.temp.name) / "snapshots" / f"{snapshot['id']}.png").exists())

    def test_favorite_copies_svg_and_survives_original_purge(self):
        drawing = self.upload().json()
        drawing_id = drawing["id"]
        self.change(f"/api/drawings/{drawing_id}/favorite", "patch", favorite=True)
        target = Path(self.temp.name) / "favorites" / f"{drawing_id}.svg"
        self.assertEqual(target.read_bytes(), (Path(self.temp.name) / "drawings" / f"{drawing_id}.svg").read_bytes())
        self.client.delete(f"/api/drawings/{drawing_id}", headers=self.auth).raise_for_status()
        self.client.delete(f"/api/drawings/{drawing_id}/purge", headers=self.auth).raise_for_status()
        self.assertEqual(self.client.get(f"/api/favorites/{drawing_id}").status_code, 200)

    def test_moment_freezes_visible_cells_and_can_be_projected(self):
        first, second = self.upload().json(), self.upload("blue").json()
        self.change("/api/items", drawing_id=first["id"], cell_id=3)
        self.change("/api/items", drawing_id=second["id"], cell_id=3)
        original = self.client.get("/api/state").json()["current_page_id"]
        layout = [None] * 27
        layout[3] = first["id"]
        response = self.client.post("/api/snapshots", headers=self.auth,
            files={"snapshot": ("shot.png", png(), "image/png")},
            data={"name": "Mốc thử", "layout": json.dumps(layout)})
        self.assertEqual(response.status_code, 201, response.text)
        moment = response.json()
        state = self.client.get("/api/state").json()
        self.assertEqual(state["current_page_id"], original)
        page = next(p for p in state["pages"] if p["id"] == moment["page_id"])
        self.assertEqual(page["cells"][3]["drawing_ids"], [first["id"]])
        self.assertEqual(sum(len(c["drawing_ids"]) for c in page["cells"]), 1)
        state = self.change(f"/api/pages/{moment['page_id']}/activate")
        self.assertEqual(state["current_page_id"], moment["page_id"])
        self.assertEqual(self.client.delete(f"/api/snapshots/{moment['id']}", headers=self.auth).status_code, 409)
        self.change(f"/api/pages/{original}/activate")
        self.client.delete(f"/api/snapshots/{moment['id']}", headers=self.auth).raise_for_status()
        self.assertFalse(any(p["id"] == moment["page_id"] for p in self.client.get("/api/state").json()["pages"]))

    def test_state_write_failure_keeps_previous_revision(self):
        before = self.app.state.store.public()
        with patch("backend.app.main.atomic_write", side_effect=OSError("full")):
            response = self.client.post("/api/pages", json={}, headers=self.auth)
        self.assertEqual(response.status_code, 507)
        after = self.app.state.store.public()
        self.assertEqual(before["revision"], after["revision"])
        self.assertEqual(before["pages"], after["pages"])

    def test_websocket_notifies_all_displays_after_change(self):
        with self.client.websocket_connect("/ws/display", headers={"Origin": "http://testserver"}) as first:
            with self.client.websocket_connect("/ws/display", headers={"Origin": "http://testserver"}) as second:
                self.upload()
                self.assertEqual(first.receive_json()["type"], "state_changed")
                self.assertEqual(second.receive_json()["revision"], 1)

    def test_frontend_routes_and_finalized_state_shape(self):
        for path in ["/", "/draw/", "/display/", "/control/"]:
            self.assertEqual(self.client.get(path).status_code, 200)
        state = self.client.get("/api/state").json()
        self.assertEqual(set(state["settings"]), {"rotation_seconds", "paused", "led_fade"})
        self.assertEqual(len(state["pages"][0]["cells"]), 27)

    def test_page_name_and_rotation_settings_persist(self):
        page_id = self.client.get("/api/state").json()["current_page_id"]
        self.change(f"/api/pages/{page_id}", "patch", name="  Khai mạc  ")
        self.change("/api/settings", "patch", rotation_seconds=15)
        restarted = TestClient(create_app(self.temp.name))
        state = restarted.get("/api/state").json()
        self.assertEqual(state["pages"][0]["name"], "Khai mạc")
        self.assertEqual(state["settings"]["rotation_seconds"], 15)
        restarted.close()
        for name in [" ", "x" * 81, None]:
            self.assertEqual(self.client.patch(f"/api/pages/{page_id}", json={"name": name}, headers=self.auth).status_code, 422)
        for seconds in [1, 121, 2.5, True]:
            self.assertEqual(self.client.patch("/api/settings", json={"rotation_seconds": seconds}, headers=self.auth).status_code, 422)

    def test_page_delete_switches_active_page_and_protects_last_page(self):
        before = self.client.get("/api/state").json()
        original = before["current_page_id"]
        created_state = self.change("/api/pages")
        created = next(page["id"] for page in created_state["pages"] if page["id"] != original)
        self.assertEqual(created_state["current_page_id"], original)
        response = self.client.delete(f"/api/pages/{created}", headers=self.auth)
        self.assertEqual(response.status_code, 200, response.text)
        state = response.json()
        self.assertEqual(state["current_page_id"], original)
        self.assertEqual([page["id"] for page in state["pages"]], [original])
        self.assertEqual(self.client.delete(f"/api/pages/{original}", headers=self.auth).status_code, 409)
        self.assertEqual(self.client.delete(f"/api/pages/{uuid4().hex}", headers=self.auth).status_code, 404)

    def test_both_cell_activation_routes_preserve_membership_clock_and_page(self):
        first, second = self.upload().json()['id'], self.upload('blue').json()['id']
        live = self.client.get('/api/state').json()['current_page_id']
        state = self.change('/api/pages')
        other = next(page['id'] for page in state['pages'] if page['id'] != live)
        for page_id in (live, other):
            for drawing_id in (first, second):
                self.change(f'/api/pages/{page_id}/items', drawing_id=drawing_id, cell_id=4)
        for path, target in ((f'/api/pages/{other}/cells/4', other), ('/api/cells/4', live)):
            with self.subTest(path=path):
                before = self.client.get('/api/state').json()
                clock = before['server_time'] + 1
                with patch('backend.app.main.time.time', return_value=clock):
                    after = self.change(path, 'patch', drawing_id=first)
                self.assertEqual(after['revision'], before['revision'] + 1)
                self.assertEqual(after['current_page_id'], live)
                for old, new in zip(before['pages'], after['pages']):
                    if new['id'] != target:
                        self.assertEqual(new, old)
                    else:
                        self.assertEqual(new['cells'][4]['drawing_ids'], old['cells'][4]['drawing_ids'])
                        self.assertEqual(new['cells'][4]['active'], first)
                        self.assertEqual(new['cells'][4]['shown_at'], clock)
                        self.assertEqual(next(item['drawing_id'] for item in new['items'] if item['cell_id'] == 4), first)
                invalid = self.client.patch(path, headers=self.auth, json={'drawing_id': uuid4().hex})
                self.assertEqual(invalid.status_code, 404)
                self.assertEqual(invalid.json()['detail'], 'Hình không còn trong danh sách của ô.')
                self.assertEqual(self.client.get('/api/state').json()['revision'], after['revision'])
        for path in (f'/api/pages/{uuid4().hex}/cells/27', '/api/cells/27'):
            invalid = self.client.patch(path, headers=self.auth, json={'drawing_id': 'invalid'})
            self.assertEqual(invalid.status_code, 422)
            self.assertEqual(invalid.json()['detail'], 'Ô không hợp lệ.')
        invalid = self.client.patch(f'/api/pages/{uuid4().hex}/cells/4', headers=self.auth, json={'drawing_id': 'invalid'})
        self.assertEqual(invalid.status_code, 404)
        self.assertEqual(invalid.json()['detail'], 'Không tìm thấy trang.')

    def test_editing_selected_page_does_not_change_live_page(self):
        drawing = self.upload().json()
        live = self.client.get("/api/state").json()["current_page_id"]
        state = self.change("/api/pages")
        selected = next(page["id"] for page in state["pages"] if page["id"] != live)
        state = self.change(f"/api/pages/{selected}/items", drawing_id=drawing["id"], cell_id=4)
        self.assertEqual(state["current_page_id"], live)
        page = next(page for page in state["pages"] if page["id"] == selected)
        self.assertEqual(page["cells"][4]["active"], drawing["id"])
        state = self.change(f"/api/pages/{selected}/cells/4", "patch", drawing_id=drawing["id"])
        self.assertEqual(state["current_page_id"], live)
        state = self.change(f"/api/pages/{selected}/items/{drawing['id']}", "delete")
        self.assertEqual(state["current_page_id"], live)
        self.assertFalse(next(page for page in state["pages"] if page["id"] == selected)["cells"][4]["drawing_ids"])
