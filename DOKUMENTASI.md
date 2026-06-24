# Dokumentasi Teknis — Kita & AI

> **Versi:** 1.0  
> **Tanggal:** 24 Juni 2024  
> **Stack:** Vanilla JavaScript, Supabase Auth, Supabase Edge Functions, localStorage + Supabase DB  
> **Bahasa:** Indonesia

---

## Daftar Isi

1. [Arsitektur Aplikasi](#1-arsitektur-aplikasi)
2. [Autentikasi (Auth)](#2-autentikasi-auth)
3. [Navigasi & Layout](#3-navigasi--layout)
4. [Chat Utama](#4-chat-utama)
5. [Pengaturan Profil](#5-pengaturan-profil)
6. [Pengaturan AI](#6-pengaturan-ai)
7. [Pengaturan Font](#7-pengaturan-font)
8. [Status API](#8-status-api)
9. [Penyimpanan & Sync](#9-penyimpanan--sync)
10. [Notifikasi Toast](#10-notifikasi-toast)
11. [Edge Function (groq-chat)](#11-edge-function-groq-chat)
12. [Database Supabase](#12-database-supabase)
13. [CSS Architecture](#13-css-architecture)

---

## 1. Arsitektur Aplikasi

### 1.1 Diagram Alur

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  login.html  │────▶│  Auth Gate   │────▶│  index.html  │────▶│   app.js     │
│  (Login UI)  │     │  (Session    │     │  (UI Shell)  │     │  (Logic)     │
│              │     │   Check)     │     │              │     │              │
└──────────────┘     └──────────────┘     └──────────────┘     └──────┬───────┘
                                                                       │
                                              ┌────────────────────────┘
                                              ▼
                                    ┌──────────────────┐
                                    │  Edge Function   │
                                    │  (groq-chat)     │
                                    │  Multi-provider  │
                                    └──────┬───────────┘
                                           │
                              ┌────────────┼────────────┐
                              ▼            ▼            ▼
                         ┌────────┐  ┌─────────┐  ┌──────────┐
                         │ Groq   │  │  xAI    │  │ Gemini   │
                         │ (LLaMA)│  │ (Grok)  │  │ (Flash)  │
                         └────────┘  └─────────┘  └──────────┘
                              ▼            ▼            ▼
                         ┌────────┐  ┌─────────┐  ┌──────────┐
                         │OpenRtr │  │Cerebras │  │ (others) │
                         │(GPT-4o)│  │(OSS120B)│  │          │
                         └────────┘  └─────────┘  └──────────┘
```

### 1.2 Teknologi

| Komponen | Teknologi | Keterangan |
|---|---|---|
| Frontend | Vanilla JS (ES5-compatible) | Tanpa framework, tanpa build step |
| CSS | Custom Properties + Glassmorphism | Tema dark/light via CSS variables |
| Auth | Supabase Auth (`supabase-js@2`) | Email/password, session management |
| Backend | Supabase Edge Functions (Deno) | Proxy multi-provider AI dengan fallback |
| Database | Supabase PostgreSQL (`user_data`) | JSONB storage, RLS, trigger auto-update |
| Storage | `localStorage` (primer) + Supabase DB (sync) | 10 MB quota, auto-trim 900 KB safety |
| AI | Groq, xAI, OpenRouter, Cerebras, Gemini | Sequential fallback, auto-skip provider limit |

### 1.3 Struktur File & Peran

```
chat-dengan-ai/
├── index.html                          # Shell UI utama (header, sidebar, 4 section, toast, lightbox)
├── login.html                          # Halaman login terpisah (email/password)
├── css/
│   └── style.css                       # Semua styling (1201 baris) — CSS variables, layout, komponen, responsive, animasi
├── js/
│   ├── config.js                       # Konfigurasi global (Supabase URL/Key, navMenu, tema default)
│   └── app.js                          # Logika aplikasi utama (2420 baris) — IIFE, semua modul dalam satu file
├── supabase/
│   ├── functions/
│   │   └── groq-chat/
│   │       └── index.ts                # Edge Function — proxy AI multi-provider (264 baris Deno/TypeScript)
│   └── migrations/
│       └── 20240624000000_user_data.sql # Migrasi database — tabel user_data, RLS, trigger
└── DOKUMENTASI.md                      # File ini
```

**Catatan penting tentang arsitektur:**
- `config.js` harus di-load **sebelum** Auth Gate karena Auth Gate membutuhkan `APP_CONFIG.supabaseUrl` dan `APP_CONFIG.supabaseAnonKey`.
- `app.js` di-load **setelah** semua HTML (di akhir `<body>`) agar semua elemen DOM sudah tersedia.
- Semua kode JavaScript menggunakan IIFE (`(function(){...})()`) untuk menghindari polusi global scope.
- Hanya satu variabel global yang diekspos: `APP_CONFIG`.

---

## 2. Autentikasi (Auth)

### 2.1 Cara Kerja Login (`login.html`)

File: `login.html:79-172`

Login menggunakan Supabase Auth dengan metode **email/password**.

**Alur:**

1. **Inisialisasi Supabase client** dari `APP_CONFIG` (yang di-load dari `config.js`)
2. **Cek session existing** — jika sudah login, auto-redirect ke `index.html`
3. **Form submit** memanggil `supabase.auth.signInWithPassword()`
4. Error handling user-friendly:
   - `"Invalid login"` → "Email atau password salah."
   - `"Email not confirmed"` → "Email belum dikonfirmasi."
   - Lainnya → tampilkan pesan error asli
5. **Sukses** → `location.replace("index.html")`

```javascript
var { data, error } = await supabase.auth.signInWithPassword({
  email: emailVal,
  password: passVal,
});

if (error) {
  // Tampilkan pesan error yang user-friendly
  if (error.message.includes("Invalid login")) {
    errorEl.textContent = "Email atau password salah.";
  } else if (error.message.includes("Email not confirmed")) {
    errorEl.textContent = "Email belum dikonfirmasi. Cek inbox kamu.";
  } else {
    errorEl.textContent = error.message;
  }
  errorEl.style.display = "block";
} else {
  location.replace("index.html");
}
```

**Fitur tambahan:**
- **Toggle show/hide password** (`login-toggle-pass`) — mengubah `input[type]` antara `password` dan `text`, ikon berganti antara 👁️ dan 🙈.
- **Nonaktifkan tombol** saat loading (teks berubah jadi "Mengecek...").

### 2.2 Auth Gate di `index.html`

File: `index.html:29-66`

Auth Gate adalah skrip **inline synchronous** di `<head>` yang berjalan **sebelum** konten HTML dirender oleh browser. Tujuannya mencegah flash of unauthorized content.

**Alur:**

1. **Retry loop** — menunggu `window.supabase` dan `APP_CONFIG` tersedia (maks 40×50ms = 2 detik). Ini penting karena Supabase CDN dan `config.js` mungkin belum selesai di-parse.
2. **Cek session** via `sb.auth.getSession()` — jika tidak ada session → `window.location.replace("login.html")`
3. **Pantau perubahan session** via `sb.auth.onAuthStateChange()` — jika event `SIGNED_OUT` atau session hilang → redirect ke `login.html`

```javascript
sb.auth.getSession().then(function (result) {
  var session = result.data && result.data.session;
  if (!session) {
    window.location.replace("login.html");
  }
}).catch(function () {
  // Network error — biarkan user tetap di halaman
});

sb.auth.onAuthStateChange(function (event, session) {
  if (event === "SIGNED_OUT" || !session) {
    window.location.replace("login.html");
  }
});
```

**Mengapa `.catch()` dibiarkan kosong?** Jika terjadi network error saat cek session, user tidak langsung di-redirect (untuk mencegah redirect loop saat offline).

### 2.3 Logout Flow (`doLogout`)

File: `app.js:2244-2253`

```javascript
async function doLogout() {
  // Final sync ke Supabase sebelum logout
  try { await syncAllToSupabase(false); } catch (e) {}

  if (typeof window.supabase !== "undefined" && APP_CONFIG.supabaseUrl) {
    var sb = window.supabase.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey);
    await sb.auth.signOut();
  }
  location.replace("login.html");
}
```

**Alur:**
1. **Sync final** — menyimpan semua data ke Supabase sebelum logout
2. **Sign out** dari Supabase Auth
3. **Redirect** ke `login.html`

**Trigger:** Tombol logout di sidebar (`#btn-logout-sidebar`) dengan konfirmasi `confirm("Yakin mau logout?")`.

---

## 3. Navigasi & Layout

### 3.1 Sidebar + Bottom Nav

**Dual navigation system:** Sidebar untuk tablet/desktop, bottom nav untuk mobile.

#### Generate Navigasi (`generateNavigation`)

File: `app.js:205-234`

Menu di-generate **dinamis** dari `APP_CONFIG.navMenu` (config.js):

```javascript
APP_CONFIG.navMenu = [
  { id: "section-chat",   label: "Chat Utama",       icon: "💬" },
  { id: "section-profil", label: "Pengaturan Profil", icon: "👤" },
  { id: "section-ai",     label: "Pengaturan AI",     icon: "🤖" },
  { id: "section-status", label: "Status API",        icon: "📊" }
];
```

Setiap menu dirender sebagai `<button class="nav-link" data-section="...">` di sidebar dan `<button class="bottom-nav-link" data-section="...">` di bottom nav. Event delegation digunakan untuk menangani klik.

#### Show Section (`showSection`)

File: `app.js:236-292`

```javascript
function showSection(sectionId) {
  // 1. Sembunyikan semua section
  var allSections = document.querySelectorAll(".content-section");
  allSections.forEach(function (sec) { sec.classList.remove("active"); });

  // 2. Tampilkan section target
  var target = document.getElementById(sectionId);
  if (target) { target.classList.add("active"); }

  // 3. Update state
  currentSectionId = sectionId;

  // 4. Highlight nav-link yang aktif (sidebar + bottom nav)
  // 5. Trigger inisialisasi per section:
  //    - section-chat → scrollToBottom()
  //    - section-profil → populateProfilForm() + refreshStorageMonitor()
  //    - section-ai → populateAIForm() + refreshStorageMonitor()
  //    - section-status → renderStatusCards()
}
```

**Binding:** Klik pada `.nav-link` (sidebar) atau `.bottom-nav-link` (bottom nav) memanggil `showSection(sectionId)`.

### 3.2 Sidebar Collapse/Expand

File: `app.js:318-467`

**State disimpan di localStorage** dengan key `kita-sidebar`:

```javascript
{ collapsed: false, width: 200 }
```

**Fungsi utama:**

| Fungsi | Deskripsi |
|---|---|
| `loadSidebarState()` | Baca state dari localStorage, fallback `{collapsed:false, width:200}` |
| `saveSidebarState(state)` | Simpan state ke localStorage |
| `applySidebarState()` | Terapkan collapsed class + lebar sidebar |
| `toggleSidebar()` | Toggle class `.collapsed`, update ikon (◀/▶), simpan state |
| `updateToggleIcon()` | Ubah ikon tombol toggle |

**CSS:**
- Normal: `width: var(--sidebar-w)` (220px)
- Collapsed: `width: var(--sidebar-collapsed-w) !important` (60px)
- Saat collapsed: `.nav-label` disembunyikan, `.nav-link` di-center, ikon diperbesar

### 3.3 Sidebar Resize (Drag)

File: `app.js:413-458`

Handle resize (`#sidebar-resize-handle`) di tepi kanan sidebar. Drag mouse untuk mengubah lebar:

```javascript
handle.addEventListener("mousedown", function (e) {
  isResizing = true;
  startX = e.clientX;
  startWidth = el.offsetWidth;
  document.body.style.cursor = "col-resize";
});

document.addEventListener("mousemove", function (e) {
  if (!isResizing) return;
  var newWidth = startWidth + (e.clientX - startX);
  // Batasi: min 60px, max 320px
  if (newWidth < 60) newWidth = 60;
  if (newWidth > 320) newWidth = 320;
  el.style.width = newWidth + "px";
});

document.addEventListener("mouseup", function () {
  isResizing = false;
  // Simpan lebar ke state
  state.width = el.offsetWidth;
  saveSidebarState(state);
});
```

### 3.4 Tema Dark/Light

File: `app.js:473-494`

```javascript
function bindThemeToggle() {
  // Muat tema dari localStorage (default: "dark")
  var savedTheme = localStorage.getItem("kita-theme");
  var isDark = (savedTheme === null)
    ? (APP_CONFIG.defaultTheme === "dark")
    : (savedTheme === "dark");

  // Terapkan
  if (isDark) {
    bodyEl.classList.add("dark");
    themeToggleBtn.innerHTML = "☀️";
  } else {
    bodyEl.classList.remove("dark");
    themeToggleBtn.innerHTML = "🌙";
  }

  // Toggle
  themeToggleBtn.addEventListener("click", function () {
    var isDark = bodyEl.classList.toggle("dark");
    safeSetItem("kita-theme", isDark ? "dark" : "light");
    themeToggleBtn.innerHTML = isDark ? "☀️" : "🌙";
  });
}
```

**Cara kerja:**
- Body memiliki class `.dark` (default) atau tidak (light mode)
- CSS variables didefinisikan di `:root` (dark) dan di-override di `body:not(.dark)` (light)
- Tombol toggle di header (`#btn-theme-toggle`)
- State disimpan di localStorage key `kita-theme`

---

## 4. Chat Utama

### 4.1 Kirim Pesan Teks (`sendMessage`)

File: `app.js:1798-1876`

**Alur:**

1. **Validasi** — teks tidak boleh kosong (jika kosong, tambah class `input-error` 500ms)
2. **Baca speaker** dari dropdown `#select-speaker` (person1 / person2)
3. **Buat objek pesan:**
   ```javascript
   var msg = {
     id: generateUID(),      // "msg_<timestamp>_<random6>"
     role: "user",
     sender: speaker,        // "person1" atau "person2"
     text: text,
     time: formatTime(new Date()),  // "HH:mm"
     type: "text"
   };
   ```
4. **Panggil `addBubbleToChat(msg)`** — tambah bubble ke DOM + simpan ke history
5. **Reset input** — kosongkan textarea, reset height, fokus kembali
6. **Jika AI aktif (`aiData.aktif`):**
   - Tampilkan typing indicator
   - Disable tombol kirim (opacity 0.5)
   - Panggil `kirimPesanKeAI(msg, callback)`
   - Di callback: sembunyikan typing, enable tombol, tambah bubble AI (atau error)

### 4.2 Bubble HTML Builder (`buildBubbleHTML`)

File: `app.js:1606-1695`

Fungsi ini membangun HTML string untuk satu bubble chat. Menerima objek pesan dan mengembalikan HTML string.

**Struktur data pesan:**

```javascript
{
  id: "msg_1719234567890_abc123",  // Unique ID
  role: "user" | "assistant",      // Peran
  sender: "person1" | "person2" | "ai",
  text: "Isi pesan...",
  time: "10:30",                   // Format HH:mm
  type: "text" | "voice" | "image" | "video",
  mediaUrl: "blob:...",           // URL media (voice/image/video)
  duration: "0:12",               // Durasi (voice/video)
  persist: true                    // Simpan ke history (untuk AI)
}
```

**Logika rendering:**

| Role | Class | Warna | Sumber Warna |
|---|---|---|---|
| `assistant` | `bubble-left bubble-ai` | `ai.warnaBubble` | Data profil |
| `user` + `person1` | `bubble-right bubble-person1` | `person1.warna` | Data profil |
| `user` + `person2` | `bubble-left bubble-person2` | `person2.warna` | Data profil |

**Tipe konten:**

- **text:** `<p>` di dalam `.bubble-body`
- **voice:** `.bubble-voice-body` dengan `<button class="voice-play-btn">`, `.voice-wave` (7 wave bar), durasi
- **image:** `.image-thumb` dengan `<img>`, caption opsional. `data-full` untuk lightbox
- **video:** `.video-thumb` dengan `<img>` + play overlay + durasi badge

**Inline styles** diterapkan pada `.bubble-body`:
- `background` — warna bubble dari profil
- `color` — warna teks dari profil
- `font-size`, `font-family`, `line-height`, `font-weight` — dari pengaturan font

### 4.3 Tambah Bubble ke Chat (`addBubbleToChat`)

File: `app.js:1698-1721`

```javascript
function addBubbleToChat(msg) {
  if (!msg.id) msg.id = generateUID();
  if (!msg.time) msg.time = formatTime(new Date());

  var html = buildBubbleHTML(msg);

  // Insert SEBELUM typing indicator (agar typing tetap di bawah)
  if (els.typingInd) {
    els.typingInd.insertAdjacentHTML("beforebegin", html);
  } else {
    els.bubbleArea.insertAdjacentHTML("beforeend", html);
  }

  // Simpan ke history (kecuali assistant sementara)
  if (msg.role !== "assistant" || msg.persist) {
    chatHistory.push(msg);
    saveChatHistory();
  }

  updateEmptyPlaceholder();
  scrollToBottom();
}
```

### 4.4 AI Response (`kirimPesanKeAI`)

File: `app.js:1484-1537`

**Alur lengkap:**

1. **Generate system prompt** dari `generateSystemPrompt()` (lihat Bagian 6)
2. **Bangun array messages** untuk API:
   - System prompt sebagai message pertama (role: `system`)
   - 20 pesan terakhir dari `chatHistory` (role: `user`/`assistant` dengan prefiks nama pengirim)
   - Pesan user saat ini dengan format `[NamaPengirim]: teks`
3. **Panggil `callAI(messages, null, 500, skipProviders)`**
4. **Handle response:**
   - Jika HTTP error → simpan limited providers, callback error
   - Jika sukses → simpan limited providers, callback reply text
   - Jika reply kosong → callback error "response kosong"
   - Network error → callback error "Gagal terhubung"

```javascript
function kirimPesanKeAI(userMessage, callback) {
  var systemPrompt = generateSystemPrompt();
  var messages = [];
  messages.push({ role: "system", content: systemPrompt });

  var recentHistory = chatHistory.slice(-20);
  recentHistory.forEach(function (msg) {
    if (msg.role === "assistant") {
      messages.push({ role: "assistant", content: msg.text });
    } else {
      var senderName = (msg.sender === "person1") ? prof.person1.nama : prof.person2.nama;
      messages.push({ role: msg.role, content: "[" + senderName + "]: " + msg.text });
    }
  });

  var senderName = (userMessage.sender === "person1") ? prof.person1.nama : prof.person2.nama;
  messages.push({ role: "user", content: "[" + senderName + "]: " + userMessage.text });

  var skipProviders = loadLimitedProviders();
  callAI(messages, null, 500, skipProviders)
    .then(function (response) { /* handle */ })
    .catch(function () { callback("⚠️ Gagal terhubung ke server AI.", null); });
}
```

### 4.5 `callAI` — Panggil Edge Function

File: `app.js:184-199`

```javascript
function callAI(messages, model, maxTokens, skipProviders) {
  var url = APP_CONFIG.supabaseUrl + "/functions/v1/groq-chat";
  var body = { messages: messages, max_tokens: maxTokens || 500 };
  if (skipProviders && skipProviders.length > 0) {
    body.skip_providers = skipProviders;
  }
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + APP_CONFIG.supabaseAnonKey,
      "apikey": APP_CONFIG.supabaseAnonKey,
    },
    body: JSON.stringify(body),
  });
}
```

**Key points:**
- Endpoint: `{supabaseUrl}/functions/v1/groq-chat`
- Headers: `Authorization` + `apikey` (keduanya menggunakan Anon Key)
- Body: `messages`, `max_tokens`, `skip_providers` (opsional)
- Fallback di-handle oleh Edge Function, bukan di frontend

### 4.6 Riwayat Chat (History)

File: `app.js:1742-1794`

**Penyimpanan:**

| Fungsi | Deskripsi |
|---|---|
| `loadChatHistory()` | Muat dari `localStorage["kita-chat-history"]`, parse ke `chatHistory` array |
| `saveChatHistory()` | Batasi maks 2000 pesan (`slice(-2000)`), simpan ke localStorage |
| `renderChatFromHistory()` | Render ulang semua bubble dari `chatHistory` array |

**Render flow:**
1. Hapus semua bubble dari area chat (kecuali typing indicator & placeholder)
2. Iterasi `chatHistory`, panggil `buildBubbleHTML()` untuk setiap pesan
3. Insert sebelum typing indicator
4. Update placeholder visibility

### 4.7 Voice Note (MediaRecorder API)

File: `app.js:1880-1965`

**Alur rekaman:**

1. **Klik tombol mic** (`#btn-mic`)
2. **Cek dukungan browser** — `navigator.mediaDevices.getUserMedia`
3. **Minta izin mikrofon** — `getUserMedia({ audio: true })`
4. **Pilih MIME type** yang didukung:
   - Prioritas: `audio/webm;codecs=opus` → `audio/webm` → `audio/mp4`
5. **Buat `MediaRecorder`** instance
6. **Event handlers:**
   - `ondataavailable` — kumpulkan chunk audio ke `audioChunks`
   - `onstop` — buat blob dari chunk, generate URL, hitung durasi, tambah bubble voice
7. **Mulai rekam** — `mediaRecorder.start()`, ubah ikon mic jadi ⏹️, tambah class `.recording`
8. **Stop** — klik mic lagi atau panggil `stopRecording()`

```javascript
mediaRecorder.onstop = function () {
  var audioBlob = new Blob(audioChunks, { type: mimeType || "audio/webm" });
  var audioUrl = URL.createObjectURL(audioBlob);

  var durationSec = Math.round((Date.now() - _recordStartTime) / 1000);
  var durMin = Math.floor(durationSec / 60);
  var durSec = durationSec % 60;
  var durationStr = durMin + ":" + String(durSec).padStart(2, "0");

  var msg = {
    type: "voice",
    mediaUrl: audioUrl,
    duration: durationStr,
    // ...
  };
  addBubbleToChat(msg);
};
```

### 4.8 Media Upload (Gambar/Video)

File: `app.js:1967-2034`

**Alur:**

1. **Buat hidden `<input type="file">`** — accept `image/*,video/*`
2. **Klik tombol gallery** (`#btn-gallery`) → trigger klik hidden input
3. **File dipilih** → `URL.createObjectURL(file)`
4. **Deteksi tipe:**
   - Jika `file.type.startsWith("video/")` → buat `<video>` element sementara, baca `duration` via `onloadedmetadata`
   - Jika gambar → langsung tambah bubble
5. **Reset input** — `hiddenFileInput.value = ""`

### 4.9 Typing Indicator

File: `app.js:1582-1592`

Element typing indicator (`#typing-indicator`) adalah bubble dummy dengan tiga dot animasi (`.typing-dot`). Default `display: none`.

```javascript
function showTyping() {
  var ind = getChatElements().typingInd;
  if (ind) { ind.style.display = "flex"; scrollToBottom(); }
}

function hideTyping() {
  var ind = getChatElements().typingInd;
  if (ind) ind.style.display = "none";
}
```

**Animasi CSS:** Tiga dot dengan `animation-delay` berbeda (0s, 0.15s, 0.3s) — bouncing effect.

### 4.10 Lightbox (Fullscreen Gambar)

File: `app.js:2038-2052`

**Trigger:** Klik pada `.image-thumb` atau `.video-thumb` di area chat (via event delegation).

```javascript
function openLightbox(imgSrc) {
  els.lightboxImg.src = imgSrc;
  els.lightbox.style.display = "flex";
  document.body.style.overflow = "hidden";  // Cegah scroll
}

function closeLightbox() {
  els.lightbox.style.display = "none";
  els.lightboxImg.src = "";          // Bersihkan src
  document.body.style.overflow = "";
}
```

**Close trigger:**
- Klik overlay background
- Klik tombol close (✕)
- Tekan Escape

### 4.11 Scroll Management

File: `app.js:1560-1580`

| Fungsi | Deskripsi |
|---|---|
| `scrollToBottom()` | `area.scrollTop = area.scrollHeight` |
| `isNearBottom()` | Return true jika jarak scroll ke bawah < 80px |
| `updateScrollButton()` | Tampilkan/sembunyikan tombol scroll bawah (`#btn-scroll-bottom`) |

**Tombol scroll bawah** muncul (class `.visible`) saat user scroll ke atas. Klik → `scrollToBottom()`.

---

## 5. Pengaturan Profil

### 5.1 Struktur Data (`loadProfilData`)

File: `app.js:583-593`

```javascript
{
  person1: {
    nama: "Kamu",
    warna: "#3b82f6",       // Warna background bubble (biru)
    warnaTeks: "#ffffff"     // Warna teks bubble
  },
  person2: {
    nama: "Sari",
    warna: "#ec4899",       // Warna background bubble (pink)
    warnaTeks: "#ffffff"
  },
  ai: {
    nama: "Kita AI",
    avatar: "🤖",
    warnaBubble: "#7c3aed", // Warna background bubble AI (ungu)
    warnaTeks: "#e0e0e0"
  }
}
```

**Key localStorage:** `kita-profil`

### 5.2 Form Fields

**Person 1 (Kamu):**
- `#profil-p1-nama` — Nama (text input, max 30)
- `#profil-p1-warna` — Warna bubble (color picker)
- `#profil-p1-teks` — Warna teks (color picker + preset dots)

**Person 2 (Pacar):**
- `#profil-p2-nama`, `#profil-p2-warna`, `#profil-p2-teks`

**Profil AI:**
- `#profil-ai-nama` — Nama AI (text input)
- `#profil-ai-avatar` — Avatar/emoji (text input + live preview 2rem)
- `#profil-ai-warna-bubble` — Warna bubble (color picker)
- `#profil-ai-teks` — Warna teks (color picker + preset dots)

### 5.3 Preview Bubble Real-Time

File: `app.js:654-705`

Setiap perubahan input (event `input`) langsung memperbarui preview bubble:

```javascript
function updateProfilPreview(target) {
  // target = "p1", "p2", atau "ai"

  // Baca nilai dari form
  // Update:
  //   - Nama di .bubble-name (preview)
  //   - Background di .bubble-body (preview)
  //   - Warna teks di .bubble-body (preview)
  //   - Hex label
}
```

### 5.4 Color Presets

Setiap color picker teks memiliki 8 preset color dots:

```html
<div class="color-presets" data-target="profil-p1-teks">
  <button class="preset-dot" style="background:#ffffff" data-color="#ffffff"></button>
  <button class="preset-dot" style="background:#fbbf24" data-color="#fbbf24"></button>
  <!-- ... 6 lainnya -->
</div>
```

Event delegation menangani klik: baca `data-color`, set `input.value`, trigger event `input`, panggil `markActivePreset()` untuk menandai dot yang aktif.

### 5.5 Save Flow

File: `app.js:782-819`

**Tombol "Simpan Profil"** (`#btn-simpan-profil`):

1. Baca semua nilai form
2. Bangun objek data profil
3. Panggil `saveProfilData(data)` → `safeSetItem("kita-profil", JSON.stringify(data))`
4. Simpan juga data font (karena satu form)
5. **Side effects:**
   - `updateSpeakerDropdown()` — update nama di dropdown chat
   - `updateExistingBubbles()` — update nama/warna bubble yang sudah ada di area chat
   - `applyFontToAllBubbles()` — terapkan font ke semua bubble
   - `refreshStorageMonitor()` — update monitor storage
   - `showToast("Profil & font berhasil disimpan")`

### 5.6 Update Existing Bubbles

File: `app.js:717-747`

Setelah profil disimpan, semua bubble yang sudah ada di area chat diperbarui:

```javascript
document.querySelectorAll(".bubble-person1 .bubble-name").forEach(function (el) {
  el.textContent = "✨ " + data.person1.nama;
});
document.querySelectorAll(".bubble-person1 .bubble-body").forEach(function (el) {
  el.style.background = data.person1.warna;
  el.style.color = data.person1.warnaTeks;
});
// ... sama untuk person2 dan ai
```

---

## 6. Pengaturan AI

### 6.1 Struktur Data (`loadAIData`)

File: `app.js:1290-1303`

```javascript
{
  nama: "Kita AI",
  kepribadian: "hangat",       // "hangat" | "bijak" | "seru" | "custom"
  customKepribadian: "",       // Hanya jika kepribadian = "custom"
  peraturan: "",               // Instruksi khusus (max 1000 karakter)
  aktif: true,                 // AI otomatis membalas
  bolehSaran: true             // AI boleh memberikan saran/rekomendasi
}
```

**Key localStorage:** `kita-ai`

### 6.2 System Prompt Generation (`generateSystemPrompt`)

File: `app.js:1311-1346`

Fungsi ini menggabungkan data AI + data profil untuk membuat system prompt yang dikirim ke AI provider:

```javascript
function generateSystemPrompt() {
  var ai   = loadAIData();
  var prof = loadProfilData();

  var keprMap = {
    hangat: "Hangat & Ramah — selalu menyapa dengan hangat, empati tinggi, dan bersahabat.",
    bijak:  "Bijak & Netral — memberikan jawaban objektif, seimbang, dan penuh pertimbangan.",
    seru:   "Seru & Santai — gaya bicara santai, humoris, gunakan bahasa gaul sesekali."
  };

  var keprDesc = (ai.kepribadian === "custom" && ai.customKepribadian)
    ? "Custom: " + ai.customKepribadian
    : (keprMap[ai.kepribadian] || "");

  var lines = [];
  lines.push("Kamu adalah " + ai.nama + ".");
  lines.push("Kamu sedang berada dalam percakapan antara " + prof.person1.nama + " dan " + prof.person2.nama + ".");
  lines.push("Kepribadianmu: " + keprDesc);

  if (!ai.aktif) {
    lines.push("PENTING: Kamu sedang NONAKTIF. Jangan membalas pesan apapun.");
  }
  if (!ai.bolehSaran) {
    lines.push("PENTING: JANGAN memberikan saran, ide, atau rekomendasi dalam bentuk apapun.");
  }
  if (ai.peraturan) {
    lines.push("Peraturan khusus: " + ai.peraturan);
  }

  lines.push("Gunakan Bahasa Indonesia yang santai dan natural.");
  lines.push("Jawab dengan singkat, padat, dan relevan dengan percakapan.");
  lines.push("Nama Person 1: " + prof.person1.nama);
  lines.push("Nama Person 2: " + prof.person2.nama);

  return lines.join("\n");
}
```

### 6.3 Preview System Prompt (`updateAIPreview`)

File: `app.js:1380-1425`

Preview real-time system prompt ditampilkan di `<pre id="ai-preview-prompt">`. Setiap perubahan input (nama, kepribadian, peraturan, toggle) langsung memperbarui preview. Format preview mirip dengan `generateSystemPrompt()` tapi dengan header "=== SYSTEM PROMPT ===" dan format lebih readable.

### 6.4 AI Personality Options

| Value | Label | Deskripsi dalam System Prompt |
|---|---|---|
| `hangat` | 🌸 Hangat & Ramah | Hangat & Ramah — selalu menyapa dengan hangat, empati tinggi, dan bersahabat |
| `bijak` | 🧘 Bijak & Netral | Bijak & Netral — memberikan jawaban objektif, seimbang, dan penuh pertimbangan |
| `seru` | 🎉 Seru & Santai | Seru & Santai — gaya bicara santai, humoris, gunakan bahasa gaul sesekali |
| `custom` | ✏️ Custom... | Menggunakan teks dari input `#ai-kepribadian-custom` |

**Toggle:**
- **AI Aktif** (`#ai-aktif`) — jika OFF, AI tidak membalas. System prompt berisi "PENTING: Kamu sedang NONAKTIF."
- **AI Boleh Beri Saran** (`#ai-boleh-saran`) — jika OFF, AI tidak boleh memberi saran/rekomendasi. System prompt berisi "PENTING: JANGAN memberikan saran..."

### 6.5 Peraturan Khusus

Textarea `#ai-peraturan` (max 1000 karakter) untuk instruksi tambahan. Karakter counter real-time (`updatePeraturanCount()`). Ditambahkan ke system prompt sebagai "Peraturan khusus: ...".

---

## 7. Pengaturan Font

### 7.1 Struktur Data (`loadFontData`)

File: `app.js:832-843`

```javascript
{
  ukuran: 15,            // px (range: 12-24)
  fontFamily: "Inter",   // "Inter" | "system-ui" | "serif" | "monospace"
  lineHeight: 1.6,       // (range: 1.2-2.2)
  fontWeight: "400"      // "400" | "700" (bold)
}
```

**Key localStorage:** `kita-font`

### 7.2 Font Family Mapping (`getFontStack`)

File: `app.js:917-924`

```javascript
function getFontStack(family) {
  var map = {
    "Inter":     "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
    "system-ui": "system-ui, 'Segoe UI', -apple-system, sans-serif",
    "serif":     "Georgia, 'Times New Roman', serif",
    "monospace": "'SF Mono', 'Cascadia Code', 'Consolas', 'Courier New', monospace"
  };
  return map[family] || map["Inter"];
}
```

### 7.3 Apply Font ke Semua Bubble

File: `app.js:942-962`

```javascript
function applyFontToAllBubbles(overrides) {
  var data = loadFontData();
  if (overrides) {
    // Override temporary untuk live preview saat form diubah
    if (overrides.ukuran !== undefined)     data.ukuran = overrides.ukuran;
    if (overrides.fontFamily !== undefined) data.fontFamily = overrides.fontFamily;
    if (overrides.lineHeight !== undefined) data.lineHeight = overrides.lineHeight;
    if (overrides.fontWeight !== undefined) data.fontWeight = overrides.fontWeight;
  }

  var fontStack = getFontStack(data.fontFamily || "Inter");
  var lineH = data.lineHeight || 1.6;
  var weight = (data.fontWeight === "700") ? "700" : "400";

  // Terapkan ke semua <p> dalam .bubble-body
  document.querySelectorAll(".bubble-body p").forEach(function (el) {
    el.style.fontSize = data.ukuran + "px";
    el.style.fontFamily = fontStack;
    el.style.lineHeight = lineH;
    el.style.fontWeight = weight;
  });
}
```

### 7.4 Live Preview & Binding

File: `app.js:965-1087`

Setiap perubahan slider/dropdown/toggle langsung memicu:
1. **Update preview** (ukuran font preview box, line height preview, dll)
2. **`applyFontToAllBubbles(getFormOverrides())`** — live preview di area chat

**Reset defaults** mengembalikan semua ke nilai awal: ukuran 15px, Inter, line-height 1.6, tidak bold.

### 7.5 `buildBubbleHTML` — Inline Styles

Font diaplikasikan sebagai **inline styles** pada setiap bubble (bukan CSS class), sehingga:
- Setiap bubble memiliki tampilan independen
- Tidak ada konflik CSS
- Perubahan font langsung terlihat tanpa reload stylesheet
- Format: `style="font-size:15px;font-family:'Inter',...;line-height:1.6;font-weight:400;"`

---

## 8. Status API

### 8.1 Provider List

File: `app.js:2297-2303`

```javascript
var providers = [
  { name: "groq",       label: "Groq",       model: "llama-3.3-70b",    emoji: "⚡" },
  { name: "xai",        label: "xAI",        model: "grok-2-latest",    emoji: "🚀" },
  { name: "openrouter", label: "OpenRouter", model: "gpt-4o-mini",      emoji: "🔗" },
  { name: "cerebras",   label: "Cerebras",   model: "gpt-oss-120b",     emoji: "🧠" },
  { name: "gemini",     label: "Gemini",      model: "gemini-2.0-flash", emoji: "🌐" }
];
```

**Render:** `renderStatusCards()` membuat card untuk setiap provider dengan:
- Indikator warna (hijau = aktif, kuning = limited)
- Nama provider + model
- Status teks ("Aktif", "Limit — reset ~X menit")
- Countdown timer jika sedang limited
- Auto-refresh tiap 30 detik jika ada provider yang limited

### 8.2 Rate Limit Tracking

**Key localStorage:** `kita-limited`

Format:
```javascript
{
  "groq": 1719235000000,    // Timestamp reset_at (ms sejak epoch)
  "xai":  1719235200000
}
```

**Fungsi:**

| Fungsi | Deskripsi |
|---|---|
| `loadLimitedProviders()` | Baca dari localStorage, **auto-clean** provider yang reset_at-nya sudah lewat, return array nama provider yang masih limited |
| `saveLimitedProviders(providers)` | Merge provider limited baru ke localStorage |

### 8.3 Fallback Logic

Flow fallback terjadi di **Edge Function** (bukan di frontend). Frontend hanya mengirim parameter `skip_providers` (daftar provider yang sedang limited) ke Edge Function. Edge Function kemudian mencoba provider satu per satu, melewatkan yang ada di `skip_providers`.

**Prioritas:** groq → xai → openrouter → cerebras → gemini

---

## 9. Penyimpanan & Sync

### 9.1 localStorage Keys

| Key | Tipe Data | Deskripsi |
|---|---|---|
| `kita-chat-history` | JSON array | Riwayat chat (maks 2000 pesan) |
| `kita-profil` | JSON object | Data profil Person 1, Person 2, AI |
| `kita-ai` | JSON object | Pengaturan AI (kepribadian, peraturan, toggle) |
| `kita-api-keys` | JSON object | API keys untuk provider (opsional) |
| `kita-font` | JSON object | Pengaturan font (ukuran, family, line-height, bold) |
| `kita-theme` | String `"dark"` / `"light"` | Tema aktif |
| `kita-sidebar` | JSON object | State sidebar (`{collapsed, width}`) |
| `kita-limited` | JSON object | Provider yang sedang rate-limited (`{provider: resetAt}`) |

### 9.2 Safe localStorage Wrapper

File: `app.js:539-550`

```javascript
function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    scheduleSyncToSupabase();   // Auto-sync ke cloud (debounce 1.5 detik)
    return true;
  } catch (e) {
    console.warn("[KitaAI] Gagal simpan ke localStorage:", key, e.message);
    showToast("Penyimpanan lokal penuh! Hapus history chat lama.", "⚠️");
    return false;
  }
}
```

Setiap kali `safeSetItem` dipanggil, otomatis menjadwalkan sync ke Supabase (debounce 1.5 detik). Jika localStorage penuh (QuotaExceededError), tampilkan toast peringatan.

### 9.3 Supabase Sync

**Tabel:** `public.user_data` (lihat Bagian 12)

#### Load dari Supabase (`loadFromSupabase`)

File: `app.js:59-94`

Dipanggil **sekali** saat `initApp()`, sebelum inisialisasi UI:

1. Cek session
2. `SELECT data FROM user_data WHERE user_id = session.user.id`
3. Jika ada data, **populate semua localStorage keys** dari data server

```javascript
var serverData = resp.data.data;
Object.keys(serverData).forEach(function (key) {
  if (serverData[key]) {
    localStorage.setItem(key, serverData[key]);
  }
});
```

#### Sync ke Supabase (`syncAllToSupabase`)

File: `app.js:98-157`

1. Kumpulkan **semua 8 keys localStorage** ke dalam satu object
2. Cek ukuran total — jika > 900 KB, **auto-trim chat history** (potong 20% secara iteratif sampai muat)
3. Upsert ke `user_data` table: `{user_id, data, updated_at}`
4. Update `_lastSyncTime` dan refresh storage monitor

#### Auto-Trim Safety

File: `app.js:123-138`

```javascript
var totalSize = new Blob([JSON.stringify(allData)]).size;
var MAX_SYNC_SIZE = 900 * 1024;  // 900 KB safety (Supabase limit ~1 MB)

if (totalSize > MAX_SYNC_SIZE && allData['kita-chat-history']) {
  var historyArr = JSON.parse(allData['kita-chat-history']);
  while (new Blob([JSON.stringify(allData)]).size > MAX_SYNC_SIZE && historyArr.length > 50) {
    historyArr = historyArr.slice(-Math.floor(historyArr.length * 0.8));
    allData['kita-chat-history'] = JSON.stringify(historyArr);
  }
  localStorage.setItem('kita-chat-history', allData['kita-chat-history']);
  chatHistory = historyArr;
}
```

#### Schedule Sync (Debounce)

File: `app.js:160-163`

```javascript
function scheduleSyncToSupabase() {
  clearTimeout(_syncDebounceTimer);
  _syncDebounceTimer = setTimeout(function () { syncAllToSupabase(true); }, 1500);
}
```

Dipanggil setiap kali `safeSetItem` — sync dijadwalkan 1.5 detik setelah perubahan terakhir (mencegah spam request).

#### Delete dari Supabase

File: `app.js:166-179`

`DELETE FROM user_data WHERE user_id = session.user.id` — dipanggil saat user klik "Hapus Semua Data".

### 9.4 Storage Monitor

File: `app.js:1092-1284`

**Komponen UI di section Profil:**

- **Progress bar** — persentase pemakaian localStorage (batas 10 MB)
- **Rincian per key** — ukuran masing-masing key (Chat, Profil, AI, API Keys, Font)
- **Status sync Supabase** — kapan terakhir sync, status koneksi
- **Warning** — muncul jika pemakaian > 80%

**Fungsi:**

| Fungsi | Deskripsi |
|---|---|
| `hitungStorageUsage()` | Hitung total bytes + detail per key |
| `getByteSize(str)` | Hitung ukuran string UTF-8 via `new Blob([str]).size` |
| `formatBytes(bytes)` | Format ke "1.2 KB" / "5.3 MB" |
| `refreshStorageMonitor()` | Update semua elemen UI + render status sync |

**Tombol aksi:**
- **🔄 Refresh** — update tampilan
- **🗑️ Hapus History Chat** — hapus `kita-chat-history`, kosongkan area chat
- **⚠️ Hapus Semua Data** — hapus semua key + delete dari Supabase + reload halaman

---

## 10. Notifikasi Toast

File: `app.js:500-526`

### 10.1 Komponen

```html
<div id="toast" class="toast" style="display: none;">
  <span id="toast-icon" class="toast-icon">✅</span>
  <span id="toast-text" class="toast-text"></span>
</div>
```

Toast muncul di tengah layar (position fixed, centered), dengan animasi fade-in/out.

### 10.2 API

```javascript
showToast(teks, ikon, type);
```

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `teks` | String | Teks notifikasi |
| `ikon` | String / null | Emoji ikon (jika null, gunakan default berdasarkan type) |
| `type` | String / null | `"success"` (hijau, ikon ✓), `"error"` (merah, ikon ✗), null (default, ikon dari parameter) |

### 10.3 Behavior

- **Duration:** 2.5 detik (auto-hide)
- **Pending timer dibatalkan** jika `showToast` dipanggil lagi sebelum hide
- CSS class: `.toast.show` untuk visibility, `.toast.success` / `.toast.error` untuk warna

### 10.4 CSS Styling (dari style.css)

Toast diposisikan fixed di tengah: `top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1000`. Background glassmorphism, border-radius penuh, animasi `fadeSlideIn`.

---

## 11. Edge Function (groq-chat)

File: `supabase/functions/groq-chat/index.ts` (264 baris)

### 11.1 Overview

Edge Function ini adalah **proxy multi-provider** yang berjalan di Supabase (Deno runtime). Menerima permintaan dari frontend, mencoba provider AI satu per satu secara sequential, dan mengembalikan response dari provider pertama yang berhasil.

### 11.2 Provider Definitions

```typescript
interface ProviderDef {
  name: string;
  secretKey: string;          // Nama environment variable (diambil dari Deno.env)
  defaultModel: string;
  buildRequest: (apiKey, messages, maxTokens) => { url, headers, body };
  extractReply: (data) => string | null;
}
```

**5 Provider:**

| Provider | Secret Key Env | Default Model | API Endpoint |
|---|---|---|---|
| `groq` | `GROQ_API_KEY` | `llama-3.3-70b-versatile` | `api.groq.com/openai/v1/chat/completions` |
| `xai` | `XAI_API_KEY` | `grok-2-latest` | `api.x.ai/v1/chat/completions` |
| `openrouter` | `OPENROUTER_API_KEY` | `openai/gpt-4o-mini` | `openrouter.ai/api/v1/chat/completions` |
| `cerebras` | `CEREBRAS_API_KEY` | `gpt-oss-120b` | `api.cerebras.ai/v1/chat/completions` |
| `gemini` | `GEMINI_API_KEY` | `gemini-2.0-flash` | `generativelanguage.googleapis.com/v1beta/models/...` |

**Khusus Gemini:** Format request berbeda — messages dikonversi dari `{role, content}` menjadi `{contents: [{role, parts: [{text}]}]}`. System prompt digabung sebagai `user`. API key dikirim via query parameter.

### 11.3 Sequential Fallback Logic

```typescript
for (let i = 0; i < PROVIDERS.length; i++) {
  const prov = PROVIDERS[i];

  // 1. SKIP jika provider di-skip oleh frontend
  if (skipProviders.includes(prov.name)) continue;

  // 2. SKIP jika secret tidak ditemukan di environment
  const apiKey = Deno.env.get(prov.secretKey);
  if (!apiKey) continue;

  // 3. COBA panggil API provider
  try {
    const upstream = await fetch(url, { method: "POST", ... });
    const upstreamData = await upstream.json();

    // 4. Jika HTTP error → catat, lanjut ke provider berikutnya
    if (!upstream.ok) {
      // Jika 429 → parse Retry-After, tandai provider sebagai limited
      if (status === 429) {
        const retryAfter = upstream.headers.get("retry-after");
        const resetAt = parseRetryAfter(retryAfter);
        limitedProviders[prov.name] = resetAt;
      }
      continue;
    }

    // 5. Jika reply kosong → lanjut
    const replyText = prov.extractReply(upstreamData);
    if (!replyText) continue;

    // 6. SUKSES → return response
    return new Response(JSON.stringify({
      success: true,
      provider: prov.name,
      choices: [{ index: 0, message: { role: "assistant", content: replyText }, finish_reason: "stop" }],
      rate_limits: rateLimits,
      limited_providers: limitedProviders,
    }), { status: 200 });

  } catch (fetchErr) {
    // Network error → lanjut
    continue;
  }
}

// 7. SEMUA GAGAL → return 502
return new Response(JSON.stringify({
  success: false,
  error: "Semua provider AI gagal.",
  details: errors,
  limited_providers: limitedProviders,
}), { status: 502 });
```

### 11.4 Rate Limit Handling (429)

**Deteksi 429:**
```typescript
if (status === 429) {
  const retryAfter = upstream.headers.get("retry-after")
    || upstream.headers.get("x-ratelimit-reset");
  const resetAt = parseRetryAfter(retryAfter);
  limitedProviders[prov.name] = resetAt || (Date.now() + 60_000); // fallback 60 detik
}
```

**Parse Retry-After:**
```typescript
function parseRetryAfter(val: string | null): number | null {
  if (!val) return null;
  const num = parseInt(val, 10);
  if (!isNaN(num)) return Date.now() + num * 1000;  // detik relatif
  const date = Date.parse(val);
  return isNaN(date) ? null : date;                   // absolute date
}
```

**Rate limit info di response sukses:** Jika header `x-ratelimit-remaining-*` menunjukkan sisa ≤ 1, provider ditandai sebagai limited secara preemptif.

### 11.5 Response Format

**Sukses (200):**
```json
{
  "success": true,
  "provider": "groq",
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "choices": [{
    "index": 0,
    "message": { "role": "assistant", "content": "Halo! Ada yang bisa dibantu?" },
    "finish_reason": "stop"
  }],
  "rate_limits": [{ "provider": "groq", "status": "ok", ... }],
  "limited_providers": {}
}
```

**Gagal (502):**
```json
{
  "success": false,
  "error": "Semua provider AI gagal.",
  "details": ["groq: HTTP 429", "xai: network error", ...],
  "rate_limits": [...],
  "limited_providers": { "groq": 1719235000000 }
}
```

**CORS:** Semua response menyertakan header CORS (`Access-Control-Allow-Origin: *`).

---

## 12. Database Supabase

File: `supabase/migrations/20240624000000_user_data.sql`

### 12.1 Tabel `public.user_data`

```sql
CREATE TABLE IF NOT EXISTS public.user_data (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

| Kolom | Tipe | Deskripsi |
|---|---|---|
| `user_id` | UUID (PK, FK) | Primary key, foreign key ke `auth.users(id)`. ON DELETE CASCADE |
| `data` | JSONB | Seluruh data user dalam format JSON (key-value dari localStorage) |
| `created_at` | TIMESTAMPTZ | Waktu pertama kali data dibuat |
| `updated_at` | TIMESTAMPTZ | Waktu terakhir data diubah (auto-update via trigger) |

**Relasi:** One-to-one dengan `auth.users` (setiap user memiliki tepat satu row di `user_data`).

### 12.2 Row Level Security (RLS)

```sql
ALTER TABLE public.user_data ENABLE ROW LEVEL SECURITY;

-- SELECT: user hanya bisa baca data miliknya sendiri
CREATE POLICY "Users can select own data"
  ON public.user_data FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT: user hanya bisa insert data dengan user_id miliknya
CREATE POLICY "Users can insert own data"
  ON public.user_data FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: user hanya bisa update data miliknya sendiri
CREATE POLICY "Users can update own data"
  ON public.user_data FOR UPDATE
  USING (auth.uid() = user_id);

-- DELETE: user hanya bisa hapus data miliknya sendiri
CREATE POLICY "Users can delete own data"
  ON public.user_data FOR DELETE
  USING (auth.uid() = user_id);
```

**Keamanan:** Setiap operasi CRUD diperiksa dengan `auth.uid() = user_id`. Tidak ada user yang bisa mengakses data user lain.

### 12.3 Trigger `updated_at`

```sql
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_data_updated_at
  BEFORE UPDATE ON public.user_data
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
```

Setiap kali row di-UPDATE, kolom `updated_at` otomatis di-set ke waktu saat ini.

---

## 13. CSS Architecture

File: `css/style.css` (1201 baris)

### 13.1 CSS Variables (Design Tokens)

**Dark Mode** (`:root`):

```css
:root {
  /* Background hierarchy */
  --bg-root:    #06060b;      /* Paling gelap */
  --bg-body:    #0a0a12;      /* Background body */
  --bg-surface: #12121f;      /* Card, section */
  --bg-elevated:#1a1a28;      /* Header, modal */
  --bg-overlay: #1e1e2c;      /* Overlay, hover */

  /* Text hierarchy */
  --text-primary:   #e3e0f3;  /* Judul, teks utama */
  --text-secondary: #c7c4d7;  /* Teks body */
  --text-muted:     #908fa0;  /* Hint, placeholder */

  /* Border */
  --border-subtle:  rgba(255,255,255,0.08);  /* Border halus */
  --border-default: #464554;                 /* Border normal */

  /* Accent (indigo-violet gradient) */
  --accent:        #6366f1;    /* Indigo */
  --accent-hover:  #818cf8;    /* Indigo light */
  --accent-end:    #a855f7;    /* Violet */
  --accent-soft:   rgba(99,102,241,0.12);
  --accent-glow:   rgba(99,102,241,0.30);
  --ai-glow:       rgba(168,85,247,0.05);

  /* Shadow */
  --shadow-xs: 0 1px 2px rgba(0,0,0,0.3);
  --shadow-sm: 0 2px 8px rgba(0,0,0,0.4);
  --shadow-md: 0 4px 16px rgba(0,0,0,0.5);
  --shadow-lg: 0 8px 32px rgba(0,0,0,0.6);

  /* Border radius */
  --radius-xs: 4px;  --radius-sm: 8px;   --radius-md: 12px;
  --radius-lg: 16px; --radius-xl: 24px;  --radius-2xl: 16px;
  --radius-full: 9999px;

  /* Transitions */
  --transition-fast:   0.15s cubic-bezier(0.4,0,0.2,1);
  --transition-base:   0.25s cubic-bezier(0.4,0,0.2,1);
  --transition-smooth: 0.35s cubic-bezier(0.4,0,0.2,1);

  /* Layout dimensions */
  --header-h: 64px;
  --sidebar-w: 220px;
  --sidebar-collapsed-w: 60px;
  --chat-max-w: 1000px;
  --bottom-nav-h: 68px;
}
```

**Light Mode** (`body:not(.dark)`):

Semua variable di-override dengan nilai light:
```css
body:not(.dark) {
  --bg-body:    #f0f0f7;
  --bg-surface: #ffffff;
  --text-primary: #13131e;
  --text-muted:   #9494a6;
  --border-subtle: rgba(0,0,0,0.08);
  /* ... dst */
}
```

**Pola overriding:** Semua komponen menggunakan CSS variables, sehingga transisi dark/light hanya perlu toggle class `body.dark`. Transisi di-animasikan via `transition: background var(--transition-smooth), color var(--transition-smooth)`.

### 13.2 Layout System

```
┌──────────────────────────────────────────────────┐
│  #app-header (fixed, z-40, h=64px, glassmorphism)│
├────────┬─────────────────────────────────────────┤
│#sidebar│  #main-content                          │
│(fixed, │  (flex:1, margin-left: sidebar-w,       │
│ z-50,  │   overflow-y:auto)                      │
│ 220px) │  ┌────────────────────────────────┐     │
│        │  │  .content-section.active       │     │
│        │  │  (display:flex, flex:1,        │     │
│        │  │   overflow-y:auto)             │     │
│        │  └────────────────────────────────┘     │
├────────┴─────────────────────────────────────────┤
│  #bottom-nav (mobile only, fixed bottom, z-100)  │
└──────────────────────────────────────────────────┘
```

**Key CSS patterns:**
- Body: `display:flex; flex-direction:column; height:100vh; overflow:hidden`
- `#app-wrapper`: `display:flex; flex:1; min-height:0; overflow:hidden` (mencegah overflow body)
- `#main-content`: `flex:1; margin-left: var(--sidebar-w); overflow-y:auto`
- `.content-section`: `display:none` → `.active` = `display:flex; flex:1; overflow-y:auto`

### 13.3 Component Styling Pattern

**Glassmorphism (Header, Bottom Nav):**
```css
background: rgba(18,18,31,0.82);
backdrop-filter: blur(12px);
-webkit-backdrop-filter: blur(12px);
border-bottom: 1px solid var(--border-subtle);
```

**Card (Section, Form Card):**
```css
background: var(--bg-surface);
border-radius: var(--radius-lg);
padding: 36px;
box-shadow: var(--shadow-lg);
border: 1px solid var(--border-subtle);
```

**Button (Nav Link Active, Accent):**
```css
background: linear-gradient(135deg, var(--accent), var(--accent-end));
color: #fff;
font-weight: 700;
box-shadow: 0 4px 16px var(--accent-glow);
```

**Toggle Switch:**
- Checkbox disembunyikan (`opacity:0; width:0; height:0`)
- `.toggle-slider` pseudo-element sebagai visual switch
- `input:checked + .toggle-slider` — background accent, dot bergeser ke kanan

**Form Elements:**
- `.form-input` — border bottom only, background transparent, focus: border accent
- `.form-color` — color picker styled (width 40px, height 40px, border-radius)
- `.form-range` — slider custom (track + thumb styled)
- `.form-select` — dropdown custom dengan background surface

### 13.4 Responsive Breakpoints

```css
/* Tablet — sidebar collapsed by default */
@media (max-width: 900px) {
  #sidebar { width: var(--sidebar-collapsed-w) !important; }
  #sidebar .nav-label { display: none; }
  #main-content { margin-left: var(--sidebar-collapsed-w); }
  #section-chat.content-section.active { border-radius: var(--radius-md); }
}

/* Mobile — bottom nav instead of sidebar */
@media (max-width: 640px) {
  #app-header { padding: 0 16px; }
  #sidebar { display: none; }
  #bottom-nav { display: block; }
  #main-content {
    margin-left: 0 !important;
    margin-bottom: var(--bottom-nav-h);
    padding: 16px 12px;
  }
  .content-section { padding: 20px 16px; border-radius: var(--radius-md); }
  #section-chat.content-section { border-radius: var(--radius-md); }
  #section-chat.content-section.active { border-radius: var(--radius-md) var(--radius-md) 0 0; }
  #chat-bubble-area { padding: 16px 12px; gap: 12px; }
  #chat-input-bar { padding: 8px 10px 12px; }
  .chat-textarea { font-size: 0.9rem; }
}
```

### 13.5 Animations

**Fade Slide In (section transition):**
```css
@keyframes fadeSlideIn {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
.content-section { animation: fadeSlideIn 0.3s ease-out; }
```
Setiap section yang diaktifkan muncul dengan animasi slide-up + fade-in.

**Typing Dots (bouncing):**
```css
@keyframes typingBounce {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-8px); }
}
.typing-dot:nth-child(1) { animation-delay: 0s; }
.typing-dot:nth-child(2) { animation-delay: 0.15s; }
.typing-dot:nth-child(3) { animation-delay: 0.3s; }
```

**Voice Wave (playing state):**
```css
@keyframes waveAnimation {
  0%, 100% { height: 4px; }
  50% { height: 16px; }
}
.bubble-voice.playing .wave-bar {
  animation: waveAnimation 0.6s ease-in-out infinite;
}
/* Staggered delays untuk 7 wave bar */
```

**Ripple Effect (tombol kirim):**
```css
@keyframes rippleEffect {
  from { transform: scale(0); opacity: 1; }
  to { transform: scale(3); opacity: 0; }
}
```

**Recording Pulse (tombol mic saat merekam):**
```css
.btn-mic.recording {
  animation: recordingPulse 1.5s infinite;
  background: #ef4444;
  color: #fff;
}
@keyframes recordingPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); }
  50% { box-shadow: 0 0 0 12px rgba(239,68,68,0); }
}
```

---

## Appendix A: Utilitas

| Fungsi | Lokasi | Deskripsi |
|---|---|---|
| `escapeHTML(str)` | `app.js:533-537` | Escape karakter HTML untuk cegah XSS (menggunakan `createTextNode`) |
| `isLightColor(hex)` | `app.js:553-566` | Deteksi warna terang (luminance > 0.6) untuk kontras teks |
| `formatTime(date)` | `app.js:569-572` | Format `Date` ke `HH:mm` |
| `generateUID()` | `app.js:575-577` | Generate ID unik: `msg_<timestamp>_<random6>` |
| `getByteSize(str)` | `app.js:1106-1110` | Hitung ukuran string UTF-8 via `new Blob([str]).size` |
| `formatBytes(bytes)` | `app.js:1141-1145` | Format bytes ke "1.2 KB" / "5.3 MB" |
| `getFontStack(family)` | `app.js:917-924` | Konversi nama font ke CSS font-family stack |
| `markActivePreset(targetId, color)` | `app.js:927-939` | Tandai preset dot yang cocok dengan warna saat ini |

## Appendix B: Event Delegation Summary

| Container | Event | Target Selector | Handler |
|---|---|---|---|
| `#nav-list` (sidebar) | `click` | `.nav-link` | `showSection(sectionId)` |
| `#bottom-nav` | `click` | `.bottom-nav-link` | `showSection(sectionId)` |
| `#chat-bubble-area` | `click` | `.image-thumb` | `openLightbox(src)` |
| `#chat-bubble-area` | `click` | `.video-thumb` | `openLightbox(src)` |
| `#chat-bubble-area` | `click` | `.voice-play-btn` | `playVoiceNote(url, btn)` |
| `#lightbox-overlay` | `click` | (self or close btn) | `closeLightbox()` |
| `.color-presets` | `click` | `.preset-dot` | Set color input + trigger event |

## Appendix C: Inisialisasi Aplikasi (`initApp`)

File: `app.js:2384-2418`

**Urutan inisialisasi:**

1. `loadFromSupabase()` — Load data dari cloud (async, await)
2. `generateNavigation()` — Generate sidebar + bottom nav HTML
3. `bindNavigationEvents()` — Binding klik navigasi
4. `initSidebar()` — Apply state, binding toggle + resize
5. `showSection(APP_CONFIG.defaultActive)` — Tampilkan section default ("section-chat")
6. `bindThemeToggle()` — Binding toggle dark/light
7. `initChat()` — Load history, render atau hapus dummy, binding chat events
8. `initProfil()` — Populate form, binding profil events
9. `initAI()` — Populate form, binding AI events
10. `initFont()` — Populate form, binding font events, apply font ke bubble
11. `initStorageMonitor()` — Refresh monitor, binding storage events
12. `bindLogoutButtons()` — Binding tombol logout + refresh status

**Error handling:** Setiap step di-wrap dalam try-catch terpisah, sehingga kegagalan satu modul tidak menghentikan inisialisasi modul lainnya.

---

*Dokumentasi ini mencakup seluruh aspek teknis aplikasi Kita & AI. Untuk pertanyaan lebih lanjut, silakan merujuk ke source code langsung.*
