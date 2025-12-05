## Slugledger

Slugledger is an append-only ledger exposed as a Cloudflare Worker. It records the lifecycle of your [n8n](https://n8n.io/) workflows in D1 (metadata) and optionally streams large JSON payloads into R2 for inexpensive, durable storage. The API is implemented with [Hono](https://hono.dev/), documented via Scalar, and secured with a simple API-key gate.

### Highlights
- Single POST endpoint to capture workflow start/end metadata plus optional arbitrary JSON payloads.
- Automatic promotion of payloads to R2 when `data` is provided, with coordinated metadata stored alongside the D1 row.
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

6. **Run the smoke-test script (optional)**
   With the dev server running, execute:
   ```bash
   ./test-endpoints.sh
   ```
   The script uses `curl` to exercise the core endpoints and prints pass/fail per request.

---

## API & Authentication
- **Auth**: Every request (except `/docs` and `/openapi.json`) checks for an API key either in an `Authorization: Bearer <token>` header or an `X-API-Key` header. The expected key is pulled from `API_KEY` defined via `.dev.vars` (dev) or Worker environment variables (prod). Leaving `API_KEY` unset disables auth, so make sure to configure it in production.

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/jobs` | Append a ledger entry. Optionally include `data` to persist JSON to R2 and `metadata` for contextual fields. |
| `POST` | `/events` | Insert an event (optional id + server-generated ISO timestamp + JSON payload) into the `events` table. |
| `GET`  | `/events` | Query events with optional filters (`id`, `after`, `before`, `limit`). |
| `GET`  | `/runs/:run_id` | List every entry for a run ordered by `created_at ASC`. |
| `GET`  | `/runs/:run_id/latest` | Fetch the newest entry for a run. |
| `GET`  | `/executions/:n8n_execution_id` | List entries for a single n8n execution. |
| `GET`  | `/openapi.json` | Machine-readable OpenAPI 3.1 document. |
| `GET`  | `/docs` | Scalar’s interactive UI fed by the same OpenAPI spec. |

### Example: create a ledger entry
```bash
curl -X POST http://localhost:8787/jobs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "run_id": "run-123",
    "n8n_workflow_id": "workflow-456",
    "n8n_execution_id": "execution-789",
    "n8n_status_code": 201,
    "n8n_status_message": "workflow_started",
    "metadata": { "source": "webhook", "env": "prod" },
    "data": { "items_processed": 42 }
  }'
```
If `data` is provided and non-empty, Slugledger:
1. Uploads the JSON blob to R2 (`results/<run>/<workflow>/<execution>/<timestamp>.json`).
2. Stores the pointer plus metadata in D1.
3. Overwrites `n8n_status_code/message` with `200/result_stored` so downstream consumers can distinguish storage outcomes.

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

---

## Troubleshooting
- **401 Unauthorized**: Confirm the header name (`Authorization: Bearer ...` or `X-API-Key`) matches the value configured in `.dev.vars`/production vars.
- **R2 upload fails**: Ensure the bound R2 bucket exists, is reachable from your Worker, and that the service token used by Wrangler has R2 write permissions.
- **D1 schema mismatch**: Rerun the SQL snippet above or inspect `wrangler d1 migrations list` to ensure the `jobs` table exists with the required columns.

That’s it—Slugledger should now give you a clean, readable overview of every workflow execution, complete with API docs and turnkey deployment steps.
