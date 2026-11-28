#!/usr/bin/env python3
"""Store one password in the login keychain. The password arrives on stdin, never argv."""

import os
import pty
import select
import signal
import sys
import time

password = sys.stdin.buffer.read()
if password.endswith(b"\n"):
    password = password[:-1]
if password.endswith(b"\r"):
    password = password[:-1]
if not password or b"\n" in password or b"\r" in password or b"\0" in password:
    sys.stderr.write("rejected\n")
    raise SystemExit(2)

security = os.environ.get("SELFHOST_SECURITY") or "/usr/bin/security"
argv = [security, "add-generic-password", "-a", "default", "-s", "cloudflare", "-U", "-w"]

pid, fd = pty.fork()
if pid == 0:
    os.execv(security, argv)

buf = b""
sends = 0
deadline = time.time() + 15
while time.time() < deadline:
    ready, _, _ = select.select([fd], [], [], 0.2)
    if not ready:
        continue
    try:
        chunk = os.read(fd, 4096)
    except OSError:
        break
    if not chunk:
        break
    buf += chunk
    if sends == 0 and b"password data" in buf.lower():
        os.write(fd, password + b"\n")
        sends = 1
    elif sends == 1 and b"retype" in buf.lower():
        os.write(fd, password + b"\n")
        sends = 2
else:
    try:
        os.kill(pid, signal.SIGKILL)
    except OSError:
        pass

_, status = os.waitpid(pid, 0)
if sends < 2:
    sys.stderr.write("no prompt\n")
    raise SystemExit(1)
raise SystemExit(os.WEXITSTATUS(status) if os.WIFEXITED(status) else 1)
