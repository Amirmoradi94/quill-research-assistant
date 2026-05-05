import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

DB_PATH = os.environ.get("POSTDOC_DB", "/app/data/postdoc.db")
DB_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(DB_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
