"""Seed the database from applications.md on first startup."""
import os
import re
from datetime import date, datetime
from pathlib import Path

from .database import SessionLocal, engine, Base
from . import models

STATUS_MAP = {
    "📝 drafting": "drafting",
    "📤 sent": "sent",
    "💬 replied": "replied",
    "🗓 interview": "interview",
    "✅ offer": "offer",
    "❌ rejected": "rejected",
    "🔇 no reply": "no_reply",
    "": "drafting",
}

APPLICATIONS_MD = os.environ.get("APPLICATIONS_MD", "/app/seed/applications.md")


def _parse_status(raw: str) -> str:
    raw = raw.strip()
    for emoji_label, val in STATUS_MAP.items():
        if emoji_label and emoji_label in raw:
            return val
    return "drafting"


def _split_row(line: str):
    parts = [c.strip() for c in line.strip().strip("|").split("|")]
    return parts


def _parse_markdown(path: Path):
    profs = []
    fellowships = []
    activity = []

    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    current_tier = None
    section = None

    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("## T1"):
            current_tier, section = "T1", "profs"
        elif line.startswith("## T2"):
            current_tier, section = "T2", "profs"
        elif line.startswith("## T3"):
            current_tier, section = "T3", "profs"
        elif line.startswith("## Funding") or line.startswith("## Fellowship"):
            section = "fellowships"
        elif line.startswith("## Activity"):
            section = "activity"
        elif line.startswith("|") and "---" not in line and section:
            cols = _split_row(line)
            if not cols or not cols[0] or cols[0] in ("#", "Professor", "Fellowship", "Date"):
                i += 1
                continue

            if section == "profs":
                try:
                    num = int(cols[0])
                except (ValueError, IndexError):
                    i += 1
                    continue
                name = cols[1] if len(cols) > 1 else ""
                university = cols[2] if len(cols) > 2 else ""
                dept_lab = cols[3] if len(cols) > 3 else ""
                has_dept_col = len(cols) >= 7
                if has_dept_col:
                    date_sent_raw = cols[4]
                    status_raw = cols[5]
                    notes = cols[6] if len(cols) > 6 else ""
                else:
                    dept_lab = ""
                    date_sent_raw = cols[3] if len(cols) > 3 else ""
                    status_raw = cols[4] if len(cols) > 4 else ""
                    notes = cols[5] if len(cols) > 5 else ""

                date_sent = None
                if date_sent_raw and re.match(r"\d{4}-\d{2}-\d{2}", date_sent_raw):
                    try:
                        date_sent = datetime.strptime(date_sent_raw, "%Y-%m-%d").date()
                    except ValueError:
                        pass

                profs.append(
                    dict(
                        number=num,
                        name=name.replace("†", "").strip(),
                        university=university,
                        dept_lab=dept_lab,
                        tier=current_tier or "T3",
                        status=_parse_status(status_raw),
                        date_sent=date_sent,
                        notes=notes,
                    )
                )

            elif section == "fellowships":
                if len(cols) >= 5 and cols[0] and cols[0] != "Fellowship":
                    fellowships.append(
                        dict(
                            name=cols[0],
                            deadline=cols[1],
                            amount=cols[2],
                            eligibility=cols[3],
                            status=cols[4] if cols[4] else "pending",
                        )
                    )

            elif section == "activity":
                if len(cols) >= 2 and re.match(r"\d{4}-\d{2}-\d{2}", cols[0]):
                    try:
                        d = datetime.strptime(cols[0], "%Y-%m-%d").date()
                    except ValueError:
                        d = date.today()
                    activity.append(dict(date=d, action=cols[1]))
        i += 1

    return profs, fellowships, activity


def seed_if_empty():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if db.query(models.Professor).count() > 0:
            return
        md_path = Path(APPLICATIONS_MD)
        if not md_path.exists():
            return
        profs, fellowships, activity = _parse_markdown(md_path)

        for p in profs:
            db.add(models.Professor(**p))
        for f in fellowships:
            db.add(models.Grant(**f))
        for a in activity:
            db.add(models.Activity(**a))

        db.add(
            models.Activity(
                date=date.today(),
                action=f"Seeded {len(profs)} professors, {len(fellowships)} fellowships from applications.md",
            )
        )
        db.commit()
    finally:
        db.close()
