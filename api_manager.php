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
    $conn = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8mb4", $dbuser, $dbpass);
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

function getSearch($input) { return isset($input["search"]) ? trim($input["search"]) : ""; }

function addAudit($conn, $userID, $action, $table, $details = "")
{
    if ($userID <= 0) return;
    try {
        $stmt = $conn->prepare("
            INSERT INTO auditlog
            (UserID, ActionType, TableAffected, ActionTimestamp, Details, IsArchived)
            VALUES (:u, :a, :t, NOW(), :d, 'No')
        ");
        $stmt->execute([":u" => $userID, ":a" => $action, ":t" => $table, ":d" => $details]);
    } catch (Exception $e) {}
}

function requireManager($conn, $currentUserID)
{
    if (!$currentUserID || intval($currentUserID) <= 0)
        response(false, "Manager access required.", null);

    try {
        $stmt = $conn->prepare("
            SELECT u.UserID, u.UserName, u.UserStatus,
                   u.IsArchived AS UserArchived,
                   r.RoleName, r.IsArchived AS RoleArchived
            FROM `user` u
            LEFT JOIN `role` r ON u.RoleID = r.RoleID
            WHERE u.UserID = :id LIMIT 1
        ");
        $stmt->execute([":id" => intval($currentUserID)]);
        $user = $stmt->fetch();

        if (!$user) response(false, "User not found.", null);
        if (strtolower(trim($user["UserArchived"] ?? "")) === "yes")
            response(false, "Your account is archived.", null);
        if (strtolower(trim($user["UserStatus"] ?? "")) !== "active")
            response(false, "Your account is inactive.", null);
        if (strtolower(trim($user["RoleArchived"] ?? "")) === "yes")
            response(false, "Your role is archived.", null);

        $role = strtolower(trim($user["RoleName"] ?? ""));
        $allowed = ["warehouse manager", "manager", "warehouse", "admin", "administrator"];

        if (!in_array($role, $allowed)) {
            response(false, "Manager access required. Current role: " . ($user["RoleName"] ?? "No Role"), null);
        }

        return $user;
    } catch (PDOException $e) {
        response(false, "Auth error: " . $e->getMessage(), null);
    }
}

function stockJoins() {
    return "
        LEFT JOIN (
            SELECT ProductID AS pid, SUM(ReceivedQuantity) AS qty
            FROM receiving_line WHERE IsArchived = 'No' GROUP BY ProductID
        ) rin ON rin.pid = p.ProductID
        LEFT JOIN (
            SELECT ProductID AS pid, SUM(QuantityReleased) AS qty
            FROM stock_release_line WHERE IsArchived = 'No' GROUP BY ProductID
        ) rel ON rel.pid = p.ProductID
        LEFT JOIN (
            SELECT Product_ID AS pid, SUM(Quantity) AS qty
            FROM stock_return_line WHERE IsArchived = 'No' GROUP BY Product_ID
        ) sret ON sret.pid = p.ProductID
        LEFT JOIN (
            SELECT Product_ID AS pid, SUM(Quantity) AS qty
            FROM purchase_return_line WHERE IsArchived = 'No' GROUP BY Product_ID
        ) pret ON pret.pid = p.ProductID
        LEFT JOIN (
            SELECT Product_ID AS pid,
                SUM(CASE
                    WHEN LOWER(TRIM(Adjustment_Type)) = 'increase' THEN Adjustment_Quantity
                    WHEN LOWER(TRIM(Adjustment_Type)) = 'decrease' THEN -Adjustment_Quantity
                    ELSE 0
                END) AS qty
            FROM inventory_adjustment_line WHERE IsArchived = 'No' GROUP BY Product_ID
        ) adj ON adj.pid = p.ProductID
    ";
}

function stockExpression() {
    return "(
        COALESCE(rin.qty, 0) - COALESCE(rel.qty, 0)
        + COALESCE(sret.qty, 0) - COALESCE(pret.qty, 0)
        + COALESCE(adj.qty, 0)
    )";
}

try {

    $currentUserID = getCurrentUserID($input);

    if ($operation === "logout") {
        if ($currentUserID > 0) {
            addAudit($conn, $currentUserID, "LOGOUT", "user", "Manager logged out.");
        }
        response(true, "Logout successful.", null);
    }

    requireManager($conn, $currentUserID);

    if ($operation === "getManagerDashboard") {

        $stmt = $conn->query("SELECT COUNT(*) AS t FROM product WHERE IsArchived='No'");
        $totalProducts = intval($stmt->fetch()["t"]);

        $stmt = $conn->query("
            SELECT COUNT(*) AS t FROM (
                SELECT p.ProductID, " . stockExpression() . " AS OnHand, p.MinStockLevel
                FROM product p " . stockJoins() . "
                WHERE p.IsArchived = 'No'
                HAVING OnHand < p.MinStockLevel
            ) x
        ");
        $lowStockCount = intval($stmt->fetch()["t"]);

        $stmt = $conn->query("
            SELECT COUNT(*) AS t FROM inventory_adjustment ia
            LEFT JOIN status s ON ia.Status_ID = s.StatusID
            WHERE ia.IsArchived = 'No'
              AND LOWER(TRIM(s.StatusName)) IN ('pending','for review','submitted')
        ");
        $pendingAdj = intval($stmt->fetch()["t"]);

        $stmt = $conn->query("
            SELECT COUNT(*) AS t FROM stock_return sr
            LEFT JOIN status s ON sr.Status_ID = s.StatusID
            WHERE sr.IsArchived = 'No'
              AND LOWER(TRIM(s.StatusName)) IN ('pending','for review','submitted')
        ");
        $pendingRet = intval($stmt->fetch()["t"]);

        $stmt = $conn->query("
            SELECT COUNT(*) AS t FROM purchase_order po
            LEFT JOIN status s ON po.Status_ID = s.StatusID
            WHERE po.IsArchived = 'No'
              AND LOWER(TRIM(s.StatusName)) IN ('pending','approved')
        ");
        $pendingPOs = intval($stmt->fetch()["t"]);

        $stmt = $conn->query("
            SELECT ia.Adjustment_ID, ia.Adjustment_Date,
                   s.StatusName,
                   GROUP_CONCAT(p.ProductName SEPARATOR ', ') AS ProductNames,
                   MAX(ial.Adjustment_Type) AS Adjustment_Type
            FROM inventory_adjustment ia
            LEFT JOIN status s ON ia.Status_ID = s.StatusID
            LEFT JOIN inventory_adjustment_line ial
                ON ia.Adjustment_ID = ial.Adjustment_ID AND ial.IsArchived = 'No'
            LEFT JOIN product p ON ial.Product_ID = p.ProductID
            WHERE ia.IsArchived = 'No'
            GROUP BY ia.Adjustment_ID
            ORDER BY ia.Adjustment_Date DESC
            LIMIT 8
        ");
        $recentAdjustments = $stmt->fetchAll();

        foreach ($recentAdjustments as &$adj) {
            if (empty($adj["ProductNames"])) $adj["ProductNames"] = "—";
            if (empty($adj["Adjustment_Type"])) $adj["Adjustment_Type"] = "—";
        }
        unset($adj);

        $stmt = $conn->query("
            SELECT a.AuditLogID, u.UserName, a.ActionType,
                   a.TableAffected, a.ActionTimestamp
            FROM auditlog a
            LEFT JOIN `user` u ON a.UserID = u.UserID
            WHERE a.IsArchived = 'No'
            ORDER BY a.ActionTimestamp DESC
            LIMIT 8
        ");
        $recentActivity = $stmt->fetchAll();

        response(true, "Manager dashboard loaded.", [
            "totalProducts"      => $totalProducts,
            "lowStockCount"      => $lowStockCount,
            "pendingAdjustments" => $pendingAdj,
            "pendingReturns"     => $pendingRet,
            "pendingPOs"         => $pendingPOs,
            "recentAdjustments"  => $recentAdjustments,
            "recentActivity"     => $recentActivity
        ]);
    }

    if ($operation === "getProducts") {
        $search = getSearch($input);

        $sql = "
            SELECT p.ProductID, p.Barcode, p.ProductName, p.Description,
                   p.UnitOfMeasureID, u.UnitName, p.MinStockLevel,
                   p.BinID, b.BinCode, s.ShelfCode, a.AisleCode,
                   p.CategoryID, c.CategoryName, p.IsArchived
            FROM product p
            LEFT JOIN category c ON p.CategoryID = c.CategoryID
            LEFT JOIN bin b ON p.BinID = b.BinID
            LEFT JOIN shelf s ON b.ShelfID = s.ShelfID
            LEFT JOIN aisle a ON s.AisleID = a.AisleID
            LEFT JOIN unit_of_measure u ON p.UnitOfMeasureID = u.UnitOfMeasureID
            WHERE p.IsArchived = 'No'
        ";

        if ($search !== "") {
            $sql .= " AND (p.ProductName LIKE :s1 OR p.Barcode LIKE :s2 OR c.CategoryName LIKE :s3) ";
        }
        $sql .= " ORDER BY p.ProductName ASC LIMIT 500 ";

        $stmt = $conn->prepare($sql);
        $params = [];
        if ($search !== "") {
            $params[":s1"] = "%$search%";
            $params[":s2"] = "%$search%";
            $params[":s3"] = "%$search%";
        }
        $stmt->execute($params);
        response(true, "Products loaded.", $stmt->fetchAll());
    }

    if ($operation === "getCategories") {
        $search = getSearch($input);
        $sql = "SELECT CategoryID, CategoryName FROM category WHERE IsArchived='No'";
        if ($search !== "") $sql .= " AND CategoryName LIKE :s ";
        $sql .= " ORDER BY CategoryName ASC ";

        $stmt = $conn->prepare($sql);
        $params = [];
        if ($search !== "") $params[":s"] = "%$search%";
        $stmt->execute($params);
        response(true, "Categories loaded.", $stmt->fetchAll());
    }

    if ($operation === "getSuppliers") {
        $search = getSearch($input);
        $sql = "SELECT SupplierID, SupplierName, ContactPerson, Phone, Email, Address
                FROM supplier WHERE IsArchived='No'";
        if ($search !== "") $sql .= " AND (SupplierName LIKE :s1 OR ContactPerson LIKE :s2 OR Email LIKE :s3) ";
        $sql .= " ORDER BY SupplierName ASC ";

        $stmt = $conn->prepare($sql);
        $params = [];
        if ($search !== "") {
            $params[":s1"] = "%$search%";
            $params[":s2"] = "%$search%";
            $params[":s3"] = "%$search%";
        }
        $stmt->execute($params);
        response(true, "Suppliers loaded.", $stmt->fetchAll());
    }

    if ($operation === "getAisles") {
        $stmt = $conn->query("SELECT AisleID, AisleCode FROM aisle WHERE IsArchived='No' ORDER BY AisleCode");
        response(true, "Aisles loaded.", $stmt->fetchAll());
    }

    if ($operation === "getShelves") {
        $stmt = $conn->query("
            SELECT s.ShelfID, s.ShelfCode, a.AisleCode
            FROM shelf s LEFT JOIN aisle a ON s.AisleID = a.AisleID
            WHERE s.IsArchived = 'No'
            ORDER BY a.AisleCode, s.ShelfCode
        ");
        response(true, "Shelves loaded.", $stmt->fetchAll());
    }

    if ($operation === "getBins") {
        $stmt = $conn->query("
            SELECT b.BinID, b.BinCode, s.ShelfCode, a.AisleCode
            FROM bin b
            LEFT JOIN shelf s ON b.ShelfID = s.ShelfID
            LEFT JOIN aisle a ON s.AisleID = a.AisleID
            WHERE b.IsArchived = 'No'
            ORDER BY a.AisleCode, s.ShelfCode, b.BinCode
        ");
        response(true, "Bins loaded.", $stmt->fetchAll());
    }

    if ($operation === "getInventoryQuantities") {
        $search = getSearch($input);
        $sql = "
            SELECT p.ProductID, p.Barcode, p.ProductName, p.MinStockLevel,
                   c.CategoryName, u.UnitName,
                   b.BinCode, s.ShelfCode, a.AisleCode,
                   " . stockExpression() . " AS OnHandQuantity
            FROM product p
            LEFT JOIN category c ON p.CategoryID = c.CategoryID
            LEFT JOIN bin b ON p.BinID = b.BinID
            LEFT JOIN shelf s ON b.ShelfID = s.ShelfID
            LEFT JOIN aisle a ON s.AisleID = a.AisleID
            LEFT JOIN unit_of_measure u ON p.UnitOfMeasureID = u.UnitOfMeasureID
            " . stockJoins() . "
            WHERE p.IsArchived = 'No'
        ";
        if ($search !== "") $sql .= " AND (p.ProductName LIKE :s1 OR p.Barcode LIKE :s2) ";
        $sql .= " ORDER BY p.ProductName ASC ";

        $stmt = $conn->prepare($sql);
        $params = [];
        if ($search !== "") {
            $params[":s1"] = "%$search%";
            $params[":s2"] = "%$search%";
        }
        $stmt->execute($params);
        response(true, "Inventory loaded.", $stmt->fetchAll());
    }

    if ($operation === "getLowStock") {
        $sql = "
            SELECT p.ProductID, p.Barcode, p.ProductName, p.MinStockLevel,
                   c.CategoryName, u.UnitName,
                   b.BinCode, s.ShelfCode, a.AisleCode,
                   " . stockExpression() . " AS OnHandQuantity
            FROM product p
            LEFT JOIN category c ON p.CategoryID = c.CategoryID
            LEFT JOIN bin b ON p.BinID = b.BinID
            LEFT JOIN shelf s ON b.ShelfID = s.ShelfID
            LEFT JOIN aisle a ON s.AisleID = a.AisleID
            LEFT JOIN unit_of_measure u ON p.UnitOfMeasureID = u.UnitOfMeasureID
            " . stockJoins() . "
            WHERE p.IsArchived = 'No'
            HAVING OnHandQuantity < p.MinStockLevel
            ORDER BY (p.MinStockLevel - OnHandQuantity) DESC
        ";
        $stmt = $conn->query($sql);
        response(true, "Low stock loaded.", $stmt->fetchAll());
    }

    if ($operation === "getInventoryMovements") {
        $productID = intval($input["Product_ID"] ?? 0);
        $movType = trim($input["MovementType"] ?? "");
        $dateFrom = trim($input["dateFrom"] ?? "");
        $dateTo   = trim($input["dateTo"] ?? "");

        $unionParts = [];

        $sql = "
            SELECT r.ReceivingDate AS MovementDate, 'Receiving' AS MovementType,
                   p.ProductName, rl.ReceivedQuantity AS Quantity,
                   r.ReceivingID AS Reference,
                   CONCAT(u.FirstName, ' ', u.LastName) AS UserName
            FROM receiving_line rl
            INNER JOIN receiving r ON rl.ReceivingID = r.ReceivingID
            INNER JOIN product p ON rl.ProductID = p.ProductID
            LEFT JOIN `user` u ON r.ReceivedByUserID = u.UserID
            WHERE rl.IsArchived = 'No' AND r.IsArchived = 'No'
        ";
        $params = [];
        if ($productID) { $sql .= " AND rl.ProductID = :pid "; $params[":pid"] = $productID; }
        if ($dateFrom)  { $sql .= " AND DATE(r.ReceivingDate) >= :df "; $params[":df"] = $dateFrom; }
        if ($dateTo)    { $sql .= " AND DATE(r.ReceivingDate) <= :dt "; $params[":dt"] = $dateTo; }

        $unionParts[] = ["sql" => $sql, "params" => $params];

        $sql = "
            SELECT sr.ReleaseDate AS MovementDate, 'Release' AS MovementType,
                   p.ProductName, srl.QuantityReleased AS Quantity,
                   sr.ReleaseID AS Reference,
                   CONCAT(u.FirstName, ' ', u.LastName) AS UserName
            FROM stock_release_line srl
            INNER JOIN stock_release sr ON srl.ReleaseID = sr.ReleaseID
            INNER JOIN product p ON srl.ProductID = p.ProductID
            LEFT JOIN `user` u ON sr.ReleasedByUserID = u.UserID
            WHERE srl.IsArchived = 'No' AND sr.IsArchived = 'No'
        ";
        $params = [];
        if ($productID) { $sql .= " AND srl.ProductID = :pid "; $params[":pid"] = $productID; }
        if ($dateFrom)  { $sql .= " AND DATE(sr.ReleaseDate) >= :df "; $params[":df"] = $dateFrom; }
        if ($dateTo)    { $sql .= " AND DATE(sr.ReleaseDate) <= :dt "; $params[":dt"] = $dateTo; }
        $unionParts[] = ["sql" => $sql, "params" => $params];

        $sql = "
            SELECT sr.Return_Date AS MovementDate, 'Return' AS MovementType,
                   p.ProductName, srl.Quantity AS Quantity,
                   sr.Stock_Return_ID AS Reference,
                   CONCAT(u.FirstName, ' ', u.LastName) AS UserName
            FROM stock_return_line srl
            INNER JOIN stock_return sr ON srl.Stock_Return_ID = sr.Stock_Return_ID
            INNER JOIN product p ON srl.Product_ID = p.ProductID
            LEFT JOIN `user` u ON sr.User_ID = u.UserID
            WHERE srl.IsArchived = 'No' AND sr.IsArchived = 'No'
        ";
        $params = [];
        if ($productID) { $sql .= " AND srl.Product_ID = :pid "; $params[":pid"] = $productID; }
        if ($dateFrom)  { $sql .= " AND DATE(sr.Return_Date) >= :df "; $params[":df"] = $dateFrom; }
        if ($dateTo)    { $sql .= " AND DATE(sr.Return_Date) <= :dt "; $params[":dt"] = $dateTo; }
        $unionParts[] = ["sql" => $sql, "params" => $params];

        $sql = "
            SELECT ia.Adjustment_Date AS MovementDate, 'Adjustment' AS MovementType,
                   p.ProductName, ial.Adjustment_Quantity AS Quantity,
                   ia.Adjustment_ID AS Reference,
                   CONCAT(u.FirstName, ' ', u.LastName) AS UserName
            FROM inventory_adjustment_line ial
            INNER JOIN inventory_adjustment ia ON ial.Adjustment_ID = ia.Adjustment_ID
            INNER JOIN product p ON ial.Product_ID = p.ProductID
            LEFT JOIN `user` u ON ia.User_ID = u.UserID
            WHERE ial.IsArchived = 'No' AND ia.IsArchived = 'No'
        ";
        $params = [];
        if ($productID) { $sql .= " AND ial.Product_ID = :pid "; $params[":pid"] = $productID; }
        if ($dateFrom)  { $sql .= " AND DATE(ia.Adjustment_Date) >= :df "; $params[":df"] = $dateFrom; }
        if ($dateTo)    { $sql .= " AND DATE(ia.Adjustment_Date) <= :dt "; $params[":dt"] = $dateTo; }
        $unionParts[] = ["sql" => $sql, "params" => $params];

        $sql = "
            SELECT pr.Return_Date AS MovementDate, 'Purchase Return' AS MovementType,
                   p.ProductName, prl.Quantity AS Quantity,
                   pr.Purchase_Return_ID AS Reference,
                   CONCAT(u.FirstName, ' ', u.LastName) AS UserName
            FROM purchase_return_line prl
            INNER JOIN purchase_return pr ON prl.Purchase_Return_ID = pr.Purchase_Return_ID
            INNER JOIN product p ON prl.Product_ID = p.ProductID
            LEFT JOIN `user` u ON pr.User_ID = u.UserID
            WHERE prl.IsArchived = 'No' AND pr.IsArchived = 'No'
        ";
        $params = [];
        if ($productID) { $sql .= " AND prl.Product_ID = :pid "; $params[":pid"] = $productID; }
        if ($dateFrom)  { $sql .= " AND DATE(pr.Return_Date) >= :df "; $params[":df"] = $dateFrom; }
        if ($dateTo)    { $sql .= " AND DATE(pr.Return_Date) <= :dt "; $params[":dt"] = $dateTo; }
        $unionParts[] = ["sql" => $sql, "params" => $params];

        $finalSql = "";
        $allParams = [];
        foreach ($unionParts as $i => $p) {
            if ($i > 0) $finalSql .= " UNION ALL ";
            $finalSql .= $p["sql"];
            foreach ($p["params"] as $k => $v) {
                $allParams[$k . "_" . $i] = $v;
                $finalSql = str_replace($k, $k . "_" . $i, $finalSql);
            }
        }

        $finalSql = "SELECT * FROM (" . $finalSql . ") AS movements ";

        if ($movType !== "") {
            $finalSql .= " WHERE MovementType = :mt ";
            $allParams[":mt"] = $movType;
        }

        $finalSql .= " ORDER BY MovementDate DESC LIMIT 500 ";

        $stmt = $conn->prepare($finalSql);
        $stmt->execute($allParams);
        response(true, "Movements loaded.", $stmt->fetchAll());
    }

    /* ============================================================
       ✅ FIXED — getReceivingDiscrepancies
       Was joining purchase_order_line via a REGEXP_REPLACE() on a
       non-existent text column (r.PO_Reference). The receiving
       table actually has a real PO_ID foreign key (see phpMyAdmin
       schema), so we now join on that directly. Much simpler and
       actually correct.
    ============================================================ */
    if ($operation === "getReceivingDiscrepancies") {
        $search = getSearch($input);
        $sql = "
            SELECT r.ReceivingID, r.ReceivingDate,
                   p.ProductName,
                   COALESCE(pol.Quantity, 0) AS OrderedQty,
                   rl.ReceivedQuantity AS ReceivedQty,
                   (rl.ReceivedQuantity - COALESCE(pol.Quantity, 0)) AS Variance
            FROM receiving_line rl
            INNER JOIN receiving r ON rl.ReceivingID = r.ReceivingID
            INNER JOIN product p ON rl.ProductID = p.ProductID
            LEFT JOIN purchase_order_line pol
                ON pol.Product_ID = rl.ProductID
                AND pol.PO_ID = r.PO_ID
                AND pol.IsArchived = 'No'
            WHERE rl.IsArchived = 'No' AND r.IsArchived = 'No'
        ";
        if ($search !== "") $sql .= " AND (p.ProductName LIKE :s OR r.ReceivingID LIKE :s2) ";
        $sql .= " ORDER BY r.ReceivingDate DESC LIMIT 300 ";

        $stmt = $conn->prepare($sql);
        $params = [];
        if ($search !== "") { $params[":s"] = "%$search%"; $params[":s2"] = "%$search%"; }
        $stmt->execute($params);
        response(true, "Receiving discrepancies loaded.", $stmt->fetchAll());
    }

    if ($operation === "getAdjustmentDiscrepancies") {
        $search = getSearch($input);
        $sql = "
            SELECT ia.Adjustment_ID, ia.Adjustment_Date,
                   p.ProductName,
                   ial.System_Quantity, ial.Actual_Quantity,
                   ial.Adjustment_Quantity, ial.Adjustment_Type
            FROM inventory_adjustment_line ial
            INNER JOIN inventory_adjustment ia ON ial.Adjustment_ID = ia.Adjustment_ID
            INNER JOIN product p ON ial.Product_ID = p.ProductID
            WHERE ial.IsArchived = 'No' AND ia.IsArchived = 'No'
              AND ial.Adjustment_Quantity > 0
        ";
        if ($search !== "") $sql .= " AND (p.ProductName LIKE :s OR ia.Adjustment_ID LIKE :s2) ";
        $sql .= " ORDER BY ia.Adjustment_Date DESC LIMIT 300 ";

        $stmt = $conn->prepare($sql);
        $params = [];
        if ($search !== "") { $params[":s"] = "%$search%"; $params[":s2"] = "%$search%"; }
        $stmt->execute($params);
        response(true, "Adjustment discrepancies loaded.", $stmt->fetchAll());
    }

    if ($operation === "getInventoryAdjustments") {
        $search = getSearch($input);

        $sql = "
            SELECT ia.Adjustment_ID, ia.Adjustment_Date, ia.User_ID,
                   CONCAT(u.FirstName, ' ', u.LastName) AS UserName,
                   ia.Reason, ia.Status_ID, s.StatusName,
                   ial.Adjustment_Line_ID, ial.Product_ID, p.ProductName,
                   ial.System_Quantity, ial.Actual_Quantity,
                   ial.Adjustment_Quantity, ial.Adjustment_Type
            FROM inventory_adjustment ia
            LEFT JOIN inventory_adjustment_line ial
                ON ia.Adjustment_ID = ial.Adjustment_ID AND ial.IsArchived = 'No'
            LEFT JOIN product p ON ial.Product_ID = p.ProductID
            LEFT JOIN `user` u ON ia.User_ID = u.UserID
            LEFT JOIN status s ON ia.Status_ID = s.StatusID
            WHERE ia.IsArchived = 'No'
        ";

        if ($search !== "") {
            $sql .= " AND (p.ProductName LIKE :s1 OR ia.Reason LIKE :s2 OR s.StatusName LIKE :s3) ";
        }
        $sql .= " ORDER BY ia.Adjustment_Date DESC LIMIT 500 ";

        $stmt = $conn->prepare($sql);
        $params = [];
        if ($search !== "") {
            $params[":s1"] = "%$search%";
            $params[":s2"] = "%$search%";
            $params[":s3"] = "%$search%";
        }
        $stmt->execute($params);
        response(true, "Adjustments loaded.", $stmt->fetchAll());
    }

    if ($operation === "getInventoryAdjustment") {
        $id = intval($input["Adjustment_ID"] ?? 0);
        $stmt = $conn->prepare("
            SELECT ia.*, s.StatusName,
                   CONCAT(u.FirstName, ' ', u.LastName) AS UserName
            FROM inventory_adjustment ia
            LEFT JOIN status s ON ia.Status_ID = s.StatusID
            LEFT JOIN `user` u ON ia.User_ID = u.UserID
            WHERE ia.Adjustment_ID = :id LIMIT 1
        ");
        $stmt->execute([":id" => $id]);
        $parent = $stmt->fetch();
        if (!$parent) response(false, "Not found.", null);

        $lineStmt = $conn->prepare("
            SELECT ial.*, p.ProductName, p.Barcode
            FROM inventory_adjustment_line ial
            LEFT JOIN product p ON ial.Product_ID = p.ProductID
            WHERE ial.Adjustment_ID = :id AND ial.IsArchived = 'No'
        ");
        $lineStmt->execute([":id" => $id]);
        $parent["lines"] = $lineStmt->fetchAll();

        response(true, "Adjustment loaded.", $parent);
    }

    if ($operation === "getStockReturns") {
        $search = getSearch($input);

        $sql = "
            SELECT sr.Stock_Return_ID, sr.User_ID,
                   CONCAT(u.FirstName, ' ', u.LastName) AS UserName,
                   sr.Return_Date, sr.Status_ID, s.StatusName, sr.Reason,
                   srl.Stock_Return_Line_ID, srl.Product_ID, p.ProductName, srl.Quantity
            FROM stock_return sr
            LEFT JOIN stock_return_line srl
                ON sr.Stock_Return_ID = srl.Stock_Return_ID AND srl.IsArchived = 'No'
            LEFT JOIN product p ON srl.Product_ID = p.ProductID
            LEFT JOIN `user` u ON sr.User_ID = u.UserID
            LEFT JOIN status s ON sr.Status_ID = s.StatusID
            WHERE sr.IsArchived = 'No'
        ";
        if ($search !== "") {
            $sql .= " AND (sr.Reason LIKE :s1 OR s.StatusName LIKE :s2 OR p.ProductName LIKE :s3) ";
        }
        $sql .= " ORDER BY sr.Return_Date DESC LIMIT 500 ";

        $stmt = $conn->prepare($sql);
        $params = [];
        if ($search !== "") {
            $params[":s1"] = "%$search%";
            $params[":s2"] = "%$search%";
            $params[":s3"] = "%$search%";
        }
        $stmt->execute($params);
        response(true, "Stock returns loaded.", $stmt->fetchAll());
    }

    if ($operation === "getStockReturn") {
        $id = intval($input["Stock_Return_ID"] ?? 0);
        $stmt = $conn->prepare("
            SELECT sr.*, s.StatusName,
                   CONCAT(u.FirstName, ' ', u.LastName) AS UserName
            FROM stock_return sr
            LEFT JOIN status s ON sr.Status_ID = s.StatusID
            LEFT JOIN `user` u ON sr.User_ID = u.UserID
            WHERE sr.Stock_Return_ID = :id LIMIT 1
        ");
        $stmt->execute([":id" => $id]);
        $parent = $stmt->fetch();
        if (!$parent) response(false, "Not found.", null);

        $lineStmt = $conn->prepare("
            SELECT srl.*, p.ProductName, p.Barcode
            FROM stock_return_line srl
            LEFT JOIN product p ON srl.Product_ID = p.ProductID
            WHERE srl.Stock_Return_ID = :id AND srl.IsArchived = 'No'
        ");
        $lineStmt->execute([":id" => $id]);
        $parent["lines"] = $lineStmt->fetchAll();

        response(true, "Stock return loaded.", $parent);
    }

    function setStatusByName($conn, $statusName) {
        $stmt = $conn->prepare("
            SELECT StatusID FROM status
            WHERE LOWER(TRIM(StatusName)) = :sn AND IsArchived = 'No' LIMIT 1
        ");
        $stmt->execute([":sn" => strtolower($statusName)]);
        $row = $stmt->fetch();
        return $row ? intval($row["StatusID"]) : null;
    }

    if ($operation === "approveAdjustment") {
        $id = intval($input["Adjustment_ID"] ?? 0);
        if ($id <= 0) response(false, "Invalid ID.", null);

        $approvedID = setStatusByName($conn, "approved");
        if (!$approvedID) response(false, "No 'Approved' status found.", null);

        $conn->prepare("UPDATE inventory_adjustment SET Status_ID = :s WHERE Adjustment_ID = :id")
             ->execute([":s" => $approvedID, ":id" => $id]);

        addAudit($conn, $currentUserID, "APPROVE", "inventory_adjustment", "Approved adjustment #$id");
        response(true, "Adjustment approved.", null);
    }

    if ($operation === "rejectAdjustment") {
        $id = intval($input["Adjustment_ID"] ?? 0);
        $reason = trim($input["Reason"] ?? "");
        if ($id <= 0) response(false, "Invalid ID.", null);

        $rejectedID = setStatusByName($conn, "rejected");
        if (!$rejectedID) response(false, "No 'Rejected' status found.", null);

        $conn->prepare("
            UPDATE inventory_adjustment
            SET Status_ID = :s, Reason = CONCAT(COALESCE(Reason,''), ' [Rejected: ', :r, ']')
            WHERE Adjustment_ID = :id
        ")->execute([":s" => $rejectedID, ":r" => $reason, ":id" => $id]);

        addAudit($conn, $currentUserID, "REJECT", "inventory_adjustment", "Rejected adjustment #$id");
        response(true, "Adjustment rejected.", null);
    }

    if ($operation === "approveStockReturn") {
        $id = intval($input["Stock_Return_ID"] ?? 0);
        if ($id <= 0) response(false, "Invalid ID.", null);

        $approvedID = setStatusByName($conn, "approved");
        if (!$approvedID) response(false, "No 'Approved' status found.", null);

        $conn->prepare("UPDATE stock_return SET Status_ID = :s WHERE Stock_Return_ID = :id")
             ->execute([":s" => $approvedID, ":id" => $id]);

        addAudit($conn, $currentUserID, "APPROVE", "stock_return", "Approved stock return #$id");
        response(true, "Stock return approved.", null);
    }

    if ($operation === "rejectStockReturn") {
        $id = intval($input["Stock_Return_ID"] ?? 0);
        $reason = trim($input["Reason"] ?? "");
        if ($id <= 0) response(false, "Invalid ID.", null);

        $rejectedID = setStatusByName($conn, "rejected");
        if (!$rejectedID) response(false, "No 'Rejected' status found.", null);

        $conn->prepare("
            UPDATE stock_return
            SET Status_ID = :s, Reason = CONCAT(COALESCE(Reason,''), ' [Rejected: ', :r, ']')
            WHERE Stock_Return_ID = :id
        ")->execute([":s" => $rejectedID, ":r" => $reason, ":id" => $id]);

        addAudit($conn, $currentUserID, "REJECT", "stock_return", "Rejected stock return #$id");
        response(true, "Stock return rejected.", null);
    }

    if ($operation === "getPurchaseOrders") {
        $search = getSearch($input);
        $sql = "
            SELECT po.PO_ID, po.PO_Date, po.Expected_Date,
                   s.SupplierName,
                   CONCAT(u.FirstName, ' ', u.LastName) AS UserName,
                   st.StatusName
            FROM purchase_order po
            LEFT JOIN supplier s ON po.Supplier_ID = s.SupplierID
            LEFT JOIN `user` u ON po.User_ID = u.UserID
            LEFT JOIN status st ON po.Status_ID = st.StatusID
            WHERE po.IsArchived = 'No'
        ";
        if ($search !== "") $sql .= " AND (s.SupplierName LIKE :s1 OR po.PO_ID LIKE :s2) ";
        $sql .= " ORDER BY po.PO_Date DESC LIMIT 500 ";

        $stmt = $conn->prepare($sql);
        $params = [];
        if ($search !== "") { $params[":s1"] = "%$search%"; $params[":s2"] = "%$search%"; }
        $stmt->execute($params);
        response(true, "POs loaded.", $stmt->fetchAll());
    }

    /* ============================================================
       getPurchaseOrder
       Single PO header + its ordered product lines, used by the
       Manager Purchase Orders page's "View" action.
    ============================================================ */
    if ($operation === "getPurchaseOrder") {
        $id = intval($input["PO_ID"] ?? 0);
        if ($id <= 0) response(false, "Invalid ID.", null);

        $stmt = $conn->prepare("
            SELECT po.*, s.SupplierName,
                   CONCAT(u.FirstName, ' ', u.LastName) AS UserName,
                   st.StatusName
            FROM purchase_order po
            LEFT JOIN supplier s ON po.Supplier_ID = s.SupplierID
            LEFT JOIN `user` u ON po.User_ID = u.UserID
            LEFT JOIN status st ON po.Status_ID = st.StatusID
            WHERE po.PO_ID = :id LIMIT 1
        ");
        $stmt->execute([":id" => $id]);
        $parent = $stmt->fetch();
        if (!$parent) response(false, "Not found.", null);

        $lineStmt = $conn->prepare("
            SELECT pol.*, p.ProductName, p.Barcode
            FROM purchase_order_line pol
            LEFT JOIN product p ON pol.Product_ID = p.ProductID
            WHERE pol.PO_ID = :id AND pol.IsArchived = 'No'
        ");
        $lineStmt->execute([":id" => $id]);
        $parent["lines"] = $lineStmt->fetchAll();

        response(true, "Purchase order loaded.", $parent);
    }

    /* ============================================================
       ✅ FIXED — getReceivings
       PO_Reference is now aliased straight off receiving.PO_ID
       (a real FK column per the schema) instead of a text field
       that didn't exist on this table.
    ============================================================ */
    if ($operation === "getReceivings") {
        $search = getSearch($input);
        $sql = "
            SELECT r.ReceivingID, r.ReceivingDate,
                   s.SupplierName,
                   CONCAT(u.FirstName, ' ', u.LastName) AS UserName,
                   r.PO_ID AS PO_Reference,
                   st.StatusName
            FROM receiving r
            LEFT JOIN supplier s ON r.SupplierID = s.SupplierID
            LEFT JOIN `user` u ON r.ReceivedByUserID = u.UserID
            LEFT JOIN status st ON r.StatusID = st.StatusID
            WHERE r.IsArchived = 'No'
        ";
        if ($search !== "") $sql .= " AND (s.SupplierName LIKE :s1 OR r.PO_ID LIKE :s2) ";
        $sql .= " ORDER BY r.ReceivingDate DESC LIMIT 500 ";

        $stmt = $conn->prepare($sql);
        $params = [];
        if ($search !== "") { $params[":s1"] = "%$search%"; $params[":s2"] = "%$search%"; }
        $stmt->execute($params);
        response(true, "Receivings loaded.", $stmt->fetchAll());
    }

    /* ============================================================
       ✅ FIXED — getReceiving
       Single receiving header + a merged "Ordered vs Received"
       line list, used by the Manager Receivings page's "View"
       action. Ordered qty comes from purchase_order_line (via the
       receiving's PO_ID), received qty comes from receiving_line;
       the two are merged per ProductID so a product that was
       ordered-but-not-received (or received-without-being-ordered)
       still shows up correctly, with a computed Variance.
    ============================================================ */
    if ($operation === "getReceiving") {
        $id = intval($input["ReceivingID"] ?? 0);
        if ($id <= 0) response(false, "Invalid ID.", null);

        $stmt = $conn->prepare("
            SELECT r.*, s.SupplierName,
                   CONCAT(u.FirstName, ' ', u.LastName) AS UserName,
                   st.StatusName
            FROM receiving r
            LEFT JOIN supplier s ON r.SupplierID = s.SupplierID
            LEFT JOIN `user` u ON r.ReceivedByUserID = u.UserID
            LEFT JOIN status st ON r.StatusID = st.StatusID
            WHERE r.ReceivingID = :id LIMIT 1
        ");
        $stmt->execute([":id" => $id]);
        $parent = $stmt->fetch();
        if (!$parent) response(false, "Not found.", null);

        $parent["PO_Reference"] = $parent["PO_ID"] ?? null;

        // Products ordered on the linked PO (if any)
        $orderedLines = [];
        if (!empty($parent["PO_ID"])) {
            $poStmt = $conn->prepare("
                SELECT pol.Product_ID, p.ProductName, p.Barcode, pol.Quantity AS OrderedQuantity
                FROM purchase_order_line pol
                LEFT JOIN product p ON pol.Product_ID = p.ProductID
                WHERE pol.PO_ID = :poid AND pol.IsArchived = 'No'
            ");
            $poStmt->execute([":poid" => $parent["PO_ID"]]);
            $orderedLines = $poStmt->fetchAll();
        }

        // Products actually received on this receiving record
        $recvStmt = $conn->prepare("
            SELECT rl.ProductID AS Product_ID, p.ProductName, p.Barcode, rl.ReceivedQuantity
            FROM receiving_line rl
            LEFT JOIN product p ON rl.ProductID = p.ProductID
            WHERE rl.ReceivingID = :id AND rl.IsArchived = 'No'
        ");
        $recvStmt->execute([":id" => $id]);
        $receivedLines = $recvStmt->fetchAll();

        // Merge ordered + received by ProductID
        $merged = [];

        foreach ($orderedLines as $ol) {
            $pid = $ol["Product_ID"];
            $merged[$pid] = [
                "ProductID"        => $pid,
                "ProductName"      => $ol["ProductName"],
                "Barcode"          => $ol["Barcode"],
                "OrderedQuantity"  => (float) $ol["OrderedQuantity"],
                "ReceivedQuantity" => 0
            ];
        }

        foreach ($receivedLines as $rl) {
            $pid = $rl["Product_ID"];
            if (!isset($merged[$pid])) {
                $merged[$pid] = [
                    "ProductID"        => $pid,
                    "ProductName"      => $rl["ProductName"],
                    "Barcode"          => $rl["Barcode"],
                    "OrderedQuantity"  => 0,
                    "ReceivedQuantity" => 0
                ];
            }
            $merged[$pid]["ReceivedQuantity"] += (float) $rl["ReceivedQuantity"];
        }

        foreach ($merged as &$m) {
            $m["Variance"] = $m["ReceivedQuantity"] - $m["OrderedQuantity"];
        }
        unset($m);

        // Sort by product name for a stable, readable display order
        $linesOut = array_values($merged);
        usort($linesOut, function ($a, $b) {
            return strcmp((string) $a["ProductName"], (string) $b["ProductName"]);
        });

        $parent["lines"] = $linesOut;

        response(true, "Receiving loaded.", $parent);
    }

    if ($operation === "getPurchaseReturns") {
        $search = getSearch($input);
        $sql = "
            SELECT pr.Purchase_Return_ID, pr.Return_Date,
                   s.SupplierName,
                   p.ProductName, prl.Quantity, pr.Reason
            FROM purchase_return pr
            LEFT JOIN supplier s ON pr.Supplier_ID = s.SupplierID
            LEFT JOIN purchase_return_line prl 
                ON pr.Purchase_Return_ID = prl.Purchase_Return_ID 
                AND prl.IsArchived = 'No'
            LEFT JOIN product p ON prl.Product_ID = p.ProductID
            WHERE pr.IsArchived = 'No'
        ";
        if ($search !== "") $sql .= " AND (s.SupplierName LIKE :s1 OR pr.Reason LIKE :s2) ";
        $sql .= " ORDER BY pr.Return_Date DESC LIMIT 500 ";

        $stmt = $conn->prepare($sql);
        $params = [];
        if ($search !== "") { $params[":s1"] = "%$search%"; $params[":s2"] = "%$search%"; }
        $stmt->execute($params);
        response(true, "Purchase returns loaded.", $stmt->fetchAll());
    }

    if ($operation === "getTransactionSummary") {
        $results = [];

        $stmt = $conn->query("
            SELECT 'Receiving' AS Type,
                   COUNT(DISTINCT r.ReceivingID) AS Count,
                   COALESCE(SUM(rl.ReceivedQuantity), 0) AS TotalQty
            FROM receiving r
            LEFT JOIN receiving_line rl ON r.ReceivingID = rl.ReceivingID AND rl.IsArchived = 'No'
            WHERE r.IsArchived = 'No'
              AND r.ReceivingDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        ");
        $results[] = $stmt->fetch();

        $stmt = $conn->query("
            SELECT 'Stock Release' AS Type,
                   COUNT(DISTINCT sr.ReleaseID) AS Count,
                   COALESCE(SUM(srl.QuantityReleased), 0) AS TotalQty
            FROM stock_release sr
            LEFT JOIN stock_release_line srl ON sr.ReleaseID = srl.ReleaseID AND srl.IsArchived = 'No'
            WHERE sr.IsArchived = 'No'
              AND sr.ReleaseDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        ");
        $results[] = $stmt->fetch();

        $stmt = $conn->query("
            SELECT 'Stock Return' AS Type,
                   COUNT(DISTINCT sr.Stock_Return_ID) AS Count,
                   COALESCE(SUM(srl.Quantity), 0) AS TotalQty
            FROM stock_return sr
            LEFT JOIN stock_return_line srl ON sr.Stock_Return_ID = srl.Stock_Return_ID AND srl.IsArchived = 'No'
            WHERE sr.IsArchived = 'No'
              AND sr.Return_Date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        ");
        $results[] = $stmt->fetch();

        $stmt = $conn->query("
            SELECT 'Adjustment' AS Type,
                   COUNT(DISTINCT ia.Adjustment_ID) AS Count,
                   COALESCE(SUM(ial.Adjustment_Quantity), 0) AS TotalQty
            FROM inventory_adjustment ia
            LEFT JOIN inventory_adjustment_line ial ON ia.Adjustment_ID = ial.Adjustment_ID AND ial.IsArchived = 'No'
            WHERE ia.IsArchived = 'No'
              AND ia.Adjustment_Date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        ");
        $results[] = $stmt->fetch();

        response(true, "Transaction summary loaded.", $results);
    }

    if ($operation === "getAuditLogs") {
        $search = getSearch($input);
        $sql = "
            SELECT a.AuditLogID, u.UserName, a.ActionType,
                   a.TableAffected, a.ActionTimestamp, a.Details
            FROM auditlog a
            LEFT JOIN `user` u ON a.UserID = u.UserID
            WHERE a.IsArchived = 'No'
        ";
        if ($search !== "") {
            $sql .= " AND (u.UserName LIKE :s1 OR a.ActionType LIKE :s2
                     OR a.TableAffected LIKE :s3 OR a.Details LIKE :s4) ";
        }
        $sql .= " ORDER BY a.ActionTimestamp DESC LIMIT 500 ";

        $stmt = $conn->prepare($sql);
        $params = [];
        if ($search !== "") {
            $params[":s1"] = "%$search%";
            $params[":s2"] = "%$search%";
            $params[":s3"] = "%$search%";
            $params[":s4"] = "%$search%";
        }
        $stmt->execute($params);
        response(true, "Audit loaded.", $stmt->fetchAll());
    }

    if ($operation === "getStaffActivity") {
        $stmt = $conn->query("
            SELECT
                u.UserID, u.UserName,
                CONCAT(u.FirstName, ' ', u.LastName) AS FullName,
                r.RoleName,
                COUNT(a.AuditLogID) AS TotalActions,
                MAX(a.ActionTimestamp) AS LastActivity
            FROM `user` u
            LEFT JOIN `role` r ON u.RoleID = r.RoleID
            LEFT JOIN auditlog a ON a.UserID = u.UserID AND a.IsArchived = 'No'
            WHERE u.IsArchived = 'No'
            GROUP BY u.UserID
            ORDER BY TotalActions DESC
        ");
        $rows = $stmt->fetchAll();

        foreach ($rows as &$r) {
            if (empty($r["UserName"]) && !empty($r["FullName"])) {
                $r["UserName"] = $r["FullName"];
            }
        }
        unset($r);

        response(true, "Staff activity loaded.", $rows);
    }

    if ($operation === "getStatuses") {
        $stmt = $conn->query("
            SELECT StatusID, StatusName FROM status
            WHERE IsArchived = 'No' ORDER BY StatusName ASC
        ");
        response(true, "Statuses loaded.", $stmt->fetchAll());
    }

    response(false, "Invalid operation: " . $operation, null);

} catch (PDOException $e) {
    response(false, "DB error: " . $e->getMessage(), null);
} catch (Exception $e) {
    response(false, "Server error: " . $e->getMessage(), null);
}