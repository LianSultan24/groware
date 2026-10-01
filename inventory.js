const baseApiUrl = "http://localhost/grocery_warehouse/api_inventory.php";

let currentUser     = null;
let productsCache   = [];
let statusesCache   = [];
let categoriesCache = [];
let aislesCache     = [];
let shelvesCache    = [];
let unitsCache      = [];
let confirmCallback = null;


/* ============================================================
   SESSION
============================================================ */

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
        const allowed = ["inventory staff", "inventory", "inventory officer", "stock clerk"];

        if (!allowed.includes(role)) {
            if (role === "admin" || role === "administrator") {
                window.location.replace("admin.html");
            } else {
                localStorage.removeItem("user");
                window.location.replace("login.html");
            }
            return false;
        }

        const name = ((currentUser.FirstName || "") + " " + (currentUser.LastName || "")).trim();
        const displayName = name || currentUser.UserName;

        const topbarName = document.getElementById("topbar-username");
        if (topbarName) topbarName.textContent = "Welcome, " + displayName;

        const profileName = document.getElementById("sidebar-profile-name");
        if (profileName) profileName.textContent = displayName;

        const profileRole = document.getElementById("sidebar-profile-role");
        if (profileRole) profileRole.textContent = currentUser.RoleName || "Inventory Staff";

        const profileAvatar = document.getElementById("sidebar-profile-avatar");
        if (profileAvatar) {
            profileAvatar.textContent = displayName.trim().charAt(0).toUpperCase() || "I";
        }

        return true;
    } catch (err) {
        console.error("Session error:", err);
        window.location.replace("login.html");
        return false;
    }
}


/* ============================================================
   API
============================================================ */

async function apiCall(operation, payload = {}) {
    const body = Object.assign(
        { operation, LoggedInUserID: currentUser ? currentUser.UserID : 0 },
        payload
    );

    try {
        const res = await axios.post(baseApiUrl, body, {
            headers: { "Content-Type": "application/json" }
        });
        return res.data;
    } catch (err) {
        console.error("API error:", err);
        return {
            success: false,
            message: err?.response?.data?.message || "Unable to connect to the server.",
            data: []
        };
    }
}


/* ============================================================
   SIDEBAR (mobile drawer)
============================================================ */

function openSidebar() {
    const sidebar  = document.getElementById("sidebar");
    const backdrop = document.getElementById("sidebar-backdrop");
    if (sidebar)  sidebar.classList.add("sidebar-open");
    if (backdrop) backdrop.classList.add("open");
}

function closeSidebar() {
    const sidebar  = document.getElementById("sidebar");
    const backdrop = document.getElementById("sidebar-backdrop");
    if (sidebar)  sidebar.classList.remove("sidebar-open");
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


/* ============================================================
   ✅ SIDEBAR COLLAPSE (desktop icon-only rail)
   Same behavior as admin.html: state is remembered in
   localStorage, and the floating toggle button lives half
   outside the sidebar, vertically centered on the icon list.
============================================================ */

function wireSidebarCollapse() {
    const sidebarToggle = document.getElementById("sidebar-toggle");
    const sidebarEl = document.getElementById("sidebar");
    if (!sidebarToggle || !sidebarEl) return;

    const savedState = localStorage.getItem("inventorySidebarCollapsed");
    if (savedState === "true") {
        sidebarEl.classList.add("collapsed");
        sidebarToggle.setAttribute("title", "Expand sidebar");
    }

    sidebarToggle.addEventListener("click", () => {
        sidebarEl.classList.toggle("collapsed");

        const isCollapsed = sidebarEl.classList.contains("collapsed");
        sidebarToggle.setAttribute(
            "title",
            isCollapsed ? "Expand sidebar" : "Collapse sidebar"
        );

        localStorage.setItem("inventorySidebarCollapsed", isCollapsed ? "true" : "false");
        closeProfileMenu();

        // Chart.js canvases need an explicit resize once the
        // sidebar's width transition finishes.
        setTimeout(() => {
            if (chartProductsCategory) chartProductsCategory.resize();
            if (chartLowStockSeverity) chartLowStockSeverity.resize();
        }, 280);
    });
}


/* ============================================================
   ✅ SIDEBAR PROFILE MENU (Log Out)
   Opens on hover (desktop, handled purely in CSS) and on
   click/tap or keyboard (handled here so touch and
   keyboard/screen-reader users can reach it too). "Log Out"
   itself never logs out directly — it opens the shared confirm
   modal first, and only calls logout() if the staff confirms.
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
    askConfirm("Are you sure you want to log out?", () => {
        logout();
    });
}

function wireSidebarProfile() {
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
        if (profileEl && !profileEl.contains(e.target)) {
            closeProfileMenu();
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeProfileMenu();
    });
}


/* ============================================================
   HELPERS
============================================================ */

function setActiveSection(sectionId, title) {
    document.querySelectorAll(".page-section").forEach(s => s.classList.remove("active-section"));
    const target = document.getElementById(sectionId);
    if (target) target.classList.add("active-section");

    document.querySelectorAll(".nav-link").forEach(b => b.classList.remove("active"));
    const btn = document.querySelector(`.nav-link[data-section="${sectionId}"]`);
    if (btn) btn.classList.add("active");

    const titleEl = document.getElementById("page-title");
    if (titleEl) titleEl.textContent = title;
}

/* ✅ Lets dashboard stat cards and chart panels act as shortcuts —
   clicking "Total Products" jumps straight to Products, the
   "Products by Category" chart jumps to Categories, etc. Reuses
   setActiveSection() via the nav-link's own click handler so the
   section-load side effects (loadProducts(), loadCategories(), …)
   still run exactly as they do from the sidebar. */
function goToSection(sectionId) {
    const navBtn = document.querySelector(`.nav-link[data-section="${sectionId}"]`);
    if (navBtn) {
        navBtn.click();
    } else {
        setActiveSection(sectionId, sectionId);
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

function fillSelect(id, rows, valueKey, labelKey) {
    const sel = document.getElementById(id);
    if (!sel) return;

    const opts = rows
        .map(r => `<option value="${r[valueKey]}">${escapeHtml(r[labelKey])}</option>`)
        .join("");

    sel.innerHTML = `<option value="">All</option>` + opts;
}


/* ============================================================
   ✅ DASHBOARD CHARTS
   Same doughnut-center-text approach as admin.js: draw the
   "total" text directly on the canvas, centered on
   chart.chartArea, so it lines up with the ring regardless of
   legend size/position or window resizing.
============================================================ */

let chartProductsCategory = null;
let chartLowStockSeverity = null;

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
        ctx.font = pluginOptions.valueFont ||
            "800 24px system-ui, -apple-system, sans-serif";
        ctx.fillText(
            String(pluginOptions.value ?? ""),
            centerX,
            centerY - 10
        );

        ctx.fillStyle = pluginOptions.labelColor || "#166534";
        ctx.font = pluginOptions.labelFont ||
            "700 10px system-ui, -apple-system, sans-serif";
        ctx.fillText(
            pluginOptions.label || "",
            centerX,
            centerY + 12
        );

        ctx.restore();
    }
};

async function loadDashboardCharts(totalProducts) {

    if (typeof Chart === "undefined") {
        console.warn("Chart.js not loaded — skipping charts.");
        return;
    }

    const [productsRes, lowStockRes] = await Promise.all([
        apiCall("getProducts", { search: "" }),
        apiCall("getLowStock")
    ]);

    /* ---------- CHART 1: Products by Category (Bar) ---------- */

    const products = (productsRes.data || []).filter(p => p.IsArchived !== "Yes");

    const categoryCounts = {};
    products.forEach(p => {
        const cat = p.CategoryName || "Uncategorized";
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });

    const sortedCategories = Object.entries(categoryCounts)
        .sort((a, b) => b[1] - a[1]);

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
                    backgroundColor: "#16A34A",
                    hoverBackgroundColor: "#12331F",
                    borderRadius: 8,
                    borderSkipped: false,
                    maxBarThickness: 48
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
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
                        ticks: {
                            precision: 0,
                            color: "#166534",
                            font: { size: 11, weight: "600" }
                        },
                        grid: {
                            color: "rgba(166, 221, 187, 0.5)",
                            drawBorder: false
                        }
                    },
                    x: {
                        ticks: {
                            color: "#166534",
                            font: { size: 11, weight: "600" }
                        },
                        grid: { display: false }
                    }
                }
            }
        });
    }

    /* ---------- CHART 2: Low Stock Severity (Doughnut) ---------- */

    const lowStock = lowStockRes.data || [];
    const criticalCount = lowStock.filter(r => Number(r.OnHandQuantity) === 0).length;
    const lowCount = lowStock.length - criticalCount;
    const okCount = Math.max(0, Number(totalProducts || 0) - lowStock.length);

    if (chartLowStockSeverity) {
        chartLowStockSeverity.destroy();
        chartLowStockSeverity = null;
    }

    const ctx2 = document.getElementById("chart-lowstock-severity");
    if (ctx2) {
        chartLowStockSeverity = new Chart(ctx2, {
            type: "doughnut",
            data: {
                labels: ["OK", "Low", "Critical"],
                datasets: [{
                    data: [okCount, lowCount, criticalCount],
                    backgroundColor: ["#16A34A", "#F59E0B", "#DC2626"],
                    borderColor: "#FFFFFF",
                    borderWidth: 3,
                    hoverOffset: 6
                }]
            },
            plugins: [doughnutCenterTextPlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: "68%",
                layout: { padding: 0 },
                plugins: {
                    legend: {
                        position: "right",
                        labels: {
                            boxWidth: 10,
                            boxHeight: 10,
                            usePointStyle: true,
                            pointStyle: "circle",
                            padding: 12,
                            color: "#052E16",
                            font: { size: 11, weight: "600" },
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
                                const pct = total > 0
                                    ? Math.round((ctx.parsed / total) * 100)
                                    : 0;
                                return `${ctx.label}: ${ctx.parsed} (${pct}%)`;
                            }
                        }
                    },
                    doughnutCenterText: {
                        enabled: true,
                        value: totalProducts ?? 0,
                        label: "PRODUCTS"
                    }
                }
            }
        });
    }

    window.removeEventListener("resize", handleDashboardChartsResize);
    window.addEventListener("resize", handleDashboardChartsResize);
    wireChartResizeObserver();
}

let dashboardChartsResizeTimer = null;

function handleDashboardChartsResize() {
    if (dashboardChartsResizeTimer) clearTimeout(dashboardChartsResizeTimer);
    dashboardChartsResizeTimer = setTimeout(() => {
        if (chartProductsCategory) chartProductsCategory.resize();
        if (chartLowStockSeverity) chartLowStockSeverity.resize();
    }, 200);
}

/* ✅ RESPONSIVE FIX — window "resize" only fires for the browser
   window itself. The chart containers can also change size without
   the window changing (sidebar collapse/expand, the grid re-flowing,
   a device rotating while the window stays the same size), and
   Chart.js won't know to redraw unless something tells it to. A
   ResizeObserver watches the actual container elements, so charts
   stay correctly sized no matter what caused the resize. */
let chartResizeObserver = null;

function wireChartResizeObserver() {
    if (typeof ResizeObserver === "undefined") return;

    if (chartResizeObserver) {
        chartResizeObserver.disconnect();
        chartResizeObserver = null;
    }

    chartResizeObserver = new ResizeObserver(() => {
        handleDashboardChartsResize();
    });

    document.querySelectorAll(".chart-container").forEach(el => {
        chartResizeObserver.observe(el);
    });
}


/* ============================================================
   DASHBOARD
============================================================ */

async function loadDashboard() {
    try {
        const res = await apiCall("getInventoryDashboard");

        if (!res || !res.success) {
            console.warn("Dashboard:", res ? res.message : "no response");
            return;
        }

        const d = res.data || {};

        const setText = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };

        setText("stat-products",    d.totalProducts ?? 0);
        setText("stat-categories",  d.totalCategories ?? 0);
        setText("stat-locations",   `${d.totalAisles ?? 0} / ${d.totalShelves ?? 0} / ${d.totalBins ?? 0}`);
        setText("stat-pending-adj", d.pendingAdjustments ?? 0);
        setText("stat-pending-ret", d.pendingReturns ?? 0);

        const lowBody = document.getElementById("dashboard-lowstock");
        if (lowBody) {
            if (!d.lowStockWatchlist || d.lowStockWatchlist.length === 0) {
                lowBody.innerHTML = `<tr><td colspan="2" class="empty-row">No products.</td></tr>`;
            } else {
                lowBody.innerHTML = d.lowStockWatchlist.map(p => `
                    <tr>
                        <td>${escapeHtml(p.ProductName)}</td>
                        <td>${escapeHtml(p.MinStockLevel)}</td>
                    </tr>
                `).join("");
            }
        }

        const adjBody = document.getElementById("dashboard-adjustments");
        if (adjBody) {
            if (!d.recentAdjustments || d.recentAdjustments.length === 0) {
                adjBody.innerHTML = `<tr><td colspan="3" class="empty-row">No recent activity.</td></tr>`;
            } else {
                adjBody.innerHTML = d.recentAdjustments.map(a => {
                    const product = (a.ProductNames && String(a.ProductNames).trim() !== "")
                        ? escapeHtml(a.ProductNames)
                        : "—";

                    return `
                        <tr>
                            <td>${fmtDate(a.Adjustment_Date)}</td>
                            <td>${product}</td>
                            <td>${statusBadge(a.StatusName)}</td>
                        </tr>
                    `;
                }).join("");
            }
        }

        await loadDashboardCharts(d.totalProducts);
    } catch (err) {
        console.error("Dashboard error:", err);
    }
}


/* ============================================================
   FILTER CACHES
============================================================ */

async function loadFilterCaches() {
    const tasks = [
        (async () => {
            if (categoriesCache.length > 0) return;
            try {
                const res = await apiCall("getCategories");
                if (res && res.success) categoriesCache = res.data || [];
            } catch (e) { console.error("Categories cache error:", e); }
        })(),
        (async () => {
            if (aislesCache.length > 0) return;
            try {
                const res = await apiCall("getAisles");
                if (res && res.success) aislesCache = res.data || [];
            } catch (e) { console.error("Aisles cache error:", e); }
        })(),
        (async () => {
            if (shelvesCache.length > 0) return;
            try {
                const res = await apiCall("getShelves");
                if (res && res.success) shelvesCache = res.data || [];
            } catch (e) { console.error("Shelves cache error:", e); }
        })(),
        (async () => {
            if (statusesCache.length > 0) return;
            try {
                const res = await apiCall("getStatuses");
                if (res && res.success) statusesCache = res.data || [];
            } catch (e) { console.error("Statuses cache error:", e); }
        })(),
        (async () => {
            if (unitsCache.length > 0) return;
            try {
                const res = await apiCall("getUnitsOfMeasure");
                if (res && res.success) unitsCache = res.data || [];
            } catch (e) { console.error("Units cache error:", e); }
        })()
    ];

    await Promise.all(tasks);

    fillSelect("filter-products-category", categoriesCache, "CategoryID", "CategoryName");
    fillSelect("filter-stock-category",    categoriesCache, "CategoryID", "CategoryName");
    fillSelect("filter-lowstock-category", categoriesCache, "CategoryID", "CategoryName");
    fillSelect("filter-shelves-aisle",     aislesCache,     "AisleID",    "AisleCode");
    fillSelect("filter-bins-aisle",        aislesCache,     "AisleID",    "AisleCode");

    const unitSel = document.getElementById("filter-products-unit");
    if (unitSel) {
        unitSel.innerHTML = `<option value="">All units</option>` +
            unitsCache.map(u => `<option value="${u.UnitOfMeasureID}">${escapeHtml(u.UnitName)}</option>`).join("");
    }

    const shelfSel = document.getElementById("filter-bins-shelf");
    if (shelfSel) {
        shelfSel.innerHTML = `<option value="">All shelves</option>` +
            shelvesCache.map(s => `<option value="${s.ShelfID}">${escapeHtml((s.AisleCode || "") + " / " + (s.ShelfCode || ""))}</option>`).join("");
    }

    const adjStatusSel = document.getElementById("filter-adjustments-status");
    if (adjStatusSel) {
        adjStatusSel.innerHTML = `<option value="">All statuses</option>` +
            statusesCache.map(s => `<option value="${s.StatusID}">${escapeHtml(s.StatusName)}</option>`).join("");
    }

    const retStatusSel = document.getElementById("filter-returns-status");
    if (retStatusSel) {
        retStatusSel.innerHTML = `<option value="">All statuses</option>` +
            statusesCache.map(s => `<option value="${s.StatusID}">${escapeHtml(s.StatusName)}</option>`).join("");
    }
}


/* ============================================================
   PRODUCTS
============================================================ */

async function loadProducts() {
    const tbody = document.getElementById("products-tbody");
    if (!tbody) return;

    const search = (document.getElementById("search-products") || {}).value || "";
    const categoryID = (document.getElementById("filter-products-category") || {}).value || "";
    const unitID = (document.getElementById("filter-products-unit") || {}).value || "";

    tbody.innerHTML = `<tr><td colspan="6" class="empty-row">Loading…</td></tr>`;

    try {
        const res = await apiCall("getProducts", { search: search.trim() });

        if (!res || !res.success) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-row">${escapeHtml((res && res.message) || "Failed to load.")}</td></tr>`;
            setCount("products-count", 0);
            return;
        }

        productsCache = res.data || [];

        let rows = productsCache;
        if (categoryID) rows = rows.filter(p => String(p.CategoryID) === String(categoryID));
        if (unitID)     rows = rows.filter(p => String(p.UnitOfMeasureID) === String(unitID));

        setCount("products-count", rows.length);

        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-row">No products found.</td></tr>`;
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
        tbody.innerHTML = `<tr><td colspan="6" class="empty-row">Failed to load products.</td></tr>`;
    }
}

function clearProductFilters() {
    const s = document.getElementById("search-products"); if (s) s.value = "";
    const c = document.getElementById("filter-products-category"); if (c) c.value = "";
    const u = document.getElementById("filter-products-unit"); if (u) u.value = "";
    loadProducts();
}


/* ============================================================
   CATEGORIES
============================================================ */

async function loadCategories() {
    const tbody = document.getElementById("categories-tbody");
    if (!tbody) return;

    const search = (document.getElementById("search-categories") || {}).value || "";
    tbody.innerHTML = `<tr><td class="empty-row">Loading…</td></tr>`;

    try {
        const res = await apiCall("getCategories", { search: search.trim() });

        if (!res || !res.success) {
            tbody.innerHTML = `<tr><td class="empty-row">${escapeHtml((res && res.message) || "Failed to load.")}</td></tr>`;
            setCount("categories-count", 0);
            return;
        }

        const rows = res.data || [];
        setCount("categories-count", rows.length);

        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td class="empty-row">No categories.</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(c => `
            <tr><td>${escapeHtml(c.CategoryName)}</td></tr>
        `).join("");
    } catch (err) {
        console.error("Categories error:", err);
        tbody.innerHTML = `<tr><td class="empty-row">Failed to load categories.</td></tr>`;
    }
}

function clearCategoryFilters() {
    const s = document.getElementById("search-categories"); if (s) s.value = "";
    loadCategories();
}


/* ============================================================
   AISLES
============================================================ */

async function loadAisles() {
    const tbody = document.getElementById("aisles-tbody");
    if (!tbody) return;

    const search = (document.getElementById("search-aisles") || {}).value || "";
    tbody.innerHTML = `<tr><td class="empty-row">Loading…</td></tr>`;

    try {
        const res = await apiCall("getAisles", { search: search.trim() });
        if (!res || !res.success) {
            tbody.innerHTML = `<tr><td class="empty-row">Failed.</td></tr>`;
            setCount("aisles-count", 0);
            return;
        }

        const rows = res.data || [];
        setCount("aisles-count", rows.length);

        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td class="empty-row">No aisles.</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(a => `
            <tr><td>${escapeHtml(a.AisleCode)}</td></tr>
        `).join("");
    } catch (err) { console.error("Aisles error:", err); }
}

function clearAisleFilters() {
    const s = document.getElementById("search-aisles"); if (s) s.value = "";
    loadAisles();
}


/* ============================================================
   SHELVES
============================================================ */

async function loadShelves() {
    const tbody = document.getElementById("shelves-tbody");
    if (!tbody) return;

    const search = (document.getElementById("search-shelves") || {}).value || "";
    const aisleID = (document.getElementById("filter-shelves-aisle") || {}).value || "";

    tbody.innerHTML = `<tr><td colspan="2" class="empty-row">Loading…</td></tr>`;

    try {
        const res = await apiCall("getShelves", { search: search.trim() });
        if (!res || !res.success) {
            tbody.innerHTML = `<tr><td colspan="2" class="empty-row">Failed.</td></tr>`;
            setCount("shelves-count", 0);
            return;
        }

        let rows = res.data || [];
        if (aisleID) rows = rows.filter(s => String(s.AisleID) === String(aisleID));

        setCount("shelves-count", rows.length);

        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="2" class="empty-row">No shelves.</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(s => `
            <tr>
                <td>${escapeHtml(s.AisleCode || "—")}</td>
                <td>${escapeHtml(s.ShelfCode)}</td>
            </tr>
        `).join("");
    } catch (err) { console.error("Shelves error:", err); }
}

function clearShelfFilters() {
    const s = document.getElementById("search-shelves"); if (s) s.value = "";
    const a = document.getElementById("filter-shelves-aisle"); if (a) a.value = "";
    loadShelves();
}


/* ============================================================
   BINS
============================================================ */

async function loadBins() {
    const tbody = document.getElementById("bins-tbody");
    if (!tbody) return;

    const search = (document.getElementById("search-bins") || {}).value || "";
    const aisleID = (document.getElementById("filter-bins-aisle") || {}).value || "";
    const shelfID = (document.getElementById("filter-bins-shelf") || {}).value || "";

    tbody.innerHTML = `<tr><td colspan="3" class="empty-row">Loading…</td></tr>`;

    try {
        const res = await apiCall("getBins", { search: search.trim() });
        if (!res || !res.success) {
            tbody.innerHTML = `<tr><td colspan="3" class="empty-row">Failed.</td></tr>`;
            setCount("bins-count", 0);
            return;
        }

        let rows = res.data || [];

        if (aisleID) {
            const aisleCode = (aislesCache.find(a => String(a.AisleID) === String(aisleID)) || {}).AisleCode;
            if (aisleCode) rows = rows.filter(b => String(b.AisleCode) === String(aisleCode));
        }

        if (shelfID) rows = rows.filter(b => String(b.ShelfID) === String(shelfID));

        setCount("bins-count", rows.length);

        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" class="empty-row">No bins.</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(b => `
            <tr>
                <td>${escapeHtml(b.AisleCode || "—")}</td>
                <td>${escapeHtml(b.ShelfCode || "—")}</td>
                <td>${escapeHtml(b.BinCode)}</td>
            </tr>
        `).join("");
    } catch (err) { console.error("Bins error:", err); }
}

function clearBinFilters() {
    const s = document.getElementById("search-bins"); if (s) s.value = "";
    const a = document.getElementById("filter-bins-aisle"); if (a) a.value = "";
    const sh = document.getElementById("filter-bins-shelf"); if (sh) sh.value = "";
    loadBins();
}


/* ============================================================
   STOCK
============================================================ */

async function loadStock() {
    const tbody = document.getElementById("stock-tbody");
    if (!tbody) return;

    const search = (document.getElementById("search-stock") || {}).value || "";
    const categoryID = (document.getElementById("filter-stock-category") || {}).value || "";
    const level = (document.getElementById("filter-stock-level") || {}).value || "";

    tbody.innerHTML = `<tr><td colspan="6" class="empty-row">Loading…</td></tr>`;

    try {
        const res = await apiCall("getInventoryQuantities", { search: search.trim() });
        if (!res || !res.success) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-row">Failed.</td></tr>`;
            setCount("stock-count", 0);
            return;
        }

        let rows = res.data || [];

        if (categoryID) {
            const catName = (categoriesCache.find(c => String(c.CategoryID) === String(categoryID)) || {}).CategoryName;
            if (catName) rows = rows.filter(r => String(r.CategoryName) === String(catName));
        }

        if (level === "low") {
            rows = rows.filter(r => Number(r.OnHandQuantity) < Number(r.MinStockLevel));
        } else if (level === "ok") {
            rows = rows.filter(r => Number(r.OnHandQuantity) >= Number(r.MinStockLevel));
        }

        setCount("stock-count", rows.length);

        if (rows.length === 0) {
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
    } catch (err) {
        console.error("Stock error:", err);
        tbody.innerHTML = `<tr><td colspan="6" class="empty-row">Failed to load stock.</td></tr>`;
    }
}

function clearStockFilters() {
    const s = document.getElementById("search-stock"); if (s) s.value = "";
    const c = document.getElementById("filter-stock-category"); if (c) c.value = "";
    const l = document.getElementById("filter-stock-level"); if (l) l.value = "";
    loadStock();
}


/* ============================================================
   LOW STOCK
============================================================ */

async function loadLowStock() {
    const tbody = document.getElementById("lowstock-tbody");
    if (!tbody) return;

    const search = (document.getElementById("search-lowstock") || {}).value || "";
    const categoryID = (document.getElementById("filter-lowstock-category") || {}).value || "";
    const severity = (document.getElementById("filter-lowstock-severity") || {}).value || "";

    tbody.innerHTML = `<tr><td colspan="6" class="empty-row">Loading…</td></tr>`;

    try {
        const res = await apiCall("getLowStock");
        if (!res || !res.success) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-row">Failed.</td></tr>`;
            setCount("lowstock-count", 0);
            return;
        }

        let rows = res.data || [];

        if (search.trim() !== "") {
            const s = search.toLowerCase();
            rows = rows.filter(r =>
                String(r.ProductName || "").toLowerCase().includes(s) ||
                String(r.Barcode || "").toLowerCase().includes(s)
            );
        }

        if (categoryID) {
            const catName = (categoriesCache.find(c => String(c.CategoryID) === String(categoryID)) || {}).CategoryName;
            if (catName) rows = rows.filter(r => String(r.CategoryName) === String(catName));
        }

        if (severity === "critical") {
            rows = rows.filter(r => Number(r.OnHandQuantity) === 0);
        } else if (severity === "low") {
            rows = rows.filter(r => Number(r.OnHandQuantity) > 0);
        }

        setCount("lowstock-count", rows.length);

        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-row">No products below minimum stock.</td></tr>`;
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
    } catch (err) {
        console.error("Low stock error:", err);
        tbody.innerHTML = `<tr><td colspan="6" class="empty-row">Failed to load low stock.</td></tr>`;
    }
}

function clearLowStockFilters() {
    const s = document.getElementById("search-lowstock"); if (s) s.value = "";
    const c = document.getElementById("filter-lowstock-category"); if (c) c.value = "";
    const sv = document.getElementById("filter-lowstock-severity"); if (sv) sv.value = "";
    loadLowStock();
}


/* ============================================================
   STATUSES / PRODUCTS CACHE
============================================================ */

async function loadStatusesForDropdowns() {
    if (statusesCache.length === 0) {
        try {
            const res = await apiCall("getStatuses");
            if (res && res.success) statusesCache = res.data || [];
        } catch (e) { console.error(e); }
    }

    const adjStatus = document.getElementById("adj-status");
    const retStatus = document.getElementById("ret-status");

    const options = statusesCache.map(s =>
        `<option value="${s.StatusID}">${escapeHtml(s.StatusName)}</option>`
    ).join("");

    if (adjStatus) adjStatus.innerHTML = options;
    if (retStatus) retStatus.innerHTML = options;

    const pending = statusesCache.find(s =>
        String(s.StatusName).toLowerCase().trim() === "pending"
    );
    if (pending) {
        if (adjStatus) adjStatus.value = pending.StatusID;
        if (retStatus) retStatus.value = pending.StatusID;
    }
}

async function ensureProductsCache() {
    if (productsCache.length > 0) return;
    try {
        const res = await apiCall("getProducts");
        if (res && res.success) productsCache = res.data || [];
    } catch (e) { console.error(e); }
}


/* ============================================================
   ADJUSTMENT PREVIEW
============================================================ */

function updateAdjustmentPreview() {
    const systemEl = document.getElementById("adj-system");
    const actualEl = document.getElementById("adj-actual");
    const preview  = document.getElementById("adj-preview");

    if (!systemEl || !actualEl || !preview) return;

    const sys = parseInt(systemEl.value, 10) || 0;
    const act = parseInt(actualEl.value, 10) || 0;
    const diff = act - sys;
    const absDiff = Math.abs(diff);

    let text = "";
    let cls = "";

    if (diff === 0) {
        text = "✓ No discrepancy — System matches Actual";
        cls = "adj-preview-ok";
    } else if (diff > 0) {
        text = `↑ Increase of ${absDiff}`;
        cls = "adj-preview-increase";
    } else {
        text = `↓ Decrease of ${absDiff}`;
        cls = "adj-preview-decrease";
    }

    preview.textContent = text;
    preview.className = "adj-preview " + cls;

    const typeEl = document.getElementById("adj-type");
    if (typeEl) {
        if (diff > 0) typeEl.value = "Increase";
        else if (diff < 0) typeEl.value = "Decrease";
    }
}


/* ============================================================
   INVENTORY ADJUSTMENTS
============================================================ */

async function loadAdjustments() {
    const tbody = document.getElementById("adjustments-tbody");
    if (!tbody) return;

    const search = (document.getElementById("search-adjustments") || {}).value || "";
    const statusID = (document.getElementById("filter-adjustments-status") || {}).value || "";
    const typeFilter = (document.getElementById("filter-adjustments-type") || {}).value || "";
    const dateFrom = (document.getElementById("filter-adjustments-from") || {}).value || "";
    const dateTo = (document.getElementById("filter-adjustments-to") || {}).value || "";

    tbody.innerHTML = `<tr><td colspan="9" class="empty-row">Loading…</td></tr>`;

    try {
        const res = await apiCall("getInventoryAdjustments", { search: search.trim() });
        if (!res || !res.success) {
            tbody.innerHTML = `<tr><td colspan="9" class="empty-row">Failed.</td></tr>`;
            setCount("adjustments-count", 0);
            return;
        }

        let rows = res.data || [];

        if (statusID) rows = rows.filter(a => String(a.Status_ID) === String(statusID));
        if (typeFilter) rows = rows.filter(a => String(a.Adjustment_Type) === typeFilter);

        if (dateFrom) {
            const from = new Date(dateFrom);
            rows = rows.filter(a => new Date(a.Adjustment_Date) >= from);
        }
        if (dateTo) {
            const to = new Date(dateTo);
            to.setHours(23, 59, 59);
            rows = rows.filter(a => new Date(a.Adjustment_Date) <= to);
        }

        setCount("adjustments-count", rows.length);

        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" class="empty-row">No adjustments found.</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(a => {
            const statusName = String(a.StatusName || "").toLowerCase().trim();
            const isPending  = ["pending", "for review", "draft", ""].includes(statusName);

            const adjQty = Number(a.Adjustment_Quantity ?? 0);
            const adjCell = adjQty === 0
                ? `<span class="badge badge-green">0 (match)</span>`
                : escapeHtml(adjQty);

            const actions = isPending ? `
                <button class="btn-icon" onclick="editAdjustment(${a.Adjustment_ID})">Edit</button>
                <button class="btn-icon btn-icon-danger"
                        onclick="cancelAdjustment(${a.Adjustment_ID})">Cancel</button>
            ` : `<span class="field-hint">Locked</span>`;

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
    } catch (err) {
        console.error("Adjustments error:", err);
        tbody.innerHTML = `<tr><td colspan="9" class="empty-row">Failed to load adjustments.</td></tr>`;
    }
}

function clearAdjustmentFilters() {
    ["search-adjustments", "filter-adjustments-status", "filter-adjustments-type",
     "filter-adjustments-from", "filter-adjustments-to"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
    loadAdjustments();
}

async function openAdjustmentModal(mode, adjustmentID = null) {
    await ensureProductsCache();
    await loadStatusesForDropdowns();

    const productSelect = document.getElementById("adj-product");
    if (productSelect) {
        productSelect.innerHTML = productsCache.map(p =>
            `<option value="${p.ProductID}">${escapeHtml(p.ProductName)}</option>`
        ).join("");

        productSelect.addEventListener("change", async () => {
            const productID = productSelect.value;
            if (!productID) {
                document.getElementById("adj-system").value = "0";
                updateAdjustmentPreview();
                return;
            }

            try {
                const res = await apiCall("getProductStock", { Product_ID: productID });
                if (res && res.success && res.data) {
                    const onHand = Number(res.data.OnHandQuantity || 0);
                    document.getElementById("adj-system").value = onHand;
                    updateAdjustmentPreview();
                }
            } catch (err) {
                console.error("Fetch stock error:", err);
            }
        });
    }

    const titleEl = document.getElementById("adjustment-modal-title");
    if (titleEl) {
        titleEl.textContent = mode === "edit" ? "Edit Inventory Adjustment" : "New Inventory Adjustment";
    }

    document.getElementById("adj-id").value     = "";
    document.getElementById("adj-system").value = "0";
    document.getElementById("adj-actual").value = "0";
    document.getElementById("adj-type").value   = "Increase";
    document.getElementById("adj-reason").value = "";

    const pending = statusesCache.find(s =>
        String(s.StatusName).toLowerCase().trim() === "pending"
    );
    if (pending) {
        const adjStatus = document.getElementById("adj-status");
        if (adjStatus) adjStatus.value = pending.StatusID;
    }

    if (mode === "edit" && adjustmentID) {
        try {
            const res = await apiCall("getInventoryAdjustment", { Adjustment_ID: adjustmentID });
            if (res && res.success && res.data) {
                const a = res.data;
                const line = (a.lines && a.lines[0]) ? a.lines[0] : null;

                document.getElementById("adj-id").value     = a.Adjustment_ID;
                document.getElementById("adj-reason").value = a.Reason || "";
                if (a.Status_ID) document.getElementById("adj-status").value = a.Status_ID;

                if (line) {
                    if (line.Product_ID && productSelect) productSelect.value = line.Product_ID;
                    document.getElementById("adj-system").value = line.System_Quantity;
                    document.getElementById("adj-actual").value = line.Actual_Quantity;
                    document.getElementById("adj-type").value   = line.Adjustment_Type;
                }
            }
        } catch (err) { console.error("Load adjustment error:", err); }
    } else {
        if (productSelect && productSelect.value) {
            productSelect.dispatchEvent(new Event("change"));
        }
    }

    updateAdjustmentPreview();
    openModal("adjustment-modal-overlay");
}

async function saveAdjustment() {
    const id = document.getElementById("adj-id").value;
    const payload = {
        Product_ID:      parseInt(document.getElementById("adj-product").value, 10),
        System_Quantity: parseInt(document.getElementById("adj-system").value, 10) || 0,
        Actual_Quantity: parseInt(document.getElementById("adj-actual").value, 10) || 0,
        Adjustment_Type: document.getElementById("adj-type").value,
        Reason:          document.getElementById("adj-reason").value.trim(),
        Status_ID:       parseInt(document.getElementById("adj-status").value, 10) || 0
    };

    if (!payload.Product_ID) { alert("Please select a product."); return; }
    if (!payload.Reason)     { alert("Reason is required."); return; }

    if (payload.System_Quantity === payload.Actual_Quantity) {
        const proceed = confirm(
            "Walay discrepancy (System = Actual).\n\n" +
            "I-record gihapon ni as verification?\n\n" +
            "Click OK to submit, Cancel to edit."
        );
        if (!proceed) return;
    }

    try {
        let res;
        if (id) {
            payload.Adjustment_ID = parseInt(id, 10);
            res = await apiCall("updateInventoryAdjustment", payload);
        } else {
            res = await apiCall("insertInventoryAdjustment", payload);
        }

        if (res && res.success) {
            closeModal("adjustment-modal-overlay");
            loadAdjustments();
            loadDashboard();
        } else {
            alert((res && res.message) || "Failed to save adjustment.");
        }
    } catch (err) {
        console.error("Save adjustment error:", err);
        alert("Failed to save adjustment.");
    }
}

function editAdjustment(id) { openAdjustmentModal("edit", id); }

function cancelAdjustment(id) {
    askConfirm("Cancel this inventory adjustment? It will be archived.", async () => {
        try {
            const res = await apiCall("deleteInventoryAdjustment", { Adjustment_ID: id });
            if (res && res.success) { loadAdjustments(); loadDashboard(); }
            else alert((res && res.message) || "Failed.");
        } catch (err) {
            console.error(err);
            alert("Failed to cancel adjustment.");
        }
    });
}


/* ============================================================
   STOCK RETURNS
============================================================ */

async function loadReturns() {
    const tbody = document.getElementById("returns-tbody");
    if (!tbody) return;

    const search = (document.getElementById("search-returns") || {}).value || "";
    const statusID = (document.getElementById("filter-returns-status") || {}).value || "";
    const dateFrom = (document.getElementById("filter-returns-from") || {}).value || "";
    const dateTo = (document.getElementById("filter-returns-to") || {}).value || "";

    tbody.innerHTML = `<tr><td colspan="7" class="empty-row">Loading…</td></tr>`;

    try {
        const res = await apiCall("getStockReturns", { search: search.trim() });
        if (!res || !res.success) {
            tbody.innerHTML = `<tr><td colspan="7" class="empty-row">Failed.</td></tr>`;
            setCount("returns-count", 0);
            return;
        }

        let rows = res.data || [];

        if (statusID) rows = rows.filter(r => String(r.Status_ID) === String(statusID));

        if (dateFrom) {
            const from = new Date(dateFrom);
            rows = rows.filter(r => new Date(r.Return_Date) >= from);
        }
        if (dateTo) {
            const to = new Date(dateTo);
            to.setHours(23, 59, 59);
            rows = rows.filter(r => new Date(r.Return_Date) <= to);
        }

        setCount("returns-count", rows.length);

        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="empty-row">No stock returns found.</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(r => {
            const statusName = String(r.StatusName || "").toLowerCase().trim();
            const isPending  = ["pending", "for review", "draft", ""].includes(statusName);

            const actions = isPending ? `
                <button class="btn-icon" onclick="editReturn(${r.Stock_Return_ID})">Edit</button>
                <button class="btn-icon btn-icon-danger"
                        onclick="cancelReturn(${r.Stock_Return_ID})">Cancel</button>
            ` : `<span class="field-hint">Locked</span>`;

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
    } catch (err) {
        console.error("Returns error:", err);
        tbody.innerHTML = `<tr><td colspan="7" class="empty-row">Failed to load returns.</td></tr>`;
    }
}

function clearReturnFilters() {
    ["search-returns", "filter-returns-status", "filter-returns-from", "filter-returns-to"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
    loadReturns();
}

async function openReturnModal(mode, returnID = null) {
    await ensureProductsCache();
    await loadStatusesForDropdowns();

    const productSelect = document.getElementById("ret-product");
    if (productSelect) {
        productSelect.innerHTML = productsCache.map(p =>
            `<option value="${p.ProductID}">${escapeHtml(p.ProductName)}</option>`
        ).join("");
    }

    const titleEl = document.getElementById("return-modal-title");
    if (titleEl) {
        titleEl.textContent = mode === "edit" ? "Edit Stock Return" : "New Stock Return";
    }

    document.getElementById("ret-id").value       = "";
    document.getElementById("ret-quantity").value = "1";
    document.getElementById("ret-reason").value   = "";

    const pending = statusesCache.find(s =>
        String(s.StatusName).toLowerCase().trim() === "pending"
    );
    if (pending) {
        const retStatus = document.getElementById("ret-status");
        if (retStatus) retStatus.value = pending.StatusID;
    }

    if (mode === "edit" && returnID) {
        try {
            const res = await apiCall("getStockReturn", { Stock_Return_ID: returnID });
            if (res && res.success && res.data) {
                const r = res.data;
                const line = (r.lines && r.lines[0]) ? r.lines[0] : null;

                document.getElementById("ret-id").value     = r.Stock_Return_ID;
                document.getElementById("ret-reason").value = r.Reason || "";
                if (r.Status_ID) document.getElementById("ret-status").value = r.Status_ID;

                if (line) {
                    if (line.Product_ID && productSelect) productSelect.value = line.Product_ID;
                    document.getElementById("ret-quantity").value = line.Quantity;
                }
            }
        } catch (err) { console.error("Load return error:", err); }
    }

    openModal("return-modal-overlay");
}

async function saveReturn() {
    const id = document.getElementById("ret-id").value;
    const payload = {
        Product_ID: parseInt(document.getElementById("ret-product").value, 10),
        Quantity:   parseInt(document.getElementById("ret-quantity").value, 10) || 0,
        Reason:     document.getElementById("ret-reason").value.trim(),
        Status_ID:  parseInt(document.getElementById("ret-status").value, 10) || 0
    };

    if (!payload.Product_ID) { alert("Product is required."); return; }
    if (payload.Quantity <= 0) { alert("Quantity must be greater than 0."); return; }
    if (!payload.Reason)     { alert("Reason is required."); return; }

    try {
        let res;
        if (id) {
            payload.Stock_Return_ID = parseInt(id, 10);
            res = await apiCall("updateStockReturn", payload);
        } else {
            res = await apiCall("insertStockReturn", payload);
        }

        if (res && res.success) {
            closeModal("return-modal-overlay");
            loadReturns();
            loadDashboard();
        } else {
            alert((res && res.message) || "Failed to save stock return.");
        }
    } catch (err) {
        console.error("Save return error:", err);
        alert("Failed to save stock return.");
    }
}

function editReturn(id) { openReturnModal("edit", id); }

function cancelReturn(id) {
    askConfirm("Cancel this stock return? It will be archived.", async () => {
        try {
            const res = await apiCall("deleteStockReturn", { Stock_Return_ID: id });
            if (res && res.success) { loadReturns(); loadDashboard(); }
            else alert((res && res.message) || "Failed.");
        } catch (err) {
            console.error(err);
            alert("Failed to cancel stock return.");
        }
    });
}


/* ============================================================
   LOGOUT
============================================================ */

async function logout() {
    try { await apiCall("logout"); } catch (err) { console.error("Logout error:", err); }
    localStorage.removeItem("user");
    window.location.replace("login.html");
}


/* ============================================================
   WIRING
============================================================ */

function wireNavigation() {
    document.querySelectorAll(".nav-link").forEach(btn => {
        btn.addEventListener("click", () => {
            const sectionId = btn.getAttribute("data-section");
            const title     = (btn.querySelector(".nav-text") || btn).textContent.trim();
            setActiveSection(sectionId, title);

            closeSidebar();

            if (sectionId === "dashboard-section")   loadDashboard();
            if (sectionId === "products-section")    loadProducts();
            if (sectionId === "categories-section")  loadCategories();
            if (sectionId === "locations-section")   { loadAisles(); loadShelves(); loadBins(); }
            if (sectionId === "stock-section")       loadStock();
            if (sectionId === "lowstock-section")    loadLowStock();
            if (sectionId === "adjustments-section") loadAdjustments();
            if (sectionId === "returns-section")     loadReturns();
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

    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        document.querySelectorAll(".modal-overlay.open").forEach(m => {
            m.classList.remove("open");
        });
    });
}

function wireSearchInputs() {
    const map = {
        "search-products":    loadProducts,
        "search-categories":  loadCategories,
        "search-aisles":      loadAisles,
        "search-shelves":     loadShelves,
        "search-bins":        loadBins,
        "search-stock":       loadStock,
        "search-lowstock":    loadLowStock,
        "search-adjustments": loadAdjustments,
        "search-returns":     loadReturns
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
        "filter-products-unit":         loadProducts,
        "filter-shelves-aisle":         loadShelves,
        "filter-bins-aisle":            loadBins,
        "filter-bins-shelf":            loadBins,
        "filter-stock-category":        loadStock,
        "filter-stock-level":           loadStock,
        "filter-lowstock-category":     loadLowStock,
        "filter-lowstock-severity":     loadLowStock,
        "filter-adjustments-status":    loadAdjustments,
        "filter-adjustments-type":      loadAdjustments,
        "filter-adjustments-from":      loadAdjustments,
        "filter-adjustments-to":        loadAdjustments,
        "filter-returns-status":        loadReturns,
        "filter-returns-from":          loadReturns,
        "filter-returns-to":            loadReturns
    };

    Object.keys(map).forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener("change", map[id]);
    });
}

function wireButtons() {
    const addAdjBtn = document.getElementById("btn-add-adjustment");
    if (addAdjBtn) addAdjBtn.addEventListener("click", () => openAdjustmentModal("add"));

    const saveAdjBtn = document.getElementById("btn-save-adjustment");
    if (saveAdjBtn) saveAdjBtn.addEventListener("click", saveAdjustment);

    const addRetBtn = document.getElementById("btn-add-return");
    if (addRetBtn) addRetBtn.addEventListener("click", () => openReturnModal("add"));

    const saveRetBtn = document.getElementById("btn-save-return");
    if (saveRetBtn) saveRetBtn.addEventListener("click", saveReturn);

    const sysInput = document.getElementById("adj-system");
    const actInput = document.getElementById("adj-actual");
    if (sysInput) sysInput.addEventListener("input", updateAdjustmentPreview);
    if (actInput) actInput.addEventListener("input", updateAdjustmentPreview);

    const hamburger = document.getElementById("hamburger-btn");
    if (hamburger) {
        hamburger.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleSidebar();
        });
    }

    const backdrop = document.getElementById("sidebar-backdrop");
    if (backdrop) {
        backdrop.addEventListener("click", closeSidebar);
    }
}


/* ============================================================
   INIT
============================================================ */

document.addEventListener("DOMContentLoaded", () => {
    if (!loadSession()) return;

    wireNavigation();
    wireTabs();
    wireModals();
    wireSearchInputs();
    wireFilters();
    wireButtons();
    wireSidebarCollapse();
    wireSidebarProfile();

    loadDashboard();
    loadFilterCaches().catch(err => console.error("Filter caches error:", err));
});