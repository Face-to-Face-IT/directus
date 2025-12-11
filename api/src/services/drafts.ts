import { ForbiddenError, InvalidPayloadError } from '@directus/errors';
import type { AbstractServiceOptions, Draft, Item, MutationOptions, PrimaryKey } from '@directus/types';
import Joi from 'joi';
import { ItemsService } from './items.js';
import { validateAccess } from '../permissions/modules/validate-access/validate-access.js';

/**
 * Service for managing draft items.
 * Drafts are incomplete items that haven't been saved to the target collection yet.
 * Unlike content versions which track changes to existing items, drafts are for new items
 * that are still being worked on and may not pass validation constraints.
 */
export class DraftsService extends ItemsService<Draft> {
	constructor(options: AbstractServiceOptions) {
		super('directus_drafts', options);
	}

	/**
	 * Validates draft creation data
	 */
	private async validateCreateData(data: Partial<Item>): Promise<void> {
		const draftCreateSchema = Joi.object({
			name: Joi.string().allow(null),
			collection: Joi.string().required(),
			data: Joi.object().required(),
		});

		const { error } = draftCreateSchema.validate(data);
		if (error) throw new InvalidPayloadError({ reason: error.message });

		// Verify the user has create permission on the target collection
		if (this.accountability) {
			try {
				await validateAccess(
					{
						accountability: this.accountability,
						action: 'create',
						collection: data['collection'],
						primaryKeys: [],
					},
					{
						schema: this.schema,
						knex: this.knex,
					},
				);
			} catch {
				throw new ForbiddenError();
			}
		}

		// Verify the collection exists
		if (!this.schema.collections[data['collection']]) {
			throw new InvalidPayloadError({ reason: `Collection "${data['collection']}" does not exist` });
		}
	}

	/**
	 * Validates draft update data
	 */
	private async validateUpdateData(data: Partial<Item>): Promise<void> {
		const draftUpdateSchema = Joi.object({
			name: Joi.string().allow(null),
			data: Joi.object(),
		});

		const { error } = draftUpdateSchema.validate(data);
		if (error) throw new InvalidPayloadError({ reason: error.message });
	}

	override async createOne(data: Partial<Item>, opts?: MutationOptions): Promise<PrimaryKey> {
		await this.validateCreateData(data);
		return super.createOne(data, opts);
	}

	override async createMany(data: Partial<Item>[], opts?: MutationOptions): Promise<PrimaryKey[]> {
		if (!Array.isArray(data)) {
			throw new InvalidPayloadError({ reason: 'Input should be an array of items' });
		}

		for (const item of data) {
			await this.validateCreateData(item);
		}

		return super.createMany(data, opts);
	}

	override async updateMany(keys: PrimaryKey[], data: Partial<Item>, opts?: MutationOptions): Promise<PrimaryKey[]> {
		await this.validateUpdateData(data);
		return super.updateMany(keys, data, opts);
	}

	/**
	 * Save draft data (merge with existing data)
	 * This allows partial updates to the draft data without replacing the entire object
	 */
	async save(key: PrimaryKey, delta: Record<string, any>): Promise<Draft> {
		const draft = await super.readOne(key);

		// Merge the new data with existing data
		const mergedData = {
			...draft.data,
			...delta,
		};

		await super.updateOne(key, { data: mergedData });

		return await super.readOne(key);
	}

	/**
	 * Publish a draft - creates the actual item in the target collection
	 * This will throw validation errors if the item doesn't pass the collection's constraints
	 */
	async publish(key: PrimaryKey): Promise<{ collection: string; key: PrimaryKey }> {
		const draft = await super.readOne(key);

		const itemsService = new ItemsService(draft.collection, {
			accountability: this.accountability,
			knex: this.knex,
			schema: this.schema,
		});

		// Create the actual item - this will go through full validation
		const itemKey = await itemsService.createOne(draft.data);

		// Delete the draft after successful creation
		await super.deleteOne(key);

		return {
			collection: draft.collection,
			key: itemKey,
		};
	}

	/**
	 * Validate draft data against the target collection's schema without saving
	 * Returns validation errors if any
	 */
	async validate(key: PrimaryKey): Promise<{ valid: boolean; errors: any[] }> {
		const draft = await super.readOne(key);

		// Import validation utilities
		const { validatePayload } = await import('@directus/utils');

		// Get field validation rules for the collection
		const { FieldsService } = await import('./fields.js');
		const fieldsService = new FieldsService({
			accountability: this.accountability,
			knex: this.knex,
			schema: this.schema,
		});

		const fields = await fieldsService.readAll(draft.collection);

		// Build validation rules from required fields
		const validationRules: { _and: any[] } = { _and: [] };

		for (const field of fields) {
			if (field.meta?.required) {
				validationRules._and.push({
					[field.field]: { _nnull: true },
				});
				validationRules._and.push({
					[field.field]: { _submitted: true },
				});
			}

			// Add custom validation rules if present
			if (field.meta?.validation) {
				const fieldValidation = field.meta.validation as { _and?: any[] };
				if (fieldValidation._and) {
					validationRules._and.push(...fieldValidation._and);
				}
			}
		}

		try {
			const errors = validatePayload(validationRules, draft.data);

			if (errors.length > 0) {
				return {
					valid: false,
					errors: errors.flatMap((error) => error.details),
				};
			}

			return { valid: true, errors: [] };
		} catch (error: any) {
			return {
				valid: false,
				errors: [{ message: error.message }],
			};
		}
	}
}
