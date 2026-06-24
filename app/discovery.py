"""Deterministic discovery services for university and page-seed enumeration."""
from __future__ import annotations

import re
import hashlib
from dataclasses import dataclass
from html import unescape
from datetime import datetime
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
from sqlalchemy import func
from sqlalchemy.orm import Session

from . import models
from .database import SessionLocal


MAX_PHASE4_PAGES = 40
MAX_PHASE4_OPENALEX_INSTITUTIONS = 20
MAX_OPENALEX_AUTHORS_PER_INSTITUTION = 5
MIN_CANDIDATE_CONFIDENCE = 0.55


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


@dataclass
class UniversityRecord:
    name: str
    country_code: str
    country: str
    region: str | None = None
    official_url: str | None = None
    official_domain: str | None = None
    source: str | None = None
    source_url: str | None = None
    source_confidence: float | None = None


DEFAULT_DEPARTMENTS = [
    "Computer Science",
    "Electrical and Computer Engineering",
    "Mechanical Engineering",
    "Civil and Environmental Engineering",
    "Engineering",
]

FACULTY_DIRECTORY_PATHS = [
    "faculty",
    "people",
    "directory",
    "academics/faculty",
    "research/faculty",
    "departments",
]

DEPARTMENT_PATH_PATTERNS = [
    "{slug}",
    "department/{slug}",
    "departments/{slug}",
    "academics/{slug}",
    "{slug}/faculty",
    "{slug}/people",
    "departments/{slug}/faculty",
    "departments/{slug}/people",
]

TITLE_PATTERN = re.compile(
    r"\b(Assistant Professor|Associate Professor|Professor|Full Professor|"
    r"Canada Research Chair|Research Chair|Lecturer|Senior Lecturer|"
    r"Adjunct Professor|Distinguished Professor)\b",
    re.IGNORECASE,
)
EMAIL_PATTERN = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
NAME_PATTERN = re.compile(
    r"\b(?:Dr\.|Prof\.|Professor)\s+([A-Z][A-Za-z'`.-]+(?:\s+[A-Z][A-Za-z'`.-]+){1,3})"
)
LINE_NAME_PATTERN = re.compile(r"^([A-Z][A-Za-z'`.-]+(?:\s+[A-Z][A-Za-z'`.-]+){1,3})\b")
PROFILE_LINK_KEYWORDS = (
    "faculty", "people", "profile", "directory", "professor", "research", "lab", "staff"
)


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


def _target_departments(run: models.DiscoveryRun) -> list[str]:
    raw = run.target_departments or []
    if isinstance(raw, str):
        raw_items = re.split(r"[,;\n]+", raw)
    else:
        raw_items = [str(item) for item in raw]
    departments = [item.strip() for item in raw_items if item and item.strip()]
    if not departments:
        filters = run.filters or {}
        departments.extend(str(item).strip() for item in re.split(r"[,;\n]+", str(filters.get("target_departments") or "")) if item.strip())
    if not departments:
        departments = DEFAULT_DEPARTMENTS

    seen: set[str] = set()
    out: list[str] = []
    for department in departments[:8]:
        key = normalize_name(department)
        if key and key not in seen:
            seen.add(key)
            out.append(department)
    return out


def _ror_record(item: dict[str, Any], fallback_code: str) -> UniversityRecord | None:
    name = _ror_name(item)
    if not name:
        return None
    code, country, region = _ror_location(item, fallback_code)
    official_url = _first_link(item)
    domain = (item.get("domains") or [None])[0] or normalize_domain(official_url)
    return UniversityRecord(
        name=name,
        country_code=code,
        country=country,
        region=region,
        official_url=normalize_url(official_url),
        official_domain=normalize_domain(domain),
        source="ror",
        source_url=item.get("id"),
        source_confidence=1.0,
    )


def _ror_name(item: dict[str, Any]) -> str | None:
    names = item.get("names")
    if isinstance(names, list):
        for row in names:
            if not isinstance(row, dict):
                continue
            types = row.get("types") or []
            if "ror_display" in types and row.get("value"):
                return str(row["value"]).strip()
        for row in names:
            if isinstance(row, dict) and row.get("value"):
                return str(row["value"]).strip()
    if item.get("name"):
        return str(item["name"]).strip()
    return None


def _ror_location(item: dict[str, Any], fallback_code: str) -> tuple[str, str, str | None]:
    for location in item.get("locations") or []:
        details = location.get("geonames_details") if isinstance(location, dict) else None
        if not isinstance(details, dict):
            continue
        code = str(details.get("country_code") or fallback_code).upper()
        country = str(details.get("country_name") or country_name(code))
        region = details.get("continent_name")
        return code, country, str(region) if region else None
    return fallback_code, country_name(fallback_code), None


def _first_link(item: dict[str, Any]) -> str | None:
    for link in item.get("links") or []:
        if isinstance(link, dict) and link.get("value"):
            return str(link["value"])
        if isinstance(link, str):
            return link
    return None


def _openalex_record(item: dict[str, Any], fallback_code: str) -> UniversityRecord | None:
    name = item.get("display_name")
    if not name:
        return None
    geo = item.get("geo") if isinstance(item.get("geo"), dict) else {}
    code = str(geo.get("country_code") or fallback_code).upper()
    official_url = normalize_url(item.get("homepage_url"))
    return UniversityRecord(
        name=str(name).strip(),
        country_code=code,
        country=str(geo.get("country") or country_name(code)),
        region=str(geo.get("region") or "") or None,
        official_url=official_url,
        official_domain=normalize_domain(official_url),
        source="openalex",
        source_url=item.get("ror") or item.get("id"),
        source_confidence=0.85,
    )


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


def _candidate_match(candidate: models.DiscoveryCandidate, ctx: Any) -> tuple[int, list[str]]:
    from . import scoring

    text = _candidate_text(candidate)
    tokens = scoring._tokenize(text)
    methods = scoring._extract_methods(text)
    reasons: list[str] = []
    alignment = scoring._jaccard(ctx.interest_tokens, tokens)
    method_overlap = scoring._jaccard(ctx.method_tokens, methods)
    if alignment > 0:
        reasons.append("research keywords overlap with your profile")
    if method_overlap > 0:
        reasons.append("method overlap: " + ", ".join(sorted(ctx.method_tokens & methods)[:4]))

    raw = candidate.raw_payload if isinstance(candidate.raw_payload, dict) else {}
    works_count = raw.get("works_count") or 0
    cited_by_count = raw.get("cited_by_count") or 0
    try:
        output_signal = min(1.0, (float(works_count) / 80.0) ** 0.5)
    except (TypeError, ValueError):
        output_signal = 0.0
    try:
        citation_signal = min(1.0, (float(cited_by_count) / 2500.0) ** 0.5)
    except (TypeError, ValueError):
        citation_signal = 0.0
    confidence_signal = min(1.0, max(0.0, float(candidate.extraction_confidence or 0.0)))
    profile_signal = 1.0 if candidate.profile_url else 0.0
    email_signal = 1.0 if candidate.email else 0.0

    if works_count:
        reasons.append(f"{int(works_count)} indexed works")
    if candidate.profile_url:
        reasons.append("profile evidence available")
    if candidate.email:
        reasons.append("direct email found")

    if not ctx.interest_tokens:
        alignment = 0.35 if text else 0.0
        reasons.append("profile keywords are sparse, using source strength")

    score = round(
        100
        * (
            0.42 * min(1.0, alignment * 5.0)
            + 0.14 * min(1.0, method_overlap * 4.0)
            + 0.14 * output_signal
            + 0.08 * citation_signal
            + 0.12 * confidence_signal
            + 0.07 * profile_signal
            + 0.03 * email_signal
        )
    )
    return max(0, min(100, int(score))), reasons[:6]


def verify_and_score_candidates_for_run(run_id: int) -> dict[str, int]:
    """Mark extracted candidates as verified/rejected and compute match scores."""
    from . import scoring

    with SessionLocal() as db:
        run = db.get(models.DiscoveryRun, run_id)
        if not run:
            return {"updated": 0, "verified": 0, "rejected": 0}
        candidates = (
            db.query(models.DiscoveryCandidate)
            .filter(models.DiscoveryCandidate.run_id == run_id)
            .all()
        )
        ctx = scoring.UserContext.from_db(db)
        existing_professors = {
            (normalize_name(prof.name), normalize_name(prof.university or ""))
            for prof in db.query(models.Professor).all()
        }
        updated = 0
        verified = 0
        rejected = 0
        now = datetime.utcnow()

        for candidate in candidates:
            normalized_university = normalize_name(candidate.university_name or "")
            duplicate_key = (candidate.normalized_name, normalized_university)
            score, reasons = _candidate_match(candidate, ctx)
            candidate.match_score = score
            candidate.matched_reasons = reasons
            candidate.scored_at = now

            if duplicate_key in existing_professors and not candidate.professor_id:
                candidate.verification_status = "duplicate"
                candidate.rejection_reason = "Already exists in the professor pipeline."
                rejected += 1
            elif not _looks_like_person_name(candidate.name):
                candidate.verification_status = "rejected"
                candidate.rejection_reason = "Name does not look like an individual faculty candidate."
                rejected += 1
            elif not candidate.university_name:
                candidate.verification_status = "rejected"
                candidate.rejection_reason = "Missing university affiliation."
                rejected += 1
            elif not candidate.profile_url:
                candidate.verification_status = "rejected"
                candidate.rejection_reason = "Missing profile/source URL."
                rejected += 1
            else:
                candidate.verification_status = "verified"
                candidate.rejection_reason = None
                verified += 1
            candidate.updated_at = now
            updated += 1

        run.candidates_verified = (
            db.query(func.count(models.DiscoveryCandidate.id))
            .filter(models.DiscoveryCandidate.run_id == run_id)
            .filter(models.DiscoveryCandidate.verification_status == "verified")
            .scalar()
            or verified
        )
        run.candidates_rejected = (
            db.query(func.count(models.DiscoveryCandidate.id))
            .filter(models.DiscoveryCandidate.run_id == run_id)
            .filter(models.DiscoveryCandidate.verification_status.in_(["rejected", "duplicate"]))
            .scalar()
            or rejected
        )
        run.summary = (
            f"Verified {run.candidates_verified} candidate profile(s); "
            f"{run.candidates_rejected} rejected or duplicate."
        )
        run.updated_at = now
        db.add(models.DiscoveryLog(
            run_id=run_id,
            level="info",
            stage="verification",
            message=run.summary,
            payload={"updated": updated, "verified": run.candidates_verified, "rejected": run.candidates_rejected},
        ))
        db.commit()
        return {"updated": updated, "verified": run.candidates_verified, "rejected": run.candidates_rejected}


def promote_candidate_to_professor(db: Session, candidate_id: int) -> models.Professor | None:
    """Create or link a dashboard professor from a verified discovery candidate."""
    candidate = db.get(models.DiscoveryCandidate, candidate_id)
    if not candidate:
        return None
    normalized_university = normalize_name(candidate.university_name or "")
    existing = None
    if normalized_university:
        for prof in db.query(models.Professor).filter(models.Professor.name.ilike(candidate.name)).all():
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


def _upsert_university(db: Session, run_id: int, record: UniversityRecord) -> bool:
    normalized = normalize_name(record.name)
    existing = None
    if record.source_url:
        existing = (
            db.query(models.DiscoveryUniversity)
            .filter(models.DiscoveryUniversity.run_id == run_id)
            .filter(models.DiscoveryUniversity.source_url == record.source_url)
            .first()
        )
    if existing is None:
        existing = (
            db.query(models.DiscoveryUniversity)
            .filter(models.DiscoveryUniversity.run_id == run_id)
            .filter(models.DiscoveryUniversity.normalized_name == normalized)
            .filter(models.DiscoveryUniversity.country == record.country)
            .first()
        )
    if existing:
        if not existing.official_url and record.official_url:
            existing.official_url = record.official_url
        if not existing.official_domain and record.official_domain:
            existing.official_domain = record.official_domain
        if not existing.region and record.region:
            existing.region = record.region
        if existing.source != "ror" and record.source == "ror":
            existing.source = record.source
            existing.source_url = record.source_url
            existing.source_confidence = record.source_confidence
        existing.status = "checked"
        existing.checked_at = datetime.utcnow()
        return False

    db.add(models.DiscoveryUniversity(
        run_id=run_id,
        name=record.name,
        normalized_name=normalized,
        country=record.country,
        country_code=record.country_code,
        region=record.region,
        official_domain=record.official_domain,
        official_url=record.official_url,
        source=record.source,
        source_url=record.source_url,
        source_confidence=record.source_confidence,
        status="checked",
        checked_at=datetime.utcnow(),
    ))
    return True


def _upsert_department(
    db: Session,
    run_id: int,
    university: models.DiscoveryUniversity,
    name: str,
    url: str | None = None,
) -> tuple[models.DiscoveryDepartment, bool]:
    normalized = normalize_name(name)
    existing = (
        db.query(models.DiscoveryDepartment)
        .filter(models.DiscoveryDepartment.run_id == run_id)
        .filter(models.DiscoveryDepartment.university_id == university.id)
        .filter(models.DiscoveryDepartment.normalized_name == normalized)
        .first()
    )
    if existing:
        if not existing.url and url:
            existing.url = url
        if not existing.domain and university.official_domain:
            existing.domain = university.official_domain
        existing.status = "queued"
        return existing, False

    department = models.DiscoveryDepartment(
        run_id=run_id,
        university_id=university.id,
        name=name,
        normalized_name=normalized,
        url=url,
        domain=university.official_domain,
        source="generated_seed",
        relevance_keywords=[name],
        status="queued",
    )
    db.add(department)
    db.flush()
    return department, True


def _upsert_page(
    db: Session,
    run_id: int,
    url: str,
    page_type: str,
    university: models.DiscoveryUniversity | None = None,
    department: models.DiscoveryDepartment | None = None,
    discovered_from_url: str | None = None,
) -> bool:
    normalized_url = normalize_url_key(url)
    existing = (
        db.query(models.DiscoveryPage)
        .filter(models.DiscoveryPage.run_id == run_id)
        .filter(models.DiscoveryPage.normalized_url == normalized_url)
        .first()
    )
    if existing:
        if university and not existing.university_id:
            existing.university_id = university.id
        if department and not existing.department_id:
            existing.department_id = department.id
        if existing.page_type == "unknown" and page_type:
            existing.page_type = page_type
        existing.status = "pending"
        return False

    db.add(models.DiscoveryPage(
        run_id=run_id,
        university_id=university.id if university else None,
        department_id=department.id if department else None,
        url=normalize_url(url) or url,
        normalized_url=normalized_url,
        page_type=page_type,
        status="pending",
        depth=1 if department else 0,
        fetcher="generated_seed",
        discovered_from_url=discovered_from_url,
    ))
    return True


def _candidate_profile_url(page: models.DiscoveryPage, name: str, links: list[dict[str, Any]]) -> str | None:
    normalized_parts = normalize_name(name).split()
    if len(normalized_parts) < 2:
        return None
    name_tokens = set(normalized_parts)
    best: tuple[int, str] | None = None
    for link in links[:400]:
        href = str(link.get("href") or "").strip()
        text = str(link.get("text") or "").strip()
        if not href:
            continue
        combined = f"{href} {text}".lower()
        score = 0
        if all(part in combined for part in normalized_parts[-2:]):
            score += 5
        if name_tokens & set(normalize_name(text).split()):
            score += 2
        if any(keyword in combined for keyword in PROFILE_LINK_KEYWORDS):
            score += 2
        if score <= 0:
            continue
        url = normalize_url(urljoin(page.url, href))
        if url and (best is None or score > best[0]):
            best = (score, url)
    return best[1] if best else page.url


def _extract_candidates_from_page_text(
    page: models.DiscoveryPage,
    university: models.DiscoveryUniversity | None,
    department: models.DiscoveryDepartment | None,
    text: str,
    links: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    candidates: dict[str, dict[str, Any]] = {}
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for index, line in enumerate(lines[:1200]):
        if len(line) > 260:
            continue
        title_match = TITLE_PATTERN.search(line)
        names: list[str] = []
        for match in NAME_PATTERN.finditer(line):
            names.append(match.group(1).strip())
        if title_match and not names:
            line_match = LINE_NAME_PATTERN.search(line)
            if line_match:
                names.append(line_match.group(1).strip())
        if not names:
            continue
        window = " ".join(lines[max(0, index - 2): index + 4])
        emails = EMAIL_PATTERN.findall(window)
        for name in names:
            if not _looks_like_person_name(name):
                continue
            key = normalize_name(name)
            confidence = 0.62 + (0.18 if title_match else 0) + (0.12 if emails else 0)
            candidate = candidates.get(key) or {
                "name": name,
                "title": title_match.group(1) if title_match else None,
                "rank": _rank_from_title(title_match.group(1) if title_match else ""),
                "email": emails[0] if emails else None,
                "profile_url": _candidate_profile_url(page, name, links),
                "research_text": "",
                "evidence_summary": "",
                "confidence": min(0.98, confidence),
                "quote": window[:900],
            }
            if not candidate.get("email") and emails:
                candidate["email"] = emails[0]
                candidate["confidence"] = min(0.98, float(candidate["confidence"]) + 0.1)
            if title_match and not candidate.get("title"):
                candidate["title"] = title_match.group(1)
                candidate["rank"] = _rank_from_title(title_match.group(1))
            candidate["research_text"] = _research_snippet(window)
            candidate["evidence_summary"] = _evidence_summary(candidate, university, department)
            candidates[key] = candidate

    return [
        candidate
        for candidate in candidates.values()
        if float(candidate.get("confidence") or 0) >= MIN_CANDIDATE_CONFIDENCE
    ]


def _looks_like_person_name(name: str) -> bool:
    parts = name.split()
    if len(parts) < 2 or len(parts) > 4:
        return False
    blocked = {
        "Computer Science", "Electrical Engineering", "Mechanical Engineering",
        "Civil Engineering", "Research Chair", "Assistant Professor",
        "Associate Professor", "Full Professor",
    }
    if name in blocked:
        return False
    return all(part[:1].isupper() for part in parts if part[:1].isalpha())


def _rank_from_title(title: str) -> str | None:
    value = title.lower()
    if "assistant" in value:
        return "assistant"
    if "associate" in value:
        return "associate"
    if "professor" in value or "chair" in value:
        return "full"
    if "lecturer" in value:
        return "lecturer"
    return None


def _research_snippet(text: str) -> str:
    sentences = re.split(r"(?<=[.!?])\s+", text)
    interesting = [
        sentence.strip()
        for sentence in sentences
        if any(keyword in sentence.lower() for keyword in ("research", "lab", "group", "project", "interests", "systems", "energy", "learning", "robot"))
    ]
    return " ".join(interesting[:2])[:800]


def _evidence_summary(
    candidate: dict[str, Any],
    university: models.DiscoveryUniversity | None,
    department: models.DiscoveryDepartment | None,
) -> str:
    parts = []
    if candidate.get("title"):
        parts.append(str(candidate["title"]))
    if department:
        parts.append(department.name)
    if university:
        parts.append(university.name)
    if candidate.get("email"):
        parts.append("email found")
    return " · ".join(parts)


def _upsert_candidate(
    db: Session,
    run_id: int,
    page: models.DiscoveryPage,
    candidate: dict[str, Any],
) -> tuple[models.DiscoveryCandidate, bool]:
    normalized = normalize_name(str(candidate["name"]))
    existing = (
        db.query(models.DiscoveryCandidate)
        .filter(models.DiscoveryCandidate.run_id == run_id)
        .filter(models.DiscoveryCandidate.normalized_name == normalized)
        .filter(models.DiscoveryCandidate.university_id == page.university_id)
        .first()
    )
    if existing:
        if not existing.email and candidate.get("email"):
            existing.email = candidate["email"]
        if not existing.profile_url and candidate.get("profile_url"):
            existing.profile_url = candidate["profile_url"]
        if not existing.title and candidate.get("title"):
            existing.title = candidate["title"]
        if not existing.research_text and candidate.get("research_text"):
            existing.research_text = candidate["research_text"]
        if candidate.get("confidence") and not existing.extraction_confidence:
            existing.extraction_confidence = candidate["confidence"]
        existing.updated_at = datetime.utcnow()
        return existing, False

    university_name = page.university.name if page.university else None
    country = page.university.country if page.university else None
    dept_lab = page.department.name if page.department else None
    row = models.DiscoveryCandidate(
        run_id=run_id,
        university_id=page.university_id,
        department_id=page.department_id,
        source_page_id=page.id,
        name=str(candidate["name"]).strip(),
        normalized_name=normalized,
        title=candidate.get("title"),
        rank=candidate.get("rank"),
        university_name=university_name,
        country=country,
        dept_lab=dept_lab,
        email=candidate.get("email"),
        profile_url=candidate.get("profile_url") or page.url,
        research_text=candidate.get("research_text"),
        evidence_summary=candidate.get("evidence_summary"),
        raw_payload=candidate.get("raw_payload") or {"source": "phase4_text_extraction"},
        extraction_confidence=candidate.get("confidence"),
        verification_status="pending",
    )
    db.add(row)
    db.flush()
    return row, True


def _add_candidate_evidence(
    db: Session,
    candidate: models.DiscoveryCandidate,
    page: models.DiscoveryPage,
    extracted: dict[str, Any],
) -> None:
    exists = (
        db.query(models.DiscoveryEvidence.id)
        .filter(models.DiscoveryEvidence.candidate_id == candidate.id)
        .filter(models.DiscoveryEvidence.page_id == page.id)
        .first()
    )
    if exists:
        return
    db.add(models.DiscoveryEvidence(
        candidate_id=candidate.id,
        page_id=page.id,
        evidence_type="profile",
        url=page.final_url or page.url,
        quote=str(extracted.get("quote") or "")[:1200],
        confidence=extracted.get("confidence"),
    ))
    if extracted.get("email"):
        db.add(models.DiscoveryEvidence(
            candidate_id=candidate.id,
            page_id=page.id,
            evidence_type="email",
            url=page.final_url or page.url,
            quote=str(extracted["email"]),
            confidence=0.9,
        ))


def _html_to_text_and_links(html: str, base_url: str) -> tuple[str, list[dict[str, Any]]]:
    links: list[dict[str, Any]] = []
    for match in re.finditer(r"<a\b[^>]*href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", html, flags=re.IGNORECASE | re.DOTALL):
        href = unescape(match.group(1).strip())
        label = re.sub(r"<[^>]+>", " ", match.group(2))
        label = " ".join(unescape(label).split())
        if href and not href.startswith(("mailto:", "tel:", "javascript:")):
            links.append({"href": urljoin(base_url, href), "text": label})

    cleaned = re.sub(r"<(script|style|noscript|svg)\b.*?</\1>", " ", html, flags=re.IGNORECASE | re.DOTALL)
    cleaned = re.sub(r"</(p|div|section|article|li|h[1-6]|tr)>", "\n", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"<br\s*/?>", "\n", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    cleaned = unescape(cleaned)
    lines = [" ".join(line.split()) for line in cleaned.splitlines()]
    text = "\n".join(line for line in lines if line)
    return text, links


def _phase4_page_query(db: Session, run_id: int) -> list[models.DiscoveryPage]:
    pages = (
        db.query(models.DiscoveryPage)
        .filter(models.DiscoveryPage.run_id == run_id)
        .filter(models.DiscoveryPage.status.in_(["pending", "failed"]))
        .filter(models.DiscoveryPage.page_type.in_(["faculty_directory", "department_index", "department", "university_home"]))
        .all()
    )
    if pages:
        def sort_key(page: models.DiscoveryPage) -> tuple[int, int, int, str, int]:
            page_rank = {
                "faculty_directory": 0,
                "department_index": 1,
                "department": 2,
                "university_home": 3,
            }.get(page.page_type, 9)
            university_name = (page.university.name if page.university else "").lower()
            if university_name.startswith("university of"):
                university_rank = 0
            elif " university" in university_name or university_name.startswith("university"):
                university_rank = 1
            elif "college" in university_name or "school" in university_name:
                university_rank = 3
            else:
                university_rank = 2
            return (page_rank, university_rank, page.depth, university_name, page.id)

        return sorted(pages, key=sort_key)[:MAX_PHASE4_PAGES]
    return (
        db.query(models.DiscoveryPage)
        .filter(models.DiscoveryPage.run_id == run_id)
        .filter(models.DiscoveryPage.status.in_(["pending", "failed"]))
        .order_by(models.DiscoveryPage.id.asc())
        .limit(MAX_PHASE4_PAGES)
        .all()
    )


def _phase4_university_query(db: Session, run_id: int) -> list[models.DiscoveryUniversity]:
    universities = (
        db.query(models.DiscoveryUniversity)
        .filter(models.DiscoveryUniversity.run_id == run_id)
        .filter(models.DiscoveryUniversity.source_url.isnot(None))
        .all()
    )

    def has_ror(university: models.DiscoveryUniversity) -> bool:
        return "ror.org/" in str(university.source_url or "")

    def sort_key(university: models.DiscoveryUniversity) -> tuple[int, int, str]:
        name = university.name.lower()
        if name.startswith("university of"):
            university_rank = 0
        elif " university" in name or name.startswith("university"):
            university_rank = 1
        elif "college" in name or "school" in name:
            university_rank = 3
        else:
            university_rank = 2
        return (0 if has_ror(university) else 1, university_rank, name)

    return [u for u in sorted(universities, key=sort_key) if has_ror(u)][:MAX_PHASE4_OPENALEX_INSTITUTIONS]


def _openalex_source_page(
    db: Session,
    run_id: int,
    university: models.DiscoveryUniversity,
    url: str,
) -> models.DiscoveryPage:
    normalized = normalize_url_key(url)
    existing = (
        db.query(models.DiscoveryPage)
        .filter(models.DiscoveryPage.run_id == run_id)
        .filter(models.DiscoveryPage.normalized_url == normalized)
        .first()
    )
    if existing:
        existing.university_id = existing.university_id or university.id
        existing.page_type = "openalex_authors"
        existing.status = "crawled"
        existing.fetcher = "openalex"
        existing.final_url = url
        existing.last_crawled_at = datetime.utcnow()
        return existing
    row = models.DiscoveryPage(
        run_id=run_id,
        university_id=university.id,
        url=url,
        normalized_url=normalized,
        final_url=url,
        page_type="openalex_authors",
        status="crawled",
        depth=0,
        fetcher="openalex",
        last_crawled_at=datetime.utcnow(),
    )
    db.add(row)
    db.flush()
    return row


def _openalex_ror(university: models.DiscoveryUniversity) -> str | None:
    source_url = str(university.source_url or "")
    if "ror.org/" in source_url:
        return source_url
    return None


def _openalex_author_candidate(author: dict[str, Any], university: models.DiscoveryUniversity) -> dict[str, Any] | None:
    name = str(author.get("display_name") or "").strip()
    if not name or not _looks_like_person_name(name):
        return None
    topics = []
    for topic in author.get("topics") or []:
        if isinstance(topic, dict) and topic.get("display_name"):
            topics.append(str(topic["display_name"]))
    summary_stats = author.get("summary_stats") if isinstance(author.get("summary_stats"), dict) else {}
    works_count = author.get("works_count")
    cited_by_count = author.get("cited_by_count")
    profile_url = str(author.get("id") or "").strip() or None
    research_parts = []
    if topics:
        research_parts.append("Topics: " + ", ".join(topics[:5]))
    if works_count is not None:
        research_parts.append(f"Works: {works_count}")
    if cited_by_count is not None:
        research_parts.append(f"Citations: {cited_by_count}")
    if summary_stats.get("h_index") is not None:
        research_parts.append(f"h-index: {summary_stats.get('h_index')}")
    return {
        "name": name,
        "title": None,
        "rank": None,
        "email": None,
        "profile_url": profile_url,
        "research_text": " · ".join(research_parts) or None,
        "evidence_summary": f"{name} appears in OpenAlex with a last-known affiliation at {university.name}.",
        "quote": f"{name} · {university.name} · " + ("; ".join(research_parts) if research_parts else "OpenAlex author profile"),
        "confidence": 0.72,
        "raw_payload": {
            "source": "openalex_authors",
            "openalex_id": profile_url,
            "orcid": author.get("orcid"),
            "works_count": works_count,
            "cited_by_count": cited_by_count,
            "topics": topics[:8],
        },
    }


def _extract_openalex_author_candidates(
    db: Session,
    client: httpx.Client,
    run_id: int,
) -> tuple[int, int, int]:
    universities = _phase4_university_query(db, run_id)
    source_pages = 0
    candidates_created = 0
    failures = 0
    for university in universities:
        ror = _openalex_ror(university)
        if not ror:
            continue
        params = {
            "filter": f"last_known_institutions.ror:{ror}",
            "sort": "works_count:desc",
            "per-page": MAX_OPENALEX_AUTHORS_PER_INSTITUTION,
            "select": "id,orcid,display_name,works_count,cited_by_count,summary_stats,last_known_institutions,topics",
        }
        try:
            response = client.get("https://api.openalex.org/authors", params=params)
            response.raise_for_status()
            request_url = str(response.url)
            payload = response.json()
            source_page_url = f"https://api.openalex.org/authors/by-ror/{ror.rstrip('/').split('/')[-1]}"
            page = _openalex_source_page(db, run_id, university, source_page_url)
            page.final_url = request_url
            extracted = 0
            for author in payload.get("results") or []:
                if not isinstance(author, dict):
                    continue
                candidate_data = _openalex_author_candidate(author, university)
                if not candidate_data:
                    continue
                candidate, created = _upsert_candidate(db, run_id, page, candidate_data)
                _add_candidate_evidence(db, candidate, page, candidate_data)
                candidates_created += int(created)
                extracted += 1
            page.extracted_count = extracted
            source_pages += 1
            if source_pages % 5 == 0:
                db.flush()
                db.commit()
        except Exception as exc:  # noqa: BLE001 - source-level failures are summarized on the run
            failures += 1
            _add_log(
                db,
                run_id,
                "warning",
                "candidates",
                f"OpenAlex author extraction failed for {university.name}.",
                {"university_id": university.id, "error": str(exc)[:500]},
            )
    return source_pages, candidates_created, failures


def extract_candidates_for_run(run_id: int, complete: bool = True) -> bool:
    """Fetch seeded pages and extract professor candidates with evidence."""
    with SessionLocal() as db:
        run = db.get(models.DiscoveryRun, run_id)
        if not run:
            return False
        run.status = "running"
        run.phase = "candidates"
        if not run.started_at:
            run.started_at = datetime.utcnow()
        run.updated_at = datetime.utcnow()
        db.commit()
        pages = _phase4_page_query(db, run_id)
        _add_log(
            db,
            run_id,
            "info",
            "candidates",
            f"Started candidate extraction from {len(pages)} prioritized page seed(s).",
            {"page_limit": MAX_PHASE4_PAGES},
        )

    pages_crawled = 0
    fetch_failures = 0
    candidates_created = 0
    structured_pages_crawled = 0
    structured_candidates_created = 0
    headers = {"User-Agent": "QuillAI/1.0 deterministic-candidate-discovery"}
    with httpx.Client(timeout=httpx.Timeout(12.0), headers=headers, follow_redirects=True) as client:
        with SessionLocal() as db:
            pages = _phase4_page_query(db, run_id)
            for page in pages:
                try:
                    response = client.get(page.url)
                    page.http_status = response.status_code
                    page.final_url = str(response.url)
                    content_type = response.headers.get("content-type", "")
                    if response.status_code >= 400 or ("text/html" not in content_type and "application/xhtml" not in content_type):
                        page.status = "skipped" if response.status_code < 500 else "failed"
                        page.error_message = f"Unsupported or unavailable page: HTTP {response.status_code}"
                        fetch_failures += int(page.status == "failed")
                        continue

                    text, links = _html_to_text_and_links(response.text, str(response.url))
                    page.content_hash = hashlib.sha256(response.text.encode("utf-8", errors="ignore")).hexdigest()
                    page.fetcher = "httpx"
                    page.status = "crawled"
                    page.last_crawled_at = datetime.utcnow()
                    pages_crawled += 1

                    extracted = _extract_candidates_from_page_text(page, page.university, page.department, text, links)
                    page.extracted_count = len(extracted)
                    for candidate_data in extracted:
                        candidate, created = _upsert_candidate(db, run_id, page, candidate_data)
                        _add_candidate_evidence(db, candidate, page, candidate_data)
                        candidates_created += int(created)

                    if pages_crawled % 10 == 0:
                        db.flush()
                        run = db.get(models.DiscoveryRun, run_id)
                        if run:
                            run.pages_crawled = pages_crawled
                            run.candidates_extracted = _count_candidates(db, run_id)
                            run.updated_at = datetime.utcnow()
                        db.commit()
                except Exception as exc:  # noqa: BLE001 - capture page-level fetch failures
                    page.status = "failed"
                    page.error_message = str(exc)[:500]
                    page.last_crawled_at = datetime.utcnow()
                    fetch_failures += 1
                    continue

            structured_pages_crawled, structured_candidates_created, structured_failures = _extract_openalex_author_candidates(db, client, run_id)
            fetch_failures += structured_failures
            candidates_created += structured_candidates_created
            db.flush()
            run = db.get(models.DiscoveryRun, run_id)
            if not run:
                return False
            run.pages_crawled = pages_crawled + structured_pages_crawled
            run.candidates_extracted = _count_candidates(db, run_id)
            run.candidates_verified = (
                db.query(func.count(models.DiscoveryCandidate.id))
                .filter(models.DiscoveryCandidate.run_id == run_id)
                .filter(models.DiscoveryCandidate.verification_status == "verified")
                .scalar()
                or 0
            )
            run.failures = (run.failures or 0) + fetch_failures
            run.updated_at = datetime.utcnow()
            if complete:
                run.status = "done"
                run.completed_at = datetime.utcnow()
            run.summary = (
                f"Extracted {run.candidates_extracted} candidate profile(s) from "
                f"{run.pages_crawled} crawled source page(s)."
            )
            db.commit()
            _add_log(
                db,
                run_id,
                "info" if run.candidates_extracted else "warning",
                "candidates",
                run.summary,
                {
                    "pages_attempted": len(pages),
                    "pages_crawled": pages_crawled,
                    "structured_pages_crawled": structured_pages_crawled,
                    "candidates_created": candidates_created,
                    "structured_candidates_created": structured_candidates_created,
                    "fetch_failures": fetch_failures,
                },
            )
            return run.candidates_extracted > 0


def _university_base_url(university: models.DiscoveryUniversity) -> str | None:
    if university.official_url:
        parsed = urlparse(normalize_url(university.official_url) or university.official_url)
        if parsed.netloc:
            return f"{parsed.scheme or 'https'}://{parsed.netloc}".rstrip("/")
    if university.official_domain:
        return f"https://{university.official_domain}".rstrip("/")
    return None


def _seed_department_pages_for_university(
    db: Session,
    run_id: int,
    university: models.DiscoveryUniversity,
    department_names: list[str],
) -> tuple[int, int]:
    base_url = _university_base_url(university)
    if not base_url:
        return 0, 0

    created_departments = 0
    created_pages = 0
    created_pages += int(_upsert_page(db, run_id, base_url, "university_home", university=university))
    for path in FACULTY_DIRECTORY_PATHS:
        created_pages += int(_upsert_page(
            db,
            run_id,
            f"{base_url}/{path}",
            "faculty_directory" if "faculty" in path or "people" in path or "directory" in path else "department_index",
            university=university,
            discovered_from_url=base_url,
        ))

    for department_name in department_names:
        slug = slugify_path(department_name)
        primary_url = f"{base_url}/departments/{slug}"
        department, created = _upsert_department(db, run_id, university, department_name, primary_url)
        created_departments += int(created)
        for pattern in DEPARTMENT_PATH_PATTERNS:
            path = pattern.format(slug=slug)
            page_type = "faculty_directory" if path.endswith("/faculty") or path.endswith("/people") else "department"
            created_pages += int(_upsert_page(
                db,
                run_id,
                f"{base_url}/{path}",
                page_type,
                university=university,
                department=department,
                discovered_from_url=base_url,
            ))
    return created_departments, created_pages


def _fetch_ror(client: httpx.Client, code: str) -> tuple[list[UniversityRecord], int]:
    records: list[UniversityRecord] = []
    total_seen = 0
    page = 1
    while page <= 60:
        response = client.get(
            "https://api.ror.org/organizations",
            params={"filter": f"country.country_code:{code},types:education", "page": page},
        )
        response.raise_for_status()
        payload = response.json()
        items = payload.get("items") or []
        if not items:
            break
        for item in items:
            if isinstance(item, dict) and (record := _ror_record(item, code)):
                records.append(record)
        total_seen += len(items)
        if total_seen >= int(payload.get("number_of_results") or total_seen):
            break
        page += 1
    return records, page


def _fetch_openalex(client: httpx.Client, code: str) -> tuple[list[UniversityRecord], int]:
    records: list[UniversityRecord] = []
    total_seen = 0
    page = 1
    while page <= 50:
        response = client.get(
            "https://api.openalex.org/institutions",
            params={"filter": f"country_code:{code.lower()},type:education", "per-page": 200, "page": page},
        )
        response.raise_for_status()
        payload = response.json()
        items = payload.get("results") or []
        if not items:
            break
        for item in items:
            if isinstance(item, dict) and (record := _openalex_record(item, code)):
                records.append(record)
        total_seen += len(items)
        count = int((payload.get("meta") or {}).get("count") or total_seen)
        if total_seen >= count:
            break
        page += 1
    return records, page


def enumerate_universities_for_run(run_id: int, complete: bool = True) -> bool:
    """Populate discovery_universities for a run."""
    with SessionLocal() as db:
        run = db.get(models.DiscoveryRun, run_id)
        if not run:
            return False
        run.status = "running"
        run.phase = "universities"
        if not run.started_at:
            run.started_at = datetime.utcnow()
        run.updated_at = datetime.utcnow()
        db.commit()
        countries = [str(code).upper() for code in (run.target_countries or [])]
        _add_log(db, run_id, "info", "universities", f"Started university coverage for {len(countries)} country target(s).")

    source_successes = 0
    source_failures = 0
    source_pages = 0
    headers = {"User-Agent": "QuillAI/1.0 deterministic-university-discovery"}
    with httpx.Client(timeout=httpx.Timeout(30.0), headers=headers, follow_redirects=True) as client:
        for code in countries:
            for source_name, fetcher in (("ror", _fetch_ror), ("openalex", _fetch_openalex)):
                with SessionLocal() as db:
                    run = db.get(models.DiscoveryRun, run_id)
                    if not run:
                        return False
                try:
                    records, pages = fetcher(client, code)
                    source_successes += 1
                    source_pages += pages
                    created = 0
                    with SessionLocal() as db:
                        for record in records:
                            if _upsert_university(db, run_id, record):
                                db.flush()
                                created += 1
                        run = db.get(models.DiscoveryRun, run_id)
                        if run:
                            run.universities_total = _count_universities(db, run_id)
                            run.universities_checked = source_pages
                            run.updated_at = datetime.utcnow()
                        db.commit()
                        _add_log(
                            db,
                            run_id,
                            "info",
                            "universities",
                            f"{country_name(code)} coverage updated: {created} new, {len(records)} seen.",
                            {"country_code": code, "source": source_name, "pages": pages, "records": len(records)},
                        )
                except Exception as exc:  # noqa: BLE001 - logged into run state for audit
                    source_failures += 1
                    with SessionLocal() as db:
                        run = db.get(models.DiscoveryRun, run_id)
                        if run:
                            run.failures = source_failures
                            run.universities_checked = source_pages
                            run.updated_at = datetime.utcnow()
                        db.commit()
                        _add_log(
                            db,
                            run_id,
                            "warning",
                            "universities",
                            f"{country_name(code)} source pass failed.",
                            {"country_code": code, "source": source_name, "error": str(exc)[:500]},
                        )

    with SessionLocal() as db:
        run = db.get(models.DiscoveryRun, run_id)
        if not run:
            return False
        total = _count_universities(db, run_id)
        run.universities_total = total
        run.universities_checked = source_pages
        run.failures = source_failures
        run.updated_at = datetime.utcnow()
        if source_successes == 0:
            run.status = "failed"
            run.error_message = "No university source completed successfully."
            run.summary = "University coverage failed before any structured source completed."
            level = "error"
        else:
            run.status = "done" if complete else "running"
            run.summary = f"Found {total} unique institutions across {len(countries)} country target(s)."
            level = "info"
        if complete or source_successes == 0:
            run.completed_at = datetime.utcnow()
        db.commit()
        _add_log(db, run_id, level, "universities", run.summary or "University coverage finished.")
        return source_successes > 0


def seed_department_pages_for_run(run_id: int, complete: bool = True) -> bool:
    """Populate discovery_departments and discovery_pages with deterministic crawl seeds."""
    with SessionLocal() as db:
        run = db.get(models.DiscoveryRun, run_id)
        if not run:
            return False
        if _count_departments(db, run_id) > 0 and _count_pages(db, run_id) > 0:
            run.departments_found = _count_departments(db, run_id)
            run.directory_pages_found = _count_pages(db, run_id)
            run.phase = "departments"
            run.summary = (
                f"Seeded {run.departments_found} departments and {run.directory_pages_found} crawl pages "
                "from the existing run state."
            )
            if complete:
                run.status = "done"
                run.completed_at = datetime.utcnow()
            run.updated_at = datetime.utcnow()
            db.commit()
            _add_log(db, run_id, "info", "departments", "Department and page seeds already exist; keeping existing rows.")
            return True
        run.status = "running"
        run.phase = "departments"
        if not run.started_at:
            run.started_at = datetime.utcnow()
        run.updated_at = datetime.utcnow()
        db.commit()
        department_names = _target_departments(run)
        universities = (
            db.query(models.DiscoveryUniversity)
            .filter(models.DiscoveryUniversity.run_id == run_id)
            .order_by(models.DiscoveryUniversity.country.asc(), models.DiscoveryUniversity.name.asc())
            .all()
        )
        _add_log(
            db,
            run_id,
            "info",
            "departments",
            f"Started page seeding for {len(universities)} universities and {len(department_names)} department target(s).",
            {"departments": department_names},
        )

    total_departments_created = 0
    total_pages_created = 0
    universities_seen = 0
    without_domain = 0
    with SessionLocal() as db:
        run = db.get(models.DiscoveryRun, run_id)
        if not run:
            return False
        department_names = _target_departments(run)
        universities = (
            db.query(models.DiscoveryUniversity)
            .filter(models.DiscoveryUniversity.run_id == run_id)
            .order_by(models.DiscoveryUniversity.country.asc(), models.DiscoveryUniversity.name.asc())
            .all()
        )
        for university in universities:
            universities_seen += 1
            if not _university_base_url(university):
                without_domain += 1
                continue
            created_departments, created_pages = _seed_department_pages_for_university(db, run_id, university, department_names)
            total_departments_created += created_departments
            total_pages_created += created_pages
            if universities_seen % 50 == 0:
                db.flush()
                run.departments_found = _count_departments(db, run_id)
                run.directory_pages_found = _count_pages(db, run_id)
                run.updated_at = datetime.utcnow()
                db.commit()

        db.flush()
        run.departments_found = _count_departments(db, run_id)
        run.directory_pages_found = _count_pages(db, run_id)
        run.pages_crawled = 0
        run.updated_at = datetime.utcnow()
        if complete:
            run.status = "done"
            run.completed_at = datetime.utcnow()
        run.summary = (
            f"Seeded {run.departments_found} departments and {run.directory_pages_found} crawl pages "
            f"from {len(universities)} universities."
        )
        db.commit()
        _add_log(
            db,
            run_id,
            "info" if total_pages_created else "warning",
            "departments",
            run.summary,
            {
                "departments_created": total_departments_created,
                "pages_created": total_pages_created,
                "universities_without_domain": without_domain,
            },
        )
        return run.directory_pages_found > 0


def run_discovery_seed_pipeline(run_id: int) -> None:
    """Run Phase 2, Phase 3, then Phase 4 for a new deterministic discovery run."""
    if enumerate_universities_for_run(run_id, complete=False):
        if seed_department_pages_for_run(run_id, complete=False):
            extract_candidates_for_run(run_id, complete=True)
