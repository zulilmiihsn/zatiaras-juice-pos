# Pelaksanaan roadmap kualitas

Tanggal mulai: 19 Oktober 2026. Target mengikuti rubrik tetap pada
[roadmap 9,8](QUALITY-ROADMAP-9-8.md). Bukti lokal, runtime workerd, dan CI
dibedakan di bawah. Penerimaan rilis tetap memerlukan CI hijau pada SHA
kandidat yang akan dipromosikan.

## Milestone yang sudah disimpan

| Commit    | Tujuan                                       | Bukti lokal                                                                                   |
| --------- | -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `0aa5dcf` | Roadmap dan kriteria audit                   | Prettier dan pemeriksaan whitespace                                                           |
| `80fa73d` | Root kanonik runner E2E Windows              | Dua reproduksi gagal sebelum perbaikan; 16 tes runner lulus sesudahnya                        |
| `384cbf0` | Cache opsional tidak membuang hasil jaringan | Empat reproduksi gagal sebelum perbaikan; seluruh 19 tes cache/isolasi lulus sesudahnya       |
| `93840ee` | Keluaran Android dikecualikan dari formatter | Lint root lulus; manifest TWA sumber tetap diperiksa                                          |
| `dcd66bb` | Tes state menjalankan store Svelte asli      | Enam kontrak state dan perbandingan kalkulator cart produksi lulus; cache fixture dibersihkan |
| `912b15b` | Kontrak intent dan uang                      | Batas angka, seluruh field bisnis, dan enam mutasi source terisolasi terdeteksi               |
| `4aad67b` | Batas kepercayaan revisi stok legacy         | Reproduksi bypass review pemilik dan revisi consent usang; kontrak SQLite dan D1              |

Perbaikan runner diperlukan karena cwd Windows `D:\projects\zatiaraspos`
dan path fisik `D:\Projects\zatiaraspos` menghasilkan dua URL untuk modul
yang sama: `/src/...` dan `/@fs/...`. Trace browser menunjukkan dua instance
state/cache. Root fisik kini diteruskan ke proses server dan browser.
Assertion isolasi cabang dipertahankan.

Cache produk, kategori, tambahan, katalog POS, dan statistik dashboard kini
mengisolasi kegagalan baca/tulis IndexedDB opsional. Test browser juga
memastikan katalog beda cabang atau rusak tetap ditolak, kegagalan jaringan
tetap ditangani, dan antrean transaksi gagal tersimpan tidak menghasilkan
acknowledgement sukses.

## Bukti CI milestone pertama

[CI 39234809836](https://github.com/zulilmiihsn/zatiaras-juice-pos/actions/runs/39234809836)
menguji SHA `93840eee62861cfda1998f5d06ee2db8efe2dde6`.

- Static, operations, unit, dan seluruh E2E lulus.
- Build aplikasi serta smoke realtime, scheduled worker, dan ledger browser
  terkompilasi selesai; langkah berikutnya mencapai pembuatan manifest.
- Run keseluruhan gagal karena manifest rilis menolak branch
  `codex/quality-9-8-hardening`. Preflight memang hanya menerima `main`
  atau `release/*`.
- Guard tersebut tidak dilonggarkan. Kandidat akhir disiapkan pada
  `release/quality-9-8-hardening` untuk verifikasi artefak yang sesuai
  kontrak rilis. Belum ada deployment produksi.

## Penguatan kontrak yang sedang diselesaikan

### Identitas intent dan uang

Tes baru menguji kesetaraan format intent, perubahan seluruh field bisnis,
alias nama custom, batas angka uang, negative underflow, dan overflow
desimal sebelum pembulatan. Enam mutasi terhadap salinan source fingerprint
di direktori sementara harus terdeteksi oleh assertion yang sama. Mutasi
tidak dijalankan pada source working tree.

### Batas kepercayaan replay stok

Dua masalah tambahan direproduksi menggunakan transisi kebijakan dan
rekonsiliasi database yang sebenarnya:

1. Angka revisi legacy yang tidak bertanda tangan dapat menyatakan revisi
   terkini dan melewati review pemilik setelah kebijakan berubah.
2. Menarik persetujuan setelah siklus kebijakan berikutnya tidak
   memperbarui revisi tinjauan, sehingga persetujuan berikutnya masih
   merujuk kebijakan lama.

Perbaikan memisahkan revisi terverifikasi dari metadata legacy. Cabang
yang tidak pernah mengalami transisi tetap mendukung antrean lama.
Setelah transisi, revisi tanpa bukti tanda tangan memerlukan review pemilik;
antrean tetap dipertahankan. Penarikan persetujuan mengambil revisi kebijakan
cabang saat itu dalam satu statement atomik.

Sepuluh kontrak lulus pada SQLite dan workerd D1. Bukti workerd memakai
entry script langsung dengan `--d1`, mencetak backend, dan memeriksa
kapabilitas D1. Percobaan awal memakai `node --test ... --d1` ternyata
menyaring argumen script dan hanya menjalankan SQLite; percobaan tersebut
tidak dihitung sebagai bukti D1.

Review lanjutan juga mengikat waktu antrean pada consent, menolak epoch baru
untuk penjualan yang lebih lama, dan memeriksa ulang intent setelah konflik
INSERT paralel. Kontrak fingerprint, cabang, dan waktu tetap berlaku ketika
penulis lain menang di antara pre-read dan readback.

### Validasi konfigurasi pajak

Tes boundary tambahan menemukan ID pajak nonteks yang diterima validator.
Objek JSON dengan properti `toString` tertentu juga dapat menyebabkan
exception saat nilai dimasukkan ke pesan validasi. Validator kini
mensyaratkan ID teks nonkosong dan menghasilkan pesan tanpa mengonversi
objek mentah. Rumus, nilai nol eksplisit, threshold custom, dan adaptasi
legacy tetap diuji.

Verifikasi handler mencakup request anonim, input malformed, penulisan
lintas cabang, serta pemeriksaan bahwa revisi dan konfigurasi tidak
berubah setelah request ditolak. Tiga tes browser handler lulus; rumus pajak
tidak diubah.

### Cache sesi dan batas storage opsional

Logout menghapus cache memori/IndexedDB yang dapat dimuat ulang, termasuk
snapshot finansial legacy, dan menaikkan epoch commit sebelum menunggu IO.
Antrean transaksi offline pada store bernama dan key legacy dipertahankan.
Login berhasil juga memulai cache sesi baru. Respons katalog terlambat tidak
dapat menciptakan ulang snapshot sesudah logout.

Query lanjutan dashboard memakai cabang yang ditangkap saat request dimulai.
Reproduksi browser semula menunjukkan dua query stok beralih ke cabang baru;
assertion yang sama lulus sesudah argumen cabang diteruskan eksplisit.
Storage cache opsional memiliki deadline 2 detik. Deadline ini tidak dipakai
untuk acknowledgement antrean transaksi yang harus durable.

### Boundary payload dan upload

Login menolak credential nonteks dengan 400 dan branch normalizer menolak
coercion objek. Skema input tidak mengubah pesan anti-enumeration, bcrypt,
atau kebijakan rate limit yang sudah ada.

Parser multipart membaca byte terbatas sebelum alokasi form. Request maksimal
5 MiB ditambah overhead 256 KiB; gambar tetap maksimal 5 MiB. Handler menolak
anonim/kasir sebelum membaca body. Enam kontrak parser/handler mencakup header
ukuran palsu, stream kebesaran yang dibatalkan, byte biner, form rusak,
signature MIME, UTF-8 terpotong, dan kepemilikan cabang.

### Kebijakan uang dan cakupan kritis

Decoder dan normalisasi uang dipindahkan utuh ke `money.ts`. `currency.ts`
mempertahankan public API melalui reexport dengan ekstensi `.ts`, termasuk
bagi recovery CLI native. Tidak ada perubahan algoritme atau tipe kolom.
Restore apply/chunk native dan D1 tetap menjadi gate.

Gate coverage terpisah mengukur sembilan modul domain melalui loader TSX
tunggal. Semua ambang pada `coverage-policy.mjs` dipenuhi pada Node 24.20.0;
tes tambahan memakai DB sebenarnya untuk preview arsip yang read-only,
cutoff WITA, cabang asing, pencabutan sesi/PIN, dan role eksak.
Laporan JSON mengandung counter dan runtime; lima kontrak failure injection
menolak evidence hilang, usang, malformed, atau child yang gagal.

## Peta kontrak dan bukti kanonik

| Kontrak                       | Suite yang menjalankan perilaku asli                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Uang, HPP, intent, receipt    | `checkout-policy`, `pos-integrity`, `ingredient-yield`, `receipt-output`, `report-tax`; enam mutasi source fingerprint                           |
| Tenant, role, sesi, PIN, CSRF | `tenant-scope`, `auth-service`, `role-contract`, `session-renew`, `page-lock`, `csrf-contract`, compiled native HTTP                             |
| Stok dan replay offline       | `stock-replay-contract` SQLite/D1, `stock-reconciliation`, `stock-offline-review`, `offline`, browser Antrean/POS                                |
| Arsip dan restore             | `archive-usecase`, `archive-guard`, `archive-chunk`, `archive-download`, `restore-apply`, `restore-chunk`; readback/failure/concurrency/D1       |
| Cache dan lifecycle           | `service-pure`, store Svelte asli, `cache-storage`, `cache-branch`, `dashboard-branch`, `stock-generation`                                       |
| AI                            | `ai-gateway`, `ai-chat-usecase`, `ai-mutation`, malformed/timeout/fallback/abort/branch; provider dipalsukan pada boundary, tanpa model berbayar |
| Rilis dan pemulihan           | operations suites, manifest/preflight/rollback/drill, smoke realtime/scheduled/ledger browser dari artefak terkompilasi                          |

## Review keamanan dan keputusan yang dipertahankan

Review boundary mengikuti auth service/session reader, API role/branch, page
access, CSRF, rate limit, payload allowlist, parser body, upload, rendering
Markdown, dan AI gateway. Sesi memakai otoritas profil terkini. Role tak
dikenal ditolak; admin tidak otomatis memperoleh akses pada kebijakan
`requireExactRole`. Rate limit memakai DO dengan timeout dan fallback UPSERT
D1 atomik; kegagalan keduanya menolak request. Markdown meng-escape teks
sebelum menambahkan tag tetap, tanpa atribut atau URL dari output model.
Gateway AI memusatkan timeout/abort/fallback, batas body, budget gratis, dan
redaksi credential. Tidak ada perubahan spekulatif pada boundary yang sudah
memenuhi kontrak dan memiliki tes negatif.

ADR 0001–0003 tetap berlaku: uang `REAL` dengan normalisasi boundary,
invalidasi realtime umum best-effort setelah commit, dan enforcement FK
legacy menunggu preflight/migrasi yang disetujui. Ketiganya bukan bug yang
ditutup dengan mengganti tipe atau mengaktifkan constraint tanpa rehearsal.
Guard arah dependensi, nol explicit `any`, nol catch kosong, dan route tanpa
import DB diperiksa bersama review semantik; metrik tersebut tidak dipakai
sebagai pengganti review tanggung jawab modul.

## Performa dan pemulihan yang sudah diukur

Workload 365 hari dijalankan pada Node 24.20.0 dengan D1/workerd lokal dan
objek arsip di disk sementara. Dataset berisi 182.500 penjualan, 182.500
detail POS, serta 3.650 transaksi manual. Tidak ada resource produksi atau
model AI eksternal yang dipanggil.

| Pengukuran                    | Hasil                                                                                      | Budget/scope                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Checkout di atas data setahun | p50 381 ms; p95 504 ms; maksimal 592 ms                                                    | p95 di bawah 2.000 ms                                      |
| Laporan setahun, tiga run     | 1.864 / 1.125 / 1.366 ms                                                                   | Seluruh run di bawah 5.000 ms                              |
| Arsip                         | 65 panggilan; 193 objek; panggilan terlama 27.170 ms                                       | Wall-clock use case lokal di bawah 30.000 ms per panggilan |
| Ukuran objek arsip            | Maksimal 1.619.673 byte; total 311.780.386 byte                                            | Batas satu snapshot 2.000.000 byte                         |
| Restore                       | 193 bagian; total 640.923 ms; bagian terlama 36.175 ms                                     | Orkestrasi recovery CLI/Node; bukan request HTTP Worker    |
| Paritas workload besar        | Pendapatan laporan dan jumlah seluruh header/detail POS serta catatan manual kembali cocok | Tidak menggantikan drill hash seluruh field                |
| RSS puncak Node               | 892 MiB                                                                                    | Termasuk generator/driver; bukan heap atau RSS workerd     |

Run awal selesai restore tetapi gagal budget karena satu panggilan arsip
518.532 ms. Hasil tersebut tidak dihapus atau diberi label lulus. Run ulang
menyimpan durasi seluruh 65 panggilan dan memenuhi budget tanpa mengubah
batasnya. Perbedaan ini menunjukkan variabilitas environment lokal; hasil
tidak dipakai sebagai sertifikasi latensi atau kapasitas produksi serentak.

Drill pemulihan terpisah menjalankan baseline sumber yang dipin, 43 migrasi,
41 tabel dan 52 baris pada workerd D1. Inventory dan hash field seluruh tabel
cocok, termasuk uang, receipt, idempotency, data legacy dan isolasi cabang.
Failure injection menolak dump sehat yang tidak lengkap, perubahan trust
anchor, kerusakan field finansial, serta kegagalan copy/startup; resource
sementara dibersihkan.

Pengukuran inspector V8 pada Pages Worker terkompilasi memakai workload
HTTP ledger/auth/CSRF/tenant asli pada lima cabang. Dua run mengamati heap
V8 maksimum sekitar 10,27 MiB, backing storage sekitar 1,06 MiB dan 3.015
sampel heap pada run pertama. Sampel non-idle CPU seluruh rangkaian adalah
28.240 ms pada run pertama dan 21.040 ms pada run kedua. Ini rangkaian
banyak request dengan overhead inspector, bukan CPU per request atau CPU
yang ditagih Cloudflare. Memori tersebut tidak dicampur dengan RSS Node.
Smoke kanonik tanpa profiler tetap menjadi gate rilis.

Probe lanjutan memakai HTTP nyata milik harness untuk multipart. Native
`File` workerd, signature PNG, cabang dari sesi, serta byte R2 yang dibaca
kembali cocok. Profil arsip satu request memproses 3.000 header manual
dengan deskripsi 1.000 byte per header, tiga chunk maksimal 1.000 header,
serta D1 dan R2 lokal asli. Request selesai 1.080 ms; sampel non-idle CPU
sekitar 1.032 ms. Heap V8 teramati maksimal 16.906.164 byte dan backing
storage 6.134.793 byte pada tiga sampel, sehingga angka ini tidak disebut
batas puncak heap yang dijamin. Tiga objek masing-masing 1.728.342 byte;
3.000 header tepat tersebut terhapus setelah snapshot/readback. Probe
tidak menggantikan workload POS setahun atau pengukuran CPU pada Cloudflare sebenarnya.
Seluruh 12 kontrak native HTTP/WebSocket pada harness yang sama tetap lulus,
dan runtime serta state sementara dibersihkan.

## Ketepatan tes browser

Trace replay status legacy menunjukkan POST berhasil 200 dan ledger menjadi
`done:1`, tetapi polling assertion selesai sebelum acknowledgement diterima.
Tes kini menunggu acknowledgement yang sejak awal memang wajib diperiksa,
kemudian memeriksa ledger dan penghapusan intent lokal. Assertion, timeout
dan jumlah retry tetap dipertahankan.

Pada tes notifikasi, deadline request semula dimulai sebelum navigasi dan
pengisian POS selesai. Payload untuk checkout paralel kini diambil dari
request pada respons checkout asli yang sudah diperiksa helper. Deadline
HTTP tetap 30 detik. Pemeriksaan preferensi setelah reload/tab baru memakai
readiness sesi yang sama dengan login; loading tidak disamakan dengan
checkbox bernilai salah.

Fixture simpan rekonsiliasi semula mengirim `data: { job }`, sedangkan
handler PUT mengirim `data: job`. Tes dapat lulus pada payload keluar lalu
memunculkan exception Svelte. Fixture kini mengikuti kontrak handler,
memeriksa nilai tersimpan 750 pada placeholder setelah draft dibersihkan,
dan mensyaratkan nol page error.
Tidak ada perubahan perilaku produksi untuk menyamarkan ketidaksesuaian
fixture tersebut.

Empat kasus terkait kemudian lulus dalam satu run browser terisolasi tanpa
profiler paralel. Run penuh sebelumnya memberi 40/41 pada cohort A, 64/66
pada B, dan 49/49 pada C; tiga kegagalan A/B adalah sinkronisasi yang
dijelaskan di atas. Run agregat tersebut tetap dicatat exit 1. Tidak ada
klaim bahwa agregat lama menjadi hijau hanya karena kasus ulang lulus.
CI kandidat menjalankan kembali seluruh cohort dari checkout bersih.

Screenshot POS dan hasil pembayaran pada 1280 px serta 390 px telah
diperiksa. Nominal, kembalian, CTA, navigasi, dan panel pesanan terbaca tanpa
kontrol terpotong atau overflow. Tes keyboard/focus mencakup Tab,
Shift+Tab, Escape, inert, restore focus, serta dialog/sheet pada viewport
mobile. State empty/error, retry, transaksi ambigu dan queue offline tetap
memiliki kontrak browser; pemeriksaan ini bukan sertifikasi WCAG menyeluruh.

## Kelengkapan provenance rilis

Review verifier menemukan manifest dapat diterima setelah inventori
`config_checksums` atau `migration_checksums` dihapus. Ini bug validasi
metadata rilis, bukan tradeoff yang didokumentasikan. Reproduksi gagal
sebelum perbaikan. Verifier kini mensyaratkan grup object dan seluruh file
yang wajib tercatat, sehingga penghapusan hash tidak menyembunyikan config
yang berubah. Dua belas tes gate lulus pada Node 24.20.0, termasuk grup
hilang/null/array/kosong, entri hilang, tamper, SHA berbeda, runtime hilang,
dan diagnosis CRLF tanpa melonggarkan hash byte. Manifest sah dari publisher
yang ada tetap kompatibel; schema dan kebijakan branch tidak diubah.

## Penerimaan kandidat

Milestone [CI 39352063580](https://github.com/zulilmiihsn/zatiaras-juice-pos/actions/runs/39352063580)
pada `fc8aef116410cfd0e74be81508475f0079b8abf3` lulus seluruh enam job:
static, operations, critical coverage, unit, seluruh E2E dan build beserta
smoke terkompilasi serta manifest. Perbaikan kelengkapan metadata verifier
dan laporan ini tetap memerlukan run baru pada SHA final.

Kandidat kode dan tes berada pada branch `release/quality-9-8-hardening`.
Hasil final harus dibaca pada status CI commit laporan ini; run milestone
lama tidak menggantikannya. CI menyimpan coverage domain dan artefak rilis
dengan SHA pada nama artefak. Artefak promosi harus lolos verifier yang sama
untuk seluruh file aplikasi/runtime serta checksum config dan metadata
migrasi dari commit tersebut.

Lokal: check 0 error/0 warning; lint; audit dependensi tanpa kerentanan yang
dikenal; unit 169/169 tanpa skip; operations; critical coverage; build;
deploy config; compiled realtime/scheduled/ledger-browser; dan pengujian
ulang browser terkait telah dijalankan. Rantai agregat sebelum perbaikan
sinkronisasi tetap berstatus gagal seperti dicatat di atas. Snapshot hasil
CI pada SHA final adalah bukti penerimaan suite penuh lintas OS.

Tidak ada merge atau deployment produksi sebagai bagian audit ini.
Perubahan pengguna yang sudah ada pada `.claude/`, TWA, dan
`docs/QUALITY-ASSESSMENT.md` dipertahankan di luar commit tugas ini.

## Penilaian engineering

Tiga penghalang awal sudah ditangani. Penilaian berikut memakai bobot tetap
roadmap, sebagai pertimbangan engineering berbasis bukti, bukan persentase
coverage atau sertifikasi produksi.

| Area                                | Bobot | Skor | Dasar penilaian dan batas                                                                                                                 |
| ----------------------------------- | ----- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Integritas uang, stok, data, cabang | 25%   | 9,8  | Intent/uang, isolasi, concurrency, consent replay, snapshot receipt, restore atomik dan paritas field                                     |
| Keamanan                            | 20%   | 9,8  | Otoritas sesi terkini, role/PIN/CSRF, payload, multipart terbatas, gateway AI dan provenance; seluruh boundary yang dipetakan ditinjau    |
| Ketahanan aplikasi dan offline      | 15%   | 9,8  | Cache opsional dibatasi, respons basi difence, antrean durable dipertahankan, retry/recovery aktual diuji                                 |
| Maintainability dan arsitektur      | 15%   | 9,6  | Kebijakan kanonik dan arah dependensi dijaga; sebagian boundary wire internal masih memakai cast TypeScript dan alur fallback bercabang   |
| Performa                            | 10%   | 9,5  | Workload setahun dan probe Worker memenuhi budget lokal; throughput serentak representatif serta CPU yang ditagih Cloudflare belum diukur |
| Operasi dan rilis                   | 10%   | 9,7  | Drill full-field, failure injection, rollback, provenance dan CI; validasi operator staging memakai backup nyata masih terpisah           |
| UX dan aksesibilitas                | 5%    | 9,6  | Alur utama, error/empty, keyboard, screenshot desktop/mobile; perangkat fisik, printer dan assistive technology belum diuji langsung      |

Jumlah berbobot **9,72/10**, dibulatkan **9,7/10**. Target **9,8 belum
dinyatakan tercapai**. Kenaikan berikutnya membutuhkan bukti kapasitas pada
staging yang sesuai workload operasional dan verifikasi operator pada
perangkat nyata, termasuk receipt/notifikasi/aksesibilitas. Peningkatan
skor tidak dibenarkan hanya dengan menambah test atau mengubah bobot.

Rilis tetap bergantung pada CI dan verifikasi artefak pada SHA yang sama,
bukan pada angka audit ini. Tradeoff ADR 0001–0003 tetap berlaku dengan
mitigasinya; tidak ada migrasi destruktif untuk mengejar skor.
