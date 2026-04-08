# 🚀 AutoPM — Autonomous Code Review & Product Intelligence System

> An AI system that doesn't just review code — it decides what to build, writes it, reviews it, deploys it, and learns from user feedback.

## 📂 Project Structure

```
hackathon/
├── backend/                    # FastAPI + Gemini AI backend
│   ├── app/
│   │   ├── main.py             # FastAPI entry point
│   │   ├── routes/
│   │   │   ├── generate.py     # POST /api/generate-code
│   │   │   ├── review.py       # POST /api/review-code
│   │   │   └── github_route.py # POST /api/push-to-github + /api/pipeline
│   │   ├── services/
│   │   │   ├── ai_service.py   # Gemini API integration
│   │   │   ├── review_engine.py # Review orchestration
│   │   │   └── github_service.py # GitHub API automation
│   │   └── models/
│   │       └── schemas.py      # Pydantic request/response models
│   ├── requirements.txt
│   └── .env                    # API keys (not committed)
│
└── vscode-extension/           # VS Code extension
    ├── src/extension.ts        # Extension source
    ├── package.json            # Extension manifest
    └── tsconfig.json
```

## 🚀 Quick Start

### 1. Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure API Keys

Edit `backend/.env`:
```
GEMINI_API_KEY=your-actual-gemini-key
GEMINI_MODEL=gemini-2.5-flash
OLLAMA_FALLBACK_ENABLED=true
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5-coder:7b
AI_TIMEOUT_SECONDS=120
GITHUB_TOKEN=your-github-pat
GITHUB_OWNER=your-username
GITHUB_REPO=your-repo
```

Optional (recommended for quota spikes): install Ollama and pull the fallback model.
```bash
ollama pull qwen2.5-coder:7b
```
When Gemini returns 429/quota errors, AutoPM will fallback to Ollama automatically.

### 3. Run Backend

```bash
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API docs at: http://localhost:8000/docs

### 4. VS Code Extension

```bash
cd vscode-extension
npm install
npm run compile
```

Then press `F5` in VS Code to launch the extension in debug mode.

## ✅ Automated Testing

Run everything from the repo root:

```bash
./test.sh
```

What it does:
- Runs backend tests with `pytest` (`backend/tests`)
- Runs VS Code extension tests with `npm test` (`@vscode/test-electron`)

If your environment is headless or cannot launch the VS Code test host, backend tests will still run locally, and extension tests should be run on a machine that can execute the VS Code binary.

## 📡 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/generate-code` | POST | Generate code from issue |
| `/api/review-code` | POST | AI code review |
| `/api/push-to-github` | POST | Push code + create PR |
| `/api/pipeline` | POST | Full pipeline: generate → review → push |

## 🎬 VS Code Commands

- **AutoPM: Review This File** — Right-click or Cmd+Shift+P
- **AutoPM: Review Selected Code** — Select code → right-click
- **AutoPM: Generate Fix from Issue** — Describe a bug, get a fix
- **AutoPM: Push to GitHub** — Auto-create branch + PR
- **AutoPM: Run Full Pipeline** — End-to-end automation

## 👥 Team

- **Aashmit** — Signal Engine (data collection)
- **Dipam** — Backend Pipeline (orchestration)
- **Ankit** — Code Gen + Review + GitHub (core AI engine)
- **Harsh** — Frontend + Demo
