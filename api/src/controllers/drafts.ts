import { ErrorCode, isDirectusError } from '@directus/errors';
import type { PrimaryKey } from '@directus/types';
import express from 'express';
import { respond } from '../middleware/respond.js';
import useCollection from '../middleware/use-collection.js';
import { validateBatch } from '../middleware/validate-batch.js';
import { MetaService } from '../services/meta.js';
import { DraftsService } from '../services/drafts.js';
import asyncHandler from '../utils/async-handler.js';
import { sanitizeQuery } from '../utils/sanitize-query.js';

const router = express.Router();

router.use(useCollection('directus_drafts'));

// Create draft(s)
router.post(
	'/',
	asyncHandler(async (req, res, next) => {
		const service = new DraftsService({
			accountability: req.accountability,
			schema: req.schema,
		});

		const savedKeys: PrimaryKey[] = [];

		if (Array.isArray(req.body)) {
			const keys = await service.createMany(req.body);
			savedKeys.push(...keys);
		} else {
			const primaryKey = await service.createOne(req.body);
			savedKeys.push(primaryKey);
		}

		try {
			if (Array.isArray(req.body)) {
				const records = await service.readMany(savedKeys, req.sanitizedQuery);
				res.locals['payload'] = { data: records };
			} else {
				const record = await service.readOne(savedKeys[0]!, req.sanitizedQuery);
				res.locals['payload'] = { data: record };
			}
		} catch (error: any) {
			if (isDirectusError(error, ErrorCode.Forbidden)) {
				return next();
			}

			throw error;
		}

		return next();
	}),
	respond,
);

// Read drafts
const readHandler = asyncHandler(async (req, res, next) => {
	const service = new DraftsService({
		accountability: req.accountability,
		schema: req.schema,
	});

	const metaService = new MetaService({
		accountability: req.accountability,
		schema: req.schema,
	});

	let result;

	if (req.body.keys) {
		result = await service.readMany(req.body.keys, req.sanitizedQuery);
	} else {
		result = await service.readByQuery(req.sanitizedQuery);
	}

	const meta = await metaService.getMetaForQuery(req.collection, req.sanitizedQuery);

	res.locals['payload'] = { data: result, meta };
	return next();
});

router.get('/', validateBatch('read'), readHandler, respond);
router.search('/', validateBatch('read'), readHandler, respond);

// Read single draft
router.get(
	'/:pk',
	asyncHandler(async (req, res, next) => {
		const service = new DraftsService({
			accountability: req.accountability,
			schema: req.schema,
		});

		const record = await service.readOne(req.params['pk']!, req.sanitizedQuery);

		res.locals['payload'] = { data: record || null };
		return next();
	}),
	respond,
);

// Update drafts (batch)
router.patch(
	'/',
	validateBatch('update'),
	asyncHandler(async (req, res, next) => {
		const service = new DraftsService({
			accountability: req.accountability,
			schema: req.schema,
		});

		let keys: PrimaryKey[] = [];

		if (Array.isArray(req.body)) {
			keys = await service.updateBatch(req.body);
		} else if (req.body.keys) {
			keys = await service.updateMany(req.body.keys, req.body.data);
		} else {
			const sanitizedQuery = await sanitizeQuery(req.body.query, req.schema, req.accountability);
			keys = await service.updateByQuery(sanitizedQuery, req.body.data);
		}

		try {
			const result = await service.readMany(keys, req.sanitizedQuery);
			res.locals['payload'] = { data: result || null };
		} catch (error: any) {
			if (isDirectusError(error, ErrorCode.Forbidden)) {
				return next();
			}

			throw error;
		}

		return next();
	}),
	respond,
);

// Update single draft
router.patch(
	'/:pk',
	asyncHandler(async (req, res, next) => {
		const service = new DraftsService({
			accountability: req.accountability,
			schema: req.schema,
		});

		const primaryKey = await service.updateOne(req.params['pk']!, req.body);

		try {
			const record = await service.readOne(primaryKey, req.sanitizedQuery);
			res.locals['payload'] = { data: record || null };
		} catch (error: any) {
			if (isDirectusError(error, ErrorCode.Forbidden)) {
				return next();
			}

			throw error;
		}

		return next();
	}),
	respond,
);

// Delete drafts (batch)
router.delete(
	'/',
	validateBatch('delete'),
	asyncHandler(async (req, _res, next) => {
		const service = new DraftsService({
			accountability: req.accountability,
			schema: req.schema,
		});

		if (Array.isArray(req.body)) {
			await service.deleteMany(req.body);
		} else if (req.body.keys) {
			await service.deleteMany(req.body.keys);
		} else {
			const sanitizedQuery = await sanitizeQuery(req.body.query, req.schema, req.accountability);
			await service.deleteByQuery(sanitizedQuery);
		}

		return next();
	}),
	respond,
);

// Delete single draft
router.delete(
	'/:pk',
	asyncHandler(async (req, _res, next) => {
		const service = new DraftsService({
			accountability: req.accountability,
			schema: req.schema,
		});

		await service.deleteOne(req.params['pk']!);

		return next();
	}),
	respond,
);

// Save draft data (merge with existing)
router.post(
	'/:pk/save',
	asyncHandler(async (req, res, next) => {
		const service = new DraftsService({
			accountability: req.accountability,
			schema: req.schema,
		});

		const draft = await service.save(req.params['pk']!, req.body);

		res.locals['payload'] = { data: draft };

		return next();
	}),
	respond,
);

// Validate draft against target collection schema
router.get(
	'/:pk/validate',
	asyncHandler(async (req, res, next) => {
		const service = new DraftsService({
			accountability: req.accountability,
			schema: req.schema,
		});

		const result = await service.validate(req.params['pk']!);

		res.locals['payload'] = { data: result };

		return next();
	}),
	respond,
);

// Publish draft - create the actual item in the target collection
router.post(
	'/:pk/publish',
	asyncHandler(async (req, res, next) => {
		const service = new DraftsService({
			accountability: req.accountability,
			schema: req.schema,
		});

		const result = await service.publish(req.params['pk']!);

		res.locals['payload'] = { data: result };

		return next();
	}),
	respond,
);

export default router;
