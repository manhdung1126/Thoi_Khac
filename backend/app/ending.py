"""Durable ending snapshot, using the existing Store and state notifications."""
import copy
import math
import time
from uuid import uuid4
from fastapi import HTTPException


def validate_mask(value):
    if not isinstance(value, dict):
        raise HTTPException(422, "Thiếu hình đích Ending.")
    w, h, points = value.get("width"), value.get("height"), value.get("points")
    if type(w) is not int or type(h) is not int or not 4 <= w <= 256 or not 4 <= h <= 256:
        raise HTTPException(422, "Mask tối đa 256 × 256.")
    if not isinstance(points, list) or not 10 <= len(points) <= 6000:
        raise HTTPException(422, "Mask cần 10–6.000 vị trí.")
    for point in points:
        if not isinstance(point, list) or len(point) != 2 or any(type(v) not in (int, float) or not math.isfinite(v) for v in point) or not 0 <= point[0] < w or not 0 <= point[1] < h:
            raise HTTPException(422, "Điểm mask không hợp lệ.")
    if len({tuple(p) for p in points}) != len(points):
        raise HTTPException(422, "Các vị trí mask không được trùng nhau.")
    aspect = value.get("aspect", w / h)
    if type(aspect) not in (int, float) or not math.isfinite(aspect) or not .01 <= aspect <= 64:
        raise HTTPException(422, "Tỷ lệ mask không hợp lệ.")
    return {"id": str(value.get("id", "custom"))[:80], "width": w, "height": h, "aspect": aspect, "points": points}


def prepare(state, body, directory):
    if state.get("ending"):
        raise HTTPException(409, "Hãy quay lại Normal trước khi chuẩn bị Ending khác.")
    mask = validate_mask(body.get("mask"))
    seed = body.get("seed", "thoi-khac-01")
    if not isinstance(seed, str) or not seed.strip() or len(seed) > 80:
        raise HTTPException(422, "Mã bố cục cần 1–80 ký tự.")
    page = next(p for p in state["pages"] if p["id"] == state["current_page_id"])
    ids = set(x for c in page["cells"] for x in c["drawing_ids"])
    drawings = [copy.deepcopy(d) for d in state["drawings"] if not d["deleted"] and d["id"] in ids]
    if not drawings:
        raise HTTPException(409, "Trang đang chiếu chưa có nét vẽ.")
    if len(drawings) > len(mask["points"]):
        raise HTTPException(422, "Hình đích không đủ vị trí cho bộ nét hiện tại.")
    for d in drawings:
        if not (directory / "drawings" / (d["id"] + ".svg")).is_file() or not (directory / "vectors" / (d["id"] + ".json")).is_file():
            raise HTTPException(409, "Có nét vẽ thiếu tệp. Khôi phục tệp trước khi chuẩn bị Ending.")
    state["ending"] = {"id": uuid4().hex, "phase": "PREPARE", "prepared_at": time.time(),
        "start_time": None, "duration": 20, "motion_version": 2, "viewport": {"width": 1536, "height": 768},
        "name": str(body.get("name", "Biểu tượng Hà Nội"))[:100], "seed": seed,
        "mask": mask, "page_id": page["id"], "page_name": page["name"],
        "cells": copy.deepcopy(page["cells"]), "drawings": drawings}


def protected_ids(state):
    return {d["id"] for d in (state.get("ending") or {}).get("drawings", [])}
