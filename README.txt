======================================================
PANDUAN SETUP FINANCE TRACKER - BACA SEBELUM MEMULAI
======================================================

Halo! Terima kasih telah membeli Finance Tracker.
Ikuti 3 langkah mudah ini untuk mengaktifkan database kamu:

LANGKAH 1: MENYIAPKAN GOOGLE SHEETS

1. Buka browser di HP/Laptop, lalu buka link berikut: https://sheets.new
2. Buat tab pertama, beri nama: Transaksi
   Pada baris paling atas (A1 sampai I1), tulis judul kolom:
   ID | Tanggal | Nama | Credit | Debit | Kategori | Akun | TargetAkun | Catatan
3. Buat tab kedua (klik ikon + di kiri bawah), beri nama: Akun
   Pada baris paling atas (A1 sampai C1), tulis judul kolom:
   NamaAkun | Klasifikasi | SaldoAwal

LANGKAH 2: MENGAKTIFKAN APPS SCRIPT (BACKEND)

1. Di dalam Google Sheets kamu, klik menu Extensions (Ekstensi) > Apps Script.
2. Hapus semua kode yang ada di sana.
3. Buka link panduan script berikut, salin kodenya, dan tempel (paste) ke dalam Apps Script:
   [MASUKKAN LINK PASTEBIN/GIST KAMU DISINI]
4. Klik ikon Save (Disket), lalu klik tombol "Deploy" di pojok kanan atas > "New Deployment".
5. Klik ikon Gear, pilih "Web app".
   - Execute as: Me (Email kamu)
   - Who has access: Anyone (Siapa saja)
6. Klik Deploy. Jika muncul pop-up izin, klik "Authorize Access" dan pilih "Allow".
7. Salin (Copy) "Web App URL" panjang yang diberikan.

LANGKAH 3: MENGHUBUNGKAN KE APLIKASI

1. Buka website aplikasi Finance Tracker kamu.
2. Klik ikon Awan (Cloud) di pojok kanan atas header.
3. Ubah mode menjadi "Google Sheets Sync".
4. Tempel (Paste) URL Web App panjang yang sudah kamu salin tadi.
5. Klik "Hubungkan". Selesai! Aplikasi kamu sudah aktif dan sinkron ke cloud.
