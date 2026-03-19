# CLAUDE.md

## Proje
Dulra Mobile — Ekolojik saha çalışmaları için mobil uygulama. Offline veri girişi, fotoğraf, GPS ve Supabase senkronizasyon.

## Tech Stack
- Expo SDK 55, React Native, TypeScript
- Expo Router (file-based routing)
- expo-sqlite + Drizzle ORM (offline DB)
- NativeWind (Tailwind CSS)
- Zustand (client state)
- @supabase/supabase-js (backend)
- expo-camera, expo-location, expo-file-system

## Komutlar
npx expo start              # Dev server
npx expo start --clear      # Cache temizle + dev server
npx expo run:ios            # iOS simulator
npx expo run:android        # Android emulator

## Klasör Yapısı
- src/app/ → Sadece route dosyaları (ince, screen import eder)
- src/screens/ → Ekran component'leri (iş mantığı burada)
- src/components/ → Paylaşılan UI bileşenleri
- src/lib/ → Supabase client, SQLite setup, sync logic, utils
- src/hooks/ → Custom hooks
- src/constants/ → Renkler, config sabitleri
- src/types/ → TypeScript tipleri

## Kurallar
- app/ içine iş mantığı koyma, sadece route
- Kebab-case dosya isimleri (my-screen.tsx)
- @/ path alias → src/ dizinine işaret eder
- `any` type kullanma, `unknown` veya proper interface yaz
- EXPO_PUBLIC_ prefix → client'ta görünür, hassas key koyma
- .ios.tsx / .android.tsx → platform-specific dosyalar
- _layout.tsx = layout wrapper
- (group)/ = route group (URL'de görünmez)
- console.log production'da olmasın
- Dosyalar 400 satırı geçmesin, parçala

## Offline-First Prensibi
- Tüm veri önce SQLite'a yazılır (sync_status: pending)
- Internet gelince Supabase'e sync edilir (sync_status: synced)
- Uygulama internetsiz tam çalışmalı

## UX Kuralları
- Hedef kullanıcı: 40-50 yaş üstü saha ekolojistleri
- Büyük dokunma alanları (minimum 48x48px)
- Okunabilir font boyutu (minimum 16px)
- Sayfa geçişlerinde yumuşak animasyon (Reanimated veya Moti ile)
- Ani geçiş yok, her ekran geçişi fade veya slide ile olmalı
- Sade, temiz UI — karmaşık gesture yok
- Buton ve aksiyonlar açık, anlaşılır olmalı
- Loading state'lerde skeleton veya spinner göster
- Uygulama dili tamamen İngilizce olmalı (UI metinleri, tarihler, saat formatları, içerikler)
