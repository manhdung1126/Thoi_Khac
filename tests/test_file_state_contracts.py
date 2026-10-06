"""Fault-injected API/storage outcomes; every asset lives in temporary storage."""
import errno
import io
import json
import os
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import Mock, patch
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image
from backend.app.main import create_app


class FileStateContracts(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='cos-file-state-')
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        clock = patch('backend.app.main.time.time', return_value=100)
        clock.start()
        self.addCleanup(clock.stop)
        self.open_app()
        self.addCleanup(lambda: self.client.close())
        self.vectors = {'version': 1, 'profile': 'led-2px', 'strokes': [
            {'erase': False, 'width': 2, 'points': [[20, 20], [400, 400]]}]}
        self.raw_vectors = json.dumps(self.vectors)
        with patch('backend.app.led.secrets.choice', side_effect=lambda choices: choices[-1]):
            self.drawings = [self.submit(uuid4().hex).json() for _ in range(2)]
        response = self.client.patch(f"/api/drawings/{self.drawings[1]['id']}/favorite",
            json={'favorite': True}, headers=self.auth)
        self.assertEqual(response.status_code, 200)
        image = io.BytesIO()
        Image.new('RGBA', (8, 8), (255, 215, 0, 255)).save(image, format='PNG')
        self.preview = image.getvalue()

    def open_app(self):
        # No background ticker, sockets or production server are used.
        self.client = TestClient(create_app(self.directory), raise_server_exceptions=False)
        response = self.client.post('/api/admin/login', json={'pin': '2468'})
        self.assertEqual(response.status_code, 200)
        self.auth = {'Authorization': 'Bearer ' + response.json()['token']}

    def state(self):
        response = self.client.get('/api/state')
        self.assertEqual(response.status_code, 200)
        return response.json()

    def files(self):
        return {path.relative_to(self.directory): path.read_bytes()
                for path in self.directory.rglob('*') if path.is_file()}

    def submit(self, submission_id):
        return self.client.post('/api/drawings', data={
            'submission_id': submission_id, 'strokes': self.raw_vectors})

    def moment(self):
        layout = [None] * 27
        layout[8] = self.drawings[0]['id']
        return self.client.post('/api/snapshots', headers=self.auth,
            files={'snapshot': ('test.png', self.preview, 'image/png')},
            data={'name': 'Fault test', 'layout': json.dumps(layout)})

    def assert_recovery(self, expected_state, expected_files):
        self.assertEqual(self.state(), expected_state)
        self.assertEqual(self.files(), expected_files)
        self.client.close()
        self.open_app()
        self.assertEqual(self.state(), expected_state)
        self.assertEqual(self.files(), expected_files)
        self.assertEqual(self.client.app.state.store.state,
                         json.loads(expected_files[Path('state.json')]))
        self.assertEqual(self.client.get('/api/health').status_code, 200)
        for drawing in self.drawings:
            self.assertEqual(self.client.get(drawing['image_path']).content,
                             expected_files[Path('drawings') / f"{drawing['id']}.svg"])
            self.assertEqual(self.client.get(drawing['vector_path']).json(), self.vectors)

    def test_upload_temporary_file_creation_failure_at_each_stage_rolls_back_and_retries_after_restart(self):
        original = tempfile.mkstemp
        for folder in ['drawings', 'vectors', '.']:
            with self.subTest(folder=folder):
                before, files, submission_id = self.state(), self.files(), uuid4().hex

                def fail_temporary(*args, **kwargs):
                    if Path(kwargs['dir']) == self.directory / folder:
                        raise OSError(errno.ENOSPC, 'temporary file unavailable')
                    return original(*args, **kwargs)

                with patch('tempfile.mkstemp', side_effect=fail_temporary):
                    failed = self.submit(submission_id)
                self.assertEqual(failed.status_code, 507)
                self.assertIn('detail', failed.json())
                self.assert_recovery(before, files)
                retry = self.submit(submission_id)
                self.assertEqual(retry.status_code, 201)
                drawing = retry.json()
                self.assertFalse(drawing['replayed'])
                self.assertEqual(self.state()['revision'], before['revision'] + 1)
                self.assertEqual(self.client.get(drawing['image_path']).status_code, 200)
                self.assertEqual(self.client.get(drawing['vector_path']).json(), self.vectors)
                self.assertEqual(set(self.files()) - set(files), {
                    Path('drawings') / f"{drawing['id']}.svg",
                    Path('vectors') / f"{drawing['id']}.json"})

    def test_partial_upload_stream_write_failure_removes_temporary_data_and_preserves_old_assets(self):
        before, files = self.state(), self.files()
        original = os.fdopen

        @contextmanager
        def failing_stream(descriptor, mode):
            with original(descriptor, mode) as stream:
                proxy = Mock(wraps=stream)

                def partial_write(data):
                    stream.write(data[:12])
                    raise OSError(errno.ENOSPC, 'partial write rejected')

                proxy.write.side_effect = partial_write
                yield proxy

        with patch('os.fdopen', side_effect=failing_stream):
            failed = self.submit(uuid4().hex)
        self.assertEqual(failed.status_code, 507)
        self.assert_recovery(before, files)
        self.assertEqual(self.submit(uuid4().hex).status_code, 201)

    def test_snapshot_creation_and_persistence_faults_leave_no_orphan_png_and_recover(self):
        real_temporary, real_replace = tempfile.mkstemp, os.replace
        scenarios = [('temporary', 'snapshots'), ('replace', 'snapshots'),
                     ('flush', 'snapshots'), ('temporary', '.'), ('replace', '.')]
        for boundary, folder in scenarios:
            with self.subTest(boundary=boundary, folder=folder):
                before, files = self.state(), self.files()

                def fail_temporary(*args, **kwargs):
                    if Path(kwargs['dir']) == self.directory / folder:
                        raise OSError(errno.ENOSPC, 'temporary file rejected')
                    return real_temporary(*args, **kwargs)

                def fail_replace(source, target):
                    if Path(target).parent == self.directory / folder:
                        raise OSError(errno.EACCES, 'replace rejected')
                    return real_replace(source, target)

                fault = (patch('tempfile.mkstemp', side_effect=fail_temporary) if boundary == 'temporary'
                         else patch('os.replace', side_effect=fail_replace) if boundary == 'replace'
                         else patch('os.fsync', side_effect=OSError(errno.ENOSPC, 'flush rejected')))
                with fault:
                    failed = self.moment()
                self.assertEqual(failed.status_code, 507)
                self.assert_recovery(before, files)
                retry = self.moment()
                self.assertEqual(retry.status_code, 201)
                self.assertEqual(self.state()['revision'], before['revision'] + 1)
                self.assertEqual(self.state()['current_page_id'], before['current_page_id'])
                self.assertEqual(self.client.get(retry.json()['image_path']).status_code, 200)
                self.assertEqual(set(self.files()) - set(files), {
                    Path('snapshots') / f"{retry.json()['id']}.png"})

    def test_state_serialization_failure_after_upload_or_snapshot_creation_rolls_back_assets(self):
        real_dumps = json.dumps
        for operation in ['upload', 'snapshot']:
            with self.subTest(operation=operation):
                before, files = self.state(), self.files()

                def fail_state(value, *args, **kwargs):
                    if isinstance(value, dict) and 'revision' in value and 'pages' in value:
                        raise ValueError('state serialization rejected')
                    return real_dumps(value, *args, **kwargs)

                with patch('json.dumps', side_effect=fail_state):
                    failed = self.submit(uuid4().hex) if operation == 'upload' else self.moment()
                self.assertEqual(failed.status_code, 500)
                self.assert_recovery(before, files)
                retry = self.submit(uuid4().hex) if operation == 'upload' else self.moment()
                self.assertEqual(retry.status_code, 201)

    def test_favorite_copy_read_create_and_replace_failures_do_not_commit_flag_or_create_artifact(self):
        drawing = self.drawings[0]
        source = self.directory / 'drawings' / f"{drawing['id']}.svg"
        real_read, real_temporary, real_replace = Path.read_bytes, tempfile.mkstemp, os.replace
        for boundary in ['read', 'temporary', 'replace']:
            with self.subTest(boundary=boundary):
                before, files = self.state(), self.files()

                def fail_read(path):
                    if path == source:
                        raise OSError(errno.EACCES, 'read rejected')
                    return real_read(path)

                def fail_temporary(*args, **kwargs):
                    if Path(kwargs['dir']) == self.directory / 'favorites':
                        raise OSError(errno.ENOSPC, 'temporary file rejected')
                    return real_temporary(*args, **kwargs)

                def fail_replace(src, target):
                    if Path(target).parent == self.directory / 'favorites':
                        raise OSError(errno.EACCES, 'replace rejected')
                    return real_replace(src, target)

                fault = (patch.object(Path, 'read_bytes', fail_read) if boundary == 'read'
                         else patch('tempfile.mkstemp', side_effect=fail_temporary) if boundary == 'temporary'
                         else patch('os.replace', side_effect=fail_replace))
                with fault:
                    failed = self.client.patch(f"/api/drawings/{drawing['id']}/favorite",
                        json={'favorite': True}, headers=self.auth)
                self.assertEqual(failed.status_code, 507)
                self.assert_recovery(before, files)

    def test_favorite_commit_failure_retains_export_without_flag_contract_unclear(self):
        # Characterization only: export copies intentionally survive original purge.
        # Whether a failed favorite operation may also retain one needs a design decision.
        before, files = self.state(), self.files()
        drawing = self.drawings[0]
        real_replace = os.replace

        def fail_state(source, target):
            if Path(target) == self.directory / 'state.json':
                raise OSError(errno.ENOSPC, 'state persistence rejected')
            return real_replace(source, target)

        with patch('os.replace', side_effect=fail_state):
            failed = self.client.patch(f"/api/drawings/{drawing['id']}/favorite",
                json={'favorite': True}, headers=self.auth)
        self.assertEqual(failed.status_code, 507)
        retained = Path('favorites') / f"{drawing['id']}.svg"
        expected = {**files, retained: files[Path('drawings') / f"{drawing['id']}.svg"]}
        self.assert_recovery(before, expected)
        self.assertFalse(next(d for d in self.state()['drawings'] if d['id'] == drawing['id'])['favorite'])
        self.assertEqual(self.client.get(f"/api/favorites/{drawing['id']}").content, expected[retained])
        retry = self.client.patch(f"/api/drawings/{drawing['id']}/favorite",
            json={'favorite': True}, headers=self.auth)
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(retry.json()['revision'], before['revision'] + 1)
        self.assertTrue(next(d for d in retry.json()['drawings'] if d['id'] == drawing['id'])['favorite'])
        self.assertEqual((self.directory / retained).read_bytes(), expected[retained])

    def test_purge_unlink_failure_does_not_leave_unreachable_source_assets_after_restart(self):
        drawing = self.drawings[0]
        drawing_id = drawing['id']
        source = self.directory / 'drawings' / f'{drawing_id}.svg'
        trashed = self.client.delete(f'/api/drawings/{drawing_id}', headers=self.auth)
        self.assertEqual(trashed.status_code, 200)
        before, files = self.state(), self.files()
        real_replace = os.replace

        def fail_svg(path, target):
            if Path(path) == source:
                raise PermissionError(errno.EACCES, 'purge staging rejected')
            return real_replace(path, target)

        with patch('os.replace', side_effect=fail_svg):
            failed = self.client.delete(f'/api/drawings/{drawing_id}/purge', headers=self.auth)
        self.assertEqual(failed.status_code, 507)
        self.assertIn('detail', failed.json())
        after, actual = self.state(), self.files()
        self.assertEqual({p: data for p, data in actual.items() if p != Path('state.json')},
                         {p: data for p, data in files.items() if p != Path('state.json')})
        for key in ['settings', 'pages', 'snapshots', 'current_page_id']:
            self.assertEqual(after[key], before[key], key)
        self.client.close()
        self.open_app()
        self.assertEqual(self.state(), after)
        self.assertEqual(self.files(), actual)
        self.assertEqual(self.client.app.state.store.state, json.loads(actual[Path('state.json')]))
        self.assertEqual(after, before)
        self.assertEqual(actual, files)
        self.assertEqual(self.client.get(drawing['image_path']).content, files[source.relative_to(self.directory)])
        self.assertEqual(self.client.get(drawing['vector_path']).json(), self.vectors)
        retry = self.client.delete(f'/api/drawings/{drawing_id}/purge', headers=self.auth)
        self.assertEqual(retry.status_code, 200)
        purged, purged_files = self.state(), self.files()
        self.assertEqual(purged['revision'], before['revision'] + 1)
        self.assertNotIn(drawing_id, {d['id'] for d in purged['drawings']})
        self.assertFalse(any(s['id'] == drawing_id for s in json.loads(purged_files[Path('state.json')])['submissions'].values()))
        expected_files = {p: data for p, data in files.items()
                          if p not in (Path('state.json'), Path('drawings') / f'{drawing_id}.svg',
                                       Path('vectors') / f'{drawing_id}.json')}
        self.assertEqual({p: data for p, data in purged_files.items() if p != Path('state.json')}, expected_files)
        self.client.close()
        self.open_app()
        self.assertEqual(self.state(), purged)
        self.assertEqual(self.files(), purged_files)
        self.assertEqual(self.client.get(drawing['image_path']).status_code, 404)
        self.assertEqual(self.client.get(drawing['vector_path']).status_code, 404)
        registered = {d['id'] for d in after['drawings']}
        unreachable = sorted(str(p) for p in actual
            if p.parent in (Path('drawings'), Path('vectors')) and p.stem not in registered)
        print('PURGE_FAILURE_EVIDENCE ' + json.dumps({
            'api_status': failed.status_code, 'retry_status': retry.status_code,
            'revision_before': before['revision'], 'revision_after': after['revision'],
            'drawing_in_state': drawing_id in registered,
            'submission_binding_present': any(s['id'] == drawing_id for s in json.loads(actual[Path('state.json')])['submissions'].values()),
            'orphan_files': unreachable,
            'svg_get_after_restart': self.client.get(drawing['image_path']).status_code,
            'vectors_get_after_restart': self.client.get(drawing['vector_path']).status_code,
            'unrelated_svg_get': self.client.get(self.drawings[1]['image_path']).status_code,
        }), flush=True)
        # A failed cleanup must keep source assets reachable/retryable, or finish
        # deleting them. No requirement to choose a particular rollback strategy.
        self.assertEqual(unreachable, [],
            f'P2: purge returned {failed.status_code}, retry returned {retry.status_code}, '
            'but source SVG/vector files remain without a drawing reference after restart')

    def assert_purge_retry(self, drawing, before, files):
        drawing_id = drawing['id']
        response = self.client.delete(f'/api/drawings/{drawing_id}/purge', headers=self.auth)
        self.assertEqual(response.status_code, 200)
        expected = {**before, 'revision': before['revision'] + 1,
                    'drawings': [d for d in before['drawings'] if d['id'] != drawing_id]}
        self.assertEqual(self.state(), expected)
        purged_files = self.files()
        sources = {Path('drawings') / f'{drawing_id}.svg', Path('vectors') / f'{drawing_id}.json'}
        self.assertEqual({p: data for p, data in purged_files.items() if p != Path('state.json')},
                         {p: data for p, data in files.items() if p not in sources | {Path('state.json')}})
        persisted = json.loads(purged_files[Path('state.json')])
        self.assertFalse(any(s['id'] == drawing_id for s in persisted['submissions'].values()))
        self.client.close()
        self.open_app()
        self.assertEqual(self.state(), expected)
        self.assertEqual(self.files(), purged_files)
        self.assertEqual(self.client.app.state.store.state, persisted)
        self.assertEqual(self.client.get(drawing['image_path']).status_code, 404)
        self.assertEqual(self.client.get(drawing['vector_path']).status_code, 404)
        self.assertEqual(self.client.get('/api/health').status_code, 200)
        self.assertEqual(self.client.delete(f'/api/drawings/{drawing_id}/purge', headers=self.auth).status_code, 404)
        self.assertEqual(self.state(), expected)
        self.assertEqual(self.files(), purged_files)

    def test_purge_second_asset_staging_failure_restores_first_asset_before_restart_and_retry(self):
        drawing = self.drawings[0]
        drawing_id = drawing['id']
        self.client.delete(f'/api/drawings/{drawing_id}', headers=self.auth).raise_for_status()
        before, files = self.state(), self.files()
        svg = self.directory / 'drawings' / f'{drawing_id}.svg'
        vector = self.directory / 'vectors' / f'{drawing_id}.json'
        real_replace = os.replace
        staged = []

        def fail_second(source, target):
            if Path(source) == vector:
                self.assertFalse(svg.exists())
                self.assertEqual(len(staged), 1)
                self.assertEqual(staged[0].read_bytes(), files[svg.relative_to(self.directory)])
                raise PermissionError(errno.EACCES, 'second asset staging rejected')
            result = real_replace(source, target)
            if Path(source) == svg:
                staged.append(Path(target))
            return result

        with patch('os.replace', side_effect=fail_second):
            failed = self.client.delete(f'/api/drawings/{drawing_id}/purge', headers=self.auth)
        self.assertEqual(failed.status_code, 507)
        self.assertEqual(len(staged), 1)
        self.assert_recovery(before, files)
        self.assert_purge_retry(drawing, before, files)

    def test_purge_state_persistence_failure_restores_both_assets_after_restart_and_retry(self):
        drawing = self.drawings[0]
        drawing_id = drawing['id']
        self.client.delete(f'/api/drawings/{drawing_id}', headers=self.auth).raise_for_status()
        before, files = self.state(), self.files()
        sources = [self.directory / 'drawings' / f'{drawing_id}.svg',
                   self.directory / 'vectors' / f'{drawing_id}.json']
        real_replace = os.replace
        reached_commit = []

        def fail_state(source, target):
            if Path(target) == self.directory / 'state.json':
                self.assertTrue(all(not path.exists() for path in sources))
                reached_commit.append(True)
                raise OSError(errno.ENOSPC, 'state persistence rejected after staging')
            return real_replace(source, target)

        with patch('os.replace', side_effect=fail_state):
            failed = self.client.delete(f'/api/drawings/{drawing_id}/purge', headers=self.auth)
        self.assertEqual(failed.status_code, 507)
        self.assertEqual(reached_commit, [True])
        self.assert_recovery(before, files)
        self.assert_purge_retry(drawing, before, files)

    def test_purge_quarantine_creation_failure_preserves_state_assets_and_retry(self):
        drawing = self.drawings[0]
        self.client.delete(f"/api/drawings/{drawing['id']}", headers=self.auth).raise_for_status()
        before, files = self.state(), self.files()
        with patch('tempfile.mkdtemp', side_effect=PermissionError(errno.EACCES, 'quarantine rejected')):
            failed = self.client.delete(f"/api/drawings/{drawing['id']}/purge", headers=self.auth)
        self.assertEqual(failed.status_code, 507)
        self.assert_recovery(before, files)
        self.assert_purge_retry(drawing, before, files)

    def test_purge_post_commit_cleanup_faults_keep_normal_paths_empty_and_favorite_export_after_restart(self):
        real_unlink = Path.unlink
        for suffix in ['.svg', '.json']:
            with self.subTest(suffix=suffix):
                drawing = self.submit(uuid4().hex).json()
                drawing_id = drawing['id']
                self.client.patch(f'/api/drawings/{drawing_id}/favorite',
                    json={'favorite': True}, headers=self.auth).raise_for_status()
                self.client.delete(f'/api/drawings/{drawing_id}', headers=self.auth).raise_for_status()
                before, files = self.state(), self.files()

                def fail_cleanup(path, *args, **kwargs):
                    if path.parent.name.startswith('.purge-') and path.name == drawing_id + suffix:
                        raise PermissionError(errno.EACCES, 'quarantine cleanup rejected')
                    return real_unlink(path, *args, **kwargs)

                with self.assertLogs('backend.app.main', level='ERROR') as logs:
                    with patch.object(Path, 'unlink', fail_cleanup):
                        response = self.client.delete(f'/api/drawings/{drawing_id}/purge', headers=self.auth)
                self.assertEqual(response.status_code, 200)
                self.assertTrue(any('Committed purge cleanup deferred' in message for message in logs.output))
                purged, actual = self.state(), self.files()
                self.assertEqual(purged, {**before, 'revision': before['revision'] + 1,
                    'drawings': [d for d in before['drawings'] if d['id'] != drawing_id]})
                normal = {Path('drawings') / f'{drawing_id}.svg', Path('vectors') / f'{drawing_id}.json'}
                retained = set(actual) - set(files)
                self.assertEqual(len(retained), 1)
                artifact = retained.pop()
                self.assertTrue(artifact.parent.name.startswith('.purge-'))
                self.assertEqual(artifact.name, drawing_id + suffix)
                original = Path('drawings' if suffix == '.svg' else 'vectors') / artifact.name
                self.assertEqual(actual[artifact], files[original])
                self.assertEqual({p: data for p, data in actual.items() if p != Path('state.json') and p != artifact},
                                 {p: data for p, data in files.items() if p not in normal | {Path('state.json')}})
                self.client.close()
                self.open_app()
                self.assertEqual(self.state(), purged)
                self.assertEqual(self.files(), actual)
                self.assertEqual(self.client.app.state.store.state, json.loads(actual[Path('state.json')]))
                self.assertEqual(self.client.get(drawing['image_path']).status_code, 404)
                self.assertEqual(self.client.get(drawing['vector_path']).status_code, 404)
                self.assertEqual(self.client.get('/api/favorites/' + drawing_id).content,
                                 files[Path('favorites') / f'{drawing_id}.svg'])
                self.assertEqual(self.client.delete(f'/api/drawings/{drawing_id}/purge', headers=self.auth).status_code, 404)
                self.assertEqual(self.state(), purged)
                self.assertEqual(self.files(), actual)

    def test_purge_missing_svg_vector_or_both_remains_successful_after_restart(self):
        for missing in [('drawings',), ('vectors',), ('drawings', 'vectors')]:
            with self.subTest(missing=missing):
                drawing = self.submit(uuid4().hex).json()
                drawing_id = drawing['id']
                self.client.delete(f'/api/drawings/{drawing_id}', headers=self.auth).raise_for_status()
                for folder in missing:
                    suffix = '.svg' if folder == 'drawings' else '.json'
                    (self.directory / folder / (drawing_id + suffix)).unlink()
                before, files = self.state(), self.files()
                self.client.close()
                self.open_app()
                self.assertEqual(self.state(), before)
                self.assert_purge_retry(drawing, before, files)
