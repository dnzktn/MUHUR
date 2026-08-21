# Mühür — Sabit Fiyat Yerine Teklif Akışı Tasarımı

**Tarih:** 2026-08-21
**Kapsam:** Proje 5 — Mühür Yeminli Çeviri Platformu. Sitede sabit fiyat gösterimini kaldırıp, belge yükleyen müşteriye manuel bir fiyat teklifi e-postayla gönderilen bir akış eklemek.

## Bağlam

Faz 2.5'e kadar gerçek sitede zaten hiçbir fiyat gösterilmiyordu (Faz 2'de sipariş formuna bilinçli olarak fiyat hesaplayıcı eklenmemişti — backend'de sayfa sayısı/ekspres/noter/apostil alanları hiç doldurulmuyordu). Elimizdeki prototip dosyalarında (`muhur-prototip-v5.html`, `muhur-prototip-v6-calisma-alani_1.html`) ise sabit bir fiyat listesi (TR-EN 180 TL/sayfa vb.) ve canlı fiyat hesaplayıcılı bir sipariş akışı var — ama bu sayfalar hiçbir zaman gerçek siteye inşa edilmedi.

Kullanıcı artık işi netleştirdi: **sitede hiçbir zaman sabit fiyat gösterilmeyecek.** Bunun yerine, müşteri belgesini yükler, Yağmur (doğrulanmış profesyonel) belgeye bakıp manuel bir fiyat belirler, ve müşteriye sadece bu fiyat teklifini içeren bir e-posta gönderilir — çeviri metninin kendisi değil.

## Kararlar

- **Çeviri zamanlaması değişmiyor:** Belge yüklenince Gemini hemen taslak üretmeye devam eder (mevcut `POST /api/documents` akışı aynen kalır). Teklif süreci, çeviri sürecinin *paralelinde/sonrasında* eklenen ayrı bir adımdır, onu geciktirmez.
- **Şema değişikliği yok:**
  - `Order.priceTotal` (Faz 1'den beri şemada var, hiçbir route hiç doldurmuyordu) artık teklif tutarını tutar.
  - `OrderStatus.IN_REVIEW` (Faz 1'den beri tanımlı, hiç kullanılmıyordu) "teklif gönderildi, müşteri yanıtı bekleniyor" durumu için yeniden kullanılır.
- **Yeni endpoint, mevcut e-posta desenini tekrarlar:** `POST /api/orders/:id/send-quote`, Faz 3'ün `POST /api/orders/:id/send-email`'iyle aynı desen (JWT korumalı, tenant-scoped, mevcut `EmailProvider` enjeksiyonunu kullanır) — ama farklı bir amaç ve gövde taşır.
  - Girdi: `{ priceTotal: number }` (pozitif sayı, TL).
  - `Order.priceTotal` güncellenir, `Order.status` `IN_REVIEW`'a çekilir.
  - Müşteriye şu içerikte e-posta gönderilir: konu "Çeviri Teklifiniz Hazır", gövde fiyatı ve kısa bir bilgilendirme içerir (çeviri metni **asla** bu e-postaya dahil edilmez).
  - Tekrar gönderime izin var — Yağmur fiyatı güncelleyip yeniden teklif gönderebilir (aynı `send-email` rotasının "resend allowed" deseni).
  - Ön koşul yok (finalize'daki gibi `FinalTranslation` şartı aranmaz) — teklif, taslak hazır olur olmaz gönderilebilir, çeviri bitmeden de gönderilebilir.
- **Onayla + E-posta ile Gönder akışı değişmiyor:** Bu ikisi, teklif kabul edildikten sonra (şimdilik ödeme entegrasyonu olmadan, manuel/telefon onayıyla) nihai çeviriyi göndermek için kullanılmaya devam eder. Aralarında zorunlu bir sıralama/engelleme eklenmiyor — Yağmur işini nasıl yürüteceğine kendi karar verir (dahili bir araç, katı bir state machine'e gerek yok).
- **Pazarlama sayfaları kararı kalıcı hale getiriliyor:** İleride ana sayfa/hizmetler/fiyatlandırma gibi sayfalar inşa edilirse, hiçbir sabit fiyat tablosu/listesi eklenmeyecek — bu, ayrı bir gelecek spec'e not olarak taşınacak, şimdi inşa edilecek bir şey yok (o sayfalar hâlâ kapsam dışı).

## Backend Değişikliği

**`POST /api/orders/:id/send-quote`** (JWT korumalı — `requireAuth`, mevcut `orders.routes.ts` dosyasına eklenir)
- `prisma.order.findFirst({ where: { id, tenantId } })` — tenant-scoped, mevcut desen. Bulunamazsa `404`.
- Body doğrulama: `priceTotal` sayı ve `> 0` değilse `400`.
- `opts.emailService.send({ to: order.customer.email, subject: "Çeviri Teklifiniz Hazır", text: "<fiyatı içeren metin>" })` çağrılır.
- Başarılı → `prisma.order.update({ data: { priceTotal, status: "IN_REVIEW" } })`, `200` döner.
- E-posta hatası → `502` + net mesaj; `Order.priceTotal`/`status` değişmeden kalır (mevcut `send-email` deseniyle aynı: hata durumunda yarım güncelleme yapılmaz).

## Frontend Değişikliği

`workspace.html`'de `ws-grid`'in altına, mevcut "Onayla/E-posta ile Gönder" bölümünün (`send-box`) üstüne yeni bir "Fiyat Teklifi" kartı eklenir:
- Sayı girişi (TL), mevcut `Order.priceTotal` doluysa (0'dan büyükse) o değerle önceden doldurulur.
- "Teklifi Gönder" butonu → `POST /api/orders/:id/send-quote` çağırır.
- Başarılı olursa "Teklif gönderildi: X TL" mesajı gösterilir, `#order-status` rozeti `IN_REVIEW` olarak güncellenir.

## Test

Yeni endpoint, Faz 3 deseniyle TDD ile geliştirilir: gerçek Postgres'e karşı (`resetDb()`), sahte `EmailProvider` enjekte edilerek. Frontend değişikliği için otomatik test yok (proje genelindeki karar) — gerçek tarayıcıda manuel uçtan uca doğrulama yapılır.

## Kapsam Dışı

- Ödeme entegrasyonu / teklif "kabul" akışı (müşterinin teklifi onaylaması hâlâ manuel/telefon/e-posta yoluyla, sistem dışında)
- Pazarlama sayfaları (ana sayfa, hizmetler, fiyatlandırma, kurumsal, takip, iletişim) — hâlâ ayrı bir alt proje, bu spec sadece "fiyat listesi asla eklenmeyecek" kararını kaydeder
- Teklif geçmişi/versiyonlama (sadece en son gönderilen fiyat tutulur, `Order.priceTotal` üzerine yazılır)
