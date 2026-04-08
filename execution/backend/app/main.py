"""
AutoPM Backend — FastAPI Application Entry Point
Autonomous Code Review & Product Intelligence System
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

load_dotenv()

app = FastAPI(
    title="AutoPM — Autonomous Code Review Engine",
    description="AI-powered code generation, review, and GitHub integration",
    version="1.0.0",
)

# Allow CORS for VS Code extension and frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Import and register routes
from app.routes.generate import router as generate_router
from app.routes.review import router as review_router
from app.routes.github_route import router as github_router
from app.routes.pr_analysis import router as pr_analysis_router

app.include_router(generate_router, prefix="/api", tags=["Code Generation"])
app.include_router(review_router, prefix="/api", tags=["Code Review"])
app.include_router(github_router, prefix="/api", tags=["GitHub Integration"])
app.include_router(pr_analysis_router, prefix="/api", tags=["PR Analysis"])


@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    gemini_key = bool(os.getenv("GEMINI_API_KEY"))
    github_token = bool(os.getenv("GITHUB_TOKEN"))
    return {
        "status": "healthy",
        "service": "AutoPM Code Engine",
        "config": {
            "gemini_configured": gemini_key,
            "github_configured": github_token,
        },
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
