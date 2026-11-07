# Budget Saver — Panduan Pasang (±15 menit)

Arsitektur: `index.html` (aplikasi, di-hosting gratis) → memanggil **Apps Script** (API) → menulis ke **Google Sheets** milik Anda.
Satu akun Google, data sama di iPhone dan laptop Windows, dan tetap bisa dibuka langsung di Sheets.

## Bagian A — Backend (Google Sheets + Apps Script)

1. Buat Google Sheet baru (kosong), beri nama mis. **Budget Saver**.
2. Menu **Extensions → Apps Script**. Hapus isi `Code.gs` bawaan, tempel seluruh isi file `apps-script/Code.gs`.
3. Di baris atas, ganti `GANTI_TOKEN_INI` dengan kata sandi panjang buatan Anda (≥ 24 karakter acak). Ini kunci akses API. Simpan di password manager.
4. (Opsional) Project Settings → centang **Show "appsscript.json"** → tempel isi `apps-script/appsscript.json` agar zona waktu Asia/Jakarta.
5. (Opsional) Pilih fungsi **`setup`** di toolbar → **Run**. Setujui izin akses (Advanced → Go to … → Allow).
   Tanpa langkah ini pun, sheet dibuat otomatis saat aplikasi pertama kali menekan **Hubungkan**.
   Hasilnya: sheet `Dashboard`, `Kategori`, `Top Up (Income)`, `Catat Harian (Pengeluaran)` dengan struktur dan rumus yang sama seperti Budget_Saver.xlsx. Aman dijalankan ulang, tidak menimpa data.
6. **Deploy → New deployment → ⚙ Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Klik Deploy, salin **Web app URL** (berakhiran `/exec`).

> Mengubah `Code.gs` di kemudian hari: **Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy**. URL tetap sama.

Soal keamanan: akses "Anyone" hanya membuka pintu; setiap permintaan ditolak tanpa token. Siapa pun yang tahu URL **dan** token bisa membaca/menulis data, jadi jaga keduanya. Untuk mengganti token: ubah di `Code.gs`, deploy versi baru, lalu masukkan token baru di tiap perangkat.

## Bagian B — Hosting aplikasi (pilih salah satu, gratis)

Aplikasi harus berada di alamat **https** agar bisa dipasang di iPhone.

- **Netlify Drop** (paling cepat): buka app.netlify.com/drop, seret isi folder `budget-saver` (index.html, sw.js, manifest, ikon). Anda langsung dapat alamat `https://nama-acak.netlify.app`.
- **GitHub Pages / Cloudflare Pages**: unggah file yang sama ke repositori lalu aktifkan Pages.

Folder `apps-script/` dan `test/` tidak perlu diunggah. URL Apps Script dan token **tidak** ditulis di file; Anda memasukkannya lewat menu Pengaturan, jadi aman walau situs bersifat publik.

## Bagian C — Hubungkan perangkat

**Laptop Windows (Edge/Chrome)**
1. Buka alamat aplikasi → **Pengaturan** → isi URL Web App + Token → **Hubungkan**.
2. Pasang sebagai aplikasi: Edge → ⋯ → Apps → *Install this site as an app* (Chrome: ikon install di address bar).

**iPhone (Safari)**
1. Buka alamat aplikasi di Safari → Share → **Add to Home Screen**.
2. Buka dari ikon di layar utama → **Pengaturan**. Di iOS, aplikasi layar utama punya penyimpanan terpisah dari Safari, jadi sambungan perlu diisi di sini.
3. Cara cepat: di laptop, Pengaturan → **Salin tautan perangkat lain**, kirim ke diri sendiri (Catatan/AirDrop/Pesan), salin, lalu di iPhone tempel ke kolom *tautan penyiapan* → **Gunakan tautan**. Tautan memuat token Anda, jadi jangan dibagikan ke orang lain.

Saat pertama menghubungkan, bila di perangkat itu sudah ada catatan lokal, Anda akan ditanya: unggah ke Sheets, atau pakai data yang ada di Sheets.

## Cara kerja sehari-hari

- Catat pengeluaran/top up dari tombol **+** atau tombol di kartu Total Cash. Di laptop tekan **N**.
- Tab **Peta**: mind map aliran uang bulan terpilih. Pusatnya selisih (masuk − keluar); Masuk dan Keluar bercabang per kategori lalu per keterangan (5 terbesar + Lainnya). Ketuk kategori untuk buka/lipat, ketuk keterangan untuk melihat dan mengedit transaksinya. Di laptop lebar tampil kiri-kanan, di iPhone atas-bawah.
- Tab bar kaca: ketuk, atau tekan lalu geser lensa ke tab lain dan lepas. Di iPhone tab bar mengecil saat scroll ke bawah dan kembali saat scroll ke atas. Efek refraksi tepi kaca aktif di Edge/Chrome; Safari memakai blur kaca biasa.
- Tanpa internet: catatan tersimpan di perangkat dan dikirim otomatis saat online (indikator *Offline · n*).
- Aplikasi menyinkron saat dibuka, setiap 90 detik, dan saat Anda mengetuk indikator di kanan atas.
- Boleh mengisi/mengubah langsung di Google Sheets; muncul di aplikasi pada sinkron berikutnya. Kolom ID yang disembunyikan jangan dihapus.
- Kategori maksimal 10 (sama dengan Dashboard di Sheets). Mengganti nama kategori ikut memperbarui semua transaksinya. Kategori yang masih punya transaksi tidak bisa dihapus.
- Ekspor CSV ada di Pengaturan → Data.

## Perbedaan kecil dari file Excel

- **Sisa Saldo Kategori** kini hanya menghitung top up yang tanggalnya ≤ tanggal pengeluaran (rumus lama menghitung seluruh top up, termasuk yang masuk belakangan).
- Dashboard di Sheets tetap hidup dengan rumus yang sama; aplikasi menghitung angka yang sama di sisi klien.

## Jika bermasalah

| Gejala | Penyebab umum |
|---|---|
| "Tidak bisa terhubung" | URL bukan yang berakhiran `/exec`, atau akses belum **Anyone**, atau belum deploy versi baru setelah mengubah kode |
| "Token salah" | Token di aplikasi ≠ `API_TOKEN` di `Code.gs` (perhatikan spasi) |
| "Sheet belum disiapkan" | Jalankan `setup()` dari Apps Script |
| Perubahan ditolak | Pesan muncul sebagai notifikasi singkat; data kembali ke kondisi di Sheets |
