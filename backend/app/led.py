"""Persistent per-cell carousels; presentation geometry matches shared/led.js."""
import json
import math
import secrets
import time

from fastapi import HTTPException

COUNT = 27
SIZE = 140
GAP = 47 * 1536 / 4600
TOPS = [190, 162, 190, 228, 190, 228, 190, 162, 190]
PEN_WIDTHS = (1, 1.5, 2, 2.5, 3)


def _number(value):
    return f'{value:.3f}'.rstrip('0').rstrip('.')


def _turn(before, current, after):
    ax, ay = current[0] - before[0], current[1] - before[1]
    bx, by = after[0] - current[0], after[1] - current[1]
    a, b = math.hypot(ax, ay), math.hypot(bx, by)
    if not a or not b:
        return 0
    return math.acos(max(-1, min(1, (ax * bx + ay * by) / (a * b))))


def _stable(points):
    if len(points) < 3:
        return points
    result = [points[0]]
    for index in range(1, len(points) - 1):
        before, current, after = points[index - 1:index + 2]
        corner = _turn(before, current, after) > math.pi * .31
        candidate = current if corner else [
            before[0] * .18 + current[0] * .64 + after[0] * .18,
            before[1] * .18 + current[1] * .64 + after[1] * .18,
        ]
        if corner or math.dist(candidate, result[-1]) >= .45:
            result.append(candidate)
    if math.dist(points[-1], result[-1]) < .01:
        result[-1] = points[-1]
    else:
        result.append(points[-1])
    return result


def _shape(stroke, color):
    points, width = _stable(stroke['points']), 6 if stroke['erase'] else stroke.get('width', 2)
    attributes = f' fill="none" stroke="{color}" stroke-width="{_number(width * 720 / 140)}" stroke-linecap="round" stroke-linejoin="round"'
    if len(points) == 1:
        return f'<circle cx="{_number(points[0][0])}" cy="{_number(points[0][1])}" r="{_number(width * 720 / 280)}" fill="{color}"/>'
    commands = [f'M{_number(points[0][0])} {_number(points[0][1])}']
    if len(points) == 2:
        commands.append(f'L{_number(points[1][0])} {_number(points[1][1])}')
    else:
        for index in range(1, len(points) - 1):
            before, current, after = points[index - 1:index + 2]
            corner = _turn(before, current, after) > math.pi * .38
            short = min(math.dist(before, current), math.dist(current, after)) < .8
            if corner or short:
                commands.append(f'L{_number(current[0])} {_number(current[1])}')
            else:
                commands.append(f'Q{_number(current[0])} {_number(current[1])} {_number((current[0] + after[0]) / 2)} {_number((current[1] + after[1]) / 2)}')
        commands.append(f'L{_number(points[-1][0])} {_number(points[-1][1])}')
    return f'<path d="{" ".join(commands)}"{attributes}/>'


def svg_document(data):
    """Create a transparent, script-free SVG from already validated strokes."""
    body, masks = '', []
    for stroke in data['strokes']:
        if stroke['erase']:
            mask_id = f'e{len(masks)}'
            masks.append(f'<mask id="{mask_id}" maskUnits="userSpaceOnUse"><rect width="720" height="720" fill="white"/>{_shape(stroke, "black")}</mask>')
            body = f'<g mask="url(#{mask_id})">{body}</g>'
        else:
            body += _shape(stroke, '#FFD700')
    definitions = f'<defs>{"".join(masks)}</defs>' if masks else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 720" width="720" height="720">{definitions}{body}</svg>'.encode()


def sync_items(page):
    left = (1536 - 9 * SIZE - 8 * GAP) / 2
    page['items'] = []
    for cell in page['cells']:
        if cell['active'] not in cell['drawing_ids']:
            cell['active'] = cell['drawing_ids'][0] if cell['drawing_ids'] else None
            cell['shown_at'] = time.time() if cell['active'] else None
        if cell['active']:
            col, row = divmod(cell['id'], 3)
            page['items'].append({'drawing_id': cell['active'], 'cell_id': cell['id'],
                'x': (left + col * (SIZE + GAP) + SIZE / 2) / 1536,
                'y': (TOPS[col] + row * (SIZE + GAP) + SIZE / 2) / 768,
                'scale': 1, 'rotation': 0})


def ensure_cells(page):
    if 'cells' in page:
        return
    previous = [item['drawing_id'] for item in page['items']]
    page['cells'] = [{'id': i, 'drawing_ids': [], 'active': None} for i in range(COUNT)]
    for drawing_id in dict.fromkeys(previous):
        assign(page, drawing_id)
    sync_items(page)


def assign(page, drawing_id, target=None, paused=False):
    ensure_cells(page)
    found = next((c for c in page['cells'] if drawing_id in c['drawing_ids']), None)
    if found and (target is None or target == found['id']):
        return found['id']
    if found:
        found['drawing_ids'].remove(drawing_id)
    if target is None:
        # Fill the installation in balanced rounds: every cell receives its
        # Nth drawing before any cell can receive drawing N+1.
        minimum = min(len(c['drawing_ids']) for c in page['cells'])
        cell = secrets.choice([c for c in page['cells'] if len(c['drawing_ids']) == minimum])
    else:
        if type(target) is not int or not 0 <= target < COUNT:
            raise HTTPException(422, 'Ô phải nằm trong khoảng 1–27.')
        cell = page['cells'][target]
    cell['drawing_ids'].append(drawing_id)
    if not paused or not cell['active']:
        cell['active'] = drawing_id
        cell['shown_at'] = time.time()
    sync_items(page)
    return cell['id']


def remove(page, drawing_id):
    if 'cells' not in page:
        return
    for cell in page['cells']:
        cell['drawing_ids'] = [value for value in cell['drawing_ids'] if value != drawing_id]
    sync_items(page)


def rotate(page, interval=8, now=None):
    ensure_cells(page)
    now = time.time() if now is None else now
    changed = False
    for cell in page['cells']:
        ids = cell['drawing_ids']
        if len(ids) > 1 and now - cell.get('shown_at', now) >= interval:
            cell['active'] = ids[(ids.index(cell['active']) + 1) % len(ids)]
            cell['shown_at'] = now
            changed = True
    if changed:
        sync_items(page)
    return changed


def validate_vectors(raw):
    if not raw:
        return None
    try:
        data = json.loads(raw)
        if not isinstance(data, dict) or data.get('version') != 1 or data.get('profile') != 'led-2px':
            raise ValueError()
        strokes = data['strokes']
        if not isinstance(strokes, list) or not 1 <= len(strokes) <= 2000:
            raise ValueError()
        clean, count = [], 0
        for stroke in strokes:
            if not isinstance(stroke, dict) or type(stroke.get('erase')) is not bool:
                raise ValueError()
            width = stroke.get('width')
            if width is not None and (type(width) not in (int, float) or width not in PEN_WIDTHS):
                raise ValueError()
            points = stroke['points']
            if not isinstance(points, list) or not points:
                raise ValueError()
            count += len(points)
            if count > 50000:
                raise ValueError()
            for point in points:
                if not isinstance(point, list) or len(point) != 2:
                    raise ValueError()
                if any(type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 720 for v in point):
                    raise ValueError()
            item = {'erase': stroke['erase'], 'points': points}
            if width is not None:
                item['width'] = width
            clean.append(item)
        return {'version': 1, 'profile': 'led-2px', 'strokes': clean}
    except (ValueError, TypeError, KeyError, RecursionError):
        raise HTTPException(422, 'Dữ liệu nét LED không hợp lệ (tối đa 50.000 điểm).')
