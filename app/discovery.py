"""Shared discovery helpers.

Country-target parsing, name/URL normalization, run logging, and
candidate→professor promotion. The retrieval-first pipeline itself lives in
`discovery_v2`; this module holds the small utilities it (and the API) reuse.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import models


COUNTRIES: dict[str, str] = {
    "AD": "Andorra",
    "AE": "United Arab Emirates",
    "AF": "Afghanistan",
    "AL": "Albania",
    "AM": "Armenia",
    "AO": "Angola",
    "AR": "Argentina",
    "AT": "Austria",
    "AU": "Australia",
    "AZ": "Azerbaijan",
    "BA": "Bosnia and Herzegovina",
    "BD": "Bangladesh",
    "BE": "Belgium",
    "BF": "Burkina Faso",
    "BG": "Bulgaria",
    "BH": "Bahrain",
    "BI": "Burundi",
    "BJ": "Benin",
    "BN": "Brunei",
    "BO": "Bolivia",
    "BR": "Brazil",
    "BT": "Bhutan",
    "BW": "Botswana",
    "BY": "Belarus",
    "BZ": "Belize",
    "CA": "Canada",
    "CH": "Switzerland",
    "CL": "Chile",
    "CM": "Cameroon",
    "CN": "China",
    "CO": "Colombia",
    "CR": "Costa Rica",
    "CU": "Cuba",
    "CY": "Cyprus",
    "CZ": "Czechia",
    "DE": "Germany",
    "DK": "Denmark",
    "DO": "Dominican Republic",
    "DZ": "Algeria",
    "EC": "Ecuador",
    "EE": "Estonia",
    "EG": "Egypt",
    "ES": "Spain",
    "ET": "Ethiopia",
    "FI": "Finland",
    "FR": "France",
    "GB": "United Kingdom",
    "GE": "Georgia",
    "GH": "Ghana",
    "GR": "Greece",
    "GT": "Guatemala",
    "HK": "Hong Kong",
    "HN": "Honduras",
    "HR": "Croatia",
    "HU": "Hungary",
    "ID": "Indonesia",
    "IE": "Ireland",
    "IL": "Israel",
    "IN": "India",
    "IQ": "Iraq",
    "IR": "Iran",
    "IS": "Iceland",
    "IT": "Italy",
    "JO": "Jordan",
    "JP": "Japan",
    "KE": "Kenya",
    "KR": "South Korea",
    "KW": "Kuwait",
    "KZ": "Kazakhstan",
    "LB": "Lebanon",
    "LK": "Sri Lanka",
    "LT": "Lithuania",
    "LU": "Luxembourg",
    "LV": "Latvia",
    "MA": "Morocco",
    "MT": "Malta",
    "MX": "Mexico",
    "MY": "Malaysia",
    "NG": "Nigeria",
    "NL": "Netherlands",
    "NO": "Norway",
    "NZ": "New Zealand",
    "PE": "Peru",
    "PH": "Philippines",
    "PK": "Pakistan",
    "PL": "Poland",
    "PT": "Portugal",
    "QA": "Qatar",
    "RO": "Romania",
    "RS": "Serbia",
    "SA": "Saudi Arabia",
    "SE": "Sweden",
    "SG": "Singapore",
    "SI": "Slovenia",
    "SK": "Slovakia",
    "SV": "El Salvador",
    "TH": "Thailand",
    "TN": "Tunisia",
    "TR": "Turkey",
    "TW": "Taiwan",
    "UA": "Ukraine",
    "US": "United States",
    "UY": "Uruguay",
    "VN": "Vietnam",
    "ZA": "South Africa",
}

EU_CODES = [
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
    "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]

REGION_ALIASES: dict[str, list[str]] = {
    "european union": EU_CODES,
    "eu": EU_CODES,
    "north america": ["US", "CA"],
    "scandinavia": ["DK", "NO", "SE", "FI", "IS"],
    "nordics": ["DK", "NO", "SE", "FI", "IS"],
    "nordic countries": ["DK", "NO", "SE", "FI", "IS"],
}

COUNTRY_ALIASES: dict[str, str] = {
    "america": "US",
    "britain": "GB",
    "ca": "CA",
    "can": "CA",
    "czech republic": "CZ",
    "deutschland": "DE",
    "england": "GB",
    "holland": "NL",
    "prc": "CN",
    "south korea": "KR",
    "swiss": "CH",
    "uae": "AE",
    "uk": "GB",
    "united states of america": "US",
    "usa": "US",
}

for _code, _name in COUNTRIES.items():
    COUNTRY_ALIASES[_code.lower()] = _code
    COUNTRY_ALIASES[_name.lower()] = _code


def parse_country_targets(value: Any) -> list[str]:
    """Resolve country/region text into stable ISO2 country codes."""
    if value is None:
        return []
    if isinstance(value, list):
        raw_items = [str(item) for item in value]
    else:
        raw_items = re.split(r"[,;\n]+", str(value))

    out: list[str] = []
    seen: set[str] = set()
    for raw in raw_items:
        token = raw.strip()
        if not token:
            continue
        normalized = re.sub(r"\s+", " ", token.lower().replace(".", "")).strip()
        codes = REGION_ALIASES.get(normalized)
        if codes is None:
            code = COUNTRY_ALIASES.get(normalized)
            codes = [code] if code else []
        for code in codes:
            if code and code in COUNTRIES and code not in seen:
                seen.add(code)
                out.append(code)
    return out


def country_name(code: str) -> str:
    return COUNTRIES.get(code.upper(), code.upper())


def normalize_name(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()
    return re.sub(r"\s+", " ", normalized)


def normalize_domain(url_or_domain: str | None) -> str | None:
    if not url_or_domain:
        return None
    value = str(url_or_domain).strip()
    parsed = urlparse(value if "://" in value else f"https://{value}")
    host = (parsed.netloc or parsed.path).split("/")[0].lower()
    if host.startswith("www."):
        host = host[4:]
    return host or None


def normalize_url(value: str | None) -> str | None:
    if not value:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    return raw if "://" in raw else f"https://{raw}"


def normalize_url_key(value: str) -> str:
    parsed = urlparse(normalize_url(value) or value)
    scheme = parsed.scheme.lower() or "https"
    host = (parsed.netloc or parsed.path.split("/")[0]).lower()
    if host.startswith("www."):
        host = host[4:]
    path = parsed.path if parsed.netloc else "/" + "/".join(parsed.path.split("/")[1:])
    path = re.sub(r"/+", "/", path).rstrip("/")
    return f"{scheme}://{host}{path or ''}".rstrip("/")


def slugify_path(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "department"


def _add_log(db: Session, run_id: int, level: str, stage: str, message: str, payload: dict[str, Any] | None = None) -> None:
    db.add(models.DiscoveryLog(run_id=run_id, level=level, stage=stage, message=message, payload=payload))
    db.commit()


def _count_universities(db: Session, run_id: int) -> int:
    return db.query(func.count(models.DiscoveryUniversity.id)).filter(models.DiscoveryUniversity.run_id == run_id).scalar() or 0


def _count_departments(db: Session, run_id: int) -> int:
    return db.query(func.count(models.DiscoveryDepartment.id)).filter(models.DiscoveryDepartment.run_id == run_id).scalar() or 0


def _count_pages(db: Session, run_id: int) -> int:
    return db.query(func.count(models.DiscoveryPage.id)).filter(models.DiscoveryPage.run_id == run_id).scalar() or 0


def _count_candidates(db: Session, run_id: int) -> int:
    return db.query(func.count(models.DiscoveryCandidate.id)).filter(models.DiscoveryCandidate.run_id == run_id).scalar() or 0


def _candidate_text(candidate: models.DiscoveryCandidate) -> str:
    raw = candidate.raw_payload if isinstance(candidate.raw_payload, dict) else {}
    topics = raw.get("topics") if isinstance(raw.get("topics"), list) else []
    return "\n".join(
        str(part)
        for part in [
            candidate.name,
            candidate.title,
            candidate.rank,
            candidate.dept_lab,
            candidate.research_text,
            candidate.evidence_summary,
            " ".join(str(topic) for topic in topics[:8]),
        ]
        if part
    )


def _candidate_category(text: str) -> str:
    lower = text.lower()
    categories = [
        ("renewable", ["solar", "photovoltaic", "pv", "renewable", "energy", "grid"]),
        ("cv", ["computer vision", "vision", "image", "visual", "object detection"]),
        ("robotics", ["robot", "autonomous", "uav", "drone", "navigation", "multi-agent"]),
        ("rl", ["reinforcement learning", "policy", "q-learning", "actor-critic"]),
        ("nlp", ["language model", "nlp", "text", "transformer", "llm"]),
        ("or", ["optimization", "operations research", "scheduling", "dispatch"]),
        ("adversarial", ["adversarial", "attack", "robust", "security"]),
        ("theory", ["theory", "mathematics", "algorithm", "complexity"]),
    ]
    for category, tokens in categories:
        if any(token in lower for token in tokens):
            return category
    return "general"


def promote_candidate_to_professor(db: Session, candidate_id: int, user_id: int) -> models.Professor | None:
    """Create or link a dashboard professor from a verified discovery candidate."""
    candidate = db.get(models.DiscoveryCandidate, candidate_id)
    if not candidate:
        return None
    normalized_university = normalize_name(candidate.university_name or "")
    existing = None
    if normalized_university:
        for prof in db.query(models.Professor).filter(
            models.Professor.user_id == user_id, models.Professor.name.ilike(candidate.name)
        ).all():
            if normalize_name(prof.name) == candidate.normalized_name and normalize_name(prof.university or "") == normalized_university:
                existing = prof
                break
    if existing:
        candidate.professor_id = existing.id
        candidate.verification_status = "duplicate"
        candidate.rejection_reason = "Already exists in the professor pipeline."
        candidate.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(existing)
        return existing

    text = _candidate_text(candidate)
    research_angle = candidate.evidence_summary or candidate.research_text or ""
    if candidate.research_text and candidate.evidence_summary:
        research_angle = f"{candidate.evidence_summary} {candidate.research_text}"
    prof = models.Professor(
        user_id=user_id,
        name=candidate.name,
        university=candidate.university_name or "",
        dept_lab=candidate.dept_lab or "",
        tier="T3",
        status="drafting",
        email=candidate.email or "",
        profile_url=candidate.profile_url or "",
        lab_url=candidate.lab_url,
        scholar_url=candidate.scholar_url,
        research_angle=research_angle[:800],
        research_interests=(candidate.research_text or candidate.evidence_summary or "")[:2000],
        research_category=_candidate_category(text),
        notes=f"Imported from discovery candidate #{candidate.id}. {candidate.evidence_summary or ''}".strip(),
        source="discovery",
        is_suggested=True,
        match_score=candidate.match_score,
        relevance_score=candidate.match_score,
        relevance_breakdown={"discovery_reasons": candidate.matched_reasons or []},
        relevance_scored_at=candidate.scored_at,
    )
    db.add(prof)
    db.flush()
    candidate.professor_id = prof.id
    candidate.verification_status = "verified"
    candidate.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(prof)
    return prof


