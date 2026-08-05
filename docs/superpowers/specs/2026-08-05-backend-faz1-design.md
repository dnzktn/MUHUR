# Mühür Backend — Faz 1 Tasarımı

**Tarih:** 2026-08-05
**Kapsam:** Proje 5 — Mühür Yeminli Çeviri Platformu backend'inin ilk fazı.

## Bağlam

Mühür, AI'ın (şu an sadece Gemini; Claude ileride eklenecek) çevirdiği, yeminli/doğrulanmış
bir profesyonelin kontrol edip imzaladığı resmî çeviri servisidir. Önce Türkiye'de TR-EN-FR
ile başlar, göçmenlik hukuku bürolarına (B2B) satılır. Frontend prototipi ayrı bir Claude
sohbetinde hazırlanmıştır ve bu oturumda elde değildir; bu backend, prototipin tarif ettiği
akışlara (sipariş, çalışma alanı, taslak sekmeleri, kelime bazlı öneri, imza/tarih, e-posta
gönderimi) göre tasarlanmıştır.

Backend işi büyük ve çok parçalı olduğu için aşamalara bölündü. Bu spec sadece **Faz 1**'i
kapsar: veri modeli + tech stack + Gemini "belge yükle → taslak al" akışının uçtan uca
çalışması. Sonraki fazlar (workspace UI bağlama, e-posta intake, bildirim/gönderim, ödeme)
ayrı spec'ler olarak ele alınacak.

## Kararlar

- **Tech stack:** Node.js + TypeScript, Fastify, Prisma ORM, PostgreSQL (Docker container).
  Tümü ücretsiz/açık kaynak.
- **AI sağlayıcı:** Şimdilik sadece **Gemini** (Google AI Studio ücretsiz katmanı, geliştirme
  amaçlı). Claude entegrasyonu bilinçli olarak ertelendi (maliyet nedeniyle). Veri modeli ve
  kod yapısı (`provider` alanı) çoklu sağlayıcıya hazır bırakılacak.
  - **Önemli kısıt:** Ücretsiz Gemini katmanında gönderilen veriler Google tarafından model
    geliştirme amacıyla kullanılabilir. Gerçek müşteri belgeleri (kişisel/hukuki belgeler)
    işlenmeye başlamadan önce ücretli/billing-enabled katmana geçilmesi gerekir. Bu, kod ile
    zorlanan bir kısıt değil, operasyonel bir hatırlatmadır.
- **Multi-tenant:** Veri modelinde `tenant_id` alanları bulunur ama Faz 1'de tek bir tenant
  ("Mühür") kullanılır. B2B müşteriler (göçmenlik büroları) tenant değil, `Customer` kaydı
  olarak modellenir.
- **Auth:** İç panel (çalışma alanı) için email+password login, JWT ile korunan endpoint'ler.
  Sipariş oluşturma (dış/müşteri tarafı) auth gerektirmez.
- **Belge formatları:** PDF, fotoğraf/görsel, Word (.docx), yapıştırılan düz metin.
  - PDF ve görseller doğrudan Gemini'ye (multimodal) gönderilir — ayrı OCR adımı yok.
  - DOCX, `mammoth` ile düz metne çevrilip Gemini'ye gönderilir.
  - Yapıştırılan metin doğrudan gönderilir.
- **Ortam:** Şimdilik sadece yerel geliştirme (Docker Compose ile Postgres). Deploy/hosting
  kararı sonraya bırakıldı.
- **E-posta gönderimi:** Faz 1'de mock/log — gerçek SendGrid/Postmark entegrasyonu ayrı bir
  faza bırakıldı (brief'te de belirtildiği gibi).
- **Ödeme:** Faz 1 kapsamı dışında; `Payment` tablosu şema olarak var ama entegrasyon yok.

## Veri Modeli

```
Tenant (şimdilik tek satır: "Mühür")
  - id, name

Customer (B2B büro veya bireysel müşteri)
  - id, tenant_id, name, email, phone, type (individual | corporate)

VerifiedProfessional ("doğrulanmış profesyonel" — Yağmur ilk kayıt)
  - id, tenant_id, name, email, password_hash
  - languages (örn. ["TR","EN","FR"]), region, capacity, rate

Document (yüklenen belge)
  - id, tenant_id, customer_id, order_id
  - source_format (pdf | image | docx | pasted_text)
  - file_url, extracted_text
  - source_lang, target_lang
  - status (received | extracting | ready | failed)

Order (sipariş)
  - id, tenant_id, customer_id
  - status (received | ai_drafting | drafts_ready | in_review | approved | sent | delivered)
  - service_type (standard | express), notary (bool), apostille (bool)
  - page_count, price_total
  - assigned_professional_id

Draft (AI taslağı — belge + sağlayıcı başına)
  - id, document_id, provider (gemini | claude — ileride)
  - draft_text, status (pending | ready | failed), created_at

FinalTranslation (nihai, düzenlenmiş çeviri)
  - id, document_id, edited_by (professional_id), final_text, signed_at

Payment
  - id, order_id, method (card | iban), status, amount
```

`VerifiedProfessional` soyutlaması bilinçli seçildi: "yeminli tercüman" yerine kullanılıyor
ki Proje 2/3'te farklı doğrulanmış profesyonel tipleri (örn. noter, avukat) aynı tabloyu
paylaşabilsin.

## AI Entegrasyonu ve API Akışı

**Belge yükleme → taslak üretimi:**
1. `POST /api/documents` — dosya (PDF/JPG/PNG/DOCX) veya yapıştırılan metin + hedef dil ile
   yüklenir.
   - DOCX: `mammoth` ile metin çıkarılır, düz metin olarak Gemini'ye gönderilir.
   - PDF/görsel: dosya doğrudan Gemini'ye (multimodal) gönderilir, okuma+çeviri tek istekte.
   - Yapıştırılan metin: doğrudan gönderilir.
2. Gemini'den çeviri istenir → `Draft` kaydı oluşturulur (`provider: gemini`).
3. Tek sağlayıcı olduğu için Faz 1'de tek taslak sekmesi olacak; `provider` alanı ileride
   Claude eklenince ikinci sekmeyi destekleyecek şekilde tasarlandı.

**Kelime/ifade seçince canlı öneri:**
- `POST /api/documents/:id/suggest` — seçili metin parçası + bağlam gönderilir, Gemini'den
  farklı "temperature" ile 2-3 alternatif çeviri istenir.

**Onay ve teslim akışı:**
- `PATCH /api/orders/:id/finalize` — nihai metin + imza/tarih kaydedilir, `FinalTranslation`
  oluşturulur.
- E-posta gönderimi mock/log (yukarıda belirtildi).

## Auth

- `POST /api/auth/login` — email+password → JWT access token (kısa ömürlü, refresh token
  yok, Faz 1 için gereksiz karmaşıklık).
- İç panel endpoint'leri (`/api/orders`, `/api/documents/:id/finalize` vb.) JWT gerektirir.
- Sipariş oluşturma (`POST /api/documents`, müşteri tarafı) auth gerektirmez.

## Proje Yapısı

```
muhur-backend/
  src/
    routes/        (auth, documents, orders, drafts)
    services/      (gemini.service.ts, extraction.service.ts)
    prisma/        (schema.prisma, migrations)
    lib/           (jwt, error handling)
  docker-compose.yml   (postgres)
  .env.example
```

## Hata Yönetimi

- Gemini API hatası/timeout → `Draft.status = failed`, kullanıcıya net hata döner. Rakiplerin
  en çok şikayet aldığı nokta "sessiz gecikme" olduğu için `Order.status` her adımda açıkça
  güncellenir, hata sessizce yutulmaz.
- Dosya format doğrulama: desteklenmeyen format/boyut aşımı `400` ile net mesajla reddedilir.
- Ücretsiz Gemini rate limit aşımı: `429` yakalanır, kullanıcıya "sistem yoğun, tekrar deneyin"
  + backend log'unda uyarı (ücretli katmana geçiş sinyali).

## Test Planı (Faz 1 hedefi)

Uçtan uca script/test: gerçek bir PDF veya metin ile belge yükle → Gemini'den taslak dönsün →
veritabanına doğru kaydedildiğini doğrula (`npm run test:flow` gibi bir komutla).

## Kapsam Dışı (sonraki fazlar)

- Mevcut prototip UI'sinin gerçek API'ye bağlanması
- E-posta ile belge alımı (inbox izleme)
- Gerçek e-posta gönderim entegrasyonu (SendGrid/Postmark)
- Ödeme entegrasyonu (iyzico/PayTR)
- Claude API entegrasyonu (ikinci taslak sağlayıcı)
- Gerçek rol/yetki modeli (ortaklık yapısı netleşince)
