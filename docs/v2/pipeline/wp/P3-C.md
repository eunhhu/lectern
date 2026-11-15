# P3-C 계약: LECTERN_PDF, pdf_page, 라우트, pdfjs-dist

> 등급: `careful` · 게이트: `full` · 의존: `P2-C` · 소유: `packages/config/`, `packages/db/`, `packages/domain/`, `packages/pdf/`, `docs/env.md`, `deploy/systemd/`, `docs/v2/pipeline/flags-on.env`, `apps/server/`, `apps/web/package.json`, `bun.lock`, `tsconfig.json`
> (이 줄은 `pipeline.json`의 값과 같아야 한다.)

## 1. 목표

PDF 기능의 바닥을 깐다. 플래그 `LECTERN_PDF`(기본 꺼짐), 테이블 `pdf_page`(마이그레이션 `p3_pdf`), domain 라우트 3개(서버는 501 스텁), 새 워크스페이스 `packages/pdf`(뼈대 + `pdfjs-dist` 정확한 버전), `apps/web`에도 같은 버전의 `pdfjs-dist`. 동작은 바뀌지 않는다(플래그를 읽는 코드가 아직 없다).

## 2. 먼저 읽을 것

- 계약: `CONTRACTS.md` §0.1(D-0-3~D-0-5), §0.2, §0.3, §3 전체(D-P3-1, D-P3-2, DB `p3_pdf`, domain 라우트 표)
- 레시피: `RECIPES.md` R1(테이블), R2(domain), R3(501 스텁), R4(플래그)
- 코드: `packages/config/src/index.ts` — `ENV`, `bool`, `Config`, `loadConfig` (`LECTERN_ASK` 옆에 넣는다)
- `packages/db/src/schema.ts` — `asset`, `searchChunk` (표 모양 본보기), `packages/db/test/migrate.test.ts`
- `packages/domain/src/api/resources.ts` — `AssetParams`, `RecordingParams`, `SearchKind`(이미 `pdf_page` 있음), `PdfPageSearchHit`; `api/ask.ts` — `AskPdfPageCitation`(이미 있음)
- `packages/domain/src/api/routes.ts` — `ROUTES`의 `getAssetContent` 항목, `json`
- `apps/server/src/api/v2/assets.ts` — `assetsRouter`; `recordings.ts` — `recordingsRouter`; `common.ts` — `notImplemented`; `apps/server/test/api-v2.test.ts` — `NOT_YET`
- `packages/media/package.json` — 새 워크스페이스 패키지의 모양
- `apps/web/README.md` — 의존성을 `--minimum-release-age=1209600`로 고정했다는 설명

## 3. 사전 점검

```bash
git grep -n "LECTERN_ASK:" -- packages/config/src/index.ts
git grep -n "export const asset = sqliteTable" -- packages/db/src/schema.ts
git grep -n "export const AssetParams\|export const RecordingParams\|export const SearchKind" -- packages/domain/src/api/resources.ts
git grep -n "AskPdfPageCitation\|PdfPageSearchHit" -- packages/domain/src/api
git grep -n "operationId: \"getAssetContent\"" -- packages/domain/src/api/routes.ts
git grep -n "export const assetsRouter\|export const recordingsRouter" -- apps/server/src/api/v2
git grep -n "const NOT_YET" -- apps/server/test/api-v2.test.ts
git grep -n "notImplemented" -- apps/server/src/api/v2/common.ts
test -f docs/v2/pipeline/flags-on.env && ls packages/media/package.json
bun pm view pdfjs-dist version   # 네트워크 읽기: 허용
```

## 4. 만들 파일과 고칠 파일

| 경로 | 새로/수정 | 무엇 |
|---|---|---|
| `packages/config/src/index.ts` | 수정 | `LECTERN_PDF`, `Config.pdf` |
| `packages/config/test/config.test.ts` | 수정 | 기본값·값 변환 |
| `docs/env.md` | 수정 | `bun run config:docs`로 재생성 |
| `deploy/systemd/lectern.env.example` | 수정 | `LECTERN_PDF=0` |
| `docs/v2/pipeline/flags-on.env` | 수정 | `LECTERN_PDF=1` |
| `packages/db/src/schema.ts` | 수정 | `pdfPage` 표 |
| `packages/db/migrations/*_p3_pdf.sql`, `meta/*` | 새로(생성) | drizzle이 만든다 |
| `packages/db/test/migrate.test.ts` | 수정 | 적용 목록·표 목록 |
| `packages/domain/src/api/resources.ts`, `routes.ts`, `test/fixtures.ts`, `openapi.json` | 수정 | 3개 라우트와 DTO |
| `apps/server/src/api/v2/assets.ts`, `recordings.ts`, `README.md`, `test/api-v2.test.ts` | 수정 | 501 스텁 |
| `packages/pdf/package.json`, `src/index.ts`, `test/package.test.ts` | 새로 | 뼈대 |
| `apps/web/package.json`, `bun.lock` | 수정 | `pdfjs-dist` 정확한 버전 |
| `apps/server/package.json` | 수정 | `"@lectern/pdf": "workspace:*"` 의존성 |

## 5. 단계

1. **버전 고르기(코드 전에).** `bun pm view pdfjs-dist time --json`으로 버전별 게시일을 본다. 오늘 날짜에서 14일 이상 지난 것 중 가장 새 **정식 버전**(`-` 붙은 프리릴리스 제외)을 `V`로 정한다. 같은 방법으로 `pdf-lib`의 `W`를 정한다. 어떤 값도 추측하지 않는다. 보고에 `V`, `W`, 게시일을 적는다.
2. `packages/config/src/index.ts`: `ENV`에 `LECTERN_PDF: { schema: bool(false), description: "1: accept PDF uploads, extract their pages, show the PDF viewer and cite pages. 0: PDF uploads are refused as today" }`. `Config`에 `pdf: boolean`, `loadConfig` 반환에 `pdf: p.LECTERN_PDF`. 테스트: `loadConfig({}).pdf === false`, `loadConfig({LECTERN_PDF:"1"}).pdf === true`, `"2"`는 `ConfigError`.
3. `bun run config:docs`; `lectern.env.example`에 `LECTERN_ASK` 아래 주석 + `LECTERN_PDF=0`; `flags-on.env`에 `LECTERN_PDF=1`.
4. `schema.ts`에 추가(DDL은 CONTRACTS §3 그대로):
```ts
export const pdfPage = sqliteTable(
  "pdf_page",
  {
    assetId: text("asset_id").notNull(),
    pageNo: integer("page_no").notNull(),
    workspaceId: text("workspace_id").notNull(),
    recordingId: text("recording_id").notNull(),
    text: text("text").notNull(),
    charCount: integer("char_count").notNull(),
    hasTextLayer: integer("has_text_layer").notNull(),
    ocrSource: text("ocr_source", { enum: ["device", "model"] }),
  },
  (t) => [primaryKey({ columns: [t.assetId, t.pageNo] }), index("idx_pdf_page_recording").on(t.recordingId)]
);
```
5. `bun run --cwd packages/db generate --name p3_pdf`. 생성된 SQL에 `DROP`/`RENAME`이 없는지 읽는다. 파일 이름이 `_p3_pdf`로 끝나지 않으면 세 파일과 `_journal.json`의 `tag`를 함께 고친다. `migrate.test.ts`의 `applied` 목록 끝에 새 태그, 표 목록에 `pdf_page`.
6. domain `resources.ts`(`named`, `.default()` 금지):
```ts
export const AssetPageInfo = named("AssetPageInfo", z.object({ page_no: z.int().min(1), has_text_layer: z.boolean(), char_count: z.int().nonnegative() }));
export const AssetPages = named("AssetPages", z.object({ page_count: z.int().nonnegative(), scanned: z.boolean(), pages: z.array(AssetPageInfo) }));
export const OcrAssetRequest = named("OcrAssetRequest", z.object({ dry_run: z.boolean() }));
export const OcrAssetResponse = named("OcrAssetResponse", z.object({ pages_to_ocr: z.int().nonnegative(), estimated_cost_microusd: MicroUsd, job_id: JobId.nullable() }));
export const AlignmentPage = named("AlignmentPage", z.object({ asset_id: AssetId, page_no: z.int().min(1), score: z.number() }));
export const AlignmentWindow = named("AlignmentWindow", z.object({ start_ms: Milliseconds, end_ms: Milliseconds, pages: z.array(AlignmentPage) }));
export const RecordingAlignment = named("RecordingAlignment", z.object({ windows: z.array(AlignmentWindow) }));
```
   필요한 import(`MicroUsd`, `JobId`, `Milliseconds`, `AssetId`)는 `primitives.ts`에 있는지 `git grep`으로 확인하고 없는 것만 가져온다.
7. `routes.ts`에 `getAssetContent` 아래로 추가: `GET /assets/{asset_id}/pages` `listAssetPages`(params `R.AssetParams`, 200 `AssetPages`, errors `[403, 404]`), `POST /assets/{asset_id}/ocr` `ocrAsset`(params `R.AssetParams`, `headers: idempotent`가 있으면 사용, body `OcrAssetRequest`, 200 `OcrAssetResponse`(dry run), 202 `OcrAssetResponse`(큐에 넣음), errors `[400, 403, 404, 409, 429]`), `GET /recordings/{recording_id}/alignment` `getRecordingAlignment`(params `R.RecordingParams`, 200 `RecordingAlignment`, errors `[403, 404]`). tag는 `recordings`. `test/fixtures.ts`의 `API_CASES`에 새 이름 5개(`AssetPages`, `OcrAssetRequest`, `OcrAssetResponse`, `RecordingAlignment` 등 `named`로 만든 것 전부)의 valid/invalid 케이스. `bun run domain:openapi`.
8. 서버: `assets.ts`의 `assetsRouter`에 `listAssetPages: notImplemented, ocrAsset: notImplemented`, `recordings.ts`의 `recordingsRouter`에 `getRecordingAlignment: notImplemented`. `api-v2.test.ts`의 `NOT_YET`에 세 operationId. `README.md` 표에 세 줄(상태 `501, P3-03/05/04`).
9. `packages/pdf/package.json`: `packages/media/package.json`을 본떠 `name: "@lectern/pdf"`, `version 0.1.0`, `private`, `type module`, `main/exports ./src/index.ts`, `dependencies: { "pdfjs-dist": "V" }`, `devDependencies: { "pdf-lib": "W" }`(둘 다 `^` 없음). `src/index.ts`는 `export const PDF_PACKAGE = "@lectern/pdf";` 한 줄과 주석(P3-02가 채운다). `test/package.test.ts`: 위 상수를 import해 확인.
10. `apps/server/package.json`의 `dependencies`에 `"@lectern/pdf": "workspace:*"`를 더한다(P3-03·P3-05가 서버에서 `extractPdfPages`를 부른다).
11. `apps/web/package.json`의 `dependencies`에 `"pdfjs-dist": "V"`(알파벳 순서, `^` 없음).
12. `bun install --minimum-release-age=1209600`(`bun.lock` 갱신). 이어서 `bun install --frozen-lockfile`이 통과하는지 확인.
13. CSP: `apps/server/src/index.ts`의 `HTML_CONTENT_SECURITY_POLICY`에는 `default-src 'self'`가 있어 같은 오리진 워커는 `worker-src` 없이도 열린다. **바꾸지 않는다.** 단 `blob:` 워커는 막힌다(P3-08이 워커를 `/app/assets/`에서 불러야 하는 이유).

## 6. 테스트

| 파일 | 테스트 이름 | 준비 | 기대 |
|---|---|---|---|
| `packages/config/test/config.test.ts` | pdf flag defaults off | `loadConfig({})` | `pdf === false` |
| 같은 파일 | pdf flag on and invalid | `{LECTERN_PDF:"1"}` / `{LECTERN_PDF:"2"}` | `true` / `ConfigError` |
| 같은 파일 | env docs up to date | 기존 테스트 | 통과 |
| `packages/db/test/migrate.test.ts` | fresh db has pdf_page | 빈 DB에 `runMigrations` | `applied` 끝이 `_p3_pdf`로 끝남, `pdf_page` 표 존재, 컬럼 8개, PK `(asset_id, page_no)` |
| 같은 파일 | existing rows survive | 0003까지 적용 후 `asset` 1행 넣고 다시 마이그레이션 | 행 유지 |
| `packages/domain/test/*` | 기존 openapi·api 테스트 | — | 통과, `openapi.json` 최신, 기존 라우트 불변 |
| `apps/server/test/api-v2.test.ts` | NOT_YET 501 | 기존 루프 | 세 라우트가 501 `not_implemented` |
| `packages/pdf/test/package.test.ts` | exports marker | import | `"@lectern/pdf"` |
| 같은 파일 | versions are pinned | `package.json` 읽기 | 두 의존성 문자열이 `/^\d+\.\d+\.\d+$/` |
| 같은 파일 | web uses same pdfjs version | `apps/web/package.json` 읽기 | `pdfjs-dist` 값이 `packages/pdf`의 값과 같다 |

## 7. 검증 명령

```bash
bun test packages/config packages/db packages/domain packages/pdf apps/server/test/api-v2.test.ts
```
```bash
bash scripts/pipeline/gate.sh full
```

## 8. 하지 않는 것

- 업로드 수락: P3-01. 추출 함수: P3-02. 라우트 실제 구현: P3-03(`listAssetPages`), P3-05(`ocrAsset`), P3-04(`getRecordingAlignment`).
- 웹 번들 설정·워커 파일 복사: P3-08. `^`·`~` 범위 쓰기, 프리릴리스 쓰기, 시스템 PDF 도구 의존.
- CSP 완화. `pdf_page`에 컬럼을 계약 밖으로 더하기.

## 9. 끝났다는 기준

- [ ] 6절의 테스트가 모두 있고 통과한다
- [ ] 7절의 게이트가 통과한다
- [ ] 바뀐 파일이 전부 소유 경로 안이다
- [ ] 실제 외부 호출이 없다(`bun pm view`는 레지스트리 읽기라 허용)
- [ ] `bun install --frozen-lockfile` 통과, `^` 없음
- [ ] 보고에 `pdfjs-dist` 버전과 게시일, `pdf-lib` 버전과 게시일을 적었다
- [ ] `LECTERN_PDF` 꺼짐에서 기존 동작이 그대로다

## 10. 명세 작성자 메모

- `SearchKind`·`PdfPageSearchHit`·`AskPdfPageCitation`·`SourceRef`의 `pdf_page`는 이미 domain에 있다. CATALOG의 "없으면 추가"는 해당 없음.
- `packages/harness/package.json`은 소유 밖이라 `@lectern/pdf`를 더하지 않는다. P3-03은 추출 함수를 서버가 주입하는 방식으로 쓴다(P3-03 명세).
- `pdf-lib`를 루트가 아니라 `packages/pdf`의 devDependency로 둔다(루트 `package.json`은 소유 밖).
- 버전 `V`, `W`는 레지스트리를 읽어야 알 수 있어 명세에 적지 않았다.
- `ocrAsset`의 `headers: idempotent` 변수명이 `routes.ts`에 있는지는 워커가 확인한다(`reprocessRecording`이 쓴다).
