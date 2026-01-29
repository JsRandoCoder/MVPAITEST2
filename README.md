# README.md
## ARA on Cloudflare (Free) — no localhost, no bash

This repo runs fully on Cloudflare as **one Worker**:
- Serves a tiny UI at `/`
- Exposes API under `/api/*`
- Uses **D1** for durable task state + event log (source of truth)
- Uses a **Durable Object** for retries + DLQ-like `dead` status

Deploy (Dashboard only):
1) Put this repo on GitHub.
2) Create a D1 database (`ara_db`).
3) Create a Worker by importing the repo (Git integration).
4) Bind:
- D1: variable `DB`
- Durable Object: variable `SCHEDULER`, class `Scheduler`
5) Run `migrations/0001.sql` in the D1 Console.
6) Open the Worker URL → use the UI.

Optional paid model:
- Set `OPENAI_API_KEY` (secret)
- Optional `OPENAI_MODEL` (default `gpt-4o-mini`)

Endpoints:
- GET /
- GET /api/health
- POST /api/tasks { "prompt": "..." }
- GET /api/tasks/:id
- POST /api/tasks/:id/cancel
- GET /api/tasks/:id/events (SSE)
