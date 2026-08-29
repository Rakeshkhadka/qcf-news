"""
Newsletter API routes.

Three public endpoints — signup, confirm, unsubscribe — and two behind
permissions for the newsroom.

**All three public endpoints are POST, including the two reached from a link
in an email.**  A GET that changes state is a trap here: mail clients, link
scanners and corporate security gateways fetch every URL in a message before
the reader sees it, and a GET unsubscribe would take people off the list who
never clicked anything.  The links in the emails therefore point at pages on
the site, and those pages post here.

**The token travels in the query string, not the body.**  `List-Unsubscribe`
can only name a URL, and RFC 8058 one-click requires that URL to work on its
own — so the token has to be *in* it.  The cost is a token in the access log,
accepted knowingly: the same token is already in the URL of the email that
carried it, and it grants nothing beyond leaving a mailing list.
"""
from typing import Optional

from dependency_injector.wiring import Provide, inject
from fastapi import APIRouter, Depends, Query, Request

from src.apps.v1.newsletter.schemas.newsletter import SubscribeRequest
from src.apps.v1.newsletter.services.subscription_service import SubscriptionService
from src.apps.v1.newsletter.tokens import MAX_TOKEN_LENGTH, MIN_TOKEN_LENGTH
from src.apps.v1.users.permissions import PermissionCode
from src.container import Container
from src.dependencies import require_permission
from src.utils.client_ip import get_client_ip

router = APIRouter()

#: Longest User-Agent kept as consent evidence; the column is 500 wide and a
#: header far longer than that is noise, not evidence.
MAX_USER_AGENT_LENGTH = 500


@router.post("/subscribe")
@inject
async def subscribe(
    payload: SubscribeRequest,
    request: Request,
    service: SubscriptionService = Depends(Provide[Container.subscription_service]),
):
    """
    Ask for the newsletter.

    Answers 202 with the same message whichever branch it took — see the
    service for why the response must not reveal whether an address is already
    on the list.
    """
    user_agent = request.headers.get("user-agent")
    return await service.subscribe(
        payload,
        client_ip=get_client_ip(request),
        user_agent=user_agent[:MAX_USER_AGENT_LENGTH] if user_agent else None,
    )


@router.post("/confirm")
@inject
async def confirm(
    token: str = Query(..., min_length=MIN_TOKEN_LENGTH, max_length=MAX_TOKEN_LENGTH),
    service: SubscriptionService = Depends(Provide[Container.subscription_service]),
):
    """Complete a double opt-in. Idempotent."""
    return await service.confirm(token)


@router.post("/unsubscribe")
@inject
async def unsubscribe(
    token: str = Query(..., min_length=MIN_TOKEN_LENGTH, max_length=MAX_TOKEN_LENGTH),
    service: SubscriptionService = Depends(Provide[Container.subscription_service]),
):
    """
    Leave the list. Idempotent, and works even when signups are disabled.

    This is also the URL named in `List-Unsubscribe`, so it must keep working
    with nothing but the token in the query string — no body, no session, no
    referer.
    """
    return await service.unsubscribe(token)


# ── Newsroom ──────────────────────────────────────────────────────────────


@router.get("/subscribers")
@inject
async def list_subscribers(
    status: Optional[str] = Query(
        None, description="Filter by pending / confirmed / unsubscribed."
    ),
    search: Optional[str] = Query(None, max_length=200),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user=Depends(require_permission(PermissionCode.READ_SUBSCRIBERS)),
    service: SubscriptionService = Depends(Provide[Container.subscription_service]),
):
    return await service.list_subscribers(
        status_filter=status, search=search, limit=limit, offset=offset
    )


@router.delete("/subscribers/{subscriber_id}")
@inject
async def delete_subscriber(
    subscriber_id: int,
    current_user=Depends(require_permission(PermissionCode.DELETE_SUBSCRIBER)),
    service: SubscriptionService = Depends(Provide[Container.subscription_service]),
):
    """
    Erase a subscriber, for a right-to-be-forgotten request.

    A hard delete — it destroys the consent record along with the address.  To
    stop mailing someone while keeping the proof that they asked to stop, use
    the unsubscribe link instead.
    """
    return await service.delete_subscriber(subscriber_id)
