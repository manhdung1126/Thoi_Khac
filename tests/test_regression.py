"""Public API contracts that must survive cleanup; all writes use a temporary store."""
import io
import errno
import json
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image
from backend.app.main import create_app


class RegressionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='cos-regression-')
        self.pin = patch.dict('os.environ', {'CLOUD_ADMIN_PIN': 'baseline-test-pin'})
        self.pin.start()
        self.client = TestClient(create_app(self.temp.name))
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.pin.stop()
        self.temp.cleanup()

    def login(self, client=None):
        response = (client or self.client).post('/api/admin/login', json={'pin': 'baseline-test-pin'})
        self.assertEqual(response.status_code, 200)
        return {'Authorization': 'Bearer ' + response.json()['token']}

    def test_mutating_routes_reject_missing_or_invalid_credentials_without_state_changes(self):
        before = self.client.get('/api/state').json()
        page_id, drawing_id = before['current_page_id'], uuid4().hex
        operations = [
            ('POST', '/api/pages'), ('PATCH', '/api/settings'),
            ('PATCH', f'/api/pages/{page_id}'), ('DELETE', f'/api/pages/{page_id}'),
            ('POST', f'/api/pages/{page_id}/activate'),
            ('POST', '/api/items'), ('POST', f'/api/pages/{page_id}/items'),
            ('PATCH', '/api/cells/0'), ('PATCH', f'/api/pages/{page_id}/cells/0'),
            ('DELETE', f'/api/drawings/{drawing_id}'),
            ('PATCH', f'/api/drawings/{drawing_id}/favorite'),
            ('POST', f'/api/drawings/{drawing_id}/restore'),
            ('DELETE', f'/api/drawings/{drawing_id}/purge'),
            ('DELETE', f'/api/snapshots/{drawing_id}'),
            ('POST', '/api/ending/prepare'), ('POST', f'/api/ending/{drawing_id}/start'),
            ('POST', f'/api/ending/{drawing_id}/reset'),
        ]
        for headers in [{}, {'Authorization': 'Bearer not-a-session'}]:
            for method, path in operations:
                with self.subTest(method=method, path=path, authenticated=bool(headers)):
                    self.assertEqual(self.client.request(method, path, json={}, headers=headers).status_code, 401)
            response = self.client.post('/api/snapshots', headers=headers,
                files={'snapshot': ('guard.png', b'not decoded before authorization', 'image/png')})
            self.assertEqual(response.status_code, 401)
        after = self.client.get('/api/state').json()
        for key in ['revision', 'pages', 'drawings', 'snapshots', 'settings']:
            self.assertEqual(after[key], before[key])
        self.assertEqual(self.client.get('/api/health').status_code, 200)

    def test_login_rate_limit_expires_and_a_configured_pin_is_required(self):
        with patch('backend.app.main.time.time', return_value=100):
            for _ in range(10):
                self.assertEqual(self.client.post('/api/admin/login', json={'pin': '2468'}).status_code, 401)
            self.assertEqual(self.client.post('/api/admin/login', json={'pin': 'baseline-test-pin'}).status_code, 429)
        with patch('backend.app.main.time.time', return_value=160):
            self.assertIn('Authorization', self.login())

    def test_restart_invalidates_sessions_but_preserves_saved_pages(self):
        old_auth = self.login()
        response = self.client.post('/api/pages', json={}, headers=old_auth)
        self.assertEqual(response.status_code, 200)
        before = response.json()
        with TestClient(create_app(self.temp.name)) as restarted:
            self.assertEqual(restarted.patch('/api/settings', json={'paused': True}, headers=old_auth).status_code, 401)
            self.assertEqual(restarted.get('/api/state').json()['pages'], before['pages'])
            self.assertEqual(restarted.patch('/api/settings', json={'paused': True}, headers=self.login(restarted)).status_code, 200)

    def test_concurrent_retry_creates_only_one_drawing_and_one_cell_entry(self):
        vectors = {'version': 2, 'profile': 'led-2px', 'strokes': [
            {'erase': False, 'material': 'mono-v1', 'width': 2, 'points': [[100, 100, .4], [500, 500, .8]]}]}
        form = {'submission_id': uuid4().hex, 'strokes': json.dumps(vectors)}
        with ThreadPoolExecutor(max_workers=6) as workers:
            responses = list(workers.map(lambda _: self.client.post('/api/drawings', data=form), range(6)))
        self.assertTrue(all(response.status_code == 201 for response in responses))
        self.assertEqual(len({response.json()['id'] for response in responses}), 1)
        self.assertEqual(sum(not response.json()['replayed'] for response in responses), 1)
        state = self.client.get('/api/state').json()
        self.assertEqual(len(state['drawings']), 1)
        self.assertEqual(sum(len(cell['drawing_ids']) for page in state['pages'] for cell in page['cells']), 1)
        drawing = responses[0].json()
        self.assertEqual(self.client.get(drawing['vector_path']).json(), vectors)
        self.assertEqual(self.client.get(drawing['image_path']).status_code, 200)

    def test_invalid_moment_leaves_no_page_or_orphan_preview_file(self):
        output = io.BytesIO()
        Image.new('RGBA', (8, 8), (255, 215, 0, 255)).save(output, format='PNG')
        layout = [None] * 27
        layout[0] = uuid4().hex  # A syntactically valid ID, but no drawing exists.
        before = self.client.get('/api/state').json()
        response = self.client.post('/api/snapshots', headers=self.login(),
            files={'snapshot': ('moment.png', output.getvalue(), 'image/png')},
            data={'layout': json.dumps(layout), 'name': 'Invalid moment'})
        self.assertEqual(response.status_code, 404)
        after = self.client.get('/api/state').json()
        for key in ['revision', 'pages', 'snapshots', 'current_page_id']:
            self.assertEqual(after[key], before[key])
        self.assertEqual(list((Path(self.temp.name) / 'snapshots').glob('*.png')), [])

    def test_restart_recovers_pages_assets_favorites_trash_and_projectable_moment(self):
        auth = self.login()
        response = self.client.patch('/api/settings', headers=auth, json={'paused': True, 'rotation_seconds': 17})
        self.assertEqual(response.status_code, 200)
        live = response.json()['current_page_id']
        drawings = []
        for index in range(3):
            vectors = {'version': 2, 'profile': 'led-2px', 'strokes': [
                {'erase': False, 'material': 'mono-v1', 'width': 2,
                 'points': [[100, 100, .5], [300 + index * 100, 500, .8]]}]}
            created = self.client.post('/api/drawings', data={'submission_id': uuid4().hex, 'strokes': json.dumps(vectors)})
            self.assertEqual(created.status_code, 201)
            drawings.append(created.json())
        active, trashed, archived = drawings
        for drawing in [active, archived]:
            self.client.patch(f"/api/drawings/{drawing['id']}/favorite", headers=auth, json={'favorite': True}).raise_for_status()
        self.client.delete(f"/api/drawings/{trashed['id']}", headers=auth).raise_for_status()
        self.client.delete(f"/api/drawings/{archived['id']}", headers=auth).raise_for_status()
        self.client.delete(f"/api/drawings/{archived['id']}/purge", headers=auth).raise_for_status()
        self.client.patch(f'/api/pages/{live}', headers=auth, json={'name': 'Trang phục hồi'}).raise_for_status()
        self.client.post('/api/items', headers=auth, json={'drawing_id': active['id'], 'cell_id': 4}).raise_for_status()
        preview = io.BytesIO()
        Image.new('RGBA', (8, 8), (255, 215, 0, 255)).save(preview, format='PNG')
        layout = [None] * 27
        layout[4] = active['id']
        response = self.client.post('/api/snapshots', headers=auth,
            files={'snapshot': ('restart.png', preview.getvalue(), 'image/png')},
            data={'name': 'Khoảnh khắc phục hồi', 'layout': json.dumps(layout)})
        self.assertEqual(response.status_code, 201)
        moment = response.json()
        paths = [active['image_path'], active['vector_path'], trashed['image_path'], trashed['vector_path'],
                 f"/api/favorites/{active['id']}", f"/api/favorites/{archived['id']}", moment['image_path']]
        assets = {}
        for path in paths:
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, path)
            assets[path] = response.content
        before = self.client.get('/api/state').json()
        # Stop the old lifespan before reopening the same directory. No Store internals.
        self.client.__exit__(None, None, None)
        self.client = TestClient(create_app(self.temp.name))
        self.client.__enter__()
        after = self.client.get('/api/state').json()
        for key in ['pages', 'drawings', 'snapshots', 'settings', 'current_page_id']:
            self.assertEqual(after[key], before[key], key)
        for path, content in assets.items():
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, path)
            self.assertEqual(response.content, content, path)
        self.assertEqual(self.client.get(archived['image_path']).status_code, 404)
        self.assertEqual(self.client.patch('/api/settings', headers=auth, json={'paused': False}).status_code, 401)
        auth = self.login()
        restored = self.client.post(f"/api/drawings/{trashed['id']}/restore", headers=auth, json={})
        self.assertEqual(restored.status_code, 200)
        self.assertFalse(next(d for d in restored.json()['drawings'] if d['id'] == trashed['id'])['deleted'])
        projected = self.client.post(f"/api/pages/{moment['page_id']}/activate", headers=auth, json={})
        self.assertEqual(projected.status_code, 200)
        state = projected.json()
        self.assertEqual(state['current_page_id'], moment['page_id'])
        page = next(page for page in state['pages'] if page['id'] == moment['page_id'])
        self.assertEqual(page['cells'][4]['drawing_ids'], [active['id']])

    def test_failed_upload_keeps_committed_state_and_leaves_no_partial_assets(self):
        vectors = {'version': 2, 'profile': 'led-2px', 'strokes': [
            {'erase': False, 'material': 'mono-v1', 'width': 2, 'points': [[10, 10, .5], [500, 500, .5]]}]}
        original_replace = os.replace
        directory = Path(self.temp.name)
        seeded = self.client.post('/api/drawings', data={'submission_id': uuid4().hex, 'strokes': json.dumps(vectors)})
        self.assertEqual(seeded.status_code, 201)
        for stage, code in [('drawings', errno.EACCES), ('vectors', errno.ENOSPC), ('state.json', errno.ENOSPC)]:
            with self.subTest(stage=stage):
                submission_id = uuid4().hex
                before = self.client.get('/api/state').json()
                files = {p.relative_to(directory): p.read_bytes() for p in directory.rglob('*') if p.is_file()}
                def fail_commit(source, target):
                    target = Path(target)
                    if target.parent.name == stage or target.name == stage:
                        raise OSError(code, 'Injected disk fault')
                    return original_replace(source, target)
                with patch('backend.app.main.os.replace', side_effect=fail_commit):
                    response = self.client.post('/api/drawings', data={'submission_id': submission_id, 'strokes': json.dumps(vectors)})
                self.assertEqual(response.status_code, 507)
                after = self.client.get('/api/state').json()
                for key in ['revision', 'pages', 'drawings', 'snapshots']:
                    self.assertEqual(after[key], before[key])
                actual = {p.relative_to(directory): p.read_bytes() for p in directory.rglob('*') if p.is_file()}
                self.assertEqual(set(actual), set(files), 'A rejected upload must not leave orphan SVG/vector files')
                self.assertEqual(actual, files, 'Previously committed file contents must remain unchanged')
                retry = self.client.post('/api/drawings', data={'submission_id': submission_id, 'strokes': json.dumps(vectors)})
                self.assertEqual(retry.status_code, 201)
                drawing = retry.json()
                committed = self.client.get('/api/state').json()
                self.assertEqual(len(committed['drawings']), len(before['drawings']) + 1)
                retry_files = {p.relative_to(directory): p.read_bytes() for p in directory.rglob('*') if p.is_file()}
                self.assertEqual(set(retry_files) - set(files), {
                    Path('drawings') / f"{drawing['id']}.svg", Path('vectors') / f"{drawing['id']}.json"})
                for path, content in files.items():
                    if path != Path('state.json'):
                        self.assertEqual(retry_files[path], content)
                replay = self.client.post('/api/drawings', data={'submission_id': submission_id, 'strokes': json.dumps(vectors)})
                self.assertEqual(replay.status_code, 201)
                self.assertEqual(replay.json()['id'], drawing['id'])
                self.assertTrue(replay.json()['replayed'])
                self.assertEqual(self.client.get('/api/state').json()['revision'], committed['revision'])
                self.assertEqual({p.relative_to(directory): p.read_bytes() for p in directory.rglob('*') if p.is_file()}, retry_files)

    def test_failed_moment_disk_commit_rolls_back_preview_and_can_be_retried(self):
        directory = Path(self.temp.name)
        auth = self.login()
        preview = io.BytesIO()
        Image.new('RGBA', (8, 8), (255, 215, 0, 255)).save(preview, format='PNG')
        before = self.client.get('/api/state').json()
        state_file = (directory / 'state.json').read_bytes()
        original_replace = os.replace
        def fail_state(source, target):
            if Path(target).name == 'state.json':
                raise OSError(errno.ENOSPC, 'Injected full disk')
            return original_replace(source, target)
        with patch('backend.app.main.os.replace', side_effect=fail_state):
            response = self.client.post('/api/snapshots', headers=auth,
                files={'snapshot': ('fault.png', preview.getvalue(), 'image/png')})
        self.assertEqual(response.status_code, 507)
        self.assertEqual((directory / 'state.json').read_bytes(), state_file)
        for key in ['revision', 'pages', 'snapshots']:
            self.assertEqual(self.client.get('/api/state').json()[key], before[key])
        self.assertEqual(list((directory / 'snapshots').glob('*')), [])
        response = self.client.post('/api/snapshots', headers=auth,
            files={'snapshot': ('retry.png', preview.getvalue(), 'image/png')})
        self.assertEqual(response.status_code, 201)

    def test_corrupt_state_refuses_startup_without_silent_reset_and_backup_restores_it(self):
        with tempfile.TemporaryDirectory(prefix='cos-corrupt-') as directory:
            with TestClient(create_app(directory)) as client:
                auth = self.login(client)
                client.patch('/api/settings', headers=auth, json={'paused': True}).raise_for_status()
                before = client.get('/api/state').json()
            path = Path(directory) / 'state.json'
            backup = path.read_bytes()
            damaged = b'{"pages": [unfinished'
            path.write_bytes(damaged)  # Test-owned fault fixture only.
            with self.assertRaises(json.JSONDecodeError):
                create_app(directory)
            self.assertEqual(path.read_bytes(), damaged)
            path.write_bytes(backup)  # Explicit restore from the test's verified backup.
            with TestClient(create_app(directory)) as recovered:
                state = recovered.get('/api/state').json()
                for key in ['pages', 'drawings', 'snapshots', 'settings', 'current_page_id']:
                    self.assertEqual(state[key], before[key])

    def test_missing_artwork_blocks_ending_without_losing_state_then_recovers_from_backup(self):
        vectors = {'version': 2, 'profile': 'led-2px', 'strokes': [
            {'erase': False, 'material': 'mono-v1', 'width': 2, 'points': [[10, 10, .5], [500, 500, .5]]}]}
        drawing = self.client.post('/api/drawings', data={'submission_id': uuid4().hex, 'strokes': json.dumps(vectors)}).json()
        path = Path(self.temp.name) / 'drawings' / (drawing['id'] + '.svg')
        backup = path.read_bytes()
        path.unlink()  # Only this generated test asset; real exhibition storage is isolated.
        before = self.client.get('/api/state').json()
        mask = {'width': 64, 'height': 64, 'points': [[x, y] for y in range(10, 54, 4) for x in range(10, 54, 4)]}
        body = {'request_id': uuid4().hex, 'mask': mask}
        auth = self.login()
        self.assertEqual(self.client.get(drawing['image_path']).status_code, 404)
        self.assertEqual(self.client.post('/api/ending/prepare', headers=auth, json=body).status_code, 409)
        after = self.client.get('/api/state').json()
        self.assertEqual(after['revision'], before['revision'])
        self.assertEqual(after['drawings'], before['drawings'])
        self.assertNotIn('ending', after)
        path.write_bytes(backup)
        self.assertEqual(self.client.get(drawing['image_path']).content, backup)
        self.assertEqual(self.client.post('/api/ending/prepare', headers=auth, json=body).status_code, 200)

    def test_distinct_concurrent_submissions_preserve_all_assets_and_balanced_queues(self):
        def submit(index):
            vectors = {'version': 2, 'profile': 'led-2px', 'strokes': [
                {'erase': False, 'material': 'mono-v1', 'width': 2, 'points': [[10, 10, .5], [100 + index, 500, .5]]}]}
            return self.client.post('/api/drawings', data={'submission_id': uuid4().hex, 'strokes': json.dumps(vectors)})
        with ThreadPoolExecutor(max_workers=8) as workers:
            responses = list(workers.map(submit, range(60)))
        self.assertTrue(all(response.status_code == 201 for response in responses))
        ids = {response.json()['id'] for response in responses}
        self.assertEqual(len(ids), 60)
        state = self.client.get('/api/state').json()
        self.assertEqual({drawing['id'] for drawing in state['drawings']}, ids)
        cells = state['pages'][0]['cells']
        queued = [drawing for cell in cells for drawing in cell['drawing_ids']]
        self.assertEqual(set(queued), ids)
        self.assertEqual(len(queued), 60)
        self.assertLessEqual(max(len(c['drawing_ids']) for c in cells) - min(len(c['drawing_ids']) for c in cells), 1)
        for response in responses:
            drawing = response.json()
            self.assertEqual(self.client.get(drawing['image_path']).status_code, 200)
            self.assertEqual(self.client.get(drawing['vector_path']).status_code, 200)
