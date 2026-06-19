# hyani

Simple project with a static frontend and a Node backend.

## Overview
- Frontend: `index.html`, `app.js`, `style.css` (host on GitHub Pages)
- Backend: `server.js` (host on a Node-capable service like Render)

## Quick setup (local)
```bash
git clone https://github.com/your-username/your-repo.git
cd your-repo
npm install
# Run backend locally
node server.js
# Open index.html in a browser for the frontend, or visit http://localhost:PORT if the server serves it
```

## Host frontend on GitHub Pages
1. Push your repo to GitHub (ensure `index.html` is at the repository root).
2. In GitHub, go to Settings → Pages.
3. Under "Build and deployment" set Source to branch `main` and folder `/ (root)`.
4. Save — your site will be available at `https://your-username.github.io/your-repo/`.

Notes:
- If you use a framework that builds into `dist/` or `docs/`, set Pages source to that folder.

## Host backend (recommended: Render)
1. Create a Render account and choose **New → Web Service**.
2. Connect your GitHub repo and pick branch `main`.
3. Set the start command to `node server.js` (or `npm start`).
4. Add any required environment variables in Render's dashboard.
5. Deploy — Render will build and expose a public URL for your API.

Other providers: Railway, Fly, Heroku (if available), or a VPS.

## What I added to this repo
- `.gitignore` — ignores `node_modules`, `.env`, and other common artifacts.
- `README.md` — this file with hosting instructions.

## Next steps I can help with
- Walk you through enabling GitHub Pages in the repo settings.
- Create a Render service step-by-step and set environment variables.
- Add a small `start` script to `package.json` if you want.
