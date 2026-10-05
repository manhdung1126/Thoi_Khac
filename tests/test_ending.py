import json
import tempfile
import time
import unittest
from uuid import uuid4
from fastapi.testclient import TestClient
from backend.app.main import create_app


class EndingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="cos-ending-")
        self.client = TestClient(create_app(self.temp.name))
        self.client.__enter__()
        self.auth = {"Authorization": "Bearer " + self.client.post("/api/admin/login", json={"pin": "2468"}).json()["token"]}
        self.mask = {"id": "test-square", "width": 64, "height": 64, "aspect": 1,
                     "points": [[x, y] for y in range(8, 56, 4) for x in range(8, 56, 4)]}

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.temp.cleanup()

    def upload(self):
        data = {"version": 1, "profile": "led-2px", "strokes": [{"erase": False, "width": 2, "points": [[100, 100], [600, 600]]}]}
        response = self.client.post("/api/drawings", data={"submission_id": uuid4().hex, "strokes": json.dumps(data)})
        self.assertEqual(response.status_code, 201)
        return response.json()["id"]

    def prepare(self, request_id=None):
        return self.client.post("/api/ending/prepare", headers=self.auth, json={"request_id": request_id or uuid4().hex, "mask": self.mask, "seed": "test"})

    def test_snapshot_new_submissions_duplicate_start_and_restart_resume(self):
        original = self.upload()
        request = uuid4().hex
        first = self.prepare(request)
        self.assertEqual(first.status_code, 200, first.text)
        e = first.json()["ending"]
        self.assertEqual(self.prepare(request).json()["ending"]["id"], e["id"])
        self.assertEqual(self.prepare().status_code, 409)
        new = self.upload()
        state = self.client.get("/api/state").json()
        self.assertEqual([d["id"] for d in state["ending"]["drawings"]], [original])
        self.assertIn(new, [d["id"] for d in state["drawings"]])
        path = "/api/ending/" + e["id"]
        self.assertEqual(self.client.post(path + "/start", headers=self.auth).status_code, 409)
        self.assertEqual(self.client.post(path + "/start").status_code, 401)
        self.client.post(path + "/ready", json={"client_id": uuid4().hex, "ready": True})
        start = self.client.post(path + "/start", headers=self.auth).json()["ending"]["start_time"]
        self.assertEqual(self.client.post(path + "/start", headers=self.auth).json()["ending"]["start_time"], start)
        other = TestClient(create_app(self.temp.name))
        self.assertEqual(other.get("/api/state").json()["ending"]["start_time"], start)
        other.close()
        self.assertEqual(self.client.post(path + "/reset", headers=self.auth).status_code, 200)
        state = self.client.get("/api/state").json()
        self.assertNotIn("ending", state)
        self.assertEqual(len(state["drawings"]), 2)
        self.assertEqual(self.client.post(path + "/reset", headers=self.auth).status_code, 200)

    def test_validation_asset_protection_and_stale_requests(self):
        self.assertEqual(self.prepare().status_code, 409)
        original = self.upload()
        body = {"request_id": uuid4().hex, "mask": {**self.mask, "points": [[1, 1]] * 10}}
        self.assertEqual(self.client.post("/api/ending/prepare", headers=self.auth, json=body).status_code, 422)
        e = self.prepare().json()["ending"]
        self.client.delete("/api/drawings/" + original, headers=self.auth)
        self.assertEqual(self.client.delete("/api/drawings/" + original + "/purge", headers=self.auth).status_code, 409)
        self.assertEqual(self.client.get("/api/strokes/" + original).status_code, 200)
        self.assertEqual(self.client.post("/api/pages/" + e["page_id"] + "/activate", headers=self.auth, json={}).status_code, 409)
        self.assertEqual(self.client.post("/api/ending/" + uuid4().hex + "/reset", headers=self.auth).status_code, 409)
        self.client.app.state.store.ending_ready[e["id"]] = {uuid4().hex: time.time() - 46}
        self.assertEqual(self.client.post("/api/ending/" + e["id"] + "/start", headers=self.auth).status_code, 409)
