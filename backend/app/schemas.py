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
