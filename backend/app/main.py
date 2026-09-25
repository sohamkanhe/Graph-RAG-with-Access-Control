from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.orm import Session
from .config import settings
from .database import Base, engine, get_db
from .models import User
from pypdf import PdfReader
from .schemas import AuthResponse, DocumentUploadResponse, LoginRequest, RegisterRequest, SearchRequest, SearchResponse
from .security import create_token, current_user, hash_password, new_user_id, verify_password
from .services import AuthorizationGraph, RetrievalService

graph = AuthorizationGraph()
retrieval = RetrievalService()


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    graph.seed_documents()
    retrieval.seed_collection()
    yield
    graph.driver.close()


app = FastAPI(title="Secure Enterprise RAG API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins.split(","), allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


def auth_response(user: User) -> AuthResponse:
    return AuthResponse(access_token=create_token(user), user={"id": user.id, "email": user.email, "displayName": user.display_name})


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/auth/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    email = str(payload.email).lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    user = User(id=new_user_id(), email=email, password_hash=hash_password(payload.password), display_name=payload.display_name, tenant_id="acme")
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
    return {"id": user.id, "email": user.email, "displayName": user.display_name}


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


@app.post("/documents/upload", response_model=DocumentUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_document(file: UploadFile = File(...), user: User = Depends(current_user)):
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
        title = Path(file.filename or "Untitled document.pdf").stem
        document_id = graph.create_owned_document(user.id, user.tenant_id, title)
        retrieval.index_document(document_id, title, user.tenant_id, chunks)
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error))
    return {"document_id": document_id, "title": title, "chunk_count": len(chunks)}


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
