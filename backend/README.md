# QA Automation System — Auto Inspector

Signal-driven autonomous QA. A signal comes in → system checks the site → reports what's broken.

---

## How it works

```
Signal arrives (review / monitoring / GitHub / any source)
        ↓
Check Knowledge Base — site crawled before?
        ↓ NO                    ↓ YES
Crawl entire site       Find affected page instantly
Build KB tree           No crawling needed
        ↓                       ↓
Go directly to affected page (Playwright)
Execute known flow (click, fill, submit)
        ↓
Take screenshot + grab page content
        ↓
Send to AI once — one-shot analysis
        ↓
Report: issue found / passed + summary
        ↓
KB updated with new errors found
```

---

## Stack

- **NestJS** — API server
- **Playwright** — real browser automation
- **Groq (llama-4)** — AI analysis (fast, free)
- **Knowledge Base** — JSON tree per site, saved to disk

---

## Setup

### 1. Install dependencies

```bash
cd backend
npm install
npx playwright install chromium
```

### 2. Environment variables

Create `backend/.env`:

```env
# Required — get free key at console.groq.com
GROQ_API_KEY=your_groq_key_here

# Optional — for Playwright docker mode
PLAYWRIGHT_WS_ENDPOINT=ws://localhost:3001
```

### 3. Run

```bash
# Terminal 1 — backend
cd backend
npm run start:dev

# Terminal 2 — frontend (optional)
cd frontend
npm run dev
```

Server runs at `http://localhost:3000`

---

## Signal API

### Send a signal

```
POST /signal
```

**Body:**

```json
{
  "site_url": "https://yoursite.com",
  "issue": "schedule meeting button failing",
  "page": "/booking",
  "source": "twitter_review",
  "severity": "high",
  "metadata": {}
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `site_url` | yes | Full URL of the site to check |
| `issue` | yes | What's broken in plain English |
| `page` | no | Exact page path — skips KB lookup if provided |
| `source` | no | Where signal came from (twitter, github, monitoring) |
| `severity` | no | high / medium / low |
| `metadata` | no | Any extra info |

**Response:**

```json
{
  "status": "passed",
  "site_url": "https://yoursite.com",
  "target_url": "https://yoursite.com/booking",
  "kb_used": true,
  "issue_found": false,
  "summary": "No visible errors found on /booking",
  "errors_found": []
}
```

---

## Knowledge Base API

### Build KB for a site (first time)

```
POST /signal/kb/build
```

```json
{ "site_url": "https://yoursite.com" }
```

Crawls the entire site with Playwright. Saves pages, elements, forms, flows, API calls to `kb/yoursite.com/tree.json`. Run this once per site. Signal endpoint auto-builds if KB doesn't exist.

---

### List all sites in KB

```
GET /signal/kb
```

```json
[
  {
    "site": "https://bharatmcp.com",
    "crawled_at": "2026-04-08T15:00:00.000Z",
    "page_count": 4,
    "flow_count": 1
  }
]
```

---

### Reset KB for a site

```
POST /signal/kb/reset
```

```json
{ "site_url": "https://yoursite.com" }
```

Deletes the KB. Next signal will rebuild it automatically.

---

## How to connect your signal source

Any system can send a signal. Just POST to `/signal`.

### From your friend's review system

```python
import requests

def send_qa_signal(issue_text, site_url):
    requests.post("http://your-qa-server:3000/signal", json={
        "site_url": site_url,
        "issue": issue_text,
        "source": "review_system",
        "severity": "high"
    })

# example — negative review detected
send_qa_signal("booking page not working", "https://bharatmcp.com")
```

### From GitHub webhook

```
Repo → Settings → Webhooks → Add webhook

Payload URL:  http://your-server:3000/signal
Content type: application/json
```

Send this body on push:

```json
{
  "site_url": "https://yoursite.com",
  "issue": "code pushed to main — run full QA",
  "source": "github",
  "severity": "medium"
}
```

### From monitoring system

```bash
# when error detected
curl -X POST http://your-qa-server:3000/signal \
  -H "Content-Type: application/json" \
  -d '{
    "site_url": "https://yoursite.com",
    "issue": "500 error on checkout",
    "page": "/checkout",
    "source": "monitoring",
    "severity": "high"
  }'
```

### From CI/CD (GitHub Actions)

Add to `.github/workflows/deploy.yml`:

```yaml
- name: Run QA after deploy
  run: |
    curl -X POST ${{ secrets.QA_SERVER_URL }}/signal \
      -H "Content-Type: application/json" \
      -d '{
        "site_url": "${{ secrets.SITE_URL }}",
        "issue": "full QA after deploy",
        "source": "github_actions",
        "severity": "high"
      }'
```

---

## Signal → page mapping

The system automatically maps your issue text to the right page:

| Issue contains | Goes to |
|----------------|---------|
| schedule / meeting / book / calendar | `/talk-with-us` or `/booking` |
| login / signin / auth | `/login` or `/auth` |
| signup / register | `/signup` or `/register` |
| payment / checkout | `/payment` or `/checkout` |
| contact | `/contact` or `/talk-with-us` |
| access | `/early-access` |

If no keyword matches — goes to first non-home page in KB.

---

## KB file structure

```
kb/
└── bharatmcp.com/
    ├── meta.json       ← site info, page count, crawled_at
    └── tree.json       ← full site map with pages, elements, forms, flows
```

`tree.json` example:

```json
{
  "site": "https://bharatmcp.com",
  "crawled_at": "2026-04-08T15:00:00.000Z",
  "pages": [
    {
      "url": "/talk-with-us",
      "title": "Bharat MCP",
      "elements": ["button|1", "button|2", ...],
      "forms": [{ "fields": ["name", "email", "company"], "action": "" }],
      "known_errors": ["Failed to schedule meeting"],
      "apis_called": ["POST /api/schedule"]
    }
  ],
  "api_endpoints": [
    { "method": "POST", "path": "/api/schedule", "last_status": "unknown" }
  ],
  "flows": [
    {
      "name": "schedule_meeting",
      "steps": ["select date", "select time", "click Continue", "fill form", "submit"]
    }
  ]
}
```

---

## Old jobs endpoint (still works)

```
POST /jobs/test.run
```

```json
{
  "startUrl": "https://yoursite.com",
  "userStory": "Check if the homepage loads correctly"
}
```

Returns WebSocket URL for live browser view.

---

## Deploy to Railway (24/7)

1. Push everything to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select your repo
4. Add environment variables:
   - `GROQ_API_KEY` = your key
5. Deploy

Your public URL: `https://your-app.railway.app/signal`

Point all signal sources to this URL.

---

## What's next — Phase 3

- AI reads your GitHub repo source code
- Finds the exact file and line causing the issue
- Writes a fix
- Opens a GitHub PR automatically
- Re-runs QA to confirm fix works