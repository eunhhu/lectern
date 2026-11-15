# P1-C 계약: LECTERN_PIPELINE 플래그와 job.cancel_requested_at

> 등급: `careful` · 게이트: `full` · 의존: `P0-01` · 소유: `packages/config/`, `packages/db/`, `docs/env.md`, `deploy/systemd/`, `docs/v2/pipeline/flags-on.env`, `apps/server/`
> (이 줄은 `pipeline.json`의 값과 같아야 한다.)

## 1. 목표

설정에 `LECTERN_PIPELINE`(`v1`|`v2`, 기본 `v1`)을 더하고(`config().pipeline`), `job` 테이블에 nullable 컬럼 `cancel_requested_at`을 더한다(마이그레이션 `p1_pipeline`). 플래그를 읽는 코드는 아직 없으므로 동작은 바뀌지 않는다. 게이트의 "플래그 켬" preflight에 `LECTERN_PIPELINE=v2`가 들어간다.

## 2. 먼저 읽을 것

- 계약: `CONTRACTS.md` §0.2, §0.3, §1.2, D-0-3, D-0-4, D-P1-8.
- 레시피: `RECIPES.md` R4(플래그), R1(컬럼 추가).
- 코드: `packages/config/src/index.ts` — `ENV`의 `LECTERN_TRANSCRIPT_ENGINE`(enum 본보기), `Config` 인터페이스, `loadConfig`.
- 코드: `packages/config/test/config.test.ts` — 기본값 테스트와 "docs/env.md is up to date" 테스트.
- 코드: `packages/db/src/schema.ts` — `job` 테이블(`finishedAt` 다음에 컬럼을 더한다).
- 코드: `packages/db/test/migrate.test.ts` — `res.applied` 목록 검사.
- 코드: `apps/server/test/v2-migration-rehearsal.test.ts` — `preP2Copy`가 0003 이후 migration을 되감는다(아래 5단계 7번).
- `deploy/systemd/lectern.env.example`, `docs/env.md`(자동 생성), `docs/v2/pipeline/flags-on.env`.

## 3. 사전 점검

```bash
git grep -n "LECTERN_TRANSCRIPT_ENGINE" -- packages/config/src/index.ts
git grep -n "finishedAt: integer" -- packages/db/src/schema.ts
git grep -n "0003_v2_entities" -- packages/db/test apps/server/test
git grep -n "LECTERN_TRANSCRIPT_ENGINE" -- deploy/systemd/lectern.env.example
git grep -n "config:docs\|\"generate\"" -- package.json packages/db/package.json
```

## 4. 만들 파일과 고칠 파일

| 경로 | 새로/수정 | 무엇 |
|---|---|---|
| `packages/config/src/index.ts` | 수정 | `ENV.LECTERN_PIPELINE`, `Config.pipeline`, `loadConfig` 연결 |
| `packages/config/test/config.test.ts` | 수정 | 기본값·변환·잘못된 값 테스트 |
| `docs/env.md` | 재생성 | `bun run config:docs` (손으로 고치지 않는다) |
| `deploy/systemd/lectern.env.example` | 수정 | 주석과 `LECTERN_PIPELINE=v1` 줄 |
| `docs/v2/pipeline/flags-on.env` | 수정 | `LECTERN_PIPELINE=v2` 줄 추가 |
| `packages/db/src/schema.ts` | 수정 | `job.cancelRequestedAt` |
| `packages/db/migrations/0004_p1_pipeline.sql`, `meta/0004_snapshot.json`, `meta/_journal.json` | 생성 | drizzle-kit이 만든다 |
| `packages/db/test/migrate.test.ts` | 수정 | 적용 목록과 새 컬럼 검사 |
| `apps/server/test/v2-migration-rehearsal.test.ts` | 수정 | 0004 되감기와 기대 목록 |

## 5. 단계

1. `packages/config/src/index.ts`의 `ENV`에서 `LECTERN_TRANSCRIPT_ENGINE` 바로 아래에 추가한다.
   ```ts
   LECTERN_PIPELINE: {
     schema: z.enum(["v1", "v2"]).default("v1"),
     description:
       "v1: a finished upload runs the distill job (audio in, Markdown out). v2: it runs the `process` job (transcript, then structured notes, CONTRACTS §1). Costs more than v1 per recording",
   },
   ```
2. 같은 파일 `Config`에 `pipeline: "v1" | "v2";`(위에 한 줄 영어 주석)를 넣고, `loadConfig` 반환 객체에 `pipeline: p.LECTERN_PIPELINE,`를 넣는다.
3. `deploy/systemd/lectern.env.example`의 `LECTERN_TRANSCRIPT_ENGINE=off` 줄 아래에 설명 주석 3줄과 `LECTERN_PIPELINE=v1`을 넣는다.
4. `docs/v2/pipeline/flags-on.env` 끝에 `LECTERN_PIPELINE=v2`를 한 줄 추가한다. 시크릿은 넣지 않는다.
5. `bun run config:docs`를 돌려 `docs/env.md`를 만든다.
6. `packages/db/src/schema.ts`의 `job`에서 `finishedAt` 다음 줄에 추가한다.
   ```ts
   /** Set by cancelJob (CONTRACTS D-P1-8); the running handler stops at its next check. */
   cancelRequestedAt: integer("cancel_requested_at"),
   ```
   그 다음 `bun run --cwd packages/db generate --name p1_pipeline`을 돈다. 생성된 SQL이 `ALTER TABLE \`job\` ADD \`cancel_requested_at\` integer;` 한 줄뿐인지 읽는다. `DROP`·`RENAME`이 있으면 멈추고 보고한다. 파일 이름이 `0004_p1_pipeline`이 아니면 세 파일과 journal `tag`를 함께 고친다.
7. `apps/server/test/v2-migration-rehearsal.test.ts`를 고친다. `preP2Copy`가 0003 이후 journal 항목을 `__drizzle_migrations`에서 지우는데, 컬럼은 남으므로 다시 적용할 때 "duplicate column"으로 깨진다. `copy.close()` 앞에 추가한다.
   ```ts
   try { copy.exec(`ALTER TABLE job DROP COLUMN cancel_requested_at`); } catch { /* column absent */ }
   ```
   `expect(report.migrations).toEqual(["0003_v2_entities"])`를 `["0003_v2_entities", "0004_p1_pipeline"]`로 바꾼다. 다른 `report.migrations` 단언이 있으면(`git grep -n "report.migrations"`) 같은 식으로 맞춘다.
8. `packages/db/test/migrate.test.ts`: `res.applied`를 `[..., "0003_v2_entities", "0004_p1_pipeline"]`로 바꾸고, 같은 테스트에 컬럼 검사를 더한다(6절).

## 6. 테스트

| 테스트 | 파일 | 준비 | 기대 |
|---|---|---|---|
| pipeline defaults to v1 | `packages/config/test/config.test.ts` | `loadConfig({})` | `.pipeline === "v1"` |
| pipeline accepts v2 | 같음 | `loadConfig({ LECTERN_PIPELINE: "v2" })` | `"v2"` |
| pipeline rejects other values | 같음 | `loadConfig({ LECTERN_PIPELINE: "v3" })` | `ConfigError`, issues에 `LECTERN_PIPELINE` |
| empty pipeline means default | 같음 | `{ LECTERN_PIPELINE: "" }` | `"v1"` |
| docs/env.md is up to date | 같음(기존) | — | 통과 |
| fresh db has job.cancel_requested_at | `packages/db/test/migrate.test.ts` | 새 DB에 `runMigrations`, `PRAGMA table_info(job)` | `cancel_requested_at` 컬럼이 있고 `notnull = 0` |
| existing job rows survive | 같음 | 0003까지만 적용한 DB는 만들기 어렵다. 대신 새 DB에서 `INSERT INTO job (id, owner_id, kind, run_after, created_at)` 후 `SELECT cancel_requested_at` | `null` |
| rehearsal still passes | `v2-migration-rehearsal.test.ts` | 기존 테스트 | 통과, `migrations`가 두 항목 |

## 7. 검증 명령

```bash
bun test packages/config packages/db apps/server/test/v2-migration-rehearsal.test.ts
```
```bash
bash scripts/pipeline/gate.sh full
```

## 8. 하지 않는 것

- `config().pipeline`을 읽는 코드(업로드 분기, `process` 작업): P1-12가 한다.
- `cancel_requested_at`을 쓰거나 읽는 코드와 `JobKind`/domain 변경: P1-13이 한다(`JobKind`에는 이미 `process`, `regenerate`가 있다).
- 다른 플래그 추가, 기존 플래그 의미 변경 금지.
- 생성된 마이그레이션 파일을 손으로 고치기 금지(이름 맞춤 제외).

## 9. 끝났다는 기준

- [ ] 6절의 테스트가 모두 있고 통과한다
- [ ] 7절의 게이트가 통과한다(preflight 끔·켬)
- [ ] 바뀐 파일이 전부 소유 경로 안이다
- [ ] 실제 외부 호출이 없다
- [ ] 마이그레이션 SQL에 `DROP`/`RENAME`이 없다
- [ ] `docs/env.md`는 `bun run config:docs`로만 바뀌었다

## 10. 명세 작성자 메모

- `apps/server/test/v2-migration-rehearsal.test.ts`가 "0003 이후 전부 되감기 + 기대 목록 `["0003_v2_entities"]`"에 묶여 있어서, 0004를 더하면 그대로는 실패한다. 5단계 7번처럼 `apps/server/`(소유 안) 테스트를 고친다. 기존 단언을 느슨하게 만드는 것이 아니라 새 마이그레이션을 반영하는 갱신이다.
- `ALTER TABLE ... DROP COLUMN`은 SQLite 3.35+에 필요하다. Bun 내장 SQLite는 충족하지만 확인은 하지 못했다.
