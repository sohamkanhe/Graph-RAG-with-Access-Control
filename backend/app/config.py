from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=False)
    database_url: str
    neo4j_uri: str
    neo4j_user: str
    neo4j_password: str
    qdrant_url: str
    jwt_secret: str
    google_api_key: str = ""
    gemini_chat_model: str = "gemini-3.6-flash"
    gemini_embedding_model: str = "models/gemini-embedding-001"
    gemini_temperature: float = 0.7
    cors_origins: str = "http://localhost:5173"


settings = Settings()
