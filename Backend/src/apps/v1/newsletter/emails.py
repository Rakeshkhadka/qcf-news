"""
The messages the newsletter sends, and the URLs inside them.

Kept apart from the service so the wording — the part a person actually reads,
and the part a compliance review actually checks — is in one file rather than
scattered through business logic.

Every message carries, because a commercial mailing has to:
  • who is writing, and a postal address for them (CAN-SPAM §7704(a)(5));
  • a one-click unsubscribe link in the body;
  • `List-Unsubscribe` and `List-Unsubscribe-Post` headers, so a mail client
    can offer its own unsubscribe button without the reader hunting for the
    link (RFC 8058).
"""
from html import escape
from urllib.parse import quote

from src.config.settings import settings


def confirm_url(token: str) -> str:
    """Where the reader lands after clicking "confirm" in the opt-in email."""
    return f"{settings.site_base_url}/newsletter/confirm?token={quote(token)}"


def unsubscribe_url(token: str) -> str:
    """The human-facing unsubscribe page — a confirmation button, not an act."""
    return f"{settings.site_base_url}/newsletter/unsubscribe?token={quote(token)}"


def one_click_unsubscribe_url(token: str) -> str:
    """
    The API endpoint named in `List-Unsubscribe`.

    RFC 8058 requires the URL to accept a POST and to unsubscribe without any
    further interaction, so this points at the API directly rather than at the
    page above — the page deliberately asks first, which is the opposite of
    what a one-click header promises.
    """
    return (
        f"{settings.site_base_url}/api/v1/newsletter/unsubscribe"
        f"?token={quote(token)}"
    )


def list_unsubscribe_headers(token: str) -> dict[str, str]:
    """
    Headers letting the mail client unsubscribe on the reader's behalf.

    `List-Unsubscribe-Post` is what upgrades the header from "open this link"
    to a true one-click opt-out, and Gmail and Yahoo both require it of bulk
    senders.
    """
    methods = [f"<{one_click_unsubscribe_url(token)}>"]
    if settings.NEWSLETTER_UNSUBSCRIBE_MAILBOX:
        methods.append(f"<mailto:{settings.NEWSLETTER_UNSUBSCRIBE_MAILBOX}>")
    return {
        "List-Unsubscribe": ", ".join(methods),
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    }


def _footer_text() -> str:
    return (
        f"{settings.SITE_NAME}\n"
        f"{settings.POSTAL_ADDRESS}\n\n"
        "You are receiving this because your address was entered into the "
        f"newsletter form at {settings.site_base_url}."
    )


def _wrap_html(body: str, *, unsubscribe: str) -> str:
    """
    Minimal, inline-styled HTML.

    No stylesheet, no image, no web font: mail clients strip most of it, and a
    message that reads correctly as plain text with a couple of inline styles
    on top survives more inboxes than one that needs any of it.
    """
    return (
        '<div style="font-family:Georgia,\'Times New Roman\',serif;'
        'font-size:16px;line-height:1.5;color:#171a1b;max-width:560px;'
        'margin:0 auto;padding:24px">'
        f"{body}"
        '<hr style="border:0;border-top:1px solid #ddd;margin:32px 0">'
        '<p style="font-size:12px;color:#666;line-height:1.6">'
        f"{escape(settings.SITE_NAME)}<br>"
        f"{escape(settings.POSTAL_ADDRESS)}<br><br>"
        "You are receiving this because your address was entered into the "
        f'newsletter form at {escape(settings.site_base_url)}.<br>'
        f'<a href="{escape(unsubscribe)}" style="color:#666">Unsubscribe</a>'
        "</p></div>"
    )


def confirmation_email(*, confirm_link: str, unsubscribe_link: str) -> dict:
    """
    The double opt-in request.

    Written for someone who did *not* sign up, too: it says plainly that
    nothing happens unless they click, so a mistyped address costs its owner
    one ignored message rather than an unwanted subscription.
    """
    subject = f"Confirm your {settings.SITE_NAME} subscription"
    text = (
        f"Please confirm your subscription\n"
        f"{'=' * 33}\n\n"
        f"Somebody — we hope you — asked for the {settings.SITE_NAME} "
        "newsletter at this address.\n\n"
        "Confirm it by opening this link:\n\n"
        f"{confirm_link}\n\n"
        f"The link works for the next "
        f"{settings.NEWSLETTER_CONFIRM_TOKEN_TTL_HOURS} hours.\n\n"
        "If it wasn't you, ignore this email. Nothing was subscribed and we "
        "won't write again.\n\n"
        f"{'-' * 33}\n"
        f"{_footer_text()}\n"
        f"Unsubscribe: {unsubscribe_link}\n"
    )
    html = _wrap_html(
        '<h1 style="font-size:26px;margin:0 0 16px">Please confirm your '
        "subscription</h1>"
        f"<p>Somebody — we hope you — asked for the "
        f"{escape(settings.SITE_NAME)} newsletter at this address.</p>"
        f'<p style="margin:28px 0"><a href="{escape(confirm_link)}" '
        'style="background:#171a1b;color:#fff;padding:13px 22px;'
        'text-decoration:none;border-radius:2px;font-family:Helvetica,'
        'Arial,sans-serif;font-size:13px;letter-spacing:0.06em;'
        'text-transform:uppercase">Confirm subscription</a></p>'
        f"<p>The link works for the next "
        f"{settings.NEWSLETTER_CONFIRM_TOKEN_TTL_HOURS} hours.</p>"
        "<p>If it wasn't you, ignore this email. Nothing was subscribed and "
        "we won't write again.</p>",
        unsubscribe=unsubscribe_link,
    )
    return {"subject": subject, "text_body": text, "html_body": html}


def welcome_email(*, unsubscribe_link: str) -> dict:
    """Sent once, immediately after the confirmation link is clicked."""
    subject = f"You're subscribed to {settings.SITE_NAME}"
    text = (
        f"You're on the list\n"
        f"{'=' * 18}\n\n"
        f"Your subscription to the {settings.SITE_NAME} newsletter is "
        "confirmed.\n\n"
        "Every issue carries an unsubscribe link, and this one does too — "
        "leaving takes one click, at any time:\n\n"
        f"{unsubscribe_link}\n\n"
        f"{'-' * 18}\n"
        f"{_footer_text()}\n"
    )
    html = _wrap_html(
        '<h1 style="font-size:26px;margin:0 0 16px">You\'re on the list</h1>'
        f"<p>Your subscription to the {escape(settings.SITE_NAME)} newsletter "
        "is confirmed.</p>"
        "<p>Every issue carries an unsubscribe link, and this one does too — "
        "leaving takes one click, at any time.</p>",
        unsubscribe=unsubscribe_link,
    )
    return {"subject": subject, "text_body": text, "html_body": html}
