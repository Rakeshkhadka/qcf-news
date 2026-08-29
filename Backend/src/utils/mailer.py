"""
Outbound transactional email.

Scope is deliberately narrow: this sends the handful of one-to-one messages
the site owes a reader — today, the newsletter confirmation and its welcome
note.  It is not a bulk sender, and the actual newsletter campaigns are not
its job.

**SMTP over the standard library, not a new dependency.**  `smtplib` speaks
STARTTLS and implicit TLS perfectly well; what it is not is async, so every
send is handed to a worker thread through `anyio.to_thread.run_sync` rather
than parking the event loop for the length of a TCP conversation with someone
else's mail server.

Two backends:

- `SmtpMailer`     — the real one, used whenever `SMTP_HOST` is configured.
- `ConsoleMailer`  — logs the message instead of sending it.  Available only
  in DEBUG, so that a local stack can exercise the whole double opt-in flow
  (the confirmation URL is right there in the log) without a mail server.  It
  is unreachable in production by construction: `build_mailer` refuses to
  return it when DEBUG is off.
"""
import logging
import smtplib
import ssl
from abc import ABC, abstractmethod
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid
from typing import Optional

import anyio

from src.config.settings import settings

logger = logging.getLogger(__name__)


class MailDeliveryError(RuntimeError):
    """Raised when a message could not be handed to the mail server."""


class Mailer(ABC):
    """Sends one message to one recipient."""

    @abstractmethod
    async def send(
        self,
        *,
        to: str,
        subject: str,
        text_body: str,
        html_body: Optional[str] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> None:
        ...


def _build_message(
    *,
    to: str,
    subject: str,
    text_body: str,
    html_body: Optional[str],
    headers: Optional[dict[str, str]],
) -> EmailMessage:
    """
    Assemble a multipart/alternative message.

    Header values are checked for CR and LF before they go anywhere near the
    message: an address or subject carrying a newline is a header-injection
    attempt, and `EmailMessage` would happily fold it into extra headers.
    """
    for label, value in (("recipient", to), ("subject", subject)):
        if "\r" in value or "\n" in value:
            raise ValueError(f"Illegal line break in {label}")

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr(
        (settings.newsletter_from_name, settings.NEWSLETTER_FROM_EMAIL)
    )
    message["To"] = to
    message["Date"] = formatdate(localtime=True)
    # Without an explicit Message-ID some servers add their own and some spam
    # filters mark its absence; the domain comes from the sending address.
    message["Message-ID"] = make_msgid(
        domain=settings.NEWSLETTER_FROM_EMAIL.rpartition("@")[2] or None
    )
    if settings.NEWSLETTER_REPLY_TO:
        message["Reply-To"] = settings.NEWSLETTER_REPLY_TO

    for name, value in (headers or {}).items():
        if "\r" in value or "\n" in value:
            raise ValueError(f"Illegal line break in header {name}")
        message[name] = value

    message.set_content(text_body)
    if html_body:
        message.add_alternative(html_body, subtype="html")
    return message


class SmtpMailer(Mailer):
    """Delivers through a configured SMTP relay."""

    async def send(
        self,
        *,
        to: str,
        subject: str,
        text_body: str,
        html_body: Optional[str] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> None:
        message = _build_message(
            to=to,
            subject=subject,
            text_body=text_body,
            html_body=html_body,
            headers=headers,
        )
        try:
            await anyio.to_thread.run_sync(self._send_blocking, message)
        except (OSError, smtplib.SMTPException) as exc:
            # The address is not logged: the log is a less protected store than
            # the database, and a signup attempt is personal data too.
            logger.warning("SMTP delivery failed: %s", exc, exc_info=True)
            raise MailDeliveryError(str(exc)) from exc

    @staticmethod
    def _send_blocking(message: EmailMessage) -> None:
        """Runs in a worker thread; everything here is synchronous on purpose."""
        host = settings.SMTP_HOST
        port = settings.SMTP_PORT
        timeout = settings.SMTP_TIMEOUT_SECONDS

        if settings.SMTP_USE_SSL:
            context = ssl.create_default_context()
            client: smtplib.SMTP = smtplib.SMTP_SSL(
                host, port, timeout=timeout, context=context
            )
        else:
            client = smtplib.SMTP(host, port, timeout=timeout)

        try:
            client.ehlo()
            if settings.SMTP_USE_TLS and not settings.SMTP_USE_SSL:
                # `create_default_context` verifies the certificate and the
                # hostname.  A relay with a self-signed certificate belongs
                # behind SMTP_USE_TLS=False on a trusted network, not behind a
                # disabled check here.
                client.starttls(context=ssl.create_default_context())
                client.ehlo()
            if settings.SMTP_USERNAME:
                client.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            client.send_message(message)
        finally:
            try:
                client.quit()
            except smtplib.SMTPException:
                # The message is already sent; a relay that hangs up rudely on
                # QUIT must not turn a success into a failure.
                client.close()


class ConsoleMailer(Mailer):
    """Development backend: writes the message to the log instead of sending."""

    async def send(
        self,
        *,
        to: str,
        subject: str,
        text_body: str,
        html_body: Optional[str] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> None:
        logger.info(
            "[console mailer] To: %s\nSubject: %s\n%s\n%s",
            to,
            subject,
            "\n".join(f"{k}: {v}" for k, v in (headers or {}).items()),
            text_body,
        )


def build_mailer() -> Mailer:
    """
    Pick a backend from configuration.

    Raises when nothing can send.  That is the point: the alternative is a
    no-op mailer that lets `subscribe` answer "check your inbox" for a message
    that was never written — which is the exact failure mode this whole
    feature exists to remove.
    """
    if settings.SMTP_HOST:
        return SmtpMailer()
    if settings.DEBUG:
        logger.warning(
            "SMTP_HOST is unset; newsletter mail will be logged, not delivered"
        )
        return ConsoleMailer()
    raise RuntimeError(
        "SMTP_HOST must be set to send newsletter mail. Set NEWSLETTER_ENABLED"
        "=False to take the signup form off the site instead."
    )
