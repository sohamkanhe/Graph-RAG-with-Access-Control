from datetime import datetime
from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column
from .database import Base


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(120))
    tenant_id: Mapped[str] = mapped_column(String(80), index=True, default="acme")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
