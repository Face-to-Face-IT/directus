import { useEnv } from '@directus/env';
import { SchemaBuilder } from '@directus/schema-builder';
import type { Permission } from '@directus/types';
import knex from 'knex';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Client_SQLite3 } from './mock.js';
import { applyRelationalSearch, isRelationalField } from './search-relational.js';

vi.mock('@directus/env', () => ({
	useEnv: vi.fn().mockReturnValue({ RELATIONAL_SEARCH_MAX_DEPTH: 2 }),
}));

const adminPermissions: Permission[] = [];

describe('isRelationalField', () => {
	test('returns true for m2o fields', () => {
		const schema = new SchemaBuilder()
			.collection('articles', (c) => {
				c.field('id').id();
				c.field('author').m2o('users');
			})
			.build();

		expect(isRelationalField(schema.collections['articles']!.fields['author']!)).toBe(true);
	});

	test('returns true for o2m fields', () => {
		const schema = new SchemaBuilder()
			.collection('countries', (c) => {
				c.field('id').id();
				c.field('cities').o2m('cities', 'country_id');
			})
			.build();

		expect(isRelationalField(schema.collections['countries']!.fields['cities']!)).toBe(true);
	});

	test('returns true for m2m fields', () => {
		const schema = new SchemaBuilder()
			.collection('articles', (c) => {
				c.field('id').id();
				c.field('tags').m2m('tags');
			})
			.build();

		expect(isRelationalField(schema.collections['articles']!.fields['tags']!)).toBe(true);
	});

	test('returns true for translations fields', () => {
		const schema = new SchemaBuilder()
			.collection('articles', (c) => {
				c.field('id').id();
				c.field('translations').translations();
			})
			.build();

		expect(isRelationalField(schema.collections['articles']!.fields['translations']!)).toBe(true);
	});

	test('returns false for primitive fields', () => {
		const schema = new SchemaBuilder()
			.collection('test', (c) => {
				c.field('id').id();
				c.field('name').string();
			})
			.build();

		expect(isRelationalField(schema.collections['test']!.fields['name']!)).toBe(false);
	});
});

describe('applyRelationalSearch', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	beforeEach(() => {
		vi.mocked(useEnv).mockReturnValue({ RELATIONAL_SEARCH_MAX_DEPTH: 2 } as any);
	});

	describe('M2O search', () => {
		const schema = new SchemaBuilder()
			.collection('articles', (c) => {
				c.field('id').id();
				c.field('title').string();
				c.field('author').m2o('users');
			})
			.collection('users', (c) => {
				c.field('id').id();
				c.field('name').string();
				c.field('email').string();
			})
			.build();

		test('generates EXISTS subquery for M2O relation', () => {
			const db = vi.mocked(knex.default({ client: Client_SQLite3 }));
			const queryBuilder = db.queryBuilder();

			queryBuilder.where(function () {
				applyRelationalSearch(
					db as any,
					schema,
					this,
					'john',
					'articles',
					'author',
					schema.collections['articles']!.fields['author']!,
					adminPermissions,
					1,
					new Set(['articles']),
				);
			});

			const rawQuery = queryBuilder.toSQL();

			// Should generate: EXISTS (SELECT 1 FROM users WHERE users.id = articles.author AND (...))
			expect(rawQuery.sql).toContain('exists');
			expect(rawQuery.sql).toContain('"users"');
			expect(rawQuery.sql).toContain('LOWER');
			expect(rawQuery.bindings).toContain('%john%');
		});

		test('does not search when depth exceeds max', () => {
			vi.mocked(useEnv).mockReturnValue({ RELATIONAL_SEARCH_MAX_DEPTH: 1 } as any);

			const db = vi.mocked(knex.default({ client: Client_SQLite3 }));
			const queryBuilder = db.queryBuilder();

			queryBuilder.where(function () {
				applyRelationalSearch(
					db as any,
					schema,
					this,
					'john',
					'articles',
					'author',
					schema.collections['articles']!.fields['author']!,
					adminPermissions,
					2, // Exceeds max depth of 1
					new Set(['articles']),
				);
			});

			const rawQuery = queryBuilder.toSQL();

			// Should not add any conditions
			expect(rawQuery.sql).toEqual('select *');
		});

		test('does not search when RELATIONAL_SEARCH_MAX_DEPTH is 0', () => {
			vi.mocked(useEnv).mockReturnValue({ RELATIONAL_SEARCH_MAX_DEPTH: 0 } as any);

			const db = vi.mocked(knex.default({ client: Client_SQLite3 }));
			const queryBuilder = db.queryBuilder();

			queryBuilder.where(function () {
				applyRelationalSearch(
					db as any,
					schema,
					this,
					'john',
					'articles',
					'author',
					schema.collections['articles']!.fields['author']!,
					adminPermissions,
					1,
					new Set(['articles']),
				);
			});

			const rawQuery = queryBuilder.toSQL();

			expect(rawQuery.sql).toEqual('select *');
		});
	});

	describe('O2M search', () => {
		const schema = new SchemaBuilder()
			.collection('countries', (c) => {
				c.field('id').id();
				c.field('name').string();
				c.field('cities').o2m('cities', 'country_id');
			})
			.collection('cities', (c) => {
				c.field('id').id();
				c.field('name').string();
			})
			.build();

		test('generates EXISTS subquery for O2M relation', () => {
			const db = vi.mocked(knex.default({ client: Client_SQLite3 }));
			const queryBuilder = db.queryBuilder();

			queryBuilder.where(function () {
				applyRelationalSearch(
					db as any,
					schema,
					this,
					'paris',
					'countries',
					'cities',
					schema.collections['countries']!.fields['cities']!,
					adminPermissions,
					1,
					new Set(['countries']),
				);
			});

			const rawQuery = queryBuilder.toSQL();

			expect(rawQuery.sql).toContain('exists');
			expect(rawQuery.sql).toContain('"cities"');
			expect(rawQuery.bindings).toContain('%paris%');
		});
	});

	describe('M2M search', () => {
		const schema = new SchemaBuilder()
			.collection('articles', (c) => {
				c.field('id').id();
				c.field('title').string();
				c.field('tags').m2m('tags');
			})
			.collection('tags', (c) => {
				c.field('id').id();
				c.field('name').string();
			})
			.build();

		test('generates nested EXISTS subqueries for M2M relation via junction', () => {
			const db = vi.mocked(knex.default({ client: Client_SQLite3 }));
			const queryBuilder = db.queryBuilder();

			queryBuilder.where(function () {
				applyRelationalSearch(
					db as any,
					schema,
					this,
					'javascript',
					'articles',
					'tags',
					schema.collections['articles']!.fields['tags']!,
					adminPermissions,
					1,
					new Set(['articles']),
				);
			});

			const rawQuery = queryBuilder.toSQL();

			// Should have nested EXISTS: junction table and target table
			expect(rawQuery.sql).toContain('exists');
			expect(rawQuery.sql).toContain('"tags"');
			expect(rawQuery.bindings).toContain('%javascript%');
		});
	});

	describe('Translations search', () => {
		const schema = new SchemaBuilder()
			.collection('articles', (c) => {
				c.field('id').id();
				c.field('title').string();
				c.field('translations').translations();
			})
			.build();

		test('generates nested EXISTS subqueries for translations relation', () => {
			const db = vi.mocked(knex.default({ client: Client_SQLite3 }));
			const queryBuilder = db.queryBuilder();

			// The translations junction should have been auto-created by SchemaBuilder
			queryBuilder.where(function () {
				applyRelationalSearch(
					db as any,
					schema,
					this,
					'hola',
					'articles',
					'translations',
					schema.collections['articles']!.fields['translations']!,
					adminPermissions,
					1,
					new Set(['articles']),
				);
			});

			const rawQuery = queryBuilder.toSQL();

			expect(rawQuery.sql).toContain('exists');
			expect(rawQuery.bindings).toContain('%hola%');
		});
	});

	describe('Cycle detection', () => {
		const schema = new SchemaBuilder()
			.collection('a', (c) => {
				c.field('id').id();
				c.field('name').string();
				c.field('b_ref').m2o('b');
			})
			.collection('b', (c) => {
				c.field('id').id();
				c.field('name').string();
				c.field('a_ref').m2o('a');
			})
			.build();

		test('stops recursing when a cycle is detected', () => {
			const db = vi.mocked(knex.default({ client: Client_SQLite3 }));
			const queryBuilder = db.queryBuilder();

			// Search from 'a' → 'b' should work, but 'b' → 'a' should be stopped (cycle)
			queryBuilder.where(function () {
				applyRelationalSearch(
					db as any,
					schema,
					this,
					'test',
					'a',
					'b_ref',
					schema.collections['a']!.fields['b_ref']!,
					adminPermissions,
					1,
					new Set(['a']), // 'a' already visited
				);
			});

			const rawQuery = queryBuilder.toSQL();

			// Should search 'b' fields but not recurse back to 'a'
			expect(rawQuery.sql).toContain('exists');
			expect(rawQuery.sql).toContain('"b"');
			// Should not have a second level of EXISTS going back to 'a'
			// (the SQL should only have one level of nesting for b's fields)
		});

		test('does not search already visited collection', () => {
			const db = vi.mocked(knex.default({ client: Client_SQLite3 }));
			const queryBuilder = db.queryBuilder();

			// If 'b' is already in visited, should not search it
			queryBuilder.where(function () {
				applyRelationalSearch(
					db as any,
					schema,
					this,
					'test',
					'a',
					'b_ref',
					schema.collections['a']!.fields['b_ref']!,
					adminPermissions,
					1,
					new Set(['a', 'b']), // Both already visited
				);
			});

			const rawQuery = queryBuilder.toSQL();

			// Should not add any conditions since 'b' was already visited
			expect(rawQuery.sql).toEqual('select *');
		});
	});

	describe('Permission filtering', () => {
		const schema = new SchemaBuilder()
			.collection('articles', (c) => {
				c.field('id').id();
				c.field('title').string();
				c.field('author').m2o('users');
			})
			.collection('users', (c) => {
				c.field('id').id();
				c.field('name').string();
				c.field('email').string();

				c.field('secret')
					.string()
					.options({ special: ['conceal'] });
			})
			.build();

		test('excludes concealed fields on related collections', () => {
			const db = vi.mocked(knex.default({ client: Client_SQLite3 }));
			const queryBuilder = db.queryBuilder();

			queryBuilder.where(function () {
				applyRelationalSearch(
					db as any,
					schema,
					this,
					'test',
					'articles',
					'author',
					schema.collections['articles']!.fields['author']!,
					adminPermissions,
					1,
					new Set(['articles']),
				);
			});

			const rawQuery = queryBuilder.toSQL();

			// Should search name and email but not secret
			expect(rawQuery.sql).toContain('"users"."name"');
			expect(rawQuery.sql).toContain('"users"."email"');
			expect(rawQuery.sql).not.toContain('"users"."secret"');
		});

		test('respects field-level permissions on related collections', () => {
			const db = vi.mocked(knex.default({ client: Client_SQLite3 }));
			const queryBuilder = db.queryBuilder();

			const restrictedPermissions: Permission[] = [
				{
					collection: 'users',
					action: 'read',
					fields: ['name'], // Only name is allowed, not email
					permissions: {
						name: {},
					},
				} as unknown as Permission,
			];

			queryBuilder.where(function () {
				applyRelationalSearch(
					db as any,
					schema,
					this,
					'test',
					'articles',
					'author',
					schema.collections['articles']!.fields['author']!,
					restrictedPermissions,
					1,
					new Set(['articles']),
				);
			});

			const rawQuery = queryBuilder.toSQL();

			// Should only search name
			expect(rawQuery.sql).toContain('"users"."name"');
			expect(rawQuery.sql).not.toContain('"users"."email"');
		});
	});

	describe('Non-searchable fields on related collections', () => {
		test('excludes non-searchable fields on related collections', () => {
			const schema = new SchemaBuilder()
				.collection('articles', (c) => {
					c.field('id').id();
					c.field('author').m2o('users');
				})
				.collection('users', (c) => {
					c.field('id').id();
					c.field('name').string();
					c.field('internal_code').string().options({ searchable: false });
				})
				.build();

			const db = vi.mocked(knex.default({ client: Client_SQLite3 }));
			const queryBuilder = db.queryBuilder();

			queryBuilder.where(function () {
				applyRelationalSearch(
					db as any,
					schema,
					this,
					'test',
					'articles',
					'author',
					schema.collections['articles']!.fields['author']!,
					adminPermissions,
					1,
					new Set(['articles']),
				);
			});

			const rawQuery = queryBuilder.toSQL();

			expect(rawQuery.sql).toContain('"users"."name"');
			expect(rawQuery.sql).not.toContain('"users"."internal_code"');
		});
	});

	describe('M2A search', () => {
		const schema = new SchemaBuilder()
			.collection('pages', (c) => {
				c.field('id').id();
				c.field('title').string();
				c.field('blocks').m2a(['text_blocks', 'image_blocks']);
			})
			.collection('text_blocks', (c) => {
				c.field('id').id();
				c.field('content').text();
			})
			.collection('image_blocks', (c) => {
				c.field('id').id();
				c.field('alt_text').string();
			})
			.build();

		test('generates EXISTS subqueries for each allowed collection in M2A', () => {
			const db = vi.mocked(knex.default({ client: Client_SQLite3 }));
			const queryBuilder = db.queryBuilder();

			queryBuilder.where(function () {
				applyRelationalSearch(
					db as any,
					schema,
					this,
					'hello',
					'pages',
					'blocks',
					schema.collections['pages']!.fields['blocks']!,
					adminPermissions,
					1,
					new Set(['pages']),
				);
			});

			const rawQuery = queryBuilder.toSQL();

			expect(rawQuery.sql).toContain('exists');
			// Should search across both text_blocks and image_blocks
			expect(rawQuery.bindings).toContain('%hello%');
		});
	});
});
