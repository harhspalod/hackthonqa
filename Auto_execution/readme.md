# Autopm — AI Code Review Assistant

An enterprise-grade AI-powered code review system that automatically analyzes GitHub pull requests, identifies bugs, security vulnerabilities, code smells, and architectural violations — then posts inline comments and auto-fixes the issues directly on the PR.

## How it works

When a PR is opened or updated on GitHub, the system:

1. Receives the webhook event
2. Fetches the full diff from GitHub
3. Runs 4 AI workers in parallel (bug, security, smell, architecture)
4. Aggregates and ranks findings by severity
5. Posts a detailed review comment on the PR
6. Auto-fixes the issues and pushes the fixes back to the branch

It also accepts issue reports from external sources like Reddit, Slack, or monitoring tools via a QA JSON endpoint.

---

## Architecture

```
GitHub PR / QA JSON
        ↓
  github-bridge        — receives events, fetches diff
        ↓
  triage-service       — dedup, rate limit, severity routing
        ↓
  analysis-workers     — 4 parallel AI workers (Groq/llama-3.3-70b)
        ↓
  aggregator           — merge, rank, filter low confidence
        ↓
  comment-writer       — post comment + auto-fix + push
```

All services communicate via Redis queues (BullMQ).

---

## Services

| Service | Port | Description |
|---|---|---|
| `github-bridge` | 3001 | Webhook receiver, GitHub API client |
| `triage-service` | — | Queue worker, severity routing |
| `analysis-workers` | — | AI analysis via Groq |
| `aggregator` | — | Finding dedup and ranking |
| `comment-writer` | — | GitHub commenter + auto-fixer |

---

## What it detects

- **Bugs** — logic errors, null dereferences, off-by-one, unhandled errors
- **Security** — SQL injection, XSS, CSRF, hardcoded secrets, eval usage, insecure APIs
- **Code smells** — complexity, duplication, magic numbers, dead code
- **Architecture** — circular deps, layer violations, tight coupling

---

## Prerequisites

- Node.js 18+
- pnpm
- Redis 6+
- Groq API key (free at console.groq.com)
- GitHub personal access token (repo scope)

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/autopm
cd autopm
pnpm install
```

### 2. Environment variables

**`packages/github-bridge/.env`**
```
GITHUB_WEBHOOK_SECRET=your_webhook_secret
QA_WEBHOOK_API_KEY=your_qa_api_key
PORT=3001
GITHUB_TOKEN=ghp_your_token_here
```

**`packages/analysis-workers/.env`**
```
GROK_API_KEY=gsk_your_groq_key_here
REDIS_HOST=localhost
REDIS_PORT=6379
```

**`packages/comment-writer/.env`**
```
GITHUB_TOKEN=ghp_your_token_here
GROQ_API_KEY=gsk_your_groq_key_here
REDIS_HOST=localhost
REDIS_PORT=6379
```

**`packages/triage-service/.env`** and **`packages/aggregator/.env`**
```
REDIS_HOST=localhost
REDIS_PORT=6379
```

### 3. Start Redis

```bash
redis-server --daemonize yes
```

### 4. Run all services

Open 5 terminals:

```bash
pnpm dev:bridge       # terminal 1
pnpm dev:triage       # terminal 2
pnpm dev:analysis     # terminal 3
pnpm dev:aggregator   # terminal 4
pnpm dev:commenter    # terminal 5
```

### 5. Expose to internet

```bash
cloudflared tunnel --url http://localhost:3001
```

Copy the `https://` URL it gives you.

### 6. Register GitHub webhook

Go to your repo → **Settings** → **Webhooks** → **Add webhook**:

- Payload URL: `https://your-tunnel-url.trycloudflare.com/webhook/github`
- Content type: `application/json`
- Secret: same as `GITHUB_WEBHOOK_SECRET` in your `.env`
- Events: **Pull requests**

---

## Usage

### Automatic PR review

Just open a pull request on any repo with the webhook registered. Autopm will automatically:
- Analyze the diff
- Post a comment with all findings
- Push auto-fixes to the branch

### Manual QA signal

Send an issue report from any source:

```bash
curl -X POST http://localhost:3001/webhook/qa \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_qa_api_key" \
  -d '{
    "timestamp": "2026-04-09T00:00:00.000Z",
    "issue": "SQL injection found in login endpoint",
    "source": "reddit",
    "severity": "high",
    "reason": "User input passed directly to query",
    "target_url": "https://github.com/owner/repo/pull/1"
  }'
```

---

## File structure

```
packages/
  github-bridge/        Step 1 — webhook receiver + GitHub API client
    src/
      index.ts          Express entry point
      webhook.ts        GitHub + QA webhook routes
      normalizer.ts     Any payload → ReviewEvent schema
      github-client.ts  Fetch tree / diff / blame
      queue.ts          BullMQ enqueue

  triage-service/       Step 2 — dedup + severity routing
    src/
      index.ts          Worker entry
      queue.ts          Redis + BullMQ setup
      dedup.ts          SHA fingerprint deduplication
      severity.ts       Pattern-based severity rules
      rate-limiter.ts   Per-repo rate cap

  analysis-workers/     Step 3 — parallel AI analysis
    src/
      index.ts          Worker pool (4 parallel)
    prompts/
      bug.md            Bug detection prompt
      security.md       Security scan prompt
      smell.md          Code smell prompt
      arch.md           Architecture check prompt

  aggregator/           Step 4 — merge + rank findings
    src/
      index.ts          Collector worker
      merge.ts          Dedup + severity ranking
      confidence.ts     Low confidence filter

  comment-writer/       Step 5 — post comment + auto-fix
    src/
      index.ts          Consumer worker
      github-commenter.ts  PR review API calls
      formatter.ts      Markdown formatting
      auto-fixer.ts     AI rewrite + git push
```

---

## Severity levels

| Level | Description |
|---|---|
| `critical` | Security vulnerabilities, production-breaking bugs |
| `high` | SQL injection, XSS, hardcoded secrets, eval usage |
| `medium` | Race conditions, missing validation, code smells |
| `low` | Style issues, minor improvements |

---

## AI model

Uses **Groq** with `llama-3.3-70b-versatile` — fast, free tier available, OpenAI-compatible API.

To switch models update `packages/analysis-workers/src/index.ts`:
```typescript
model: "llama-3.3-70b-versatile"  // change this
```

Supported Groq models: `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `mixtral-8x7b-32768`

---

## Adding a new source

The system accepts events from any source via the QA endpoint. Supported `source` values:
- `reddit`
- `slack`  
- `monitoring`
- `github_issue`
- `qa_json`

Just POST to `/webhook/qa` with the required fields: `issue`, `severity`, `source`, `timestamp`.

---

## License

MIT