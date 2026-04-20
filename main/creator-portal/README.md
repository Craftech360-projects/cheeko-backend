# Cheeko Creator Portal

Lightweight no-build public portal for creator uploads, generation, and review submission.

## What it supports

- Create a draft content submission
- Upload `audio` and `cover image`
- Start a generated draft job backed by `content-poc`
- Submit draft for review
- View your submissions
- Browser-session tracking for public creators

## How to run

1. Start `manager-api-node` on `http://localhost:8002`.
2. Serve this folder with any static server, for example:

```bash
cd main/creator-portal
python -m http.server 4173
```

3. Open `http://localhost:4173`.

## Notes

- This is intentionally simple and dependency-free so the workflow can be exercised immediately.
- The API base URL is not shown to end users. It defaults to `http://localhost:8002/toy` for local testing. For deployment, set `window.CHEEKO_CREATOR_API_BASE` before loading `app.js`, or store `creatorPortal.apiBaseUrl` in local storage for a private local override.
- Public creator submissions do not require sign-in. Admin/reviewer publishing still happens through protected backend endpoints.
- Press `Alt+R` to retry the last stored generation job from this browser session.
