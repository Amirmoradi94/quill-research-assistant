"""Gmail SMTP sender for outreach drafts.

Credential storage
------------------
The user's Gmail address is stored plainly; the app password is encrypted with
Fernet (AES-128-CBC + HMAC-SHA256) using a key that's either:

  1. ``SECRET_KEY`` from the environment (preferred for shared deployments), or
  2. Auto-generated and persisted to the app data directory on first use (good
     enough for a single-user local dashboard).

The key never leaves the host, the encrypted password is decrypted only
in-memory when a send is dispatched, and we never log the plaintext.

Send pipeline
-------------
``send_draft(draft_id)``:
  1. Pulls the draft + professor + user-profile from the DB.
  2. Refuses if the professor has no email or the draft has empty body/subject.
  3. Builds a multipart/alternative message with text-only body, optional CV
     attachment (taken from ``users.cv_doc_id``).
  4. Opens a TLS SMTP session to ``smtp.gmail.com:587``, logs in, sends.
  5. Stamps ``email_drafts.sent_at`` / ``sent_via='gmail'`` / ``sent_message_id``
     and advances ``professors.status`` to ``'sent'`` with today's date.
"""
from __future__ import annotations

import os
import smtplib
import ssl
import uuid
from datetime import date, datetime
from email.message import EmailMessage
from email.utils import formataddr
from pathlib import Path
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.orm import Session

from . import models
from .runtime import data_dir, smtp_key_path


SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587

_DATA_DIR = data_dir()
_KEY_FILE = smtp_key_path()


# ───────────────────────────────────────────────────────────────────
# Key management
# ───────────────────────────────────────────────────────────────────
def _resolve_key() -> bytes:
    env = os.environ.get("SECRET_KEY")
    if env:
        # Accept either a raw 32-byte url-safe-base64 Fernet key, or any
        # passphrase (derived via SHA-256).
        if len(env) == 44 and env.endswith("="):
            return env.encode()
        from hashlib import sha256
        from base64 import urlsafe_b64encode
        return urlsafe_b64encode(sha256(env.encode()).digest())

    if _KEY_FILE.exists():
        return _KEY_FILE.read_bytes().strip()
    # Generate on first use
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    key = Fernet.generate_key()
    _KEY_FILE.write_bytes(key)
    try:
        _KEY_FILE.chmod(0o600)
    except OSError:
        pass
    return key


def _fernet() -> Fernet:
    return Fernet(_resolve_key())


def encrypt_password(plaintext: str) -> str:
    """Encrypt a Gmail app password for storage in settings.gmail_app_password_encrypted."""
    if not plaintext:
        return ""
    # Strip spaces — Google displays the 16-char app password with spaces
    # ("abcd efgh ijkl mnop"); SMTP wants it joined.
    return _fernet().encrypt(plaintext.replace(" ", "").encode()).decode()


def decrypt_password(ciphertext: str) -> str:
    if not ciphertext:
        return ""
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken as exc:
        raise RuntimeError(
            "Stored Gmail app password could not be decrypted. The encryption key "
            "has changed since it was saved — re-enter the password in Settings."
        ) from exc


# ───────────────────────────────────────────────────────────────────
# Connection verification
# ───────────────────────────────────────────────────────────────────
def verify_credentials(address: str, app_password: str) -> tuple[bool, str]:
    """Try a SMTP login. Returns (ok, message)."""
    if not address or not app_password:
        return False, "Address and app password are both required."
    try:
        ctx = ssl.create_default_context()
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as smtp:
            smtp.starttls(context=ctx)
            smtp.login(address, app_password.replace(" ", ""))
        return True, "Connected — credentials accepted by Gmail."
    except smtplib.SMTPAuthenticationError as exc:
        return False, (
            "Gmail rejected the credentials. Make sure 2-Step Verification is "
            "on and the password is a 16-character App Password (not your "
            f"login password). Server said: {exc.smtp_error.decode(errors='replace')[:200]}"
        )
    except (smtplib.SMTPException, OSError) as exc:
        return False, f"Could not reach Gmail SMTP: {exc}"


# ───────────────────────────────────────────────────────────────────
# Send
# ───────────────────────────────────────────────────────────────────
class SendError(RuntimeError):
    """Raised when a draft cannot be sent. The HTTP layer maps this to 400."""


def send_draft(db: Session, draft_id: int) -> dict:
    """Send a draft via Gmail SMTP. Stamps the draft + professor on success.

    Raises SendError with a user-friendly message on any failure (no Gmail
    creds, no professor email, blank body, SMTP failure, …).
    Returns a dict of the post-send draft state for the API to echo back.
    """
    settings = db.get(models.Settings, 1)
    if not settings or not settings.gmail_address or not settings.gmail_app_password_encrypted:
        raise SendError(
            "Gmail is not connected. Go to Settings → Gmail and enter your "
            "address + a 16-character App Password."
        )

    draft = db.get(models.EmailDraft, draft_id)
    if not draft:
        raise SendError(f"Draft {draft_id} not found.")
    if draft.sent_at:
        raise SendError(f"Draft {draft_id} was already sent on {draft.sent_at.isoformat()}.")
    if draft.is_backup:
        raise SendError(f"Draft {draft_id} is a backup version; restore it before sending.")
    subject = (draft.subject or "").strip()
    body = (draft.body or "").strip()
    if not subject:
        raise SendError("Draft has an empty subject — fill it in first.")
    if not body:
        raise SendError("Draft has an empty body — fill it in first.")

    prof = draft.professor
    if not prof:
        raise SendError("Draft has no linked professor.")
    to_addr = (prof.email or "").strip()
    if not to_addr or "@" not in to_addr:
        raise SendError(f"Professor {prof.name!r} has no valid email on file.")

    # Decrypt creds
    try:
        password = decrypt_password(settings.gmail_app_password_encrypted)
    except RuntimeError as exc:
        raise SendError(str(exc))

    # Build MIME message
    user = db.get(models.User, 1)
    from_name = (settings.gmail_send_name or "").strip() \
        or (user.preferred_name or user.name if user else "").strip() \
        or settings.gmail_address
    from_header = formataddr((from_name, settings.gmail_address))

    message_id = f"<{uuid.uuid4()}@{settings.gmail_address.split('@', 1)[-1]}>"

    msg = EmailMessage()
    msg["From"] = from_header
    msg["To"] = formataddr((prof.name or "", to_addr))
    msg["Subject"] = subject
    msg["Message-ID"] = message_id
    msg.set_content(body)

    # Attachments — per-draft override wins, else fall back to user CV
    attachment_paths = _resolve_attachments(db, draft, user)
    for path in attachment_paths:
        if not path.exists():
            continue
        suffix = path.suffix.lower().lstrip(".") or "octet-stream"
        # Pick a reasonable maintype; default to application/* which is fine
        # for PDF, DOCX, ZIP, etc. (Gmail handles MIME-sniffing client-side.)
        if suffix in {"png", "jpg", "jpeg", "gif", "webp"}:
            maintype, subtype = "image", "jpeg" if suffix == "jpg" else suffix
        elif suffix == "pdf":
            maintype, subtype = "application", "pdf"
        elif suffix in {"docx", "doc"}:
            maintype, subtype = "application", \
                "vnd.openxmlformats-officedocument.wordprocessingml.document" if suffix == "docx" else "msword"
        elif suffix in {"txt", "md", "tex", "csv"}:
            maintype, subtype = "text", "plain"
        else:
            maintype, subtype = "application", "octet-stream"
        msg.add_attachment(
            path.read_bytes(),
            maintype=maintype, subtype=subtype,
            filename=path.name,
        )

    # Actually send
    try:
        ctx = ssl.create_default_context()
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as smtp:
            smtp.starttls(context=ctx)
            smtp.login(settings.gmail_address, password)
            smtp.send_message(msg)
    except smtplib.SMTPAuthenticationError as exc:
        draft.send_error = f"AUTH: {exc.smtp_error.decode(errors='replace')[:300]}"
        db.commit()
        raise SendError("Gmail rejected the App Password. Re-enter it in Settings.")
    except smtplib.SMTPRecipientsRefused as exc:
        draft.send_error = f"REJECTED: {exc.recipients}"
        db.commit()
        raise SendError(f"Gmail refused the recipient: {to_addr}")
    except (smtplib.SMTPException, OSError) as exc:
        draft.send_error = f"SMTP: {exc}"
        db.commit()
        raise SendError(f"SMTP failure: {exc}")

    # Mark sent
    now = datetime.utcnow()
    draft.sent_at = now
    draft.sent_via = "gmail"
    draft.sent_message_id = message_id
    draft.send_error = None
    prof.status = "sent"
    prof.date_sent = date.today()

    # Log to activity table if present
    try:
        db.add(models.Activity(
            kind="email_sent",
            professor_id=prof.id,
            payload={"draft_id": draft.id, "to": to_addr, "subject": subject},
            at=now,
        ))
    except Exception:
        pass

    settings.gmail_last_verified_at = now
    db.commit()

    return {
        "draft_id": draft.id,
        "professor_id": prof.id,
        "professor_name": prof.name,
        "to": to_addr,
        "subject": subject,
        "sent_at": now.isoformat(),
        "sent_message_id": message_id,
        "attachments": [p.name for p in attachment_paths if p.exists()],
    }


def send_reply(db: Session, reply_id: int) -> dict:
    """Send the composed response to an inbound EmailReply via Gmail SMTP.

    The message is threaded (In-Reply-To / References) so it lands in the
    same Gmail conversation. No attachment is added — the CV already went
    out with the initial outreach email.
    """
    settings = db.get(models.Settings, 1)
    if not settings or not settings.gmail_address or not settings.gmail_app_password_encrypted:
        raise SendError(
            "Gmail is not connected. Go to Settings → Gmail and enter your "
            "address + a 16-character App Password."
        )

    reply = db.get(models.EmailReply, reply_id)
    if not reply:
        raise SendError(f"Reply {reply_id} not found.")
    if reply.response_sent_at:
        raise SendError(f"A response to this reply was already sent on {reply.response_sent_at.isoformat()}.")

    subject = (reply.response_subject or "").strip()
    body = (reply.response_draft or "").strip()
    if not body:
        raise SendError("There is no drafted response to send — write one first.")

    to_addr = (reply.from_email or "").strip()
    if not to_addr or "@" not in to_addr:
        # Fall back to the professor's address on file.
        prof = reply.draft.professor if reply.draft else None
        to_addr = (prof.email or "").strip() if prof else ""
    if not to_addr or "@" not in to_addr:
        raise SendError("This reply has no usable sender address to respond to.")

    if not subject:
        base = (reply.subject or "").strip() or "your message"
        subject = base if base.lower().startswith("re:") else f"Re: {base}"

    try:
        password = decrypt_password(settings.gmail_app_password_encrypted)
    except RuntimeError as exc:
        raise SendError(str(exc))

    user = db.get(models.User, 1)
    from_name = (settings.gmail_send_name or "").strip() \
        or (user.preferred_name or user.name if user else "").strip() \
        or settings.gmail_address
    message_id = f"<{uuid.uuid4()}@{settings.gmail_address.split('@', 1)[-1]}>"

    # Threading headers: reference both our original outbound message and the
    # professor's reply so Gmail keeps the whole exchange in one conversation.
    in_reply_to = f"<{reply.message_id}>" if reply.message_id else None
    sent_mid = reply.draft.sent_message_id if reply.draft else None
    refs = " ".join(x for x in (sent_mid, in_reply_to) if x)

    msg = EmailMessage()
    msg["From"] = formataddr((from_name, settings.gmail_address))
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg["Message-ID"] = message_id
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
    if refs:
        msg["References"] = refs
    msg.set_content(body)

    try:
        ctx = ssl.create_default_context()
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as smtp:
            smtp.starttls(context=ctx)
            smtp.login(settings.gmail_address, password)
            smtp.send_message(msg)
    except smtplib.SMTPAuthenticationError:
        raise SendError("Gmail rejected the App Password. Re-enter it in Settings.")
    except smtplib.SMTPRecipientsRefused:
        raise SendError(f"Gmail refused the recipient: {to_addr}")
    except (smtplib.SMTPException, OSError) as exc:
        raise SendError(f"SMTP failure: {exc}")

    now = datetime.utcnow()
    reply.response_sent_at = now
    reply.response_message_id = message_id
    reply.response_subject = subject

    try:
        db.add(models.Activity(
            kind="reply_sent",
            professor_id=reply.professor_id,
            payload={"reply_id": reply.id, "to": to_addr, "subject": subject},
            at=now,
        ))
    except Exception:
        pass

    db.commit()
    return {
        "reply_id": reply.id,
        "to": to_addr,
        "subject": subject,
        "sent_at": now.isoformat(),
    }


def _resolve_attachments(
    db: Session, draft: models.EmailDraft, user: Optional[models.User]
) -> list[Path]:
    """Resolve which files to attach for this draft.

    Precedence:
      1. ``draft.attachment_doc_ids`` if it's a list (even empty — "no files").
      2. Otherwise fall back to the user's primary CV (``user.cv_doc_id``).
    """
    ids: Optional[list[int]]
    if isinstance(draft.attachment_doc_ids, list):
        ids = list(draft.attachment_doc_ids)
    elif user and getattr(user, "cv_doc_id", None):
        ids = [user.cv_doc_id]
    else:
        ids = []

    paths: list[Path] = []
    for did in ids:
        doc = db.get(models.Document, did)
        if doc and doc.file_path:
            p = Path(doc.file_path)
            if p.exists():
                paths.append(p)
    return paths


def _user_cv_path(db: Session, user: Optional[models.User]) -> Optional[Path]:
    if not user or not getattr(user, "cv_doc_id", None):
        return None
    doc = db.get(models.Document, user.cv_doc_id)
    if not doc or not doc.file_path:
        return None
    p = Path(doc.file_path)
    return p if p.exists() else None
