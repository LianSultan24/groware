const baseApiUrl = "http://localhost/grocery_warehouse/releasing_api.php";

let currentUser = null;
let confirmCallback = null;
let currentReleaseId = null;
let currentReleaseLines = [];

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
        const allowed = ["releasing staff", "releasing", "admin", "administrator"];

        if (!allowed.includes(role)) {
            localStorage.removeItem("user");
            window.location.replace("login.html");
            return false;
        }

        const name = ((currentUser.FirstName || "") + " " + (currentUser.LastName || "")).trim();
        const displayName = name || currentUser.UserName || "Releasing";

        const topbarName = document.getElementById("topbar-username");
        if (topbarName) topbarName.textContent = "Welcome, " + displayName;

        const profileName = document.getElementById("sidebar-profile-name");
        if (profileName) profileName.textContent = displayName;

        const profileRole = document.getElementById("sidebar-profile-role");
        if (profileRole) profileRole.textContent = currentUser.RoleName || "Releasing Staff";

        const profileAvatar = document.getElementById("sidebar-profile-avatar");
        if (profileAvatar) {
            profileAvatar.textContent = displayName.trim().charAt(0).toUpperCase() || "R";
        }

        return true;
    } catch (err) {
        console.error("Session error:", err);
        window.location.replace("login.html");
        return false;
    }
}

async function apiCall(operation, payload = {}) {

    const body = {
        ...payload,
        LoggedInUserID: currentUser ? currentUser.UserID : 0
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
        console.error("API ERROR:", operation, error);
        return {
            success: false,
            message: error?.response?.data?.message || "Unable to connect to the server.",
            data: []
        };
    }
}

function esc(value) {
    if (value === null || value === undefined) return "";
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function fmtDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (isNaN(d)) return value;
    return d.toLocaleString();
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

function statusBadge(value) {
    const map = {
        Approved: "badge-amber",
        Completed: "badge-green",
        Pending: "badge-gray",
        Rejected: "badge-red",
        Cancelled: "badge-gray"
    };
    return `<span class="badge ${map[value] || "badge-gray"}">${esc(value || "—")}</span>`;
}

function setCount(id, count) {
    const el = document.getElementById(id);
    if (el) el.textContent = count === 0 ? "" : `${count} record${count === 1 ? "" : "s"} found`;
}

function debounce(element, handler) {
    if (!element) return;
    let timer = null;
    element.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(handler, 300);
    });
}

/* ============================================================
   NAVIGATION
============================================================ */

const sectionTitles = {
    "dashboard-section": "Dashboard",
    "releases-section": "Stock Releases",
    "product-section": "Products",
    "stock-section": "Current Stock",
    "locations-section": "Aisle / Shelf / Bin"
};

function setActiveSection(sectionId) {
    document.querySelectorAll(".page-section").forEach(s => s.classList.remove("active-section"));
    const target = document.getElementById(sectionId);
    if (target) target.classList.add("active-section");

    document.querySelectorAll(".nav-link").forEach(b => b.classList.remove("active"));
    const btn = document.querySelector(`.nav-link[data-section="${sectionId}"]`);
    if (btn) btn.classList.add("active");

    const titleEl = document.getElementById("page-title");
    if (titleEl) titleEl.textContent = sectionTitles[sectionId] || "";

    closeSidebar();
}

function wireNavigation() {
    document.querySelectorAll(".nav-link").forEach(btn => {
        btn.addEventListener("click", () => {
            const sectionId = btn.getAttribute("data-section");
            setActiveSection(sectionId);

            if (sectionId === "dashboard-section") loadDashboard();
            if (sectionId === "releases-section") loadReleases();
            if (sectionId === "product-section") loadProducts();
            if (sectionId === "stock-section") loadStock();
            if (sectionId === "locations-section") { loadAisles(); loadShelves(); loadBins(); }
        });
    });
}

function goToSection(sectionId) {
    const navBtn = document.querySelector(`.nav-link[data-section="${sectionId}"]`);
    if (navBtn) navBtn.click();
}

function wireTabs() {
    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active-tab"));
            btn.classList.add("active");
            const panel = document.getElementById(btn.dataset.tab);
            if (panel) panel.classList.add("active-tab");
        });
    });
}

/* ============================================================
   DASHBOARD
============================================================ */

async function loadDashboard() {
    const res = await apiCall("getDashboardStats");
    if (!res || !res.success) {
        console.warn("Dashboard:", res ? res.message : "no response");
        return;
    }

    const d = res.data || {};
    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    setText("stat-toprocess", d.toProcessCount ?? 0);
    setText("stat-completed", d.completedCount ?? 0);
    setText("stat-products", d.totalProducts ?? 0);
    setText("stat-lowstock", d.lowStockCount ?? 0);

    const toProcessBody = document.getElementById("dashboard-toprocess");
    if (toProcessBody) {
        const rows = d.toProcess || [];
        toProcessBody.innerHTML = rows.length
            ? rows.map(r => `
                <tr>
                    <td>#${esc(r.ReleaseID)}</td>
                    <td>${esc(r.RequestedBy || "—")}</td>
                    <td>${esc(r.ItemCount)}</td>
                    <td>${statusBadge(r.StatusName)}</td>
                    <td><button class="btn-icon" onclick="openProcessModal(${r.ReleaseID})">Process</button></td>
                </tr>
            `).join("")
            : `<tr><td colspan="5" class="empty-row">Nothing waiting to be processed.</td></tr>`;
    }

    const completedBody = document.getElementById("dashboard-completed");
    if (completedBody) {
        const rows = d.recentCompleted || [];
        completedBody.innerHTML = rows.length
            ? rows.map(r => `
                <tr>
                    <td>#${esc(r.ReleaseID)}</td>
                    <td>${esc(r.ReleaseDate || "—")}</td>
                    <td>${esc(r.ReleasedBy || "—")}</td>
                    <td>${statusBadge(r.StatusName)}</td>
                </tr>
            `).join("")
            : `<tr><td colspan="4" class="empty-row">No completed releases yet.</td></tr>`;
    }
}

/* ============================================================
   STOCK RELEASES
============================================================ */

let releaseStatusesCache = null;

async function loadReleaseStatusFilter() {
    if (releaseStatusesCache) return;

    const res = await apiCall("getStatuses");
    const all = (res && res.success && res.data) || [];
    releaseStatusesCache = all.filter(s =>
        ["approved", "completed"].includes(String(s.StatusName || "").toLowerCase().trim())
    );

    const sel = document.getElementById("filter-releases-status");
    if (sel) {
        sel.innerHTML = `<option value="">Approved &amp; Completed</option>` +
            releaseStatusesCache.map(s => `<option value="${s.StatusID}">${esc(s.StatusName)}</option>`).join("");
    }
}

async function loadReleases() {
    await loadReleaseStatusFilter();

    const tbody = document.getElementById("releases-tbody");
    if (!tbody) return;

    const search = (document.getElementById("search-releases") || {}).value || "";
    const statusID = (document.getElementById("filter-releases-status") || {}).value || "";
    const dateFrom = (document.getElementById("filter-releases-from") || {}).value || "";
    const dateTo = (document.getElementById("filter-releases-to") || {}).value || "";

    tbody.innerHTML = `<tr><td colspan="7" class="empty-row">Loading…</td></tr>`;

    const res = await apiCall("getStockReleases", {
        search: search.trim(),
        Status_ID: statusID,
        dateFrom, dateTo
    });

    const rows = (res && res.success && res.data) || [];
    setCount("releases-count", rows.length);

    if (!res.success) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-row">${esc(res.message)}</td></tr>`;
        return;
    }

    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-row">No stock releases found.</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map(r => {
        const statusName = String(r.StatusName || "").toLowerCase().trim();
        const isApproved = statusName === "approved";

        const action = isApproved
            ? `<button class="btn-icon" onclick="openProcessModal(${r.ReleaseID})">Process</button>`
            : `<button class="btn-icon" onclick="openViewReleaseModal(${r.ReleaseID})">View</button>`;

        return `
            <tr>
                <td>#${esc(r.ReleaseID)}</td>
                <td>${esc(r.RequestedBy || "—")}</td>
                <td>${esc(r.ReleasedBy || "—")}</td>
                <td>${esc(r.ReleaseDate || "—")}</td>
                <td class="num">${esc(r.ItemCount)}</td>
                <td>${statusBadge(r.StatusName)}</td>
                <td>${action}</td>
            </tr>
        `;
    }).join("");
}

function clearReleaseFilters() {
    ["search-releases", "filter-releases-status", "filter-releases-from", "filter-releases-to"]
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
    loadReleases();
}

/* ============================================================
   PROCESS RELEASE MODAL
============================================================ */

function openModal(id) { const el = document.getElementById(id); if (el) el.classList.add("open"); }
function closeModal(id) { const el = document.getElementById(id); if (el) el.classList.remove("open"); }

async function openProcessModal(releaseId) {
    currentReleaseId = releaseId;
    currentReleaseLines = [];

    document.getElementById("process-modal-title").textContent = `Process Stock Release #${releaseId}`;
    const body = document.getElementById("process-modal-body");
    body.innerHTML = `<p class="modal-loading">Loading…</p>`;
    openModal("process-modal-overlay");

    const res = await apiCall("getStockRelease", { ReleaseID: releaseId });

    if (!res || !res.success || !res.data) {
        body.innerHTML = `<p class="field-hint">${esc((res && res.message) || "Failed to load release.")}</p>`;
        document.getElementById("btn-save-progress").style.display = "none";
        document.getElementById("btn-mark-completed").style.display = "none";
        return;
    }

    const d = res.data;
    currentReleaseLines = d.lines || [];

    const statusName = String(d.StatusName || "").toLowerCase().trim();
    const isApproved = statusName === "approved";

    document.getElementById("btn-save-progress").style.display = isApproved ? "" : "none";
    document.getElementById("btn-mark-completed").style.display = isApproved ? "" : "none";

    body.innerHTML = `
        <div class="detail-grid">
            <div>
                <span class="detail-label">Requested By</span>
                <span class="detail-value">${esc(d.RequestedBy || "—")}</span>
            </div>
            <div>
                <span class="detail-label">Request Date</span>
                <span class="detail-value">${esc(d.RequestDate || "—")}</span>
            </div>
            <div>
                <span class="detail-label">Status</span>
                <span class="detail-value">${statusBadge(d.StatusName)}</span>
            </div>
        </div>

        <div class="form-group" style="max-width:220px;">
            <label>Release Date *</label>
            <input type="date" id="release-date-input" value="${esc(d.ReleaseDate || today())}">
        </div>

        <table class="line-table">
            <thead>
                <tr>
                    <th>Product</th>
                    <th>Location</th>
                    <th class="num">On Hand</th>
                    <th class="num">Qty Requested</th>
                    <th class="num">Qty To Release</th>
                    <th>Availability</th>
                </tr>
            </thead>
            <tbody id="release-lines-body">
                ${currentReleaseLines.map((l, i) => releaseLineRow(l, i)).join("")}
            </tbody>
        </table>
    `;

    const dateInput = document.getElementById("release-date-input");
    if (dateInput) dateInput.disabled = !isApproved;

    document.querySelectorAll("#release-lines-body input[type='number']").forEach(input => {
        input.disabled = !isApproved;
        input.addEventListener("input", () => updateAvailabilityRow(input));
    });

    document.querySelectorAll("#release-lines-body tr").forEach(row => {
        const input = row.querySelector("input[type='number']");
        if (input) updateAvailabilityRow(input);
    });
}

function releaseLineRow(line, index) {
    const onHand = Number(line.OnHand ?? 0);
    const requested = Number(line.QuantityRequested ?? 0);
    const releasedDefault = line.QuantityReleased !== null && line.QuantityReleased !== undefined && Number(line.QuantityReleased) > 0
        ? Number(line.QuantityReleased)
        : requested;

    return `
        <tr data-line-index="${index}" data-onhand="${onHand}">
            <td>${esc(line.ProductName)}</td>
            <td>${esc(line.BinCode || "—")}</td>
            <td class="num">${esc(onHand)}</td>
            <td class="num">${esc(requested)}</td>
            <td class="num">
                <input type="number" min="0" max="${Math.min(onHand, requested)}" step="1"
                    value="${esc(releasedDefault)}" data-max-requested="${requested}">
            </td>
            <td class="availability-cell">—</td>
        </tr>
    `;
}

function updateAvailabilityRow(input) {
    const row = input.closest("tr");
    if (!row) return;

    const onHand = Number(row.dataset.onhand || 0);
    const maxRequested = Number(input.dataset.maxRequested || 0);
    const qty = Number(input.value || 0);

    const cell = row.querySelector(".availability-cell");

    row.classList.remove("release-row-short");

    if (input.value === "" || isNaN(qty) || qty < 0) {
        cell.innerHTML = `<span class="availability-short">Enter a quantity</span>`;
        row.classList.add("release-row-short");
        return;
    }

    if (qty > maxRequested) {
        cell.innerHTML = `<span class="availability-short">Exceeds requested qty</span>`;
        row.classList.add("release-row-short");
        return;
    }

    if (qty > onHand) {
        cell.innerHTML = `<span class="availability-short">Insufficient stock</span>`;
        row.classList.add("release-row-short");
        return;
    }

    cell.innerHTML = `<span class="availability-ok">Available</span>`;
}

function collectReleaseLines() {
    const lines = [];
    let hasShortage = false;

    document.querySelectorAll("#release-lines-body tr").forEach(row => {
        const index = Number(row.dataset.lineIndex);
        const input = row.querySelector("input[type='number']");
        const qty = Number(input.value || 0);

        if (row.classList.contains("release-row-short")) hasShortage = true;

        const sourceLine = currentReleaseLines[index];

        lines.push({
            Stock_Release_Line_ID: sourceLine ? sourceLine.Stock_Release_Line_ID : null,
            ProductID: sourceLine ? sourceLine.ProductID : null,
            QuantityReleased: qty
        });
    });

    return { lines, hasShortage };
}

async function saveReleaseProgress() {
    if (!currentReleaseId) return;

    const releaseDate = document.getElementById("release-date-input").value;
    if (!releaseDate) {
        alert("Please set the release date.");
        return;
    }

    const { lines } = collectReleaseLines();

    const res = await apiCall("processStockRelease", {
        ReleaseID: currentReleaseId,
        ReleaseDate: releaseDate,
        lines,
        markCompleted: false
    });

    if (!res.success) {
        alert(res.message);
        return;
    }

    alert(res.message || "Progress saved.");
    closeProcessModal();
    loadReleases();
    loadDashboard();
}

function markReleaseCompleted() {
    if (!currentReleaseId) return;

    const releaseDate = document.getElementById("release-date-input").value;
    if (!releaseDate) {
        alert("Please set the release date.");
        return;
    }

    const { lines, hasShortage } = collectReleaseLines();

    if (hasShortage) {
        alert("Please resolve the quantities flagged in red before marking this release as completed.");
        return;
    }

    openConfirmModal(
        `Mark Stock Release #${currentReleaseId} as completed? This records the products as released and updates inventory.`,
        {
            title: "Mark as Completed",
            warning: "This cannot be undone from this screen.",
            confirmLabel: "Mark Completed",
            onConfirm: async () => {
                const res = await apiCall("processStockRelease", {
                    ReleaseID: currentReleaseId,
                    ReleaseDate: releaseDate,
                    lines,
                    markCompleted: true
                });

                if (!res.success) {
                    alert(res.message);
                    return;
                }

                alert(res.message || "Stock release completed.");
                closeProcessModal();
                loadReleases();
                loadDashboard();
            }
        }
    );
}

function closeProcessModal() {
    closeModal("process-modal-overlay");
    currentReleaseId = null;
    currentReleaseLines = [];
}

/* ============================================================
   VIEW (READ-ONLY) RELEASE MODAL — for completed records
============================================================ */

async function openViewReleaseModal(releaseId) {
    document.getElementById("view-release-modal-title").textContent = `Stock Release #${releaseId}`;
    const body = document.getElementById("view-release-modal-body");
    body.innerHTML = `<p class="modal-loading">Loading…</p>`;
    openModal("view-release-modal-overlay");

    const res = await apiCall("getStockRelease", { ReleaseID: releaseId });

    if (!res || !res.success || !res.data) {
        body.innerHTML = `<p class="field-hint">${esc((res && res.message) || "Failed to load release.")}</p>`;
        return;
    }

    const d = res.data;
    const lines = d.lines || [];

    body.innerHTML = `
        <div class="detail-grid">
            <div><span class="detail-label">Requested By</span><span class="detail-value">${esc(d.RequestedBy || "—")}</span></div>
            <div><span class="detail-label">Released By</span><span class="detail-value">${esc(d.ReleasedBy || "—")}</span></div>
            <div><span class="detail-label">Release Date</span><span class="detail-value">${esc(d.ReleaseDate || "—")}</span></div>
            <div><span class="detail-label">Status</span><span class="detail-value">${statusBadge(d.StatusName)}</span></div>
        </div>

        <table class="line-table">
            <thead>
                <tr><th>Product</th><th>Location</th><th class="num">Qty Requested</th><th class="num">Qty Released</th></tr>
            </thead>
            <tbody>
                ${lines.map(l => `
                    <tr>
                        <td>${esc(l.ProductName)}</td>
                        <td>${esc(l.BinCode || "—")}</td>
                        <td class="num">${esc(l.QuantityRequested)}</td>
                        <td class="num">${esc(l.QuantityReleased ?? "—")}</td>
                    </tr>
                `).join("") || `<tr><td colspan="4" class="empty-row">No lines.</td></tr>`}
            </tbody>
        </table>
    `;
}

function closeViewReleaseModal() {
    closeModal("view-release-modal-overlay");
}

/* ============================================================
   PRODUCTS
============================================================ */

async function loadProducts() {
    const tbody = document.getElementById("product-tbody");
    if (!tbody) return;
    const search = (document.getElementById("search-product") || {}).value || "";
    tbody.innerHTML = `<tr><td colspan="7" class="empty-row">Loading…</td></tr>`;

    const res = await apiCall("getProducts", { search: search.trim() });
    const rows = (res && res.success && res.data) || [];

    tbody.innerHTML = rows.length
        ? rows.map(p => `
            <tr>
                <td>${esc(p.Barcode)}</td>
                <td>${esc(p.ProductName)}</td>
                <td>${esc(p.CategoryName || "—")}</td>
                <td>${esc(p.UnitName || "—")}</td>
                <td class="num ${Number(p.OnHand) <= Number(p.MinStockLevel) ? "stock-low" : "stock-ok"}">${esc(p.OnHand)}</td>
                <td class="num">${esc(p.MinStockLevel)}</td>
                <td>${esc(p.BinCode || "—")}</td>
            </tr>
        `).join("")
        : `<tr><td colspan="7" class="empty-row">No products found.</td></tr>`;
}

/* ============================================================
   CURRENT STOCK
============================================================ */

async function loadStock() {
    const tbody = document.getElementById("stock-tbody");
    if (!tbody) return;
    const search = (document.getElementById("search-stock") || {}).value || "";
    tbody.innerHTML = `<tr><td colspan="6" class="empty-row">Loading…</td></tr>`;

    const res = await apiCall("getInventoryQuantities", { search: search.trim() });
    const rows = (res && res.success && res.data) || [];

    tbody.innerHTML = rows.length
        ? rows.map(r => `
            <tr>
                <td>${esc(r.ProductName)}</td>
                <td>${esc(r.CategoryName || "—")}</td>
                <td>${esc(r.BinCode || "—")}</td>
                <td>${esc(r.UnitName || "—")}</td>
                <td class="num ${Number(r.OnHandQuantity) <= Number(r.MinStockLevel) ? "stock-low" : "stock-ok"}">${esc(r.OnHandQuantity)}</td>
                <td class="num">${esc(r.MinStockLevel)}</td>
            </tr>
        `).join("")
        : `<tr><td colspan="6" class="empty-row">No stock data.</td></tr>`;
}

/* ============================================================
   LOCATIONS
============================================================ */

async function loadAisles() {
    const tbody = document.getElementById("aisles-tbody");
    if (!tbody) return;
    const res = await apiCall("getAisles");
    const rows = (res && res.success && res.data) || [];
    tbody.innerHTML = rows.length
        ? rows.map(a => `<tr><td>${esc(a.AisleCode)}</td></tr>`).join("")
        : `<tr><td class="empty-row">No aisles.</td></tr>`;
}

async function loadShelves() {
    const tbody = document.getElementById("shelves-tbody");
    if (!tbody) return;
    const res = await apiCall("getShelves");
    const rows = (res && res.success && res.data) || [];
    tbody.innerHTML = rows.length
        ? rows.map(s => `<tr><td>${esc(s.AisleCode || "—")}</td><td>${esc(s.ShelfCode)}</td></tr>`).join("")
        : `<tr><td colspan="2" class="empty-row">No shelves.</td></tr>`;
}

async function loadBins() {
    const tbody = document.getElementById("bins-tbody");
    if (!tbody) return;
    const res = await apiCall("getBins");
    const rows = (res && res.success && res.data) || [];
    tbody.innerHTML = rows.length
        ? rows.map(b => `<tr><td>${esc(b.AisleCode || "—")}</td><td>${esc(b.ShelfCode || "—")}</td><td>${esc(b.BinCode)}</td></tr>`).join("")
        : `<tr><td colspan="3" class="empty-row">No bins.</td></tr>`;
}

/* ============================================================
   CONFIRM MODAL
============================================================ */

function openConfirmModal(message, { title = "Confirm Action", warning = "", confirmLabel = "Confirm", onConfirm = null } = {}) {
    document.getElementById("confirm-modal-title").textContent = title;
    document.getElementById("confirm-modal-message").textContent = message;
    document.getElementById("confirm-modal-warning").textContent = warning;

    const btn = document.getElementById("btn-confirm-action");
    btn.textContent = confirmLabel;

    confirmCallback = onConfirm;
    openModal("confirm-modal-overlay");
}

function closeConfirmModal() {
    closeModal("confirm-modal-overlay");
    confirmCallback = null;
}

/* ============================================================
   LOGOUT
============================================================ */

async function logout() {
    try { await apiCall("logout"); } catch (err) { console.error(err); }
    localStorage.removeItem("user");
    window.location.replace("login.html");
}

function confirmLogout() {
    closeProfileMenu();
    openConfirmModal(
        "Are you sure you want to log out?",
        {
            title: "Log Out",
            warning: "You will need to sign in again to access the releasing panel.",
            confirmLabel: "Log Out",
            onConfirm: () => logout()
        }
    );
}

/* ============================================================
   SIDEBAR (collapse, mobile drawer)
============================================================ */

function openSidebar() {
    document.getElementById("sidebar")?.classList.add("sidebar-open");
    document.getElementById("sidebar-backdrop")?.classList.add("open");
}
function closeSidebar() {
    document.getElementById("sidebar")?.classList.remove("sidebar-open");
    document.getElementById("sidebar-backdrop")?.classList.remove("open");
}
function toggleSidebar() {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return;
    sidebar.classList.contains("sidebar-open") ? closeSidebar() : openSidebar();
}

function wireSidebarToggle() {
    const hamburger = document.getElementById("hamburger-btn");
    if (hamburger) hamburger.addEventListener("click", (e) => { e.stopPropagation(); toggleSidebar(); });

    const backdrop = document.getElementById("sidebar-backdrop");
    if (backdrop) backdrop.addEventListener("click", closeSidebar);

    const sidebarToggle = document.getElementById("sidebar-toggle");
    const sidebarEl = document.getElementById("sidebar");

    if (sidebarToggle && sidebarEl) {
        if (localStorage.getItem("releasingSidebarCollapsed") === "true") {
            sidebarEl.classList.add("collapsed");
            sidebarToggle.setAttribute("title", "Expand sidebar");
        }

        sidebarToggle.addEventListener("click", () => {
            sidebarEl.classList.toggle("collapsed");
            const isCollapsed = sidebarEl.classList.contains("collapsed");
            sidebarToggle.setAttribute("title", isCollapsed ? "Expand sidebar" : "Collapse sidebar");
            localStorage.setItem("releasingSidebarCollapsed", isCollapsed ? "true" : "false");
            closeProfileMenu();
        });
    }
}

function closeProfileMenu() {
    document.getElementById("sidebar-profile")?.classList.remove("menu-open");
    document.getElementById("sidebar-profile-trigger")?.setAttribute("aria-expanded", "false");
}
function toggleProfileMenu() {
    const profile = document.getElementById("sidebar-profile");
    const trigger = document.getElementById("sidebar-profile-trigger");
    if (!profile || !trigger) return;
    const isOpen = profile.classList.toggle("menu-open");
    trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
}

function wireProfileMenu() {
    const trigger = document.getElementById("sidebar-profile-trigger");
    const profileEl = document.getElementById("sidebar-profile");
    const logoutBtn = document.getElementById("btn-logout");

    if (trigger) trigger.addEventListener("click", (e) => { e.stopPropagation(); toggleProfileMenu(); });
    if (logoutBtn) logoutBtn.addEventListener("click", (e) => { e.stopPropagation(); confirmLogout(); });

    document.addEventListener("click", (e) => {
        if (profileEl && !profileEl.contains(e.target)) closeProfileMenu();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeProfileMenu(); });
}

/* ============================================================
   INIT
============================================================ */

document.addEventListener("DOMContentLoaded", () => {
    if (!loadSession()) return;

    wireNavigation();
    wireTabs();
    wireSidebarToggle();
    wireProfileMenu();

    debounce(document.getElementById("search-releases"), loadReleases);
    debounce(document.getElementById("search-product"), loadProducts);
    debounce(document.getElementById("search-stock"), loadStock);

    ["filter-releases-status", "filter-releases-from", "filter-releases-to"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("change", loadReleases);
    });

    ["process-modal-overlay", "view-release-modal-overlay", "confirm-modal-overlay"].forEach(id => {
        const overlay = document.getElementById(id);
        if (overlay) {
            overlay.addEventListener("click", e => {
                if (e.target.id === id) {
                    if (id === "confirm-modal-overlay") closeConfirmModal();
                    else closeModal(id);
                }
            });
        }
    });

    const confirmBtn = document.getElementById("btn-confirm-action");
    if (confirmBtn) {
        confirmBtn.addEventListener("click", () => {
            const cb = confirmCallback;
            closeConfirmModal();
            if (cb) cb();
        });
    }

    loadDashboard();
});