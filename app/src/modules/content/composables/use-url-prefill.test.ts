import api from '@/api';
import { useFieldsStore } from '@/stores/fields';
import { useRelationsStore } from '@/stores/relations';
import { createTestingPinia } from '@pinia/testing';
import { setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
	parseQueryParam,
	resolveRelationalLookup,
	resolveUrlPrefillData,
	RESERVED_QUERY_PARAMS,
	type ParsedRelationalParam,
} from './use-url-prefill';

vi.mock('@/api', () => ({
	default: {
		get: vi.fn(),
	},
}));

vi.mock('@/stores/relations', () => ({
	useRelationsStore: vi.fn(),
}));

vi.mock('@/stores/fields', () => ({
	useFieldsStore: vi.fn(),
}));

describe('use-url-prefill', () => {
	beforeEach(() => {
		setActivePinia(
			createTestingPinia({
				createSpy: vi.fn,
				stubActions: false,
			}),
		);

		// Default mock implementations
		vi.mocked(useRelationsStore).mockReturnValue({
			getRelationForField: vi.fn().mockReturnValue(null),
		} as any);

		vi.mocked(useFieldsStore).mockReturnValue({
			getPrimaryKeyFieldForCollection: vi.fn().mockReturnValue({ field: 'id' }),
		} as any);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('RESERVED_QUERY_PARAMS', () => {
		test('should include expected reserved parameters', () => {
			expect(RESERVED_QUERY_PARAMS).toContain('bookmark');
			expect(RESERVED_QUERY_PARAMS).toContain('version');
			expect(RESERVED_QUERY_PARAMS).toContain('all');
			expect(RESERVED_QUERY_PARAMS).toContain('archived');
		});
	});

	describe('parseQueryParam', () => {
		test('should return null for reserved query params', () => {
			expect(parseQueryParam('bookmark', '123', 'articles')).toBeNull();
			expect(parseQueryParam('version', '1', 'articles')).toBeNull();
			expect(parseQueryParam('all', 'true', 'articles')).toBeNull();
			expect(parseQueryParam('archived', 'true', 'articles')).toBeNull();
		});

		test('should parse direct field values', () => {
			const result = parseQueryParam('status', 'draft', 'articles');

			expect(result).toEqual({
				field: 'status',
				value: 'draft',
				isRelational: false,
			});
		});

		test('should parse numeric direct field values', () => {
			const result = parseQueryParam('priority', '5', 'tasks');

			expect(result).toEqual({
				field: 'priority',
				value: '5',
				isRelational: false,
			});
		});

		test('should return null for invalid dot notation (empty parts)', () => {
			expect(parseQueryParam('.field', 'value', 'articles')).toBeNull();
			expect(parseQueryParam('field.', 'value', 'articles')).toBeNull();
		});

		test('should return null for dot notation when field is not a relation', () => {
			vi.mocked(useRelationsStore).mockReturnValue({
				getRelationForField: vi.fn().mockReturnValue(null),
			} as any);

			const result = parseQueryParam('nonexistent.field', 'value', 'articles');

			expect(result).toBeNull();
		});

		test('should parse relational lookup syntax', () => {
			vi.mocked(useRelationsStore).mockReturnValue({
				getRelationForField: vi.fn().mockReturnValue({
					related_collection: 'programs',
				}),
			} as any);

			const result = parseQueryParam('program.abbreviation', 'ABC', 'cases');

			expect(result).toEqual({
				field: 'program',
				lookupField: 'abbreviation',
				lookupValue: 'ABC',
				isRelational: true,
				relatedCollection: 'programs',
			});
		});

		test('should handle different lookup fields for same relation', () => {
			vi.mocked(useRelationsStore).mockReturnValue({
				getRelationForField: vi.fn().mockReturnValue({
					related_collection: 'users',
				}),
			} as any);

			const resultByEmail = parseQueryParam('author.email', 'test@example.com', 'articles');
			const resultByUsername = parseQueryParam('author.username', 'john', 'articles');

			expect(resultByEmail).toEqual({
				field: 'author',
				lookupField: 'email',
				lookupValue: 'test@example.com',
				isRelational: true,
				relatedCollection: 'users',
			});

			expect(resultByUsername).toEqual({
				field: 'author',
				lookupField: 'username',
				lookupValue: 'john',
				isRelational: true,
				relatedCollection: 'users',
			});
		});

		test('should only use first two parts of deeply nested dot notation', () => {
			vi.mocked(useRelationsStore).mockReturnValue({
				getRelationForField: vi.fn().mockReturnValue({
					related_collection: 'programs',
				}),
			} as any);

			const result = parseQueryParam('program.meta.value', 'test', 'cases');

			// Should parse with 'meta' as the lookup field (second part only)
			expect(result).toEqual({
				field: 'program',
				lookupField: 'meta',
				lookupValue: 'test',
				isRelational: true,
				relatedCollection: 'programs',
			});
		});
	});

	describe('resolveRelationalLookup', () => {
		test('should return null when relatedCollection is null', async () => {
			const param: ParsedRelationalParam = {
				field: 'program',
				lookupField: 'abbreviation',
				lookupValue: 'ABC',
				isRelational: true,
				relatedCollection: null,
			};

			const result = await resolveRelationalLookup(param);

			expect(result).toBeNull();
		});

		test('should return null when primary key field is not found', async () => {
			vi.mocked(useFieldsStore).mockReturnValue({
				getPrimaryKeyFieldForCollection: vi.fn().mockReturnValue(null),
			} as any);

			const param: ParsedRelationalParam = {
				field: 'program',
				lookupField: 'abbreviation',
				lookupValue: 'ABC',
				isRelational: true,
				relatedCollection: 'programs',
			};

			const result = await resolveRelationalLookup(param);

			expect(result).toBeNull();
		});

		test('should resolve relational lookup successfully', async () => {
			vi.mocked(useFieldsStore).mockReturnValue({
				getPrimaryKeyFieldForCollection: vi.fn().mockReturnValue({ field: 'id' }),
			} as any);

			vi.mocked(api.get).mockResolvedValue({
				data: {
					data: [{ id: 42 }],
				},
			});

			const param: ParsedRelationalParam = {
				field: 'program',
				lookupField: 'abbreviation',
				lookupValue: 'ABC',
				isRelational: true,
				relatedCollection: 'programs',
			};

			const result = await resolveRelationalLookup(param);

			expect(result).toEqual({
				field: 'program',
				value: 42,
			});

			expect(api.get).toHaveBeenCalledWith('/items/programs', {
				params: {
					filter: { abbreviation: { _eq: 'ABC' } },
					fields: ['id'],
					limit: 1,
				},
			});
		});

		test('should return null when no items are found', async () => {
			vi.mocked(useFieldsStore).mockReturnValue({
				getPrimaryKeyFieldForCollection: vi.fn().mockReturnValue({ field: 'id' }),
			} as any);

			vi.mocked(api.get).mockResolvedValue({
				data: {
					data: [],
				},
			});

			const param: ParsedRelationalParam = {
				field: 'program',
				lookupField: 'abbreviation',
				lookupValue: 'NONEXISTENT',
				isRelational: true,
				relatedCollection: 'programs',
			};

			const result = await resolveRelationalLookup(param);

			expect(result).toBeNull();
		});

		test('should return null when API call fails', async () => {
			vi.mocked(useFieldsStore).mockReturnValue({
				getPrimaryKeyFieldForCollection: vi.fn().mockReturnValue({ field: 'id' }),
			} as any);

			vi.mocked(api.get).mockRejectedValue(new Error('API Error'));

			const param: ParsedRelationalParam = {
				field: 'program',
				lookupField: 'abbreviation',
				lookupValue: 'ABC',
				isRelational: true,
				relatedCollection: 'programs',
			};

			const result = await resolveRelationalLookup(param);

			expect(result).toBeNull();
		});

		test('should handle custom primary key field names', async () => {
			vi.mocked(useFieldsStore).mockReturnValue({
				getPrimaryKeyFieldForCollection: vi.fn().mockReturnValue({ field: 'uuid' }),
			} as any);

			vi.mocked(api.get).mockResolvedValue({
				data: {
					data: [{ uuid: 'abc-123-def' }],
				},
			});

			const param: ParsedRelationalParam = {
				field: 'category',
				lookupField: 'slug',
				lookupValue: 'electronics',
				isRelational: true,
				relatedCollection: 'categories',
			};

			const result = await resolveRelationalLookup(param);

			expect(result).toEqual({
				field: 'category',
				value: 'abc-123-def',
			});

			expect(api.get).toHaveBeenCalledWith('/items/categories', {
				params: {
					filter: { slug: { _eq: 'electronics' } },
					fields: ['uuid'],
					limit: 1,
				},
			});
		});
	});

	describe('resolveUrlPrefillData', () => {
		test('should return empty object for empty query', async () => {
			const result = await resolveUrlPrefillData({}, 'articles');

			expect(result).toEqual({});
		});

		test('should skip reserved query params', async () => {
			const result = await resolveUrlPrefillData(
				{
					bookmark: '123',
					version: '1',
					status: 'draft',
				},
				'articles',
			);

			expect(result).toEqual({
				status: 'draft',
			});
		});

		test('should handle multiple direct field values', async () => {
			const result = await resolveUrlPrefillData(
				{
					status: 'draft',
					priority: 'high',
					title: 'Test Article',
				},
				'articles',
			);

			expect(result).toEqual({
				status: 'draft',
				priority: 'high',
				title: 'Test Article',
			});
		});

		test('should skip fields that already have edits', async () => {
			const result = await resolveUrlPrefillData(
				{
					status: 'draft',
					title: 'From URL',
				},
				'articles',
				{ title: 'Already edited' },
			);

			expect(result).toEqual({
				status: 'draft',
			});
		});

		test('should resolve relational lookups', async () => {
			vi.mocked(useRelationsStore).mockReturnValue({
				getRelationForField: vi.fn().mockReturnValue({
					related_collection: 'programs',
				}),
			} as any);

			vi.mocked(useFieldsStore).mockReturnValue({
				getPrimaryKeyFieldForCollection: vi.fn().mockReturnValue({ field: 'id' }),
			} as any);

			vi.mocked(api.get).mockResolvedValue({
				data: {
					data: [{ id: 42 }],
				},
			});

			const result = await resolveUrlPrefillData(
				{
					'program.abbreviation': 'ABC',
				},
				'cases',
			);

			expect(result).toEqual({
				program: 42,
			});
		});

		test('should handle mixed direct and relational params', async () => {
			vi.mocked(useRelationsStore).mockReturnValue({
				getRelationForField: vi.fn((_collection, field) => {
					if (field === 'program') {
						return { related_collection: 'programs' };
					}

					return null;
				}),
			} as any);

			vi.mocked(useFieldsStore).mockReturnValue({
				getPrimaryKeyFieldForCollection: vi.fn().mockReturnValue({ field: 'id' }),
			} as any);

			vi.mocked(api.get).mockResolvedValue({
				data: {
					data: [{ id: 99 }],
				},
			});

			const result = await resolveUrlPrefillData(
				{
					status: 'active',
					'program.abbreviation': 'XYZ',
					priority: 'high',
				},
				'cases',
			);

			expect(result).toEqual({
				status: 'active',
				priority: 'high',
				program: 99,
			});
		});

		test('should handle multiple relational lookups in parallel', async () => {
			vi.mocked(useRelationsStore).mockReturnValue({
				getRelationForField: vi.fn((_collection, field) => {
					if (field === 'program') {
						return { related_collection: 'programs' };
					}

					if (field === 'assigned_to') {
						return { related_collection: 'users' };
					}

					return null;
				}),
			} as any);

			vi.mocked(useFieldsStore).mockReturnValue({
				getPrimaryKeyFieldForCollection: vi.fn().mockReturnValue({ field: 'id' }),
			} as any);

			vi.mocked(api.get)
				.mockResolvedValueOnce({
					data: { data: [{ id: 10 }] },
				})
				.mockResolvedValueOnce({
					data: { data: [{ id: 20 }] },
				});

			const result = await resolveUrlPrefillData(
				{
					'program.abbreviation': 'ABC',
					'assigned_to.username': 'jsmith',
				},
				'cases',
			);

			// Both should be resolved
			expect(result.program).toBeDefined();
			expect(result.assigned_to).toBeDefined();
		});

		test('should skip relational field if already edited', async () => {
			vi.mocked(useRelationsStore).mockReturnValue({
				getRelationForField: vi.fn().mockReturnValue({
					related_collection: 'programs',
				}),
			} as any);

			const result = await resolveUrlPrefillData(
				{
					'program.abbreviation': 'ABC',
				},
				'cases',
				{ program: 999 }, // Already edited
			);

			expect(result).toEqual({});
			expect(api.get).not.toHaveBeenCalled();
		});

		test('should gracefully handle failed relational lookups', async () => {
			vi.mocked(useRelationsStore).mockReturnValue({
				getRelationForField: vi.fn().mockReturnValue({
					related_collection: 'programs',
				}),
			} as any);

			vi.mocked(useFieldsStore).mockReturnValue({
				getPrimaryKeyFieldForCollection: vi.fn().mockReturnValue({ field: 'id' }),
			} as any);

			vi.mocked(api.get).mockRejectedValue(new Error('Not found'));

			const result = await resolveUrlPrefillData(
				{
					status: 'active',
					'program.abbreviation': 'NONEXISTENT',
				},
				'cases',
			);

			// Should still include direct field, but not the failed relational lookup
			expect(result).toEqual({
				status: 'active',
			});
		});
	});
});
