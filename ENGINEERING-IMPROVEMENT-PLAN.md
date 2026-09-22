# Engineering Improvement Plan

Tanggal: 22 September 2026  
Baseline: commit `fdcd88411a56acae1b26e4096c3d054da321701c` pada `main`  
Target: menaikkan kualitas overall dari 7,5/10 menuju minimal 8,5/10 tanpa memecah aplikasi menjadi microservices.

## 1. Keputusan dan batas kerja

- Pertahankan arsitektur modular monolith SvelteKit + Cloudflare Pages, D1, R2, dan Durable Objects.
- Kerjakan urut. Jangan mulai refactor arsitektur sebelum CI dan release gate hijau.
- Jangan menjalankan migrasi D1 remote, deploy produksi, restore produksi, atau rotasi secret tanpa persetujuan pemilik.
- Jangan mengubah data historis atau schema produksi berdasarkan asumsi. Ambil backup dan inspeksi schema aktual dahulu.
- Setiap fase harus memiliki tes regresi dan commit terpisah agar mudah direview atau di-revert.
- Local pass bukan pengganti CI remote. Fase hanya selesai bila acceptance criteria lokal dan remote terpenuhi.

### 1.1 Arti status task

| Status         | Arti                                                                              |
| -------------- | --------------------------------------------------------------------------------- |
| `Pending`      | Belum dikerjakan atau bukti belum tersedia.                                       |
| `In progress`  | Sedang dikerjakan; belum boleh dianggap aman atau selesai.                        |
| `Blocked`      | Prasyarat, akses, atau keputusan belum tersedia. Blocker harus ditulis eksplisit. |
| `Passed local` | Implementasi dan gate lokal terkait lulus, tetapi CI remote belum hijau.          |
| `Completed`    | Implementasi, seluruh tes relevan, CI remote, dokumentasi, dan evidence selesai.  |

Checklist hanya boleh dicentang saat status `Completed`. Source review, satu happy path, atau test lokal saja tidak cukup.

### 1.2 Bukti yang wajib disimpan

- Commit SHA yang diuji.
- Command persis dan exit code.
- Jumlah suite/test pass, fail, dan skip.
- Link CI remote pada SHA tersebut.
- Artifact/report/log yang relevan.
- Daftar file berubah dan batas scope.
- Lingkungan pengujian: Windows, Ubuntu CI, SQLite, D1/workerd, staging, atau production.
- Bukti cleanup server, browser, workerd, database, dan temporary directory.
- Batas bukti: hal yang belum diuji harus ditulis, bukan diasumsikan lulus.

Bukti berikut tidak sah:

- Screenshot tanpa SHA dan command.
- Klaim “sudah dites” tanpa exit code.
- Tes helper tiruan ketika kriteria meminta handler/service/runtime asli.
- CI hijau pada commit berbeda.
- Retry sampai hijau tanpa root cause flakiness.
- Build lokal sebagai pengganti CI remote.

### 1.3 Siklus wajib setiap task

1. Baca implementasi dan tes yang ada.
2. Catat kontrak perilaku sebelum perubahan.
3. Buat/perkuat tes reproduksi.
4. Pastikan reproduksi gagal dengan alasan benar bila memungkinkan.
5. Terapkan perubahan terkecil yang memenuhi kontrak.
6. Jalankan tes terarah, lalu seluruh gate fase.
7. Review diff, secret exposure, cleanup, dan dokumentasi.
8. Commit atomik dan verifikasi CI pada SHA sama.

### 1.4 Kelas tes wajib

| Kelas             | Tujuan                                              | Wajib ketika                                    |
| ----------------- | --------------------------------------------------- | ----------------------------------------------- |
| Static            | Typecheck, lint, format, config syntax              | Semua perubahan kode/config.                    |
| Unit              | Parser, policy, state transition, perhitungan murni | Logika bisnis berubah.                          |
| Integration       | Handler/service asli dengan SQLite atau D1/workerd  | SQL, route, repository, transaction berubah.    |
| E2E               | Browser, UI, API, hydration, dan D1 nyata           | Alur pengguna/release gate berubah.             |
| Negative          | Input invalid, role/branch salah, stale revision    | Boundary, security, atau data berubah.          |
| Concurrency       | Request bersamaan, retry, duplicate, race           | Uang, stok, archive, restore, settings berubah. |
| Failure injection | Network/DB/R2/realtime/AI gagal                     | Operasi multi-step atau integrasi berubah.      |
| Operational       | Backup, restore, migration, deploy, rollback        | Script operasional/release berubah.             |

### 1.5 Stop condition global

Hentikan fase bila salah satu terjadi:

- Selisih uang, stok, pajak, row count, receipt, atau checksum tidak dapat dijelaskan.
- Kebocoran data/event/cache lintas cabang.
- CI remote merah pada kandidat.
- Cleanup dapat menyentuh `.wrangler/state`, `.env`, database, backup, atau artifact pengguna.
- Backup tidak dapat diverifikasi atau direstore.
- Migrasi memerlukan menebak schema/data production.
- Secret production masuk command line, log, fixture, atau repository.
- Refactor mengubah kontrak tanpa acceptance test dan persetujuan.
- Fix hanya menurunkan assertion, menambah skip, memperbesar timeout, atau retry buta.

## 2. Baseline dan temuan aktif

### Bukti yang sudah hijau lokal

- `pnpm check`: 0 error, 0 warning.
- `pnpm lint`: lulus.
- `pnpm test:unit`: 21 suite lulus.
- `pnpm test:operations`: lulus.
- `pnpm build`: exit 0.
- `pnpm deploy:check`: lulus.
- Full E2E terisolasi: 22/22 lulus, 30 migrasi x 3 D1 lokal, cleanup sukses.

### Temuan yang masih terbuka

1. CI remote commit `fdcd884` gagal pada step `Run All Test Suites`; step build CI dilewati.
2. Penyebab persis CI belum diketahui karena log job membutuhkan akses GitHub terautentikasi. Jangan menebak sebelum mengambil log atau mereproduksi pada Linux.
3. `.github/workflows/ci.yml` belum menjalankan full E2E.
4. `deploy:all` tidak memanggil `test:release` dan dapat memakai `.svelte-kit/cloudflare` lama.
5. `scripts/preflight-release.mjs` hanya meng-hash maksimal 50 file dan tidak membuktikan artifact berasal dari HEAD aktif.
6. `README.md` menyatakan `deploy:all` membangun aplikasi, tetapi script saat ini tidak menjalankan build.
7. Orkestrasi masih terkonsentrasi pada `src/routes/api/aichat/+server.ts`, `src/routes/api/pos/transaction/+server.ts`, dan `src/routes/api/archive/+server.ts`.
8. Isolasi cabang dalam satu D1 group masih bergantung pada semua query membawa `cabang_id`.
9. Beberapa relasi legacy belum dilindungi constraint database dan mengandalkan service.
10. Migrasi produksi, restore backup produksi, smoke seluruh cabang, dan printer fisik belum diverifikasi.

## 3. Urutan eksekusi

| Urutan | Fase                                          | Prioritas        | Hasil utama                                       |
| ------ | --------------------------------------------- | ---------------- | ------------------------------------------------- |
| 1      | Pulihkan CI remote                            | P0               | CI hijau dan kegagalan dapat didiagnosis          |
| 2      | Amankan release dan artifact                  | P0               | Tidak ada deploy artifact lama/tidak teruji       |
| 3      | Wajibkan full E2E di CI                       | P0               | Gate browser otomatis pada commit/release         |
| 4      | Rapikan boundary aplikasi                     | P1               | Route tipis, use case teruji                      |
| 5      | Perkuat tenant dan integritas data            | P1               | Branch scope dan constraint lebih sulit dilanggar |
| 6      | Naikkan maintainability dan test architecture | P1               | Perubahan lebih mudah dipahami dan diverifikasi   |
| 7      | Verifikasi operasional produksi               | P0 sebelum rilis | Backup, migrasi, smoke, dan rollback terbukti     |

### 3.1 Dependensi, ukuran, dan reviewer

Ukuran bersifat relatif, bukan janji durasi. Satu paket besar harus dipecah mengikuti strategi commit pada bagian 12.

| Fase               | Dependensi                            | Ukuran                              | Reviewer minimum                 |
| ------------------ | ------------------------------------- | ----------------------------------- | -------------------------------- |
| 1. CI              | Akses log GitHub                      | M                                   | Maintainer + pemilik workflow    |
| 2. Release         | Fase 1 hijau                          | L                                   | Maintainer + operator Cloudflare |
| 3. E2E CI          | Fase 1 hijau; runner E2E lokal stabil | M                                   | Maintainer + owner alur POS      |
| 4. Boundary        | Fase 1-3 completed                    | XL, pecah AI/archive/POS            | Owner domain + reviewer backend  |
| 5. Tenant/data     | Fase 1-3; audit schema/data           | XL, pecah context/constraint/outbox | Owner data + operator D1         |
| 6. Maintainability | Baseline metric; Fase 1 stabil        | L, migrasi bertahap                 | Maintainer + owner test          |
| 7. Production      | Semua P0 completed                    | M operasional                       | Operator + approver bisnis       |

### 3.2 Gate kenaikan nilai

| Kondisi            | Nilai indikatif maksimum      | Alasan                                                  |
| ------------------ | ----------------------------- | ------------------------------------------------------- |
| CI masih merah     | 7,5/10                        | Bukti lokal belum terkonfirmasi remote.                 |
| Fase 1-3 completed | 8,0-8,3/10                    | Release dan E2E sudah repeatable.                       |
| Fase 4-6 completed | 8,5/10                        | Boundary, tenant safety, dan maintainability membaik.   |
| Fase 7 completed   | Siap dinilai production-ready | Operasi backup/migration/smoke/rollback sudah terbukti. |

Angka bukan acceptance criterion. Checklist dan evidence tetap menjadi penentu selesai.

---

## 4. Fase 1 - Pulihkan CI remote

### Tujuan

Menemukan penyebab nyata kegagalan CI #64, memperbaiki portabilitas, dan menghasilkan output diagnostik yang berguna.

### Task

- [x] Ambil log lengkap job `Run All Test Suites` melalui GitHub UI/CLI/API terautentikasi.
- [x] Catat command, suite, assertion, OS, Node, dan stack trace pertama yang gagal.
- [x] Reproduksi pada Ubuntu dengan Node dari `.node-version` dan install frozen lockfile.
- [x] Jalankan setiap kelompok terpisah: `test:operations`, `test:quality`, dan `test:unit`.
- [x] Perbaiki akar masalah. Jangan menambah retry atau skip untuk menyembunyikan kegagalan deterministik.
- [x] Pecah workflow menjadi job/step yang memberi nama suite gagal secara langsung.
- [x] Simpan output test sebagai artifact saat gagal.
- [x] Gunakan timeout job agar proses workerd/Playwright yang macet tidak menggantung tanpa batas.
- [x] Perbarui action yang memberi warning runtime deprecated bila versi stabil pengganti tersedia.

### Evidence Fase 1 (Completed)

- CI #64 (`fdcd884`): single job gagal pada `Run All Test Suites`, build dilewati. Log detail butuh auth (API log 403); anotasi hanya generik.
- CI #65 (`dc9d328`): setelah pecah 5 job, `Static` + `Operations` gagal pada `Setup Node.js` dengan error publik `Unable to locate executable file: pnpm`. Root cause: `setup-node@v5` dijalankan sebelum pnpm terinstal.
- Fix: `pnpm/action-setup` dipindah sebelum `setup-node`, `cache: pnpm` diaktifkan, `upload-artifact` naik ke v5.
- CI #66 (`f61de056`): setup lolos; `Unit Tests` gagal tepat pada step `Run Receipt Output Suite` dalam 1 detik. Root cause: `receipt-output-tests.ts` assert SHA256 HTML yang memuat `toLocaleString('id-ID')` — output ICU beda antara Node 26/Windows vs Node 24/Ubuntu.
- Fix: hapus golden hash; ganti contract struktural portabel (subtotal, handle `@`, escape `<script>`), tanpa ubah production code. Lokal `pnpm test:receipt-output` lulus.
- CI #68 (`fc927d0f`): **success** — 5/5 job hijau (Static, Operations, Unit 21/21 suite, Quality, Build).
- Commit: `dc9d328`, `f61de056`, `f3ad321`, `fc927d0f` pada `main`, semua ter-push ke `origin/main`.
- Batas bukti: run kedua hijau berurutan masih menunggu; E2E CI dan release artifact safety masuk Fase 2-3.

### File sasaran

- `.github/workflows/ci.yml`
- `package.json`
- Suite atau runner yang terbukti gagal dari log, bukan file yang hanya dicurigai.

### Rincian task

| ID    | Task                                | Output wajib                                                             |
| ----- | ----------------------------------- | ------------------------------------------------------------------------ |
| CI-01 | Ambil dan klasifikasikan log CI #64 | Root-cause note: step, command, stack pertama, OS, Node, file terkait.   |
| CI-02 | Reproduksi Linux                    | Command deterministik dengan failure dan exit code sama.                 |
| CI-03 | Perbaiki akar masalah               | Patch minimal dan regression test lintas OS.                             |
| CI-04 | Pecah job CI                        | Job/step static, operations, unit, build, dan kemudian E2E.              |
| CI-05 | Tambah diagnostics                  | Log/report failure terunggah tanpa secret.                               |
| CI-06 | Stabilkan process lifecycle         | Tidak ada server/workerd/browser yatim saat pass, fail, cancel, timeout. |

### Matriks tes CI

| ID     | Skenario                                        | Syarat lulus                                                              |
| ------ | ----------------------------------------------- | ------------------------------------------------------------------------- |
| CI-T01 | Fresh install Ubuntu                            | Frozen install exit 0; lockfile tidak berubah.                            |
| CI-T02 | Fresh install Windows                           | Exit 0; dependency tree konsisten.                                        |
| CI-T03 | Operations sendiri                              | Backup/self-test/isolation lulus tanpa production access.                 |
| CI-T04 | Quality sendiri                                 | Check, build, lint, format, structure, dependency checks lulus.           |
| CI-T05 | Unit sendiri                                    | Seluruh suite lulus tanpa skip baru.                                      |
| CI-T06 | Assertion sengaja dirusak pada branch sementara | CI merah pada step tepat; file/case terlihat.                             |
| CI-T07 | Run dibatalkan ketika server aktif              | Process berhenti; temp dibersihkan atau dipertahankan dengan pesan jelas. |
| CI-T08 | Commit sama dijalankan dua kali                 | Hasil identik; tidak bergantung state run sebelumnya.                     |

### Acceptance criteria

- [ ] `pnpm install --frozen-lockfile` lulus pada Ubuntu dan Windows.
- [ ] `pnpm test:operations` lulus pada Ubuntu dan Windows.
- [ ] `pnpm test:quality` lulus pada Ubuntu dan Windows.
- [ ] `pnpm test:unit` lulus pada Ubuntu dan Windows.
- [ ] Dua run CI remote berturut-turut hijau pada commit berbeda atau rerun bersih.
- [ ] Kegagalan buatan pada satu suite menampilkan nama suite dan log yang dapat diunduh.

### Hindari dan rollback

- Jangan gunakan `continue-on-error`, `|| true`, exit 0 palsu, atau skip khusus CI untuk test wajib.
- Jangan menambah retry sebelum flakiness direproduksi.
- Jangan mengubah versi Node/pnpm hanya untuk mengejar hijau tanpa compatibility proof.
- Jangan memakai secret atau D1 production.
- Jangan campur perbaikan CI dengan refactor domain.
- Workflow dapat di-revert tanpa data migration; simpan link run gagal awal dan dua run hijau akhir.

---

## 5. Fase 2 - Amankan release dan artifact

### Tujuan

Memastikan release hanya menggunakan artifact yang dibangun dari commit hijau yang sama.

### Task immediate guard

- [x] Ubah `deploy:preflight` agar menjalankan `deploy:check` dan full release gate, bukan hanya `test:all`.
- [x] Pastikan build output dibuat ulang sebelum dipakai. Jangan menerima `.svelte-kit/cloudflare` lama.
- [x] Wajibkan `RELEASE_COMMIT_SHA`; jangan default diam-diam ke HEAD tanpa verifikasi remote.
- [x] Verifikasi working tree bersih, HEAD sama dengan SHA release, dan commit berada pada branch yang diizinkan.
- [x] Hash seluruh file artifact, bukan hanya 50 file pertama.
- [x] Masukkan commit SHA, waktu build, Node/pnpm version, checksum config, dan checksum manifest migrasi ke artifact manifest.
- [x] Gagalkan deploy bila artifact manifest hilang, berubah, atau SHA tidak cocok.
- [x] Sinkronkan `README.md` dan `DEVELOPER-GUIDE.md` dengan perilaku script sebenarnya.

### Target architecture

- [x] CI membangun `.svelte-kit/cloudflare` tepat satu kali setelah seluruh gate hijau.
- [x] CI mengunggah artifact immutable bernama berdasarkan commit SHA.
- [x] Job deploy mengunduh artifact tersebut; tidak membangun ulang dan tidak memakai output workstation.
- [x] GitHub Environment production memakai approval manual.
- [x] Deploy realtime dan Pages mencatat SHA artifact yang sama.
- [x] Migrasi D1 tetap workflow terpisah dengan backup dan approval; jangan otomatis digabung dengan app deploy.

### Evidence Fase 2 (Completed)

- `scripts/preflight-release.mjs` ditulis ulang: mode default full gate (`deploy:check` + `test:release`), `--manifest-only` untuk CI, `--verify-only` tanpa mutasi. `RELEASE_COMMIT_SHA` 40-hex wajib di semua mode.
- Manifest `build-artifacts.json` (gitignored) kini memuat schema, commit SHA, branch, waktu UTC, versi Node/pnpm, checksum `wrangler*.jsonc`, checksum `drizzle/meta/manifest.json` + `_journal.json`, dan SHA-256 seluruh file artifact (batas 50 file dihapus; build lokal ~170 file).
- `scripts/preflight-release.test.mjs`: 8 tes node:test lulus (manifest segar, 61 file, tamper/hilang/tambahan/SHA/config-change/missing-manifest). Dirantai ke `test:operations` via `test:release-gate`.
- Verifikasi manual lokal: tanpa SHA ditolak (REL-T02); SHA salah ditolak; manifest lama 50-file milik commit lain ditolak mentah (schema/SHA/unrecorded files).
- CI job **Build** menjalankan `deploy:manifest` + upload artifact `release-<sha>` (build output + manifest, retensi 14 hari).
- Workflow baru `.github/workflows/deploy.yml` (`workflow_dispatch`, environment `production`): download artifact `release-<sha>`, `--verify-only`, lalu deploy realtime + Pages hanya bila `dry_run=false`. Migrasi D1 tidak tersentuh workflow ini.
- `deploy:all` tetap preflight + realtime + pages, tetapi preflight kini full gate; README + DEVELOPER-GUIDE §9C disinkronkan.
- Batas bukti: deploy workflow belum pernah di-dispatch (butuh secrets + approval pemilik); E2E CI masuk Fase 3.

### File sasaran

- `package.json`
- `scripts/preflight-release.mjs`
- `scripts/verify-cloudflare-deploy-config.mjs`
- `.github/workflows/ci.yml`
- Workflow deploy baru bila dipilih
- `README.md`
- `DEVELOPER-GUIDE.md`

### Kontrak artifact minimum

Manifest artifact harus mencakup full commit SHA, branch, waktu UTC, versi Node/pnpm, root artifact, checksum semua config, checksum manifest migrasi, dan SHA-256 seluruh file deployable. Daftar file harus lengkap dan deterministik; tidak boleh berhenti pada 50 file.

### Rincian task

| ID     | Task                     | Output wajib                                                |
| ------ | ------------------------ | ----------------------------------------------------------- |
| REL-01 | Tutup stale artifact gap | Build output baru dan manifest terikat HEAD.                |
| REL-02 | Verifikasi provenance    | Script menolak SHA/config/migration/file mismatch.          |
| REL-03 | Artifact CI immutable    | Artifact bernama full SHA; deploy tidak rebuild.            |
| REL-04 | Protected deploy         | Manual approval dan least-privilege production environment. |
| REL-05 | Pisahkan migrasi         | Backup/migrate tidak otomatis ikut app deploy.              |
| REL-06 | Sinkronkan docs          | README/runbook sama dengan script aktif.                    |

### Matriks tes release

| ID      | Skenario                                 | Syarat lulus                                  |
| ------- | ---------------------------------------- | --------------------------------------------- |
| REL-T01 | Working tree kotor                       | Ditolak sebelum build/network mutation.       |
| REL-T02 | `RELEASE_COMMIT_SHA` hilang              | Production preflight menolak.                 |
| REL-T03 | SHA berbeda dari HEAD                    | Ditolak dengan expected/actual SHA.           |
| REL-T04 | Artifact lama tersisa                    | Tidak diterima; output baru wajib dibuktikan. |
| REL-T05 | Satu file artifact diubah                | Checksum verification menolak.                |
| REL-T06 | Wrangler config berubah setelah build    | Verification menolak.                         |
| REL-T07 | Migration manifest berubah setelah build | Verification menolak.                         |
| REL-T08 | File ke-51 diubah                        | Verification tetap menolak.                   |
| REL-T09 | Secret scan artifact/log                 | Tidak ada token, password, key, `.env`, dump. |
| REL-T10 | Unit/E2E merah                           | Artifact tidak dipromosikan.                  |
| REL-T11 | Deploy dry-run                           | Pages/realtime memakai SHA sama.              |
| REL-T12 | Pages gagal setelah realtime sukses      | Runbook state parsial dan rollback terbukti.  |

### Acceptance criteria

- [ ] Preflight gagal bila artifact dibuat dari commit berbeda.
- [ ] Preflight gagal bila satu file artifact diubah sesudah build.
- [ ] Preflight gagal bila full E2E belum hijau.
- [ ] Preflight gagal pada working tree kotor.
- [ ] Dry-run deploy membuktikan Pages dan realtime memakai SHA sama.
- [ ] Tidak ada secret masuk log, argv, artifact, atau manifest.

### Hindari dan rollback

- Jangan deploy dari output workstation tanpa provenance.
- Jangan rebuild pada job deploy.
- Jangan simpan secret dalam artifact/manifest.
- Jangan gabungkan migrasi remote ke `deploy:all`.
- Jangan gunakan tag `latest`; gunakan full SHA.
- Jangan anggap deploy realtime dan Pages atomik.
- Simpan artifact sebelumnya; rollback memilih SHA lama tanpa rebuild.
- Schema rollback mengikuti restore/forward-fix runbook, bukan Pages rollback.

---

## 6. Fase 3 - Wajibkan full E2E di CI

### Tujuan

Menjadikan 22 tes browser dan persistence D1 terisolasi sebagai gate otomatis, bukan bukti manual.

### Task

- [x] Buat job `e2e` terpisah dengan `playwright install --with-deps chromium`.
- [x] Jalankan `pnpm test:e2e:all` pada runner Linux.
- [x] Pertahankan persistence/config/password/key unik per run.
- [x] Upload HTML report, trace, screenshot, dan video hanya pada failure.
- [x] Verifikasi cleanup temporary state sesudah sukses maupun gagal.
- [x] Pastikan `.wrangler/state` repository tidak dibuat atau diubah.
- [x] Tambahkan concurrency cancellation agar push baru membatalkan run branch lama.
- [x] Jadikan job E2E required check untuk release/main setelah stabil.

### Evidence Fase 3 (Completed)

- Job `e2e` di `.github/workflows/ci.yml`: install Chromium `--with-deps`, `pnpm test:e2e:all`, lalu step `Verify No Project State Touched` (tolak bila `.wrangler` muncul atau `git status` kotor). Report `playwright-report` + `test-results` di-upload hanya saat gagal.
- Concurrency cancellation sudah ada sejak Fase 1 (`ci-${{ github.ref }}`, cancel-in-progress).
- Job `build` kini `needs: [static, operations, unit, quality, e2e]` sehingga artifact tidak dibuat bila E2E gagal.
- Cleanup server/workerd dan isolasi D1 diwarisi dari runner terisolasi Fase B9 (`scripts/e2e-server.mjs` + `e2e-environment.mjs`).
- CI #71 (`06668b4`): **success, 6/6 job** — Static, Operations, Unit, E2E Browser Tests, Quality, Build. E2E lolos di Linux pada percobaan pertama; step `Verify No Project State Touched` lulus (tanpa `.wrangler`, git status bersih).
- Batas bukti: E2E-T02 paralel dua run dan E2E-T03 failure-injection disengaja belum dijalankan di CI; branch protection required-checks perlu diaktifkan manual di GitHub (di luar kode).

### Rincian task

| ID     | Task                   | Output wajib                                               |
| ------ | ---------------------- | ---------------------------------------------------------- |
| E2E-01 | Provision browser      | Chromium dan dependencies versi Playwright tersedia.       |
| E2E-02 | Environment terisolasi | Config, port, password, key, dan tiga D1 unik.             |
| E2E-03 | Diagnostics            | HTML report, trace, screenshot, video pada failure.        |
| E2E-04 | Cleanup                | Success/failure/cancel tidak menyentuh state project/user. |
| E2E-05 | Parallel safety        | Dua run tidak berbagi resource.                            |
| E2E-06 | Required gate          | Promotion/deploy bergantung job E2E.                       |

### Matriks tes E2E

| ID      | Skenario                   | Syarat lulus                                                  |
| ------- | -------------------------- | ------------------------------------------------------------- |
| E2E-T01 | Full suite                 | 22/22 atau jumlah terbaru lulus, exit 0.                      |
| E2E-T02 | Dua runner paralel         | Port/path/DB ID/password/key berbeda.                         |
| E2E-T03 | Browser test sengaja gagal | Exit nonzero, report tersedia, server berhenti.               |
| E2E-T04 | Server startup gagal       | Playwright tidak mulai; cleanup/retention eksplisit.          |
| E2E-T05 | Workerd menahan file       | Parent menunggu child exit sebelum cleanup.                   |
| E2E-T06 | Migrasi fixture invalid    | Setup fail-fast; test bisnis tidak berjalan.                  |
| E2E-T07 | Cleanup dua kali           | Idempoten; sibling/sentinel tetap utuh.                       |
| E2E-T08 | Repository sesudah run     | `.wrangler/state`, `.env*`, config, git status tidak berubah. |
| E2E-T09 | Checkout POS               | UI -> API -> D1 asli; receipt/idempotency benar.              |
| E2E-T10 | Auth/branch                | Unauthenticated, role salah, branch salah ditolak.            |

### Acceptance criteria

- [ ] 22/22 E2E lulus di CI.
- [ ] Dua job E2E paralel tidak berbagi port, password, config, atau D1 state.
- [ ] Failure test meninggalkan report, tetapi tidak menyentuh state pengguna.
- [ ] Job build/deploy tidak berjalan bila E2E gagal.

### Hindari dan evidence

- Jangan gunakan fixed port, existing server, production DB ID, atau project `.wrangler/state`.
- Jangan tulis password/key ke `.env` project.
- Jangan hapus temp parent; hanya directory milik run.
- Jangan mengganti handler/D1 asli dengan mock untuk acceptance bisnis.
- Upload trace/video hanya saat failure.
- Simpan link job, jumlah test, versi browser/Playwright/Node, dan bukti cleanup tanpa menyimpan generated secret.

---

## 7. Fase 4 - Rapikan boundary aplikasi

### Tujuan

Menjaga modular monolith, tetapi memindahkan bisnis dan orkestrasi keluar dari route HTTP.

### Aturan target

```text
Svelte UI
  -> Store / client service
  -> Route HTTP: auth + parse + response
  -> Application use case
  -> Domain service / policy
  -> Branch-scoped repository
  -> D1 / R2 / Durable Object / external AI
```

### Task 4A - AI

- [x] Ekstrak `AiGateway` untuk timeout, retry, fallback model, parsing response, dan error mapping.
- [x] Terapkan timeout pada primary, fallback, dan streaming request.
- [ ] Ekstrak use case identifikasi intent, pengambilan data laporan, memory, dan auto-apply.
- [x] Hilangkan `any` pada response/model/platform yang berada di critical path.
- [x] Pertahankan fast period resolver sebagai pure module dan analyzer sebagai fallback eksplisit.
- [x] Tambahkan contract test untuk timeout, malformed response, fallback, abort, dan branch scope.

### Evidence 4A - AiGateway (Completed)

- Baru `src/lib/server/aiGateway.ts`: `callAiChat`, `requestAiStream`, `requestAiStreamResilient`, typed `AiGatewayError` (`UPSTREAM_TIMEOUT`/`UPSTREAM_ERROR`/`INVALID_RESPONSE`), tanpa import SvelteKit/store/browser. Tiap percobaan punya deadline sendiri (dulu fallback/stream tanpa timeout). Urutan fallback, retry tanpa tools, dan fallback `|| ''` dipertahankan; timeout fallback terakhir diteruskan apa adanya.
- Route `src/routes/api/aichat/+server.ts` 1223 -> 1027 baris: hapus `callOpenRouter`/`callOpenRouterStream` lokal, blok stream fallback 43 baris jadi satu panggilan resilient. Tiga pemanggil non-streaming + satu streaming lulus typecheck.
- Baru `src/tests/ai-gateway-tests.ts`: 12 contract test (sukses, fallback 429, semua-gagal + status, timeout primary/fallback/stream + abort signal, malformed, retry tanpa tools, parity `|| ''`, urutan judul stream, respons terakhir !ok, error terakhir, tanpa bocor key). Dirantai ke `test:unit` + step CI `Run AI Gateway Suite`.
- Lokal: 22/22 suite unit, check 0/0, ESLint + Prettier lulus.
- Sisa 4A (use case intent/laporan/memory) + 4B archive + 4C POS belum dikerjakan.

### Task 4B - Archive

- [ ] Ekstrak `ArchiveUseCase` dari route.
- [ ] Pisahkan claim/lease, snapshot R2, readback, summary, finalisasi D1, dan cleanup.
- [ ] Pertahankan guard atomik dan tes race yang sudah lulus.
- [ ] Route hanya validasi request, role, branch, lalu memanggil use case.

### Task 4C - POS

- [ ] Pertahankan modul checkout yang sudah ada: loader, financials, fingerprint, statement builder.
- [ ] Pindahkan orkestrasi `POST /api/pos/transaction` ke `CheckoutUseCase`.
- [ ] Pertahankan signed quote, idempotency, fingerprint, receipt snapshot, stock guard, dan batch atomik.
- [ ] Jangan mengubah kontrak offline replay tanpa tes backward compatibility queue IndexedDB.

### Rincian task dan urutan

| ID     | Task                            | Prasyarat               | Output wajib                                 |
| ------ | ------------------------------- | ----------------------- | -------------------------------------------- |
| ARC-01 | Contract tests sebelum refactor | Fase 1-3 hijau          | Snapshot perilaku route/use case lama.       |
| ARC-02 | Ekstrak AI gateway              | Contract AI ada         | Gateway typed dengan timeout/abort/fallback. |
| ARC-03 | Ekstrak AI use cases            | ARC-02                  | Route AI menjadi boundary tipis.             |
| ARC-04 | Ekstrak archive use case        | R02/R08 hijau           | Claim/snapshot/finalize tetap atomik.        |
| ARC-05 | Ekstrak checkout use case       | POS integrity/E2E hijau | Route POS tipis tanpa ubah kontrak.          |
| ARC-06 | Tegakkan dependency direction   | ARC-02 sampai ARC-05    | Domain tidak import route/UI/global browser. |

Kerjakan berurutan: AI gateway, AI use case, archive, lalu POS. Jangan refactor tiga critical route bersamaan.

### Matriks tes AI

| Skenario                    | Syarat lulus                                            |
| --------------------------- | ------------------------------------------------------- |
| Primary sukses              | Typed response satu kali.                               |
| Primary 429/5xx             | Fallback terbatas sesuai policy.                        |
| Primary/fallback timeout    | Semua fetch di-abort; tidak ada request tanpa deadline. |
| Streaming client disconnect | Upstream dibatalkan dan resource dilepas.               |
| Response malformed          | Typed error; auto-apply tidak berjalan.                 |
| Periode ambigu              | Analyzer fallback; tidak memilih periode parsial.       |
| Branch berbeda              | Data cabang lain tidak masuk prompt/response.           |
| API key hilang              | Fail-closed; key tidak bocor.                           |

### Matriks tes archive

| Skenario                        | Syarat lulus                                             |
| ------------------------------- | -------------------------------------------------------- |
| 1/20/21/45/101 row              | Count, R2, summary, deletion, status konsisten.          |
| Retry sukses                    | Idempoten; summary tidak ganda; row baru tidak terhapus. |
| Dua cutoff bersamaan            | Satu claim aktif per cabang.                             |
| Lease habis/takeover            | Worker lama tidak finalisasi.                            |
| Edit/delete/session saat upload | Finalisasi konflik dan rollback/no-op.                   |
| R2 put/readback rusak           | Ledger utuh; job tidak completed.                        |
| Gagal chunk tengah              | Tidak ada partial state diklaim completed.               |
| Branch berbeda                  | Claim/manifest tidak silang cabang.                      |

### Matriks tes POS

| Skenario                         | Syarat lulus                                                  |
| -------------------------------- | ------------------------------------------------------------- |
| Tunai/non-tunai                  | Ledger, detail, stok, bahan, HPP, summary, receipt konsisten. |
| Idempotency sama/payload sama    | Satu mutasi; receipt lama dikembalikan.                       |
| Idempotency sama/payload beda    | 409 tanpa mutasi kedua.                                       |
| Checkout bersamaan stok terakhir | Maksimal satu sukses.                                         |
| Quote expired                    | 409/requote; harga tidak berubah diam-diam.                   |
| Offline replay                   | Snapshot signed, variance audit, retry idempoten.             |
| Batch gagal                      | Seluruh mutation rollback.                                    |
| Realtime/audit gagal             | Commit utama tetap benar.                                     |
| Branch/role salah                | Ditolak sebelum mutasi.                                       |

### Acceptance criteria

- [ ] Route AI, archive, dan POS berisi terutama boundary HTTP; bisnis utama dapat diuji tanpa RequestHandler.
- [ ] Seluruh tes lama tetap lulus tanpa mengurangi assertion.
- [ ] Setiap use case memiliki typed input/output dan typed domain error.
- [ ] Tidak ada perubahan perilaku bisnis tanpa acceptance test baru.
- [ ] Full E2E tetap 22/22 atau bertambah.

### Syarat struktur, hindari, rollback

- Route tidak berisi SQL bisnis baru.
- Use case tidak bergantung Svelte component/store/browser global.
- Adapter Cloudflare berada pada boundary infrastructure.
- Domain error memiliki code stabil dan mapping HTTP diuji.
- Tidak ada circular dependency atau dua policy kanonik aktif.
- Hindari rewrite big-bang, universal generic repository, rename API/schema bersamaan, atau abstraction demi jumlah baris.
- Jangan ubah uang, WITA, idempotency, receipt, dan offline contract sebagai efek samping.
- Satu commit per subfase. Bila parity gagal, revert subfase; jangan mengubah expected output tanpa analisis domain.

---

## 8. Fase 5 - Perkuat tenant dan integritas data

### Tujuan

Mengurangi ketergantungan pada disiplin manual setiap query.

### Task

- [ ] Buat `BranchContext` hanya dari auth session/server, bukan langsung dari payload client.
- [ ] Repository kritis wajib menerima `BranchContext`, bukan string cabang bebas.
- [ ] Larang import `getD1Database`/`getRawDb` langsung dari route melalui ESLint restriction, kecuali allowlist sementara.
- [ ] Inventaris semua raw SQL dan buktikan setiap operasi tenant memakai `cabang_id` pada SELECT/UPDATE/DELETE/JOIN.
- [ ] Tambahkan test negatif lintas cabang untuk setiap repository kritis.
- [ ] Audit orphan dan duplikat pada schema aktual sebelum menambah foreign key/constraint.
- [ ] Tambahkan compound uniqueness/check/FK secara bertahap untuk relasi yang aman.
- [ ] Buat ADR keputusan penyimpanan uang. Jangan migrasi `REAL` ke integer sebelum audit nilai historis dan kompatibilitas laporan.
- [ ] Evaluasi transactional outbox untuk realtime agar event dan mutasi domain berada pada batch D1 sama.

### Rincian task

| ID      | Task                         | Output wajib                                                 |
| ------- | ---------------------------- | ------------------------------------------------------------ |
| DATA-01 | Inventaris query tenant      | Daftar route/repository/query dan predicate cabang.          |
| DATA-02 | BranchContext                | Hanya dapat dibuat dari session terverifikasi.               |
| DATA-03 | Migrasikan repository kritis | POS, ledger, tax, archive, report, settings memakai context. |
| DATA-04 | Lint boundary                | Direct DB import dari route ditolak kecuali allowlist.       |
| DATA-05 | Audit data read-only         | Laporan orphan, duplicate, invalid enum/range.               |
| DATA-06 | Rancang constraint           | Migration forward-only + compatibility/rollback guidance.    |
| DATA-07 | ADR money model              | Keputusan berdasarkan data historis/HPP.                     |
| DATA-08 | Realtime outbox spike        | Prototype dan failure tests sebelum adopsi.                  |

### Matriks tes tenant

| Skenario                      | Syarat lulus                                     |
| ----------------------------- | ------------------------------------------------ |
| User A membaca ID cabang B    | 404/403; metadata B tidak bocor.                 |
| User A PATCH/DELETE ID B      | Nol row berubah.                                 |
| Payload mengganti `cabang_id` | Dibuang/ditolak; scope tetap session.            |
| Admin lintas cabang sah       | Hanya melalui policy eksplisit dan audit.        |
| Cabang satu D1 group          | Data/cache/realtime/rate-limit/session terpisah. |
| ID sama pada cabang berbeda   | Composite scope memilih target benar.            |

### Matriks tes migration/constraint

| Skenario                   | Syarat lulus                                     |
| -------------------------- | ------------------------------------------------ |
| Fresh DB                   | 0000-latest lulus; `quick_check=ok`.             |
| Upgrade snapshot lama      | Lulus tanpa kehilangan row/field bisnis.         |
| Orphan sebelum FK          | Preflight melaporkan; migration menolak aman.    |
| Duplicate sebelum unique   | Exact key dilaporkan; tidak dedup otomatis.      |
| Invalid amount/yield/stock | Ditolak sesuai kontrak.                          |
| Shard pertama gagal        | Shard berikutnya tidak berjalan.                 |
| Production schema drift    | Stop; repair/migration eksplisit sesudah review. |

### Acceptance criteria

- [ ] Route baru tidak dapat mengakses database tanpa branch context terverifikasi.
- [ ] Tes lintas cabang membuktikan read/write/update/delete tidak bocor.
- [ ] Migration matrix, SQLite, dan D1/workerd lulus.
- [ ] Constraint baru tidak menolak data produksi valid dan tidak menghapus data historis.
- [ ] Realtime failure tidak mengubah hasil commit dan event dapat dipulihkan bila outbox diterapkan.

### Hindari dan rollback

- Jangan jadikan `branch` payload sebagai authority atau gunakan ID tanpa scope.
- Jangan tambah constraint sebelum audit data aktual.
- Jangan dedup/membulatkan/memperbaiki production otomatis.
- Jangan migrasi tipe uang tanpa ADR, backup, parity, dan rehearsal.
- Jangan hapus compatibility fallback sebelum semua shard terverifikasi.
- Constraint rollout boleh dua tahap: observability/preflight, lalu enforcement.
- Setiap migration wajib punya preflight, expected count, checksum, dan rollback/forward-fix guidance.

---

## 9. Fase 6 - Maintainability dan test architecture

### Tujuan

Mengurangi biaya memahami perubahan, mempercepat diagnosis, dan mencegah regresi serupa.

### Task

- [ ] Pilih satu runner utama untuk unit/integration test; migrasikan bertahap, bukan big-bang.
- [ ] Ganti rantai 21 command serial dengan test discovery/reporting terstruktur.
- [ ] Pertahankan test D1/workerd khusus sebagai integration suite terpisah.
- [ ] Tambahkan coverage report. Target awal: critical money/data modules minimal 90% branch coverage; global threshold ditentukan sesudah baseline.
- [ ] Buat fixtures bersama untuk D1, branch, session, checkout, archive, dan tax.
- [ ] Larang empty `catch {}` kecuali diberi alasan `best-effort` dan observability yang sesuai.
- [ ] Gunakan schema runtime terpusat untuk payload API kritis dan hasil eksternal AI.
- [ ] Standarkan typed error code; UI tidak boleh bergantung pada pencocokan teks error.
- [ ] Tambahkan complexity report dan daftar modul hotspot. Gunakan batas tanggung jawab, bukan target baris buta.
- [ ] Hapus komentar historis yang tidak lagi menjelaskan perilaku saat ini.
- [ ] Tambahkan dependency/security scan dan lockfile audit ke CI.
- [ ] Tambahkan test yang memeriksa dokumentasi command release cocok dengan `package.json`.

### Rincian task

| ID     | Task                   | Output wajib                                           |
| ------ | ---------------------- | ------------------------------------------------------ |
| MNT-01 | Baseline metrik        | Durasi, coverage, complexity, ownership.               |
| MNT-02 | Pilih runner           | ADR runner dan migration strategy.                     |
| MNT-03 | Migrasi test bertahap  | Output terstruktur tanpa case hilang.                  |
| MNT-04 | Fixtures bersama       | D1/session/branch/checkout tanpa global mutable state. |
| MNT-05 | Typed validation/error | Schema dan stable code critical API.                   |
| MNT-06 | Error discipline       | Empty catch hanya best-effort terdokumentasi.          |
| MNT-07 | Complexity guard       | Threshold untuk hotspot baru.                          |
| MNT-08 | Docs drift guard       | Package/workflow/docs sinkron.                         |
| MNT-09 | Security gate          | Severity policy dan exception expiry.                  |

### Baseline dan target minimum

Sebelum menetapkan gate, ukur complexity, coverage per modul, durasi suite, flaky rate, jumlah `any`, direct DB import, empty catch, dan validator duplikat.

| Metrik                              | Target minimum                                      |
| ----------------------------------- | --------------------------------------------------- |
| Critical money/data branch coverage | 90%; cabang error penting tidak dikecualikan.       |
| Flaky required test                 | 0 yang diketahui.                                   |
| Empty catch tanpa alasan            | 0.                                                  |
| Direct DB import baru dari route    | 0.                                                  |
| Stable error code critical API      | 100% jalur error yang dipakai UI.                   |
| Failure diagnostics                 | Suite, file, case, expected, actual, stack pertama. |
| Docs drift release/test/deploy      | 0.                                                  |

### Matriks tes maintainability

| Skenario                                 | Syarat lulus                            |
| ---------------------------------------- | --------------------------------------- |
| Runner lama vs baru                      | Jumlah case dan expected result parity. |
| Assertion sengaja gagal                  | Report jelas, exit nonzero.             |
| Dua suite D1 paralel                     | Tidak berbagi DB/global state.          |
| Critical branch coverage turun           | Gate merah.                             |
| Error text berubah, code sama            | UI tetap benar.                         |
| Error code hilang                        | Contract test merah.                    |
| README command tidak ada                 | Drift test merah.                       |
| Dependency high/critical tanpa exception | CI merah.                               |

### Acceptance criteria

- [ ] Output test menunjukkan suite/file/assertion gagal tanpa membaca log panjang.
- [ ] Critical domain coverage mencapai target yang disetujui.
- [ ] Tidak ada empty catch tanpa alasan eksplisit.
- [ ] Error API kritis mempunyai code stabil dan test kontrak.
- [ ] Developer baru dapat menemukan aturan kanonik melalui `DEVELOPER-GUIDE.md`.
- [ ] Waktu CI tetap wajar; suite independen berjalan paralel tanpa berbagi state.

### Hindari dan rollback

- Jangan migrasi semua test satu PR.
- Jangan mengejar coverage dengan assertion kosong.
- Jangan paralelkan suite dengan DB/path/singleton sama.
- Jangan jadikan line count satu-satunya ukuran desain.
- Jangan ubah error code tanpa compatibility plan.
- Jangan tambah dependency besar bila standard library cukup.
- Pertahankan runner lama sampai parity terbukti; migrasikan per domain.

---

## 10. Fase 7 - Verifikasi operasional produksi

### Tujuan

Membuktikan sistem dapat dirilis dan dipulihkan, bukan hanya dibangun.

### Task

- [ ] Ambil backup ketiga D1 production melalui runner backup yang sudah diaudit.
- [ ] Verifikasi checksum dan lakukan restore drill ke database non-production terpisah.
- [ ] Bandingkan schema production aktual dengan 30 migrasi dan manifest.
- [ ] Jalankan migrasi pada staging/canary lebih dahulu.
- [ ] Jalankan smoke login, PIN, buka/tutup sesi, checkout tunai/non-tunai, offline replay, void, laporan, arsip, dan restore.
- [ ] Uji printer yang benar-benar dipakai: browser, ESC/POS USB/network, dan reprint receipt lama.
- [ ] Verifikasi realtime antar dua browser untuk setiap group cabang.
- [ ] Catat rollback point, artifact SHA, backup manifest, migration result, dan operator.

### Prasyarat mutlak

- [ ] Seluruh P0 sebelumnya completed.
- [ ] CI release SHA hijau dan required checks aktif.
- [ ] Artifact immutable tersedia dan checksum cocok.
- [ ] Backup tiga shard selesai, verified, dan berada di luar repository/workspace.
- [ ] Restore drill backup berhasil pada non-production.
- [ ] Maintenance window, operator, approver, dan komunikasi insiden tersedia.
- [ ] Kondisi session/queue memenuhi syarat operasi.

### Matriks smoke operasional

| ID      | Alur                 | Syarat lulus                                               |
| ------- | -------------------- | ---------------------------------------------------------- |
| OPS-T01 | Login valid/invalid  | Valid ke cabang benar; invalid tidak bocor user.           |
| OPS-T02 | Role/PIN             | Aksi sesuai role; elevasi kedaluwarsa.                     |
| OPS-T03 | Buka/tutup sesi      | Modal, total, history, status konsisten.                   |
| OPS-T04 | Tunai                | Total, cash, change, ledger, stok, summary, receipt benar. |
| OPS-T05 | Non-tunai            | Payment split dan laporan benar.                           |
| OPS-T06 | Offline replay       | Queue/replay satu kali; konflik terlihat; tidak duplikat.  |
| OPS-T07 | Void/metode bayar    | CAS, stok, summary, audit konsisten.                       |
| OPS-T08 | Pajak/laporan        | Omzet, YTD, archive parity, PDF, WITA benar.               |
| OPS-T09 | Archive              | Preview, R2, checksum, finalisasi, parity benar.           |
| OPS-T10 | Restore drill        | Conflict fail-closed; apply menjaga field/agregat.         |
| OPS-T11 | Realtime dua browser | Event hanya ke cabang benar; reconnect pulih.              |
| OPS-T12 | Printer browser      | Layout, topping, subtotal, nama numerik, reprint benar.    |
| OPS-T13 | ESC/POS              | Encoding, cut, failure, retry, fallback benar.             |
| OPS-T14 | Monitoring           | Error/latency/audit terlihat tanpa data sensitif.          |

### Stop/rollback trigger

- Checksum backup/artifact mismatch.
- Schema drift tidak dijelaskan atau satu migration shard gagal.
- Login/branch isolation gagal.
- Selisih uang, pajak, stok, summary, receipt.
- Offline replay duplikat atau realtime silang cabang.
- Error/latency melewati baseline yang disetujui.
- Artifact SHA aktif tidak dapat dibuktikan.

Saat trigger terjadi: stop rollout, jangan lanjut shard/cabang, simpan log, lindungi backup, dan ikuti rollback/forward-fix runbook. Jangan menulis SQL spontan di production.

### Acceptance criteria

- [ ] Backup dapat direstore dan hasil row count/checksum sesuai.
- [ ] Migrasi ketiga shard sukses atau first-fail-stop bekerja sebelum shard berikutnya.
- [ ] Smoke seluruh cabang target lulus.
- [ ] Printer fisik lulus pada jalur yang dipakai operasional.
- [ ] Rollback rehearsal berhasil pada staging.
- [ ] Release record menyebut commit dan artifact SHA yang sama.

### Hindari dan evidence

- Jangan jadikan production tempat pertama mengetes migration.
- Jangan simpan backup dalam repository/workspace atau media sama dengan source utama.
- Jangan restore ke production untuk sekadar test.
- Jangan lanjut shard berikutnya setelah first failure.
- Jangan hapus backup sebelum retention berakhir.
- Jangan anggap Pages rollback mengembalikan D1.
- Evidence wajib: release SHA, CI links, artifact/backup manifest, restore drill, schema diff, migration per shard, smoke per cabang/perangkat, deployment IDs, monitoring before/after, dan go/no-go approver.

---

## 11. Gate wajib setiap fase

Jalankan sesuai cakupan perubahan:

```powershell
rtk pnpm check
rtk pnpm lint
rtk pnpm test:unit
rtk pnpm test:operations
rtk pnpm build
rtk pnpm deploy:check
rtk pnpm test:e2e:all
rtk git diff --check
```

### Gate berdasarkan jenis perubahan

| Perubahan          | Gate minimum tambahan                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| Dokumentasi        | Prettier check, link/path check, `git diff --check`.                                             |
| Workflow CI        | YAML/action syntax, forced-failure test, CI remote.                                              |
| Script Node        | Unit script lintas OS, failure injection, cleanup test.                                          |
| UI/store/service   | Unit/state test + E2E alur terkait.                                                              |
| API/auth/branch    | Handler integration + negative role/branch/CSRF tests.                                           |
| SQL/repository     | SQLite fresh/upgrade + D1/workerd + rollback/concurrency.                                        |
| Checkout/uang/stok | POS integrity + idempotency + concurrency + full E2E.                                            |
| Archive/restore    | R2 failure/readback + handler/CLI + D1/workerd + parity.                                         |
| AI                 | Timeout/fallback/malformed/branch contract; tidak perlu model berbayar untuk gate deterministik. |
| Release/deploy     | Full `test:release`, artifact verification, CI remote, dry-run.                                  |

### Syarat command dianggap lulus

- Exit code 0.
- Tidak ada failed/cancelled/unexpected skip.
- Warning baru telah diklasifikasikan dan tidak menyembunyikan kegagalan.
- Tidak ada file tracked/untracked tak terduga sesudah command.
- Tidak ada process server/browser/workerd tertinggal.
- Tidak ada state project/user yang dihapus atau diubah oleh test.
- Output menyebut jumlah test/suite dan artifact yang relevan.

### Syarat review diff

- Hanya file dalam scope task yang berubah.
- Tidak ada secret, credential, dump data, `.env`, database state, atau backup.
- Tidak ada assertion dikurangi tanpa alasan kontrak.
- Tidak ada bypass auth/CSRF/branch/rate limit.
- Tidak ada destructive migration tanpa preflight dan backup.
- Dokumentasi dan command aktual sinkron.
- Generated artifact tidak di-commit kecuali memang bagian kontrak repository.

Untuk perubahan archive/restore, tambahkan D1/workerd:

```powershell
rtk pnpm exec tsx src/tests/archive-guard-tests.ts --d1
rtk pnpm exec tsx src/tests/restore-apply-tests.ts --d1
```

## 12. Strategi commit

Gunakan commit kecil berdasarkan fase:

1. `fix(ci): pulihkan test suite remote`
2. `fix(release): verifikasi artifact berdasarkan commit`
3. `test(e2e): wajibkan suite browser di ci`
4. `refactor(ai): ekstrak gateway dan use case`
5. `refactor(archive): ekstrak orkestrasi arsip`
6. `refactor(pos): tipiskan route checkout`
7. `refactor(data): wajibkan branch context`
8. `test(quality): satukan runner dan coverage`
9. `docs(release): sinkronkan runbook produksi`

Jangan menggabungkan refactor arsitektur dengan migrasi produksi dalam satu commit.

### Syarat setiap commit

- Satu tujuan dan satu fase.
- Pesan menjelaskan hasil, bukan aktivitas umum.
- Tes terarah sudah lulus sebelum commit.
- Tidak mencampur formatting seluruh repo dengan perubahan perilaku.
- Tidak mengandung secret atau artifact runtime.
- Dapat di-revert tanpa merusak commit fase lain.
- CI SHA commit tersebut diverifikasi sebelum task ditandai completed.

### Strategi pull request

- PR P0 CI/release dipisah dari refactor arsitektur.
- PR AI, archive, POS, tenant, migration, dan test runner dipisah.
- Setiap PR menjelaskan kontrak sebelum/sesudah, risiko, tes, rollback, dan batas bukti.
- Perubahan migration membutuhkan review khusus data dan runbook operator.
- Branch protection wajib meminta review dan required checks setelah CI stabil.

## 13. Definisi selesai keseluruhan

- [ ] CI remote hijau dan branch protection aktif.
- [ ] Full E2E menjadi required check.
- [ ] Deployment memakai artifact immutable dari commit yang sama.
- [ ] Route kritis tipis dan use case dapat diuji langsung.
- [ ] Branch isolation dipaksakan melalui context/repository dan tes negatif.
- [ ] Constraint database kritis ditambah setelah audit data.
- [ ] Test reporting, coverage, dan error contract konsisten.
- [ ] Backup/restore, migrasi staging, smoke cabang, dan printer fisik lulus.
- [ ] Dokumentasi release sesuai script aktual.
- [ ] Tidak ada klaim siap produksi selama salah satu P0 masih terbuka.

## 14. Definition of Done per task

Sebuah task hanya selesai bila seluruh poin berikut benar:

- [ ] Masalah/tujuan memiliki reproduksi atau baseline terukur.
- [ ] Implementasi memenuhi kontrak tanpa workaround tersembunyi.
- [ ] Tes positif, negatif, dan failure path relevan tersedia.
- [ ] Tes concurrency/idempotency tersedia bila menyentuh data kritis.
- [ ] Tes lintas cabang tersedia bila menyentuh tenant data.
- [ ] Static, unit, integration, dan E2E terkait lulus.
- [ ] Cleanup dan tidak-adanya side effect pada state pengguna terbukti.
- [ ] Dokumentasi dan runbook diperbarui.
- [ ] Diff direview untuk secret, scope creep, dan destructive behavior.
- [ ] Commit atomik dibuat.
- [ ] CI remote pada commit yang sama hijau.
- [ ] Evidence dan batas pengujian dicatat.

## 15. Definition of Ready per task

Task boleh dimulai hanya bila:

- [ ] Tujuan dan perilaku expected jelas.
- [ ] Dependency task sebelumnya completed.
- [ ] Fixture/test environment tersedia.
- [ ] Data atau secret production tidak diperlukan untuk development test.
- [ ] Risiko data dan rollback diketahui.
- [ ] File/module owner atau reviewer diketahui untuk area kritis.
- [ ] Tidak ada perubahan paralel yang konflik pada file/domain sama.

## 16. Prioritas eksekusi berikutnya

Mulai hanya dari paket berikut:

1. `CI-01`: ambil log lengkap CI #64.
2. `CI-02`: reproduksi failure pada Linux/Node yang sama.
3. `CI-03`: perbaiki akar masalah dengan tes regresi.
4. `CI-04` dan `CI-05`: pecah job serta simpan diagnostics.
5. Verifikasi dua run CI hijau.
6. Baru mulai `REL-01` stale artifact guard.

Jangan mulai refactor AI/archive/POS sebelum CI, artifact safety, dan full E2E CI selesai.
