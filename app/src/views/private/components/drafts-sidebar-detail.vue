<script setup lang="ts">
import api from '@/api';
import { useGroupable } from '@directus/composables';
import type { Draft } from '@directus/types';
import { abbreviateNumber } from '@directus/utils';
import { formatDistanceToNow } from 'date-fns';
import { computed, onMounted, ref, toRefs, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

const props = defineProps<{
	collection: string;
	currentDraftId?: string | null;
}>();

const emit = defineEmits<{
	'load-draft': [draft: Draft];
	'delete-draft': [id: string];
}>();

const { t } = useI18n();
const router = useRouter();

const title = computed(() => t('my_drafts'));

const { active: open } = useGroupable({
	value: title.value,
	group: 'sidebar-detail',
});

const { collection, currentDraftId } = toRefs(props);

const drafts = ref<Draft[]>([]);
const loading = ref(false);
const confirmDelete = ref<string | null>(null);
const deleting = ref(false);

const draftsCount = computed(() => drafts.value.length);

onMounted(() => {
	if (open.value) getDrafts();
});

watch(open, (newOpen) => {
	if (newOpen && drafts.value.length === 0) getDrafts();
});

watch(collection, () => {
	drafts.value = [];
	if (open.value) getDrafts();
});

async function getDrafts() {
	loading.value = true;

	try {
		const response = await api.get('/drafts', {
			params: {
				filter: {
					collection: { _eq: collection.value },
				},
				sort: '-date_updated',
			},
		});

		drafts.value = response.data.data;
	} catch {
		drafts.value = [];
	} finally {
		loading.value = false;
	}
}

function loadDraft(draft: Draft) {
	emit('load-draft', draft);

	// Navigate to the new item page with draft query parameter
	router.push({
		path: `/content/${collection.value}/+`,
		query: { draft: draft.id },
	});
}

async function deleteDraft(id: string) {
	deleting.value = true;

	try {
		await api.delete(`/drafts/${id}`);
		drafts.value = drafts.value.filter((d) => d.id !== id);
		emit('delete-draft', id);

		// If we deleted the current draft, navigate to clean new item page
		if (currentDraftId.value === id) {
			router.push(`/content/${collection.value}/+`);
		}
	} finally {
		deleting.value = false;
		confirmDelete.value = null;
	}
}

function formatDate(date: string) {
	return formatDistanceToNow(new Date(date), { addSuffix: true });
}

function onToggle(isOpen: boolean) {
	if (isOpen && drafts.value.length === 0) getDrafts();
}

defineExpose({
	refresh: getDrafts,
});
</script>

<template>
	<sidebar-detail
		id="drafts"
		:title
		icon="edit_note"
		:badge="draftsCount > 0 ? abbreviateNumber(draftsCount) : null"
		@toggle="onToggle"
	>
		<v-progress-linear v-if="loading && drafts.length === 0" indeterminate />

		<div v-else-if="draftsCount === 0" class="empty">
			<div class="content">{{ $t('no_drafts') }}</div>
		</div>

		<template v-else>
			<div class="drafts-list">
				<div
					v-for="draft in drafts"
					:key="draft.id"
					class="draft-item"
					:class="{ active: currentDraftId === draft.id }"
					@click="loadDraft(draft)"
				>
					<div class="draft-info">
						<div class="draft-name">{{ draft.name || $t('draft_name_placeholder') }}</div>
						<div class="draft-meta">{{ formatDate(draft.date_updated || draft.date_created) }}</div>
					</div>
					<v-icon
						v-tooltip="$t('delete_label')"
						name="delete"
						class="delete-icon"
						clickable
						@click.stop="confirmDelete = draft.id"
					/>
				</div>
			</div>
		</template>

		<!-- Delete Confirmation Dialog -->
		<v-dialog :model-value="!!confirmDelete" @update:model-value="confirmDelete = null">
			<v-card>
				<v-card-title>{{ $t('discard_draft') }}</v-card-title>
				<v-card-text>{{ $t('delete_are_you_sure') }}</v-card-text>
				<v-card-actions>
					<v-button secondary @click="confirmDelete = null">
						{{ $t('cancel') }}
					</v-button>
					<v-button kind="danger" :loading="deleting" @click="deleteDraft(confirmDelete!)">
						{{ $t('delete_label') }}
					</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</sidebar-detail>
</template>

<style lang="scss" scoped>
.v-progress-linear {
	margin: 24px 0;
}

.empty {
	margin-block: 16px;
	margin-inline-start: 2px;
	color: var(--theme--foreground-subdued);
	font-style: italic;
}

.drafts-list {
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.draft-item {
	display: flex;
	align-items: center;
	padding: 12px;
	border-radius: var(--theme--border-radius);
	cursor: pointer;
	transition: background-color var(--fast) var(--transition);

	&:hover {
		background-color: var(--theme--background-accent);
	}

	&.active {
		background-color: var(--theme--primary-background);
	}
}

.draft-info {
	flex: 1;
	min-width: 0;
}

.draft-name {
	font-weight: 500;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.draft-meta {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.delete-icon {
	--v-icon-color: var(--theme--foreground-subdued);
	--v-icon-color-hover: var(--theme--danger);

	opacity: 0;
	transition: opacity var(--fast) var(--transition);

	.draft-item:hover & {
		opacity: 1;
	}
}
</style>
