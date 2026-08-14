# REYA — Robot AI Lokal & Cepat Indonesia

REYA adalah aplikasi robot AI cerdas yang memproses percakapan suara cepat melalui OpenRouter, kamera gesture tangan full-frame, dan musik gesture 2-tangan di browser dan perangkat lokal.

## Fitur Utama

- ⚡ **AI Cepat & Pintar**: Terintegrasi langsung dengan OpenRouter (`openrouter/free`) untuk respon cepat 1-2 detik layaknya mengobrol langsung.
- 🎙️ **Mode Obrolan Suara Langsung (Hands-Free)**: Fitur auto-mic untuk mengobrol dua arah bolak-balik tanpa harus terus-menerus menekan tombol.
- 📷 **Kamera Adaptif Full-Frame**: Menyesuaikan rasio kamera (16:9 / 4:3) dengan tombol **⛶ Full** untuk memperluas tampilan visual gesture.
- 🎵 **Musik Gesture 2-Tangan**: Nada mengikuti ketinggian tangan (Y-axis), tangan kanan untuk melodi dan tangan kiri untuk bass, dengan efek X-axis stereo + brightness.
- 🤖 **Wajah Robot Animasi**: Reaktif terhadap suara (mendengarkan, berpikir, berbicara).
- 🔒 **Privasi Terjaga**: Kamera dan pemrosesan gesture diproses langsung di browser.

## Konfigurasi (.env)

Buat file `.env` dan masukkan API key OpenRouter:
```env
OPENROUTER_API_KEY=your_openrouter_api_key_here
OPENROUTER_MODEL=openrouter/free
NEXT_PUBLIC_OPENROUTER_API_KEY=your_openrouter_api_key_here
NEXT_PUBLIC_OPENROUTER_MODEL=openrouter/free
```

## Cara Menjalankan

1. Jalankan server:
   ```bash
   npm install
   npm run dev
   ```
2. Buka `http://localhost:3088` di browser.
3. Izinkan akses kamera dan mikrofon.

## Kontrol Gesture

- ✋ **Aktivasi**: Memulai musik gesture.
- ☝️ **Bermain**: Gerakkan tangan naik-turun untuk nada tinggi/rendah.
- 👍 **🔥 Boost**: Meningkatkan volume dan dinamika suara.
- 🤟 **💥 Drop**: Efek bass drop spektakuler.
- ✌️ **Mode**: Mengganti instrumen musik.
- ✊ **Stop**: Menghentikan musik.
