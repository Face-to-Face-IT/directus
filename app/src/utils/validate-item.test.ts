import { DeepPartial, Field } from '@directus/types';
import { createTestingPinia } from '@pinia/testing';
import { setActivePinia } from 'pinia';
import { beforeEach, expect, test, vi } from 'vitest';
import { computed, type ComputedRef } from 'vue';
import { validateItem } from '@/utils/validate-item';

const parentFormContext = vi.hoisted(() => ({
	useParentFormContext: vi.fn((): ComputedRef<Record<string, any> | null> => computed(() => null)),
}));

vi.mock('@/composables/use-parent-form-context', () => parentFormContext);

vi.mock('@/utils/parse-filter', () => ({
	parseFilter: (filter: any) => {
		// Simulate resolving $NOW to actual date, matching real parseFilter behavior
		const resolved = JSON.parse(JSON.stringify(filter), (_key, value) => {
			if (typeof value === 'string' && value.startsWith('$NOW')) return new Date().toISOString();
			return value;
		});

		return resolved;
	},
}));

const fields: DeepPartial<Field>[] = [
	{
		field: 'id',
		collection: 'users',
		type: 'integer',
		name: 'ID',
		meta: {
			required: true,
		},
		schema: null,
	},
	{
		field: 'name',
		collection: 'users',
		type: 'string',
		name: 'Name',
		meta: {
			required: true,
		},
		schema: null,
	},
	{
		field: 'email',
		collection: 'users',
		type: 'string',
		name: 'Email',
		schema: null,
	},
	{
		field: 'role',
		collection: 'users',
		type: 'integer',
		name: 'Role',
		meta: {
			required: true,
		},
		schema: null,
	},
];

beforeEach(() => {
	setActivePinia(
		createTestingPinia({
			createSpy: () => (_collection, field) => {
				if (field === 'role') {
					return [{ some: 'relation' }];
				}

				return [];
			},
		}),
	);
});

test('Required fields', () => {
	let result = validateItem(
		{
			id: 1,
			name: 'test',
			email: 'test@test.com',
			role: [1, 2],
		},
		fields as Field[],
		true,
	);

	expect(result.length).toEqual(0);

	result = validateItem(
		{
			id: 1,
			name: 'test',
			email: 'test@test.com',
			role: [],
		},
		fields as Field[],
		true,
	);

	expect(result.length).toEqual(1);
});

test('Custom validation with $NOW dynamic variable does not throw', () => {
	const fieldsWithValidation: DeepPartial<Field>[] = [
		{
			field: 'publish_date',
			collection: 'articles',
			type: 'timestamp',
			name: 'Publish Date',
			meta: {
				required: false,
				validation: {
					_and: [
						{
							publish_date: {
								_gte: '$NOW',
							},
						},
					],
				},
			},
			schema: null,
		},
	];

	const futureDate = new Date(Date.now() + 86400000).toISOString();

	const result = validateItem({ publish_date: futureDate }, fieldsWithValidation as Field[], true, true);

	expect(result.length).toEqual(0);
});

test('$form-based condition hides required field — no validation error when parent form context present', () => {
	// Simulate being inside a parent drawer by returning a non-null parent form context.
	// The condition rule checks "$form._nnull: true", which matches when $form is non-null.
	parentFormContext.useParentFormContext.mockReturnValue(computed(() => ({ id: 1, title: 'Parent item' })));

	const fieldsWithFormCondition: DeepPartial<Field>[] = [
		{
			field: 'category',
			collection: 'notes',
			type: 'string',
			name: 'Category',
			meta: {
				required: true,
				hidden: false,
				conditions: [
					{
						name: 'Hide in drawer',
						rule: { $form: { _nnull: true } },
						hidden: true,
						readonly: false,
						options: null,
						required: false,
					},
				],
			},
			schema: null,
		},
	];

	// category is null — would normally fail "required" validation.
	// But the $form condition matches (parent form context is non-null), hiding the field.
	const result = validateItem({ category: null }, fieldsWithFormCondition as Field[], true);

	expect(result.length).toEqual(0);
});

test('$form-based condition does NOT hide required field when parent form context is null (top-level)', () => {
	// No parent form context — $form is null, so { $form: { _nnull: true } } doesn't match.
	parentFormContext.useParentFormContext.mockReturnValue(computed(() => null));

	const fieldsWithFormCondition: DeepPartial<Field>[] = [
		{
			field: 'category',
			collection: 'notes',
			type: 'string',
			name: 'Category',
			meta: {
				required: true,
				hidden: false,
				conditions: [
					{
						name: 'Hide in drawer',
						rule: { $form: { _nnull: true } },
						hidden: true,
						readonly: false,
						options: null,
						required: false,
					},
				],
			},
			schema: null,
		},
	];

	// category is null — $form is null so condition doesn't match, field stays required.
	const result = validateItem({ category: null }, fieldsWithFormCondition as Field[], true);

	expect(result.length).toBeGreaterThan(0);
	expect(result[0]!.field).toBe('category');
});
