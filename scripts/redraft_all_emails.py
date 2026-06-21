"""Regenerate all email drafts using the current draft_email prompt.

For each professor, POSTs to /api/ai/run with workflow=draft_email and consumes
the SSE stream until completion. The backend saves the new draft row.

Existing active drafts are marked as backup (hidden from dashboard but kept in DB).
New drafts are added alongside them.

Usage:
    python3 scripts/redraft_all_emails.py [API_BASE]
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path

import httpx

API_BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
DB_PATH = os.environ.get("POSTDOC_DB", str(Path(__file__).resolve().parent.parent / "data" / "postdoc.db"))


def run_draft(prof_id: int, prof_name: str) -> tuple[bool, str]:
    """Run draft_email for one professor via SSE. Returns (ok, msg)."""
    url = f"{API_BASE}/api/ai/run"
    payload = {"workflow": "draft_email", "professor_id": prof_id, "timeout_s": 240}
    last_event = None
    try:
        with httpx.stream("POST", url, json=payload, timeout=300) as r:
            if r.status_code != 200:
                return False, f"HTTP {r.status_code}: {r.read().decode('utf-8', 'replace')[:200]}"
            for line in r.iter_lines():
                if not line:
                    continue
                if line.startswith("event:"):
                    last_event = line.split(":", 1)[1].strip()
                elif line.startswith("data:") and last_event in ("done", "error"):
                    data = json.loads(line[5:].strip() or "{}")
                    if last_event == "error":
                        return False, str(data.get("message", "unknown"))[:200]
                    if last_event == "done":
                        if data.get("ok"):
                            return True, "ok"
                        return False, "done but not ok"
        return False, "stream ended without done/error"
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    profs = conn.execute(
        "SELECT id, name FROM professors WHERE profile_url IS NOT NULL AND profile_url != '' ORDER BY id"
    ).fetchall()

    # Backup only. Keep existing drafts in place; new drafts will be inserted
    # alongside them so the user can compare per-professor in the UI.
    bak = f"{DB_PATH}.bak.{datetime.now().strftime('%Y%m%d-%H%M%S')}-pre-redraft"
    Path(bak).write_bytes(Path(DB_PATH).read_bytes())
    print(f"Backup: {bak}")

    # Mark existing active (non-backup) drafts as backup so they're hidden from the dashboard
    marked = conn.execute(
        "UPDATE email_drafts SET is_backup = 1 WHERE is_backup = 0 AND id IN "
        "(SELECT ed.id FROM email_drafts ed JOIN professors p ON ed.professor_id = p.id "
        "WHERE p.profile_url IS NOT NULL AND p.profile_url != '')"
    ).rowcount
    conn.commit()
    print(f"Marked {marked} existing drafts as backup\n")
    conn.close()
    print("Keeping existing drafts hidden in DB; new drafts will be added as active rows.\n")

    total = len(profs)
    print(f"Re-drafting for {total} professors via {API_BASE}\n")

    ok_count = 0
    fail_count = 0
    t0 = time.time()
    for i, (pid, name) in enumerate(profs, 1):
        t1 = time.time()
        ok, msg = run_draft(pid, name)
        dur = time.time() - t1
        tag = "OK " if ok else "ERR"
        print(f"  [{i:3}/{total}] {tag} {name[:40]:40} {dur:5.1f}s  {msg if not ok else ''}", flush=True)
        if ok: ok_count += 1
        else:  fail_count += 1

    print(f"\nDone in {(time.time()-t0)/60:.1f} min. OK={ok_count}  FAIL={fail_count}")


if __name__ == "__main__":
    main()
