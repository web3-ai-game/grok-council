# grok-council

自架的 Grok 客戶端。金鑰是你自己的 xAI key，只放在伺服器。手機和 Mac 用 Chrome 裝成 PWA。

Self-hosted Grok client. You bring an xAI API key. The server holds it. Phone and Mac install it as a Chrome PWA.

這是脫敏後的公開匯出。部署筆記、原點位址和正式資料庫不在這棵樹裡。

This is a sanitized public export. Deploy notes, origin addresses, and the production database are not in this tree.

## 兩條 Heavy

同一個輸入框後面有兩條路。

Two paths sit behind the same box.

| 引擎 | 你看得到什麼 |
|---|---|
| 官方多智能體直通 | `grok-4.20-multi-agent-0309`。只看得到議長輸出。Official multi-agent passthrough. Leader output only. |
| 自研專家議會 | 門控選專家，平行作答，議長合成。每位專家的推理都看得到。In-house council. The gate picks experts, they answer in parallel, a chair synthesizes. Every expert's reasoning is visible. |

八個席位：分析師、情報官、工程師、紅隊、策略家、表達者、量化員、議長。門控不必每次叫醒全部八位。前端用卡片矩陣即時顯示。程式在 `backend/app/orchestrator` 和 `frontend/src/components`。

Eight seats: analyst, intel, engineer, red team, strategist, writer, quant, chair. The gate does not have to wake all eight. The UI is a live card grid. Code lives in `backend/app/orchestrator` and `frontend/src/components`.

同一個客戶端還有 Auto、Fast、Expert、Heavy、網頁搜尋、推理摘要、圖像與影片、專案、自訂代理、跨會話記憶、排程、引用和語音。花費從每次回應的 cost tick 入帳，再按日、模型和使用者切開。

The same client also has Auto, Fast, Expert, Heavy, web search, a reasoning summary, image and video, projects, custom agents, cross-session memory, scheduled tasks, citations, and voice. Spend is booked from the cost tick on each response, then sliced by day, model, and user.

## 本地執行

需要 Python 3.11 以上、Node 18 以上，以及一把 xAI API key。

Needs Python 3.11+, Node 18+, and an xAI API key.

```bash
cp .env.example .env
# 編輯 .env，填 XAI_API_KEY。Edit .env and set XAI_API_KEY.

cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8800
```

另開一個終端機。In another terminal:

```bash
cd frontend
npm install
npm run dev
```

打開 `http://localhost:5173`，註冊第一個帳號。

Open `http://localhost:5173` and register the first account.

## 目錄

```
backend/app/
  xai/            xAI 客戶端、模型表、定價。Client, model registry, pricing.
  orchestrator/   門控、平行作答、合成。Gate, fan-out, synthesis.
  api/            路由。Routes.
  store/          SQLite
frontend/src/
  routes/         對話、創作、專案、任務、設定。Chat, create, projects, tasks, settings.
  components/     議會面板。Council panel.
  lib/            API 與 SSE。API and SSE.
```

技術棧：FastAPI、httpx、SQLite WAL、React 18、TypeScript、Vite、Tailwind。串流走 SSE。這個規模刻意不用 Redis、Celery、Postgres。

Stack: FastAPI, httpx, SQLite WAL, React 18, TypeScript, Vite, Tailwind. Streaming is SSE. This size of install does not need Redis, Celery, or Postgres.

## 狀態

正式環境以 PWA 安裝在手機和 Mac 上。這個公開樹不含 nginx、systemd 和主機位址。

The production install is a PWA on phone and Mac. This public tree does not include nginx, systemd, or the host address.

## 授權

未另附授權檔。看原始碼可以，拿去商用前先來信。

No license file is attached. Reading the source is fine. Ask before commercial use.

聯絡：one@oece-x.com
