import json
from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.orm import Session
from .config import settings
from .database import Base, engine, get_db, migrate_users_table
from .models import User, ChatSession, ChatMessage
from pypdf import PdfReader
from .schemas import (
    AuthResponse,
    ChatMessageSchema,
    ChatSessionDetail,
    ChatSessionSummary,
    CreateChatSessionRequest,
    CreateDepartmentRequest,
    CreateRoleRequest,
    DepartmentSummary,
    DepartmentUpdateRequest,
    DocumentPermissionsRequest,
    DocumentSummary,
    DocumentUploadResponse,
    LoginRequest,
    RegisterRequest,
    RoleSummary,
    RoleUpdateRequest,
    SearchRequest,
    SearchResponse,
    SendMessageRequest,
    UserDetail,
    UserPermissionsRequest,
    UserSummary,
)
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
    graph.close()
    retrieval.close()


app = FastAPI(title="Secure Enterprise RAG API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins.split(","), allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


def auth_response(user: User) -> AuthResponse:
    return AuthResponse(access_token=create_token(user), user={"id": user.id, "email": user.email, "displayName": user.display_name, "isAdmin": user.is_admin})


@app.get("/health")
def health():
    return {
        "status": "ok",
        "redis": graph.is_redis_connected(),
    }


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


@app.get("/admin/users/{user_id}", response_model=UserDetail)
def admin_user_detail(user_id: str, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    target = db.get(User, user_id)
    if not target or target.tenant_id != admin.tenant_id:
        raise HTTPException(status_code=404, detail="User not found")
    details = graph.get_user_details(target.id, target.tenant_id)
    return {
        "id": target.id,
        "email": target.email,
        "display_name": target.display_name,
        "is_admin": target.is_admin,
        "departments": details.get("departments", []),
        "roles": details.get("roles", []),
        "direct_document_ids": details.get("direct_document_ids", []),
        "all_allowed_documents": details.get("all_allowed_documents", []),
    }


@app.post("/admin/users/{user_id}/permissions", response_model=UserDetail)
def admin_user_permissions(user_id: str, payload: UserPermissionsRequest, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    target = db.get(User, user_id)
    if not target or target.tenant_id != admin.tenant_id:
        raise HTTPException(status_code=404, detail="User not found")
    graph.update_user_permissions(target.id, target.tenant_id, payload.departments, payload.roles, payload.direct_document_ids)
    return admin_user_detail(user_id, admin, db)


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


@app.post("/admin/documents/{document_id}/permissions", response_model=DocumentSummary)
def set_document_permissions(document_id: str, payload: DocumentPermissionsRequest, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    emails = [str(email).lower() for email in payload.user_emails]
    users = db.scalars(select(User).where(User.email.in_(emails), User.tenant_id == admin.tenant_id, User.is_admin.is_(False))).all() if emails else []
    if len(users) != len(set(emails)):
        raise HTTPException(status_code=400, detail="Choose existing non-admin users only")
    user_entries = [{"id": u.id, "email": u.email} for u in users]
    if not graph.set_document_permissions(document_id, admin.tenant_id, user_entries, payload.departments, payload.roles):
        raise HTTPException(status_code=404, detail="Document not found")
    return next(item for item in graph.list_documents(admin.tenant_id) if item["id"] == document_id)


@app.get("/admin/departments", response_model=list[DepartmentSummary])
def admin_departments(admin: User = Depends(admin_user)):
    return graph.list_departments(admin.tenant_id)


@app.post("/admin/departments", response_model=DepartmentSummary, status_code=status.HTTP_201_CREATED)
def create_department(payload: CreateDepartmentRequest, admin: User = Depends(admin_user)):
    return graph.create_department(admin.tenant_id, payload.name)


@app.post("/admin/departments/{department_id}", response_model=DepartmentSummary)
def update_department(department_id: str, payload: DepartmentUpdateRequest, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    emails = [str(email).lower() for email in payload.user_emails]
    users = db.scalars(select(User).where(User.email.in_(emails), User.tenant_id == admin.tenant_id, User.is_admin.is_(False))).all() if emails else []
    if len(users) != len(set(emails)):
        raise HTTPException(status_code=400, detail="Choose existing non-admin users only")
    user_entries = [{"id": u.id, "email": u.email} for u in users]
    graph.set_department_members_and_docs(admin.tenant_id, department_id, user_entries, payload.document_ids)
    depts = graph.list_departments(admin.tenant_id)
    target = next((d for d in depts if d["id"] == department_id.lower()), None)
    if not target:
        raise HTTPException(status_code=404, detail="Department not found")
    return target


@app.delete("/admin/departments/{department_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_department(department_id: str, admin: User = Depends(admin_user)):
    graph.delete_department(admin.tenant_id, department_id)


@app.get("/admin/roles", response_model=list[RoleSummary])
def admin_roles(admin: User = Depends(admin_user)):
    return graph.list_roles(admin.tenant_id)


@app.post("/admin/roles", response_model=RoleSummary, status_code=status.HTTP_201_CREATED)
def create_role(payload: CreateRoleRequest, admin: User = Depends(admin_user)):
    return graph.create_role(admin.tenant_id, payload.name)


@app.post("/admin/roles/{role_id}", response_model=RoleSummary)
def update_role(role_id: str, payload: RoleUpdateRequest, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    emails = [str(email).lower() for email in payload.user_emails]
    users = db.scalars(select(User).where(User.email.in_(emails), User.tenant_id == admin.tenant_id, User.is_admin.is_(False))).all() if emails else []
    if len(users) != len(set(emails)):
        raise HTTPException(status_code=400, detail="Choose existing non-admin users only")
    user_entries = [{"id": u.id, "email": u.email} for u in users]
    graph.set_role_members_and_docs(admin.tenant_id, role_id, user_entries, payload.document_ids)
    roles = graph.list_roles(admin.tenant_id)
    target = next((r for r in roles if r["id"] == role_id.lower()), None)
    if not target:
        raise HTTPException(status_code=404, detail="Role not found")
    return target


@app.delete("/admin/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_role(role_id: str, admin: User = Depends(admin_user)):
    graph.delete_role(admin.tenant_id, role_id)


@app.post("/admin/reload-api-key")
def reload_api_key(payload: dict, _: User = Depends(admin_user)):
    """Hot-swap the Gemini API key without restarting the container.
    Send: {"api_key": "YOUR_NEW_KEY"}
    """
    new_key = str(payload.get("api_key", "")).strip()
    if not new_key:
        raise HTTPException(status_code=400, detail="api_key must not be empty")
    retrieval.reload_api_key(new_key)
    return {"status": "ok", "message": "Gemini API key reloaded successfully"}

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
    user_emails_str: str = Form(""),
    departments_str: str = Form(""),
    roles_str: str = Form(""),
    user: User = Depends(admin_user),
    db: Session = Depends(get_db),
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

    user_emails = [e.strip().lower() for e in user_emails_str.split(",") if e.strip()] if user_emails_str else []
    departments = [d.strip() for d in departments_str.split(",") if d.strip()] if departments_str else []
    roles = [r.strip() for r in roles_str.split(",") if r.strip()] if roles_str else []

    user_entries = []
    if user_emails:
        db_users = db.scalars(select(User).where(User.email.in_(user_emails), User.tenant_id == user.tenant_id, User.is_admin.is_(False))).all()
        user_entries = [{"id": u.id, "email": u.email} for u in db_users]

    try:
        title = document_name.strip() or Path(file.filename or "Untitled document.pdf").stem
        document_id = graph.create_admin_document(user.tenant_id, title, user_entries, departments, roles)
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
    if not allowed_ids:
        return {"answer": "No authorized documents matched this request.", "citations": [], "authorized_document_count": 0}

    try:
        chunks = retrieval.search(payload.query, user.tenant_id, allowed_ids)
        answer = retrieval.synthesize(payload.query, chunks)
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error))
    citations = [{"document_id": chunk["document_id"], "title": chunk["title"], "excerpt": chunk["text"][:240]} for chunk in chunks]
    return {"answer": answer, "citations": citations, "authorized_document_count": len(allowed_ids)}


@app.get("/chats", response_model=list[ChatSessionSummary])
def list_chats(user: User = Depends(current_user), db: Session = Depends(get_db)):
    sessions = db.scalars(
        select(ChatSession)
        .where(ChatSession.user_id == user.id)
        .order_by(ChatSession.updated_at.desc())
    ).all()
    return [
        ChatSessionSummary(
            id=s.id,
            title=s.title,
            created_at=s.created_at.isoformat() if s.created_at else None,
            updated_at=s.updated_at.isoformat() if s.updated_at else None,
        )
        for s in sessions
    ]


@app.post("/chats", response_model=ChatSessionSummary, status_code=status.HTTP_201_CREATED)
def create_chat(payload: CreateChatSessionRequest = CreateChatSessionRequest(), user: User = Depends(current_user), db: Session = Depends(get_db)):
    session = ChatSession(
        id=new_user_id(),
        user_id=user.id,
        tenant_id=user.tenant_id,
        title=payload.title.strip() or "New Chat",
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return ChatSessionSummary(
        id=session.id,
        title=session.title,
        created_at=session.created_at.isoformat() if session.created_at else None,
        updated_at=session.updated_at.isoformat() if session.updated_at else None,
    )


@app.get("/chats/{chat_id}", response_model=ChatSessionDetail)
def get_chat(chat_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    session = db.get(ChatSession, chat_id)
    if not session or session.user_id != user.id:
        raise HTTPException(status_code=404, detail="Chat not found")
    return ChatSessionDetail(
        id=session.id,
        title=session.title,
        created_at=session.created_at.isoformat() if session.created_at else None,
        updated_at=session.updated_at.isoformat() if session.updated_at else None,
        messages=[
            ChatMessageSchema(
                id=m.id,
                session_id=m.session_id,
                role=m.role,
                content=m.content,
                citations=m.citations or [],
                authorized_document_count=m.authorized_document_count,
                created_at=m.created_at.isoformat() if m.created_at else None,
            )
            for m in session.messages
        ],
    )


@app.delete("/chats/{chat_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_chat(chat_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    session = db.get(ChatSession, chat_id)
    if not session or session.user_id != user.id:
        raise HTTPException(status_code=404, detail="Chat not found")
    db.delete(session)
    db.commit()


@app.post("/chats/{chat_id}/messages")
def send_chat_message(chat_id: str, payload: SendMessageRequest, user: User = Depends(current_user), db: Session = Depends(get_db)):
    session = db.get(ChatSession, chat_id)
    if not session or session.user_id != user.id:
        raise HTTPException(status_code=404, detail="Chat not found")

    user_msg_content = payload.message.strip()

    # 1. Save user message to PostgreSQL
    user_msg = ChatMessage(
        id=new_user_id(),
        session_id=session.id,
        role="user",
        content=user_msg_content,
    )
    db.add(user_msg)

    if session.title == "New Chat":
        session.title = user_msg_content[:40].strip() + ("..." if len(user_msg_content) > 40 else "")

    # 2. Graph Authorization check via Neo4j / Redis
    allowed_ids = graph.allowed_documents(user.id, user.tenant_id)
    citations = []

    if not allowed_ids:
        answer = "No authorized documents matched this request."
    else:
        try:
            chunks = retrieval.search(user_msg_content, user.tenant_id, allowed_ids)
            answer = retrieval.synthesize(user_msg_content, chunks)
            citations = [{"document_id": chunk["document_id"], "title": chunk["title"], "excerpt": chunk["text"][:240]} for chunk in chunks]
        except RuntimeError as error:
            raise HTTPException(status_code=503, detail=str(error))

    # 3. Save assistant message to PostgreSQL
    assistant_msg = ChatMessage(
        id=new_user_id(),
        session_id=session.id,
        role="assistant",
        content=answer,
        citations=citations,
        authorized_document_count=len(allowed_ids),
    )
    db.add(assistant_msg)
    db.commit()
    db.refresh(user_msg)
    db.refresh(assistant_msg)

    return {
        "user_message": {
            "id": user_msg.id,
            "session_id": session.id,
            "role": user_msg.role,
            "content": user_msg.content,
            "created_at": user_msg.created_at.isoformat() if user_msg.created_at else None,
        },
        "assistant_message": {
            "id": assistant_msg.id,
            "session_id": session.id,
            "role": assistant_msg.role,
            "content": assistant_msg.content,
            "citations": assistant_msg.citations or [],
            "authorized_document_count": assistant_msg.authorized_document_count,
            "created_at": assistant_msg.created_at.isoformat() if assistant_msg.created_at else None,
        },
        "chat_title": session.title,
    }
