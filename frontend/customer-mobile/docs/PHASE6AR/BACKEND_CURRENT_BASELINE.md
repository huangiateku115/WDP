# Phase 6A-R — Current Backend baseline

Audit date: **7/11/2026**, Asia/Bangkok. Documentation-only audit; no implementation or live requests.

## Workspace and authority

- Actual root: `C:/Users/laptop/Desktop/WDP`.
- Website: `frontend/src`, React/Vite, Customer/Staff/Manager/Admin/BOM routes.
- Native app: `frontend/customer-mobile`, Expo/React Native, 23 offline designs.
- Current Backend: `backend/src`, Express/TypeScript/Mongoose/Keycloak. **Read-only access explicitly authorized by the Phase 6A-R request**, replacing the previous task's prohibition. No additional repository AGENTS file found within the inspected Backend/reference trees. `frontend/AGENTS.md` was read before work.
- Reference: `BE-REF`; not silently substituted for current Backend. The 221 historical file paths now have identical bytes between current Backend and BE-REF. Current baseline manifests include 257 text source/test/doc/config files in each tree. `.env*`, secrets, node_modules, generated artifacts and symlinks excluded from content reads/hashes.

## Git identity and history

Repository: `huangiateku115/WDP`. Branch: **Frontend**. Local HEAD: **b7f09b48299882075d6c16511f8419fdb040488a**, also labelled `origin/dev` locally. HEAD dated 5/11/2026, merge of `feat/mi07-managed-rental-closure`.

Relevant history read without changing Git:

| Commit | Date | Observed history subject |
| --- | --- | --- |
| b7f09b4 | 2026-11-05 | Merge pull request #20, managed rental closure |
| 4555658 | 2026-11-05 | Integrated PayOS payment |
| 484f02a | 2026-10-31 | fix bug storage |
| 7a5cd84 | 2026-10-26 | Repeated inbound Postman work / reliable old baseline content |
| 0c77762 | 2026-10-25 | Stock Ledger Foundation |

The previous audit did not record a Git revision. This audit compared **all 221 historical BE-REF hashes** from `PHASE6A_SOURCE_BASELINE.json` against Git object contents at `7a5cd84`, both raw and CRLF-normalized: **221/221 match**. Therefore `7a5cd84` is a reliable content baseline for those files, not a guess based on commit dates. Existing historical audit documents remain unchanged.

Git history diff `7a5cd84..HEAD` under Backend src/tests: **41 files, 8303 insertions, 592 deletions**. Of the historical 221 paths, 34 current files have different raw hashes. Added PayOS/closure files are outside that old manifest. These counts have different denominators; neither is an API change count.

Normal `git status` and `rev-parse HEAD` with a worktree failed because Git could not chdir to the parent under current permissions; the connected workspace info/status tools also returned internal errors. Read-only `--git-dir` object/log commands worked. A separate comparison of **1523 tracked Backend/Frontend files** against HEAD (raw/normalized line endings, secret paths excluded) found **0 content differences**. This is not a complete Git index/untracked status assertion. `SOURCE_BASELINE.json` records all 1186 selected pre-existing text files across Frontend/Backend/BE-REF so existing untracked work is preserved independently of Git. No reset, checkout, fetch, clean, add or commit ran.

## Registered surface and tools

`backend/src/app.ts` mounts `/api/v1`; `src/routes/index.ts` mounts 20 route modules. Expanded inventory: **184 unique method/path registrations**, including root and health. Pricing router factory expanded separately for `/pricing-rules` and `/policies`. Previous equivalent full route inventory: 178. Old Phase 6A's 86 was a **selected Customer/dependency subset**, not all Backend routes.

Evidence files:

- `REGISTERED_ROUTES.json`: exact route file/line, middleware aliases, handlers and controller extracts.
- `API_CHANGE_MATRIX.csv`: 184 rows, source request/response pointers, current gate/lifecycle/retry detail and historical selected operation links.
- `API_OPERATIONS.json`: same operation records, including full current controller extracts where resolved.
- `REVISION_METADATA.json`: verified Git/baseline matching and tracked-content comparison.
- `HISTORICAL_FILE_COMPARISON.json`: raw hash comparison against old manifest.
- `SOURCE_EVIDENCE.md`: current anchors/snippets for findings.

Backend scripts expose build/start/dev/seed; **none executed**. Tests read as evidence, including new PayOS, storage/reservation, inspection, closure-readiness and inventory concurrency tests. Backend tests often require compiled dist or database safety prerequisites: no build, test, migration, seed, transaction probe or provider call was performed.

No revision-matched mounted OpenAPI spec was established. README/Postman/docs were treated as supporting documentation; route/controller/service/model code controls conclusions. No remote fetch or deployment introspection performed.

## Deployment distinction

**Source revision verified; deployment revision UNVERIFIED.** Config variable names/gate code inspected, never environment values. The presence of PayOS SDK and routes does not establish configured keys, webhook registration, provider account, HTTPS origin, Mongo transaction topology, capability rollout or production availability. The status GET may reconcile/write payment checkout state: no live GETs were used to audit it.

All future integration requires deployment revision/capabilities, approved non-production test accounts/facilities and data-write authorization. No credentials requested or recorded.
