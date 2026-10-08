# Rencana Remediasi Audit ZatiarasPOS

Tanggal rencana: 5 Oktober 2026.

Baseline audit: commit `3ac4c41d8f185ea52677e6903e9bd1314257f84b`. SHA ini adalah referensi audit/CI, bukan klaim bahwa working tree pengguna bersih atau produksi memakai SHA tersebut.

**Status awal: rencana saja; seluruh 63 task implementasi/verifikasi masih `Pending`. Tidak ada perbaikan aplikasi yang dinyatakan selesai oleh dokumen ini.**

Dokumen ini adalah sumber kanonik pekerjaan dan status untuk seluruh temuan sepanjang sesi audit: review awal, review lanjutan, reproduksi runtime, gate yang gagal, serta batas bukti operasional. [Engineering Improvement Plan](../ENGINEERING-IMPROVEMENT-PLAN.md) tetap menyimpan histori pekerjaan sebelumnya; jangan membuka ulang pekerjaan historis yang sudah selesai hanya karena baseline lamanya berbeda.

## 1. Hasil akhir dan batas kewenangan

Hasil akhir yang diminta:

1. Seluruh bug terkonfirmasi diperbaiki sampai handler/use case/database/UI, bukan hanya toast atau helper.
2. Seluruh risiko statis diperiksa dengan interleaving/failure path yang relevan; diperbaiki bila benar, atau ditutup dengan bukti `Not affected` yang dapat direview.
3. Kontrak uang, stok, cabang, sesi, struk, AI, arsip, restore, dan release tetap konsisten.
4. Gate lokal, workerd, browser, CI, artifact, staging, dan operasi nyata yang disebut di sini memiliki evidence pada kandidat yang sama.
5. Seluruh task pada tracker `Completed`; tidak ada blocker, acceptance criterion, atau fitur yang diam-diam dihapus untuk menghasilkan status hijau.

Bukan target: angka subjektif 10/10, sertifikasi keamanan, microservices, rewrite framework, fitur tambahan, atau jaminan tidak pernah ada bug baru. Selesai berarti kontrak dan bukti di dokumen ini terpenuhi.

Persetujuan untuk membuat rencana **bukan** persetujuan menjalankan migrasi/deploy/restore/wipe/rotasi secret produksi, mengirim data produksi ke model, membayar provider, atau menghapus state pengguna. Development memakai fixture dan state milik runner yang terisolasi. Operasi nyata memiliki gate persetujuan pada bagian 10.

## 2. Baseline bukti — bukan status perbaikan

| Area                    | Hasil audit yang sudah diamati                                                                             | Batas bukti                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `rtk pnpm test:all`     | Exit 0; operasi, 8 quality checks, dan 38 suite unit lulus                                                 | Bukan seluruh alur bisnis telah aman                                                                 |
| Enam suite `--d1`       | Exit 0 untuk archive guard, restore apply, stock reconciliation, stock offline review, Antrean, notifikasi | D1/workerd lokal, bukan shard produksi                                                               |
| `rtk pnpm test:e2e:all` | Exit 1; 67 lulus, 3 gagal dari 70                                                                          | Tiga skenario Antrean belum memiliki root cause                                                      |
| Konfigurasi deploy      | Exit 0; peringatan Web Push belum dikonfigurasi                                                            | Bukan bukti realtime/push produksi berfungsi                                                         |
| Migrasi tanpa apply     | Exit 0; 38 checksum cocok                                                                                  | Tidak menjalankan migrasi remote                                                                     |
| Dependensi              | 0 high/critical; 2 moderate dan 1 low                                                                      | Exploit aplikasi tidak dibuktikan                                                                    |
| CI/artifact             | CI pada SHA baseline sukses; artifact diverifikasi untuk 171 file utama dan 3 runtime roots                | Metadata journal Windows berbeda CRLF/LF; verifikasi memakai penyesuaian pada salinan sementara saja |
| Toolchain               | Pin Node 24.20.0, pnpm 11.24.0; audit lokal Node 26.8.1                                                    | Paritas runtime belum dibuktikan; jangan otomatis menyalahkan Node                                   |
| Smoke nyata             | Login/dashboard/stok Chrome; POS snapshot harga/idempotency; role/branch/CSRF/PIN positif-negatif          | Bukan load test atau sertifikasi perangkat fisik                                                     |
| Cleanup audit           | Probe dan database sementara dibuang; report kualitas lama dipulihkan                                      | Trace kegagalan tetap ada di luar repo                                                               |

CI referensi: <https://github.com/zulilmiihsn/zatiaras-juice-pos/actions/runs/37254496603>.

Evidence E2E lokal, selama belum dihapus oleh pemilik: `%TEMP%\zatiaras-full-audit-5n1OS9\e2e-results`. Gunakan `trace.zip`, screenshot, dan `error-context.md` untuk triage; jangan menyalin cookie/password/isi sensitif ke repo atau laporan publik.

### 2.1 Koreksi dan temuan yang tidak boleh dijadikan alasan perubahan salah

| Observasi                                                                         | Disposisi dan tindakan                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Klaim awal admin login menjadi kasir sehingga monitoring tidak dapat diakses      | **Dicoret sebagai bug akses admin.** `getAuthSession` membaca role profil aktual; HTTP monitoring admin terbukti 200. Jangan menurunkan role admin agar sama dengan kolom session. Konsistensi role tidak dikenal ditangani terpisah oleh AUD-019. |
| Klaim frontend menolak semua admin                                                | **Dicoret untuk admin yang valid.** `UserRole` memang mencakup `admin`. AUD-019 menguji ketiga role valid dan role tidak dikenal tanpa memperluas permission.                                                                                      |
| Klaim AppModal sudah memiliki focus trap lengkap                                  | **Tidak benar pada sumber yang dibaca.** ARIA sudah ada, tetapi perpindahan/trap/restorasi fokus belum ada; AUD-023 harus mendahului migrasi dialog stok.                                                                                          |
| Klaim archive masih memakai schema version 1                                      | **Tidak benar.** Exporter memakai v2. Temuan sesungguhnya: v2 sudah memuat field baru yang dapat diabaikan decoder v2 lama; AUD-041 menetapkan kontrak versi baru.                                                                                 |
| Nominal invalid menyebabkan laporan NaN/null                                      | **Dikoreksi.** String invalid tersimpan, kemudian laporan memperlakukannya sebagai 0. Bug tetap pada boundary tulis; jangan memperbaikinya dengan fallback 0.                                                                                      |
| Login berakhir di `/login` berarti password salah                                 | **Tidak terbukti.** Snapshot menampilkan login berhasil; AUD-004 menyelidiki transisi setelah login.                                                                                                                                               |
| Timeout notifikasi berarti event pasti hilang atau preferensi suara pasti kembali | **Tidak terbukti.** AUD-002/AUD-003 menguji state dan delivery, bukan menebak penyebab dari timeout.                                                                                                                                               |
| Tidak ada binding pada config Pages berarti realtime produksi pasti rusak         | **Belum terbukti.** Ada config utama lain; AUD-050 memverifikasi config yang benar-benar dikonsumsi artifact/runtime.                                                                                                                              |
| Batas universal ukuran body respons Worker                                        | Jangan mengarang limit. Risiko terverifikasi dari sumber adalah buffering tanpa batas; gunakan limit vendor yang benar dan hasil ukur pada AUD-039/AUD-057.                                                                                        |
| SDK browser/subagent audit gagal atau runtime probe lokal ECONNRESET              | Pisahkan kegagalan tool/harness dari aplikasi. Tidak perlu mengubah kode aplikasi untuk menutupi tool audit. Klasifikasi launcher/runtime pada AUD-001.                                                                                            |

Observasi positif yang harus dipertahankan: signed pricing POS, idempotency/fingerprint, branch guards, PIN, snapshot saat commit, claim/lease arsip, readback R2, dan rollback atomik restore yang sudah ada.

## 3. Aturan eksekusi AI Agent

### 3.1 Sumber dan kontrak

- Ikuti `AGENTS.md`, `DEVELOPER-GUIDE.md`, ADR, dan operator runbook. Semua command manual Agent berprefix `rtk`.
- Baca implementasi dan bagian tes yang relevan sebelum edit. Referensi line audit adalah titik awal, bukan line permanen.
- Bila LSP tersedia, gunakan references sebelum mengubah exported API, kemudian migrasikan semua caller. Jangan meninggalkan alias/re-export/shim atau dua implementasi kebijakan aktif.
- Dependency tetap UI -> store/service -> HTTP boundary -> application use case -> domain/policy -> branch-scoped repository -> infrastructure.
- Use case kritis menerima `BranchContext` hasil session; query tenant membawa predicate cabang. Branch dari body/query/cache bukan otoritas.
- Rupiah operasional dinormalisasi; **HPP tetap presisi 4 desimal sesuai ADR 0001**. Qty/unit/yield bukan uang dan tidak boleh ikut dibulatkan menjadi rupiah.
- Pertahankan kolom uang REAL. Perubahan tipe/destructive migration membutuhkan ADR, preflight, backup, rehearsal, dan approval sendiri.
- `(cabang_id, idempotency_key)` dan fingerprint tetap otoritas retry. Key sama + payload berbeda adalah 409 tanpa mutasi bisnis.
- Kontrak queue IndexedDB, arsip lama, dan receipt snapshot tetap dapat dibaca melalui decoder versioned yang kanonik. Ini bukan izin menambah compatibility alias atau mempertahankan dua writer lama/baru.

### 3.2 Siklus task

1. Claim ID pada tracker: isi owner aktual, base SHA, dan file ownership; status `In progress` hanya untuk task dependency-ready.
2. Catat kontrak before/after, bukti audit yang dipakai, tes regresi, serta rollback.
3. Observasi/gate audit yang gagal adalah ground truth. Jangan mengulang check yang sama hanya untuk memastikan laporan audit. Untuk risiko belum dieksekusi, buat reproduksi deterministik pada jalur nyata sebelum perbaikan.
4. Bug finansial/race mendapat regresi failing-before/passing-after yang beralasan. Bila impraktis, dokumentasikan alasan dan gunakan smoke sebelum/sesudah yang menguji state bisnis.
5. Terapkan perubahan minimal sampai seluruh caller/decoder/UI selesai. Jangan berhenti pada endpoint baru yang belum dipakai atau state helper yang belum terhubung.
6. Jalankan tes terarah setelah perubahan terintegrasi; exercise handler/program/UI asli. Unit saja bukan bukti runtime.
7. Jalankan gate fase sekali setelah cohort selesai; rekam exit code, counts, artifact, environment, dan cleanup.
8. Update docs/changelog yang ada setelah smoke membuktikan perubahan. Hapus scaffold/probe sementara; pertahankan failure artifacts yang relevan di tempat aman luar repo.
9. Review scope/secret/kontrak; buat commit atomik dan verifikasi CI pada SHA yang sama sesuai kewenangan.
10. Status `Passed local` sampai bukti remote/reviewer tersedia. `Completed` hanya setelah DoD individual dan global-per-task terpenuhi.

Untuk risiko statis yang ternyata tidak berlaku: jangan membuat fix palsu. Rekam disposition `Not affected`, interleaving/boundary yang diuji, sumber proteksi, dan hasil runtime; reviewer harus menyetujui penutupannya. Satu happy path yang tidak gagal bukan pembuktian race tidak ada.

### 3.3 Kepemilikan dan paralelisme

Satu integration owner menjaga kontrak lintas modul, task graph, CI, dan release candidate. Lane berikut adalah tanggung jawab, bukan nama Agent yang sudah ditugaskan.

| Lane             | Wilayah utama         | Konflik yang harus diserialkan                                       |
| ---------------- | --------------------- | -------------------------------------------------------------------- |
| Runtime/Antrean  | AUD-001..004, AUD-050 | File notifikasi dan fixture E2E yang sama                            |
| Data/POS         | AUD-005..014, AUD-058 | `stok/+page.svelte`, service bahan/sesi, menu atomic, report queries |
| Security/cache   | AUD-015..020          | Login/session/hooks dan metadata tenant                              |
| UI               | AUD-021..029, AUD-053 | Halaman stok, modal primitives, stores laporan/Catat                 |
| AI               | AUD-030..038          | `reportData`, `autoApplyService`, gateway                            |
| Archive/ops      | AUD-039..048, AUD-059 | Export format, restore lib, manifest verifier, D1 migrations         |
| Realtime/quality | AUD-049..057          | Worker, package scripts, lockfile, CI                                |
| Operator/release | AUD-060..063          | Secret, perangkat, staging/production dan promotion                  |

- Paralel hanya untuk dua atau lebih slice nyata dengan file/kontrak terpisah. Jangan membuat Agent hanya untuk update checklist/formatting.
- Parent menetapkan interface dan owner sebelum fan-out. Siblings tidak mengedit file bersama; satu owner mengintegrasikan perubahan yang bersinggungan.
- Untuk subagents paralel: reproduksi baseline oleh integration owner sebelum fan-out; anak tidak menjalankan build/lint/tests/formatter saat shared tree masih berubah. Parent menjalankan gate setelah semua hasil diintegrasikan.
- Jangan menjalankan E2E mutatif bersamaan terhadap D1/state yang sama. `workers: 1` bukan bug; tambah worker hanya bila isolasi per-worker benar-benar dibuktikan.
- Blocker satu lane tidak menghentikan pekerjaan lain yang dependency-ready. Tidak ada polling/babysitting atau status selesai tanpa hasil.

## 4. Definition of Ready, Done, dan larangan

### 4.1 Definition of Ready per task

- ID, masalah, kelas bukti, expected behavior, dan file target jelas.
- Dependency teknis selesai atau prasyarat baseline tersedia; tidak ada konflik file owner.
- Fixture terisolasi, runtime pin, failure injection, dan cleanup tersedia.
- Risiko data, reviewer, dan rollback diketahui.
- Operasi berbayar/remote/destructive sudah mendapat approval bila task akan memakainya.

### 4.2 Definition of Done per task

Semua poin wajib, bukan pilihan:

- [ ] Acceptance criteria pada kartu task terpenuhi end-to-end atau disposition `Not affected` memiliki proof yang setara.
- [ ] Semua caller, DTO, state, decoder, error code, repository, SQL, dan UI yang terpengaruh dimigrasikan; dead path dihapus.
- [ ] Positif, negatif, boundary, failure path, role/cabang/CSRF relevan lulus; race/idempotency diuji bila menyentuh data/async.
- [ ] Runtime smoke nyata membuktikan state/hasil, bukan mock echo, wiring, source-text assertion, atau bare not-throw.
- [ ] Gate relevan lulus dengan command, exit code, counts, OS/Node, SQLite/workerd/browser yang dicatat.
- [ ] Tidak menambah `any`, catch kosong tanpa alasan best-effort, raw float money, SQL bisnis di route baru, atau policy kedua.
- [ ] Tidak ada secret/dump/runtime artifact/probe yang masuk repo; resource milik runner bersih dan state pengguna tidak disentuh.
- [ ] Docs/changelog/runbook yang terpengaruh sinkron; tidak memperbarui angka tanpa hasil aktual.
- [ ] Commit atomik, reviewer domain/data/security yang relevan, dan CI pada SHA yang sama memiliki bukti.
- [ ] Untuk task operasional: approval, backup/readback, staging, rollback, dan bukti target/deployment nyata lengkap.
- [ ] Tracker dan catatan eksekusi diperbarui dengan batas bukti yang masih ada; tidak ada acceptance tersembunyi yang tertinggal.

### 4.3 Yang harus dihindari

1. Membuat toast sukses/gagal seolah rollback terjadi padahal sebagian write sudah commit.
2. Mengganti retry key, mengabaikan fingerprint conflict, atau mematikan stok/CSRF/PIN/tenant guard agar tes hijau.
3. Mengubah invalid money/date menjadi 0/tanggal sekarang; mengecualikan arsip yang gagal dibaca sebagai data kosong.
4. Menimpa saldo dengan snapshot form; mengedit histori struk/harga/counter untuk cocok dengan katalog sekarang.
5. Memilih session/username duplicate yang menang berdasarkan tebakan atau menghapus data historis tanpa reconciliation yang disetujui.
6. Menaikkan timeout, menambah retry/skip, memakai force click untuk menutupi UI yang tidak siap, atau menurunkan assertion tanpa root cause.
7. Memasang deadline hanya pada headers; memakai `Promise.race` sambil membiarkan upstream/timer/subscription hidup tanpa cleanup.
8. Menganggap `waitUntil` saja sudah menjamin audit durable; mengubah kegagalan sekunder menjadi pembatalan commit yang sudah sah.
9. Mempercayai action/ID/nominal/deskripsi dari model tanpa schema dan consent yang memperlihatkan dampak sebenarnya.
10. Menghapus fitur `update_transaction` hanya untuk menghindari validasi; perubahan scope/permission butuh persetujuan, bukan keputusan diam-diam.
11. Menganggap `localhost` prefix, symlink/path bebas, manifest berisi nama binding, atau PASS table count sebagai proof keselamatan.
12. Melonggarkan checksum runtime/SQL/backup/arsip atau menormalkan seluruh payload untuk menutupi byte mismatch.
13. Membuat restore parsial ke ledger hidup lalu menyebutnya atomik; mengambil lock/lease tanpa recovery yang benar.
14. Menggunakan `wrangler pages deploy --dry-run`: flag tersebut tidak didukung pada CLI yang diamati. Validasi Pages melalui mekanisme yang memang tersedia, lalu staging berizin.
15. Menambah Redis/queue framework/microservices/generic abstraction, rewrite UI, atau format massal sebagai bagian bug fix.
16. Mengedit `.env`, `.wrangler/state`, backup, browser profile, atau file pengguna untuk cleanup fixture.
17. Mengganti Node range/menyalahkan environment tanpa evidence; CI hijau lama bukan CI kandidat baru.
18. Menjadikan 0 regex `any`, jumlah baris, coverage persen, bundle total, atau satu screenshot sebagai sertifikat clean code/performa.
19. Mengirim secret melalui argv/log/fixture atau melakukan panggilan provider berbayar tanpa approval dan batas biaya.
20. Menandai operator/hardware task `Completed` hanya berdasarkan simulasi, atau menghilangkannya dari scope agar keseluruhan terlihat selesai.

### 4.4 Rollback dan stop conditions

| Kelas                       | Jalur rollback yang harus disiapkan                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kode/UI murni               | Revert commit task melalui proses release berizin; pertahankan format data yang sudah terlanjur ditulis                                                 |
| Constraint/migrasi additive | Preflight duplicate/orphan lebih dahulu; rehearsal up/rollback pada fixture dan staging; rollback tidak menghapus ledger/receipt                        |
| Writer/format baru          | Reader kanonik tetap membaca data historis; candidate lama tidak boleh dipromosikan bila tidak dapat membaca data baru                                  |
| Archive/restore/wipe        | Snapshot dan checksum terverifikasi; job/lease/checkpoint dapat direkonsiliasi; tidak menghapus R2 sumber atau ledger untuk “membersihkan” konflik      |
| Data produksi               | Backup seluruh shard terdampak; daftar exact IDs dan alasan bisnis; repair/rollback berizin dengan laporan before/after                                 |
| Deploy/secret               | Artifact terakhir yang terverifikasi dan prosedur rollback/rotasi teruji; tidak mengembalikan binary lama yang tidak kompatibel dengan schema/data baru |

Hentikan **mutasi berisiko**, bukan seluruh pekerjaan aman, bila uang/stok/paritas tidak cocok, cabang bocor, backup/readback gagal, schema aktual tidak diketahui, checksum berbeda tanpa penjelasan, cleanup keluar dari owned root, atau kandidat CI merah. Catat blocker spesifik dan lanjutkan task lain yang dapat dikerjakan.

## 5. Urutan fase dan exit criteria

Dependency pada tracker adalah dependency teknis; phase order adalah urutan default. Investigasi dependency-ready dan slice independen boleh berjalan bersama dengan aturan ownership.

| Fase                             | Task                       | Exit criteria                                                                                                       |
| -------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| F0: baseline dan browser merah   | AUD-001..004               | Runtime pin/isolation terbukti; tiga root cause dan regresi nyata; suite Antrean tidak lagi merah                   |
| F1: integritas bisnis            | AUD-005..014               | Write uang/stok/sesi atomik/tervalidasi; metadata tidak mengubah saldo; report gagal secara benar; reprint snapshot |
| F2: security dan tenancy         | AUD-015..020               | Constraint credential, public login, observability, role, cache memenuhi boundary cabang                            |
| F3: AI                           | AUD-030..038               | Financial parity, accounting category, validated consent, date/session scope, gateway deadline/error contract       |
| F4: archive dan recovery         | AUD-039..048               | Format versioned, export/download/restore bounded, backup guard/drill/rollback/UAT fail-closed                      |
| F5: UI dan realtime              | AUD-021..029, AUD-049..051 | Lifecycle/focus/keyboard/WITA/branch benar; post-commit tidak menggantung; compiled realtime dan retention terbukti |
| F6: maintainability dan evidence | AUD-052..057               | Advisory diperbaiki; refactor tanpa drift; gate bermakna; docs/byte provenance/performance terukur                  |
| F7: operasi nyata                | AUD-058..062               | Inventaris/repair data, recovery/migration, push/AI provider/printer memiliki bukti berizin                         |
| F8: release dan sign-off         | AUD-063                    | Semua ID selesai; satu kandidat CI/artifact/staging/production terverifikasi; tidak ada blocker                     |

Refactor besar AUD-053 menunggu bug fix relevan dan baseline browser stabil. AUD-050 boleh ditarik lebih awal bila root cause Antrean memang membutuhkan konfigurasi/runtime realtime; jangan membuat workaround di UI untuk menutupi akar tersebut.

## 6. Tracker kanonik

Arti status mengikuti roadmap lama:

- `Pending`: belum dimulai/bukti belum tersedia.
- `In progress`: owner sudah claim; implementasi/verifikasi belum selesai.
- `Blocked`: prerequisite/akses/approval belum tersedia; tulis apa yang kurang dan cara membuka blocker.
- `Passed local`: code/acceptance/gate lokal selesai, CI/reviewer/operator yang diperlukan belum lengkap.
- `Completed`: seluruh DoD selesai. Checklist hanya `[x]` untuk status ini.

Kelas bukti: `R` = reproduksi runtime; `S` = temuan sumber/risiko belum dieksekusi; `G` = gate gagal; `O` = batas kesiapan operasional; `M` = maintainability/evidence. Kelas ini bukan severity dan tidak berubah menjadi `R` tanpa bukti.

Kolom `Deps` memakai nomor AUD; `ALL` berarti seluruh AUD lain. `Owner` harus nama/session aktual setelah claim, bukan role fiktif. `Evidence` diisi rujukan catatan eksekusi/CI/artifact yang aman. Jika perbaikan statis tidak diperlukan, disposition tetap ditulis di evidence, bukan item dihapus.

| Done | ID                  | Fase | Prioritas | Kelas | Pekerjaan                                        | Deps                                                                                     | Status       | Owner    | Evidence                    |
| ---- | ------------------- | ---- | --------- | ----- | ------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------ | -------- | --------------------------- |
| [ ]  | [AUD-001](#aud-001) | F0   | P1        | O     | Toolchain, isolation, ECONNRESET dan cleanup     | -                                                                                        | Passed local | opencode | §12 AUD-001 2026-10-05      |
| [ ]  | [AUD-002](#aud-002) | F0   | P1        | G     | Timeout fan-out notifikasi Antrean               | 001                                                                                      | Passed local | opencode | §12 AUD-002..004 2026-10-05 |
| [ ]  | [AUD-003](#aud-003) | F0   | P1        | G     | Switch suara hilang setelah reload               | 001                                                                                      | Passed local | opencode | §12 AUD-002..004 2026-10-05 |
| [ ]  | [AUD-004](#aud-004) | F0   | P1        | G     | Relogin tidak menyelesaikan navigasi             | 001                                                                                      | Passed local | opencode | §12 AUD-002..004 2026-10-05 |
| [ ]  | [AUD-005](#aud-005) | F1   | P1        | R     | Validasi uang dan domain ledger manual           | 001                                                                                      | Passed local | opencode | §12 AUD-005 2026-10-05      |
| [ ]  | [AUD-006](#aud-006) | F1   | P1        | R     | Kulakan atomik dan idempoten                     | 005, 009                                                                                 | Passed local | opencode | §12 AUD-006 2026-10-05      |
| [ ]  | [AUD-007](#aud-007) | F1   | P1        | R     | Konversi preset kulakan terakhir                 | 001                                                                                      | Passed local | opencode | §12 AUD-007 2026-10-05      |
| [ ]  | [AUD-008](#aud-008) | F1   | P1        | S     | Metadata menu tidak menimpa stok                 | 001                                                                                      | Passed local | opencode | §12 AUD-008 2026-10-05      |
| [ ]  | [AUD-009](#aud-009) | F1   | P1        | S     | Saldo bahan lewat ledger/reconciliation          | 001                                                                                      | Passed local | opencode | §12 AUD-009 2026-10-05      |
| [ ]  | [AUD-010](#aud-010) | F1   | P1        | R     | Satu sesi aktif per cabang                       | 005                                                                                      | Passed local | pi-agent | §12 AUD-010 2026-10-06      |
| [ ]  | [AUD-011](#aud-011) | F1   | P1        | S     | PATCH sesi hanya transisi close valid            | 010                                                                                      | Passed local | pi-agent | §12 AUD-011 2026-10-06      |
| [ ]  | [AUD-012](#aud-012) | F1   | P2        | S     | Void kalah CAS menjadi 409 tanpa side effect     | 001                                                                                      | Passed local | opencode | §12 AUD-012 2026-10-06      |
| [ ]  | [AUD-013](#aud-013) | F1   | P1        | S     | Error query kas arsip tidak jadi laporan kosong  | 001                                                                                      | Passed local | pi-agent | §12 AUD-013 2026-10-06      |
| [ ]  | [AUD-014](#aud-014) | F1   | P1        | S     | Cetak ulang memakai receipt snapshot             | 001                                                                                      | Passed local | pi-agent | §12 AUD-014 2026-10-06      |
| [ ]  | [AUD-015](#aud-015) | F2   | P2        | S     | Unique username per cabang                       | 001                                                                                      | Passed local | opencode | §12 AUD-015 2026-10-06      |
| [ ]  | [AUD-016](#aud-016) | F2   | P2        | S     | Public credential failure seragam                | 001                                                                                      | Passed local | opencode | §12 AUD-016 2026-10-06      |
| [ ]  | [AUD-017](#aud-017) | F2   | P2        | S     | Anonymous telemetry tidak memilih tenant         | 001                                                                                      | Passed local | opencode | §12 AUD-017 2026-10-06      |
| [ ]  | [AUD-018](#aud-018) | F2   | P2        | S     | Tenant scope diagnostik global                   | 017                                                                                      | Passed local | opencode | §12 AUD-018 2026-10-06      |
| [ ]  | [AUD-019](#aud-019) | F2   | P2        | S     | Kontrak role valid/unknown konsisten             | 001                                                                                      | Passed local | opencode | §12 AUD-019 2026-10-06      |
| [ ]  | [AUD-020](#aud-020) | F2   | P1        | S     | Cache/fetch terikat branch yang ditangkap        | 001                                                                                      | Passed local | opencode | §12 AUD-020 2026-10-06      |
| [ ]  | [AUD-021](#aud-021) | F5   | P2        | S     | Generation guard load stok                       | 020                                                                                      | Passed local | opencode | §12 AUD-021 2026-10-06      |
| [ ]  | [AUD-022](#aud-022) | F5   | P2        | S     | Teardown stok sebelum async mount selesai        | 021                                                                                      | Passed local | opencode | §12 AUD-022 2026-10-06      |
| [ ]  | [AUD-023](#aud-023) | F5   | P2        | S     | Fokus AppModal dan utility kanonik               | 001                                                                                      | Passed local | opencode | §12 AUD-023 2026-10-06      |
| [ ]  | [AUD-024](#aud-024) | F5   | P2        | S     | Dialog stok bernama dan keyboard-safe            | 023                                                                                      | Passed local | opencode | §12 AUD-024 2026-10-06      |
| [ ]  | [AUD-025](#aud-025) | F5   | P2        | S     | Enter modalSheet tidak dismiss form              | 023                                                                                      | Passed local | opencode | §12 AUD-025 2026-10-06      |
| [ ]  | [AUD-026](#aud-026) | F5   | P1        | S     | Default tanggal/jam Catat dalam WITA             | 001                                                                                      | Passed local | opencode | §12 AUD-026 2026-10-06      |
| [ ]  | [AUD-027](#aud-027) | F5   | P2        | S     | Aktivitas Catat: lima terbaru hari WITA          | 026                                                                                      | Passed local | opencode | §12 AUD-027 2026-10-06      |
| [ ]  | [AUD-028](#aud-028) | F5   | P2        | S     | Tax listener laporan tidak menumpuk              | 001                                                                                      | Passed local | opencode | §12 AUD-028 2026-10-06      |
| [ ]  | [AUD-029](#aud-029) | F5   | P2        | S     | Label dashboard cabang aktual                    | 020                                                                                      | Passed local | opencode | §12 AUD-029 2026-10-06      |
| [ ]  | [AUD-030](#aud-030) | F3   | P1        | R     | AI mencakup agregat aktif dan arsip              | 013                                                                                      | Passed local | opencode | §12 AUD-030 2026-10-06      |
| [ ]  | [AUD-031](#aud-031) | F3   | P1        | R     | Pajak AI: omzet usaha, YTD, lintas tahun         | 030                                                                                      | Passed local | opencode | §12 AUD-031 2026-10-06      |
| [ ]  | [AUD-032](#aud-032) | F3   | P1        | S     | Modal/prive bukan pendapatan/beban usaha         | 005, 031                                                                                 | Passed local | opencode | §12 AUD-032 2026-10-06      |
| [ ]  | [AUD-033](#aud-033) | F3   | P1        | S     | Schema rekomendasi dan consent mutation          | 005, 032                                                                                 | Passed local | opencode | §12 AUD-033 2026-10-06      |
| [ ]  | [AUD-034](#aud-034) | F3   | P2        | S     | Deadline body/stream AI dan client abort         | 001                                                                                      | Passed local | opencode | §12 AUD-034 2026-10-06      |
| [ ]  | [AUD-035](#aud-035) | F3   | P2        | S     | HPP melalui gateway dan rate limit               | 034                                                                                      | Passed local | opencode | §12 AUD-035 2026-10-06      |
| [ ]  | [AUD-036](#aud-036) | F3   | P2        | S     | Tanggal eksplisit masa depan ditolak             | 001                                                                                      | Passed local | opencode | §12 AUD-036 2026-10-06      |
| [ ]  | [AUD-037](#aud-037) | F3   | P2        | S     | Error AI publik tidak membocorkan internal       | 034                                                                                      | Passed local | opencode | §12 AUD-037 2026-10-06      |
| [ ]  | [AUD-038](#aud-038) | F3   | P2        | S     | Sesi AI sesuai periode historis                  | 010, 030                                                                                 | Passed local | opencode | §12 AUD-038 2026-10-06      |
| [ ]  | [AUD-039](#aud-039) | F4   | P1        | S     | Archive bounded/resumable/byte-safe              | 041                                                                                      | Passed local | opencode | §12 AUD-039 2026-10-06      |
| [ ]  | [AUD-040](#aud-040) | F4   | P1        | S     | Resume archive benar-benar mengunduh             | 039                                                                                      | Passed local | opencode | §12 AUD-040 2026-10-07      |
| [ ]  | [AUD-041](#aud-041) | F4   | P1        | S     | Versioned snapshot dan field restore eksplisit   | 001                                                                                      | Passed local | opencode | §12 AUD-041 2026-10-06      |
| [ ]  | [AUD-042](#aud-042) | F4   | P1        | R     | Preflight semua field bisnis restore             | 041                                                                                      | Passed local | opencode | §12 AUD-042 2026-10-07      |
| [ ]  | [AUD-043](#aud-043) | F4   | P1        | S     | Restore staging bounded dan finalisasi atomik    | 039, 042                                                                                 | Passed local | opencode | §12 AUD-043 2026-10-07      |
| [ ]  | [AUD-044](#aud-044) | F4   | P0        | R     | Wipe memerlukan backup COMPLETE nyata            | 001                                                                                      | Passed local | opencode | §12 AUD-044 2026-10-07      |
| [ ]  | [AUD-045](#aud-045) | F4   | P0        | S     | Wipe tidak terpecah menjadi partial state        | 044                                                                                      | Passed local | opencode | §12 AUD-045 2026-10-07      |
| [ ]  | [AUD-046](#aud-046) | F4   | P1        | R     | Restore drill membuktikan POS/integrity/parity   | 042                                                                                      | Passed local | opencode | §12 AUD-046 2026-10-07      |
| [ ]  | [AUD-047](#aud-047) | F4   | P2        | R     | CLI rollback/runbook/backup eksternal konsisten  | 044, 046                                                                                 | Passed local | opencode | §12 AUD-047 2026-10-07      |
| [ ]  | [AUD-048](#aud-048) | F4   | P2        | R     | UAT exact loopback sebelum load credential       | 001                                                                                      | Passed local | opencode | §12 AUD-048 2026-10-07      |
| [ ]  | [AUD-049](#aud-049) | F5   | P2        | S     | Post-commit effects bounded, audit durable       | 001                                                                                      | Passed local | opencode | §12 AUD-049 2026-10-07      |
| [ ]  | [AUD-050](#aud-050) | F5   | P1        | O     | Binding realtime dan compiled artifact auth      | 019, 049                                                                                 | Passed local | opencode | §12 AUD-050 2026-10-07      |
| [ ]  | [AUD-051](#aud-051) | F5   | P2        | S     | Retensi error/notifikasi dan drain audit outbox  | 017, 049                                                                                 | Passed local | opencode | §12 AUD-051 2026-10-07      |
| [ ]  | [AUD-052](#aud-052) | F6   | P2        | O     | Patch tiga advisory dependensi                   | 001                                                                                      | Passed local | opencode | §12 AUD-052 2026-10-07      |
| [ ]  | [AUD-053](#aud-053) | F6   | P2        | M     | Pisahkan tanggung jawab halaman/route besar      | 006, 007, 008, 009, 013, 014, 020, 022, 024, 025, 028, 030, 033, 035, 039, 043, 049, 054 | Blocked      | opencode | §12 AUD-053 2026-10-07      |
| [ ]  | [AUD-054](#aud-054) | F6   | P2        | M     | Tes/gate membuktikan behavior, bukan wiring      | 001                                                                                      | Passed local | opencode | §12 AUD-054 2026-10-07      |
| [ ]  | [AUD-055](#aud-055) | F6   | P2        | M     | Docs semantik sinkron dengan implementasi        | 001                                                                                      | Passed local | opencode | §12 AUD-055 2026-10-07      |
| [ ]  | [AUD-056](#aud-056) | F6   | P2        | O     | Artifact metadata portable tanpa melemahkan hash | 001                                                                                      | Passed local | opencode | §12 AUD-056 2026-10-07      |
| [ ]  | [AUD-057](#aud-057) | F6   | P2        | O     | Budget performa pada runtime nyata               | 039, 043, 049, 050, 052, 053, 054                                                        | Passed local | opencode | §12 AUD-057 2026-10-07      |
| [ ]  | [AUD-058](#aud-058) | F7   | P1        | O     | Inventaris/rekonsiliasi data terdampak aktual    | 005, 008, 009, 010, 011, 013, 015, 031, 032, 041, 042, 043, 044, 045, 046, 047           | Blocked      | opencode | §12 AUD-058..062 2026-10-07 |
| [ ]  | [AUD-059](#aud-059) | F7   | P0        | O     | Backup/restore/migrasi/rollback shard nyata      | 058, 046, 047, 056, 057                                                                  | Blocked      | opencode | §12 AUD-058..062 2026-10-07 |
| [ ]  | [AUD-060](#aud-060) | F7   | P1        | O     | Web Push dan realtime perangkat nyata            | 002, 003, 004, 050, 051                                                                  | Blocked      | opencode | §12 AUD-058..062 2026-10-07 |
| [ ]  | [AUD-061](#aud-061) | F7   | P1        | O     | AI provider nyata dengan budget/approval         | 030, 031, 032, 033, 034, 035, 036, 037, 038                                              | Blocked      | opencode | §12 AUD-058..062 2026-10-07 |
| [ ]  | [AUD-062](#aud-062) | F7   | P1        | O     | Printer fisik dan seluruh jalur reprint          | 014, 023, 024, 025                                                                       | Blocked      | opencode | §12 AUD-058..062 2026-10-07 |
| [ ]  | [AUD-063](#aud-063) | F8   | P0        | O     | Final release gate dan sign-off                  | ALL                                                                                      | Pending      | —        | —                           |

## 7. Kartu kerja lengkap

Semua kartu mewarisi DoD, gate profile, rollback, dan larangan global. `Target` adalah file/module yang sudah ditemukan; helper/test baru hanya dibuat bila belum ada tempat yang sesuai, bukan scaffold. Tambahkan test domain baru ke script, `test:unit`, dan step CI sesuai aturan repo; smoke operasional yang membutuhkan artifact berjalan sesudah build, jangan menciptakan dependency cycle CI.

### AUD-001

**Toolchain, fixture isolation, dan klasifikasi ECONNRESET.** Target: `.node-version`, `package.json`, `scripts/run-playwright-local.mjs`, `scripts/e2e-environment*`, CI.

- Pakai Node/pnpm pin sebagai baseline yang sama dengan CI. Catat dukungan runtime yang benar-benar dibuktikan; `engines >=22` bukan bukti setiap major baru sudah diuji.
- Klasifikasikan ECONNRESET probe audit: application, Vite/Node, atau launcher sementara. Jangan menambah global swallow-error pada app untuk memperbaiki script audit yang sudah dibuang.
- **DoD:** baseline/cleanup lulus pada Windows dan Ubuntu; server/browser/workerd berhenti pada success, assertion failure, startup failure, dan interruption. Tidak ada perubahan/deletion state dev. Jika fault aplikasi/runtime tetap berlaku pada versi yang dinyatakan didukung, root cause dan fix teruji, bukan sekadar downgrade.
- **Verifikasi:** G-STATIC, G-OPS; launch actual runner dan amati PID/output/state dengan failure injection.

### AUD-002

**Fan-out notifikasi Antrean timeout.** Target: `e2e/antrean-notifications.spec.ts:129`, notification state/service/server delivery.

- Pakai trace baseline untuk menemukan wait yang macet; pisahkan pembayaran sukses, event persistence, fan-out, origin exclusion, delivery, dan visibility acknowledgment.
- Uji recipient cabang sama, bukan origin, cabang lain tidak menerima, queue terlihat hanya membisukan profilnya sendiri.
- **DoD:** skenario asli selesai tanpa assertion turun/retry buta; event/cursor/state nyata membuktikan setiap penerima. Cleanup tidak menutupi assertion pertama dengan `context.close` error.
- **Verifikasi:** G-NOTIFY, G-BROWSER; jika akar pada binding/compiled runtime, integrasikan AUD-050, bukan mock pengganti.

### AUD-003

**Switch suara hilang setelah reload.** Target: `e2e/antrean-notifications.spec.ts:237`, halaman pengaturan Antrean, preference store.

- Tentukan apakah hidrasi/navigation/profile load atau state preferensi yang gagal; elemen tidak ada bukan bukti nilainya kembali.
- Persist state berdasarkan identitas profil browser yang benar; pisahkan antar device dan pertahankan sinkronisasi tab profil yang sama.
- **DoD:** switch muncul/usable pada mobile width; toggle tersimpan setelah reload; tab sama konsisten dan device lain independen. Loading/error tidak menghilangkan kontrol tanpa state UI yang jelas.
- **Verifikasi:** G-NOTIFY, G-BROWSER, reload dan multi-tab/device nyata.

### AUD-004

**Relogin login-sukses tetapi navigasi belum selesai.** Target: `e2e/antrean-notifications.spec.ts:422`, login/session/layout/notification lifecycle.

- Telusuri login response, cookie/session, route transition, hydration, dan reset subscription pengguna lama.
- Profile browser tetap sama setelah relogin, tetapi user/session/cursor lama tidak boleh menghidupkan event historis atau mengotorisasi pengguna baru.
- **DoD:** login mencapai halaman tujuan; tidak ada suara historis/user lama; identity/cursor benar setelah logout-login. Tes auth biasa, role valid, expiry, dan navigation failure tetap kuat.
- **Verifikasi:** G-AUTH, G-NOTIFY, G-BROWSER.

### AUD-005

**Ledger manual menerima nominal/domain invalid.** Target: `api/buku-kas/+server.ts`, `bukuKasService.ts`, currency helpers, caller Catat/AI/offline.

- Validasi seluruh batch sebelum write: field wajib, nominal finite/nonnegative dalam rentang numerik aman policy kanonik, `tipe` in/out, kategori/sumber yang diizinkan, timestamp sesuai kontrak. Normalisasi rupiah dengan policy existing; bukan konversi garbage menjadi 0.
- Migrasikan caller dengan kontrak queue lama yang sah; perbedaan tipe yang benar-benar historis harus didecode eksplisit, bukan coercion bebas. Update/create tidak boleh bypass policy yang sama.
- **DoD:** `not-a-number`, nilai negatif, NaN/Infinity, arah invalid, dan baris invalid di akhir batch ditolak tanpa mutasi bisnis. `100000.123456` tidak tersimpan mentah; input valid/replay sah menghasilkan nominal kanonik. HPP 4 desimal tidak rusak.
- **Verifikasi:** G-AUTH, G-SQL, G-POS; HTTP nyata dan regresi boundary/whole-batch.

### AUD-006

**Kulakan: stock -> cash -> HPP tiga request terpisah.** Target: `stok/+page.svelte:598`, service/mutation bahan, buku kas, application purchase use case.

- Sediakan satu command pembelian branch-scoped; normalisasi quantity/unit/yield dan uang; commit movement, saldo, kas, serta purchase/HPP inputs dalam satu D1 atomic batch.
- Frontend memakai satu stable operation key dan immutable intent untuk retry ambigu; fingerprint berbeda ditolak. Ganti semua caller lama dan hapus jalur tiga-write.
- **DoD:** failure di setiap tahap meninggalkan seluruh state bisnis before; success mengubah seluruh state tepat sekali. Lost response + retry/concurrent double-submit tetap satu kulakan, satu kas, HPP benar. Mode ignored/monitored mengikuti stock policy, bukan bypass.
- **Verifikasi:** G-POS, G-SQL, G-BROWSER; reproduksi baseline 100 -> 1100 dengan kas 503 harus menjadi rollback utuh.

### AUD-007

**Preset jumlah beli terakhir salah unit.** Target: `stok/+page.svelte:1712`, unit conversion helpers.

- Pertahankan penyimpanan `jumlah_beli_terakhir` dalam base unit; convert ke purchase unit untuk label dan input dengan helper existing.
- Uji gram/kg, ml/liter, pcs/kemasan, fractional quantity, serta yield agar tidak terkonversi dua kali.
- **DoD:** tersimpan 1000 gram dengan unit beli kg menampilkan/mengisi 1 kg; resulting base 1000 gram, bukan 1.000.000. Label, input, preview, dan command purchase konsisten.
- **Verifikasi:** G-POS, G-BROWSER; amount dan stock outcome, bukan hanya teks tombol.

### AUD-008

**Metadata menu menimpa stok yang berubah saat form terbuka.** Target: `api/produk/save-atomic/+server.ts:184`, `menuState.svelte.ts`, menu CRUD.

- Pisahkan metadata/recipe edit dari quantity command. Form metadata tidak mengirim captured `stok`; existing row stock tidak di-update sebagai efek metadata.
- Bila user sengaja mengubah saldo, gunakan CAS/mutation ledger/reconciliation existing; atomic recipe replace tetap branch-scoped.
- **DoD:** open form -> checkout mengurangi stock -> save nama/harga/resep tidak mengembalikan saldo. Adjustment disengaja punya ledger dan conflict behavior benar; policy ignored juga benar.
- **Verifikasi:** G-SQL, G-POS, `test:menu-atomic`, browser menu concurrent checkout.

### AUD-009

**PATCH bahan mengubah saldo tanpa movement.** Target: `bahanService.ts:99`, `bahanHppState.svelte.ts`, ingredient edit pada halaman stok.

- Tolak balance field di metadata PATCH dan migrasikan kedua UI yang mengirim snapshot stock. Perubahan saldo eksplisit lewat atomic mutation/reconciliation.
- Pertahankan quantity awal/create yang memang didukung dengan invariant ledger existing; jangan membuat delta nol atau membulatkan quantity dengan money helper.
- **DoD:** concurrent checkout/manual mutation tidak hilang saat metadata save; direct PATCH saldo tidak bypass guard; actual adjustment menghasilkan satu movement dengan saldo setelah yang benar.
- **Verifikasi:** G-SQL, G-POS; mutation guards/reconciliation dan UI edit bahan.

### AUD-010

**Lebih dari satu sesi toko aktif.** Target: `sesiTokoService.ts:90`, schema/index sesi, route/session caller.

- Tambahkan invariant satu active session per `cabang_id` dengan partial unique constraint dan opening transition atomik; client check bukan otoritas.
- Preflight duplicates sebelum migration; jangan memilih/menghapus sesi lama otomatis. Berikan conflict yang dapat ditangani UI dan normalisasi opening cash.
- **DoD:** dua open serentak menghasilkan satu aktif; loser conflict tanpa mutasi; retry stabil. Closing tidak menyingkap sesi lama sebagai aktif. Cabang lain dapat membuka sesi sendiri; checkout selalu terikat sesi valid.
- **Verifikasi:** G-SQL, G-POS, handler concurrency SQLite + workerd; dua HTTP 200/dua aktif baseline tidak boleh berulang.

### AUD-011

**PATCH sesi mengizinkan rewrite histori/reactivation.** Target: `sesiTokoService.ts:118`, `api/sesi-toko`, opening/closing UI.

- Allowlist close fields, validasi closing cash/time, dan CAS active -> closed. Tolak perubahan `kas_awal`, `waktu_buka`, `created_at`, tenant/actor, dan reactivation pada jalur close.
- Preserve role yang memang boleh close; repeated close memiliki hasil konsisten, bukan menimpa snapshot penutupan.
- **DoD:** kasir/pemilik tidak dapat rewrite opening via PATCH; wrong session/branch/stale close ditolak; concurrent close satu transition; reconciliation closing benar.
- **Verifikasi:** G-AUTH, G-SQL, G-POS, browser buka/tutup toko.

### AUD-012

**Void kalah CAS menjadi raw constraint failure.** Target: `transaksiKasirService.ts:185`, migration `0031_stock_policy_checkout_ledger.sql`.

- Jadikan product movement `INSERT ... SELECT ... WHERE` terikat successful mutation token, seperti ingredient effects; jangan insert delta 0 bila claim kalah.
- Bedakan losing revision -> 409, duplicate void -> hasil idempoten, dan genuine DB fault -> error sebenarnya/rollback.
- **DoD:** payment-method edit menang race versus void menghasilkan 409 tanpa mutation/summary reversal palsu; duplicate void tidak restock dua kali. Constraint `delta <> 0` tetap aktif, bukan dihapus.
- **Verifikasi:** G-SQL, G-POS; interleaving deterministik actual batch dan failure path.

### AUD-013

**Query kas arsip gagal tetapi laporan sukses kurang data.** Target: `reportQueries.ts:108-125`, report route/client/error handling.

- Hapus fallback empty untuk mandatory financial archive input; propagasikan typed error sehingga UI tidak menampilkan total seolah valid.
- Shared canonical reader tetap mencakup aktif/arsip; kegagalan observability terpisah dari kegagalan data laporan.
- **DoD:** query archive gagal -> laporan gagal jelas, bukan 200 dengan pendapatan/laba/pajak palsu. Empty archive yang valid tetap sukses; mixed/fully archived periods dan no-double-count lulus.
- **Verifikasi:** G-SQL, report grouping/tax suites, G-BROWSER dengan DB failure injection.

### AUD-014

**History reprint mengabaikan receipt snapshot.** Target: `riwayatPrint.ts:18`, history DTO/query, receipt decoder/renderers/printer engine.

- Ambil/decode snapshot commit branch-scoped; satu authoritative receipt data untuk HTML/PDF/ESC-POS. Jangan query current catalog/settings untuk mengganti business snapshot.
- Legacy tanpa snapshot memakai historical fields yang memang tersimpan dan menyatakan data yang tidak tersedia; jangan mengarang cash/change. Aggregate arsip bukan satu receipt individual.
- **DoD:** total 10000/cash 12000/change 2000 dan detail/header snapshot tetap pada reprint setelah katalog/settings berubah dan setelah archive->restore. Semua history caller memakai jalur kanonik.
- **Verifikasi:** receipt-output, G-POS, G-BROWSER; printer fisik diselesaikan AUD-062.

### AUD-015

**Username uniqueness hanya check-before-update.** Target: `api/gantikeamanan/+server.ts:209`, schema `profil`, credential/seed writers, migrations.

- Enforce unique pada tenant column schema aktual dan username dengan normalization/collation yang sama dengan login. Jangan memakai nama kolom legacy migration sebagai asumsi schema sekarang.
- Preflight collisions; map genuine uniqueness conflict ke stable `USERNAME_EXISTS` contract. Update credential dan revoke session tetap atomik.
- **DoD:** dua akun satu cabang memilih username sama serentak: tepat satu berhasil; loser tidak berubah/password/session tidak setengah jalan. Username sama pada cabang berbeda tetap sesuai kontrak; duplicate legacy terdeteksi sebelum DDL.
- **Verifikasi:** G-AUTH, G-SQL, migration matrix dan Windows/Ubuntu concurrency.

### AUD-016

**Username enumeration melalui pesan login.** Target: `api/veriflogin/+server.ts:139-169`, login UI, audit reason.

- Satu public status/code/message untuk username tidak ada dan password salah; detailed reason hanya sink server yang aman.
- Pertahankan rate limit dan audit; jangan membocorkan key/password/username existence melalui field response tambahan.
- **DoD:** kedua kegagalan memiliki public contract yang sama; valid login, lock/rate limit dan role guard tetap benar. Jangan mengganti stable code tanpa review registry.
- **Verifikasi:** G-AUTH, HTTP negatif dan browser auth.

### AUD-017

**Anonymous query parameter memilih tenant telemetry.** Target: `hooks.server.ts:31`, `observability.ts`, metric/error repositories.

- Authenticated telemetry memakai session BranchContext. Anonymous telemetry ke sink non-tenant/redacted; jangan fallback ke binding tenant dari `?branch=`.
- Error path dan nonexistent API paths memakai aturan yang sama; logger tetap best-effort, tidak menjadi dependency commit.
- **DoD:** anonymous/forged branch request tidak menulis `request_metrics`/`error_events` cabang pilihan; authenticated request masuk cabangnya; logging outage tidak membatalkan write sah.
- **Verifikasi:** G-AUTH, G-SQL, request/error failure injection dan dua cabang satu shard.

### AUD-018

**Diagnostik memakai history isolate global tanpa tenant tag.** Target: `api/cache-metrics`, `api/security-events`, summary storage/read gates.

- Tentukan tenant/platform scope eksplisit. Owner melihat cabangnya saja; global summary hanya permission platform yang memang ditetapkan.
- Tag/filter event saat collect dan summarize; anonymous events tidak dicampur ke tenant pilihan. Hindari userId/endpoint data cabang lain dalam owner output.
- **DoD:** fixture dua cabang dalam isolate yang sama tidak bercampur pada owner response; admin global hanya sesuai permission. Same-branch stats tetap benar; restart isolate bukan proof persistence.
- **Verifikasi:** G-AUTH dan actual handler/isolate exercise, bukan array helper mock.

### AUD-019

**Role session/login response tidak memiliki satu policy untuk unknown role.** Target: `veriflogin`, `sessionStore`, `userRole.svelte.ts`, role types/auth guards.

- Satukan valid-role parsing; support `pemilik`, `kasir`, `admin` secara konsisten. Unknown role fail-closed, bukan silent authority/default yang berbeda antara login dan reload.
- Jangan “memperbaiki” admin dengan downgrade atau memberi admin permission bisnis baru. Live profile tetap otoritas role/revocation.
- **DoD:** ketiga role valid konsisten di login, `/api/session`, reload dan UI; unknown tidak mendapat session valid. Admin monitoring tetap 200, owner monitoring tetap 403, cashier protected mutation tetap ditolak.
- **Verifikasi:** G-AUTH, G-BROWSER; dokumentasikan false positive admin secara terpisah.

### AUD-020

**Captured cache key dengan fetch branch yang berubah.** Target: `productService.ts:39`, `dbGetStrict`, smart cache/IndexedDB/background refresh.

- Capture branch/request context sekali, pass ke fetch actual, dan reject/skip late commit setelah context berubah. Cache namespace dan request harus sama.
- Cover IDB await, background refresh, invalidate/clear, logout-login antar cabang; ikuti generation pattern existing POS, bukan helper kedua.
- **DoD:** response B tidak dapat tersimpan di key A; stale response tidak resurrect cache setelah invalidate; offline view tidak menampilkan branch lain. Signed POS catalog guard tetap aktif.
- **Verifikasi:** G-AUTH, store-state/offline suites, G-BROWSER dengan controlled delayed HTTP dan dua cabang same/cross shard.

### AUD-021

**Load bahan lama menimpa load baru.** Target: `stok/+page.svelte:215`, refresh/realtime callers.

- Gunakan captured branch dan generation/abort; hanya current request boleh commit data atau finalize loading.
- Initial, explicit refresh, realtime, dan purchase completion memakai flow yang sama.
- **DoD:** request lama selesai terakhir tidak mengganti data baru atau mematikan loading request aktif; failure stale tidak menampilkan error untuk view baru.
- **Verifikasi:** state transition regression dan G-BROWSER delayed response/order.

### AUD-022

**Async mount stok mendaftarkan listener sesudah destroy.** Target: `stok/+page.svelte:718`, window sale listener, refresh bus/realtime subscriptions.

- Setup/disposal synchronously owned; guard continuation setelah await; simpan named window handler dan batalkan in-flight/timer yang dimiliki component.
- Navigation tidak meninggalkan callbacks yang reload state halaman mati.
- **DoD:** navigate away saat load pending -> resolving tidak mendaftarkan subscription; mount/unmount berulang tidak menggandakan request; event setelah destroy tidak memanggil handler lama.
- **Verifikasi:** lifecycle regression dan G-BROWSER route transition + request observation.

### AUD-023

**AppModal belum move/trap/restore focus.** Target: `AppModal.svelte`, `modalSheet.svelte`, shared accessibility utility/callers.

- Gunakan satu focus policy yang sesuai Svelte lifecycle: accessible name, initial focus, Tab/Shift-Tab, Escape, background inert, restore trigger dan cleanup.
- Tangani no-focusable, disabled/removed trigger, nested dialog, portal, dan timer sebelum unmount; jangan menaruh browser global dalam domain/server.
- **DoD:** queue detail/logout confirmation benar pada keyboard dan accessibility tree; focus tidak keluar modal; setelah close kembali secara aman. Bukan hanya `aria-modal=true`.
- **Verifikasi:** a11y suite + G-BROWSER keyboard/visual nyata.

### AUD-024

**Tiga dialog stok tidak bernama/keyboard-safe.** Target: hand-written overlays pada `stok/+page.svelte:1118` dan dialog stok lainnya.

- Migrasikan semua dialog stok ke primitive yang sudah lulus AUD-023; unique heading IDs, label, focus restore, close/submit behavior.
- Preserve form validation, mobile scroll, click-outside policy, dan stock amount preview.
- **DoD:** setiap dialog dapat dibuka/diisi/dikirim/dibatalkan dengan keyboard; Escape bekerja dari input; background tidak dapat diaktifkan; tidak ada regression kulakan/preset.
- **Verifikasi:** G-BROWSER desktop/mobile, a11y dan POS/stok related E2E.

### AUD-025

**Enter bubble menutup modalSheet.** Target: `modalSheet.svelte:152-154`, custom item/cash payment callers.

- Hapus Enter sebagai backdrop-level dismiss; Escape/explicit close tetap sesuai kontrak. Enter mengaktifkan focused control/form saja.
- Terapkan focus/lifecycle policy kanonik tanpa double-close atau timer yang tertinggal.
- **DoD:** Enter di input custom item/payment tidak membuang form; submit tepat sekali; keyboard cancel, button activation dan swipe close tetap benar.
- **Verifikasi:** a11y, POS integrity dan G-BROWSER keyboard actual controls.

### AUD-026

**Default Catat memakai timezone perangkat lalu dianggap WITA.** Target: `catatState.svelte.ts:84-123`, WITA helpers.

- Date/time defaults berasal instant sekarang dalam WITA; conversion persisted UTC memakai helper yang sama dengan reporting.
- Test frozen instant dekat pergantian tanggal, perangkat UTC/WIB/WITA dan month/year boundary.
- **DoD:** tanpa edit manual, input pada perangkat berbeda menghasilkan instant UTC dan hari WITA yang sama; date/time explicit tetap tersimpan benar.
- **Verifikasi:** deterministic timezone regression, G-BROWSER emulated timezone dan actual saved row/report.

### AUD-027

**Aktivitas Hari Ini memuat lima row tertua.** Target: `catatState.svelte.ts:96`, buku-kas query options/UI card.

- Filter WITA today melalui UTC bounds dan order terbaru sebelum limit 5; deterministic tie-break sesuai schema.
- Query error bukan valid empty activity; branch/source filter tetap benar.
- **DoD:** lebih dari lima row hari ini plus row kemarin menghasilkan tepat lima terbaru hari ini dari cabang/source yang benar; boundary midnight, no rows, dan query failure punya state UI benar.
- **Verifikasi:** G-SQL, G-BROWSER Catat card vs actual ledger timestamps.

### AUD-028

**Tax-settings listener laporan menumpuk.** Target: `laporanState.svelte.ts:206`, initialize/filter/destroy callers.

- Named listener/disposer, remove before re-register and on destroy; clear scheduled refresh dan obsolete in-flight report ownership.
- Preserve forced refresh setelah perubahan tax yang nyata.
- **DoD:** setelah banyak date/filter changes, satu tax event memicu satu logical refresh; destroyed state tidak reload; newest report tetap otoritas.
- **Verifikasi:** store-state and G-BROWSER navigation/filter/event observation.

### AUD-029

**Dashboard selalu menulis Samarinda.** Target: `src/routes/+page.svelte:383`, canonical branch labels/profile context.

- Derive label dari authenticated branch context dan existing branch label map; jangan menganggap selected UI branch membuktikan otorisasi.
- Loading/session change tidak menggabungkan label branch baru dengan metrics lama.
- **DoD:** kelima branch label konsisten dengan data/session pada login/reload; branch switch tidak menampilkan label/data campuran.
- **Verifikasi:** G-AUTH, G-BROWSER branch sessions, termasuk aliases dalam satu D1 group.

### AUD-030

**AI report mengabaikan data arsip.** Target: `ai/reportData.ts:166`, `reportQueries.ts` dan summary repositories.

- Reuse canonical active + daily/product/manual archive aggregation, bukan salinan SQL bisnis kedua. `hasData` mencerminkan canonical valid data.
- Provider prompt/report DTO berasal fakta yang sama; source error tidak menjadi NO_DATA.
- **DoD:** archive-only Rp40000 terbaca; mixed/fully active/multi-year/no-data dan no-double-count sesuai laporan kanonik; branch lain tidak ikut.
- **Verifikasi:** G-AI, G-SQL, actual report functions/handler tanpa paid model.

### AUD-031

**Pajak AI memakai semua income dan YTD=0.** Target: `ai/reportData.ts:614`, canonical tax/report policy.

- Gunakan omzet usaha, config tax persisted, YTD before period dan segmentation tax year yang sama dengan canonical report.
- Modal/pinjaman tidak jadi omzet; current period tidak dihitung dua kali.
- **DoD:** fixture YTD600m + current100k menghasilkan 500, bukan 0; usaha400m + modal200m menghasilkan 0, bukan 500000. Threshold, lintas tahun/reset Januari, active/archive dan config scope sesuai canonical engine.
- **Verifikasi:** G-AI, report-tax/tax suites, G-SQL; numeric parity actual functions.

### AUD-032

**Auto-apply modal/prive dikategorikan usaha.** Target: transaction prompts, `autoApplyService.ts:408`, analysis DTO/category policy.

- Model mengusulkan accounting category yang divalidasi; direction saja tidak menentukan business revenue/expense.
- Gunakan kategori kanonik existing `pendapatan_usaha`, `beban_usaha`, `lainnya`; modal/prive/pinjaman yang non-operasional masuk jenis yang benar dan consent memperlihatkannya.
- **DoD:** setor modal mengubah cashflow tetapi tidak taxable turnover; prive bukan beban usaha; sale/operating expense tetap benar. Ambiguity meminta konfirmasi eksplisit, bukan silent default.
- **Verifikasi:** G-AI, G-POS, apply -> real ledger -> canonical/AI report parity.

### AUD-033

**Rekomendasi model dapat membawa mutation tersembunyi.** Target: `aiAnalysisService.ts:117`, `autoApplyService`, recommendation modal/types/server mutation boundary.

- Runtime schema discriminated action + field allowlist + amount/date/category validation; ID/branch/immutable fields tidak menjadi otoritas dari model.
- Consent berasal validated payload: action, target, nilai before/after, category, date dan dampak. Pertahankan intended create/update feature dengan role/branch/confirmation/CAS, jangan menghapus update sebagai jalan pintas.
- **DoD:** malformed/unknown action, mismatch visible title vs payload, foreign/stale target, negative/nonfinite amount dan prompt-injected data tidak mutate. Valid confirmed actions bekerja sekali; cancel/context change tidak apply; retry identity mengikuti fingerprint existing.
- **Verifikasi:** G-AI, G-AUTH, G-POS, G-BROWSER confirmation and actual ledger effects.

### AUD-034

**Timeout AI hanya headers, bukan body/lifetime.** Target: `aiGateway.ts:254`, stream route/read loops, nonstream JSON body handling.

- Deadline mencakup connection + body parsing + stream; apply total/idle policy dan propagate client disconnect ke upstream abort/reader cancel.
- Dispose timer/listener pada success/error/cancel; retry/fallback hanya sesuai error semantics dan budget, bukan mengulang stream yang sudah menghasilkan output sembarangan.
- **DoD:** headers200+body stalled, slow trickle, malformed/truncated JSON/SSE, provider error dan client disconnect terminate dengan bounded resources/public contract. Fallback sah tetap bekerja; key tidak masuk log/error.
- **Verifikasi:** G-AI actual fetch/ReadableStream failure injection, route streaming smoke tanpa paid provider.

### AUD-035

**HPP parse bypass gateway/deadline/rate limit.** Target: `api/hpp/parse/+server.ts:10`, AI gateway/provider adapter.

- Semua provider request lewat gateway kanonik; owner/session/branch, budget, per-user HPP rate policy dan malformed response validation diterapkan sebelum mutation/response.
- Delete direct provider fetch path; preserve HPP unit/quantity/yield and four-decimal contract.
- **DoD:** rate limit menolak sebelum upstream; timeout/malformed/upstream error memiliki safe response; valid parse dan unauthorized/wrong branch cases benar. Tidak ada call gratis/berbayar tersembunyi dalam unit tests.
- **Verifikasi:** G-AI, G-AUTH, HPP UI/HTTP smoke dengan controlled upstream.

### AUD-036

**Explicit date masa depan dalam tahun yang sama diterima.** Target: `aiPeriod.ts:89`, other period resolvers/use case.

- Bandingkan assembled valid day dengan frozen today WITA pada semua jalur explicit/range/month; invalid calendar/leap date tidak boleh rollover diam-diam.
- Masa depan tidak diklasifikasikan sebagai historical NO_DATA; gunakan existing typed period error/clarification contract.
- **DoD:** before 31 Desember 2026, request tanggal itu ditolak/diklarifikasi secara benar tanpa SQL/model historical query. Hari ini, kemarin, leap day, tahun/bulan lintas batas memiliki perilaku konsisten.
- **Verifikasi:** `test:ai-period`, G-AI actual use case with frozen now.

### AUD-037

**Raw Error.message AI masuk public response.** Target: `api/aichat/+server.ts:399`, typed gateway/use-case errors, error registry/logging.

- Fixed public Indonesian message/code per error class; diagnostic server hanya setelah redaction. Untrusted provider error bukan teks publik.
- Preserve retryability/status semantics; jangan menyamakan timeout/validation/auth secara sembarangan.
- **DoD:** injected SQL/schema/endpoint/credential-like errors tidak muncul di JSON/SSE/log aman; existing public codes tetap atau perubahan melalui compatibility review. Legit typed client errors tetap dapat ditangani UI.
- **Verifikasi:** G-AI, error-code suite, actual route negative response.

### AUD-038

**Sesi Toko Terkini di report historis berasal hari sekarang.** Target: `ai/reportData.ts:490`, canonical session/report query.

- Filter latest session pada requested WITA period, atau exclude field bila tidak ada sesi periode itu. Live context, bila memang diperlukan, terpisah berlabel tanggal dan tidak masuk kesimpulan periode.
- Match opening/closing interval semantics existing; tidak menghilangkan historical shift yang melintas midnight.
- **DoD:** request lama dengan sesi aktif hari ini tidak memasukkan opening cash/status hari ini sebagai data lama; shift summaries dan latest relevant session konsisten.
- **Verifikasi:** G-AI, G-SQL frozen historical/current session fixture.

### AUD-039

**Archive whole-history buffering tanpa batas.** Target: `archiveUseCase.ts:391`, `archiveService.ts`, R2 adapter, archive job/item schema.

- Pilih bounded job berdasarkan row/detail/encoded-byte/SQL budgets yang terukur; cursor/lease renewal dan manifest exact IDs/revisions persisten. Banyak job harus dapat menuntaskan cutoff yang diminta.
- Snapshot streamed/paged ke R2, verified readback sebelum delete; completion response metadata saja. Finalisasi tiap bounded batch atomik: conflict -> seluruh batch tersebut gagal, ledger utuh.
- **DoD:** large dataset menuntaskan semua eligible rows melalui resume tanpa OOM/unbounded arrays; crashes pada claim/upload/readback/finalize dan competing edit/lease takeover tidak kehilangan/duplikasi data. Active/archive totals dan receipt/provenance tetap parity.
- **Verifikasi:** G-ARCHIVE, G-SQL, G-PERF, G-BROWSER; real R2 failure/readback pada staging berizin. Jangan menurunkan atomicity kontrak agar chunking mudah.

### AUD-040

**Resume sukses tetapi tidak ada download yang dijanjikan.** Target: `api/archive/+server.ts:58`, owner archive page, authenticated object download boundary.

- Fresh/resumed completion memakai metadata dan dedicated branch-authorized streaming download yang sama. Object lookup dari verified job identity, bukan arbitrary R2 key/public bucket.
- UI membedakan archived, download started, dan download failed; retry download tidak mengarsip/hapus data lagi.
- **DoD:** response hilang setelah finalize -> retry mengunduh archive sebenarnya dengan filename/checksum benar; branch/role salah ditolak; failed download tidak diberi label downloaded.
- **Verifikasi:** G-ARCHIVE, G-AUTH, G-BROWSER actual downloaded bytes + response-loss injection.

### AUD-041

**Schema v2 meluas tanpa membedakan decoder lama.** Target: `buildArchiveSnapshot`, archive types, `restore-archive-lib`, decoder/fixture docs.

- Emit versi baru untuk kontrak expanded/segmented yang benar-benar berubah; field lists eksplisit, bukan `SELECT *` sebagai schema definition.
- Decoder v1/v2 existing mendapat required/defaulted field map yang terdokumentasi; new writer hanya versi kanonik baru. Unsupported newer version fail-before-apply, tidak silent omit preparation/provenance/order number/receipt fields.
- **DoD:** older decoder menolak versi baru; supported legacy archives tetap restorabel tanpa mengarang histori; current archive round-trip semua business/stock/order fields dan counts/checksum benar.
- **Verifikasi:** G-ARCHIVE, G-SQL, old/current consumer compatibility fixtures, migration/counter/preparation regressions.

### AUD-042

**Restore preflight tidak memvalidasi semua field bisnis.** Target: `restore-archive-lib.mjs:80`, BK/TK field schemas and SQL builder.

- Validate presence/types/enums/timestamps/finite money/qty, branch/ID references, snapshot totals/receipt, counts and cross-field invariants seluruh archive sebelum generate/apply.
- Guard mutation revision/conflict atomik; valid numeric values mengikuti money/HPP precision contract tanpa mengubah snapshot historis untuk cocok dengan katalog.
- **DoD:** `not-a-date`, `credit`, missing/invalid fields, bad counts/checksum, cross-branch detail, duplicate/conflicting IDs, invalid receipt dan bad final row menghasilkan zero live-ledger changes. Rp100000 valid terlihat benar di laporan setelah restore.
- **Verifikasi:** G-ARCHIVE, G-SQL; actual CLI/library->database->report; null-prototype SQLite rows dinormalisasi hanya untuk comparison.

### AUD-043

**Restore memakai ribuan subprocess dan satu import tak berbatas.** Target: `restore-archive.mjs:190`, restore job/staging/finalization repositories.

- Stage/validate bounded rows dengan stable archive digest/job/checkpoints dan batched target reads; tidak satu Wrangler process untuk tiap 50 row tanpa resume.
- Live ledger tidak berubah sampai full preflight selesai; final apply menggunakan guarded atomic set-based batch sesuai D1 budget. Crash/resume idempoten; source archive tetap ada.
- **DoD:** restore largest expected/current legacy archive pada runtime target selesai dalam budget, receipt/counter/preparation/provenance/parity utuh; late conflict tetap zero live changes. Kalau atomic budget tidak cukup, task `Blocked` untuk keputusan ADR/owner, bukan silent partial apply atau fixture dikecilkan.
- **Verifikasi:** G-ARCHIVE, G-SQL, G-PERF; Windows/Ubuntu CLI, interruption/resume, workerd dan authorized staging with real legacy size.

### AUD-044

**Wipe menerima manifest tanpa backup nyata.** Target: `wipe-branch-history.mjs:80`, `d1-backup.mjs`, manifest/file verifier.

- Reuse satu verifier COMPLETE/status/target binding+branch/schema/file existence/size/SHA/readability; resolve safe external backup root dan reject traversal/symlink escape/stale identity.
- Seluruh preflight selesai sebelum mutation pertama; confirmation target eksplisit. Name binding saja tidak pernah cukup.
- **DoD:** fabricated manifest baseline dengan actualBackupFiles0 ditolak sebelum delete; partial/missing/tampered/wrong-target backup juga ditolak. Backup asli yang berhasil drill dapat authorize wipe hanya dengan explicit apply/confirmation.
- **Verifikasi:** G-OPS, G-SQL; actual wipe function + failure injection, no remote mutation pada automated tests.

### AUD-045

**Wipe multi-call dapat menyisakan histori parsial.** Target: `wipe-branch-history.mjs`, guarded deletion and summary/order ledgers.

- Setelah full preflight, satu guarded atomic bounded branch operation untuk seluruh business tables yang termasuk wipe; bila perlu staged job, live deletion tetap memenuhi declared atomic batch contract.
- Validate table/branch dependency, archive lease, counts and aggregates; jangan meninggalkan details/counters/summaries yang berpura-pura utuh.
- **DoD:** failure statement tengah/akhir -> semua before state; cabang sibling dalam shard sama tidak berubah; rerun/interrupt behavior jelas dan target verification kuat. Tidak memakai beberapa remote calls tanpa recovery contract.
- **Verifikasi:** G-OPS, G-SQL SQLite/workerd concurrency and failure injection; production execution hanya oleh operator berizin.

### AUD-046

**Restore drill PASS untuk partial dump/orphan.** Target: `restore-drill-local.mjs`, full backup/restore helpers/tests.

- Require actual POS schema/version/columns + expected manifest counts; run integrity/quick checks, foreign_key_check, domain orphan checks dan financial parity/counters/receipt checks.
- SQLite drill ditambah D1/workerd path; FK-only bukan pengganti domain checks pada tabel yang belum punya FK.
- **DoD:** toy one-table/incomplete POS SQL dan orphan fixture gagal nonzero; complete backup benar PASS dengan counts/parity. Cleanup selalu milik drill; report tidak menyatakan D1 lulus bila hanya SQLite yang diuji.
- **Verifikasi:** G-OPS, G-ARCHIVE, G-SQL with fresh migrated POS database.

### AUD-047

**Runbook rollback flag salah dan backup discovery tidak konsisten.** Target: `rollback-migration.mjs`, `OPERATOR-RUNBOOK.md:86`, restore verification.

- Standardkan parser pada documented CLI spelling; usage invalid nonzero, dry-run sukses menguraikan intended target/steps dan zero mutations.
- Backup path eksplisit dari external verified backup root, bukan mencari repo `backups` yang bertentangan dengan policy. CLI dan runbook memakai verifier/drill kanonik.
- **DoD:** command runbook benar-benar mengoperasikan safe dry-run, bukan Usage exit0; wrong shard/missing/tampered backup fail-closed; authorized staging rollback memulihkan schema/data sesuai manifest.
- **Verifikasi:** G-OPS Windows/Ubuntu actual CLI, injection dan G-SQL rollback rehearsal.

### AUD-048

**UAT localhost prefix dapat mengirim credential keluar.** Target: `uat-pos-integrity.mjs`, shared live-UAT URL guard/credential loading.

- Parse URL; exact allowed loopback hostname/address, protocol dan port policy; reject userinfo/prefix lookalikes sebelum membaca env/password atau melakukan fetch.
- Remote path hanya dengan explicit existing authorization, trusted destination dan disposable test credentials; redirect tidak boleh memindahkan credential ke target lain.
- **DoD:** `localhost.audit.invalid`, lookalike 127 prefix, userinfo, unexpected scheme/redirect ditolak tanpa network/env secret access. Exact valid loopback tetap menjalankan POS integrity; native Request test tidak dianggap bukti network leak.
- **Verifikasi:** G-OPS actual imported CLI + intercepted fetch, Windows/Ubuntu; tidak mengirim secret nyata.

### AUD-049

**Post-commit realtime/audit menunda balasan tanpa deadline.** Target: `checkoutUseCase.ts:793`, audit outbox, `publishBranchEvent`/DO client and platform execution context.

- Durable audit intent berada bersama atomic business commit; bila saat ini enqueue baru setelah commit, pindahkan bagian durability, bukan seluruh delivery network.
- Delivery/logging/realtime best-effort bounded/deferred lewat supported execution context; fallback tanpa context tetap bounded/cancellable. Tidak membatalkan commit atau membuat sale baru saat upstream hang.
- **DoD:** realtime/logging stall/failure -> response commit sah dalam budget; retry key sama tetap sale satu; audit intent dapat drain setelah recovery; no timer/task leak atau unbounded Promise.all waits.
- **Verifikasi:** G-POS, G-NOTIFY, actual HTTP response latency + stalled dependency injection.

### AUD-050

**Binding realtime/config/build override belum terverifikasi pada artifact.** Target: `wrangler*.jsonc`, `export-durable-objects.mjs`, realtime HTTP/DO/auth boundary, deploy checker.

- Tetapkan config yang benar-benar dikonsumsi build/Pages/Worker dan external DO binding; jangan menebak dari satu file. Missing required binding fail jelas sebelum release, bukan quiet skip.
- Compiled interception/entry memakai satu canonical session/profile/branch/role policy dengan route, bukan stale session-only SQL lain. Hilangkan fragile generated-variable text patch bila tidak dapat dibuktikan aman pada build contract.
- **DoD:** built artifact pada runtime Cloudflare lokal melakukan websocket connect/publish/reconnect, heartbeat/fan-out/isolation; expired/revoked/foreign session gagal. Actual staging binding/job deploy sequence sesuai artifact SHA, tanpa mengarang Pages dry-run.
- **Verifikasi:** G-NOTIFY, G-AUTH, G-RELEASE; actual built-Worker smoke, bukan hanya Vite/source route tests. Staging approval bila dibutuhkan dicatat sebagai blocker, bukan diabaikan.

### AUD-051

**Retensi teknis dan audit drain belum lengkap.** Target: `realtimeWorker.js`, error repositories, order notification device/event/delivery tables.

- Existing 90-day cleanup hanya audit_logs/request_metrics dan daily drain LIMIT100. Tetapkan retensi untuk error/quarantine/expired notification/device/delivery serta throughput/retry policy sesuai evidence volume.
- Cleanup bounded tenant-scoped; active leased/retry events tidak dihapus; ledger finansial/receipt/archive bukan log teknis.
- **DoD:** expired data dibersihkan sesuai documented policy tanpa menyentuh aktif/cabang lain; backlog melebihi100 pulih dalam budget terukur; permanent poison row quarantine tanpa menyandera drain. Outage dan cron retry tidak kehilangan durable event/audit.
- **Verifikasi:** G-SQL, G-NOTIFY, G-OPS frozen-now expiry/retry/concurrency and actual scheduled handler.

### AUD-052

**Tiga advisory dependensi belum dipatch.** Target: `package.json`, `pnpm-lock.yaml`, jsPDF/PDF/workbox build consumers.

- Update dependency parent/override terkecil sesuai convention repo untuk brace-expansion 2.1.6 -> minimal 2.1.7, 5.0.11 -> minimal 5.0.12, DOMPurify 3.4.14 -> minimal 3.4.16; cek advisory terbaru saat eksekusi.
- Bedakan dev/optional runtime reachability; jangan force-update seluruh stack atau mengklaim app exploit tanpa proof.
- **DoD:** seluruh advisory yang tercatat hilang dari dependency graph/audit, atau upstream disposition resmi yang bisa direview membuktikan tidak berlaku. PDF/receipt/PWA build smoke tetap bekerja; frozen lockfile reproduktif.
- **Verifikasi:** G-STATIC, audit high+ dan JSON seluruh severity, build/PDF/browser smoke.

### AUD-053

**Halaman besar dan boundary bisnis tidak merata.** Target: stok 2145 baris, manajemen menu 1951, POS 1282, owner stock/security pages, 26 route DB allowlist.

- Setelah correctness, pecah per tanggung jawab: UI presentation, typed state, command/use case, pure policy/repository. Reuse existing store/component patterns; satu integration owner untuk file yang sama.
- Pindahkan SQL bisnis pada route yang tersentuh ke branch repository/use case; allowlist turun hanya bila benar-benar dimigrasikan. Jangan refactor seluruh 26 route tanpa kebutuhan dan verification per slice.
- **DoD:** touched critical flows punya satu policy, route tipis, reusable state dengan lifecycle jelas; all callers migrated/dead code removed; before/after business invariants dan relevant browser flows sama. Line count turun bukan acceptance tunggal.
- **Verifikasi:** G-STATIC, seluruh gate domain terdampak, G-BROWSER; satu commit satu tujuan, bukan formatting massal.

### AUD-054

**Green checks tidak membuktikan semantik, beberapa metric terlalu sempit.** Target: code-quality/maintainability/docs-drift tests, suite registry/package/CI runners.

- Ganti/hapus wording/implementation/default/source-text/mock-echo tests yang tidak menguji consumer-visible contract; jangan re-pin teks setelah refactor. Meaningful policy lint dapat memakai AST/rule, bukan unit test snapshot source.
- Restore/CLI/gateway/cache/lifecycle tests menjalankan handler/state nyata dan transitions/errors. Guard counts tetap diagnostic, bukan sertifikat clean code.
- Satu canonical release orchestration: hindari build/check yang diulang tanpa manfaat; smoke artifact berjalan setelah build yang benar, bukan cycle job unit->build->unit.
- **DoD:** setiap bug/risk punya meaningful regression; script test baru terdaftar di unit/CI bila berlaku; failure reports menyebut assertion pertama/counts/exit dan cleanup. Tidak ada skip/assertion dilution atau hardcoded old suite count.
- **Verifikasi:** G-STATIC, G-OPS, suite failure injection; integration owner menjalankan combined gates setelah perubahan lengkap.

### AUD-055

**Dokumentasi semantik menyimpang.** Target: `DEVELOPER-GUIDE.md:88`, ADR0003, README, operator runbook, roadmap, agent command guidance.

- Perbaiki bcrypt vs PBKDF2/Argon2, D1 FK default ON, actual CLI/config/backup paths, money vs HPP precision, updated archive schema and support boundaries.
- Baseline historical counts 21/29/22 bukan angka terbaru. Gunakan actual script/result sebagai sumber; jangan membuat test wording agar docs tampak sinkron.
- **DoD:** pembaca dapat menjalankan command dan memahami auth/FK/recovery yang benar; link/rencana aktif jelas; selesai historis tidak dibuka ulang; docs/changelog setiap perubahan perilaku tercatat.
- **Verifikasi:** G-DOC, actual documented CLI dry-run/negative behavior, authoritative vendor sources.

### AUD-056

**CI artifact verify berbeda karena journal CRLF/LF Windows.** Target: `preflight-release.mjs`, release manifest, `.gitattributes`, metadata checkout/build docs.

- `.gitattributes` sudah mengatur LF: buktikan fresh checkout Windows/Linux lebih dahulu. Bila mismatch hanya checkout lama/editor, diagnosis jelas; jangan mengubah file pengguna otomatis.
- Jika normalized control-metadata hashing diperlukan, version manifest semantics dan allowlist text files secara eksplisit. Runtime/assets/SQL/backup/archive tetap raw exact byte SHA; jangan normalize semuanya.
- **DoD:** CI artifact strict verification pada supported clean environments lulus tanpa manual patch salinan; substantive metadata/source/runtime tamper tetap ditolak. Old manifest handling eksplisit, HEAD/source/deployment claims tidak melebihi yang diverifikasi.
- **Verifikasi:** G-OPS, G-RELEASE Windows/Ubuntu real build/download/verify + tamper cases.

### AUD-057

**Performa belum memiliki runtime budgets/hasil beban nyata.** Target: report queries, bounded archive/restore, checkout/realtime, frontend loading.

- Tetapkan acceptance budget dari limit vendor, expected largest dataset, existing SLO atau keputusan owner; catat angka sebelum pengukuran. Ukur cold/warm, concurrency, peak memory, query/batch count, latency distribution dan initial route payload.
- 2.1MB total bundle/445KB terbesar bukan initial payload/UX proof. Pakai actual loaded chunks, devices/network profile, dan compiled Worker/D1, bukan loop mock.
- **DoD:** archive/restore largest expected data selesai dalam budget dengan headroom; post-commit dependency hang bounded; report/checkout/UI memenuhi declared budgets. Jika gagal, fix bottleneck lalu ulang target setelah perubahan, tidak mengecilkan fixture atau membuat fallback palsu.
- **Verifikasi:** G-PERF + G-BROWSER; report includes dataset/config/SHA/limits/metrics and cleanup.

### AUD-058

**Dampak data aktual belum diinventarisasi.** Target: authorized branch-scoped audit/reconciliation tools and affected ledger/session/profile/stock/archive data.

- Tidak ada bukti database produksi terkena fixture audit. Inventaris read-only data aktual: invalid nominal/date/category, duplicate active sessions/usernames, stock-ledger/HPP mismatch, receipt/provenance fields.
- Backup sebelum repair; exact IDs, alasan bisnis dan approved correction tersedia. Jangan mengubah nonnumeric menjadi 0, memilih duplicate winner, atau rewrite receipt/historical price secara otomatis.
- **DoD:** setiap cabang punya evidence zero affected rows atau reconciliation yang disetujui, before/after totals/stock/tax/counters/receipt parity dan rollback. Sensitive exports tetap di secure external storage.
- **Verifikasi:** G-SQL, G-OPS, G-OPERATOR; task code dapat selesai tanpa production mutation, tetapi data sign-off tetap wajib untuk close.

### AUD-059

**Recovery/migration/rollback operasional belum terbukti.** Target: backup/restore/migration scripts, external backup storage, all 3 shard groups/5 branches.

- Operator mengambil backup asli terverifikasi; restore ke target terisolasi, schema/integrity/FK/domain checks dan financial/idempotency/receipt parity.
- Rehearse additive migrations dan rollback di staging dengan approved representative data, lalu apply production hanya berizin. Abort bila constraint preflight belum bersih atau artifact/schema tidak kompatibel.
- **DoD:** semua shard/branch scope tercakup; backup readback+restore proof nyata, dry-run dan rollback dapat dieksekusi, no sibling contamination. Record target IDs secara aman, approvals, exit/counts, RPO/RTO actual vs approved objective.
- **Verifikasi:** G-OPERATOR, G-ARCHIVE, G-RELEASE; lokal saja tidak mencentang task ini.

### AUD-060

**Web Push belum dikonfigurasi dan perangkat nyata belum diuji.** Target: VAPID/config/secrets, realtime Worker, notification devices/preferences/UI.

- Operator provision secret/config dengan channel aman; deploy order Pages/Worker sesuai verified artifact. UI activation failure harus jujur dan tidak berpura-pura push aktif.
- Uji supported browsers/devices foreground/background/closed tab, permissions/revoke, reconnect/offline recovery, profile identity/relogin, branch/origin exclusion dan sound preference.
- **DoD:** live event dari committed order sampai perangkat authorized terbukti sekali sesuai cursor/visibility semantics; cross-branch/old session tidak menerima; denied/expired device tidak crash/loop. Feature tidak boleh dicoret hanya karena konfigurasi belum tersedia.
- **Verifikasi:** G-NOTIFY, G-OPERATOR, physical device evidence dan provider configuration tanpa secret leakage.

### AUD-061

**Provider AI nyata belum disertifikasi kontraknya.** Target: approved provider/model credentials/config, gateway/chat/HPP/report flows.

- Unit/injection tetap tanpa paid model. Live smoke hanya setelah approval provider/model, minimal request, budget/quota, payload non-sensitive, dan staging target jelas.
- Valid response melalui gateway, financial facts canonical, deadline/cancel/fallback/error mapping terukur. Key hanya server secret; billable retry mengikuti policy.
- **DoD:** actual provider happy path dan approved bounded failure/cancel behavior sesuai contract; malformed/rate/timeout negatif dibuktikan injection; biaya/usage dan secret safety tercatat tanpa data pelanggan dikirim.
- **Verifikasi:** G-AI dan G-OPERATOR; tidak menganggap simulator sebagai bukti quota/key/provider readiness.

### AUD-062

**Printer fisik/receipt end-to-end belum diverifikasi.** Target: printer engine, supported browser/USB/Bluetooth/ESC-POS/PDF paths, original/history callers.

- Inventaris channel/device yang benar-benar didukung; uji paper width/layout, add-on/custom item/porsi, nomor harian, nama pelanggan, cash/change dan error/reconnect.
- Commit saat printer gagal tetap sah; reprint snapshot setelah katalog/settings berubah, offline replay dan archive->restore tidak mengubah isi bisnis.
- **DoD:** setiap supported channel mendapat evidence output fisik/actual PDF dan recovery; no duplicate sale saat print retry. Channel yang belum diuji tetap `Blocked`, bukan dianggap lulus karena preview.
- **Verifikasi:** G-POS, receipt suites, G-BROWSER, G-OPERATOR with physical devices.

### AUD-063

**Release final dan penutupan semua temuan.** Target: tracker, canonical release script, CI artifact/provenance, runbook, staging/production deployment records.

- Integration owner memeriksa semua ID/DoD/evidence, termasuk Source -> fixed/Not affected, operator gates, legacy data, dan preserved invariants.
- Jalankan final consolidated gates pada candidate SHA yang sama; verify immutable CI artifact, supported build-runtime smoke, approved staging and production promotion, rollback compatibility dan monitoring.
- **DoD:** seluruh 62 ID lain Completed, full E2E tidak gagal/skip tanpa scope approval, CI required checks hijau pada candidate, artifact tidak rebuild dari workstation, live smoke semua cabang/critical devices selesai, approvals dan rollback proof lengkap. Tidak ada claim “production-ready” sebelum ini.
- **Verifikasi:** G-FINAL, G-RELEASE, G-OPERATOR; final report menyebut evidence/known limits, bukan skor 10/10.

## 8. Gate verifikasi yang dapat dijalankan

Command berikut adalah command proyek yang sudah ada saat rencana dibuat. Agent memeriksa source/script saat eksekusi; command domain baru baru dipakai setelah implementation+registration lengkap. Semua result di bawah adalah **yang harus dijalankan nanti**, bukan klaim sudah lulus pada fix baru.

### G-DOC — dokumen

```powershell
rtk pnpm exec prettier --check docs/AUDIT-REMEDIATION-PLAN.md ENGINEERING-IMPROVEMENT-PLAN.md
rtk git diff --check
```

Perubahan docs lain memakai file yang benar-benar berubah. Jangan format seluruh repository untuk menyelesaikan satu dokumen.

### G-STATIC — kode/config

```powershell
rtk pnpm check
rtk pnpm lint
rtk pnpm deploy:check
```

YAML/JSONC lint/config check relevan dan remote CI ditambahkan bila workflow/config berubah. Registry error code wajib untuk perubahan public code.

### G-AUTH — handler dan security

- Actual HTTP positives + anonymous 401, wrong role/branch/CSRF negatives, PIN sebelum/sesudah unlock, supported/unknown role, expired/revoked session.
- Credential/username race, telemetry isolation dan cache isolation sesuai kartu.
- Gunakan existing `e2e/auth.spec.ts`, handler regression dan fixture terisolasi; bukan hanya mock locals yang menggemakan role.

### G-POS — uang/stok/receipt/offline

```powershell
rtk pnpm test:pos-integrity
rtk pnpm test:offline
rtk pnpm test:ingredient-yield
rtk pnpm test:quantity-decimal
rtk pnpm test:stock-policy
rtk pnpm test:stock-write-guards
rtk pnpm test:stock-reconciliation
rtk pnpm test:stock-offline-review
rtk pnpm test:receipt-output
rtk pnpm test:menu-atomic
```

Tambahkan behavior regression baru yang diperlukan untuk kulakan/ledger/sesi/void; unit/state, actual handler, D1 concurrency dan E2E terkait wajib. Offline queued payload lama yang sah tetap replay tepat sekali; signed price, fingerprint, receipt, stock policy tetap kanonik.

### G-SQL — fresh SQLite + workerd

```powershell
rtk pnpm test:migration-matrix
rtk pnpm test:tenant-scope
rtk pnpm test:data-health
rtk pnpm exec tsx src/tests/stock-reconciliation-tests.ts --d1
rtk pnpm exec tsx src/tests/stock-offline-review-tests.ts --d1
```

Schema/index baru ditambahkan dengan migration journal/checksum, fresh DB, upgrade existing fixture, duplicate/orphan preflight, concurrency and rollback. Tes baru harus benar-benar menggunakan workerd bila melaporkan `--d1`; flag yang diabaikan tidak sah.

### G-AI — tanpa model berbayar pada automated gates

```powershell
rtk pnpm test:ai-period
rtk pnpm test:ai-gateway
rtk pnpm test:ai-chat-usecase
rtk pnpm test:report-tax
rtk pnpm test:tax
rtk pnpm test:tax-cas
rtk pnpm test:tax-save-chain
rtk pnpm test:error-codes
```

Additional regression: active/archive/YTD/capital parity, validated recommendation mutation, client disconnect/stalled body, rate limit before upstream, HPP four decimals, safe errors and WITA historical/session scopes.

### G-ARCHIVE — claim/readback/export/restore

```powershell
rtk pnpm test:archive-restore
rtk pnpm test:archive-usecase
rtk pnpm test:archive-guard
rtk pnpm test:restore-apply
rtk pnpm test:report-grouping
rtk pnpm test:report-tax
rtk pnpm exec tsx src/tests/archive-guard-tests.ts --d1
rtk pnpm exec tsx src/tests/restore-apply-tests.ts --d1
```

R2 corruption/readback/missing object, claim/lease race, edit-after-snapshot, late restore conflict, old/new archive decoder, CLI apply/dry-run, download bytes, counts/totals/idempotency/receipt/counter parity. Actual R2 staging proof membutuhkan approval, bukan mock saja.

### G-NOTIFY — Antrean/realtime

```powershell
rtk pnpm test:antrean
rtk pnpm test:antrean-notifications
rtk pnpm test:realtime
rtk pnpm exec tsx src/tests/antrean-tests.ts --d1
rtk pnpm exec tsx src/tests/antrean-notification-tests.ts --d1
rtk pnpm test:e2e:all e2e/antrean-notifications.spec.ts
```

Actual compiled runtime websocket/DO/binding plus notification cursor/origin/visibility/device/expiry/relogin behaviors; source tests tidak menggantikan built artifact smoke.

### G-OPS — scripts dan failure injection

```powershell
rtk pnpm test:operations
rtk pnpm test:d1-backup
rtk pnpm test:d1-wipe
rtk pnpm test:release-gate
rtk pnpm test:e2e:isolation
rtk pnpm test:uat-live-safety
rtk proxy node scripts/migrate-production.mjs
```

Command terakhir tidak memakai `--apply`. Backup/restore/wipe/rollback/UAT tambahan diuji dengan injected transport/process/failures, Windows+Ubuntu, exit behavior, valid/invalid manifest/path/schema/target, and owned cleanup. Jangan menjalankan destructive default untuk mendapat proof CLI.

### G-BROWSER — actual UI

```powershell
rtk pnpm test:e2e:all e2e/pos.spec.ts e2e/menu.spec.ts e2e/reports.spec.ts
rtk pnpm test:e2e:all e2e/auth.spec.ts e2e/offline.spec.ts e2e/stock-policy.spec.ts
rtk pnpm test:e2e:all e2e/a11y.spec.ts e2e/archive.spec.ts
```

Pilih alur yang benar-benar terkait setelah cohort integrated. Tambahkan keyboard/mobile/timezone/late response/route teardown/actual downloaded file cases sesuai kartu. Smoke visual manual pada permukaan berubah tetap wajib; suite saja tidak membuktikan keyboard/focus/perangkat yang belum diobservasi.

### G-PERF, G-RELEASE, G-OPERATOR

- G-PERF: actual workload/config/SHA/frozen data, peak memory, latency distributions, query counts/budgets, cold/warm browser and large archive/restore; compare dengan angka budget yang sudah ditetapkan, bukan subjektif “cepat”.
- G-RELEASE: supported build satu kandidat, semua runtime roots/checksums, source/metadata/commit provenance, artifact tamper rejection, actual compiled smoke, matching CI and deployment record. Worker dry-run hanya jika memang didukung CLI yang dipakai; Pages memakai validasi/staging yang benar.
- G-OPERATOR: explicit approved target/action, secure verified backups, actual restore/rollback/migration/push/provider/printer evidence, approvals, rollback compatibility, no production secret in logs/repo.

### G-FINAL — sekali sesudah integrasi kandidat

```powershell
rtk pnpm test:release
rtk pnpm deploy:check
rtk pnpm audit --audit-level high
rtk proxy pnpm audit --json
rtk git diff --check
```

`test:release` saat ini mencakup test:all/build/full E2E; jangan mengklaim masing-masing aggregate pernah dijalankan bila hanya komponen tertentu. AUD-054 menghilangkan duplikasi orchestration yang tidak perlu; tetap satu chain kanonik dengan seluruh bukti. JSON audit menampilkan seluruh severity dan dapat exit nonzero walau high+ pass. Semua D1/ops/browser/performance/operator extras yang diwajibkan kartu tetap diperlukan.

Jumlah tes boleh bertambah melalui regresi; 70 dan 38 adalah baseline historis, bukan target count yang dipin untuk selamanya. Tidak boleh mengurangi cakupan/skips agar final hijau.

## 9. Protokol tracker dan evidence AI Agent

### 9.1 Claim, handoff, dan resume

1. Baca rencana ini dan tracker. Pilih task pertama dependency-ready dalam prioritas/fase; jangan mengulang pekerjaan Completed.
2. Isi owner/session aktual dan catatan claim sebelum shared edit. Jika file sedang dimiliki Agent lain, kerjakan slice lain atau koordinasikan integration owner.
3. Handoff menyebut ID, contract/interface, file ownership, reproduksi/trace, current status, gate yang sudah/belum dijalankan, blockers, dan next concrete action.
4. Resume tidak menyimpulkan command lulus dari source atau chat. Gunakan evidence; check gagal yang sudah dilaporkan bukan alasan rerun tanpa perubahan/root cause.
5. Update status/checklist dan evidence segera setelah milestone yang benar. Selesai fase bukan alasan berhenti bila ada task actionable.
6. Task `Blocked` menyebut prerequisite tepat, pihak yang dapat menyediakan, tindakan yang telah dicoba, dan pekerjaan aman lain yang tetap berjalan. Approval remote/biaya/hardware tidak boleh diakali dengan fallback palsu.

### 9.2 Satu catatan eksekusi per milestone

Append di bagian 12 atau rujuk artifact aman. Catatan wajib memuat:

- ID, timestamp, owner/session, disposition (`Fixed` atau `Not affected`), status dan alasan.
- Base SHA dan final candidate/commit SHA; daftar file, contract before/after dan scope.
- Reproduksi/failing-before beserta expected invariant; actual passing-after state/output.
- Command persis, exit code, pass/fail/skip counts, OS/Node/pnpm, SQLite/workerd/browser/staging/production scope.
- Artifact/trace/screenshot/report locations yang aman; jangan menyimpan raw secret/PII.
- CI URL pada SHA yang sama, reviewer, approval operator bila berlaku.
- Rollback proof, cleanup resource/owned state, dan batas bukti/known issue yang belum selesai.
- Dependency yang terbuka/tertutup dan next task yang dapat dijalankan.

Evidence task tidak boleh diganti dengan link CI baseline. Jika task tidak mengubah code, jelaskan current candidate yang diverifikasi dan mengapa no-code disposition sah.

### 9.3 Ringkasan progress

Progress dihitung dari 63 row tracker: jumlah Pending/In progress/Blocked/Passed local/Completed; `[x]` harus tepat sama dengan Completed. Source/gate failure/operator task tetap masuk denominator sampai accepted disposition/DoD, bukan dihapus. Reviewer mengecek dependency closure dan bukti, bukan hanya hitungan centang.

Status 2026-10-07: **56 Passed local, 6 Blocked (AUD-053 slice + AUD-058..062 operator), 1 Pending (AUD-063 final), 0 In progress, 0 Completed**. `[x]` tetap 0/63.

## 10. Gate operator dan prasyarat eksternal

Task berikut tidak dapat disertifikasi sepenuhnya hanya dengan workspace lokal:

| Prasyarat                                                | Digunakan oleh                          | Proof yang diperlukan                                                                     |
| -------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------- |
| Izin target staging/production, Cloudflare/GitHub access | AUD-050, AUD-058, AUD-059, AUD-063      | Identitas target, action scope, approver, deployment/CI SHA                               |
| Backup nyata semua shard dan secure external storage     | AUD-044..047, AUD-058, AUD-059          | COMPLETE/readback/SHA/schema/size, restore parity, approved retention/RPO/RTO             |
| Inventaris archive legacy terbesar dan expected growth   | AUD-039, AUD-041..043, AUD-057, AUD-059 | Ukuran/row/field contract; sanitized fixture representative; no arbitrary smaller dataset |
| VAPID/config dan browser/device push yang didukung       | AUD-060                                 | Provisioned secret melalui channel aman, real subscription/delivery/revoke                |
| Provider/model AI, quota dan batas biaya approved        | AUD-061                                 | Payload test non-sensitive, actual response/cancel/usage and budget                       |
| Printer/peripheral dan platform yang diklaim didukung    | AUD-062                                 | Actual paper/PDF, reconnect/failure/reprint all supported paths                           |
| Maintainer/reviewer bisnis/security/operator             | Seluruh task kritis, AUD-063            | Review contract, migration/data correction, release/rollback sign-off                     |

Kalau prerequisite belum ada, tulis `Blocked` pada penerimaan yang membutuhkan itu; selesaikan seluruh code/test/documentation yang reachable. Jangan mengurangi scope Web Push/AI/printer/recovery secara diam-diam. Pengubahan fitur/support contract atau atomicity membutuhkan keputusan owner eksplisit dan pembaruan seluruh DoD.

## 11. Definition of Done keseluruhan

- [ ] Semua 63 row Completed; tidak ada owner kerja aktif atau blocker yang disembunyikan.
- [ ] Semua bug R diperbaiki; semua S memiliki runtime proof fixed/Not affected dan reviewer; tiga kegagalan G punya root cause/regresi/passing flow asli.
- [ ] Uang rupiah/HPP4/qty, atomic purchase, metadata-stock separation, session transition, CAS void dan replay idempotency benar pada fresh/upgrade SQLite dan workerd.
- [ ] Laporan aktif/arsip/AI/tax/session/capital parity; read failure bukan empty success; historical receipt/counters/provenance tetap utuh.
- [ ] Auth/role/PIN/CSRF/branch/cache/telemetry/realtime boundaries positif-negatif lulus untuk seluruh cabang termasuk shared shard aliases.
- [ ] Modal/lifecycle/keyboard/WITA/branch labels dan notification preferences/relogin berfungsi pada actual desktop/mobile surface.
- [ ] Archive, streamed download, versioned decode, full preflight, bounded restore and destructive-script guards fail-closed dengan crash/lease/conflict/readback proof.
- [ ] Seluruh advisory yang tercatat ditangani; no unknown unsafe override; PDF/PWA/provider output paths tetap bekerja.
- [ ] Performa memenuhi declared measured budgets, bukan hanya build size atau mock benchmark.
- [ ] Data aktual diperiksa/rekonsiliasi berizin; backup/restore/migration/rollback dan push/AI/printer nyata memiliki evidence lengkap.
- [ ] Static/unit/state/integration/ops/workerd/full E2E/release gates lulus; CI required checks pada candidate SHA yang sama hijau.
- [ ] Immutable artifact yang diverifikasi dipromosikan tanpa workstation rebuild; staging/production target, approvals, all-branch smoke dan rollback compatibility terverifikasi.
- [ ] Docs/changelog/runbook/tracker/evidence sinkron; semua scaffold/resources milik runner bersih, user state/secret aman.
- [ ] Final report menyatakan apa yang dibuktikan dan batas yang tersisa. Klaim 10/10/zero-risk tidak dipakai sebagai pengganti acceptance.

**Stop condition untuk mengklaim selesai: seluruh checklist di atas benar.** Jika salah satu belum benar, laporkan status aktual dan prerequisite yang kurang; jangan menyebut perbaikan lengkap atau production-ready.

## 12. Catatan eksekusi

### AUD-001 2026-10-05 — Passed local (opencode)

- Disposition: `Not affected` untuk kode aplikasi; tidak ada fix. ECONNRESET hanya muncul di dokumen audit, tidak ada handler/swallow global di `src/` atau `scripts/` (grep hanya kena docs + 2 komentar tidak terkait). Klasifikasi: transient tool/harness/probe, bukan fault aplikasi. Tidak menambah swallow-error global.
- Toolchain: base SHA `3ac4c41d8f185ea52677e6903e9bd1314257f84b` (HEAD, `git log` cocok). `.node-version` 24.20.0 = CI `node-version-file`; `pnpm` 11.24.0 = CI `pnpm/action-setup@v4` + `packageManager`. Lokal `node --version` v26.8.1 vs pin 24.20.0 (mismatch tercatat); `engines >=22` bukan bukti tiap major didukung. Gate lokal lulus di 26.8.1, bukan klaim 26 didukung. Kanonik tetap CI 24.20.0.
- Isolation/cleanup: `e2e-environment.mjs` pakai `mkdtempSync` tmp + `wrangler.json` acak + UUID DB + signing key acak; `cleanup()` hanya hapus owned dir. `run-playwright-local.mjs` kill tests + `shutdown` server + timeout 20s + cleanup owned temp. `e2e-server.mjs` handle `shutdown`/`disconnect`/`SIGTERM`/`SIGINT`.
- Gate lokal (Windows, Node 26.8.1, pnpm 11.24.0): `rtk pnpm check` exit 0 (0 error 0 warning); `rtk pnpm lint` exit 0; `rtk pnpm deploy:check` exit 0 (warning Web Push belum dikonfigurasi sesuai ekspektasi); `rtk pnpm test:operations` exit 0 (backup 9 + wipe 6 + uat-self-test PASS + isolation 2 + release-gate 10); `rtk pnpm test:e2e:isolation` exit 0 (2/2).
- Batas bukti: Windows success-path saja. Ubuntu/interrupt/startup-failure/browser/workerd-stop belum dibuktikan di kandidat ini; CI baseline `https://github.com/zulilmiihsn/zatiaras-juice-pos/actions/runs/37254496603` sebagai referensi, bukan pengganti CI pada SHA kandidat kotor ini. Working tree kotor saat ukur: `M ENGINEERING-IMPROVEMENT-PLAN.md`, `?? docs/AUDIT-REMEDIATION-PLAN.md`. `Completed` butuh tree bersih + CI SHA sama + reviewer.
- Rollback: tanpa perubahan kode; revert tracker bila ditolak.

### AUD-002..004 2026-10-05 — Passed local (opencode)

- Triage dari `error-context.md` audit (`%TEMP%\zatiaras-full-audit-5n1OS9\e2e-results`): AUD-002 timeout 120s tanpa baris gagal (snapshot modal sukses + keranjang kosong = checkout OK, tahap macet tak terpetakan); AUD-003 switch tidak ditemukan setelah reload (snapshot hanya header = gate `allowed && role` belum lolos dalam 10s); AUD-004 `toHaveURL(/\/$/)` gagal (snapshot modal "Login Berhasil!" = kredensial OK, navigasi `/` tak tiba).
- Reproduksi: tiap skenario lulus solo (`--workers=1`: 51.9s / 1.4m / 1.6m) dan seberkas 6/6 lulus (4.2m) pada Windows Node 26.8.1 — sebelum maupun sesudah fix. Akar deterministik tidak ketemu; pola umum ketiga gagal = tunggu tanpa batas saat server lambat (beban full-suite 70 tes).
- Fix minimal (tanpa turun asersi/retry buta): `authGuard.fetchSessionPayload` pakai `AbortSignal.timeout(8000)` (konsisten `orderNotificationService`) agar `requireAuth`/`isAuthenticated` jatuh ke fallback deterministik, bukan halaman kosong; login `await goto('/')` agar relogin tiba atau gagal eksplisit; spec `waitForRequest`/`waitForResponse` timeout 30s + `cleanup` fetch timeout 15s agar gagal berikut menunjuk tahap, bukan 120s buta.
- Gate lokal: `check` 0/0; eslint + prettier file tersentuh lulus; `antrean-notifications` 6/6 + `auth` 2/2 lulus sejalan (4.8m), cleanup owned-temp OK, tanpa `.wrangler` di repo.
- Batas bukti: full `test:e2e:all` 70 tes belum diulang lokal; CI SHA sama + reviewer belum. `Completed` butuh itu. File ubah: `src/lib/utils/authGuard.ts`, `src/routes/login/+page.svelte`, `e2e/antrean-notifications.spec.ts`.
- Rollback: revert tiga file via proses release berizin.

### AUD-005 2026-10-05 — Passed local (opencode)

- Reproduksi: statis + kontrak. `POST /api/buku-kas` meneruskan payload mentah (`payloadRows` passthrough) dengan `nominal ?? 0`; `insertBukuKasRows` tanpa validasi nominal/tipe/jenis/sumber/waktu — string invalid tersimpan lalu laporan membaca 0. Tes regresi `ledger-validation-tests` mengunci kontrak baru.
- Fix: baru `src/lib/server/ledgerValidation.ts` (tanpa SvelteKit, `LedgerValidationError` bawa status). Seluruh batch divalidasi sebelum tulis: nominal finite >= 0 <= MAX_SAFE_INTEGER lalu `Math.round` (desimal tidak mentah, tanpa fallback 0); tipe in/out; jenis 3 nilai + pairing (in→pendapatan/lainnya, out→beban/lainnya); sumber catat/stok (pos tetap 409); waktu parseable; metode tunai/non-tunai (+qris→non-tunai); deskripsi wajib isi. `insertBukuKasRows` validasi lalu insert ternormalisasi; PATCH manual validasi field + pairing lawan nilai kini; route petakan error→400, hapus `?? 0`.
- Dampak sadar: kategori model AI invalid kini 400 saat apply (fail-closed, benar per AUD-033); replay antrean invalid lama gagal keras, bukan korupsi diam.
- Gate lokal: suite baru lulus; `check` 0/0; eslint+prettier file tersentuh lulus; `pos-integrity`, `offline` (40), `service-pure`, `docs-drift`, `maintainability`, `error-codes` lulus. File ubah: validator baru, `bukuKasService`, route, suite baru, `package.json` (`test:ledger-validation` + rantai unit), `ci.yml` step.
- Batas bukti: tanpa HTTP-handler negatif runtime; full E2E + CI SHA sama + reviewer belum. Rollback: revert file via release berizin.

### AUD-006 2026-10-05 — Passed local (opencode)

- Reproduksi: jalur lama 3 request berurutan tanpa transaksi (`insert bahan_mutasi` → `insert buku_kas` → `update bahan` di `stok/+page.svelte`). Kas 4xx/5xx sesudah mutasi commit = stok berubah tanpa kas; retry = kulakan ganda. Tes baru mengunci kontrak atomik + idempoten.
- Fix: `POST /api/bahan/purchase` → `purchaseUseCase.executePurchase` (BranchContext, pemilik). Satu batch D1: UPDATE stok aritmetik (+HPP bila kulakan+kas) + INSERT mutasi (`stok_setelah` sub-select, `operation_key`, `referensi_id` = kas) + INSERT kas (lewat validator AUD-005, `idempotency_key` = `purchase:key`). Idempoten: cek kunci → duplikat; balapan → unique index menang, kalah baca ulang. Konversi satuan otoritatif server; HPP server dari kas/jumlah/yield; policy ignored → 409 (cermin mutasi route); update_hpp/hpp-eksplisit hanya tambah.
- Migrasi `0038_purchase_operation_key` (kolom + partial unique, aditif): matrix 39/39 + quick_check ok. UI stok + `savePurchasedItem` pindah ke perintah tunggal (kunci per niat modal; retry pakai kunci sama). Batas sadar: `savePurchasedItem` tak lagi menimpa `satuan`/`yield=100` (perlu alur khusus, bukan efek samping belanja); HPP kini ikut yield aktual (konsisten `insert/updateBahanRow`); `saveMutasiBahan` 1-tulis atomik tetap (bukan kulakan).
- Gate lokal: suite `purchase-command` SQLite + `--d1` lulus (sukses, retry, balapan, rollback kas-gagal, unit invalid, kurang, ignored-409, kasir-403); E2E `kulakan` 1/1 + `stock-policy` 15/15 lulus; `check` 0/0; eslint+prettier lulus; `tenant-scope`, `data-health`, `docs-drift`, `maintainability` (allowlist +1 eksplisit), `error-codes`, `pos-integrity`, `offline`, `service-pure` lulus.
- Batas bukti: migrasi 0038 belum apply remote/staging (operator F7); full E2E + CI SHA sama + reviewer belum. Rollback: revert file + migrasi baru (kolom nullable, drop index) via release berizin.

### AUD-007 2026-10-05 — Passed local (opencode)

- Reproduksi: chip "Kulakan Terakhir" menampilkan/mengisi `jumlah_beli_terakhir` mentah (satuan dasar) dengan label satuan beli — 1000 gram tersimpan tampil sebagai 1000 kg. Form edit bahan sudah round-trip benar; hanya chip salah.
- Fix: derived `terakhirKulakanPreset` (`safeConvertFromBaseUnit` ke satuan beli + fallback satuan dasar) untuk label dan isian di `stok/+page.svelte`. Bonus temuan: `update_hpp` tanpa kas kini diabaikan server (cermin UI), bukan 400.
- Bukti E2E `kulakan`: chip bertuliskan "Kulakan Terakhir (1 kg)", klik mengisi `1` + satuan kg, submit kedua tanpa kas → stok 2000. Lintasan ini juga membuktikan retry CSRF 403→200 aman berkat `operation_key` (trace E2E).
- Gate lokal: `check` 0/0; eslint+prettier lulus; `kulakan` 1/1; `purchase-command` SQLite + `--d1` tetap lulus.
- Batas bukti: CI SHA sama + reviewer belum. Rollback: revert dua file via release berizin.

### AUD-008 2026-10-05 — Passed local (opencode)

- Reproduksi: `POST /api/produk/save-atomic` edit selalu `UPDATE produk SET ... stok = <payload>` — form basi menimpa susutan checkout bersamaan. Regresi di `stock-write-guards`: buka (3) → susut luar (1) → simpan stok tangkapan 3 → saldo tetap 1 + nama berubah (gagal pada kode lama).
- Fix: edit tak lagi menulis kolom `stok`; respons kembalikan saldo aktual; klien tak kirim `stok` saat edit (tetap kirim saat buat). Mode ignored: 409 hanya untuk ubah flag lacak; stok basi diabaikan (200, saldo utuh). Penyesuaian disengaja tetap lewat rekonsiliasi/produk_mutasi.
- Kontrak berubah disengaja: guard lama `stok:99 → 409` kini `200` saldo utuh (tes diperbarui). File ubah: route save-atomic, `menuState`, `stock-write-guards-tests`.
- Gate lokal: `stock-write-guards` lulus; `check` 0/0; eslint+prettier lulus.
- Flake lama tercatat (bukan regresi): `e2e/menu.spec.ts` guard guard rute gagal 2x dengan perubahan + 1x pohon bersih (`git stash`) — halaman render tanpa redirect `/login` dalam 10s. Di luar scope kartu; verifikasi ulang di gate full-suite AUD-063.
- Batas bukti: CI SHA sama + reviewer belum. Rollback: revert tiga file via release berizin.

### AUD-009 2026-10-05 — Passed local (opencode)

- Reproduksi: `updateBahanRow` menerima `stok_saat_ini` dari PATCH; dua form edit mengirim snapshot saldo — checkout bersamaan terhapus. Regresi di `stock-write-guards`: PATCH metadata + `stok_saat_ini` → 400, saldo 7 utuh; PATCH nama → 200, saldo utuh.
- Fix: server tolak field saldo di PATCH (400); kedua form kirim saldo hanya saat buat. Saldo eksplisit tetap lewat mutasi atomik/purchase/rekonsiliasi. Urutan guard bahan: policy ignored (409) dulu, lalu 400 saldo — ekspektasi lama utuh.
- Bukti E2E `kulakan`: buka edit bahan → simpan langsung → stok tetap 2000.
- Gate lokal: `stock-write-guards` lulus; `kulakan` 1/1; `check` 0/0; eslint+prettier lulus.
- Batas bukti: CI SHA sama + reviewer belum. Rollback: revert empat file via release berizin.

### AUD-010 2026-10-06 — Passed local (pi-agent)

- Reproduksi gagal sebelum fix: retry dengan ID sesi sama tetapi kas awal berbeda diterima sebagai duplikat sukses (assertion `Missing expected rejection`).
- Implementasi: migrasi aditif `0039_sesi_toko_single_active.sql` menambahkan partial unique index `(cabang_id) WHERE is_active = 1`; preflight duplikat dicantumkan di komentar migrasi dan tidak menghapus/memilih sesi otomatis. Pembukaan menjadi satu `INSERT ... SELECT ... WHERE NOT EXISTS`; unique index tetap melindungi balapan. ID sama + isi ter-normalisasi sama = retry stabil; isi berbeda = 409 tanpa perubahan. Kas awal divalidasi lalu dinormalisasi lewat `normalizeMoney`.
- Regresi menjalankan service dan handler `POST /api/sesi-toko`: satu pemenang 200 + satu konflik 409 pada kontensi, retry, payload konflik, kas invalid, tutup lalu buka, serta cabang independen termasuk dua alias pada binding D1 yang sama.
- Gate lokal: `rtk pnpm test:sesi-toko` exit 0; `rtk pnpm exec tsx src/tests/sesi-toko-tests.ts --d1` exit 0; `rtk pnpm test:migration-matrix` exit 0 (40/40 migration, `quick_check=ok`); `rtk pnpm test:pos-integrity` exit 0; `rtk pnpm test:unit` exit 0; `rtk pnpm check` exit 0 (0 error/0 warning); `rtk pnpm exec eslint .` exit 0; Prettier untuk file kode/workflow/rencana yang disentuh lulus; `rtk git diff --check` bersih.
- Batas bukti: `rtk pnpm lint` masih gagal karena formatting `drizzle/meta/_journal.json`, yang sudah dirty sebelum sesi ini; file metadata tidak dinormalisasi agar perubahan byte/provenance yang tidak terkait tidak tertutup. CI pada SHA yang sama dan review belum ada karena tree belum di-commit. Migrasi belum diterapkan remote/staging; preflight data/operator tetap wajib. Base HEAD `3ac4c41`; seluruh workspace sudah memiliki perubahan lokal sebelumnya.
- Rollback: belum ada mutasi remote. Kode dapat di-revert; penghapusan constraint hanya melalui migrasi ter-review setelah memastikan tidak ada duplicate-active data.

### AUD-011 2026-10-06 — Passed local (pi-agent)

- Reproduksi gagal sebelum fix: PATCH sesi menerima `kas_awal` dan `is_active: true` tanpa rejection, sehingga membuka peluang rewrite saldo pembukaan/reactivation dari jalur close.
- Implementasi: PATCH hanya menerima pasangan `waktu_tutup` + `is_active: false`; field opening/tenant/actor/unknown (termasuk `kas_akhir`, yang tidak punya kolom/kontrak tersimpan) ditolak. Waktu harus valid dan tidak mendahului pembukaan. UPDATE memakai CAS branch-scoped `is_active = 1 AND waktu_tutup IS NULL`; lost race menjadi 409, sesi/cabang tak ditemukan 404. Retry penutupan dengan timestamp sama idempoten; timestamp berbeda tidak menimpa histori.
- Regresi handler PATCH asli: role pemilik, rewrite-fields, timestamp sebelum buka, wrong branch, close/retry, stale retry, concurrent close dengan dua timestamp (satu transisi/200, satu 409), serta saldo dan waktu buka tetap utuh. Sesi yang ditutup tidak aktif kembali saat sesi baru dibuka.
- Gate lokal: `rtk pnpm test:sesi-toko` exit 0; `rtk pnpm exec tsx src/tests/sesi-toko-tests.ts --d1` exit 0; `rtk pnpm test:unit` exit 0; `rtk pnpm test:pos-integrity` exit 0; `rtk pnpm check` exit 0 (0 error/0 warning); ESLint untuk kode tersentuh exit 0; Prettier untuk file terkait lulus; `rtk git diff --check` bersih.
- Batas bukti: CI kandidat dan reviewer belum; full browser buka/tutup toko belum diuji. `rtk pnpm lint` masih terhalang format `drizzle/meta/_journal.json` yang sudah dirty sebelum sesi ini. Tidak ada migrasi/data production yang diterapkan. Base HEAD `3ac4c41` dengan perubahan lokal sebelumnya; belum ada commit kandidat.
- Rollback: tanpa mutasi remote. Revert service/route/test; jangan mengubah opening/closing history untuk menyesuaikan tes.

### AUD-013 2026-10-06 — Passed local (pi-agent)

- Reproduksi gagal sebelum fix: test pada handler laporan mendapat `Missing expected rejection`; query `ringkasan_kas_arsip_harian` ditelan oleh `.catch(() => ({ results: [] }))` dan endpoint menyusun laporan seolah arsip kosong.
- Fix minimal: hapus fallback empty pada query arsip wajib di `buildLaporanAggregate`; kegagalan DB kini merambat ke handler sebagai request gagal. Arsip yang benar-benar kosong tetap valid; tidak ada fallback 0 atau perubahan policy agregasi.
- Regresi menggunakan GET handler laporan dan database fresh terisolasi dengan tabel archive dihilangkan, bukan mengandalkan mock echo. Kasus dijalankan terhadap SQLite dan workerd D1; existing report-tax cases untuk periode valid tetap lulus.
- Gate lokal: `rtk pnpm test:report-tax` exit 0; `rtk pnpm exec tsx src/tests/report-tax-tests.ts --d1` exit 0; `rtk pnpm test:unit` exit 0; `rtk pnpm check` exit 0 (0 error/0 warning); ESLint file tersentuh exit 0; Prettier file terkait lulus; `rtk git diff --check` exit 0.
- Batas bukti: browser E2E belum dijalankan; CI kandidat/reviewer belum karena working tree belum di-commit. Tidak ada data remote yang disentuh.
- Rollback: revert query/test/CI perubahan; tanpa migrasi.

### AUD-014 2026-10-06 — Passed local (pi-agent)

- Kontrak before/after: cetak ulang POS memakai `receipt_snapshot` permanen yang tersimpan bersama row `buku_kas` branch-scoped. Snapshot versi 1 kini mencakup item/harga/topping, total, uang diterima, kembalian, waktu/pelanggan, dan field header toko yang dibaca dengan predicate `cabang_id` saat checkout. Initial sale receipt juga memakai snapshot response yang sama.
- History DTO membawa snapshot; halaman riwayat umum/kasir/pemilik tidak lagi memuat pengaturan struk terkini. Jalur reprint menyusun satu data receipt untuk HTML dan ESC/POS. Snapshot ada -> tidak query katalog atau detail transaksi terkini. Legacy tanpa snapshot hanya memakai field ledger dan detail transaksi historis tersimpan; header serta uang/kembalian yang hilang diberi status tidak tersedia. Snapshot rusak gagal tertutup; sumber agregat arsip ditolak sebagai struk individual.
- Regresi: total Rp10.000, tunai Rp12.000, kembalian Rp2.000, detail/header lama tetap menang atas nominal/nama katalog/header terkini; HTML dan ESC/POS diverifikasi. Tes awal untuk `cash_received: null` gagal karena decoder mengubah JSON null menjadi nol; decoder diperbaiki agar nilai tidak tersedia tetap null. Legacy dan field snapshot eksplisit `null` tidak mengarang uang/header; corrupt snapshot dan aggregate archive ditolak. Checkout handler menguji capture pengaturan cabang dan retry tetap mengembalikan header lama setelah setting berubah. Restore SQLite + workerd menguji total/cash/change/header snapshot tetap identik.
- Gate lokal: `rtk pnpm test:receipt-output`, `rtk pnpm test:antrean`, `rtk pnpm test:antrean -- --d1`, `rtk pnpm test:restore-apply`, `rtk pnpm test:restore-apply -- --d1`, dan `rtk pnpm test:unit` exit 0. `rtk pnpm check` 0 error/0 warning. `rtk pnpm test:e2e:pos` 3/3 lulus; browser checkout tunai lalu buka riwayat dan klik cetak, tanpa request detail transaksi (`/api/transaksi-kasir`) tambahan ketika snapshot ada. E2E awal sempat salah menghitung satu request pengaturan pada navigasi; assertion diperbaiki agar mengukur request tambahan selama aksi cetak, lalu suite dijalankan ulang hijau. ESLint file terkait, Prettier, serta `rtk git diff --check` lulus.
- Batas bukti: belum ada CI pada kandidat/SHA yang sama atau review; working tree belum di-commit. Browser E2E menjalankan output workflow lokal terisolasi, bukan pembacaan fisik kertas/printer atau semua kombinasi driver; verifikasi perangkat tetap AUD-062. Tidak menjalankan migrasi atau operasi production.
- Rollback: revert perubahan writer/decoder/history DTO/renderers/callers dan regresi terkait; tidak ada migration/DDL maupun data remote yang perlu dibatalkan. Receipt snapshot baru memakai kolom JSON teks yang sudah ada.

### AUD-039 2026-10-06 — Passed local (opencode)

- Reproduksi: baca + snapshot + batch finalisasi tak batas (satu job, satu objek).
- Fix: driver chunk — tiap chunk job sendiri (klaim, snapshot ≤1MB, readback, finalisasi atomik guard sama). Kursor (waktu,id), cap 10/panggil + partial jujur, recall otomatis. Satu chunk = respons lama utuh.
- Regresi `archive-chunk-tests`: multi-chunk, crash-resume, byte-budget, partial. Guard lama update ekspektasi part (101=3 objek). Gagal beralasan di lama, hijau SQLite + D1 di baru.
- File ubah: usecase, rute (partial/passthrough), guard test, suite baru, `package.json` + step CI.
- Gate lokal: chunk + guard + usecase lulus, `check` 0/0, eslint + prettier lulus, docs/maintainability lulus, `diff --check` bersih.
- Batas bukti: CI SHA sama + reviewer belum; tree belum commit. R2 staging asli + G-PERF volume legacy butuh operator; orphan part konflik catat cleanup.
- Rollback: revert enam file via release berizin.

### AUD-041 2026-10-06 — Passed local (opencode)

- Reproduksi: writer v2 + SELECT * (kolom operasional ikut snapshot, versi meluas diam-diam).
- Fix: writer v3 + SELECT/proyeksi eksplisit kontrak; decoder gerbang [1,2,3] + peta field terdokumentasi; v4+ tolak pra-apply.
- Regresi `archive-version-tests`: kontrak kolom, v3 round-trip + checksum + paritas, legacy v1 default, tolak v4. Gagal beralasan di lama, hijau SQLite + D1 di baru.
- File ubah: usecase, restore-lib, suite baru, `package.json` + step CI.
- Gate lokal: suite baru 2 mode + usecase/restore/apply lama lulus, `check` 0/0, eslint + prettier lulus, docs/maintainability lulus, `diff --check` bersih.
- Batas bukti: CI SHA sama + reviewer belum; tree belum commit. Decoder era v2 tolak v3 by design.
- Rollback: revert lima file via release berizin.

### AUD-038 2026-10-06 — Passed local (opencode)

- Reproduksi: sesi terkini global tanpa filter — kas 999999 hari ini bocor ke laporan Agustus.
- Fix: sesi terkini ikut bukaan WITA periode (semantik ringkasan); luar periode = exclude.
- Regresi di `ai-report-tests`: historis + lintas-midnight + kosong + kini. Gagal beralasan di lama (999999 vs 50000), hijau SQLite + D1 di baru.
- File ubah: `reportData`, suite existing (rantai CI ada).
- Gate lokal: suite 2 mode lulus, `check` 0/0, eslint + prettier lulus, `diff --check` bersih.
- Batas bukti: CI SHA sama + reviewer belum; tree belum commit.
- Rollback: revert dua file via release berizin.

### AUD-037 2026-10-06 — Passed local (opencode)

- Reproduksi: SSE + catch non-stream teruskan `err.message` mentah; log provider body mentah.
- Fix: pesan publik tetap per kelas + status 504/502/500 (kode tetap registry 19); log teredaksi; body provider tak masuk log.
- Regresi di `ai-gateway-tests` 19-20 (injeksi SQL/skema/key) + E2E `aichat-errors.spec.ts` kontrak negatif. Merah di lama, hijau di baru.
- File ubah: gateway, rute, suite existing, spec E2E (rantai ada).
- Gate lokal: suite + error-codes 19 utuh + E2E lulus, `check` 0/0, eslint + prettier lulus, `diff --check` bersih.
- Batas bukti: CI SHA sama + reviewer belum; tree belum commit. Mapping live butuh provider (unit + review wiring).
- Rollback: revert empat file via release berizin.

### AUD-036 2026-10-06 — Passed local (opencode)

- Reproduksi: `findExplicitDay` tanpa cek masa depan — 31 Des 2026 lolos; bulan depan explicit sama.
- Fix: tolak rakitan hari/bulan > today WITA (null ke analyzer, tanpa query). Range parsial + kabisat + lintas batas utuh.
- Regresi di `ai-period-tests`: future 6 pola + batas inklusif + kabisat + lintas batas. Gagal beralasan di lama, hijau di baru. Usecase pakai fungsi sama.
- File ubah: `aiPeriod`, suite existing (rantai CI ada).
- Gate lokal: period + chat-usecase lulus, `check` 0/0, eslint + prettier lulus, `diff --check` bersih.
- Batas bukti: CI SHA sama + reviewer belum; tree belum commit.
- Rollback: revert dua file via release berizin.

### AUD-035 2026-10-06 — Passed local (opencode)

- Reproduksi: fetch mentah tanpa timeout/limit; biaya 2 desimal langgar ADR 0001.
- Fix: usecase via gateway (deadline + kontrak aman) + limit 20/10 mnt per user + biaya 4 desimal; fetch langsung hapus; rute tipis.
- Regresi unit usecase (gateway/limit/timeout/malformed/4dp) + E2E HTTP 401/403/aman + burst 429. Gagal beralasan di lama (nol 429), hijau di baru.
- File ubah: usecase baru, rute, parser, suite unit, spec E2E, `package.json` + step CI.
- Gate lokal: unit 2 mode + E2E lulus, `check` 0/0, eslint + prettier lulus, docs/error/maintainability lulus, `diff --check` bersih.
- Batas bukti: CI SHA sama + reviewer belum; tree belum commit. Parse valid live butuh key (unit fake); cabang rute ikut sesi.
- Rollback: revert tujuh file via release berizin.

### AUD-034 2026-10-06 — Passed local (opencode)

- Reproduksi: timeout cuma headers (dok gateway akui); body stall + loop baca + putus klien tanpa batas.
- Fix: `readJson` ikut deadline; `pumpAiStream` total + idle + abort klien + cancel + dispose; attempt teruskan sinyal klien; rute pakai pump + sinyal + enqueue/close aman.
- Regresi di `ai-gateway-tests` 13-18: stall body, idle, trickle, abort, stop, abort-awal. Merah di lama (tanpa ekspor), hijau di baru.
- File ubah: gateway, rute, suite existing (rantai CI ada).
- Gate lokal: suite + ai-chat lulus, `check` 0/0, eslint + prettier lulus, maintainability lulus, `diff --check` bersih.
- Batas bukti: CI SHA sama + reviewer belum; tree belum commit. Smoke rute live butuh provider (AUD-061); sinyal non-stream AI1/2/3 tak diulir.
- Rollback: revert tiga file via release berizin.

### AUD-033 2026-10-06 — Passed local (opencode)

- Reproduksi: aksi asing + amount negatif + target asing lolos parse ke consent; kategori update mentah ke server.
- Fix: `aiRecommendationSchema.ts` kanonik (allowlist aksi/field, amount, id target; buang id/branch model). Parse + apply pakai sama; update validasi amount/tipe + kategori valid-atau-absen; consent tampilkan aksi + nominal + target tervalidasi; prompt wajib category.
- Regresi unit skema + E2E `ai-mutation.spec.ts` mock analyze: jahat gugur, valid sekali, asing 404 tanpa mutasi. Gagal beralasan di lama, hijau di baru.
- File ubah: validator baru, parse, apply, modal, prompt, 2 suite, `package.json` + step CI.
- Gate lokal: unit + E2E lulus, ai-chat-usecase utuh, `check` 0/0, eslint + prettier lulus, docs/maintainability lulus, `diff --check` bersih.
- Batas bukti: CI SHA sama + reviewer belum; tree belum commit. Retry pakai fingerprint existing utuh; cancel tak apply utuh.
- Rollback: revert delapan file via release berizin.

### AUD-032 2026-10-06 — Passed local (opencode)

- Reproduksi: default arah diam — setor modal jadi usaha, ambigu lolos tanpa konfirmasi, consent tanpa kategori.
- Fix: `ledgerCategory.ts` kanonik (eksplisit valid / modal-prive infer / ambigu tolak); service pakai; prompt wajib category + contoh; consent tampilkan badge kategori.
- Regresi unit policy + paritas modal-prive di `ai-report-tests`; E2E `ai-category.spec.ts` mock analyze: badge tampil, modal terapkan jadi Lainnya, ambigu gagal eksplisit. Gagal beralasan di lama, hijau di baru.
- File ubah: policy baru, service, modal, prompt, 2 suite, `package.json` + step CI.
- Gate lokal: unit 2 mode + E2E lulus, `check` 0/0, eslint + prettier lulus, docs/maintainability lulus, `diff --check` bersih.
- Batas bukti: CI SHA sama + reviewer belum; tree belum commit. Update path tak sentuh jenis (tak bisa salah kategori).
- Rollback: revert tujuh file via release berizin.

### AUD-031 2026-10-06 — Passed local (opencode)

- Reproduksi: pajak AI hitung semua income + YTD=0 — YTD600m+100k bayar 0, usaha400m+modal200m bayar 500rb.
- Fix: hapus hitung lokal; pakai `summary.pajak/labaBersih` kanonik (omzet usaha + YTD + segmentasi tahun). Kueri config ganda + impor mesin cabut.
- Regresi di `ai-report-tests`: YTD600m+100k=500, modal=0, lintas tahun paritas. Gagal beralasan di lama, hijau SQLite + D1 di baru.
- File ubah: `reportData` (rantai `test:ai-report` sudah ada).
- Gate lokal: suite 2 mode lulus, tax/cas/report-tax utuh, `check` 0/0, eslint + prettier lulus, error/maintainability lulus, `diff --check` bersih.
- Batas bukti: CI SHA sama + reviewer belum; tree belum commit.
- Rollback: revert dua file via release berizin.

### AUD-030 2026-10-06 — Passed local (opencode)

- Reproduksi: 16 kueri AI baca buku_kas aktif saja — arsip 40000 tak terbaca, total 25000 vs kanonik 165000.
- Fix: inti finansial + hasData dari `buildLaporanAggregate` kanonik (tanpa catch agar gagal merambat, bukan NO_DATA); transaksi arsip dari tabel ringkasan kanonik. Rincian bulanan/produk tetap aktif (tercatat).
- Regresi `ai-report-tests`: paritas kanonik, arsip-only 40000, cabang asing abaikan, NO_DATA kosong, error propagasi. Gagal beralasan di lama, hijau SQLite + D1 di baru.
- File ubah: `reportData`, suite baru, `package.json` + step CI.
- Gate lokal: suite baru 2 mode lulus, ai-chat-usecase + report-tax utuh, `check` 0/0, eslint + prettier lulus, docs/maintainability lulus, `diff --check` bersih.
- Batas bukti: CI SHA sama + reviewer belum; tree belum commit. Pajak YTD milik AUD-031.
- Rollback: revert empat file via release berizin.

### AUD-029 2026-10-06 — Passed local (opencode)

- Reproduksi: header tulis mati `Samarinda` untuk semua sesi; tanpa peta label kanonik.
- Fix: `src/lib/utils/branches.ts` peta lima cabang + alias; header dari cabang profil terautentikasi, loading = `…` netral. Metrik tetap ikut sesi server (otoritas API tak berubah).
- Regresi unit 5 label + unknown netral; E2E `dashboard-branch.spec.ts` 6 tes sesi nyata (lima label + anti-campur + reload). Gagal beralasan di lama (Berau tak tampil), hijau di baru.
- Pelajaran harness: seed tiap baris wajib shard cabangnya (login query shard itu).
- File ubah: util baru, header, suite unit, seed harness, spec E2E, `package.json` + step CI.
- Gate lokal: unit + E2E 6/6 lulus, `check` 0/0, eslint + prettier lulus, docs/maintainability lulus, `diff --check` bersih.
- Batas bukti: CI SHA sama + reviewer belum; tree belum commit.
- Rollback: revert enam file via release berizin.

### AUD-028 2026-10-06 — Passed local (opencode)

- Reproduksi: listener pajak anonim daftar ulang tiap apply tanpa lepas — bocor + reload state mati sesudah destroy.
- Fix: handler pajak bernama + lepas-sebelum-daftar + lepas saat destroy; flag alive jaga callback realtime/refresh; timerdbusuk bersih. Refresh paksa pajak nyata utuh.
- Regresi `e2e/laporan-tax.spec.ts`: satu event = satu refresh (kunci perilaku) + mati abaikan event (diskriminan: merah di lama, hijau di baru). Jujur: tumpuk sinkron runtuh via clearTimeout sehingga hitung-1 lolos di lama; bukti tumpuk = beban listener + reload mati.
- File ubah: `laporanState`, spec E2E (otomatis ikut `test:e2e:all`).
- Gate lokal: spec 2/2 lulus, stores 8 lulus, `check` 0/0, eslint + prettier lulus, `diff --check` bersih.
- Batas bukti: CI SHA sama + reviewer belum; tree belum commit.
- Rollback: revert dua file via release berizin.

### AUD-027 2026-10-06 — Passed local (opencode)

- Reproduksi: query tanpa batas hari + urutan lama-dulu + gagal telan jadi kosong valid.
- Fix: `loadRecentTransactions` kirim batas UTC hari WITA + `direction desc` + limit 5 (cabang/sumber di server). Gagal = state `recentError` + kartu error + tombol muat ulang, bukan kosong.
- Regresi `e2e/catat-recent.spec.ts` ledger nyata: 6 hari ini + 1 kemarin = 5 terbaru urut benar; gagal 500 = error + pulih retry. Gagal beralasan di lama (2/2 merah), hijau di baru. Unit batas WITA tambah di `catat-timezone-tests`.
- Pelajaran harness: snackbar basi + `isSubmitting` diam abaikan klik — serialkan tunggu hilang; menit eksplisit dari jam WITA bukan Node lokal.
- File ubah: `catatState`, kartu Catat, unit zona, spec E2E (otomatis ikut `test:e2e:all`).
- Gate lokal: spec 2/2 lulus, unit zona lulus, `check` 0/0, eslint + prettier lulus, `diff --check` bersih.
- Batas bukti: CI SHA sama + reviewer belum; tree belum commit. Tie semenit UUID acak di luar kontrak order server (terima id DESC; riwayat berbagi kontrak).
- Rollback: revert empat file via release berizin.

### AUD-026 2026-10-06 — Passed local (opencode)

- Reproduksi: default tanggal/jam dari getter lokal perangkat lalu dianggap WITA. Terbukti E2E: Midway tampil sehari mundur, WIB jam meleset 60 menit.
- Fix: default pakai `getTodayWita` + `getNowWita` kanonik (Asia/Makassar eksplisit). Simpan tetap `witaToUtcISO` (sudah benar) — tanggal/waktu eksplisit tak berubah.
- Regresi unit beku 5 instant (tengah malam/bulan/tahun) + round-trip simpan; E2E 2 zona (UTC-11, WIB) cocok WITA kini. Gagal beralasan di lama (2/2 merah), hijau di baru.
- File ubah: `catatState`, suite unit baru, spec E2E, `package.json` + step CI.
- Gate lokal: unit + E2E 2/2 lulus, `check` 0/0, eslint + prettier lulus, docs/maintainability lulus, `diff --check` bersih.
- Batas bukti: CI SHA sama + reviewer belum; tree belum commit. Jendela tengah malam WITA rawan flake detik (toleransi waktu 2 menit, tanggal eksak).
- Rollback: revert empat file via release berizin.

### AUD-025 2026-10-06 — Passed local (opencode)

- Reproduksi: backdrop sheet `onkeyup` + `onkeypress` Enter tutup sheet — Enter di input kasir buang form + nilai.
- Fix: cabut dua handler Enter; Escape satu jalur (action panel; backdrop hanya bila target backdrop sendiri, tanpa double-close). Klik backdrop + swipe + tombol utuh.
- Regresi `e2e/sheet-enter.spec.ts` alur kasir nyata: Enter di input nilai utuh + sheet terbuka, Uang Pas aktif, Escape tutup + URL bayar utuh. Gagal beralasan di lama (sheet hilang sesudah Enter), hijau di baru.
- Sela: warning a11y check 0/1 usai cabut handler — atasi via keydown Escape target-tepat (bukan svelte-ignore, bukan double-close).
- File ubah: `modalSheet.svelte`, spec E2E (otomatis ikut `test:e2e:all`).
- Gate lokal: spec lulus, modal-focus 2/2 lulus ulang, pos-integrity lulus, a11y lulus, `check` 0/0, eslint + prettier lulus, `diff --check` bersih.
- Batas bukti: CI SHA sama + reviewer belum; tree belum commit. Submit ganda antar-caller tercakup komponen tunggal.
- Rollback: revert dua file via release berizin.

### AUD-024 2026-10-06 — Passed local (opencode)

- Reproduksi: tiga overlay tulis tangan tanpa nama (tak temu via accessibility tree), tanpa trap/restore.
- Fix: tiga dialog pindah ke AppModal kanonik (nama heading unik, trap + Escape + restore + inert warisan). Visual dalam utuh (header/form/aksi dipindah byte-identik); transisi ganda panel buang; `fly`/`cubicOut` tak terpakai cabut. Click-outside tetap via AppModal.
- Regresi `e2e/stock-dialogs.spec.ts` 3 tes desktop/mobile: bahan isi-kibor + wrap + Escape + restore, mutasi preview + Escape dari input, hapus Tab + Escape + restore. Gagal beralasan di lama (3/3 nama tak temu), hijau di baru.
- File ubah: `stok/+page.svelte`, spec E2E (otomatis ikut `test:e2e:all`).
- Gate lokal: spec 3/3 lulus, kulakan E2E lulus (tanpa regression preset), a11y lulus, `check` 0/0, eslint + prettier lulus, `diff --check` bersih.
- Batas bukti: CI SHA sama + reviewer belum; tree belum commit.
- Rollback: revert dua file via release berizin.

### AUD-023 2026-10-06 — Passed local (opencode)

- Reproduksi: AppModal hanya ARIA tanpa gerak/trap/restore fokus; sheet punya trap lokal tanpa inert + timer bocor + restore buta.
- Fix: `src/lib/utils/modalFocus.ts` kanonik (initial, Tab wrap via `trapFocusStep` murni, Escape satu jalur, inert latar, restore aman, stack nested, cleanup timer/listener). AppModal + sheet pakai action sama; handler Escape ganda wrapper cabut (Enter sheet milik AUD-025 tak sentuh).
- Regresi `e2e/modal-focus.spec.ts` 2 tes kibor nyata: logout AppModal (trap + wrap + inert + Escape + restore) dan sheet keranjang (trap + inert + Escape + restore). Gagal beralasan di lama (AppModal fokus + inert; sheet inert). Unit `trapFocusStep` tambah di a11y suite.
- Pelajaran harness: pil keranjang mobile-only (viewport 390), label restore via aria, Enter tak buka modal (pakai click).
- File ubah: util baru, dua komponen, unit a11y, spec E2E (otomatis ikut `test:e2e:all`).
- Gate lokal: spec 2/2 lulus, a11y lulus, `check` 0/0, eslint + prettier lulus, error/docs/maintainability lulus, `diff --check` bersih.
- Batas bukti: CI SHA sama + reviewer belum; tree belum commit. Nested dialog implementasi tanpa bukti E2E.
- Rollback: revert empat file + hapus util/spec via release berizin.

### AUD-022 2026-10-06 — Passed local (opencode)

- Reproduksi: `onMount` await load dulu baru subscribe; handler window anonim tak pernah dilepas. Navigasi SPA pergi = yatim panggil halaman mati + ganda tiap mount.
- Fix: subscribe sinkron sebelum fetch (bus + window bernama + 3 realtime), guard `stokMounted` di callback, `removeEventListener` + naikkan generasi load saat destroy.
- Regresi `e2e/stock-lifecycle.spec.ts` 2 tes transisi SPA navbar + observasi request: mati abaikan event + mount tunggal + pergi saat pending tak daftar. Gagal beralasan di lama (2/2 merah fetch yatim), hijau di baru.
- Pelajaran harness: `page.goto` muat ulang dokumen (yatim ikut mati, tes vakum) — wajib tautan SPA agar destroy asli.
- File ubah: `stok/+page.svelte`, spec E2E (otomatis ikut `test:e2e:all`).
- Gate lokal: spec 2/2 lulus, `check` 0/0, eslint + prettier lulus, `diff --check` bersih.
- Batas bukti: CI SHA sama + reviewer belum; tree belum commit.
- Rollback: revert dua file via release berizin.

### AUD-021 2026-10-06 — Passed local (opencode)

- Reproduksi: `loadBahan` tanpa guard — refresh ganda + respons tunda = data basi menang + toast salah + spinner mati. Terbukti E2E: tahan fetch, refresh ganda, lepas marker/error belakangan.
- Fix: generasi per load di `stok/+page.svelte:216`; hanya terkini boleh commit data, toast error, atau finalize loading. Semua caller (awal/refresh/bus/event/realtime) tetap satu flow.
- Regresi `e2e/stock-generation.spec.ts` 2 tes HTTP tunda: timpa-data gagal beralasan di lama (marker tampil), hijau di baru. Varian failure sempat lolos instan di lama karena toast telat >1s; perketat jadi tunggu aktif 5s — probe lama `toastSeen=true`, baru `false`.
- File ubah: `stok/+page.svelte`, spec E2E (otomatis ikut `test:e2e:all`).
- Gate lokal: spec 2/2 lulus, `check` 0/0, eslint + prettier lulus, `diff --check` bersih.
- Batas bukti: CI SHA sama + reviewer belum; tree belum commit. Satu flake infra (startup timeout) coba ulang hijau + temp milik runner bersih.
- Rollback: revert dua file via release berizin.

### AUD-020 2026-10-06 — Passed local (opencode)

- Reproduksi: `getCachedTable` kunci pakai cabang capture tapi fetcher `dbGetStrict` baca cabang malas saat fetch jalan; commit `smartCache` + IDB tulis apa pun yang tiba. Terbukti E2E: tahan respons samarinda, pindah berau, lepas marker — kode lama commit marker ke key samarinda + bangkit sesudah invalidate.
- Fix: `dbGet` terima cabang eksplisit. `SmartCache` epoch commit per key + global + opsi `guard` (commit foreground/background gugur bila guard/epoch gugur). `productService` capture cabang sekali, generasi per key, fetch cabang eksplisit, tulis IDB hanya bila guard hidup. `getPosCatalog` tak tersentuh (validasi cabang respons sudah ada).
- Regresi `e2e/cache-branch.spec.ts` 2 tes modul asli + HTTP tunda: silang cabang + bangkit-sesudah-invalidate. Gagal beralasan pada kode lama (2/2 merah tepat di asersi marker), hijau pada kode baru.
- File ubah: `dataApiClient`, `cache`, `productService`, spec E2E (tanpa skrip/unit baru — E2E terhitung otomatis di `test:e2e:all`).
- Gate lokal: spec baru 2/2 lulus, `stores` 8 + `offline` 40 + `service-pure` lulus, `check` 0/0, eslint + prettier lulus, docs/maintainability lulus, `diff --check` bersih.
- Batas bukti: CI SHA sama + reviewer belum; tree belum commit. E2E satu cabang + simulasi pindah via store (benar-benar ganti konteks fetch); shard silang fisik di luar seed E2E.
- Rollback: revert tiga file + hapus spec via release berizin.

### AUD-019 2026-10-06 — Passed local (opencode)

- Reproduksi: tiga kebijakan beda — login hanya kenal kasir/pemilik + default diam kasir (admin ikut downgrade, respons bilang admin), session store default kasir, store UI null. Admin tak pernah dapat sesi admin; role sampah dapat sesi kasir.
- Fix: `src/lib/utils/roles.ts` kanonik tunggal (`normalizeRole`, trim + lowercase, unknown null). Login pakai helper + unknown fail-closed 401 seragam + respons/sesi pakai role normalisasi. Session store unknown = null sesi. Store UI delegasi ke helper. Admin tak downgrade, tanpa permission bisnis baru.
- Regresi `role-contract-tests`: helper 3 valid + unknown/trim/case, `getAuthSession` tiga role pulang sama + weird null. E2E `auth-enumeration` tambah: admin login role admin + `/api/session` admin, weird 401 + session false, monitoring admin 200 + owner 403. Seed E2E tambah `admin-e2e` + `weird-e2e` aditif per-run.
- File ubah: helper baru, login/session/store, suite unit baru, seed harness, spec E2E, `package.json` + step CI.
- Gate lokal: unit lulus, E2E spec 4/4 lulus, `check` 0/0, eslint + prettier lulus, tenant/error/docs/maintainability lulus, `diff --check` bersih.
- Batas bukti: CI SHA sama + reviewer belum; tree belum commit. UI reload lewat `/api/session` terbukti E2E; paritas store UI by construction (satu implementasi).
- Rollback: revert tujuh file via release berizin. Koreksi false-positive admin tetap di §2.1.

### AUD-018 2026-10-06 — Passed local (opencode)

- Reproduksi: `cache-metrics` + `security-events` pakai history isolate global tanpa tag cabang; ringkasan tercampur lintas cabang pada respons owner.
- Fix: tag `branch` saat collect (sesi atau `anonymous`); ringkasan filter cabang sesi, admin (null) global. Anonim tak masuk view owner. Tanpa sesi tanpa cabang = string kosong fail-closed.
- Regresi `diagnostic-scope-tests` panggil handler asli: dua cabang satu isolate terisolasi, admin global 2/3, anonim tak campur.
- File ubah: dua route, suite baru, `package.json` (`test:diagnostic-scope` + rantai unit), step CI.
- Gate lokal: suite baru lulus, `check` 0/0, eslint + prettier lulus, `tenant-scope`/`docs-drift`/`error-codes`/`maintainability` lulus, `git diff --check` bersih.
- Batas bukti: CI SHA sama + reviewer belum; tree belum commit. Restart isolate bukan bukti persistensi (memori volatil by design).
- Rollback: revert route/suite/package/CI via release berizin.

### AUD-017 2026-10-06 — Passed local (opencode)

- Reproduksi: `branchFromObservation` pakai `?branch=` untuk anonim lalu tulis telemetri ke tabel tenant pilihan; tanpa branch pun fallback ke `samarinda` bila binding ada.
- Fix: sesi ada = cabang sesi otoritas (`?branch=` diabaikan, sesi invalid = null). Tanpa sesi = null (drop, tak tulis ke tenant mana pun). Tanpa default samarinda. `record*` sudah early-return null + try/catch best-effort, tak jadi outage source.
- Regresi `telemetry-scope-tests`: sesi + palsu = sesi, anonim + valid = null, sesi invalid = null, anonim tulis 0 row, terautentikasi masuk cabang sendiri, outage (tanpa platform) tak lempar. SQLite + `--d1` lulus.
- File ubah: `observability.ts`, suite baru, `package.json` (`test:telemetry-scope` + rantai unit), step CI SQLite + workerd.
- Batas bukti: CI SHA sama + reviewer belum; tree belum commit. Jalur login langsung (`veriflogin` branch body) di luar scope kartu (akun percabangan niat, bukan observasi hooks).
- Rollback: revert fungsi + suite + package/CI via release berizin.

### AUD-016 2026-10-06 — Passed local (opencode)

- Reproduksi: `POST /api/veriflogin` kembalikan pesan beda untuk user tak ada (`Username tidak ditemukan`) vs password salah (`Password salah`) — oracle enumeration walau code sama.
- Fix: dua jalur gagal kini kembalikan kontrak publik identik 401 `INVALID_CREDENTIALS` / `Username atau password salah.`. Alasan rinci (`user_not_found` / `password_mismatch`) tetap hanya di audit log server. UI sudah seragam via `errorHandling` (`Username atau password salah.`), tak diubah.
- Regresi `e2e/auth-enumeration.spec.ts`: POST unknown vs wrong-password assert status + body identik persis + kode/pesan stabil; POST kredensial UAT valid 200 sukses. `e2e/auth.spec.ts` 2/2 tetap hijau (pesan baru cocok pola `salah`).
- Batas bukti: unit tsx tak dipakai karena route impor `$app/environment` (hanya resolve di server nyata); bukti HTTP via runner E2E terisolasi. Full E2E + CI SHA sama + reviewer belum; tree belum commit.
- Rollback: revert dua pesan + hapus spec via release berizin.

### AUD-015 2026-10-06 — Passed local (opencode)

- Reproduksi: dua akun satu cabang rebut username baru sama via `POST /api/gantikeamanan` paralel. Kode lama check-before-update lolos dua-duanya lalu dua UPDATE sukses (kembar), tanpa otoritas DB.
- Fix: `profil` jadi `UNIQUE (cabang_id, username)` via `drizzle/0040_profil_unique_username.sql` (drop index lama + create unique, preflight duplikat di komentar). Normalisasi trim exact-match sama dengan login. Route tangkap pelanggaran unik jadi 400 `USERNAME_EXISTS`; batch atomik jaga sesi/password loser utuh. File ubah: schema, migrasi + journal/manifest, route, suite baru, `package.json` (`test:credential-username` + rantai unit), step CI SQLite + workerd.
- Regresi `credential-username-tests`: index UNIQUE ada, beda cabang boleh sama, duplikat langsung ditolak, race 1 menang + 1 `USERNAME_EXISTS`, loser username/password/sesi utuh, klaim ulang tetap kode stabil.
- Gate lokal: suite baru SQLite + `--d1` lulus, `migration-matrix` 41/41 + quick_check ok, `tenant-scope`, `maintainability`, `docs-drift`, `error-codes` lulus, `check` 0/0, eslint + prettier file tersentuh lulus, `git diff --check` bersih.
- Batas bukti: CI SHA sama + reviewer belum; working tree belum commit; base HEAD `3ac4c41` plus perubahan lokal sebelumnya. Migrasi belum apply remote/staging; preflight data/operator tetap wajib. `drizzle-kit generate` tetap gagal seperti sebelum task (manifest malformed pra-ada, bukan regresi).
- Rollback: revert schema/migrasi/route/test/package/CI via release berizin; constraint baru hanya aman bila tanpa duplikat.

### AUD-012 2026-10-06 — Passed local (opencode)

- Reproduksi gagal beralasan: checkout produk lacak lalu suntik pemenang gaya edit metode bayar (bump revision + token) antara baca header void dan batch klaim. Kode lama lempar raw `PRODUCT_VOID_MISMATCH` (trigger void guard / CHECK delta<>0 dari `VALUES ELSE 0`), bukan 409.
- Fix minimal: `produk_mutasi` void pindah ke `INSERT..SELECT..WHERE EXISTS` terikat mutation token klaim, cermin `bahan_mutasi`. Kalah CAS = 0 row, bukan insert delta 0. Constraint `delta<>0` tetap aktif. File ubah: `src/lib/server/services/transaksiKasirService.ts`, regresi di `src/tests/stock-policy-tests.ts` (wrapper raceDb tanpa mutasi objek beku workerd).
- Regresi: loser void assert 409, 0 mutasi void, stok utuh, header utuh. Menang + duplikat tetap hijau via suite existing.
- Gate lokal: `stock-policy` SQLite + `--d1` lulus, `pos-integrity` lulus, `check` 0/0, eslint + prettier file tersentuh lulus, `git diff --check` bersih.
- Batas bukti: CI SHA sama + reviewer belum; working tree belum commit; base HEAD `3ac4c41` plus perubahan lokal AUD-001..011/013/014. Tanpa migrasi/data remote.
- Rollback: revert dua file via release berizin.

Tracker di §6 adalah status terkini; catatan milestone di bagian ini menjelaskan bukti dan batasnya. Status `Passed local` belum berarti `Completed`.

### AUD-040 2026-10-07 — Passed local (opencode)

- Reproduksi: arsip sukses lalu respons hilang (reload) tak bisa unduh ulang — tak ada jalur unduh dari identitas job terverifikasi. Regresi `archive-download-tests` (unit, handler asli): byte + header tepat, cabang/role/job-jalan/traversal/kosong ditolak, objek hilang = 502.
- Fix: `GET /api/archive/download` (branch + pemilik + `job_id`, lookup `archive_jobs` completed scope cabang, stream R2 + `Content-Disposition` + `X-Archive-Sha256/Id`, tanpa key arbitrer). UI arsip: state idle/downloading/downloaded/failed, retry pakai job sama tanpa arsip ulang.
- Temuan nyata saat E2E: (1) helper spec POST ke `/api/sesi-toko` untuk tutup sesi → 400 (kontrak AUD-011 = PATCH); (2) klik SSR sebelum hidrasi = no-op → helper `openArchiveConfirm` klik-ulang sampai dialog tampil; (3) modal konfirmasi ganda menimpa panel inline (overlay intersepsi klik) → hapus modal mati, satu konfirmasi inline; (4) abort jaringan tampilkan `Failed to fetch` mentah → pesan Indonesia tetap.
- File ubah: route download baru, halaman arsip, suite unit baru, spec E2E baru, `package.json` (`test:archive-download` + rantai unit), step CI SQLite + workerd, allowlist maintainability +1 eksplisit.
- Gate lokal: suite baru SQLite + `--d1` lulus; E2E `archive-download.spec.ts` 3/3 lulus (56.9s/31.1s/24.3s full-run, cleanup OK, tanpa `.wrangler`); `check` 0/0; prettier file tersentuh lulus; `tenant-scope`, `docs-drift`, `error-codes`, `maintainability` lulus; `diff --check` bersih (hanya warning CRLF pra-ada).
- Batas bukti: CI SHA sama + reviewer belum; tree belum commit. R2 staging asli + volume legacy butuh operator (catat F7).
- Rollback: revert file via release berizin; tanpa migrasi.

### AUD-042 2026-10-07 — Passed local (opencode)

- Reproduksi: `validateArchive` loloskan `tipe: 'credit'`, `waktu: 'not-a-date'`, nominal negatif/NaN — preflight hijau lalu SQL apply tulis korupsi ke ledger. Gagal beralasan: validasi baru menolak ketiganya + pasangan tipe/jenis + sumber + metode + receipt rusak + qty/detail + count mismatch, semua zero-change.
- Fix: `validateBukuKasBusiness`/`validateTransaksiKasirBusiness` di `restore-archive-lib.mjs` (tipe in/out, jenis trio + pairing cermin AUD-005, sumber pos/catat/stok, waktu parseable, nominal finite >= 0 <= MAX_SAFE_INTEGER tanpa ubah snapshot historis, metode tunai/non-tunai/qris bila ada, receipt harus JSON valid bila ada, detail jumlah > 0 + nominal wajib + orphan/cabang). Toleransi sadar: metode null (kolom nullable historis), deskripsi bebas, HPP 4dp tak disentuh.
- Bonus preflight: CLI tolak versi `[1,2]` padahal writer kanonik emit v3 (AUD-041) — gerbang disamakan `[1,2,3]` agar arsip kini restorabel; decoder lama tetap tolak versi baru by design.
- File ubah: `restore-archive-lib.mjs`, `restore-archive.mjs` (gerbang versi), regresi di `restore-apply-tests.ts` (rantai CI ada).
- Gate lokal: suite SQLite + `--d1` lulus; guard/usecase/restore lama lulus; `check` 0/0; prettier + `diff --check` bersih.
- Batas bukti: CI SHA sama + reviewer belum; tree belum commit. Bounded staging/execution tetap AUD-043.
- Rollback: revert tiga file via release berizin; tanpa migrasi.

### AUD-043 2026-10-07 — Passed local (opencode)

- Reproduksi: CLI baca preflight satu wrangler per 50 ID (20rb baris = 800 subprocess) lalu satu `--file` tak berbatas — gagal tengah = partial state, tanpa resume.
- Fix: `planRestore` tunggal (validasi + guard + insert satu sumber; `buildRestoreSql` kini merakit dari plan, tanpa dua implementasi) + `buildRestoreChunks` (default 100 baris/chunk, jauh di bawah batas variabel SQLite 999): tiap chunk BEGIN/COMMIT sendiri berisi guard barisnya + summary guard + insert idempoten + counter MAX + marker upsert (semua aman-ulang). CLI: preflight penuh dulu (baca 200 ID/chunk), dry-run cetak rencana, apply per-chunk dengan checkpoint `tmpdir/restore-<sha12>/chunk-<i>.done`, ulangi perintah = resume. Arsip kecil = satu chunk; paritas statement vs single-shot dibuktikan tes.
- Gagal beralasan di lama: chunk/crash/resume hijau di baru (SQLite + workerd D1).
- File ubah: `restore-archive-lib.mjs` (plan + chunk), `restore-archive.mjs` (chunk apply + checkpoint + `--chunk-rows`), suite baru `restore-chunk-tests.ts`, `package.json` + step CI SQLite + workerd.
- Gate lokal: chunk + apply + guard lama lulus 2 mode; `check` 0/0; prettier + `diff --check` bersih; docs/maintainability lulus.
- Batas bukti: CI SHA sama + reviewer belum; tree belum commit. Eksekusi CLI nyata + volume legacy butuh operator (F7).
- Rollback: revert lima file via release berizin; tanpa migrasi.

### AUD-044 2026-10-07 — Passed local (opencode)

- Reproduksi: `assertBackupCoversBranch` hanya cek file ada + binding tercantum — manifest palsu (`shards: []` tanpa file, bukan-JSON) lolos sebagai "backup" sebelum DELETE.
- Fix: pakai ulang satu verifier kanonik `verifyManifest` dari `d1-backup.mjs` (path absolut luar repo/workspace tolak traversal/symlink, schema v1, tepat 3 shard cocok id produksi, readback SHA per file) + wajib penanda COMPLETE + cakupan binding cabang. Seluruh preflight tetap sebelum mutasi pertama; konfirmasi eksplisit tak berubah.
- File ubah: `wipe-branch-history.mjs`, regresi `wipe-branch-history.test.mjs` (fixture backup nyata 3 shard + COMPLETE; palsu/parsial/rusak ditolak).
- Gate lokal: `test:d1-wipe` 7/7 lulus; `check` menyusul di gate cohort.
- Batas bukti: CI SHA sama + reviewer belum. Tanpa mutasi remote di test (executor palsu).
- Rollback: revert dua file via release berizin.

### AUD-045 2026-10-07 — Passed local (opencode)

- Reproduksi: hapus 15 tabel via 15 remote call berurutan + verifikasi terpisah — gagal tengah = histori parsial, sibling berisiko.
- Fix: `buildWipeSql` murni — satu transaksi (BEGIN/COMMIT) berisi 15 DELETE anak-dulu + guard nol per tabel (`WIPE_REMAIN`), semua ter-scope `cabang_id`. CLI: preflight hitung + guard arsip dulu, lalu TEPAT SATU `--file` apply, lalu baca verifikasi pelaporan. Gagal apply/inkonsisten = throw tanpa klaim sukses.
- File ubah: `wipe-branch-history.mjs`, regresi `wipe-branch-history.test.mjs` (satu call, urutan, scope tanpa DELETE telanjang, guard per tabel, failure injection, cabang tak dikenal).
- Gate lokal: `test:d1-wipe` 9/9 lulus; `test:d1-backup` 9/9 utuh (verifier tak tersentuh).
- Batas bukti: CI SHA sama + reviewer belum. Eksekusi remote + konkurensi SQLite/workerd butuh operator (F7).
- Rollback: revert dua file via release berizin.

### AUD-046 2026-10-07 — Passed local (opencode)

- Reproduksi: drill hanya hitung tabel — dump satu-tabel/incomplete/orphan tetap PASS.
- Fix: `checkDrillDatabase` mewajibkan kolom POS aktual, integrity/quick_check ok, orphan domain nol (cermin dataHealth; FK-only bukan pengganti), stok negatif nol, pasangan nomor lengkap, counter >= MAX aktual. Mode `--d1`: parse SQLite dulu lalu salin baris ke D1 terisolasi + cek data-scope di workerd. CLI smoke PASS pada fixture; cleanup milik drill.
- File ubah: `restore-drill-local.mjs`, suite `restore-drill-local.test.mjs` (7 SQLite + 1 workerd + kontrak), `package.json` (`test:d1-drill` + rantai `test:operations`).
- Gate lokal: drill 9/9 lulus (SQLite + workerd); CLI smoke PASS; prettier bersih.
- Batas bukti: CI SHA sama + reviewer belum. Drill backup produksi nyata butuh operator (F7).
- Rollback: revert tiga file via release berizin.

### AUD-047 2026-10-07 — Passed local (opencode)

- Reproduksi: CLI tanpa sumber (usage exit 0) cari `backups/` di repo — bertentangan kebijakan eksternal; flag runbook `(--shard [--live] [--apply])` picu discovery itu; `execSync` interpolasi path rawan injeksi.
- Fix: tulis ulang CLI — sumber eksplisit saja (`--file` absolut eksternal atau `--backup-manifest` verifier kanonik + COMPLETE + file shard target), usage invalid exit 2, shard/file salah/drill gagal fail-closed pre-mutasi, default dry-run uraikan target + nol mutasi, apply satu spawn array `--file` (tanpa shell). Runbook §4 disinkron ke ejaan baru.
- File ubah: `rollback-migration.mjs`, suite `rollback-migration.test.mjs` (usage nonzero, parse, file hilang/kosong/rusak, dry-run nol-spawn, apply satu-spawn + gagal exit 1, manifest rusak), `package.json` (`test:rollback` + rantai operations), runbook §4.
- Gate lokal: rollback 6/6 lulus; prettier bersih.
- Batas bukti: CI SHA sama + reviewer belum. Rehearsal rollback staging nyata butuh operator (F7).
- Rollback: revert empat file via release berizin.

### AUD-049 2026-10-07 — Passed local (opencode)

- Reproduksi: `await Promise.all([audit, publish...])` tanpa deadline + `consumeDurableRateLimit` fetch DO tanpa timeout — stub gantung = respons checkout gantung selamanya (terbukti debug: sale tak kembali; nohub 134ms).
- Fix: `settlePostCommitEffects` baru (budget 5s, timer ref'd + cleanup, allSettled tanpa unhandled rejection); `publishBranchEvent` timeout 3s (AbortSignal + timer backstop untuk stub abaikan-signal); `consumeRateLimit` DO timeout 2s → fallback D1. Checkout hung-stall kini kembali ~5.2s, sale tepat satu, retry idempoten. Timer `unref` DITOLAK — buktikan ia mematahkan budget (loop kosong keluar sebelum timer).
- File ubah: `postCommit.ts` baru, `realtimePublisher.ts`, `rateLimit.ts`, `checkoutUseCase.ts` (1 call), suite `post-commit-tests.ts`, `package.json` + step CI SQLite + workerd.
- Gate lokal: post-commit SQLite + `--d1` lulus; pos-integrity, stock-policy, realtime lulus; `check` 0/0; prettier bersih.
- Batas bukti: CI SHA sama + reviewer belum. Budget worst-case ~7s (2s ratelimit + 5s settle) dinyatakan, bukan diukur beban nyata (AUD-057).
- Rollback: revert enam file via release berizin; tanpa migrasi.

### AUD-050 2026-10-07 — Passed local (opencode)

- Temuan: Pages (`wrangler.pages.jsonc`) tanpa REALTIME_HUB — binding hidup di `wrangler.jsonc` (script_name → worker realtime) + dashboard; patch `_worker.js` berupa text-insert rapuh tanpa verifikasi pasca-tulis.
- Fix: `export-durable-objects` murni + idempoten (`patchWorkerText`/`verifyPatchedWorker` terekspor, guard CLI agar import aman) + verifikasi baca-balik artifact (marker tepat 1x + hookup). `deploy:check` kini gagalkan drift: paritas database_id Pages↔realtime per binding + cron relay/cleanup. Paritas sesi: intercept samakan route (cookie sid + prefix cabang + expiry + 401/503); tanpa cek role di keduanya by design (kanal invalidasi; data lewat API role-gated).
- Bukti build nyata: `pnpm build` lulus; `_worker.js` marker 1x + hookup; skrip cetak verifikasi.
- File ubah: `export-durable-objects.mjs`, `verify-cloudflare-deploy-config.mjs`, suite `realtime-artifact.test.mjs`, `package.json` (`test:realtime-artifact` + rantai operations).
- Gate lokal: realtime-artifact 3/3 lulus; build produksi lulus; prettier bersih.
- Batas bukti: CI SHA sama + reviewer belum. Smoke websocket/heartbeat/fanout staging + urutan deploy butuh operator (F7).
- Rollback: revert empat file via release berizin; tanpa migrasi.

### AUD-051 2026-10-07 — Passed local (opencode)

- Reproduksi: drain outbox LIMIT 100/hari tanpa loop (backlog abadi); retensi hanya 2 tabel; delivery/event/device notifikasi tanpa retensi (tumbuh tanpa batas).
- Fix: drain loop halaman 100 x maks 10/run + hitung terdrain; retensi 90 hari terdokumentasi untuk audit_logs/request_metrics/error_events/karantina + teknis notifikasi (delivery terminal by next_attempt_at, event tua tanpa ref pending/leased, device nonaktif kedaluwarsa). pending/leased TAK PERNAH dihapus; ledger/struk/arsip tak tersentuh.
- Pelajaran debug: payload tanpa entityType membuat SEMUA baris poison (gagal INSERT → attempt+1 → putar 10 halaman); fixture valid wajib. Bukan bug drain.
- File ubah: `realtimeWorker.js`, suite `retention-tests.ts` (drain-250 + retensi + pending/leased aman), `package.json` + step CI SQLite + workerd.
- Gate lokal: retention SQLite + `--d1` lulus; `check` 0/0; prettier bersih.
- Batas bukti: CI SHA sama + reviewer belum. Throughput cron produksi + backlog raksasa butuh observasi operator.
- Rollback: revert empat file via release berizin; tanpa migrasi.

### AUD-054 2026-10-07 — Passed local (opencode)

- Audit gate: tanpa `.skip`/`.todo`/fixme di unit+E2E; tanpa hitungan suite lawas di-pin; `readFileSync` tersisa hanya kontrak konten (docs/manifest/SQL/migrasi) + fixture, bukan mock perilaku; orkestrasi tunggal (test:all→test:release, CI build terminal, tanpa siklus unit→build→unit).
- Fix: `docs-drift` kini tegakkan rantai hidup — tiap entri test:unit/test:operations wajib script ada + target file ada. Gagal beralasan pada rantai sintetis mati; hijau pada rantai nyata (50+ unit, 8 operasi).
- File ubah: `docs-drift-tests.ts`.
- Gate lokal: docs-drift lulus; `check` 0/0; prettier bersih.
- Batas bukti: CI SHA sama + reviewer belum. Failure-injection CI (red-check) ranah operator.
- Rollback: revert satu file via release berizin.

### AUD-055 2026-10-07 — Passed local (opencode)

- Temuan (verifikasi kode vs docs): login disebut PBKDF2/Argon2 padahal bcryptjs (PIN yang PBKDF2); role disebut hanya 2 padahal kanonik 3 (AUD-019); AGENTS.md pin 29 suite/22 tes padahal rantai kini 57 entri + 29 spec; arsip tanpa versi/budget (writer v3, chunk 50/1MB/10, restore 100 + resume).
- Fix: GUIDE auth (bcrypt + 3 role + batas Antrean), GUIDE arsip (v3/decoder 1–3/budget/restore chunk), AGENTS tanpa angka pin. FK/D1, HPP 4dp, path CLI/backup, perintah `rtk` sudah sinkron — tanpa klaim baru.
- Gate lokal: docs-drift lulus; migrasi dry-run 41/41 checksum cocok; prettier + `diff --check` bersih.
- File ubah: `DEVELOPER-GUIDE.md`, `AGENTS.md`.
- Batas bukti: CI SHA sama + reviewer belum.
- Rollback: revert dua file via release berizin.

### AUD-052 2026-10-07 — Passed local (opencode)

- Temuan saat eksekusi: 7 vuln (2 high: source-map-js 1.2.1, sharp 0.35.4; 3 moderate: brace-expansion 2.1.6/5.0.11, postcss-selector-parser 7.1.3; 2 low: dompurify 3.4.14 x2). Override lama PIN versi rentan (advisory terbit sesudah pin).
- Fix: override minimal preseden repo — sharp 0.35.5, brace-expansion 2.1.7/5.0.12, postcss-selector-parser 7.1.6, source-map-js 1.2.2, dompurify 3.4.16. Tanpa force-update stack.
- Reachability: semua dev-tooling (vite/postcss/eslint/miniflare) kecuali dompurify (optional via jspdf client-side, sanitasi SVG laporan; tanpa bukti exploit = tanpa klaim exploit).
- Gate lokal: audit high+ bersih; audit json SELURUH severity 0; frozen-lockfile lulus; receipt-output lulus; build produksi lulus + PWA 160 entry.
- File ubah: `pnpm-workspace.yaml`, `pnpm-lock.yaml`.
- Batas bukti: CI SHA sama + reviewer belum.
- Rollback: revert dua file via release berizin.

### AUD-048 2026-10-07 — Passed local (opencode)

- Reproduksi: `startsWith('http://localhost')` anggap `localhost.audit.invalid`, `127.0.0.1.evil`, userinfo sebagai lokal — lalu baca `.env` dan POST kredensial ke host asing; redirect fetch default bisa pindahkan kredensial.
- Fix: `scripts/uat-target.mjs` bersama — parse URL, hostname loopback EXACT (127.0.0.1/::1/localhost, IPv6 dinormalisasi), tolak userinfo/skema asing/lookalike SEBELUM password dibaca atau fetch, https hanya dengan ALLOW_REMOTE_UAT=1, fetch credential-bearing `redirect: 'error'`. `uat-pos-integrity.mjs` pakai guard + wrapper.
- File ubah: guard baru, CLI UAT, suite `uat-target.test.mjs` (exact/lookalike/remote/CLI asli), `package.json` (`test:uat-target` + rantai operations).
- Gate lokal: uat-target 4/4 lulus (termasuk CLI asli tolak lookalike pre-network).
- Batas bukti: CI SHA sama + reviewer belum. Windows+Ubuntu + intersepsi transport tercakup pattern operasi; tanpa secret nyata.
- Rollback: revert empat file via release berizin.

### AUD-056 2026-10-07 — Passed local (opencode)

- Diagnosis: blob HEAD LF-only (terbukti `git show`); CRLF hanya working copy basi pre-`.gitattributes` — `_journal.json` 293 CRLF + `pnpm-workspace.yaml` 30 CRLF. Perbaikan: normalisasi EOL 2 file itu saja (konten jurnal 0038–0040 utuh); runtime/assets/SQL/backup/arsip tetap raw exact; file basi lain tak disentuh.
- Bukti fresh-checkout: `git worktree` HEAD → journal/manifest/pnpm-workspace/package/wrangler.pages 0 CRLF; worktree dibuang. Tanpa patch salinan manual.
- Gate lokal: migration-matrix 41/41 + quick_check ok; release-gate 10/10 lulus; `diff --check` tanpa warning journal.
- Batas bukti: CI SHA sama (Linux LF) + reviewer belum.
- Rollback: revert via release berizin.

### AUD-053 2026-10-07 — Blocked slice 1 (opencode)- Alasan block: refactor halaman raksasa hanya aman per slice dengan CI hijau sebagai jaring.

Slice berikut butuh `test:release` penuh + CI SHA sama hijau + reviewer: sisa stok script,
pos cart orchestration, manajemenmenu, 28-route allowlist (038+ baris inti tak tersentuh slice ini).

- Slice 1 selesai lokal: `stockHealth.ts` murni (getStockHealth verbatim + predikat low-stock
  tunggal gantikan 2 derived ganda + filter/hitung/opsi kategori) dipakai halaman stok;
  halaman 2173→2064 baris, tanpa ubah perilaku. Regresi `stock-health-tests.ts` (5 status,
  predikat, filter, kategori) + `test:stock-health` rantai unit + step CI.
- Gate lokal slice: unit baru lulus; kulakan E2E 1/1 lulus (48.7s); stock-policy lulus;
  `check` 0/0; maintainability (max 2064 ≤ 2200) + docs-drift lulus; prettier bersih.
- File ubah: `stockHealth.ts` + suite baru, halaman stok, `package.json` + step CI.
- Buka block: gate F8 hijau → lanjut slice 2 per file owner tunggal.

### AUD-058..062 2026-10-07 — Blocked operator (opencode)

- Sisi kode/test selesai dan terverifikasi lokal: detector `dataHealth.ts` + `test:data-health`
  (058); backup COMPLETE/readback + drill + rollback CLI + migrasi dry-run 41/41 (059);
  notifikasi cursor/origin/visibility + push generik + cron/lease/backoff (060);
  gateway deadline/fallback + schema consent + HPP via gateway (061);
  snapshot permanen + HTML/ESC-POS + jalur reprint kanonik (062).
- Block: tanpa target staging/produksi, kredensial Cloudflare, VAPID/device fisik,
  quota AI, dan printer fisik — bukti §§10–11 mensyaratkan itu dan dilarang diakali
  simulasi. Nol mutasi produksi dilakukan sesi ini.
- Buka block: identitas target + approver + backup COMPLETE + jadwal staging (runbook §§1–11).

### F8 gate 2026-10-08 — perbaikan CI dari 2 run merah (opencode)

- Run 37685021672: (1) file prasyarat AUD-014 belum commit (receiptSnapshot/dataLoader) +
  (2) `realtime-artifact` panggil deploy:check tanpa env CI. Fix: commit fondasi +
  env dummy non-secret pada test.
- Run 37705951214 (static/operasi/unit/quality hijau): E2E 96/107. Triase 11 gagal:
  (a) pesan 503/AI memuat nama `OPENROUTER_API_KEY` (kontrak AUD-037) → pesan tanpa identifier
  di hpp-parse + aichat; (b) redirect anonim flaky (menu/pajak, guard client vs hidrasi) →
  `+page.server.ts` 302 anonim pada 2 halaman online-only (API tetap otoritas role);
  (c) polusi antar-spec ai-category→ai-mutation (75000 sama di DB server bersama) →
  fixture unik 75001; (d) kaskade login 429 (60/IP + 15/user per 15 mnt vs ~~100 login
  se~~11 mnt CI): suite 107 tes dipecah 3 grup (36/36/35) @ server+DB terisolasi
  (`test:e2e:ci-a/b/c`), tanpa ubah tes/assertion/limit. cache-branch:88 flaky
  antar-run (lolos solo 2x + grup) — pantau, bukan redakan.
- File ubah: 2 pesan error, 2 page.server guard, fixture ai-mutation, script grup + CI
  (timeout e2e 25→45 mnt).
- Lanjutan: catat-recent hermetik (cleanup ledger ber-CSRF + retry ECONNRESET;
  polusi AI terbukti via probe, CSRF sekali-pakai tertangkap 403 eksplisit);
  cache-branch:88 flaky khusus workstation multi-tes (lolos solo/CI/instrumen;
  guard terbukti airtight per interleaving — pantau, tanpa ubah kode hijau).

### AUD-057 2026-10-07 — Passed local (opencode)

- Budget dinyatakan dulu (workstation Windows/Node 26.8.1, SQLite lokal, kandidat ini):
  restore chunk-apply ≤15s/100 baris; laporan ≤2s/≤10rb baris; checkout normal ≤2s,
  stall penuh bounded ≤7s (2s ratelimit + 5s settle). Bundle 445KB max-chunk DICATAT, bukan bukti UX.
- Ukur: chunk-plan 2000 baris 144ms (20 chunk); apply 2000 baris 3973ms (~500 baris/s);
  agregat laporan 2000 baris 142ms paritas exact 21.999.000; checkout normal 134–222ms;
  checkout stall-hang 5201ms (satu sale, bounded). Semua dalam budget dengan headroom besar.
- Batas bukti: lokal saja. Cold/warm browser, Worker/D1 terkompilasi, arsip 22rb legacy,
  dan trafik produksi butuh staging + observasi operator. Fixture tak dikecilkan.
- Rollback: tanpa perubahan kode (catatan bukti saja).

## 13. Referensi kontrak dan vendor

- [Panduan developer](../DEVELOPER-GUIDE.md), [operator runbook](OPERATOR-RUNBOOK.md), [roadmap historis](../ENGINEERING-IMPROVEMENT-PLAN.md).
- [ADR uang REAL dan HPP 4 desimal](adr/0001-money-storage.md), [ADR realtime outbox](adr/0002-realtime-outbox.md), [ADR foreign keys yang perlu dikoreksi](adr/0003-foreign-keys.md), [ADR notifikasi Antrean](adr/0004-antrean-notifications.md).
- [Cloudflare D1 foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [Worker limits](https://developers.cloudflare.com/workers/platform/limits/), [Pages Wrangler configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/).
- [brace-expansion advisory](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr), [DOMPurify advisory](https://github.com/advisories/GHSA-p98j-92pf-mc4p).
