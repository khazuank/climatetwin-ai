"""Small, server-side management session store for the local demonstration."""

import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, Response
from management_config import management_credentials

COOKIE = "climatetwin_session"
SESSION_SECONDS = 8 * 60 * 60
_sessions: dict[str, tuple[float, str]] = {}
_attempts: dict[str, deque[float]] = defaultdict(deque)


def make_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 600_000)
    return f"pbkdf2_sha256$600000${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, rounds, salt, expected = encoded.split("$")
        if algorithm != "pbkdf2_sha256" or int(rounds) < 300_000:
            return False
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(rounds))
        return hmac.compare_digest(actual, bytes.fromhex(expected))
    except (ValueError, TypeError):
        return False


def login(username: str, password: str, address: str, response: Response, secure: bool) -> str:
    now = time.monotonic()
    attempts = _attempts[address]
    while attempts and now - attempts[0] > 300:
        attempts.popleft()
    if len(attempts) >= 10:
        raise HTTPException(429, "Too many sign-in attempts. Try again in five minutes.")
    expected_user, encoded = management_credentials()
    # Compute a hash on both paths to avoid a username enumeration timing signal.
    password_ok = verify_password(password, encoded or make_hash("unconfigured", b"0" * 16))
    if not expected_user or not encoded or not hmac.compare_digest(username, expected_user) or not password_ok:
        attempts.append(now)
        raise HTTPException(401, "Invalid username or password.")
    attempts.clear()
    token = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(32)
    _sessions[hashlib.sha256(token.encode()).hexdigest()] = (now + SESSION_SECONDS, csrf)
    response.set_cookie(COOKIE, token, max_age=SESSION_SECONDS, httponly=True,
                        secure=secure, samesite="lax", path="/")
    return csrf


def session(request: Request) -> tuple[str, str]:
    token = request.cookies.get(COOKIE, "")
    key = hashlib.sha256(token.encode()).hexdigest()
    entry = _sessions.get(key)
    if not token or not entry:
        raise HTTPException(401, "Management sign-in required.")
    expiry, csrf = entry
    if time.monotonic() >= expiry:
        _sessions.pop(key, None)
        raise HTTPException(401, "Management session expired.")
    return key, csrf


def require_management(request: Request) -> None:
    session(request)


def require_management_mutation(request: Request) -> None:
    _, csrf = session(request)
    if not hmac.compare_digest(request.headers.get("x-csrf-token", ""), csrf):
        raise HTTPException(403, "Invalid request token.")


def logout(request: Request, response: Response) -> None:
    key, _ = session(request)
    _sessions.pop(key, None)
    response.delete_cookie(COOKIE, path="/")
