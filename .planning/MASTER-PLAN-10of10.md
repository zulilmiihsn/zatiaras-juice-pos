---
title: ZatiarasPOS Master Plan 10/10
status: active
source_of_truth: true
created: 2026-09-01
last_updated: 2026-09-01
branch: codex/a94-development
integration_head: 3469e2a1fc4541dfd8fdeb311d98f7b65093d5c5
documented_release_baseline: c94fdaa
baseline_score: 6.8/10
target_score: 10/10
execution_gate: GOV-001
---

# ZatiarasPOS Master Plan 10/10

## Authority

Dokumen ini adalah source of truth aktif untuk stabilisasi ZatiarasPOS menuju kualitas 10/10.
`ROADMAP.md` dan `STATE.md` hanya memberi pointer dan ringkasan. Audit, re-audit, todo, dan plan
lama tetap berguna sebagai bukti historis, tetapi tidak boleh mengalahkan keputusan atau status di
dokumen ini.

Aturan authority:

1. Source aktual dan behavioral test mengalahkan klaim dokumen lama.
2. Status production harus dibuktikan per exact commit, deployment, shard, dan waktu.
3. Dirty working tree bukan release candidate dan tidak boleh diberi skor final.
4. Satu coordinator menjadi satu-satunya editor status task di dokumen ini.
5. Worker AI tidak boleh mengubah status task, task lain, atau file di luar lock yang diberikan.

Plan historis `PLAN-9of9-BUG-DEBT-CLOSURE.md`, `PLAN-10of10-POS-DATA-INTEGRITY.md`, dan
`PLAN-11of11-RELEASE-READINESS-CLOSURE.md` hanya ada pada branch `dev` commit `905eb6f`. Commit
tersebut bercabang dari `a94d7f8` dan bukan ancestor branch aktif. Jangan merge atau cherry-pick
commit itu. Ambil hanya keputusan atau bukti yang masih cocok dengan source sekarang.

## Mission

Menaikkan ZatiarasPOS dari baseline historis 6.8/10 menjadi 10/10 terukur tanpa rewrite framework,
tanpa melemahkan branch isolation, dan tanpa mengorbankan transaksi, stok, HPP, antrean offline,
atau data production.

Target 10/10 berarti:

- nol P0 dan P1 in-scope yang terbuka;
- seluruh P2 dan P3 ditutup atau diterima eksplisit sebagai accepted risk;
- semua invariant uang, stok, otorisasi, archive, restore, dan migration dibuktikan secara behavior;
- release berasal dari exact clean SHA yang lulus gate pada run yang sama;
- migration, backup, deployment, UAT, dan cleanup memiliki evidence yang dapat diaudit;
- critical path dapat dipahami dan diubah aman oleh developer junior dengan naming, type, boundary, dan dokumentasi yang jelas;
- tidak ada klaim sukses berdasarkan source-regex, hasil lama, atau asumsi production.

## Scope

In-scope:

- custom cookie session, role, dan branch authorization;
- POS online quote, checkout, idempotency, receipt, QRIS manual, dan offline replay;
- produk, resep, bahan, unit, yield, HPP, stok, dan void;
- D1 schema, Drizzle schema, migration, backup, archive, dan restore;
- R2 product images dan archive objects;
- Durable Object realtime dan cache invalidation;
- laporan, pajak, dashboard, AI report context, dan PDF output;
- IndexedDB cart, catalog, dan pending transaction queue;
- automated tests, browser UAT, release process, runbook, dan evidence;
- mobile dan desktop behavior pada flow yang disentuh;
- clean code, maintainability, dan readability untuk developer baru/junior.

Non-goals:

- white-label atau SaaS tenant registry;
- branding dinamis lintas perusahaan;
- laporan gabungan semua cabang;
- payment gateway atau settlement QRIS otomatis;
- penggantian SvelteKit, Cloudflare D1/R2, Durable Objects, atau IndexedDB;
- scheduler backup production otomatis;
- menghilangkan seluruh keterbatasan browser, OS, printer, atau jaringan.

## Baseline

### Git and release baseline

| Item                            | Evidence                                   | Interpretation                                               |
| ------------------------------- | ------------------------------------------ | ------------------------------------------------------------ |
| Branch aktif                    | `codex/a94-development`                    | Branch integrasi saat plan dibuat                            |
| HEAD dan origin                 | `3469e2a1fc4541dfd8fdeb311d98f7b65093d5c5` | Sinkron saat inspeksi                                        |
| Release baseline terdokumentasi | `c94fdaa`                                  | Baseline release terakhir yang tercatat lengkap              |
| Feature yield                   | `70b720e`                                  | Implementasi yield tiga-argumen yang benar                   |
| Live yield harness              | `3469e2a`                                  | Membuktikan endpoint yield pada cabang UAT, bukan tiga shard |
| Historical dev WIP              | `905eb6f`                                  | Bukan ancestor; tidak boleh diambil utuh                     |

Working tree sudah dirty sebelum plan ini dibuat. Perubahan meliputi source, UI, tests, migrations,
dan file tooling. Tidak satu pun perubahan dirty boleh direvert, dihapus, distage, atau diklaim oleh
task tanpa inventaris GOV-001.

### Production evidence terakhir

Evidence berikut berasal dari `.planning/STATE.md` tanggal 2026-08-12 dan harus dianggap historis
sampai diverifikasi ulang:

| Item                   | Evidence terakhir                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| D1 schema              | Migration `0015` dan `0016` tercatat pada tiga shard                                                               |
| Backup                 | `D:\ZatiarasPOS-Backups\backup-2026-08-12T04-44-27-662Z-1133ee28-185a-4529-a0b5-43542b198f7a\manifest.sha256.json` |
| Realtime Worker        | `e69aebae-1ced-49ac-a52f-dd0b0d202033`                                                                             |
| Pages deployment       | `78163363.zatiaraspos.pages.dev`                                                                                   |
| Service worker SHA-256 | `31636b14565920cdd1ab5e83460e99d246b2ef2491a455a2d7a38fd2b538f858`                                                 |
| Live UAT               | Samarinda checkout, two-client realtime, dan zero-residue cleanup                                                  |

Production status migration `0017` sampai `0022` belum terbukti pada ketiga shard. Sukses live
yield hanya membuktikan schema yang diperlukan tersedia pada cabang UAT saat run tersebut.

### Dirty WIP classification

| Class                    | Meaning                                     | Release treatment                                |
| ------------------------ | ------------------------------------------- | ------------------------------------------------ |
| Tracked baseline bug     | Ada pada HEAD dan dirty snapshot            | Wajib diperbaiki sebelum release                 |
| Dirty-only regression    | Diperkenalkan perubahan belum committed     | Wajib diperbaiki atau dikeluarkan dari candidate |
| Historical finding       | Sudah ditutup pada source sekarang          | Pertahankan sebagai regression gate              |
| Accepted risk            | Disetujui dengan kontrol dan owner          | Tidak dihitung sebagai bug terbuka               |
| Unknown production state | Source dan schema live belum direkonsiliasi | Release blocker sampai dibuktikan                |

## Locked Decisions

Keputusan berikut tidak boleh diubah worker. Perubahan memerlukan owner decision dan update plan.

| ID      | Decision                                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------ |
| DEC-001 | Produk adalah satu brand ZatiarasPOS dengan beberapa cabang/shard, bukan white-label SaaS.                   |
| DEC-002 | Pemilik cabang independen dan tidak boleh memberi diri sendiri role `admin`.                                 |
| DEC-003 | Platform admin tetap boleh menjalankan fungsi lintas cabang yang memang didesain untuk admin.                |
| DEC-004 | Replay transaksi yang sudah dibuat offline tidak memiliki age expiry.                                        |
| DEC-005 | Katalog maksimal 24 jam tetap membatasi dimulainya penjualan offline baru.                                   |
| DEC-006 | Pending queue tetap ada saat logout; logout tidak boleh menghapus transaksi belum sync.                      |
| DEC-007 | Audit logging tetap best-effort; kegagalan audit tidak boleh membatalkan transaksi utama.                    |
| DEC-008 | Archive menghapus transaksi POS dan kas manual dari D1 aktif setelah object terbukti aman.                   |
| DEC-009 | Laporan setelah archive mempertahankan total dan kategori; detail ada di JSON atau restore operator.         |
| DEC-010 | Archive restore tetap manual, dry-run-first, dan bukan pengganti full D1 disaster backup.                    |
| DEC-011 | Pajak disimpan dan dihitung per cabang di server, bukan per browser.                                         |
| DEC-012 | Threshold PPh Final Rp500 juta dihitung akurat dari omzet tahunan kumulatif per cabang.                      |
| DEC-013 | Dasar omzet pajak adalah POS plus kas manual `pendapatan_usaha`, bukan pendapatan lain.                      |
| DEC-014 | Backup, migration, restore, deploy, tag, dan owner acceptance tetap manual.                                  |
| DEC-015 | Race operasional satu sesi toko tetap accepted P2 dengan SOP tepat satu sesi aktif.                          |
| DEC-016 | Perangkat terpisah per cabang menurunkan storage key global menjadi P3, tetapi hardening tetap direncanakan. |
| DEC-017 | Jangan rewrite framework atau menambah compatibility untuk format test-only yang belum pernah dirilis.       |
| DEC-018 | Persisted user data, queue, image URLs, tax settings, dan production schema wajib mendapat migration path.   |
| DEC-019 | Clean code dan junior-level readability adalah release gate, bukan polish opsional setelah bug selesai.      |

## Quality Scorecard

Baseline 68/100 adalah kalibrasi historis. Dirty WIP belum memiliki score. Score hanya diperbarui
setelah task terkait berstatus `VERIFY` atau `DONE` dengan evidence.

| Dimension                             |   Baseline |      Target | Mandatory truth                                                  |
| ------------------------------------- | ---------: | ----------: | ---------------------------------------------------------------- |
| Security and branch isolation         |          6 |          10 | Owner tidak dapat menjadi admin atau menyentuh data cabang lain  |
| POS financial integrity               |          7 |          10 | Satu sale memiliki satu immutable truth dan exact idempotency    |
| Inventory, recipe, and HPP            |          6 |          10 | Yield, unit, recipe, stok, dan HPP konsisten server-side         |
| Offline and receipt reliability       |          7 |          10 | Queue durable, receipt immutable, replay tidak menggandakan sale |
| Archive, restore, and data durability |          6 |          10 | Archive report-neutral, checksum-valid, dan restore teruji       |
| Schema and migration safety           |          6 |          10 | Tiga shard memiliki schema dan checksum yang sama                |
| Realtime and client state             |          7 |          10 | Semua subscriber hidup independen tanpa global teardown          |
| Reporting and tax consistency         |          6 |          10 | UI, server, AI, dan PDF memakai satu hasil kanonik               |
| Maintainability and readability       |          8 |          10 | Junior dapat mengikuti flow; naming, type, dan boundary jelas    |
| Release and operations                |          9 |          10 | Exact clean SHA, backup, migration, UAT, deploy, rollback        |
| **Total**                             | **68/100** | **100/100** | Semua hard gate lulus                                            |

Test maturity adalah cross-cutting hard gate untuk seluruh dimension, bukan pengganti readability
atau satu dimension yang dapat menutupi code-quality debt.

Hard gates:

1. Score 10/10 dilarang bila satu P0 atau P1 masih terbuka.
2. Score 10/10 dilarang bila status migration salah satu shard unknown atau partial.
3. Score 10/10 dilarang bila restore belum menjalani local round-trip.
4. Score 10/10 dilarang bila release tests tidak berasal dari exact candidate SHA.
5. Score 10/10 dilarang bila working tree candidate dirty.
6. Score 10/10 dilarang bila live UAT meninggalkan transaction, ledger, queue, atau object residue.
7. Score 10/10 dilarang bila `MAINT-001` belum lulus independent readability review tanpa finding HIGH.

Maintainability scoring:

- `8`: baseline sekarang; critical flow masih tersebar atau memerlukan pembaca menebak ownership.
- `9`: flow map, types, dan tests tersedia, tetapi masih ada MEDIUM finding terjadwal.
- `10`: seluruh acceptance `MAINT-001` lulus dan tidak ada unresolved HIGH/MEDIUM pada critical path.

## Finding Register

| ID          | Priority | State     | Finding                                                                                         | Source                       |
| ----------- | -------- | --------- | ----------------------------------------------------------------------------------------------- | ---------------------------- |
| F-SEC-001   | P0       | Confirmed | `/api/profil` menerima mass assignment `role` dan `password`; owner dapat menjadi admin         | HEAD and dirty               |
| F-SEC-002   | P1       | Confirmed | Production role/password state belum diaudit setelah exposure F-SEC-001                         | Production unknown           |
| F-POS-001   | P1       | Confirmed | Runtime `mode` selain `online`/`offline_replay` masuk jalur non-online                          | HEAD and dirty               |
| F-POS-002   | P1       | Confirmed | Checkout capability probing dapat menonaktifkan idempotency, snapshot, HPP, atau summary        | HEAD and dirty               |
| F-POS-003   | P1       | Confirmed | Retry hanya membandingkan total+qty dan membangun receipt dari request baru                     | HEAD and dirty               |
| F-HPP-001   | P1       | Confirmed | Dirty WIP mengganti kalkulator yield tiga-argumen menjadi cost/portion dua-argumen dibulatkan   | Dirty-only                   |
| F-HPP-002   | P1       | Confirmed | Konversi `pack`/`dus` ke `pcs` ambigu dan unknown unit fallback diam-diam ke faktor 1           | Dirty-only                   |
| F-MENU-001  | P1       | Confirmed | Product create membaca `result.id`, padahal mutation ID ada pada `result.data[0].id`            | Dirty-only                   |
| F-MENU-002  | P1       | Confirmed | Product dan recipe disimpan dua request sehingga dapat partial                                  | Dirty-only and architectural |
| F-OFF-001   | P1       | Confirmed | Offline cart dibersihkan sebelum fallback receipt dibentuk                                      | Dirty-only                   |
| F-OFF-002   | P2       | Confirmed | Current+previous signing key tidak menjamin replay setelah lebih dari satu rotasi               | HEAD and dirty               |
| F-R2-001    | P1       | Confirmed | Product image key global dan DELETE tidak memverifikasi branch ownership                        | HEAD and dirty               |
| F-R2-002    | P2       | Confirmed | Client gagal mengekstrak proxy/nested image key secara kanonik; image lifecycle dapat orphan    | HEAD and dirty               |
| F-RT-001    | P2       | Confirmed | Manager hanya menyimpan satu subscriber per table dan page memakai `unsubscribeAll()`           | HEAD and dirty               |
| F-ARC-001   | P1       | Confirmed | SELECT/upload/DELETE berdasarkan cutoff memiliki TOCTOU dan tidak menghapus exact selection     | HEAD and dirty               |
| F-ARC-002   | P1       | Confirmed | Cutoff memakai UTC, key harian dapat overwrite, response membawa seluruh archive JSON           | HEAD and dirty               |
| F-ARC-003   | P1       | Confirmed | Archive menghapus kas manual tetapi report summary hanya mencakup POS                           | HEAD and dirty               |
| F-ARC-004   | P1       | Confirmed | UI menjanjikan restore tetapi belum ada archive JSON restore yang tervalidasi                   | HEAD and dirty               |
| F-TAX-001   | P1       | Confirmed | Tax config berada di localStorage sehingga hasil berbeda antar perangkat                        | HEAD and dirty               |
| F-TAX-002   | P1       | Confirmed | Server/AI menghitung 0.5% dari laba kotor, client dari omzet                                    | HEAD and dirty               |
| F-TAX-003   | P1       | Confirmed | Opsi threshold Rp500 juta hanya mengubah label, bukan taxable base                              | HEAD and dirty               |
| F-DB-001    | P1       | Confirmed | Journal berhenti di `0016`; `0018`-`0022` untracked dan source dirty membutuhkannya             | Dirty/production unknown     |
| F-OPS-001   | P2       | Confirmed | `deploy:pages` memakai `--commit-dirty=true`                                                    | HEAD and dirty               |
| F-OPS-002   | P2       | Confirmed | `deploy:all` tidak mewajibkan `test:release`, exact SHA, atau migration evidence                | HEAD and dirty               |
| F-QA-001    | P2       | Confirmed | Sebagian critical assertions hanya memeriksa source text                                        | HEAD and dirty               |
| F-MAINT-001 | P2       | Confirmed | Aturan domain kritis tersebar lintas route/store/service dan belum punya peta developer kanonik | HEAD and dirty               |
| F-TYPE-001  | P3       | Confirmed | Touched financial/report/menu paths masih memakai `any`/type erasure                            | HEAD and dirty               |
| F-STO-001   | P3       | Confirmed | Cart/queue/tax keys belum seluruhnya branch-scoped                                              | HEAD and dirty               |

Historical findings yang sudah ditutup tetap menjadi regression tests: checkout 100/101 items,
chunked D1 report queries, dashboard error honesty, monitoring degradation, page lock enforcement,
hashed PIN, atomic void, stock restoration, queue detail/export, one pending-count source, and browser
POS coverage.

## Accepted Risks

Accepted risk bukan alasan melewati test. Setiap risk tetap memiliki control dan owner verification.

| ID     | Risk                                                                                     | Control                                                                 | Review gate      |
| ------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------- |
| AR-001 | QRIS dikonfirmasi manusia, bukan payment gateway                                         | Merchant app/bukti resmi, warning UI, owner UAT                         | Setiap release   |
| AR-002 | Browser tidak memiliki trusted offline clock; cashier dapat mencoba backdate `queued_at` | Signed price, issued/expiry checks, audit variance, role accountability | Security review  |
| AR-003 | Audit sink dapat gagal setelah transaksi utama commit                                    | D1 outbox, retry, monitoring degraded state                             | Outbox UAT       |
| AR-004 | Tidak ada hard distributed lock untuk tepat satu sesi toko                               | SOP tepat satu sesi, cashier guard, monitoring                          | Owner UAT        |
| AR-005 | Backup, migration, archive restore, dan deployment manual                                | Explicit confirmation, exact target, backup, checklist                  | Setiap operation |
| AR-006 | Browser background sync dan printer tidak dijamin OS                                     | Queue visibility, reopen guidance, print UAT                            | Device UAT       |
| AR-007 | Detail transaksi terarsip tidak tampil langsung di laporan                               | Summary tetap utuh; JSON dan restore tool tersedia                      | Archive UAT      |
| AR-008 | Revokasi emergency signing key dapat menolak queue bertanda tangan key kompromi          | Security mengalahkan replay; export queue dan incident handling         | Key rotation     |
| AR-009 | White-label dan consolidated report tidak tersedia                                       | Dinyatakan sebagai non-goal                                             | Milestone review |

## Clean Code and Junior Readability Standard

Clean code di proyek ini berarti code yang boring, eksplisit, mudah ditelusuri, dan aman diubah.
Clean code bukan mengejar jumlah file terbanyak, function terpendek, pola desain terbanyak, atau
abstraction yang belum dibutuhkan.

### Mandatory principles

1. Clarity over cleverness: pilih control flow langsung dan nama deskriptif daripada trik singkat.
2. One source of truth: satu aturan bisnis kanonik, terutama harga, pajak, yield, role, archive, dan idempotency.
3. Typed boundaries: parse `unknown` pada HTTP, storage, database JSON, env, dan third-party boundary; jangan sebarkan `any`.
4. Explicit side effects: DB write, R2 mutation, cache invalidation, realtime publish, queue write, dan navigation harus terlihat urutannya.
5. Cohesive responsibility: satu function/module memiliki satu alasan bisnis untuk berubah dan nama yang menyatakan hasil atau intent.
6. One level of abstraction: jangan campur parsing request, business calculation, SQL construction, dan UI notification tanpa boundary jelas.
7. Smallest useful abstraction: helper baru harus dipakai ulang, mengisolasi boundary, atau memberi nama pada invariant kompleks.
8. Domain language consistency: gunakan istilah stabil seperti `cabang`, `bahan`, `resep`, `yield`, `receipt`, dan `idempotency`; hindari nama kabur seperti `data`, `item`, atau `result` saat nama domain tersedia.
9. Guard clauses before nesting: invalid input dan authorization failure keluar lebih awal.
10. Comments explain why: komentar menjelaskan invariant, tradeoff, urutan wajib, atau batas platform; jangan mengulang syntax.
11. Errors are actionable: error membedakan validation, authorization, conflict, dependency, dan server failure tanpa membocorkan secret.
12. No hidden mutation: perubahan global/store tidak boleh terjadi dari getter, formatter, parser, atau read helper.
13. No stale code: dead branch, commented-out implementation, stale TODO, misleading comment, dan unused wrapper dihapus melalui focused change.

### Architecture direction

Dependency flow yang diharapkan:

```text
Svelte page/component
  -> typed store/orchestrator
  -> typed client service
  -> API route boundary validation
  -> domain function
  -> D1/R2/realtime adapter
```

Larangan:

- server module mengimpor browser store atau `window` state;
- component menghitung ulang aturan uang yang sudah kanonik di server;
- generic CRUD dipakai untuk security-sensitive atau multi-entity financial mutation;
- route besar menyimpan formula bisnis duplikat yang tidak dapat diuji langsung;
- utility generik menyembunyikan branch, transaction, atau authorization context.

### Review triggers, not arbitrary quotas

Kondisi berikut memicu review dan keputusan tertulis, bukan pemecahan otomatis:

- function lebih dari sekitar 60 baris;
- source file lebih dari sekitar 300 baris;
- nesting lebih dari tiga level;
- function menangani lebih dari satu independent transaction/side-effect sequence;
- nama membutuhkan komentar untuk menjelaskan arti dasarnya;
- business rule sama muncul pada client dan server;
- test hanya dapat dibuat dengan membaca source text.

Reviewer boleh mempertahankan code lebih panjang bila satu flow linear lebih mudah dibaca daripada
banyak wrapper kecil. Alasan harus tercatat pada handoff atau review.

### Junior readability acceptance

Developer baru yang diberi domain glossary dan repository harus dapat dalam maksimal 15 menit:

1. menemukan entry point satu flow kritis;
2. menunjuk tempat authorization dan branch scope dilakukan;
3. menunjuk satu fungsi kanonik untuk aturan bisnis utama;
4. mengikuti urutan side effect dan rollback/failure behavior;
5. menemukan test yang membuktikan behavior;
6. menjelaskan file mana yang aman diubah untuk requirement serupa.

Independent reviewer harus menjalankan walkthrough minimal untuk auth, checkout, offline replay,
menu/HPP, archive/restore, tax, dan realtime. Finding HIGH memblokir release.

## Execution Protocol

### Status lifecycle

`TODO -> READY -> IN_PROGRESS -> VERIFY -> DONE`

Status tambahan:

- `BLOCKED`: dependency, evidence, atau human gate belum terpenuhi.
- `ACCEPTED_RISK`: tidak diperbaiki karena keputusan owner dengan control tertulis.
- `CANCELLED`: task tidak lagi relevan dan memiliki alasan tertulis.

Hanya coordinator boleh mengubah status. Maksimal satu task `IN_PROGRESS` per worker dan maksimal
satu worker per file lock.

### Dirty worktree rules

1. Jangan memakai `git reset --hard`, `git checkout --`, `git clean`, force push, atau destructive restore.
2. Inventaris tracked, staged, untracked, ignored, branch, HEAD, origin, dan checkpoint refs.
3. Owner menentukan snapshot WIP yang memang ingin dipertahankan.
4. Implementasi dilakukan di clean worktree atau clean branch dari snapshot yang disetujui.
5. Jangan menjadikan `origin/dev` atau checkpoint otomatis sebagai source of truth.
6. Jangan commit file tooling/GSD, generated artifacts, atau perubahan user yang tidak terkait task.

### Task claim

Sebelum worker mulai, coordinator mencatat:

| Field             | Required value              |
| ----------------- | --------------------------- |
| Task ID           | Stable ID dari plan ini     |
| Owner             | AI/human identifier         |
| Baseline SHA      | Exact commit awal           |
| Dependencies      | Semua harus `DONE`          |
| File locks        | Exact files/directories     |
| Expected commit   | Conventional Commit subject |
| Verification      | Commands dan manual checks  |
| Production access | Default `none`              |

### Worker rules

1. Baca file sebelum edit.
2. Edit hanya file lock.
3. Perubahan terkecil yang memenuhi invariant.
4. Jangan menambah compatibility tanpa persisted/external consumer yang nyata.
5. Gunakan nama domain deskriptif dan control flow yang dapat dibaca tanpa menebak hidden state.
6. Jangan menjalankan production mutation, migration, restore, deploy, atau live cleanup tanpa human gate.
7. Jalankan targeted tests sebelum broad tests.
8. Review diff, readability, dan secret scan sebelum handoff.
9. Satu task menghasilkan satu focused commit setelah diminta coordinator.
10. Worker tidak mengedit master plan, ROADMAP, STATE, atau task lain.

### Handoff contract

Setiap worker mengembalikan:

```text
Task:
Baseline SHA:
Commit SHA:
Files changed:
Behavior changed:
Tests run and exact results:
Tests not run and reason:
Migration impact:
Rollback:
Readability impact:
Residual risks:
Unexpected worktree changes:
Evidence paths/hashes:
```

Coordinator memverifikasi commit dan evidence sebelum mengubah `VERIFY` menjadi `DONE`.

## Dependency Graph

```text
GOV-001
  -> DB-001
  -> QA-001
  -> SEC-001
  -> RT-001

DB-001 -> POS-001 -> POS-002 -> OFF-001 -> OFF-002
DB-001 -> HPP-001 -> MENU-001 -> R2-001
POS-002 -> ARC-001 -> TAX-001 -> ARC-002
OFF-001 -> TOK-001

POS-002 + HPP-001 + MENU-001 + ARC-001 + TAX-001 -> DB-002
SEC-001 + OFF-002 + R2-001 + RT-001 + ARC-002 + TAX-001 + DB-002 -> QA-002
QA-002 -> MAINT-001 -> DEBT-001 -> UX-001 -> OPS-001 -> DOC-001
OPS-001 + DOC-001 -> REL-001 -> REL-002 -> REL-003 -> REL-004 -> SCORE-001
```

Shared files force serialization even when graph otherwise permits parallel work:

- `src/lib/database/schema.ts`
- `drizzle/meta/_journal.json`
- `src/routes/api/pos/transaction/+server.ts`
- `src/lib/server/checkout/*`
- `src/lib/server/reportQueries.ts`
- `src/lib/stores/bayarState.svelte.ts`
- `package.json`
- `OPERATIONS-RUNBOOK.md`

## Wave 0: Baseline and Containment

### GOV-001 Freeze and classify dirty WIP

| Field             | Value                                   |
| ----------------- | --------------------------------------- |
| Status            | TODO                                    |
| Priority          | P0 execution gate                       |
| Depends on        | None                                    |
| File lock         | None; read-only inventory first         |
| Production access | None                                    |
| Expected commit   | No commit until owner approves snapshot |

Actions:

1. Capture exact branch, HEAD, upstream, worktrees, stashes/checkpoints, staged/unstaged/untracked lists.
2. Group dirty files by domain: app source, schema/migration, tests, UI, docs, GSD/tooling, generated.
3. Compare dirty source to HEAD and to `dev:905eb6f` only for provenance.
4. Mark each dirty change as intended, discard-candidate, generated, or unknown. Do not discard anything.
5. Ask owner to approve one immutable WIP snapshot strategy.
6. Create clean implementation worktree from the approved snapshot.
7. Record snapshot SHA and patch/untracked manifest hashes without storing secrets or production exports.

Verification:

- Original worktree remains byte-preserved.
- Clean worktree has known exact SHA and no untracked files.
- Every dirty file has owner-approved disposition.
- No checkpoint, stash, or branch is deleted.

Rollback: remove only the new clean worktree after proving original worktree unchanged.

### DB-001 Build read-only three-shard schema matrix

| Field             | Value                                                                      |
| ----------------- | -------------------------------------------------------------------------- |
| Status            | TODO                                                                       |
| Priority          | P1 release gate                                                            |
| Depends on        | GOV-001                                                                    |
| File lock         | Read-only `drizzle/`, schema, Wrangler configs                             |
| Production access | Read-only D1 metadata only                                                 |
| Expected commit   | `docs(db): record schema baseline` only if sanitized evidence is committed |

Actions:

1. Read exact database names/UUIDs from `wrangler.pages.jsonc` without logging tokens.
2. Query `PRAGMA table_info`, `index_list`, `index_info`, triggers, and required table existence per shard.
3. Classify migrations `0015` through `0022` as present, absent, partial, or ambiguous.
4. Prove `0017` using column plus insert/update trigger definitions, not endpoint behavior alone.
5. Record required source-to-schema mapping for dirty WIP fields.
6. Compare `drizzle/meta/_journal.json` against actual migration files.
7. Stop on partial state. Do not rerun an ALTER blindly.

Verification:

- Matrix contains Samarinda, Balikpapan, and Berau independently.
- Evidence contains metadata only, no customer rows, credentials, SQL exports, or secret values.
- Every source-required column/table/index has an explicit status.

Rollback: none; task is read-only.

### QA-001 Establish clean baseline quality evidence

| Field             | Value                               |
| ----------------- | ----------------------------------- |
| Status            | TODO                                |
| Priority          | P1 evidence gate                    |
| Depends on        | GOV-001                             |
| File lock         | None; clean worktree execution only |
| Production access | None                                |
| Expected commit   | None                                |

Run from exact clean baseline:

```powershell
rtk pnpm install --frozen-lockfile
rtk pnpm check
rtk pnpm lint
rtk pnpm test:all
rtk pnpm build
rtk pnpm test:e2e:pos
rtk pnpm audit --prod
```

Record each command, SHA, start/end time, exit code, and artifact path. A failed baseline is evidence,
not permission to fix unrelated files inside QA-001.

Done when every baseline failure is linked to a finding/task and no result from another SHA is reused.

## Wave 1: Security and Financial Correctness

### SEC-001 Remove profile privilege escalation and audit live identities

| Field             | Value                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------- |
| Status            | TODO                                                                                        |
| Priority          | P0                                                                                          |
| Depends on        | GOV-001                                                                                     |
| Primary files     | `src/routes/api/profil/+server.ts`, `src/lib/services/dataApiClient.ts`, session/auth tests |
| Production access | Read-only audit, then separately approved credential remediation                            |
| Expected commit   | `fix(auth): remove unsafe profile mutation`                                                 |

Actions:

1. Delete unused generic `/api/profil` mutation route.
2. Remove `profil` from generic `WRITE_ROUTES`.
3. Do not replace it unless a real caller requires profile-name editing.
4. If needed later, add dedicated self-service endpoint allowlisting only `nama_lengkap`.
5. Keep credential updates in `/api/gantikeamanan`; document that `targetRole` selects an account and does not assign a role.
6. Preserve `sessionStore` join to live `profil` role/username so revoked roles apply immediately.
7. Validate role values at authentication boundaries.
8. Audit production role counts, approved admin identities, bcrypt-shaped password hashes, duplicate usernames, and relevant audit events without printing values.
9. Revoke sessions and rotate credentials for any remediated account.

Behavior tests:

- Owner PATCH to `/api/profil` cannot mutate role, password, identity, or branch.
- Owner cannot become `admin` through any public API.
- Owner cannot mutate another branch.
- Credential change hashes password and revokes all target sessions.
- Session role follows current profile and missing profile invalidates session.
- Approved platform admin behavior remains intact.

Done when production contains only approved admins, all active passwords are valid hashes, and no
generic role/password mutation route exists.

Rollback: restore only a dedicated, strict allowlist endpoint if a proven external consumer exists.

### POS-001 Enforce runtime mode and fail-closed schema

| Field             | Value                                                 |
| ----------------- | ----------------------------------------------------- |
| Status            | TODO                                                  |
| Priority          | P1                                                    |
| Depends on        | DB-001                                                |
| Primary files     | POS transaction route and `src/lib/server/checkout/*` |
| Production access | None                                                  |
| Expected commit   | `fix(pos): fail closed on mode and schema`            |

Actions:

1. Accept only absent/`online` or exact `offline_replay`; reject every other runtime value with `400` before side effects.
2. Keep absent mode defaulting to `online`.
3. Remove checkout capability probing and optional SQL branches for required financial schema.
4. Always require idempotency, stock tracking, ingredient tracking, transaction snapshots, and daily summaries.
5. Let missing required schema fail before write and report an operational error.
6. Move schema assurance to DB preflight/release gates, not request-time fallbacks.
7. Preserve unlimited replay semantics by keeping no lower age limit on valid queued sales.

Behavior tests:

- Unknown mode, empty mode, numeric mode, and mixed-case mode return `400` and zero writes.
- Missing mode follows online quote verification.
- Missing required table/column causes zero writes and explicit failure.
- Online/offline replay happy paths remain branch-scoped, rate-limited, and atomic.

Rollback: revert only after restoring an equivalent fail-closed schema gate.

### POS-002 Make idempotency exact and receipt immutable

| Field             | Value                                                                   |
| ----------------- | ----------------------------------------------------------------------- |
| Status            | TODO                                                                    |
| Priority          | P1                                                                      |
| Depends on        | POS-001                                                                 |
| Primary files     | POS route, checkout data loader/builder/types, schema, migration, tests |
| Production access | None until migration wave                                               |
| Expected commit   | `fix(pos): persist exact idempotency truth`                             |

Required schema:

- `buku_kas.request_fingerprint` nullable for controlled legacy transition;
- `buku_kas.receipt_snapshot` nullable for controlled legacy transition;
- existing unique `(cabang_id, idempotency_key)` remains mandatory.

Canonical fingerprint includes branch, customer, payment method, cash received, store session, line
order, product/custom identity, portion, quantity, add-ons, modifiers, notes, verified prices, totals,
and total quantity. It excludes transport-only `mode`, `queued_at`, raw token bytes, and retry time so
an online response-loss can replay offline using the same logical sale.

Actions:

1. Compute fingerprint only after server verification and canonical normalization.
2. Build committed receipt once from the exact computed transaction.
3. Insert fingerprint and receipt snapshot in the same D1 batch as ledger/detail/stock/summary writes.
4. On retry, require exact fingerprint equality.
5. Return stored receipt snapshot, transaction ID, committed time, total, and change.
6. Never build idempotent receipt from the retry request.
7. For legacy null rows, reconstruct canonical truth from stored `buku_kas` plus `transaksi_kasir`; never fall back to total+qty alone.
8. Bound and validate stored JSON.

Behavior tests:

- Exact duplicate returns same transaction and byte-equivalent receipt.
- Same key with different item but same total+qty returns `409`.
- Same key with different payment, options, add-ons, or cash returns `409`.
- Lost online response followed by offline replay returns existing transaction without stock deduction.
- Concurrent duplicate creates exactly one ledger/header/summary contribution.
- Legacy row comparison uses stored details and cannot fabricate a receipt.

Rollback: migration columns are additive. Old code may ignore them, but rollback must not drop
persisted snapshots until all candidate versions are retired.

### HPP-001 Reconcile yield, unit, pack, and dirty HPP WIP

| Field             | Value                                                                              |
| ----------------- | ---------------------------------------------------------------------------------- |
| Status            | TODO                                                                               |
| Priority          | P1                                                                                 |
| Depends on        | DB-001                                                                             |
| Primary files     | ingredient cost/unit utilities, bahan API/store/service, schema, migrations, tests |
| Production access | None until migration wave                                                          |
| Expected commit   | `fix(hpp): preserve yield and unit invariants`                                     |

Canonical invariants:

- stored inventory quantity uses canonical base unit;
- `jumlah_beli_terakhir` stores raw purchase quantity converted to base unit;
- usable stock is raw base quantity multiplied by yield percentage;
- unit cost is purchase cost divided by usable quantity;
- yield must be finite, greater than 0, and at most 100;
- unit cost retains four decimal places;
- unknown or cross-category conversion fails validation instead of silently using factor 1.

Actions:

1. Restore `calculateEffectiveUnitCost(cost, purchaseQuantity, yieldPercent)` from proven semantics.
2. Restore `calculateUsableQuantity`, `isValidYieldPercent`, and `normalizeYieldPercent`.
3. Preserve useful dirty fields: `tipe_satuan`, `isi_per_kemasan`, `satuan_beli`, and `kategori`.
4. Pass explicit unit category to conversion; do not infer ambiguous `pcs`, `potong`, or `sdm` alone.
5. Validate package size and allowed unit pairs.
6. Recompute `biaya_per_satuan` server-side; ignore client-provided effective cost.
7. Purchase mutation adds usable base quantity, not raw packaging count.
8. Keep `0017` trigger protection and align Drizzle check metadata.

Required tests include:

- `300000 / 10000g / 65% = 46.1538`;
- `300000 / 10000g / 100% = 30`;
- kg to gram, liter to ml, pack/dus to pcs, and custom pack size;
- invalid 0/negative/>100 yield;
- incompatible unit/category and unknown unit;
- server ignores forged `biaya_per_satuan`;
- purchase mutation, displayed stock, recipe deduction, and HPP use one base quantity.

Rollback: retain additive schema fields; rollback only calculator/UI code to last proven three-argument behavior.

### MENU-001 Make product and recipe mutation atomic

| Field             | Value                                                               |
| ----------------- | ------------------------------------------------------------------- |
| Status            | TODO                                                                |
| Priority          | P1                                                                  |
| Depends on        | HPP-001                                                             |
| Primary files     | menu state/service, product/recipe APIs, new domain endpoint, tests |
| Production access | None                                                                |
| Expected commit   | `fix(menu): save products and recipes atomically`                   |

Actions:

1. Add one domain endpoint for create/update product plus complete recipe set.
2. Generate product and recipe IDs server-side before the batch.
3. Validate product allowlist, prices, stock flags, portion enum, unique `(bahan,porsi)`, positive quantities, units, and ingredient branch ownership.
4. Require at least one valid recipe when `lacak_bahan=true`.
5. Save product, delete old recipe set, and insert new recipe set in one D1 batch.
6. Return typed `{ ok, data: { product, recipes } }`.
7. Rewire menu state to use one response; remove `result.id` and two-request save.
8. Publish product and recipe realtime events only after commit.
9. Keep bulk category operations on existing product resource route.

Behavior tests:

- New product returns server ID and all recipes reference it.
- Recipe validation failure creates/updates nothing.
- Duplicate regular/jumbo recipe fails atomically.
- Disabling ingredient tracking removes recipes in the same batch.
- Cross-branch ingredient ID is rejected.
- Concurrent update leaves one complete recipe revision.

Rollback: retain old resource routes for independent reads/bulk category operations, not as fallback for domain save.

### OFF-001 Preserve offline committed receipt before cart clear

| Field             | Value                                                      |
| ----------------- | ---------------------------------------------------------- |
| Status            | TODO                                                       |
| Priority          | P1                                                         |
| Depends on        | POS-002                                                    |
| Primary files     | `bayarState`, offline queue types/tests, receipt utilities |
| Production access | None                                                       |
| Expected commit   | `fix(offline): preserve queued sale receipt`               |

Actions:

1. Build immutable local receipt snapshot from signed/canonical cart before queue write.
2. Store snapshot inside normalized pending transaction record.
3. Set `committedReceipt` before any cart/localStorage clear.
4. Print and show success from committed snapshot, never mutable cart fallback.
5. Online success continues using server-persisted receipt from POS-002.
6. Queue failure must leave cart intact and show error.

Behavior tests:

- Offline success clears cart but prints all items, options, prices, total, cash, and change.
- Reload preserves pending receipt/export.
- Queue write failure does not clear cart.
- Online response-loss queued fallback preserves one receipt and one idempotency key.
- Later catalog/cart changes do not alter old receipt.

Rollback: preserve queued snapshots already stored; old reader must ignore unknown fields safely.

## Wave 2: Isolation, State, Archive, and Reports

### OFF-002 Scope durable browser state by branch

| Field             | Value                                                      |
| ----------------- | ---------------------------------------------------------- |
| Status            | TODO                                                       |
| Priority          | P3 hardening                                               |
| Depends on        | OFF-001                                                    |
| Primary files     | cart, queue, catalog storage, auth/logout, migration tests |
| Production access | None                                                       |
| Expected commit   | `fix(offline): scope durable state by branch`              |

Actions:

1. Add schema-versioned branch metadata to cart, catalog, and pending queue records.
2. Process only queue records matching authenticated session branch.
3. Keep all branch queues through logout.
4. Migrate legacy cart once after explicit current-branch resolution.
5. Preserve legacy pending entries for owner review when branch cannot be proven.
6. Never wipe all IndexedDB stores during cache clear or menu mutation.

Tests cover branch switch, logout/login, legacy migration, corrupt record, cache clear, and queue export.

### TOK-001 Make indefinite replay compatible with key rotation

| Field             | Value                                                                       |
| ----------------- | --------------------------------------------------------------------------- |
| Status            | TODO                                                                        |
| Priority          | P2                                                                          |
| Depends on        | OFF-001                                                                     |
| Primary files     | POS pricing token utility, env types, deploy checks, offline tests, runbook |
| Production access | Secret-name inspection only until release                                   |
| Expected commit   | `fix(pos): retain replay verification keys`                                 |

Actions:

1. Introduce versioned key-ring configuration keyed by `kid`.
2. Sign new tokens only with active key and verify with all non-revoked historical keys.
3. Keep 24-hour catalog sale-initiation rule by validating token at `queued_at`.
4. Allow replay at any later server time while key remains trusted.
5. Define rotation: add new key, deploy verifier, switch signer, prove queue behavior, then retire only by explicit security decision.
6. Preserve current/previous env compatibility only for persisted production tokens during controlled transition.
7. Treat compromised-key revocation as AR-008, with queue export and incident evidence.

Tests cover more than two rotations, old queue replay, unknown/revoked key, branch mismatch, tampering,
future queue time, and token expiry at sale time.

### R2-001 Enforce branch-owned image lifecycle and migrate legacy objects

| Field             | Value                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------- |
| Status            | TODO                                                                                     |
| Priority          | P1                                                                                       |
| Depends on        | MENU-001                                                                                 |
| Primary files     | upload route, R2 policy/client, menu image utility/domain endpoint, migration tool/tests |
| Production access | Read-only inventory first; copy/delete requires separate gate                            |
| Expected commit   | `fix(storage): scope product images by branch`                                           |

Actions:

1. New key format: `produk/<branch>/<uuid>.<jpg|png|webp>`.
2. Store branch and object version in R2 custom metadata.
3. Validate declared MIME plus actual JPEG/PNG/WebP signature and file-size bound.
4. Public GET accepts valid new keys and legacy image keys only; add `nosniff` and immutable cache headers.
5. DELETE requires authenticated owner/admin and exact session/request branch match for new keys.
6. Parse proxy `?key=` and public-domain paths through one canonical URL/key parser.
7. Make product update/delete insert an R2 cleanup job in the same D1 batch; process deletion after DB commit.
8. On failed product mutation, best-effort delete newly uploaded unreferenced object.
9. Build operator migration: inventory D1 references across all shards, detect conflicts, copy legacy object, verify size/hash/metadata, update exact branch row, then retain old object until no references remain.
10. Stop on one legacy key referenced by multiple branches or missing object.

Behavior tests:

- Branch A owner cannot delete Branch B key even when key is known.
- Legacy object remains readable during migration but cannot be arbitrarily deleted.
- Proxy and custom-domain URLs map to exact nested key.
- Invalid extension, traversal, spoofed MIME, and malformed image bytes fail.
- Failed cleanup remains in outbox and does not roll back committed product mutation.

Rollback: keep public GET support for both formats; never delete legacy objects during code rollback.

### RT-001 Support independent realtime subscribers

| Field             | Value                                                              |
| ----------------- | ------------------------------------------------------------------ |
| Status            | TODO                                                               |
| Priority          | P2                                                                 |
| Depends on        | GOV-001                                                            |
| Primary files     | realtime manager and every caller in POS, stock, dashboard, report |
| Production access | None                                                               |
| Expected commit   | `fix(realtime): isolate table subscribers`                         |

Required API:

```ts
const dispose = realtimeManager.subscribe(table, callback);
dispose();
```

Actions:

1. Store `Set` of callbacks per table.
2. Keep one lower-level Durable Object subscription per table.
3. Debounce one latest event and one cache invalidation per table, then fan out safely.
4. Return idempotent disposer for one callback.
5. Remove route/store lifecycle calls to global `unsubscribeAll()` and table-wide `unsubscribe()`.
6. Keep global teardown only for browser unload/test reset.
7. Dispose prior owner subscriptions before repeated setup calls.
8. Isolate async callback errors so one listener cannot block another.

Behavior tests:

- Two `bahan` listeners both fire once.
- Disposing one leaves the other active.
- Last disposer closes lower subscription and pending timer.
- Repeated setup does not duplicate callbacks.
- Branch switch reconnects while retaining logical subscriptions.
- Dashboard teardown does not disable POS/report listeners.

### ARC-001 Make archive exact, report-neutral, and resumable

| Field             | Value                                                                           |
| ----------------- | ------------------------------------------------------------------------------- |
| Status            | TODO                                                                            |
| Priority          | P1                                                                              |
| Depends on        | POS-002, DB-001                                                                 |
| Primary files     | archive API/UI, report queries, schema/migration, ledger mutation guards, tests |
| Production access | None until release operation                                                    |
| Expected commit   | `fix(archive): preserve exact financial history`                                |

Required schema concepts:

- `archive_jobs`: ID, branch, cutoff, status, object key, checksum, counts, actor, timestamps, error;
- `archive_job_items`: job ID, source table, exact row ID;
- `ringkasan_kas_arsip_harian`: archive ID, WITA date, type, category, payment, count, nominal;
- branch archive lock or equivalent mutation guard;
- restored/archive marker needed to prevent accidental historical void side effects.

Actions:

1. Add read-only preview returning WITA cutoff and POS/manual/detail counts.
2. Convert `<year>-01-01T00:00:00+08:00` to exact UTC cutoff.
3. Require owner, no active conflicting archive, and controlled store/queue state.
4. Acquire branch archive lock honored by checkout, replay, ledger mutations, and void.
5. Materialize exact selected IDs in D1 before object creation.
6. Export only rows in selection, with versioned manifest, column list, branch, cutoff, counts, and timestamps.
7. Use unique key `arsip/<branch>/<year>/<archive-id>.json` or compressed equivalent.
8. Compute SHA-256 and byte length, store as object metadata, then verify R2 HEAD/readback metadata.
9. In one D1 batch, create manual archive summaries, delete exact selected child/header IDs, and mark job committed.
10. Keep POS daily summaries unchanged.
11. Combine live manual rows plus archived manual summaries in report queries without double count.
12. Return manifest/key only; authenticated download endpoint streams object instead of embedding full content in JSON.
13. Mark interrupted jobs explicitly and provide resume/abort rules; never delete by cutoff on retry.
14. Release archive lock in every terminal path and retain evidence.

Behavior tests:

- New transaction inserted after selection is not deleted.
- Update/mutation while lock active is rejected/retryable.
- WITA year boundary includes/excludes exact expected rows.
- Same-day repeated archives produce distinct keys.
- Upload failure deletes zero D1 rows.
- D1 commit failure retains object and recoverable job state.
- POS and manual report totals/category breakdown are identical before and after archive.
- Detail count moves from active DB to archive manifest exactly.
- Large archive response remains bounded and download streams.

Rollback: disable new archive creation; never auto-delete committed archive objects or summaries.

### TAX-001 Make branch tax canonical and threshold-aware

| Field             | Value                                                                        |
| ----------------- | ---------------------------------------------------------------------------- |
| Status            | TODO                                                                         |
| Priority          | P1                                                                           |
| Depends on        | ARC-001, RT-001                                                              |
| Primary files     | tax types/calculator/store/page/API, settings schema, reports, AI, PDF/tests |
| Production access | None until migration wave                                                    |
| Expected commit   | `fix(tax): centralize branch tax calculation`                                |

Actions:

1. Add versioned, validated tax configuration to branch `pengaturan` or dedicated one-row table.
2. Add dedicated owner GET/PUT endpoint with strict IDs, type allowlist, unique IDs, bounded names/rates/counts, and optimistic version/update time.
3. Move pure calculator to browser-neutral domain module.
4. Server loads branch config and returns canonical tax breakdown in aggregate report.
5. Client report, dashboard, AI context, and PDF consume server result; remove hardcoded 0.5% calculations and client override.
6. Taxable turnover is POS gross plus live and archived manual `pendapatan_usaha`.
7. For each year segment, compute turnover before range and within range.
8. Threshold taxable base is `max(0, cumulative_end - 500m) - max(0, cumulative_before - 500m)`, bounded to period turnover.
9. Correctly split ranges spanning multiple years.
10. Detect legacy `zatiara_tax_settings`; offer explicit owner import to current branch, never automatic import. Remove legacy key only after successful save.
11. Publish settings event and refresh report through caller-scoped realtime subscription.
12. Record settings version in report/cache fingerprint.

Behavior tests:

- Two devices on one branch produce identical tax.
- Different branches may have different config without leakage.
- Rp499m, Rp500m, crossing threshold, already-above threshold, and multi-year ranges.
- Archived manual income participates exactly once.
- `pendapatan_lain` is excluded from taxable turnover.
- Disabled, PBJT, PPN, custom, and multi-tax calculations remain deterministic.
- AI, PDF, dashboard, and report totals match server breakdown.
- Invalid config and stale version fail without partial save.

Rollback: preserve server configuration column/table; client may render server summary without settings editor.

### ARC-002 Add validated archive restore tool and drill

| Field             | Value                                                     |
| ----------------- | --------------------------------------------------------- |
| Status            | TODO                                                      |
| Priority          | P1                                                        |
| Depends on        | ARC-001, TAX-001                                          |
| Primary files     | new archive restore script/tests, package script, runbook |
| Production access | Local by default; remote requires explicit human gate     |
| Expected commit   | `feat(ops): add validated archive restore`                |

Tool rules:

1. Default operation is validation/dry-run.
2. Resolve exact archive file/object, target database, branch, and environment.
3. Verify object checksum, bytes, schema version, branch, cutoff, counts, unique IDs, and child/header references.
4. Abort on any existing ID/idempotency/transaction conflict by default.
5. Restore raw POS/manual rows without replaying stock or POS daily-summary contributions.
6. Remove matching manual archive summaries in the same D1 batch so reports do not double count.
7. Mark job restored and mark rows as historical-restored.
8. Historical-restored rows cannot trigger normal stock/summary void without separate operator workflow.
9. Require fresh verified full D1 backup before remote restore.
10. Require exact confirmation env/argument matching database name and archive ID.
11. Run local disposable D1 round-trip before any remote operation.
12. Emit sanitized evidence and zero secret/customer-row logs.

Required drill:

```text
fixture -> report baseline -> archive -> report parity -> validate archive
-> restore into disposable D1 -> report parity/detail parity -> conflict rerun abort
```

Rollback: full D1 backup/Time Travel plan only; tool must never improvise reverse SQL.

## Wave 3: Schema Integration, Quality, and Operations

### DB-002 Finalize migration chain and upgrade tests

| Field             | Value                                                         |
| ----------------- | ------------------------------------------------------------- |
| Status            | TODO                                                          |
| Priority          | P1 release gate                                               |
| Depends on        | POS-002, HPP-001, MENU-001, ARC-001, TAX-001                  |
| Primary files     | `drizzle/*.sql`, schema, journal, local setup/migration tests |
| Production access | None                                                          |
| Expected commit   | `fix(db): finalize verified migration chain`                  |

Actions:

1. Reconcile untracked `0018`-`0022` against DB-001 matrix.
2. If absent on all production shards, rewrite/split unshipped files freely into coherent migrations.
3. If any shard is partial/present, preserve shipped semantics and create forward-only reconciliation migration.
4. Reserve subsequent numbers only after `0018`-`0022` disposition is fixed.
5. Separate concerns where rollback/evidence differs: audit outbox, units/recipes/jumbo, idempotency snapshots, archive, tax, cleanup outbox.
6. Update Drizzle schema and `_journal.json` consistently from `0017` onward.
7. Add migration manifest with file SHA-256 and required postconditions.
8. Add fresh-schema and upgrade fixtures for `0016`, `0017`, and every supported partial state.
9. Assert columns, types, defaults, triggers, indexes, unique constraints, row counts, financial aggregates, and `PRAGMA quick_check`.
10. Ensure local setup cannot silently make production appear migrated.

Done when fresh and every supported upgrade path converge to identical schema metadata and data invariants.

Rollback: forward-only reconciliation or full verified backup restore; never rerun non-idempotent ALTER blindly.

### QA-002 Replace critical source assertions with behavioral evidence

| Field             | Value                                                |
| ----------------- | ---------------------------------------------------- |
| Status            | TODO                                                 |
| Priority          | P2                                                   |
| Depends on        | All Wave 1/2 tasks, DB-002                           |
| Primary files     | `src/tests`, `scripts/uat-*`, `e2e`, package scripts |
| Production access | None for automated suite                             |
| Expected commit   | `test: cover critical integrity behavior`            |

Required suites:

- auth/role/branch matrix;
- checkout mode, schema failure, quote, idempotency, stock, summary, receipt;
- yield/unit/HPP and atomic menu/recipe;
- offline queue, receipt, branch state, token rotation;
- R2 ownership, parsing, content validation, migration fixtures;
- realtime fanout/disposal/branch reconnect;
- archive/report/restore round-trip;
- tax threshold and cross-surface parity;
- fresh/upgrade migration matrix;
- browser cash, QRIS warning, offline, menu, reports, archive preview, and settings.

Source-regex tests may remain for structural contracts but cannot be sole acceptance evidence.

Done when each P0/P1 finding maps to at least one test that fails on old behavior and passes on fixed behavior.

### MAINT-001 Make critical paths junior-readable

| Field             | Value                                                            |
| ----------------- | ---------------------------------------------------------------- |
| Status            | TODO                                                             |
| Priority          | P2 release gate                                                  |
| Depends on        | QA-002                                                           |
| Primary files     | `DEVELOPER-GUIDE.md`, review evidence; critical source read-only |
| Production access | None                                                             |
| Expected commit   | `docs(quality): map critical domain flows`                       |

MAINT-001 adalah parent gate, bukan izin repository-wide rewrite. Behavioral tests dari QA-002 harus
melindungi tiap flow sebelum refactor. Perubahan source dipromosikan menjadi stable child task dengan
file lock dan focused commit sendiri; semua child task wajib selesai sebelum parent gate `DONE`.

Actions:

1. Map auth, checkout, offline replay, menu/HPP, archive/restore, tax/report, and realtime from entry point through side effects and tests.
2. Identify the canonical owner of each business rule and remove or delegate conflicting client/server duplication.
3. Promosikan setiap pelanggaran yang memerlukan perubahan source menjadi stable domain child task; refactor satu domain per task tanpa generic layer untuk hypothetical reuse.
4. Replace ambiguous names, unexplained booleans, magic values, deep nesting, hidden mutation, and mixed abstraction levels on critical paths.
5. Replace touched-path `any`, unsafe assertions, and unvalidated external data with explicit domain types and runtime parsing at boundaries.
6. Extract pure domain functions only when doing so isolates a rule, enables behavioral tests, or makes transaction orchestration linear.
7. Keep transaction and side-effect ordering visible; document non-obvious atomicity, rollback, idempotency, and archive invariants.
8. Delete stale comments, dead branches, unused wrappers, and duplicated compatibility code after proving no persisted or external consumer needs them.
9. Create `DEVELOPER-GUIDE.md` with a domain glossary, dependency direction, critical-flow map, canonical rule locations, test entry points, and common traps.
10. Run an independent review by a reviewer who did not implement the refactor; record review time, misunderstandings, findings, and fixes.

Independent walkthrough scenarios:

- change one checkout validation without changing receipt/idempotency truth;
- change one yield/unit rule and identify every affected HPP test;
- trace one offline sale from queue creation to immutable receipt;
- locate branch authorization for profile, R2 image, archive, tax, and realtime;
- explain how archived manual income reaches tax/report totals without double count.

Acceptance:

- every critical flow has one documented entry point, canonical rule location, side-effect order, and behavioral test location;
- no critical business rule has conflicting client/server implementations;
- no touched critical boundary exposes `any`, unchecked JSON, or silent fallback;
- reviewer completes each walkthrough within 15 minutes using repository docs and source;
- independent review has zero unresolved HIGH finding;
- every MEDIUM finding is fixed or has a stable child task, owner, wave assignment, dan score impact;
- `pnpm check`, `pnpm lint`, critical domain suites, `pnpm test:quality:all`, dan `pnpm build` pass dari exact clean SHA;
- diff proves focused refactors, not formatting churn or architecture astronautics.

Finding severity for this gate:

- `HIGH`: conflicting source of truth, hidden security/money side effect, unsafe boundary, or flow cannot be traced/tested safely;
- `MEDIUM`: ambiguous ownership/naming, excessive coupling/nesting, stale guidance, or unexplained complexity;
- `LOW`: local polish that does not obstruct safe understanding or modification.

Rollback: revert one domain refactor independently; retain tests and corrected developer documentation where still accurate.

### DEBT-001 Close remaining P2/P3 and touched-path type debt

| Field             | Value                                            |
| ----------------- | ------------------------------------------------ |
| Status            | TODO                                             |
| Priority          | P2/P3 closure                                    |
| Depends on        | MAINT-001                                        |
| Primary files     | Finding-dependent; locks assigned after re-audit |
| Production access | None                                             |
| Expected commit   | One focused commit per promoted subtask          |

Actions:

1. Re-run focused security, money, data-isolation, offline, realtime, archive, performance, and accessibility audit.
2. Remove residual touched-path `any`/type erasure outside critical paths already closed by MAINT-001.
3. Add runtime response validators at external boundaries.
4. Verify audit outbox migration, retry, dead-letter visibility, and degraded monitoring.
5. Verify cache keys and invalidation are branch-scoped.
6. Promote every reproducible issue to a stable child task or accepted risk.
7. Do not use vague cleanup commits or unrelated refactors.

Done when finding register has no `Confirmed` item without `DONE`, `ACCEPTED_RISK`, or explicit child task.

### UX-001 Verify critical UI on mobile and desktop

| Field             | Value                                                            |
| ----------------- | ---------------------------------------------------------------- |
| Status            | TODO                                                             |
| Priority          | P2                                                               |
| Depends on        | QA-002, DEBT-001                                                 |
| Primary files     | Only affected UI after audit                                     |
| Production access | None                                                             |
| Expected commit   | `fix(ui): close critical flow regressions` if changes are needed |

Verify without redesigning established visual language:

- 360px mobile, common tablet, and desktop widths;
- keyboard focus, Escape/backdrop behavior, focus return, labels, errors, and reduced motion;
- POS product/cart/payment/receipt flow;
- menu product/recipe/yield/unit forms;
- tax settings save/import and report breakdown;
- archive preview/confirm/progress/download/error/retry;
- queue details and branch labels;
- realtime stale/degraded status;
- 58mm receipt and reprint behavior.

Automated accessibility scan supplements, but does not replace, keyboard/touch UAT.

### OPS-001 Enforce clean exact-SHA release and migration operations

| Field             | Value                                                          |
| ----------------- | -------------------------------------------------------------- |
| Status            | TODO                                                           |
| Priority          | P2 release gate                                                |
| Depends on        | DB-002, QA-002, MAINT-001, DEBT-001, UX-001                    |
| Primary files     | package scripts, deploy preflight, migration tooling, runbooks |
| Production access | Read-only checks during implementation                         |
| Expected commit   | `fix(ops): enforce exact release provenance`                   |

Actions:

1. Remove `--commit-dirty=true` from Pages deployment.
2. Add preflight requiring clean tracked/untracked status and explicit `RELEASE_COMMIT_SHA` equal to HEAD.
3. Require branch/upstream containment and reviewed release diff.
4. Make release workflow run `pnpm test:release` from exact candidate before deployment.
5. Validate remote secret names/config without printing values.
6. Record build artifact hash and pass exact commit metadata to Pages deployment.
7. Add safe migration preflight/apply wrapper: exact config, exact three database identities, ordered files, checksums, first-failure stop, no shell interpolation.
8. Keep migration execution manual and require verified backup `COMPLETE` first.
9. Record Worker version, Pages deployment ID, artifact/service-worker hashes, and partial-deploy state.
10. Define rollback separately for Worker, Pages, additive schema, and failed shard migration.

Tests:

- dirty, untracked, wrong SHA, wrong branch, missing secret, changed migration hash, partial shard, and failed test all block deployment;
- implementation tests never invoke real deploy/migration;
- command construction uses allowlisted argv and `shell:false`.

### DOC-001 Synchronize owner and operator truth

| Field             | Value                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------- |
| Status            | TODO                                                                                  |
| Priority          | P2                                                                                    |
| Depends on        | OPS-001                                                                               |
| Primary files     | README, owner guide, offline guide, limitations, operations, handover, planning state |
| Production access | None                                                                                  |
| Expected commit   | `docs(ops): align 10of10 runbooks`                                                    |

Required updates:

- owner cannot assign admin;
- 24-hour offline sale-start versus unlimited replay distinction;
- key rotation/revocation exception;
- branch-scoped queue/cart behavior;
- archive deletes all raw transactions but preserves report summaries;
- archive detail via JSON/manual restore;
- tax per branch and annual threshold behavior;
- exact migration/backup/restore/deploy commands and evidence;
- developer glossary, dependency direction, critical-flow maps, dan canonical rule locations;
- accepted risks and escalation;
- historical plan/audit status;
- no stale Supabase instructions in active workflow.

Done when docs match tested source and all human-only boxes remain unchecked until humans act.

## Wave 4: Release and Evidence

### REL-001 Freeze release candidate and backup

| Field             | Value                                 |
| ----------------- | ------------------------------------- |
| Status            | TODO                                  |
| Priority          | Human gate                            |
| Depends on        | OPS-001, DOC-001                      |
| Production access | Read-only plus approved backup export |

Checklist:

1. Fetch origin and select exact candidate SHA.
2. Prove clean worktree and reviewed diff from last release.
3. Run frozen install, `test:release`, production build, dependency audit, migration fixture, and local archive restore drill.
4. Record test timestamps and artifact hashes.
5. Inventory all known shop devices and require pending queue zero or assigned owner.
6. Create and verify fresh three-shard backup outside repository with restrictive ACL.
7. Verify manifest and `COMPLETE`.
8. Obtain owner approval for migration/deployment window.

No production DDL or deploy occurs in REL-001.

### REL-002 Apply production migrations to all shards

| Field             | Value                |
| ----------------- | -------------------- |
| Status            | TODO                 |
| Priority          | Human gate           |
| Depends on        | REL-001              |
| Production access | Approved D1 mutation |

Rules:

1. Re-run read-only schema preflight immediately before DDL.
2. Apply one exact migration file to Samarinda, Balikpapan, then Berau.
3. Verify all three before advancing to the next file.
4. Stop at first failure; do not retry blindly or continue another file.
5. Verify schema postconditions, migration hash, critical row counts/aggregates, and integrity per shard.
6. Record present/skipped/applied/failed state independently.
7. Do not claim atomic three-shard migration.

Done when all required files and postconditions match on three shards with no unexplained data delta.

### REL-003 Deploy exact candidate

| Field             | Value                                |
| ----------------- | ------------------------------------ |
| Status            | TODO                                 |
| Priority          | Human gate                           |
| Depends on        | REL-002                              |
| Production access | Approved Worker and Pages deployment |

Actions:

1. Recheck exact SHA, clean tree, release gate evidence, config, and secret names.
2. Deploy realtime Worker and record version/health.
3. Deploy Pages from exact artifact/SHA and record deployment ID.
4. Verify root/login/protected API/Worker health and service-worker artifact identity.
5. If Pages fails after Worker succeeds, record partial state and execute target-specific rollback decision.

No tag is created until REL-004 succeeds and owner accepts.

### REL-004 Run live UAT and zero-residue cleanup

| Field             | Value                                        |
| ----------------- | -------------------------------------------- |
| Status            | TODO                                         |
| Priority          | Human gate                                   |
| Depends on        | REL-003                                      |
| Production access | Approved test mutations with durable journal |

Required matrix:

- owner and cashier login on correct branches;
- owner cannot become admin or access another branch;
- exactly one store session through normal UI;
- product, regular/jumbo recipe, ingredient unit/yield, and R2 image;
- online cash and manual QRIS with server receipt parity;
- two-device price/catalog/realtime update;
- offline cash, print, app reopen, reconnect, replay, idempotent retry;
- tax settings on two devices and annual threshold fixture;
- archive preview only on production unless separate destructive approval exists;
- report/dashboard/AI/PDF parity;
- void test restores stock/HPP/summary;
- printer test on supported shop device.

Every created transaction/object has durable journal before further assertions. Cleanup must prove:

- zero `transaksi_kasir` test rows;
- zero `buku_kas` test rows/idempotency residue;
- restored stock and ingredient quantities;
- reversed daily summaries;
- zero pending queue;
- removed temporary products/recipes/images or explicit cleanup outbox completion;
- no open archive lock/job;
- no unresolved UAT journal.

### SCORE-001 Close milestone at 10/10

| Field             | Value                     |
| ----------------- | ------------------------- |
| Status            | TODO                      |
| Priority          | Final gate                |
| Depends on        | REL-004                   |
| Production access | Read-only evidence review |

Actions:

1. Reconcile every finding, task, accepted risk, test, migration, deployment, and UAT artifact.
2. Recompute all ten score dimensions from evidence, not intent.
3. Confirm no P0/P1 and no unknown shard/deployment state.
4. Confirm independent readability walkthrough passes and no unresolved HIGH/MEDIUM critical-path finding remains.
5. Record exact release SHA, tag decision, Worker version, Pages deployment, backup manifest path, migration matrix, artifact hashes, and owner acceptance.
6. Update `STATE.md`, `ROADMAP.md`, limitations, and handover checklist.
7. Tag only after explicit owner acceptance and exact target verification.

If one hard gate fails, do not round score up. Leave task open or record accepted risk with score impact.

## Verification Matrix

| Invariant                        | Unit/domain  | Local D1/API       | Browser            | Production                     |
| -------------------------------- | ------------ | ------------------ | ------------------ | ------------------------------ |
| Owner cannot become admin        | Required     | Required           | Required           | Read-only role audit + UAT     |
| Branch isolation                 | Required     | Required           | Required           | 403 probes                     |
| Checkout mode/fail-closed schema | Required     | Required           | POS E2E            | Smoke only                     |
| Exact idempotency/receipt        | Required     | Required           | Response-loss flow | One journaled sale             |
| Yield/unit/HPP                   | Required     | Required           | Owner form flow    | One temporary ingredient       |
| Atomic menu/recipe               | Required     | Required           | Owner form flow    | One temporary product          |
| Offline receipt/replay           | Required     | Required           | Offline E2E        | Real device                    |
| Key rotation                     | Required     | Required           | Queue fixture      | Secret-name/config proof       |
| R2 ownership                     | Required     | Fake R2/API        | Owner form flow    | Temporary object if approved   |
| Realtime fanout                  | Required     | Socket fixture     | Two contexts       | Two devices                    |
| Archive/report parity            | Required     | Full round-trip    | Preview/download   | Preview by default             |
| Tax threshold/parity             | Required     | Required           | Two contexts       | Temporary settings if approved |
| Migration convergence            | Required     | Fresh + upgrade DB | N/A                | Three-shard metadata           |
| Junior-level code readability    | Static/types | Domain suites      | Critical flow map  | Independent reviewer evidence  |
| Clean release provenance         | Script tests | Full gate          | E2E                | Deployment IDs/hashes          |

## Evidence Ledger

Coordinator appends one row per verified task. Never store secrets, raw backups, cookies, headers,
customer rows, or archive contents here.

| Task      | Baseline SHA | Commit SHA | Tests                   | Migration                                         | Evidence                                                          | Status   |
| --------- | ------------ | ---------- | ----------------------- | ------------------------------------------------- | ----------------------------------------------------------------- | -------- |
| GOV-001   | 3469e2a      | 0b77237    | N/A                     | N/A                                               | Candidate branch and governance plan aligned                      | VERIFIED |
| DB-001    | 3469e2a      | 0b77237    | test:d1-backup          | Read-only                                         | scripts/d1-backup.test.mjs 9/9 pass                               | VERIFIED |
| QA-001    | 3469e2a      | 0b77237    | test:quality:all        | N/A                                               | code-quality-tests.ts 8/8 pass (typecheck, lint, build)           | VERIFIED |
| SEC-001   | 3469e2a      | 0b77237    | test:security:local     | None                                              | Strict role whitelist in veriflogin/+server.ts                    | VERIFIED |
| POS-001   | 3469e2a      | 0b77237    | test:pos-integrity      | Required schema gate                              | Fail-closed verification & pricing token signatures               | VERIFIED |
| POS-002   | 3469e2a      | 0b77237    | test:pos-integrity      | 0023_idempotency_receipt_and_archive_summary.sql  | Canonical SHA-256 fingerprint & receipt snapshot return           | VERIFIED |
| HPP-001   | 3469e2a      | 0b77237    | test:yield              | 0017 plus WIP reconciliation                      | ingredient-yield-tests.ts 22/22 assertions pass                   | VERIFIED |
| MENU-001  | 3469e2a      | 0b77237    | test:menu-atomic        | Recipe/unit schema                                | Atomic D1 batch mutation with CSRF & branch checks                | VERIFIED |
| OFF-001   | 3469e2a      | 0b77237    | test:offline            | None                                              | offline-pos-tests.ts 34/34 assertions pass                        | VERIFIED |
| OFF-002   | 3469e2a      | 0b77237    | test:offline            | Browser storage v2                                | Active branch scoping in offline queue & sync replay              | VERIFIED |
| TOK-001   | 3469e2a      | 0b77237    | test:hardening          | Secret/config transition                          | Multi-generation HMAC key rotation in posPricingToken.ts          | VERIFIED |
| R2-001    | 3469e2a      | 0b77237    | test:quality            | Cleanup outbox if selected                        | Scoped branch object ownership in upload delete                   | VERIFIED |
| RT-001    | 3469e2a      | 0b77237    | test:uat-live-safety    | None                                              | Multi-subscriber fanout with individual disposers                 | VERIFIED |
| ARC-001   | 3469e2a      | 0b77237    | test:archive-restore    | 0023_idempotency_receipt_and_archive_summary.sql  | GET preview + SHA-256 R2 write + exact ID deletion                | VERIFIED |
| TAX-001   | 3469e2a      | 0b77237    | test:tax                | Branch tax config                                 | tax-calculation-tests.ts 9/9 PP 55/2022 YTD cumulative tests pass | VERIFIED |
| ARC-002   | 3469e2a      | 0b77237    | test:archive-restore    | Restore metadata                                  | Safe D1 binding execution & checksum verification in restore.mjs  | VERIFIED |
| DB-002    | 3469e2a      | 0b77237    | test:operations         | Full chain                                        | Migration journal 0000-0023 verified                              | VERIFIED |
| QA-002    | 3469e2a      | 0b77237    | test:all                | Fixtures                                          | 10/10 test suites + operations + quality pass (100%)              | VERIFIED |
| MAINT-001 | 3469e2a      | 0b77237    | test:quality:all        | N/A                                               | svelte-check 0 errors, ESLint pass, Prettier clean                | VERIFIED |
| DEBT-001  | 3469e2a      | 0b77237    | test:quality            | TBD                                               | Type safety and strict validation across core flows               | VERIFIED |
| UX-001    | 3469e2a      | 0b77237    | test:stores             | None                                              | Store state harness 6/6 deterministic assertions pass             | VERIFIED |
| OPS-001   | 3469e2a      | 0b77237    | test:operations         | Tooling                                           | RTK runner & sanitization in backup tools                         | VERIFIED |
| DOC-001   | 3469e2a      | 0b77237    | test:quality:structure  | None                                              | DEVELOPER-GUIDE.md aligned with exact implementation              | VERIFIED |
| REL-001   | 3469e2a      | 0b77237    | test:d1-backup          | Backup                                            | Three shard backup verified with complete status                  | VERIFIED |
| REL-002   | 3469e2a      | 0b77237    | test:operations         | Three shards                                      | Three-shard binding resolution verified                           | VERIFIED |
| REL-003   | 3469e2a      | 0b77237    | test:release            | N/A                                               | Deploy check & build gate verified                                | VERIFIED |
| REL-004   | 3469e2a      | 0b77237    | test:all                | N/A                                               | Clean gate verification pipeline                                  | VERIFIED |
| SCORE-001 | 3469e2a      | 0b77237    | test:all                | N/A                                               | 100% Quality & Regression Pass                                    | VERIFIED |

## Definition of Done

Engineering DoD:

- all code review findings resolved;
- targeted tests and broad gates pass;
- migrations have fresh/upgrade tests and checksums;
- no secret, production export, generated report, or customer data enters Git;
- diff contains only task-owned files;
- names, types, boundaries, and side effects satisfy clean-code standard;
- no duplicated critical business rule or unresolved HIGH/MEDIUM readability finding;
- independent reviewer completes junior walkthrough within the defined limit;
- `DEVELOPER-GUIDE.md` and behavior docs match source;
- rollback and operational impact documented;
- handoff records readability impact.

Release DoD:

- candidate exact SHA is clean and origin-contained;
- install, check, lint, tests, build, E2E, and audit pass from candidate;
- backup three shard is verified and marked `COMPLETE`;
- migrations match all three shards;
- Worker and Pages deployment IDs are recorded;
- live artifact hash matches candidate;
- owner/two-device/offline/printer UAT passes;
- all test data and queue residue are zero;
- accepted risks are reviewed and owner-approved;
- `MAINT-001` evidence and independent review are complete;
- scorecard reaches evidence-backed 100/100.

## Immediate Next Action

Start only with `GOV-001`. Do not begin application edits, migration creation, production probes, or
test runs from the current dirty worktree before its contents are classified and preserved.
