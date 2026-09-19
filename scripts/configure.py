#!/usr/bin/env python3
"""Generate local secrets once, without overwriting an existing installation."""
from pathlib import Path
import os
import secrets

root = Path(__file__).resolve().parent.parent
target = root / ".env"
if target.exists():
    raise SystemExit(".env already exists; leaving it unchanged.")
content = (root / ".env.example").read_text(encoding="utf-8")
content = content.replace("POSTGRES_PASSWORD=\n", "POSTGRES_PASSWORD=" + secrets.token_hex(32) + "\n")
fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as output:
    output.write(content)
print("Created .env. Initial access is loopback-only. Do not commit this file.")
