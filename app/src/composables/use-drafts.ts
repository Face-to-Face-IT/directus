import api from '@/api';
import { VALIDATION_TYPES } from '@/constants';
import { APIError } from '@/types/error';
import { unexpectedError } from '@/utils/unexpected-error';
import { notify } from '@/utils/notify';
import type { Draft, Filter } from '@directus/types';
import { Ref, ref, unref, watch } from 'vue';
import { useCollectionPermissions } from './use-permissions';
import { i18n } from '@/lang';

export type UseDraftsOptions = {
	collection: Ref<string>;
};

export function useDrafts(options: UseDraftsOptions) {
	const { collection } = options;

	const drafts = ref<Draft[] | null>(null);
	const currentDraft = ref<Draft | null>(null);
	const loading = ref(false);
	const saving = ref(false);
	const publishing = ref(false);
	const validationErrors = ref<any[]>([]);

	const { createAllowed: createDraftsAllowed, readAllowed: readDraftsAllowed } =
		useCollectionPermissions('directus_drafts');

	watch(collection, () => {
		currentDraft.value = null;
		getDrafts();
	});

	return {
		drafts,
		currentDraft,
		loading,
		saving,
		publishing,
		validationErrors,
		createDraftsAllowed,
		readDraftsAllowed,
		getDrafts,
		createDraft,
		updateDraft,
		saveDraft,
		deleteDraft,
		publishDraft,
		validateDraft,
		loadDraft,
		clearDraft,
	};

	/**
	 * Fetch all drafts for the current collection
	 */
	async function getDrafts() {
		if (!readDraftsAllowed.value) return;

		loading.value = true;

		try {
			const filter: Filter = {
				collection: {
					_eq: unref(collection),
				},
			};

			const response = await api.get('/drafts', {
				params: {
					filter,
					sort: '-date_updated',
					fields: ['*'],
				},
			});

			drafts.value = response.data.data;
		} catch (error) {
			unexpectedError(error);
		} finally {
			loading.value = false;
		}
	}

	/**
	 * Create a new draft
	 */
	async function createDraft(data: Record<string, any>, name?: string): Promise<Draft | null> {
		saving.value = true;

		try {
			const response = await api.post('/drafts', {
				collection: unref(collection),
				name: name || null,
				data,
			});

			const newDraft = response.data.data as Draft;

			drafts.value = [...(drafts.value || []), newDraft];
			currentDraft.value = newDraft;

			notify({
				title: i18n.global.t('draft_saved'),
			});

			return newDraft;
		} catch (error) {
			handleSaveError(error);
			return null;
		} finally {
			saving.value = false;
		}
	}

	/**
	 * Update an existing draft's metadata (name)
	 */
	async function updateDraft(id: string, updates: { name?: string | null }): Promise<Draft | null> {
		saving.value = true;

		try {
			const response = await api.patch(`/drafts/${id}`, updates);

			const updatedDraft = response.data.data as Draft;

			if (drafts.value) {
				const index = drafts.value.findIndex((d) => d.id === id);
				if (index !== -1) {
					drafts.value[index] = updatedDraft;
				}
			}

			if (currentDraft.value?.id === id) {
				currentDraft.value = updatedDraft;
			}

			return updatedDraft;
		} catch (error) {
			handleSaveError(error);
			return null;
		} finally {
			saving.value = false;
		}
	}

	/**
	 * Save draft data (merge with existing)
	 */
	async function saveDraft(id: string, data: Record<string, any>): Promise<Draft | null> {
		saving.value = true;
		validationErrors.value = [];

		try {
			const response = await api.post(`/drafts/${id}/save`, data);

			const updatedDraft = response.data.data as Draft;

			if (drafts.value) {
				const index = drafts.value.findIndex((d) => d.id === id);
				if (index !== -1) {
					drafts.value[index] = updatedDraft;
				}
			}

			if (currentDraft.value?.id === id) {
				currentDraft.value = updatedDraft;
			}

			notify({
				title: i18n.global.t('draft_saved'),
			});

			return updatedDraft;
		} catch (error) {
			handleSaveError(error);
			return null;
		} finally {
			saving.value = false;
		}
	}

	/**
	 * Delete a draft
	 */
	async function deleteDraft(id: string): Promise<boolean> {
		try {
			await api.delete(`/drafts/${id}`);

			if (drafts.value) {
				const index = drafts.value.findIndex((d) => d.id === id);
				if (index !== -1) {
					drafts.value.splice(index, 1);
				}
			}

			if (currentDraft.value?.id === id) {
				currentDraft.value = null;
			}

			notify({
				title: i18n.global.t('draft_deleted'),
			});

			return true;
		} catch (error) {
			unexpectedError(error);
			return false;
		}
	}

	/**
	 * Publish a draft - creates the actual item in the target collection
	 */
	async function publishDraft(id: string): Promise<{ collection: string; key: string } | null> {
		publishing.value = true;
		validationErrors.value = [];

		try {
			const response = await api.post(`/drafts/${id}/publish`);

			const result = response.data.data;

			// Remove the draft from local state
			if (drafts.value) {
				const index = drafts.value.findIndex((d) => d.id === id);
				if (index !== -1) {
					drafts.value.splice(index, 1);
				}
			}

			if (currentDraft.value?.id === id) {
				currentDraft.value = null;
			}

			notify({
				title: i18n.global.t('draft_published'),
			});

			return result;
		} catch (error) {
			handleSaveError(error);
			return null;
		} finally {
			publishing.value = false;
		}
	}

	/**
	 * Validate a draft against the target collection's schema
	 */
	async function validateDraft(id: string): Promise<{ valid: boolean; errors: any[] }> {
		try {
			const response = await api.get(`/drafts/${id}/validate`);
			return response.data.data;
		} catch (error) {
			unexpectedError(error);
			return { valid: false, errors: [{ message: 'Validation request failed' }] };
		}
	}

	/**
	 * Load a draft into the current draft state
	 */
	function loadDraft(draft: Draft) {
		currentDraft.value = draft;
	}

	/**
	 * Clear the current draft
	 */
	function clearDraft() {
		currentDraft.value = null;
		validationErrors.value = [];
	}

	/**
	 * Handle save/publish errors
	 */
	function handleSaveError(error: any) {
		if (error?.response?.data?.errors) {
			validationErrors.value = error.response.data.errors
				.filter((err: APIError) => VALIDATION_TYPES.includes(err?.extensions?.code))
				.map((err: APIError) => err.extensions);

			const otherErrors = error.response.data.errors.filter(
				(err: APIError) => !VALIDATION_TYPES.includes(err?.extensions?.code),
			);

			if (otherErrors.length > 0) {
				otherErrors.forEach(unexpectedError);
			}
		} else {
			unexpectedError(error);
		}

		throw error;
	}
}
