import test from 'node:test'
import assert from 'node:assert/strict'

import app from '../src/index'

type StoredEvent = {
	id: string
	ts: string
	payload: string
}

class MockD1Database {
	public inserts: StoredEvent[] = []

	prepare(query: string) {
		const db = this
		return {
			query,
			values: [] as unknown[],
			bind(...values: unknown[]) {
				this.values = values
				return this
			},
			async run() {
				if (query.startsWith('INSERT INTO events')) {
					const [id, ts, payload] = this.values as [string, string, string]
					db.inserts.push({ id, ts, payload })
					return {
						success: true,
						meta: { last_row_id: 0, changes: 1 },
					}
				}
				throw new Error(`Unexpected query: ${query}`)
			},
			async all() {
				return { success: true, results: [], meta: { last_row_id: 0, changes: 0 } }
			},
			async first() {
				return null
			},
		}
	}

	async exec() {
		return { count: 0, duration: 0 }
	}
}

class MockR2Bucket {
	public storage = new Map<string, string>()

	async put(key: string, value: string) {
		this.storage.set(key, value)
		return {
			key,
			size: value.length,
			etag: 'etag',
			uploaded: new Date(),
		}
	}

	async get(key: string) {
		const body = this.storage.get(key)
		return body
			? {
					key,
					size: body.length,
					etag: 'etag',
					uploaded: new Date(),
					body,
					bodyUsed: false,
				}
			: null
	}

	async delete() {}
}

test('POST /events uploads payload.data to R2 and stores pointer', async () => {
	const db = new MockD1Database()
	const r2 = new MockR2Bucket()
	const env = {
		DB: db,
		R2: r2,
		API_KEY: undefined,
	}

	const response = await app.fetch(
		new Request('https://example.com/events', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				payload: {
					type: 'workflow.completed',
					data: { foo: 'bar', answer: 42 },
				},
			}),
		}),
		env as any
	)

	assert.equal(response.status, 201)
	const body = (await response.json()) as { success: boolean; id: string }
	assert.equal(body.success, true)
	assert.ok(body.id, 'response should include generated id')

	assert.equal(db.inserts.length, 1)
	const storedPayload = JSON.parse(db.inserts[0].payload) as Record<string, unknown>
	assert.equal(storedPayload.type, 'workflow.completed')
	assert.equal(typeof storedPayload.data, 'undefined')
	assert.ok(typeof storedPayload.data_pointer === 'string')

	const storedData = r2.storage.get(storedPayload.data_pointer as string)
	assert.equal(storedData, JSON.stringify({ foo: 'bar', answer: 42 }))
})

