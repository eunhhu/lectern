# 환경 변수 레퍼런스

> 자동 생성 파일입니다. `packages/config/src/index.ts`를 고친 뒤 `bun run config:docs`로 다시 만드세요.

| Variable | Default | | Description |
|---|---|---|---|
| `PORT` | `18775` |  | HTTP port (binds 127.0.0.1) |
| `LECTERN_BASE_URL` | `https://lectern.qucord.com` |  | Public origin; an http:// value drops the cookie Secure flag (local dev) |
| `LECTERN_DATA_DIR` | — |  | SQLite DB, uploads, trash and backups (default: <repo>/data) |
| `LECTERN_LECTURES_DIR` | — |  | Owner's Markdown/audio archive synced into the library (default: <repo>/lectures) |
| `LECTERN_REPO_DIR` | — |  | Checkout the CD webhook resets to origin/main; deploys are refused without one |
| `LECTERN_WORKER_MODE` | `embedded` |  | embedded: the API process also runs the job worker (until lectern-worker.service is installed); external: only apps/worker runs jobs |
| `LECTERN_TRUSTED_PROXY_HOPS` | `1` |  | Reverse proxies in front of the server (X-Forwarded-For hops to trust) |
| `LECTERN_WEB_SHELL` | `false` |  | 1: serve the new web app (apps/web/dist, built with `bun run web:build`) at /app |
| `LECTERN_LOG_REQUESTS` | `true` |  | Write one log line per request |
| `LECTERN_LOG_FORMAT` | `json` |  | json for journald/production, pretty for local development |
| `LECTERN_SHUTDOWN_GRACE_SEC` | `20` |  | Seconds running jobs get to finish on SIGTERM / deploy |
| `LECTERN_MAX_CONCURRENT_JOBS` | `2` |  | Concurrent distillations |
| `LECTERN_JOB_LEASE_TTL_MS` | `60000` |  | How long a worker's claim on a job lasts without a heartbeat before others reclaim it |
| `LECTERN_JOB_POLL_MS` | `1000` |  | Worker poll interval for new jobs |
| `LECTERN_MAX_CONCURRENT_COMPACT` | `1` |  | Concurrent audio compactions |
| `LECTERN_MAINTENANCE_INTERVAL_MIN` | `60` |  | Maintenance cadence (expired rows, trash, retention, backups, WAL) |
| `LECTERN_BACKUP_KEEP` | `7` |  | Database backups kept |
| `LECTERN_BACKUP_INTERVAL_HOURS` | `24` |  | Hours between backups |
| `LECTERN_TRASH_DAYS` | `7` |  | Days before trashed uploads are deleted |
| `LECTERN_GEMINI_MODEL` | `gemini-3.8-flash` |  | Pinned Gemini model id (never a -latest alias) |
| `LECTERN_GEMINI_ALLOWED_MODELS` | — |  | Comma-separated extra model ids requests may select |
| `LECTERN_GEMINI_TIMEOUT_MS` | `900000` |  | Deadline for one generateContent call |
| `LECTERN_DISTILL_ENGINE` | `legacy` |  | legacy: the distill job calls packages/core directly; harness: the same Gemini call runs as one stage on packages/harness (stage_run, artifact and ai_call cost rows, resume without a second Gemini call) |
| `LECTERN_TRANSCRIPT_ENGINE` | `off` |  | v2 transcript pipeline (packages/harness: ingest → … → speakers, AI_HARNESS §11 step 3). off: not run. shadow: after a distill on the server key succeeds, a `transcribe` job transcribes the recording again (Gemini, about $0.2 per hour of audio) and keeps the transcript as a harness artifact nobody sees. on: will publish the transcript once the transcript tables exist; until then it runs as shadow |
| `LECTERN_ASK` | `false` |  | 1: turn on 물어보기 (/api/v2/ask) and its search index over each user's lectures (ADR-0009); index jobs and answers call Gemini (cost). 0: the ask routes answer 501 |
| `LECTERN_ASK_MONTHLY_LIMIT_MICROUSD` | `2000000` |  | Per-workspace monthly ask budget in micro-USD (2000000 = $2, ROADMAP D14); 0 blocks asking |
| `LECTERN_LEGAL_CONTACT_EMAIL` | — |  | Contact address printed on /privacy and /terms (account deletion and data requests); a role address such as privacy@, not a personal one |
| `LECTERN_LEGAL_OFFICER_NAME` | — |  | 개인정보 보호책임자 name printed on /privacy |
| `LECTERN_LEGAL_EFFECTIVE_DATE` | — |  | 공고·시행일 of the current /privacy and /terms (YYYY-MM-DD) |
| `LECTERN_OWNER_EMAIL` | — |  | Bootstrap owner account email |
| `LECTERN_OWNER_NAME` | — |  | Bootstrap owner display name |
| `LECTERN_OWNER_ALIASES` | — |  | Comma-separated login ids that resolve to the owner email |
| `LECTERN_OWNER_PASSWORD` | — | secret | Initial owner password (only used when the owner account is created) |
| `LECTERN_FORCE_RESET_OWNER_PASSWORD` | `false` |  | 1: reset the owner password to LECTERN_OWNER_PASSWORD at boot |
| `LECTERN_OWNER_API_TOKEN` | — | secret | Fixed owner API token |
| `LECTERN_DEPLOY_TOKEN` | — | secret | CD webhook secret |
| `GEMINI_API_KEY` | — | secret | Gemini API key (paid tier) |
| `RESEND_API_KEY` | — | secret | Resend email API key |
| `RESEND_FROM_EMAIL` | `Lectern <noreply@qucord.com>` |  | From address for verification and reminder email |
| `LECTERN_RESEND_CREDENTIALS_FILE` | — |  | JSON file with resend.api_key, used when RESEND_API_KEY is unset |
