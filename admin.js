const baseApiUrl =
    "http://localhost/grocery_warehouse/api.php";

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

/* ============================================================
   GLOBAL MESSAGE MODAL
============================================================ */

let messageModalTimer = null;

function showMessageModal(message, type = "info") {

    const overlay = document.getElementById("message-modal-overlay");
    const titleEl = document.getElementById("message-modal-title");
    const bodyEl  = document.getElementById("message-modal-message");
    const confirmBtn = document.getElementById("btn-message-confirm");
    const iconEl  = document.getElementById("message-modal-icon");

    if (!overlay || !titleEl || !bodyEl) {
        console.warn("Message modal not found:", message);
        return;
    }

    let title = "Message";
    let icon = "ℹ";
    let iconClass = "info";

    if (type === "success") {
        title = "Success";
        icon = "✔";
        iconClass = "success";
    } else if (type === "error") {
        title = "Error";
        icon = "✖";
        iconClass = "error";
    } else if (type === "warning") {
        title = "Warning";
        icon = "⚠";
        iconClass = "warning";
    }

    titleEl.textContent = title;
    bodyEl.textContent = message;

    if (iconEl) {
        iconEl.textContent = icon;
        iconEl.className = "message-modal-icon " + iconClass;
    }

    overlay.classList.add("open");

    if (confirmBtn) {
        confirmBtn.onclick = () => hideMessageModal();
    }
}

function hideMessageModal() {
    const overlay = document.getElementById("message-modal-overlay");
    if (overlay) overlay.classList.remove("open");
    if (messageModalTimer) {
        clearTimeout(messageModalTimer);
        messageModalTimer = null;
    }
}

function showErrorModal(message) { showMessageModal(message, "error"); }
function showSuccessModal(message) { showMessageModal(message, "success"); }
function showWarningModal(message) { showMessageModal(message, "warning"); }
function showInfoModal(message) { showMessageModal(message, "info"); }

/* ============================================================
   API
============================================================ */

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
            message: error?.response?.data?.message || "Unable to connect to the server.",
            data: []
        };
    }
};

/* ============================================================
   HELPERS
============================================================ */

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
        Rejected: "badge-red"
    };
    return `
        <span class="badge ${map[val] || "badge-gray"}">
            ${esc(val ?? "-")}
        </span>
    `;
};

const logout = async () => {
    await callApi("logout");
    localStorage.removeItem("user");
    window.location.href = "login.html";
};

const sectionTitles = {
    "section-dashboard": "Dashboard",
    "section-role": "Roles",
    "section-category": "Categories",
    "section-supplier": "Suppliers",
    "section-storage-location": "Storage Location",
    "section-product": "Products",
    "section-uom": "Units of Measure",
    "section-user": "User Accounts",
    "section-transactions": "Inventory & Transactions",
    "section-audit": "Audit Log"
};

/* ============================================================
   ACTION BUTTONS
============================================================ */

function actionButtons(moduleKey, id) {
    return `
        <button class="btn-icon" title="Edit"
            onclick="openFormModal('${moduleKey}', ${Number(id)})">✎</button>
        <button class="btn-icon btn-icon-danger" title="Archive"
            onclick="deleteRecord('${moduleKey}', ${Number(id)})">🗑</button>
    `;
}

function restoreButton(moduleKey, id, displayName) {
    return `
        <button class="btn-icon" title="Restore this record"
            onclick="restoreRecord('${moduleKey}', ${Number(id)}, '${esc(displayName)}')"
        >↺ Restore</button>
    `;
}

function renderActionsCell(moduleKey, id, mode, displayName) {
    return mode === "archived"
        ? restoreButton(moduleKey, id, displayName)
        : actionButtons(moduleKey, id);
}

/* ============================================================
   MODULES
============================================================ */

const MODULES = {

    role: {
        title: "Role",
        idField: "RoleID",
        ops: { list: "getRoles", get: "getRole", insert: "insertRole", update: "updateRole", delete: "deleteRole" },
        tableBody: "tbl-role",
        searchInput: "search-role",
        fields: [
            { name: "RoleName", label: "Role Name", type: "text", required: true }
        ],
        row: (r, mode = "list") => `
            <td>${esc(r.RoleName)}</td>
            <td>${renderActionsCell("role", r.RoleID, mode, r.RoleName)}</td>
        `
    },

    category: {
        title: "Category",
        idField: "CategoryID",
        ops: { list: "getCategories", get: "getCategory", insert: "insertCategory", update: "updateCategory", delete: "deleteCategory" },
        tableBody: "tbl-category",
        searchInput: "search-category",
        fields: [
            { name: "CategoryName", label: "Category Name", type: "text", required: true }
        ],
        row: (r, mode = "list") => `
            <td>${esc(r.CategoryName)}</td>
            <td>${renderActionsCell("category", r.CategoryID, mode, r.CategoryName)}</td>
        `
    },

    supplier: {
        title: "Supplier",
        idField: "SupplierID",
        ops: { list: "getSuppliers", get: "getSupplier", insert: "insertSupplier", update: "updateSupplier", delete: "deleteSupplier" },
        tableBody: "tbl-supplier",
        searchInput: "search-supplier",
        fields: [
            { name: "SupplierName", label: "Supplier Name", type: "text", required: true },
            { name: "ContactPerson", label: "Contact Person", type: "text" },
            { name: "Phone", label: "Phone", type: "text" },
            { name: "Email", label: "Email", type: "text" },
            { name: "Address", label: "Address", type: "textarea" }
        ],
       row: (r, mode = "list") => `
    <td>${esc(r.SupplierName)}</td>
    <td>${esc(r.ContactPerson)}</td>
    <td>${esc(r.Phone)}</td>
    <td>${esc(r.Email)}</td>
    <td>
        ${renderActionsCell("supplier", r.SupplierID, mode, r.SupplierName)}
        ${
            mode !== "archived"
                ? `<button class="btn-icon" title="Manage Products"
                      onclick="openSupplierProductsModal(${Number(r.SupplierID)}, '${esc(r.SupplierName)}')"
                   >📦 Products</button>`
                : ""
        }
    </td>
`
    },

    aisle: {
        title: "Aisle",
        idField: "AisleID",
        ops: { list: "getAisles", get: "getAisle", insert: "insertAisle", update: "updateAisle", delete: "deleteAisle" },
        tableBody: "tbl-aisle",
        searchInput: "search-aisle",
        fields: [
            { name: "AisleCode", label: "Aisle Code", type: "text", required: true }
        ],
        row: (r, mode = "list") => `
            <td>${esc(r.AisleCode)}</td>
            <td>${renderActionsCell("aisle", r.AisleID, mode, r.AisleCode)}</td>
        `
    },

    shelf: {
        title: "Shelf",
        idField: "ShelfID",
        ops: { list: "getShelves", get: "getShelf", insert: "insertShelf", update: "updateShelf", delete: "deleteShelf" },
        tableBody: "tbl-shelf",
        searchInput: "search-shelf",
        fields: [
            { name: "AisleID", label: "Aisle", type: "select", optionsSource: "aisle", required: true },
            { name: "ShelfCode", label: "Shelf Code", type: "text", required: true }
        ],
        row: (r, mode = "list") => `
            <td>${esc(r.AisleCode)}</td>
            <td>${esc(r.ShelfCode)}</td>
            <td>${renderActionsCell("shelf", r.ShelfID, mode, r.ShelfCode)}</td>
        `
    },

    bin: {
        title: "Bin",
        idField: "BinID",
        ops: { list: "getBins", get: "getBin", insert: "insertBin", update: "updateBin", delete: "deleteBin" },
        tableBody: "tbl-bin",
        searchInput: "search-bin",
        fields: [
            { name: "ShelfID", label: "Shelf", type: "select", optionsSource: "shelf", required: true },
            { name: "BinCode", label: "Bin Code", type: "text", required: true }
        ],
        row: (r, mode = "list") => `
            <td>${esc(r.ShelfCode)}</td>
            <td>${esc(r.BinCode)}</td>
            <td>${renderActionsCell("bin", r.BinID, mode, r.BinCode)}</td>
        `
    },

    product: {
        title: "Product",
        idField: "ProductID",
        ops: { list: "getProducts", get: "getProduct", insert: "insertProduct", update: "updateProduct", delete: "deleteProduct" },
        tableBody: "tbl-product",
        searchInput: "search-product",
        fields: [
            { name: "ProductName", label: "Product Name", type: "text", required: true },
            { name: "Barcode", label: "Barcode", type: "text" },
            { name: "Description", label: "Description", type: "textarea" },
            { name: "CategoryID", label: "Category", type: "select", optionsSource: "category" },
            { name: "UnitOfMeasureID", label: "Unit of Measure", type: "select", optionsSource: "uom" },
            { name: "MinStockLevel", label: "Minimum Stock Level", type: "number" },
            { name: "BinID", label: "Bin Location", type: "select", optionsSource: "bin" }
        ],
        row: (r, mode = "list") => `
            <td>${esc(r.ProductName)}</td>
            <td>${esc(r.Barcode)}</td>
            <td>${esc(r.CategoryName)}</td>
            <td>${esc(r.UnitSymbol || r.UnitName)}</td>
            <td>${esc(r.MinStockLevel)}</td>
            <td>${
                r.AisleCode
                    ? `${esc(r.AisleCode)} / ${esc(r.ShelfCode)} / ${esc(r.BinCode)}`
                    : esc(r.BinCode)
            }</td>
            <td>${renderActionsCell("product", r.ProductID, mode, r.ProductName)}</td>
        `
    },

    uom: {
        title: "Unit of Measure",
        idField: "UnitOfMeasureID",
        ops: { list: "getUnitsOfMeasureList", get: "getUnitOfMeasure", insert: "insertUnitOfMeasure", update: "updateUnitOfMeasure", delete: "deleteUnitOfMeasure" },
        tableBody: "tbl-uom",
        searchInput: "search-uom",
        fields: [
            { name: "UnitName", label: "Unit Name", type: "text", required: true },
            { name: "UnitSymbol", label: "Symbol", type: "text" }
        ],
        row: (r, mode = "list") => `
            <td>${esc(r.UnitName)}</td>
            <td>${esc(r.UnitSymbol || "—")}</td>
            <td>${renderActionsCell("uom", r.UnitOfMeasureID, mode, r.UnitName)}</td>
        `
    },

    user: {
        title: "User Account",
        idField: "UserID",
        ops: { list: "getUsers", get: "getUser", insert: "insertUser", update: "updateUser", delete: "deleteUser" },
        tableBody: "tbl-user",
        searchInput: "search-user",
        fields: [
            { name: "UserName", label: "Username", type: "text", required: true },
            { name: "Password", label: "Password", type: "password", hint: "Leave blank to keep the current password when editing." },
            { name: "FirstName", label: "First Name", type: "text" },
            { name: "LastName", label: "Last Name", type: "text" },
            { name: "Email", label: "Email", type: "text" },
            { name: "RoleID", label: "Role", type: "select", optionsSource: "role", required: true },
            { name: "UserStatus", label: "Account Status", type: "select",
              staticOptions: [
                  { value: "Active", label: "Active" },
                  { value: "Inactive", label: "Inactive" }
              ]
            }
        ],
        row: (r, mode = "list") => `
            <td>${esc(r.UserName)}</td>
            <td>${esc(r.FirstName)} ${esc(r.LastName)}</td>
            <td>${esc(r.Email)}</td>
            <td>${esc(r.RoleName)}</td>
            <td>${statusBadge(r.UserStatus)}</td>
            <td>
                ${renderActionsCell("user", r.UserID, mode, r.UserName)}
                ${
                    mode !== "archived"
                        ? `<button class="btn-icon" title="Toggle Active/Inactive"
                              onclick="toggleUserStatus(${Number(r.UserID)}, '${r.UserStatus === "Active" ? "Inactive" : "Active"}')"
                           >⇄</button>`
                        : ""
                }
            </td>
        `
    }
};

/* ============================================================
   TABLE LOADING
============================================================ */

async function loadTable(moduleKey, search = "") {

    const module = MODULES[moduleKey];
    if (!module) return;

    const result = await callApi(module.ops.list, { search });

    const tbody = document.getElementById(module.tableBody);
    if (!tbody) return;

    if (!result.success) {
        tbody.innerHTML = `
            <tr><td colspan="20" class="empty-row">${esc(result.message)}</td></tr>
        `;
        return;
    }

    let rows = result.data || [];
    rows = rows.filter(r => r.IsArchived !== "Yes");

    if (!rows.length) {
        tbody.innerHTML = `
            <tr><td colspan="20" class="empty-row">No records found.</td></tr>
        `;
        return;
    }

    tbody.innerHTML = rows
        .map(r => `<tr>${module.row(r, "list")}</tr>`)
        .join("");
}

function loadStorageLocationTables() {
    loadTable("aisle");
    loadTable("shelf");
    loadTable("bin");
}

/* ============================================================
   ARCHIVED MODAL
============================================================ */

let currentArchivedModuleKey = null;

async function loadArchivedTable(moduleKey) {

    const module = MODULES[moduleKey];
    if (!module) return;

    const tbody = document.getElementById("archived-modal-tbody");
    if (!tbody) return;

    tbody.innerHTML = `
        <tr><td colspan="20" class="empty-row">Loading...</td></tr>
    `;

    const result = await callApi(module.ops.list, {
        search: "",
        archived: true
    });

    if (!result.success) {
        tbody.innerHTML = `
            <tr><td colspan="20" class="empty-row">${esc(result.message)}</td></tr>
        `;
        return;
    }

    const rows = result.data || [];

    if (!rows.length) {
        tbody.innerHTML = `
            <tr><td colspan="20" class="empty-row">No archived records found.</td></tr>
        `;
        return;
    }

    tbody.innerHTML = rows
        .map(r => `<tr>${module.row(r, "archived")}</tr>`)
        .join("");
}

function openArchivedModal(moduleKey) {

    const module = MODULES[moduleKey];
    if (!module) return;

    currentArchivedModuleKey = moduleKey;

    document.getElementById("archived-modal-title").textContent =
        "Archived " + module.title + "s";

    const sourceTable = document
        .getElementById(module.tableBody)
        ?.closest("table");

    const theadTarget = document.getElementById("archived-modal-thead");

    if (sourceTable && theadTarget) {
        theadTarget.innerHTML = sourceTable.querySelector("thead").innerHTML;
    }

    document.getElementById("archived-modal-overlay").classList.add("open");

    loadArchivedTable(moduleKey);
}

function closeArchivedModal() {
    document.getElementById("archived-modal-overlay").classList.remove("open");
    currentArchivedModuleKey = null;
}

/* ============================================================
   RESTORE RECORD
============================================================ */

async function restoreRecord(moduleKey, id, displayName = "") {

    const module = MODULES[moduleKey];
    if (!module) return;

    closeArchivedModal();

    const nameText = displayName && String(displayName).trim() !== ""
        ? `${module.title}: "${displayName}"`
        : `this ${module.title.toLowerCase()}`;

    const returnModuleKey = moduleKey;

    openConfirmModal(
        `Are you sure you want to restore ${nameText}?`,
        {
            title: `Restore ${module.title}`,
            warning: "This record will become active again and will show up in the main list.",
            confirmLabel: "Restore",

            onCancel: () => {
                openArchivedModal(returnModuleKey);
            },

            onConfirm: async () => {

                const result = await callApi("restoreRecord", {
                    table: moduleKey,
                    id: id
                });

                if (!result.success) {
                    showErrorModal(result.message);
                    openArchivedModal(returnModuleKey);
                    return;
                }

                showSuccessModal(result.message || "Record restored successfully.");

                if (moduleKey === "aisle" || moduleKey === "shelf" || moduleKey === "bin") {
                    loadStorageLocationTables();
                } else {
                    loadTable(moduleKey);
                }

                loadAuditLog();
            }
        }
    );
}

/* ============================================================
   OPTIONS
============================================================ */

async function getOptions(sourceKey) {

    switch (sourceKey) {

        case "aisle": {
            const res = await callApi("getAisles", { search: "" });
            return (res.data || [])
                .filter(r => r.IsArchived === "No")
                .map(r => ({ value: r.AisleID, label: r.AisleCode }));
        }

        case "shelf": {
            const res = await callApi("getShelves", { search: "" });
            return (res.data || [])
                .filter(r => r.IsArchived === "No")
                .map(r => ({ value: r.ShelfID, label: `${r.AisleCode} / ${r.ShelfCode}` }));
        }

        case "bin": {
            const res = await callApi("getBins", { search: "" });
            return (res.data || [])
                .filter(r => r.IsArchived === "No")
                .map(r => ({ value: r.BinID, label: `${r.AisleCode} / ${r.ShelfCode} / ${r.BinCode}` }));
        }

        case "category": {
            const res = await callApi("getCategories", { search: "" });
            return (res.data || [])
                .filter(r => r.IsArchived === "No")
                .map(r => ({ value: r.CategoryID, label: r.CategoryName }));
        }

        case "uom": {
            const res = await callApi("getUnitsOfMeasure");
            return (res.data || [])
                .map(r => ({ value: r.UnitOfMeasureID, label: `${r.UnitName} (${r.UnitSymbol || ""})` }));
        }

        case "role": {
            const res = await callApi("getRoles", { search: "" });
            return (res.data || [])
                .filter(r => r.IsArchived === "No")
                .map(r => ({ value: r.RoleID, label: r.RoleName }));
        }

        default:
            return [];
    }
}

/* ============================================================
   FORM MODAL
============================================================ */

let currentModuleKey = null;
let currentEditId = null;

async function openFormModal(moduleKey, id = null) {

    const module = MODULES[moduleKey];
    if (!module) return;

    currentModuleKey = moduleKey;
    currentEditId = id;

    document.getElementById("modal-title").textContent =
        (id ? "Edit " : "Add ") + module.title;

    const body = document.getElementById("modal-body");
    body.innerHTML = `<p class="modal-loading">Loading form...</p>`;

    document.getElementById("modal-overlay").classList.add("open");

    const optionsCache = {};

    for (const field of module.fields) {
        if (field.type === "select" && field.optionsSource) {
            optionsCache[field.name] = await getOptions(field.optionsSource);
        }
    }

    let record = {};

    if (id) {
        const res = await callApi(module.ops.get, { [module.idField]: id });
        if (res.success) record = res.data || {};
    }

    body.innerHTML = module.fields.map((field) => {

        const value = record[field.name] ?? "";
        const requiredMark = field.required ? " *" : "";
        const hint = field.hint
            ? `<small class="field-hint">${esc(field.hint)}</small>`
            : "";

        if (field.type === "select") {

            const opts = field.staticOptions || optionsCache[field.name] || [];

            const optionsHtml = opts.map(o => `
                <option value="${esc(o.value)}"
                    ${String(o.value) === String(value) ? "selected" : ""}>
                    ${esc(o.label)}
                </option>
            `).join("");

            return `
                <div class="form-group">
                    <label>${field.label}${requiredMark}</label>
                    <select id="field-${field.name}">
                        <option value="">-- Select ${field.label} --</option>
                        ${optionsHtml}
                    </select>
                    ${hint}
                </div>
            `;
        }

        if (field.type === "textarea") {
            return `
                <div class="form-group">
                    <label>${field.label}${requiredMark}</label>
                    <textarea id="field-${field.name}" rows="3">${esc(value)}</textarea>
                    ${hint}
                </div>
            `;
        }

        return `
            <div class="form-group">
                <label>${field.label}${requiredMark}</label>
                <input type="${field.type}" id="field-${field.name}"
                    value="${field.type === "password" ? "" : esc(value)}">
                ${hint}
            </div>
        `;

    }).join("");
}

function closeFormModal() {
    document.getElementById("modal-overlay").classList.remove("open");
    currentModuleKey = null;
    currentEditId = null;
}

async function saveRecord() {

    const module = MODULES[currentModuleKey];
    if (!module) return;

    const payload = {};

    for (const field of module.fields) {

        const el = document.getElementById(`field-${field.name}`);
        if (!el) continue;

        if (
            field.required &&
            el.value.trim() === "" &&
            !(currentEditId && field.type === "password")
        ) {
            showErrorModal(`${field.label} is required.`);
            return;
        }

        payload[field.name] = el.value;
    }

    let result;
    const isEdit = Boolean(currentEditId);

    if (isEdit) {
        payload[module.idField] = currentEditId;
        result = await callApi(module.ops.update, payload);
    } else {
        result = await callApi(module.ops.insert, payload);
    }

    if (!result.success) {
        showErrorModal(result.message);
        return;
    }

    const successMessage = result.message ||
        (isEdit ? `${module.title} updated successfully.` : `${module.title} added successfully.`);

    showSuccessModal(successMessage);

    closeFormModal();

    const savedKey = currentModuleKeySafe(module);

    if (savedKey === "aisle" || savedKey === "shelf" || savedKey === "bin") {
        loadStorageLocationTables();
    } else {
        loadTable(savedKey);
    }

    loadAuditLog();
}

function currentModuleKeySafe(moduleObj) {
    return Object.keys(MODULES).find(key => MODULES[key] === moduleObj);
}

/* ============================================================
   CONFIRM MODAL
============================================================ */

let confirmActionCallback = null;
let confirmCancelCallback = null;

function openConfirmModal(message, {
    title = "Confirm Action",
    warning = "This can be reviewed later; archived records are not permanently deleted.",
    confirmLabel = "Archive",
    onConfirm = null,
    onCancel = null
} = {}) {

    document.getElementById("confirm-modal-title").textContent = title;
    document.getElementById("confirm-modal-message").textContent = message;
    document.getElementById("confirm-modal-warning").textContent = warning;

    const btn = document.getElementById("btn-confirm-action");
    btn.textContent = confirmLabel;

    confirmActionCallback = onConfirm;
    confirmCancelCallback = onCancel;

    document.getElementById("confirm-modal-overlay").classList.add("open");
}

function closeConfirmModal(triggerCancel = false) {

    document.getElementById("confirm-modal-overlay").classList.remove("open");

    const confirmCb = confirmActionCallback;
    const cancelCb  = confirmCancelCallback;

    confirmActionCallback = null;
    confirmCancelCallback = null;

    if (triggerCancel && typeof cancelCb === "function") {
        cancelCb();
    }
}

function deleteRecord(moduleKey, id) {

    const module = MODULES[moduleKey];
    if (!module) return;

    openConfirmModal(
        `Are you sure you want to archive this ${module.title.toLowerCase()}?`,
        {
            title: `Archive ${module.title}`,
            confirmLabel: "Archive",
            onConfirm: async () => {

                const result = await callApi(module.ops.delete, {
                    [module.idField]: id
                });

                if (!result.success) {
                    showErrorModal(result.message);
                    return;
                }

                showSuccessModal(result.message ||
                    `${module.title} archived successfully.`);

                if (moduleKey === "aisle" || moduleKey === "shelf" || moduleKey === "bin") {
                    loadStorageLocationTables();
                } else {
                    loadTable(moduleKey);
                }

                loadAuditLog();
            }
        }
    );
}

async function toggleUserStatus(userID, newStatus) {

    const result = await callApi("toggleUserStatus", {
        UserID: userID,
        UserStatus: newStatus
    });

    if (!result.success) {
        showErrorModal(result.message);
        return;
    }

    showSuccessModal(result.message || `User status changed to ${newStatus}.`);

    loadTable("user");
    loadAuditLog();
}

/* ============================================================
   DASHBOARD
============================================================ */

let chartProductsCategory = null;
let chartPoStatus = null;

async function loadDashboard() {

    const result = await callApi("getDashboardStats");

    if (!result.success) {
        console.error(result.message);
        return;
    }

    const s = result.data || {};

    const setText = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    setText("stat-products",    s.totalProducts ?? 0);
    setText("stat-suppliers",   s.totalSuppliers ?? 0);
    setText("stat-categories",  s.totalCategories ?? 0);
    setText("stat-active-users",
        `${s.activeUsers ?? 0} / ${s.totalUsers ?? 0}`);
    setText("stat-pending-po",  s.pendingPOs ?? 0);

    const lowStock = document.getElementById("tbl-low-stock");

    if (lowStock) {
        lowStock.innerHTML = (s.lowStockWatchlist || []).map(p => `
            <tr>
                <td>${esc(p.ProductName)}</td>
                <td>${esc(p.MinStockLevel)}</td>
            </tr>
        `).join("") || `
            <tr><td colspan="2" class="empty-row">No products yet.</td></tr>
        `;
    }

    const activity = document.getElementById("tbl-recent-activity");

    if (activity) {
        activity.innerHTML = (s.recentActivity || []).map(a => `
            <tr>
                <td>${esc(a.UserName || "—")}</td>
                <td>${esc(a.ActionType)}</td>
                <td>${esc(a.TableAffected)}</td>
                <td>${esc(a.ActionTimestamp)}</td>
            </tr>
        `).join("") || `
            <tr><td colspan="4" class="empty-row">No activity yet.</td></tr>
        `;
    }

    await loadDashboardCharts();
}

/* ============================================================
   DASHBOARD CHARTS
============================================================ */

/* ✅ FIX: doughnut "total" label used to be a separate HTML div
   absolutely positioned at 50%/50% of the container. That only
   lines up with the circle when the circle itself is centered
   in the container — but Chart.js shifts the circle to make
   room for the right-side legend, so the circle's real center
   drifts away from 50%/50%, making the label look off to the
   side.

   Fix: draw the "total" text directly on the canvas, centered
   on chart.chartArea (the actual plotted area Chart.js leaves
   after reserving space for the legend). This always lines up
   with the circle, regardless of legend size/position or
   window resizing. */
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
            "800 26px system-ui, -apple-system, sans-serif";
        ctx.fillText(
            String(pluginOptions.value ?? ""),
            centerX,
            centerY - 11
        );

        ctx.fillStyle = pluginOptions.labelColor || "#166534";
        ctx.font = pluginOptions.labelFont ||
            "700 11px system-ui, -apple-system, sans-serif";
        ctx.fillText(
            pluginOptions.label || "",
            centerX,
            centerY + 13
        );

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
        callApi("getPurchaseOrders", { search: "" })
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
                // ✅ FIX: without this, Chart.js's internal resize
                // observer can fight with our own container resizing
                // (especially during the sidebar-collapse transition)
                // and momentarily render at the wrong size.
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

    /* ---------- CHART 2: PO Status (Doughnut) ---------- */

    const pos = (poRes.data || []).filter(p => p.IsArchived !== "Yes");

    const statusCounts = {};
    pos.forEach(p => {
        const status = p.StatusName || "Unknown";
        statusCounts[status] = (statusCounts[status] || 0) + 1;
    });

    const totalPOs = pos.length;

    const statusColorMap = {
        "Completed": "#0E9F6E",
        "Approved":  "#0E9F6E",
        "Pending":   "#D97706",
        "For Review":"#D97706",
        "Submitted":"#D97706",
        "Cancelled": "#DC2626",
        "Canceled":  "#DC2626",
        "Rejected":  "#DC2626",
        "Draft":     "#9CA3AF"
    };

    const statusLabels = Object.keys(statusCounts);
    const statusValues = statusLabels.map(k => statusCounts[k]);
    const statusColors = statusLabels.map(s =>
        statusColorMap[s] || "#9CA3AF"
    );

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
                layout: {
                    padding: 0
                },
                plugins: {
                    legend: {
                        // ✅ FIX: on narrow containers a right-side legend
                        // squeezes the doughnut into a sliver. Switch the
                        // legend to the bottom once the chart area gets
                        // narrow, using Chart.js's own layout callback so
                        // it re-evaluates on every resize automatically.
                        position: (ctxChart) =>
                            ctxChart.chart.width < 340 ? "bottom" : "right",
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
                                const pct = total > 0
                                    ? Math.round((ctx.parsed / total) * 100)
                                    : 0;
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

    // ✅ FIX: a plain "window resize" listener only fires when the
    // browser window itself changes size. It never fires when the
    // *chart's own container* changes size for any other reason —
    // e.g. collapsing/expanding the sidebar, switching dashboard
    // sections back in, or a table growing/shrinking above the
    // charts. A ResizeObserver watches the actual container element,
    // so it correctly catches every one of those cases too, and we
    // keep the window listener as a harmless fallback for browsers
    // without ResizeObserver support.
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

    // Observe the whole dashboard section (covers both chart panels,
    // the sidebar-collapse transition, and any container width change)
    dashboardResizeObserver.observe(dashboardSection);
}

function handleDashboardResize() {
    if (dashboardResizeTimer) clearTimeout(dashboardResizeTimer);
    dashboardResizeTimer = setTimeout(() => {
        if (chartProductsCategory) chartProductsCategory.resize();
        if (chartPoStatus) chartPoStatus.resize();
    }, 150);
}

/* ============================================================
   AUDIT LOG
============================================================ */

async function loadAuditLog(search = "") {

    const result = await callApi("getAuditLogs", { search });

    const tbody = document.getElementById("tbl-audit");
    if (!tbody) return;

    if (!result.success) {
        tbody.innerHTML = `
            <tr><td colspan="5" class="empty-row">${esc(result.message)}</td></tr>
        `;
        return;
    }

    tbody.innerHTML = (result.data || []).map(a => `
        <tr>
            <td>${esc(a.UserName || "—")}</td>
            <td>${esc(a.ActionType)}</td>
            <td>${esc(a.TableAffected)}</td>
            <td>${esc(a.ActionTimestamp)}</td>
            <td>${esc(a.Details)}</td>
        </tr>
    `).join("") || `
        <tr><td colspan="5" class="empty-row">No audit records found.</td></tr>
    `;
}

/* ============================================================
   TRANSACTIONS
============================================================ */

let statusOptionsCache = null;

async function getStatusOptions() {

    if (statusOptionsCache) return statusOptionsCache;

    const res = await callApi("getStatuses", { search: "" });

    statusOptionsCache = (res.data || [])
        .filter(s => s.IsArchived === "No");

    return statusOptionsCache;
}

function buildStatusActionCell(transactionTable, recordID, currentStatusID, statusOptions) {

    const selectId = `txn-status-${transactionTable}-${recordID}`;

    const optionsHtml = statusOptions.map(s => `
        <option value="${esc(s.StatusID)}"
            ${String(s.StatusID) === String(currentStatusID) ? "selected" : ""}>
            ${esc(s.StatusName)}
        </option>
    `).join("");

    return `
        <select class="status-select" id="${selectId}">
            ${optionsHtml}
        </select>
        <button class="btn-icon" title="Update Status"
            onclick="changeTransactionStatus('${transactionTable}', ${Number(recordID)}, '${selectId}')"
        >✔</button>
    `;
}

async function changeTransactionStatus(transactionTable, recordID, selectId) {

    const select = document.getElementById(selectId);
    if (!select) return;

    const statusID = select.value;

    if (!statusID) {
        showWarningModal("Please select a status.");
        return;
    }

    const result = await callApi("updateTransactionStatus", {
        transactionTable,
        recordID,
        statusID
    });

    if (!result.success) {
        showErrorModal(result.message);
        return;
    }

    showSuccessModal(result.message || "Transaction status updated successfully.");

    loadTransactions();
    loadAuditLog();
}

async function loadTransactions() {

    const statusOptions = await getStatusOptions();

    const po = await callApi("getPurchaseOrders");
    const poBody = document.getElementById("tbl-po");

    if (poBody) {
        poBody.innerHTML = (po.data || []).map(r => `
            <tr>
                <td>${esc(r.PO_ID)}</td>
                <td>${esc(r.PO_Date)}</td>
                <td>${esc(r.Expected_Date)}</td>
                <td>${esc(r.SupplierName)}</td>
                <td>${esc(r.UserName)}</td>
                <td>${statusBadge(r.StatusName)}</td>
                <td>${buildStatusActionCell("purchase_order", r.PO_ID, r.StatusID, statusOptions)}</td>
            </tr>
        `).join("") || `
            <tr><td colspan="7" class="empty-row">No purchase orders found.</td></tr>
        `;
    }

    const recv = await callApi("getReceivings");
    const recvBody = document.getElementById("tbl-recv");

    if (recvBody) {
        recvBody.innerHTML = (recv.data || []).map(r => `
            <tr>
                <td>${esc(r.ReceivingID)}</td>
                <td>${esc(r.ReceivingDate)}</td>
                <td>${esc(r.SupplierName)}</td>
                <td>${esc(r.UserName)}</td>
                <td>${esc(r.PO_Reference)}</td>
                <td>${statusBadge(r.StatusName)}</td>
                <td>${buildStatusActionCell("receiving", r.ReceivingID, r.StatusID, statusOptions)}</td>
            </tr>
        `).join("") || `
            <tr><td colspan="7" class="empty-row">No receiving records found.</td></tr>
        `;
    }

    const rel = await callApi("getStockReleases");
    const relBody = document.getElementById("tbl-release");

    if (relBody) {
        relBody.innerHTML = (rel.data || []).map(r => `
            <tr>
                <td>${esc(r.ReleaseID)}</td>
                <td>${esc(r.ReleaseDate || "—")}</td>
                <td>${esc(r.RequestedBy)}</td>
                <td>${esc(r.ReleasedBy || "—")}</td>
                <td>${statusBadge(r.StatusName)}</td>
                <td>${buildStatusActionCell("stock_release", r.ReleaseID, r.StatusID, statusOptions)}</td>
            </tr>
        `).join("") || `
            <tr><td colspan="6" class="empty-row">No stock releases found.</td></tr>
        `;
    }

    const ret = await callApi("getStockReturns");
    const retBody = document.getElementById("tbl-return");

    if (retBody) {
        retBody.innerHTML = (ret.data || []).map(r => `
            <tr>
                <td>${esc(r.Stock_Return_ID)}</td>
                <td>${esc(r.Return_Date)}</td>
                <td>${esc(r.UserName)}</td>
                <td>${esc(r.Reason)}</td>
                <td>${statusBadge(r.StatusName)}</td>
                <td>${buildStatusActionCell("stock_return", r.Stock_Return_ID, r.StatusID, statusOptions)}</td>
            </tr>
        `).join("") || `
            <tr><td colspan="6" class="empty-row">No stock returns found.</td></tr>
        `;
    }

    const adj = await callApi("getInventoryAdjustments");
    const adjBody = document.getElementById("tbl-adjust");

    if (adjBody) {
        adjBody.innerHTML = (adj.data || []).map(r => `
            <tr>
                <td>${esc(r.Adjustment_ID)}</td>
                <td>${esc(r.Adjustment_Date)}</td>
                <td>${esc(r.UserName)}</td>
                <td>${esc(r.Reason)}</td>
                <td>${statusBadge(r.StatusName)}</td>
                <td>${buildStatusActionCell("inventory_adjustment", r.Adjustment_ID, r.StatusID, statusOptions)}</td>
            </tr>
        `).join("") || `
            <tr><td colspan="6" class="empty-row">No inventory adjustments found.</td></tr>
        `;
    }
}

/* ============================================================
   SECTION SWITCHING
============================================================ */

function switchSection(targetId) {

    document.querySelectorAll(".page-section")
        .forEach(el => el.classList.remove("active-section"));

    const target = document.getElementById(targetId);
    if (!target) return;

    target.classList.add("active-section");

    document.querySelectorAll(".nav-link")
        .forEach(el => el.classList.remove("active"));

    const nav = document.querySelector(`.nav-link[data-target="${targetId}"]`);
    if (nav) nav.classList.add("active");

    const title = document.getElementById("page-title");
    if (title) title.textContent = sectionTitles[targetId] || "";

    closeSidebar();

    if (targetId === "section-dashboard") {
        loadDashboard();
        // ✅ FIX: the section was just switched back to "display: block"
        // after being "display: none". Chart.js can compute the wrong
        // size for a canvas that was hidden when it was created/resized,
        // so force one more resize pass once the layout has settled.
        requestAnimationFrame(() => {
            handleDashboardResize();
        });
    } else if (targetId === "section-storage-location") {
        loadStorageLocationTables();
    } else if (targetId === "section-transactions") {
        loadTransactions();
    } else if (targetId === "section-audit") {
        loadAuditLog();
    } else {
        const key = Object.keys(MODULES)
            .find(k => `section-${k}` === targetId);
        if (key) loadTable(key);
    }
}

/* ============================================================
   ✅ DASHBOARD → SECTION NAVIGATION
   Lets the dashboard's stat cards and charts act as shortcuts:
   clicking/tapping "Total Products" jumps straight to Products,
   the "Products by Category" chart jumps to Categories, etc.
   Reuses switchSection() (and the nav-link highlighting/tab
   logic it already does) instead of duplicating it.
============================================================ */

function goToSection(targetId, tabId = null) {

    const navBtn = document.querySelector(`.nav-link[data-target="${targetId}"]`);
    if (navBtn) {
        navBtn.click();
    } else {
        switchSection(targetId);
    }

    if (tabId) {
        // Give switchSection's loadTransactions() a tick to finish
        // rendering the tab panels before we select one.
        requestAnimationFrame(() => {
            const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
            if (tabBtn) tabBtn.click();
        });
    }
}
/* ============================================================
   SUPPLIER PRODUCTS
============================================================ */

let currentSupplierIDForProducts = null;

async function openSupplierProductsModal(supplierId, supplierName) {
    currentSupplierIDForProducts = supplierId;

    document.getElementById("supplier-products-modal-title").textContent =
        `Products — ${supplierName}`;

    const productsRes = await callApi("getProducts", { search: "" });
    const allProducts = (productsRes.data || []).filter(p => p.IsArchived !== "Yes");

    const select = document.getElementById("supplier-product-select");
    select.innerHTML = `<option value="">-- Select Product --</option>` +
        allProducts.map(p => `<option value="${p.ProductID}">${esc(p.ProductName)}</option>`).join("");

    document.getElementById("supplier-lead-time").value = "";

    document.getElementById("supplier-products-modal-overlay").classList.add("open");

    loadSupplierProducts(supplierId);
}

async function loadSupplierProducts(supplierId) {
    const tbody = document.getElementById("tbl-supplier-products");
    tbody.innerHTML = `<tr><td colspan="3" class="empty-row">Loading...</td></tr>`;

    const result = await callApi("getSupplierProducts", { SupplierID: supplierId });

    if (!result.success) {
        tbody.innerHTML = `<tr><td colspan="3" class="empty-row">${esc(result.message)}</td></tr>`;
        return;
    }

    const rows = result.data || [];

    tbody.innerHTML = rows.length
        ? rows.map(r => `
            <tr>
                <td>${esc(r.ProductName)}</td>
                <td>${esc(r.LeadTimeDays)} day(s)</td>
                <td>
                    <button class="btn-icon btn-icon-danger" title="Remove"
                        onclick="removeSupplierProduct(${Number(r.SupplierProductID)})">🗑</button>
                </td>
            </tr>
        `).join("")
        : `<tr><td colspan="3" class="empty-row">No products linked yet.</td></tr>`;
}

async function addSupplierProduct() {
    const select = document.getElementById("supplier-product-select");
    const leadTimeInput = document.getElementById("supplier-lead-time");
    const productId = select.value;

    if (!productId) {
        showWarningModal("Please select a product.");
        return;
    }

    const result = await callApi("insertSupplierProduct", {
        SupplierID: currentSupplierIDForProducts,
        ProductID: productId,
        LeadTimeDays: leadTimeInput.value || 0
    });

    if (!result.success) {
        showErrorModal(result.message);   // dinhi mo-gawas ang "already exists" message
        return;
    }

    showSuccessModal(result.message || "Product added to supplier.");
    select.value = "";
    leadTimeInput.value = "";
    loadSupplierProducts(currentSupplierIDForProducts);
    loadAuditLog();
}

async function removeSupplierProduct(supplierProductId) {
    const result = await callApi("deleteSupplierProduct", {
        SupplierProductID: supplierProductId
    });

    if (!result.success) {
        showErrorModal(result.message);
        return;
    }

    showSuccessModal(result.message || "Product removed.");
    loadSupplierProducts(currentSupplierIDForProducts);
    loadAuditLog();
}

function closeSupplierProductsModal() {
    document.getElementById("supplier-products-modal-overlay").classList.remove("open");
    currentSupplierIDForProducts = null;
}
/* ============================================================
   SEARCH SETUP
============================================================ */

function setupSearches() {

    Object.entries(MODULES).forEach(([key, module]) => {

        const input = document.getElementById(module.searchInput);
        if (!input) return;

        let timer = null;

        input.addEventListener("input", () => {
            clearTimeout(timer);
            timer = setTimeout(() => loadTable(key, input.value), 300);
        });
    });

    const auditSearch = document.getElementById("search-audit");

    if (auditSearch) {
        let timer = null;
        auditSearch.addEventListener("input", () => {
            clearTimeout(timer);
            timer = setTimeout(() => loadAuditLog(auditSearch.value), 300);
        });
    }
}

/* ============================================================
   SIDEBAR
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

/* ============================================================
   SIDEBAR PROFILE MENU (Log Out)
   Opens on hover (desktop, handled purely in CSS) and on
   click/tap or keyboard (handled here so touch and
   keyboard/screen-reader users can reach it too). "Log Out"
   itself never logs out directly — it opens the shared confirm
   modal first, and only calls logout() if the admin confirms.
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
            warning: "You will need to sign in again to access the admin panel.",
            confirmLabel: "Log Out",
            onConfirm: () => {
                logout();
            }
        }
    );
}

/* ============================================================
   INIT
============================================================ */

document.addEventListener("DOMContentLoaded", () => {

    document.querySelectorAll(".nav-link").forEach(btn => {
        btn.addEventListener("click", () => switchSection(btn.dataset.target));
    });

    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active-tab"));
            btn.classList.add("active");
            const tab = document.getElementById(btn.dataset.tab);
            if (tab) tab.classList.add("active-tab");
        });
    });

    setupSearches();

    const displayName = (
        currentUser?.FirstName || currentUser?.UserName || "Admin"
    );
    const fullDisplayName = currentUser?.FirstName
        ? `${currentUser.FirstName} ${currentUser.LastName || ""}`.trim()
        : (currentUser?.UserName || "Admin");

    const welcome = document.getElementById("welcome-text");
    if (welcome) welcome.textContent = `Welcome, ${displayName}`;

    const profileName = document.getElementById("sidebar-profile-name");
    if (profileName) profileName.textContent = fullDisplayName;

    const profileRole = document.getElementById("sidebar-profile-role");
    if (profileRole) profileRole.textContent = currentUser?.RoleName || "Administrator";

    const profileAvatar = document.getElementById("sidebar-profile-avatar");
    if (profileAvatar) {
        profileAvatar.textContent = fullDisplayName.trim().charAt(0).toUpperCase() || "A";
    }

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

    /* ✅ SIDEBAR COLLAPSE TOGGLE */
    const sidebarToggle = document.getElementById("sidebar-toggle");
    const sidebarEl = document.getElementById("sidebar");

    if (sidebarToggle && sidebarEl) {

        const savedState = localStorage.getItem("sidebarCollapsed");
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

            localStorage.setItem("sidebarCollapsed", isCollapsed ? "true" : "false");
            closeProfileMenu();

            // ✅ FIX: the sidebar width change is animated (CSS
            // transition), so the container doesn't reach its final
            // size immediately. The ResizeObserver set up in
            // loadDashboardCharts() will keep firing as the sidebar
            // animates, but we still kick off one resize right away
            // and one after the transition ends for a crisp result.
            handleDashboardResize();
            setTimeout(() => {
                if (chartProductsCategory) chartProductsCategory.resize();
                if (chartPoStatus) chartPoStatus.resize();
            }, 300);
        });
    }

    /* ✅ SIDEBAR PROFILE / LOGOUT MENU */
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

    // Close the profile menu on outside click, and on Escape.
    document.addEventListener("click", (e) => {
        if (profileEl && !profileEl.contains(e.target)) {
            closeProfileMenu();
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeProfileMenu();
    });

    const saveBtn = document.getElementById("btn-save-record");
    if (saveBtn) saveBtn.addEventListener("click", saveRecord);

    const overlay = document.getElementById("modal-overlay");
    if (overlay) {
        overlay.addEventListener("click", e => {
            if (e.target.id === "modal-overlay") closeFormModal();
        });
    }

    const confirmBtn = document.getElementById("btn-confirm-action");
    if (confirmBtn) {
        confirmBtn.addEventListener("click", () => {
            const callback = confirmActionCallback;
            closeConfirmModal(false);
            if (callback) callback();
        });
    }

    const confirmCancelBtns = document.querySelectorAll(
        '#confirm-modal-overlay .modal-footer .btn-outline-secondary, ' +
        '#confirm-modal-overlay .modal-header .modal-close'
    );
    confirmCancelBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            closeConfirmModal(true);
        });
    });

    const confirmOverlay = document.getElementById("confirm-modal-overlay");
    if (confirmOverlay) {
        confirmOverlay.addEventListener("click", e => {
            if (e.target.id === "confirm-modal-overlay") {
                closeConfirmModal(true);
            }
        });
    }

    const archivedOverlay = document.getElementById("archived-modal-overlay");
    if (archivedOverlay) {
        archivedOverlay.addEventListener("click", e => {
            if (e.target.id === "archived-modal-overlay") closeArchivedModal();
        });
    }

    const messageOverlay = document.getElementById("message-modal-overlay");
    if (messageOverlay) {
        messageOverlay.addEventListener("click", e => {
            if (e.target.id === "message-modal-overlay") hideMessageModal();
        });
    }

    document.addEventListener("keydown", e => {
        if (e.key === "Escape") hideMessageModal();
    });

    loadDashboard();
});