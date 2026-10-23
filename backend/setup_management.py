"""One-time local Management credential setup. Run with a username argument."""

import argparse
from getpass import getpass
import os
from pathlib import Path
import tempfile

from auth import make_hash
from management_config import CONFIG_PATH, PASSWORD_HASH_KEY, USERNAME_KEY


def save_credentials(username: str, password: str, path: Path = CONFIG_PATH) -> None:
    if not username or not password or any(character in username for character in "\r\n="):
        raise ValueError("Username and password must be nonempty; username cannot contain newlines or =")
    content = f"{USERNAME_KEY}={username}\n{PASSWORD_HASH_KEY}={make_hash(password)}\n"
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent,
                                         prefix=".management-", delete=False) as file:
            temporary = Path(file.name)
            file.write(content)
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Save local Management credentials in backend/.env")
    parser.add_argument("username", help="Management username")
    username = parser.parse_args().username
    password = getpass("Management password: ")
    confirmation = getpass("Confirm password: ")
    if password != confirmation:
        parser.error("Passwords do not match")
    try:
        save_credentials(username, password)
    except ValueError as error:
        parser.error(str(error))
    print(f"Saved Management credentials in {CONFIG_PATH}. Restart the backend to use them.")


if __name__ == "__main__":
    main()
