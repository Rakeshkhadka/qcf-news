from functools import lru_cache
from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL

BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Global application settings loaded from environment variables."""

    APP_NAME: str = "QCF News API"
    DEBUG: bool = False

    # Interactive API documentation (/docs, /redoc, /openapi.json).  Off by
    # default so a production deployment does not publish its own attack
    # surface map; the development env file turns it back on.
    ENABLE_API_DOCS: bool = False

    # Exact origins allowed to make browser requests to this API, comma
    # separated.  Empty means "no cross-origin browser access", which is the
    # correct default: in the standard deployment the host nginx puts the site
    # and the API on one origin, so CORS never enters the picture.
    #
    # A literal "*" is honoured but forces credentials off — see
    # `cors_allow_credentials` below for why it cannot be otherwise.
    CORS_ALLOW_ORIGINS: str = ""

    # Database
    DB_NAME: str
    DB_USER: str
    DB_PASS: str
    DB_HOST: str = "localhost"
    DB_PORT: int = 5432

    # JWT
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_MINUTES: int = 10080  # 7 days
    JWT_ALGORITHM: str = "HS256"
    JWT_SECRET_KEY: str
    JWT_REFRESH_SECRET_KEY: str

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # Rate limiting (per client IP)
    RATE_LIMIT_ENABLED: bool = True
    # The admin dashboard loads several resources in parallel; leave enough
    # room for ordinary navigation while endpoint-specific rules below protect
    # credentials and expensive uploads.
    RATE_LIMIT_REQUESTS: int = 120
    RATE_LIMIT_WINDOW_SECONDS: int = 60
    # How long an IP stays blocked after it breaches the limit.
    RATE_LIMIT_BLOCK_SECONDS: int = 60
    # Only trust X-Forwarded-For when a reverse proxy you control sets it;
    # otherwise any client can spoof the header and evade the limit.
    RATE_LIMIT_TRUST_PROXY: bool = False
    RATE_LIMIT_EXEMPT_PATHS: str = "/health,/docs,/redoc,/openapi.json"
    # Tighter per-endpoint budgets, enforced on top of the global one.
    # Format: "[METHOD ]PATH=LIMIT/WINDOW[/BLOCK]", comma separated.
    # Credential endpoints are the brute-force targets; uploads are the
    # expensive ones. Both default to 5 per minute.
    RATE_LIMIT_RULES: str = (
        "POST /api/v1/users/login=5/60,"
        "POST /api/v1/users/token=5/60,"
        "POST /api/v1/users/register=5/60,"
        "POST /api/v1/users/refresh-token=5/60,"
        "POST /api/v1/users/change-password=5/60,"
        "/api/v1/uploads=5/60,"
        # The signup form is an open door to somebody else's inbox: each
        # accepted request sends one email to an address the caller chose.
        # Capped per IP; the per-recipient throttle that stops a distributed
        # version of the same abuse is NEWSLETTER_RESEND_INTERVAL_SECONDS.
        # Only the three public routes are named — the admin list underneath
        # the same prefix stays on the global budget.
        "POST /api/v1/newsletter/subscribe=5/300,"
        "POST /api/v1/newsletter/confirm=10/300,"
        "POST /api/v1/newsletter/unsubscribe=10/300"
    )

    # Media / uploads
    MEDIA_ROOT: str = str(BASE_DIR / "media")
    MEDIA_URL: str = "/media"
    # Absolute origin prepended to stored media paths (empty = relative URLs)
    PUBLIC_BASE_URL: str = ""
    MAX_IMAGE_SIZE_MB: int = 10
    MAX_IMAGES_PER_UPLOAD: int = 20
    ALLOWED_IMAGE_EXTENSIONS: str = "jpg,jpeg,png,gif,webp,avif"

    # ── Site identity ─────────────────────────────────────────────────────
    # The public brand and origin, as a reader sees them.  Distinct from
    # APP_NAME (which names the service) and from PUBLIC_BASE_URL (which
    # prefixes stored media paths): these are what goes into an email — the
    # From name, and the origin the confirm and unsubscribe links are built
    # on.  A link is useless relative, so SITE_BASE_URL must be absolute.
    SITE_NAME: str = "Celeb Scoop"
    SITE_BASE_URL: str = ""
    # Postal address printed in the footer of every message.  CAN-SPAM §7704
    # requires a valid physical address in commercial email; a newsletter with
    # no way to identify its sender is not one this app will send.
    POSTAL_ADDRESS: str = ""

    # ── Newsletter ────────────────────────────────────────────────────────
    # Off by default, and the signup form is not rendered when it is off.  A
    # deployment that has not configured a sender shows no subscribe box at
    # all, rather than a box that swallows addresses.
    NEWSLETTER_ENABLED: bool = False
    NEWSLETTER_FROM_EMAIL: str = ""
    NEWSLETTER_FROM_NAME: str = ""
    NEWSLETTER_REPLY_TO: str = ""
    # How long a confirmation link stays usable.  Long enough to survive a
    # weekend, short enough that an address abandoned mid-signup ages out
    # instead of sitting in the table as a permanently pending consent.
    NEWSLETTER_CONFIRM_TOKEN_TTL_HOURS: int = 48
    # Minimum gap between two confirmation emails to the same address, so the
    # form cannot be used to bomb somebody else's inbox.  The per-IP rate
    # limit does not cover this: an attacker with many IPs would still hit one
    # victim, and the throttle that matters is keyed on the recipient.
    NEWSLETTER_RESEND_INTERVAL_SECONDS: int = 300
    # Optional mailbox offered as the second List-Unsubscribe method, for the
    # mail clients that prefer mailto: over a URL.  Left empty, only the URL
    # is advertised.
    NEWSLETTER_UNSUBSCRIBE_MAILBOX: str = ""
    # Key the permanent unsubscribe tokens are derived from.  Falls back to
    # JWT_SECRET_KEY, which works but couples the two: rotating the JWT key
    # would then invalidate every unsubscribe link already sitting in a
    # reader's inbox.  Set this to decouple them.
    NEWSLETTER_TOKEN_SECRET: str = ""

    # ── SMTP ──────────────────────────────────────────────────────────────
    # Empty host = no delivery.  In DEBUG the mailer falls back to logging
    # messages; in production an empty host with NEWSLETTER_ENABLED=True is
    # rejected at boot rather than discovered by a reader who never got a
    # confirmation email.
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    # STARTTLS on the standard submission port.  SMTP_USE_SSL is implicit TLS
    # (port 465) and takes precedence when set.
    SMTP_USE_TLS: bool = True
    SMTP_USE_SSL: bool = False
    SMTP_TIMEOUT_SECONDS: int = 10

    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=True,
        extra="allow",
    )

    @model_validator(mode="after")
    def check_newsletter_config(self) -> "Settings":
        """
        Refuse to boot with the newsletter half-configured.

        The signup form exists to collect an address and mail a confirmation
        link to it.  Enabled without a sender, an origin to build the link on,
        or a postal address to print, it can do none of those — and the
        failure is invisible from the outside, because the form still renders
        and still says "check your inbox".  Failing at startup puts the error
        in front of whoever set the variables, which is the only person who
        can fix it.

        DEBUG is exempt from the SMTP requirement alone: the console mailer
        writes the confirmation URL to the log so the flow can be walked
        through locally.
        """
        if not self.NEWSLETTER_ENABLED:
            return self

        missing = [
            name
            for name, value in (
                ("NEWSLETTER_FROM_EMAIL", self.NEWSLETTER_FROM_EMAIL),
                ("SITE_BASE_URL", self.SITE_BASE_URL),
                ("POSTAL_ADDRESS", self.POSTAL_ADDRESS),
            )
            if not value.strip()
        ]
        if not self.DEBUG and not self.SMTP_HOST.strip():
            missing.append("SMTP_HOST")

        if missing:
            raise ValueError(
                "NEWSLETTER_ENABLED is True but "
                + ", ".join(missing)
                + (" is" if len(missing) == 1 else " are")
                + " not set. Configure them, or set NEWSLETTER_ENABLED=False "
                "to take the signup form off the site."
            )

        if not self.site_base_url.startswith(("http://", "https://")):
            raise ValueError(
                "SITE_BASE_URL must be an absolute origin "
                f"(got {self.SITE_BASE_URL!r}) — confirmation links are built "
                "from it and a relative link cannot be clicked from an inbox."
            )
        return self

    @property
    def site_base_url(self) -> str:
        """Public site origin with any trailing slash removed."""
        return self.SITE_BASE_URL.strip().rstrip("/")

    @property
    def newsletter_from_name(self) -> str:
        """Display name on outgoing mail; falls back to the site's own name."""
        return self.NEWSLETTER_FROM_NAME.strip() or self.SITE_NAME

    @property
    def allowed_image_extensions(self) -> set[str]:
        return {
            ext.strip().lower().lstrip(".")
            for ext in self.ALLOWED_IMAGE_EXTENSIONS.split(",")
            if ext.strip()
        }

    @property
    def cors_allow_origins(self) -> list[str]:
        return [
            origin.strip().rstrip("/")
            for origin in self.CORS_ALLOW_ORIGINS.split(",")
            if origin.strip()
        ]

    @property
    def cors_allow_credentials(self) -> bool:
        """
        Credentials may only be granted to an explicit origin list.

        `Access-Control-Allow-Origin: *` together with
        `Access-Control-Allow-Credentials: true` is rejected by every browser,
        so a wildcard plus credentials is not a lax policy — it is a broken
        one that fails at runtime. Name the origins to get credentials.
        """
        return bool(self.cors_allow_origins) and "*" not in self.cors_allow_origins

    @property
    def rate_limit_exempt_paths(self) -> tuple[str, ...]:
        return tuple(
            path.strip()
            for path in self.RATE_LIMIT_EXEMPT_PATHS.split(",")
            if path.strip()
        )

    @property
    def max_image_size_bytes(self) -> int:
        return self.MAX_IMAGE_SIZE_MB * 1024 * 1024

    def _database_url(self, driver: str) -> str:
        """
        Assemble a connection URL with each component escaped.

        Built with `URL.create` rather than an f-string because the password is
        generated, not chosen: `openssl rand -base64` yields `/`, `+` and `=`
        roughly half the time, and an interpolated `/` ends the authority
        section — `postgresql+asyncpg://qcf_news:ab/cd@db:5432/qcf_news` either
        fails to connect or resolves somewhere unintended.  `render_as_string`
        with `hide_password=False` puts the escaped value back on the string
        SQLAlchemy's `create_engine` expects.
        """
        return URL.create(
            drivername=driver,
            username=self.DB_USER,
            password=self.DB_PASS,
            host=self.DB_HOST,
            port=self.DB_PORT,
            database=self.DB_NAME,
        ).render_as_string(hide_password=False)

    @property
    def async_database_url(self) -> str:
        return self._database_url("postgresql+asyncpg")

    @property
    def sync_database_url(self) -> str:
        return self._database_url("postgresql+psycopg2")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
