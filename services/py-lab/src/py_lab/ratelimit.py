"""Per-IP rate limit (sliding window of one minute, in memory) and the client IP behind Render's proxy."""

from __future__ import annotations

import math
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass

WINDOW_S = 60.0


def client_ip(peer: str | None, forwarded_for: str | None, trusted_hops: int) -> str:
    """The visitor's address. Each trusted proxy appends the address it received the request from to
    X-Forwarded-For, so with N trusted hops the client is the N-th entry from the right, like Express's
    `trust proxy N` (apps/api uses 1). Entries further left were written by the client and can be forged,
    which is why uvicorn's own `--forwarded-allow-ips='*'` (left-most entry) is not used for this."""
    hops = [entry.strip() for entry in (forwarded_for or "").split(",") if entry.strip()]
    chain = [peer or "unknown", *reversed(hops)]
    return chain[min(trusted_hops, len(chain) - 1)]


@dataclass(frozen=True)
class Decision:
    allowed: bool
    limit: int
    remaining: int
    #: Seconds until a slot frees up (Retry-After when refused).
    reset_s: int

    def headers(self) -> dict[str, str]:
        headers = {
            "X-RateLimit-Limit": str(self.limit),
            "X-RateLimit-Remaining": str(self.remaining),
            "X-RateLimit-Reset": str(self.reset_s),
        }
        if not self.allowed:
            headers["Retry-After"] = str(self.reset_s)
        return headers


class RateLimiter:
    """`limit` requests per minute per key. One process, so a dict is enough (Render runs one instance)."""

    def __init__(self, limit: int, clock: Callable[[], float] = time.monotonic, max_keys: int = 10_000) -> None:
        self.limit = limit
        self.clock = clock
        self.max_keys = max_keys
        self._hits: dict[str, deque[float]] = {}

    def check(self, key: str) -> Decision:
        now = self.clock()
        if len(self._hits) >= self.max_keys:
            self._prune(now)
        hits = self._hits.setdefault(key, deque())
        while hits and now - hits[0] >= WINDOW_S:
            hits.popleft()
        if len(hits) >= self.limit:
            return Decision(False, self.limit, 0, max(1, math.ceil(WINDOW_S - (now - hits[0]))))
        hits.append(now)
        reset = math.ceil(WINDOW_S - (now - hits[0]))
        return Decision(True, self.limit, self.limit - len(hits), reset)

    def _prune(self, now: float) -> None:
        for key in [key for key, hits in self._hits.items() if not hits or now - hits[-1] >= WINDOW_S]:
            del self._hits[key]
