import api from '@/api';
import { useFieldsStore } from '@/stores/fields';
import { useRelationsStore } from '@/stores/relations';
import type { LocationQuery } from 'vue-router';

/**
 * Reserved query parameters that should not be used for prefilling item data
 */
export const RESERVED_QUERY_PARAMS = ['bookmark', 'version', 'all', 'archived'];

/**
 * Parses URL query parameters for prefilling new item data.
 * 
 * Supports two syntaxes:
 * 1. Direct field values: `?field=value`
 * 2. Relational lookups: `?field.lookupField=value` - looks up the related item
 *    by the specified field and uses its primary key
 * 
 * @example
 * // Direct value
 * parseQueryParam('status', 'draft', 'articles')
 * // Returns: { field: 'status', value: 'draft', isRelational: false }
 * 
 * @example
 * // Relational lookup
 * parseQueryParam('program.abbreviation', 'ABC', 'cases')
 * // Returns: { field: 'program', lookupField: 'abbreviation', lookupValue: 'ABC', isRelational: true, relatedCollection: 'programs' }
 */
export interface ParsedDirectParam {
	field: string;
	value: unknown;
	isRelational: false;
}

export interface ParsedRelationalParam {
	field: string;
	lookupField: string;
	lookupValue: unknown;
	isRelational: true;
	relatedCollection: string | null;
}

export type ParsedParam = ParsedDirectParam | ParsedRelationalParam;

/**
 * Parse a single query parameter key-value pair
 */
export function parseQueryParam(
	key: string,
	value: unknown,
	collection: string,
): ParsedParam | null {
	// Skip reserved query params
	if (RESERVED_QUERY_PARAMS.includes(key)) {
		return null;
	}

	// Check for relational lookup syntax: field.lookupField=value
	if (key.includes('.')) {
		const parts = key.split('.');
		const fieldName = parts[0];
		const lookupField = parts[1];

		if (!fieldName || !lookupField) {
			return null;
		}

		// Get the relation for this field
		const relationsStore = useRelationsStore();
		const relation = relationsStore.getRelationForField(collection, fieldName);

		if (relation?.related_collection) {
			return {
				field: fieldName,
				lookupField,
				lookupValue: value,
				isRelational: true,
				relatedCollection: relation.related_collection,
			};
		}

		// Field has dot notation but is not a valid relation
		return null;
	}

	// Direct field value
	return {
		field: key,
		value,
		isRelational: false,
	};
}

/**
 * Resolve a relational lookup to the primary key of the related item
 */
export async function resolveRelationalLookup(
	param: ParsedRelationalParam,
): Promise<{ field: string; value: unknown } | null> {
	if (!param.relatedCollection) {
		return null;
	}

	const fieldsStore = useFieldsStore();
	const relatedPkField = fieldsStore.getPrimaryKeyFieldForCollection(param.relatedCollection);

	if (!relatedPkField) {
		return null;
	}

	try {
		const response = await api.get(`/items/${param.relatedCollection}`, {
			params: {
				filter: { [param.lookupField]: { _eq: param.lookupValue } },
				fields: [relatedPkField.field],
				limit: 1,
			},
		});

		const items = response.data.data;

		if (items && items.length > 0) {
			return {
				field: param.field,
				value: items[0][relatedPkField.field],
			};
		}

		return null;
	} catch {
		// If lookup fails, return null
		return null;
	}
}

/**
 * Parse and resolve all URL query parameters for prefilling a new item
 * 
 * @param query - The route query object
 * @param collection - The collection name
 * @param existingEdits - Fields that have already been edited (won't be overwritten)
 * @returns Object with resolved field values
 */
export async function resolveUrlPrefillData(
	query: LocationQuery,
	collection: string,
	existingEdits: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
	const prefillData: Record<string, unknown> = {};
	const lookupPromises: Promise<void>[] = [];

	for (const [key, value] of Object.entries(query)) {
		// Skip if already edited
		const fieldName = key.includes('.') ? key.split('.')[0] : key;

		if (fieldName && fieldName in existingEdits) {
			continue;
		}

		const parsed = parseQueryParam(key, value, collection);

		if (!parsed) {
			continue;
		}

		if (parsed.isRelational) {
			// Create a promise to resolve the relational lookup
			const lookupPromise = resolveRelationalLookup(parsed).then((result) => {
				if (result) {
					prefillData[result.field] = result.value;
				}
			});

			lookupPromises.push(lookupPromise);
		} else {
			prefillData[parsed.field] = parsed.value;
		}
	}

	// Wait for all relational lookups to complete
	await Promise.all(lookupPromises);

	return prefillData;
}
