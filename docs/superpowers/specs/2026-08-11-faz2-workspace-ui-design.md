# Mühür Faz 2 — Çalışma Alanı UI Tasarımı

**Tarih:** 2026-08-11
**Kapsam:** Proje 5 — Mühür Yeminli Çeviri Platformu, Faz 2.

## Bağlam

Faz 1'de Fastify + Prisma + PostgreSQL + Gemini backend'i tamamlandı, tüm testler
yeşil, gerçek Gemini API'sine karşı uçtan uca doğrulandı (bkz.
[2026-08-05-backend-faz1-plan.md](../plans/2026-08-05-backend-faz1-plan.md)).
Backend'in arkasında durduğu prototip HTML dosyası (`muhur-prototip-v6-calisma-alani.html`)
hiçbir zaman bu oturuma ya da diske ulaşmadı — kullanıcı da dosyaya erişemiyor. Bu
yüzden Faz 2, prototipi bağlamak yerine, orijinal brief'teki ekran tanımlarına göre
**minimum, fonksiyonel bir frontend'i sıfırdan** inşa edip mevcut API'ye bağlar.

Kapsam bilinçli olarak daraltıldı: pazarlama sayfaları (ana sayfa, hizmetler,
fiyatlandırma, kurumsal, takip, iletişim) bu fazda yok. Sadece iş akışının kalbi:
**sipariş formu** (müşteri tarafı) ve **çalışma alanı** (profesyonel tarafı).

## Kararlar

- **Frontend stack:** Sade HTML/CSS/vanilla JS, build aracı yok. Faz 1'in sadeliğiyle
  tutarlı, hızlı kurulur.
- **Sunum:** `@fastify/static` ile `muhur-backend/public/` klasörü sunucudan doğrudan
  sunulur — ayrı bir frontend sunucusu, CORS yapılandırması gerekmez.
- **Görsel tasarım seviyesi:** Fonksiyonel/sade. Amaç API entegrasyonunu doğrulamak;
  gerçek prototip/marka kimliği elde edilince tasarım o zaman değiştirilecek.
- **Login:** Gerçek bir login sayfası (e-posta+şifre → `POST /api/auth/login` →
  JWT `localStorage`'a yazılır).
- **Panel giriş noktası:** Basit bir sipariş listesi (`GET /api/orders` — yeni
  endpoint) → tıklanınca çalışma alanına gidilir. URL query param ile doğrudan
  gitme yerine gerçekçi bir liste akışı seçildi.
- **Müşteri oluşturma:** Sipariş formunda e-posta girilince otomatik müşteri
  upsert edilir (`POST /api/customers` — yeni endpoint). Manuel müşteri yönetimi
  yok, form kendi kendine yeterli.
- **Nihai metin düzenleme:** `contenteditable` div — metin seçimi ve öneriyle
  yerinde değiştirme `window.getSelection()` ile doğal çalışır.
- **Test yaklaşımı:** Yeni backend endpoint'leri Faz 1'deki gibi TDD + gerçek
  Postgres'e karşı test edilir. Frontend için otomatik test yok; tarayıcıda
  uçtan uca manuel doğrulama yapılır (kullanıcının "UI değişikliklerinde
  tarayıcıda dene" kuralına uygun).

## Backend Eklemeleri

İki yeni endpoint, Faz 1'in mevcut dosya yapısına (`src/routes/`, `TranslationProvider`
deseni, `resetDb()` test altyapısı) uyumlu şekilde eklenir:

**`POST /api/customers`** (auth gerektirmez — sipariş formu herkese açık)
- Girdi: `{ name: string, email: string }`
- `prisma.customer.upsert({ where: { email }, update: { name }, create: { tenantId, name, email } })`
  — email zaten `@unique`, tenant Faz 1'deki tek satırdan alınır (seed'deki sabit
  tenant id ya da `prisma.tenant.findFirstOrThrow()`).
- Çıktı: `201 { customerId }`
- Boş/eksik `name`/`email` → `400`.

**`GET /api/orders`** (JWT korumalı — `requireAuth`)
- `request.professional!.tenantId` ile scoped: `prisma.order.findMany({ where: { tenantId }, include: { customer: true }, orderBy: { createdAt: "desc" } })`
- Çıktı: `200 [{ id, status, createdAt, customer: { name, email } }, ...]`
- Faz 1'de kurulan tenant-scoping desenini (Task 8dcae4d/d34fcfe'de eklenen)
  tekrar kullanır — yeni bir güvenlik deseni icat edilmez.

## Sayfalar ve Akış

```
order-form.html  (herkese açık)
  → POST /api/customers  → customerId
  → POST /api/documents  → orderId, documentId, draftId
  → "Siparişiniz alındı, takip numaranız: <orderId>"

login.html  (herkese açık)
  → POST /api/auth/login  → token → localStorage
  → yönlendirme: orders.html

orders.html  (JWT gerekli)
  → GET /api/orders  → tablo (müşteri, durum, tarih)
  → satır tıkla → workspace.html?order=<id>

workspace.html?order=<id>  (JWT gerekli)
  → GET /api/orders/:id  → orijinal metin (Document.extractedText) + AI taslağı (Draft.draftText) yan yana
  → taslak metni contenteditable div'e kopyalanır (düzenlenebilir nihai metin)
  → metin seç → "Öneri iste" → POST /api/documents/:id/suggest → 3 öneri listesi → tıkla → seçili metnin yerine geçer
  → imza/tarih ekle: statik metin ekleme (backend çağrısı yok)
  → "Onayla" → PATCH /api/orders/:id/finalize { documentId, finalText } → başarılıysa "Onaylandı, e-posta gönderimi Faz 3'te eklenecek"
```

## Hata Yönetimi

- Her fetch `try/catch` içinde; API'nin döndürdüğü `{ error: "..." }` mesajı
  kırmızı bir uyarı kutusunda gösterilir (Faz 1 zaten net mesajlar döndürüyor).
- `401` alan herhangi bir istek → `login.html`'e otomatik yönlendirme.
- Gemini `502` (çeviri başarısız) → çalışma alanında "AI taslağı üretilemedi,
  tekrar deneyin" mesajı; backend zaten `Draft.status: FAILED` +
  `Order.status: RECEIVED` ile temiz bir duruma dönüyor, frontend sadece bunu
  yansıtır.
- `PATCH .../finalize` `409` (zaten onaylanmış) → "Bu belge zaten onaylanmış"
  mesajı, buton devre dışı bırakılır.

## Kapsam Dışı (sonraki fazlar)

- Pazarlama sayfaları (ana sayfa, hizmetler, fiyatlandırma, kurumsal, takip,
  iletişim)
- Gerçek e-posta gönderimi (onaylandıktan sonra)
- E-posta ile belge alımı (inbox izleme)
- Ödeme entegrasyonu
- Gerçek prototip tasarımının (Apple Design ilkeleri, marka kimliği) uygulanması
  — prototip dosyası elde edilince ayrı bir tasarım geçişi olarak ele alınacak
- Gemini 429 (kota) özel mesajı ve dosya saklama (Faz 1'de zaten ertelenmişti)
