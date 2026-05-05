from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, Date, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from .database import Base


class Professor(Base):
    __tablename__ = "professors"

    id = Column(Integer, primary_key=True)
    number = Column(Integer, index=True)
    name = Column(String, nullable=False)
    university = Column(String, index=True)
    dept_lab = Column(String, default="")
    tier = Column(String, index=True, default="T3")
    status = Column(String, index=True, default="drafting")
    date_sent = Column(Date, nullable=True)
    email = Column(String, default="")
    research_angle = Column(String, default="")
    notes = Column(Text, default="")
    priority = Column(Integer, default=0)
    profile_url = Column(String, default="")
    research_interests = Column(Text, default="")
    research_category = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    activities = relationship(
        "Activity", back_populates="professor", cascade="all, delete-orphan"
    )
    drafts = relationship(
        "EmailDraft", back_populates="professor", cascade="all, delete-orphan"
    )


class EmailDraft(Base):
    __tablename__ = "email_drafts"

    id = Column(Integer, primary_key=True)
    professor_id = Column(Integer, ForeignKey("professors.id"), index=True, nullable=False)
    subject = Column(String, default="")
    body = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    professor = relationship("Professor", back_populates="drafts")


class Fellowship(Base):
    __tablename__ = "fellowships"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    deadline = Column(String, default="")
    amount = Column(String, default="")
    eligibility = Column(Text, default="")
    status = Column(String, default="pending")
    notes = Column(Text, default="")
    url = Column(String, default="")


class Activity(Base):
    __tablename__ = "activities"

    id = Column(Integer, primary_key=True)
    date = Column(Date, default=datetime.utcnow)
    action = Column(String, nullable=False)
    detail = Column(Text, default="")
    professor_id = Column(Integer, ForeignKey("professors.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    professor = relationship("Professor", back_populates="activities")
