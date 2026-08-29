"""
Resolving the caller's IP address from a request.

One implementation, two very different callers: the rate limiter, which uses
it as the key an abuser is bucketed under, and the newsletter signup, which
records it as evidence of consent.  They share the same trust rule, which is
the reason this lives in one place — a forwarded header is only believed when
`RATE_LIMIT_TRUST_PROXY` says a proxy we control is in front, because
otherwise any client can write `X-Forwarded-For` themselves and pick their own
identity.
"""
from typing import Optional

from fastapi import Request

from src.config.settings import settings

#: Longest textual IPv6 form, including a zone id — anything longer is not an
#: address and must not reach a 45-character column.
MAX_IP_LENGTH = 45


def get_client_ip(request: Request) -> Optional[str]:
    """
    The caller's address, or ``None`` when it cannot be determined.

    With a trusted proxy in front, the left-most `X-Forwarded-For` entry is the
    original client and everything after it is the proxy chain.  Without one,
    only the socket's peer address is believed.
    """
    if settings.RATE_LIMIT_TRUST_PROXY:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            candidate = forwarded.split(",")[0].strip()
            if candidate:
                return candidate[:MAX_IP_LENGTH]
        real_ip = request.headers.get("x-real-ip")
        if real_ip and real_ip.strip():
            return real_ip.strip()[:MAX_IP_LENGTH]
    return request.client.host if request.client else None
