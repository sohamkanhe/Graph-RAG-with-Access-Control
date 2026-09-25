from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.orm import Session
from .config import settings
from .database import Base, engine, get_db, migrate_users_table
from .models import User
from pypdf import PdfReader
from .schemas import AuthResponse, DocumentSummary, DocumentUploadResponse, DocumentUsersRequest, LoginRequest, RegisterRequest, SearchRequest, SearchResponse, UserSummary
from .security import admin_user, create_token, current_user, hash_password, new_user_id, verify_password
from .services import AuthorizationGraph, RetrievalService

graph = AuthorizationGraph()
retrieval = RetrievalService()


@asynccontextmanager
async def lifespan(_: FastAPI):
    migrate_users_table()
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        admin = db.scalar(select(User).where(User.email == settings.admin_email.lower()))
        if not admin:
            admin = User(id=new_user_id(), email=settings.admin_email.lower(), password_hash=hash_password(settings.admin_password), display_name=settings.admin_display_name, tenant_id="acme", is_admin=True)
            db.add(admin)
            db.commit()
        elif not admin.is_admin:
            admin.is_admin = True
            db.commit()
        graph.provision_user(admin.id, admin.tenant_id)
        for email, password, display_name in [
            (settings.seed_user_one_email, settings.seed_user_one_password, "User One"),
            (settings.seed_user_two_email, settings.seed_user_two_password, "User Two"),
        ]:
            if not db.scalar(select(User).where(User.email == email.lower())):
                db.add(User(id=new_user_id(), email=email.lower(), password_hash=hash_password(password), display_name=display_name, tenant_id="acme", is_admin=False))
        db.commit()
    yield
    graph.driver.close()


app = FastAPI(title="Secure Enterprise RAG API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins.split(","), allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


def auth_response(user: User) -> AuthResponse:
    return AuthResponse(access_token=create_token(user), user={"id": user.id, "email": user.email, "displayName": user.display_name, "isAdmin": user.is_admin})


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/auth/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    email = str(payload.email).lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    user = User(id=new_user_id(), email=email, password_hash=hash_password(payload.password), display_name=payload.display_name, tenant_id="acme", is_admin=False)
    db.add(user)
    db.commit()
    graph.provision_user(user.id, user.tenant_id)
    return auth_response(user)


@app.post("/auth/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == str(payload.email).lower()))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    return auth_response(user)


@app.get("/auth/me")
def me(user: User = Depends(current_user)):
    return {"id": user.id, "email": user.email, "displayName": user.display_name, "isAdmin": user.is_admin}


@app.get("/admin/users", response_model=list[UserSummary])
def admin_users(_: User = Depends(admin_user), db: Session = Depends(get_db)):
    return db.scalars(select(User).order_by(User.email)).all()


@app.delete("/admin/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: str, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    target = db.get(User, user_id)
    if not target or target.tenant_id != admin.tenant_id or target.is_admin:
        raise HTTPException(status_code=400, detail="Only non-admin users in your tenant can be deleted")
    graph.delete_user(target.id, target.tenant_id)
    db.delete(target)
    db.commit()


@app.get("/admin/documents", response_model=list[DocumentSummary])
def admin_documents(admin: User = Depends(admin_user)):
    return graph.list_documents(admin.tenant_id)


@app.delete("/admin/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(document_id: str, admin: User = Depends(admin_user)):
    if not graph.delete_document(document_id, admin.tenant_id):
        raise HTTPException(status_code=404, detail="Document not found")


@app.post("/admin/documents/{document_id}/users", response_model=DocumentSummary)
def set_document_users(document_id: str, payload: DocumentUsersRequest, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    emails = [str(email).lower() for email in payload.user_emails]
    users = db.scalars(select(User).where(User.email.in_(emails), User.tenant_id == admin.tenant_id, User.is_admin.is_(False))).all()
    if len(users) != len(set(emails)):
        raise HTTPException(status_code=400, detail="Choose existing non-admin users only")
    if not graph.set_document_users(document_id, admin.tenant_id, [{"id": item.id, "email": item.email} for item in users]):
        raise HTTPException(status_code=404, detail="Document not found")
    return next(item for item in graph.list_documents(admin.tenant_id) if item["id"] == document_id)


def chunk_text(text: str, size: int = 1200, overlap: int = 200) -> list[str]:
    normalized = " ".join(text.split())
    if not normalized:
        return []
    chunks, start = [], 0
    while start < len(normalized):
        end = min(len(normalized), start + size)
        if end < len(normalized):
            boundary = normalized.rfind(". ", start, end)
            if boundary > start + size // 2:
                end = boundary + 1
        chunks.append(normalized[start:end])
        start = end - overlap if end < len(normalized) else end
    return chunks


@app.post("/admin/documents/upload", response_model=DocumentUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile = File(...),
    document_name: str = Form(""),
    user: User = Depends(admin_user),
):
    if Path(file.filename or "").suffix.lower() != ".pdf":
        raise HTTPException(status_code=415, detail="Only PDF documents are supported")
    raw = await file.read()
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="PDF must be 20 MB or smaller")
    try:
        text = "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(raw)).pages)
    except Exception:
        raise HTTPException(status_code=422, detail="The PDF could not be read")
    chunks = chunk_text(text)
    if not chunks:
        raise HTTPException(status_code=422, detail="No extractable text was found in this PDF")
    try:
        title = document_name.strip() or Path(file.filename or "Untitled document.pdf").stem
        document_id = graph.create_admin_document(user.tenant_id, title, [], [], [])
        retrieval.index_document(document_id, title, user.tenant_id, chunks)
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error))
    return {"document_id": document_id, "title": title, "chunk_count": len(chunks)}


@app.post("/documents/upload", status_code=status.HTTP_403_FORBIDDEN)
def user_upload_disabled(_: User = Depends(current_user)):
    raise HTTPException(status_code=403, detail="Only administrators can upload documents")


@app.post("/search", response_model=SearchResponse)
def search(payload: SearchRequest, user: User = Depends(current_user)):
    allowed_ids = graph.allowed_documents(user.id, user.tenant_id)
    try:
        chunks = retrieval.search(payload.query, user.tenant_id, allowed_ids)
        answer = retrieval.synthesize(payload.query, chunks)
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error))
    citations = [{"document_id": chunk["document_id"], "title": chunk["title"], "excerpt": chunk["text"][:240]} for chunk in chunks]
    return {"answer": answer, "citations": citations, "authorized_document_count": len(allowed_ids)}
