from datetime import date as _date, datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict


class ProfessorBase(BaseModel):
    number: Optional[int] = None
    name: str
    university: Optional[str] = ""
    dept_lab: Optional[str] = ""
    tier: Optional[str] = "T3"
    status: Optional[str] = "drafting"
    date_sent: Optional[_date] = None
    email: Optional[str] = ""
    research_angle: Optional[str] = ""
    notes: Optional[str] = ""
    priority: Optional[int] = 0
    profile_url: Optional[str] = ""
    research_interests: Optional[str] = ""
    research_category: Optional[str] = ""


class ProfessorCreate(ProfessorBase):
    pass


class ProfessorUpdate(BaseModel):
    number: Optional[int] = None
    name: Optional[str] = None
    university: Optional[str] = None
    dept_lab: Optional[str] = None
    tier: Optional[str] = None
    status: Optional[str] = None
    date_sent: Optional[_date] = None
    email: Optional[str] = None
    research_angle: Optional[str] = None
    notes: Optional[str] = None
    priority: Optional[int] = None
    profile_url: Optional[str] = None
    research_interests: Optional[str] = None
    research_category: Optional[str] = None


class ProfessorOut(ProfessorBase):
    id: int
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class FellowshipBase(BaseModel):
    name: str
    deadline: Optional[str] = ""
    amount: Optional[str] = ""
    eligibility: Optional[str] = ""
    status: Optional[str] = "pending"
    notes: Optional[str] = ""
    url: Optional[str] = ""


class FellowshipUpdate(BaseModel):
    name: Optional[str] = None
    deadline: Optional[str] = None
    amount: Optional[str] = None
    eligibility: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    url: Optional[str] = None


class FellowshipOut(FellowshipBase):
    id: int
    model_config = ConfigDict(from_attributes=True)


class ActivityBase(BaseModel):
    date: Optional[_date] = None
    action: str
    detail: Optional[str] = ""
    professor_id: Optional[int] = None


class ActivityOut(ActivityBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class DraftBase(BaseModel):
    professor_id: int
    subject: Optional[str] = ""
    body: Optional[str] = ""


class DraftUpdate(BaseModel):
    subject: Optional[str] = None
    body: Optional[str] = None


class DraftOut(DraftBase):
    id: int
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class DraftWithProfessor(DraftOut):
    professor_name: Optional[str] = ""
    professor_university: Optional[str] = ""
    professor_status: Optional[str] = ""
    professor_email: Optional[str] = ""
    professor_research_category: Optional[str] = ""


class Stats(BaseModel):
    total: int
    by_status: dict
    by_tier: dict
    by_university: dict
    sent_count: int
    reply_count: int
    response_rate: float
    interview_count: int
    offer_count: int
    pending_followups: int
