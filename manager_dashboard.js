const baseApiUrl = "http://localhost/grocery_warehouse/api_manager.php";

let currentUser     = null;
let productsCache   = [];
let statusesCache   = [];
let categoriesCache = [];
let aislesCache     = [];
let shelvesCache    = [];
let confirmCallback = null;

function loadSession() {
    try {
        const raw = localStorage.getItem("user");
        if (!raw) { window.location.replace("login.html"); return false; }

        currentUser = JSON.parse(raw);
        if (!currentUser || !currentUser.UserID) {
            window.location.replace("login.html");
            return false;
        }

        const role = String(currentUser.RoleName || "").toLowerCase().trim();
        const allowed = ["warehouse manager", "manager", "warehouse"];

        if (!allowed.includes(role)) {
            if (role === "admin" || role === "administrator") {
                window.location.replace("admin.html");
            } else if (role === "inventory staff" || role === "inventory") {
                window.location.replace("inventory.html");
            } else if (role === "receiving staff" || role === "receiving") {
                window.location.replace("receiving_dashboard.html");
            } else {
                localStorage.removeItem("user");
                window.location.replace("login.html");
            }
            return false;
        }

        const name = ((currentUser.FirstName || "") + " " + (currentUser.LastName || "")).trim();
        const displayName = name || currentUser.UserName || "Manager";

        const topbarName = document.getElementById("topbar-username");
        if (topbarName) topbarName.textContent = "Welcome, " + displayName;

        const profileName = document.getElementById("sidebar-profile-name");
        if (profileName) profileName.textContent = displayName;

        const profileRole = document.getElementById("sidebar-profile-role");
        if (profileRole) profileRole.textContent = currentUser.RoleName || "Warehouse Manager";

        const profileAvatar = document.getElementById("sidebar-profile-avatar");
        if (profileAvatar) {
            profileAvatar.textContent = displayName.trim().charAt(0).toUpperCase() || "M";
        }

        return true;
    } catch (err) {
        console.error("Session error:", err);
        window.location.replace("login.html");
        return false;
    }
}

async function apiCall(operation, payload = {}) {
    const body = Object.assign(
        { operation, LoggedInUserID: currentUser ? currentUser.UserID : 0 },
        payload
    );

    const res = await axios.post(baseApiUrl, body, {
        headers: { "Content-Type": "application/json" }
    });
    return res.data;
}

function setActiveSection(sectionId, title) {
    document.querySelectorAll(".page-section").forEach(s => s.classList.remove("active-section"));
    const target = document.getElementById(sectionId);
    if (target) target.classList.add("active-section");

    document.querySelectorAll(".nav-link").forEach(b => b.classList.remove("active"));
    const btn = document.querySelector(`.nav-link[data-section="${sectionId}"]`);
    if (btn) btn.classList.add("active");

    const titleEl = document.getElementById("page-title");
    if (titleEl) titleEl.textContent = title;

    closeSidebar();

    if (sectionId === "dashboard-section") {
        requestAnimationFrame(() => handleDashboardResize());
    }
}

/* ============================================================
   DASHBOARD → SECTION NAVIGATION
   Lets the dashboard's stat cards and chart panels act as
   shortcuts, same as the admin dashboard.
============================================================ */

function goToSection(sectionId, tabId = null) {
    const navBtn = document.querySelector(`.nav-link[data-section="${sectionId}"]`);
    if (navBtn) {
        navBtn.click();
    }

    if (tabId) {
        requestAnimationFrame(() => {
            const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
            if (tabBtn) tabBtn.click();
        });
    }
}

function openModal(id)  { const el = document.getElementById(id); if (el) el.classList.add("open"); }
function closeModal(id) { const el = document.getElementById(id); if (el) el.classList.remove("open"); }

function askConfirm(message, onYes) {
    const msg = document.getElementById("confirm-message");
    if (msg) msg.textContent = message;
    confirmCallback = onYes;
    openModal("confirm-modal-overlay");
}

function fmtDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (isNaN(d)) return value;
    return d.toLocaleString();
}

function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function statusBadge(value) {
    const status = String(value || "").toLowerCase().trim();

    const map = {
        "approved":   "badge-green",
        "completed":  "badge-green",
        "active":     "badge-green",
        "received":   "badge-green",
        "pending":    "badge-amber",
        "for review": "badge-amber",
        "submitted":  "badge-amber",
        "draft":      "badge-gray",
        "cancelled":  "badge-gray",
        "canceled":   "badge-gray",
        "rejected":   "badge-red"
    };

    const cls = map[status] || "badge-gray";
    return `<span class="badge ${cls}">${escapeHtml(value || "—")}</span>`;
}

function setCount(id, count) {
    const el = document.getElementById(id);
    if (el) el.textContent = count === 0 ? "" : `${count} record${count === 1 ? "" : "s"} found`;
}

/* ============================================================
   ✅ SHARED FILTER HELPERS
   fillSelect renders "<option value=''>All ...</option>" plus
   one option per row. The various ensure*Cache() functions load
   a reference list (categories / products / aisles / shelves)
   once and reuse it — each guarded so repeated calls (e.g. every
   time a section is opened) don't re-fetch or re-render options
   that are already there.
============================================================ */

function fillSelect(id, rows, valueKey, labelKey, allLabel = "All") {
    const sel = document.getElementById(id);
    if (!sel) return;

    const opts = rows
        .map(r => `<option value="${r[valueKey]}">${escapeHtml(r[labelKey])}</option>`)
        .join("");

    sel.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>` + opts;
}

async function ensureCategoriesCache() {
    if (categoriesCache.length === 0) {
        const res = await apiCall("getCategories");
        if (res && res.success) categoriesCache = res.data || [];
    }
    return categoriesCache;
}

async function ensureProductsCache() {
    if (productsCache.length === 0) {
        const res = await apiCall("getProducts");
        if (res && res.success) productsCache = res.data || [];
    }
    return productsCache;
}

async function ensureAislesCache() {
    if (aislesCache.length === 0) {
        const res = await apiCall("getAisles");
        if (res && res.success) aislesCache = res.data || [];
    }
    return aislesCache;
}

async function ensureShelvesCache() {
    if (shelvesCache.length === 0) {
        const res = await apiCall("getShelves");
        if (res && res.success) shelvesCache = res.data || [];
    }
    return shelvesCache;
}

/* Fills a <select> with "<option>All products</option>" plus one
   option per cached product, but only the first time (guarded by
   checking it still only has its placeholder option). */
function populateProductSelectOnce(selectId, allLabel = "All products") {
    const sel = document.getElementById(selectId);
    if (!sel || sel.options.length > 1) return;
    fillSelect(selectId, productsCache, "ProductID", "ProductName", allLabel);
}

function populateCategorySelectOnce(selectId, allLabel = "All categories") {
    const sel = document.getElementById(selectId);
    if (!sel || sel.options.length > 1) return;
    fillSelect(selectId, categoriesCache, "CategoryID", "CategoryName", allLabel);
}

/* Products/Low Stock/Current Stock rows carry CategoryName, not
   CategoryID, so a selected CategoryID from the dropdown has to be
   resolved back to the matching CategoryName before it can filter
   those rows. */
function categoryNameFromID(categoryID) {
    if (!categoryID) return "";
    const match = categoriesCache.find(c => String(c.CategoryID) === String(categoryID));
    return match ? match.CategoryName : "";
}

/* ✅ Discrepancy rows (receiving + inventory adjustment) only carry
   ProductName, with no CategoryID/CategoryName of their own. This
   builds a ProductName → CategoryName lookup from productsCache so
   the Category filter can still work against them. Matching is by
   product name (lower-cased/trimmed) since that's the only field
   the two datasets share. */
function buildProductCategoryLookup() {
    const map = {};
    productsCache.forEach(p => {
        map[String(p.ProductName || "").toLowerCase().trim()] = p.CategoryName || "";
    });
    return map;
}

/* ============================================================
   ✅ PRINT
   Opens the target table in a fresh, minimal print view — no
   sidebar, topbar, or filter controls — with a title and a
   printed-on timestamp, then triggers the browser's print
   dialog. Works for any <table id="..."> already on the page,
   using whatever rows are currently loaded/filtered in it.
============================================================ */

function printReportTable(tableId, title) {
    const table = document.getElementById(tableId);
    if (!table) {
        console.warn("printReportTable: no table found with id", tableId);
        return;
    }

    const printWindow = window.open("", "_blank", "width=980,height=720");
    if (!printWindow) {
        alert("Please allow pop-ups for this site to print the report.");
        return;
    }

    const generatedAt = new Date().toLocaleString();
    const generatedBy = currentUser
        ? ((currentUser.FirstName || "") + " " + (currentUser.LastName || "")).trim() || currentUser.UserName
        : "";

    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>${escapeHtml(title)}</title>
            <style>
                * { box-sizing: border-box; }
                body {
                    font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
                    color: #0F2419;
                    padding: 32px;
                    margin: 0;
                }
                .print-header {
                    display: flex;
                    align-items: baseline;
                    justify-content: space-between;
                    border-bottom: 2px solid #12331F;
                    padding-bottom: 10px;
                    margin-bottom: 6px;
                }
                .print-header h1 {
                    font-size: 18px;
                    margin: 0;
                }
                .print-brand {
                    font-size: 12px;
                    font-weight: 700;
                    color: #166534;
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                }
                .print-meta {
                    font-size: 11.5px;
                    color: #555;
                    margin-bottom: 20px;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 12.5px;
                }
                th, td {
                    border: 1px solid #ccc;
                    padding: 7px 10px;
                    text-align: left;
                }
                th {
                    background: #E4F6EC;
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                    font-size: 11px;
                    color: #166534;
                }
                tbody tr:nth-child(even) td { background: #FAFEFB; }
                .badge {
                    display: inline-block;
                    padding: 2px 9px;
                    border-radius: 999px;
                    font-size: 10.5px;
                    font-weight: 700;
                }
                .badge-green { background: #DCFCE7; color: #166534; }
                .badge-amber { background: #FEF3C7; color: #92400E; }
                .badge-red   { background: #FEE2E2; color: #991B1B; }
                .badge-gray  { background: #E5E7EB; color: #374151; }
                .empty-row { display: none; }
                .print-footer {
                    margin-top: 22px;
                    font-size: 10.5px;
                    color: #888;
                    text-align: right;
                }
                @page { margin: 16mm; }
                @media print {
                    body { padding: 0; }
                }
            </style>
        </head>
        <body>
            <div class="print-header">
                <h1>${escapeHtml(title)}</h1>
                <span class="print-brand">Grocery Warehouse Management System</span>
            </div>
            <div class="print-meta">
                Printed ${escapeHtml(generatedAt)}${generatedBy ? " by " + escapeHtml(generatedBy) : ""}
            </div>
            ${table.outerHTML}
            <div class="print-footer">End of report</div>
        </body>
        </html>
    `);
    printWindow.document.close();

    const triggerPrint = () => {
        printWindow.focus();
        printWindow.print();
    };

    // onload is the reliable path; the timeout is a fallback for
    // browsers that don't fire it for document.write()-built pages.
    printWindow.onload = triggerPrint;
    setTimeout(triggerPrint, 400);
}

async function loadDashboard() {
    try {
        const res = await apiCall("getManagerDashboard");
        if (!res || !res.success) {
            console.warn("Dashboard:", res ? res.message : "no response");
            return;
        }

        const d = res.data || {};

        const setText = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };

        setText("stat-products", d.totalProducts ?? 0);
        setText("stat-lowstock", d.lowStockCount ?? 0);
        setText("stat-adj",      d.pendingAdjustments ?? 0);
        setText("stat-ret",      d.pendingReturns ?? 0);
        setText("stat-po",       d.pendingPOs ?? 0);

        const adjBody = document.getElementById("dashboard-adjustments");
        if (adjBody) {
            if (!d.recentAdjustments || d.recentAdjustments.length === 0) {
                adjBody.innerHTML = `<tr><td colspan="4" class="empty-row">No recent adjustments.</td></tr>`;
            } else {
                adjBody.innerHTML = d.recentAdjustments.map(a => `
                    <tr>
                        <td>${fmtDate(a.Adjustment_Date)}</td>
                        <td>${escapeHtml(a.ProductNames || "—")}</td>
                        <td>${escapeHtml(a.Adjustment_Type || "—")}</td>
                        <td>${statusBadge(a.StatusName)}</td>
                    </tr>
                `).join("");
            }
        }

        const actBody = document.getElementById("dashboard-activity");
        if (actBody) {
            if (!d.recentActivity || d.recentActivity.length === 0) {
                actBody.innerHTML = `<tr><td colspan="4" class="empty-row">No recent activity.</td></tr>`;
            } else {
                actBody.innerHTML = d.recentActivity.map(a => `
                    <tr>
                        <td>${fmtDate(a.ActionTimestamp)}</td>
                        <td>${escapeHtml(a.UserName || "—")}</td>
                        <td>${escapeHtml(a.ActionType || "—")}</td>
                        <td>${escapeHtml(a.TableAffected || "—")}</td>
                    </tr>
                `).join("");
            }
        }
    } catch (err) {
        console.error("Dashboard error:", err);
    }

    await loadDashboardCharts();
}

/* ============================================================
   DASHBOARD CHARTS
============================================================ */

let chartProductsCategory = null;
let chartAdjStatus = null;

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

    const [productsRes, adjRes] = await Promise.all([
        apiCall("getProducts", { search: "" }),
        apiCall("getInventoryAdjustments", { search: "" })
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

    /* ---------- CHART 2: Adjustments by Status (Doughnut) ---------- */

    const adjRows = adjRes.data || [];
    const seenAdjIDs = new Set();
    const statusCounts = {};

    adjRows.forEach(a => {
        const id = a.Adjustment_ID;
        if (seenAdjIDs.has(id)) return;
        seenAdjIDs.add(id);

        const status = a.StatusName || "Unknown";
        statusCounts[status] = (statusCounts[status] || 0) + 1;
    });

    const totalAdj = seenAdjIDs.size;

    const statusColorMap = {
        "Completed": "#0E9F6E",
        "Approved":  "#0E9F6E",
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

    if (chartAdjStatus) {
        chartAdjStatus.destroy();
        chartAdjStatus = null;
    }

    const ctx2 = document.getElementById("chart-adj-status");
    if (ctx2) {
        chartAdjStatus = new Chart(ctx2, {
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
                        value: totalAdj,
                        label: "TOTAL ADJ."
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

    const dashboardSection = document.getElementById("dashboard-section");
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
        if (chartAdjStatus) chartAdjStatus.resize();
    }, 150);
}

async function loadStatusesCache() {
    if (statusesCache.length > 0) return statusesCache;
    const res = await apiCall("getStatuses");
    if (res && res.success) statusesCache = res.data || [];
    return statusesCache;
}

/* ============================================================
   PRODUCTS  (✅ + Category filter)
============================================================ */

async function loadProducts() {
    const tbody = document.getElementById("products-tbody");
    if (!tbody) return;

    const search = (document.getElementById("search-products") || {}).value || "";
    const categoryID = (document.getElementById("filter-products-category") || {}).value || "";

    await ensureCategoriesCache();
    populateCategorySelectOnce("filter-products-category");

    tbody.innerHTML = `<tr><td colspan="6" class="empty-row">Loading…</td></tr>`;

    try {
        const res = await apiCall("getProducts", { search: search.trim() });
        if (!res || !res.success) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-row">${escapeHtml((res && res.message) || "Failed.")}</td></tr>`;
            setCount("products-count", 0);
            return;
        }

        productsCache = res.data || [];

        let rows = productsCache;
        if (categoryID) rows = rows.filter(p => String(p.CategoryID) === String(categoryID));

        setCount("products-count", rows.length);

        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-row">No products.</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(p => `
            <tr>
                <td>${escapeHtml(p.Barcode)}</td>
                <td>${escapeHtml(p.ProductName)}</td>
                <td>${escapeHtml(p.CategoryName || "—")}</td>
                <td>${escapeHtml(p.UnitName || "—")}</td>
                <td>${escapeHtml(p.BinCode || "—")}</td>
                <td>${escapeHtml(p.MinStockLevel)}</td>
            </tr>
        `).join("");
    } catch (err) {
        console.error("Products error:", err);
    }
}

function clearProductFilters() {
    const s = document.getElementById("search-products"); if (s) s.value = "";
    const c = document.getElementById("filter-products-category"); if (c) c.value = "";
    loadProducts();
}

async function loadCategories() {
    const tbody = document.getElementById("categories-tbody");
    if (!tbody) return;
    const search = (document.getElementById("search-categories") || {}).value || "";
    tbody.innerHTML = `<tr><td class="empty-row">Loading…</td></tr>`;

    try {
        const res = await apiCall("getCategories", { search: search.trim() });
        const rows = (res && res.success && res.data) || [];
        setCount("categories-count", rows.length);

        if (!rows.length) {
            tbody.innerHTML = `<tr><td class="empty-row">No categories.</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(c => `<tr><td>${escapeHtml(c.CategoryName)}</td></tr>`).join("");
    } catch (err) { console.error(err); }
}

function clearCategoryFilters() {
    const s = document.getElementById("search-categories"); if (s) s.value = "";
    loadCategories();
}

/* ============================================================
   SUPPLIERS  (✅ + "Product" filter)
   NOTE: getSuppliers itself has no product/category info, so
   filtering "by product" is done by asking, for every supplier
   currently in the list, whether that supplier has the selected
   product linked (via the same getSupplierProducts operation the
   Admin panel's "Manage Products" modal already uses, keyed by
   SupplierID). This assumes api_manager.php exposes
   getSupplierProducts the same way api.php does for Admin, and
   that its rows carry a ProductID (or Product_ID) field — if your
   backend names things differently, this filter will just show
   zero matches and the field name below is the first thing to check.
============================================================ */

async function loadSuppliers() {
    const tbody = document.getElementById("suppliers-tbody");
    if (!tbody) return;

    const search = (document.getElementById("search-suppliers") || {}).value || "";
    const productID = (document.getElementById("filter-suppliers-product") || {}).value || "";

    await ensureProductsCache();
    populateProductSelectOnce("filter-suppliers-product");

    tbody.innerHTML = `<tr><td colspan="5" class="empty-row">Loading…</td></tr>`;

    try {
        const res = await apiCall("getSuppliers", { search: search.trim() });
        let rows = (res && res.success && res.data) || [];

        if (productID) {
            tbody.innerHTML = `<tr><td colspan="5" class="empty-row">Filtering by product…</td></tr>`;
            rows = await filterSuppliersByProduct(rows, productID);
        }

        setCount("suppliers-count", rows.length);

        if (!rows.length) {
            tbody.innerHTML = `<tr><td colspan="5" class="empty-row">No suppliers.</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(s => `
            <tr>
                <td>${escapeHtml(s.SupplierName)}</td>
                <td>${escapeHtml(s.ContactPerson || "—")}</td>
                <td>${escapeHtml(s.Phone || "—")}</td>
                <td>${escapeHtml(s.Email || "—")}</td>
                <td>${escapeHtml(s.Address || "—")}</td>
            </tr>
        `).join("");
    } catch (err) { console.error(err); }
}

async function filterSuppliersByProduct(suppliers, productID) {
    const checks = await Promise.all(suppliers.map(async (s) => {
        try {
            const res = await apiCall("getSupplierProducts", { SupplierID: s.SupplierID });
            const lines = (res && res.success && res.data) || [];
            const matches = lines.some(l =>
                String(l.ProductID ?? l.Product_ID) === String(productID)
            );
            return matches ? s : null;
        } catch (e) {
            console.error("filterSuppliersByProduct error for supplier", s.SupplierID, e);
            return null;
        }
    }));
    return checks.filter(Boolean);
}

function clearSupplierFilters() {
    const s = document.getElementById("search-suppliers"); if (s) s.value = "";
    const p = document.getElementById("filter-suppliers-product"); if (p) p.value = "";
    loadSuppliers();
}

/* ============================================================
   AISLES / SHELVES / BINS  (✅ search + filters, same pattern
   as the Inventory Staff dashboard's Storage Location page)
============================================================ */

async function loadAisles() {
    const tbody = document.getElementById("aisles-tbody");
    if (!tbody) return;

    const search = (document.getElementById("search-aisles") || {}).value || "";
    tbody.innerHTML = `<tr><td class="empty-row">Loading…</td></tr>`;

    const res = await apiCall("getAisles", { search: search.trim() });
    const rows = (res && res.success && res.data) || [];
    setCount("aisles-count", rows.length);

    tbody.innerHTML = rows.length
        ? rows.map(a => `<tr><td>${escapeHtml(a.AisleCode)}</td></tr>`).join("")
        : `<tr><td class="empty-row">No aisles.</td></tr>`;
}

function clearAisleFilters() {
    const s = document.getElementById("search-aisles"); if (s) s.value = "";
    loadAisles();
}

async function loadShelves() {
    const tbody = document.getElementById("shelves-tbody");
    if (!tbody) return;

    const search  = (document.getElementById("search-shelves") || {}).value || "";
    const aisleID = (document.getElementById("filter-shelves-aisle") || {}).value || "";

    await ensureAislesCache();
    fillSelect("filter-shelves-aisle", aislesCache, "AisleID", "AisleCode", "All aisles");
    const aisleSel = document.getElementById("filter-shelves-aisle");
    if (aisleSel) aisleSel.value = aisleID;

    tbody.innerHTML = `<tr><td colspan="2" class="empty-row">Loading…</td></tr>`;

    const res = await apiCall("getShelves", { search: search.trim() });
    let rows = (res && res.success && res.data) || [];
    if (aisleID) rows = rows.filter(s => String(s.AisleID) === String(aisleID));

    setCount("shelves-count", rows.length);

    tbody.innerHTML = rows.length
        ? rows.map(s => `
            <tr>
                <td>${escapeHtml(s.AisleCode || "—")}</td>
                <td>${escapeHtml(s.ShelfCode)}</td>
            </tr>
        `).join("")
        : `<tr><td colspan="2" class="empty-row">No shelves.</td></tr>`;
}

function clearShelfFilters() {
    const s = document.getElementById("search-shelves"); if (s) s.value = "";
    const a = document.getElementById("filter-shelves-aisle"); if (a) a.value = "";
    loadShelves();
}

async function loadBins() {
    const tbody = document.getElementById("bins-tbody");
    if (!tbody) return;

    const search  = (document.getElementById("search-bins") || {}).value || "";
    const aisleID = (document.getElementById("filter-bins-aisle") || {}).value || "";
    const shelfID = (document.getElementById("filter-bins-shelf") || {}).value || "";

    await ensureAislesCache();
    await ensureShelvesCache();

    fillSelect("filter-bins-aisle", aislesCache, "AisleID", "AisleCode", "All aisles");
    const aisleSel = document.getElementById("filter-bins-aisle");
    if (aisleSel) aisleSel.value = aisleID;

    const shelfSel = document.getElementById("filter-bins-shelf");
    if (shelfSel) {
        shelfSel.innerHTML = `<option value="">All shelves</option>` +
            shelvesCache.map(s => `<option value="${s.ShelfID}">${escapeHtml((s.AisleCode || "") + " / " + (s.ShelfCode || ""))}</option>`).join("");
        shelfSel.value = shelfID;
    }

    tbody.innerHTML = `<tr><td colspan="3" class="empty-row">Loading…</td></tr>`;

    const res = await apiCall("getBins", { search: search.trim() });
    let rows = (res && res.success && res.data) || [];

    if (aisleID) {
        const aisleCode = (aislesCache.find(a => String(a.AisleID) === String(aisleID)) || {}).AisleCode;
        if (aisleCode) rows = rows.filter(b => String(b.AisleCode) === String(aisleCode));
    }
    if (shelfID) rows = rows.filter(b => String(b.ShelfID) === String(shelfID));

    setCount("bins-count", rows.length);

    tbody.innerHTML = rows.length
        ? rows.map(b => `
            <tr>
                <td>${escapeHtml(b.AisleCode || "—")}</td>
                <td>${escapeHtml(b.ShelfCode || "—")}</td>
                <td>${escapeHtml(b.BinCode)}</td>
            </tr>
        `).join("")
        : `<tr><td colspan="3" class="empty-row">No bins.</td></tr>`;
}

function clearBinFilters() {
    const s = document.getElementById("search-bins"); if (s) s.value = "";
    const a = document.getElementById("filter-bins-aisle"); if (a) a.value = "";
    const sh = document.getElementById("filter-bins-shelf"); if (sh) sh.value = "";
    loadBins();
}

/* ============================================================
   CURRENT STOCK  (✅ + Category filter)
============================================================ */

async function loadStock() {
    const tbody = document.getElementById("stock-tbody");
    if (!tbody) return;

    const search = (document.getElementById("search-stock") || {}).value || "";
    const categoryID = (document.getElementById("filter-stock-category") || {}).value || "";

    await ensureCategoriesCache();
    populateCategorySelectOnce("filter-stock-category");

    tbody.innerHTML = `<tr><td colspan="6" class="empty-row">Loading…</td></tr>`;

    try {
        const res = await apiCall("getInventoryQuantities", { search: search.trim() });
        let rows = (res && res.success && res.data) || [];

        if (categoryID) {
            const catName = categoryNameFromID(categoryID);
            if (catName) rows = rows.filter(r => String(r.CategoryName) === String(catName));
        }

        setCount("stock-count", rows.length);

        if (!rows.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-row">No stock data.</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(r => `
            <tr>
                <td>${escapeHtml(r.ProductName)}</td>
                <td>${escapeHtml(r.CategoryName || "—")}</td>
                <td>${escapeHtml(r.BinCode || "—")}</td>
                <td>${escapeHtml(r.UnitName || "—")}</td>
                <td>${escapeHtml(r.OnHandQuantity)}</td>
                <td>${escapeHtml(r.MinStockLevel)}</td>
            </tr>
        `).join("");
    } catch (err) { console.error(err); }
}

function clearStockFilters() {
    const s = document.getElementById("search-stock"); if (s) s.value = "";
    const c = document.getElementById("filter-stock-category"); if (c) c.value = "";
    loadStock();
}

/* ============================================================
   LOW STOCK  (✅ + Category filter)
============================================================ */

async function loadLowStock() {
    const tbody = document.getElementById("lowstock-tbody");
    if (!tbody) return;

    const search = (document.getElementById("search-lowstock") || {}).value || "";
    const categoryID = (document.getElementById("filter-lowstock-category") || {}).value || "";

    await ensureCategoriesCache();
    populateCategorySelectOnce("filter-lowstock-category");

    tbody.innerHTML = `<tr><td colspan="6" class="empty-row">Loading…</td></tr>`;

    try {
        const res = await apiCall("getLowStock");
        let rows = (res && res.success && res.data) || [];

        if (search.trim() !== "") {
            const s = search.toLowerCase();
            rows = rows.filter(r =>
                String(r.ProductName || "").toLowerCase().includes(s) ||
                String(r.Barcode || "").toLowerCase().includes(s)
            );
        }

        if (categoryID) {
            const catName = categoryNameFromID(categoryID);
            if (catName) rows = rows.filter(r => String(r.CategoryName) === String(catName));
        }

        setCount("lowstock-count", rows.length);

        if (!rows.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-row">No low stock.</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(r => {
            const onHand   = Number(r.OnHandQuantity ?? 0);
            const minStock = Number(r.MinStockLevel ?? 0);
            const shortage = minStock - onHand;

            return `
                <tr>
                    <td>${escapeHtml(r.ProductName)}</td>
                    <td>${escapeHtml(r.CategoryName || "—")}</td>
                    <td>${escapeHtml(r.BinCode || "—")}</td>
                    <td><strong>${escapeHtml(onHand)}</strong></td>
                    <td>${escapeHtml(minStock)}</td>
                    <td><span class="badge badge-red">${escapeHtml(shortage)}</span></td>
                </tr>
            `;
        }).join("");
    } catch (err) { console.error(err); }
}

function clearLowStockFilters() {
    const s = document.getElementById("search-lowstock"); if (s) s.value = "";
    const c = document.getElementById("filter-lowstock-category"); if (c) c.value = "";
    loadLowStock();
}

async function loadMovements() {
    const tbody = document.getElementById("movements-tbody");
    if (!tbody) return;

    const productID = (document.getElementById("filter-movements-product") || {}).value || "";
    const type      = (document.getElementById("filter-movements-type") || {}).value || "";
    const dateFrom  = (document.getElementById("filter-movements-from") || {}).value || "";
    const dateTo    = (document.getElementById("filter-movements-to") || {}).value || "";

    tbody.innerHTML = `<tr><td colspan="6" class="empty-row">Loading…</td></tr>`;

    try {
        const res = await apiCall("getInventoryMovements", {
            Product_ID: productID,
            MovementType: type,
            dateFrom, dateTo
        });

        const rows = (res && res.success && res.data) || [];
        setCount("movements-count", rows.length);

        if (!rows.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-row">No movements.</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(m => `
            <tr>
                <td>${fmtDate(m.MovementDate)}</td>
                <td>${escapeHtml(m.MovementType)}</td>
                <td>${escapeHtml(m.ProductName)}</td>
                <td>${escapeHtml(m.Quantity)}</td>
                <td>${escapeHtml(m.Reference || "—")}</td>
                <td>${escapeHtml(m.UserName || "—")}</td>
            </tr>
        `).join("");
    } catch (err) { console.error(err); }
}

function clearMovementFilters() {
    ["filter-movements-product","filter-movements-type","filter-movements-from","filter-movements-to"]
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
    loadMovements();
}

async function populateMovementProductFilter() {
    await ensureProductsCache();
    const sel = document.getElementById("filter-movements-product");
    if (sel) {
        sel.innerHTML = `<option value="">All products</option>` +
            productsCache.map(p => `<option value="${p.ProductID}">${escapeHtml(p.ProductName)}</option>`).join("");
    }
}

/* ============================================================
   DISCREPANCIES  (✅ + Category filter)
   Both tables lack a Category column, so the filter is applied
   client-side by looking up each row's ProductName against the
   Product → Category map built from productsCache (see
   buildProductCategoryLookup above).
============================================================ */

async function loadDiscrepancies() {
    const search = (document.getElementById("search-discrepancies") || {}).value || "";
    const categoryID = (document.getElementById("filter-discrepancies-category") || {}).value || "";

    await ensureCategoriesCache();
    populateCategorySelectOnce("filter-discrepancies-category");
    await ensureProductsCache();

    const catName = categoryID ? categoryNameFromID(categoryID) : "";
    const lookup = catName ? buildProductCategoryLookup() : null;

    const matchesCategory = (productName) => {
        if (!lookup) return true;
        const cat = lookup[String(productName || "").toLowerCase().trim()];
        return cat === catName;
    };

    const recvBody = document.getElementById("discrepancies-recv-tbody");
    if (recvBody) {
        recvBody.innerHTML = `<tr><td colspan="5" class="empty-row">Loading…</td></tr>`;
        try {
            const res = await apiCall("getReceivingDiscrepancies", { search: search.trim() });
            let rows = (res && res.success && res.data) || [];
            rows = rows.filter(r => matchesCategory(r.ProductName));

            if (!rows.length) {
                recvBody.innerHTML = `<tr><td colspan="5" class="empty-row">No discrepancies.</td></tr>`;
            } else {
                recvBody.innerHTML = rows.map(r => {
                    const v = Number(r.Variance ?? 0);
                    let cls = "badge-green";
                    let label = "Match";
                    if (v > 0) { cls = "badge-amber"; label = `+${v} Excess`; }
                    else if (v < 0) { cls = "badge-red"; label = `${v} Short`; }

                    return `
                        <tr>
                            <td>${escapeHtml(r.ReceivingID)}</td>
                            <td>${escapeHtml(r.ProductName)}</td>
                            <td>${escapeHtml(r.OrderedQty)}</td>
                            <td>${escapeHtml(r.ReceivedQty)}</td>
                            <td><span class="badge ${cls}">${label}</span></td>
                        </tr>
                    `;
                }).join("");
            }
        } catch (err) { console.error(err); }
    }

    const adjBody = document.getElementById("discrepancies-adj-tbody");
    if (adjBody) {
        adjBody.innerHTML = `<tr><td colspan="6" class="empty-row">Loading…</td></tr>`;
        try {
            const res = await apiCall("getAdjustmentDiscrepancies", { search: search.trim() });
            let rows = (res && res.success && res.data) || [];
            rows = rows.filter(a => matchesCategory(a.ProductName));

            if (!rows.length) {
                adjBody.innerHTML = `<tr><td colspan="6" class="empty-row">No discrepancies.</td></tr>`;
            } else {
                adjBody.innerHTML = rows.map(a => `
                    <tr>
                        <td>${fmtDate(a.Adjustment_Date)}</td>
                        <td>${escapeHtml(a.ProductName || "—")}</td>
                        <td>${escapeHtml(a.System_Quantity)}</td>
                        <td>${escapeHtml(a.Actual_Quantity)}</td>
                        <td><span class="badge badge-amber">${escapeHtml(a.Adjustment_Quantity)}</span></td>
                        <td>${escapeHtml(a.Adjustment_Type)}</td>
                    </tr>
                `).join("");
            }
        } catch (err) { console.error(err); }
    }
}

function clearDiscrepancyFilters() {
    const s = document.getElementById("search-discrepancies"); if (s) s.value = "";
    const c = document.getElementById("filter-discrepancies-category"); if (c) c.value = "";
    loadDiscrepancies();
}

async function loadAdjustments() {
    const tbody = document.getElementById("adjustments-tbody");
    if (!tbody) return;

    const search = (document.getElementById("search-adjustments") || {}).value || "";
    const statusID = (document.getElementById("filter-adjustments-status") || {}).value || "";

    await loadStatusesCache();

    const sel = document.getElementById("filter-adjustments-status");
    if (sel && sel.options.length <= 1) {
        sel.innerHTML = `<option value="">All statuses</option>` +
            statusesCache.map(s => `<option value="${s.StatusID}">${escapeHtml(s.StatusName)}</option>`).join("");
    }

    tbody.innerHTML = `<tr><td colspan="9" class="empty-row">Loading…</td></tr>`;

    try {
        const res = await apiCall("getInventoryAdjustments", { search: search.trim() });
        let rows = (res && res.success && res.data) || [];

        if (statusID) rows = rows.filter(a => String(a.Status_ID) === String(statusID));

        setCount("adjustments-count", rows.length);

        if (!rows.length) {
            tbody.innerHTML = `<tr><td colspan="9" class="empty-row">No adjustments.</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(a => {
            const statusName = String(a.StatusName || "").toLowerCase().trim();
            const isPending  = ["pending", "for review", "submitted", "draft", ""].includes(statusName);

            const adjQty = Number(a.Adjustment_Quantity ?? 0);
            const adjCell = adjQty === 0
                ? `<span class="badge badge-green">0 (match)</span>`
                : escapeHtml(adjQty);

            const actions = isPending
                ? `<button class="btn-icon" onclick="openReview('adjustment', ${a.Adjustment_ID})">Review</button>`
                : `<span class="field-hint">Locked</span>`;

            return `
                <tr>
                    <td>${fmtDate(a.Adjustment_Date)}</td>
                    <td>${escapeHtml(a.ProductName || "—")}</td>
                    <td>${escapeHtml(a.System_Quantity)}</td>
                    <td>${escapeHtml(a.Actual_Quantity)}</td>
                    <td>${adjCell}</td>
                    <td>${escapeHtml(a.Adjustment_Type)}</td>
                    <td>${statusBadge(a.StatusName)}</td>
                    <td>${escapeHtml(a.Reason || "—")}</td>
                    <td>${actions}</td>
                </tr>
            `;
        }).join("");
    } catch (err) { console.error(err); }
}

function clearAdjustmentFilters() {
    ["search-adjustments","filter-adjustments-status"].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = "";
    });
    loadAdjustments();
}

async function loadReturns() {
    const tbody = document.getElementById("returns-tbody");
    if (!tbody) return;

    const search = (document.getElementById("search-returns") || {}).value || "";
    const statusID = (document.getElementById("filter-returns-status") || {}).value || "";

    await loadStatusesCache();

    const sel = document.getElementById("filter-returns-status");
    if (sel && sel.options.length <= 1) {
        sel.innerHTML = `<option value="">All statuses</option>` +
            statusesCache.map(s => `<option value="${s.StatusID}">${escapeHtml(s.StatusName)}</option>`).join("");
    }

    tbody.innerHTML = `<tr><td colspan="7" class="empty-row">Loading…</td></tr>`;

    try {
        const res = await apiCall("getStockReturns", { search: search.trim() });
        let rows = (res && res.success && res.data) || [];
        if (statusID) rows = rows.filter(r => String(r.Status_ID) === String(statusID));

        setCount("returns-count", rows.length);

        if (!rows.length) {
            tbody.innerHTML = `<tr><td colspan="7" class="empty-row">No stock returns.</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(r => {
            const statusName = String(r.StatusName || "").toLowerCase().trim();
            const isPending  = ["pending", "for review", "submitted", "draft", ""].includes(statusName);

            const actions = isPending
                ? `<button class="btn-icon" onclick="openReview('return', ${r.Stock_Return_ID})">Review</button>`
                : `<span class="field-hint">Locked</span>`;

            return `
                <tr>
                    <td>${fmtDate(r.Return_Date)}</td>
                    <td>${escapeHtml(r.UserName || "—")}</td>
                    <td>${escapeHtml(r.ProductName || "—")}</td>
                    <td>${escapeHtml(r.Quantity)}</td>
                    <td>${statusBadge(r.StatusName)}</td>
                    <td>${escapeHtml(r.Reason || "—")}</td>
                    <td>${actions}</td>
                </tr>
            `;
        }).join("");
    } catch (err) { console.error(err); }
}

function clearReturnFilters() {
    ["search-returns","filter-returns-status"].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = "";
    });
    loadReturns();
}

/* ============================================================
   PURCHASE ORDERS  (✅ ID column removed, "View" action added)
   The View button opens the shared #details-modal-overlay via
   openPODetails(), which fetches the single PO plus its ordered
   product lines from a "getPurchaseOrder" backend operation.
============================================================ */

async function loadPurchaseOrders() {
    const tbody = document.getElementById("po-tbody");
    if (!tbody) return;
    const search = (document.getElementById("search-po") || {}).value || "";
    tbody.innerHTML = `<tr><td colspan="6" class="empty-row">Loading…</td></tr>`;

    try {
        const res = await apiCall("getPurchaseOrders", { search: search.trim() });
        const rows = (res && res.success && res.data) || [];
        setCount("po-count", rows.length);

        if (!rows.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-row">No purchase orders.</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(p => `
            <tr>
                <td>${escapeHtml(p.PO_Date)}</td>
                <td>${escapeHtml(p.Expected_Date)}</td>
                <td>${escapeHtml(p.SupplierName)}</td>
                <td>${escapeHtml(p.UserName)}</td>
                <td>${statusBadge(p.StatusName)}</td>
                <td><button class="btn-icon" onclick="openPODetails(${p.PO_ID})">View</button></td>
            </tr>
        `).join("");
    } catch (err) { console.error(err); }
}

function clearPOFilters() {
    const s = document.getElementById("search-po"); if (s) s.value = "";
    loadPurchaseOrders();
}

async function openPODetails(id) {
    const titleEl = document.getElementById("details-modal-title");
    const bodyEl  = document.getElementById("details-modal-body");
    if (!titleEl || !bodyEl) return;

    titleEl.textContent = `Purchase Order #${id}`;
    bodyEl.innerHTML = "Loading…";
    openModal("details-modal-overlay");

    try {
        const res = await apiCall("getPurchaseOrder", { PO_ID: id });

        if (!res || !res.success || !res.data) {
            bodyEl.innerHTML = `<p style="color:red;">${escapeHtml((res && res.message) || "Failed to load.")}</p>`;
            return;
        }

        const d = res.data;
        const lines = d.lines || [];

        const linesHtml = lines.map(l => `
            <tr>
                <td>${escapeHtml(l.ProductName || "—")}</td>
                <td style="text-align:right;">${escapeHtml(l.Quantity)}</td>
            </tr>
        `).join("");

        bodyEl.innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
                <div>
                    <strong>PO Date:</strong> ${fmtDate(d.PO_Date)}<br>
                    <strong>Expected:</strong> ${fmtDate(d.Expected_Date)}<br>
                    <strong>Status:</strong> ${statusBadge(d.StatusName)}
                </div>
                <div>
                    <strong>Supplier:</strong> ${escapeHtml(d.SupplierName || "—")}<br>
                    <strong>Requested By:</strong> ${escapeHtml(d.UserName || "—")}
                </div>
            </div>

            <hr>

            <h4 style="margin:12px 0;font-size:14px;">Products Ordered</h4>
            <table class="data-table">
                <thead>
                    <tr><th>Product</th><th style="text-align:right;">Qty</th></tr>
                </thead>
                <tbody>
                    ${linesHtml || `<tr><td colspan="2" class="empty-row">No lines</td></tr>`}
                </tbody>
            </table>
        `;
    } catch (err) {
        console.error("PO details error:", err);
        bodyEl.innerHTML = `<p style="color:red;">Failed to load details.</p>`;
    }
}

/* ============================================================
   RECEIVINGS  (✅ ID column removed, "View" action added)
   The View button opens the shared #details-modal-overlay via
   openReceivingDetails(), which now shows a merged Ordered vs
   Received comparison (see the function below for details).
============================================================ */

async function loadReceivings() {
    const tbody = document.getElementById("receivings-tbody");
    if (!tbody) return;
    const search = (document.getElementById("search-receivings") || {}).value || "";
    tbody.innerHTML = `<tr><td colspan="6" class="empty-row">Loading…</td></tr>`;

    try {
        const res = await apiCall("getReceivings", { search: search.trim() });
        const rows = (res && res.success && res.data) || [];
        setCount("receivings-count", rows.length);

        if (!rows.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-row">No receivings.</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(r => `
            <tr>
                <td>${escapeHtml(r.ReceivingDate)}</td>
                <td>${escapeHtml(r.SupplierName)}</td>
                <td>${escapeHtml(r.UserName)}</td>
                <td>${r.PO_Reference ? "PO-" + escapeHtml(r.PO_Reference) : "—"}</td>
                <td>${statusBadge(r.StatusName)}</td>
                <td><button class="btn-icon" onclick="openReceivingDetails(${r.ReceivingID})">View</button></td>
            </tr>
        `).join("");
    } catch (err) { console.error(err); }
}

function clearReceivingFilters() {
    const s = document.getElementById("search-receivings"); if (s) s.value = "";
    loadReceivings();
}

/* ============================================================
   ✅ FIXED — openReceivingDetails
   Now shows Ordered qty (from the linked PO) side-by-side with
   Received qty (actual), plus a variance badge, using the merged
   "lines" array returned by the fixed getReceiving backend op.
============================================================ */
async function openReceivingDetails(id) {
    const titleEl = document.getElementById("details-modal-title");
    const bodyEl  = document.getElementById("details-modal-body");
    if (!titleEl || !bodyEl) return;

    titleEl.textContent = `Receiving #${id}`;
    bodyEl.innerHTML = "Loading…";
    openModal("details-modal-overlay");

    try {
        const res = await apiCall("getReceiving", { ReceivingID: id });

        if (!res || !res.success || !res.data) {
            bodyEl.innerHTML = `<p style="color:red;">${escapeHtml((res && res.message) || "Failed to load.")}</p>`;
            return;
        }

        const d = res.data;
        const lines = d.lines || [];

        const linesHtml = lines.map(l => {
            const ordered  = Number(l.OrderedQuantity ?? 0);
            const received = Number(l.ReceivedQuantity ?? 0);
            const variance = Number(l.Variance ?? (received - ordered));

            let cls = "badge-green";
            let label = "Match";
            if (variance > 0) { cls = "badge-amber"; label = `+${variance} Excess`; }
            else if (variance < 0) { cls = "badge-red"; label = `${variance} Short`; }

            return `
                <tr>
                    <td>${escapeHtml(l.ProductName || "—")}</td>
                    <td style="text-align:right;">${escapeHtml(ordered)}</td>
                    <td style="text-align:right;">${escapeHtml(received)}</td>
                    <td style="text-align:center;"><span class="badge ${cls}">${label}</span></td>
                </tr>
            `;
        }).join("");

        bodyEl.innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
                <div>
                    <strong>Date:</strong> ${fmtDate(d.ReceivingDate)}<br>
                    <strong>Status:</strong> ${statusBadge(d.StatusName)}<br>
                    <strong>PO Ref:</strong> ${d.PO_Reference ? "PO-" + escapeHtml(d.PO_Reference) : "—"}
                </div>
                <div>
                    <strong>Supplier:</strong> ${escapeHtml(d.SupplierName || "—")}<br>
                    <strong>Received By:</strong> ${escapeHtml(d.UserName || "—")}
                </div>
            </div>

            <hr>

            <h4 style="margin:12px 0;font-size:14px;">Ordered vs Received</h4>
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Product</th>
                        <th style="text-align:right;">Ordered</th>
                        <th style="text-align:right;">Received</th>
                        <th style="text-align:center;">Variance</th>
                    </tr>
                </thead>
                <tbody>
                    ${linesHtml || `<tr><td colspan="4" class="empty-row">No lines</td></tr>`}
                </tbody>
            </table>
        `;
    } catch (err) {
        console.error("Receiving details error:", err);
        bodyEl.innerHTML = `<p style="color:red;">Failed to load details.</p>`;
    }
}

/* ============================================================
   PURCHASE RETURNS  (✅ ID column removed)
============================================================ */

async function loadPurchaseReturns() {
    const tbody = document.getElementById("prets-tbody");
    if (!tbody) return;
    const search = (document.getElementById("search-prets") || {}).value || "";
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row">Loading…</td></tr>`;

    try {
        const res = await apiCall("getPurchaseReturns", { search: search.trim() });
        const rows = (res && res.success && res.data) || [];
        setCount("prets-count", rows.length);

        if (!rows.length) {
            tbody.innerHTML = `<tr><td colspan="5" class="empty-row">No purchase returns.</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(r => `
            <tr>
                <td>${escapeHtml(r.Return_Date)}</td>
                <td>${escapeHtml(r.SupplierName)}</td>
                <td>${escapeHtml(r.ProductName || "—")}</td>
                <td>${escapeHtml(r.Quantity || "—")}</td>
                <td>${escapeHtml(r.Reason || "—")}</td>
            </tr>
        `).join("");
    } catch (err) { console.error(err); }
}

function clearPretFilters() {
    const s = document.getElementById("search-prets"); if (s) s.value = "";
    loadPurchaseReturns();
}

async function loadReports() {
    const stockBody = document.getElementById("reports-stock-tbody");
    if (stockBody) {
        stockBody.innerHTML = `<tr><td colspan="5" class="empty-row">Loading…</td></tr>`;
        try {
            const res = await apiCall("getInventoryQuantities");
            const rows = (res && res.success && res.data) || [];

            if (!rows.length) {
                stockBody.innerHTML = `<tr><td colspan="5" class="empty-row">No data.</td></tr>`;
            } else {
                stockBody.innerHTML = rows.map(r => {
                    const onHand = Number(r.OnHandQuantity ?? 0);
                    const min    = Number(r.MinStockLevel ?? 0);
                    const status = onHand < min
                        ? `<span class="badge badge-red">Low</span>`
                        : `<span class="badge badge-green">OK</span>`;

                    return `
                        <tr>
                            <td>${escapeHtml(r.ProductName)}</td>
                            <td>${escapeHtml(r.CategoryName || "—")}</td>
                            <td>${escapeHtml(onHand)}</td>
                            <td>${escapeHtml(min)}</td>
                            <td>${status}</td>
                        </tr>
                    `;
                }).join("");
            }
        } catch (err) { console.error(err); }
    }

    const txnBody = document.getElementById("reports-txn-tbody");
    if (txnBody) {
        txnBody.innerHTML = `<tr><td colspan="3" class="empty-row">Loading…</td></tr>`;
        try {
            const res = await apiCall("getTransactionSummary");
            const rows = (res && res.success && res.data) || [];

            if (!rows.length) {
                txnBody.innerHTML = `<tr><td colspan="3" class="empty-row">No data.</td></tr>`;
            } else {
                txnBody.innerHTML = rows.map(t => `
                    <tr>
                        <td>${escapeHtml(t.Type)}</td>
                        <td>${escapeHtml(t.Count)}</td>
                        <td>${escapeHtml(t.TotalQty)}</td>
                    </tr>
                `).join("");
            }
        } catch (err) { console.error(err); }
    }
}

async function loadAudit() {
    const tbody = document.getElementById("audit-tbody");
    if (!tbody) return;
    const search = (document.getElementById("search-audit") || {}).value || "";
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row">Loading…</td></tr>`;

    try {
        const res = await apiCall("getAuditLogs", { search: search.trim() });
        const rows = (res && res.success && res.data) || [];
        setCount("audit-count", rows.length);

        if (!rows.length) {
            tbody.innerHTML = `<tr><td colspan="5" class="empty-row">No audit records.</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(a => `
            <tr>
                <td>${fmtDate(a.ActionTimestamp)}</td>
                <td>${escapeHtml(a.UserName || "—")}</td>
                <td>${escapeHtml(a.ActionType)}</td>
                <td>${escapeHtml(a.TableAffected)}</td>
                <td>${escapeHtml(a.Details || "—")}</td>
            </tr>
        `).join("");
    } catch (err) { console.error(err); }
}

function clearAuditFilters() {
    const s = document.getElementById("search-audit"); if (s) s.value = "";
    loadAudit();
}

async function loadStaffActivity() {
    const tbody = document.getElementById("staff-tbody");
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="4" class="empty-row">Loading…</td></tr>`;

    try {
        const res = await apiCall("getStaffActivity");
        const rows = (res && res.success && res.data) || [];

        if (!rows.length) {
            tbody.innerHTML = `<tr><td colspan="4" class="empty-row">No staff activity.</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(s => `
            <tr>
                <td>${escapeHtml(s.UserName || "—")}</td>
                <td>${escapeHtml(s.RoleName || "—")}</td>
                <td>${escapeHtml(s.TotalActions)}</td>
                <td>${fmtDate(s.LastActivity)}</td>
            </tr>
        `).join("");
    } catch (err) { console.error(err); }
}

let currentReview = { type: null, id: null };

async function openReview(type, id) {
    currentReview = { type, id };

    const titleEl = document.getElementById("review-modal-title");
    const bodyEl  = document.getElementById("review-modal-body");

    titleEl.textContent = type === "adjustment"
        ? `Review Inventory Adjustment #${id}`
        : `Review Stock Return #${id}`;

    bodyEl.innerHTML = "Loading…";
    openModal("review-modal-overlay");

    try {
        const op = type === "adjustment" ? "getInventoryAdjustment" : "getStockReturn";
        const payload = type === "adjustment"
            ? { Adjustment_ID: id }
            : { Stock_Return_ID: id };

        const res = await apiCall(op, payload);

        if (!res || !res.success || !res.data) {
            bodyEl.innerHTML = `<p style="color:red;">${escapeHtml(res.message || "Failed to load.")}</p>`;
            return;
        }

        const d = res.data;
        const lines = d.lines || [];

        let linesHtml = "";

        if (type === "adjustment") {
            linesHtml = lines.map(l => `
                <tr>
                    <td>${escapeHtml(l.ProductName || "—")}</td>
                    <td style="text-align:right;">${escapeHtml(l.System_Quantity)}</td>
                    <td style="text-align:right;">${escapeHtml(l.Actual_Quantity)}</td>
                    <td style="text-align:right;">${escapeHtml(l.Adjustment_Quantity)}</td>
                    <td style="text-align:center;">${escapeHtml(l.Adjustment_Type)}</td>
                </tr>
            `).join("");
        } else {
            linesHtml = lines.map(l => `
                <tr>
                    <td>${escapeHtml(l.ProductName || "—")}</td>
                    <td style="text-align:right;">${escapeHtml(l.Quantity)}</td>
                </tr>
            `).join("");
        }

        bodyEl.innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
                <div>
                    <strong>Date:</strong> ${fmtDate(d.Adjustment_Date || d.Return_Date)}<br>
                    <strong>User:</strong> ${escapeHtml(d.UserName || "—")}<br>
                    <strong>Status:</strong> ${statusBadge(d.StatusName)}
                </div>
                <div>
                    <strong>Reason:</strong><br>
                    ${escapeHtml(d.Reason || "—")}
                </div>
            </div>

            <hr>

            <h4 style="margin:12px 0;font-size:14px;">Lines</h4>
            <table class="data-table">
                <thead>
                    ${type === "adjustment"
                        ? `<tr><th>Product</th><th style="text-align:right;">System</th><th style="text-align:right;">Actual</th><th style="text-align:right;">Adj</th><th style="text-align:center;">Type</th></tr>`
                        : `<tr><th>Product</th><th style="text-align:right;">Quantity</th></tr>`}
                </thead>
                <tbody>
                    ${linesHtml || `<tr><td colspan="5" class="empty-row">No lines</td></tr>`}
                </tbody>
            </table>
        `;

        const statusName = String(d.StatusName || "").toLowerCase().trim();
        const isPending  = ["pending", "for review", "submitted", "draft", ""].includes(statusName);

        const approveBtn = document.getElementById("btn-approve");
        const rejectBtn  = document.getElementById("btn-reject");

        approveBtn.disabled = !isPending;
        rejectBtn.disabled  = !isPending;

    } catch (err) {
        console.error("Review error:", err);
        bodyEl.innerHTML = `<p style="color:red;">Failed to load details.</p>`;
    }
}

async function approveCurrent() {
    if (!currentReview.type || !currentReview.id) return;

    const op = currentReview.type === "adjustment"
        ? "approveAdjustment"
        : "approveStockReturn";

    const payload = currentReview.type === "adjustment"
        ? { Adjustment_ID: currentReview.id }
        : { Stock_Return_ID: currentReview.id };

    try {
        const res = await apiCall(op, payload);
        if (res && res.success) {
            closeModal("review-modal-overlay");
            loadAdjustments();
            loadReturns();
            loadDashboard();
        } else {
            alert((res && res.message) || "Failed to approve.");
        }
    } catch (err) {
        console.error(err);
        alert("Failed to approve.");
    }
}

async function rejectCurrent() {
    if (!currentReview.type || !currentReview.id) return;

    const reason = prompt("Reason for rejection (optional):");
    if (reason === null) return;

    const op = currentReview.type === "adjustment"
        ? "rejectAdjustment"
        : "rejectStockReturn";

    const payload = currentReview.type === "adjustment"
        ? { Adjustment_ID: currentReview.id, Reason: reason }
        : { Stock_Return_ID: currentReview.id, Reason: reason };

    try {
        const res = await apiCall(op, payload);
        if (res && res.success) {
            closeModal("review-modal-overlay");
            loadAdjustments();
            loadReturns();
            loadDashboard();
        } else {
            alert((res && res.message) || "Failed to reject.");
        }
    } catch (err) {
        console.error(err);
        alert("Failed to reject.");
    }
}

async function logout() {
    try { await apiCall("logout"); } catch (err) { console.error("Logout error:", err); }
    localStorage.removeItem("user");
    window.location.replace("login.html");
}

function wireNavigation() {
    document.querySelectorAll(".nav-link").forEach(btn => {
        btn.addEventListener("click", () => {
            const sectionId = btn.getAttribute("data-section");
            const title     = (btn.querySelector(".nav-text") || btn).textContent.trim();
            setActiveSection(sectionId, title);

            if (sectionId === "dashboard-section")   loadDashboard();
            if (sectionId === "products-section")    loadProducts();
            if (sectionId === "categories-section")  loadCategories();
            if (sectionId === "suppliers-section")   loadSuppliers();
            if (sectionId === "locations-section")   { loadAisles(); loadShelves(); loadBins(); }
            if (sectionId === "stock-section")       loadStock();
            if (sectionId === "lowstock-section")    loadLowStock();
            if (sectionId === "movements-section")   { populateMovementProductFilter(); loadMovements(); }
            if (sectionId === "discrepancies-section") loadDiscrepancies();
            if (sectionId === "adjustments-section") loadAdjustments();
            if (sectionId === "returns-section")     loadReturns();
            if (sectionId === "po-section")          loadPurchaseOrders();
            if (sectionId === "receivings-section")  loadReceivings();
            if (sectionId === "prets-section")       loadPurchaseReturns();
            if (sectionId === "reports-section")     loadReports();
            if (sectionId === "audit-section")       loadAudit();
            if (sectionId === "staff-section")       loadStaffActivity();
        });
    });
}

function wireTabs() {
    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const tabId = btn.getAttribute("data-tab");
            document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active-tab"));
            btn.classList.add("active");
            const panel = document.getElementById(tabId);
            if (panel) panel.classList.add("active-tab");
        });
    });
}

function wireModals() {
    document.querySelectorAll("[data-close]").forEach(btn => {
        btn.addEventListener("click", () => closeModal(btn.getAttribute("data-close")));
    });

    const confirmYes = document.getElementById("btn-confirm-yes");
    if (confirmYes) {
        confirmYes.addEventListener("click", () => {
            closeModal("confirm-modal-overlay");
            if (typeof confirmCallback === "function") {
                const cb = confirmCallback;
                confirmCallback = null;
                cb();
            }
        });
    }

    const approveBtn = document.getElementById("btn-approve");
    if (approveBtn) approveBtn.addEventListener("click", approveCurrent);

    const rejectBtn = document.getElementById("btn-reject");
    if (rejectBtn) rejectBtn.addEventListener("click", rejectCurrent);
}

function wireSearchInputs() {
    const map = {
        "search-products":      loadProducts,
        "search-categories":    loadCategories,
        "search-suppliers":     loadSuppliers,
        "search-aisles":        loadAisles,
        "search-shelves":       loadShelves,
        "search-bins":          loadBins,
        "search-stock":         loadStock,
        "search-lowstock":      loadLowStock,
        "search-discrepancies": loadDiscrepancies,
        "search-adjustments":   loadAdjustments,
        "search-returns":       loadReturns,
        "search-po":            loadPurchaseOrders,
        "search-receivings":    loadReceivings,
        "search-prets":         loadPurchaseReturns,
        "search-audit":         loadAudit
    };

    Object.keys(map).forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        let timer = null;
        el.addEventListener("input", () => {
            clearTimeout(timer);
            timer = setTimeout(() => map[id](), 300);
        });
    });
}

function wireFilters() {
    const map = {
        "filter-products-category":     loadProducts,
        "filter-suppliers-product":     loadSuppliers,
        "filter-shelves-aisle":         loadShelves,
        "filter-bins-aisle":            loadBins,
        "filter-bins-shelf":            loadBins,
        "filter-stock-category":        loadStock,
        "filter-lowstock-category":     loadLowStock,
        "filter-discrepancies-category":loadDiscrepancies,
        "filter-movements-product":     loadMovements,
        "filter-movements-type":        loadMovements,
        "filter-movements-from":        loadMovements,
        "filter-movements-to":          loadMovements,
        "filter-adjustments-status":    loadAdjustments,
        "filter-returns-status":        loadReturns
    };

    Object.keys(map).forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener("change", map[id]);
    });
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
        const savedState = localStorage.getItem("managerSidebarCollapsed");
        if (savedState === "true") {
            sidebarEl.classList.add("collapsed");
            sidebarToggle.setAttribute("title", "Expand sidebar");
        }

        sidebarToggle.addEventListener("click", () => {
            sidebarEl.classList.toggle("collapsed");
            const isCollapsed = sidebarEl.classList.contains("collapsed");
            sidebarToggle.setAttribute("title", isCollapsed ? "Expand sidebar" : "Collapse sidebar");
            localStorage.setItem("managerSidebarCollapsed", isCollapsed ? "true" : "false");
            closeProfileMenu();

            handleDashboardResize();
            setTimeout(() => {
                if (chartProductsCategory) chartProductsCategory.resize();
                if (chartAdjStatus) chartAdjStatus.resize();
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
    askConfirm("Are you sure you want to log out?", () => logout());
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

document.addEventListener("DOMContentLoaded", () => {
    if (!loadSession()) return;

    wireNavigation();
    wireTabs();
    wireModals();
    wireSearchInputs();
    wireFilters();
    wireSidebarToggle();
    wireProfileMenu();

    loadDashboard();
    loadStatusesCache().catch(err => console.error(err));
});