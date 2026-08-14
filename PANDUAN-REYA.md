# REYA — Robot AI Lokal Indonesia

REYA sudah dibuat sebagai aplikasi lokal dengan wajah animasi, percakapan Bahasa Indonesia, kamera gesture tangan, musik gesture (nada mengikuti ketinggian tangan), pengenalan suara, suara cute Supertonic, serta Qwen3-TTS/voice clone.

## Cara mulai

1. Ekstrak folder REYA.
2. Pasang aplikasi gratis berikut bila belum ada: Node.js, Python 3.12, dan Ollama.
3. Buka folder hasil ekstrak. Jalankan `local-ai\install-natural-voice.ps1` untuk suara natural saja, atau `local-ai\install.ps1` untuk semua fitur AI.
4. Jalankan `start-raya.ps1`.
5. Izinkan akses kamera dan mikrofon.

REYA tetap bisa dibuka dalam mode demo sebelum model lengkap dipasang. Untuk laptop tanpa GPU, pilih **Studio Suara → Natural Indo → REYA Cute**. Pemasang akan mengunduh model suara sekitar 400 MB sekali saja, lalu model berjalan lokal tanpa biaya.

## Kontrol gesture

- 👍 mengaktifkan musik
- ☝️ nada mengikuti ketinggian tangan — tinggi = nada tinggi
- ✋ memainkan chord sesuai posisi tangan
- ✌️ mengganti mode musik
- ✊ atau 👎 menghentikan musik
- 🤟 memainkan chord kejutan

## Cara bermain musik

1. Aktifkan kamera lalu tunjukkan 👍.
2. Angkat tangan kanan tinggi untuk nada tinggi, turunkan untuk nada rendah. Geser kiri-kanan untuk brightness dan stereo.
3. Gunakan tangan kiri untuk bass — kontrol sama seperti tangan kanan tapi di oktaf rendah.
4. Buka ✋ untuk chord, ✌️ untuk mode berikutnya, serta ✊ untuk berhenti.
5. Tombol **Dengar petunjuk REYA** akan membacakan tutorial sesuai mode yang dipilih.

Suara bawaan memakai **F2 REYA Cute**, karakter perempuan yang ceria, playful, muda, dan resmi mendukung Bahasa Indonesia. **Custom Qwen** tetap tersedia untuk eksperimen, tetapi Bahasa Indonesia belum termasuk bahasa resmi Qwen3-TTS. Mode **Perangkat** hanya cadangan dan kualitasnya bergantung pada Windows/browser. Voice clone hanya boleh digunakan dengan suara milik sendiri atau suara yang Anda punya izin untuk gunakan.
