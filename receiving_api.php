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

$host = "127.0.0.1";
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
    if (is_array($decoded)) $input = $decoded;
}

if (empty($input) && !empty($_POST)) $input = $_POST;

if (isset($_POST["json"]) && !empty($_POST["json"])) {
    $jsonData = json_decode($_POST["json"], true);
    if (is_array($jsonData)) $input = array_merge($input, $jsonData);
}

$operation = $input["operation"] ?? $_POST["operation"] ?? "";

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

function addAudit($conn, $userID, $action, $table, $details = "")
{
    if ($userID <= 0) return;
    try {
        $stmt = $conn->prepare("
            INSERT INTO auditlog
            (UserID, ActionType, TableAffected, ActionTimestamp, Details, IsArchived)
            VALUES (:u, :a, :t, NOW(), :d, 'No')
        ");
        $stmt->execute([
            ":u" => $userID,
            ":a" => $action,
            ":t" => $table,
            ":d" => $details
        ]);
    } catch (Exception $e) {}
}

function getSearch($input)
{
    return isset($input["search"]) ? trim($input["search"]) : "";
}

function requireReceivingStaff($conn, $userID)
{
    if (!$userID || intval($userID) <= 0) {
        response(false, "Authentication required.", null);
    }

    try {
        $stmt = $conn->prepare("
            SELECT
                u.UserID, u.UserName, u.UserStatus,
                u.IsArchived AS UserArchived,
                r.RoleName, r.IsArchived AS RoleArchived
            FROM `user` u
            LEFT JOIN `role` r ON u.RoleID = r.RoleID
            WHERE u.UserID = :id
            LIMIT 1
        ");
        $stmt->execute([":id" => intval($userID)]);
        $user = $stmt->fetch();

        if (!$user) response(false, "User not found.", null);

        if (strtolower(trim($user["UserArchived"] ?? "")) === "yes") {
            response(false, "Account archived.", null);
        }

        if (strtolower(trim($user["UserStatus"] ?? "")) !== "active") {
            response(false, "Account inactive.", null);
        }

        if (strtolower(trim($user["RoleArchived"] ?? "")) === "yes") {
            response(false, "Role archived.", null);
        }

        $role = strtolower(trim($user["RoleName"] ?? ""));

        if (
            $role !== "receiving staff" &&
            $role !== "admin" &&
            $role !== "administrator"
        ) {
            response(false, "Receiving Staff access required.", null);
        }

        return $user;

    } catch (PDOException $e) {
        response(false, "Auth error: " . $e->getMessage(), null);
    }
}

try {

    $currentUserID = getCurrentUserID($input);

    if ($operation === "logout") {
        if ($currentUserID > 0) {
            addAudit($conn, $currentUserID, "LOGOUT", "user", "Receiving staff logged out.");
        }
        response(true, "Logout successful.", null);
    }

    requireReceivingStaff($conn, $currentUserID);

    if ($operation === "getReceivingDashboardStats") {

        $stmt = $conn->query("
            SELECT COUNT(*) AS total
            FROM purchase_order po
            INNER JOIN status s ON po.Status_ID = s.StatusID
            WHERE po.IsArchived = 'No'
              AND LOWER(TRIM(s.StatusName)) IN ('pending', 'approved')
        ");
        $expected = intval($stmt->fetch()["total"]);

        $stmt = $conn->query("
            SELECT COUNT(*) AS total
            FROM receiving
            WHERE IsArchived = 'No'
              AND DATE(ReceivingDate) = CURDATE()
        ");
        $today = intval($stmt->fetch()["total"]);

        $stmt = $conn->query("
            SELECT COUNT(*) AS total
            FROM receiving r
            INNER JOIN status s ON r.StatusID = s.StatusID
            WHERE r.IsArchived = 'No'
              AND LOWER(TRIM(s.StatusName)) = 'pending'
        ");
        $pending = intval($stmt->fetch()["total"]);

        $stmt = $conn->query("SELECT COUNT(*) AS total FROM product WHERE IsArchived = 'No'");
        $totalProducts = intval($stmt->fetch()["total"]);

        $stmt = $conn->query("
            SELECT
                po.PO_ID, po.PO_Date, po.Expected_Date,
                s.SupplierName,
                CONCAT(u.FirstName, ' ', u.LastName) AS UserName,
                st.StatusName
            FROM purchase_order po
            LEFT JOIN supplier s ON po.Supplier_ID = s.SupplierID
            LEFT JOIN `user` u ON po.User_ID = u.UserID
            LEFT JOIN status st ON po.Status_ID = st.StatusID
            WHERE po.IsArchived = 'No'
              AND LOWER(TRIM(st.StatusName)) IN ('pending', 'approved')
            ORDER BY po.Expected_Date ASC
            LIMIT 10
        ");
        $expectedPOs = $stmt->fetchAll();

        response(true, "Dashboard stats loaded.", [
            "expectedDeliveries" => $expected,
            "receivingsToday"    => $today,
            "pendingReceivings"  => $pending,
            "totalProducts"      => $totalProducts,
            "expectedPOs"        => $expectedPOs
        ]);
    }

    if ($operation === "getProductsForReceiving") {
        $search = getSearch($input);

        $sql = "
            SELECT
                p.ProductID, p.Barcode, p.ProductName, p.Description,
                p.MinStockLevel,
                c.CategoryName,
                u.UnitName, u.UnitSymbol,
                b.BinCode, s.ShelfCode, a.AisleCode
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

    if ($operation === "getSuppliersForReceiving") {
        $search = getSearch($input);

        $sql = "
            SELECT SupplierID, SupplierName, ContactPerson, Phone, Email, Address
            FROM supplier
            WHERE IsArchived = 'No'
        ";

        if ($search !== "") {
            $sql .= " AND (SupplierName LIKE :s1 OR ContactPerson LIKE :s2 OR Email LIKE :s3) ";
        }

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

    if ($operation === "getAislesForReceiving") {
        $stmt = $conn->query("
            SELECT AisleID, AisleCode FROM aisle
            WHERE IsArchived = 'No'
            ORDER BY AisleCode ASC
        ");
        response(true, "Aisles loaded.", $stmt->fetchAll());
    }

    if ($operation === "getShelvesForReceiving") {
        $stmt = $conn->query("
            SELECT s.ShelfID, s.ShelfCode, a.AisleCode
            FROM shelf s
            LEFT JOIN aisle a ON s.AisleID = a.AisleID
            WHERE s.IsArchived = 'No'
            ORDER BY a.AisleCode, s.ShelfCode
        ");
        response(true, "Shelves loaded.", $stmt->fetchAll());
    }

    if ($operation === "getBinsForReceiving") {
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

    if ($operation === "getStatusesForReceiving") {
        $stmt = $conn->query("
            SELECT StatusID, StatusName FROM status
            WHERE IsArchived = 'No'
            ORDER BY StatusName ASC
        ");
        response(true, "Statuses loaded.", $stmt->fetchAll());
    }

    if ($operation === "getExpectedPurchaseOrders") {
        $search = getSearch($input);

        $sql = "
            SELECT
                po.PO_ID, po.PO_Date, po.Expected_Date,
                po.Supplier_ID, s.SupplierName, po.User_ID,
                CONCAT(u.FirstName, ' ', u.LastName) AS UserName,
                po.Status_ID, st.StatusName
            FROM purchase_order po
            LEFT JOIN supplier s ON po.Supplier_ID = s.SupplierID
            LEFT JOIN `user` u ON po.User_ID = u.UserID
            LEFT JOIN status st ON po.Status_ID = st.StatusID
            WHERE po.IsArchived = 'No'
              AND LOWER(TRIM(st.StatusName)) IN ('pending', 'approved')
        ";

        if ($search !== "") {
            $sql .= " AND (s.SupplierName LIKE :s1 OR po.PO_ID LIKE :s2) ";
        }

        $sql .= " ORDER BY po.Expected_Date ASC ";

        $stmt = $conn->prepare($sql);
        $params = [];
        if ($search !== "") {
            $params[":s1"] = "%$search%";
            $params[":s2"] = "%$search%";
        }
        $stmt->execute($params);

        response(true, "Expected POs loaded.", $stmt->fetchAll());
    }

    if ($operation === "getPurchaseOrderLines") {
        $poId = intval($input["PO_ID"] ?? 0);

        $stmt = $conn->prepare("
            SELECT
                pol.PO_Line_ID,
                pol.Product_ID AS ProductID,
                p.ProductName,
                pol.Quantity AS OrderedQuantity,
                pol.Unit_Price AS CostPrice
            FROM purchase_order_line pol
            LEFT JOIN product p ON pol.Product_ID = p.ProductID
            WHERE pol.PO_ID = :id
              AND pol.IsArchived = 'No'
        ");
        $stmt->execute([":id" => $poId]);
        response(true, "PO lines loaded.", $stmt->fetchAll());
    }

    /* ============================================================
       ✅ FIXED — getReceivings
       The `receiving` table has a real PO_ID (int) foreign key —
       there is no PO_Reference column. Selecting/filtering on
       r.PO_Reference threw a SQL error on every call (caught
       silently by the outer try/catch), which is why the Receiving
       Records page never showed any data. We now select r.PO_ID
       and alias it as PO_Reference so receiving_dashboard.js (which
       already expects that field name) keeps working unchanged.
    ============================================================ */
    if ($operation === "getReceivings") {
        $search = getSearch($input);
        $date = trim($input["date"] ?? "");
        $status = trim($input["status"] ?? "");

        $sql = "
            SELECT
                r.ReceivingID, r.ReceivingDate,
                r.SupplierID, s.SupplierName,
                r.ReceivedByUserID,
                CONCAT(u.FirstName, ' ', u.LastName) AS UserName,
                r.PO_ID AS PO_Reference,
                r.StatusID, st.StatusName
            FROM receiving r
            LEFT JOIN supplier s ON r.SupplierID = s.SupplierID
            LEFT JOIN `user` u ON r.ReceivedByUserID = u.UserID
            LEFT JOIN status st ON r.StatusID = st.StatusID
            WHERE r.IsArchived = 'No'
        ";

        $params = [];

        if ($search !== "") {
            $sql .= " AND (s.SupplierName LIKE :s1 OR r.PO_ID LIKE :s2) ";
            $params[":s1"] = "%$search%";
            $params[":s2"] = "%$search%";
        }

        if ($date !== "") {
            $sql .= " AND DATE(r.ReceivingDate) = :date ";
            $params[":date"] = $date;
        }

        if ($status !== "") {
            $sql .= " AND r.StatusID = :status ";
            $params[":status"] = intval($status);
        }

        $sql .= " ORDER BY r.ReceivingDate DESC, r.ReceivingID DESC LIMIT 500 ";

        $stmt = $conn->prepare($sql);
        $stmt->execute($params);

        response(true, "Receivings loaded.", $stmt->fetchAll());
    }

    /* ============================================================
       ✅ FIXED — getReceivingById
       Same PO_ID fix as above. Also removed the old regex that
       tried to pull digits out of a text PO_Reference field —
       PO_ID is already a plain integer, so it's used directly to
       join purchase_order_line for the Ordered-vs-Received lines.
    ============================================================ */
    if ($operation === "getReceivingById") {
        $id = intval($input["ReceivingID"] ?? 0);

        $stmt = $conn->prepare("
            SELECT
                r.ReceivingID, r.ReceivingDate,
                r.SupplierID, s.SupplierName,
                r.ReceivedByUserID,
                CONCAT(u.FirstName, ' ', u.LastName) AS UserName,
                r.PO_ID AS PO_Reference,
                r.StatusID, st.StatusName
            FROM receiving r
            LEFT JOIN supplier s ON r.SupplierID = s.SupplierID
            LEFT JOIN `user` u ON r.ReceivedByUserID = u.UserID
            LEFT JOIN status st ON r.StatusID = st.StatusID
            WHERE r.ReceivingID = :id
            LIMIT 1
        ");
        $stmt->execute([":id" => $id]);
        $row = $stmt->fetch();

        if (!$row) response(false, "Receiving not found.", null);

        $poId = !empty($row["PO_Reference"]) ? intval($row["PO_Reference"]) : null;

        $stmt = $conn->prepare("
            SELECT
                rl.ReceivingLineID,
                rl.ProductID AS ProductID,
                p.ProductName,
                rl.ReceivedQuantity AS ReceivedQty,
                rl.CostPrice,
                COALESCE(pol.Quantity, 0) AS OrderedQty
            FROM receiving_line rl
            LEFT JOIN product p 
                ON rl.ProductID = p.ProductID
            LEFT JOIN purchase_order_line pol 
                ON pol.Product_ID = rl.ProductID 
                AND pol.PO_ID = :poId
                AND pol.IsArchived = 'No'
            WHERE rl.ReceivingID = :id
              AND rl.IsArchived = 'No'
        ");
        $stmt->execute([
            ":id"   => $id,
            ":poId" => $poId
        ]);
        $row["lines"] = $stmt->fetchAll();

        response(true, "Receiving loaded.", $row);
    }

    /* ============================================================
       ✅ FIXED — insertReceiving
       Writes to the real PO_ID column instead of the non-existent
       PO_Reference column. The frontend still sends the field as
       "PO_Reference" in its payload (receiving_dashboard.js), so
       we just read it under that key and cast it to an int PO_ID.
    ============================================================ */
    if ($operation === "insertReceiving") {

        $supplierID = intval($input["SupplierID"] ?? 0);
        $date = trim($input["ReceivingDate"] ?? "");
        $poRefInput = trim($input["PO_Reference"] ?? "");
        $poId = $poRefInput !== "" ? intval($poRefInput) : null;
        $statusID = intval($input["StatusID"] ?? 0) ?: null;
        $lines = $input["Lines"] ?? [];

        if ($supplierID <= 0 || $date === "") {
            response(false, "Supplier and date are required.", null);
        }

        if (!is_array($lines) || !count($lines)) {
            response(false, "At least one line is required.", null);
        }

        $conn->beginTransaction();

        try {
            $stmt = $conn->prepare("
                INSERT INTO receiving
                (ReceivingDate, SupplierID, ReceivedByUserID, PO_ID, StatusID, IsArchived)
                VALUES (:date, :sup, :usr, :po, :st, 'No')
            ");
            $stmt->execute([
                ":date" => $date,
                ":sup"  => $supplierID,
                ":usr"  => $currentUserID,
                ":po"   => $poId,
                ":st"   => $statusID
            ]);

            $newID = $conn->lastInsertId();

            $lineStmt = $conn->prepare("
                INSERT INTO receiving_line
                (ReceivingID, ProductID, ReceivedQuantity, CostPrice, IsArchived)
                VALUES (:rid, :pid, :rq, :cp, 'No')
            ");

            foreach ($lines as $line) {
                $lineStmt->execute([
                    ":rid" => $newID,
                    ":pid" => intval($line["ProductID"] ?? 0) ?: null,
                    ":rq"  => floatval($line["ReceivedQuantity"] ?? $line["ReceivedQty"] ?? 0),
                    ":cp"  => floatval($line["CostPrice"] ?? 0)
                ]);
            }

            $conn->commit();

            addAudit($conn, $currentUserID, "INSERT", "receiving", "Created Receiving #$newID");
            response(true, "Receiving created.", ["ReceivingID" => $newID]);

        } catch (Exception $e) {
            $conn->rollBack();
            response(false, "Insert failed: " . $e->getMessage(), null);
        }
    }

    /* ============================================================
       ✅ FIXED — updateReceiving
       Same PO_ID fix as insertReceiving above.
    ============================================================ */
    if ($operation === "updateReceiving") {

        $id = intval($input["ReceivingID"] ?? 0);
        $supplierID = intval($input["SupplierID"] ?? 0);
        $date = trim($input["ReceivingDate"] ?? "");
        $poRefInput = trim($input["PO_Reference"] ?? "");
        $poId = $poRefInput !== "" ? intval($poRefInput) : null;
        $statusID = intval($input["StatusID"] ?? 0) ?: null;
        $lines = $input["Lines"] ?? [];

        if ($id <= 0) response(false, "Invalid Receiving ID.", null);

        $conn->beginTransaction();

        try {
            $conn->prepare("
                UPDATE receiving
                SET ReceivingDate = :date,
                    SupplierID = :sup,
                    PO_ID = :po,
                    StatusID = :st
                WHERE ReceivingID = :id
            ")->execute([
                ":date" => $date,
                ":sup"  => $supplierID,
                ":po"   => $poId,
                ":st"   => $statusID,
                ":id"   => $id
            ]);

            $conn->prepare("DELETE FROM receiving_line WHERE ReceivingID = :id")
                 ->execute([":id" => $id]);

            $lineStmt = $conn->prepare("
                INSERT INTO receiving_line
                (ReceivingID, ProductID, ReceivedQuantity, CostPrice, IsArchived)
                VALUES (:rid, :pid, :rq, :cp, 'No')
            ");

            foreach ($lines as $line) {
                $lineStmt->execute([
                    ":rid" => $id,
                    ":pid" => intval($line["ProductID"] ?? 0) ?: null,
                    ":rq"  => floatval($line["ReceivedQuantity"] ?? $line["ReceivedQty"] ?? 0),
                    ":cp"  => floatval($line["CostPrice"] ?? 0)
                ]);
            }

            $conn->commit();

            addAudit($conn, $currentUserID, "UPDATE", "receiving", "Updated Receiving #$id");
            response(true, "Receiving updated.", null);

        } catch (Exception $e) {
            $conn->rollBack();
            response(false, "Update failed: " . $e->getMessage(), null);
        }
    }

    if ($operation === "deleteReceiving") {

        $id = intval($input["ReceivingID"] ?? 0);
        if ($id <= 0) response(false, "Invalid ID.", null);

        $conn->prepare("UPDATE receiving SET IsArchived = 'Yes' WHERE ReceivingID = :id")
             ->execute([":id" => $id]);

        addAudit($conn, $currentUserID, "CANCEL", "receiving", "Cancelled Receiving #$id");

        response(true, "Receiving cancelled.", null);
    }

    response(false, "Invalid operation: " . $operation, null);

} catch (PDOException $e) {
    response(false, "DB error: " . $e->getMessage(), null);
} catch (Exception $e) {
    response(false, "Server error: " . $e->getMessage(), null);
}

?>