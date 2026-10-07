"""Audit server is isolated; no flag must serve byte-identical application code."""
import tempfile
import json
import unittest
from pathlib import Path
from uuid import uuid4
from fastapi.testclient import TestClient
from benchmarks.draw_device import ROOT, create_test_app, instrument_source
from backend.app.main import create_app


class DeviceAuditTests(unittest.TestCase):
    def test_opt_in_response_instrumentation_and_private_storage(self):
        with tempfile.TemporaryDirectory(prefix='cos-audit-test-') as directory:
            with TestClient(create_test_app(Path(directory))) as client:
                for name in ('index.html', 'app.js'):
                    original=(ROOT / 'frontend' / 'draw' / name).read_bytes()
                    for suffix in ('', '?perf=0'):
                        self.assertEqual(client.get('/draw/'+name+suffix).content, original)
                page=client.get('/draw/?perf=1')
                self.assertIn('src="app.js?perf=1"', page.text)
                self.assertEqual(page.headers['cache-control'], 'no-store')
                module=client.get('/draw/app.js?perf=1')
                self.assertIn('const audit=startAudit()', module.text)
                self.assertIn("audit.measure('canvas_readback'", module.text)
                self.assertIn('audit.alphaCheck(', module.text)
                self.assertEqual(client.get('/__draw_audit__/device-audit.js').status_code, 200)
                self.assertEqual(client.get('/api/health').json()['status'], 'ok')
                key=uuid4().hex
                vectors={'version':2,'profile':'led-2px','strokes':[{'erase':False,'material':'mono-v1','width':2,'color':'#1264A3','points':[[10,10,.6],[120,120,.6]]}]}
                uploaded=client.post('/api/drawings',data={'submission_id':key,'strokes':json.dumps(vectors)})
                self.assertEqual(uploaded.status_code,201)
                drawing=uploaded.json()
                self.assertTrue((Path(directory)/'drawings'/f'{drawing["id"]}.svg').exists())
            self.assertTrue(any(Path(directory).iterdir()), 'Persistence belongs to temporary directory')
            with TestClient(create_app(Path(directory))) as client:
                self.assertEqual(client.get('/__draw_audit__/device-audit.js').status_code, 404)
                self.assertEqual(client.get(drawing['vector_path']).json(),vectors)
                retried=client.post('/api/drawings',data={'submission_id':key,'strokes':json.dumps(vectors)})
                self.assertTrue(retried.json()['replayed'])
                self.assertEqual(len(client.get('/api/state').json()['drawings']),1)

    def test_source_drift_is_rejected_not_silently_misleading(self):
        source=(ROOT / 'frontend' / 'draw' / 'app.js').read_text()
        with self.assertRaisesRegex(ValueError, 'anchor changed'):
            instrument_source(source.replace('JSON.stringify(submissionPayload(strokes))', 'different()'))
