import FormData from "form-data";

async function main(): Promise<void> {
  const baseUrl = process.env.MUHUR_BASE_URL ?? "http://localhost:3000";
  const customerId = process.env.TEST_CUSTOMER_ID;

  if (!customerId) {
    throw new Error(
      "Set TEST_CUSTOMER_ID to the demo customer id printed by `npm run prisma:seed`."
    );
  }

  const form = new FormData();
  form.append("customerId", customerId);
  form.append("sourceLang", "TR");
  form.append("targetLang", "EN");
  form.append(
    "pastedText",
    "Bu belge nüfus cüzdanı örneğidir. Ad: Ayşe Yılmaz. Doğum tarihi: 01.01.1990."
  );

  // Use a buffer (not the raw stream) so undici sends a correct Content-Length
  // and the multipart body isn't truncated.
  const res = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    body: form.getBuffer() as unknown as BodyInit,
    headers: form.getHeaders(),
  });

  const body = await res.json();
  console.log("Response status:", res.status);
  console.log("Response body:", body);

  if (res.status !== 201) {
    throw new Error("Document upload failed — see response body above.");
  }

  console.log("\nFaz 1 uçtan uca akış başarılı: belge yüklendi, Gemini taslağı üretildi.");
  console.log(`Order id: ${body.orderId}`);
  console.log(`Draft id: ${body.draftId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
