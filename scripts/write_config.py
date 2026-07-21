#!/usr/bin/env python3
"""Write the browser-safe runtime configuration used by GitHub Pages."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="")
    parser.add_argument("--anon-key", default="")
    parser.add_argument("--output", type=Path, default=Path("site/config.js"))
    args = parser.parse_args()
    config = {
        "supabaseUrl": args.url.strip().rstrip("/"),
        "supabaseAnonKey": args.anon_key.strip(),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        "window.SIROK_CONFIG = " + json.dumps(config, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

