"""城市预设的加载与查询。"""

from __future__ import annotations

import json
from pathlib import Path

from .model import CityPreset


class PresetError(LookupError):
    """预设不存在或文件格式错误时抛出。"""


def default_data_path() -> Path:
    """仓库内 data/cities.json 的默认路径。"""

    return Path(__file__).resolve().parent.parent / "data" / "cities.json"


def load_presets(path: str | Path | None = None) -> dict[str, CityPreset]:
    data_file = Path(path) if path else default_data_path()
    if not data_file.exists():
        raise PresetError(f"找不到预设文件: {data_file}")

    raw = json.loads(data_file.read_text(encoding="utf-8"))
    items = raw.get("cities")
    if not isinstance(items, list) or not items:
        raise PresetError("cities.json 中缺少非空的 'cities' 列表")

    presets: dict[str, CityPreset] = {}
    for item in items:
        preset = CityPreset.from_dict(item)
        if preset.key in presets:
            raise PresetError(f"重复的城市 key: {preset.key}")
        presets[preset.key] = preset
    return presets


def get_preset(key: str, path: str | Path | None = None) -> CityPreset:
    presets = load_presets(path)
    if key not in presets:
        available = "、".join(sorted(presets))
        raise PresetError(f"未知城市 key: {key}；可用: {available}")
    return presets[key]
