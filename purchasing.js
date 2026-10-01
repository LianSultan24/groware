const baseApiUrl = "http://localhost/grocery_warehouse/purchasing_api.php";

function getStoredUser() {

    try {
        const raw = localStorage.getItem("user");
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        console.error("Invalid stored user:", error);
        return null;
    }
}

const currentUser = getStoredUser();

if (!currentUser) {
    window.location.href = "login.html";
}

const ALLOWED_ROLES = [
    "purchasing staff",
    "purchasing",
    "purchaser",
    "purchasing officer",
    "admin",
    "administrator"
];

if (
    currentUser &&
    !ALLOWED_ROLES.includes(
        String(currentUser.RoleName || "").toLowerCase().trim()
    )
) {
    alert("This page is for purchasing staff only.");
    window.location.href = "login.html";
}

async function callApi(operation, payload = {}) {

    const user = getStoredUser();

    const body = {
        ...payload,
        LoggedInUserID: user ? Number(user.UserID) : null
    };

    console.log("API REQUEST:", operation, body);

    const formData = new FormData();

    formData.append("operation", operation);
    formData.append("json", JSON.stringify(body));

    try {

        const response = await axios({
            url: baseApiUrl,
            method: "POST",
            data: formData
        });

        console.log("API RESPONSE:", operation, response.data);

        return response.data;

    } catch (error) {

        console.error("API ERROR:", error);

        let message = "Unable to connect to the server.";

        if (error.response && error.response.data) {

            if (typeof error.response.data === "string") {
                message = error.response.data;
            } else if (error.response.data.message) {
                message = error.response.data.message;
            }
        }

        return { success: false, message: message, data: [] };
    }
}

function esc(value) {

    if (value === null || value === undefined) {
        return "";
    }

    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function money(value) {

    const number = Number(value || 0);

    return "₱" + number.toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function statusBadge(value) {

    const map = {
        Active: "badge-green",
        Inactive: "badge-gray",
        Pending: "badge-amber",
        Draft: "badge-gray",
        Approved: "badge-green",
        Received: "badge-green",
        Completed: "badge-green",
        Cancelled: "badge-gray",
        Rejected: "badge-red"
    };

    return `<span class="badge ${map[value] || "badge-gray"}">${esc(value || "-")}</span>`;
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

function emptyRow(colspan, message) {
    return `<tr><td colspan="${colspan}" class="empty-row">${esc(message)}</td></tr>`;
}

function loadingRow(colspan) {
    return `<tr><td colspan="${colspan}" class="empty-row">Loading...</td></tr>`;
}

function debounce(element, handler) {

    if (!element) {
        return;
    }

    let timer = null;

    element.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(handler, 300);
    });
}

function stockClass(onHand, minLevel) {
    return Number(onHand) <= Number(minLevel) ? "stock-low" : "stock-ok";
}

const cache = {
    suppliers: [],
    statuses: [],
    categories: []
};

async function loadCaches() {

    const [suppliers, statuses, categories] = await Promise.all([
        callApi("getSuppliers"),
        callApi("getStatuses"),
        callApi("getCategories")
    ]);

    cache.suppliers = suppliers.success ? (suppliers.data || []) : [];
    cache.statuses = statuses.success ? (statuses.data || []) : [];
    cache.categories = categories.success ? (categories.data || []) : [];

    fillFilterSelects();
}

function fillFilterSelects() {

    const categoryFilter = document.getElementById("po-filter-category");

    if (categoryFilter) {

        const keep = categoryFilter.value;

        categoryFilter.innerHTML =
            `<option value="">All categories</option>` +
            cache.categories.map(c =>
                `<option value="${c.CategoryID}">${esc(c.CategoryName)}</option>`
            ).join("");

        categoryFilter.value = keep;
    }

    const prStatusFilter = document.getElementById("pr-filter-status");

    if (prStatusFilter) {

        const keep = prStatusFilter.value;

        prStatusFilter.innerHTML =
            `<option value="">All statuses</option>` +
            cache.statuses.map(s =>
                `<option value="${s.StatusID}">${esc(s.StatusName)}</option>`
            ).join("");

        prStatusFilter.value = keep;
    }
}

function supplierOptions(selected) {

    return cache.suppliers.map(s => `
        <option value="${s.SupplierID}"
            ${String(s.SupplierID) === String(selected) ? "selected" : ""}>
            ${esc(s.SupplierName)}
        </option>
    `).join("");
}

function statusOptions(selected) {

    return cache.statuses.map(s => `
        <option value="${s.StatusID}"
            ${String(s.StatusID) === String(selected) ? "selected" : ""}>
            ${esc(s.StatusName)}
        </option>
    `).join("");
}

const sectionTitles = {
    "section-dashboard": "Dashboard",
    "section-po": "Purchase Orders",
    "section-pr": "Purchase Returns",
    "section-product": "Products",
    "section-stock": "Stock Levels",
    "section-supplier": "Suppliers",
    "section-category": "Categories"
};

const sectionLoaders = {
    "section-dashboard": loadDashboard,
    "section-po": () => loadPurchaseOrders(),
    "section-pr": () => loadPurchaseReturns(),
    "section-product": () => loadProducts(),
    "section-stock": () => loadStock(),
    "section-supplier": () => loadSuppliers(),
    "section-category": () => loadCategories()
};

function switchSection(targetId) {

    document.querySelectorAll(".page-section").forEach(section => {
        section.classList.remove("active-section");
    });

    const target = document.getElementById(targetId);

    if (target) {
        target.classList.add("active-section");
    }

    document.querySelectorAll(".nav-link").forEach(button => {
        button.classList.remove("active");
    });

    const navButton = document.querySelector(
        `.nav-link[data-target="${targetId}"]`
    );

    if (navButton) {
        navButton.classList.add("active");
    }

    const pageTitle = document.getElementById("page-title");

    if (pageTitle) {
        pageTitle.textContent = sectionTitles[targetId] || "";
    }

    closeSidebar();

    if (sectionLoaders[targetId]) {
        sectionLoaders[targetId]();
    }

    if (targetId === "section-dashboard") {
        requestAnimationFrame(() => handleDashboardResize());
    }
}

/* ============================================================
   DASHBOARD → SECTION NAVIGATION
   Lets the dashboard's stat cards and chart panels act as
   shortcuts, same pattern as the admin dashboard.
============================================================ */

function goToSection(targetId) {

    const navButton = document.querySelector(
        `.nav-link[data-target="${targetId}"]`
    );

    if (navButton) {
        navButton.click();
    } else {
        switchSection(targetId);
    }
}

async function logout() {

    await callApi("logout");

    localStorage.removeItem("user");

    window.location.href = "login.html";
}

async function loadDashboard() {

    const result = await callApi("getDashboardStats");

    if (!result.success) {
        alert(result.message);
        return;
    }

    const s = result.data || {};

    document.getElementById("stat-my-po").textContent = s.myPOs ?? 0;
    document.getElementById("stat-pending-po").textContent = s.pendingPOs ?? 0;
    document.getElementById("stat-returns").textContent = s.totalReturns ?? 0;
    document.getElementById("stat-products").textContent = s.totalProducts ?? 0;
    document.getElementById("stat-suppliers").textContent = s.totalSuppliers ?? 0;

    document.getElementById("tbl-low-stock").innerHTML =
        (s.lowStock || []).map(p => `
            <tr>
                <td>${esc(p.ProductName)}</td>
                <td class="num stock-low">${esc(p.OnHand)} ${esc(p.UnitSymbol || "")}</td>
                <td class="num">${esc(p.MinStockLevel)}</td>
                <td>
                    <button class="btn-icon" title="See details"
                        onclick="viewProduct(${p.ProductID})">👁</button>
                </td>
            </tr>
        `).join("") ||
        emptyRow(4, "Every product is above its minimum level.");

    document.getElementById("tbl-recent-po").innerHTML =
        (s.recentPOs || []).map(po => `
            <tr>
                <td>#${po.PO_ID}</td>
                <td>${esc(po.SupplierName)}</td>
                <td>${esc(po.PO_Date)}</td>
                <td class="num">${money(po.TotalAmount)}</td>
                <td>${statusBadge(po.StatusName)}</td>
            </tr>
        `).join("") ||
        emptyRow(5, "Create your first purchase order to see it here.");

    await loadDashboardCharts();
}

/* ============================================================
   DASHBOARD CHARTS
============================================================ */

let chartProductsCategory = null;
let chartPoStatus = null;

const doughnutCenterTextPlugin = {
    id: "doughnutCenterText",
    afterDraw(chart, _args, pluginOptions) {
        if (!pluginOptions || !pluginOptions.enabled) return;

        const { ctx, chartArea } = chart;
        if (!chartArea) return;

        const centerX = (chartArea.left + chartArea.right) / 2;
        const centerY = (chartArea.top + chartArea.bottom) / 2;

        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        ctx.fillStyle = pluginOptions.valueColor || "#052E16";
        ctx.font = pluginOptions.valueFont || "800 26px system-ui, -apple-system, sans-serif";
        ctx.fillText(String(pluginOptions.value ?? ""), centerX, centerY - 11);

        ctx.fillStyle = pluginOptions.labelColor || "#166534";
        ctx.font = pluginOptions.labelFont || "700 11px system-ui, -apple-system, sans-serif";
        ctx.fillText(pluginOptions.label || "", centerX, centerY + 13);

        ctx.restore();
    }
};

async function loadDashboardCharts() {

    if (typeof Chart === "undefined") {
        console.warn("Chart.js not loaded — skipping charts.");
        return;
    }

    const [productsRes, poRes] = await Promise.all([
        callApi("getProducts", { search: "" }),
        callApi("getPurchaseOrders", {})
    ]);

    /* ---------- CHART 1: Products by Category (Bar) ---------- */

    const products = productsRes.data || [];

    const categoryCounts = {};
    products.forEach(p => {
        const cat = p.CategoryName || "Uncategorized";
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });

    const sortedCategories = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);
    const totalCategories = sortedCategories.length;
    const topCategories = sortedCategories.slice(0, 6);

    const subtitle = document.getElementById("chartCategorySubtitle");
    if (subtitle) {
        subtitle.textContent = `Top ${topCategories.length} of ${totalCategories} categories`;
    }

    const catLabels = topCategories.map(([name]) => name);
    const catCounts = topCategories.map(([, count]) => count);

    if (chartProductsCategory) {
        chartProductsCategory.destroy();
        chartProductsCategory = null;
    }

    const ctx1 = document.getElementById("chart-products-category");
    if (ctx1) {
        chartProductsCategory = new Chart(ctx1, {
            type: "bar",
            data: {
                labels: catLabels,
                datasets: [{
                    label: "Products",
                    data: catCounts,
                    backgroundColor: "#0E9F6E",
                    hoverBackgroundColor: "#047857",
                    borderRadius: 8,
                    borderSkipped: false,
                    maxBarThickness: 48
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                resizeDelay: 100,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: "#12331F",
                        titleColor: "#FFFFFF",
                        bodyColor: "#FFFFFF",
                        padding: 10,
                        cornerRadius: 8,
                        displayColors: false,
                        callbacks: {
                            label: (ctx) => `${ctx.parsed.y} product${ctx.parsed.y === 1 ? "" : "s"}`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { precision: 0, color: "#166534", font: { size: 11, weight: "600" } },
                        grid: { color: "rgba(166, 221, 187, 0.5)", drawBorder: false }
                    },
                    x: {
                        ticks: { color: "#166534", font: { size: 11, weight: "600" } },
                        grid: { display: false }
                    }
                }
            }
        });
    }

    /* ---------- CHART 2: Purchase Orders by Status (Doughnut) ---------- */

    const pos = poRes.data || [];

    const statusCounts = {};
    pos.forEach(po => {
        const status = po.StatusName || "Unknown";
        statusCounts[status] = (statusCounts[status] || 0) + 1;
    });

    const totalPOs = pos.length;

    const statusColorMap = {
        "Completed": "#0E9F6E",
        "Approved":  "#0E9F6E",
        "Received":  "#0E9F6E",
        "Pending":   "#D97706",
        "For Review":"#D97706",
        "Submitted": "#D97706",
        "Cancelled": "#DC2626",
        "Canceled":  "#DC2626",
        "Rejected":  "#DC2626",
        "Draft":     "#9CA3AF"
    };

    const statusLabels = Object.keys(statusCounts);
    const statusValues = statusLabels.map(k => statusCounts[k]);
    const statusColors = statusLabels.map(s => statusColorMap[s] || "#9CA3AF");

    if (chartPoStatus) {
        chartPoStatus.destroy();
        chartPoStatus = null;
    }

    const ctx2 = document.getElementById("chart-po-status");
    if (ctx2) {
        chartPoStatus = new Chart(ctx2, {
            type: "doughnut",
            data: {
                labels: statusLabels,
                datasets: [{
                    data: statusValues,
                    backgroundColor: statusColors,
                    borderColor: "#FFFFFF",
                    borderWidth: 3,
                    hoverOffset: 6
                }]
            },
            plugins: [doughnutCenterTextPlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                resizeDelay: 100,
                cutout: "68%",
                layout: { padding: 0 },
                plugins: {
                    legend: {
                        position: (ctxChart) => ctxChart.chart.width < 340 ? "bottom" : "right",
                        labels: {
                            boxWidth: 10,
                            boxHeight: 10,
                            usePointStyle: true,
                            pointStyle: "circle",
                            padding: 14,
                            color: "#052E16",
                            font: { size: 12, weight: "600" },
                            generateLabels: (chart) => {
                                const data = chart.data;
                                if (data.labels.length && data.datasets.length) {
                                    return data.labels.map((label, i) => {
                                        const value = data.datasets[0].data[i];
                                        return {
                                            text: `${label}    ${value}`,
                                            fillStyle: data.datasets[0].backgroundColor[i],
                                            strokeStyle: data.datasets[0].backgroundColor[i],
                                            lineWidth: 0,
                                            hidden: false,
                                            index: i
                                        };
                                    });
                                }
                                return [];
                            }
                        }
                    },
                    tooltip: {
                        backgroundColor: "#12331F",
                        titleColor: "#FFFFFF",
                        bodyColor: "#FFFFFF",
                        padding: 10,
                        cornerRadius: 8,
                        displayColors: false,
                        callbacks: {
                            label: (ctx) => {
                                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = total > 0 ? Math.round((ctx.parsed / total) * 100) : 0;
                                return `${ctx.label}: ${ctx.parsed} (${pct}%)`;
                            }
                        }
                    },
                    doughnutCenterText: {
                        enabled: true,
                        value: totalPOs,
                        label: "TOTAL POS"
                    }
                }
            }
        });
    }

    setupChartResizeObserver();

    window.removeEventListener("resize", handleDashboardResize);
    window.addEventListener("resize", handleDashboardResize);
}

let dashboardResizeTimer = null;
let dashboardResizeObserver = null;

function setupChartResizeObserver() {
    if (!("ResizeObserver" in window)) return;

    if (dashboardResizeObserver) {
        dashboardResizeObserver.disconnect();
        dashboardResizeObserver = null;
    }

    const dashboardSection = document.getElementById("section-dashboard");
    if (!dashboardSection) return;

    dashboardResizeObserver = new ResizeObserver(() => {
        handleDashboardResize();
    });

    dashboardResizeObserver.observe(dashboardSection);
}

function handleDashboardResize() {
    if (dashboardResizeTimer) clearTimeout(dashboardResizeTimer);
    dashboardResizeTimer = setTimeout(() => {
        if (chartProductsCategory) chartProductsCategory.resize();
        if (chartPoStatus) chartPoStatus.resize();
    }, 150);
}

async function loadProducts() {

    const search = document.getElementById("search-product").value.trim();

    const tbody = document.getElementById("tbl-product");

    tbody.innerHTML = loadingRow(8);

    const result = await callApi("getProducts", { search: search });

    if (!result.success) {
        tbody.innerHTML = emptyRow(8, result.message);
        return;
    }

    tbody.innerHTML = (result.data || []).map(p => `
        <tr>
            <td>${esc(p.Barcode)}</td>
            <td>${esc(p.ProductName)}</td>
            <td>${esc(p.CategoryName)}</td>
            <td>${esc(p.UnitName)}</td>
            <td class="num ${stockClass(p.OnHand, p.MinStockLevel)}">${esc(p.OnHand)}</td>
            <td class="num">${esc(p.MinStockLevel)}</td>
            <td>${esc(p.BinCode)}</td>
            <td>
                <button class="btn-icon" title="See details"
                    onclick="viewProduct(${p.ProductID})">👁</button>
            </td>
        </tr>
    `).join("") || emptyRow(8, "No products found.");
}

async function viewProduct(id) {

    openViewModal("Product details");

    const body = document.getElementById("view-modal-body");

    const result = await callApi("getProductDetails", { ProductID: id });

    if (!result.success) {
        body.innerHTML = `<p class="archived-empty">${esc(result.message)}</p>`;
        return;
    }

    const p = result.data;

    document.getElementById("view-modal-title").textContent = p.ProductName;

    body.innerHTML = `

        <div class="detail-card">

            <h4>${esc(p.ProductName)}</h4>

            <div class="detail-sub">
                ${esc(p.Barcode || "No barcode")} ·
                ${esc(p.CategoryName || "Uncategorised")}
            </div>

            <div class="detail-grid">

                <div>
                    <span class="detail-label">On hand</span>
                    <span class="detail-value ${stockClass(p.OnHand, p.MinStockLevel)}">
                        ${esc(p.OnHand)} ${esc(p.UnitSymbol || "")}
                    </span>
                </div>

                <div>
                    <span class="detail-label">Minimum level</span>
                    <span class="detail-value">${esc(p.MinStockLevel)}</span>
                </div>

                <div>
                    <span class="detail-label">Unit</span>
                    <span class="detail-value">${esc(p.UnitName || "—")}</span>
                </div>

                <div>
                    <span class="detail-label">Location</span>
                    <span class="detail-value">
                        ${esc(p.AisleCode || "—")} /
                        ${esc(p.ShelfCode || "—")} /
                        ${esc(p.BinCode || "—")}
                    </span>
                </div>

                <div>
                    <span class="detail-label">Total received</span>
                    <span class="detail-value">${esc(p.TotalReceived)}</span>
                </div>

                <div>
                    <span class="detail-label">Total released</span>
                    <span class="detail-value">${esc(p.TotalReleased)}</span>
                </div>

            </div>

            ${p.Description ? `
                <div class="detail-grid">
                    <div style="grid-column: 1 / -1;">
                        <span class="detail-label">Description</span>
                        <span class="detail-value">${esc(p.Description)}</span>
                    </div>
                </div>
            ` : ""}

        </div>


        <div class="detail-section">

            <h4>Suppliers carrying this product</h4>

            <table class="line-table">
                <thead>
                    <tr>
                        <th>Supplier</th>
                        <th>Contact person</th>
                        <th>Phone</th>
                        <th class="num">Lead time</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    ${(p.suppliers || []).map(s => `
                        <tr>
                            <td>${esc(s.SupplierName)}</td>
                            <td>${esc(s.ContactPerson || "—")}</td>
                            <td>${esc(s.Phone || "—")}</td>
                            <td class="num">${s.LeadTimeDays ? esc(s.LeadTimeDays) + " days" : "—"}</td>
                            <td>
                                <button class="btn-icon" title="See supplier"
                                    onclick="viewSupplier(${s.SupplierID})">👁</button>
                            </td>
                        </tr>
                    `).join("") ||
                    `<tr><td colspan="5" class="empty-row">
                        No supplier is linked to this product yet.
                    </td></tr>`}
                </tbody>
            </table>

        </div>


        <div class="detail-section">

            <h4>Recent purchase orders</h4>

            <table class="line-table">
                <thead>
                    <tr>
                        <th>PO</th>
                        <th>Date</th>
                        <th>Supplier</th>
                        <th class="num">Qty</th>
                        <th class="num">Unit price</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${(p.recentOrders || []).map(o => `
                        <tr>
                            <td>#${o.PO_ID}</td>
                            <td>${esc(o.PO_Date)}</td>
                            <td>${esc(o.SupplierName)}</td>
                            <td class="num">${esc(o.Quantity)}</td>
                            <td class="num">${money(o.Unit_Price)}</td>
                            <td>${statusBadge(o.StatusName)}</td>
                        </tr>
                    `).join("") ||
                    `<tr><td colspan="6" class="empty-row">
                        This product has never been ordered.
                    </td></tr>`}
                </tbody>
            </table>

        </div>
    `;
}

let lowOnly = false;

function toggleLowOnly() {

    lowOnly = !lowOnly;

    document.getElementById("btn-low-only").textContent =
        lowOnly ? "Show all stock" : "Show only low stock";

    loadStock();
}

async function loadStock() {

    const search = document.getElementById("search-stock").value.trim();

    const tbody = document.getElementById("tbl-stock");

    tbody.innerHTML = loadingRow(6);

    const result = await callApi("getStockLevels", {
        search: search,
        lowOnly: lowOnly
    });

    if (!result.success) {
        tbody.innerHTML = emptyRow(6, result.message);
        return;
    }

    tbody.innerHTML = (result.data || []).map(p => {

        const low = Number(p.OnHand) <= Number(p.MinStockLevel);

        return `
            <tr>
                <td>${esc(p.ProductName)}</td>
                <td>${esc(p.CategoryName)}</td>
                <td class="num ${low ? "stock-low" : "stock-ok"}">
                    ${esc(p.OnHand)} ${esc(p.UnitSymbol || "")}
                </td>
                <td class="num">${esc(p.MinStockLevel)}</td>
                <td>${low ? statusBadge("Pending") : statusBadge("Completed")}</td>
                <td>
                    <button class="btn-icon" title="See details"
                        onclick="viewProduct(${p.ProductID})">👁</button>
                </td>
            </tr>
        `;

    }).join("") || emptyRow(6, "No stock records found.");
}

async function loadSuppliers() {

    const search = document.getElementById("search-supplier").value.trim();

    const tbody = document.getElementById("tbl-supplier");

    tbody.innerHTML = loadingRow(5);

    const result = await callApi("getSuppliers", { search: search });

    if (!result.success) {
        tbody.innerHTML = emptyRow(5, result.message);
        return;
    }

    const rows = result.data || [];

    if (search === "") {
        cache.suppliers = rows;
        fillFilterSelects();
    }

    tbody.innerHTML = rows.map(s => `
        <tr>
            <td>${esc(s.SupplierName)}</td>
            <td>${esc(s.ContactPerson || "—")}</td>
            <td>${esc(s.Phone || "—")}</td>
            <td>${esc(s.Email || "—")}</td>
            <td>
                <button class="btn-icon" title="See details"
                    onclick="viewSupplier(${s.SupplierID})">👁</button>
            </td>
        </tr>
    `).join("") || emptyRow(5, "No suppliers found.");
}

async function viewSupplier(id) {

    openViewModal("Supplier details");

    const body = document.getElementById("view-modal-body");

    const result = await callApi("getSupplierDetails", { SupplierID: id });

    if (!result.success) {
        body.innerHTML = `<p class="archived-empty">${esc(result.message)}</p>`;
        return;
    }

    const s = result.data;

    document.getElementById("view-modal-title").textContent = s.SupplierName;

    body.innerHTML = `

        <div class="detail-card">

            <h4>${esc(s.SupplierName)}</h4>

            <div class="detail-sub">Supplier profile</div>

            <div class="detail-grid">

                <div>
                    <span class="detail-label">Contact person</span>
                    <span class="detail-value">${esc(s.ContactPerson || "—")}</span>
                </div>

                <div>
                    <span class="detail-label">Phone</span>
                    <span class="detail-value">${esc(s.Phone || "—")}</span>
                </div>

                <div>
                    <span class="detail-label">Email</span>
                    <span class="detail-value">${esc(s.Email || "—")}</span>
                </div>

                <div>
                    <span class="detail-label">Address</span>
                    <span class="detail-value">${esc(s.Address || "—")}</span>
                </div>

            </div>

        </div>


        <div class="mini-stats">

            <div class="mini-stat">
                <span class="mini-label">Purchase orders</span>
                <span class="mini-value">${esc(s.totalPOs)}</span>
            </div>

            <div class="mini-stat">
                <span class="mini-label">Total ordered value</span>
                <span class="mini-value">${money(s.totalSpend)}</span>
            </div>

            <div class="mini-stat">
                <span class="mini-label">Last order</span>
                <span class="mini-value">${esc(s.lastOrderDate || "—")}</span>
            </div>

            <div class="mini-stat">
                <span class="mini-label">Catalog products</span>
                <span class="mini-value">${(s.products || []).length}</span>
            </div>

        </div>


        <div class="detail-section">

            <h4>Products from this supplier</h4>

            <table class="line-table">
                <thead>
                    <tr>
                        <th>Product</th>
                        <th>Category</th>
                        <th class="num">On hand</th>
                        <th class="num">Min level</th>
                        <th class="num">Lead time</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    ${(s.products || []).map(p => `
                        <tr>
                            <td>${esc(p.ProductName)}</td>
                            <td>${esc(p.CategoryName || "—")}</td>
                            <td class="num ${stockClass(p.OnHand, p.MinStockLevel)}">
                                ${esc(p.OnHand)} ${esc(p.UnitSymbol || "")}
                            </td>
                            <td class="num">${esc(p.MinStockLevel)}</td>
                            <td class="num">${p.LeadTimeDays ? esc(p.LeadTimeDays) + " days" : "—"}</td>
                            <td>
                                <button class="btn-icon" title="See details"
                                    onclick="viewProduct(${p.ProductID})">👁</button>
                            </td>
                        </tr>
                    `).join("") ||
                    `<tr><td colspan="6" class="empty-row">
                        No products are linked to this supplier yet.
                        Ask the admin to set them up in the supplier catalog.
                    </td></tr>`}
                </tbody>
            </table>

        </div>


        <div class="detail-section">

            <h4>Previously ordered from this supplier</h4>

            <table class="line-table">
                <thead>
                    <tr>
                        <th>Product</th>
                        <th class="num">Total ordered</th>
                        <th>Last ordered</th>
                    </tr>
                </thead>
                <tbody>
                    ${(s.orderedProducts || []).map(p => `
                        <tr>
                            <td>${esc(p.ProductName)}</td>
                            <td class="num">${esc(p.TotalOrdered)}</td>
                            <td>${esc(p.LastOrdered)}</td>
                        </tr>
                    `).join("") ||
                    `<tr><td colspan="3" class="empty-row">
                        No purchase history yet.
                    </td></tr>`}
                </tbody>
            </table>

        </div>
    `;
}

async function loadCategories() {

    const search = document.getElementById("search-category").value.trim();

    const tbody = document.getElementById("tbl-category");

    tbody.innerHTML = loadingRow(3);

    const result = await callApi("getCategories", { search: search });

    if (!result.success) {
        tbody.innerHTML = emptyRow(3, result.message);
        return;
    }

    const rows = result.data || [];

    if (search === "") {
        cache.categories = rows;
        fillFilterSelects();
    }

    tbody.innerHTML = rows.map(c => `
        <tr>
            <td>${esc(c.CategoryName)}</td>
            <td class="num">${esc(c.ProductCount)}</td>
            <td>
                <button class="btn-icon" title="See products"
                    onclick="viewCategory(${c.CategoryID})">👁</button>
            </td>
        </tr>
    `).join("") || emptyRow(3, "No categories found.");
}

async function viewCategory(id) {

    openViewModal("Category details");

    const body = document.getElementById("view-modal-body");

    const result = await callApi("getCategoryDetails", { CategoryID: id });

    if (!result.success) {
        body.innerHTML = `<p class="archived-empty">${esc(result.message)}</p>`;
        return;
    }

    const c = result.data;

    document.getElementById("view-modal-title").textContent = c.CategoryName;

    body.innerHTML = `

        <div class="mini-stats">

            <div class="mini-stat">
                <span class="mini-label">Products</span>
                <span class="mini-value">${esc(c.productCount)}</span>
            </div>

            <div class="mini-stat">
                <span class="mini-label">Needs reordering</span>
                <span class="mini-value ${Number(c.lowCount) > 0 ? "stock-low" : ""}">
                    ${esc(c.lowCount)}
                </span>
            </div>

        </div>


        <div class="detail-section">

            <h4>Products in ${esc(c.CategoryName)}</h4>

            <table class="line-table">
                <thead>
                    <tr>
                        <th>Product</th>
                        <th>Barcode</th>
                        <th class="num">On hand</th>
                        <th class="num">Min level</th>
                        <th>Bin</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    ${(c.products || []).map(p => `
                        <tr>
                            <td>${esc(p.ProductName)}</td>
                            <td>${esc(p.Barcode || "—")}</td>
                            <td class="num ${stockClass(p.OnHand, p.MinStockLevel)}">
                                ${esc(p.OnHand)} ${esc(p.UnitSymbol || "")}
                            </td>
                            <td class="num">${esc(p.MinStockLevel)}</td>
                            <td>${esc(p.BinCode || "—")}</td>
                            <td>
                                <button class="btn-icon" title="See details"
                                    onclick="viewProduct(${p.ProductID})">👁</button>
                            </td>
                        </tr>
                    `).join("") ||
                    `<tr><td colspan="6" class="empty-row">
                        No products in this category yet.
                    </td></tr>`}
                </tbody>
            </table>

        </div>
    `;
}

function clearPOFilters() {

    document.getElementById("po-search").value = "";
    document.getElementById("po-filter-category").value = "";
    document.getElementById("po-date-from").value = "";
    document.getElementById("po-date-to").value = "";

    loadPurchaseOrders();
}

async function loadPurchaseOrders() {

    const tbody = document.getElementById("tbl-po");

    tbody.innerHTML = loadingRow(8);

    const result = await callApi("getPurchaseOrders", {
        search: document.getElementById("po-search").value.trim(),
        Category_ID: document.getElementById("po-filter-category").value || 0,
        DateFrom: document.getElementById("po-date-from").value,
        DateTo: document.getElementById("po-date-to").value
    });

    if (!result.success) {
        tbody.innerHTML = emptyRow(8, result.message);
        return;
    }

    tbody.innerHTML = (result.data || []).map(po => `
        <tr>
            <td>#${po.PO_ID}</td>
            <td>${esc(po.PO_Date)}</td>
            <td>${esc(po.Expected_Date || "—")}</td>
            <td>${esc(po.SupplierName)}</td>
            <td class="num">${esc(po.ItemCount)}</td>
            <td class="num">${money(po.TotalAmount)}</td>
            <td>${statusBadge(po.StatusName)}</td>
            <td>
                <button class="btn-icon" title="See details"
                    onclick="viewPO(${po.PO_ID})">👁</button>

                <button class="btn-icon" title="Edit"
                    onclick="openPOModal(${po.PO_ID})">✎</button>

                <button class="btn-icon" title="Cancel"
                    onclick="cancelPO(${po.PO_ID})">⊘</button>

                <button class="btn-icon btn-icon-danger" title="Remove"
                    onclick="deletePO(${po.PO_ID})">🗑</button>
            </td>
        </tr>
    `).join("") || emptyRow(8, "No purchase orders match these filters.");
}

let poEditId = null;

let lineCounter = 0;

let poProducts = [];

let poCatalogIsFallback = false;

// true once the user types/changes the expected date by hand,
// so auto-compute stops overwriting it
let poExpectedManual = false;

/* ============================================================
   EXPECTED DELIVERY DATE (auto from LeadTimeDays)
============================================================ */

function addDays(dateStr, days) {

    const parts = String(dateStr).split("-").map(Number);

    if (parts.length !== 3 || parts.some(isNaN)) {
        return "";
    }

    const d = new Date(parts[0], parts[1] - 1, parts[2] + Number(days));

    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");

    return `${yyyy}-${mm}-${dd}`;
}

function getSelectedLeadDays() {

    let maxLead = 0;

    document.querySelectorAll("#po-lines-body .line-product").forEach(select => {

        if (!select.value) {
            return;
        }

        const product = poProducts.find(
            p => String(p.ProductID) === String(select.value)
        );

        const lead = Number(product && product.LeadTimeDays ? product.LeadTimeDays : 0);

        if (lead > maxLead) {
            maxLead = lead;
        }
    });

    return maxLead;
}

function updateExpectedDate() {

    const input = document.getElementById("po-expected");
    const note = document.getElementById("po-expected-note");

    if (!input || poExpectedManual) {
        return;
    }

    const poDate = document.getElementById("po-date").value;
    const lead = getSelectedLeadDays();

    if (!poDate || lead <= 0) {

        input.value = "";

        if (note) {
            note.textContent = "Auto-filled from the supplier's lead time once you pick products.";
        }

        return;
    }

    input.value = addDays(poDate, lead);

    if (note) {
        note.textContent =
            `Auto-computed: PO date + ${lead} day(s) lead time ` +
            `(longest among the selected products). You can still change it.`;
    }
}

function onExpectedDateInput(input) {

    poExpectedManual = input.value !== "";

    if (!poExpectedManual) {
        updateExpectedDate();
    }
}

function poProductOptions(selected) {

    return poProducts.map(p => `
        <option value="${p.ProductID}"
            ${String(p.ProductID) === String(selected) ? "selected" : ""}
            data-price="${p.LastPrice ?? ""}">
            ${esc(p.ProductName)}${p.Barcode ? " — " + esc(p.Barcode) : ""}
            (stock: ${esc(p.OnHand ?? 0)})
        </option>
    `).join("");
}

function poLineRow(line = {}) {

    lineCounter += 1;

    const rowId = `po-line-${lineCounter}`;

    return `
        <tr id="${rowId}" class="po-line">
            <td>
                <select class="line-product" onchange="onPOProductChange('${rowId}')">
                    <option value="">-- Select product --</option>
                    ${poProductOptions(line.Product_ID)}
                </select>
            </td>

            <td class="col-qty">
                <input type="number" class="line-qty" min="1" step="1"
                    value="${line.Quantity ?? 1}" oninput="recalcPO()">
            </td>

            <td class="col-price">
                <input type="number" class="line-price" min="0" step="0.01"
                    value="${line.Unit_Price ?? 0}" oninput="recalcPO()">
            </td>

            <td class="col-sub line-subtotal num">₱0.00</td>

            <td class="col-act">
                <button class="btn-icon btn-icon-danger" title="Remove line"
                    onclick="removePOLine('${rowId}')">✕</button>
            </td>
        </tr>
    `;
}

function addPOLine(line = {}) {

    const body = document.getElementById("po-lines-body");

    if (!body) {
        return;
    }

    body.insertAdjacentHTML("beforeend", poLineRow(line));

    recalcPO();
}

function removePOLine(rowId) {

    const row = document.getElementById(rowId);

    if (row) {
        row.remove();
    }

    recalcPO();
    updateExpectedDate();

    const supplierSelect = document.getElementById("po-supplier");

    if (supplierSelect && !supplierSelect.value) {
        refreshSupplierOptionsFromSelectedProducts();
    }
}

async function onPOProductChange(rowId) {

    const row = document.getElementById(rowId);

    if (!row) {
        return;
    }

    const select = row.querySelector(".line-product");
    const priceInput = row.querySelector(".line-price");

    const option = select.options[select.selectedIndex];

    const lastPrice = option ? option.getAttribute("data-price") : "";

    if (lastPrice && Number(priceInput.value) === 0) {
        priceInput.value = lastPrice;
    }

    recalcPO();
    updateExpectedDate();

    const supplierSelect = document.getElementById("po-supplier");

    if (supplierSelect && !supplierSelect.value) {
        await refreshSupplierOptionsFromSelectedProducts();
    }
}

function recalcPO() {

    let total = 0;

    document.querySelectorAll("#po-lines-body .po-line").forEach(row => {

        const qty = Number(row.querySelector(".line-qty").value || 0);
        const price = Number(row.querySelector(".line-price").value || 0);

        const subtotal = qty * price;

        total += subtotal;

        row.querySelector(".line-subtotal").textContent = money(subtotal);
    });

    const totalBox = document.getElementById("po-total");

    if (totalBox) {
        totalBox.textContent = money(total);
    }
}

async function refreshSupplierOptionsFromSelectedProducts() {

    const productIDs = Array.from(
        document.querySelectorAll("#po-lines-body .line-product")
    )
        .map(select => select.value)
        .filter(value => value !== "")
        .map(Number);

    const supplierSelect = document.getElementById("po-supplier");
    const noteBox = document.getElementById("po-supplier-note");

    if (!supplierSelect) {
        return;
    }

    if (productIDs.length === 0) {

        supplierSelect.innerHTML =
            `<option value="">-- Select supplier --</option>` +
            supplierOptions("");

        if (noteBox) {
            noteBox.textContent = "";
        }

        return;
    }

    const result = await callApi("getSuppliersForProducts", {
        ProductIDs: productIDs
    });

    if (!result.success) {
        alert(result.message);
        return;
    }

    const eligible = result.data || [];

    supplierSelect.innerHTML =
        `<option value="">-- Select supplier --</option>` +
        eligible.map(s => `
            <option value="${s.SupplierID}">${esc(s.SupplierName)}</option>
        `).join("");

    if (noteBox) {

        noteBox.textContent = eligible.length > 0
            ? `${eligible.length} supplier(s) carry all the product(s) selected so far.`
            : "No supplier carries every product selected so far. Remove a product or choose a different one.";
    }
}

async function loadAllProductsForPO(extraLines = []) {

    const noteBox = document.getElementById("po-supplier-note");

    const result = await callApi("getProducts", { search: "" });

    if (!result.success) {
        alert(result.message);
        return;
    }

    poProducts = result.data || [];
    poCatalogIsFallback = true;

    extraLines.forEach(line => {

        const exists = poProducts.some(
            p => String(p.ProductID) === String(line.Product_ID)
        );

        if (!exists) {

            poProducts.push({
                ProductID: line.Product_ID,
                ProductName: line.ProductName,
                Barcode: line.Barcode,
                OnHand: "",
                LastPrice: line.Unit_Price
            });
        }
    });

    if (noteBox) {

        noteBox.textContent =
            "No supplier selected yet, so every product is listed. " +
            "Pick a product to narrow down the supplier choices, or pick a supplier first to narrow down the products.";
    }
}

async function loadSupplierProducts(supplierID, extraLines = []) {

    poProducts = [];
    poCatalogIsFallback = false;

    const noteBox = document.getElementById("po-supplier-note");

    if (!supplierID) {

        if (noteBox) {
            noteBox.textContent = "";
        }

        return;
    }

    const result = await callApi("getProductsBySupplier", {
        Supplier_ID: Number(supplierID)
    });

    if (!result.success) {
        alert(result.message);
        return;
    }

    // Only the supplier's associated products. No fallback.
    poProducts = result.data.products || [];

    extraLines.forEach(line => {

        const exists = poProducts.some(
            p => String(p.ProductID) === String(line.Product_ID)
        );

        if (!exists) {

            poProducts.push({
                ProductID: line.Product_ID,
                ProductName: line.ProductName,
                Barcode: line.Barcode,
                OnHand: "",
                LastPrice: line.Unit_Price,
                LeadTimeDays: null
            });
        }
    });

    if (noteBox) {

        if (poProducts.length === 0) {

            noteBox.textContent =
                "This supplier has no associated products yet. " +
                "Ask the admin to link products to this supplier.";

        } else {

            noteBox.textContent =
                `${poProducts.length} product(s) available from this supplier.`;
        }
    }
}

function rebuildAllLineProductOptions() {

    document.querySelectorAll("#po-lines-body .po-line").forEach(row => {

        const select = row.querySelector(".line-product");
        const currentValue = select.value;

        select.innerHTML =
            `<option value="">-- Select product --</option>` +
            poProductOptions(currentValue);

        const stillExists = currentValue !== "" && Array.from(select.options)
            .some(opt => opt.value === currentValue);

        select.value = stillExists ? currentValue : "";
    });
}

async function onPOSupplierChange() {

    const supplierID = document.getElementById("po-supplier").value;

    if (!supplierID) {

        await loadAllProductsForPO();

        rebuildAllLineProductOptions();

        await refreshSupplierOptionsFromSelectedProducts();

        updateExpectedDate();

        return;
    }

    await loadSupplierProducts(supplierID);

    // Remove any line whose product this supplier does not carry
    const allowedIDs = new Set(
        poProducts.map(p => String(p.ProductID))
    );

    document.querySelectorAll("#po-lines-body .po-line").forEach(row => {

        const select = row.querySelector(".line-product");

        if (select.value && !allowedIDs.has(select.value)) {
            row.remove();
        }
    });

    rebuildAllLineProductOptions();

    if (document.querySelectorAll("#po-lines-body .po-line").length === 0) {
        addPOLine();
    }

    recalcPO();
    updateExpectedDate();
}

async function openPOModal(id = null) {

    poEditId = id;
    poProducts = [];
    poCatalogIsFallback = false;
    poExpectedManual = false;

    document.getElementById("po-modal-title").textContent =
        id ? `Edit Purchase Order #${id}` : "New Purchase Order";

    const body = document.getElementById("po-modal-body");

    body.innerHTML = `<p class="modal-loading">Loading form...</p>`;

    document.getElementById("po-modal-overlay").classList.add("open");

    let record = {
        PO_Date: today(),
        Expected_Date: "",
        Supplier_ID: "",
        Status_ID: "",
        lines: []
    };

    if (id) {

        const result = await callApi("getPurchaseOrder", { PO_ID: id });

        if (!result.success) {
            body.innerHTML = `<p class="archived-empty">${esc(result.message)}</p>`;
            return;
        }

        record = result.data;

        if (Number(record.Editable) !== 1) {

            body.innerHTML = `
                <p class="archived-empty">
                    ${esc(record.StatusName)} purchase orders can no longer be edited.
                    Use the details view instead.
                </p>
            `;

            document.getElementById("btn-save-po").style.display = "none";

            return;
        }

        // Editing a PO that already has an expected date: keep it as-is
        poExpectedManual = !!record.Expected_Date;
    }

    document.getElementById("btn-save-po").style.display = "";

    body.innerHTML = `

        <div class="form-row">

            <div class="form-group">
                <label>Supplier</label>
                <select id="po-supplier" onchange="onPOSupplierChange()">
                    <option value="">-- Select supplier --</option>
                    ${supplierOptions(record.Supplier_ID)}
                </select>
                <small class="field-note" id="po-supplier-note"></small>
            </div>

            <div class="form-group">
                <label>PO date *</label>
                <input type="date" id="po-date"
                    value="${esc(record.PO_Date || today())}"
                    onchange="updateExpectedDate()">
            </div>

            <div class="form-group">
                <label>Expected delivery date</label>
                <input type="date" id="po-expected"
                    value="${esc(record.Expected_Date || "")}"
                    oninput="onExpectedDateInput(this)">
                <small class="field-note" id="po-expected-note">
                    Auto-filled from the supplier's lead time once you pick products.
                </small>
            </div>

            <div class="form-group">
                <label>Status</label>
                <select id="po-status">
                    <option value="">Pending (default)</option>
                    ${statusOptions(record.Status_ID)}
                </select>
            </div>

        </div>

        <div class="line-items">

            <h4>Products ordered</h4>

            <table class="line-table">
                <thead>
                    <tr>
                        <th>Product</th>
                        <th class="col-qty">Quantity</th>
                        <th class="col-price">Unit price</th>
                        <th class="col-sub">Subtotal</th>
                        <th class="col-act"></th>
                    </tr>
                </thead>
                <tbody id="po-lines-body"></tbody>
            </table>

            <button class="btn btn-outline btn-add-line" onclick="addPOLine()">
                + Add product
            </button>

            <div class="line-total">
                <span>Order total</span>
                <span id="po-total">₱0.00</span>
            </div>

        </div>
    `;

    if (record.Supplier_ID) {

        await loadSupplierProducts(record.Supplier_ID, record.lines || []);

        (record.lines || []).forEach(line => {

            document.getElementById("po-lines-body")
                .insertAdjacentHTML("beforeend", poLineRow(line));
        });

        if ((record.lines || []).length === 0) {
            addPOLine();
        }

        recalcPO();
        updateExpectedDate();

    } else {

        await loadAllProductsForPO();

        addPOLine();

        recalcPO();
    }
}

function closePOModal() {

    document.getElementById("po-modal-overlay").classList.remove("open");

    poEditId = null;
    poProducts = [];
    poCatalogIsFallback = false;
    poExpectedManual = false;
}

function collectPOLines() {

    const lines = [];

    let valid = true;

    document.querySelectorAll("#po-lines-body .po-line").forEach(row => {

        const productID = row.querySelector(".line-product").value;
        const qty = Number(row.querySelector(".line-qty").value || 0);
        const price = Number(row.querySelector(".line-price").value || 0);

        if (!productID || qty <= 0) {
            valid = false;
            return;
        }

        lines.push({
            Product_ID: Number(productID),
            Quantity: qty,
            Unit_Price: price
        });
    });

    return { lines: lines, valid: valid };
}

async function savePO() {

    const supplierID = document.getElementById("po-supplier").value;
    const poDate = document.getElementById("po-date").value;
    const expected = document.getElementById("po-expected").value;
    const statusID = document.getElementById("po-status").value;

    if (!supplierID) {
        alert("Select a supplier first.");
        return;
    }

    if (!poDate) {
        alert("Set the PO date.");
        return;
    }

    const collected = collectPOLines();

    if (!collected.valid) {
        alert("Each line needs a product and a quantity of at least 1.");
        return;
    }

    if (collected.lines.length === 0) {
        alert("Add at least one product to the order.");
        return;
    }

    const payload = {
        Supplier_ID: Number(supplierID),
        PO_Date: poDate,
        Expected_Date: expected,
        Status_ID: statusID ? Number(statusID) : 0,
        lines: collected.lines
    };

    let result;

    if (poEditId) {

        payload.PO_ID = poEditId;

        result = await callApi("updatePurchaseOrder", payload);

    } else {

        result = await callApi("insertPurchaseOrder", payload);
    }

    if (!result.success) {
        alert(result.message);
        return;
    }

    alert(result.message);

    closePOModal();

    loadPurchaseOrders();
}

function cancelPO(id) {

    openConfirmModal(
        `Cancel purchase order #${id}?`,
        {
            title: "Cancel Purchase Order",
            warning: "The order will be marked Cancelled. This can be reviewed later.",
            confirmLabel: "Cancel Order",
            onConfirm: async () => {

                const result = await callApi("cancelPurchaseOrder", { PO_ID: id });

                alert(result.message);

                if (result.success) {
                    loadPurchaseOrders();
                }
            }
        }
    );
}

function deletePO(id) {

    openConfirmModal(
        `Remove purchase order #${id}? It will no longer appear in the list.`,
        {
            title: "Remove Purchase Order",
            warning: "This action cannot be undone from this screen.",
            confirmLabel: "Remove",
            onConfirm: async () => {

                const result = await callApi("deletePurchaseOrder", { PO_ID: id });

                alert(result.message);

                if (result.success) {
                    loadPurchaseOrders();
                }
            }
        }
    );
}

async function viewPO(id) {

    openViewModal(`Purchase Order #${id}`);

    const body = document.getElementById("view-modal-body");

    const result = await callApi("getPurchaseOrder", { PO_ID: id });

    if (!result.success) {
        body.innerHTML = `<p class="archived-empty">${esc(result.message)}</p>`;
        return;
    }

    const po = result.data;

    let total = 0;

    (po.lines || []).forEach(line => {
        total += Number(line.Subtotal || 0);
    });

    body.innerHTML = `

        <div class="detail-card">

            <h4>${esc(po.SupplierName)}</h4>

            <div class="detail-sub">Supplier for this order</div>

            <div class="detail-grid">

                <div>
                    <span class="detail-label">Contact person</span>
                    <span class="detail-value">${esc(po.ContactPerson || "—")}</span>
                </div>

                <div>
                    <span class="detail-label">Phone</span>
                    <span class="detail-value">${esc(po.Phone || "—")}</span>
                </div>

                <div>
                    <span class="detail-label">Email</span>
                    <span class="detail-value">${esc(po.Email || "—")}</span>
                </div>

                <div>
                    <span class="detail-label">Address</span>
                    <span class="detail-value">${esc(po.Address || "—")}</span>
                </div>

            </div>

            <div style="margin-top: 12px;">
                <button class="btn btn-outline"
                    onclick="viewSupplier(${po.Supplier_ID})">
                    See full supplier profile
                </button>
            </div>

        </div>


        <div class="detail-grid">

            <div>
                <span class="detail-label">PO date</span>
                <span class="detail-value">${esc(po.PO_Date)}</span>
            </div>

            <div>
                <span class="detail-label">Expected delivery</span>
                <span class="detail-value">${esc(po.Expected_Date || "—")}</span>
            </div>

            <div>
                <span class="detail-label">Status</span>
                <span class="detail-value">${statusBadge(po.StatusName)}</span>
            </div>

            <div>
                <span class="detail-label">Prepared by</span>
                <span class="detail-value">${esc(po.UserName)}</span>
            </div>

        </div>


        <div class="detail-section">

            <h4>Items ordered</h4>

            <table class="line-table">
                <thead>
                    <tr>
                        <th>Product</th>
                        <th class="num">Quantity</th>
                        <th class="num">Unit price</th>
                        <th class="num">Subtotal</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    ${(po.lines || []).map(line => `
                        <tr>
                            <td>${esc(line.ProductName)}</td>
                            <td class="num">${esc(line.Quantity)} ${esc(line.UnitSymbol || "")}</td>
                            <td class="num">${money(line.Unit_Price)}</td>
                            <td class="num">${money(line.Subtotal)}</td>
                            <td>
                                <button class="btn-icon" title="See product"
                                    onclick="viewProduct(${line.Product_ID})">👁</button>
                            </td>
                        </tr>
                    `).join("") ||
                    `<tr><td colspan="5" class="empty-row">No items.</td></tr>`}
                </tbody>
            </table>

            <div class="line-total">
                <span>Order total</span>
                <span>${money(total)}</span>
            </div>

        </div>
    `;
}

async function loadPurchaseReturns() {

    const tbody = document.getElementById("tbl-pr");

    tbody.innerHTML = loadingRow(8);

    const result = await callApi("getPurchaseReturns", {
        search: document.getElementById("pr-search").value.trim(),
        Status_ID: document.getElementById("pr-filter-status").value || 0
    });

    if (!result.success) {
        tbody.innerHTML = emptyRow(8, result.message);
        return;
    }

    tbody.innerHTML = (result.data || []).map(pr => `
        <tr>
            <td>#${pr.Purchase_Return_ID}</td>
            <td>${esc(pr.Return_Date)}</td>
            <td>#${pr.PO_ID}</td>
            <td>${esc(pr.SupplierName)}</td>
            <td class="num">${esc(pr.TotalQuantity)}</td>
            <td>${esc(pr.Reason || "—")}</td>
            <td>${statusBadge(pr.StatusName)}</td>
            <td>
                <button class="btn-icon" title="See details"
                    onclick="viewPR(${pr.Purchase_Return_ID})">👁</button>

                <button class="btn-icon" title="Edit"
                    onclick="openPRModal(${pr.Purchase_Return_ID})">✎</button>

                <button class="btn-icon" title="Cancel"
                    onclick="cancelPR(${pr.Purchase_Return_ID})">⊘</button>

                <button class="btn-icon btn-icon-danger" title="Remove"
                    onclick="deletePR(${pr.Purchase_Return_ID})">🗑</button>
            </td>
        </tr>
    `).join("") || emptyRow(8, "No purchase returns yet.");
}

let prEditId = null;

let prPOLines = [];

function prProductOptions(selected) {

    return prPOLines.map(line => `
        <option value="${line.Product_ID}"
            ${String(line.Product_ID) === String(selected) ? "selected" : ""}>
            ${esc(line.ProductName)} (ordered: ${esc(line.Quantity)})
        </option>
    `).join("");
}

function prLineRow(line = {}) {

    lineCounter += 1;

    const rowId = `pr-line-${lineCounter}`;

    return `
        <tr id="${rowId}" class="pr-line">
            <td>
                <select class="pr-product">
                    <option value="">-- Select product --</option>
                    ${prProductOptions(line.Product_ID)}
                </select>
            </td>

            <td class="col-qty">
                <input type="number" class="pr-qty" min="1" step="1"
                    value="${line.Quantity ?? 1}">
            </td>

            <td class="col-act">
                <button class="btn-icon btn-icon-danger" title="Remove line"
                    onclick="removePRLine('${rowId}')">✕</button>
            </td>
        </tr>
    `;
}

function addPRLine(line = {}) {

    const body = document.getElementById("pr-lines-body");

    if (!body) {
        return;
    }

    if (prPOLines.length === 0) {
        alert("Select a purchase order first.");
        return;
    }

    body.insertAdjacentHTML("beforeend", prLineRow(line));
}

function removePRLine(rowId) {

    const row = document.getElementById(rowId);

    if (row) {
        row.remove();
    }
}

async function purchaseOrderOptions(selectedID) {

    const result = await callApi("getPurchaseOrders", {});

    return (result.data || []).map(po => `
        <option value="${po.PO_ID}"
            ${String(po.PO_ID) === String(selectedID) ? "selected" : ""}>
            #${po.PO_ID} — ${esc(po.SupplierName)} (${esc(po.PO_Date)})
        </option>
    `).join("");
}

async function onPRPOChange() {

    const poID = document.getElementById("pr-po").value;

    const body = document.getElementById("pr-lines-body");

    body.innerHTML = "";

    prPOLines = [];

    const infoBox = document.getElementById("pr-supplier-info");

    if (!poID) {
        infoBox.innerHTML = "—";
        return;
    }

    const result = await callApi("getPurchaseOrder", { PO_ID: Number(poID) });

    if (!result.success) {
        alert(result.message);
        return;
    }

    prPOLines = result.data.lines || [];

    infoBox.innerHTML = `
        ${esc(result.data.SupplierName)}<br>
        <small>
            ${esc(result.data.ContactPerson || "No contact person")} ·
            ${esc(result.data.Phone || "No phone")}
        </small>
    `;

    addPRLine();
}

async function openPRModal(id = null) {

    prEditId = id;
    prPOLines = [];

    document.getElementById("pr-modal-title").textContent =
        id ? `Edit Purchase Return #${id}` : "New Purchase Return";

    const body = document.getElementById("pr-modal-body");

    body.innerHTML = `<p class="modal-loading">Loading form...</p>`;

    document.getElementById("pr-modal-overlay").classList.add("open");

    let record = {
        PO_ID: "",
        Return_Date: today(),
        Reason: "",
        Status_ID: "",
        lines: []
    };

    if (id) {

        const result = await callApi("getPurchaseReturn", {
            Purchase_Return_ID: id
        });

        if (!result.success) {
            body.innerHTML = `<p class="archived-empty">${esc(result.message)}</p>`;
            return;
        }

        record = result.data;

        if (Number(record.Editable) !== 1) {

            body.innerHTML = `
                <p class="archived-empty">
                    ${esc(record.StatusName)} purchase returns can no longer be edited.
                </p>
            `;

            document.getElementById("btn-save-pr").style.display = "none";

            return;
        }
    }

    document.getElementById("btn-save-pr").style.display = "";

    const poOptions = await purchaseOrderOptions(record.PO_ID);

    body.innerHTML = `

        <div class="form-row">

            <div class="form-group">
                <label>Purchase order *</label>
                <select id="pr-po" onchange="onPRPOChange()" ${id ? "disabled" : ""}>
                    <option value="">-- Select purchase order --</option>
                    ${poOptions}
                </select>
            </div>

            <div class="form-group">
                <label>Supplier</label>
                <div class="detail-value" id="pr-supplier-info">
                    ${record.SupplierName ? `
                        ${esc(record.SupplierName)}<br>
                        <small>
                            ${esc(record.ContactPerson || "No contact person")} ·
                            ${esc(record.Phone || "No phone")}
                        </small>
                    ` : "—"}
                </div>
            </div>

            <div class="form-group">
                <label>Return date *</label>
                <input type="date" id="pr-date" value="${esc(record.Return_Date || today())}">
            </div>

            <div class="form-group">
                <label>Status</label>
                <select id="pr-status">
                    <option value="">Pending (default)</option>
                    ${statusOptions(record.Status_ID)}
                </select>
            </div>

        </div>

        <div class="form-group">
            <label>Reason</label>
            <textarea id="pr-reason" rows="2"
                placeholder="Damaged goods, wrong item, expired stock...">${esc(record.Reason || "")}</textarea>
        </div>

        <div class="line-items">

            <h4>Products returned</h4>

            <table class="line-table">
                <thead>
                    <tr>
                        <th>Product</th>
                        <th class="col-qty">Quantity</th>
                        <th class="col-act"></th>
                    </tr>
                </thead>
                <tbody id="pr-lines-body"></tbody>
            </table>

            <button class="btn btn-outline btn-add-line" onclick="addPRLine()">
                + Add product
            </button>

        </div>
    `;

    if (id && record.PO_ID) {

        const poResult = await callApi("getPurchaseOrder", {
            PO_ID: Number(record.PO_ID)
        });

        if (poResult.success) {
            prPOLines = poResult.data.lines || [];
        }

        (record.lines || []).forEach(line => addPRLine(line));

        if ((record.lines || []).length === 0) {
            addPRLine();
        }
    }
}

function closePRModal() {

    document.getElementById("pr-modal-overlay").classList.remove("open");

    prEditId = null;
    prPOLines = [];
}

function collectPRLines() {

    const lines = [];

    let valid = true;

    document.querySelectorAll("#pr-lines-body .pr-line").forEach(row => {

        const productID = row.querySelector(".pr-product").value;
        const qty = Number(row.querySelector(".pr-qty").value || 0);

        if (!productID || qty <= 0) {
            valid = false;
            return;
        }

        lines.push({
            Product_ID: Number(productID),
            Quantity: qty
        });
    });

    return { lines: lines, valid: valid };
}

async function savePR() {

    const poID = document.getElementById("pr-po").value;
    const returnDate = document.getElementById("pr-date").value;
    const reason = document.getElementById("pr-reason").value.trim();
    const statusID = document.getElementById("pr-status").value;

    if (!poID) {
        alert("Select the purchase order being returned.");
        return;
    }

    if (!returnDate) {
        alert("Set the return date.");
        return;
    }

    const collected = collectPRLines();

    if (!collected.valid) {
        alert("Each line needs a product and a quantity of at least 1.");
        return;
    }

    if (collected.lines.length === 0) {
        alert("Add at least one product to the return.");
        return;
    }

    const payload = {
        PO_ID: Number(poID),
        Return_Date: returnDate,
        Reason: reason,
        Status_ID: statusID ? Number(statusID) : 0,
        lines: collected.lines
    };

    let result;

    if (prEditId) {

        payload.Purchase_Return_ID = prEditId;

        result = await callApi("updatePurchaseReturn", payload);

    } else {

        result = await callApi("insertPurchaseReturn", payload);
    }

    if (!result.success) {
        alert(result.message);
        return;
    }

    alert(result.message);

    closePRModal();

    loadPurchaseReturns();
}

function cancelPR(id) {

    openConfirmModal(
        `Cancel purchase return #${id}?`,
        {
            title: "Cancel Purchase Return",
            warning: "The return will be marked Cancelled.",
            confirmLabel: "Cancel Return",
            onConfirm: async () => {

                const result = await callApi("cancelPurchaseReturn", {
                    Purchase_Return_ID: id
                });

                alert(result.message);

                if (result.success) {
                    loadPurchaseReturns();
                }
            }
        }
    );
}

function deletePR(id) {

    openConfirmModal(
        `Remove purchase return #${id}?`,
        {
            title: "Remove Purchase Return",
            warning: "This action cannot be undone from this screen.",
            confirmLabel: "Remove",
            onConfirm: async () => {

                const result = await callApi("deletePurchaseReturn", {
                    Purchase_Return_ID: id
                });

                alert(result.message);

                if (result.success) {
                    loadPurchaseReturns();
                }
            }
        }
    );
}

async function viewPR(id) {

    openViewModal(`Purchase Return #${id}`);

    const body = document.getElementById("view-modal-body");

    const result = await callApi("getPurchaseReturn", {
        Purchase_Return_ID: id
    });

    if (!result.success) {
        body.innerHTML = `<p class="archived-empty">${esc(result.message)}</p>`;
        return;
    }

    const pr = result.data;

    body.innerHTML = `

        <div class="detail-card">

            <h4>${esc(pr.SupplierName)}</h4>

            <div class="detail-sub">Supplier receiving this return</div>

            <div class="detail-grid">

                <div>
                    <span class="detail-label">Contact person</span>
                    <span class="detail-value">${esc(pr.ContactPerson || "—")}</span>
                </div>

                <div>
                    <span class="detail-label">Phone</span>
                    <span class="detail-value">${esc(pr.Phone || "—")}</span>
                </div>

                <div>
                    <span class="detail-label">Email</span>
                    <span class="detail-value">${esc(pr.Email || "—")}</span>
                </div>

                <div>
                    <span class="detail-label">Address</span>
                    <span class="detail-value">${esc(pr.Address || "—")}</span>
                </div>

            </div>

            <div style="margin-top: 12px;">
                <button class="btn btn-outline"
                    onclick="viewSupplier(${pr.Supplier_ID})">
                    See full supplier profile
                </button>
            </div>

        </div>


        <div class="detail-grid">

            <div>
                <span class="detail-label">Purchase order</span>
                <span class="detail-value">
                    #${esc(pr.PO_ID)} (${esc(pr.PO_Date || "—")})
                </span>
            </div>

            <div>
                <span class="detail-label">Return date</span>
                <span class="detail-value">${esc(pr.Return_Date)}</span>
            </div>

            <div>
                <span class="detail-label">Status</span>
                <span class="detail-value">${statusBadge(pr.StatusName)}</span>
            </div>

            <div>
                <span class="detail-label">Filed by</span>
                <span class="detail-value">${esc(pr.UserName)}</span>
            </div>

            <div>
                <span class="detail-label">Reason</span>
                <span class="detail-value">${esc(pr.Reason || "—")}</span>
            </div>

        </div>


        <div class="detail-section">

            <h4>Items returned</h4>

            <table class="line-table">
                <thead>
                    <tr>
                        <th>Product</th>
                        <th class="num">Quantity</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    ${(pr.lines || []).map(line => `
                        <tr>
                            <td>${esc(line.ProductName)}</td>
                            <td class="num">${esc(line.Quantity)} ${esc(line.UnitSymbol || "")}</td>
                            <td>
                                <button class="btn-icon" title="See product"
                                    onclick="viewProduct(${line.Product_ID})">👁</button>
                            </td>
                        </tr>
                    `).join("") ||
                    `<tr><td colspan="3" class="empty-row">No items.</td></tr>`}
                </tbody>
            </table>

        </div>
    `;
}

function openViewModal(title) {

    document.getElementById("view-modal-title").textContent = title;

    document.getElementById("view-modal-body").innerHTML =
        `<p class="modal-loading">Loading...</p>`;

    document.getElementById("view-modal-overlay").classList.add("open");
}

function closeViewModal() {
    document.getElementById("view-modal-overlay").classList.remove("open");
}

/* ============================================================
   CONFIRM MODAL (used for cancel / remove / logout)
============================================================ */

let confirmActionCallback = null;

function openConfirmModal(message, {
    title = "Confirm Action",
    warning = "This action cannot be undone.",
    confirmLabel = "Confirm",
    onConfirm = null
} = {}) {

    document.querySelector("#confirm-modal-overlay .modal-header h3").textContent = title;
    document.getElementById("confirm-modal-message").textContent = message;
    document.getElementById("confirm-modal-warning").textContent = warning;

    const btn = document.getElementById("btn-confirm-action");
    btn.textContent = confirmLabel;

    confirmActionCallback = onConfirm;

    document.getElementById("confirm-modal-overlay").classList.add("open");
}

function closeConfirmModal() {
    document.getElementById("confirm-modal-overlay").classList.remove("open");
    confirmActionCallback = null;
}

/* ============================================================
   SIDEBAR (collapse, mobile drawer)
============================================================ */

function openSidebar() {
    const sidebar = document.getElementById("sidebar");
    const backdrop = document.getElementById("sidebar-backdrop");
    if (sidebar) sidebar.classList.add("sidebar-open");
    if (backdrop) backdrop.classList.add("open");
}

function closeSidebar() {
    const sidebar = document.getElementById("sidebar");
    const backdrop = document.getElementById("sidebar-backdrop");
    if (sidebar) sidebar.classList.remove("sidebar-open");
    if (backdrop) backdrop.classList.remove("open");
}

function toggleSidebar() {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return;
    if (sidebar.classList.contains("sidebar-open")) {
        closeSidebar();
    } else {
        openSidebar();
    }
}

function wireSidebarToggle() {
    const hamburger = document.getElementById("hamburger-btn");
    if (hamburger) {
        hamburger.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleSidebar();
        });
    }

    const backdrop = document.getElementById("sidebar-backdrop");
    if (backdrop) backdrop.addEventListener("click", closeSidebar);

    const sidebarToggle = document.getElementById("sidebar-toggle");
    const sidebarEl = document.getElementById("sidebar");

    if (sidebarToggle && sidebarEl) {
        const savedState = localStorage.getItem("purchasingSidebarCollapsed");
        if (savedState === "true") {
            sidebarEl.classList.add("collapsed");
            sidebarToggle.setAttribute("title", "Expand sidebar");
        }

        sidebarToggle.addEventListener("click", () => {
            sidebarEl.classList.toggle("collapsed");
            const isCollapsed = sidebarEl.classList.contains("collapsed");
            sidebarToggle.setAttribute("title", isCollapsed ? "Expand sidebar" : "Collapse sidebar");
            localStorage.setItem("purchasingSidebarCollapsed", isCollapsed ? "true" : "false");
            closeProfileMenu();

            handleDashboardResize();
            setTimeout(() => {
                if (chartProductsCategory) chartProductsCategory.resize();
                if (chartPoStatus) chartPoStatus.resize();
            }, 300);
        });
    }
}

/* ============================================================
   SIDEBAR PROFILE MENU (Log Out)
============================================================ */

function closeProfileMenu() {
    const profile = document.getElementById("sidebar-profile");
    const trigger = document.getElementById("sidebar-profile-trigger");
    if (profile) profile.classList.remove("menu-open");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
}

function toggleProfileMenu() {
    const profile = document.getElementById("sidebar-profile");
    const trigger = document.getElementById("sidebar-profile-trigger");
    if (!profile || !trigger) return;
    const isOpen = profile.classList.toggle("menu-open");
    trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
}

function confirmLogout() {
    closeProfileMenu();

    openConfirmModal(
        "Are you sure you want to log out?",
        {
            title: "Log Out",
            warning: "You will need to sign in again to access the purchasing panel.",
            confirmLabel: "Log Out",
            onConfirm: () => logout()
        }
    );
}

function wireProfileMenu() {
    const profileTrigger = document.getElementById("sidebar-profile-trigger");
    const profileEl = document.getElementById("sidebar-profile");
    const logoutBtn = document.getElementById("btn-logout");

    if (profileTrigger) {
        profileTrigger.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleProfileMenu();
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            confirmLogout();
        });
    }

    document.addEventListener("click", (e) => {
        if (profileEl && !profileEl.contains(e.target)) closeProfileMenu();
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeProfileMenu();
    });
}

document.addEventListener("DOMContentLoaded", async () => {

    const displayName = currentUser
        ? (currentUser.FirstName || currentUser.UserName || "Purchasing")
        : "Purchasing";

    const fullDisplayName = currentUser && currentUser.FirstName
        ? `${currentUser.FirstName} ${currentUser.LastName || ""}`.trim()
        : (currentUser ? currentUser.UserName : "Purchasing");

    const welcome = document.getElementById("welcome-text");
    if (welcome) welcome.textContent = `Welcome, ${displayName}`;

    const profileName = document.getElementById("sidebar-profile-name");
    if (profileName) profileName.textContent = fullDisplayName;

    const profileRole = document.getElementById("sidebar-profile-role");
    if (profileRole) profileRole.textContent = (currentUser && currentUser.RoleName) || "Purchasing Staff";

    const profileAvatar = document.getElementById("sidebar-profile-avatar");
    if (profileAvatar) {
        profileAvatar.textContent = fullDisplayName.trim().charAt(0).toUpperCase() || "P";
    }

    document.querySelectorAll(".nav-link").forEach(button => {

        button.addEventListener("click", () => {
            switchSection(button.dataset.target);
        });
    });

    wireSidebarToggle();
    wireProfileMenu();

    debounce(document.getElementById("search-product"), loadProducts);
    debounce(document.getElementById("search-stock"), loadStock);
    debounce(document.getElementById("search-supplier"), loadSuppliers);
    debounce(document.getElementById("search-category"), loadCategories);
    debounce(document.getElementById("po-search"), loadPurchaseOrders);
    debounce(document.getElementById("pr-search"), loadPurchaseReturns);

    ["po-filter-category", "po-date-from", "po-date-to"]
        .forEach(id => {

            const element = document.getElementById(id);

            if (element) {
                element.addEventListener("change", loadPurchaseOrders);
            }
        });

    const prStatus = document.getElementById("pr-filter-status");

    if (prStatus) {
        prStatus.addEventListener("change", loadPurchaseReturns);
    }

    ["po-modal-overlay", "pr-modal-overlay", "view-modal-overlay", "confirm-modal-overlay"].forEach(id => {

        const overlay = document.getElementById(id);

        if (overlay) {

            overlay.addEventListener("click", event => {

                if (event.target.id === id) {

                    if (id === "confirm-modal-overlay") {
                        closeConfirmModal();
                    } else {
                        overlay.classList.remove("open");
                    }
                }
            });
        }
    });

    const confirmBtn = document.getElementById("btn-confirm-action");
    if (confirmBtn) {
        confirmBtn.addEventListener("click", () => {
            const callback = confirmActionCallback;
            closeConfirmModal();
            if (callback) callback();
        });
    }

    await loadCaches();

    loadDashboard();
});