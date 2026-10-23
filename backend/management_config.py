"""Management credentials from the backend's local config or process environment."""

import os
from pathlib import Path

CONFIG_PATH = Path(__file__).resolve().parent / ".env"
USERNAME_KEY = "CLIMATETWIN_MANAGEMENT_USERNAME"
PASSWORD_HASH_KEY = "CLIMATETWIN_MANAGEMENT_PASSWORD_HASH"


def load_local_credentials(path: Path = CONFIG_PATH) -> dict[str, str]:
    if not path.exists():
        return {}
    values: dict[str, str] = {}
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or key not in (USERNAME_KEY, PASSWORD_HASH_KEY) or not value:
            raise ValueError(f"Invalid management configuration at {path}:{number}")
        values[key] = value
    return values


# Resolve relative to this module, so launching Uvicorn from another directory works.
_local_credentials = load_local_credentials()


def management_credentials() -> tuple[str, str]:
    # Explicit process variables remain available for deployed environments.
    return (
        os.environ.get(USERNAME_KEY, _local_credentials.get(USERNAME_KEY, "")),
        os.environ.get(PASSWORD_HASH_KEY, _local_credentials.get(PASSWORD_HASH_KEY, "")),
    )
