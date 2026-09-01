document.getElementById("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const errorBox = document.getElementById("error");
  errorBox.classList.add("hidden");

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || "Giriş başarısız.");
    }

    localStorage.setItem("papiras_token", body.token);
    window.location.href = "/orders.html";
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.remove("hidden");
  }
});
