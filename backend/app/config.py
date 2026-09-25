from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=False)
    database_url: str
    neo4j_uri: str
    neo4j_user: str
    neo4j_password: str
    qdrant_url: str
    jwt_secret: str
    admin_email: str = "admin@example.com"
    admin_password: str = "AdminTitan!2026"
    admin_display_name: str = "System Admin"
    seed_user_one_email: str = "user.one@example.com"
    seed_user_one_password: str = "TitanUserOne!2026"
    seed_user_two_email: str = "user.two@example.com"
    seed_user_two_password: str = "TitanUserTwo!2026"
    google_api_key: str = ""
    gemini_chat_model: str = "gemini-3.6-flash"
    gemini_embedding_model: str = "models/gemini-embedding-001"
    gemini_temperature: float = 0.7
    cors_origins: str = "http://localhost:5173"


settings = Settings()
