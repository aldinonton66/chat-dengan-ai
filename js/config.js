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
