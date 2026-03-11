import { useEnv } from '@directus/env';
import type { FieldOverview, Permission, Relation, SchemaOverview } from '@directus/types';
import { getRelationInfo } from '@directus/utils';
import type { Knex } from 'knex';
import { getCases } from '../../../../permissions/modules/process-ast/lib/get-cases.js';

/**
 * Relational field types that can be searched through.
 * These correspond to values found in `field.special`.
 */
const RELATIONAL_SPECIALS = new Set(['m2o', 'o2m', 'm2m', 'file', 'files', 'translations', 'm2a']);

/**
 * Check whether a field is a relational type that we can search through.
 */
export function isRelationalField(field: FieldOverview): boolean {
	return field.special.some((s) => RELATIONAL_SPECIALS.has(s));
}

/**
 * Get the maximum relational search depth from the environment configuration.
 * Returns 0 (disabled) by default.
 */
function getMaxRelationalDepth(): number {
	const env = useEnv();
	return Number(env['RELATIONAL_SEARCH_MAX_DEPTH']) || 0;
}

/**
 * Apply relational search conditions using EXISTS subqueries.
 *
 * This function adds OR conditions to the query builder for relational fields,
 * using EXISTS subqueries to avoid duplicate rows (which JOINs would cause).
 *
 * Cycle detection is performed via a `visited` Set of collection names to prevent
 * infinite recursion when circular relationships exist (e.g., A → B → A).
 */
export function applyRelationalSearch(
	knex: Knex,
	schema: SchemaOverview,
	queryBuilder: Knex.QueryBuilder,
	searchQuery: string,
	collection: string,
	fieldName: string,
	field: FieldOverview,
	permissions: Permission[],
	currentDepth: number,
	visited: Set<string>,
): void {
	const maxDepth = getMaxRelationalDepth();

	// Depth limit exceeded — stop recursing
	if (maxDepth === 0 || currentDepth > maxDepth) return;

	// Determine relation type from the field's special markers
	const specialType = getSpecialRelationType(field);

	if (!specialType) return;

	const { relation } = getRelationInfo(schema.relations, collection, fieldName);

	if (!relation) return;

	switch (specialType) {
		case 'm2o':
		case 'file':
			applyM2OSearch(knex, schema, queryBuilder, searchQuery, collection, relation, permissions, currentDepth, visited);
			break;
		case 'o2m':
			applyO2MSearch(knex, schema, queryBuilder, searchQuery, collection, relation, permissions, currentDepth, visited);
			break;
		case 'm2m':
		case 'files':
		case 'translations':
			applyM2MSearch(knex, schema, queryBuilder, searchQuery, collection, relation, permissions, currentDepth, visited);
			break;
		case 'm2a':
			applyM2ASearch(knex, schema, queryBuilder, searchQuery, collection, relation, permissions, currentDepth, visited);
			break;
	}
}

/**
 * Extract the primary relational type from a field's special array.
 */
function getSpecialRelationType(
	field: FieldOverview,
): 'm2o' | 'o2m' | 'm2m' | 'file' | 'files' | 'translations' | 'm2a' | null {
	for (const s of field.special) {
		if (RELATIONAL_SPECIALS.has(s)) {
			return s as 'm2o' | 'o2m' | 'm2m' | 'file' | 'files' | 'translations' | 'm2a';
		}
	}

	return null;
}

/**
 * M2O: The current collection stores the foreign key.
 * We search the related collection's searchable fields via EXISTS.
 *
 * Example: articles.author_id → users.id
 * SQL: EXISTS (SELECT 1 FROM users WHERE users.id = articles.author_id AND (users.name LIKE ...))
 */
function applyM2OSearch(
	knex: Knex,
	schema: SchemaOverview,
	queryBuilder: Knex.QueryBuilder,
	searchQuery: string,
	collection: string,
	relation: Relation,
	permissions: Permission[],
	currentDepth: number,
	visited: Set<string>,
): void {
	const relatedCollection = relation.related_collection;

	if (!relatedCollection) return;
	if (visited.has(relatedCollection)) return;

	const relatedSchema = schema.collections[relatedCollection];

	if (!relatedSchema) return;

	const relatedPrimary = relatedSchema.primary;
	const foreignKeyField = relation.field;

	const newVisited = new Set(visited);
	newVisited.add(relatedCollection);

	queryBuilder.orWhere(function () {
		this.whereExists(function () {
			this.select(knex.raw(1))
				.from(relatedCollection)
				.whereRaw(`??.?? = ??.??`, [relatedCollection, relatedPrimary, collection, foreignKeyField]);

			addRelatedSearchConditions(
				knex,
				schema,
				this,
				searchQuery,
				relatedCollection,
				permissions,
				currentDepth,
				newVisited,
			);
		});
	});
}

/**
 * O2M: The related collection stores the foreign key pointing back to the current collection.
 *
 * For O2M, getRelationInfo returns a relation where:
 * - relation.collection = the "many" collection (where the FK lives)
 * - relation.field = the FK field on the "many" collection
 * - relation.related_collection = the current collection (the "one" side)
 *
 * Example: countries.cities → cities.country_id
 * SQL: EXISTS (SELECT 1 FROM cities WHERE cities.country_id = countries.id AND (cities.name LIKE ...))
 */
function applyO2MSearch(
	knex: Knex,
	schema: SchemaOverview,
	queryBuilder: Knex.QueryBuilder,
	searchQuery: string,
	collection: string,
	relation: Relation,
	permissions: Permission[],
	currentDepth: number,
	visited: Set<string>,
): void {
	const manyCollection = relation.collection;
	const fkField = relation.field;

	if (!manyCollection || manyCollection === collection) return;
	if (visited.has(manyCollection)) return;

	const manySchema = schema.collections[manyCollection];
	const currentSchema = schema.collections[collection];

	if (!manySchema || !currentSchema) return;

	const currentPrimary = currentSchema.primary;

	const newVisited = new Set(visited);
	newVisited.add(manyCollection);

	queryBuilder.orWhere(function () {
		this.whereExists(function () {
			this.select(knex.raw(1))
				.from(manyCollection)
				.whereRaw(`??.?? = ??.??`, [manyCollection, fkField, collection, currentPrimary]);

			addRelatedSearchConditions(
				knex,
				schema,
				this,
				searchQuery,
				manyCollection,
				permissions,
				currentDepth,
				newVisited,
			);
		});
	});
}

/**
 * M2M / Files / Translations: These all use a junction table pattern.
 *
 * The relation from getRelationInfo is the O2M side (current → junction).
 * We need to find the M2O relation on the junction table that points to the target collection.
 * This is identified via relation.meta.junction_field.
 *
 * Example: articles.tags (M2M via articles_tags junction)
 * SQL: EXISTS (
 *   SELECT 1 FROM articles_tags
 *   WHERE articles_tags.articles_id = articles.id
 *   AND EXISTS (
 *     SELECT 1 FROM tags
 *     WHERE tags.id = articles_tags.tags_id
 *     AND (tags.name LIKE ...)
 *   )
 * )
 */
function applyM2MSearch(
	knex: Knex,
	schema: SchemaOverview,
	queryBuilder: Knex.QueryBuilder,
	searchQuery: string,
	collection: string,
	relation: Relation,
	permissions: Permission[],
	currentDepth: number,
	visited: Set<string>,
): void {
	// relation.collection is the junction table
	// relation.field is the FK on junction pointing back to current collection
	const junctionCollection = relation.collection;
	const junctionFkToCurrentCollection = relation.field;
	const junctionField = relation.meta?.junction_field;

	if (!junctionCollection || !junctionField) return;

	const junctionSchema = schema.collections[junctionCollection];
	const currentSchema = schema.collections[collection];

	if (!junctionSchema || !currentSchema) return;

	// Find the M2O relation from junction → target collection
	const junctionRelation = schema.relations.find(
		(r) => r.collection === junctionCollection && r.field === junctionField,
	);

	if (!junctionRelation) return;

	const targetCollection = junctionRelation.related_collection;

	if (!targetCollection) return;
	if (visited.has(targetCollection)) return;

	const targetSchema = schema.collections[targetCollection];

	if (!targetSchema) return;

	const currentPrimary = currentSchema.primary;
	const targetPrimary = targetSchema.primary;

	const newVisited = new Set(visited);
	newVisited.add(targetCollection);

	queryBuilder.orWhere(function () {
		this.whereExists(function () {
			this.select(knex.raw(1))
				.from(junctionCollection)
				.whereRaw(`??.?? = ??.??`, [junctionCollection, junctionFkToCurrentCollection, collection, currentPrimary])
				.whereExists(function () {
					this.select(knex.raw(1))
						.from(targetCollection)
						.whereRaw(`??.?? = ??.??`, [targetCollection, targetPrimary, junctionCollection, junctionField]);

					addRelatedSearchConditions(
						knex,
						schema,
						this,
						searchQuery,
						targetCollection,
						permissions,
						currentDepth,
						newVisited,
					);
				});
		});
	});
}

/**
 * M2A (Many-to-Any): Uses a junction table with a collection discriminator field.
 *
 * The relation from getRelationInfo is the O2M side (current → junction).
 * The junction table has an "item" field and a "collection" field that together
 * form a polymorphic reference to any of the allowed collections.
 *
 * We iterate over all allowed collections and create EXISTS subqueries for each.
 */
function applyM2ASearch(
	knex: Knex,
	schema: SchemaOverview,
	queryBuilder: Knex.QueryBuilder,
	searchQuery: string,
	collection: string,
	relation: Relation,
	permissions: Permission[],
	currentDepth: number,
	visited: Set<string>,
): void {
	// For M2A, similar to M2M but the junction has a polymorphic reference
	const junctionCollection = relation.collection;
	const junctionFkToCurrent = relation.field;
	const junctionField = relation.meta?.junction_field;

	if (!junctionCollection || !junctionField) return;

	// Find the A2O relation on the junction table
	const a2oRelation = schema.relations.find((r) => r.collection === junctionCollection && r.field === junctionField);

	if (!a2oRelation) return;

	const allowedCollections = a2oRelation.meta?.one_allowed_collections;
	const collectionField = a2oRelation.meta?.one_collection_field;

	if (!allowedCollections || !collectionField) return;

	const currentSchema = schema.collections[collection];

	if (!currentSchema) return;

	const currentPrimary = currentSchema.primary;

	for (const targetCollection of allowedCollections) {
		if (visited.has(targetCollection)) continue;

		const targetSchema = schema.collections[targetCollection];

		if (!targetSchema) continue;

		const targetPrimary = targetSchema.primary;

		const newVisited = new Set(visited);
		newVisited.add(targetCollection);

		queryBuilder.orWhere(function () {
			this.whereExists(function () {
				this.select(knex.raw(1))
					.from(junctionCollection)
					.whereRaw(`??.?? = ??.??`, [junctionCollection, junctionFkToCurrent, collection, currentPrimary])
					.where(`${junctionCollection}.${collectionField}`, targetCollection)
					.whereExists(function () {
						this.select(knex.raw(1))
							.from(targetCollection)
							.whereRaw(`??.?? = ??.??`, [targetCollection, targetPrimary, junctionCollection, junctionField]);

						addRelatedSearchConditions(
							knex,
							schema,
							this,
							searchQuery,
							targetCollection,
							permissions,
							currentDepth,
							newVisited,
						);
					});
			});
		});
	}
}

/**
 * Add search conditions for a related collection's fields.
 * This mirrors the logic in applySearch() but operates on a subquery builder
 * and recurses for nested relations.
 */
function addRelatedSearchConditions(
	knex: Knex,
	schema: SchemaOverview,
	subQueryBuilder: Knex.QueryBuilder,
	searchQuery: string,
	relatedCollection: string,
	permissions: Permission[],
	currentDepth: number,
	visited: Set<string>,
): void {
	const relatedSchema = schema.collections[relatedCollection];

	if (!relatedSchema) return;

	const allowedFields = new Set(
		permissions.filter((p) => p.collection === relatedCollection).flatMap((p) => p.fields ?? []),
	);

	const { cases } = getCases(relatedCollection, permissions, []);

	let fields = Object.entries(relatedSchema.fields);

	// Filter out non-searchable and concealed fields
	fields = fields.filter(([_name, field]) => field.searchable !== false && !field.special.includes('conceal'));

	// Apply field permission restrictions if non-admin
	if (cases.length !== 0 && !allowedFields.has('*')) {
		fields = fields.filter(([name]) => allowedFields.has(name));
	}

	subQueryBuilder.andWhere(function () {
		let hasCondition = false;

		for (const [name, field] of fields) {
			// Primitive field search conditions
			if (['text', 'string'].includes(field.type)) {
				this.orWhereRaw(`LOWER(??) LIKE ?`, [`${relatedCollection}.${name}`, `%${searchQuery.toLowerCase()}%`]);
				hasCondition = true;
			} else if (field.type === 'uuid') {
				// Only match exact UUIDs
				const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

				if (uuidRegex.test(searchQuery)) {
					this.orWhere({ [`${relatedCollection}.${name}`]: searchQuery });
					hasCondition = true;
				}
			} else if (isRelationalField(field)) {
				// Recurse into nested relations (depth + 1)
				applyRelationalSearch(
					knex,
					schema,
					this,
					searchQuery,
					relatedCollection,
					name,
					field,
					permissions,
					currentDepth + 1,
					visited,
				);
				// Don't set hasCondition — recursive call might not add anything
			}
		}

		if (!hasCondition) {
			// Ensure the EXISTS subquery doesn't match everything when no searchable fields found
			this.orWhereRaw('1 = 0');
		}
	});
}
