// ============================================================
//  FILE: config.js
//  DESKRIPSI: Konfigurasi global aplikasi "Kita & AI"
//  Semua nilai di sini AMAN diekspos ke publik (bukan secret)
// ============================================================

var APP_CONFIG = {

  // Nama aplikasi (ditampilkan di header)
  appName: "Kita & AI",

  // Tema default: 'light' atau 'dark'
  defaultTheme: "dark",

  // Supabase — Project URL & Anon Key (public, aman di frontend)
  supabaseUrl: "YOUR_SUPABASE_URL",
  supabaseAnonKey: "YOUR_SUPABASE_ANON_KEY",

  // Daftar menu navigasi
  navMenu: [
    { id: "section-chat",   label: "Chat Utama",       icon: "💬" },
    { id: "section-profil", label: "Pengaturan Profil", icon: "👤" },
    { id: "section-ai",     label: "Pengaturan AI",     icon: "🤖" },
    { id: "section-api",    label: "Pengaturan API",    icon: "🔑" }
  ],

  // Menu default yang aktif saat halaman pertama dimuat
  defaultActive: "section-chat"

};
