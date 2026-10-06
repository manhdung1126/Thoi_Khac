"""Store transactions: committed, public and recovered data must agree."""
import copy
import json
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

from backend.app import led
from backend.app.main import Store, current_page, new_page


class StoreContracts(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='cos-store-contract-')
        self.addCleanup(temporary.cleanup)
        self.directory = temporary.name
        clock = patch('backend.app.main.time.time', return_value=100)
        self.clock = clock.start()
        self.addCleanup(clock.stop)
        self.store = Store(self.directory)
        vectors = {'version': 1, 'profile': 'led-2px', 'strokes': [
            {'erase': False, 'width': 2, 'points': [[10, 10], [200, 200]]}]}
        with patch('backend.app.led.secrets.choice', side_effect=lambda choices: choices[-1]):
            self.ids = [self.store.upload(uuid4().hex, vectors)[0]['id'] for _ in range(2)]
        self.live = self.store.public()['current_page_id']

        def seed(state):
            for drawing_id in self.ids:
                led.assign(current_page(state), drawing_id, 0)
            other = new_page(state)
            led.assign(other, self.ids[0], 4)
            state['current_page_id'] = self.live
            return other['id']

        self.other = self.store.mutate(seed)

    def assert_durable(self):
        persisted = json.loads(self.store.path.read_text())
        self.assertEqual(persisted, self.store.state)
        recovered = Store(self.directory)
        self.assertEqual(recovered.state, persisted)
        self.assertEqual(recovered.public(), self.store.public())

    def test_success_commits_once_returns_result_and_preserves_other_data(self):
        before = self.store.public()
        self.clock.return_value = 103

        def rename(state):
            current_page(state)['name'] = 'Tên đã lưu'
            return 'saved'

        self.assertEqual(self.store.mutate(rename), 'saved')
        after = self.store.public()
        self.assertEqual(after['revision'], before['revision'] + 1)
        self.assertEqual(current_page(after)['name'], 'Tên đã lưu')
        for key in ['settings', 'drawings', 'snapshots', 'current_page_id']:
            self.assertEqual(after[key], before[key], key)
        self.assertEqual(current_page(after)['cells'], current_page(before)['cells'])
        self.assertEqual(after['pages'][1], before['pages'][1])
        self.assert_durable()

    def test_callback_exception_discards_all_partial_changes_and_revision(self):
        before = copy.deepcopy(self.store.state)
        persisted = self.store.path.read_bytes()

        def fail(state):
            state['settings']['rotation_seconds'] = 31
            current_page(state)['cells'][0]['drawing_ids'].clear()
            state['drawings'][0]['deleted'] = True
            new_page(state)
            raise ValueError('reject transaction')

        with self.assertRaisesRegex(ValueError, 'reject transaction'):
            self.store.mutate(fail)
        self.assertEqual(self.store.state, before)
        self.assertEqual(self.store.path.read_bytes(), persisted)
        self.assert_durable()

    def test_failed_atomic_replacement_keeps_memory_disk_and_restart_unchanged(self):
        before = copy.deepcopy(self.store.state)
        persisted = self.store.path.read_bytes()

        def rename(state):
            current_page(state)['name'] = 'Không được lưu'
            state['settings']['led_fade'] = .5

        with patch('backend.app.main.os.replace', side_effect=OSError('disk unavailable')):
            with self.assertRaisesRegex(OSError, 'disk unavailable'):
                self.store.mutate(rename)
        self.assertEqual(self.store.state, before)
        self.assertEqual(self.store.path.read_bytes(), persisted)
        self.assertEqual(list(self.store.directory.glob('.pending-*')), [])
        self.assert_durable()

    def test_public_projection_exposes_committed_revision_without_persisting_read_metadata(self):
        self.store.mutate(lambda state: state['settings'].update(rotation_seconds=17))
        persisted = self.store.path.read_bytes()
        self.clock.return_value = 106
        view = self.store.public()
        self.assertEqual(view['server_time'], 106)
        self.assertEqual(view['revision'], self.store.state['revision'])
        self.assertEqual(view['settings']['rotation_seconds'], 17)
        self.assertEqual(current_page(view)['items'][0]['drawing_id'], self.ids[1])
        self.assertNotIn('submissions', view)
        self.assertEqual(len(self.store.state['submissions']), 2)
        self.assertNotIn('server_time', json.loads(persisted))
        view['settings']['rotation_seconds'] = 99
        view['pages'][0]['cells'][0]['drawing_ids'].clear()
        self.assertEqual(self.store.public()['settings']['rotation_seconds'], 17)
        self.assertEqual(current_page(self.store.public())['cells'][0]['drawing_ids'], self.ids)
        self.assertEqual(self.store.path.read_bytes(), persisted)
        self.assert_durable()

    def test_independent_mutations_preserve_pages_queues_and_drawings_across_restart(self):
        before = self.store.public()
        operations = [
            lambda state: state['settings'].update(rotation_seconds=23),
            lambda state: state['pages'][1].update(name='Trang ngoài sóng'),
            lambda state: state['drawings'][0].update(created_at=97),
        ]
        for offset, operation in enumerate(operations, 1):
            self.clock.return_value = 100 + offset
            self.store.mutate(operation)
            view = self.store.public()
            self.assertEqual(view['revision'], before['revision'] + offset)
            self.assertEqual(view['current_page_id'], self.live)
            self.assertEqual(current_page(view), current_page(before))
            self.assertEqual(view['pages'][1]['cells'], before['pages'][1]['cells'])
            self.assertEqual(view['drawings'][1], before['drawings'][1])
            self.assertEqual(view['snapshots'], before['snapshots'])
            self.assert_durable()
        final = self.store.public()
        self.assertEqual(final['settings']['rotation_seconds'], 23)
        self.assertEqual(final['pages'][1]['name'], 'Trang ngoài sóng')
        self.assertEqual(final['drawings'][0]['created_at'], 97)
