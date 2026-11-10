# REYA : Robot AI Lokal Indonesia

REYA adalah konsol robot AI berbahasa Indonesia bergaya instrumen perangkat keras studio (Tactile Studio Hardware) yang memadukan otak **Gemini Flash (`gemini-flash-latest`)**, sintesis suara **Voicebox (`jamiepine/voicebox`)**, kamera pelacak 2 tangan MediaPipe, dan synthesizer musik polifonik 2D.

## Cara memulai

1. Pastikan **Node.js 22+** sudah terpasang.
2. Untuk mengaktifkan suara dari **Voicebox (`https://github.com/jamiepine/voicebox`)**:
   - Jalankan aplikasi desktop atau backend Voicebox sehingga server aktif di `http://127.0.0.1:17493`.
   - Buka tombol **Studio Suara** di bar atas REYA, pilih tab **Voicebox Studio**, lalu klik **Cek Koneksi** untuk memuat daftar profil suara dari `GET /profiles`.
   - Bila Voicebox belum dinyalakan, REYA otomatis beralih ke mesin suara cadangan Bahasa Indonesia agar tetap bersuara tanpa gangguan.
3. Untuk menjalankan server lokal tambahan (opsional Supertonic F2 / Qwen3-TTS / Whisper STT):
   - Jalankan `local-ai\install-natural-voice.ps1` atau `local-ai\install.ps1`.
4. Jalankan `start-raya.ps1` atau `npm run dev` lalu buka `http://localhost:3088`.

## Konfigurasi API Gemini (Argon / Flash Latest)

REYA dikonfigurasi menggunakan endpoint resmi Google Generative Language API:
- Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent`
- Header autentikasi: `X-goog-api-key` di `.env` dan `.env.local` (`GEMINI_API_KEY` dan `NEXT_PUBLIC_GEMINI_API_KEY`).

## Kontrol gerakan tangan & synthesizer 2D

- **Telapak Terbuka**: Mengaktifkan mesin synthesizer dan memainkan akor mayor.
- **Telunjuk Naik**: Memainkan nada melodi sesuai ketinggian tangan (kanan = melodi, kiri = bass).
- **Dua Jari (Victory)**: Berpindah ke bank instrumen berikutnya (`BANK 01` sampai `BANK 05`).
- **Jempol Naik**: Memberikan lonjakan volume (Boost).
- **Tangan Mengepal**: Menghentikan seluruh keluaran suara synthesizer.
- **Sentuh / Geser Matriks 2D**: Anda juga dapat langsung mengklik atau menggeser kursor di kanvas matriks 2D pada **MOD-03** untuk membunyikan instrumen tanpa kamera.
