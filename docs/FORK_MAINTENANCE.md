# Face-to-Face IT Directus Fork Maintenance

This document describes the maintenance procedures for the Face-to-Face IT fork of Directus.

## Overview

This fork maintains custom features on top of upstream Directus. We use a two-branch strategy:

- **`main`**: Pure mirror of upstream Directus, synced weekly
- **`custom`**: Integration branch with all internal features merged

This allows us to:
- Keep `main` clean for easy upstream tracking
- Maintain feature branches that can be submitted upstream
- Have a ready-to-deploy `custom` branch with all customizations

## Architecture

### Branching Strategy

```
upstream/main (directus/directus)
    │
    ▼ [weekly sync workflow]
origin/main (pure upstream mirror)
    │
    ├──────────────────────────────┐
    │                              │
    ▼ [update-custom workflow]     │
origin/custom (main + internal     │
features merged)                   │
                                   │
    feature/* branches ────────────┘
    (based on main, merged to custom)
```

### Key Branches

| Branch | Purpose |
|--------|---------|
| `main` | Pure upstream mirror, synced with directus/directus |
| `custom` | Integration branch: main + internal features merged |
| `feature/*` | Individual feature branches, based on main |
| `release/*` | Tagged release snapshots (created from custom) |
| `sync/upstream-*` | Temporary branches for upstream sync PRs |

### Feature Classification

Features have different statuses that determine how they're handled:

| Status | Merge to Custom | Description |
|--------|-----------------|-------------|
| `internal` | Yes | Internal features, merged to custom branch |
| `upstream-pending` | No | Has open PR to directus/directus, kept clean |
| `experimental` | No | Not ready for integration |
| `deprecated` | No | Being phased out |

## Fork Manifest

The `.fork-manifest.json` file tracks:

- **upstream_base**: Current upstream version we're based on
- **upstream_repo**: The upstream repository (directus/directus)
- **last_sync**: When we last synced from upstream
- **branches**: Description of main branches (main, custom)
- **features**: Array of feature branches with status and merge settings
- **releases**: History of F2F releases

Example:
```json
{
  "upstream_base": "v11.14.0",
  "upstream_repo": "directus/directus",
  "last_sync": "2026-01-22T00:00:00Z",
  "branches": {
    "main": "Synced with upstream, pure mirror",
    "custom": "main + internal features merged"
  },
  "features": [
    {
      "id": "form-context",
      "branch": "feature/form-context",
      "description": "$FORM context for nested relationships",
      "status": "internal",
      "merge_to_custom": true
    },
    {
      "id": "external-mcp-tools",
      "branch": "feature/external-mcp-tools",
      "description": "External MCP server support",
      "status": "upstream-pending",
      "upstream_pr": "https://github.com/directus/directus/pull/26513",
      "merge_to_custom": false,
      "note": "Do not rebase - has open upstream PR"
    }
  ],
  "releases": []
}
```

## Automated Workflows

### 1. Upstream Sync (`upstream-sync.yml`)

**Schedule**: Weekly on Monday at 6am UTC (or manual trigger)

**Process**:
1. Fetches latest upstream release tag
2. Creates `sync/upstream-vX.Y.Z` branch
3. Attempts merge from upstream
4. Creates PR with appropriate labels

**If conflicts occur**:
- PR is labeled `needs-resolution`
- Maintainer must resolve conflicts manually
- After resolution, remove the label and merge

### 2. Update Custom (`update-custom.yml`)

**Trigger**: After push to `main` (or manual)

**Process**:
1. Reads features from manifest where `merge_to_custom: true`
2. Merges main into custom to get latest upstream changes
3. Merges each internal feature branch into custom
4. Pushes updated custom branch
5. Creates issues for any merge failures

**Manual dispatch options**:
- `reset_custom`: Reset custom to main before merging (use if custom has diverged badly)

**If merge fails**:
- GitHub issue is created with conflict details
- Maintainer resolves manually (see procedure below)
- Close issue after resolution

### 3. Build Release (`build-release.yml`)

**Trigger**: Manual dispatch

**Inputs**:
- `release_suffix`: Version suffix (e.g., "1" for v11.14.0-f2f.1)
- `features`: Comma-separated feature IDs or "all"
- `skip_tests`: Skip test suite (not recommended)

**Process**:
1. Creates release branch from custom
2. Runs build and tests
3. Updates manifest with release info
4. Creates tag and GitHub Release

## Manual Procedures

### Adding a New Internal Feature

1. Create branch from main:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/my-feature
   ```

2. Develop the feature with clean commits

3. Add to manifest with `merge_to_custom: true`:
   ```json
   {
     "id": "my-feature",
     "branch": "feature/my-feature",
     "description": "Description of my feature",
     "status": "internal",
     "merge_to_custom": true
   }
   ```

4. Push branch and manifest update:
   ```bash
   git push origin feature/my-feature
   git checkout main
   git add .fork-manifest.json
   git commit -m "chore: add my-feature to manifest"
   git push origin main
   ```

5. The `update-custom` workflow will automatically merge it to custom

### Adding a Feature for Upstream Submission

1. Create branch from main:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/upstream-feature
   ```

2. Develop following Directus contribution guidelines

3. Add to manifest with `merge_to_custom: false`:
   ```json
   {
     "id": "upstream-feature",
     "branch": "feature/upstream-feature",
     "description": "Feature for upstream submission",
     "status": "upstream-pending",
     "upstream_pr": "https://github.com/directus/directus/pull/XXXXX",
     "merge_to_custom": false,
     "note": "Do not rebase - has open upstream PR"
   }
   ```

4. Submit PR to directus/directus from this branch

5. **Important**: Do NOT rebase this branch after submitting the PR

### Resolving Upstream Sync Conflicts

1. Checkout the sync branch:
   ```bash
   git fetch origin
   git checkout sync/upstream-vX.Y.Z
   ```

2. The conflicts are already marked. Resolve each file.

3. Test the build:
   ```bash
   pnpm install
   pnpm build
   pnpm test
   ```

4. Commit and push:
   ```bash
   git add .
   git commit -m "chore: resolve upstream sync conflicts"
   git push origin sync/upstream-vX.Y.Z
   ```

5. Remove `needs-resolution` label from PR and merge

6. The `update-custom` workflow will automatically update custom branch

### Resolving Custom Branch Merge Conflicts

If the `update-custom` workflow fails:

1. Checkout custom branch:
   ```bash
   git fetch origin
   git checkout custom
   ```

2. Merge main first:
   ```bash
   git merge origin/main
   # Resolve any conflicts
   git commit
   ```

3. Merge each failed feature branch:
   ```bash
   git merge origin/feature/xxx
   # Resolve conflicts
   git add <resolved-files>
   git commit
   ```

4. Push the updated custom branch:
   ```bash
   git push origin custom
   ```

5. Close the GitHub issue

### Rebasing a Feature Branch (Internal Features Only)

Sometimes you need to update an internal feature branch to incorporate upstream changes:

1. Checkout and rebase:
   ```bash
   git fetch origin
   git checkout feature/my-feature
   git rebase origin/main
   ```

2. Resolve conflicts, continue rebase:
   ```bash
   # For each conflict
   git add <resolved-files>
   git rebase --continue
   ```

3. Force push:
   ```bash
   git push origin feature/my-feature --force-with-lease
   ```

4. The `update-custom` workflow will pick up the changes

**Warning**: Never rebase feature branches with status `upstream-pending`!

### Creating a Hotfix Release

For urgent fixes that can't wait for regular release:

1. Start from the latest release tag:
   ```bash
   git checkout v11.14.0-f2f.1
   git checkout -b hotfix/critical-fix
   ```

2. Apply fix and test

3. Create release manually or use workflow with just the hotfix branch

### Deprecating a Feature

1. Update manifest status:
   ```json
   {
     "id": "old-feature",
     "branch": "feature/old-feature",
     "status": "deprecated",
     "merge_to_custom": false
   }
   ```

2. Deprecated features are excluded from custom branch

3. Branch can be deleted after removing from manifest

### When an Upstream PR is Merged

When Directus accepts your upstream PR:

1. Update manifest to mark as merged:
   ```json
   {
     "id": "my-upstream-feature",
     "status": "upstream-merged",
     "upstream_pr": "...",
     "merge_to_custom": false,
     "note": "Merged to upstream in vX.Y.Z"
   }
   ```

2. The feature will be available via normal upstream sync

3. Delete the feature branch once upstream version is in our main

## Extension Compatibility

The `directus-extensions` repository tracks which extensions depend on fork features.

See `directus-core-dependencies.json` in that repo for:
- Which extensions require which fork features
- Minimum compatible fork version

When deprecating features, check extension dependencies first.

## Troubleshooting

### Workflow Failures

1. Check Actions tab for error logs
2. Common issues:
   - **Merge conflicts**: Resolve manually as described above
   - **Test failures**: May indicate breaking changes in upstream
   - **Build failures**: Check for dependency issues

### Manifest Corruption

The manifest is just JSON. If corrupted:

1. Check git history: `git log -p -- .fork-manifest.json`
2. Restore from last good state
3. Verify with: `jq . .fork-manifest.json`

### Custom Branch Diverged Badly

If custom has significant merge conflicts:

1. Use the `reset_custom` option in the workflow
2. Or manually:
   ```bash
   git checkout custom
   git reset --hard origin/main
   git push origin custom --force
   ```
3. Then run `update-custom` workflow to re-merge features

### Feature Branch Diverged

If a feature branch significantly diverged from main:

1. Consider squashing to a single commit
2. Rebase onto main (only if NOT upstream-pending!)
3. Verify functionality
4. Force push with `--force-with-lease`

## Best Practices

1. **Keep features focused**: Each feature branch should do one thing
2. **Write clear commit messages**: Helps when cherry-picking or upstreaming
3. **Test after merges**: Merges can introduce subtle issues
4. **Update manifest promptly**: Keep it accurate
5. **Document breaking changes**: Note in release descriptions
6. **Check extension deps**: Before deprecating features
7. **Never rebase upstream-pending branches**: Keep PR history clean

## Related Documentation

- [Directus Docs](https://docs.directus.io/)
- [Extension Development](https://docs.directus.io/extensions/)
- [Contributing to Directus](https://github.com/directus/directus/blob/main/contributing.md)
