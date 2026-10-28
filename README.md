# MyFundedBook (separate frontend and backend)

    backend/   JSON API + SQLite + user login      node backend/server.js   -> http://localhost:3000
    frontend/  static site (index.html)            node frontend/serve.js   -> http://localhost:5173

Needs Node 22.5+. No npm install. Start both, open http://localhost:5173, create an account.

## Backend (`backend/server.js`)
- API only. Data: `backend/data/journal.db`, screenshots `backend/data/images/<userId>/`, URL-signing secret `backend/data/secret.key`.
- Auth: signup/login return a bearer token (30 days); the frontend sends `Authorization: Bearer ...`. Passwords scrypt-hashed. Login throttled after 8 failures.
- Env: `PORT` (3000), `HOST` (127.0.0.1), `ALLOWED_ORIGINS` (comma list of frontend origins for CORS, default http://localhost:5173), `DATA_DIR`.
- Endpoints: POST /api/signup, /api/login, /api/logout, /api/password; GET /api/me; GET /api/journal; PUT /api/journal;
  DELETE /api/journal/:col/:id; POST /api/images?path=; POST /api/images/sign; GET (signed) /api/images/...; DELETE /api/images/...

## Frontend (`frontend/`)
- `index.html` is your journal; `shim.js` makes its storage/auth calls to the API; `config.js` holds the API URL.
- To deploy: host `frontend/` on any static host, host the backend, set `MFB_API_URL` in `config.js` and `ALLOWED_ORIGINS` on the backend.

Not included: password reset by email, live sync between open tabs. `supabase/` is the older cloud alternative.
