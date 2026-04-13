---
'@directus/api': minor
'@directus/env': patch
'@directus/app': patch
---

Added relational field search support via EXISTS subqueries, allowing the search bar to find items based on fields in
related collections (M2O, O2M, M2M, translations, M2A). Configurable via `RELATIONAL_SEARCH_MAX_DEPTH` env var (default
0 = disabled) and per-field searchable toggle. Included cycle detection to prevent infinite recursion.
