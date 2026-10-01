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

function getSearch($input)
{
    return isset($input["search"]) ? trim($input["search"]) : "";
}

function addAudit($conn, $userID, $action, $table, $details = "")
{
    if ($userID <= 0) return;
    try {
        $stmt = $conn->prepare("
            INSERT INTO auditlog (UserID, ActionType, TableAffected, ActionTimestamp, Details, IsArchived)
            VALUES (:u, :a, :t, NOW(), :d, 'No')
        ");
        $stmt->execute([":u" => $userID, ":a" => $action, ":t" => $table, ":d" => $details]);
    } catch (Exception $e) {}
}

function requireReleasing($conn, $currentUserID)
{
    if (!$currentUserID || intval($currentUserID) <= 0) {
        response(false, "Releasing access required.", null);
    }

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
        $allowed = ["releasing staff", "releasing", "admin", "administrator"];

        if (!in_array($role, $allowed, true)) {
            response(false, "Releasing access required. Current role: " . ($user["RoleName"] ?? "No Role"), null);
        }

        return $user;
    } catch (PDOException $e) {
        response(false, "Auth error: " . $e->getMessage(), null);
    }
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

function stockExpression()
{
    return "(
        COALESCE(rin.qty, 0) - COALESCE(rel.qty, 0)
        + COALESCE(sret.qty, 0) - COALESCE(pret.qty, 0)
        + COALESCE(adj.qty, 0)
    )";
}

function findStatusIDByName($conn, $name)
{
    $stmt = $conn->prepare("
        SELECT StatusID FROM status
        WHERE LOWER(TRIM(StatusName)) = :name AND IsArchived = 'No' LIMIT 1
    ");
    $stmt->execute([":name" => strtolower(trim($name))]);
    $row = $stmt->fetch();
    return $row ? intval($row["StatusID"]) : 0;
}

try {

    $currentUserID = getCurrentUserID($input);

    if ($operation === "logout") {
        if ($currentUserID > 0) {
            addAudit($conn, $currentUserID, "LOGOUT", "user", "Releasing staff logged out.");
        }
        response(true, "Logout successful.", null);
    }

    requireReleasing($conn, $currentUserID);

    /* ============================================================
       DASHBOARD
    ============================================================ */

    if ($operation === "getDashboardStats") {

        $approvedID  = findStatusIDByName($conn, "approved");
        $completedID = findStatusIDByName($conn, "completed");

        $toProcessCount = 0;
        if ($approvedID > 0) {
            $stmt = $conn->prepare("
                SELECT COUNT(*) AS t FROM stock_release
                WHERE IsArchived = 'No' AND Status_ID = :sid
            ");
            $stmt->execute([":sid" => $approvedID]);
            $toProcessCount = intval($stmt->fetch()["t"]);
        }

        $completedCount = 0;
        if ($completedID > 0) {
            $stmt = $conn->prepare("
                SELECT COUNT(*) AS t FROM stock_release
                WHERE IsArchived = 'No' AND Status_ID = :sid
            ");
            $stmt->execute([":sid" => $completedID]);
            $completedCount = intval($stmt->fetch()["t"]);
        }

        $totalProducts = intval($conn->query("
            SELECT COUNT(*) AS t FROM product WHERE IsArchived = 'No'
        ")->fetch()["t"]);

        $lowStockCount = intval($conn->query("
            SELECT COUNT(*) AS t FROM (
                SELECT p.ProductID, " . stockExpression() . " AS OnHand, p.MinStockLevel
                FROM product p " . stockJoins() . "
                WHERE p.IsArchived = 'No'
                HAVING OnHand <= p.MinStockLevel
            ) x
        ")->fetch()["t"]);

        $toProcess = [];
        if ($approvedID > 0) {
            $stmt = $conn->prepare("
                SELECT sr.ReleaseID,
                       CONCAT(COALESCE(u.FirstName,''), ' ', COALESCE(u.LastName,'')) AS RequestedBy,
                       st.StatusName,
                       (SELECT COUNT(*) FROM stock_release_line l WHERE l.ReleaseID = sr.ReleaseID AND l.IsArchived = 'No') AS ItemCount
                FROM stock_release sr
                LEFT JOIN `user` u ON sr.RequestedByUserID = u.UserID
                LEFT JOIN status st ON sr.Status_ID = st.StatusID
                WHERE sr.IsArchived = 'No' AND sr.Status_ID = :sid
                ORDER BY sr.ReleaseID DESC
                LIMIT 8
            ");
            $stmt->execute([":sid" => $approvedID]);
            $toProcess = $stmt->fetchAll();
        }

        $recentCompleted = [];
        if ($completedID > 0) {
            $stmt = $conn->prepare("
                SELECT sr.ReleaseID, sr.ReleaseDate,
                       CONCAT(COALESCE(u.FirstName,''), ' ', COALESCE(u.LastName,'')) AS ReleasedBy,
                       st.StatusName
                FROM stock_release sr
                LEFT JOIN `user` u ON sr.ReleasedByUserID = u.UserID
                LEFT JOIN status st ON sr.Status_ID = st.StatusID
                WHERE sr.IsArchived = 'No' AND sr.Status_ID = :sid
                ORDER BY sr.ReleaseDate DESC, sr.ReleaseID DESC
                LIMIT 8
            ");
            $stmt->execute([":sid" => $completedID]);
            $recentCompleted = $stmt->fetchAll();
        }

        response(true, "Dashboard loaded.", [
            "toProcessCount"  => $toProcessCount,
            "completedCount"  => $completedCount,
            "totalProducts"   => $totalProducts,
            "lowStockCount"   => $lowStockCount,
            "toProcess"       => $toProcess,
            "recentCompleted" => $recentCompleted
        ]);
    }

    /* ============================================================
       REFERENCE DATA (view-only)
    ============================================================ */

    if ($operation === "getProducts") {
        $search = getSearch($input);

        $sql = "
            SELECT p.ProductID, p.Barcode, p.ProductName, p.MinStockLevel,
                   c.CategoryName, u.UnitName, b.BinCode,
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
            $sql .= " AND (p.ProductName LIKE :s1 OR p.Barcode LIKE :s2 OR c.CategoryName LIKE :s3) ";
            $params[":s1"] = "%$search%"; $params[":s2"] = "%$search%"; $params[":s3"] = "%$search%";
        }
        $sql .= " ORDER BY p.ProductName ASC LIMIT 500 ";

        $stmt = $conn->prepare($sql);
        $stmt->execute($params);
        response(true, "Products loaded.", $stmt->fetchAll());
    }

    if ($operation === "getInventoryQuantities") {
        $search = getSearch($input);

        $sql = "
            SELECT p.ProductID, p.ProductName, p.MinStockLevel,
                   c.CategoryName, u.UnitName, b.BinCode,
                   " . stockExpression() . " AS OnHandQuantity
            FROM product p
            LEFT JOIN category c ON p.CategoryID = c.CategoryID
            LEFT JOIN unit_of_measure u ON p.UnitOfMeasureID = u.UnitOfMeasureID
            LEFT JOIN bin b ON p.BinID = b.BinID
            " . stockJoins() . "
            WHERE p.IsArchived = 'No'
        ";
        $params = [];
        if ($search !== "") {
            $sql .= " AND (p.ProductName LIKE :s1 OR p.Barcode LIKE :s2) ";
            $params[":s1"] = "%$search%"; $params[":s2"] = "%$search%";
        }
        $sql .= " ORDER BY p.ProductName ASC ";

        $stmt = $conn->prepare($sql);
        $stmt->execute($params);
        response(true, "Inventory loaded.", $stmt->fetchAll());
    }

    if ($operation === "getAisles") {
        $stmt = $conn->query("SELECT AisleID, AisleCode FROM aisle WHERE IsArchived = 'No' ORDER BY AisleCode");
        response(true, "Aisles loaded.", $stmt->fetchAll());
    }

    if ($operation === "getShelves") {
        $stmt = $conn->query("
            SELECT s.ShelfID, s.ShelfCode, a.AisleCode
            FROM shelf s LEFT JOIN aisle a ON s.AisleID = a.AisleID
            WHERE s.IsArchived = 'No' ORDER BY a.AisleCode, s.ShelfCode
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

    if ($operation === "getStatuses") {
        $stmt = $conn->query("
            SELECT StatusID, StatusName FROM status
            WHERE IsArchived = 'No' ORDER BY StatusName ASC
        ");
        response(true, "Statuses loaded.", $stmt->fetchAll());
    }

    /* ============================================================
       STOCK RELEASES
    ============================================================ */

    if ($operation === "getStockReleases") {

        $search   = getSearch($input);
        $statusID = intval($input["Status_ID"] ?? 0);
        $dateFrom = trim($input["dateFrom"] ?? "");
        $dateTo   = trim($input["dateTo"] ?? "");

        $approvedID  = findStatusIDByName($conn, "approved");
        $completedID = findStatusIDByName($conn, "completed");
        $visibleIDs  = array_filter([$approvedID, $completedID]);

        $sql = "
            SELECT sr.ReleaseID, sr.RequestDate, sr.ReleaseDate,
                   CONCAT(COALESCE(ru.FirstName,''), ' ', COALESCE(ru.LastName,'')) AS RequestedBy,
                   CONCAT(COALESCE(lu.FirstName,''), ' ', COALESCE(lu.LastName,'')) AS ReleasedBy,
                   sr.Status_ID, st.StatusName,
                   (SELECT COUNT(*) FROM stock_release_line l WHERE l.ReleaseID = sr.ReleaseID AND l.IsArchived = 'No') AS ItemCount
            FROM stock_release sr
            LEFT JOIN `user` ru ON sr.RequestedByUserID = ru.UserID
            LEFT JOIN `user` lu ON sr.ReleasedByUserID = lu.UserID
            LEFT JOIN status st ON sr.Status_ID = st.StatusID
            LEFT JOIN stock_release_line srl ON srl.ReleaseID = sr.ReleaseID AND srl.IsArchived = 'No'
            LEFT JOIN product p ON srl.ProductID = p.ProductID
            WHERE sr.IsArchived = 'No'
        ";

        $params = [];

        if ($statusID > 0) {
            $sql .= " AND sr.Status_ID = :statusid ";
            $params[":statusid"] = $statusID;
        } else if (count($visibleIDs) > 0) {
            $placeholders = [];
            foreach ($visibleIDs as $i => $vid) {
                $key = ":vid$i";
                $placeholders[] = $key;
                $params[$key] = $vid;
            }
            $sql .= " AND sr.Status_ID IN (" . implode(",", $placeholders) . ") ";
        }

        if ($search !== "") {
            $sql .= " AND (
                CONCAT(COALESCE(ru.FirstName,''),' ',COALESCE(ru.LastName,'')) LIKE :s1
                OR CONCAT(COALESCE(lu.FirstName,''),' ',COALESCE(lu.LastName,'')) LIKE :s2
                OR p.ProductName LIKE :s3
            ) ";
            $params[":s1"] = "%$search%"; $params[":s2"] = "%$search%"; $params[":s3"] = "%$search%";
        }

        if ($dateFrom !== "") {
            $sql .= " AND (sr.ReleaseDate >= :df OR sr.ReleaseDate IS NULL) ";
            $params[":df"] = $dateFrom;
        }

        if ($dateTo !== "") {
            $sql .= " AND (sr.ReleaseDate <= :dt OR sr.ReleaseDate IS NULL) ";
            $params[":dt"] = $dateTo;
        }

        $sql .= " GROUP BY sr.ReleaseID ORDER BY sr.ReleaseID DESC LIMIT 500 ";

        $stmt = $conn->prepare($sql);
        $stmt->execute($params);

        response(true, "Stock releases loaded.", $stmt->fetchAll());
    }

    if ($operation === "getStockRelease") {

        $id = intval($input["ReleaseID"] ?? 0);
        if ($id <= 0) response(false, "Invalid release ID.", null);

        $stmt = $conn->prepare("
            SELECT sr.ReleaseID, sr.RequestDate, sr.ReleaseDate, sr.Status_ID, st.StatusName,
                   CONCAT(COALESCE(ru.FirstName,''), ' ', COALESCE(ru.LastName,'')) AS RequestedBy,
                   CONCAT(COALESCE(lu.FirstName,''), ' ', COALESCE(lu.LastName,'')) AS ReleasedBy
            FROM stock_release sr
            LEFT JOIN `user` ru ON sr.RequestedByUserID = ru.UserID
            LEFT JOIN `user` lu ON sr.ReleasedByUserID = lu.UserID
            LEFT JOIN status st ON sr.Status_ID = st.StatusID
            WHERE sr.ReleaseID = :id AND sr.IsArchived = 'No'
            LIMIT 1
        ");
        $stmt->execute([":id" => $id]);
        $header = $stmt->fetch();

        if (!$header) response(false, "Stock release not found.", null);

        $stmt = $conn->prepare("
            SELECT srl.Stock_Release_Line_ID, srl.ProductID, p.ProductName, b.BinCode,
                   srl.QuantityRequested, srl.QuantityReleased,
                   " . stockExpression() . " AS OnHand
            FROM stock_release_line srl
            INNER JOIN product p ON srl.ProductID = p.ProductID
            LEFT JOIN bin b ON p.BinID = b.BinID
            " . stockJoins() . "
            WHERE srl.ReleaseID = :id AND srl.IsArchived = 'No'
            ORDER BY srl.Stock_Release_Line_ID ASC
        ");
        $stmt->execute([":id" => $id]);
        $header["lines"] = $stmt->fetchAll();

        response(true, "Stock release loaded.", $header);
    }

    if ($operation === "processStockRelease") {

        $id           = intval($input["ReleaseID"] ?? 0);
        $releaseDate  = trim($input["ReleaseDate"] ?? "");
        $lines        = $input["lines"] ?? [];
        $markCompleted = !empty($input["markCompleted"]);

        if ($id <= 0) response(false, "Invalid release ID.", null);
        if ($releaseDate === "") response(false, "Release date is required.", null);
        if (!is_array($lines) || count($lines) === 0) response(false, "No release lines to process.", null);

        $stmt = $conn->prepare("
            SELECT sr.*, st.StatusName
            FROM stock_release sr
            LEFT JOIN status st ON sr.Status_ID = st.StatusID
            WHERE sr.ReleaseID = :id AND sr.IsArchived = 'No'
            LIMIT 1
        ");
        $stmt->execute([":id" => $id]);
        $release = $stmt->fetch();

        if (!$release) response(false, "Stock release not found.", null);

        $statusName = strtolower(trim($release["StatusName"] ?? ""));
        if ($statusName !== "approved") {
            response(false, "Only approved stock releases can be processed. This one is " . ($release["StatusName"] ?: "unknown") . ".", null);
        }

        // Validate each line: cannot exceed requested quantity or current on-hand stock
        foreach ($lines as $line) {

            $lineID = intval($line["Stock_Release_Line_ID"] ?? 0);
            $qty    = intval($line["QuantityReleased"] ?? -1);

            if ($lineID <= 0) response(false, "Invalid release line.", null);
            if ($qty < 0) response(false, "Quantity released cannot be negative.", null);

            $stmt = $conn->prepare("
                SELECT srl.ProductID, srl.QuantityRequested
                FROM stock_release_line srl
                WHERE srl.Stock_Release_Line_ID = :lid AND srl.ReleaseID = :rid AND srl.IsArchived = 'No'
                LIMIT 1
            ");
            $stmt->execute([":lid" => $lineID, ":rid" => $id]);
            $lineRow = $stmt->fetch();

            if (!$lineRow) response(false, "A release line was not found.", null);

            if ($qty > intval($lineRow["QuantityRequested"])) {
                response(false, "Quantity released cannot exceed the requested quantity.", null);
            }

            // Fresh on-hand check (excludes this release's own not-yet-saved contribution)
            $stmt = $conn->prepare("
                SELECT " . stockExpression() . " AS OnHand
                FROM product p " . stockJoins() . "
                WHERE p.ProductID = :pid
            ");
            $stmt->execute([":pid" => intval($lineRow["ProductID"])]);
            $onHandRow = $stmt->fetch();
            $onHand = $onHandRow ? intval($onHandRow["OnHand"]) : 0;

            // Add back this line's previously-saved QuantityReleased, since the
            // on-hand calc above already subtracts it (we're about to overwrite it).
            $stmt = $conn->prepare("SELECT QuantityReleased FROM stock_release_line WHERE Stock_Release_Line_ID = :lid LIMIT 1");
            $stmt->execute([":lid" => $lineID]);
            $prevReleased = intval($stmt->fetch()["QuantityReleased"] ?? 0);
            $availableNow = $onHand + $prevReleased;

            if ($markCompleted && $qty > $availableNow) {
                response(false, "Insufficient stock to release the requested quantity for one of the products.", null);
            }
        }

        if ($markCompleted) {
            foreach ($lines as $line) {
                $qty = intval($line["QuantityReleased"] ?? 0);
                if ($qty <= 0) {
                    response(false, "Every line needs a quantity greater than zero to mark this release as completed.", null);
                }
            }
        }

        $conn->beginTransaction();

        $lineStmt = $conn->prepare("
            UPDATE stock_release_line
            SET QuantityReleased = :qty
            WHERE Stock_Release_Line_ID = :lid AND ReleaseID = :rid
        ");

        foreach ($lines as $line) {
            $lineStmt->execute([
                ":qty" => intval($line["QuantityReleased"] ?? 0),
                ":lid" => intval($line["Stock_Release_Line_ID"]),
                ":rid" => $id
            ]);
        }

        if ($markCompleted) {

            $completedID = findStatusIDByName($conn, "completed");
            if ($completedID <= 0) {
                $conn->rollBack();
                response(false, "No 'Completed' status found. Ask the admin to add it.", null);
            }

            $conn->prepare("
                UPDATE stock_release
                SET ReleaseDate = :rdate, Status_ID = :status, ReleasedByUserID = :uid
                WHERE ReleaseID = :id
            ")->execute([
                ":rdate"  => $releaseDate,
                ":status" => $completedID,
                ":uid"    => $currentUserID,
                ":id"     => $id
            ]);

            $conn->commit();

            addAudit($conn, $currentUserID, "UPDATE", "stock_release", "Completed stock release #$id.");

            response(true, "Stock release marked as completed.", null);

        } else {

            $conn->prepare("
                UPDATE stock_release
                SET ReleaseDate = :rdate
                WHERE ReleaseID = :id
            ")->execute([":rdate" => $releaseDate, ":id" => $id]);

            $conn->commit();

            addAudit($conn, $currentUserID, "UPDATE", "stock_release", "Saved progress on stock release #$id.");

            response(true, "Progress saved.", null);
        }
    }

    response(false, "Invalid operation: " . $operation, null);

} catch (PDOException $e) {
    if ($conn->inTransaction()) $conn->rollBack();
    response(false, "Database error: " . $e->getMessage(), null);
} catch (Exception $e) {
    if ($conn->inTransaction()) $conn->rollBack();
    response(false, "Server error: " . $e->getMessage(), null);
}