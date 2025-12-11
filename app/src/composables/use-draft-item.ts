import api from '@/api';
import { notify } from '@/utils/notify';
import { unexpectedError } from '@/utils/unexpected-error';
import type { Draft } from '@directus/types';
import { useRouteQuery } from '@vueuse/router';
import { isEqual } from 'lodash';
import { computed, ref, Ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { i18n } from '@/lang';

export type UseDraftItemOptions = {
	collection: Ref<string>;
	isNew: Ref<boolean>;
	edits: Ref<Record<string, any>>;
};

export function useDraftItem(options: UseDraftItemOptions) {
	const { collection, isNew, edits } = options;
	const router = useRouter();

	// Get draft ID from query parameter
	const draftId = useRouteQuery<string | null>('draft', null, {
		transform: (value) => (Array.isArray(value) ? value[0] : value) || null,
		mode: 'replace',
	});

	const currentDraft = ref<Draft | null>(null);
	const loadedDraftData = ref<Record<string, any> | null>(null);
	const loadingDraft = ref(false);
	const savingDraft = ref(false);

	const hasDraft = computed(() => !!draftId.value);

	// Track whether current edits differ from the loaded draft data
	const hasDraftChanges = computed(() => {
		if (!currentDraft.value || !loadedDraftData.value) return false;
		return !isEqual(edits.value, loadedDraftData.value);
	});

	// Load draft when draft ID changes and we're on a new item
	watch(
		[draftId, isNew],
		async ([newDraftId, newIsNew]) => {
			if (newDraftId && newIsNew) {
				await loadDraft(newDraftId);
			} else if (!newDraftId) {
				currentDraft.value = null;
				loadedDraftData.value = null;
			}
		},
		{ immediate: true },
	);

	async function loadDraft(id: string) {
		loadingDraft.value = true;

		try {
			const response = await api.get(`/drafts/${id}`);
			const draft = response.data.data as Draft;

			// Verify the draft is for the correct collection
			if (draft.collection !== collection.value) {
				notify({
					title: i18n.global.t('draft_collection_mismatch'),
					type: 'warning',
				});
				clearDraftQuery();
				return;
			}

			currentDraft.value = draft;

			// Store the loaded draft data for change tracking
			loadedDraftData.value = { ...draft.data };

			// Pre-fill the edits with draft data
			edits.value = { ...draft.data };
		} catch (error) {
			unexpectedError(error);
			clearDraftQuery();
		} finally {
			loadingDraft.value = false;
		}
	}

	async function saveDraft(name?: string): Promise<Draft | null> {
		savingDraft.value = true;

		try {
			let draft: Draft;

			if (currentDraft.value) {
				// Update existing draft
				const response = await api.post(`/drafts/${currentDraft.value.id}/save`, edits.value);
				draft = response.data.data;

				// Update name if provided
				if (name !== undefined && name !== currentDraft.value.name) {
					await api.patch(`/drafts/${currentDraft.value.id}`, { name });
					draft.name = name;
				}
			} else {
				// Create new draft
				const response = await api.post('/drafts', {
					collection: collection.value,
					name: name || null,
					data: edits.value,
				});
				draft = response.data.data;

				// Update URL with new draft ID
				router.replace({
					query: { ...router.currentRoute.value.query, draft: draft.id },
				});
			}

			currentDraft.value = draft;

			// Update loaded draft data to reflect saved state (no unsaved changes)
			loadedDraftData.value = { ...edits.value };

			notify({
				title: i18n.global.t('draft_saved'),
			});

			return draft;
		} catch (error) {
			unexpectedError(error);
			return null;
		} finally {
			savingDraft.value = false;
		}
	}

	async function publishDraft(): Promise<{ collection: string; key: string } | null> {
		if (!currentDraft.value) return null;

		savingDraft.value = true;

		try {
			// First save the latest changes
			await api.post(`/drafts/${currentDraft.value.id}/save`, edits.value);

			// Then publish
			const response = await api.post(`/drafts/${currentDraft.value.id}/publish`);
			const result = response.data.data;

			currentDraft.value = null;

			notify({
				title: i18n.global.t('draft_published'),
			});

			return result;
		} catch (error) {
			unexpectedError(error);
			return null;
		} finally {
			savingDraft.value = false;
		}
	}

	async function deleteDraft(): Promise<boolean> {
		if (!currentDraft.value) return false;

		try {
			await api.delete(`/drafts/${currentDraft.value.id}`);

			currentDraft.value = null;
			clearDraftQuery();

			notify({
				title: i18n.global.t('draft_deleted'),
			});

			return true;
		} catch (error) {
			unexpectedError(error);
			return false;
		}
	}

	function clearDraftQuery() {
		const query = { ...router.currentRoute.value.query };
		delete query.draft;
		router.replace({ query });
	}

	function discardDraft() {
		edits.value = {};
		currentDraft.value = null;
		loadedDraftData.value = null;
		clearDraftQuery();
	}

	return {
		draftId,
		currentDraft,
		loadingDraft,
		savingDraft,
		hasDraft,
		hasDraftChanges,
		loadDraft,
		saveDraft,
		publishDraft,
		deleteDraft,
		discardDraft,
		clearDraftQuery,
	};
}
