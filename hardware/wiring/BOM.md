# Bill of Materials — Smart Safe Deposit Box

Daftar komponen lengkap untuk membangun perangkat keras proyek ini.

## Komponen Utama

| No | Komponen | Spesifikasi | Qty | Fungsi |
|----|----------|-------------|-----|--------|
| 1 | NodeMCU ESP8266 | ESP-12E, 3.3V logic | 1 | Mikrokontroler utama + koneksi WiFi |
| 2 | RFID Reader | MFRC522, 13.56 MHz | 1 | Membaca kartu RFID nasabah |
| 3 | Kartu RFID | ISO 14443A (Mifare) | 5+ | Identitas nasabah |
| 4 | Fingerprint Sensor | AS608 / R307 | 1 | Otentikasi sidik jari |
| 5 | Servo Motor | SG90, 5V, 180° | 2 | Aktuator pintu & brankas |
| 6 | Buzzer | Aktif, 5V | 1 | Indikator audio |

## Komponen Pendukung

| No | Komponen | Spesifikasi | Qty | Fungsi |
|----|----------|-------------|-----|--------|
| 7 | Power Supply | 5V 2A, micro-USB | 1 | Sumber daya utama |
| 8 | Kabel Jumper | Male-Female, 20cm | 20+ | Koneksi antar komponen |
| 9 | Breadboard | 830 titik | 1 | Prototipe rangkaian |

## Koneksi Pin (Ringkasan)

| Sensor | Pin Sensor | Pin NodeMCU |
|--------|-----------|-------------|
| RFID MFRC522 | SDA | D8 |
| RFID MFRC522 | RST | D2 |
| RFID MFRC522 | SCK | D5 |
| RFID MFRC522 | MISO | D6 |
| RFID MFRC522 | MOSI | D7 |
| RFID MFRC522 | VCC | 3.3V |
| RFID MFRC522 | GND | GND |
| Fingerprint AS608 | TX | D1 |
| Fingerprint AS608 | RX | D0 |
| Fingerprint AS608 | VCC | 3.3V |
| Fingerprint AS608 | GND | GND |
| Servo Pintu | Signal | D3 |
| Servo Brankas | Signal | D4 |
| Servo (keduanya) | VCC | 5V (Vin) |
| Servo (keduanya) | GND | GND |
| Buzzer | + | GPIO3 (RX) |
| Buzzer | - | GND |

> **Catatan:** NodeMCU beroperasi pada 3.3V. RFID dan Fingerprint sudah kompatibel
> dengan level tegangan ini. Servo membutuhkan 5V — gunakan pin **Vin** NodeMCU
> yang terhubung ke input USB.

## Diagram Wiring

Lihat diagram visual di:
- [`wiring_diagram_v1.svg`](wiring_diagram_v1.svg) — layout awal
- [`wiring_diagram_v2.svg`](wiring_diagram_v2.svg) — revisi lengkap dengan power rail
