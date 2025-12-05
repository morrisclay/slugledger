# About Slugledger

Slugledger is an append-only event ledger that runs entirely on Cloudflare Workers. It is designed to capture the lifecycle of your [n8n](https://n8n.io/) workflows (or any JSON-bearing workload) with durable storage in Cloudflare D1 and optional large-payload offloading into R2. A lightweight [Hono](https://hono.dev/) application powers the API, while [Scalar](https://scalar.com/) renders always-in-sync, interactive documentation directly from the bundled OpenAPI schema.

## Why it exists

- **Provenance for automations** – keep an immutable audit log of each workflow execution, payload, and status transition.
- **Cloudflare-native** – co-locates compute, data, and docs on Workers, D1, and R2 so you avoid multi-cloud drift.
- **Self-documenting** – publishes `/openapi.json` plus `/docs`, giving operators and integrators a turnkey playground.

## Core architecture

| Component | Purpose |
| --- | --- |
| Cloudflare Worker + Hono | Hosts the API, auth middleware, and Scalar UI. |
| Cloudflare D1 | Persists the normalized ledger tables (`events`, historical `jobs`). |
| Cloudflare R2 (optional) | Stores oversized JSON payloads while D1 keeps pointers. |
| Scalar API Reference | Serves interactive docs at `/docs`, backed by `/openapi.json`. |

### Request lifecycle

1. Clients call `/events` with any JSON payload (and optional custom `id`); the Worker assigns an ISO timestamp just before persisting.
2. The Worker enforces API-key auth (skipped for `/docs`/`/openapi.json`), validates the body, and normalizes the payload.
3. Event metadata is inserted into D1. When payloads exceed your chosen threshold you can stream them into R2 and keep an object pointer in D1 (the helper functions are already scaffolded).
4. Consumers can read rows via `GET /events` filters or run SQL-style analytics with `POST /events/query`.

### Operational characteristics

- **Append-only safety** – Only `/events` endpoints are exposed; legacy `/jobs`, `/runs`, and `/executions` handlers have been removed to keep the surface area small.
- **API-key gate** – Require either `Authorization: Bearer <token>` or `X-API-Key` with the value stored in `.dev.vars` / Worker vars.
- **Instant docs + testing** – Scalar makes it easy for teammates to explore endpoints without curling by hand.

## When to use Slugledger

- You run numerous n8n workflows (or any automation) and need a tamper-resistant execution log.
- You prefer Cloudflare’s global latency, built-in TLS, and developer ergonomics to building bespoke infrastructure.
- You want a single deployable artifact (a Worker) that includes its own docs, auth, and data access patterns.

## Related documents

- [Getting Started](./getting-started.md) – step-by-step instructions for local dev, testing, and deployment.
- [`README.md`](../README.md) – quick reference for scripts, SQL schema, and operational commands.
