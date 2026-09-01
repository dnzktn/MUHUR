(function () {
  var WHATSAPP_NUMBER = "90XXXXXXXXXX";

  var btn = document.createElement("a");
  btn.href = "https://wa.me/" + WHATSAPP_NUMBER;
  btn.target = "_blank";
  btn.rel = "noopener noreferrer";
  btn.className = "wa-fab";
  btn.setAttribute("aria-label", "WhatsApp'tan yazın");
  btn.innerHTML =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.6L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5Z"/></svg>';

  document.addEventListener("DOMContentLoaded", function () {
    document.body.appendChild(btn);
  });
})();
