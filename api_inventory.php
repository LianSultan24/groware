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

function getPendingStatusID($conn)
{
    try {
        $stmt = $conn->query("
            SELECT StatusID FROM status
            WHERE LOWER(TRIM(StatusName)) = 'pending'
            AND IsArchived = 'No'
            LIMIT 1
        ");
        $row = $stmt->fetch();
        return $row ? intval($row["StatusID"]) : 1;
    } catch (Exception $e) {
        return 1;
    }
}

function requireInventoryStaff($conn, $currentUserID)
{
    if (!$currentUserID || intval($currentUserID) <= 0) {
        response(false, "Inventory Staff access required.", null);
    }

    try {
        $stmt = $conn->prepare("
            SELECT
                u.UserID, u.UserName, u.FirstName, u.LastName,
                u.UserStatus, u.IsArchived AS UserArchived,
                u.RoleID, r.RoleName, r.IsArchived AS RoleArchived
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
        $allowed = [
            "inventory staff", "inventory",
            "inventory officer", "stock clerk",
            "admin", "administrator"
        ];

        if (!in_array($roleName, $allowed)) {
            response(false,
                "Inventory Staff access required. Current role: " .
                ($user["RoleName"] ?? "No Role"), null);
        }

        return $user;
    } catch (PDOException $e) {
        response(false, "Authorization error: " . $e->getMessage(), null);
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

function stockJoins()
{
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
            SELECT
                Product_ID AS pid,
                SUM(CASE
                    WHEN LOWER(TRIM(Adjustment_Type)) = 'increase' THEN Adjustment_Quantity
                    WHEN LOWER(TRIM(Adjustment_Type)) = 'decrease' THEN -Adjustment_Quantity
                    ELSE 0
                END) AS qty
            FROM inventory_adjustment_line WHERE IsArchived = 'No' GROUP BY Product_ID
        ) adj ON adj.pid = p.ProductID
    ";
}

function stockExpression()
{
    return "(
        COALESCE(rin.qty, 0)
        - COALESCE(rel.qty, 0)
        + COALESCE(sret.qty, 0)
        - COALESCE(pret.qty, 0)
        + COALESCE(adj.qty, 0)
    )";
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

        addAudit($conn, intval($user["UserID"]), "LOGIN", "user", "Inventory Staff logged in.");
        response(true, "Login successful.", $user);
    }

    if ($operation === "logout") {
        if ($currentUserID > 0) {
            addAudit($conn, $currentUserID, "LOGOUT", "user", "Inventory Staff logged out.");
        }
        response(true, "Logout successful.", null);
    }

    requireInventoryStaff($conn, $currentUserID);

    if ($operation === "getInventoryDashboard") {

        $stmt = $conn->query("SELECT COUNT(*) AS total FROM product WHERE IsArchived='No'");
        $totalProducts = intval($stmt->fetch()["total"]);

        $stmt = $conn->query("SELECT COUNT(*) AS total FROM category WHERE IsArchived='No'");
        $totalCategories = intval($stmt->fetch()["total"]);

        $stmt = $conn->query("SELECT COUNT(*) AS total FROM aisle WHERE IsArchived='No'");
        $totalAisles = intval($stmt->fetch()["total"]);

        $stmt = $conn->query("SELECT COUNT(*) AS total FROM shelf WHERE IsArchived='No'");
        $totalShelves = intval($stmt->fetch()["total"]);

        $stmt = $conn->query("SELECT COUNT(*) AS total FROM bin WHERE IsArchived='No'");
        $totalBins = intval($stmt->fetch()["total"]);

        $stmt = $conn->query("
            SELECT COUNT(*) AS total
            FROM inventory_adjustment ia
            LEFT JOIN status s ON ia.Status_ID = s.StatusID
            WHERE ia.IsArchived = 'No'
            AND LOWER(TRIM(s.StatusName)) IN ('pending','for review','submitted')
        ");
        $pendingAdjustments = intval($stmt->fetch()["total"]);

        $stmt = $conn->query("
            SELECT COUNT(*) AS total
            FROM stock_return sr
            LEFT JOIN status s ON sr.Status_ID = s.StatusID
            WHERE sr.IsArchived = 'No'
            AND LOWER(TRIM(s.StatusName)) IN ('pending','for review','submitted')
        ");
        $pendingReturns = intval($stmt->fetch()["total"]);

        $stmt = $conn->query("
            SELECT ProductID, ProductName, Barcode, MinStockLevel
            FROM product WHERE IsArchived='No'
            ORDER BY MinStockLevel DESC, ProductName ASC LIMIT 10
        ");
        $lowStockWatchlist = $stmt->fetchAll();

        $stmt = $conn->query("
            SELECT
                ia.Adjustment_ID,
                ia.Adjustment_Date,
                ia.Status_ID,
                s.StatusName,
                GROUP_CONCAT(p.ProductName SEPARATOR ', ') AS ProductNames
            FROM inventory_adjustment ia
            LEFT JOIN status s ON ia.Status_ID = s.StatusID
            LEFT JOIN inventory_adjustment_line ial 
                ON ia.Adjustment_ID = ial.Adjustment_ID 
                AND ial.IsArchived = 'No'
            LEFT JOIN product p 
                ON ial.Product_ID = p.ProductID
            WHERE ia.IsArchived = 'No'
            GROUP BY ia.Adjustment_ID
            ORDER BY ia.Adjustment_Date DESC, ia.Adjustment_ID DESC
            LIMIT 8
        ");

        $recentAdjustments = $stmt->fetchAll();

        foreach ($recentAdjustments as &$adj) {
            if (empty($adj["ProductNames"])) {
                $adj["ProductNames"] = "—";
            }
        }
        unset($adj);

        response(true, "Inventory dashboard loaded.", [
            "totalProducts"      => $totalProducts,
            "totalCategories"    => $totalCategories,
            "totalAisles"        => $totalAisles,
            "totalShelves"       => $totalShelves,
            "totalBins"          => $totalBins,
            "pendingAdjustments" => $pendingAdjustments,
            "pendingReturns"     => $pendingReturns,
            "lowStockWatchlist"  => $lowStockWatchlist,
            "recentAdjustments"  => $recentAdjustments
        ]);
    }

    if ($operation === "getProducts") {
        $search   = getSearch($input);
        $archived = getArchivedFilter($input);

        $sql = "
            SELECT p.ProductID, p.Barcode, p.ProductName, p.Description,
                   p.UnitOfMeasureID, u.UnitName, p.MinStockLevel, p.CreatedAt,
                   p.BinID, b.BinCode, s.ShelfCode, a.AisleCode,
                   p.CategoryID, c.CategoryName, p.IsArchived,
                   " . stockExpression() . " AS OnHand
            FROM product p
            LEFT JOIN category c ON p.CategoryID = c.CategoryID
            LEFT JOIN bin b ON p.BinID = b.BinID
            LEFT JOIN shelf s ON b.ShelfID = s.ShelfID
            LEFT JOIN aisle a ON s.AisleID = a.AisleID
            LEFT JOIN unit_of_measure u ON p.UnitOfMeasureID = u.UnitOfMeasureID
            " . stockJoins() . "
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

    if ($operation === "getProductStock") {
        $productID = intval($input["Product_ID"] ?? 0);
        if ($productID <= 0) response(false, "Product ID required.", null);

        $sql = "
            SELECT
                p.ProductID, p.ProductName, p.Barcode,
                p.MinStockLevel,
                c.CategoryName,
                u.UnitName, u.UnitSymbol,
                " . stockExpression() . " AS OnHandQuantity
            FROM product p
            LEFT JOIN category c ON p.CategoryID = c.CategoryID
            LEFT JOIN unit_of_measure u ON p.UnitOfMeasureID = u.UnitOfMeasureID
            " . stockJoins() . "
            WHERE p.ProductID = :id
            LIMIT 1
        ";

        $stmt = $conn->prepare($sql);
        $stmt->execute([":id" => $productID]);
        $row = $stmt->fetch();

        if (!$row) response(false, "Product not found.", null);

        response(true, "Stock loaded.", $row);
    }

    if ($operation === "getCategories") {
        $search   = getSearch($input);
        $archived = getArchivedFilter($input);

        $sql = "SELECT CategoryID, CategoryName, IsArchived
                FROM category WHERE IsArchived = :archived";
        if ($search !== "") $sql .= " AND CategoryName LIKE :search ";
        $sql .= " ORDER BY CategoryName ASC ";

        $stmt = $conn->prepare($sql);
        $params = [":archived" => $archived ? "Yes" : "No"];
        if ($search !== "") $params[":search"] = "%$search%";
        $stmt->execute($params);
        response(true, "Categories loaded.", $stmt->fetchAll());
    }

    if ($operation === "getAisles") {
        $search   = getSearch($input);
        $archived = getArchivedFilter($input);

        $sql = "SELECT AisleID, AisleCode, IsArchived
                FROM aisle WHERE IsArchived = :archived";
        if ($search !== "") $sql .= " AND AisleCode LIKE :search ";
        $sql .= " ORDER BY AisleCode ASC ";

        $stmt = $conn->prepare($sql);
        $params = [":archived" => $archived ? "Yes" : "No"];
        if ($search !== "") $params[":search"] = "%$search%";
        $stmt->execute($params);
        response(true, "Aisles loaded.", $stmt->fetchAll());
    }

    if ($operation === "getShelves") {
        $search   = getSearch($input);
        $archived = getArchivedFilter($input);

        $sql = "SELECT s.ShelfID, s.AisleID, a.AisleCode, s.ShelfCode, s.IsArchived
                FROM shelf s LEFT JOIN aisle a ON s.AisleID = a.AisleID
                WHERE s.IsArchived = :archived";
        if ($search !== "") $sql .= " AND (s.ShelfCode LIKE :search OR a.AisleCode LIKE :search2) ";
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

    if ($operation === "getBins") {
        $search   = getSearch($input);
        $archived = getArchivedFilter($input);

        $sql = "SELECT b.BinID, b.ShelfID, s.ShelfCode, a.AisleCode, b.BinCode, b.IsArchived
                FROM bin b
                LEFT JOIN shelf s ON b.ShelfID = s.ShelfID
                LEFT JOIN aisle a ON s.AisleID = a.AisleID
                WHERE b.IsArchived = :archived";
        if ($search !== "") {
            $sql .= " AND (b.BinCode LIKE :search OR s.ShelfCode LIKE :search2 OR a.AisleCode LIKE :search3) ";
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

    if ($operation === "getUnitsOfMeasure") {
        $stmt = $conn->query("
            SELECT UnitOfMeasureID, UnitName, UnitSymbol, IsArchived
            FROM unit_of_measure WHERE IsArchived = 'No'
            ORDER BY UnitName ASC
        ");
        response(true, "Units loaded.", $stmt->fetchAll());
    }

    if ($operation === "getInventoryQuantities") {
        $search = getSearch($input);

        $sql = "
            SELECT
                p.ProductID, p.Barcode, p.ProductName, p.MinStockLevel,
                c.CategoryName, u.UnitName, u.UnitSymbol,
                b.BinCode, s.ShelfCode, a.AisleCode,
                COALESCE(rin.qty, 0) AS Received,
                COALESCE(rel.qty, 0) AS Released,
                COALESCE(sret.qty, 0) AS Returned,
                COALESCE(pret.qty, 0) AS PurchaseReturned,
                COALESCE(adj.qty, 0) AS Adjusted,
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

        if ($search !== "") {
            $sql .= " AND (p.ProductName LIKE :search OR p.Barcode LIKE :search2 OR c.CategoryName LIKE :search3) ";
        }

        $sql .= " ORDER BY p.ProductName ASC ";

        $stmt = $conn->prepare($sql);
        $params = [];
        if ($search !== "") {
            $params[":search"]  = "%$search%";
            $params[":search2"] = "%$search%";
            $params[":search3"] = "%$search%";
        }
        $stmt->execute($params);
        response(true, "Inventory quantities loaded.", $stmt->fetchAll());
    }

    if ($operation === "getLowStock") {
        $sql = "
            SELECT
                p.ProductID, p.Barcode, p.ProductName, p.MinStockLevel,
                c.CategoryName, u.UnitName, u.UnitSymbol,
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
            ORDER BY (p.MinStockLevel - OnHandQuantity) DESC, p.ProductName ASC
        ";
        $stmt = $conn->query($sql);
        response(true, "Low stock loaded.", $stmt->fetchAll());
    }

    if ($operation === "getInventoryAdjustments") {
        $search   = getSearch($input);
        $archived = getArchivedFilter($input);

        $sql = "
            SELECT
                ia.Adjustment_ID, ia.Adjustment_Date, ia.User_ID,
                CONCAT(u.FirstName, ' ', u.LastName) AS UserName,
                ia.Reason, ia.Status_ID, s.StatusName, ia.IsArchived,
                ial.Adjustment_Line_ID, ial.Product_ID, p.ProductName, p.Barcode,
                ial.System_Quantity, ial.Actual_Quantity,
                ial.Adjustment_Quantity, ial.Adjustment_Type
            FROM inventory_adjustment ia
            LEFT JOIN inventory_adjustment_line ial
                ON ia.Adjustment_ID = ial.Adjustment_ID AND ial.IsArchived = 'No'
            LEFT JOIN product p ON ial.Product_ID = p.ProductID
            LEFT JOIN `user` u ON ia.User_ID = u.UserID
            LEFT JOIN status s ON ia.Status_ID = s.StatusID
            WHERE ia.IsArchived = :archived
        ";

        if ($search !== "") {
            $sql .= " AND (p.ProductName LIKE :search OR p.Barcode LIKE :search2
                     OR ia.Reason LIKE :search3 OR s.StatusName LIKE :search4) ";
        }

        $sql .= " ORDER BY ia.Adjustment_Date DESC, ia.Adjustment_ID DESC, ial.Adjustment_Line_ID ASC ";

        $stmt = $conn->prepare($sql);
        $params = [":archived" => $archived ? "Yes" : "No"];
        if ($search !== "") {
            $params[":search"]  = "%$search%";
            $params[":search2"] = "%$search%";
            $params[":search3"] = "%$search%";
            $params[":search4"] = "%$search%";
        }
        $stmt->execute($params);
        response(true, "Inventory adjustments loaded.", $stmt->fetchAll());
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
        if (!$parent) response(false, "Adjustment not found.", null);

        $lineStmt = $conn->prepare("
            SELECT ial.*, p.ProductName, p.Barcode
            FROM inventory_adjustment_line ial
            LEFT JOIN product p ON ial.Product_ID = p.ProductID
            WHERE ial.Adjustment_ID = :id AND ial.IsArchived = 'No'
            ORDER BY ial.Adjustment_Line_ID ASC
        ");
        $lineStmt->execute([":id" => $id]);
        $parent["lines"] = $lineStmt->fetchAll();

        response(true, "Adjustment loaded.", $parent);
    }

    if ($operation === "insertInventoryAdjustment") {
        $productID = intval($input["Product_ID"] ?? 0);
        $systemQty = intval($input["System_Quantity"] ?? 0);
        $actualQty = intval($input["Actual_Quantity"] ?? 0);
        $adjType   = trim($input["Adjustment_Type"] ?? "");
        $reason    = trim($input["Reason"] ?? "");
        $statusID  = intval($input["Status_ID"] ?? 0);

        if ($productID <= 0) response(false, "Product is required.", null);

        $adjTypeLower = strtolower($adjType);
        if ($adjTypeLower !== "increase" && $adjTypeLower !== "decrease")
            response(false, "Adjustment type must be Increase or Decrease.", null);

        if ($reason === "") response(false, "Reason is required.", null);

        $adjustmentQty = abs($actualQty - $systemQty);
        if ($statusID <= 0) $statusID = getPendingStatusID($conn);

        $conn->beginTransaction();
        try {
            $stmt = $conn->prepare("
                INSERT INTO inventory_adjustment
                (User_ID, Adjustment_Date, Reason, Status_ID, IsArchived)
                VALUES (:userid, NOW(), :reason, :status, 'No')
            ");
            $stmt->execute([
                ":userid" => $currentUserID,
                ":reason" => $reason,
                ":status" => $statusID
            ]);
            $newID = $conn->lastInsertId();

            $lineStmt = $conn->prepare("
                INSERT INTO inventory_adjustment_line
                (Adjustment_ID, Product_ID, System_Quantity, Actual_Quantity,
                 Adjustment_Quantity, Adjustment_Type, IsArchived)
                VALUES (:adjid, :product, :systemqty, :actualqty,
                        :adjqty, :adjtype, 'No')
            ");
            $lineStmt->execute([
                ":adjid"     => $newID,
                ":product"   => $productID,
                ":systemqty" => $systemQty,
                ":actualqty" => $actualQty,
                ":adjqty"    => $adjustmentQty,
                ":adjtype"   => ucfirst($adjTypeLower)
            ]);

            $conn->commit();

            $auditMsg = ($adjustmentQty === 0)
                ? "Verified no discrepancy (ProductID: $productID, qty: $actualQty)"
                : "Created adjustment #$newID for ProductID: $productID";

            addAudit($conn, $currentUserID, "INSERT", "inventory_adjustment", $auditMsg);

            response(true, "Inventory adjustment submitted.", ["Adjustment_ID" => $newID]);
        } catch (Exception $e) {
            $conn->rollBack();
            response(false, "Failed to insert adjustment: " . $e->getMessage(), null);
        }
    }

    if ($operation === "updateInventoryAdjustment") {
        $id        = intval($input["Adjustment_ID"] ?? 0);
        $productID = intval($input["Product_ID"] ?? 0);
        $systemQty = intval($input["System_Quantity"] ?? 0);
        $actualQty = intval($input["Actual_Quantity"] ?? 0);
        $adjType   = trim($input["Adjustment_Type"] ?? "");
        $reason    = trim($input["Reason"] ?? "");
        $statusID  = intval($input["Status_ID"] ?? 0);

        if ($id <= 0) response(false, "Invalid adjustment ID.", null);

        $check = $conn->prepare("
            SELECT ia.Status_ID, s.StatusName
            FROM inventory_adjustment ia
            LEFT JOIN status s ON ia.Status_ID = s.StatusID
            WHERE ia.Adjustment_ID = :id LIMIT 1
        ");
        $check->execute([":id" => $id]);
        $existing = $check->fetch();
        if (!$existing) response(false, "Adjustment not found.", null);

        $statusName = strtolower(trim($existing["StatusName"] ?? ""));
        if (!in_array($statusName, ["pending", "for review", "draft", ""]))
            response(false, "Only pending adjustments can be updated.", null);

        $adjTypeLower = strtolower($adjType);
        if ($adjTypeLower !== "increase" && $adjTypeLower !== "decrease")
            response(false, "Adjustment type must be Increase or Decrease.", null);

        $adjustmentQty = abs($actualQty - $systemQty);

        $conn->beginTransaction();
        try {
            $stmt = $conn->prepare("
                UPDATE inventory_adjustment
                SET Reason = :reason, Status_ID = :status
                WHERE Adjustment_ID = :id
            ");
            $stmt->execute([
                ":reason" => $reason,
                ":status" => $statusID ?: $existing["Status_ID"],
                ":id"     => $id
            ]);

            $del = $conn->prepare("DELETE FROM inventory_adjustment_line WHERE Adjustment_ID = :id");
            $del->execute([":id" => $id]);

            $lineStmt = $conn->prepare("
                INSERT INTO inventory_adjustment_line
                (Adjustment_ID, Product_ID, System_Quantity, Actual_Quantity,
                 Adjustment_Quantity, Adjustment_Type, IsArchived)
                VALUES (:adjid, :product, :systemqty, :actualqty,
                        :adjqty, :adjtype, 'No')
            ");
            $lineStmt->execute([
                ":adjid"     => $id,
                ":product"   => $productID,
                ":systemqty" => $systemQty,
                ":actualqty" => $actualQty,
                ":adjqty"    => $adjustmentQty,
                ":adjtype"   => ucfirst($adjTypeLower)
            ]);

            $conn->commit();
            addAudit($conn, $currentUserID, "UPDATE", "inventory_adjustment", "Updated adjustment #$id");
            response(true, "Adjustment updated successfully.", null);
        } catch (Exception $e) {
            $conn->rollBack();
            response(false, "Failed to update adjustment: " . $e->getMessage(), null);
        }
    }

    if ($operation === "deleteInventoryAdjustment") {
        $id = intval($input["Adjustment_ID"] ?? 0);
        if ($id <= 0) response(false, "Invalid adjustment ID.", null);

        $check = $conn->prepare("
            SELECT ia.Status_ID, s.StatusName
            FROM inventory_adjustment ia
            LEFT JOIN status s ON ia.Status_ID = s.StatusID
            WHERE ia.Adjustment_ID = :id LIMIT 1
        ");
        $check->execute([":id" => $id]);
        $existing = $check->fetch();
        if (!$existing) response(false, "Adjustment not found.", null);

        $statusName = strtolower(trim($existing["StatusName"] ?? ""));
        if (!in_array($statusName, ["pending", "for review", "draft", ""]))
            response(false, "Only pending adjustments can be cancelled.", null);

        $conn->prepare("UPDATE inventory_adjustment SET IsArchived = 'Yes' WHERE Adjustment_ID = :id")
             ->execute([":id" => $id]);

        addAudit($conn, $currentUserID, "ARCHIVE", "inventory_adjustment", "Cancelled adjustment #$id");
        response(true, "Adjustment cancelled successfully.", null);
    }

    if ($operation === "getStockReturns") {
        $search   = getSearch($input);
        $archived = getArchivedFilter($input);

        $sql = "
            SELECT
                sr.Stock_Return_ID, sr.User_ID,
                CONCAT(u.FirstName, ' ', u.LastName) AS UserName,
                sr.Return_Date, sr.Status_ID, s.StatusName, sr.Reason, sr.IsArchived,
                srl.Stock_Return_Line_ID, srl.Product_ID, p.ProductName, p.Barcode, srl.Quantity
            FROM stock_return sr
            LEFT JOIN stock_return_line srl
                ON sr.Stock_Return_ID = srl.Stock_Return_ID AND srl.IsArchived = 'No'
            LEFT JOIN product p ON srl.Product_ID = p.ProductID
            LEFT JOIN `user` u ON sr.User_ID = u.UserID
            LEFT JOIN status s ON sr.Status_ID = s.StatusID
            WHERE sr.IsArchived = :archived
        ";

        if ($search !== "") {
            $sql .= " AND (sr.Reason LIKE :search OR s.StatusName LIKE :search2
                     OR CONCAT(u.FirstName, ' ', u.LastName) LIKE :search3
                     OR p.ProductName LIKE :search4) ";
        }

        $sql .= " ORDER BY sr.Return_Date DESC, sr.Stock_Return_ID DESC, srl.Stock_Return_Line_ID ASC ";

        $stmt = $conn->prepare($sql);
        $params = [":archived" => $archived ? "Yes" : "No"];
        if ($search !== "") {
            $params[":search"]  = "%$search%";
            $params[":search2"] = "%$search%";
            $params[":search3"] = "%$search%";
            $params[":search4"] = "%$search%";
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
        if (!$parent) response(false, "Stock return not found.", null);

        $lineStmt = $conn->prepare("
            SELECT srl.*, p.ProductName, p.Barcode
            FROM stock_return_line srl
            LEFT JOIN product p ON srl.Product_ID = p.ProductID
            WHERE srl.Stock_Return_ID = :id AND srl.IsArchived = 'No'
            ORDER BY srl.Stock_Return_Line_ID ASC
        ");
        $lineStmt->execute([":id" => $id]);
        $parent["lines"] = $lineStmt->fetchAll();

        response(true, "Stock return loaded.", $parent);
    }

    if ($operation === "insertStockReturn") {
        $reason    = trim($input["Reason"] ?? "");
        $statusID  = intval($input["Status_ID"] ?? 0);
        $productID = intval($input["Product_ID"] ?? 0);
        $quantity  = intval($input["Quantity"] ?? 0);

        if ($reason === "") response(false, "Reason is required.", null);
        if ($productID <= 0) response(false, "Product is required.", null);
        if ($quantity <= 0) response(false, "Quantity must be greater than 0.", null);

        if ($statusID <= 0) $statusID = getPendingStatusID($conn);

        $conn->beginTransaction();
        try {
            $stmt = $conn->prepare("
                INSERT INTO stock_return
                (User_ID, Return_Date, Status_ID, Reason, IsArchived)
                VALUES (:userid, NOW(), :status, :reason, 'No')
            ");
            $stmt->execute([
                ":userid" => $currentUserID,
                ":status" => $statusID,
                ":reason" => $reason
            ]);
            $newID = $conn->lastInsertId();

            $lineStmt = $conn->prepare("
                INSERT INTO stock_return_line
                (Stock_Return_ID, Product_ID, Quantity, IsArchived)
                VALUES (:srid, :product, :qty, 'No')
            ");
            $lineStmt->execute([
                ":srid"    => $newID,
                ":product" => $productID,
                ":qty"     => $quantity
            ]);

            $conn->commit();

            addAudit($conn, $currentUserID, "INSERT", "stock_return",
                "Created stock return #$newID for ProductID: $productID");

            response(true, "Stock return submitted.", ["Stock_Return_ID" => $newID]);
        } catch (Exception $e) {
            $conn->rollBack();
            response(false, "Failed to insert stock return: " . $e->getMessage(), null);
        }
    }

    if ($operation === "updateStockReturn") {
        $id        = intval($input["Stock_Return_ID"] ?? 0);
        $reason    = trim($input["Reason"] ?? "");
        $statusID  = intval($input["Status_ID"] ?? 0);
        $productID = intval($input["Product_ID"] ?? 0);
        $quantity  = intval($input["Quantity"] ?? 0);

        if ($id <= 0) response(false, "Invalid stock return ID.", null);
        if ($reason === "") response(false, "Reason is required.", null);

        $check = $conn->prepare("
            SELECT sr.Status_ID, s.StatusName
            FROM stock_return sr
            LEFT JOIN status s ON sr.Status_ID = s.StatusID
            WHERE sr.Stock_Return_ID = :id LIMIT 1
        ");
        $check->execute([":id" => $id]);
        $existing = $check->fetch();
        if (!$existing) response(false, "Stock return not found.", null);

        $statusName = strtolower(trim($existing["StatusName"] ?? ""));
        if (!in_array($statusName, ["pending", "for review", "draft", ""]))
            response(false, "Only pending stock returns can be updated.", null);

        $conn->beginTransaction();
        try {
            $stmt = $conn->prepare("
                UPDATE stock_return
                SET Reason = :reason, Status_ID = :status
                WHERE Stock_Return_ID = :id
            ");
            $stmt->execute([
                ":reason" => $reason,
                ":status" => $statusID ?: $existing["Status_ID"],
                ":id"     => $id
            ]);

            if ($productID > 0 && $quantity > 0) {
                $del = $conn->prepare("DELETE FROM stock_return_line WHERE Stock_Return_ID = :id");
                $del->execute([":id" => $id]);

                $lineStmt = $conn->prepare("
                    INSERT INTO stock_return_line
                    (Stock_Return_ID, Product_ID, Quantity, IsArchived)
                    VALUES (:srid, :product, :qty, 'No')
                ");
                $lineStmt->execute([
                    ":srid"    => $id,
                    ":product" => $productID,
                    ":qty"     => $quantity
                ]);
            }

            $conn->commit();
            addAudit($conn, $currentUserID, "UPDATE", "stock_return", "Updated stock return #$id");
            response(true, "Stock return updated successfully.", null);
        } catch (Exception $e) {
            $conn->rollBack();
            response(false, "Failed to update stock return: " . $e->getMessage(), null);
        }
    }

    if ($operation === "deleteStockReturn") {
        $id = intval($input["Stock_Return_ID"] ?? 0);
        if ($id <= 0) response(false, "Invalid stock return ID.", null);

        $check = $conn->prepare("
            SELECT sr.Status_ID, s.StatusName
            FROM stock_return sr
            LEFT JOIN status s ON sr.Status_ID = s.StatusID
            WHERE sr.Stock_Return_ID = :id LIMIT 1
        ");
        $check->execute([":id" => $id]);
        $existing = $check->fetch();
        if (!$existing) response(false, "Stock return not found.", null);

        $statusName = strtolower(trim($existing["StatusName"] ?? ""));
        if (!in_array($statusName, ["pending", "for review", "draft", ""]))
            response(false, "Only pending stock returns can be cancelled.", null);

        $conn->prepare("UPDATE stock_return SET IsArchived = 'Yes' WHERE Stock_Return_ID = :id")
             ->execute([":id" => $id]);

        addAudit($conn, $currentUserID, "ARCHIVE", "stock_return", "Cancelled stock return #$id");
        response(true, "Stock return cancelled successfully.", null);
    }

    if ($operation === "getStatuses") {
        $stmt = $conn->query("
            SELECT StatusID, StatusName, IsArchived
            FROM status WHERE IsArchived = 'No' ORDER BY StatusName ASC
        ");
        response(true, "Statuses loaded.", $stmt->fetchAll());
    }

    response(false, "Invalid operation: " . $operation, null);

} catch (PDOException $e) {
    response(false, "Database error: " . $e->getMessage(), null);
} catch (Exception $e) {
    response(false, "Server error: " . $e->getMessage(), null);
}

?>