"""Page lifecycle and frozen carousel clocks through the real Control API."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from backend.app.main import Store, create_app, current_page, new_page


class PageContracts(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='cos-page-contract-')
        self.addCleanup(temporary.cleanup)
        self.directory = temporary.name
        clock = patch('backend.app.main.time.time', return_value=100)
        self.clock = clock.start()
        self.addCleanup(clock.stop)
        self.app = create_app(self.directory)
        # No lifespan/ticker: each carousel tick is explicitly driven by the test.
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        self.store = self.app.state.store
        token = self.client.post('/api/admin/login', json={'pin': '2468'}).json()['token']
        self.auth = {'Authorization': 'Bearer ' + token}
        self.live = self.state()['current_page_id']
        with patch('backend.app.led.secrets.choice', side_effect=lambda choices: choices[-1]):
            self.ids = [self.upload() for _ in range(4)]
        for index, drawing_id in enumerate(self.ids):
            self.change('POST', '/api/items', drawing_id=drawing_id, cell_id=index // 2)

    def state(self):
        response = self.client.get('/api/state')
        self.assertEqual(response.status_code, 200)
        return response.json()

    def assert_durable(self):
        persisted = json.loads(self.store.path.read_text())
        self.assertEqual(self.store.state, persisted)
        recovered = Store(self.directory)
        self.assertEqual(recovered.state, persisted)
        self.assertEqual(recovered.public(), self.state())

    def change(self, method, path, **body):
        revision = self.state()['revision']
        response = self.client.request(method, path, headers=self.auth,
            **({'json': body} if method != 'DELETE' else {}))
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result['revision'], revision + 1)
        self.assertEqual(result, self.state())
        self.assert_durable()
        return result

    def upload(self):
        before = self.state()['revision']
        vectors = {'version': 1, 'profile': 'led-2px', 'strokes': [
            {'erase': False, 'width': 2, 'points': [[20, 20], [400, 400]]}]}
        response = self.client.post('/api/drawings', data={
            'submission_id': uuid4().hex, 'strokes': json.dumps(vectors)})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(self.state()['revision'], before + 1)
        return response.json()['id']

    def create_page(self, populated=False):
        existing = {page['id'] for page in self.state()['pages']}
        state = self.change('POST', '/api/pages')
        page_id = next(page['id'] for page in state['pages'] if page['id'] not in existing)
        if populated:
            for index, drawing_id in enumerate(self.ids):
                self.change('POST', f'/api/pages/{page_id}/items', drawing_id=drawing_id, cell_id=index // 2)
        return page_id

    def test_first_page_initializes_live_empty_grid_without_a_revision_or_pause(self):
        first = Store(Path(self.directory) / 'initial')
        state = first.public()
        self.assertEqual(state['revision'], 0)
        self.assertEqual(len(state['pages']), 1)
        page = current_page(state)
        self.assertEqual(page['id'], state['current_page_id'])
        self.assertTrue(page['name'])
        self.assertEqual(page['items'], [])
        self.assertEqual(len(page['cells']), 27)
        self.assertTrue(all(not c['drawing_ids'] and c['active'] is None and c['shown_at'] is None for c in page['cells']))
        self.assertNotIn('timer_paused_at', page)
        self.assertEqual(json.loads(first.path.read_text()), first.state)
        self.assertEqual(Store(first.directory).public(), state)

    def test_new_page_helper_switches_its_input_but_store_owns_revision_and_timer_transition(self):
        before = copy.deepcopy(self.store.state)
        working = copy.deepcopy(before)
        page = new_page(working)
        self.assertEqual(working['current_page_id'], page['id'])
        self.assertEqual(working['revision'], before['revision'])
        self.assertEqual(working['pages'][:-1], before['pages'])
        self.assertEqual(page['items'], [])
        self.assertEqual(len(page['cells']), 27)
        self.assertNotIn('timer_paused_at', page)
        self.assertEqual(self.store.state, before)
        self.clock.return_value = 103
        created = self.store.mutate(new_page)
        after = self.state()
        self.assertEqual(after['current_page_id'], created['id'])
        self.assertEqual(after['revision'], before['revision'] + 1)
        self.assertEqual(after['pages'][0]['timer_paused_at'], 103)
        self.assertEqual(after['pages'][0]['cells'], before['pages'][0]['cells'])
        self.assertNotIn('timer_paused_at', current_page(after))
        self.assert_durable()

    def test_api_additional_pages_stay_offair_and_preserve_live_contents_and_deadlines(self):
        for now in [103, 104]:
            with self.subTest(now=now):
                self.clock.return_value = now
                before = self.state()
                page_id = self.create_page()
                after = self.state()
                self.assertEqual(after['current_page_id'], self.live)
                self.assertEqual(after['pages'][:-1], before['pages'])
                created = after['pages'][-1]
                self.assertEqual(created['id'], page_id)
                self.assertEqual(created['timer_paused_at'], now)
                self.assertEqual(created['items'], [])
                self.assertEqual(len(created['cells']), 27)
                self.assertTrue(all(not c['drawing_ids'] and c['active'] is None and c['shown_at'] is None for c in created['cells']))
                self.assertEqual(current_page(after)['cells'][0]['shown_at'], 100)
                self.assertEqual(after['drawings'], before['drawings'])

    def test_page_switch_freezes_elapsed_time_and_resumes_each_pages_remaining_interval(self):
        self.clock.return_value = 101
        other = self.create_page(populated=True)
        self.clock.return_value = 103
        switched = self.change('POST', f'/api/pages/{other}/activate')
        self.assertEqual(switched['pages'][0]['timer_paused_at'], 103)
        self.assertEqual(current_page(switched)['cells'][0]['shown_at'], 103)
        self.clock.return_value = 105
        self.assertFalse(self.store.rotate())
        self.clock.return_value = 106
        returned = self.change('POST', f'/api/pages/{self.live}/activate')
        self.assertEqual(current_page(returned)['cells'][0]['shown_at'], 103)  # Three elapsed, five remaining.
        self.assertEqual(returned['pages'][1]['timer_paused_at'], 106)
        self.assertEqual(returned['pages'][1]['cells'][0]['shown_at'], 103)
        self.clock.return_value = 110.999
        self.assertFalse(self.store.rotate())
        self.clock.return_value = 111
        self.assertTrue(self.store.rotate())
        self.assertEqual(current_page(self.state())['cells'][0]['active'], self.ids[0])
        self.clock.return_value = 120
        returned = self.change('POST', f'/api/pages/{other}/activate')
        self.assertEqual(current_page(returned)['cells'][0]['shown_at'], 117)
        self.clock.return_value = 124.999
        self.assertFalse(self.store.rotate())
        self.clock.return_value = 125
        self.assertTrue(self.store.rotate())
        self.assertEqual(current_page(self.state())['cells'][0]['active'], self.ids[0])
        self.assert_durable()

    def test_offair_rename_activation_removal_and_arrival_do_not_perturb_live_clock(self):
        self.clock.return_value = 103
        other = self.create_page(populated=True)
        live_before = copy.deepcopy(current_page(self.state()))
        changes = [
            (104, 'PATCH', f'/api/pages/{other}', {'name': 'Ngoài sóng'}),
            (105, 'PATCH', f'/api/pages/{other}/cells/0', {'drawing_id': self.ids[0]}),
            (106, 'DELETE', f'/api/pages/{other}/items/{self.ids[1]}', {}),
            (107, 'POST', f'/api/pages/{other}/items', {'drawing_id': self.ids[1], 'cell_id': 0}),
        ]
        for now, method, path, body in changes:
            self.clock.return_value = now
            after = self.change(method, path, **body)
            self.assertEqual(after['current_page_id'], self.live)
            self.assertEqual(current_page(after), live_before)
            self.assertEqual(after['pages'][1]['timer_paused_at'], 103)
        self.clock.return_value = 110
        shown = self.change('POST', f'/api/pages/{other}/activate')
        self.assertEqual(current_page(shown)['cells'][0]['shown_at'], 110)
        self.assertEqual(current_page(shown)['cells'][1]['shown_at'], 110)
        self.clock.return_value = 117.999
        self.assertFalse(self.store.rotate())
        self.clock.return_value = 118
        self.assertTrue(self.store.rotate())
        self.assert_durable()

    def test_pause_keeps_elapsed_time_but_manual_activation_during_pause_starts_fresh_on_resume(self):
        self.clock.return_value = 103
        paused = self.change('PATCH', '/api/settings', paused=True)
        self.assertEqual(current_page(paused)['timer_paused_at'], 103)
        self.clock.return_value = 107
        changed = self.change('PATCH', '/api/cells/0', drawing_id=self.ids[0])
        self.assertEqual(current_page(changed)['cells'][0]['shown_at'], 107)
        self.assertEqual(current_page(changed)['cells'][1]['shown_at'], 100)
        self.assertEqual(current_page(changed)['timer_paused_at'], 103)
        self.assertFalse(self.store.rotate())
        self.clock.return_value = 113
        resumed = self.change('PATCH', '/api/settings', paused=False)
        self.assertNotIn('timer_paused_at', current_page(resumed))
        cells = current_page(resumed)['cells']
        self.assertEqual([c['shown_at'] for c in cells[:2]], [113, 110])
        self.clock.return_value = 118
        self.assertTrue(self.store.rotate())
        cells = current_page(self.state())['cells']
        self.assertEqual([c['active'] for c in cells[:2]], [self.ids[0], self.ids[2]])
        self.clock.return_value = 121
        self.assertTrue(self.store.rotate())
        cells = current_page(self.state())['cells']
        self.assertEqual([c['active'] for c in cells[:2]], [self.ids[1], self.ids[2]])
        self.assert_durable()

    def test_new_arrivals_during_pause_preserve_existing_active_and_do_not_create_future_clocks(self):
        self.clock.return_value = 103
        self.change('PATCH', '/api/settings', paused=True)
        self.clock.return_value = 108
        with patch('backend.app.led.secrets.choice', side_effect=lambda choices: choices[-1]):
            queued = self.upload()
        added = self.change('POST', '/api/items', drawing_id=queued, cell_id=0)
        self.assertEqual(current_page(added)['cells'][0]['active'], self.ids[1])
        self.assertEqual(current_page(added)['cells'][0]['shown_at'], 100)
        self.clock.return_value = 109
        with patch('backend.app.led.secrets.choice', side_effect=lambda choices: choices[-1]):
            singleton = self.upload()
        self.assertEqual(current_page(self.state())['cells'][26]['shown_at'], 109)
        self.clock.return_value = 113
        resumed = self.change('PATCH', '/api/settings', paused=False)
        cells = current_page(resumed)['cells']
        self.assertEqual([cells[i]['shown_at'] for i in [0, 1, 26]], [110, 110, 113])
        self.assertTrue(all(c['shown_at'] is None or c['shown_at'] <= 113 for c in cells))
        self.clock.return_value = 118
        self.assertTrue(self.store.rotate())
        cells = current_page(self.state())['cells']
        self.assertEqual(cells[0]['active'], queued)
        self.assertEqual((cells[26]['active'], cells[26]['shown_at']), (singleton, 113))
        self.assert_durable()

    def test_cycle_changes_and_unrelated_mutations_preserve_running_and_paused_elapsed_time(self):
        self.clock.return_value = 103
        self.change('PATCH', '/api/settings', rotation_seconds=12)
        self.clock.return_value = 105
        renamed = self.change('PATCH', f'/api/pages/{self.live}', name='Đồng hồ đang chạy')
        self.assertEqual(current_page(renamed)['cells'][0]['shown_at'], 100)
        self.clock.return_value = 111.999
        self.assertFalse(self.store.rotate())
        self.clock.return_value = 112
        self.assertTrue(self.store.rotate())
        self.clock.return_value = 113
        shortened = self.change('PATCH', '/api/settings', rotation_seconds=2)
        self.assertEqual(current_page(shortened)['cells'][0]['shown_at'], 112)
        self.clock.return_value = 113.999
        self.assertFalse(self.store.rotate())
        self.clock.return_value = 114
        self.assertTrue(self.store.rotate())
        self.clock.return_value = 115
        self.change('PATCH', '/api/settings', paused=True)
        self.clock.return_value = 120
        changed = self.change('PATCH', '/api/settings', rotation_seconds=5)
        self.assertEqual(current_page(changed)['timer_paused_at'], 115)
        self.assertEqual(current_page(changed)['cells'][0]['shown_at'], 114)
        self.clock.return_value = 125
        resumed = self.change('PATCH', '/api/settings', paused=False)
        self.assertEqual(current_page(resumed)['cells'][0]['shown_at'], 124)
        self.clock.return_value = 128.999
        self.assertFalse(self.store.rotate())
        self.clock.return_value = 129
        self.assertTrue(self.store.rotate())
        self.assert_durable()

    def assert_live_deletion(self, index):
        page_ids = [self.live]
        for now in [101, 102]:
            self.clock.return_value = now
            page_ids.append(self.create_page(populated=True))
        self.clock.return_value = 103
        self.change('POST', f'/api/pages/{page_ids[index]}/activate')
        before = self.state()
        remaining = [page_id for page_id in page_ids if page_id != page_ids[index]]
        expected = remaining[min(index, len(remaining) - 1)]
        self.clock.return_value = 106
        after = self.change('DELETE', f'/api/pages/{page_ids[index]}')
        self.assertEqual([p['id'] for p in after['pages']], remaining)
        self.assertEqual(after['current_page_id'], expected)
        replacement = current_page(after)
        old_replacement = next(p for p in before['pages'] if p['id'] == expected)
        self.assertNotIn('timer_paused_at', replacement)
        self.assertEqual([c['shown_at'] for c in replacement['cells'][:2]], [106, 106])
        self.assertEqual([c['drawing_ids'] for c in replacement['cells']], [c['drawing_ids'] for c in old_replacement['cells']])
        self.assertEqual([c['active'] for c in replacement['cells']], [c['active'] for c in old_replacement['cells']])
        for page in after['pages']:
            if page['id'] != expected:
                self.assertEqual(page, next(p for p in before['pages'] if p['id'] == page['id']))
        for key in ['settings', 'drawings', 'snapshots']:
            self.assertEqual(after[key], before[key], key)
        self.clock.return_value = 113.999
        self.assertFalse(self.store.rotate())
        self.clock.return_value = 114
        self.assertTrue(self.store.rotate())
        self.assertEqual(current_page(self.state())['cells'][0]['active'], self.ids[0])
        self.assert_durable()

    def test_delete_first_live_page_projects_next_and_initializes_replacement_clock(self):
        self.assert_live_deletion(0)

    def test_delete_middle_live_page_projects_next_and_initializes_replacement_clock(self):
        self.assert_live_deletion(1)

    def test_delete_last_live_page_projects_previous_and_initializes_replacement_clock(self):
        self.assert_live_deletion(2)

    def test_delete_offair_keeps_live_clock_and_last_page_rejection_is_atomic(self):
        self.clock.return_value = 101
        other = self.create_page(populated=True)
        before = self.state()
        self.clock.return_value = 105
        after = self.change('DELETE', f'/api/pages/{other}')
        self.assertEqual(after['current_page_id'], self.live)
        self.assertEqual(after['pages'], [before['pages'][0]])
        self.clock.return_value = 108
        self.assertTrue(self.store.rotate())
        before = self.state()
        persisted = self.store.path.read_bytes()
        response = self.client.delete(f'/api/pages/{self.live}', headers=self.auth)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.state(), before)
        self.assertEqual(self.store.path.read_bytes(), persisted)
        self.assert_durable()
