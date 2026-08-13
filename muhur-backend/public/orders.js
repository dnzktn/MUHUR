const token = localStorage.getItem("muhur_token");
if (!token) {
  window.location.href = "/login.html";
  throw new Error("Redirecting to login");
}

async function loadOrders() {
  const errorBox = document.getElementById("error");
  errorBox.classList.add("hidden");

  try {
    const res = await fetch("/api/orders", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) {
      localStorage.removeItem("muhur_token");
      window.location.href = "/login.html";
      return;
    }

    const orders = await res.json();
    if (!res.ok) {
      throw new Error(orders.error || "Siparişler yüklenemedi.");
    }

    const tbody = document.getElementById("orders-body");
    tbody.innerHTML = "";

    for (const order of orders) {
      const row = document.createElement("tr");
      row.dataset.orderId = order.id;

      const nameCell = document.createElement("td");
      nameCell.textContent = order.customer.name;

      const statusCell = document.createElement("td");
      statusCell.textContent = order.status;

      const dateCell = document.createElement("td");
      dateCell.textContent = new Date(order.createdAt).toLocaleString("tr-TR");

      row.append(nameCell, statusCell, dateCell);
      row.addEventListener("click", () => {
        window.location.href = `/workspace.html?order=${order.id}`;
      });
      tbody.appendChild(row);
    }
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.remove("hidden");
  }
}

loadOrders();
