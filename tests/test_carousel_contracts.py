"""Observable queue, activation and independent-carousel contracts."""
import copy
import json
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

from backend.app import led
from backend.app.main import Store, current_page, new_page


class CellContracts(unittest.TestCase):
    def setUp(self):
        clock = patch('backend.app.led.time.time', return_value=100)
        self.clock = clock.start()
        self.addCleanup(clock.stop)
        self.page = {'items': []}
        led.ensure_cells(self.page)

    def test_sync_rebuilds_items_in_cell_order_without_changing_valid_queues_or_clocks(self):
        for cell_id, drawing_id in [(8, 'a'), (2, 'b'), (8, 'c'), (26, 'd')]:
            led.assign(self.page, drawing_id, cell_id)
        cells = copy.deepcopy(self.page['cells'])
        self.page['items'] = [{'drawing_id': 'stale', 'cell_id': 0}]
        self.clock.return_value = 113
        led.sync_items(self.page)
        self.assertEqual(self.page['cells'], cells)
        self.assertEqual([(item['cell_id'], item['drawing_id']) for item in self.page['items']],
                         [(2, 'b'), (8, 'c'), (26, 'd')])
        for item in self.page['items']:
            self.assertTrue(0 < item['x'] < 1 and 0 < item['y'] < 1)
            self.assertEqual((item['scale'], item['rotation']), (1, 0))
        before = copy.deepcopy(self.page)
        led.sync_items(self.page)
        self.assertEqual(self.page, before)

    def test_sync_repairs_missing_active_and_empty_cells_but_leaves_other_cells_untouched(self):
        led.assign(self.page, 'first', 0)
        led.assign(self.page, 'second', 0)
        led.assign(self.page, 'unrelated', 3)
        unrelated = copy.deepcopy(self.page['cells'][3:])
        self.page['cells'][0]['active'] = 'removed'
        self.page['cells'][1].update(active='removed', shown_at=90)
        self.clock.return_value = 112
        led.sync_items(self.page)
        self.assertEqual(self.page['cells'][0], {
            'id': 0, 'drawing_ids': ['first', 'second'], 'active': 'first', 'shown_at': 112})
        self.assertEqual(self.page['cells'][1], {
            'id': 1, 'drawing_ids': [], 'active': None, 'shown_at': None})
        self.assertEqual(self.page['cells'][3:], unrelated)
        self.assertEqual([item['drawing_id'] for item in self.page['items']], ['first', 'unrelated'])

    def test_arrival_replaces_active_when_running_but_paused_queue_retains_active_and_clock(self):
        self.assertEqual(led.assign(self.page, 'a', 0), 0)
        self.clock.return_value = 103
        led.assign(self.page, 'b', 0, paused=True)
        self.assertEqual(self.page['cells'][0], {
            'id': 0, 'drawing_ids': ['a', 'b'], 'active': 'a', 'shown_at': 100})
        led.assign(self.page, 'empty-first', 1, paused=True)
        self.assertEqual(self.page['cells'][1]['active'], 'empty-first')
        self.assertEqual(self.page['cells'][1]['shown_at'], 103)
        before = copy.deepcopy(self.page)
        self.assertEqual(led.assign(self.page, 'a'), 0)
        self.assertEqual(led.assign(self.page, 'a', 0), 0)
        self.assertEqual(self.page, before)
        self.clock.return_value = 105
        led.assign(self.page, 'c', 0)
        self.assertEqual(self.page['cells'][0], {
            'id': 0, 'drawing_ids': ['a', 'b', 'c'], 'active': 'c', 'shown_at': 105})
        self.assertEqual(self.page['cells'][1:], before['cells'][1:])

    def test_removal_preserves_nonactive_clock_then_resets_fallback_and_clears_empty_cell(self):
        for drawing_id in ['a', 'b', 'c']:
            led.assign(self.page, drawing_id, 0)
        led.assign(self.page, 'untouched', 4)
        unrelated = copy.deepcopy(self.page['cells'][1:])
        self.clock.return_value = 110
        led.remove(self.page, 'b')
        self.assertEqual(self.page['cells'][0], {
            'id': 0, 'drawing_ids': ['a', 'c'], 'active': 'c', 'shown_at': 100})
        led.remove(self.page, 'c')
        self.assertEqual(self.page['cells'][0], {
            'id': 0, 'drawing_ids': ['a'], 'active': 'a', 'shown_at': 110})
        led.remove(self.page, 'a')
        self.assertEqual(self.page['cells'][0], {
            'id': 0, 'drawing_ids': [], 'active': None, 'shown_at': None})
        self.assertEqual(self.page['cells'][1:], unrelated)
        self.assertEqual([item['drawing_id'] for item in self.page['items']], ['untouched'])

    def test_allocation_fills_balanced_rounds_preserving_every_other_queue_active_and_clock(self):
        with patch('backend.app.led.secrets.choice', side_effect=lambda choices: choices[-1]):
            for index in range(81):
                before = copy.deepcopy(self.page['cells'])
                self.clock.return_value = 100 + index
                target = led.assign(self.page, str(index))
                after = self.page['cells']
                loads = [len(cell['drawing_ids']) for cell in after]
                self.assertLessEqual(max(loads) - min(loads), 1)
                self.assertEqual(len(before[target]['drawing_ids']), min(len(c['drawing_ids']) for c in before))
                self.assertEqual(after[target]['drawing_ids'], before[target]['drawing_ids'] + [str(index)])
                self.assertEqual((after[target]['active'], after[target]['shown_at']), (str(index), 100 + index))
                self.assertEqual([c for c in after if c['id'] != target], [c for c in before if c['id'] != target])
                if index in (26, 53, 80):
                    self.assertEqual(loads, [index // 27 + 1] * 27)
        self.assertEqual(self.page['cells'][26]['drawing_ids'], ['0', '27', '54'])
        self.assertEqual(len(self.page['items']), 27)

    def test_move_repairs_source_active_and_keeps_membership_unique_and_other_cells_unchanged(self):
        led.assign(self.page, 'a', 0)
        led.assign(self.page, 'b', 0)
        led.assign(self.page, 'c', 1)
        unrelated = copy.deepcopy(self.page['cells'][2:])
        self.clock.return_value = 108
        self.assertEqual(led.assign(self.page, 'b', 1), 1)
        self.assertEqual(self.page['cells'][0], {
            'id': 0, 'drawing_ids': ['a'], 'active': 'a', 'shown_at': 108})
        self.assertEqual(self.page['cells'][1], {
            'id': 1, 'drawing_ids': ['c', 'b'], 'active': 'b', 'shown_at': 108})
        self.assertEqual(self.page['cells'][2:], unrelated)
        self.assertEqual(sum(cell['drawing_ids'].count('b') for cell in self.page['cells']), 1)


class CarouselContracts(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='cos-carousel-contract-')
        self.addCleanup(temporary.cleanup)
        self.directory = temporary.name
        clock = patch('backend.app.main.time.time', return_value=100)
        self.clock = clock.start()
        self.addCleanup(clock.stop)
        self.store = Store(self.directory)

        def seed(state):
            page = current_page(state)
            for index, (ids, shown_at) in enumerate([(['a', 'b', 'c'], 100), (['d', 'e'], 102), (['f'], 104)]):
                page['cells'][index].update(drawing_ids=ids, active=ids[-1], shown_at=shown_at)
            led.sync_items(page)
            live = page['id']
            other = new_page(state)
            led.assign(other, 'off-a', 4)
            led.assign(other, 'off-b', 4)
            state['current_page_id'] = live

        self.clock.return_value = 104
        self.store.mutate(seed)

    def assert_durable(self):
        persisted = json.loads(self.store.path.read_text())
        self.assertEqual(persisted, self.store.state)
        self.assertEqual(Store(self.directory).state, persisted)

    def test_independent_deadlines_advance_once_preserve_order_and_commit_exact_revision(self):
        initial = self.store.public()
        untouched = copy.deepcopy(current_page(initial)['cells'][2:])
        offair = copy.deepcopy(initial['pages'][1])
        for now, changed, active, shown, revision_offset in [
            (107.999, False, ['c', 'e'], [100, 102], 0),
            (108, True, ['a', 'e'], [108, 102], 1),
            (109.999, False, ['a', 'e'], [108, 102], 1),
            (110, True, ['a', 'd'], [108, 110], 2),
            (116, True, ['b', 'd'], [116, 110], 3),
            (124, True, ['c', 'e'], [124, 124], 4),
        ]:
            with self.subTest(now=now):
                self.clock.return_value = now
                self.assertEqual(self.store.rotate(), changed)
                state = self.store.public()
                cells = current_page(state)['cells']
                self.assertEqual([c['active'] for c in cells[:2]], active)
                self.assertEqual([c['shown_at'] for c in cells[:2]], shown)
                self.assertEqual([c['drawing_ids'] for c in cells[:2]], [['a', 'b', 'c'], ['d', 'e']])
                self.assertEqual(cells[2:], untouched)
                self.assertEqual(state['pages'][1], offair)
                self.assertEqual(state['revision'], initial['revision'] + revision_offset)
                self.assertEqual([item['drawing_id'] for item in current_page(state)['items']], active + ['f'])
                self.assert_durable()

    def test_singleton_and_paused_page_never_rotate_or_write_revision(self):
        self.store.mutate(lambda state: state['settings'].update(paused=True))
        before = copy.deepcopy(self.store.state)
        persisted = self.store.path.read_bytes()
        self.clock.return_value = 200
        self.assertFalse(self.store.rotate())
        self.assertEqual(self.store.state, before)
        self.assertEqual(self.store.path.read_bytes(), persisted)
        self.store.mutate(lambda state: state['settings'].update(paused=False))
        self.assertFalse(self.store.rotate())  # Restored remaining time, not wall-clock catch-up.
        self.store.mutate(lambda state: (led.remove(current_page(state), 'a'),
            led.remove(current_page(state), 'b'), led.remove(current_page(state), 'd')))
        before = copy.deepcopy(self.store.state)
        self.clock.return_value = 1000
        self.assertFalse(self.store.rotate())
        self.assertEqual(self.store.state, before)
        self.assert_durable()
