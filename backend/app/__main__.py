from __future__ import annotations

import argparse
import os


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app")
    parser.add_argument("--demo", action="store_true", help="offline replay, no xAI key")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8800)
    args = parser.parse_args()
    if args.demo:
        os.environ["DEMO_MODE"] = "1"
        os.environ.setdefault("XAI_API_KEY", "")
    import uvicorn

    uvicorn.run("app.main:app", host=args.host, port=args.port, reload=False)


if __name__ == "__main__":
    main()
