"""Persistent per-cell carousels; presentation geometry matches shared/led.js."""
import json
import math
import secrets
import time

from fastapi import HTTPException

COUNT = 27
SIZE = 110
GAP = 47 * 1536 / 4600
ROWS = (9, 10, 8)
PEN_WIDTHS = (1, 1.5, 2, 2.5, 3)
GRAPHITE_COLOR = '#514739'
GRAPHITE_MATERIAL = 'graphite-v1'
MONO_MATERIAL = 'mono-v1'


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
    points, width = _stable([p[:2] for p in stroke['points']]), 6 if stroke['erase'] else stroke.get('width', 2)
    attributes = f' fill="none" stroke="{color}" stroke-width="{_number(width * 720 / SIZE)}" stroke-linecap="round" stroke-linejoin="round"'
    if len(points) == 1:
        return f'<circle cx="{_number(points[0][0])}" cy="{_number(points[0][1])}" r="{_number(width * 720 / (SIZE * 2))}" fill="{color}"/>'
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


def graphite_grain(seed):
    """Same LCG and artwork-local coordinates as shared/graphite.js."""
    state = seed + 1
    def next_value():
        nonlocal state
        state = (state * 1664525 + 1013904223) & 0xffffffff
        return state / 4294967296
    return [{'x': round(2 + next_value() * 28, 3),
             'y': round(2 + next_value() * 28, 3),
             'r': round(.3 + next_value() * .65, 3),
             'alpha': round(.12 + next_value() * .28, 3)} for _ in range(64)]


def _graphite_pattern(seed):
    holes = ''.join(f'<circle cx="{_number(g["x"])}" cy="{_number(g["y"])}" r="{_number(g["r"])}" fill="black" opacity="{_number(g["alpha"])}"/>' for g in graphite_grain(seed))
    return f'<mask id="grain{seed}" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32"><rect width="32" height="32" fill="white"/>{holes}</mask><pattern id="p{seed}" patternUnits="userSpaceOnUse" width="32" height="32"><rect width="32" height="32" fill="{GRAPHITE_COLOR}" mask="url(#grain{seed})"/></pattern>'


def svg_document(data):
    """Create a transparent, script-free SVG from already validated strokes."""
    body, masks, seeds = '', [], set()
    if data['version'] == 2 and any(not s['erase'] and s.get('material') != GRAPHITE_MATERIAL for s in data['strokes']):
        # Unsaved legacy draft marks retain the same static foil gradient in a
        # mixed new artwork; existing v1 files are never rewritten.
        # Matches metallicGold() in shared/metallic.js; cross-language test locks parity.
        masks.append('<linearGradient id="legacy" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="720" y2="518.4"><stop offset="0" stop-color="#A77D16"/><stop offset=".18" stop-color="#C49A0B"/><stop offset=".38" stop-color="#F4D84F"/><stop offset=".52" stop-color="#E7BD00"/><stop offset=".72" stop-color="#B58B08"/><stop offset=".88" stop-color="#F8DC63"/><stop offset="1" stop-color="#C49A0B"/></linearGradient>')
    for stroke in data['strokes']:
        if stroke['erase']:
            mask_id = f'e{len(masks)}'
            masks.append(f'<mask id="{mask_id}" maskUnits="userSpaceOnUse"><rect width="720" height="720" fill="white"/>{_shape(stroke, "black")}</mask>')
            body = f'<g mask="url(#{mask_id})">{body}</g>'
        elif stroke.get('material') == GRAPHITE_MATERIAL:
            seed = stroke['seed']
            if seed not in seeds:
                masks.append(_graphite_pattern(seed))
                seeds.add(seed)
            pressure = sum(point[2] for point in stroke['points']) / len(stroke['points'])
            opacity = _number(.82 + .14 * pressure)
            body += f'<g opacity="{opacity}">{_shape(stroke, f"url(#p{seed})")}</g>'
        else:
            shape = _shape(stroke, 'url(#legacy)' if data['version'] == 2 else '#FFD700')
            if stroke.get('material') == MONO_MATERIAL:
                pressure = sum(point[2] for point in stroke['points']) / len(stroke['points'])
                opacity = _number(math.floor((.9 + .1 * pressure) * 1000 + .5) / 1000)
                shape = f'<g opacity="{opacity}">{shape}</g>'
            body += shape
    definitions = f'<defs>{"".join(masks)}</defs>' if masks else ''
    material = (' data-material="graphite-v1"' if any(s.get('material') == GRAPHITE_MATERIAL for s in data['strokes'])
                else ' data-material="mono-v1"' if any(s.get('material') == MONO_MATERIAL for s in data['strokes']) else '')
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 720" width="720" height="720"{material}>{definitions}{body}</svg>'.encode()


def cell_geometry(cell_id):
    row = 0 if cell_id < 9 else 1 if cell_id < 19 else 2
    col = cell_id - (0, 9, 19)[row]
    row_width = ROWS[row] * SIZE + (ROWS[row] - 1) * GAP
    left = 1392 - row_width if row == 2 else (1536 - row_width) / 2
    return left + col * (SIZE + GAP), 240 + row * (SIZE + GAP)


def _reconcile_cell_active(cell):
    """Repair an invalid selection and its clock, without changing the queue."""
    if cell['active'] not in cell['drawing_ids']:
        cell['active'] = cell['drawing_ids'][0] if cell['drawing_ids'] else None
        cell['shown_at'] = time.time() if cell['active'] else None


def _cell_display_item(cell):
    """Derive presentation geometry without changing selection or timing."""
    if cell['active']:
        x, y = cell_geometry(cell['id'])
        return {'drawing_id': cell['active'], 'cell_id': cell['id'],
            'x': (x + SIZE / 2) / 1536,
            'y': (y + SIZE / 2) / 768,
            'scale': 1, 'rotation': 0}


def sync_items(page):
    """Mutate cell selections/clocks as needed, then rebuild display items."""
    page['items'] = []
    for cell in page['cells']:
        _reconcile_cell_active(cell)
        item = _cell_display_item(cell)
        if item is not None:
            page['items'].append(item)


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
        if not isinstance(data, dict) or type(data.get('version')) is not int or data['version'] not in (1, 2) or data.get('profile') != 'led-2px':
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
            material = stroke.get('material')
            if 'material' in stroke:
                if data['version'] != 2 or material not in (GRAPHITE_MATERIAL, MONO_MATERIAL) or stroke['erase']:
                    raise ValueError()
                if material == GRAPHITE_MATERIAL and (type(stroke.get('seed')) is not int or not 0 <= stroke['seed'] <= 255):
                    raise ValueError()
            points = stroke['points']
            if not isinstance(points, list) or not points:
                raise ValueError()
            count += len(points)
            if count > 50000:
                raise ValueError()
            for point in points:
                if not isinstance(point, list) or len(point) != (3 if material else 2):
                    raise ValueError()
                if any(type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 720 for v in point[:2]):
                    raise ValueError()
                if material and (type(point[2]) not in (int, float) or not math.isfinite(point[2]) or not 0 <= point[2] <= 1):
                    raise ValueError()
            item = {'erase': stroke['erase'], 'points': points}
            if width is not None:
                item['width'] = width
            if material:
                item['material'] = material
                if material == GRAPHITE_MATERIAL:
                    item['seed'] = stroke['seed']
            clean.append(item)
        return {'version': data['version'], 'profile': 'led-2px', 'strokes': clean}
    except (ValueError, TypeError, KeyError, RecursionError):
        raise HTTPException(422, 'Dữ liệu nét LED không hợp lệ (tối đa 50.000 điểm).')
