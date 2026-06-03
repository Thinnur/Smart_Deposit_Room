# Firmware — Smart Safe Deposit Box ESP8266

Panduan lengkap untuk mengkompilasi dan meng-flash firmware ke NodeMCU ESP8266.

---

## Prerequisites

- [Arduino IDE](https://www.arduino.cc/en/software) versi **2.x** atau lebih baru
- Board package: **ESP8266 by ESP8266 Community** versi 3.x
  - Tambahkan URL board di Arduino IDE → Preferences → Additional boards manager URLs:
    ```
    https://arduino.esp8266.com/stable/package_esp8266com_index.json
    ```
  - Install via Tools → Board → Boards Manager → cari `esp8266`

---

## Library yang Dibutuhkan

Install semua library ini via **Sketch → Include Library → Manage Libraries**:

| Library | Versi Diuji | Penulis |
|---------|-------------|---------|
| `MFRC522` | 1.4.x | GithubCommunity |
| `Adafruit Fingerprint Sensor Library` | 2.x | Adafruit |
| `ArduinoJson` | **6.x** (bukan v7!) | Benoit Blanchon |
| `ESP8266WiFi` | bawaan ESP8266 core | ESP8266 Community |
| `ESP8266HTTPClient` | bawaan ESP8266 core | ESP8266 Community |

---

## Konfigurasi Sebelum Flash

1. Salin file konfigurasi:
   ```bash
   cp config.h.example config.h
   ```

2. Edit `config.h` dan isi dengan nilai yang sesuai:
   ```cpp
   #define CFG_WIFI_SSID      "nama_wifi_kamu"
   #define CFG_WIFI_PASSWORD  "password_wifi_kamu"
   #define CFG_SUPABASE_URL   "https://project-id.supabase.co"
   #define CFG_SUPABASE_KEY   "anon-key-dari-supabase"
   ```

3. Pastikan `config.h` **tidak ter-commit** ke git (sudah ada di `.gitignore`).

---

## Pengaturan Board di Arduino IDE

| Pengaturan | Nilai |
|------------|-------|
| Board | NodeMCU 1.0 (ESP-12E Module) |
| Upload Speed | 115200 |
| CPU Frequency | 80 MHz |
| Flash Size | 4MB (FS:2MB OTA:~1019KB) |
| Baud Rate Monitor | 74880 |

---

## Cara Flash

1. Hubungkan NodeMCU ke komputer via kabel USB data (bukan hanya charging).
2. Pilih port yang benar di Tools → Port.
3. Klik tombol **Upload** (→).
4. Buka Serial Monitor dengan baud rate **74880** untuk melihat log boot.

---

## Changelog

### v5.0 (Juni 2025)
- Tambah command `ENROLL_RFID`: daftarkan kartu RFID nasabah langsung dari Web Dashboard
- Tambah command `ENROLL_FP`: daftarkan sidik jari langsung dari Web Dashboard
- Progress pendaftaran dikirim real-time ke tabel `commands` via PATCH `payload.progress`

### v4.0
- State machine 5-state: STANDBY → PINTU_MASUK → DI_DALAM → BRANKAS_BUKA → PINTU_KELUAR
- State restore on reboot: query log terakhir untuk deteksi nasabah masih di dalam
- Command polling dari Supabase: LOCK_ALL, RESET_ALARM, UNLOCK_DOOR, REFRESH_CACHE

### v3.0
- Integrasi penuh Supabase REST API via HTTPS (BearSSL)
- Cache nasabah & loker di RAM untuk respon cepat tanpa HTTP setiap scan
- Logging otomatis ke `log_pintu` dan `log_loker`

### v2.0
- Dual authentication: RFID + Fingerprint
- Jam operasional: akses di luar jam kerja dicatat sebagai anomali

### v1.0
- Proof of concept: RFID buka pintu servo, log sederhana
