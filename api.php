<?php

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");
header("Access-Control-Allow-Credentials: true");
header("Content-Type: application/json; charset=UTF-8");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") {
    http_response_code(200);
    exit;
}

$host   = "127.0.0.1";
$dbname = "grocery_warehouse_db";
$dbuser = "root";
$dbpass = "";

try {
    $conn = new PDO(
        "mysql:host=$host;dbname=$dbname;charset=utf8mb4",
        $dbuser,
        $dbpass
    );
    $conn->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $conn->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
} catch (PDOException $e) {
    response(false, "Database connection failed: " . $e->getMessage(), null);
}

function response($success, $message = "", $data = null)
{
    echo json_encode([
        "success" => $success,
        "message" => $message,
        "data"    => $data
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$input = [];

$rawInput = file_get_contents("php://input");
if (!empty($rawInput)) {
    $decoded = json_decode($rawInput, true);
    if (is_array($decoded)) $input = $decoded;
}

if (isset($_POST["json"]) && !empty($_POST["json"])) {
    $jsonData = json_decode($_POST["json"], true);
    if (is_array($jsonData)) $input = array_merge($input, $jsonData);
}

if (!empty($_POST) && empty($input)) $input = $_POST;
if (empty($input) && !empty($_GET)) $input = $_GET;

$operation = $input["operation"] ?? $_POST["operation"] ?? $_GET["operation"] ?? "";

function getCurrentUserID($data)
{
    if (isset($data["LoggedInUserID"]) && intval($data["LoggedInUserID"]) > 0)
        return intval($data["LoggedInUserID"]);
    if (isset($data["UserID"]) && intval($data["UserID"]) > 0)
        return intval($data["UserID"]);
    return 0;
}

function requireAdmin($conn, $currentUserID)
{
    if (!$currentUserID || intval($currentUserID) <= 0) {
        response(false, "Admin access required.", null);
    }

    try {
        $stmt = $conn->prepare("
            SELECT
                u.UserID, u.UserName, u.UserStatus,
                u.IsArchived AS UserArchived, u.RoleID,
                r.RoleName, r.IsArchived AS RoleArchived
            FROM `user` u
            LEFT JOIN `role` r ON u.RoleID = r.RoleID
            WHERE u.UserID = :UserID LIMIT 1
        ");
        $stmt->execute([":UserID" => intval($currentUserID)]);
        $user = $stmt->fetch();

        if (!$user) response(false, "User account not found.", null);
        if (strtolower(trim($user["UserArchived"] ?? "")) === "yes")
            response(false, "Your account is archived.", null);
        if (strtolower(trim($user["UserStatus"] ?? "")) !== "active")
            response(false, "Your account is inactive.", null);
        if (strtolower(trim($user["RoleArchived"] ?? "")) === "yes")
            response(false, "Your role is archived.", null);

        $roleName = strtolower(trim($user["RoleName"] ?? ""));
        if ($roleName !== "admin" && $roleName !== "administrator") {
            response(false, "Admin access required. Current role: " . ($user["RoleName"] ?? "No Role"), null);
        }

        return $user;
    } catch (PDOException $e) {
        response(false, "Admin verification error: " . $e->getMessage(), null);
    }
}

function addAudit($conn, $userID, $action, $table, $details = "")
{
    if ($userID <= 0) return;
    try {
        $stmt = $conn->prepare("
            INSERT INTO auditlog
            (UserID, ActionType, TableAffected, ActionTimestamp, Details, IsArchived)
            VALUES (:userid, :action, :tablename, NOW(), :details, 'No')
        ");
        $stmt->execute([
            ":userid"    => $userID,
            ":action"    => $action,
            ":tablename" => $table,
            ":details"   => $details
        ]);
    } catch (Exception $e) {}
}

function getSearch($input)
{
    return isset($input["search"]) ? trim($input["search"]) : "";
}

function getArchivedFilter($input)
{
    return isset($input["archived"]) && (
        $input["archived"] === true ||
        $input["archived"] === 1 ||
        $input["archived"] === "1" ||
        $input["archived"] === "Yes" ||
        $input["archived"] === "true"
    );
}

function isDuplicate($conn, $table, $column, $value, $excludeID = 0, $excludeColumn = "id")
{
    $value = trim($value);
    if ($value === "") return false;

    try {
        $sql = "SELECT COUNT(*) AS total FROM `$table`
                WHERE LOWER(TRIM($column)) = LOWER(TRIM(:value))";

        if ($excludeID > 0) {
            $sql .= " AND `$excludeColumn` <> :excludeid";
        }

        $stmt = $conn->prepare($sql);
        $params = [":value" => $value];
        if ($excludeID > 0) $params[":excludeid"] = $excludeID;

        $stmt->execute($params);
        return intval($stmt->fetch()["total"]) > 0;
    } catch (Exception $e) {
        return false;
    }
}

function getRecordDisplayName($conn, $table, $pkColumn, $id)
{
    try {
        switch ($table) {

            case "role": {
                $stmt = $conn->prepare("SELECT RoleName FROM role WHERE $pkColumn = :id LIMIT 1");
                $stmt->execute([":id" => $id]);
                $row = $stmt->fetch();
                return $row ? "Role: " . $row["RoleName"] : "Role ID $id";
            }

            case "status": {
                $stmt = $conn->prepare("SELECT StatusName FROM status WHERE $pkColumn = :id LIMIT 1");
                $stmt->execute([":id" => $id]);
                $row = $stmt->fetch();
                return $row ? "Status: " . $row["StatusName"] : "Status ID $id";
            }

            case "category": {
                $stmt = $conn->prepare("SELECT CategoryName FROM category WHERE $pkColumn = :id LIMIT 1");
                $stmt->execute([":id" => $id]);
                $row = $stmt->fetch();
                return $row ? "Category: " . $row["CategoryName"] : "Category ID $id";
            }

            case "supplier": {
                $stmt = $conn->prepare("SELECT SupplierName FROM supplier WHERE $pkColumn = :id LIMIT 1");
                $stmt->execute([":id" => $id]);
                $row = $stmt->fetch();
                return $row ? "Supplier: " . $row["SupplierName"] : "Supplier ID $id";
            }

            case "aisle": {
                $stmt = $conn->prepare("SELECT AisleCode FROM aisle WHERE $pkColumn = :id LIMIT 1");
                $stmt->execute([":id" => $id]);
                $row = $stmt->fetch();
                return $row ? "Aisle: " . $row["AisleCode"] : "Aisle ID $id";
            }

            case "shelf": {
                $stmt = $conn->prepare("
                    SELECT s.ShelfCode, a.AisleCode
                    FROM shelf s
                    LEFT JOIN aisle a ON s.AisleID = a.AisleID
                    WHERE s.$pkColumn = :id LIMIT 1
                ");
                $stmt->execute([":id" => $id]);
                $row = $stmt->fetch();
                return $row
                    ? "Shelf: " . $row["AisleCode"] . " / " . $row["ShelfCode"]
                    : "Shelf ID $id";
            }

            case "bin": {
                $stmt = $conn->prepare("
                    SELECT b.BinCode, s.ShelfCode, a.AisleCode
                    FROM bin b
                    LEFT JOIN shelf s ON b.ShelfID = s.ShelfID
                    LEFT JOIN aisle a ON s.AisleID = a.AisleID
                    WHERE b.$pkColumn = :id LIMIT 1
                ");
                $stmt->execute([":id" => $id]);
                $row = $stmt->fetch();
                return $row
                    ? "Bin: " . $row["AisleCode"] . " / " . $row["ShelfCode"] . " / " . $row["BinCode"]
                    : "Bin ID $id";
            }

            case "product": {
                $stmt = $conn->prepare("SELECT ProductName FROM product WHERE $pkColumn = :id LIMIT 1");
                $stmt->execute([":id" => $id]);
                $row = $stmt->fetch();
                return $row ? "Product: " . $row["ProductName"] : "Product ID $id";
            }

            case "user": {
                $stmt = $conn->prepare("SELECT UserName FROM `user` WHERE $pkColumn = :id LIMIT 1");
                $stmt->execute([":id" => $id]);
                $row = $stmt->fetch();
                return $row ? "User: " . $row["UserName"] : "User ID $id";
            }

            case "uom": {
                $stmt = $conn->prepare("SELECT UnitName FROM unit_of_measure WHERE $pkColumn = :id LIMIT 1");
                $stmt->execute([":id" => $id]);
                $row = $stmt->fetch();
                return $row ? "Unit: " . $row["UnitName"] : "Unit ID $id";
            }

            default:
                return "$pkColumn: $id";
        }
    } catch (Exception $e) {
        return "$pkColumn: $id";
    }
}

/* ============================================================
   ✅ NEW HELPER: Human-readable name for a TRANSACTION record
   Used by updateTransactionStatus so the audit log shows the
   actual record (supplier, requester, reason, date) instead
   of a raw numeric ID.
============================================================ */
function getTransactionDisplayName($conn, $transactionTable, $recordID)
{
    try {
        switch ($transactionTable) {

            case "purchase_order": {
                $stmt = $conn->prepare("
                    SELECT po.PO_Date, s.SupplierName
                    FROM purchase_order po
                    LEFT JOIN supplier s ON po.Supplier_ID = s.SupplierID
                    WHERE po.PO_ID = :id LIMIT 1
                ");
                $stmt->execute([":id" => $recordID]);
                $row = $stmt->fetch();
                return $row
                    ? "Purchase Order to " . ($row["SupplierName"] ?: "Unknown Supplier") . " (" . $row["PO_Date"] . ")"
                    : "Purchase Order #$recordID";
            }

            case "receiving": {
                $stmt = $conn->prepare("
                    SELECT r.ReceivingDate, s.SupplierName
                    FROM receiving r
                    LEFT JOIN supplier s ON r.SupplierID = s.SupplierID
                    WHERE r.ReceivingID = :id LIMIT 1
                ");
                $stmt->execute([":id" => $recordID]);
                $row = $stmt->fetch();
                return $row
                    ? "Receiving from " . ($row["SupplierName"] ?: "Unknown Supplier") . " (" . $row["ReceivingDate"] . ")"
                    : "Receiving #$recordID";
            }

            case "stock_release": {
                $stmt = $conn->prepare("
                    SELECT CONCAT(u.FirstName, ' ', u.LastName) AS RequestedBy
                    FROM stock_release sr
                    LEFT JOIN `user` u ON sr.RequestedByUserID = u.UserID
                    WHERE sr.ReleaseID = :id LIMIT 1
                ");
                $stmt->execute([":id" => $recordID]);
                $row = $stmt->fetch();
                return $row
                    ? "Stock Release requested by " . trim($row["RequestedBy"])
                    : "Stock Release #$recordID";
            }

            case "stock_return": {
                $stmt = $conn->prepare("
                    SELECT sr.Reason, CONCAT(u.FirstName, ' ', u.LastName) AS UserName
                    FROM stock_return sr
                    LEFT JOIN `user` u ON sr.User_ID = u.UserID
                    WHERE sr.Stock_Return_ID = :id LIMIT 1
                ");
                $stmt->execute([":id" => $recordID]);
                $row = $stmt->fetch();
                return $row
                    ? "Stock Return by " . trim($row["UserName"]) . " (Reason: " . $row["Reason"] . ")"
                    : "Stock Return #$recordID";
            }

            case "inventory_adjustment": {
                $stmt = $conn->prepare("
                    SELECT ia.Reason, CONCAT(u.FirstName, ' ', u.LastName) AS UserName
                    FROM inventory_adjustment ia
                    LEFT JOIN `user` u ON ia.User_ID = u.UserID
                    WHERE ia.Adjustment_ID = :id LIMIT 1
                ");
                $stmt->execute([":id" => $recordID]);
                $row = $stmt->fetch();
                return $row
                    ? "Inventory Adjustment by " . trim($row["UserName"]) . " (Reason: " . $row["Reason"] . ")"
                    : "Inventory Adjustment #$recordID";
            }

            default:
                return "$transactionTable #$recordID";
        }
    } catch (Exception $e) {
        return "$transactionTable #$recordID";
    }
}

try {

    $currentUserID = getCurrentUserID($input);

    if ($operation === "login") {

        $username = trim($input["Username"] ?? $input["UserName"] ?? $input["username"] ?? "");
        $password = $input["Password"] ?? $input["password"] ?? "";

        if ($username === "" || $password === "") {
            response(false, "Username and password are required.", null);
        }

        $stmt = $conn->prepare("
            SELECT
                u.UserID, u.UserName, u.Password, u.FirstName, u.LastName,
                u.Email, u.RoleID, u.UserStatus, u.CreatedAt, u.IsArchived,
                r.RoleName, r.IsArchived AS RoleArchived
            FROM `user` u
            LEFT JOIN `role` r ON u.RoleID = r.RoleID
            WHERE u.UserName = :username LIMIT 1
        ");
        $stmt->execute([":username" => $username]);
        $user = $stmt->fetch();

        if (!$user) response(false, "Invalid username or password.", null);
        if ($user["IsArchived"] === "Yes") response(false, "This account is archived.", null);
        if (strtolower(trim($user["UserStatus"])) !== "active")
            response(false, "This account is inactive.", null);
        if (!$user["RoleID"] || !$user["RoleName"])
            response(false, "User role is not assigned.", null);
        if ($user["RoleArchived"] === "Yes") response(false, "User role is archived.", null);

        $validPassword = false;

        if (password_verify($password, $user["Password"])) {
            $validPassword = true;
        } else if (hash_equals($user["Password"], $password)) {
            $newHash = password_hash($password, PASSWORD_DEFAULT);
            $conn->prepare("UPDATE `user` SET Password = :password WHERE UserID = :userid")
                 ->execute([":password" => $newHash, ":userid" => $user["UserID"]]);
            $validPassword = true;
        }

        if (!$validPassword) response(false, "Invalid username or password.", null);

        unset($user["Password"], $user["RoleArchived"]);

        addAudit($conn, intval($user["UserID"]), "LOGIN", "user", "Admin logged in.");
        response(true, "Login successful.", $user);
    }

    if ($operation === "logout") {
        if ($currentUserID > 0) {
            addAudit($conn, $currentUserID, "LOGOUT", "user", "Admin logged out.");
        }
        response(true, "Logout successful.", null);
    }

    requireAdmin($conn, $currentUserID);

    /* ============================================================
       DASHBOARD
    ============================================================ */

    if ($operation === "getDashboardStats") {

        $stmt = $conn->query("SELECT COUNT(*) AS total FROM product WHERE IsArchived = 'No'");
        $totalProducts = intval($stmt->fetch()["total"]);

        $stmt = $conn->query("SELECT COUNT(*) AS total FROM supplier WHERE IsArchived = 'No'");
        $totalSuppliers = intval($stmt->fetch()["total"]);

        $stmt = $conn->query("SELECT COUNT(*) AS total FROM category WHERE IsArchived = 'No'");
        $totalCategories = intval($stmt->fetch()["total"]);

        $stmt = $conn->query("SELECT COUNT(*) AS total FROM `user` WHERE IsArchived = 'No'");
        $totalUsers = intval($stmt->fetch()["total"]);

        $stmt = $conn->query("
            SELECT COUNT(*) AS total FROM `user`
            WHERE IsArchived = 'No' AND LOWER(TRIM(UserStatus)) = 'active'
        ");
        $activeUsers = intval($stmt->fetch()["total"]);

        $stmt = $conn->query("
            SELECT COUNT(*) AS total
            FROM purchase_order po
            INNER JOIN status s ON po.Status_ID = s.StatusID
            WHERE po.IsArchived = 'No'
            AND LOWER(TRIM(s.StatusName)) = 'pending'
        ");
        $pendingPOs = intval($stmt->fetch()["total"]);

        $stmt = $conn->query("
            SELECT ProductID, ProductName, MinStockLevel
            FROM product
            WHERE IsArchived = 'No'
            ORDER BY MinStockLevel DESC, ProductName ASC
            LIMIT 5
        ");
        $lowStockWatchlist = $stmt->fetchAll();

        $stmt = $conn->query("
            SELECT
                a.AuditLogID, u.UserName, a.ActionType,
                a.TableAffected, a.ActionTimestamp, a.Details
            FROM auditlog a
            LEFT JOIN `user` u ON a.UserID = u.UserID
            WHERE a.IsArchived = 'No'
            ORDER BY a.ActionTimestamp DESC
            LIMIT 8
        ");
        $recentActivity = $stmt->fetchAll();

        response(true, "Dashboard data loaded.", [
            "totalProducts"     => $totalProducts,
            "totalSuppliers"    => $totalSuppliers,
            "totalCategories"   => $totalCategories,
            "totalUsers"        => $totalUsers,
            "activeUsers"       => $activeUsers,
            "pendingPOs"        => $pendingPOs,
            "lowStockWatchlist" => $lowStockWatchlist,
            "recentActivity"    => $recentActivity
        ]);
    }

    /* ============================================================
       ROLES
    ============================================================ */

    if ($operation === "getRoles") {
        $search   = getSearch($input);
        $archived = getArchivedFilter($input);

        $sql = "SELECT RoleID, RoleName, IsArchived FROM role WHERE IsArchived = :archived";
        if ($search !== "") $sql .= " AND RoleName LIKE :search ";
        $sql .= " ORDER BY RoleName ASC ";

        $stmt = $conn->prepare($sql);
        $params = [":archived" => $archived ? "Yes" : "No"];
        if ($search !== "") $params[":search"] = "%$search%";

        $stmt->execute($params);
        response(true, "Roles loaded.", $stmt->fetchAll());
    }

    if ($operation === "getRole") {
        $id = intval($input["RoleID"] ?? 0);
        $stmt = $conn->prepare("SELECT * FROM role WHERE RoleID = :id LIMIT 1");
        $stmt->execute([":id" => $id]);
        response(true, "Role loaded.", $stmt->fetch());
    }

    if ($operation === "insertRole") {
        $name = trim($input["RoleName"] ?? "");
        if ($name === "") response(false, "Role name is required.", null);

        if (isDuplicate($conn, "role", "RoleName", $name)) {
            response(false, "Role name '$name' already exists. Please use a different name.", null);
        }

        $conn->prepare("INSERT INTO role (RoleName, IsArchived) VALUES (:name, 'No')")
             ->execute([":name" => $name]);

        addAudit($conn, $currentUserID, "INSERT", "role", "Added Role: $name");

        response(true, "Role added successfully.", ["RoleID" => $conn->lastInsertId()]);
    }

    if ($operation === "updateRole") {
        $id   = intval($input["RoleID"] ?? 0);
        $name = trim($input["RoleName"] ?? "");

        if ($id <= 0 || $name === "") response(false, "Invalid role information.", null);

        if (isDuplicate($conn, "role", "RoleName", $name, $id, "RoleID")) {
            response(false, "Role name '$name' already exists. Please use a different name.", null);
        }

        $displayName = getRecordDisplayName($conn, "role", "RoleID", $id);

        $conn->prepare("UPDATE role SET RoleName = :name WHERE RoleID = :id")
             ->execute([":name" => $name, ":id" => $id]);

        addAudit($conn, $currentUserID, "UPDATE", "role", "Updated $displayName");

        response(true, "Role updated successfully.", null);
    }

    if ($operation === "deleteRole") {
        $id = intval($input["RoleID"] ?? 0);
        $displayName = getRecordDisplayName($conn, "role", "RoleID", $id);

        $conn->prepare("UPDATE role SET IsArchived = 'Yes' WHERE RoleID = :id")
             ->execute([":id" => $id]);

        addAudit($conn, $currentUserID, "ARCHIVE", "role", "Archived $displayName");

        response(true, "Role archived successfully.", null);
    }

    /* ============================================================
       STATUSES
    ============================================================ */

    if ($operation === "getStatuses") {
        $search   = getSearch($input);
        $archived = getArchivedFilter($input);

        $sql = "SELECT StatusID, StatusName, IsArchived FROM status WHERE IsArchived = :archived";
        if ($search !== "") $sql .= " AND StatusName LIKE :search ";
        $sql .= " ORDER BY StatusName ASC ";

        $stmt = $conn->prepare($sql);
        $params = [":archived" => $archived ? "Yes" : "No"];
        if ($search !== "") $params[":search"] = "%$search%";

        $stmt->execute($params);
        response(true, "Statuses loaded.", $stmt->fetchAll());
    }

    if ($operation === "getStatus") {
        $id = intval($input["StatusID"] ?? 0);
        $stmt = $conn->prepare("SELECT * FROM status WHERE StatusID = :id LIMIT 1");
        $stmt->execute([":id" => $id]);
        response(true, "Status loaded.", $stmt->fetch());
    }

    if ($operation === "insertStatus") {
        $name = trim($input["StatusName"] ?? "");
        if ($name === "") response(false, "Status name is required.", null);

        if (isDuplicate($conn, "status", "StatusName", $name)) {
            response(false, "Status name '$name' already exists. Please use a different name.", null);
        }

        $conn->prepare("INSERT INTO status (StatusName, IsArchived) VALUES (:name, 'No')")
             ->execute([":name" => $name]);

        addAudit($conn, $currentUserID, "INSERT", "status", "Added Status: $name");

        response(true, "Status added successfully.", ["StatusID" => $conn->lastInsertId()]);
    }

    if ($operation === "updateStatus") {
        $id   = intval($input["StatusID"] ?? 0);
        $name = trim($input["StatusName"] ?? "");

        if ($id <= 0 || $name === "") response(false, "Invalid status information.", null);

        if (isDuplicate($conn, "status", "StatusName", $name, $id, "StatusID")) {
            response(false, "Status name '$name' already exists. Please use a different name.", null);
        }

        $displayName = getRecordDisplayName($conn, "status", "StatusID", $id);

        $conn->prepare("UPDATE status SET StatusName = :name WHERE StatusID = :id")
             ->execute([":name" => $name, ":id" => $id]);

        addAudit($conn, $currentUserID, "UPDATE", "status", "Updated $displayName");

        response(true, "Status updated successfully.", null);
    }

    if ($operation === "deleteStatus") {
        $id = intval($input["StatusID"] ?? 0);
        $displayName = getRecordDisplayName($conn, "status", "StatusID", $id);

        $conn->prepare("UPDATE status SET IsArchived = 'Yes' WHERE StatusID = :id")
             ->execute([":id" => $id]);

        addAudit($conn, $currentUserID, "ARCHIVE", "status", "Archived $displayName");

        response(true, "Status archived successfully.", null);
    }

    /* ============================================================
       CATEGORIES
    ============================================================ */

    if ($operation === "getCategories") {
        $search   = getSearch($input);
        $archived = getArchivedFilter($input);

        $sql = "SELECT CategoryID, CategoryName, IsArchived FROM category WHERE IsArchived = :archived";
        if ($search !== "") $sql .= " AND CategoryName LIKE :search ";
        $sql .= " ORDER BY CategoryName ASC ";

        $stmt = $conn->prepare($sql);
        $params = [":archived" => $archived ? "Yes" : "No"];
        if ($search !== "") $params[":search"] = "%$search%";

        $stmt->execute($params);
        response(true, "Categories loaded.", $stmt->fetchAll());
    }

    if ($operation === "getCategory") {
        $id = intval($input["CategoryID"] ?? 0);
        $stmt = $conn->prepare("SELECT * FROM category WHERE CategoryID = :id LIMIT 1");
        $stmt->execute([":id" => $id]);
        response(true, "Category loaded.", $stmt->fetch());
    }

    if ($operation === "insertCategory") {
        $name = trim($input["CategoryName"] ?? "");
        if ($name === "") response(false, "Category name is required.", null);

        if (isDuplicate($conn, "category", "CategoryName", $name)) {
            response(false, "Category name '$name' already exists. Please use a different name.", null);
        }

        $conn->prepare("INSERT INTO category (CategoryName, IsArchived) VALUES (:name, 'No')")
             ->execute([":name" => $name]);

        addAudit($conn, $currentUserID, "INSERT", "category", "Added Category: $name");

        response(true, "Category added successfully.", ["CategoryID" => $conn->lastInsertId()]);
    }

    if ($operation === "updateCategory") {
        $id   = intval($input["CategoryID"] ?? 0);
        $name = trim($input["CategoryName"] ?? "");

        if ($id <= 0 || $name === "") response(false, "Invalid category information.", null);

        if (isDuplicate($conn, "category", "CategoryName", $name, $id, "CategoryID")) {
            response(false, "Category name '$name' already exists. Please use a different name.", null);
        }

        $displayName = getRecordDisplayName($conn, "category", "CategoryID", $id);

        $conn->prepare("UPDATE category SET CategoryName = :name WHERE CategoryID = :id")
             ->execute([":name" => $name, ":id" => $id]);

        addAudit($conn, $currentUserID, "UPDATE", "category", "Updated $displayName");

        response(true, "Category updated successfully.", null);
    }

    if ($operation === "deleteCategory") {
        $id = intval($input["CategoryID"] ?? 0);
        $displayName = getRecordDisplayName($conn, "category", "CategoryID", $id);

        $conn->prepare("UPDATE category SET IsArchived = 'Yes' WHERE CategoryID = :id")
             ->execute([":id" => $id]);

        addAudit($conn, $currentUserID, "ARCHIVE", "category", "Archived $displayName");

        response(true, "Category archived successfully.", null);
    }

    /* ============================================================
       SUPPLIERS
    ============================================================ */

    if ($operation === "getSuppliers") {
        $search   = getSearch($input);
        $archived = getArchivedFilter($input);

        $sql = "
            SELECT SupplierID, SupplierName, ContactPerson, Phone, Email, Address, IsArchived
            FROM supplier WHERE IsArchived = :archived
        ";

        if ($search !== "") {
            $sql .= " AND (SupplierName LIKE :search OR ContactPerson LIKE :search2
                     OR Phone LIKE :search3 OR Email LIKE :search4) ";
        }

        $sql .= " ORDER BY SupplierName ASC ";

        $stmt = $conn->prepare($sql);
        $params = [":archived" => $archived ? "Yes" : "No"];
        if ($search !== "") {
            $params[":search"]  = "%$search%";
            $params[":search2"] = "%$search%";
            $params[":search3"] = "%$search%";
            $params[":search4"] = "%$search%";
        }

        $stmt->execute($params);
        response(true, "Suppliers loaded.", $stmt->fetchAll());
    }

    if ($operation === "getSupplier") {
        $id = intval($input["SupplierID"] ?? 0);
        $stmt = $conn->prepare("SELECT * FROM supplier WHERE SupplierID = :id LIMIT 1");
        $stmt->execute([":id" => $id]);
        response(true, "Supplier loaded.", $stmt->fetch());
    }

    if ($operation === "insertSupplier") {
        $name = trim($input["SupplierName"] ?? "");
        if ($name === "") response(false, "Supplier name is required.", null);

        if (isDuplicate($conn, "supplier", "SupplierName", $name)) {
            response(false, "Supplier name '$name' already exists. Please use a different name.", null);
        }

        $conn->prepare("
            INSERT INTO supplier (SupplierName, ContactPerson, Phone, Email, Address, IsArchived)
            VALUES (:name, :contact, :phone, :email, :address, 'No')
        ")->execute([
            ":name"    => $name,
            ":contact" => trim($input["ContactPerson"] ?? ""),
            ":phone"   => trim($input["Phone"] ?? ""),
            ":email"   => trim($input["Email"] ?? ""),
            ":address" => trim($input["Address"] ?? "")
        ]);

        addAudit($conn, $currentUserID, "INSERT", "supplier", "Added Supplier: $name");

        response(true, "Supplier added successfully.", ["SupplierID" => $conn->lastInsertId()]);
    }

    if ($operation === "updateSupplier") {
        $id   = intval($input["SupplierID"] ?? 0);
        $name = trim($input["SupplierName"] ?? "");

        if ($id <= 0 || $name === "") response(false, "Invalid supplier information.", null);

        if (isDuplicate($conn, "supplier", "SupplierName", $name, $id, "SupplierID")) {
            response(false, "Supplier name '$name' already exists. Please use a different name.", null);
        }

        $displayName = getRecordDisplayName($conn, "supplier", "SupplierID", $id);

        $conn->prepare("
            UPDATE supplier
            SET SupplierName = :name, ContactPerson = :contact,
                Phone = :phone, Email = :email, Address = :address
            WHERE SupplierID = :id
        ")->execute([
            ":name"    => $name,
            ":contact" => trim($input["ContactPerson"] ?? ""),
            ":phone"   => trim($input["Phone"] ?? ""),
            ":email"   => trim($input["Email"] ?? ""),
            ":address" => trim($input["Address"] ?? ""),
            ":id"      => $id
        ]);

        addAudit($conn, $currentUserID, "UPDATE", "supplier", "Updated $displayName");

        response(true, "Supplier updated successfully.", null);
    }

    if ($operation === "deleteSupplier") {
        $id = intval($input["SupplierID"] ?? 0);
        $displayName = getRecordDisplayName($conn, "supplier", "SupplierID", $id);

        $conn->prepare("UPDATE supplier SET IsArchived = 'Yes' WHERE SupplierID = :id")
             ->execute([":id" => $id]);

        addAudit($conn, $currentUserID, "ARCHIVE", "supplier", "Archived $displayName");

        response(true, "Supplier archived successfully.", null);
    }

	/* ============================================================
   SUPPLIER PRODUCTS
============================================================ */

if ($operation === "getSupplierProducts") {
    $supplierID = intval($input["SupplierID"] ?? 0);
    if ($supplierID <= 0) response(false, "Invalid supplier ID.", null);

    $stmt = $conn->prepare("
        SELECT sp.SupplierProductID, sp.SupplierID, sp.ProductID,
               sp.LeadTimeDays, p.ProductName, p.Barcode, sp.IsArchived
        FROM supplier_product sp
        INNER JOIN product p ON sp.ProductID = p.ProductID
        WHERE sp.SupplierID = :supplierid AND sp.IsArchived = 'No'
        ORDER BY p.ProductName ASC
    ");
    $stmt->execute([":supplierid" => $supplierID]);
    response(true, "Supplier products loaded.", $stmt->fetchAll());
}

if ($operation === "insertSupplierProduct") {
    $supplierID   = intval($input["SupplierID"] ?? 0);
    $productID    = intval($input["ProductID"] ?? 0);
    $leadTimeDays = intval($input["LeadTimeDays"] ?? 0);

    if ($supplierID <= 0 || $productID <= 0) {
        response(false, "Supplier and product are required.", null);
    }

    // ✅ Validation: dili na maka-add ug product nga naa na sa supplier
    $checkStmt = $conn->prepare("
        SELECT COUNT(*) AS total FROM supplier_product
        WHERE SupplierID = :supplierid AND ProductID = :productid AND IsArchived = 'No'
    ");
    $checkStmt->execute([":supplierid" => $supplierID, ":productid" => $productID]);
    if (intval($checkStmt->fetch()["total"]) > 0) {
        response(false, "This product is already added for this supplier.", null);
    }

    $conn->prepare("
        INSERT INTO supplier_product (SupplierID, ProductID, LeadTimeDays, IsArchived)
        VALUES (:supplierid, :productid, :leadtime, 'No')
    ")->execute([
        ":supplierid" => $supplierID,
        ":productid"  => $productID,
        ":leadtime"   => $leadTimeDays
    ]);

    $supplierName = getRecordDisplayName($conn, "supplier", "SupplierID", $supplierID);
    $productName  = getRecordDisplayName($conn, "product", "ProductID", $productID);

    addAudit($conn, $currentUserID, "INSERT", "supplier_product",
        "Linked $productName to $supplierName");

    response(true, "Product added to supplier successfully.",
        ["SupplierProductID" => $conn->lastInsertId()]);
}

if ($operation === "deleteSupplierProduct") {
    $id = intval($input["SupplierProductID"] ?? 0);
    if ($id <= 0) response(false, "Invalid record.", null);

    $conn->prepare("UPDATE supplier_product SET IsArchived = 'Yes' WHERE SupplierProductID = :id")
         ->execute([":id" => $id]);

    addAudit($conn, $currentUserID, "ARCHIVE", "supplier_product",
        "Removed supplier-product link #$id");

    response(true, "Product removed from supplier.", null);
}

    if ($operation === "getAisles") {
        $search   = getSearch($input);
        $archived = getArchivedFilter($input);

        $sql = "SELECT AisleID, AisleCode, IsArchived FROM aisle WHERE IsArchived = :archived";
        if ($search !== "") $sql .= " AND AisleCode LIKE :search ";
        $sql .= " ORDER BY AisleCode ASC ";

        $stmt = $conn->prepare($sql);
        $params = [":archived" => $archived ? "Yes" : "No"];
        if ($search !== "") $params[":search"] = "%$search%";

        $stmt->execute($params);
        response(true, "Aisles loaded.", $stmt->fetchAll());
    }

    if ($operation === "getAisle") {
        $id = intval($input["AisleID"] ?? 0);
        $stmt = $conn->prepare("SELECT * FROM aisle WHERE AisleID = :id LIMIT 1");
        $stmt->execute([":id" => $id]);
        response(true, "Aisle loaded.", $stmt->fetch());
    }

    if ($operation === "insertAisle") {
        $code = trim($input["AisleCode"] ?? "");
        if ($code === "") response(false, "Aisle code is required.", null);

        if (isDuplicate($conn, "aisle", "AisleCode", $code)) {
            response(false, "Aisle code '$code' already exists. Please use a different code.", null);
        }

        $conn->prepare("INSERT INTO aisle (AisleCode, IsArchived) VALUES (:code, 'No')")
             ->execute([":code" => $code]);

        addAudit($conn, $currentUserID, "INSERT", "aisle", "Added Aisle: $code");

        response(true, "Aisle added successfully.", ["AisleID" => $conn->lastInsertId()]);
    }

    if ($operation === "updateAisle") {
        $id   = intval($input["AisleID"] ?? 0);
        $code = trim($input["AisleCode"] ?? "");

        if ($id <= 0 || $code === "") response(false, "Invalid aisle information.", null);

        if (isDuplicate($conn, "aisle", "AisleCode", $code, $id, "AisleID")) {
            response(false, "Aisle code '$code' already exists. Please use a different code.", null);
        }

        $displayName = getRecordDisplayName($conn, "aisle", "AisleID", $id);

        $conn->prepare("UPDATE aisle SET AisleCode = :code WHERE AisleID = :id")
             ->execute([":code" => $code, ":id" => $id]);

        addAudit($conn, $currentUserID, "UPDATE", "aisle", "Updated $displayName");

        response(true, "Aisle updated successfully.", null);
    }

    if ($operation === "deleteAisle") {
        $id = intval($input["AisleID"] ?? 0);
        $displayName = getRecordDisplayName($conn, "aisle", "AisleID", $id);

        $conn->prepare("UPDATE aisle SET IsArchived = 'Yes' WHERE AisleID = :id")
             ->execute([":id" => $id]);

        addAudit($conn, $currentUserID, "ARCHIVE", "aisle", "Archived $displayName");

        response(true, "Aisle archived successfully.", null);
    }

    /* ============================================================
       SHELVES
    ============================================================ */

    if ($operation === "getShelves") {
        $search   = getSearch($input);
        $archived = getArchivedFilter($input);

        $sql = "
            SELECT s.ShelfID, s.AisleID, a.AisleCode, s.ShelfCode, s.IsArchived
            FROM shelf s
            LEFT JOIN aisle a ON s.AisleID = a.AisleID
            WHERE s.IsArchived = :archived
        ";

        if ($search !== "") {
            $sql .= " AND (s.ShelfCode LIKE :search OR a.AisleCode LIKE :search2) ";
        }

        $sql .= " ORDER BY a.AisleCode, s.ShelfCode ASC ";

        $stmt = $conn->prepare($sql);
        $params = [":archived" => $archived ? "Yes" : "No"];
        if ($search !== "") {
            $params[":search"]  = "%$search%";
            $params[":search2"] = "%$search%";
        }

        $stmt->execute($params);
        response(true, "Shelves loaded.", $stmt->fetchAll());
    }

    if ($operation === "getShelf") {
        $id = intval($input["ShelfID"] ?? 0);
        $stmt = $conn->prepare("SELECT * FROM shelf WHERE ShelfID = :id LIMIT 1");
        $stmt->execute([":id" => $id]);
        response(true, "Shelf loaded.", $stmt->fetch());
    }

    if ($operation === "insertShelf") {
        $aisleID = intval($input["AisleID"] ?? 0);
        $code    = trim($input["ShelfCode"] ?? "");

        if ($aisleID <= 0 || $code === "")
            response(false, "Aisle and shelf code are required.", null);

        try {
            $dupStmt = $conn->prepare("
                SELECT COUNT(*) AS total FROM shelf
                WHERE AisleID = :aisle AND LOWER(TRIM(ShelfCode)) = LOWER(TRIM(:code))
            ");
            $dupStmt->execute([":aisle" => $aisleID, ":code" => $code]);
            if (intval($dupStmt->fetch()["total"]) > 0) {
                response(false, "Shelf code '$code' already exists in this aisle.", null);
            }
        } catch (Exception $e) {}

        $conn->prepare("
            INSERT INTO shelf (AisleID, ShelfCode, IsArchived)
            VALUES (:aisle, :code, 'No')
        ")->execute([":aisle" => $aisleID, ":code" => $code]);

        $newShelfID  = $conn->lastInsertId();
        $displayName = getRecordDisplayName($conn, "shelf", "ShelfID", $newShelfID);

        addAudit($conn, $currentUserID, "INSERT", "shelf", "Added $displayName");

        response(true, "Shelf added successfully.", ["ShelfID" => $newShelfID]);
    }

    if ($operation === "updateShelf") {
        $id      = intval($input["ShelfID"] ?? 0);
        $aisleID = intval($input["AisleID"] ?? 0);
        $code    = trim($input["ShelfCode"] ?? "");

        if ($id <= 0 || $aisleID <= 0 || $code === "")
            response(false, "Invalid shelf information.", null);

        try {
            $dupStmt = $conn->prepare("
                SELECT COUNT(*) AS total FROM shelf
                WHERE AisleID = :aisle AND LOWER(TRIM(ShelfCode)) = LOWER(TRIM(:code))
                AND ShelfID <> :id
            ");
            $dupStmt->execute([":aisle" => $aisleID, ":code" => $code, ":id" => $id]);
            if (intval($dupStmt->fetch()["total"]) > 0) {
                response(false, "Shelf code '$code' already exists in this aisle.", null);
            }
        } catch (Exception $e) {}

        $displayName = getRecordDisplayName($conn, "shelf", "ShelfID", $id);

        $conn->prepare("
            UPDATE shelf SET AisleID = :aisle, ShelfCode = :code WHERE ShelfID = :id
        ")->execute([":aisle" => $aisleID, ":code" => $code, ":id" => $id]);

        addAudit($conn, $currentUserID, "UPDATE", "shelf", "Updated $displayName");

        response(true, "Shelf updated successfully.", null);
    }

    if ($operation === "deleteShelf") {
        $id = intval($input["ShelfID"] ?? 0);
        $displayName = getRecordDisplayName($conn, "shelf", "ShelfID", $id);

        $conn->prepare("UPDATE shelf SET IsArchived = 'Yes' WHERE ShelfID = :id")
             ->execute([":id" => $id]);

        addAudit($conn, $currentUserID, "ARCHIVE", "shelf", "Archived $displayName");

        response(true, "Shelf archived successfully.", null);
    }

    /* ============================================================
       BINS
    ============================================================ */

    if ($operation === "getBins") {
        $search   = getSearch($input);
        $archived = getArchivedFilter($input);

        $sql = "
            SELECT b.BinID, b.ShelfID, s.ShelfCode, a.AisleCode, b.BinCode, b.IsArchived
            FROM bin b
            LEFT JOIN shelf s ON b.ShelfID = s.ShelfID
            LEFT JOIN aisle a ON s.AisleID = a.AisleID
            WHERE b.IsArchived = :archived
        ";

        if ($search !== "") {
            $sql .= " AND (b.BinCode LIKE :search OR s.ShelfCode LIKE :search2
                     OR a.AisleCode LIKE :search3) ";
        }

        $sql .= " ORDER BY a.AisleCode, s.ShelfCode, b.BinCode ASC ";

        $stmt = $conn->prepare($sql);
        $params = [":archived" => $archived ? "Yes" : "No"];
        if ($search !== "") {
            $params[":search"]  = "%$search%";
            $params[":search2"] = "%$search%";
            $params[":search3"] = "%$search%";
        }

        $stmt->execute($params);
        response(true, "Bins loaded.", $stmt->fetchAll());
    }

    if ($operation === "getBin") {
        $id = intval($input["BinID"] ?? 0);
        $stmt = $conn->prepare("SELECT * FROM bin WHERE BinID = :id LIMIT 1");
        $stmt->execute([":id" => $id]);
        response(true, "Bin loaded.", $stmt->fetch());
    }

    if ($operation === "insertBin") {
        $shelfID = intval($input["ShelfID"] ?? 0);
        $code    = trim($input["BinCode"] ?? "");

        if ($shelfID <= 0 || $code === "")
            response(false, "Shelf and bin code are required.", null);

        try {
            $dupStmt = $conn->prepare("
                SELECT COUNT(*) AS total FROM bin
                WHERE ShelfID = :shelf AND LOWER(TRIM(BinCode)) = LOWER(TRIM(:code))
            ");
            $dupStmt->execute([":shelf" => $shelfID, ":code" => $code]);
            if (intval($dupStmt->fetch()["total"]) > 0) {
                response(false, "Bin code '$code' already exists in this shelf.", null);
            }
        } catch (Exception $e) {}

        $conn->prepare("
            INSERT INTO bin (ShelfID, BinCode, IsArchived)
            VALUES (:shelf, :code, 'No')
        ")->execute([":shelf" => $shelfID, ":code" => $code]);

        $newBinID    = $conn->lastInsertId();
        $displayName = getRecordDisplayName($conn, "bin", "BinID", $newBinID);

        addAudit($conn, $currentUserID, "INSERT", "bin", "Added $displayName");

        response(true, "Bin added successfully.", ["BinID" => $newBinID]);
    }

    if ($operation === "updateBin") {
        $id      = intval($input["BinID"] ?? 0);
        $shelfID = intval($input["ShelfID"] ?? 0);
        $code    = trim($input["BinCode"] ?? "");

        if ($id <= 0 || $shelfID <= 0 || $code === "")
            response(false, "Invalid bin information.", null);

        try {
            $dupStmt = $conn->prepare("
                SELECT COUNT(*) AS total FROM bin
                WHERE ShelfID = :shelf AND LOWER(TRIM(BinCode)) = LOWER(TRIM(:code))
                AND BinID <> :id
            ");
            $dupStmt->execute([":shelf" => $shelfID, ":code" => $code, ":id" => $id]);
            if (intval($dupStmt->fetch()["total"]) > 0) {
                response(false, "Bin code '$code' already exists in this shelf.", null);
            }
        } catch (Exception $e) {}

        $displayName = getRecordDisplayName($conn, "bin", "BinID", $id);

        $conn->prepare("
            UPDATE bin SET ShelfID = :shelf, BinCode = :code WHERE BinID = :id
        ")->execute([":shelf" => $shelfID, ":code" => $code, ":id" => $id]);

        addAudit($conn, $currentUserID, "UPDATE", "bin", "Updated $displayName");

        response(true, "Bin updated successfully.", null);
    }

    if ($operation === "deleteBin") {
        $id = intval($input["BinID"] ?? 0);
        $displayName = getRecordDisplayName($conn, "bin", "BinID", $id);

        $conn->prepare("UPDATE bin SET IsArchived = 'Yes' WHERE BinID = :id")
             ->execute([":id" => $id]);

        addAudit($conn, $currentUserID, "ARCHIVE", "bin", "Archived $displayName");

        response(true, "Bin archived successfully.", null);
    }

    /* ============================================================
       PRODUCTS
    ============================================================ */

    if ($operation === "getProducts") {
        $search   = getSearch($input);
        $archived = getArchivedFilter($input);

        $sql = "
            SELECT
                p.ProductID, p.Barcode, p.ProductName, p.Description,
                p.UnitOfMeasureID, u.UnitName, u.UnitSymbol,
                p.MinStockLevel, p.CreatedAt,
                p.BinID, b.BinCode, s.ShelfCode, a.AisleCode,
                p.CategoryID, c.CategoryName, p.IsArchived
            FROM product p
            LEFT JOIN category c ON p.CategoryID = c.CategoryID
            LEFT JOIN bin b ON p.BinID = b.BinID
            LEFT JOIN shelf s ON b.ShelfID = s.ShelfID
            LEFT JOIN aisle a ON s.AisleID = a.AisleID
            LEFT JOIN unit_of_measure u ON p.UnitOfMeasureID = u.UnitOfMeasureID
            WHERE p.IsArchived = :archived
        ";

        if ($search !== "") {
            $sql .= " AND (p.ProductName LIKE :search OR p.Barcode LIKE :search2
                     OR p.Description LIKE :search3 OR c.CategoryName LIKE :search4
                     OR b.BinCode LIKE :search5) ";
        }

        $sql .= " ORDER BY p.ProductName ASC ";

        $stmt = $conn->prepare($sql);
        $params = [":archived" => $archived ? "Yes" : "No"];
        if ($search !== "") {
            $params[":search"]  = "%$search%";
            $params[":search2"] = "%$search%";
            $params[":search3"] = "%$search%";
            $params[":search4"] = "%$search%";
            $params[":search5"] = "%$search%";
        }

        $stmt->execute($params);
        response(true, "Products loaded.", $stmt->fetchAll());
    }

    if ($operation === "getProduct") {
        $id = intval($input["ProductID"] ?? 0);
        $stmt = $conn->prepare("SELECT * FROM product WHERE ProductID = :id LIMIT 1");
        $stmt->execute([":id" => $id]);
        response(true, "Product loaded.", $stmt->fetch());
    }

    if ($operation === "insertProduct") {
        $productName = trim($input["ProductName"] ?? "");
        $barcode     = trim($input["Barcode"] ?? "");
        $description = trim($input["Description"] ?? "");
        $uom         = intval($input["UnitOfMeasureID"] ?? 0);
        $minStock    = intval($input["MinStockLevel"] ?? 0);
        $binID       = intval($input["BinID"] ?? 0);
        $categoryID  = intval($input["CategoryID"] ?? 0);

        if ($productName === "") response(false, "Product name is required.", null);

        if (isDuplicate($conn, "product", "ProductName", $productName)) {
            response(false, "Product name '$productName' already exists.", null);
        }

        if ($barcode !== "" && isDuplicate($conn, "product", "Barcode", $barcode)) {
            response(false, "Barcode '$barcode' already exists.", null);
        }

        $conn->prepare("
            INSERT INTO product
            (Barcode, ProductName, Description, UnitOfMeasureID, MinStockLevel,
             CreatedAt, BinID, CategoryID, IsArchived)
            VALUES
            (:barcode, :productname, :description, :uom, :minstock,
             NOW(), :bin, :category, 'No')
        ")->execute([
            ":barcode"     => $barcode,
            ":productname" => $productName,
            ":description" => $description,
            ":uom"         => $uom > 0 ? $uom : null,
            ":minstock"    => $minStock,
            ":bin"         => $binID > 0 ? $binID : null,
            ":category"    => $categoryID > 0 ? $categoryID : null
        ]);

        addAudit($conn, $currentUserID, "INSERT", "product", "Added Product: $productName");

        response(true, "Product added successfully.", ["ProductID" => $conn->lastInsertId()]);
    }

    if ($operation === "updateProduct") {
        $id          = intval($input["ProductID"] ?? 0);
        $productName = trim($input["ProductName"] ?? "");
        $barcode     = trim($input["Barcode"] ?? "");

        if ($id <= 0 || $productName === "") response(false, "Invalid product information.", null);

        if (isDuplicate($conn, "product", "ProductName", $productName, $id, "ProductID")) {
            response(false, "Product name '$productName' already exists.", null);
        }

        if ($barcode !== "" && isDuplicate($conn, "product", "Barcode", $barcode, $id, "ProductID")) {
            response(false, "Barcode '$barcode' already exists.", null);
        }

        $displayName = getRecordDisplayName($conn, "product", "ProductID", $id);

        $conn->prepare("
            UPDATE product
            SET Barcode = :barcode, ProductName = :productname,
                Description = :description, UnitOfMeasureID = :uom,
                MinStockLevel = :minstock, BinID = :bin, CategoryID = :category
            WHERE ProductID = :id
        ")->execute([
            ":barcode"     => $barcode,
            ":productname" => $productName,
            ":description" => trim($input["Description"] ?? ""),
            ":uom"         => intval($input["UnitOfMeasureID"] ?? 0) ?: null,
            ":minstock"    => intval($input["MinStockLevel"] ?? 0),
            ":bin"         => intval($input["BinID"] ?? 0) ?: null,
            ":category"    => intval($input["CategoryID"] ?? 0) ?: null,
            ":id"          => $id
        ]);

        addAudit($conn, $currentUserID, "UPDATE", "product", "Updated $displayName");

        response(true, "Product updated successfully.", null);
    }

    if ($operation === "deleteProduct") {
        $id = intval($input["ProductID"] ?? 0);
        $displayName = getRecordDisplayName($conn, "product", "ProductID", $id);

        $conn->prepare("UPDATE product SET IsArchived = 'Yes' WHERE ProductID = :id")
             ->execute([":id" => $id]);

        addAudit($conn, $currentUserID, "ARCHIVE", "product", "Archived $displayName");

        response(true, "Product archived successfully.", null);
    }

    /* ============================================================
       USERS
    ============================================================ */

    if ($operation === "getUsers") {
        $search   = getSearch($input);
        $archived = getArchivedFilter($input);

        $sql = "
            SELECT
                u.UserID, u.UserName, u.FirstName, u.LastName, u.Email,
                u.RoleID, r.RoleName, u.UserStatus, u.CreatedAt, u.IsArchived
            FROM `user` u
            LEFT JOIN role r ON u.RoleID = r.RoleID
            WHERE u.IsArchived = :archived
        ";

        if ($search !== "") {
            $sql .= " AND (u.UserName LIKE :search OR u.FirstName LIKE :search2
                     OR u.LastName LIKE :search3 OR u.Email LIKE :search4
                     OR r.RoleName LIKE :search5) ";
        }

        $sql .= " ORDER BY u.UserName ASC ";

        $stmt = $conn->prepare($sql);
        $params = [":archived" => $archived ? "Yes" : "No"];
        if ($search !== "") {
            $params[":search"]  = "%$search%";
            $params[":search2"] = "%$search%";
            $params[":search3"] = "%$search%";
            $params[":search4"] = "%$search%";
            $params[":search5"] = "%$search%";
        }

        $stmt->execute($params);
        response(true, "Users loaded.", $stmt->fetchAll());
    }

    if ($operation === "getUser") {
        $id = intval($input["UserID"] ?? 0);

        $stmt = $conn->prepare("
            SELECT UserID, UserName, FirstName, LastName, Email,
                   RoleID, UserStatus, CreatedAt, IsArchived
            FROM `user` WHERE UserID = :id LIMIT 1
        ");
        $stmt->execute([":id" => $id]);
        response(true, "User loaded.", $stmt->fetch());
    }

    if ($operation === "insertUser") {
        $username  = trim($input["UserName"] ?? "");
        $password  = $input["Password"] ?? "";
        $firstname = trim($input["FirstName"] ?? "");
        $lastname  = trim($input["LastName"] ?? "");
        $email     = trim($input["Email"] ?? "");
        $roleID    = intval($input["RoleID"] ?? 0);
        $status    = trim($input["UserStatus"] ?? "Active");

        if ($username === "" || $password === "")
            response(false, "Username and password are required.", null);

        if (isDuplicate($conn, "user", "UserName", $username)) {
            response(false, "Username '$username' already exists.", null);
        }

        if ($email !== "" && isDuplicate($conn, "user", "Email", $email)) {
            response(false, "Email '$email' already exists.", null);
        }

        $hashedPassword = password_hash($password, PASSWORD_DEFAULT);

        $conn->prepare("
            INSERT INTO `user`
            (UserName, Password, FirstName, LastName, Email, RoleID,
             UserStatus, CreatedAt, IsArchived)
            VALUES
            (:username, :password, :firstname, :lastname, :email, :roleid,
             :status, NOW(), 'No')
        ")->execute([
            ":username"  => $username,
            ":password"  => $hashedPassword,
            ":firstname" => $firstname,
            ":lastname"  => $lastname,
            ":email"     => $email,
            ":roleid"    => $roleID,
            ":status"    => $status
        ]);

        addAudit($conn, $currentUserID, "INSERT", "user", "Added User: $username");

        response(true, "User added successfully.", ["UserID" => $conn->lastInsertId()]);
    }

    if ($operation === "updateUser") {
        $id        = intval($input["UserID"] ?? 0);
        $username  = trim($input["UserName"] ?? "");
        $firstname = trim($input["FirstName"] ?? "");
        $lastname  = trim($input["LastName"] ?? "");
        $email     = trim($input["Email"] ?? "");
        $roleID    = intval($input["RoleID"] ?? 0);
        $status    = trim($input["UserStatus"] ?? "Active");
        $password  = $input["Password"] ?? "";

        if ($id <= 0 || $username === "") response(false, "Invalid user information.", null);

        if (isDuplicate($conn, "user", "UserName", $username, $id, "UserID")) {
            response(false, "Username '$username' already exists.", null);
        }

        if ($email !== "" && isDuplicate($conn, "user", "Email", $email, $id, "UserID")) {
            response(false, "Email '$email' already exists.", null);
        }

        $displayName = getRecordDisplayName($conn, "user", "UserID", $id);

        if ($password !== "") {
            $hashedPassword = password_hash($password, PASSWORD_DEFAULT);

            $conn->prepare("
                UPDATE `user`
                SET UserName = :username, Password = :password,
                    FirstName = :firstname, LastName = :lastname,
                    Email = :email, RoleID = :roleid, UserStatus = :status
                WHERE UserID = :id
            ")->execute([
                ":username"  => $username,
                ":password"  => $hashedPassword,
                ":firstname" => $firstname,
                ":lastname"  => $lastname,
                ":email"     => $email,
                ":roleid"    => $roleID,
                ":status"    => $status,
                ":id"        => $id
            ]);
        } else {
            $conn->prepare("
                UPDATE `user`
                SET UserName = :username, FirstName = :firstname,
                    LastName = :lastname, Email = :email,
                    RoleID = :roleid, UserStatus = :status
                WHERE UserID = :id
            ")->execute([
                ":username"  => $username,
                ":firstname" => $firstname,
                ":lastname"  => $lastname,
                ":email"     => $email,
                ":roleid"    => $roleID,
                ":status"    => $status,
                ":id"        => $id
            ]);
        }

        addAudit($conn, $currentUserID, "UPDATE", "user", "Updated $displayName");

        response(true, "User updated successfully.", null);
    }

    if ($operation === "deleteUser") {
        $id = intval($input["UserID"] ?? 0);

        if ($id === $currentUserID) {
            response(false, "You cannot archive your own account.", null);
        }

        $displayName = getRecordDisplayName($conn, "user", "UserID", $id);

        $conn->prepare("UPDATE `user` SET IsArchived = 'Yes' WHERE UserID = :id")
             ->execute([":id" => $id]);

        addAudit($conn, $currentUserID, "ARCHIVE", "user", "Archived $displayName");

        response(true, "User archived successfully.", null);
    }

    if ($operation === "toggleUserStatus") {
        $id = intval($input["UserID"] ?? 0);

        $stmt = $conn->prepare("SELECT UserStatus FROM `user` WHERE UserID = :id LIMIT 1");
        $stmt->execute([":id" => $id]);
        $user = $stmt->fetch();

        if (!$user) response(false, "User not found.", null);

        $newStatus = strtolower(trim($user["UserStatus"])) === "active" ? "Inactive" : "Active";

        $conn->prepare("UPDATE `user` SET UserStatus = :status WHERE UserID = :id")
             ->execute([":status" => $newStatus, ":id" => $id]);

        $displayName = getRecordDisplayName($conn, "user", "UserID", $id);

        addAudit($conn, $currentUserID, "UPDATE", "user",
            "Changed $displayName status to $newStatus");

        response(true, "User status updated.", ["UserStatus" => $newStatus]);
    }

    /* ============================================================
       UNITS OF MEASURE
    ============================================================ */

    if ($operation === "getUnitsOfMeasure") {
        $stmt = $conn->query("
            SELECT UnitOfMeasureID, UnitName, UnitSymbol, IsArchived
            FROM unit_of_measure WHERE IsArchived = 'No'
            ORDER BY UnitName ASC
        ");
        response(true, "Units of measure loaded.", $stmt->fetchAll());
    }

    if ($operation === "getUnitsOfMeasureList") {
        $search   = getSearch($input);
        $archived = getArchivedFilter($input);

        $sql = "
            SELECT UnitOfMeasureID, UnitName, UnitSymbol, IsArchived
            FROM unit_of_measure
            WHERE IsArchived = :archived
        ";

        if ($search !== "") {
            $sql .= " AND (UnitName LIKE :search OR UnitSymbol LIKE :search2) ";
        }

        $sql .= " ORDER BY UnitName ASC ";

        $stmt = $conn->prepare($sql);
        $params = [":archived" => $archived ? "Yes" : "No"];
        if ($search !== "") {
            $params[":search"]  = "%$search%";
            $params[":search2"] = "%$search%";
        }

        $stmt->execute($params);
        response(true, "Units of measure loaded.", $stmt->fetchAll());
    }

    if ($operation === "getUnitOfMeasure") {
        $id = intval($input["UnitOfMeasureID"] ?? 0);
        $stmt = $conn->prepare("
            SELECT UnitOfMeasureID, UnitName, UnitSymbol, IsArchived
            FROM unit_of_measure WHERE UnitOfMeasureID = :id LIMIT 1
        ");
        $stmt->execute([":id" => $id]);
        response(true, "Unit of measure loaded.", $stmt->fetch());
    }

    if ($operation === "insertUnitOfMeasure") {
        $name   = trim($input["UnitName"] ?? "");
        $symbol = trim($input["UnitSymbol"] ?? "");

        if ($name === "") response(false, "Unit name is required.", null);

        if (isDuplicate($conn, "unit_of_measure", "UnitName", $name)) {
            response(false, "Unit name '$name' already exists.", null);
        }

        if ($symbol !== "" && isDuplicate($conn, "unit_of_measure", "UnitSymbol", $symbol)) {
            response(false, "Unit symbol '$symbol' already exists.", null);
        }

        $conn->prepare("
            INSERT INTO unit_of_measure
            (UnitName, UnitSymbol, IsArchived)
            VALUES (:name, :symbol, 'No')
        ")->execute([":name" => $name, ":symbol" => $symbol]);

        $newID = $conn->lastInsertId();

        addAudit($conn, $currentUserID, "INSERT", "unit_of_measure",
            "Added Unit of Measure: $name");

        response(true, "Unit of measure added successfully.",
            ["UnitOfMeasureID" => $newID]);
    }

    if ($operation === "updateUnitOfMeasure") {
        $id     = intval($input["UnitOfMeasureID"] ?? 0);
        $name   = trim($input["UnitName"] ?? "");
        $symbol = trim($input["UnitSymbol"] ?? "");

        if ($id <= 0 || $name === "") response(false, "Invalid unit information.", null);

        if (isDuplicate($conn, "unit_of_measure", "UnitName", $name, $id, "UnitOfMeasureID")) {
            response(false, "Unit name '$name' already exists.", null);
        }

        if ($symbol !== "" && isDuplicate($conn, "unit_of_measure", "UnitSymbol", $symbol, $id, "UnitOfMeasureID")) {
            response(false, "Unit symbol '$symbol' already exists.", null);
        }

        $displayName = getRecordDisplayName($conn, "uom", "UnitOfMeasureID", $id);

        $conn->prepare("
            UPDATE unit_of_measure
            SET UnitName = :name, UnitSymbol = :symbol
            WHERE UnitOfMeasureID = :id
        ")->execute([":name" => $name, ":symbol" => $symbol, ":id" => $id]);

        addAudit($conn, $currentUserID, "UPDATE", "unit_of_measure", "Updated $displayName");

        response(true, "Unit of measure updated successfully.", null);
    }

    if ($operation === "deleteUnitOfMeasure") {
        $id = intval($input["UnitOfMeasureID"] ?? 0);
        $displayName = getRecordDisplayName($conn, "uom", "UnitOfMeasureID", $id);

        $conn->prepare("
            UPDATE unit_of_measure SET IsArchived = 'Yes'
            WHERE UnitOfMeasureID = :id
        ")->execute([":id" => $id]);

        addAudit($conn, $currentUserID, "ARCHIVE", "unit_of_measure",
            "Archived $displayName");

        response(true, "Unit of measure archived successfully.", null);
    }

    /* ============================================================
       TRANSACTIONS
    ============================================================ */

    if ($operation === "getPurchaseOrders") {
        $search   = getSearch($input);
        $archived = getArchivedFilter($input);

        $sql = "
            SELECT
                po.PO_ID, po.PO_Date, po.Expected_Date, po.Supplier_ID,
                s.SupplierName, po.User_ID,
                CONCAT(u.FirstName, ' ', u.LastName) AS UserName,
                po.Status_ID, st.StatusName, po.IsArchived
            FROM purchase_order po
            LEFT JOIN supplier s ON po.Supplier_ID = s.SupplierID
            LEFT JOIN `user` u ON po.User_ID = u.UserID
            LEFT JOIN status st ON po.Status_ID = st.StatusID
            WHERE po.IsArchived = :archived
        ";

        if ($search !== "") {
            $sql .= " AND (s.SupplierName LIKE :search
                     OR CONCAT(u.FirstName, ' ', u.LastName) LIKE :search2
                     OR st.StatusName LIKE :search3) ";
        }

        $sql .= " ORDER BY po.PO_Date DESC, po.PO_ID DESC ";

        $stmt = $conn->prepare($sql);
        $params = [":archived" => $archived ? "Yes" : "No"];
        if ($search !== "") {
            $params[":search"]  = "%$search%";
            $params[":search2"] = "%$search%";
            $params[":search3"] = "%$search%";
        }

        $stmt->execute($params);
        response(true, "Purchase orders loaded.", $stmt->fetchAll());
    }

if ($operation === "getReceivings") {
    $archived = getArchivedFilter($input);

    $sql = "
        SELECT
            r.ReceivingID, r.ReceivingDate, r.SupplierID, s.SupplierName,
            r.ReceivedByUserID,
            CONCAT(u.FirstName, ' ', u.LastName) AS UserName,
            r.PO_ID AS PO_Reference, r.StatusID, st.StatusName, r.IsArchived
        FROM receiving r
        LEFT JOIN supplier s ON r.SupplierID = s.SupplierID
        LEFT JOIN `user` u ON r.ReceivedByUserID = u.UserID
        LEFT JOIN status st ON r.StatusID = st.StatusID
        WHERE r.IsArchived = :archived
        ORDER BY r.ReceivingDate DESC, r.ReceivingID DESC
    ";

    $stmt = $conn->prepare($sql);
    $stmt->execute([":archived" => $archived ? "Yes" : "No"]);

    response(true, "Receivings loaded.", $stmt->fetchAll());
}
    if ($operation === "getStockReleases") {
        $archived = getArchivedFilter($input);

        $sql = "
            SELECT
                sr.ReleaseID, sr.ReleaseDate,
                sr.RequestedByUserID,
                CONCAT(req.FirstName, ' ', req.LastName) AS RequestedBy,
                sr.ReleasedByUserID,
                CONCAT(rel.FirstName, ' ', rel.LastName) AS ReleasedBy,
                sr.Status_ID, st.StatusName, sr.IsArchived
            FROM stock_release sr
            LEFT JOIN `user` req ON sr.RequestedByUserID = req.UserID
            LEFT JOIN `user` rel ON sr.ReleasedByUserID = rel.UserID
            LEFT JOIN status st ON sr.Status_ID = st.StatusID
            WHERE sr.IsArchived = :archived
            ORDER BY sr.ReleaseID DESC
        ";

        $stmt = $conn->prepare($sql);
        $stmt->execute([":archived" => $archived ? "Yes" : "No"]);

        response(true, "Stock releases loaded.", $stmt->fetchAll());
    }

    if ($operation === "getStockReturns") {
        $archived = getArchivedFilter($input);

        $sql = "
            SELECT
                sr.Stock_Return_ID, sr.User_ID,
                CONCAT(u.FirstName, ' ', u.LastName) AS UserName,
                sr.Return_Date, sr.Status_ID, sr.Reason, st.StatusName, sr.IsArchived
            FROM stock_return sr
            LEFT JOIN `user` u ON sr.User_ID = u.UserID
            LEFT JOIN status st ON sr.Status_ID = st.StatusID
            WHERE sr.IsArchived = :archived
            ORDER BY sr.Return_Date DESC, sr.Stock_Return_ID DESC
        ";

        $stmt = $conn->prepare($sql);
        $stmt->execute([":archived" => $archived ? "Yes" : "No"]);

        response(true, "Stock returns loaded.", $stmt->fetchAll());
    }

    if ($operation === "getInventoryAdjustments") {
        $archived = getArchivedFilter($input);

        $sql = "
            SELECT
                ia.Adjustment_ID, ia.User_ID,
                CONCAT(u.FirstName, ' ', u.LastName) AS UserName,
                ia.Adjustment_Date, ia.Status_ID, ia.Reason, st.StatusName, ia.IsArchived
            FROM inventory_adjustment ia
            LEFT JOIN `user` u ON ia.User_ID = u.UserID
            LEFT JOIN status st ON ia.Status_ID = st.StatusID
            WHERE ia.IsArchived = :archived
            ORDER BY ia.Adjustment_Date DESC, ia.Adjustment_ID DESC
        ";

        $stmt = $conn->prepare($sql);
        $stmt->execute([":archived" => $archived ? "Yes" : "No"]);

        response(true, "Inventory adjustments loaded.", $stmt->fetchAll());
    }

    if ($operation === "getAuditLogs") {
        $search   = getSearch($input);
        $archived = getArchivedFilter($input);

        $sql = "
            SELECT
                a.AuditLogID, a.UserID, u.UserName,
                a.ActionType, a.TableAffected, a.ActionTimestamp,
                a.Details, a.IsArchived
            FROM auditlog a
            LEFT JOIN `user` u ON a.UserID = u.UserID
            WHERE a.IsArchived = :archived
        ";

        if ($search !== "") {
            $sql .= " AND (u.UserName LIKE :search OR a.ActionType LIKE :search2
                     OR a.TableAffected LIKE :search3 OR a.Details LIKE :search4) ";
        }

        $sql .= " ORDER BY a.ActionTimestamp DESC LIMIT 500 ";

        $stmt = $conn->prepare($sql);
        $params = [":archived" => $archived ? "Yes" : "No"];
        if ($search !== "") {
            $params[":search"]  = "%$search%";
            $params[":search2"] = "%$search%";
            $params[":search3"] = "%$search%";
            $params[":search4"] = "%$search%";
        }

        $stmt->execute($params);
        response(true, "Audit logs loaded.", $stmt->fetchAll());
    }

    /* ============================================================
       ✅ FIXED: updateTransactionStatus
       Audit log now stores the actual record name and the actual
       status name instead of raw #ID and StatusID.
    ============================================================ */

    if ($operation === "updateTransactionStatus") {

        $transactionTable = trim($input["transactionTable"] ?? "");
        $recordID         = intval($input["recordID"] ?? 0);
        $statusID         = intval($input["statusID"] ?? 0);

        if ($recordID <= 0 || $statusID <= 0)
            response(false, "Invalid record ID or status ID.", null);

        $allowedTables = [
            "purchase_order"       => ["table" => "purchase_order",       "pk" => "PO_ID",           "status" => "Status_ID"],
            "receiving"            => ["table" => "receiving",            "pk" => "ReceivingID",     "status" => "StatusID"],
            "stock_release"        => ["table" => "stock_release",        "pk" => "ReleaseID",       "status" => "Status_ID"],
            "stock_return"         => ["table" => "stock_return",         "pk" => "Stock_Return_ID", "status" => "Status_ID"],
            "inventory_adjustment" => ["table" => "inventory_adjustment", "pk" => "Adjustment_ID",   "status" => "Status_ID"]
        ];

        if (!isset($allowedTables[$transactionTable]))
            response(false, "Invalid transaction table: " . $transactionTable, null);

        $config       = $allowedTables[$transactionTable];
        $table        = $config["table"];
        $pkColumn     = $config["pk"];
        $statusColumn = $config["status"];

        try {
            // Human-readable record name (instead of raw #ID)
            $displayName = getTransactionDisplayName($conn, $transactionTable, $recordID);

            // Actual status name (instead of raw StatusID)
            $statusStmt = $conn->prepare("SELECT StatusName FROM status WHERE StatusID = :id LIMIT 1");
            $statusStmt->execute([":id" => $statusID]);
            $statusRow  = $statusStmt->fetch();
            $statusName = $statusRow ? $statusRow["StatusName"] : "Status #$statusID";

            $stmt = $conn->prepare("
                UPDATE `$table` SET `$statusColumn` = :status
                WHERE `$pkColumn` = :id
            ");
            $stmt->execute([":status" => $statusID, ":id" => $recordID]);

            addAudit($conn, $currentUserID, "UPDATE", $table,
                "Changed $displayName status to $statusName");

            response(true, "Transaction status updated successfully.", null);

        } catch (PDOException $e) {
            response(false, "Update failed: " . $e->getMessage(), null);
        }
    }

    /* ============================================================
       RESTORE (UNARCHIVE) — FIXED FOR UOM
    ============================================================ */

    if ($operation === "restoreRecord") {

        $tableKey = strtolower(trim($input["table"] ?? ""));
        $id       = intval($input["id"] ?? 0);

        if ($id <= 0) {
            response(false, "Invalid record ID.", null);
        }

        $allowedTables = [
            "role"     => ["table" => "role",            "pk" => "RoleID"],
            "status"   => ["table" => "status",          "pk" => "StatusID"],
            "category" => ["table" => "category",        "pk" => "CategoryID"],
            "supplier" => ["table" => "supplier",        "pk" => "SupplierID"],
            "aisle"    => ["table" => "aisle",           "pk" => "AisleID"],
            "shelf"    => ["table" => "shelf",           "pk" => "ShelfID"],
            "bin"      => ["table" => "bin",             "pk" => "BinID"],
            "product"  => ["table" => "product",         "pk" => "ProductID"],
            "user"     => ["table" => "user",            "pk" => "UserID"],
            "uom"      => ["table" => "unit_of_measure", "pk" => "UnitOfMeasureID"]
        ];

        if (!isset($allowedTables[$tableKey])) {
            response(false, "Invalid table for restore: $tableKey", null);
        }

        $realTable = $allowedTables[$tableKey]["table"];
        $pkColumn  = $allowedTables[$tableKey]["pk"];

        try {
            $displayName = getRecordDisplayName($conn, $tableKey, $pkColumn, $id);

            if ($realTable === "user") {
                $stmt = $conn->prepare(
                    "UPDATE `user` SET IsArchived = 'No' WHERE $pkColumn = :id"
                );
            } else {
                $stmt = $conn->prepare(
                    "UPDATE `$realTable` SET IsArchived = 'No' WHERE $pkColumn = :id"
                );
            }

            $stmt->execute([":id" => $id]);

            addAudit($conn, $currentUserID, "UNARCHIVE", $realTable,
                "Restored $displayName");

            response(true, "Record restored successfully.", null);

        } catch (PDOException $e) {
            response(false, "Restore failed: " . $e->getMessage(), null);
        }
    }

    /* ============================================================
       UNARCHIVE SPECIFIC OPERATIONS
    ============================================================ */

    if ($operation === "unarchiveUnitOfMeasure") {
        $id = intval($input["UnitOfMeasureID"] ?? 0);
        if ($id <= 0) response(false, "Invalid unit of measure ID.", null);

        $displayName = getRecordDisplayName($conn, "uom", "UnitOfMeasureID", $id);

        $conn->prepare("UPDATE unit_of_measure SET IsArchived = 'No' WHERE UnitOfMeasureID = :id")
             ->execute([":id" => $id]);

        addAudit($conn, $currentUserID, "UNARCHIVE", "unit_of_measure",
            "Restored $displayName");

        response(true, "Unit of measure restored successfully.", null);
    }

    response(false, "Invalid operation: " . $operation, null);

} catch (PDOException $e) {
    response(false, "Database error: " . $e->getMessage(), null);
} catch (Exception $e) {
    response(false, "Server error: " . $e->getMessage(), null);
}