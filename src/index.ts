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
	API_KEY?: string // API key from environment variables (.dev.vars or wrangler.jsonc vars)
}

type EventCreateRequest = {
	id?: string
	ts: string
	payload: unknown
}

type EventRow = {
	id: string
	ts: string
	payload: string
}

type EventQueryRequest = {
	sql: string
	params?: unknown[]
}

const app = new Hono<{ Bindings: CloudflareBindings; API_KEY?: string }>()

const JOBS_DEPRECATION_MESSAGE = 'The /jobs endpoint has been deprecated. Use /events to record workflow activity.'
const RUNS_DEPRECATION_MESSAGE =
	'The /runs endpoints have been deprecated. Use /events to inspect workflow history.'
const EXECUTIONS_DEPRECATION_MESSAGE =
	'The /executions endpoint has been deprecated. Use /events to inspect workflow history.'

const deprecatedResponseSchema = {
	type: 'object',
	properties: {
		error: { type: 'string', example: 'This endpoint has been deprecated. Use /events instead.' },
		deprecated: { type: 'boolean', example: true },
	},
}

const buildDeprecatedResponse = (description: string) => ({
	description,
	content: {
		'application/json': {
			schema: deprecatedResponseSchema,
		},
	},
})

// API Key Authentication Middleware
// Checks for API key in Authorization header (Bearer token) or X-API-Key header
const apiKeyAuth = async (c: Context<{ Bindings: CloudflareBindings; API_KEY?: string }>, next: () => Promise<void>) => {
	// Skip auth for docs endpoints
	const path = c.req.path
	if (path === '/docs' || path === '/openapi.json') {
		await next()
		return
	}

	// Get API key from environment
	// In Cloudflare Workers, vars from .dev.vars or wrangler.jsonc are available in c.env
	const expectedApiKey = (c.env as unknown as { Bindings: CloudflareBindings; API_KEY?: string }).API_KEY

	// If no API key is configured, skip authentication
	if (!expectedApiKey) {
		await next()
		return
	}

	// Get API key from request headers
	const authHeader = c.req.header('Authorization')
	const apiKeyHeader = c.req.header('X-API-Key')

	let providedKey: string | undefined

	// Check Authorization header (Bearer token format)
	if (authHeader && authHeader.startsWith('Bearer ')) {
		providedKey = authHeader.substring(7)
	} else if (apiKeyHeader) {
		// Check X-API-Key header
		providedKey = apiKeyHeader
	}

	// Validate API key
	if (!providedKey || providedKey !== expectedApiKey) {
		return c.json({ error: 'Unauthorized - Invalid or missing API key' }, 401)
	}

	// API key is valid, continue
	await next()
}

// Apply API key authentication middleware to all routes
app.use('*', apiKeyAuth)

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
				summary: 'Deprecated jobs endpoint',
				description: 'This endpoint has been deprecated. Use /events to append workflow activity.',
				tags: ['Jobs'],
				deprecated: true,
				responses: {
					'410': buildDeprecatedResponse('The /jobs endpoint has been deprecated. Use /events instead.'),
				},
			},
		},
		'/events': {
			post: {
				summary: 'Create a new event entry',
				description: 'Stores an event row in the `events` table. The payload is persisted as JSON text.',
				tags: ['Events'],
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['ts', 'payload'],
								properties: {
									id: {
										type: 'string',
										description:
											'Unique identifier for the event (primary key). If omitted, a UUID is generated automatically.',
										example: 'evt_123',
									},
									ts: {
										type: 'string',
										format: 'date-time',
										description: 'ISO8601 timestamp representing when the event occurred',
										example: '2024-01-01T12:00:00.000Z',
									},
									payload: {
										type: 'object',
										description: 'Arbitrary JSON payload describing the event',
										additionalProperties: true,
										example: { type: 'user.signup', user_id: 'user_42' },
									},
								},
							},
						},
					},
				},
				responses: {
					'201': {
						description: 'Event created successfully',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										success: { type: 'boolean', example: true },
										id: { type: 'string', example: 'evt_123' },
									},
								},
							},
						},
					},
					'400': {
						description: 'Bad request - validation error',
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
					'409': {
						description: 'Duplicate event id',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										error: { type: 'string', example: 'Event with this id already exists' },
									},
								},
							},
						},
					},
				},
			},
			get: {
				summary: 'Get events',
				description: 'Returns events from the `events` table ordered by timestamp descending. Use simple filters like id, before, after, and limit. For complex queries with nested JSON fields, use POST /events/query instead.',
				tags: ['Events'],
				parameters: [
					{
						name: 'limit',
						in: 'query',
						required: false,
						schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
						description: 'Maximum number of events to return (default 100, max 500)',
					},
					{
						name: 'after',
						in: 'query',
						required: false,
						schema: { type: 'string', format: 'date-time' },
						description: 'Return events with timestamps strictly greater than this ISO timestamp',
					},
					{
						name: 'before',
						in: 'query',
						required: false,
						schema: { type: 'string', format: 'date-time' },
						description: 'Return events with timestamps strictly less than this ISO timestamp',
					},
					{
						name: 'id',
						in: 'query',
						required: false,
						schema: { type: 'string' },
						description: 'Return a specific event by id',
					},
				],
				responses: {
					'200': {
						description: 'List of events',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										events: {
											type: 'array',
											items: {
												type: 'object',
												properties: {
													id: { type: 'string' },
													ts: { type: 'string', format: 'date-time' },
													payload: { type: 'object', additionalProperties: true },
												},
											},
										},
									},
								},
							},
						},
					},
					'400': {
						description: 'Bad request - invalid query params',
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
		'/events/query': {
			post: {
				summary: 'Query events by SQL',
				description:
					'Execute a custom SQL query against the events table. Use json_extract() to query nested JSON fields in the payload. Supports parameterized queries with ? placeholders. Only SELECT statements are allowed for security.',
				tags: ['Events'],
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['sql'],
								properties: {
									sql: {
										type: 'string',
										description: 'SQL SELECT query. Use ? for parameter placeholders.',
										example: "SELECT id, ts, json_extract(payload, '$.type') as type FROM events WHERE json_extract(payload, '$.user_id') = ?",
									},
									params: {
										type: 'array',
										description: 'Array of parameter values to bind to ? placeholders',
										items: {
											oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }],
										},
										example: ['user_123'],
									},
								},
							},
						},
					},
				},
				responses: {
					'200': {
						description: 'Query results',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										results: {
											type: 'array',
											items: {
												type: 'object',
												additionalProperties: true,
											},
										},
										meta: {
											type: 'object',
											properties: {
												rows_read: { type: 'integer' },
												duration_ms: { type: 'number' },
											},
										},
									},
								},
							},
						},
					},
					'400': {
						description: 'Bad request - invalid SQL or parameters',
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
				summary: 'Deprecated runs endpoint',
				description: 'This endpoint has been deprecated. Use /events instead.',
				tags: ['Runs'],
				deprecated: true,
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
					'410': buildDeprecatedResponse('The /runs endpoint has been deprecated. Use /events instead.'),
				},
			},
		},
		'/runs/{run_id}/latest': {
			get: {
				summary: 'Deprecated runs endpoint',
				description: 'This endpoint has been deprecated. Use /events instead.',
				tags: ['Runs'],
				deprecated: true,
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
					'410': buildDeprecatedResponse('The /runs endpoint has been deprecated. Use /events instead.'),
				},
			},
		},
		'/executions/{n8n_execution_id}': {
			get: {
				summary: 'Deprecated executions endpoint',
				description: 'This endpoint has been deprecated. Use /events instead.',
				tags: ['Executions'],
				deprecated: true,
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
					'410': buildDeprecatedResponse('The /executions endpoint has been deprecated. Use /events instead.'),
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

const respondDeprecated = (c: Context, message: string) => {
	return c.json({ error: message, deprecated: true }, 410)
}

const isIsoTimestamp = (value: string) => {
	return !Number.isNaN(Date.parse(value))
}

const generateEventId = () => {
	const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
	if (cryptoApi?.randomUUID) {
		return cryptoApi.randomUUID()
	}

	// Fallback RFC4122 v4 style generator if crypto.randomUUID is unavailable
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
		const random = Math.floor(Math.random() * 16)
		const value = char === 'x' ? random : (random & 0x3) | 0x8
		return value.toString(16)
	})
}

// POST /jobs
// Deprecated endpoint placeholder
app.post('/jobs', (c) => {
	return respondDeprecated(c, JOBS_DEPRECATION_MESSAGE)
})

// POST /events
// Insert a new event row into the events table
app.post('/events', async (c) => {
	try {
		const body = await c.req.json<EventCreateRequest>()

		let eventId: string
		if (body.id !== undefined) {
			if (typeof body.id !== 'string' || body.id.trim().length === 0) {
				return c.json({ error: 'id must be a non-empty string when provided' }, 400)
			}
			eventId = body.id.trim()
		} else {
			eventId = generateEventId()
		}

		if (!body.ts || typeof body.ts !== 'string' || !isIsoTimestamp(body.ts)) {
			return c.json({ error: 'ts must be a valid ISO timestamp string' }, 400)
		}

		if (body.payload === undefined) {
			return c.json({ error: 'payload is required' }, 400)
		}

		let payloadJson: string
		try {
			payloadJson = JSON.stringify(body.payload)
		} catch {
			return c.json({ error: 'payload must be JSON-serializable' }, 400)
		}

		const stmt = c.env.DB.prepare(`INSERT INTO events (id, ts, payload) VALUES (?, ?, ?)`)
		const result = await stmt.bind(eventId, body.ts, payloadJson).run()

		if (!result.success) {
			return c.json({ error: 'Failed to insert event' }, 500)
		}

		return c.json({ success: true, id: eventId }, 201)
	} catch (error) {
		if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
			return c.json({ error: 'Event with this id already exists' }, 409)
		}
		return handleError(c, error)
	}
})

// GET /events
// Query event rows with optional filters
app.get('/events', async (c) => {
	try {
		const limitParam = c.req.query('limit')
		let limit = 100
		if (limitParam !== undefined) {
			const parsed = Number.parseInt(limitParam, 10)
			if (Number.isNaN(parsed) || parsed <= 0) {
				return c.json({ error: 'limit must be a positive integer' }, 400)
			}
			limit = Math.min(parsed, 500)
		}

		const after = c.req.query('after')
		if (after && !isIsoTimestamp(after)) {
			return c.json({ error: 'after must be a valid ISO timestamp' }, 400)
		}

		const before = c.req.query('before')
		if (before && !isIsoTimestamp(before)) {
			return c.json({ error: 'before must be a valid ISO timestamp' }, 400)
		}

		const eventId = c.req.query('id')

		const conditions: string[] = []
		const values: unknown[] = []

		if (eventId) {
			conditions.push('id = ?')
			values.push(eventId)
		}

		if (after) {
			conditions.push('ts > ?')
			values.push(after)
		}

		if (before) {
			conditions.push('ts < ?')
			values.push(before)
		}

		let query = 'SELECT * FROM events'
		if (conditions.length > 0) {
			query += ` WHERE ${conditions.join(' AND ')}`
		}
		query += ' ORDER BY ts DESC LIMIT ?'
		values.push(limit)

		const stmt = c.env.DB.prepare(query)
		const result = await stmt.bind(...values).all<EventRow>()

		if (!result.success) {
			return c.json({ error: 'Failed to fetch events' }, 500)
		}

		const events = (result.results || []).map((event) => {
			let parsedPayload: unknown = null
			try {
				parsedPayload = event.payload ? JSON.parse(event.payload) : null
			} catch {
				parsedPayload = event.payload
			}
			return {
				id: event.id,
				ts: event.ts,
				payload: parsedPayload,
			}
		})

		return c.json({ events }, 200)
	} catch (error) {
		return handleError(c, error)
	}
})

// POST /events/query
// Execute a read-only SQL query against the events table
app.post('/events/query', async (c) => {
	try {
		const body = await c.req.json<EventQueryRequest>()

		if (!body.sql || typeof body.sql !== 'string') {
			return c.json({ error: 'sql is required and must be a string' }, 400)
		}

		// Normalize and validate SQL - only allow SELECT statements
		const normalizedSql = body.sql.trim().toLowerCase()
		if (!normalizedSql.startsWith('select')) {
			return c.json({ error: 'Only SELECT queries are allowed' }, 400)
		}

		// Block dangerous keywords
		const dangerousKeywords = ['insert', 'update', 'delete', 'drop', 'alter', 'create', 'truncate', 'replace']
		for (const keyword of dangerousKeywords) {
			if (normalizedSql.includes(keyword)) {
				return c.json({ error: `Query contains forbidden keyword: ${keyword}` }, 400)
			}
		}

		const params = body.params || []
		if (!Array.isArray(params)) {
			return c.json({ error: 'params must be an array' }, 400)
		}

		const stmt = c.env.DB.prepare(body.sql)
		const startTime = Date.now()
		const result = await stmt.bind(...params).all()
		const duration = Date.now() - startTime

		if (!result.success) {
			return c.json({ error: 'Query execution failed' }, 500)
		}

		return c.json({
			results: result.results || [],
			meta: {
				rows_read: result.results?.length || 0,
				duration_ms: duration,
			},
		}, 200)
	} catch (error) {
		return handleError(c, error)
	}
})

// GET /runs/:run_id
// Deprecated endpoint placeholder
app.get('/runs/:run_id', (c) => {
	return respondDeprecated(c, RUNS_DEPRECATION_MESSAGE)
})

// GET /runs/:run_id/latest
// Deprecated endpoint placeholder
app.get('/runs/:run_id/latest', (c) => {
	return respondDeprecated(c, RUNS_DEPRECATION_MESSAGE)
})

// GET /executions/:n8n_execution_id
// Deprecated endpoint placeholder
app.get('/executions/:n8n_execution_id', (c) => {
	return respondDeprecated(c, EXECUTIONS_DEPRECATION_MESSAGE)
})

export default app
