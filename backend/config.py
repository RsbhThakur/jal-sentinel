import os
from typing import Optional
from pydantic import Field

try:
    from pydantic_settings import BaseSettings, SettingsConfigDict
    
    class Settings(BaseSettings):
        model_config = SettingsConfigDict(
            env_file=".env",
            env_file_encoding="utf-8",
            extra="ignore"
        )
        
        # Application
        app_name: str = "JAL-SENTINEL API"
        app_version: str = "1.0.0"
        environment: str = Field(default="development", alias="ENVIRONMENT")
        admin_token: str = Field(default="sentinel_admin_secret_token_2026", alias="ADMIN_TOKEN")
        
        # Database & Cache
        database_url: str = Field(
            default="sqlite+aiosqlite:///./jal_sentinel.db",
            alias="DATABASE_URL"
        )
        redis_url: str = Field(default="redis://localhost:6379/0", alias="REDIS_URL")
        
        # External Integrations
        google_maps_api_key: Optional[str] = Field(default=None, alias="GOOGLE_MAPS_API_KEY")
        fast2sms_api_key: Optional[str] = Field(default=None, alias="FAST2SMS_API_KEY")
        imd_api_base_url: str = Field(default="https://api.imd.gov.in", alias="IMD_API_BASE_URL")

except ImportError:
    # Graceful fallback if pydantic-settings is not directly installed
    from pydantic import BaseModel
    
    class Settings(BaseModel):
        app_name: str = "JAL-SENTINEL API"
        app_version: str = "1.0.0"
        environment: str = os.getenv("ENVIRONMENT", "development")
        admin_token: str = os.getenv("ADMIN_TOKEN", "sentinel_admin_secret_token_2026")
        database_url: str = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./jal_sentinel.db")
        redis_url: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
        google_maps_api_key: Optional[str] = os.getenv("GOOGLE_MAPS_API_KEY", None)
        fast2sms_api_key: Optional[str] = os.getenv("FAST2SMS_API_KEY", None)
        imd_api_base_url: str = os.getenv("IMD_API_BASE_URL", "https://api.imd.gov.in")

settings = Settings()
