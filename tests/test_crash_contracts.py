"""Durable crash layouts, not exceptions: rollback never runs in these fixtures.

Characterizes current behavior only; no recovery or maintenance policy is added.
Every app and filesystem transition is isolated from exhibition storage.
"""
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from PIL import Image
from backend.app.main import create_app


class CrashContracts(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='cos-crash-')
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        clock = patch('backend.app.main.time.time', return_value=100)
        clock.start()
        self.addCleanup(clock.stop)
        self.open_app()
        self.addCleanup(lambda: self.client.close())
        self.vectors = {'version': 1, 'profile': 'led-2px', 'strokes': [
            {'erase': False, 'width': 2, 'points': [[20, 20], [400, 400]]}]}
        self.other = self.submit()
        self.drawing = self.submit()
        self.other_svg = self.client.get(self.other['image_path']).content
        self.favorite_svg = self.client.get(self.drawing['image_path']).content
        self.client.patch(f"/api/drawings/{self.drawing['id']}/favorite",
            json={'favorite': True}, headers=self.auth).raise_for_status()
        image = io.BytesIO()
        Image.new('RGBA', (8, 8), (255, 215, 0, 255)).save(image, format='PNG')
        self.preview = image.getvalue()

    def open_app(self):
        # No lifespan ticker and no production process termination.
        self.client = TestClient(create_app(self.directory), raise_server_exceptions=False)
        response = self.client.post('/api/admin/login', json={'pin': '2468'})
        self.assertEqual(response.status_code, 200)
        self.auth = {'Authorization': 'Bearer ' + response.json()['token']}

    def state(self):
        response = self.client.get('/api/state')
        self.assertEqual(response.status_code, 200)
        return response.json()

    def files(self):
        return {p.relative_to(self.directory): p.read_bytes() if p.is_file() else None
                for p in self.directory.rglob('*')}

    def restart(self):
        self.client.close()
        before, files = (self.directory / 'state.json').read_bytes(), self.files()
        self.open_app()
        self.assertEqual((self.directory / 'state.json').read_bytes(), before)
        self.assertEqual(self.files(), files)
        persisted = json.loads(before)
        public = self.state()
        for key in ['revision', 'drawings', 'snapshots', 'settings', 'current_page_id']:
            self.assertEqual(public[key], persisted[key])
        self.assertEqual(self.client.get('/api/health').status_code, 200)
        for route in ['/control/', '/display/', '/draw/']:
            self.assertEqual(self.client.get(route).status_code, 200)
        return public

    def submit(self):
        response = self.client.post('/api/drawings', data={
            'submission_id': uuid4().hex, 'strokes': json.dumps(self.vectors)})
        self.assertEqual(response.status_code, 201)
        return response.json()

    def moment(self):
        layout = [None] * 27
        layout[8] = self.other['id']
        response = self.client.post('/api/snapshots', headers=self.auth,
            files={'snapshot': ('test.png', self.preview, 'image/png')},
            data={'name': 'Crash fixture', 'layout': json.dumps(layout)})
        self.assertEqual(response.status_code, 201)
        return response.json()

    def trash(self, drawing):
        self.client.delete(f"/api/drawings/{drawing['id']}", headers=self.auth).raise_for_status()

    def purge(self, drawing):
        return self.client.delete(f"/api/drawings/{drawing['id']}/purge", headers=self.auth)

    def delete_moment(self, moment):
        return self.client.delete(f"/api/snapshots/{moment['id']}", headers=self.auth)

    def assert_other_assets(self):
        self.assertEqual(self.client.get(self.other['image_path']).content, self.other_svg)
        self.assertEqual(self.client.get(self.other['vector_path']).json(), self.vectors)
        self.assertEqual(self.client.get(f"/api/favorites/{self.drawing['id']}").content,
                         self.favorite_svg)
        self.assertEqual((self.directory / 'favorites' / f"{self.drawing['id']}.svg").read_bytes(),
                         self.favorite_svg)

    def assert_purged(self, drawing):
        state = self.state()
        self.assertNotIn(drawing['id'], {d['id'] for d in state['drawings']})
        for page in state['pages']:
            for cell in page['cells']:
                self.assertNotIn(drawing['id'], cell['drawing_ids'])
                self.assertNotEqual(cell['active'], drawing['id'])
        persisted = json.loads((self.directory / 'state.json').read_bytes())
        self.assertFalse(any(s['id'] == drawing['id'] for s in persisted['submissions'].values()))
        for folder, suffix, url in [('drawings', '.svg', drawing['image_path']),
                                   ('vectors', '.json', drawing['vector_path'])]:
            self.assertFalse((self.directory / folder / (drawing['id'] + suffix)).exists())
            self.assertEqual(self.client.get(url).status_code, 404)
        self.assert_other_assets()

    def assert_moment_deleted(self, moment):
        state = self.state()
        self.assertNotIn(moment['id'], {s['id'] for s in state['snapshots']})
        self.assertNotIn(moment['page_id'], {p['id'] for p in state['pages']})
        self.assertFalse((self.directory / 'snapshots' / f"{moment['id']}.png").exists())
        self.assertEqual(self.client.get(moment['image_path']).status_code, 404)
        self.assert_other_assets()

    def test_p0_s0_normal_assets_survive_restart_and_normal_deletion(self):
        moment = self.moment()
        self.trash(self.drawing)
        before = self.state()
        self.assertEqual(self.restart(), before)
        self.assertEqual(self.client.get(self.drawing['image_path']).status_code, 200)
        self.assertEqual(self.client.get(self.drawing['vector_path']).json(), self.vectors)
        self.assertEqual(self.client.get(moment['image_path']).status_code, 200)
        self.assertEqual(self.purge(self.drawing).status_code, 200)
        self.assertEqual(self.delete_moment(moment).status_code, 200)
        self.assertEqual(self.state()['revision'], before['revision'] + 2)
        self.restart()
        self.assert_purged(self.drawing)
        self.assert_moment_deleted(moment)
        self.assertEqual(list(self.directory.glob('.purge-*')), [])
        self.assertEqual(list(self.directory.glob('.snapshot-delete-*')), [])

    def assert_purge_precommit_crash(self, stage_vector):
        self.trash(self.drawing)
        before = self.state()
        original_files = self.files()
        # Materialize P1/P2 with the old state intact. No exception/rollback path runs.
        self.client.close()
        quarantine = Path(tempfile.mkdtemp(prefix='.purge-', dir=self.directory))
        sources = [('drawings', '.svg')]
        if stage_vector:
            sources.append(('vectors', '.json'))
        staged = {}
        for folder, suffix in sources:
            source = self.directory / folder / (self.drawing['id'] + suffix)
            target = quarantine / source.name
            os.replace(source, target)
            staged[target] = original_files[source.relative_to(self.directory)]
        self.assertEqual(self.restart(), before)
        self.assertEqual(self.client.get(self.drawing['image_path']).status_code, 404)
        self.assertEqual(self.client.get(self.drawing['vector_path']).status_code,
                         404 if stage_vector else 200)
        self.assert_other_assets()
        # BROKEN_REFERENCE on restart, but RETRY_RECOVERABLE by completing deletion.
        # Retry does NOT restore artwork or reclaim the original crash quarantine.
        self.assertEqual(self.purge(self.drawing).status_code, 200)
        self.assertEqual(self.state(), {**before, 'revision': before['revision'] + 1,
            'drawings': [d for d in before['drawings'] if d['id'] != self.drawing['id']]})
        self.assert_purged(self.drawing)
        for path, data in staged.items():
            self.assertEqual(path.read_bytes(), data)
        for path, data in original_files.items():
            if path.parts[0] not in {'drawings', 'vectors'} or self.drawing['id'] not in path.name:
                if path != Path('state.json'):
                    self.assertEqual(self.files()[path], data)
        purged = self.state()
        self.assertEqual(self.restart(), purged)
        self.assert_purged(self.drawing)
        self.assertEqual(self.purge(self.drawing).status_code, 404)
        self.assertEqual(self.state(), purged)
        self.assertEqual({p: p.read_bytes() for p in staged}, staged)

    def test_p1_first_asset_staged_old_metadata_retry_finishes_purge(self):
        self.assert_purge_precommit_crash(stage_vector=False)

    def test_p2_all_assets_staged_old_metadata_retry_finishes_purge(self):
        self.assert_purge_precommit_crash(stage_vector=True)

    def test_p3_p4_committed_purge_debris_is_not_resurrected_or_reclaimed(self):
        # Use real API commits, then saved bytes to construct the exact post-commit
        # disk layouts: both files, vector only after first unlink, empty directory.
        for retained in [('drawings', 'vectors'), ('vectors',), ()]:
            with self.subTest(retained=retained):
                drawing = self.submit()
                assets = {'drawings': ('.svg', self.client.get(drawing['image_path']).content),
                          'vectors': ('.json', self.client.get(drawing['vector_path']).content)}
                self.trash(drawing)
                before = self.state()
                self.assertEqual(self.purge(drawing).status_code, 200)
                self.assertEqual(self.state()['revision'], before['revision'] + 1)
                self.client.close()
                quarantine = Path(tempfile.mkdtemp(prefix='.purge-', dir=self.directory))
                for folder in retained:
                    suffix, data = assets[folder]
                    (quarantine / (drawing['id'] + suffix)).write_bytes(data)
                state = self.restart()
                files = self.files()
                self.assert_purged(drawing)
                self.assertEqual(self.purge(drawing).status_code, 404)
                self.assertEqual(self.state(), state)
                self.assertEqual(self.files(), files)
                self.assertEqual(self.restart(), state)
                self.assertTrue(quarantine.is_dir())

    def test_s1_staged_png_old_metadata_retry_finishes_snapshot_deletion(self):
        moment, unrelated = self.moment(), self.moment()
        png = self.directory / 'snapshots' / f"{moment['id']}.png"
        png_bytes = png.read_bytes()
        other_bytes = self.client.get(unrelated['image_path']).content
        before = self.state()
        self.client.close()
        staged = self.directory / f".snapshot-delete-{moment['id']}-{uuid4().hex}.png"
        os.replace(png, staged)
        self.assertEqual(self.restart(), before)
        self.assertEqual(self.client.get(moment['image_path']).status_code, 404)
        self.assertEqual(staged.read_bytes(), png_bytes)
        self.assertEqual(self.delete_moment(moment).status_code, 200)
        self.assertEqual(self.state(), {**before, 'revision': before['revision'] + 1,
            'snapshots': [s for s in before['snapshots'] if s['id'] != moment['id']],
            'pages': [p for p in before['pages'] if p['id'] != moment['page_id']]})
        self.assert_moment_deleted(moment)
        after = self.state()
        self.assertEqual(self.restart(), after)
        self.assertEqual(self.client.get(unrelated['image_path']).content, other_bytes)
        self.assertEqual(staged.read_bytes(), png_bytes)
        self.assertEqual(self.delete_moment(moment).status_code, 404)
        self.assertEqual(self.state(), after)

    def test_s2_s3_committed_snapshot_debris_is_private_and_not_resurrected(self):
        moment = self.moment()
        png_bytes = self.client.get(moment['image_path']).content
        self.assertEqual(self.delete_moment(moment).status_code, 200)
        self.client.close()
        staged = self.directory / f".snapshot-delete-{moment['id']}-{uuid4().hex}.png"
        staged.write_bytes(png_bytes)
        state = self.restart()
        self.assert_moment_deleted(moment)
        self.assertEqual(self.client.get('/api/media/' + staged.name).status_code, 404)
        self.assertEqual(self.client.get('/' + staged.name).status_code, 404)
        self.assertEqual(self.delete_moment(moment).status_code, 404)
        self.assertEqual(self.state(), state)
        self.assertEqual(self.restart(), state)
        self.assertEqual(staged.read_bytes(), png_bytes)

    def test_accumulated_quarantines_are_isolated_and_new_operations_use_fresh_names(self):
        svg = self.client.get(self.drawing['image_path']).content
        vector = self.client.get(self.drawing['vector_path']).content
        # A small fixture, including repeated IDs with different quarantine names.
        for nonce in ['a', 'b']:
            quarantine = self.directory / ('.purge-' + nonce)
            quarantine.mkdir()
            (quarantine / f"{self.drawing['id']}.svg").write_bytes(svg)
            (quarantine / f"{self.drawing['id']}.json").write_bytes(vector)
            hidden = self.directory / f".snapshot-delete-{uuid4().hex}-{uuid4().hex}.png"
            hidden.write_bytes(self.preview)
        before, artifacts = self.state(), self.files()
        self.assertEqual(self.restart(), before)
        for path in artifacts:
            if path.parts[0].startswith('.purge-') or path.name.startswith('.snapshot-delete-'):
                self.assertEqual(self.client.get('/' + path.as_posix()).status_code, 404)
                self.assertEqual(self.client.get('/api/media/' + path.name).status_code, 404)
        self.assertEqual({d['id'] for d in self.client.get('/api/drawings').json()},
                         {self.other['id'], self.drawing['id']})
        self.assertEqual(self.state()['snapshots'], [])
        real_replace, targets = os.replace, []

        def observe_staging(source, target):
            target = Path(target)
            if target.parent.name.startswith('.purge-') or target.name.startswith('.snapshot-delete-'):
                targets.append(target)
                self.assertFalse(target.exists(), 'new operation reused a quarantine path')
            return real_replace(source, target)

        with patch('os.replace', side_effect=observe_staging):
            for _ in range(2):
                drawing, moment = self.submit(), self.moment()
                self.assertNotIn(drawing['id'], {self.other['id'], self.drawing['id']})
                self.trash(drawing)
                self.assertEqual(self.purge(drawing).status_code, 200)
                self.assertEqual(self.delete_moment(moment).status_code, 200)
        purge_names = {p.parent.name for p in targets if p.parent.name.startswith('.purge-')}
        snapshot_names = {p.name for p in targets if p.name.startswith('.snapshot-delete-')}
        self.assertEqual(len(purge_names), 2)
        self.assertEqual(len(snapshot_names), 2)
        self.assertTrue(purge_names.isdisjoint({'.purge-a', '.purge-b'}))
        for name in snapshot_names:
            self.assertEqual(len(UUID(Path(name).stem.rsplit('-', 1)[-1]).hex), 32)
        for path, data in artifacts.items():
            if path.parts[0].startswith('.') and path != Path('state.json'):
                self.assertEqual(self.files()[path], data)
        self.restart()
        self.assertEqual(len(list(self.directory.glob('.purge-*'))), 2)
        self.assertEqual(len(list(self.directory.glob('.snapshot-delete-*'))), 2)
        self.assert_other_assets()

    def test_quarantines_are_not_discovered_on_initial_start_without_state_file(self):
        with tempfile.TemporaryDirectory(prefix='cos-crash-discovery-') as folder:
            directory = Path(folder)
            quarantine = directory / '.purge-only'
            quarantine.mkdir()
            drawing_id = uuid4().hex
            (quarantine / f'{drawing_id}.svg').write_bytes(self.client.get(self.drawing['image_path']).content)
            (quarantine / f'{drawing_id}.json').write_bytes(json.dumps(self.vectors).encode())
            hidden = directory / f'.snapshot-delete-{uuid4().hex}-{uuid4().hex}.png'
            hidden.write_bytes(self.preview)
            for _ in range(2):
                client = TestClient(create_app(directory))
                try:
                    state = client.get('/api/state').json()
                    self.assertEqual(state['revision'], 0)
                    self.assertEqual(state['drawings'], [])
                    self.assertEqual(state['snapshots'], [])
                    self.assertEqual(client.get('/api/drawings').json(), [])
                    self.assertTrue(all(not c['drawing_ids'] for p in state['pages'] for c in p['cells']))
                    self.assertEqual(client.get('/' + hidden.name).status_code, 404)
                finally:
                    client.close()
            self.assertEqual(hidden.read_bytes(), self.preview)
            self.assertEqual(len(list(quarantine.iterdir())), 2)

    def test_interrupted_state_write_exposes_old_or_replaced_state_never_pending_content(self):
        path = self.directory / 'state.json'
        old_bytes, old_state = path.read_bytes(), self.state()
        page_id = old_state['current_page_id']
        self.client.patch(f'/api/pages/{page_id}', json={'name': 'New durable name'},
                          headers=self.auth).raise_for_status()
        new_bytes, new_state = path.read_bytes(), self.state()
        self.assertEqual(new_state['revision'], old_state['revision'] + 1)
        self.client.close()
        # Before replace: old target plus either a partial write or fully flushed
        # replacement. Crash bypasses atomic_write's finally cleanup entirely.
        path.write_bytes(old_bytes)
        pending = self.directory / '.pending-crash-state'
        for data in [new_bytes[:17], new_bytes]:
            with self.subTest(pending_complete=data == new_bytes):
                pending.write_bytes(data)
                self.assertEqual(self.restart(), old_state)
                self.assertEqual(pending.read_bytes(), data)
        self.client.close()
        os.replace(pending, path)
        self.assertEqual(self.restart(), new_state)
        self.assertFalse(pending.exists())
        self.assertEqual(path.read_bytes(), new_bytes)
        self.assert_other_assets()
