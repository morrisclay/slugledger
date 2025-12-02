import { Hono } from 'hono'
import { Context } from 'hono'

// Define types for Cloudflare bindings
// These types are provided by Cloudflare Workers runtime
interface D1Database {
	prepare(query: string): D1PreparedStatement
	exec(query: string): Promise<D1ExecResult>
}

interface D1PreparedStatement {
	bind(...values: unknown[]): D1PreparedStatement
	first<T = unknown>(): Promise<T | null>
	run(): Promise<D1Result>
	all<T = unknown>(): Promise<D1Result<T>>
}

interface D1Result<T = unknown> {
	success: boolean
	meta: {
		last_row_id: number
		changes: number
	}
	results?: T[]
}

interface D1ExecResult {
	count: number
	duration: number
}

interface R2Bucket {
	put(key: string, value: string | ArrayBuffer | ArrayBufferView, options?: R2PutOptions): Promise<R2Object | null>
	get(key: string): Promise<R2ObjectBody | null>
	delete(keys: string | string[]): Promise<void>
}

interface R2PutOptions {
	httpMetadata?: {
		contentType?: string
	}
	customMetadata?: Record<string, string>
}

interface R2Object {
	key: string
	size: number
	etag: string
	uploaded: Date
}

interface R2ObjectBody extends R2Object {
	body: unknown // ReadableStream in Workers runtime
	bodyUsed: boolean
}

type CloudflareBindings = {
	DB: D1Database
	R2: R2Bucket
}

type Env = {
	Bindings: CloudflareBindings
}

// Define request/response types
type JobCreateRequest = {
	run_id: string
	n8n_workflow_id: string
	n8n_execution_id: string
	n8n_status_code: number
	n8n_status_message: string
	metadata?: Record<string, unknown>
}

type JobResultRequest = {
	n8n_workflow_id: string
	n8n_execution_id: string
	data: Record<string, unknown>
}

type JobResultWithMetadataRequest = {
	n8n_workflow_id: string
	n8n_execution_id: string
	data: Record<string, unknown>
	metadata: Record<string, unknown>
}

type JobRow = {
	id: number
	run_id: string
	n8n_workflow_id: string
	n8n_execution_id: string
	n8n_status_code: number
	n8n_status_message: string
	r2_pointer: string | null
	metadata: string | null
	created_at: string
}

const app = new Hono<{ Bindings: CloudflareBindings }>()

// Helper function to handle errors
function handleError(c: Context, error: unknown, statusCode: number = 500) {
	// Log error (console is available in Cloudflare Workers runtime)
	const message = error instanceof Error ? error.message : 'Internal server error'
	return c.json({ error: message }, statusCode)
}

// POST /jobs
// Insert a new ledger row
app.post('/jobs', async (c) => {
	try {
		const body = await c.req.json<JobCreateRequest>()

		// Validate required fields
		if (
			!body.run_id ||
			!body.n8n_workflow_id ||
			!body.n8n_execution_id ||
			typeof body.n8n_status_code !== 'number' ||
			!body.n8n_status_message
		) {
			return c.json({ error: 'Missing required fields' }, 400)
		}

		const metadataJson = body.metadata ? JSON.stringify(body.metadata) : null

		// Insert new row (append-only)
		const stmt = c.env.DB.prepare(
			`INSERT INTO jobs (
				run_id,
				n8n_workflow_id,
				n8n_execution_id,
				n8n_status_code,
				n8n_status_message,
				metadata
			) VALUES (?, ?, ?, ?, ?, ?)`
		)

		const result = await stmt
			.bind(
				body.run_id,
				body.n8n_workflow_id,
				body.n8n_execution_id,
				body.n8n_status_code,
				body.n8n_status_message,
				metadataJson
			)
			.run()

		if (!result.success) {
			return c.json({ error: 'Failed to insert job' }, 500)
		}

		return c.json({ success: true, id: result.meta.last_row_id }, 201)
	} catch (error) {
		return handleError(c, error)
	}
})

// POST /jobs/:run_id/result
// Upload data to R2 and insert a new ledger row
app.post('/jobs/:run_id/result', async (c) => {
	try {
		const runId = c.req.param('run_id')
		if (!runId) {
			return c.json({ error: 'Missing run_id parameter' }, 400)
		}

		const body = await c.req.json<JobResultRequest>()

		// Validate required fields
		if (!body.n8n_workflow_id || !body.n8n_execution_id || !body.data) {
			return c.json({ error: 'Missing required fields' }, 400)
		}

		// Generate R2 key: results/{run_id}/{n8n_workflow_id}/{n8n_execution_id}/{timestamp}.json
		const timestamp = Date.now()
		const r2Key = `results/${runId}/${body.n8n_workflow_id}/${body.n8n_execution_id}/${timestamp}.json`

		// Upload data to R2
		const dataJson = JSON.stringify(body.data)
		await c.env.R2.put(r2Key, dataJson, {
			httpMetadata: {
				contentType: 'application/json',
			},
		})

		// Insert new row with result information
		const stmt = c.env.DB.prepare(
			`INSERT INTO jobs (
				run_id,
				n8n_workflow_id,
				n8n_execution_id,
				n8n_status_code,
				n8n_status_message,
				r2_pointer
			) VALUES (?, ?, ?, ?, ?, ?)`
		)

		const result = await stmt
			.bind(
				runId,
				body.n8n_workflow_id,
				body.n8n_execution_id,
				200, // n8n_status_code
				'result_stored', // n8n_status_message
				r2Key // r2_pointer
			)
			.run()

		if (!result.success) {
			return c.json({ error: 'Failed to insert job result' }, 500)
		}

		return c.json({ success: true, id: result.meta.last_row_id, r2_pointer: r2Key }, 201)
	} catch (error) {
		return handleError(c, error)
	}
})

// POST /jobs/:run_id/result-with-metadata
// Upload data to R2 with customMetadata and insert a new ledger row with metadata
app.post('/jobs/:run_id/result-with-metadata', async (c) => {
	try {
		const runId = c.req.param('run_id')
		if (!runId) {
			return c.json({ error: 'Missing run_id parameter' }, 400)
		}

		const body = await c.req.json<JobResultWithMetadataRequest>()

		// Validate required fields
		if (!body.n8n_workflow_id || !body.n8n_execution_id || !body.data || !body.metadata) {
			return c.json({ error: 'Missing required fields' }, 400)
		}

		// Generate R2 key: results/{run_id}/{n8n_workflow_id}/{n8n_execution_id}/{timestamp}.json
		const timestamp = Date.now()
		const r2Key = `results/${runId}/${body.n8n_workflow_id}/${body.n8n_execution_id}/${timestamp}.json`

		// Convert metadata to Record<string, string> for R2 customMetadata
		// All values must be strings in customMetadata
		const customMetadata: Record<string, string> = {}
		for (const [key, value] of Object.entries(body.metadata)) {
			customMetadata[key] = typeof value === 'string' ? value : JSON.stringify(value)
		}

		// Upload data to R2 with httpMetadata and customMetadata
		const dataJson = JSON.stringify(body.data)
		await c.env.R2.put(r2Key, dataJson, {
			httpMetadata: {
				contentType: 'application/json',
			},
			customMetadata: customMetadata,
		})

		// Insert new row with result information and metadata
		const metadataJson = JSON.stringify(body.metadata)
		const stmt = c.env.DB.prepare(
			`INSERT INTO jobs (
				run_id,
				n8n_workflow_id,
				n8n_execution_id,
				n8n_status_code,
				n8n_status_message,
				r2_pointer,
				metadata
			) VALUES (?, ?, ?, ?, ?, ?, ?)`
		)

		const result = await stmt
			.bind(
				runId,
				body.n8n_workflow_id,
				body.n8n_execution_id,
				200, // n8n_status_code
				'result_stored', // n8n_status_message
				r2Key, // r2_pointer
				metadataJson // metadata
			)
			.run()

		if (!result.success) {
			return c.json({ error: 'Failed to insert job result' }, 500)
		}

		return c.json(
			{
				success: true,
				key: r2Key,
				metadata: body.metadata,
			},
			201
		)
	} catch (error) {
		return handleError(c, error)
	}
})

// GET /runs/:run_id
// Return all ledger entries for the run ordered by created_at ASC
app.get('/runs/:run_id', async (c) => {
	try {
		const runId = c.req.param('run_id')
		if (!runId) {
			return c.json({ error: 'Missing run_id parameter' }, 400)
		}

		const stmt = c.env.DB.prepare(
			`SELECT * FROM jobs WHERE run_id = ? ORDER BY created_at ASC`
		)

		const result = await stmt.bind(runId).all<JobRow>()

		if (!result.success) {
			return c.json({ error: 'Failed to fetch runs' }, 500)
		}

		// Parse metadata JSON for each row
		const rows = (result.results || []).map((row: JobRow) => ({
			...row,
			metadata: row.metadata ? JSON.parse(row.metadata) : null,
		}))

		return c.json({ runs: rows }, 200)
	} catch (error) {
		return handleError(c, error)
	}
})

// GET /runs/:run_id/latest
// Return the latest ledger entry for the run
app.get('/runs/:run_id/latest', async (c) => {
	try {
		const runId = c.req.param('run_id')
		if (!runId) {
			return c.json({ error: 'Missing run_id parameter' }, 400)
		}

		const stmt = c.env.DB.prepare(
			`SELECT * FROM jobs WHERE run_id = ? ORDER BY created_at DESC LIMIT 1`
		)

		const result = await stmt.bind(runId).first<JobRow>()

		if (!result) {
			return c.json({ error: 'No job found for this run_id' }, 404)
		}

		// Parse metadata JSON
		const row = {
			...result,
			metadata: result.metadata ? JSON.parse(result.metadata) : null,
		}

		return c.json(row, 200)
	} catch (error) {
		return handleError(c, error)
	}
})

// GET /executions/:n8n_execution_id
// Return all rows for that execution ordered by created_at ASC
app.get('/executions/:n8n_execution_id', async (c) => {
	try {
		const executionId = c.req.param('n8n_execution_id')
		if (!executionId) {
			return c.json({ error: 'Missing n8n_execution_id parameter' }, 400)
		}

		const stmt = c.env.DB.prepare(
			`SELECT * FROM jobs WHERE n8n_execution_id = ? ORDER BY created_at ASC`
		)

		const result = await stmt.bind(executionId).all<JobRow>()

		if (!result.success) {
			return c.json({ error: 'Failed to fetch executions' }, 500)
		}

		// Parse metadata JSON for each row
		const rows = (result.results || []).map((row: JobRow) => ({
			...row,
			metadata: row.metadata ? JSON.parse(row.metadata) : null,
		}))

		return c.json({ executions: rows }, 200)
	} catch (error) {
		return handleError(c, error)
	}
})

export default app
