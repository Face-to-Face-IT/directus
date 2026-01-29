---
description: Manage development environment (start, stop, status, bootstrap)
allowed-tools: Bash(pnpm:*),Bash(docker:*),Bash(curl:*),Bash(cat:*),Bash(grep:*)
argument-hint: <action> (start|stop|status|bootstrap|run)
---

# Directus Development Environment Manager

Manage the Directus development environment for the current worktree.

**Action:** $ARGUMENTS

Parse the first word of $ARGUMENTS as the action. Default to "run" if no action provided.

## Actions

### start
Start Docker infrastructure (Postgres) and wait for it to be ready.

1. Read ports from `api/.env`:
   ```bash
   source api/.env 2>/dev/null || true
   ```

2. Start Postgres:
   ```bash
   docker compose up -d postgres
   ```

3. Wait for Postgres to be ready:
   ```bash
   for i in {1..30}; do
     docker compose exec -T postgres pg_isready -U postgres && break || sleep 2
   done
   ```

4. Report:
   - Postgres ready on port $DB_PORT
   - Run `/dev bootstrap` if first time
   - Run `/dev run` to start dev server

### stop
Stop Docker infrastructure.

```bash
docker compose down
```

### status
Show current environment status.

1. Read config from `api/.env`:
   ```bash
   source api/.env 2>/dev/null || true
   echo "Configured ports: Directus=${PORT:-8055}, Postgres=${DB_PORT:-5100}"
   ```

2. Check Docker containers:
   ```bash
   docker compose ps
   ```

3. Check if Directus API is responding:
   ```bash
   curl -sf http://localhost:${PORT:-8055}/server/health && echo "API: healthy" || echo "API: not running"
   ```

### bootstrap
Run Directus bootstrap (creates admin user, applies migrations).

**Prerequisites:**
- Docker Postgres must be running (`/dev start` first)
- Dependencies must be installed (`pnpm install`)
- Packages must be built (`pnpm build`)

```bash
cd api && pnpm cli bootstrap
```

This only needs to be run once per database, or after a database reset.

### run
Start the development server (API with hot reload).

**Prerequisites:**
- Postgres must be running (`/dev start`)
- Bootstrap must be done (`/dev bootstrap`)

```bash
cd api && pnpm dev
```

The API will be available at http://localhost:${PORT:-8055}

To also run the app separately (optional):
```bash
cd app && pnpm dev
```

## Full Setup Flow

For a fresh worktree:
```
pnpm install
pnpm build
/dev start
/dev bootstrap
/dev run
```

## Notes

- Config is in `api/.env`
- Default Postgres port: 5100 (may vary per worktree)
- Default Directus port: 8055 (may vary per worktree)
- Admin login: admin@example.com / directus
