## Slugledger

Slugledger is an append-only ledger exposed as a Cloudflare Worker. It records the lifecycle of your [n8n](https://n8n.io/) workflows in D1 (metadata) and optionally streams large JSON payloads into R2 for inexpensive, durable storage. The API is implemented with [Hono](https://hono.dev/), documented via Scalar, and secured with a simple API-key gate.

## Documentation
- [`docs/about.md`](./docs/about.md) – background on the service’s goals, architecture, and operational guarantees.
- [`docs/getting-started.md`](./docs/getting-started.md) – step-by-step local setup, testing, and deployment flow.
- Live Scalar docs at `http://<worker-domain>/docs`, powered by the `/openapi.json` endpoint in this repo.

### Highlights
- Event-centric POST endpoint (`/events`) for capturing workflow lifecycle data with optional custom IDs; timestamps are auto-assigned on the server.
- Instant OpenAPI + Scalar docs available at `/openapi.json` and `/docs`.
- Designed for append-only auditing: no update/delete mutations.

---

## Prerequisites
- Node.js 18+ and npm installed locally.
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) v4.4+ authenticated against your Cloudflare account.
- A Cloudflare D1 database and R2 bucket (Wrangler bindings already scaffolded in `wrangler.jsonc`; adjust names/IDs to your environment).

---

## Getting Started
1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure secrets**  
   Copy `.dev.vars.example` to `.dev.vars` and set `API_KEY`. This file is consumed by `wrangler dev` and is gitignored.

3. **Verify Wrangler bindings**  
   Update `wrangler.jsonc` with your own `r2_buckets`, `d1_databases`, and production `vars` if they differ from the defaults.

4. **Create the D1 tables (one-time)**  
   Run the following SQL against your D1 database (via the dashboard, `wrangler d1 execute`, or migrations):
   ```sql
   CREATE TABLE IF NOT EXISTS jobs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     run_id TEXT NOT NULL,
     n8n_workflow_id TEXT NOT NULL,
     n8n_execution_id TEXT NOT NULL,
     n8n_status_code INTEGER NOT NULL,
     n8n_status_message TEXT NOT NULL,
     r2_pointer TEXT,
     metadata TEXT,
     created_at DATETIME DEFAULT CURRENT_TIMESTAMP
   );
   CREATE INDEX IF NOT EXISTS idx_jobs_run_id ON jobs(run_id);
   CREATE INDEX IF NOT EXISTS idx_jobs_execution ON jobs(n8n_execution_id);

   CREATE TABLE IF NOT EXISTS events (
     id TEXT PRIMARY KEY,
     ts TEXT NOT NULL,
     payload TEXT NOT NULL CHECK (json_valid(payload))
   );
   CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
   ```

5. **Run the worker locally**
   ```bash
   npm run dev
   ```
   Wrangler exposes the worker at `http://127.0.0.1:8787` (or `http://localhost:8787`). Open `http://localhost:8787/docs` for interactive API docs.

6. **Test with Scalar**
   - Browse to `http://127.0.0.1:8787/docs`.
   - Click **Authorize** and paste the same API key you configured in `.dev.vars`.
   - Expand the `POST /events` operation, click **Try it out**, and ship a sample payload to confirm D1 writes succeed.
   - Inspect saved requests/responses or explore other operations (e.g., `GET /events`, `POST /events/query`) without needing curl.

7. **Run the smoke-test script (optional)**
   With the dev server running, execute:
   ```bash
   ./test-endpoints.sh
   ```
   The script uses `curl` to exercise the core endpoints and prints pass/fail per request.

---

## API & Authentication
- **Auth**: Every request (except `/docs` and `/openapi.json`) checks for an API key either in an `Authorization: Bearer <token>` header or an `X-API-Key` header. The expected key is pulled from `API_KEY` defined via `.dev.vars` (dev) or Worker environment variables (prod). Leaving `API_KEY` unset disables auth, so make sure to configure it in production.

Legacy `/jobs`, `/runs`, and `/executions` endpoints have been removed; use `/events` for ingestion and queries.

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/events` | Insert an event (optional id + JSON payload). The server stamps the row with the current ISO timestamp. |
| `GET`  | `/events` | Query events with optional filters (`id`, `after`, `before`, `limit`). |
| `POST` | `/events/query` | Run a parameterized SQL query against the `events` table (read-only). |
| `GET`  | `/openapi.json` | Machine-readable OpenAPI 3.1 document. |
| `GET`  | `/docs` | Scalar’s interactive UI fed by the same OpenAPI spec. |

### Example: create an event
```bash
curl -X POST http://localhost:8787/events \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "payload": {
      "type": "workflow.notification",
      "run_id": "run-123"
    }
  }'
```

The Worker responds with the assigned `id` and persists the payload with a freshly generated ISO8601 timestamp.

---

## Type Generation
Keep Hono’s bindings in sync with your Wrangler config by running:
```bash
npm run cf-typegen
```
This emits the `CloudflareBindings` interface that the app consumes via `new Hono<{ Bindings: CloudflareBindings }>()`.

---

## Deployment
Deploy the worker (and run any pending D1 migrations) with:
```bash
npm run deploy
```
Wrangler automatically bundles the Worker, uploads it to Cloudflare, and wires the configured R2/D1 bindings.

### Continuous deployment with Cloudflare Workers
- **GitHub → Workers Deployments**: Install the [Cloudflare Workers GitHub App](https://developers.cloudflare.com/workers/wrangler/ci-cd/#deploy-from-github) so pushes to your main branch automatically trigger builds and deploys via Wrangler in Cloudflare’s CI/CD service.
- **GitHub Actions**: Alternatively, add a workflow that invokes Wrangler directly. Example:
  ```yaml
  name: Deploy Worker
  on:
    push:
      branches: [main]
  jobs:
    deploy:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: cloudflare/wrangler-action@v3
          with:
            apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
            accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
            command: deploy --minify
  ```
  Store an API token (Workers Scripts + D1 edit permissions) and your account ID in repository secrets; every push to `main` will now redeploy the Worker the same way `npm run deploy` does.

---

## Troubleshooting
- **401 Unauthorized**: Confirm the header name (`Authorization: Bearer ...` or `X-API-Key`) matches the value configured in `.dev.vars`/production vars.
- **R2 upload fails**: Ensure the bound R2 bucket exists, is reachable from your Worker, and that the service token used by Wrangler has R2 write permissions.
- **D1 schema mismatch**: Rerun the SQL snippet above or inspect `wrangler d1 migrations list` to ensure the `jobs` table exists with the required columns.

That’s it—Slugledger should now give you a clean, readable overview of every workflow execution, complete with API docs and turnkey deployment steps.
