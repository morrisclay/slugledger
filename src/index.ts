import { Hono } from 'hono'
import { Context } from 'hono'
import { apiReference } from '@scalar/hono-api-reference'

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
	data?: Record<string, unknown> // Optional: if present, upload to R2
	metadata?: Record<string, unknown> // Optional: stored in D1 and R2 customMetadata (if R2 upload)
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

// OpenAPI schema definition
const openApiSchema = {
	openapi: '3.1.0',
	info: {
		title: 'n8n Workflow Ledger API',
		version: '1.0.0',
		description: 'Append-only ledger API for tracking n8n workflow executions',
	},
	servers: [
		{
			url: 'http://localhost:8787',
			description: 'Local development server',
		},
	],
	paths: {
		'/jobs': {
			post: {
				summary: 'Create a new job ledger entry',
				description:
					'Unified endpoint for creating job ledger entries. If `data` is provided, it will be uploaded to R2. If `metadata` is provided, it will be stored in D1 and R2 customMetadata (if R2 upload occurs).',
				tags: ['Jobs'],
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['run_id', 'n8n_workflow_id', 'n8n_execution_id', 'n8n_status_code', 'n8n_status_message'],
								properties: {
									run_id: {
										type: 'string',
										description: 'Unique identifier for the run',
										example: 'run-123',
									},
									n8n_workflow_id: {
										type: 'string',
										description: 'n8n workflow identifier',
										example: 'workflow-456',
									},
									n8n_execution_id: {
										type: 'string',
										description: 'n8n execution identifier',
										example: 'execution-789',
									},
									n8n_status_code: {
										type: 'integer',
										description: 'HTTP status code from n8n',
										example: 201,
									},
									n8n_status_message: {
										type: 'string',
										description: 'Status message from n8n',
										example: 'workflow_started',
									},
									data: {
										type: 'object',
										description: 'Optional: Result data to store in R2. If provided, will be uploaded to R2 and status will be set to 200/result_stored.',
										additionalProperties: true,
										example: { result: 'success', items_processed: 42 },
									},
									metadata: {
										type: 'object',
										description:
											'Optional: Arbitrary JSON metadata. Stored in D1 metadata column. If `data` is also provided, metadata will also be stored in R2 customMetadata.',
										additionalProperties: true,
										example: { source: 'webhook', environment: 'production', timestamp: 1234567890 },
									},
								},
							},
						},
					},
				},
				responses: {
					'201': {
						description: 'Job created successfully',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										success: { type: 'boolean', example: true },
										id: { type: 'integer', example: 1 },
										r2_pointer: {
											type: 'string',
											description: 'Present if data was uploaded to R2',
											example: 'results/run-123/workflow-456/execution-789/1234567890.json',
										},
										key: {
											type: 'string',
											description: 'Present if data was uploaded to R2 (same as r2_pointer)',
											example: 'results/run-123/workflow-456/execution-789/1234567890.json',
										},
										metadata: {
											type: 'object',
											description: 'Present if metadata was provided',
											additionalProperties: true,
											example: { source: 'webhook', environment: 'production' },
										},
									},
								},
							},
						},
					},
					'400': {
						description: 'Bad request - missing required fields',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										error: { type: 'string', example: 'Missing required fields' },
									},
								},
							},
						},
					},
					'500': {
						description: 'Internal server error',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										error: { type: 'string' },
									},
								},
							},
						},
					},
				},
			},
		},
		'/runs/{run_id}': {
			get: {
				summary: 'Get all ledger entries for a run',
				description: 'Returns all ledger entries for the specified run_id, ordered by created_at ASC',
				tags: ['Runs'],
				parameters: [
					{
						name: 'run_id',
						in: 'path',
						required: true,
						schema: { type: 'string' },
						description: 'Unique identifier for the run',
						example: 'run-123',
					},
				],
				responses: {
					'200': {
						description: 'List of ledger entries',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										runs: {
											type: 'array',
											items: {
												type: 'object',
												properties: {
													id: { type: 'integer' },
													run_id: { type: 'string' },
													n8n_workflow_id: { type: 'string' },
													n8n_execution_id: { type: 'string' },
													n8n_status_code: { type: 'integer' },
													n8n_status_message: { type: 'string' },
													r2_pointer: { type: 'string', nullable: true },
													metadata: { type: 'object', nullable: true, additionalProperties: true },
													created_at: { type: 'string', format: 'date-time' },
												},
											},
										},
									},
								},
							},
						},
					},
					'400': {
						description: 'Bad request',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										error: { type: 'string' },
									},
								},
							},
						},
					},
				},
			},
		},
		'/runs/{run_id}/latest': {
			get: {
				summary: 'Get the latest ledger entry for a run',
				description: 'Returns the most recent ledger entry for the specified run_id',
				tags: ['Runs'],
				parameters: [
					{
						name: 'run_id',
						in: 'path',
						required: true,
						schema: { type: 'string' },
						description: 'Unique identifier for the run',
						example: 'run-123',
					},
				],
				responses: {
					'200': {
						description: 'Latest ledger entry',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										id: { type: 'integer' },
										run_id: { type: 'string' },
										n8n_workflow_id: { type: 'string' },
										n8n_execution_id: { type: 'string' },
										n8n_status_code: { type: 'integer' },
										n8n_status_message: { type: 'string' },
										r2_pointer: { type: 'string', nullable: true },
										metadata: { type: 'object', nullable: true, additionalProperties: true },
										created_at: { type: 'string', format: 'date-time' },
									},
								},
							},
						},
					},
					'404': {
						description: 'No job found for this run_id',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										error: { type: 'string', example: 'No job found for this run_id' },
									},
								},
							},
						},
					},
				},
			},
		},
		'/executions/{n8n_execution_id}': {
			get: {
				summary: 'Get all ledger entries for an execution',
				description: 'Returns all ledger entries for the specified n8n_execution_id, ordered by created_at ASC',
				tags: ['Executions'],
				parameters: [
					{
						name: 'n8n_execution_id',
						in: 'path',
						required: true,
						schema: { type: 'string' },
						description: 'n8n execution identifier',
						example: 'execution-789',
					},
				],
				responses: {
					'200': {
						description: 'List of ledger entries',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										executions: {
											type: 'array',
											items: {
												type: 'object',
												properties: {
													id: { type: 'integer' },
													run_id: { type: 'string' },
													n8n_workflow_id: { type: 'string' },
													n8n_execution_id: { type: 'string' },
													n8n_status_code: { type: 'integer' },
													n8n_status_message: { type: 'string' },
													r2_pointer: { type: 'string', nullable: true },
													metadata: { type: 'object', nullable: true, additionalProperties: true },
													created_at: { type: 'string', format: 'date-time' },
												},
											},
										},
									},
								},
							},
						},
					},
					'400': {
						description: 'Bad request',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										error: { type: 'string' },
									},
								},
							},
						},
					},
				},
			},
		},
	},
}

// Serve OpenAPI spec
app.get('/openapi.json', (c) => {
	return c.json(openApiSchema)
})

// Scalar API Reference at /docs
app.get(
	'/docs',
	apiReference({
		spec: {
			url: '/openapi.json',
		},
	} as Parameters<typeof apiReference>[0])
)

// Helper function to handle errors
function handleError(c: Context, error: unknown, statusCode: number = 500) {
	// Log error (console is available in Cloudflare Workers runtime)
	const message = error instanceof Error ? error.message : 'Internal server error'
	return c.json({ error: message }, statusCode)
}

// POST /jobs
// Unified endpoint: Insert a new ledger row
// - If `data` is present: upload to R2 and store pointer
// - If `metadata` is present: store in D1 and R2 customMetadata (if R2 upload)
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

		let r2Key: string | null = null
		// Check if data is provided and not empty
		const hasData =
			body.data !== undefined &&
			body.data !== null &&
			typeof body.data === 'object' &&
			Object.keys(body.data).length > 0
		// Check if metadata is provided and not empty
		const hasMetadata =
			body.metadata !== undefined &&
			body.metadata !== null &&
			typeof body.metadata === 'object' &&
			Object.keys(body.metadata).length > 0

		// If data is present, upload to R2
		if (hasData) {
			// Generate R2 key: results/{run_id}/{n8n_workflow_id}/{n8n_execution_id}/{timestamp}.json
			const timestamp = Date.now()
			r2Key = `results/${body.run_id}/${body.n8n_workflow_id}/${body.n8n_execution_id}/${timestamp}.json`

			// Prepare R2 upload options
			const r2Options: R2PutOptions = {
				httpMetadata: {
					contentType: 'application/json',
				},
			}

			// If metadata is present, add it to R2 customMetadata
			if (hasMetadata) {
				const customMetadata: Record<string, string> = {}
				for (const [key, value] of Object.entries(body.metadata!)) {
					customMetadata[key] = typeof value === 'string' ? value : JSON.stringify(value)
				}
				r2Options.customMetadata = customMetadata
			}

			// Upload data to R2
			const dataJson = JSON.stringify(body.data)
			await c.env.R2.put(r2Key, dataJson, r2Options)

			// If data is present, override status to indicate result storage
			body.n8n_status_code = 200
			body.n8n_status_message = 'result_stored'
		}

		// Prepare metadata JSON for D1
		const metadataJson = hasMetadata ? JSON.stringify(body.metadata) : null

		// Insert new row (append-only)
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
				body.run_id,
				body.n8n_workflow_id,
				body.n8n_execution_id,
				body.n8n_status_code,
				body.n8n_status_message,
				r2Key,
				metadataJson
			)
			.run()

		if (!result.success) {
			return c.json({ error: 'Failed to insert job' }, 500)
		}

		// Build response based on what was stored
		const response: Record<string, unknown> = {
			success: true,
			id: result.meta.last_row_id,
		}

		if (r2Key) {
			response.r2_pointer = r2Key
			response.key = r2Key
		}

		if (hasMetadata) {
			response.metadata = body.metadata
		}

		return c.json(response, 201)
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
