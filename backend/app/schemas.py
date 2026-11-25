from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    display_name: str = Field(min_length=2, max_length=120)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class AuthResponse(BaseModel):
    access_token: str
    user: dict


class UserSummary(BaseModel):
    id: str
    email: str
    display_name: str
    is_admin: bool


class DocumentSummary(BaseModel):
    id: str
    title: str = "Untitled Document"
    user_emails: list[str] = []
    departments: list[str] = []
    roles: list[str] = []


class DocumentPermissionsRequest(BaseModel):
    user_emails: list[EmailStr] = []
    departments: list[str] = []
    roles: list[str] = []


class UserDetail(BaseModel):
    id: str
    email: str
    display_name: str
    is_admin: bool
    departments: list[str] = []
    roles: list[str] = []
    direct_document_ids: list[str] = []
    all_allowed_documents: list[dict] = []


class UserPermissionsRequest(BaseModel):
    departments: list[str] = []
    roles: list[str] = []
    direct_document_ids: list[str] = []


class DepartmentSummary(BaseModel):
    id: str
    name: str
    user_emails: list[str] = []
    document_ids: list[str] = []


class CreateDepartmentRequest(BaseModel):
    name: str = Field(min_length=2, max_length=60)


class DepartmentUpdateRequest(BaseModel):
    user_emails: list[EmailStr] = []
    document_ids: list[str] = []


class RoleSummary(BaseModel):
    id: str
    name: str
    user_emails: list[str] = []
    document_ids: list[str] = []


class CreateRoleRequest(BaseModel):
    name: str = Field(min_length=2, max_length=60)


class RoleUpdateRequest(BaseModel):
    user_emails: list[EmailStr] = []
    document_ids: list[str] = []


class SearchRequest(BaseModel):
    query: str = Field(min_length=3, max_length=1000)


class Citation(BaseModel):
    document_id: str
    title: str
    excerpt: str


class SearchResponse(BaseModel):
    answer: str
    citations: list[Citation]
    authorized_document_count: int


class DocumentUploadResponse(BaseModel):
    document_id: str
    title: str
    chunk_count: int


class ChatMessageSchema(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    citations: list[dict] | None = None
    authorized_document_count: int = 0
    created_at: str | None = None


class ChatSessionSummary(BaseModel):
    id: str
    title: str
    created_at: str | None = None
    updated_at: str | None = None


class ChatSessionDetail(BaseModel):
    id: str
    title: str
    created_at: str | None = None
    updated_at: str | None = None
    messages: list[ChatMessageSchema] = []


class CreateChatSessionRequest(BaseModel):
    title: str = "New Chat"


class SendMessageRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
