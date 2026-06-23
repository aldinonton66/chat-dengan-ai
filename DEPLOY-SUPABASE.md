# Deploy Supabase Edge Function — Panduan

Proyek **Kita & AI** menggunakan Supabase Edge Function sebagai proxy untuk Groq API.
Ini memastikan API key Groq TIDAK terekspos di frontend.

---

## 1. Install Supabase CLI

```bash
# Via npm (pastikan Node.js 18+ sudah terinstall)
npm install -g supabase

# Via Homebrew (macOS)
brew install supabase/tap/supabase

# Cek versi
supabase --version
```

---

## 2. Login ke Supabase

```bash
supabase login
```

Akan buka browser, login dengan akun Supabase kamu.

---

## 3. Link ke Project

```bash
cd chat-dengan-ai

# Init Supabase di project (kalau belum)
supabase init

# Link ke project yang sudah ada di dashboard
supabase link --project-ref <PROJECT_REF>

# PROJECT_REF bisa dilihat di Dashboard Supabase → Settings → General
# Format: https://supabase.com/dashboard/project/<PROJECT_REF>
```

---

## 4. Set Secret GROQ_API_KEY

```bash
# Simpan API key Groq SEBAGAI SECRET (bukan di file .env!)
supabase secrets set GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxxxx

# Verifikasi secret tersimpan
supabase secrets list
```

> **PENTING:** GROQ_API_KEY hanya disimpan di Supabase server. Tidak ada di kode frontend.

---

## 5. Deploy Edge Function

```bash
# Deploy function groq-chat
supabase functions deploy groq-chat

# Output akan menampilkan URL Edge Function:
# https://<PROJECT_REF>.supabase.co/functions/v1/groq-chat
```

---

## 6. Dapatkan Project URL & Anon Key

1. Buka [Supabase Dashboard](https://supabase.com/dashboard)
2. Pilih project kamu
3. Buka **Settings → API**
4. Copy:
   - **Project URL** (contoh: `https://abc123.supabase.co`)
   - **Anon public key** (contoh: `eyJhbGci...`)
5. Update `js/config.js`:
   ```js
   supabaseUrl: "https://abc123.supabase.co",
   supabaseAnonKey: "eyJhbGci...",
   ```
   Dan update inline script di `<head>` `index.html`:
   ```js
   var SUPABASE_URL = "https://abc123.supabase.co";
   var SUPABASE_ANON_KEY = "eyJhbGci...";
   ```

---

## 7. Setup Supabase Auth (Users)

1. Buka **Authentication → Users** di Dashboard
2. Klik **Add user → Create new user**
3. Isi email & password untuk user, misalnya:
   - Email: `aldi@example.com` / Password: `password123`
   - Email: `adel@example.com` / Password: `password456`
4. Pastikan **Auto Confirm User** dicentang (atau user harus konfirmasi email)

---

## 8. Test

1. Buka `https://<user>.github.io/chat-dengan-ai/login.html`
2. Login dengan salah satu user yang sudah dibuat di Supabase Auth
3. Buka halaman chat → tambah API key Groq di Pengaturan API
4. Kirim pesan → AI akan membalas via Supabase Edge Function

---

## Troubleshooting

| Masalah | Solusi |
|---------|--------|
| `GROQ_API_KEY secret tidak ditemukan` | Jalankan `supabase secrets set GROQ_API_KEY=...` |
| CORS error | Pastikan `Access-Control-Allow-Origin: *` ada di Edge Function |
| Login gagal | Cek user sudah dibuat di Supabase Auth dashboard |
| `supabase` command not found | Install ulang: `npm install -g supabase` |
