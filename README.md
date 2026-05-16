# Smart Safe Deposit Box — Admin Dashboard

<div align="center">

![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646cff?style=flat-square&logo=vite&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Realtime-3ecf8e?style=flat-square&logo=supabase&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-06b6d4?style=flat-square&logo=tailwindcss&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

Dashboard web untuk memantau sistem **Smart Safe Deposit Box** secara real-time. Dibangun sebagai proyek IoT Semester 4, Teknologi Rekayasa Internet — Sekolah Vokasi UGM.

</div>

---

## Fitur

| Fitur | Keterangan |
|---|---|
| **Real-time Log** | Akses pintu & loker diperbarui otomatis via Supabase Realtime |
| **Alert Anomali** | Notifikasi instan saat terdeteksi akses mencurigakan |
| **Webcam Widget** | Capture foto otomatis saat ada event akses, upload ke Supabase Storage |
| **Manajemen Nasabah** | CRUD nasabah beserta alokasi loker |
| **Riwayat & Export** | Filter log berdasarkan tanggal/nama, export ke CSV |
| **Pengaturan Sistem** | Atur jam operasional langsung dari dashboard |
| **Dark / Light Mode** | Toggle tema, preferensi disimpan di localStorage |
| **Responsive** | Tampilan optimal di desktop maupun mobile |

---

## Tech Stack

- **Frontend** — React 19, Vite 8, React Router v7
- **Styling** — Tailwind CSS v4, CSS Custom Properties (design tokens)
- **Backend** — Supabase (PostgreSQL, Realtime, Storage, Auth)
- **Font** — Plus Jakarta Sans, JetBrains Mono

---

## Cara Menjalankan

### Prerequisites

- Node.js ≥ 20
- Akun [Supabase](https://supabase.com) dengan project yang sudah dikonfigurasi

### 1. Clone & Install

```bash
git clone https://github.com/Thinnur/Web_Dashboard_Smart_Deposit_Box.git
cd Web_Dashboard_Smart_Deposit_Box
npm install
```

### 2. Setup Environment

```bash
cp .env.example .env
```

Edit `.env` dengan kredensial Supabase project kamu:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

> Temukan kedua nilai ini di **Supabase Dashboard → Project Settings → API**.

### 3. Jalankan

```bash
npm run dev
```

Buka `http://localhost:5173`

---

## Struktur Database (Supabase)

Dashboard ini mengasumsikan tabel/view berikut sudah ada di Supabase:

```
nasabah          → data pemilik loker (nama, rfid_uid, fingerprint_id)
loker            → unit loker (nomor_loker, id_nasabah)
log_pintu        → log akses pintu (waktu_akses, tipe_akses, is_anomali, url_foto)
log_loker        → log akses loker (waktu_akses, status_akses, nomor_loker)
commands         → command queue dari IoT device (type, status)
system_settings  → jam operasional (jam_buka, jam_tutup)

view_log_pintu   → view join log_pintu + nasabah
view_log_loker   → view join log_loker + nasabah + loker
```

Row Level Security (RLS) diaktifkan. Gunakan **anon key** — bukan service role key.

---

## Struktur Project

```
src/
├── components/
│   ├── Header.jsx           # Jam live + theme toggle
│   ├── Sidebar.jsx          # Navigasi
│   ├── RoomStatusCard.jsx   # Status ruangan real-time
│   ├── AlertPanel.jsx       # Banner peringatan anomali
│   ├── StatsBar.jsx         # Kartu statistik ringkasan
│   ├── DoorLogTable.jsx     # Tabel log akses pintu
│   ├── LockerLogTable.jsx   # Tabel log akses loker
│   ├── CustomerManagement.jsx
│   ├── AccessHistory.jsx    # Filter, search, export CSV
│   ├── Settings.jsx         # Pengaturan jam operasional
│   └── WebcamWidget.jsx     # Capture foto otomatis
├── context/
│   └── ThemeContext.jsx
├── lib/
│   └── supabaseClient.js
├── App.jsx
├── main.jsx
└── index.css                # Design system & CSS variables
```

---

## Scripts

```bash
npm run dev      # Development server
npm run build    # Production build
npm run preview  # Preview build hasil
npm run lint     # ESLint check
```

---

## Keamanan

- Kredensial disimpan di `.env` — **tidak di-commit ke repository**
- Menggunakan **anon key** Supabase, bukan service role key
- RLS aktif di semua tabel sensitif
- File `.env` sudah masuk `.gitignore`

---

## Lisensi

MIT — Proyek akademik Semester 4, Teknologi Rekayasa Internet, Sekolah Vokasi UGM.
