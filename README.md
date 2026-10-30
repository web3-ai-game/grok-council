# Grok Council

Self-hosted Grok client. You bring an xAI API key. The server holds the key. Phone and Mac install it as a Chrome PWA.

This is a public export. Deploy notes, origin addresses, and the production database are not in this tree.

## Two Heavy engines

| Engine | What you see |
|---|---|
| Official multi-agent passthrough | `grok-4.20-multi-agent-0309`. Leader output only. |
| In-house MoE council | Gate picks experts, they answer in parallel, a chair synthesizes. Every expert's reasoning is visible. |

Eight seats: analyst, intel, engineer, red team, strategist, writer, quant, chair. The frontend renders them as a live card grid (`frontend/src/components`, `backend/app/orchestrator`).

Also in the client: Auto / Fast / Expert / Heavy, web search, reasoning summary, image and video, projects, custom agents, cross-session memory, scheduled tasks, citations, and voice. Spend is booked from the cost tick on each response.

## Run locally

Needs Python 3.11+, Node 18+, and an xAI API key.

```bash
cp .env.example .env   # set XAI_API_KEY

cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8800

# other terminal
cd frontend && npm install && npm run dev
```

Open `http://localhost:5173` and register the first account.

## Layout

```
backend/app/
  xai/            xAI client, model registry, pricing
  orchestrator/   council gate, fan-out, synthesis
  api/            routes
  store/          SQLite
frontend/src/
  routes/         chat, create, projects, tasks, settings
  components/     council panel
  lib/            api and SSE
```

Stack: FastAPI, httpx, SQLite WAL, React 18, TypeScript, Vite, Tailwind. Streaming is SSE.
