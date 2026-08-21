const token = localStorage.getItem("muhur_token");
if (!token) {
  window.location.href = "/login.html";
  throw new Error("Redirecting to login");
}

const params = new URLSearchParams(window.location.search);
const orderId = params.get("order");

const loadingEl = document.getElementById("loading");
const contentEl = document.getElementById("workspace-content");
const errorEl = document.getElementById("error");
const successEl = document.getElementById("success");

let currentDocumentId = null;

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}

function hideError() {
  errorEl.classList.add("hidden");
}

async function loadOrder() {
  hideError();
  if (!orderId) {
    showError("Sipariş ID'si belirtilmedi.");
    loadingEl.classList.add("hidden");
    return;
  }

  try {
    const res = await fetch(`/api/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) {
      localStorage.removeItem("muhur_token");
      window.location.href = "/login.html";
      return;
    }

    const order = await res.json();
    if (!res.ok) {
      throw new Error(order.error || "Sipariş yüklenemedi.");
    }

    const doc = order.documents[0];
    if (!doc) {
      throw new Error("Bu siparişte belge bulunamadı.");
    }
    currentDocumentId = doc.id;

    document.getElementById("customer-name").textContent = order.customer.name;
    document.getElementById("order-status").textContent = order.status;
    const sendEmailBtn = document.getElementById("send-email-btn");
    if (order.status === "APPROVED" || order.status === "SENT") {
      sendEmailBtn.classList.remove("hidden");
    }
    document.getElementById("original-text").textContent =
      doc.extractedText || "(orijinal metin yok)";

    const readyDraft = doc.drafts.find((draft) => draft.status === "READY");
    const failedDraft = doc.drafts.find((draft) => draft.status === "FAILED");
    const finalTextEl = document.getElementById("final-text");
    if (doc.finalTranslation) {
      finalTextEl.textContent = doc.finalTranslation.finalText;
    } else if (readyDraft) {
      finalTextEl.textContent = readyDraft.draftText;
    } else if (failedDraft) {
      finalTextEl.textContent = "AI taslağı üretilemedi, tekrar deneyin.";
    } else {
      finalTextEl.textContent = "(AI taslağı henüz hazır değil)";
    }

    loadingEl.classList.add("hidden");
    contentEl.classList.remove("hidden");
  } catch (err) {
    loadingEl.classList.add("hidden");
    showError(err.message);
  }
}

loadOrder();

document.getElementById("suggest-btn").addEventListener("click", async () => {
  hideError();

  if (!currentDocumentId) {
    showError("Belge henüz yüklenmedi.");
    return;
  }

  const selection = window.getSelection();
  const selectedText = selection.toString().trim();
  const finalTextEl = document.getElementById("final-text");

  if (!selectedText || !finalTextEl.contains(selection.anchorNode)) {
    showError("Öneri istemek için önce nihai çeviri alanından metin seçin.");
    return;
  }

  const range = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
  if (!range) {
    showError("Öneri istemek için önce metin seçin.");
    return;
  }

  const context = finalTextEl.textContent;

  try {
    const res = await fetch(`/api/documents/${currentDocumentId}/suggest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text: selectedText, context }),
    });

    if (res.status === 401) {
      localStorage.removeItem("muhur_token");
      window.location.href = "/login.html";
      return;
    }

    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || "Öneri alınamadı.");
    }

    const suggestionsEl = document.getElementById("suggestions");
    const suggestEmptyEl = document.getElementById("suggest-empty");
    suggestionsEl.innerHTML = "";
    suggestEmptyEl.classList.add("hidden");

    for (const suggestion of body.suggestions) {
      const item = document.createElement("li");
      item.textContent = suggestion;
      item.addEventListener("click", () => {
        if (range) {
          range.deleteContents();
          range.insertNode(document.createTextNode(suggestion));
        }
        suggestionsEl.classList.add("hidden");
        suggestEmptyEl.classList.remove("hidden");
      });
      suggestionsEl.appendChild(item);
    }
    suggestionsEl.classList.remove("hidden");
  } catch (err) {
    showError(err.message);
  }
});

document.getElementById("add-signature-btn").addEventListener("click", () => {
  const finalTextEl = document.getElementById("final-text");
  const signatureLine = document.createTextNode(
    `\n\nOnaylayan: Yağmur — Tarih: ${new Date().toLocaleDateString("tr-TR")}`
  );
  finalTextEl.appendChild(signatureLine);
});

document.getElementById("finalize-btn").addEventListener("click", async () => {
  hideError();

  if (!currentDocumentId) {
    return;
  }

  const finalTextEl = document.getElementById("final-text");
  const finalText = finalTextEl.textContent.trim();

  try {
    const res = await fetch(`/api/orders/${orderId}/finalize`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ documentId: currentDocumentId, finalText }),
    });

    if (res.status === 401) {
      localStorage.removeItem("muhur_token");
      window.location.href = "/login.html";
      return;
    }

    if (res.status === 409) {
      showError("Bu belge zaten onaylanmış.");
      document.getElementById("finalize-btn").disabled = true;
      return;
    }

    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || "Onaylama başarısız.");
    }

    successEl.textContent = "Onaylandı.";
    successEl.classList.remove("hidden");
    document.getElementById("finalize-btn").disabled = true;
    document.getElementById("send-email-btn").classList.remove("hidden");
  } catch (err) {
    showError(err.message);
  }
});

document.getElementById("send-email-btn").addEventListener("click", async () => {
  hideError();

  try {
    const res = await fetch(`/api/orders/${orderId}/send-email`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) {
      localStorage.removeItem("muhur_token");
      window.location.href = "/login.html";
      return;
    }

    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || "E-posta gönderilemedi.");
    }

    document.getElementById("order-status").textContent = "SENT";
    successEl.textContent = "E-posta gönderildi.";
    successEl.classList.remove("hidden");
  } catch (err) {
    showError(err.message);
  }
});
