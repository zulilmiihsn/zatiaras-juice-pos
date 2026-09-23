<!-- rtk-instructions v2 -->

# RTK (Rust Token Killer) - Token-Optimized Commands

## Golden Rule

**Always prefix commands with `rtk`**. If RTK has a dedicated filter, it uses it. If not, it passes through unchanged. This means RTK is always safe to use.

**Important**: Even in command chains with `&&`, use `rtk`:

```bash
# ❌ Wrong
git add . && git commit -m "msg" && git push

# ✅ Correct
rtk git add . && rtk git commit -m "msg" && rtk git push
```

## RTK Commands by Workflow

### Build & Compile (80-90% savings)

```bash
rtk cargo build         # Cargo build output
rtk cargo check         # Cargo check output
rtk cargo clippy        # Clippy warnings grouped by file (80%)
rtk tsc                 # TypeScript errors grouped by file/code (83%)
rtk lint                # ESLint/Biome violations grouped (84%)
rtk prettier --check    # Files needing format only (70%)
rtk next build          # Next.js build with route metrics (87%)
```

### Test (60-99% savings)

```bash
rtk cargo test          # Cargo test failures only (90%)
rtk go test             # Go test failures only (90%)
rtk jest                # Jest failures only (99.5%)
rtk vitest              # Vitest failures only (99.5%)
rtk playwright test     # Playwright failures only (94%)
rtk pytest              # Python test failures only (90%)
rtk rake test           # Ruby test failures only (90%)
rtk rspec               # RSpec test failures only (60%)
rtk test <cmd>          # Generic test wrapper - failures only
```

### Git (59-80% savings)

```bash
rtk git status          # Compact status
rtk git log             # Compact log (works with all git flags)
rtk git diff            # Compact diff (80%)
rtk git show            # Compact show (80%)
rtk git add             # Ultra-compact confirmations (59%)
rtk git commit          # Ultra-compact confirmations (59%)
rtk git push            # Ultra-compact confirmations
rtk git pull            # Ultra-compact confirmations
rtk git branch          # Compact branch list
rtk git fetch           # Compact fetch
rtk git stash           # Compact stash
rtk git worktree        # Compact worktree
```

Note: Git passthrough works for ALL subcommands, even those not explicitly listed.

### GitHub (26-87% savings)

```bash
rtk gh pr view <num>    # Compact PR view (87%)
rtk gh pr checks        # Compact PR checks (79%)
rtk gh run list         # Compact workflow runs (82%)
rtk gh issue list       # Compact issue list (80%)
rtk gh api              # Compact API responses (26%)
```

### JavaScript/TypeScript Tooling (70-90% savings)

```bash
rtk pnpm list           # Compact dependency tree (70%)
rtk pnpm outdated       # Compact outdated packages (80%)
rtk pnpm install        # Compact install output (90%)
rtk npm run <script>    # Compact npm script output
rtk npx <cmd>           # Compact npx command output
rtk prisma              # Prisma without ASCII art (88%)
```

### Files & Search (60-75% savings)

```bash
rtk ls <path>           # Tree format, compact (65%)
rtk read <file>         # Code reading with filtering (60%)
rtk grep <pattern>      # Search grouped by file (75%). Format flags (-c, -l, -L, -o, -Z) run raw.
rtk find <pattern>      # Find grouped by directory (70%)
```

### Analysis & Debug (70-90% savings)

```bash
rtk err <cmd>           # Filter errors only from any command
rtk log <file>          # Deduplicated logs with counts
rtk json <file>         # JSON structure without values
rtk deps                # Dependency overview
rtk env                 # Environment variables compact
rtk summary <cmd>       # Smart summary of command output
rtk diff                # Ultra-compact diffs
```

### Infrastructure (85% savings)

```bash
rtk docker ps           # Compact container list
rtk docker images       # Compact image list
rtk docker logs <c>     # Deduplicated logs
rtk kubectl get         # Compact resource list
rtk kubectl logs        # Deduplicated pod logs
```

### Network (65-70% savings)

```bash
rtk curl <url>          # Compact HTTP responses (70%)
rtk wget <url>          # Compact download output (65%)
```

### Meta Commands

```bash
rtk gain                # View token savings statistics
rtk gain --history      # View command history with savings
rtk discover            # Analyze Codex sessions for missed RTK usage
rtk proxy <cmd>         # Run command without filtering (for debugging)
rtk init                # Add RTK instructions to AGENTS.md
rtk init --global       # Add RTK to ~/.Codex/AGENTS.md
```

## Token Savings Overview

| Category         | Commands                       | Typical Savings |
| ---------------- | ------------------------------ | --------------- |
| Tests            | vitest, playwright, cargo test | 90-99%          |
| Build            | next, tsc, lint, prettier      | 70-87%          |
| Git              | status, log, diff, add, commit | 59-80%          |
| GitHub           | gh pr, gh run, gh issue        | 26-87%          |
| Package Managers | pnpm, npm, npx                 | 70-90%          |
| Files            | ls, read, grep, find           | 60-75%          |
| Infrastructure   | docker, kubectl                | 85%             |
| Network          | curl, wget                     | 65-70%          |

Overall average: **60-90% token reduction** on common development operations.

<!-- /rtk-instructions -->

---

# Panduan Agen AI ZatiarasPOS

Bagian ini WAJIB dibaca sebelum mengubah kode. Tujuannya: fitur baru tidak
merusak kontrak uang/data/cabang, arsitektur tetap modular monolith, dan
setiap perubahan meninggalkan bukti verifikasi.

Dokumen pendamping: `DEVELOPER-GUIDE.md` (domain), `docs/adr/` (keputusan),
`docs/OPERATOR-RUNBOOK.md` (rilis), `ENGINEERING-IMPROVEMENT-PLAN.md` (status).

## 1. Perintah proyek (selalu pakai prefix `rtk`)

```powershell
rtk pnpm check            # typecheck, 0 error 0 warning
rtk pnpm lint             # prettier + eslint
rtk pnpm test:unit        # 29 suite, semua harus lulus
rtk pnpm test:operations  # backup + safety + isolasi + release-gate
rtk pnpm build            # build produksi
rtk pnpm deploy:check     # validasi config Cloudflare
rtk pnpm test:e2e:all     # 22 tes browser terisolasi
rtk git diff --check      # tanpa whitespace error
```

Gate minimum per jenis perubahan:

| Perubahan        | Gate tambahan                                                     |
| ---------------- | ----------------------------------------------------------------- |
| Dokumentasi      | Prettier + `git diff --check`                                     |
| Workflow CI      | Sintaks YAML + CI remote hijau                                    |
| Script Node      | Tes lintas OS + failure injection + cleanup                       |
| UI/store/service | Unit/state test + E2E alur terkait                                |
| API/auth/branch  | Integration handler + tes negatif role/branch/CSRF                |
| SQL/repository   | SQLite fresh + D1/workerd (`--d1`) + concurrency                  |
| Uang/stok        | POS integrity + idempotency + concurrency + full E2E              |
| Archive/restore  | R2 failure/readback + handler/CLI + D1 + parity                   |
| AI               | Timeout/fallback/malformed/branch contract (tanpa model berbayar) |
| Release/deploy   | `test:release` + verifikasi artifact + CI remote + dry-run        |

## 2. Arah dependensi (wajib)

```text
UI -> store/service -> route HTTP (auth + parse + respons)
  -> application use case -> domain/policy
  -> branch-scoped repository -> D1 / R2 / Durable Object / AI eksternal
```

- Domain TIDAK boleh import route, store Svelte, atau global browser.
- Route TIDAK boleh berisi SQL bisnis baru atau logika uang.
- Adapter Cloudflare hanya di boundary infrastructure.
- Satu sumber kanonik per kebijakan; dilarang dua implementasi aktif.

## 3. Peta modul (mulai dari sini, bukan grep buta)

| Area      | File                                                               | Isi                                                                   |
| --------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| POS       | `src/lib/server/checkout/`                                         | loader, financials, fingerprint, statement builder, `checkoutUseCase` |
| Arsip     | `src/lib/server/archiveService.ts` + `archiveUseCase.ts`           | klaim/lease/guard + orkestrasi                                        |
| AI        | `src/lib/server/ai/`                                               | gateway, use case, prompts, reportData                                |
| Pajak     | `src/lib/tax/engine.ts`, `src/lib/services/taxService.ts`          | PP 55/2022, YTD 500jt                                                 |
| Laporan   | `src/lib/server/reportQueries.ts`                                  | agregasi + paritas arsip                                              |
| Tenant    | `src/lib/server/branchResolver.ts`, `apiAuth.ts`                   | `BranchContext`, session scope                                        |
| Kesehatan | `src/lib/server/dataHealth.ts`                                     | detector orphan/stok negatif                                          |
| Offline   | `src/lib/services/offlineSync.ts`, `src/lib/utils/offlineQueue.ts` | replay idempoten                                                      |
| Uang      | `src/lib/utils/currency.ts`, `checkout/utils.ts`                   | `normalizeMoney`, `roundMoney`                                        |

## 4. Kontrak yang TIDAK BOLEH dilanggar

1. **Uang**: semua nominal tulis lewat `normalizeMoney`/`roundMoney`. Jangan
   aritmetika float mentah. Jangan migrasi tipe kolom tanpa ADR + backup.
2. **Idempotency**: `(cabang_id, idempotency_key)` unik. Retry = satu mutasi.
   Fingerprint beda + key sama = 409 tanpa mutasi.
3. **Cabang**: use case kritis menerima `BranchContext` (dari
   `requireSessionBranch`), bukan string mentah. Tiap query tenant wajib
   predicate `cabang_id` (`test:tenant-scope` menjaganya).
4. **Arsip**: klaim atomik dulu, snapshot R2 + readback dulu, hapus exact ID
   dalam batch. Konflik = seluruh batch gagal, ledger utuh.
5. **Restore**: preflight seluruh field bisnis + guard atomik apply.
6. **Offline replay**: kontrak queue IndexedDB backward-compatible. Ubah
   kontrak = tes kompatibilitas dulu.
7. **Receipt**: snapshot permanen saat commit; cetak ulang tidak boleh berubah
   saat katalog diedit.
8. **Error code**: `code: 'X'` adalah kontrak stabil (registry di
   `error-code-contract-tests.ts`). Tambah/hapus = review kompatibilitas.
9. **AI eksternal**: semua panggilan lewat `aiGateway` (timeout + fallback +
   typed error). Key tidak pernah masuk pesan error/log.
10. **Observability/realtime gagal** = commit tetap sah; jangan jadikan outage source.

## 5. Aturan kode

- TypeScript ketat: tanpa `any` baru (cap dijaga `test:maintainability`).
- Tanpa `catch {}` baru tanpa alasan best-effort eksplisit.
- Tanpa import DB langsung dari route baru (allowlist dijaga test).
- Tanpa secret/kredensial/dump data di kode, log, argv, fixture, atau repo.
- Tanpa migrasi destruktif tanpa preflight + backup + panduan rollback.
- Pesan error Indonesia untuk user; log teknis boleh Inggris.
- Komentar menjelaskan KENAPA, bukan mengulang kode. Hapus komentar basi
  yang disentuh perubahanmu.

## 6. Aturan test

- Bug dulu direproduksi dengan tes yang gagal beralasan, baru diperbaiki.
- Tes baru deterministik: tanpa model berbayar, tanpa production, tanpa
  tanggal mengambang (bekukan `now`), tanpa hash atas output locale-dependent.
- Baris DB dari SQLite adalah null-prototype: normalisasi sebelum `deepEqual`.
- Dilarang menurunkan assertion, menambah skip, atau retry buta agar hijau.
- File baru: `src/tests/<domain>-tests.ts` + script `test:<domain>` di
  `package.json` + rantai `test:unit` + step CI.

## 7. Aturan commit/PR/rilis (tanpa pengecualian)

- Satu commit = satu tujuan + satu fase. Dapat di-revert mandiri.
- Format pesan: `fix|feat|refactor|test|docs|chore(scope): hasil`.
- Jangan campur format massal dengan perubahan perilaku.
- Jangan push secret, `.env`, state database, backup, atau artifact runtime
  (`build-artifacts.json`, `code-quality-report.md` sudah gitignored).
- Rilis hanya via preflight + artifact terverifikasi + CI hijau + runbook.
  Dilarang deploy dari output workstation tanpa provenance.

## 8. Definition of Done per task

- [ ] Kontrak perilaku dicatat sebelum diubah; reproduksi gagal beralasan.
- [ ] Implementasi minimal tanpa workaround tersembunyi.
- [ ] Tes positif + negatif + failure path (+ concurrency/idempotency/cabang
      bila menyentuh data kritis).
- [ ] Gate §1 yang relevan hijau lokal DENGAN exit code tercatat.
- [ ] `git diff --check` bersih; diff direview untuk secret/scope creep.
- [ ] Dokumentasi/runbook diperbarui bila perilaku/contract berubah.
- [ ] Commit atomik; CI remote pada SHA yang sama hijau.
- [ ] Batas bukti ditulis jujur (lokal vs workerd vs CI vs smoke operator).
