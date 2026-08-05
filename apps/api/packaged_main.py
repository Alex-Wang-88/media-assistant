from os import environ

import uvicorn

from app.main import app


def main() -> None:
    port = int(environ.get("YOOM_API_PORT", "8000"))
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        log_level="info",
        access_log=True,
    )


if __name__ == "__main__":
    main()