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
    ]);
    exit;
}

$input = [];

$rawInput = file_get_contents("php://input");

if (!empty($rawInput)) {

    $decoded = json_decode($rawInput, true);

    if (is_array($decoded)) {
        $input = $decoded;
    }
}

if (empty($input) && !empty($_POST)) {
    $input = $_POST;
}

if (isset($_POST["json"]) && !empty($_POST["json"])) {

    $jsonData = json_decode($_POST["json"], true);

    if (is_array($jsonData)) {
        $input = array_merge($input, $jsonData);
    }
}

if (empty($input) && !empty($_GET)) {
    $input = $_GET;
}

$operation = $input["operation"]
    ?? $_POST["operation"]
    ?? $_GET["operation"]
    ?? "";

function getCurrentUserID($data)
{
    if (isset($data["LoggedInUserID"]) && intval($data["LoggedInUserID"]) > 0) {
        return intval($data["LoggedInUserID"]);
    }

    if (isset($data["UserID"]) && intval($data["UserID"]) > 0) {
        return intval($data["UserID"]);
    }

    return 0;
}

function requirePurchasing($conn, $currentUserID)
{
    if (!$currentUserID || intval($currentUserID) <= 0) {
        response(false, "Purchasing access required.", null);
    }

    try {

        $stmt = $conn->prepare("
            SELECT
                u.UserID,
                u.UserName,
                u.FirstName,
                u.LastName,
                u.UserStatus,
                u.IsArchived AS UserArchived,
                u.RoleID,
                r.RoleName,
                r.IsArchived AS RoleArchived
            FROM `user` u
            LEFT JOIN `role` r ON u.RoleID = r.RoleID
            WHERE u.UserID = :UserID
            LIMIT 1
        ");

        $stmt->execute([":UserID" => intval($currentUserID)]);

        $user = $stmt->fetch();

        if (!$user) {
            response(false, "User account not found.", null);
        }

        if (strtolower(trim($user["UserArchived"] ?? "")) === "yes") {
            response(false, "Your account is archived.", null);
        }

        if (strtolower(trim($user["UserStatus"] ?? "")) !== "active") {
            response(false, "Your account is inactive.", null);
        }

        if (strtolower(trim($user["RoleArchived"] ?? "")) === "yes") {
            response(false, "Your role is archived.", null);
        }

        $roleName = strtolower(trim($user["RoleName"] ?? ""));

        $allowed = [
            "purchasing staff",
            "purchasing",
            "purchaser",
            "purchasing officer",
            "admin",
            "administrator"
        ];

        if (!in_array($roleName, $allowed, true)) {
            response(
                false,
                "Purchasing access required. Current role: " .
                ($user["RoleName"] ?? "No Role"),
                null
            );
        }

        return $user;

    } catch (PDOException $e) {

        response(false, "Role verification error: " . $e->getMessage(), null);
    }
}

function addAudit($conn, $userID, $action, $table, $details = "")
{
    if ($userID <= 0) {
        return;
    }

    try {

        $stmt = $conn->prepare("
            INSERT INTO auditlog
            (UserID, ActionType, TableAffected, ActionTimestamp, Details, IsArchived)
            VALUES
            (:userid, :action, :tablename, NOW(), :details, 'No')
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
            SELECT Product_ID AS pid, SUM(Adjustment_Quantity) AS qty
            FROM inventory_adjustment_line WHERE IsArchived = 'No' GROUP BY Product_ID
        ) adj ON adj.pid = p.ProductID
    ";
}

function stockExpression()
{
    return "
        (
            COALESCE(rin.qty, 0)
            - COALESCE(rel.qty, 0)
            + COALESCE(sret.qty, 0)
            - COALESCE(pret.qty, 0)
            + COALESCE(adj.qty, 0)
        )
    ";
}

function findStatusID($conn, $name)
{
    $stmt = $conn->prepare("
        SELECT StatusID FROM status
        WHERE LOWER(TRIM(StatusName)) = :name AND IsArchived = 'No'
        LIMIT 1
    ");

    $stmt->execute([":name" => strtolower(trim($name))]);

    $row = $stmt->fetch();

    return $row ? intval($row["StatusID"]) : 0;
}

function getPOStatusName($conn, $poID)
{
    $stmt = $conn->prepare("
        SELECT st.StatusName, po.IsArchived
        FROM purchase_order po
        LEFT JOIN status st ON po.Status_ID = st.StatusID
        WHERE po.PO_ID = :id
        LIMIT 1
    ");

    $stmt->execute([":id" => $poID]);

    return $stmt->fetch();
}

function isEditableStatus($statusName)
{
    $s = strtolower(trim($statusName ?? ""));

    return ($s === "" || $s === "pending" || $s === "draft");
}

function supplierProductIDs($conn, $supplierID)
{
    $stmt = $conn->prepare("
        SELECT sp.ProductID
        FROM supplier_product sp
        INNER JOIN product p ON sp.ProductID = p.ProductID
        WHERE sp.SupplierID = :supplier
        AND sp.IsArchived = 'No'
        AND p.IsArchived = 'No'
    ");

    $stmt->execute([":supplier" => $supplierID]);

    $ids = [];

    foreach ($stmt->fetchAll() as $row) {
        $ids[] = intval($row["ProductID"]);
    }

    return $ids;
}

/*
 * Expected delivery date = PO date + the LONGEST LeadTimeDays among the
 * ordered products (from supplier_product). Returns null when there is
 * no lead time on record.
 */
function computeExpectedDate($conn, $supplierID, $productIDs, $poDate)
{
    if (count($productIDs) === 0 || $poDate === "") {
        return null;
    }

    $ids = implode(",", array_map("intval", $productIDs));

    $stmt = $conn->prepare("
        SELECT MAX(LeadTimeDays) AS lead
        FROM supplier_product
        WHERE SupplierID = :supplier
        AND ProductID IN ($ids)
        AND IsArchived = 'No'
    ");

    $stmt->execute([":supplier" => $supplierID]);

    $row = $stmt->fetch();

    $lead = intval($row["lead"] ?? 0);

    if ($lead <= 0) {
        return null;
    }

    return date("Y-m-d", strtotime($poDate . " +" . $lead . " days"));
}

try {

    $currentUserID = getCurrentUserID($input);

    if ($operation === "login") {

        $username = trim(
            $input["Username"] ?? $input["UserName"] ?? $input["username"] ?? ""
        );

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
            LEFT JOIN role r ON u.RoleID = r.RoleID
            WHERE u.UserName = :username
            LIMIT 1
        ");

        $stmt->execute([":username" => $username]);

        $user = $stmt->fetch();

        if (!$user) {
            response(false, "Invalid username or password.", null);
        }

        if ($user["IsArchived"] === "Yes") {
            response(false, "This account is archived.", null);
        }

        if (strtolower(trim($user["UserStatus"])) !== "active") {
            response(false, "This account is inactive.", null);
        }

        if (!$user["RoleID"] || !$user["RoleName"]) {
            response(false, "User role is not assigned.", null);
        }

        if ($user["RoleArchived"] === "Yes") {
            response(false, "User role is archived.", null);
        }

        $validPassword = false;

        if (password_verify($password, $user["Password"])) {

            $validPassword = true;

        } else if (hash_equals($user["Password"], $password)) {

            $newHash = password_hash($password, PASSWORD_DEFAULT);

            $conn->prepare("
                UPDATE `user` SET Password = :password WHERE UserID = :userid
            ")->execute([
                ":password" => $newHash,
                ":userid"   => $user["UserID"]
            ]);

            $validPassword = true;
        }

        if (!$validPassword) {
            response(false, "Invalid username or password.", null);
        }

        unset($user["Password"], $user["RoleArchived"]);

        addAudit($conn, intval($user["UserID"]), "LOGIN", "user", "User logged in.");

        response(true, "Login successful.", $user);
    }

    if ($operation === "logout") {

        if ($currentUserID > 0) {
            addAudit($conn, $currentUserID, "LOGOUT", "user", "User logged out.");
        }

        response(true, "Logout successful.", null);
    }

    $me = requirePurchasing($conn, $currentUserID);

    if ($operation === "getDashboardStats") {

        $totalProducts = intval($conn->query("
            SELECT COUNT(*) AS total FROM product WHERE IsArchived = 'No'
        ")->fetch()["total"]);

        $totalSuppliers = intval($conn->query("
            SELECT COUNT(*) AS total FROM supplier WHERE IsArchived = 'No'
        ")->fetch()["total"]);

        $totalCategories = intval($conn->query("
            SELECT COUNT(*) AS total FROM category WHERE IsArchived = 'No'
        ")->fetch()["total"]);

        $totalPOs = intval($conn->query("
            SELECT COUNT(*) AS total FROM purchase_order WHERE IsArchived = 'No'
        ")->fetch()["total"]);

        $pendingPOs = intval($conn->query("
            SELECT COUNT(*) AS total
            FROM purchase_order po
            INNER JOIN status s ON po.Status_ID = s.StatusID
            WHERE po.IsArchived = 'No'
            AND LOWER(TRIM(s.StatusName)) = 'pending'
        ")->fetch()["total"]);

        $stmt = $conn->prepare("
            SELECT COUNT(*) AS total FROM purchase_order
            WHERE IsArchived = 'No' AND User_ID = :uid
        ");
        $stmt->execute([":uid" => $currentUserID]);
        $myPOs = intval($stmt->fetch()["total"]);

        $totalReturns = intval($conn->query("
            SELECT COUNT(*) AS total FROM purchase_return WHERE IsArchived = 'No'
        ")->fetch()["total"]);

        $lowStock = $conn->query("
            SELECT
                p.ProductID,
                p.ProductName,
                p.MinStockLevel,
                u.UnitSymbol,
                " . stockExpression() . " AS OnHand
            FROM product p
            LEFT JOIN unit_of_measure u ON p.UnitOfMeasureID = u.UnitOfMeasureID
            " . stockJoins() . "
            WHERE p.IsArchived = 'No'
            HAVING OnHand <= p.MinStockLevel
            ORDER BY (p.MinStockLevel - OnHand) DESC, p.ProductName ASC
            LIMIT 10
        ")->fetchAll();

        $recentPOs = $conn->query("
            SELECT
                po.PO_ID, po.PO_Date, po.Expected_Date,
                s.SupplierName, st.StatusName,
                (
                    SELECT COALESCE(SUM(l.Quantity * l.Unit_Price), 0)
                    FROM purchase_order_line l
                    WHERE l.PO_ID = po.PO_ID AND l.IsArchived = 'No'
                ) AS TotalAmount
            FROM purchase_order po
            LEFT JOIN supplier s ON po.Supplier_ID = s.SupplierID
            LEFT JOIN status st ON po.Status_ID = st.StatusID
            WHERE po.IsArchived = 'No'
            ORDER BY po.PO_Date DESC, po.PO_ID DESC
            LIMIT 8
        ")->fetchAll();

        response(true, "Dashboard data loaded.", [
            "totalProducts"   => $totalProducts,
            "totalSuppliers"  => $totalSuppliers,
            "totalCategories" => $totalCategories,
            "totalPOs"        => $totalPOs,
            "pendingPOs"      => $pendingPOs,
            "myPOs"           => $myPOs,
            "totalReturns"    => $totalReturns,
            "lowStock"        => $lowStock,
            "recentPOs"       => $recentPOs
        ]);
    }

    if ($operation === "getProducts") {

        $search = getSearch($input);

        $sql = "
            SELECT
                p.ProductID, p.Barcode, p.ProductName, p.Description,
                p.MinStockLevel, c.CategoryName, u.UnitName, u.UnitSymbol,
                b.BinCode,
                " . stockExpression() . " AS OnHand
            FROM product p
            LEFT JOIN category c ON p.CategoryID = c.CategoryID
            LEFT JOIN unit_of_measure u ON p.UnitOfMeasureID = u.UnitOfMeasureID
            LEFT JOIN bin b ON p.BinID = b.BinID
            " . stockJoins() . "
            WHERE p.IsArchived = 'No'
        ";

        $params = [];

        if ($search !== "") {
            $sql .= "
                AND (
                    p.ProductName LIKE :search
                    OR p.Barcode LIKE :search2
                    OR c.CategoryName LIKE :search3
                )
            ";
            $params[":search"]  = "%$search%";
            $params[":search2"] = "%$search%";
            $params[":search3"] = "%$search%";
        }

        $sql .= " ORDER BY p.ProductName ASC ";

        $stmt = $conn->prepare($sql);
        $stmt->execute($params);

        response(true, "Products loaded.", $stmt->fetchAll());
    }

    if ($operation === "getProductsBySupplier") {

        $supplierID = intval($input["Supplier_ID"] ?? 0);

        if ($supplierID <= 0) {
            response(false, "Select a supplier first.", null);
        }

        // Only products linked to this supplier. No fallback:
        // a supplier with no associated products returns an empty list.
        $stmt = $conn->prepare("
            SELECT
                p.ProductID, p.ProductName, p.Barcode, p.MinStockLevel,
                c.CategoryName, u.UnitSymbol,
                sp.LeadTimeDays,
                " . stockExpression() . " AS OnHand,
                (
                    SELECT l.Unit_Price
                    FROM purchase_order_line l
                    INNER JOIN purchase_order po ON l.PO_ID = po.PO_ID
                    WHERE l.Product_ID = p.ProductID
                    AND po.Supplier_ID = :supplier2
                    AND l.IsArchived = 'No'
                    ORDER BY po.PO_Date DESC, l.PO_Line_ID DESC
                    LIMIT 1
                ) AS LastPrice
            FROM supplier_product sp
            INNER JOIN product p ON sp.ProductID = p.ProductID
            LEFT JOIN category c ON p.CategoryID = c.CategoryID
            LEFT JOIN unit_of_measure u ON p.UnitOfMeasureID = u.UnitOfMeasureID
            " . stockJoins() . "
            WHERE sp.SupplierID = :supplier3
            AND sp.IsArchived = 'No'
            AND p.IsArchived = 'No'
            ORDER BY p.ProductName ASC
        ");

        $stmt->execute([
            ":supplier2" => $supplierID,
            ":supplier3" => $supplierID
        ]);

        response(true, "Supplier products loaded.", [
            "fallback" => false,
            "products" => $stmt->fetchAll()
        ]);
    }

    if ($operation === "getSuppliersForProducts") {

        $productIDs = $input["ProductIDs"] ?? [];

        if (!is_array($productIDs)) {
            $productIDs = [];
        }

        $productIDs = array_values(array_unique(array_filter(
            array_map("intval", $productIDs),
            fn($v) => $v > 0
        )));

        $stmt = $conn->query("
            SELECT SupplierID, SupplierName, ContactPerson, Phone, Email
            FROM supplier
            WHERE IsArchived = 'No'
            ORDER BY SupplierName ASC
        ");

        $allSuppliers = $stmt->fetchAll();

        if (count($productIDs) === 0) {
            response(true, "Suppliers loaded.", $allSuppliers);
        }

        $eligible = [];

        foreach ($allSuppliers as $supplier) {

            $catalog = supplierProductIDs($conn, intval($supplier["SupplierID"]));

            // A supplier with no associated products is never eligible
            if (count($catalog) === 0) {
                continue;
            }

            $missing = array_diff($productIDs, $catalog);

            if (count($missing) === 0) {
                $eligible[] = $supplier;
            }
        }

        response(true, "Eligible suppliers loaded.", $eligible);
    }

    if ($operation === "getProductDetails") {

        $id = intval($input["ProductID"] ?? 0);

        $stmt = $conn->prepare("
            SELECT
                p.ProductID, p.Barcode, p.ProductName, p.Description,
                p.MinStockLevel, p.CreatedAt,
                c.CategoryName, c.CategoryID,
                u.UnitName, u.UnitSymbol,
                b.BinCode, s.ShelfCode, a.AisleCode,
                " . stockExpression() . " AS OnHand,
                COALESCE(rin.qty, 0) AS TotalReceived,
                COALESCE(rel.qty, 0) AS TotalReleased
            FROM product p
            LEFT JOIN category c ON p.CategoryID = c.CategoryID
            LEFT JOIN unit_of_measure u ON p.UnitOfMeasureID = u.UnitOfMeasureID
            LEFT JOIN bin b ON p.BinID = b.BinID
            LEFT JOIN shelf s ON b.ShelfID = s.ShelfID
            LEFT JOIN aisle a ON s.AisleID = a.AisleID
            " . stockJoins() . "
            WHERE p.ProductID = :id
            LIMIT 1
        ");

        $stmt->execute([":id" => $id]);

        $product = $stmt->fetch();

        if (!$product) {
            response(false, "Product not found.", null);
        }

        $stmt = $conn->prepare("
            SELECT
                s.SupplierID, s.SupplierName, s.ContactPerson, s.Phone,
                sp.LeadTimeDays
            FROM supplier_product sp
            INNER JOIN supplier s ON sp.SupplierID = s.SupplierID
            WHERE sp.ProductID = :id
            AND sp.IsArchived = 'No'
            AND s.IsArchived = 'No'
            ORDER BY s.SupplierName ASC
        ");

        $stmt->execute([":id" => $id]);

        $product["suppliers"] = $stmt->fetchAll();

        $stmt = $conn->prepare("
            SELECT
                po.PO_ID, po.PO_Date, s.SupplierName,
                l.Quantity, l.Unit_Price, st.StatusName
            FROM purchase_order_line l
            INNER JOIN purchase_order po ON l.PO_ID = po.PO_ID
            LEFT JOIN supplier s ON po.Supplier_ID = s.SupplierID
            LEFT JOIN status st ON po.Status_ID = st.StatusID
            WHERE l.Product_ID = :id
            AND l.IsArchived = 'No'
            AND po.IsArchived = 'No'
            ORDER BY po.PO_Date DESC, po.PO_ID DESC
            LIMIT 5
        ");

        $stmt->execute([":id" => $id]);

        $product["recentOrders"] = $stmt->fetchAll();

        response(true, "Product details loaded.", $product);
    }

    if ($operation === "getStockLevels") {

        $search = getSearch($input);

        $onlyLow = isset($input["lowOnly"]) &&
            ($input["lowOnly"] === true || $input["lowOnly"] === "true" || $input["lowOnly"] === 1);

        $sql = "
            SELECT
                p.ProductID, p.ProductName, p.Barcode, p.MinStockLevel,
                c.CategoryName, u.UnitSymbol,
                " . stockExpression() . " AS OnHand
            FROM product p
            LEFT JOIN category c ON p.CategoryID = c.CategoryID
            LEFT JOIN unit_of_measure u ON p.UnitOfMeasureID = u.UnitOfMeasureID
            " . stockJoins() . "
            WHERE p.IsArchived = 'No'
        ";

        $params = [];

        if ($search !== "") {
            $sql .= " AND (p.ProductName LIKE :search OR p.Barcode LIKE :search2) ";
            $params[":search"]  = "%$search%";
            $params[":search2"] = "%$search%";
        }

        if ($onlyLow) {
            $sql .= " HAVING OnHand <= p.MinStockLevel ";
        }

        $sql .= " ORDER BY p.ProductName ASC ";

        $stmt = $conn->prepare($sql);
        $stmt->execute($params);

        response(true, "Stock levels loaded.", $stmt->fetchAll());
    }

    if ($operation === "getCategories") {

        $search = getSearch($input);

        $sql = "
            SELECT
                c.CategoryID, c.CategoryName,
                (
                    SELECT COUNT(*) FROM product p
                    WHERE p.CategoryID = c.CategoryID AND p.IsArchived = 'No'
                ) AS ProductCount
            FROM category c
            WHERE c.IsArchived = 'No'
        ";

        $params = [];

        if ($search !== "") {
            $sql .= " AND c.CategoryName LIKE :search ";
            $params[":search"] = "%$search%";
        }

        $sql .= " ORDER BY c.CategoryName ASC ";

        $stmt = $conn->prepare($sql);
        $stmt->execute($params);

        response(true, "Categories loaded.", $stmt->fetchAll());
    }

    if ($operation === "getCategoryDetails") {

        $id = intval($input["CategoryID"] ?? 0);

        $stmt = $conn->prepare("
            SELECT CategoryID, CategoryName
            FROM category
            WHERE CategoryID = :id
            LIMIT 1
        ");

        $stmt->execute([":id" => $id]);

        $category = $stmt->fetch();

        if (!$category) {
            response(false, "Category not found.", null);
        }

        $stmt = $conn->prepare("
            SELECT
                p.ProductID, p.ProductName, p.Barcode, p.MinStockLevel,
                u.UnitSymbol, b.BinCode,
                " . stockExpression() . " AS OnHand
            FROM product p
            LEFT JOIN unit_of_measure u ON p.UnitOfMeasureID = u.UnitOfMeasureID
            LEFT JOIN bin b ON p.BinID = b.BinID
            " . stockJoins() . "
            WHERE p.IsArchived = 'No' AND p.CategoryID = :id
            ORDER BY p.ProductName ASC
        ");

        $stmt->execute([":id" => $id]);

        $products = $stmt->fetchAll();

        $lowCount = 0;

        foreach ($products as $product) {
            if (intval($product["OnHand"]) <= intval($product["MinStockLevel"])) {
                $lowCount++;
            }
        }

        $category["products"]     = $products;
        $category["productCount"] = count($products);
        $category["lowCount"]     = $lowCount;

        response(true, "Category details loaded.", $category);
    }

    if ($operation === "getSuppliers") {

        $search = getSearch($input);

        $sql = "
            SELECT
                s.SupplierID, s.SupplierName, s.ContactPerson,
                s.Phone, s.Email, s.Address,
                (
                    SELECT COUNT(*) FROM supplier_product sp
                    WHERE sp.SupplierID = s.SupplierID AND sp.IsArchived = 'No'
                ) AS ProductCount
            FROM supplier s
            WHERE s.IsArchived = 'No'
        ";

        $params = [];

        if ($search !== "") {
            $sql .= "
                AND (
                    s.SupplierName LIKE :search
                    OR s.ContactPerson LIKE :search2
                    OR s.Phone LIKE :search3
                    OR s.Email LIKE :search4
                )
            ";
            $params[":search"]  = "%$search%";
            $params[":search2"] = "%$search%";
            $params[":search3"] = "%$search%";
            $params[":search4"] = "%$search%";
        }

        $sql .= " ORDER BY s.SupplierName ASC ";

        $stmt = $conn->prepare($sql);
        $stmt->execute($params);

        response(true, "Suppliers loaded.", $stmt->fetchAll());
    }

    if ($operation === "getSupplierDetails") {

        $id = intval($input["SupplierID"] ?? 0);

        $stmt = $conn->prepare("
            SELECT SupplierID, SupplierName, ContactPerson, Phone, Email, Address
            FROM supplier
            WHERE SupplierID = :id
            LIMIT 1
        ");

        $stmt->execute([":id" => $id]);

        $supplier = $stmt->fetch();

        if (!$supplier) {
            response(false, "Supplier not found.", null);
        }

        $stmt = $conn->prepare("
            SELECT
                p.ProductID, p.ProductName, p.Barcode, p.MinStockLevel,
                c.CategoryName, u.UnitSymbol, sp.LeadTimeDays,
                " . stockExpression() . " AS OnHand
            FROM supplier_product sp
            INNER JOIN product p ON sp.ProductID = p.ProductID
            LEFT JOIN category c ON p.CategoryID = c.CategoryID
            LEFT JOIN unit_of_measure u ON p.UnitOfMeasureID = u.UnitOfMeasureID
            " . stockJoins() . "
            WHERE sp.SupplierID = :id
            AND sp.IsArchived = 'No'
            AND p.IsArchived = 'No'
            ORDER BY p.ProductName ASC
        ");

        $stmt->execute([":id" => $id]);

        $supplier["products"] = $stmt->fetchAll();

        $stmt = $conn->prepare("
            SELECT
                p.ProductID, p.ProductName,
                SUM(l.Quantity) AS TotalOrdered,
                MAX(po.PO_Date) AS LastOrdered
            FROM purchase_order_line l
            INNER JOIN purchase_order po ON l.PO_ID = po.PO_ID
            INNER JOIN product p ON l.Product_ID = p.ProductID
            WHERE po.Supplier_ID = :id
            AND po.IsArchived = 'No'
            AND l.IsArchived = 'No'
            GROUP BY p.ProductID, p.ProductName
            ORDER BY LastOrdered DESC
            LIMIT 10
        ");

        $stmt->execute([":id" => $id]);

        $supplier["orderedProducts"] = $stmt->fetchAll();

        $stmt = $conn->prepare("
            SELECT
                COUNT(*) AS TotalPOs,
                MAX(po.PO_Date) AS LastOrderDate
            FROM purchase_order po
            WHERE po.Supplier_ID = :id AND po.IsArchived = 'No'
        ");

        $stmt->execute([":id" => $id]);

        $summary = $stmt->fetch();

        $stmt = $conn->prepare("
            SELECT COALESCE(SUM(l.Quantity * l.Unit_Price), 0) AS TotalSpend
            FROM purchase_order_line l
            INNER JOIN purchase_order po ON l.PO_ID = po.PO_ID
            WHERE po.Supplier_ID = :id
            AND po.IsArchived = 'No'
            AND l.IsArchived = 'No'
        ");

        $stmt->execute([":id" => $id]);

        $supplier["totalPOs"]      = intval($summary["TotalPOs"] ?? 0);
        $supplier["lastOrderDate"] = $summary["LastOrderDate"] ?? null;
        $supplier["totalSpend"]    = floatval($stmt->fetch()["TotalSpend"] ?? 0);

        response(true, "Supplier details loaded.", $supplier);
    }

    if ($operation === "getStatuses") {

        $stmt = $conn->query("
            SELECT StatusID, StatusName
            FROM status
            WHERE IsArchived = 'No'
            ORDER BY StatusName ASC
        ");

        response(true, "Statuses loaded.", $stmt->fetchAll());
    }

    if ($operation === "getPurchaseOrders") {

        $search     = getSearch($input);
        $archived   = getArchivedFilter($input);
        $supplierID = intval($input["Supplier_ID"] ?? 0);
        $statusID   = intval($input["Status_ID"] ?? 0);
        $dateFrom   = trim($input["DateFrom"] ?? "");
        $dateTo     = trim($input["DateTo"] ?? "");

        $sql = "
            SELECT
                po.PO_ID, po.PO_Date, po.Expected_Date,
                po.Supplier_ID, s.SupplierName, s.ContactPerson, s.Phone,
                po.User_ID,
                CONCAT(COALESCE(u.FirstName,''), ' ', COALESCE(u.LastName,'')) AS UserName,
                po.Status_ID, st.StatusName, po.IsArchived,
                (
                    SELECT COUNT(*) FROM purchase_order_line l
                    WHERE l.PO_ID = po.PO_ID AND l.IsArchived = 'No'
                ) AS ItemCount,
                (
                    SELECT COALESCE(SUM(l.Quantity * l.Unit_Price), 0)
                    FROM purchase_order_line l
                    WHERE l.PO_ID = po.PO_ID AND l.IsArchived = 'No'
                ) AS TotalAmount
            FROM purchase_order po
            LEFT JOIN supplier s ON po.Supplier_ID = s.SupplierID
            LEFT JOIN `user` u ON po.User_ID = u.UserID
            LEFT JOIN status st ON po.Status_ID = st.StatusID
            WHERE po.IsArchived = :archived
        ";

        $params = [":archived" => $archived ? "Yes" : "No"];

        if ($search !== "") {
            $sql .= "
                AND (
                    s.SupplierName LIKE :search
                    OR s.ContactPerson LIKE :search2
                    OR st.StatusName LIKE :search3
                    OR po.PO_ID LIKE :search4
                )
            ";
            $params[":search"]  = "%$search%";
            $params[":search2"] = "%$search%";
            $params[":search3"] = "%$search%";
            $params[":search4"] = "%$search%";
        }

        if ($supplierID > 0) {
            $sql .= " AND po.Supplier_ID = :supplier ";
            $params[":supplier"] = $supplierID;
        }

        if ($statusID > 0) {
            $sql .= " AND po.Status_ID = :status ";
            $params[":status"] = $statusID;
        }

        if ($dateFrom !== "") {
            $sql .= " AND po.PO_Date >= :datefrom ";
            $params[":datefrom"] = $dateFrom;
        }

        if ($dateTo !== "") {
            $sql .= " AND po.PO_Date <= :dateto ";
            $params[":dateto"] = $dateTo;
        }

        $sql .= " ORDER BY po.PO_Date DESC, po.PO_ID DESC ";

        $stmt = $conn->prepare($sql);
        $stmt->execute($params);

        response(true, "Purchase orders loaded.", $stmt->fetchAll());
    }

    if ($operation === "getPurchaseOrder") {

        $id = intval($input["PO_ID"] ?? 0);

        if ($id <= 0) {
            response(false, "Purchase order not found.", null);
        }

        $stmt = $conn->prepare("
            SELECT
                po.PO_ID, po.PO_Date, po.Expected_Date,
                po.Supplier_ID,
                s.SupplierName, s.ContactPerson, s.Phone, s.Email, s.Address,
                po.User_ID,
                CONCAT(COALESCE(u.FirstName,''), ' ', COALESCE(u.LastName,'')) AS UserName,
                po.Status_ID, st.StatusName, po.IsArchived
            FROM purchase_order po
            LEFT JOIN supplier s ON po.Supplier_ID = s.SupplierID
            LEFT JOIN `user` u ON po.User_ID = u.UserID
            LEFT JOIN status st ON po.Status_ID = st.StatusID
            WHERE po.PO_ID = :id
            LIMIT 1
        ");

        $stmt->execute([":id" => $id]);

        $header = $stmt->fetch();

        if (!$header) {
            response(false, "Purchase order not found.", null);
        }

        $stmt = $conn->prepare("
            SELECT
                l.PO_Line_ID, l.Product_ID,
                p.ProductName, p.Barcode,
                uom.UnitSymbol,
                l.Quantity, l.Unit_Price,
                (l.Quantity * l.Unit_Price) AS Subtotal
            FROM purchase_order_line l
            LEFT JOIN product p ON l.Product_ID = p.ProductID
            LEFT JOIN unit_of_measure uom ON p.UnitOfMeasureID = uom.UnitOfMeasureID
            WHERE l.PO_ID = :id AND l.IsArchived = 'No'
            ORDER BY l.PO_Line_ID ASC
        ");

        $stmt->execute([":id" => $id]);

        $header["lines"]    = $stmt->fetchAll();
        $header["Editable"] = isEditableStatus($header["StatusName"]) ? 1 : 0;

        response(true, "Purchase order loaded.", $header);
    }

    if ($operation === "insertPurchaseOrder") {

        $supplierID = intval($input["Supplier_ID"] ?? 0);
        $poDate     = trim($input["PO_Date"] ?? "");
        $expected   = trim($input["Expected_Date"] ?? "");
        $statusID   = intval($input["Status_ID"] ?? 0);
        $lines      = $input["lines"] ?? [];

        if ($supplierID <= 0) {
            response(false, "Please select a supplier.", null);
        }

        if ($poDate === "") {
            response(false, "PO date is required.", null);
        }

        if ($expected !== "" && $expected < $poDate) {
            response(false, "Expected date cannot be earlier than the PO date.", null);
        }

        if (!is_array($lines) || count($lines) === 0) {
            response(false, "Add at least one product to the purchase order.", null);
        }

        if ($statusID <= 0) {

            $statusID = findStatusID($conn, "pending");

            if ($statusID <= 0) {
                response(false, "No 'Pending' status found. Ask the admin to add it.", null);
            }
        }

        $allowedProducts = supplierProductIDs($conn, $supplierID);

        if (count($allowedProducts) === 0) {
            response(false, "This supplier has no associated products yet.", null);
        }

        $clean = [];
        $seen  = [];

        foreach ($lines as $line) {

            $productID = intval($line["Product_ID"] ?? 0);
            $qty       = intval($line["Quantity"] ?? 0);
            $price     = floatval($line["Unit_Price"] ?? 0);

            if ($productID <= 0) {
                response(false, "Every line needs a product.", null);
            }

            if (isset($seen[$productID])) {
                response(false, "Duplicate product in the order. Merge the quantities instead.", null);
            }

            if ($qty <= 0) {
                response(false, "Quantity must be greater than zero.", null);
            }

            if ($price < 0) {
                response(false, "Unit price cannot be negative.", null);
            }

            if (!in_array($productID, $allowedProducts, true)) {
                response(false, "One of the products is not supplied by the selected supplier.", null);
            }

            $seen[$productID] = true;

            $clean[] = ["product" => $productID, "qty" => $qty, "price" => $price];
        }

        // If no expected date was sent, compute it from the lead time
        if ($expected === "") {
            $expected = computeExpectedDate(
                $conn,
                $supplierID,
                array_keys($seen),
                $poDate
            ) ?? "";
        }

        $conn->beginTransaction();

        $stmt = $conn->prepare("
            INSERT INTO purchase_order
            (Supplier_ID, User_ID, PO_Date, Expected_Date, Status_ID, IsArchived)
            VALUES
            (:supplier, :user, :podate, :expected, :status, 'No')
        ");

        $stmt->execute([
            ":supplier" => $supplierID,
            ":user"     => $currentUserID,
            ":podate"   => $poDate,
            ":expected" => $expected !== "" ? $expected : null,
            ":status"   => $statusID
        ]);

        $poID = intval($conn->lastInsertId());

        $lineStmt = $conn->prepare("
            INSERT INTO purchase_order_line
            (PO_ID, Product_ID, Quantity, Unit_Price, IsArchived)
            VALUES
            (:po, :product, :qty, :price, 'No')
        ");

        foreach ($clean as $line) {
            $lineStmt->execute([
                ":po"      => $poID,
                ":product" => $line["product"],
                ":qty"     => $line["qty"],
                ":price"   => $line["price"]
            ]);
        }

        $conn->commit();

        addAudit(
            $conn, $currentUserID, "INSERT", "purchase_order",
            "Created PO #$poID with " . count($clean) . " item(s)."
        );

        response(true, "Purchase order created.", ["PO_ID" => $poID]);
    }

    if ($operation === "updatePurchaseOrder") {

        $id         = intval($input["PO_ID"] ?? 0);
        $supplierID = intval($input["Supplier_ID"] ?? 0);
        $poDate     = trim($input["PO_Date"] ?? "");
        $expected   = trim($input["Expected_Date"] ?? "");
        $statusID   = intval($input["Status_ID"] ?? 0);
        $lines      = $input["lines"] ?? [];

        if ($id <= 0) {
            response(false, "Purchase order not found.", null);
        }

        $current = getPOStatusName($conn, $id);

        if (!$current) {
            response(false, "Purchase order not found.", null);
        }

        if ($current["IsArchived"] === "Yes") {
            response(false, "This purchase order is archived.", null);
        }

        if (!isEditableStatus($current["StatusName"])) {
            response(
                false,
                "Only pending purchase orders can be updated. This one is " .
                $current["StatusName"] . ".",
                null
            );
        }

        if ($supplierID <= 0 || $poDate === "") {
            response(false, "Supplier and PO date are required.", null);
        }

        if ($expected !== "" && $expected < $poDate) {
            response(false, "Expected date cannot be earlier than the PO date.", null);
        }

        if (!is_array($lines) || count($lines) === 0) {
            response(false, "Add at least one product to the purchase order.", null);
        }

        $allowedProducts = supplierProductIDs($conn, $supplierID);

        if (count($allowedProducts) === 0) {
            response(false, "This supplier has no associated products yet.", null);
        }

        $clean = [];
        $seen  = [];

        foreach ($lines as $line) {

            $productID = intval($line["Product_ID"] ?? 0);
            $qty       = intval($line["Quantity"] ?? 0);
            $price     = floatval($line["Unit_Price"] ?? 0);

            if ($productID <= 0) {
                response(false, "Every line needs a product.", null);
            }

            if (isset($seen[$productID])) {
                response(false, "Duplicate product in the order. Merge the quantities instead.", null);
            }

            if ($qty <= 0) {
                response(false, "Quantity must be greater than zero.", null);
            }

            if (!in_array($productID, $allowedProducts, true)) {
                response(false, "One of the products is not supplied by the selected supplier.", null);
            }

            $seen[$productID] = true;

            $clean[] = ["product" => $productID, "qty" => $qty, "price" => $price];
        }

        if ($expected === "") {
            $expected = computeExpectedDate(
                $conn,
                $supplierID,
                array_keys($seen),
                $poDate
            ) ?? "";
        }

        $conn->beginTransaction();

        $stmt = $conn->prepare("
            UPDATE purchase_order
            SET
                Supplier_ID = :supplier,
                PO_Date = :podate,
                Expected_Date = :expected,
                Status_ID = COALESCE(:status, Status_ID)
            WHERE PO_ID = :id
        ");

        $stmt->execute([
            ":supplier" => $supplierID,
            ":podate"   => $poDate,
            ":expected" => $expected !== "" ? $expected : null,
            ":status"   => $statusID > 0 ? $statusID : null,
            ":id"       => $id
        ]);

        $conn->prepare("DELETE FROM purchase_order_line WHERE PO_ID = :id")
             ->execute([":id" => $id]);

        $lineStmt = $conn->prepare("
            INSERT INTO purchase_order_line
            (PO_ID, Product_ID, Quantity, Unit_Price, IsArchived)
            VALUES
            (:po, :product, :qty, :price, 'No')
        ");

        foreach ($clean as $line) {
            $lineStmt->execute([
                ":po"      => $id,
                ":product" => $line["product"],
                ":qty"     => $line["qty"],
                ":price"   => $line["price"]
            ]);
        }

        $conn->commit();

        addAudit($conn, $currentUserID, "UPDATE", "purchase_order", "Updated PO #$id.");

        response(true, "Purchase order updated.", null);
    }

    if ($operation === "cancelPurchaseOrder") {

        $id = intval($input["PO_ID"] ?? 0);

        $current = getPOStatusName($conn, $id);

        if (!$current) {
            response(false, "Purchase order not found.", null);
        }

        $statusName = strtolower(trim($current["StatusName"] ?? ""));

        if ($statusName === "cancelled" || $statusName === "canceled") {
            response(false, "This purchase order is already cancelled.", null);
        }

        if (!isEditableStatus($current["StatusName"])) {
            response(
                false,
                "Only pending purchase orders can be cancelled. This one is " .
                $current["StatusName"] . ".",
                null
            );
        }

        $cancelID = findStatusID($conn, "cancelled");

        if ($cancelID <= 0) {
            $cancelID = findStatusID($conn, "canceled");
        }

        if ($cancelID <= 0) {
            response(false, "No 'Cancelled' status found. Ask the admin to add it.", null);
        }

        $conn->prepare("
            UPDATE purchase_order SET Status_ID = :status WHERE PO_ID = :id
        ")->execute([":status" => $cancelID, ":id" => $id]);

        addAudit($conn, $currentUserID, "CANCEL", "purchase_order", "Cancelled PO #$id.");

        response(true, "Purchase order cancelled.", null);
    }

    if ($operation === "deletePurchaseOrder") {

        $id = intval($input["PO_ID"] ?? 0);

        $current = getPOStatusName($conn, $id);

        if (!$current) {
            response(false, "Purchase order not found.", null);
        }

        $statusName = strtolower(trim($current["StatusName"] ?? ""));

        $removable = isEditableStatus($current["StatusName"]) ||
            $statusName === "cancelled" || $statusName === "canceled";

        if (!$removable) {
            response(
                false,
                "Only pending or cancelled purchase orders can be removed. This one is " .
                $current["StatusName"] . ".",
                null
            );
        }

        $stmt = $conn->prepare("
            SELECT COUNT(*) AS total FROM purchase_return
            WHERE PO_ID = :id AND IsArchived = 'No'
        ");

        $stmt->execute([":id" => $id]);

        if (intval($stmt->fetch()["total"]) > 0) {
            response(false, "This purchase order has purchase returns linked to it.", null);
        }

        $conn->beginTransaction();

        $conn->prepare("UPDATE purchase_order SET IsArchived = 'Yes' WHERE PO_ID = :id")
             ->execute([":id" => $id]);

        $conn->prepare("UPDATE purchase_order_line SET IsArchived = 'Yes' WHERE PO_ID = :id")
             ->execute([":id" => $id]);

        $conn->commit();

        addAudit($conn, $currentUserID, "ARCHIVE", "purchase_order", "Archived PO #$id.");

        response(true, "Purchase order removed.", null);
    }

    if ($operation === "getPurchaseReturns") {

        $search   = getSearch($input);
        $archived = getArchivedFilter($input);
        $statusID = intval($input["Status_ID"] ?? 0);

        $sql = "
            SELECT
                pr.Purchase_Return_ID, pr.PO_ID, pr.Supplier_ID,
                s.SupplierName, s.ContactPerson, s.Phone,
                pr.User_ID,
                CONCAT(COALESCE(u.FirstName,''), ' ', COALESCE(u.LastName,'')) AS UserName,
                pr.Return_Date, pr.Reason, pr.Status_ID, st.StatusName, pr.IsArchived,
                (
                    SELECT COALESCE(SUM(l.Quantity), 0)
                    FROM purchase_return_line l
                    WHERE l.Purchase_Return_ID = pr.Purchase_Return_ID
                    AND l.IsArchived = 'No'
                ) AS TotalQuantity
            FROM purchase_return pr
            LEFT JOIN supplier s ON pr.Supplier_ID = s.SupplierID
            LEFT JOIN `user` u ON pr.User_ID = u.UserID
            LEFT JOIN status st ON pr.Status_ID = st.StatusID
            WHERE pr.IsArchived = :archived
        ";

        $params = [":archived" => $archived ? "Yes" : "No"];

        if ($search !== "") {
            $sql .= "
                AND (
                    s.SupplierName LIKE :search
                    OR pr.Reason LIKE :search2
                    OR pr.PO_ID LIKE :search3
                )
            ";
            $params[":search"]  = "%$search%";
            $params[":search2"] = "%$search%";
            $params[":search3"] = "%$search%";
        }

        if ($statusID > 0) {
            $sql .= " AND pr.Status_ID = :status ";
            $params[":status"] = $statusID;
        }

        $sql .= " ORDER BY pr.Return_Date DESC, pr.Purchase_Return_ID DESC ";

        $stmt = $conn->prepare($sql);
        $stmt->execute($params);

        response(true, "Purchase returns loaded.", $stmt->fetchAll());
    }

    if ($operation === "getPurchaseReturn") {

        $id = intval($input["Purchase_Return_ID"] ?? 0);

        $stmt = $conn->prepare("
            SELECT
                pr.Purchase_Return_ID, pr.PO_ID, pr.Supplier_ID, pr.User_ID,
                pr.Return_Date, pr.Status_ID, pr.Reason, pr.IsArchived,
                s.SupplierName, s.ContactPerson, s.Phone, s.Email, s.Address,
                st.StatusName,
                CONCAT(COALESCE(u.FirstName,''), ' ', COALESCE(u.LastName,'')) AS UserName,
                po.PO_Date
            FROM purchase_return pr
            LEFT JOIN supplier s ON pr.Supplier_ID = s.SupplierID
            LEFT JOIN status st ON pr.Status_ID = st.StatusID
            LEFT JOIN `user` u ON pr.User_ID = u.UserID
            LEFT JOIN purchase_order po ON pr.PO_ID = po.PO_ID
            WHERE pr.Purchase_Return_ID = :id
            LIMIT 1
        ");

        $stmt->execute([":id" => $id]);

        $header = $stmt->fetch();

        if (!$header) {
            response(false, "Purchase return not found.", null);
        }

        $stmt = $conn->prepare("
            SELECT
                l.Purchase_Return_Line_ID, l.Product_ID,
                p.ProductName, uom.UnitSymbol, l.Quantity
            FROM purchase_return_line l
            LEFT JOIN product p ON l.Product_ID = p.ProductID
            LEFT JOIN unit_of_measure uom ON p.UnitOfMeasureID = uom.UnitOfMeasureID
            WHERE l.Purchase_Return_ID = :id AND l.IsArchived = 'No'
            ORDER BY l.Purchase_Return_Line_ID ASC
        ");

        $stmt->execute([":id" => $id]);

        $header["lines"]    = $stmt->fetchAll();
        $header["Editable"] = isEditableStatus($header["StatusName"]) ? 1 : 0;

        response(true, "Purchase return loaded.", $header);
    }

    if ($operation === "insertPurchaseReturn") {

        $poID       = intval($input["PO_ID"] ?? 0);
        $returnDate = trim($input["Return_Date"] ?? "");
        $reason     = trim($input["Reason"] ?? "");
        $statusID   = intval($input["Status_ID"] ?? 0);
        $lines      = $input["lines"] ?? [];

        if ($poID <= 0) {
            response(false, "Please select the purchase order being returned.", null);
        }

        if ($returnDate === "") {
            response(false, "Return date is required.", null);
        }

        if (!is_array($lines) || count($lines) === 0) {
            response(false, "Add at least one product to the return.", null);
        }

        $stmt = $conn->prepare("
            SELECT Supplier_ID, PO_Date, IsArchived
            FROM purchase_order WHERE PO_ID = :id LIMIT 1
        ");

        $stmt->execute([":id" => $poID]);

        $po = $stmt->fetch();

        if (!$po || $po["IsArchived"] === "Yes") {
            response(false, "Purchase order not found.", null);
        }

        if ($returnDate < $po["PO_Date"]) {
            response(false, "Return date cannot be earlier than the PO date.", null);
        }

        if ($statusID <= 0) {

            $statusID = findStatusID($conn, "pending");

            if ($statusID <= 0) {
                response(false, "No 'Pending' status found. Ask the admin to add it.", null);
            }
        }

        $stmt = $conn->prepare("
            SELECT Product_ID, SUM(Quantity) AS qty
            FROM purchase_order_line
            WHERE PO_ID = :id AND IsArchived = 'No'
            GROUP BY Product_ID
        ");

        $stmt->execute([":id" => $poID]);

        $ordered = [];

        foreach ($stmt->fetchAll() as $row) {
            $ordered[intval($row["Product_ID"])] = intval($row["qty"]);
        }

        $clean = [];
        $seen  = [];

        foreach ($lines as $line) {

            $productID = intval($line["Product_ID"] ?? 0);
            $qty       = intval($line["Quantity"] ?? 0);

            if ($productID <= 0 || $qty <= 0) {
                response(false, "Every return line needs a product and a quantity.", null);
            }

            if (isset($seen[$productID])) {
                response(false, "Duplicate product in the return. Merge the quantities instead.", null);
            }

            if (!isset($ordered[$productID])) {
                response(false, "One of the products is not part of the selected purchase order.", null);
            }

            if ($qty > $ordered[$productID]) {
                response(
                    false,
                    "Return quantity cannot exceed the ordered quantity (" .
                    $ordered[$productID] . ").",
                    null
                );
            }

            $seen[$productID] = true;

            $clean[] = ["product" => $productID, "qty" => $qty];
        }

        $conn->beginTransaction();

        $stmt = $conn->prepare("
            INSERT INTO purchase_return
            (PO_ID, Supplier_ID, User_ID, Return_Date, Status_ID, Reason, IsArchived)
            VALUES
            (:po, :supplier, :user, :rdate, :status, :reason, 'No')
        ");

        $stmt->execute([
            ":po"       => $poID,
            ":supplier" => intval($po["Supplier_ID"]),
            ":user"     => $currentUserID,
            ":rdate"    => $returnDate,
            ":status"   => $statusID,
            ":reason"   => $reason
        ]);

        $returnID = intval($conn->lastInsertId());

        $lineStmt = $conn->prepare("
            INSERT INTO purchase_return_line
            (Purchase_Return_ID, Product_ID, Quantity, IsArchived)
            VALUES
            (:ret, :product, :qty, 'No')
        ");

        foreach ($clean as $line) {
            $lineStmt->execute([
                ":ret"     => $returnID,
                ":product" => $line["product"],
                ":qty"     => $line["qty"]
            ]);
        }

        $conn->commit();

        addAudit(
            $conn, $currentUserID, "INSERT", "purchase_return",
            "Created purchase return #$returnID for PO #$poID."
        );

        response(true, "Purchase return created.", [
            "Purchase_Return_ID" => $returnID
        ]);
    }

    if ($operation === "updatePurchaseReturn") {

        $id         = intval($input["Purchase_Return_ID"] ?? 0);
        $returnDate = trim($input["Return_Date"] ?? "");
        $reason     = trim($input["Reason"] ?? "");
        $statusID   = intval($input["Status_ID"] ?? 0);
        $lines      = $input["lines"] ?? [];

        if ($id <= 0) {
            response(false, "Purchase return not found.", null);
        }

        $stmt = $conn->prepare("
            SELECT pr.PO_ID, pr.IsArchived, st.StatusName
            FROM purchase_return pr
            LEFT JOIN status st ON pr.Status_ID = st.StatusID
            WHERE pr.Purchase_Return_ID = :id
            LIMIT 1
        ");

        $stmt->execute([":id" => $id]);

        $current = $stmt->fetch();

        if (!$current) {
            response(false, "Purchase return not found.", null);
        }

        if ($current["IsArchived"] === "Yes") {
            response(false, "This purchase return is archived.", null);
        }

        if (!isEditableStatus($current["StatusName"])) {
            response(
                false,
                "Only pending purchase returns can be updated. This one is " .
                $current["StatusName"] . ".",
                null
            );
        }

        if ($returnDate === "") {
            response(false, "Return date is required.", null);
        }

        if (!is_array($lines) || count($lines) === 0) {
            response(false, "Add at least one product to the return.", null);
        }

        $poID = intval($current["PO_ID"]);

        $stmt = $conn->prepare("
            SELECT Product_ID, SUM(Quantity) AS qty
            FROM purchase_order_line
            WHERE PO_ID = :id AND IsArchived = 'No'
            GROUP BY Product_ID
        ");

        $stmt->execute([":id" => $poID]);

        $ordered = [];

        foreach ($stmt->fetchAll() as $row) {
            $ordered[intval($row["Product_ID"])] = intval($row["qty"]);
        }

        $clean = [];
        $seen  = [];

        foreach ($lines as $line) {

            $productID = intval($line["Product_ID"] ?? 0);
            $qty       = intval($line["Quantity"] ?? 0);

            if ($productID <= 0 || $qty <= 0) {
                response(false, "Every return line needs a product and a quantity.", null);
            }

            if (isset($seen[$productID])) {
                response(false, "Duplicate product in the return.", null);
            }

            if (!isset($ordered[$productID])) {
                response(false, "One of the products is not part of the purchase order.", null);
            }

            if ($qty > $ordered[$productID]) {
                response(
                    false,
                    "Return quantity cannot exceed the ordered quantity (" .
                    $ordered[$productID] . ").",
                    null
                );
            }

            $seen[$productID] = true;

            $clean[] = ["product" => $productID, "qty" => $qty];
        }

        $conn->beginTransaction();

        $conn->prepare("
            UPDATE purchase_return
            SET Return_Date = :rdate,
                Reason = :reason,
                Status_ID = COALESCE(:status, Status_ID)
            WHERE Purchase_Return_ID = :id
        ")->execute([
            ":rdate"  => $returnDate,
            ":reason" => $reason,
            ":status" => $statusID > 0 ? $statusID : null,
            ":id"     => $id
        ]);

        $conn->prepare("
            DELETE FROM purchase_return_line WHERE Purchase_Return_ID = :id
        ")->execute([":id" => $id]);

        $lineStmt = $conn->prepare("
            INSERT INTO purchase_return_line
            (Purchase_Return_ID, Product_ID, Quantity, IsArchived)
            VALUES
            (:ret, :product, :qty, 'No')
        ");

        foreach ($clean as $line) {
            $lineStmt->execute([
                ":ret"     => $id,
                ":product" => $line["product"],
                ":qty"     => $line["qty"]
            ]);
        }

        $conn->commit();

        addAudit($conn, $currentUserID, "UPDATE", "purchase_return", "Updated purchase return #$id.");

        response(true, "Purchase return updated.", null);
    }

    if ($operation === "cancelPurchaseReturn") {

        $id = intval($input["Purchase_Return_ID"] ?? 0);

        $stmt = $conn->prepare("
            SELECT st.StatusName
            FROM purchase_return pr
            LEFT JOIN status st ON pr.Status_ID = st.StatusID
            WHERE pr.Purchase_Return_ID = :id
            LIMIT 1
        ");

        $stmt->execute([":id" => $id]);

        $current = $stmt->fetch();

        if (!$current) {
            response(false, "Purchase return not found.", null);
        }

        if (!isEditableStatus($current["StatusName"])) {
            response(
                false,
                "Only pending purchase returns can be cancelled. This one is " .
                $current["StatusName"] . ".",
                null
            );
        }

        $cancelID = findStatusID($conn, "cancelled");

        if ($cancelID <= 0) {
            $cancelID = findStatusID($conn, "canceled");
        }

        if ($cancelID <= 0) {
            response(false, "No 'Cancelled' status found. Ask the admin to add it.", null);
        }

        $conn->prepare("
            UPDATE purchase_return SET Status_ID = :status WHERE Purchase_Return_ID = :id
        ")->execute([":status" => $cancelID, ":id" => $id]);

        addAudit($conn, $currentUserID, "CANCEL", "purchase_return", "Cancelled purchase return #$id.");

        response(true, "Purchase return cancelled.", null);
    }

    if ($operation === "deletePurchaseReturn") {

        $id = intval($input["Purchase_Return_ID"] ?? 0);

        $stmt = $conn->prepare("
            SELECT st.StatusName
            FROM purchase_return pr
            LEFT JOIN status st ON pr.Status_ID = st.StatusID
            WHERE pr.Purchase_Return_ID = :id
            LIMIT 1
        ");

        $stmt->execute([":id" => $id]);

        $current = $stmt->fetch();

        if (!$current) {
            response(false, "Purchase return not found.", null);
        }

        $statusName = strtolower(trim($current["StatusName"] ?? ""));

        $removable = isEditableStatus($current["StatusName"]) ||
            $statusName === "cancelled" || $statusName === "canceled";

        if (!$removable) {
            response(
                false,
                "Only pending or cancelled purchase returns can be removed. This one is " .
                $current["StatusName"] . ".",
                null
            );
        }

        $conn->beginTransaction();

        $conn->prepare("
            UPDATE purchase_return SET IsArchived = 'Yes' WHERE Purchase_Return_ID = :id
        ")->execute([":id" => $id]);

        $conn->prepare("
            UPDATE purchase_return_line SET IsArchived = 'Yes' WHERE Purchase_Return_ID = :id
        ")->execute([":id" => $id]);

        $conn->commit();

        addAudit($conn, $currentUserID, "ARCHIVE", "purchase_return", "Archived purchase return #$id.");

        response(true, "Purchase return removed.", null);
    }

    response(false, "Invalid operation: " . $operation, null);

} catch (PDOException $e) {

    if ($conn->inTransaction()) {
        $conn->rollBack();
    }

    response(false, "Database error: " . $e->getMessage(), null);

} catch (Exception $e) {

    if ($conn->inTransaction()) {
        $conn->rollBack();
    }

    response(false, "Server error: " . $e->getMessage(), null);
}