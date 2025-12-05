# Getting Started with Slugledger

Follow the steps below to bootstrap a local environment, explore the Scalar docs, and ship the Worker to Cloudflare.

## 1. Clone and install

```bash
git clone https://github.com/<you>/slugledger.git
cd slugledger
npm install
```

## 2. Configure local secrets

Copy `.dev.vars.example` to `.dev.vars` and set `API_KEY=<your-test-key>`. Wrangler automatically injects these values when you run `npm run dev`.

## 3. Provision Cloudflare resources

- Create (or reuse) a Cloudflare D1 database and note its binding name/ID.
- Create (or reuse) a Cloudflare R2 bucket if you plan to store large payloads outside D1.
- Update the bindings inside `wrangler.jsonc` to match your account/project.

## 4. Initialize the D1 schema

Run the SQL snippet from the [`README.md`](../README.md) against your D1 database (via the Cloudflare dashboard, `wrangler d1 execute`, or migrations) to create the `jobs` and `events` tables.

## 5. Launch the Worker locally

```bash
npm run dev
```

Wrangler will serve the Worker at `http://127.0.0.1:8787`. Keep the terminal open so hot reload can pick up file changes.

## 6. Send a test event

With the dev server running:

```bash
curl -X POST http://127.0.0.1:8787/events \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "ts": "2024-01-01T12:00:00.000Z",
        "payload": {
          "type": "workflow.notification",
          "run_id": "run-123"
        }
      }'
```

You should receive `{ "success": true, "id": "<uuid>" }`.

## 7. Explore and test with Scalar

Open `http://127.0.0.1:8787/docs` in a browser. The embedded Scalar UI consumes `/openapi.json`, letting you:

- Read endpoint descriptions that stay in sync with the Worker code.
- Authorize with your API key once and invoke endpoints directly from the UI.
- Inspect request/response samples, schemas, and error models.

## 8. Run the smoke-test script

```bash
./test-endpoints.sh
```

This shell script uses `curl` to exercise the core endpoints and prints pass/fail per request. Make sure the Worker is running locally before executing it.

## 9. Deploy to Cloudflare

```bash
npm run deploy
```

Wrangler bundles the Worker, uploads it to Cloudflare, and runs pending D1 migrations. See the README for CI/CD guidance so deployments happen automatically when you push to your main branch.
