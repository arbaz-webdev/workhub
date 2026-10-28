# Backup-restore drill

Goal (issue #73): **point-in-time recovery tested end to end.** If data is deleted or
damaged, we can bring the database back to how it was at a chosen moment, and the site
runs on it safely.

## How backups work

The database is on Neon. Neon keeps a history of every change, so instead of nightly dumps
you restore to any moment inside the plan's restore window (see **Settings → Instant
restore** in the Neon console; it's short on the free plan and longer on paid plans). Check
the window before launch and pick a plan whose window covers how late you'd notice a problem.

A restore can make a **new branch** at that moment (a separate copy, leaving the live data
alone) or roll the main branch back. Drill on a new branch first, so nothing live changes.

## The drill (about 20 minutes, every quarter and before launch)

You need the live database's owner connection string (Neon → **Connect**, direct, not pooled).
Keep connection strings in environment variables, not typed into the command:

```bash
export LIVE_URL='<live owner connection string>'
```

1. **Snapshot.** Note the time and what's in the database:

   ```bash
   node scripts/backup-drill.mjs snapshot --db "$LIVE_URL" --out drill.json
   ```

2. **Make a change to recover from** (optional, but it proves the restore goes back in
   time): in the app, delete a test task or send and delete a message.

3. **Restore to the snapshot time.** Neon console → **Branches → Create branch**: parent
   `main`, **from a point in time**, the time the snapshot printed. Name it `drill-YYYY-MM-DD`.
   Copy the new branch's owner connection string:

   ```bash
   export RESTORED_URL='<the drill branch connection string>'
   ```

4. **Verify** the restored copy has everything the snapshot had, with Row-Level Security on:

   ```bash
   node scripts/backup-drill.mjs verify --db "$RESTORED_URL" --snapshot drill.json
   ```

   It exits 1 and lists what's wrong if a table, migration or row is missing, or RLS is off.
   The thing you changed in step 2 should be back as it was.

5. **Run the site on it** (proves the app works on restored data, not only that rows exist):
   locally, set `DATABASE_URL="$RESTORED_URL"` and `APP_DB_PASSWORD` to the staging value in
   `apps/api/.env`, start the API and website, sign in and open a project and the inbox.
   The API migrates and recreates its restricted user on start, as it does on Render.

6. **Clean up.** Delete the drill branch in Neon, delete `drill.json` (it lists table sizes),
   and note the date, the restore point and how long it took in the log below.

### If it's real

Do steps 3–5 to check the restored branch, then either point Render's `DATABASE_URL` at that
branch, or use Neon's **Restore** to roll `main` back to it. Write down the time first; anything
written after the restore point is lost (export it from the old branch first if it matters).

## Log

| Date | Where | Restore point | Result | Time taken |
|---|---|---|---|---|
| 2026-10-29 | Local dev database, a copy made with `create database … template` (stands in for the branch) | 22:37 UTC | PASS on the copy; FAIL as expected after deleting 3 messages and turning RLS off on `tasks` | 2 min |
| — | Neon staging, point-in-time branch | | **To do** (needs your Neon login) | |
