"""Run the baseline in order, never importing the default app against exhibition data."""
import os
import argparse
import subprocess
import sys
import tempfile
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--layer', choices=['all', 'core', 'smoke'], default='all')
    layer = parser.parse_args().layer
    root = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix='cos-baseline-') as storage:
        environment = {**os.environ, 'CLOUD_STORAGE_DIR': storage, 'CLOUD_ADMIN_PIN': '2468'}
        stages = [
            ('JavaScript units', ['node', '--test', *map(str, sorted((root / 'tests').glob('*.cjs')))]),
            ('Python API integration', [sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py']),
            ('Browser smoke', ['node', '--test', *map(str, sorted((root / 'tests' / 'browser').glob('*.cjs')))]),
        ]
        if layer == 'core':
            stages = stages[:2]
        elif layer == 'smoke':
            stages = stages[2:]
        for name, command in stages:
            print(f'\n{name}', flush=True)
            result = subprocess.run(command, cwd=root, env=environment)
            if result.returncode:
                return result.returncode
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
