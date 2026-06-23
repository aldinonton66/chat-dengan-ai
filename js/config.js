// ============================================================
//  FILE: config.js
//  DESKRIPSI: Konfigurasi dasar aplikasi "Kita & AI"
//  Digunakan untuk menyimpan pengaturan global,
//  theme default, label, dan konstanta lainnya.
// ============================================================

var APP_CONFIG = {

  // Nama aplikasi (ditampilkan di header)
  appName: "Kita & AI",

  // Tema default: 'light' atau 'dark'
  defaultTheme: "dark",

  // Daftar menu navigasi
  // id       → ID section yang akan ditampilkan
  // label    → Teks yang tampil di sidebar / bottom nav
  // icon     → Simbol emoji untuk menu
  navMenu: [
    { id: "section-chat",   label: "Chat Utama",       icon: "💬" },
    { id: "section-profil", label: "Pengaturan Profil", icon: "👤" },
    { id: "section-ai",     label: "Pengaturan AI",     icon: "🤖" },
    { id: "section-api",    label: "Pengaturan API",    icon: "🔑" }
  ],

  // Menu default yang aktif saat halaman pertama dimuat
  defaultActive: "section-chat"

};

// ============================================================
//  DATA LOGIN — username → SHA-256 hash password
//  Disimpan di sessionStorage saat login berhasil
// ============================================================
var LOGIN_USERS = {
  "aldi": "db7b0dbb5029b025cf48a6a50ef3156197fe0e706a846166bc2976a5c91bc776",
  "adel": "44845775d767f86435b81f0c297a15d821e7bafe387942dedd9572324932a651"
};
