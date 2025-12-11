import type { Knex } from 'knex';
import { getHelpers } from '../helpers/index.js';

export async function up(knex: Knex): Promise<void> {
	const helpers = getHelpers(knex);

	await knex.schema.createTable('directus_drafts', (table) => {
		table.uuid('id').primary().notNullable();
		table.string('name');

		table
			.string('collection', helpers.schema.getTableNameMaxLength())
			.notNullable()
			.references('collection')
			.inTable('directus_collections')
			.onDelete('CASCADE');

		// Store the draft data as JSON
		table.json('data');

		table.timestamp('date_created').defaultTo(knex.fn.now());
		table.timestamp('date_updated').defaultTo(knex.fn.now());
		table.uuid('user_created').references('id').inTable('directus_users').onDelete('SET NULL');
		table.uuid('user_updated').references('id').inTable('directus_users');
	});
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.dropTable('directus_drafts');
}
