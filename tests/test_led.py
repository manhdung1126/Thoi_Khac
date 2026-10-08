import json
import tempfile
import time
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from backend.app.main import Store, create_app, current_page
from backend.app import led


class LEDTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.app=create_app(self.temp.name)
        self.client=TestClient(self.app)
        token=self.client.post('/api/admin/login',json={'pin':'2468'}).json()['token']
        self.auth={'Authorization':'Bearer '+token}
        self.client.patch('/api/settings',json={'rotation_seconds':2},headers=self.auth).raise_for_status()
    def tearDown(self):
        self.client.close();self.temp.cleanup()
    def upload(self,extra=None,key=None):
        vectors={'version':1,'profile':'led-2px','strokes':[{'erase':False,'width':2,'points':[[10,10],[60,60]]}]}
        return self.client.post('/api/drawings',data={'submission_id':key or uuid4().hex,'strokes':json.dumps(vectors),**(extra or {})})
    def state(self):return self.client.get('/api/state').json()
    def test_colored_mono_roundtrip_retry_svg_and_restart(self):
        data={'version':2,'profile':'led-2px','strokes':[
            {'erase':False,'material':'mono-v1','width':2,'color':'#2f6972','points':[[10,20,.5],[200,20,.5]]},
            {'erase':True,'points':[[100,20]]},
            {'erase':False,'material':'mono-v1','width':1,'color':'#1264A3','points':[[300,300,1]]},
            {'erase':False,'material':'mono-v1','width':2,'points':[[400,400,.5]]},
        ]}
        key=uuid4().hex;response=self.upload({'strokes':json.dumps(data)},key);response.raise_for_status()
        drawing=response.json();data['strokes'][0]['color']='#2F6972'
        self.assertEqual(self.client.get(drawing['vector_path']).json(),data)
        self.assertTrue(self.upload({'strokes':json.dumps(data)},key).json()['replayed'])
        changed=json.loads(json.dumps(data));changed['strokes'][0]['color']='#B87333'
        self.assertEqual(self.upload({'strokes':json.dumps(changed)},key).status_code,409)
        svg=self.client.get(drawing['image_path']).text
        for fragment in ['data-colored="true"','url(#ink2F6972)','url(#ink1264A3)','url(#legacy)','opacity="0.95"','stroke-width="13.091"','<mask']:
            self.assertIn(fragment,svg)
        self.assertNotIn('<rect width="720" height="720" fill="#',svg)
        with TestClient(create_app(self.temp.name)) as restarted:
            self.assertEqual(restarted.get(drawing['vector_path']).json(),data)
            self.assertEqual(restarted.get(drawing['image_path']).text,svg)

    def test_invalid_ink_cannot_enter_storage_or_svg(self):
        base={'version':2,'profile':'led-2px','strokes':[{'erase':False,'material':'mono-v1','width':2,'color':'#2F6972','points':[[10,20,.5]]}]}
        before=self.state()
        for color in [None,True,1,[],{},'#abc','red','#1234567','#12345Z','url(https://example.com)','\"/><script/>']:
            data=json.loads(json.dumps(base));data['strokes'][0]['color']=color
            self.assertEqual(self.upload({'strokes':json.dumps(data)}).status_code,422)
        for stroke in [{'erase':True,'color':'#2F6972','points':[[10,20]]},
                       {'erase':False,'color':'#2F6972','points':[[10,20]]},
                       {'erase':False,'material':'graphite-v1','seed':17,'color':'#2F6972','points':[[10,20,.5]]}]:
            self.assertEqual(self.upload({'strokes':json.dumps({**base,'strokes':[stroke]})}).status_code,422)
        after=self.state();before.pop('server_time');after.pop('server_time')
        self.assertEqual(after,before)
    def test_frontend_code_revalidates_cache_but_images_keep_normal_caching(self):
        for path in ['/draw/','/control/','/display/','/draw/app.js','/shared/monoline.js','/draw/style.css']:
            response=self.client.get(path);self.assertEqual(response.status_code,200)
            self.assertEqual(response.headers.get('cache-control'),'no-cache')
            cached=self.client.get(path,headers={'If-None-Match':response.headers['etag']})
            self.assertEqual(cached.status_code,304)
            self.assertEqual(cached.headers.get('cache-control'),'no-cache')
        self.assertNotIn('cache-control',self.client.get('/display/assets/led-scroll.png').headers)
    def test_video_background_supports_byte_ranges_and_local_poster(self):
        response=self.client.get('/display/assets/led-scroll.mp4',headers={'Range':'bytes=0-1023'})
        self.assertEqual(response.status_code,206)
        self.assertEqual(response.headers['content-type'],'video/mp4')
        self.assertTrue(response.headers['content-range'].startswith('bytes 0-1023/'))
        self.assertEqual(len(response.content),1024)
        poster=self.client.get('/display/assets/led-scroll-poster.jpg')
        self.assertEqual(poster.status_code,200)
        self.assertEqual(poster.headers['content-type'],'image/jpeg')
    def test_first_27_fill_empty_then_new_picture_replaces_random_cell_and_keeps_history(self):
        with patch('backend.app.led.secrets.choice',side_effect=lambda choices:choices[-1]):
            ids=[self.upload().json()['id'] for _ in range(27)]
            page=current_page(self.state());self.assertEqual(len(page['items']),27)
            self.assertEqual([len(c['drawing_ids']) for c in page['cells']],[1]*27)
            newest=self.upload().json()['id']
        page=current_page(self.state());cell=page['cells'][26]
        self.assertEqual(cell['drawing_ids'],[ids[0],newest]);self.assertEqual(cell['active'],newest)
        self.assertEqual(len(page['items']),27)
        store=self.app.state.store;current_page(store.state)['cells'][26]['shown_at']=time.time()-3
        self.assertTrue(store.rotate());self.assertEqual(current_page(self.state())['cells'][26]['active'],ids[0])
        restarted=Store(self.temp.name)
        self.assertEqual(current_page(restarted.public())['cells'],current_page(self.state())['cells'])

    def test_random_assignment_completes_each_round_before_starting_next(self):
        page={'items':[]}
        with patch('backend.app.led.secrets.choice',side_effect=lambda choices:choices[-1]):
            for index in range(53):
                led.assign(page,str(index))
        loads=[len(cell['drawing_ids']) for cell in page['cells']]
        self.assertEqual(sorted(loads),[1]+[2]*26)
        led.assign(page,'53')
        self.assertEqual([len(cell['drawing_ids']) for cell in page['cells']],[2]*27)
        led.assign(page,'54')
        self.assertEqual(sorted(len(cell['drawing_ids']) for cell in page['cells']),[2]*26+[3])
    def test_pause_delete_and_remove_preserve_library(self):
        ids=[self.upload().json()['id'] for _ in range(28)]
        state=self.state();cell=next(c for c in current_page(state)['cells'] if len(c['drawing_ids'])==2)
        self.client.patch('/api/settings',json={'paused':True},headers=self.auth).raise_for_status()
        self.assertFalse(self.app.state.store.rotate())
        old=cell['drawing_ids'][0]
        self.client.delete('/api/drawings/'+old,headers=self.auth).raise_for_status()
        self.assertFalse(any(old in c['drawing_ids'] for c in current_page(self.state())['cells']))
        self.client.post('/api/drawings/'+old+'/restore',json={},headers=self.auth).raise_for_status()
        self.client.post('/api/items',json={'drawing_id':old,'cell_id':0},headers=self.auth).raise_for_status()
        self.client.delete('/api/items/'+old,headers=self.auth).raise_for_status()
        self.assertFalse(any(old in c['drawing_ids'] for c in current_page(self.state())['cells']))
        self.assertFalse(next(d for d in self.state()['drawings'] if d['id']==old)['deleted'])
    def test_independent_arrivals_and_rotation_survive_restart(self):
        store=self.app.state.store
        with patch('backend.app.led.time.time',return_value=100):
            store.mutate(lambda state: (led.assign(current_page(state),'a',0),led.assign(current_page(state),'b',0)))
        with patch('backend.app.led.time.time',return_value=101):
            store.mutate(lambda state: (led.assign(current_page(state),'c',1),led.assign(current_page(state),'d',1)))
        store=Store(self.temp.name)
        with patch('backend.app.main.time.time',return_value=102):
            self.assertTrue(store.rotate())
        cells=current_page(store.state)['cells']
        self.assertEqual([cells[i]['active'] for i in (0,1)],['a','d'])
        self.assertEqual(cells[1]['shown_at'],101)
        with patch('backend.app.main.time.time',return_value=103):
            self.assertTrue(store.rotate())
        cells=current_page(store.state)['cells']
        self.assertEqual([cells[i]['active'] for i in (0,1)],['a','c'])
        with patch('backend.app.main.time.time',return_value=103.5):
            self.assertFalse(store.rotate())

    def test_pause_keeps_remaining_time_and_manual_show_only_resets_one_cell(self):
        # Keep initial random uploads away from target cells 0/1, otherwise a
        # no-op move may retain a different queue order and make this flaky.
        with patch('backend.app.led.secrets.choice',side_effect=lambda choices:choices[-1]):
            ids=[self.upload().json()['id'] for _ in range(4)]
        with patch('backend.app.main.time.time',return_value=100):
            for index,drawing_id in enumerate(ids):
                self.client.post('/api/items',json={'drawing_id':drawing_id,'cell_id':index//2},headers=self.auth).raise_for_status()
        with patch('backend.app.main.time.time',return_value=101):
            self.client.patch('/api/settings',json={'paused':True},headers=self.auth).raise_for_status()
        with patch('backend.app.main.time.time',return_value=111):
            self.client.patch('/api/settings',json={'paused':False},headers=self.auth).raise_for_status()
            self.assertFalse(self.app.state.store.rotate())
            self.client.patch('/api/cells/0',json={'drawing_id':ids[0]},headers=self.auth).raise_for_status()
        cells=current_page(self.state())['cells']
        self.assertEqual(cells[0]['shown_at'],111)
        self.assertEqual(cells[1]['shown_at'],110)
        with patch('backend.app.main.time.time',return_value=112):
            self.assertTrue(self.app.state.store.rotate())
        cells=current_page(self.state())['cells']
        self.assertEqual(cells[0]['active'],ids[0])
        self.assertEqual(cells[1]['active'],ids[2])

    def test_page_switch_preserves_remaining_time(self):
        store=self.app.state.store
        page_id=store.state['current_page_id']
        with patch('backend.app.main.time.time',return_value=100):
            store.mutate(lambda state: (led.assign(current_page(state),'a',0),led.assign(current_page(state),'b',0)))
        with patch('backend.app.main.time.time',return_value=101):
            state=self.client.post('/api/pages',json={},headers=self.auth).json()
            other=next(page['id'] for page in state['pages'] if page['id']!=page_id)
            self.client.post('/api/pages/'+other+'/activate',json={},headers=self.auth).raise_for_status()
        with patch('backend.app.main.time.time',return_value=120):
            self.client.post('/api/pages/'+page_id+'/activate',json={},headers=self.auth).raise_for_status()
            self.assertFalse(store.rotate())
        with patch('backend.app.main.time.time',return_value=121):
            self.assertTrue(store.rotate())
        self.assertEqual(current_page(store.state)['cells'][0]['active'],'a')

    def test_vector_upload_validation_retry_and_fetch(self):
        data={'version':1,'profile':'led-2px','strokes':[{'erase':False,'width':2.5,'points':[[1,2],[700,700]]}]}
        key=uuid4().hex;first=self.upload({'strokes':json.dumps(data)},key);self.assertEqual(first.status_code,201)
        replay=self.upload({'strokes':json.dumps(data)},key);self.assertTrue(replay.json()['replayed'])
        self.assertEqual(self.client.get(first.json()['vector_path']).json(),data)
        data['strokes'][0]['points'][0]=[3,4]
        self.assertEqual(self.upload({'strokes':json.dumps(data)},key).status_code,409)
        data['strokes'][0]['points'][0]=[float('nan'),4]
        self.assertEqual(self.upload({'strokes':json.dumps(data)}).status_code,422)
        data['strokes'][0]['points'][0]=[3,4];data['strokes'][0]['width']=4
        self.assertEqual(self.upload({'strokes':json.dumps(data)}).status_code,422)
        self.assertEqual(self.upload({'strokes':'[]'}).status_code,422)
    def test_svg_preserves_transparency_widths_and_eraser_order(self):
        data={'version':1,'profile':'led-2px','strokes':[
            {'erase':False,'width':2,'points':[[10,10],[100,100]]},
            {'erase':True,'points':[[50,50]]},
            {'erase':False,'width':3,'points':[[200,200]]},
        ]}
        svg=led.svg_document(data).decode()
        self.assertIn('viewBox="0 0 720 720"',svg)
        self.assertNotIn('<rect width="720" height="720" fill="#',svg)
        self.assertIn('<mask id="e0"',svg)
        self.assertIn('stroke-width="13.091"',svg)
        self.assertIn('r="9.818"',svg)
        self.assertLess(svg.index('mask="url(#e0)"'),svg.rindex('fill="#FFD700"'))
    def test_existing_page_migrates_without_losing_overflow(self):
        page={'items':[{'drawing_id':str(i)} for i in range(32)]}
        led.ensure_cells(page)
        self.assertEqual(sum(len(c['drawing_ids']) for c in page['cells']),32)
        self.assertEqual(len(page['items']),27)
        original=json.dumps(page);led.ensure_cells(page);self.assertEqual(json.dumps(page),original)
    def test_graphite_roundtrip_validation_transparency_and_restart(self):
        data={'version':2,'profile':'led-2px','strokes':[
            {'erase':False,'material':'graphite-v1','seed':17,'width':2,'points':[[10,20,.2],[200,200,.8]]},
            {'erase':True,'points':[[100,100]]},
            {'erase':False,'material':'graphite-v1','seed':17,'width':1,'points':[[300,300,.5]]},
        ]}
        key=uuid4().hex;first=self.upload({'strokes':json.dumps(data)},key);first.raise_for_status()
        self.assertEqual(self.client.get(first.json()['vector_path']).json(),data)
        self.assertTrue(self.upload({'strokes':json.dumps(data)},key).json()['replayed'])
        svg=self.client.get(first.json()['image_path']).text
        self.assertIn('data-material="graphite-v1"',svg);self.assertIn('fill="#514739"',svg)
        self.assertIn('opacity="0.89"',svg);self.assertIn('stroke-width="13.091"',svg)
        self.assertEqual(svg.count('<pattern '),1);self.assertIn('mask="url(#e1)"',svg)
        self.assertNotIn('fill="#faf3db"',svg);self.assertNotIn('<script',svg)
        restarted=Store(self.temp.name)
        self.assertEqual(next(d for d in restarted.public()['drawings'] if d['id']==first.json()['id'])['vector_path'],first.json()['vector_path'])
        before=self.state()['revision']
        for field,value in [('seed',-1),('seed',256),('seed',True),('material','<script>'),('width',4)]:
            invalid=json.loads(json.dumps(data));invalid['strokes'][0][field]=value
            self.assertEqual(self.upload({'strokes':json.dumps(invalid)}).status_code,422)
        for p in [float('nan'),-1,1.01,True]:
            invalid=json.loads(json.dumps(data));invalid['strokes'][0]['points'][0][2]=p
            self.assertEqual(self.upload({'strokes':json.dumps(invalid)}).status_code,422)
        invalid={**data,'version':1};self.assertEqual(self.upload({'strokes':json.dumps(invalid)}).status_code,422)
        self.assertEqual(self.state()['revision'],before)
        mixed=json.loads(json.dumps(data));mixed['strokes'].append({'erase':False,'width':2,'points':[[400,400],[600,600]]})
        svg=led.svg_document(led.validate_vectors(json.dumps(mixed))).decode()
        self.assertIn('<linearGradient id="legacy"',svg);self.assertIn('stroke="url(#legacy)"',svg)
    def test_cell_assignment_move_and_invalid_mutation_are_atomic(self):
        id=self.upload().json()['id']
        self.client.post('/api/items',json={'drawing_id':id,'cell_id':4},headers=self.auth).raise_for_status()
        self.assertEqual(current_page(self.state())['cells'][4]['drawing_ids'],[id])
        before=self.state()['revision']
        self.assertEqual(self.client.post('/api/items',json={'drawing_id':id,'cell_id':99},headers=self.auth).status_code,422)
        self.assertEqual(self.state()['revision'],before)
        self.assertEqual(current_page(self.state())['cells'][4]['drawing_ids'],[id])
        self.assertEqual(self.client.patch('/api/settings',json={'led_dim':1.1},headers=self.auth).status_code,422)

    def test_mono_pressure_roundtrip_transparency_and_validation(self):
        data={'version':2,'profile':'led-2px','strokes':[
            {'erase':False,'material':'mono-v1','width':2,'points':[[10,20,.1],[200,20,.9]]},
            {'erase':True,'points':[[100,20]]},
            {'erase':False,'material':'mono-v1','width':1,'points':[[300,300,1]]},
        ]}
        key=uuid4().hex;first=self.upload({'strokes':json.dumps(data)},key);first.raise_for_status()
        self.assertEqual(self.client.get(first.json()['vector_path']).json(),data)
        self.assertTrue(self.upload({'strokes':json.dumps(data)},key).json()['replayed'])
        svg=self.client.get(first.json()['image_path']).text
        self.assertIn('data-material="mono-v1"',svg);self.assertIn('opacity="0.95"',svg)
        self.assertIn('stroke-width="13.091"',svg);self.assertIn('mask="url(#e1)"',svg)
        self.assertNotIn('<pattern',svg);self.assertNotIn('<script',svg)
        self.assertNotIn('<rect width="720" height="720" fill="#',svg)
        restarted=Store(self.temp.name)
        self.assertTrue(any(d['id']==first.json()['id'] for d in restarted.public()['drawings']))
        before=self.state()['revision']
        for p in [float('nan'),float('inf'),-1,1.01,True]:
            invalid=json.loads(json.dumps(data));invalid['strokes'][0]['points'][0][2]=p
            self.assertEqual(self.upload({'strokes':json.dumps(invalid)}).status_code,422)
        for version,material,erase in [(1,'mono-v1',False),(2,'unknown',False),(2,'mono-v1',True)]:
            invalid=json.loads(json.dumps(data));invalid['version']=version
            invalid['strokes'][0].update(material=material,erase=erase)
            self.assertEqual(self.upload({'strokes':json.dumps(invalid)}).status_code,422)
        self.assertEqual(self.state()['revision'],before)
