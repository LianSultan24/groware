const baseApiUrl = "http://localhost/grocery_warehouse/receiving_api.php";

const getStoredUser = () => {
    const raw = localStorage.getItem("user");
    try {
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
};

const currentUser = getStoredUser();

if (!currentUser) {
    window.location.href = "login.html";
}

const callApi = async (operation, payload = {}) => {

    const user = getStoredUser();

    const body = {
        ...payload,
        LoggedInUserID: user ? user.UserID : null
    };

    const formData = new FormData();
    formData.append("operation", operation);
    formData.append("json", JSON.stringify(body));

    try {
        const res = await axios({
            url: baseApiUrl,
            method: "POST",
            data: formData
        });
        return res.data;
    } catch (error) {
        console.error("API ERROR:", error);
        return {
            success: false,
            message:
                error?.response?.data?.message ||
                "Unable to connect to the server.",
            data: []
        };
    }
};

let STATUSES_CACHE = [];
let SUPPLIERS_CACHE = [];

const esc = (value) => {
    if (value === null || value === undefined) return "";
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
};

const statusBadge = (val) => {
    const map = {
        Active: "badge-green",
        Inactive: "badge-gray",
        Pending: "badge-amber",
        Approved: "badge-green",
        Completed: "badge-green",
        Cancelled: "badge-gray",
        Rejected: "badge-red",
        Draft: "badge-gray",
        Received: "badge-green"
    };
    return `<span class="badge ${map[val] || "badge-gray"}">${esc(val ?? "-")}</span>`;
};

const varianceBadge = (variance) => {
    const v = Number(variance);
    if (v === 0) return `<span class="badge badge-green">Match</span>`;
    if (v > 0) return `<span class="badge badge-amber">+${v} Excess</span>`;
    return `<span class="badge badge-red">${v} Short</span>`;
};

const emptyRow = (colspan, message) =>
    `<tr><td colspan="${colspan}" class="empty-row">${esc(message)}</td></tr>`;

const loadingRow = (colspan) =>
    `<tr><td colspan="${colspan}" class="empty-row">Loading...</td></tr>`;

const logout = async () => {
    await callApi("logout");
    localStorage.removeItem("user");
    window.location.href = "login.html";
};

/* ============================================================
   SECTION SWITCHING
============================================================ */

const sectionTitles = {
    "section-dashboard": "Dashboard",
    "section-product": "Products",
    "section-supplier": "Suppliers",
    "section-storage-location": "Storage Location",
    "section-expected-po": "Expected Purchase Orders",
    "section-receivings": "Receiving Records"
};

function switchSection(targetId) {

    document.querySelectorAll(".page-section").forEach(el =>
        el.classList.remove("active-section")
    );

    const target = document.getElementById(targetId);
    if (!target) return;

    target.classList.add("active-section");

    document.querySelectorAll(".nav-link").forEach(el =>
        el.classList.remove("active")
    );

    const nav = document.querySelector(`.nav-link[data-target="${targetId}"]`);
    if (nav) nav.classList.add("active");

    const title = document.getElementById("page-title");
    if (title) title.textContent = sectionTitles[targetId] || "";

    closeSidebar();

    if (targetId === "section-dashboard") {
        loadDashboard();
        requestAnimationFrame(() => handleDashboardResize());
    }
    else if (targetId === "section-product") loadProducts();
    else if (targetId === "section-supplier") loadSuppliers();
    else if (targetId === "section-storage-location") loadStorageLocationTables();
    else if (targetId === "section-expected-po") loadExpectedPOs();
    else if (targetId === "section-receivings") loadReceivings();
}

/* Dashboard cards / chart panels act as shortcuts */
function goToSection(targetId) {

    const nav = document.querySelector(`.nav-link[data-target="${targetId}"]`);

    if (nav) {
        nav.click();
    } else {
        switchSection(targetId);
    }
}

function openOverlay(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add("open");
}

function closeOverlay(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove("open");
}

/* ============================================================
   DASHBOARD
============================================================ */

let chartRecvStatus = null;
let chartProductsCategory = null;

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

        ctx.fillStyle = "#052E16";
        ctx.font = "800 26px system-ui, -apple-system, sans-serif";
        ctx.fillText(String(pluginOptions.value ?? ""), centerX, centerY - 11);

        ctx.fillStyle = "#166534";
        ctx.font = "700 11px system-ui, -apple-system, sans-serif";
        ctx.fillText(pluginOptions.label || "", centerX, centerY + 13);

        ctx.restore();
    }
};

async function loadDashboard() {

    const res = await callApi("getReceivingDashboardStats");

    if (!res.success) {
        console.error(res.message);
        return;
    }

    const s = res.data || {};

    const setText = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    setText("stat-expected", s.expectedDeliveries ?? 0);
    setText("stat-today", s.receivingsToday ?? 0);
    setText("stat-pending", s.pendingReceivings ?? 0);
    setText("stat-products", s.totalProducts ?? 0);
    setText("stat-suppliers", SUPPLIERS_CACHE.length);

    const poBody = document.getElementById("tbl-dashboard-po");

    if (poBody) {
        poBody.innerHTML = (s.expectedPOs || []).map(r => `
            <tr>
                <td>#${esc(r.PO_ID)}</td>
                <td>${esc(r.SupplierName)}</td>
                <td>${esc(r.Expected_Date || "—")}</td>
                <td>${statusBadge(r.StatusName)}</td>
            </tr>
        `).join("") || emptyRow(4, "No expected deliveries.");
    }

    await loadDashboardCharts();
}

async function loadDashboardCharts() {

    const [recvRes, prodRes] = await Promise.all([
        callApi("getReceivings", {}),
        callApi("getProductsForReceiving", { search: "" })
    ]);

    const receivings = recvRes.data || [];
    const products = prodRes.data || [];

    /* ---------- Latest receivings table ---------- */

    const recentBody = document.getElementById("tbl-dashboard-recv");

    if (recentBody) {
        recentBody.innerHTML = receivings.slice(0, 8).map(r => `
            <tr>
                <td>#${esc(r.ReceivingID)}</td>
                <td>${esc(r.SupplierName)}</td>
                <td>${esc(r.ReceivingDate)}</td>
                <td>${statusBadge(r.StatusName)}</td>
            </tr>
        `).join("") || emptyRow(4, "No receivings yet.");
    }

    if (typeof Chart === "undefined") {
        console.warn("Chart.js not loaded — skipping charts.");
        return;
    }

    /* ---------- CHART 1: Receivings by Status (Doughnut) ---------- */

    const statusCounts = {};
    receivings.forEach(r => {
        const name = r.StatusName || "Unknown";
        statusCounts[name] = (statusCounts[name] || 0) + 1;
    });

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

    if (chartRecvStatus) {
        chartRecvStatus.destroy();
        chartRecvStatus = null;
    }

    const ctx1 = document.getElementById("chart-recv-status");

    if (ctx1) {
        chartRecvStatus = new Chart(ctx1, {
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
                plugins: {
                    legend: {
                        position: (c) => c.chart.width < 340 ? "bottom" : "right",
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
                                return data.labels.map((label, i) => ({
                                    text: `${label}    ${data.datasets[0].data[i]}`,
                                    fillStyle: data.datasets[0].backgroundColor[i],
                                    strokeStyle: data.datasets[0].backgroundColor[i],
                                    lineWidth: 0,
                                    hidden: false,
                                    index: i
                                }));
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
                            label: (c) => {
                                const total = c.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = total > 0 ? Math.round((c.parsed / total) * 100) : 0;
                                return `${c.label}: ${c.parsed} (${pct}%)`;
                            }
                        }
                    },
                    doughnutCenterText: {
                        enabled: true,
                        value: receivings.length,
                        label: "TOTAL RECEIVINGS"
                    }
                }
            }
        });
    }

    /* ---------- CHART 2: Products by Category (Bar) ---------- */

    const categoryCounts = {};
    products.forEach(p => {
        const cat = p.CategoryName || "Uncategorized";
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });

    const sorted = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 6);

    const subtitle = document.getElementById("chartCategorySubtitle");
    if (subtitle) {
        subtitle.textContent = `Top ${top.length} of ${sorted.length} categories`;
    }

    if (chartProductsCategory) {
        chartProductsCategory.destroy();
        chartProductsCategory = null;
    }

    const ctx2 = document.getElementById("chart-products-category");

    if (ctx2) {
        chartProductsCategory = new Chart(ctx2, {
            type: "bar",
            data: {
                labels: top.map(([name]) => name),
                datasets: [{
                    label: "Products",
                    data: top.map(([, count]) => count),
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
                            label: (c) => `${c.parsed.y} product${c.parsed.y === 1 ? "" : "s"}`
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

    const section = document.getElementById("section-dashboard");
    if (!section) return;

    dashboardResizeObserver = new ResizeObserver(() => handleDashboardResize());
    dashboardResizeObserver.observe(section);
}

function handleDashboardResize() {

    if (dashboardResizeTimer) clearTimeout(dashboardResizeTimer);

    dashboardResizeTimer = setTimeout(() => {
        if (chartRecvStatus) chartRecvStatus.resize();
        if (chartProductsCategory) chartProductsCategory.resize();
    }, 150);
}

/* ============================================================
   REFERENCE LISTS
============================================================ */

async function loadProducts(search = "") {

    const tbody = document.getElementById("tbl-product");
    tbody.innerHTML = loadingRow(5);

    const res = await callApi("getProductsForReceiving", { search });

    if (!res.success) {
        tbody.innerHTML = emptyRow(5, res.message);
        return;
    }

    tbody.innerHTML = (res.data || []).map(r => `
        <tr>
            <td>${esc(r.ProductName)}</td>
            <td>${esc(r.Barcode)}</td>
            <td>${esc(r.CategoryName)}</td>
            <td>${esc(r.UnitSymbol || r.UnitName)}</td>
            <td>
                ${r.AisleCode
                    ? `${esc(r.AisleCode)} / ${esc(r.ShelfCode)} / ${esc(r.BinCode)}`
                    : esc(r.BinCode)}
            </td>
        </tr>
    `).join("") || emptyRow(5, "No products found.");
}

async function loadSuppliers(search = "") {

    const tbody = document.getElementById("tbl-supplier");
    tbody.innerHTML = loadingRow(5);

    const res = await callApi("getSuppliersForReceiving", { search });

    if (!res.success) {
        tbody.innerHTML = emptyRow(5, res.message);
        return;
    }

    tbody.innerHTML = (res.data || []).map(r => `
        <tr>
            <td>${esc(r.SupplierName)}</td>
            <td>${esc(r.ContactPerson)}</td>
            <td>${esc(r.Phone)}</td>
            <td>${esc(r.Email)}</td>
            <td>${esc(r.Address)}</td>
        </tr>
    `).join("") || emptyRow(5, "No suppliers found.");
}

async function loadStorageLocationTables() {

    const [aisles, shelves, bins] = await Promise.all([
        callApi("getAislesForReceiving"),
        callApi("getShelvesForReceiving"),
        callApi("getBinsForReceiving")
    ]);

    const aisleBody = document.getElementById("tbl-aisle");
    if (aisles.success) {
        aisleBody.innerHTML = (aisles.data || []).map(r =>
            `<tr><td>${esc(r.AisleCode)}</td></tr>`
        ).join("") || emptyRow(1, "None");
    }

    const shelfBody = document.getElementById("tbl-shelf");
    if (shelves.success) {
        shelfBody.innerHTML = (shelves.data || []).map(r => `
            <tr>
                <td>${esc(r.AisleCode)}</td>
                <td>${esc(r.ShelfCode)}</td>
            </tr>
        `).join("") || emptyRow(2, "None");
    }

    const binBody = document.getElementById("tbl-bin");
    if (bins.success) {
        binBody.innerHTML = (bins.data || []).map(r => `
            <tr>
                <td>${esc(r.ShelfCode)}</td>
                <td>${esc(r.BinCode)}</td>
            </tr>
        `).join("") || emptyRow(2, "None");
    }
}

/* ============================================================
   EXPECTED POs + RECEIVING RECORDS
============================================================ */

async function loadExpectedPOs(search = "") {

    const tbody = document.getElementById("tbl-expected-po");
    tbody.innerHTML = loadingRow(7);

    const res = await callApi("getExpectedPurchaseOrders", { search });

    if (!res.success) {
        tbody.innerHTML = emptyRow(7, res.message);
        return;
    }

    tbody.innerHTML = (res.data || []).map(r => `
        <tr>
            <td>#${esc(r.PO_ID)}</td>
            <td>${esc(r.PO_Date)}</td>
            <td>${esc(r.Expected_Date || "—")}</td>
            <td>${esc(r.SupplierName)}</td>
            <td>${esc(r.UserName)}</td>
            <td>${statusBadge(r.StatusName)}</td>
            <td>
                <button class="btn-icon" title="Receive this PO"
                    onclick="openReceivingFormFromPO(${Number(r.PO_ID)})">
                    📥 Receive
                </button>
            </td>
        </tr>
    `).join("") || emptyRow(7, "No expected POs.");
}

async function loadReceivings(search = "", dateFilter = "", statusFilter = "") {

    const tbody = document.getElementById("tbl-recv");
    tbody.innerHTML = loadingRow(7);

    const res = await callApi("getReceivings", {
        search,
        date: dateFilter,
        status: statusFilter
    });

    if (!res.success) {
        tbody.innerHTML = emptyRow(7, res.message);
        return;
    }

    tbody.innerHTML = (res.data || []).map(r => `
        <tr>
            <td>#${esc(r.ReceivingID)}</td>
            <td>${esc(r.ReceivingDate)}</td>
            <td>${esc(r.SupplierName)}</td>
            <td>${esc(r.UserName)}</td>
            <td>${esc(r.PO_Reference || "—")}</td>
            <td>${statusBadge(r.StatusName)}</td>
            <td>
                <button class="btn-icon" title="See details"
                    onclick="viewReceiving(${Number(r.ReceivingID)})">👁</button>

                <button class="btn-icon" title="Edit"
                    onclick="editReceiving(${Number(r.ReceivingID)})">✎</button>

                <button class="btn-icon btn-icon-danger" title="Cancel"
                    onclick="deleteReceiving(${Number(r.ReceivingID)})">🗑</button>
            </td>
        </tr>
    `).join("") || emptyRow(7, "No receiving records.");
}

async function loadStatusesCache() {
    if (STATUSES_CACHE.length) return STATUSES_CACHE;
    const res = await callApi("getStatusesForReceiving");
    if (res.success) STATUSES_CACHE = res.data || [];
    return STATUSES_CACHE;
}

async function loadSuppliersCache() {
    if (SUPPLIERS_CACHE.length) return SUPPLIERS_CACHE;
    const res = await callApi("getSuppliersForReceiving");
    if (res.success) SUPPLIERS_CACHE = res.data || [];
    return SUPPLIERS_CACHE;
}

/* ============================================================
   RECEIVING FORM
============================================================ */

let currentReceivingID = null;
let currentReceivedLines = [];

async function openReceivingFormFromPO(poId) {

    currentReceivingID = null;
    currentReceivedLines = [];

    document.getElementById("receiving-modal-title").textContent =
        "Receive Purchase Order #" + poId;

    await loadStatusesCache();
    await loadSuppliersCache();

    document.getElementById("recv-supplier").value = "";
    document.getElementById("recv-po-ref").value = "";
    document.getElementById("recv-date").valueAsDate = new Date();
    document.getElementById("recv-received-by").value =
        `${currentUser.FirstName || ""} ${currentUser.LastName || ""}`.trim()
        || currentUser.UserName
        || "Receiving Staff";

    document.getElementById("recv-lines-body").innerHTML = loadingRow(5);

    openOverlay("receiving-modal-overlay");

    const poList = await callApi("getExpectedPurchaseOrders");
    const po = (poList.data || []).find(p => String(p.PO_ID) === String(poId));

    if (po) {
        document.getElementById("recv-supplier").value = po.SupplierName || "";
        document.getElementById("recv-po-ref").value =
            `PO #${po.PO_ID} — ${po.SupplierName}`;
    }

    const statusSel = document.getElementById("recv-status");
    statusSel.innerHTML = `<option value="">-- Select status --</option>` +
        STATUSES_CACHE.map(s => `
            <option value="${s.StatusID}">${esc(s.StatusName)}</option>
        `).join("");

    const autoStatus = STATUSES_CACHE.find(s =>
        /pending|received|draft/i.test(s.StatusName)
    );
    if (autoStatus) statusSel.value = autoStatus.StatusID;

    const res = await callApi("getPurchaseOrderLines", { PO_ID: poId });

    if (res.success && res.data && res.data.length) {
        res.data.forEach(line => {
            currentReceivedLines.push({
                ProductID: line.ProductID,
                ProductName: line.ProductName,
                OrderedQty: Number(line.OrderedQuantity || 0),
                ReceivedQty: Number(line.OrderedQuantity || 0),
                CostPrice: Number(line.CostPrice || 0)
            });
        });
        renderReceivingLines();
    } else {
        document.getElementById("recv-lines-body").innerHTML =
            emptyRow(5, "No PO lines found for this PO.");
    }

    document.getElementById("recv-po-ref").dataset.poId = poId;
}

async function openReceivingForm(receivingId) {

    currentReceivingID = receivingId;
    currentReceivedLines = [];

    document.getElementById("receiving-modal-title").textContent =
        "Edit Receiving #" + receivingId;

    document.getElementById("recv-lines-body").innerHTML = loadingRow(5);

    await loadStatusesCache();

    const statusSel = document.getElementById("recv-status");
    statusSel.innerHTML = `<option value="">-- Select status --</option>` +
        STATUSES_CACHE.map(s => `
            <option value="${s.StatusID}">${esc(s.StatusName)}</option>
        `).join("");

    const res = await callApi("getReceivingById", { ReceivingID: receivingId });

    if (!res.success || !res.data) {
        alert(res.message || "Failed to load receiving.");
        closeReceivingForm();
        return;
    }

    const r = res.data;

    document.getElementById("recv-supplier").value = r.SupplierName || "";
    document.getElementById("recv-date").value = r.ReceivingDate || "";
    document.getElementById("recv-po-ref").value = r.PO_Reference
        ? `PO #${r.PO_Reference}`
        : "—";
    document.getElementById("recv-received-by").value = r.UserName || "";
    document.getElementById("recv-status").value = r.StatusID || "";

    document.getElementById("recv-po-ref").dataset.poId = r.PO_Reference || "";

    (r.lines || []).forEach(l => {
        currentReceivedLines.push({
            ProductID: l.ProductID,
            ProductName: l.ProductName,
            OrderedQty: Number(l.OrderedQty || 0),
            ReceivedQty: Number(l.ReceivedQty || 0),
            CostPrice: Number(l.CostPrice || 0)
        });
    });

    renderReceivingLines();
    openOverlay("receiving-modal-overlay");
}

function closeReceivingForm() {
    closeOverlay("receiving-modal-overlay");
}

function renderReceivingLines() {

    const tbody = document.getElementById("recv-lines-body");

    if (!currentReceivedLines.length) {
        tbody.innerHTML = emptyRow(5, "No lines.");
        return;
    }

    tbody.innerHTML = currentReceivedLines.map((line, i) => {

        const variance = (line.ReceivedQty || 0) - (line.OrderedQty || 0);
        const hasOrdered = line.OrderedQty > 0;

        return `
            <tr>
                <td>
                    <input type="text" value="${esc(line.ProductName)}" readonly>
                </td>
                <td>
                    <input type="number" value="${line.OrderedQty}" readonly>
                </td>
                <td>
                    <input type="number" min="0" value="${line.ReceivedQty}"
                        oninput="updateLine(${i}, 'ReceivedQty', this.value)">
                </td>
                <td>
                    <input type="number" step="0.01" value="${line.CostPrice}" readonly>
                </td>
                <td style="text-align:center;">
                    ${hasOrdered
                        ? varianceBadge(variance)
                        : `<span class="badge badge-gray">—</span>`}
                </td>
            </tr>
        `;
    }).join("");
}

function updateLine(idx, field, value) {

    if (!currentReceivedLines[idx]) return;

    if (field === "ReceivedQty") {
        currentReceivedLines[idx][field] = Number(value) || 0;
    }

    const tbody = document.getElementById("recv-lines-body");
    const row = tbody.children[idx];

    if (row && row.children[4]) {

        const line = currentReceivedLines[idx];

        if (line.OrderedQty > 0) {
            const variance = (line.ReceivedQty || 0) - (line.OrderedQty || 0);
            row.children[4].innerHTML = varianceBadge(variance);
        } else {
            row.children[4].innerHTML = `<span class="badge badge-gray">—</span>`;
        }
    }
}

async function saveReceiving() {

    const date = document.getElementById("recv-date").value;
    const status = document.getElementById("recv-status").value;
    const poId = document.getElementById("recv-po-ref").dataset.poId || "";
    const receivedBy = currentUser.UserID;

    if (!date) return alert("Receiving date is required.");
    if (!currentReceivedLines.length) return alert("No lines to save.");

    for (let i = 0; i < currentReceivedLines.length; i++) {

        const line = currentReceivedLines[i];

        if (!line.ProductID) {
            return alert(`Line ${i + 1}: Missing product.`);
        }

        if (!line.ReceivedQty || line.ReceivedQty <= 0) {
            return alert(`Line ${i + 1}: Received quantity must be > 0.`);
        }
    }

    const supplierName = document.getElementById("recv-supplier").value;
    const supplier = SUPPLIERS_CACHE.find(s => s.SupplierName === supplierName);

    const payload = {
        ReceivingID: currentReceivingID,
        SupplierID: supplier ? supplier.SupplierID : null,
        ReceivingDate: date,
        PO_Reference: poId || null,
        StatusID: status || null,
        ReceivedByUserID: receivedBy,
        Lines: currentReceivedLines.map(l => ({
            ProductID: l.ProductID,
            OrderedQty: l.OrderedQty,
            ReceivedQuantity: l.ReceivedQty,
            CostPrice: l.CostPrice
        }))
    };

    const op = currentReceivingID ? "updateReceiving" : "insertReceiving";

    const res = await callApi(op, payload);

    if (!res.success) {
        alert(res.message);
        return;
    }

    closeReceivingForm();
    loadReceivings();
    loadDashboard();
    loadExpectedPOs();
}

/* ============================================================
   VIEW RECEIVING
============================================================ */

async function viewReceiving(id) {

    const body = document.getElementById("view-receiving-body");

    body.innerHTML = `<p class="modal-loading">Loading...</p>`;
    openOverlay("view-receiving-modal-overlay");

    const res = await callApi("getReceivingById", { ReceivingID: id });

    if (!res.success || !res.data) {
        body.innerHTML = `<p class="empty-row">${esc(res.message)}</p>`;
        return;
    }

    const r = res.data;

    const lines = (r.lines || []).map(l => {

        let varianceHtml = `<span class="badge badge-gray">—</span>`;

        if (l.OrderedQty && l.OrderedQty > 0) {
            varianceHtml = varianceBadge((l.ReceivedQty || 0) - (l.OrderedQty || 0));
        }

        return `
            <tr>
                <td>${esc(l.ProductName)}</td>
                <td class="num">${l.OrderedQty && l.OrderedQty > 0 ? esc(l.OrderedQty) : "—"}</td>
                <td class="num">${esc(l.ReceivedQty)}</td>
                <td class="num">${esc(l.CostPrice)}</td>
                <td style="text-align:center;">${varianceHtml}</td>
            </tr>
        `;
    }).join("");

    body.innerHTML = `

        <div class="detail-card">
            <div class="detail-grid">

                <div>
                    <span class="detail-label">Receiving ID</span>
                    <span class="detail-value">#${esc(r.ReceivingID)}</span>
                </div>

                <div>
                    <span class="detail-label">Date</span>
                    <span class="detail-value">${esc(r.ReceivingDate)}</span>
                </div>

                <div>
                    <span class="detail-label">Supplier</span>
                    <span class="detail-value">${esc(r.SupplierName)}</span>
                </div>

                <div>
                    <span class="detail-label">Received by</span>
                    <span class="detail-value">${esc(r.UserName)}</span>
                </div>

                <div>
                    <span class="detail-label">PO reference</span>
                    <span class="detail-value">${esc(r.PO_Reference ? "PO #" + r.PO_Reference : "—")}</span>
                </div>

                <div>
                    <span class="detail-label">Status</span>
                    <span class="detail-value">${statusBadge(r.StatusName)}</span>
                </div>

            </div>
        </div>

        <div class="detail-section">

            <h4>Items received</h4>

            <table class="line-table">
                <thead>
                    <tr>
                        <th>Product</th>
                        <th class="num">Ordered</th>
                        <th class="num">Received</th>
                        <th class="num">Cost</th>
                        <th style="text-align:center;">Variance</th>
                    </tr>
                </thead>
                <tbody>
                    ${lines || emptyRow(5, "No lines")}
                </tbody>
            </table>

        </div>
    `;
}

function closeViewReceiving() {
    closeOverlay("view-receiving-modal-overlay");
}

async function editReceiving(id) {
    await openReceivingForm(id);
}

/* ============================================================
   CONFIRM MODAL
============================================================ */

let confirmCallback = null;

function openConfirmModal(message, warning, callback, options = {}) {

    document.getElementById("confirm-modal-title").textContent =
        options.title || "Confirm Action";
    document.getElementById("confirm-modal-message").textContent = message;
    document.getElementById("confirm-modal-warning").textContent = warning || "";
    document.getElementById("btn-confirm-action").textContent =
        options.confirmLabel || "Confirm";

    confirmCallback = callback;

    openOverlay("confirm-modal-overlay");
}

function closeConfirmModal() {
    closeOverlay("confirm-modal-overlay");
    confirmCallback = null;
}

async function deleteReceiving(id) {

    openConfirmModal(
        `Cancel receiving #${id}?`,
        "The record will be marked as Cancelled.",
        async () => {

            const res = await callApi("deleteReceiving", { ReceivingID: id });

            if (!res.success) {
                alert(res.message);
                return;
            }

            loadReceivings();
            loadDashboard();
        },
        { title: "Cancel Receiving", confirmLabel: "Cancel Receiving" }
    );
}

/* ============================================================
   SIDEBAR (collapse, mobile drawer) + PROFILE MENU
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
    if (sidebar.classList.contains("sidebar-open")) closeSidebar();
    else openSidebar();
}

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
        "You will need to sign in again to access the receiving panel.",
        () => logout(),
        { title: "Log Out", confirmLabel: "Log Out" }
    );
}

function wireSidebar() {

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

        if (localStorage.getItem("receivingSidebarCollapsed") === "true") {
            sidebarEl.classList.add("collapsed");
            sidebarToggle.setAttribute("title", "Expand sidebar");
        }

        sidebarToggle.addEventListener("click", () => {

            sidebarEl.classList.toggle("collapsed");

            const isCollapsed = sidebarEl.classList.contains("collapsed");

            sidebarToggle.setAttribute("title", isCollapsed ? "Expand sidebar" : "Collapse sidebar");
            localStorage.setItem("receivingSidebarCollapsed", isCollapsed ? "true" : "false");

            closeProfileMenu();
            handleDashboardResize();

            setTimeout(() => {
                if (chartRecvStatus) chartRecvStatus.resize();
                if (chartProductsCategory) chartProductsCategory.resize();
            }, 300);
        });
    }
}

function wireProfileMenu() {

    const trigger = document.getElementById("sidebar-profile-trigger");
    const profileEl = document.getElementById("sidebar-profile");
    const logoutBtn = document.getElementById("btn-logout");

    if (trigger) {
        trigger.addEventListener("click", (e) => {
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

/* ============================================================
   SEARCH + FILTERS
============================================================ */

function setupSearches() {

    const debounced = (el, fn) => {
        if (!el) return;
        let t = null;
        el.addEventListener("input", () => {
            clearTimeout(t);
            t = setTimeout(fn, 300);
        });
    };

    const prodSearch = document.getElementById("search-product");
    debounced(prodSearch, () => loadProducts(prodSearch.value));

    const supSearch = document.getElementById("search-supplier");
    debounced(supSearch, () => loadSuppliers(supSearch.value));

    const poSearch = document.getElementById("search-po");
    debounced(poSearch, () => loadExpectedPOs(poSearch.value));

    const recvSearch = document.getElementById("search-recv");
    const recvDate = document.getElementById("filter-recv-date");
    const recvStatus = document.getElementById("filter-recv-status");

    const applyRecvFilters = () => {
        loadReceivings(
            recvSearch.value || "",
            recvDate.value || "",
            recvStatus.value || ""
        );
    };

    debounced(recvSearch, applyRecvFilters);

    if (recvDate) recvDate.addEventListener("change", applyRecvFilters);
    if (recvStatus) recvStatus.addEventListener("change", applyRecvFilters);
}

async function loadReceivingFilterStatuses() {

    const sel = document.getElementById("filter-recv-status");
    if (!sel) return;

    await loadStatusesCache();

    sel.innerHTML = `<option value="">All statuses</option>` +
        STATUSES_CACHE.map(s => `
            <option value="${s.StatusID}">${esc(s.StatusName)}</option>
        `).join("");
}

/* ============================================================
   INIT
============================================================ */

document.addEventListener("DOMContentLoaded", async () => {

    const displayName = currentUser.FirstName || currentUser.UserName || "Receiving Staff";

    const fullName = currentUser.FirstName
        ? `${currentUser.FirstName} ${currentUser.LastName || ""}`.trim()
        : (currentUser.UserName || "Receiving Staff");

    const welcome = document.getElementById("welcome-text");
    if (welcome) welcome.textContent = `Welcome, ${displayName}`;

    const profileName = document.getElementById("sidebar-profile-name");
    if (profileName) profileName.textContent = fullName;

    const profileRole = document.getElementById("sidebar-profile-role");
    if (profileRole) profileRole.textContent = currentUser.RoleName || "Receiving Staff";

    const profileAvatar = document.getElementById("sidebar-profile-avatar");
    if (profileAvatar) profileAvatar.textContent = fullName.charAt(0).toUpperCase() || "R";

    document.querySelectorAll(".nav-link").forEach(link => {
        link.addEventListener("click", () => switchSection(link.dataset.target));
    });

    wireSidebar();
    wireProfileMenu();

    const saveBtn = document.getElementById("btn-save-receiving");
    if (saveBtn) saveBtn.addEventListener("click", saveReceiving);

    const confirmBtn = document.getElementById("btn-confirm-action");
    if (confirmBtn) {
        confirmBtn.addEventListener("click", () => {
            const cb = confirmCallback;
            closeConfirmModal();
            if (cb) cb();
        });
    }

    ["receiving-modal-overlay", "view-receiving-modal-overlay", "confirm-modal-overlay"]
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener("click", e => {
                    if (e.target.id === id) closeOverlay(id);
                });
            }
        });

    setupSearches();

    await loadStatusesCache();
    await loadSuppliersCache();
    await loadReceivingFilterStatuses();

    loadDashboard();
});