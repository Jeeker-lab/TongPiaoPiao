"""Deterministic checkbox reader for the supported 58-person / 4-grade ballot.

The algorithm detects the printed grid on every page, crops each grade cell,
and selects the cell containing the largest connected handwriting component.
It never invents demo data and never uses language-model classification.
"""
import json
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image


EXPECTED_X = np.array([.055, .118, .210, .287, .364, .441, .517,
                       .578, .669, .746, .822, .899, .974])
MIN_MARK_SCORE = 120


def local_peak(values, expected, radius):
    lo = max(0, int(round(expected)) - radius)
    hi = min(len(values), int(round(expected)) + radius + 1)
    return lo + int(np.argmax(values[lo:hi]))


def largest_component(mask):
    """Return largest 8-connected component size in a small boolean array."""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    best = 0
    for y, x in np.argwhere(mask):
        if seen[y, x]:
            continue
        seen[y, x] = True
        q = deque([(int(y), int(x))])
        size = 0
        while q:
            cy, cx = q.popleft()
            size += 1
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if not (dx or dy):
                        continue
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
        best = max(best, size)
    return best


def page_lines(gray, side):
    """Find the 30 data-row boundaries for one half of the ballot."""
    h, w = gray.shape
    dark = gray < 185
    x1, x2 = ((int(.205*w), int(.518*w)) if side == 0
              else (int(.665*w), int(.976*w)))
    score = dark[:, x1:x2].mean(axis=1)
    # The first data boundary is around 13.5% page height; rows are ~2.77%.
    base = local_peak(score, .136*h, int(.012*h))
    step = .0277*h
    lines = [local_peak(score, base + i*step, int(.008*h)) for i in range(29)]
    # The printed note sits immediately under the last row and can look like a
    # horizontal rule. Extrapolate the final boundary from the stable row pitch.
    pitch = int(round(float(np.median(np.diff(lines)))))
    lines.append(lines[-1] + pitch)
    # Enforce strictly increasing, near-uniform boundaries.
    if any(b-a < .018*h or b-a > .037*h for a, b in zip(lines, lines[1:])):
        raise ValueError('未能稳定定位表格横线，请提高扫描清晰度或校正页面方向')
    return lines


def row_verticals(gray, y1, y2):
    """Locate all 13 vertical grid lines at this row (handles page skew)."""
    h, w = gray.shape
    dark = gray < 175
    band = dark[max(0, y1+5):min(h, y2-5), :].mean(axis=0)
    lines = [local_peak(band, p*w, int(.018*w)) for p in EXPECTED_X]
    if any(b-a < .035*w for a, b in zip(lines, lines[1:])):
        raise ValueError('未能稳定定位表格竖线，请检查页面裁切范围')
    return lines


def cell_score(crop):
    # Strong ink count plus the size of its largest continuous stroke.
    strong = crop < 135
    medium = crop < 185
    return int(strong.sum() + 4 * largest_component(medium))


def recognize(image_path, template_path):
    template = json.loads(Path(template_path).read_text(encoding='utf-8'))
    template = template.get('template', template)
    categories = template['categories']
    people = template['people']
    if len(categories) != 4 or len(people) != 58:
        raise ValueError('本地精确识别当前仅支持 58 人、4 档次的固定测评表')
    gray = np.asarray(Image.open(image_path).convert('L'))
    h, w = gray.shape
    sides = [page_lines(gray, 0), page_lines(gray, 1)]
    selections, diagnostics = [], []
    for person in people:
        if not person.get('evaluable', True):
            continue
        serial = int(person['serial'])
        side = 0 if serial <= 29 else 1
        row = (serial - 1) % 29
        top, bottom = sides[side][row], sides[side][row+1]
        verticals = row_verticals(gray, top, bottom)
        edges = verticals[2:7] if side == 0 else verticals[8:13]
        scores = []
        for j in range(4):
            # Keep away from printed grid strokes; handwriting is inside the cell.
            pad_x = max(6, int((edges[j+1]-edges[j])*.10))
            pad_y = max(6, int((bottom-top)*.13))
            crop = gray[top+pad_y:bottom-pad_y, edges[j]+pad_x:edges[j+1]-pad_x]
            scores.append(cell_score(crop))
        order = np.argsort(scores)[::-1]
        best, second = int(order[0]), int(order[1])
        margin = (scores[best] + 1) / (scores[second] + 1)
        confidence = min(.999, max(.50, .70 + min(margin-1, 1.5)*.19))
        detected = scores[best] >= MIN_MARK_SCORE
        if detected:
            selections.append({'serial': serial, 'name': person['name'],
                               'category': categories[best], 'confidence': round(confidence, 3)})
        diagnostics.append({'serial': serial, 'scores': scores,
                            'margin': round(margin, 3), 'detected': detected})
    return {'selections': selections, 'diagnostics': diagnostics,
            'engine': 'local-grid-v2', 'imageSize': [w, h]}


if __name__ == '__main__':
    try:
        # ASCII-escaped JSON keeps the Node/Python pipe encoding-independent on Windows.
        print(json.dumps(recognize(sys.argv[1], sys.argv[2]), ensure_ascii=True))
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise
