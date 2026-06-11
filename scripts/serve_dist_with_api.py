#!/usr/bin/env python3
"""Serve the built dashboard with a small read-only API shim.

This is a local fallback for environments where Vite/FastAPI cannot be started.
It covers the Home page endpoints used by the checked-in web/dist bundle.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sqlite3
import time
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "web" / "dist"
DB = ROOT / "data" / "postdoc.db"


def rows(query: str, params: tuple[object, ...] = ()) -> list[dict[str, object]]:
    with sqlite3.connect(DB) as conn:
        conn.row_factory = sqlite3.Row
        return [dict(row) for row in conn.execute(query, params).fetchall()]


def one(query: str, params: tuple[object, ...] = ()) -> dict[str, object] | None:
    result = rows(query, params)
    return result[0] if result else None


def decode_json(value: object, fallback: object = None) -> object:
    if value is None:
        return [] if fallback is None else fallback
    if isinstance(value, (list, dict)):
        return value
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not text:
        return [] if fallback is None else fallback
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return value


def decode_fields(row: dict[str, object], fields: tuple[str, ...]) -> dict[str, object]:
    out = dict(row)
    for field in fields:
        if field in out:
            out[field] = decode_json(out[field])
    return out


def execute(query: str, params: tuple[object, ...] = ()) -> int:
    with sqlite3.connect(DB) as conn:
        cur = conn.execute(query, params)
        conn.commit()
        return int(cur.lastrowid)


def stats() -> dict[str, object]:
    profs = rows("select status, tier, university, date_sent from professors")
    by_status: dict[str, int] = {}
    by_tier: dict[str, int] = {}
    by_university: dict[str, int] = {}
    for prof in profs:
        for key, bucket in (
            ("status", by_status),
            ("tier", by_tier),
            ("university", by_university),
        ):
            value = prof.get(key)
            if value is not None:
                bucket[str(value)] = bucket.get(str(value), 0) + 1

    sent_statuses = {"sent", "replied", "interview", "offer", "rejected", "no_reply"}
    reply_statuses = {"replied", "interview", "offer", "rejected"}
    sent_count = sum(1 for prof in profs if prof.get("status") in sent_statuses)
    reply_count = sum(1 for prof in profs if prof.get("status") in reply_statuses)
    threshold = date.today() - timedelta(days=14)
    pending_followups = 0
    for prof in profs:
        if prof.get("status") != "sent" or not prof.get("date_sent"):
            continue
        try:
            sent_on = date.fromisoformat(str(prof["date_sent"]))
        except ValueError:
            continue
        if sent_on <= threshold:
            pending_followups += 1

    return {
        "total": len(profs),
        "by_status": by_status,
        "by_tier": by_tier,
        "by_university": by_university,
        "sent_count": sent_count,
        "reply_count": reply_count,
        "response_rate": round((reply_count / sent_count) * 100, 1) if sent_count else 0.0,
        "interview_count": by_status.get("interview", 0) + by_status.get("offer", 0),
        "offer_count": by_status.get("offer", 0),
        "pending_followups": pending_followups,
    }


def profile() -> dict[str, object]:
    return one(
        """
        select id, name, email, current_role, affiliation, country,
               research_interests, research_categories, orcid, scholar_url,
               github, website, twitter, phd_year, phd_institution
        from users
        limit 1
        """
    ) or {
        "id": 0,
        "name": "",
        "email": None,
        "current_role": None,
        "affiliation": None,
        "country": None,
        "research_interests": None,
        "research_categories": None,
        "orcid": None,
        "scholar_url": None,
        "github": None,
        "website": None,
        "twitter": None,
        "phd_year": None,
        "phd_institution": None,
    }


def user_full() -> dict[str, object]:
    user = one("select * from users limit 1") or profile()
    json_fields = (
        "research_categories", "languages", "target_countries",
        "target_universities_preferred", "excluded_institutions",
        "work_authorization", "methods", "application_domains",
        "tools_frameworks", "datasets_used", "datasets_created",
        "programming_languages", "certifications", "reviewing_venues",
        "transcript_doc_ids", "sample_paper_doc_ids", "field_provenance",
    )
    user = decode_fields(user, json_fields)
    user_id = user.get("id") or 1
    user["education"] = [
        decode_fields(r, ("key_courses",))
        for r in rows("select * from user_education where user_id = ? order by coalesce(order_idx, 999999), id", (user_id,))
    ]
    user["publications"] = rows(
        "select * from user_publications where user_id = ? order by coalesce(order_idx, 999999), coalesce(year, 0) desc, id",
        (user_id,),
    )
    user["experience"] = [
        decode_fields(r, ("bullets", "tech_used"))
        for r in rows("select * from user_experience where user_id = ? order by coalesce(order_idx, 999999), id", (user_id,))
    ]
    user["awards"] = rows("select * from user_awards where user_id = ? order by coalesce(order_idx, 999999), coalesce(year, 0) desc, id", (user_id,))
    user["references"] = rows("select * from user_references where user_id = ? order by coalesce(order_idx, 999999), id", (user_id,))
    return user


def professors(params: dict[str, list[str]]) -> list[dict[str, object]]:
    where: list[str] = []
    values: list[object] = []
    for field in ("tier", "status", "university", "category"):
        value = params.get(field, [""])[0]
        if not value:
            continue
        column = "research_category" if field == "category" else field
        where.append(f"{column} = ?")
        values.append(value)
    q = params.get("q", [""])[0].strip().lower()
    if q:
        where.append("(lower(name) like ? or lower(coalesce(dept_lab, '')) like ? or lower(coalesce(notes, '')) like ? or lower(coalesce(research_angle, '')) like ?)")
        values.extend([f"%{q}%"] * 4)
    sql = "select * from professors"
    if where:
        sql += " where " + " and ".join(where)
    sql += """
        order by relevance_score desc nulls last,
                 case research_category
                   when 'renewable' then 0 when 'av' then 1 when 'adversarial' then 2
                   when 'robotics' then 3 when 'rl' then 4 when 'or' then 5
                   when 'nlp' then 6 when 'cv' then 7 when 'medical' then 8
                   when 'theory' then 9 else 99 end,
                 tier asc, name asc
    """
    return [
        decode_fields(r, ("hiring_signals", "relevance_breakdown", "hiring_intel"))
        for r in rows(sql, tuple(values))
    ]


def professor(pid: int) -> dict[str, object] | None:
    row = one("select * from professors where id = ?", (pid,))
    return decode_fields(row, ("hiring_signals", "relevance_breakdown", "hiring_intel")) if row else None


def drafts(params: dict[str, list[str]]) -> list[dict[str, object]]:
    where = ["coalesce(d.is_backup, 0) = 0"]
    values: list[object] = []
    professor_id = params.get("professor_id", [""])[0]
    if professor_id:
        where.append("d.professor_id = ?")
        values.append(professor_id)
    q = params.get("q", [""])[0].strip().lower()
    if q:
        where.append("(lower(coalesce(d.subject, '')) like ? or lower(coalesce(d.body, '')) like ?)")
        values.extend([f"%{q}%"] * 2)
    return [
        decode_fields(r, ("attachment_doc_ids",))
        for r in rows(
            f"""
            select d.*,
                   p.name as professor_name,
                   p.university as professor_university,
                   p.tier as professor_tier,
                   p.status as professor_status,
                   p.email as professor_email,
                   p.research_category as professor_research_category,
                   p.profile_url as profile_url,
                   p.dept_lab as professor_dept_lab
            from email_drafts d
            left join professors p on p.id = d.professor_id
            where {' and '.join(where)}
            order by d.updated_at desc, d.id desc
            """,
            tuple(values),
        )
    ]


def draft(did: int) -> dict[str, object] | None:
    result = drafts({"id": [str(did)]})
    for row in result:
        if row["id"] == did:
            return row
    return one(
        """
        select d.*, p.name as professor_name, p.university as professor_university,
               p.tier as professor_tier, p.status as professor_status,
               p.email as professor_email, p.research_category as professor_research_category,
               p.profile_url as profile_url, p.dept_lab as professor_dept_lab
        from email_drafts d left join professors p on p.id = d.professor_id
        where d.id = ?
        """,
        (did,),
    )


def documents(kind: str | None = None) -> list[dict[str, object]]:
    sql = "select * from documents"
    params: tuple[object, ...] = ()
    if kind:
        sql += " where kind = ?"
        params = (kind,)
    sql += " order by is_default desc, created_at desc"
    out = []
    for doc in rows(sql, params):
        path = ROOT / str(doc.get("file_path") or "")
        filename = path.name if doc.get("file_path") else ""
        out.append({
            "id": doc["id"],
            "kind": doc["kind"],
            "title": doc["title"],
            "filename": filename,
            "extension": Path(filename).suffix.lstrip("."),
            "size_bytes": path.stat().st_size if doc.get("file_path") and path.exists() else 0,
            "is_default": bool(doc.get("is_default")),
            "version": doc.get("version") or 1,
            "has_text": bool((doc.get("text") or "").strip()),
            "text_chars": len(doc.get("text") or ""),
            "created_at": doc.get("created_at"),
            "updated_at": doc.get("updated_at"),
        })
    return out


def settings() -> dict[str, object]:
    row = one("select * from settings where id = 1") or {}
    row = decode_fields(row, ("default_provider_per_workflow", "batch_defaults", "reply_check_last_status"))
    row["gmail_connected"] = bool(row.get("gmail_address") and row.get("gmail_app_password_encrypted"))
    return row


def grants() -> list[dict[str, object]]:
    return [
        decode_fields(r, ("matched_reasons", "discipline_tags"))
        for r in rows("select * from grants order by id asc")
    ]


def calendar_events(params: dict[str, list[str]]) -> list[dict[str, object]]:
    where: list[str] = []
    values: list[object] = []
    if params.get("from_date", [""])[0]:
        where.append("date >= ?")
        values.append(params["from_date"][0])
    if params.get("to_date", [""])[0]:
        where.append("date <= ?")
        values.append(params["to_date"][0])
    sql = "select * from calendar_events"
    if where:
        sql += " where " + " and ".join(where)
    sql += " order by date asc, coalesce(time, '') asc, id asc"
    return rows(sql, tuple(values))


def sent_rows() -> list[dict[str, object]]:
    draft_rows = rows(
        """
        select d.*, p.name as professor_name, p.email as professor_email,
               p.university, p.tier, p.research_category, p.status
        from email_drafts d
        join professors p on p.id = d.professor_id
        where d.sent_at is not null and coalesce(d.is_backup, 0) = 0
        order by d.sent_at desc
        """
    )
    distinct_dates = sorted({str(d["sent_at"])[:10] for d in draft_rows if d.get("sent_at")})
    date_to_batch = {dt: i + 1 for i, dt in enumerate(distinct_dates)}
    now = datetime.utcnow()
    out = []
    for d in draft_rows:
        replies = rows(
            "select * from email_replies where draft_id = ? order by received_at asc",
            (d["id"],),
        )
        last = replies[-1] if replies else None
        sent_at = d.get("sent_at")
        days_since = None
        if sent_at:
            try:
                days_since = (now - datetime.fromisoformat(str(sent_at))).days
            except ValueError:
                days_since = None
        out.append({
            "draft_id": d["id"],
            "professor_id": d["professor_id"],
            "professor_name": d["professor_name"],
            "professor_email": d["professor_email"],
            "university": d["university"],
            "tier": d["tier"],
            "research_category": d["research_category"],
            "subject": d["subject"],
            "body": d["body"],
            "sent_at": sent_at,
            "sent_via": d.get("sent_via"),
            "days_since_sent": days_since,
            "batch_index": date_to_batch.get(str(sent_at)[:10]) if sent_at else None,
            "status": d["status"],
            "reply_count": len(replies),
            "last_reply_at": last.get("received_at") if last else None,
            "last_reply_snippet": last.get("snippet") if last else None,
            "replies": replies,
        })
    return out


def batches(params: dict[str, list[str]]) -> dict[str, object]:
    batch_size = int(params.get("batch_size", ["12"])[0] or 12)
    max_per_university = int(params.get("max_per_university", ["2"])[0] or 2)
    requested_weekdays = [
        int(x)
        for x in str(params.get("weekdays", ["0,1,2,3,4"])[0]).split(",")
        if x.strip().isdigit()
    ]
    weekdays = sorted({w for w in requested_weekdays if 0 <= w <= 6}) or [0, 1, 2, 3, 4]
    start_date_raw = params.get("start_date", [""])[0]
    try:
        next_send_date = date.fromisoformat(start_date_raw) if start_date_raw else date.today()
    except ValueError:
        next_send_date = date.today()

    def matches_csv_filter(row: dict[str, object], param: str, field: str) -> bool:
        values = {x for x in str(params.get(param, [""])[0]).split(",") if x}
        return not values or str(row.get(field) or "") in values

    all_drafts = drafts({})
    candidates: list[dict[str, object]] = []
    skipped: list[dict[str, object]] = []
    for r in all_drafts:
        reasons = []
        if r.get("professor_status") != "drafting":
            reasons.append("not drafting")
        if not r.get("professor_email"):
            reasons.append("missing email")
        if not r.get("subject"):
            reasons.append("missing subject")
        if not r.get("body"):
            reasons.append("missing body")
        if r.get("skipped_at"):
            reasons.append("skipped by user")
        if not matches_csv_filter(r, "tiers", "professor_tier"):
            reasons.append("filtered by tier")
        if not matches_csv_filter(r, "categories", "professor_research_category"):
            reasons.append("filtered by category")
        if not matches_csv_filter(r, "universities", "professor_university"):
            reasons.append("filtered by university")
        if reasons:
            skipped.append({
                "draft_id": r["id"],
                "name": r.get("professor_name") or "Unknown professor",
                "category": r.get("professor_research_category") or "",
                "reasons": reasons,
            })
        else:
            candidates.append(r)

    def next_allowed_date(start: date) -> date:
        current = start
        while current.weekday() not in weekdays:
            current += timedelta(days=1)
        return current

    def send_date_for_batch(index: int) -> date:
        current = next_allowed_date(next_send_date)
        for _ in range(index - 1):
            current = next_allowed_date(current + timedelta(days=1))
        return current

    def batch_payload(batch_index: int, batch_drafts: list[dict[str, object]]) -> dict[str, object]:
        send_on = send_date_for_batch(batch_index)
        universities = sorted({str(d.get("university") or "") for d in batch_drafts if d.get("university")})
        tier_mix = sorted({str(d.get("tier") or "") for d in batch_drafts if d.get("tier")})
        category_mix = sorted({str(d.get("category") or "") for d in batch_drafts if d.get("category")})
        return {
            "batch_num": batch_index,
            "size": len(batch_drafts),
            "send_date": send_on.isoformat(),
            "send_weekday": send_on.strftime("%a"),
            "universities": universities,
            "tier_mix": tier_mix,
            "category_mix": category_mix,
            "drafts": batch_drafts,
        }

    batches_out = []
    current: list[dict[str, object]] = []
    uni_counts: dict[str, int] = {}
    batch_index = 1
    for d in candidates:
        uni = str(d.get("professor_university") or "")
        if len(current) >= batch_size or uni_counts.get(uni, 0) >= max_per_university:
            batches_out.append(batch_payload(batch_index, current))
            batch_index += 1
            current = []
            uni_counts = {}
        body = str(d.get("body") or "")
        current.append({
            "draft_id": d["id"],
            "professor_id": d["professor_id"],
            "professor_name": d.get("professor_name"),
            "name": d.get("professor_name"),
            "university": d.get("professor_university") or "",
            "tier": d.get("professor_tier") or "",
            "category": d.get("professor_research_category") or "",
            "subject": d.get("subject") or "",
            "body": body,
            "profile_url": d.get("profile_url"),
            "word_count": len(body.split()),
            "email": d.get("professor_email"),
            "attachment_doc_ids": decode_json(d.get("attachment_doc_ids"), []),
            "sent_at": d.get("sent_at"),
            "send_error": d.get("send_error"),
        })
        uni_counts[uni] = uni_counts.get(uni, 0) + 1
    if current:
        batches_out.append(batch_payload(batch_index, current))
    return {
        "batches": batches_out,
        "batch_size": batch_size,
        "total_batches": len(batches_out),
        "total_eligible": len(candidates),
        "max_per_university": max_per_university,
        "skipped": skipped,
    }


def interview_preps() -> list[dict[str, object]]:
    result = []
    for p in rows(
        """
        select ip.*, pr.name as professor_name, pr.university
        from interview_prep ip
        left join professors pr on pr.id = ip.professor_id
        order by ip.updated_at desc
        """
    ):
        result.append({
            "id": p["id"],
            "professor_id": p["professor_id"],
            "professor_name": p.get("professor_name"),
            "university": p.get("university"),
            "reply_id": p.get("reply_id"),
            "position_type": p.get("position_type"),
            "meeting_format": p.get("meeting_format"),
            "meeting_at": p.get("meeting_at"),
            "meeting_notes": p.get("meeting_notes"),
            "briefing": decode_json(p.get("briefing"), {"key_facts": [], "summary": "", "what_to_expect": ""}),
            "fit_analysis": decode_json(p.get("fit_analysis"), {"strengths": [], "gaps": [], "verdict": ""}),
            "talking_points": decode_json(p.get("talking_points"), []),
            "likely_questions": decode_json(p.get("likely_questions"), []),
            "questions_to_ask": decode_json(p.get("questions_to_ask"), []),
            "logistics": decode_json(p.get("logistics"), []),
            "status": p.get("status"),
            "generated_at": p.get("generated_at"),
            "updated_at": p.get("updated_at"),
        })
    return result


def ai_runs(limit: int = 100) -> list[dict[str, object]]:
    return rows(
        """
        select id, workflow, provider, status, cost_usd, tokens_in, tokens_out,
               duration_ms, output, created_at, started_at, completed_at,
               professor_id, document_id, grant_id
        from ai_runs
        order by id desc
        limit ?
        """,
        (min(limit, 200),),
    )


def providers_status() -> dict[str, object]:
    settings = one(
        """
        select ai_provider, claude_cli_path, codex_cli_path, anthropic_api_key,
               openai_api_key, daily_cost_cap_usd
        from settings
        limit 1
        """
    ) or {}
    claude_path = settings.get("claude_cli_path")
    codex_path = settings.get("codex_cli_path")
    return {
        "selected_default": settings.get("ai_provider") or "local_shim",
        "active": "local_shim",
        "claude_cli": {"available": bool(claude_path), "path": claude_path},
        "codex_cli": {"available": bool(codex_path), "path": codex_path},
        "anthropic_api": {"configured": bool(settings.get("anthropic_api_key"))},
        "openai_api": {"configured": bool(settings.get("openai_api_key"))},
        "daily_cost_cap_usd": settings.get("daily_cost_cap_usd") or 0,
    }


def local_chat_reply(message: str) -> str:
    snapshot = stats()
    first_name = str(profile().get("name") or "there").split(" ")[0]
    lower = message.lower().strip()
    if any(word in lower for word in ("hi", "hello", "hey", "what's up", "whats up")):
        return (
            f"Hi {first_name}. I am running through the local fallback server right now. "
            f"The dashboard database is reachable: {snapshot['total']} professors, "
            f"{snapshot['sent_count']} sent, {snapshot['reply_count']} replies, and "
            f"{snapshot['pending_followups']} follow-ups due."
        )
    return (
        "I can answer from the local dashboard data while the full FastAPI/CLI backend "
        "is unavailable. Current snapshot: "
        f"{snapshot['total']} professors, {snapshot['sent_count']} sent, "
        f"{snapshot['reply_count']} replies, response rate {snapshot['response_rate']}%. "
        "Ask for a dashboard summary, follow-ups, or recent activity."
    )


class Handler(BaseHTTPRequestHandler):
    def do_HEAD(self) -> None:
        self.route(send_body=False)

    def do_GET(self) -> None:
        self.route(send_body=True)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/ai/run":
            self.ai_run()
        elif parsed.path == "/api/sent/check-replies":
            self.json({"checked": 0, "new_replies": 0, "errors": []}, True)
        elif parsed.path == "/api/gmail/test":
            self.json({"ok": False, "message": "Gmail test requires the full FastAPI backend."}, True)
        elif parsed.path.endswith("/cancel") and parsed.path.startswith("/api/ai/runs/"):
            self.json({"ok": True, "status": "cancelled"}, True)
        else:
            self.json({"error": "Endpoint not available in local shim"}, True, status=501)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")
        self.end_headers()

    def route(self, send_body: bool) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self.json({"ok": True}, send_body)
        elif parsed.path == "/api/stats":
            self.json(stats(), send_body)
        elif parsed.path == "/api/profile":
            self.json(profile(), send_body)
        elif parsed.path == "/api/user":
            self.json(user_full(), send_body)
        elif parsed.path == "/api/professors":
            self.json(professors(parse_qs(parsed.query)), send_body)
        elif parsed.path.startswith("/api/professors/") and parsed.path.endswith("/papers"):
            pid = int(parsed.path.split("/")[3])
            self.json(
                rows(
                    """
                    select id, title, venue, year, abstract, url, pdf_url,
                           relevance_score, relevance_summary, fetched_at
                    from professor_papers
                    where professor_id = ?
                    order by relevance_score desc, year desc
                    """,
                    (pid,),
                ),
                send_body,
            )
        elif parsed.path.startswith("/api/professors/") and parsed.path.endswith("/draft"):
            pid = int(parsed.path.split("/")[3])
            self.json(
                one(
                    """
                    select * from email_drafts
                    where professor_id = ? and coalesce(is_backup, 0) = 0
                    order by created_at desc
                    limit 1
                    """,
                    (pid,),
                ),
                send_body,
            )
        elif parsed.path.startswith("/api/professors/") and parsed.path.endswith("/interview-prep"):
            pid = int(parsed.path.split("/")[3])
            prep = next((p for p in interview_preps() if p["professor_id"] == pid), None)
            self.json(prep or {"detail": "No interview prep for this professor yet."}, send_body, status=200 if prep else 404)
        elif parsed.path.startswith("/api/professors/"):
            pid = int(parsed.path.split("/")[3])
            prof = professor(pid)
            self.json(prof or {"detail": "not found"}, send_body, status=200 if prof else 404)
        elif parsed.path == "/api/drafts":
            self.json(drafts(parse_qs(parsed.query)), send_body)
        elif parsed.path.startswith("/api/drafts/") and parsed.path.count("/") == 3:
            did = int(parsed.path.split("/")[3])
            item = draft(did)
            self.json(item or {"detail": "not found"}, send_body, status=200 if item else 404)
        elif parsed.path == "/api/grants" or parsed.path == "/api/fellowships":
            self.json(grants(), send_body)
        elif parsed.path == "/api/documents":
            self.json(documents(parse_qs(parsed.query).get("kind", [None])[0]), send_body)
        elif parsed.path.startswith("/api/documents/") and parsed.path.endswith("/file"):
            self.document_file(int(parsed.path.split("/")[3]), send_body)
        elif parsed.path.startswith("/api/documents/") and parsed.path.count("/") == 3:
            did = int(parsed.path.split("/")[3])
            doc = one("select * from documents where id = ?", (did,))
            self.json(doc or {"detail": "not found"}, send_body, status=200 if doc else 404)
        elif parsed.path == "/api/settings":
            self.json(settings(), send_body)
        elif parsed.path == "/api/sent":
            self.json(sent_rows(), send_body)
        elif parsed.path == "/api/batches":
            self.json(batches(parse_qs(parsed.query)), send_body)
        elif parsed.path == "/api/calendar/events":
            self.json(calendar_events(parse_qs(parsed.query)), send_body)
        elif parsed.path == "/api/interview-prep":
            self.json(interview_preps(), send_body)
        elif parsed.path == "/api/activity":
            limit = int(parse_qs(parsed.query).get("limit", ["100"])[0])
            self.json(
                rows(
                    """
                    select id, date, action, detail, professor_id, created_at
                    from activities
                    order by created_at desc
                    limit ?
                    """,
                    (limit,),
                ),
                send_body,
            )
        elif parsed.path == "/api/ai/providers":
            self.json(providers_status(), send_body)
        elif parsed.path == "/api/ai/runs":
            limit = int(parse_qs(parsed.query).get("limit", ["100"])[0])
            self.json(ai_runs(limit), send_body)
        elif parsed.path == "/api/ai/workflows":
            self.json([{"id": "chat", "label": "Chat"}], send_body)
        elif parsed.path.startswith("/api/"):
            self.json({"error": "Endpoint not available in local shim"}, send_body, status=501)
        else:
            self.static(parsed.path, send_body)

    def json(self, payload: object, send_body: bool, status: int = 200) -> None:
        body = json.dumps(payload, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        if send_body:
            self.wfile.write(body)

    def document_file(self, doc_id: int, send_body: bool) -> None:
        doc = one("select file_path from documents where id = ?", (doc_id,))
        if not doc or not doc.get("file_path"):
            self.json({"detail": "not found"}, send_body, status=404)
            return
        target = (ROOT / str(doc["file_path"])).resolve()
        if not str(target).startswith(str(ROOT.resolve())) or not target.is_file():
            self.json({"detail": "not found"}, send_body, status=404)
            return
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if send_body:
            self.wfile.write(body)

    def ai_run(self) -> None:
        started = time.monotonic()
        length = int(self.headers.get("Content-Length") or "0")
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self.json({"error": "Invalid JSON"}, True, status=400)
            return

        workflow = str(payload.get("workflow") or "chat")
        params = payload.get("params") if isinstance(payload.get("params"), dict) else {}
        message = str(params.get("message") or "").strip()
        created_at = datetime.utcnow().isoformat(sep=" ")
        run_id = execute(
            """
            insert into ai_runs
              (workflow, provider, status, output, created_at, started_at,
               professor_id, document_id, grant_id)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                workflow,
                "local_shim",
                "running",
                "",
                created_at,
                created_at,
                payload.get("professor_id"),
                payload.get("document_id"),
                payload.get("grant_id"),
            ),
        )

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        def send_event(kind: str, data: dict[str, object]) -> None:
            frame = f"event: {kind}\ndata: {json.dumps(data, default=str)}\n\n"
            self.wfile.write(frame.encode("utf-8"))
            self.wfile.flush()

        send_event("run_id", {"id": run_id, "provider": "local_shim", "workflow": workflow})
        send_event("started", {"provider": "local_shim"})

        if workflow != "chat":
            answer = f"The local fallback server only supports Quill chat. Workflow '{workflow}' needs FastAPI."
            send_event("error", {"message": answer})
            status = "failed"
        else:
            answer = local_chat_reply(message)
            send_event("text", {"text": answer})
            status = "done"

        duration_ms = int((time.monotonic() - started) * 1000)
        completed_at = datetime.utcnow().isoformat(sep=" ")
        execute(
            """
            update ai_runs
            set status = ?, output = ?, duration_ms = ?, completed_at = ?
            where id = ?
            """,
            (status, answer, duration_ms, completed_at, run_id),
        )
        send_event("done", {"ok": status == "done", "result": answer, "duration_ms": duration_ms})
        self.close_connection = True

    def static(self, request_path: str, send_body: bool) -> None:
        rel = request_path.lstrip("/") or "index.html"
        target = (DIST / rel).resolve()
        if not str(target).startswith(str(DIST.resolve())) or not target.is_file():
            target = DIST / "index.html"
        body = target.read_bytes()
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if send_body:
            self.wfile.write(body)

    def log_message(self, fmt: str, *args: object) -> None:
        print("%s - %s" % (self.address_string(), fmt % args))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5173)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Serving dashboard on http://{args.host}:{args.port}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
