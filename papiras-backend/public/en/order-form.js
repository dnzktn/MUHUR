const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file");

dropzone.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) {
    dropzone.textContent = fileInput.files[0].name;
    dropzone.classList.add("filled");
  } else {
    dropzone.textContent = "Drag a file here or click to upload";
    dropzone.classList.remove("filled");
  }
});

document.getElementById("order-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const errorBox = document.getElementById("error");
  const resultBox = document.getElementById("result");
  errorBox.classList.add("hidden");
  resultBox.classList.add("hidden");

  const name = document.getElementById("name").value.trim();
  const email = document.getElementById("email").value.trim();
  const sourceLang = document.getElementById("sourceLang").value;
  const targetLang = document.getElementById("targetLang").value;
  const file = document.getElementById("file").files[0];
  const pastedText = document.getElementById("pastedText").value.trim();

  if (!file && !pastedText) {
    errorBox.textContent = "Upload a file or paste some text.";
    errorBox.classList.remove("hidden");
    return;
  }

  try {
    const customerRes = await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email }),
    });
    const customerBody = await customerRes.json();
    if (!customerRes.ok) {
      throw new Error(customerBody.error || "Could not create customer.");
    }

    const form = new FormData();
    form.append("customerId", customerBody.customerId);
    form.append("sourceLang", sourceLang);
    form.append("targetLang", targetLang);
    if (file) {
      form.append("file", file);
    } else {
      form.append("pastedText", pastedText);
    }

    const documentRes = await fetch("/api/documents", {
      method: "POST",
      body: form,
    });
    const documentBody = await documentRes.json();
    if (!documentRes.ok) {
      throw new Error(documentBody.error || "Could not upload document.");
    }

    resultBox.textContent = `Your order has been received. Tracking number: ${documentBody.orderId}`;
    resultBox.classList.remove("hidden");
    document.getElementById("order-form").reset();
    dropzone.textContent = "Drag a file here or click to upload";
    dropzone.classList.remove("filled");
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.remove("hidden");
  }
});
