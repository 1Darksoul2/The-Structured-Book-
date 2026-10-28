# MyFundedBook (separate frontend and backend)

    backend/   JSON API + SQLite + user login      node backend/server.js   -> http://localhost:3000
    frontend/  static site (index.html)            node frontend/serve.js   -> http://localhost:5173

Needs Node 22.5+. No npm install. Start both, open http://localhost:5173, create an account.

## Backend (`backend/server.js`)
- API only. Data: `backend/data/journal.db`, screenshots `backend/data/images/<userId>/`, URL-signing secret `backend/data/secret.key`.
- Auth: signup/login return a bearer token (30 days); the frontend sends `Authorization: Bearer ...`. Passwords scrypt-hashed. Login throttled after 8 failures. Changing your password signs out every other device.
- Forgot a password? There is no email service, so the server owner resets it: `node backend/reset-password.js <email> [new-password]` (use the same `DATA_DIR` as the server). That also signs the user out everywhere.
- Env: `PORT` (3000), `HOST` (127.0.0.1), `ALLOWED_ORIGINS` (comma list of frontend origins for CORS, default http://localhost:5173), `DATA_DIR`.
- Endpoints: POST /api/signup, /api/login, /api/logout, /api/password; GET /api/me; GET /api/journal; PUT /api/journal;
  DELETE /api/journal/:col/:id; POST /api/images?path=; POST /api/images/sign; GET (signed) /api/images/...; DELETE /api/images/...

## Frontend (`frontend/`)
- `index.html` is your journal; `shim.js` makes its storage/auth calls to the API; `config.js` holds the API URL.
- To deploy: host `frontend/` on any static host, host the backend, set `MFB_API_URL` in `config.js` and `ALLOWED_ORIGINS` on the backend.

Your journal starts empty: nothing is pre-filled and there is no sample data. If the backend is unreachable the app shows a "Can't reach your journal" screen with a retry button and keeps you signed in.

Excel import/export loads the SheetJS library from cdnjs, so those need an internet connection. Everything else works offline against your own backend.

Not included: password reset by email, live sync between open tabs (other devices update when you reload or switch back to the tab). `supabase/` is the older cloud alternative and is not used by this build.
