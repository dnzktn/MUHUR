# Mühür — Sipariş Bildirimleri & Müşteri Teklif Yanıtı Tasarımı

**Tarih:** 2026-08-27
**Kapsam:** Proje 5 — Mühür Yeminli Çeviri Platformu. Yeni sipariş geldiğinde ve müşteri bir fiyat teklifine yanıt verdiğinde profesyonele (Yağmur) e-posta + WhatsApp bildirimi göndermek; müşterinin teklif e-postasındaki linkten teklifi kabul/reddedebilmesi.

## Bağlam

Şu an sistemde yeni bir sipariş geldiğinde ya da bir müşteri (varsayımsal olarak) teklife yanıt verdiğinde Yağmur'a hiçbir otomatik bildirim gitmiyor — panele elle girip kontrol etmesi gerekiyor. Ayrıca müşterinin gönderilen fiyat teklifine dijital olarak yanıt verebileceği hiçbir mekanizma yok; kabul/red şu ana kadar telefon/e-posta üzerinden, tamamen sistem dışı yürüyordu.

Bu spec iki şeyi birlikte ele alır:
1. Yeni sipariş oluştuğunda Yağmur'a bildirim.
2. Müşterinin teklif e-postasındaki bir linke tıklayarak teklifi kabul/reddedebilmesi — kabul ederse sipariş `APPROVED` olur, her iki durumda da Yağmur'a ikinci bir bildirim gider.

**Ödeme entegrasyonu bu spec'in kapsamı dışındadır** — kabul edilen teklifler şimdilik "ödeme adımı yakında eklenecek" mesajıyla sonuçlanır. Ödeme, ayrı bir brainstorm+spec döngüsü olarak ele alınacak (sağlayıcı seçimi, webhook mantığı, fatura gereksinimi gibi kararlar orada verilecek).

## Kararlar

- **Bildirim kanalları:** Her iki olay için de (yeni sipariş, teklif kabul, teklif red) hem e-posta hem WhatsApp aynı anda gönderilir. Bildirim gönderimi başarısız olursa müşterinin işlemi (sipariş oluşturma / teklif yanıtlama) engellenmez, sadece loglanır — mevcut `EmailProvider` hata toleransı deseniyle aynı yaklaşım.
- **Alıcı:** Şimdilik tek, sabit bir alıcı — `.env`'deki `NOTIFY_EMAIL` ve `NOTIFY_WHATSAPP_NUMBER`. Professional tablosuna bildirim tercihi eklenmez (tek profesyonel var, YAGNI).
- **WhatsApp sağlayıcısı:** Twilio WhatsApp API. `WhatsAppProvider` arayüzü + `TwilioWhatsAppService` implementasyonu, `EmailProvider`/`ResendEmailService` deseninin birebir aynısı (tek metotlu arayüz, `BuildAppOptions`'a enjekte edilir, testler sahte/mock provider kullanır).
- **Şema değişikliği yok.** Ne bildirim sistemi ne de teklif yanıtı için yeni tablo/alan eklenmez:
  - Kabul/red linklerindeki token, DB'de saklanmaz — `HMAC-SHA256(orderId + "accept"|"reject", QUOTE_TOKEN_SECRET)` ile anlık hesaplanır ve her `send-quote` e-postası gönderiminde yeniden üretilir.
  - Teklifin hâlâ geçerli olup olmadığı, sadece `Order.status === "IN_REVIEW"` kontrolüyle anlaşılır — token'ın kendi bir süre dolumu (expiry) yoktur. Sipariş `IN_REVIEW`'dan çıktığı an (kabul/red edildiğinde ya da Yağmur elle başka bir statüye taşıdığında) eski linkler otomatik işlevsiz hale gelir.
  - Kabul edilen teklif, statüyü `APPROVED`'a taşır — Yağmur'un "Onayla" butonuyla yaptığı statü geçişiyle aynı hedef statü, ayrı bir "QUOTE_ACCEPTED" statüsü eklenmez.
  - Reddedilen teklif statüyü **değiştirmez** — sadece bildirim gönderilir, pazarlık/yeni teklif kararı Yağmur'a kalır.

## Backend Değişiklikleri

### 1. `WhatsAppProvider` arayüzü + `TwilioWhatsAppService`

Yeni dosya `src/services/whatsapp.service.ts`, `email.service.ts`'in birebir örüntüsü:

```typescript
export interface SendWhatsAppInput { to: string; text: string; }
export interface WhatsAppProvider { send(input: SendWhatsAppInput): Promise<void>; }
export class TwilioWhatsAppService implements WhatsAppProvider { ... }
```

`BuildAppOptions`'a `whatsappService?: WhatsAppProvider` eklenir, `buildApp` içinde varsayılan olarak `new TwilioWhatsAppService(...)` inşa edilir (gerçek Twilio anahtarları yoksa geliştirme ortamında sahte değerlerle çalışır, çağrı hata verirse loglanır — mevcut Resend/Gemini toleransıyla aynı).

### 2. Bildirim yardımcı fonksiyonu

`src/services/notify.service.ts`: `notifyProfessional(emailService, whatsappService, message: { subject: string; body: string })` — hem e-posta hem WhatsApp'ı paralel (`Promise.allSettled`) gönderir, her biri ayrı ayrı hata verirse loglar, hiçbirinin hatası çağıranı etkilemez (fire-and-forget, `await` edilir ama hata yutulur).

### 3. Yeni sipariş bildirimi

`POST /api/documents` rotasının başarılı akışının sonuna (mevcut Gemini taslak oluşturma tamamlandıktan sonra) eklenir:

```typescript
await notifyProfessional(opts.emailService, opts.whatsappService, {
  subject: "Yeni Sipariş",
  body: `Yeni sipariş: ${customer.name} — ${sourceLang}→${targetLang}. Panelden incele: ${PUBLIC_BASE_URL}/workspace.html?order=${order.id}`,
});
```

Bu çağrı `await` edilir ama hata fırlatmaz (yukarıdaki yardımcı zaten yutuyor) — müşterinin `201` yanıtını asla geciktirmez/engellemez.

### 4. Teklif e-postasına kabul/red linkleri

`POST /api/orders/:id/send-quote` rotasındaki e-posta gövdesi güncellenir:

```typescript
const acceptToken = signQuoteToken(order.id, "accept");
const rejectToken = signQuoteToken(order.id, "reject");
const text = `Merhaba, çeviri talebiniz için fiyat teklifimiz: ${priceTotal} TL.

Teklifi kabul etmek için: ${PUBLIC_BASE_URL}/api/quotes/${order.id}/accept?token=${acceptToken}
Teklifi reddetmek için: ${PUBLIC_BASE_URL}/api/quotes/${order.id}/reject?token=${rejectToken}`;
```

`signQuoteToken(orderId, action)` → `crypto.createHmac("sha256", QUOTE_TOKEN_SECRET).update(`${orderId}:${action}`).digest("hex")`.

### 5. Yeni public endpoint'ler: `GET /api/quotes/:orderId/accept` ve `.../reject`

Kimlik doğrulama gerektirmez (müşteri girişi yok). Akış:

1. `token` doğrulanır (`signQuoteToken` ile yeniden hesaplanıp karşılaştırılır — sabit zamanlı karşılaştırma, `crypto.timingSafeEqual`). Uyuşmazsa → `302` ile `/quote-invalid.html`.
2. `prisma.order.findUnique({ where: { id: orderId } })` — bulunamazsa veya `status !== "IN_REVIEW"` ise → `302` ile `/quote-invalid.html`.
3. **Accept:** `prisma.order.update({ data: { status: "APPROVED" } })`, ardından Yağmur'a bildirim ("{müşteri adı} {fiyat} TL'lik teklifi kabul etti. Sipariş: {workspace linki}") → `302` ile `/quote-accepted.html`.
4. **Reject:** DB güncellemesi yok, sadece Yağmur'a bildirim ("{müşteri adı} {fiyat} TL'lik teklifi reddetti. Sipariş: {workspace linki}") → `302` ile `/quote-rejected.html`.

Bu iki route `ordersRoutes` içine değil, ayrı bir `quotesRoutes` (`src/routes/quotes.routes.ts`) dosyasına eklenir — `requireAuth` preHandler'ı olmayan tek route grubu olduğu için mevcut `ordersRoutes`'a karıştırılmaz, `app.ts`'te ayrıca register edilir.

## Frontend Değişiklikleri

Üç yeni statik sayfa (`public/` altında, mevcut `order-form.html` ile aynı görsel dil — nav + kart + footer):

- **`quote-accepted.html`** — "Teklifi kabul ettiniz, teşekkürler! Ödeme adımı yakında eklenecek, ekibimiz sizinle en kısa sürede iletişime geçecek."
- **`quote-rejected.html`** — "Geri bildiriminiz için teşekkürler."
- **`quote-invalid.html`** — "Bu link artık geçerli değil ya da teklif zaten işlendi."

Bu sayfalar tamamen statik (JS gerektirmez), `workspace.js`/`order-form.js` gibi bir script dosyasına ihtiyaç duymaz.

## Test Stratejisi

- `whatsapp.service.ts` için `email.service.ts` testinin birebir aynı deseni (Twilio SDK mocklanır, `send()` çağrısının doğru parametrelerle yapıldığı ve hata durumunda fırlattığı doğrulanır).
- `POST /api/documents` testine: sipariş oluşunca `notifyProfessional`'ın (sahte email+whatsapp provider'larla) çağrıldığını doğrulayan bir test eklenir; bildirim provider'ı hata verse bile `201` yanıtının değişmediğini doğrulayan ayrı bir test.
- `GET /api/quotes/:orderId/accept` ve `.../reject` için: geçerli token ile `IN_REVIEW` siparişte doğru statü geçişi + doğru redirect; geçersiz token ile `quote-invalid` redirect; `IN_REVIEW` olmayan siparişte (örn. zaten `APPROVED`) geçerli token bile olsa `quote-invalid` redirect (idempotency/tekrar tıklama koruması); reddedilince statünün değişmediğinin doğrulanması.

## Yapılandırma

Yeni `.env` değişkenleri (gerçek değerler kullanıcı tarafından sağlanacak, geliştirme/test ortamında sahte değerlerle çalışır):

```
NOTIFY_EMAIL="..."
NOTIFY_WHATSAPP_NUMBER="+90..."
TWILIO_ACCOUNT_SID="..."
TWILIO_AUTH_TOKEN="..."
TWILIO_WHATSAPP_FROM="whatsapp:+1415..."
QUOTE_TOKEN_SECRET="..."
PUBLIC_BASE_URL="http://localhost:3000"
```

`PUBLIC_BASE_URL`, teklif e-postasındaki linklerin ve bildirimlerdeki workspace linklerinin tam URL'sini oluşturmak için kullanılır (prod'da gerçek domain'e ayarlanacak).

## Kapsam Dışı

- **Ödeme entegrasyonu** — kabul edilen teklif şimdilik sadece statüyü `APPROVED`'a taşır, ödeme akışı yok. Ayrı bir brainstorm+spec döngüsü olarak ele alınacak.
- Twilio WhatsApp template onayı süreci — kurulum sırasında (gerçek Twilio hesabı açıldığında) ele alınır, kod tarafında bir engel değil.
- Birden fazla profesyonel için ayrı ayrı bildirim tercihleri.
- Token süre dolumu (expiry) — `Order.status` kontrolü zaten bu ihtiyacı karşılıyor.
- Müşterinin teklife not/karşı teklif ekleyebilmesi — sadece kabul/red var.
