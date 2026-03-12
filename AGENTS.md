# AGENTS.md

This is the **Face-to-Face IT fork** of [Directus](https://github.com/directus/directus). It tracks upstream releases and overlays custom features for the F2F Child Welfare Information System (CWIS).

## Fork Identity

| Key | Value |
|-----|-------|
| Upstream | `directus/directus` |
| Fork | `Face-to-Face-IT/directus` |
| Docker image | `ghcr.io/face-to-face-it/directus` |
| Manifest | `.fork-manifest.json` (source of truth for versions, features, releases) |

## Branching Model

```
upstream/main ──► main              (pure mirror, fast-forward only)
                    │
                    ├── feature/*    (each branched from main, rebased on main)
                    │
                    └──► custom      (main + all feature/* branches merged)
```

### `main` — Upstream Mirror

- **Always** a fast-forward of `upstream/main`. Never commit F2F changes here.
- Sync procedure: `git fetch upstream && git checkout main && git merge --ff-only upstream/main && git push origin main`
- Upstream tags (`v11.15.1`, etc.) live here.

### `feature/*` — Custom Feature Branches

Each custom feature lives on its own branch, **based on `main`**:

| Branch | Description | Upstream PR candidate? |
|--------|-------------|----------------------|
| `feature/opentelemetry` | Full OpenTelemetry instrumentation | Yes |
| `feature/form-context` | `$FORM` context for nested relationships | Yes |
| `feature/packer` | Image build automation (vSphere/QEMU) | No (F2F-specific) |
| `feature/ai-file-content-tool` | AI file content text extraction | Yes |
| `feature/collection-url-params` | URL prefill composable | Yes |
| `feature/external-mcp-tools` | External MCP server support | Yes |
| `feature/form-grid-columns` | Third-width form grid columns | Yes |
| `feature/draft-items` | Draft items (WIP save) | Yes |

**Rules:**
- Branch from `main`, keep rebased on `main`.
- Each branch should be a clean, self-contained changeset suitable for an upstream PR.
- Register the branch in `.fork-manifest.json` under `features[]`.
- Set `merge_to_custom: true` if it should be included in the `custom` integration branch.

### `custom` — Integration Branch

- Built by merging `main` + all `feature/*` branches where `merge_to_custom: true`.
- This is the branch that gets built into Docker images and deployed.
- **Rebuilt from scratch** when syncing to a new upstream version (not rebased).
- CI builds and pushes dev images on every push to `custom`.

**Rebuild procedure:**
```bash
git checkout main
git pull origin main
git checkout -B custom main
for branch in $(jq -r '.features[] | select(.merge_to_custom == true) | .branch' .fork-manifest.json); do
  git merge --no-ff "origin/$branch" -m "Merge $branch into custom"
done
git push origin custom --force-with-lease
```

## Publishing — Docker Images

There is **one** Docker publishing workflow: `.github/workflows/release.yml`

### Dev Builds (automatic)

**Trigger:** Every push to `custom` branch.

**Tags produced:**
- `ghcr.io/face-to-face-it/directus:custom` — latest dev build
- `ghcr.io/face-to-face-it/directus:custom-{sha}` — pinned to commit

### Release Builds (manual dispatch)

**Trigger:** Manual `workflow_dispatch` on `release.yml` with the `release` checkbox checked.

The build number is **auto-incremented**. The workflow reads `.fork-manifest.json`, finds the highest existing build number for the current `upstream_base`, and increments it. No manual version input needed.

Example: if `upstream_base` is `v11.15.1` and the last release was `11.15.1-f2f.2`, the next release will be `11.15.1-f2f.3`.

**Tags produced:**
- `ghcr.io/face-to-face-it/directus:11.15.1-f2f.3` — exact version
- `ghcr.io/face-to-face-it/directus:11.15.1-f2f` — floating "latest for this upstream version"
- `ghcr.io/face-to-face-it/directus:latest` — latest stable

**Post-build:** The workflow commits a release record to `.fork-manifest.json` on the `custom` branch.

### Version Scheme

```
{upstream_version}-f2f.{build_number}
```

- `upstream_version` — the Directus release this fork is based on (e.g., `11.15.1`), read from `upstream_base` in `.fork-manifest.json`
- `build_number` — auto-incremented per upstream base, starting at `1`
- When the upstream base changes, the build number resets to `1`

Examples: `11.14.1-f2f.1`, `11.15.1-f2f.1`, `11.15.1-f2f.2`

### Release Checklist

1. Ensure `main` is synced with the target upstream version
2. Rebase all `feature/*` branches onto updated `main`
3. Rebuild `custom` (merge all features)
4. Verify CI passes on `custom` (dev build succeeds)
5. Dispatch `release.yml` with the `release` checkbox checked
6. Verify the release image — `.fork-manifest.json` is updated automatically
7. Update downstream references:
   - Terraform module default (`directus_image_tag` in `terraform-aws-environment-ecs`)
   - Scalr workspace variables for deployed tenants

## Upstream Sync Procedure

When a new upstream Directus version is released (e.g., `v11.16.0`):

1. **Sync `main`:**
   ```bash
   git fetch upstream
   git checkout main
   git merge --ff-only upstream/main
   git push origin main
   ```

2. **Rebase feature branches:**
   ```bash
   for branch in feature/opentelemetry feature/form-context ...; do
     git checkout "$branch"
     git rebase main
     git push origin "$branch" --force-with-lease
   done
   ```

3. **Update manifest:**
   Edit `.fork-manifest.json`: set `upstream_base` to the new version, update `last_sync`.

4. **Rebuild `custom`:** Follow the rebuild procedure above.

5. **Cut a release:** Dispatch `release.yml` with `release_version: "1"`.

## Upstream Contributions

Feature branches based on `main` can be submitted as PRs to `upstream/main`:

1. Ensure the branch is rebased on the latest `main` (which mirrors `upstream/main`).
2. Open a PR from `Face-to-Face-IT/directus:{branch}` → `directus/directus:main`.
3. Follow upstream's contribution guidelines (changesets, CLA, code style).
4. Once merged upstream, the feature branch can be deleted and removed from `.fork-manifest.json` — it will arrive naturally via the next upstream sync.

Changesets are required for upstream PRs but **not** for F2F-only changes on `custom`.

## GitHub Actions Workflows

### F2F Workflows (maintained by us)

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `release.yml` | Push to `custom` / manual dispatch | Build and publish Docker images to GHCR, create GitHub releases |
| `check.yml` | Push/PR to `main` or `custom` | Lint, stylelint, format, unit tests + Codecov upload |
| `blackbox.yml` | Push to `main` (API/test changes) | E2E integration tests against 6 databases |
| `blackbox-pr.yml` | PR with "Run Blackbox" label | On-demand E2E tests for feature branches |
| `codeql-analysis.yml` | Daily cron | Security scanning (free, zero maintenance) |
| `claude.yml` | `@claude` mentions | AI assistant on issues/PRs |
| `claude-code-review.yml` | PR events | Automated AI code review |

### Inherited Upstream Workflows

These come from upstream merges and are **kept as-is** to avoid merge conflicts on every sync. They either don't trigger on our branches, are harmless, or are useful for upstream contributions:

| Workflow | Trigger | Impact on fork |
|----------|---------|---------------|
| `prepare-release.yml` | Manual dispatch | Upstream's changeset/Crowdin/Slack release prep. Ignore it. |
| `changeset-check.yml` | PRs to `main` | Useful when preparing upstream contribution PRs. |
| `assign-next-release-milestone.yml` | PR merged to `main` | Assigns milestones. Harmless. |
| `close-feature-requests.yml` | Discussion created | Redirects to upstream roadmap. Harmless. |
| `lock-threads.yml` | Daily cron | Locks stale issues/PRs. Harmless. |
| `stale-issues.yml` | Daily cron | Guarded by `github.repository == 'directus/directus'` — never runs on the fork. |
| `sync-dockerhub-readme.yml` | Push to `main` (readme changes) | We don't have Docker Hub creds — fails silently. |
| `cla.yml` | PR events | Upstream CLA bot. Harmless. |

## `.fork-manifest.json`

This file is the **source of truth** for the fork's state. Structure:

```jsonc
{
  "upstream_base": "v11.15.1",         // Current upstream version we're based on
  "upstream_repo": "directus/directus",
  "last_sync": "2026-02-22T00:00:00Z", // When main was last synced
  "docker_image": "ghcr.io/face-to-face-it/directus",
  "branches": {
    "main": "Synced with upstream, pure mirror",
    "custom": "main + internal features merged"
  },
  "features": [
    {
      "branch": "feature/example",
      "description": "What it does",
      "merge_to_custom": true           // Include in custom branch builds
    }
  ],
  "releases": [
    {
      "tag": "11.15.1-f2f.1",          // Docker image tag
      "upstream_base": "11.15.1",
      "date": "2026-02-22T00:00:00Z",
      "features": ["feature/example"]  // Features included in this release
    }
  ]
}
```

## Development

### Requirements

- Node.js 22
- pnpm >=10 <11

### Commands

```bash
pnpm install                         # Install dependencies
pnpm build                           # Build all packages
pnpm --filter @directus/api build    # Build specific package

cd api && pnpm dev                   # API dev server (:8055)
cd app && pnpm dev                   # App dev server (:8080)

pnpm lint                            # ESLint
pnpm lint:style                      # Stylelint
pnpm format                          # Prettier check

pnpm test                            # Unit tests
pnpm test:blackbox                   # E2E tests (build first)
```

### Code Style

- TypeScript, ES modules
- Follow existing ESLint/Prettier config
- Test files: `*.test.ts`, co-located with source

### Pull Requests

Run `pnpm lint && pnpm lint:style && pnpm format` before creating a PR.

For upstream PRs: include a changeset (`pnpm changeset`), follow upstream conventions.
For F2F-only changes on `custom`: no changeset required.

## Parent Product Context

This repo is part of **Face-to-Face IT**, a Child Welfare Information System (CWIS). For cross-repo context:

- **Product overview & repo relationships:** `~/code/face2face/README.md`
- **Architecture diagrams (C4):** `~/code/face2face/docs/architecture/`

### This Repo's Role

The Directus fork is the core application server. It is deployed as a Docker image to ECS Fargate via the `terraform-aws-environment-ecs` module. The image tag (`directus_image_tag`) is set as a Scalr workspace variable on each tenant environment.

### Downstream Consumers

| Consumer | How it uses this repo |
|----------|----------------------|
| `terraform-aws-environment-ecs` | `directus_image_tag` variable defaults to latest release |
| `directus-extensions` | `verify-core-deps.yml` validates compatibility against `.fork-manifest.json` |
| `directus-sandbox` | Docker Compose references `ghcr.io/face-to-face-it/directus:custom` for dev |
| `directus-templates` | Schema snapshots must be compatible with the deployed Directus version |

---

## Agent Mail — Inter-Agent Communication

This project uses [mcp_agent_mail](https://github.com/Dicklesworthstone/mcp_agent_mail) for coordination between agents working across the face2face repos.

### On Session Start

1. Call `ensure_project` with this repo's absolute path as `human_key`
2. Call `register_agent` with `project_key` set to this repo's absolute path, your `program` (e.g. "opencode"), and your `model`
3. Call `fetch_inbox` to check for messages from other agents

### During Work

- **Check your inbox periodically** — other agents may send you questions or coordination messages. Use `fetch_inbox` every few significant steps.
- **When you need input from another agent** — use `send_message` to ask. Include a clear subject and specify what you need.
- **When you receive a message with `ack_required=true`** — call `acknowledge_message` after reading it.
- **Before editing shared files** — use `file_reservation_paths` to reserve them and avoid conflicts with other agents.

### Sibling Projects

These repos are part of the same product and agents across them can communicate:

| Repo | Path |
|------|------|
| directus-extensions | `/home/d3adb0y/code/face2face/repos/directus-extensions` |
| directus-sandbox | `/home/d3adb0y/code/face2face/repos/directus-sandbox` |
| directus-extension-registry | `/home/d3adb0y/code/face2face/repos/directus-extension-registry` |
| management-app | `/home/d3adb0y/code/face2face/repos/management-app` |
| directus-templates | `/home/d3adb0y/code/face2face/repos/directus-templates` |
| terraform | `/home/d3adb0y/code/face2face/repos/terraform` |

To message an agent in a sibling project, you need to know its agent name. Use `fetch_inbox` or the web UI at `http://127.0.0.1:8765/mail` to discover registered agents.
