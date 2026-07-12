"""Gmail IMAP inbox poller for reply detection.

For each sent EmailDraft, search the user's Gmail inbox for messages that
either (a) reference our outbound Message-ID via In-Reply-To/References,
or (b) come from the professor's email since we sent. New replies are
stored as EmailReply rows and the professor's status auto-advances from
"sent"/"no_reply" to "replied".

Manual-trigger only for now (no background poller).
"""
from __future__ import annotations

import email
import email.utils
import imaplib
import logging
import re
from datetime import datetime, timezone
from email.header import decode_header

from sqlalchemy.orm import Session

from . import models
from .gmail import decrypt_password

log = logging.getLogger(__name__)

IMAP_HOST = "imap.gmail.com"
IMAP_PORT = 993


class InboxError(RuntimeError):
    pass


def _decode_header(raw: str | None) -> str:
    if not raw:
        return ""
    parts = decode_header(raw)
    out = []
    for chunk, charset in parts:
        if isinstance(chunk, bytes):
            try:
                out.append(chunk.decode(charset or "utf-8", errors="replace"))
            except (LookupError, TypeError):
                out.append(chunk.decode("utf-8", errors="replace"))
        else:
            out.append(chunk)
    return "".join(out)


def _extract_body(msg) -> str:
    """Best-effort plaintext extraction from a parsed email message."""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            cd = (part.get("Content-Disposition") or "").lower()
            if ct == "text/plain" and "attachment" not in cd:
                try:
                    payload = part.get_payload(decode=True) or b""
                    charset = part.get_content_charset() or "utf-8"
                    return payload.decode(charset, errors="replace")
                except Exception:
                    continue
        return ""
    payload = msg.get_payload(decode=True) or b""
    if isinstance(payload, bytes):
        charset = msg.get_content_charset() or "utf-8"
        return payload.decode(charset, errors="replace")
    return str(payload)


def _strip_quoted(body: str) -> str:
    """Trim out the most obvious quoted-original section so the snippet
    reflects what the professor actually wrote, not our outbound text."""
    lines = body.splitlines()
    out = []
    for ln in lines:
        s = ln.strip()
        if s.startswith(">") or s.startswith("On ") and " wrote:" in s:
            break
        out.append(ln)
    return "\n".join(out).strip()


_MEETING_KEYWORDS = (
    "meeting", "meet", "call", "chat", "zoom", "google meet", "teams",
    "schedule", "availability", "available", "interview", "discuss",
    "talk", "speak", "office hours", "calendar", "set up a time", "catch up",
)


def _looks_like_meeting_request(subject: str | None, body: str | None) -> bool:
    """Cheap heuristic: does this reply read like the professor wants to meet?

    Only a UI nudge for the Interview Prep feature, never a gate."""
    text = f"{subject or ''}\n{_strip_quoted(body or '')}".lower()
    return any(kw in text for kw in _MEETING_KEYWORDS)


def _parse_addr(raw: str | None) -> tuple[str | None, str | None]:
    """Return (name, email) from a header like 'Jane Doe <jane@x.com>'."""
    if not raw:
        return None, None
    # Parse before decoding: an encoded name may itself contain a comma
    # (e.g. "Granger, Éric"), which parseaddr would mistake for a separator.
    name, addr = email.utils.parseaddr(raw)
    name = _decode_header(name)
    return (name or None), (addr.lower() if addr else None)


def _parse_date(raw: str | None) -> datetime:
    if not raw:
        return datetime.utcnow()
    try:
        dt = email.utils.parsedate_to_datetime(raw)
        if dt.tzinfo:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except Exception:
        return datetime.utcnow()


def _normalize_msgid(raw: str | None) -> str | None:
    if not raw:
        return None
    m = re.search(r"<([^>]+)>", raw)
    return m.group(1) if m else raw.strip().strip("<>") or None


def _connect(settings: models.Settings) -> imaplib.IMAP4_SSL:
    if not settings.gmail_address or not settings.gmail_app_password_encrypted:
        raise InboxError("Gmail is not configured. Connect Gmail in Settings first.")
    try:
        password = decrypt_password(settings.gmail_app_password_encrypted)
    except Exception as exc:
        raise InboxError(f"Could not decrypt Gmail app password: {exc}") from exc
    try:
        m = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT, timeout=60)
        m.login(settings.gmail_address, password.replace(" ", ""))
    except imaplib.IMAP4.error as exc:
        raise InboxError(f"IMAP login failed: {exc}") from exc
    return m


def _fetch_message(m: imaplib.IMAP4_SSL, uid: bytes) -> email.message.Message | None:
    typ, data = m.fetch(uid, "(RFC822)")
    if typ != "OK" or not data or not data[0]:
        return None
    raw = data[0][1] if isinstance(data[0], tuple) else None
    if not raw:
        return None
    return email.message_from_bytes(raw)


def check_replies(db: Session, settings: models.Settings, since_days: int = 180) -> dict:
    """Scan Gmail for replies to sent drafts. Returns a summary dict.

    Strategy:
      1. Pull all EmailDraft rows that are sent and not skipped.
      2. Connect IMAP once, select INBOX.
      3. Run a single SINCE search covering the oldest send date, then
         batch-fetch headers for every candidate message in one round trip.
      4. Match each message to a draft either by thread reference
         (In-Reply-To / References vs our outbound Message-ID) or by the
         sender address matching a professor we emailed.
      5. For each new message (not already in email_replies by message_id),
         insert a row and bump the professor's status to "replied" if it
         wasn't already at a more advanced stage.

    Per-draft ``HEADER`` searches were dropped: Gmail scans them unindexed
    (~20s each), so a run of N drafts would blow the socket timeout and
    cascade-fail. One SINCE search plus one batched fetch is both reliable
    and far faster.
    """
    if not settings:
        raise InboxError("Settings row missing.")

    advanced_statuses = {"replied", "interview", "offer", "rejected"}

    drafts = (
        db.query(models.EmailDraft)
        .filter(
            models.EmailDraft.user_id == settings.user_id,
            models.EmailDraft.sent_at.isnot(None),
            models.EmailDraft.is_backup == False,  # noqa: E712
        )
        .all()
    )
    if not drafts:
        return {"checked": 0, "new_replies": 0, "errors": []}

    # Lookup maps: outbound Message-ID -> draft, and professor email -> drafts.
    sent_id_map: dict[str, models.EmailDraft] = {}
    prof_email_map: dict[str, list[models.EmailDraft]] = {}
    for d in drafts:
        mid = _normalize_msgid(d.sent_message_id)
        if mid:
            sent_id_map[mid] = d
        prof = d.professor
        if prof and prof.email:
            prof_email_map.setdefault(prof.email.strip().lower(), []).append(d)

    earliest = min(d.sent_at for d in drafts)
    own_addr = (settings.gmail_address or "").lower()

    m = _connect(settings)
    errors: list[str] = []
    new_count = 0
    checked = len(drafts)

    try:
        typ, _ = m.select("INBOX", readonly=True)
        if typ != "OK":
            raise InboxError("Could not open INBOX")

        since = earliest.strftime("%d-%b-%Y")
        typ, data = m.search(None, "SINCE", since)
        if typ != "OK" or not data or not data[0]:
            return {"checked": checked, "new_replies": 0, "errors": errors}
        seqs = data[0].split()

        # One batched header fetch for every candidate message.
        typ, hdr_data = m.fetch(b",".join(seqs).decode(), "(BODY.PEEK[HEADER])")
        if typ != "OK":
            raise InboxError("Header fetch failed")

        for item in hdr_data:
            if not isinstance(item, tuple) or len(item) < 2:
                continue
            try:
                hdr = email.message_from_bytes(item[1])
                seq_match = re.match(rb"(\d+)", item[0])
                if not seq_match:
                    continue
                seq = seq_match.group(1)

                msg_id = _normalize_msgid(hdr.get("Message-ID"))
                if msg_id and db.query(models.EmailReply).filter_by(message_id=msg_id).first():
                    continue  # already stored

                from_name, from_email_addr = _parse_addr(hdr.get("From"))
                # Skip our own outbound copies.
                if from_email_addr and own_addr and from_email_addr.lower() == own_addr:
                    continue

                received = _parse_date(hdr.get("Date"))

                # Match by thread reference first (most reliable), then by sender.
                refs = f"{hdr.get('In-Reply-To') or ''} {hdr.get('References') or ''}"
                ref_ids = set(re.findall(r"<([^>]+)>", refs))
                draft = next((sent_id_map[r] for r in ref_ids if r in sent_id_map), None)
                if draft is None and from_email_addr:
                    cands = [
                        d for d in prof_email_map.get(from_email_addr.lower(), [])
                        if d.sent_at and received >= d.sent_at
                    ]
                    if cands:
                        draft = max(cands, key=lambda d: d.sent_at)
                if draft is None:
                    continue

                full = _fetch_message(m, seq)
                if full is None:
                    continue
                body = _extract_body(full)
                snippet = _strip_quoted(body)[:500]

                subject = _decode_header(hdr.get("Subject"))
                is_meeting = _looks_like_meeting_request(subject, body)
                reply = models.EmailReply(
                    user_id=settings.user_id,
                    draft_id=draft.id,
                    professor_id=draft.professor_id,
                    received_at=received,
                    from_email=from_email_addr,
                    from_name=from_name,
                    subject=subject,
                    snippet=snippet,
                    body=body[:20000],
                    message_id=msg_id,
                    in_reply_to=_normalize_msgid(hdr.get("In-Reply-To")),
                    created_at=datetime.utcnow(),
                    meeting_request=is_meeting,
                    meeting_intent_at=datetime.utcnow() if is_meeting else None,
                )
                db.add(reply)
                new_count += 1

                # Auto-advance status if the professor is still at sent/no_reply.
                prof = draft.professor
                if prof and prof.status not in advanced_statuses:
                    prof.status = "replied"
            except Exception as exc:
                errors.append(f"message {item[0]!r}: {exc}")
                continue

        db.commit()
    finally:
        try:
            m.logout()
        except Exception:
            pass

    return {"checked": checked, "new_replies": new_count, "errors": errors}


# ───────────────────────────────────────────────────────────────────
# Background poller
# ───────────────────────────────────────────────────────────────────
# An asyncio task that runs check_replies() on a configured interval while
# Settings.reply_check_enabled is true. Started in FastAPI's startup event;
# reads settings on every tick so toggling the switch in the UI takes effect
# within ~60 seconds without restarting the server.

import asyncio
from .database import SessionLocal

_poller_task: asyncio.Task | None = None
_TICK_SECONDS = 60


async def _poller_loop() -> None:
    """Long-running async loop. Polls every minute; for every user whose
    Settings have reply-checking enabled, runs check_replies() when (a)
    Gmail is configured and (b) enough time has passed since that user's
    last run. Each user's check is isolated in its own try/except so one
    user's bad Gmail credentials can't stop the loop from reaching the rest."""
    while True:
        try:
            await asyncio.sleep(_TICK_SECONDS)
            with SessionLocal() as db:
                enabled_settings = (
                    db.query(models.Settings)
                    .filter(models.Settings.reply_check_enabled == True)  # noqa: E712
                    .all()
                )
                for settings in enabled_settings:
                    if not (settings.gmail_address and settings.gmail_app_password_encrypted):
                        continue
                    interval_h = max(1, settings.reply_check_interval_hours or 4)
                    last = settings.reply_check_last_run_at
                    now = datetime.utcnow()
                    if last and (now - last).total_seconds() < interval_h * 3600:
                        continue
                    # Time to poll.
                    log.info("Auto reply-check: starting for user_id=%s (interval=%dh)", settings.user_id, interval_h)
                    try:
                        result = check_replies(db, settings)
                        settings.reply_check_last_run_at = datetime.utcnow()
                        settings.reply_check_last_status = {
                            "checked": result.get("checked", 0),
                            "new_replies": result.get("new_replies", 0),
                            "errors_count": len(result.get("errors", [])),
                        }
                        settings.reply_check_last_error = None
                        db.commit()
                        log.info("Auto reply-check for user_id=%s: %s", settings.user_id, settings.reply_check_last_status)
                    except InboxError as exc:
                        settings.reply_check_last_run_at = datetime.utcnow()
                        settings.reply_check_last_error = str(exc)
                        db.commit()
                        log.warning("Auto reply-check failed for user_id=%s: %s", settings.user_id, exc)
                    except Exception as exc:
                        # Isolate unexpected per-user failures so the loop still
                        # reaches every other enabled user this tick.
                        db.rollback()
                        settings.reply_check_last_run_at = datetime.utcnow()
                        settings.reply_check_last_error = str(exc)
                        db.commit()
                        log.exception("Auto reply-check crashed for user_id=%s", settings.user_id)
        except asyncio.CancelledError:
            log.info("Reply poller cancelled")
            return
        except Exception:
            log.exception("Reply poller tick crashed; will continue")


def start_poller() -> None:
    """Idempotent: starts the poller task if not already running."""
    global _poller_task
    if _poller_task is not None and not _poller_task.done():
        return
    loop = asyncio.get_event_loop()
    _poller_task = loop.create_task(_poller_loop())
    log.info("Reply poller started (tick=%ds)", _TICK_SECONDS)


def stop_poller() -> None:
    global _poller_task
    if _poller_task is not None and not _poller_task.done():
        _poller_task.cancel()
    _poller_task = None
