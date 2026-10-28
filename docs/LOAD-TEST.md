# Load test

Target (issue #72): **1,000 people using WorkHub at once, API p95 under 300 ms.**

`scripts/load-test.mjs` simulates people with the app open. Each virtual user:
- keeps the inbox's live stream open, as every signed-in tab does;
- every 1.5–4.5 seconds (3 s on average) loads what a page needs: who they are, today's
  attendance, the inbox summary and who's online, projects, the dashboard, notifications,
  clients, workspace settings, weighted by how often the app asks for each.

It only reads, so it can run against a database with real data in it. Virtual users share
the sessions of a few accounts (signing in 1,000 times would just test the sign-in rate limit).

## Results: 29 October 2026

One desktop ran everything: the API (compiled, one process), Postgres 17, and the load
generator. AMD Ryzen 5 5600 (6 cores), 16 GB, Windows 11. Pool of 10 database connections.

**1,000 users, about 308 requests a second, 60 s measured: PASS.**

| Endpoint | Requests | Errors | p50 | p95 | p99 | Max |
|---|---:|---:|---:|---:|---:|---:|
| GET /auth/me | 3,772 | 0 | 3 | 9 | 14 | 49 |
| GET /chat/summary | 2,826 | 0 | 6 | 14 | 21 | 47 |
| GET /attendance/today | 2,824 | 0 | 8 | 20 | 29 | 60 |
| GET /chat/presence | 1,884 | 0 | 5 | 14 | 19 | 52 |
| GET /projects | 1,853 | 0 | 4 | 11 | 16 | 44 |
| GET /dashboard | 1,546 | 0 | 7 | 18 | 27 | 49 |
| GET /notifications | 1,185 | 0 | 4 | 11 | 16 | 37 |
| GET /attendance/me | 1,120 | 0 | 8 | 18 | 29 | 55 |
| GET /companies | 940 | 0 | 4 | 10 | 18 | 33 |
| GET /workspaces/current | 938 | 0 | 4 | 10 | 17 | 44 |
| **All requests** | **18,888** | **0** | **6** | **15** | **23** | **60** |

Times in milliseconds. All 1,000 live streams stayed open throughout.

### Where it stops

The same 1,000 users, but each asking three times as often (one request a second, far
busier than people really click), saturated the machine at about **650 requests a second**:
p95 rose to 907 ms, still with no errors. A larger connection pool (30) made it slower, not
faster, so the limit is CPU, shared here by the API, Postgres and the load generator, not
the database pool.

So one API copy has roughly twice the headroom the target needs. Past that, run more copies
of the API: since Sprint 12 they share rate limits and live updates through Redis
(`REDIS_URL`), so adding copies needs no code changes.

### Not covered

- The free staging site (0.1 CPU, 512 MB, sleeps when idle) was not load-tested: it isn't
  sized for this, and a hammered free service can be suspended. Run this against the paid
  setup before launch, with `--allow-remote`.
- Writes (check-ins, messages, task moves) aren't part of the mix. They go through the same
  transaction path as reads, but are worth adding once there's a disposable test workspace on
  the paid setup.

## Running it

Start the API and the database, then (the local demo accounts are in the README):

```bash
LOAD_TEST_PASSWORD=<the demo accounts' password> node scripts/load-test.mjs --users 1000 --duration 60
```

Useful options: `--think 1000` (busier users), `--emails a@x,b@y` (other accounts; they must
not use two-factor sign-in), `--no-streams`, `--json results.json`. It exits 1 if p95 is over
300 ms or more than 1% of requests fail. It refuses any address but localhost unless you pass
`--allow-remote`. `DATABASE_POOL_SIZE` sets the API's connections to Postgres (default 10;
keep copies × pool size under the database's connection limit).
