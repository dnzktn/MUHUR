# Mühür Faz 3 — Gerçek E-posta Gönderimi Tasarımı

**Tarih:** 2026-08-13
**Kapsam:** Proje 5 — Mühür Yeminli Çeviri Platformu, Faz 3 (ilk alt proje: e-posta gönderimi).

## Bağlam

Faz 1 (backend temel: veri modeli, Gemini entegrasyonu, sipariş/belge/taslak/onay
API'leri) ve Faz 2 (sipariş formu + çalışma alanı UI'sinin API'ye bağlanması)
tamamlandı, `main`'e alındı, gerçek Gemini API'sine karşı ve gerçek tarayıcıda
uçtan uca doğrulandı. Bu iki fazda e-posta gönderimi bilerek kapsam dışı
bırakılmıştı ("Onayla → notere gönder → e-posta ile paylaş" adımının son kısmı
mock/log olarak bırakılmıştı).

Faz 3, brief'te ayrı bir alt sistem olarak işaretlenen dört parçadan (e-posta
gönderimi, e-posta ile belge alımı, ödeme entegrasyonu, gerçek prototip tasarımı)
en küçük ve en izole olanıyla başlıyor: **onaylanmış bir çevirinin gerçek bir
e-posta servisiyle müşteriye gönderilmesi**. Diğer üç parça ayrı spec+plan
döngüleri olarak ele alınacak.

## Kararlar

- **E-posta servisi:** Resend. Modern API, cömert ücretsiz katman, temiz Node.js
  SDK'sı. Gönderen adresi şimdilik Resend'in test/onboarding adresi
  (`onboarding@resend.dev`) — gerçek domain doğrulaması yok, bu yüzden yalnızca
  Resend hesabına kayıtlı e-postalara gönderim yapılabilir. Gerçek müşterilere
  gönderim için domain doğrulaması ileride (Faz 3'ün devamında ya da
  yayına-hazırlık aşamasında) gerekecek — bu bilinen bir kısıt, kod bunu
  zorlamaz.
- **Mimari:** Faz 1'in `TranslationProvider` desenini tekrar eder. `EmailProvider`
  arayüzü (`send({ to, subject, text }): Promise<void>`) tanımlanır,
  `ResendEmailService` bunu gerçek Resend SDK'sıyla implemente eder.
  `buildApp({ geminiService?, emailService? })` — `emailService` de enjekte
  edilebilir olur, testlerde sahte bir provider kullanılır (gerçek API'ye asla
  dokunulmaz).
- **Tetikleyici:** Otomatik değil — onaylandıktan sonra ayrı, açık bir "E-posta
  ile Gönder" butonu/endpoint'i. Brief'teki "onayla → notere gönder → e-posta
  ile paylaş" akışına uygun (aradaki noter adımı fiziksel/manuel, sistem
  dışında kalıyor, bu fazda ele alınmıyor).
- **İçerik:** Düz metin e-posta gövdesi — `FinalTranslation.finalText` doğrudan
  gövdeye yazılır. PDF üretimi/eki YAGNI (Faz 1'de dosya saklama zaten
  ertelenmişti, PDF üretimi ayrı bir kapsam).
- **Durum takibi:** `OrderStatus.SENT` (Faz 1'de tanımlı, hiç kullanılmamış)
  kullanılır. Gönderim başarılı olunca `Order.status` `SENT`'e geçer. Tekrar
  gönderime izin verilir (engellenmez) — müşteri e-postayı kaybetmiş olabilir.
- **`DELIVERED` durumu kapsam dışı:** Gerçek teslimat onayı Resend'in webhook'unu
  gerektirir (imza doğrulama, yeni endpoint). YAGNI — bu fazda eklenmiyor.
  `Order.status` `SENT`'te kalır, `DELIVERED`'a hiç geçmez.
- **Ön koşul:** Sipariş `FinalTranslation`'a sahip değilse (henüz onaylanmamışsa)
  gönderim `400` ile reddedilir — Faz 1/2'nin "asla belirsiz durumda bırakma"
  ilkesiyle tutarlı.

## Backend Değişiklikleri

**`EmailProvider` arayüzü ve `ResendEmailService`** (`src/services/email.service.ts`,
Faz 1'in `gemini.service.ts`'iyle aynı desen):

```typescript
export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
}

export interface EmailProvider {
  send(input: SendEmailInput): Promise<void>;
}

export class ResendEmailService implements EmailProvider {
  // Resend SDK'sını sarar, from: "onboarding@resend.dev" sabit
}
```

**`POST /api/orders/:id/send-email`** (JWT korumalı — `requireAuth`, mevcut
`orders.routes.ts` dosyasına eklenir)
- `prisma.order.findFirst({ where: { id, tenantId } })` — tenant-scoped, Faz 1/2
  desenini tekrarlar. Bulunamazsa `404`.
- İlişkili `Document`'ın `FinalTranslation`'ı yoksa `400` ("Önce belgeyi
  onaylayın").
- `opts.emailService.send({ to: order.customer.email, subject: "Çeviri
  Belgeniz Hazır", text: finalTranslation.finalText })` çağrılır.
- Başarılı → `prisma.order.update({ data: { status: "SENT" } })`, `200` döner.
- Resend hatası → `502` + net mesaj; `Order.status` değişmeden kalır (zaten
  `APPROVED`, tekrar denenebilir bir durumda — ambiguous/stuck değil).

**`buildApp()` değişikliği:** `BuildAppOptions`'a `emailService?: EmailProvider`
eklenir, `ordersRoutes`'a enjekte edilir (Faz 1'in `documentsRoutes`'a
`geminiService` enjeksiyonuyla aynı desen).

## Frontend Değişikliği

`workspace.js`: sipariş `APPROVED` ya da `SENT` durumundaysa (finalize
başarılı olduktan sonra ya da sayfa yeniden yüklendiğinde), "E-posta ile
Gönder" butonu görünür olur. Tıklanınca `POST /api/orders/:id/send-email`
çağrılır; başarılı olursa "E-posta gönderildi" mesajı gösterilir, buton tekrar
tıklanabilir kalır (yeniden gönderime izin var).

## Test

Yeni endpoint, Faz 1/2 deseniyle TDD ile geliştirilir: gerçek Postgres'e karşı
(`resetDb()`), sahte `EmailProvider` enjekte edilerek (gerçek Resend API'sine
testlerde asla dokunulmaz). Son adım, Faz 1'in Task 12'sindeki gibi gerçek
Resend API'sine karşı manuel bir doğrulama script'i/adımı — Resend hesabına
kayıtlı gerçek bir e-posta adresine gerçek bir e-posta gönderildiğini
kanıtlamak için.

## Ortam

`.env`'e `RESEND_API_KEY` eklenir (kullanıcı Resend hesabı açıp API key
oluşturacak). `.env.test`'te gerçek bir değere ihtiyaç yok (testler sahte
provider kullanır).

## Kapsam Dışı (sonraki alt projeler)

- E-posta ile belge alımı (inbox izleme)
- Ödeme entegrasyonu (iyzico/PayTR)
- Gerçek prototip tasarımının uygulanması
- Resend domain doğrulaması (gerçek müşterilere gönderim için gerekli olacak)
- Teslimat onayı (`DELIVERED` durumu, webhook)
- PDF üretimi/e-posta eki
