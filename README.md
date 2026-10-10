# loquesea
para lo que sea

Personal pages: meal planner (`food/`), dashboards (`planner/`), basketball practice planner (`training/`).
`index.html` links to all of them.

## How it's hosted
- **Cloudflare Worker** (`wrangler.jsonc`, `worker.js`): serves the repo's files and runs the Kroger
  helper at `/api/kroger`. Cloudflare builds it from GitHub: `main` is live, other branches get a
  preview URL. Kroger keys (`KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET`) are secrets in the Cloudflare
  dashboard. `.assetsignore` keeps repo internals off the site.
- **GitHub Pages** also serves `main`; everything works there except sending to the Kroger cart.

## Data
Pages save their data (`*.json`) by committing to `main` through the GitHub API, using the token
each browser asks for once. Those commits carry `[skip ci]` so they don't trigger a deploy.
