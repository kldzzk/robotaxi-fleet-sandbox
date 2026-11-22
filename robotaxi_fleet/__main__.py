"""允许 `python -m robotaxi_fleet`。"""

from .cli import main

if __name__ == "__main__":
    raise SystemExit(main())
