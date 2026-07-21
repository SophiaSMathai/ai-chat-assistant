# Nova — AI Chat Assistant

A minimalist, ChatGPT/Claude-inspired chat assistant built for a mentorship project.

- **Backend:** FastAPI (Python 3.11+) wrapping the `google-genai` SDK, talking to `gemini-2.5-flash`.
- **Frontend:** Vanilla HTML/CSS/JS single-page app — no framework, no build step.
- **Session memory:** Per-session, in-memory multi-turn conversation history via `client.chats`.

```
ai-chat-assistant/
├── backend/
│   ├── main.py              # FastAPI app, routes, CORS
│   ├── config.py            # Pydantic Settings (env vars)
│   ├── services/
│   │   └── gemini.py        # Gemini client + chat session management
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── .env.example
├── .gitignore
└── README.md
```

---

## 1. Local setup

### 1.1 Backend

```bash
cd ai-chat-assistant
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

pip install -r backend/requirements.txt
```

Create your local `.env` file **at the repo root** (same folder as this README):

```bash
cp .env.example .env
```

Open `.env` and paste in your real key:

```
GEMINI_API_KEY=AIza...your-real-key...
GEMINI_MODEL=gemini-2.5-flash
ALLOWED_ORIGINS=http://localhost:5500,http://127.0.0.1:5500
```

Get a key from [Google AI Studio](https://aistudio.google.com/apikey) if you don't have one yet.

`.env` is already listed in `.gitignore`, so it will never be committed. Only `.env.example` (with placeholder values) is tracked in git.

Run the API:

```bash
uvicorn backend.main:app --reload --port 8000
```

Check it's alive: open `http://localhost:8000/api/health` — you should see `{"status": "ok", ...}`.

### 1.2 Frontend

The frontend is static, so any local server works. Simplest option — VS Code's "Live Server" extension, or:

```bash
cd frontend
python3 -m http.server 5500
```

Open `http://localhost:5500`. If your backend runs on a different host/port than `http://localhost:8000`, set it before `app.js` loads by adding this line above the `<script src="app.js">` tag in `index.html`:

```html
<script>window.NOVA_API_BASE_URL = "http://localhost:8000";</script>
```

---

## 2. GitHub repository setup

Run these from the `ai-chat-assistant/` root:

```bash
git init
git add .
git status                     # sanity check: .env should NOT appear here
git commit -m "Initial commit: Nova AI chat assistant"
git branch -M main
```

Create an empty repository on GitHub (no README/license, so it stays empty), then:

```bash
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

> Double-check `git status` before your first commit — if `.env` shows up as untracked-but-about-to-be-added, stop and confirm `.gitignore` is in place first.

---

## 3. Deploying the backend (Render)

1. Go to [render.com](https://render.com) → **New +** → **Web Service**.
2. Connect your GitHub account and select this repository.
3. Configure the service:
   | Setting | Value |
   |---|---|
   | **Root Directory** | leave blank (repo root) |
   | **Runtime** | Python 3 |
   | **Build Command** | `pip install -r backend/requirements.txt` |
   | **Start Command** | `uvicorn backend.main:app --host 0.0.0.0 --port $PORT` |
4. Under **Environment** → **Environment Variables**, add:
   | Key | Value |
   |---|---|
   | `GEMINI_API_KEY` | your real Gemini key |
   | `GEMINI_MODEL` | `gemini-2.5-flash` |
   | `ALLOWED_ORIGINS` | your deployed frontend URL, e.g. `https://nova-frontend.onrender.com` (comma-separate multiple) |
5. Click **Create Web Service**. Render will build and deploy; your API will be live at something like `https://nova-backend.onrender.com`.
6. Confirm with `https://nova-backend.onrender.com/api/health`.

### Alternative: Railway

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
2. Railway auto-detects Python. Under **Settings**:
   - **Build Command:** `pip install -r backend/requirements.txt`
   - **Start Command:** `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
3. Under **Variables**, add `GEMINI_API_KEY`, `GEMINI_MODEL`, and `ALLOWED_ORIGINS` exactly as above.
4. Deploy, then grab the generated public URL.

---

## 4. Deploying the frontend

The frontend is three static files, so it deploys almost anywhere.

**Render (Static Site):**
1. **New +** → **Static Site** → select the same repo.
2. **Root Directory:** `frontend`
3. **Build Command:** leave blank (no build step needed)
4. **Publish Directory:** `.`
5. Before deploying, set the backend URL in `frontend/index.html` (see below), commit, and push.

**Vercel:**
1. Import the repo at [vercel.com/new](https://vercel.com/new).
2. **Root Directory:** `frontend`
3. Framework preset: **Other** (no build step).
4. Deploy.

### Pointing the frontend at your live backend

Before your final deploy, edit `frontend/index.html` and add this line right before `<script src="app.js" defer></script>`:

```html
<script>window.NOVA_API_BASE_URL = "https://nova-backend.onrender.com";</script>
```

Commit and push — both Render and Vercel auto-redeploy on push to `main`.

---

## 5. API reference

| Method | Path | Body | Description |
|---|---|---|---|
| `GET` | `/api/health` | — | Liveness check |
| `POST` | `/api/chat` | `{ "message": string, "session_id": string \| null }` | Sends a message, returns `{ reply, session_id }` |
| `POST` | `/api/clear` | `{ "session_id": string }` | Clears that session's in-memory history |

Errors return a JSON body `{ "error": "..." }` with an appropriate status code (`400` bad input, `429` rate limited, `500` server/key issue, `502` upstream Gemini issue).

---

## 6. Notes & next steps

- Chat history is stored **in-process memory** — it resets on redeploy/restart and won't work correctly if you scale the backend to multiple instances. For production-grade persistence, swap the `_sessions` dict in `backend/services/gemini.py` for Redis or a database table keyed by `session_id`.
- The sidebar's "previous sessions" list is a visual mock, since there's no persistent multi-session storage yet — a natural next feature to add.
- Voice input is a UI mockup only (no actual audio capture wired up).
