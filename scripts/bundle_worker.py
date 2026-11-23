"""把 Worker 源码打成单文件，供 Cloudflare 网页编辑器直接粘贴。

用法：
    python scripts/bundle_worker.py

输出：worker/dist/worker.js
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MEMO = ROOT / "worker" / "src" / "memo.js"
INDEX = ROOT / "worker" / "src" / "index.js"
OUT = ROOT / "worker" / "dist" / "worker.js"


def main() -> None:
    memo = MEMO.read_text(encoding="utf-8")
    index = INDEX.read_text(encoding="utf-8")

    index = re.sub(
        r'import\s*\{[^}]*\}\s*from\s*["\']\./memo\.js["\'];',
        "",
        index,
        count=1,
        flags=re.S,
    )
    memo = memo.replace("export function", "function")

    if 'from "./memo.js"' in index:
        raise SystemExit("未能移除 import，请检查 worker/src/index.js")
    if "export default" not in index:
        raise SystemExit("worker/src/index.js 缺少 export default")

    bundle = (
        "// Bundled single-file Worker for the Cloudflare dashboard editor.\n"
        "// Generated from worker/src/memo.js + worker/src/index.js.\n\n"
        + memo
        + "\n\n"
        + index
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(bundle, encoding="utf-8")
    print(f"written {OUT} ({len(bundle)} chars)")


if __name__ == "__main__":
    main()
