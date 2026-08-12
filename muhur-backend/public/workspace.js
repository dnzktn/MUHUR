const token = localStorage.getItem("muhur_token");
if (!token) {
  window.location.href = "/login.html";
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

async function loadOrder() {
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
    document.getElementById("original-text").textContent =
      doc.extractedText || "(orijinal metin yok)";

    const readyDraft = doc.drafts.find((draft) => draft.status === "READY");
    const finalTextEl = document.getElementById("final-text");
    if (doc.finalTranslation) {
      finalTextEl.textContent = doc.finalTranslation.finalText;
    } else if (readyDraft) {
      finalTextEl.textContent = readyDraft.draftText;
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
