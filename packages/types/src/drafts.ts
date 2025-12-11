/**
 * Represents a draft item - an incomplete item that hasn't been saved to the database yet.
 * Unlike content versions which track changes to existing items, drafts are for new items
 * that are still being worked on and may not pass validation constraints.
 */
export type Draft = {
	/** Unique identifier for the draft */
	id: string;
	/** Optional user-friendly name for the draft */
	name: string | null;
	/** The collection this draft belongs to */
	collection: string;
	/** The draft data (partial item that may not be complete) */
	data: Record<string, any>;
	/** When the draft was created */
	date_created: string;
	/** When the draft was last updated */
	date_updated: string | null;
	/** User who created the draft */
	user_created: string | null;
	/** User who last updated the draft */
	user_updated: string | null;
};
