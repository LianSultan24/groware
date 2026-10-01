const baseApiUrl = "http://localhost/grocery_warehouse/api.php";

function pageForRole(roleName) {

    const role = String(roleName || "").toLowerCase().trim();

    if (role === "admin" || role === "administrator") {
        return "admin.html";
    }

    if (
        role === "purchasing staff" ||
        role === "purchasing" ||
        role === "purchaser" ||
        role === "purchasing officer"
    ) {
        return "purchasing.html";
    }

    if (
        role === "inventory staff" ||
        role === "inventory" ||
        role === "inventory officer" ||
        role === "stock clerk"
    ) {
        return "inventory.html";
    }

    if (role === "warehouse manager" || role === "warehouse") {
        return "manager_dashboard.html";
    }

    if (role === "receiving staff" || role === "receiving") {
        return "receiving_dashboard.html";
    }

    if (role === "releasing staff" || role === "releasing") {
        return "releasing.html";
    }

    return null;
}

const login = async () => {

    const username = document
        .getElementById("username")
        .value
        .trim();

    const password = document
        .getElementById("password")
        .value;

    if (username === "" || password === "") {
        alert("Please enter username and password.");
        return;
    }

    const formData = new FormData();
    formData.append("operation", "login");
    formData.append(
        "json",
        JSON.stringify({
            username: username,
            password: password
        })
    );

    try {

        console.log("Sending login request...");

        const response = await axios.post(baseApiUrl, formData);

        console.log("API RESPONSE:", response.data);

        if (
            response.data &&
            response.data.success === true &&
            response.data.data
        ) {

            const user = response.data.data;

            const page = pageForRole(user.RoleName);

            if (!page) {
                alert(
                    "No dashboard is available for the role: " +
                    (user.RoleName || "unassigned") + "."
                );
                return;
            }

            localStorage.setItem("user", JSON.stringify(user));

            console.log("Logged in user:", user);
            console.log("Redirecting to:", page);

            window.location.replace(page);
            return;
        }

        alert(
            response.data?.message ||
            "Invalid username or password."
        );

    } catch (error) {

        console.error("LOGIN ERROR:", error);

        if (error.response) {
            console.error("SERVER RESPONSE:", error.response.data);
            alert(
                error.response.data?.message ||
                "Server error occurred."
            );
        } else {
            alert(
                "Cannot connect to api.php. " +
                "Please make sure Apache and MySQL are running."
            );
        }
    }
};

document.addEventListener("DOMContentLoaded", () => {

    const loginButton   = document.getElementById("btn-login");
    const usernameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");

    if (loginButton) {
        loginButton.addEventListener("click", login);
    }

    if (usernameInput) {
        usernameInput.addEventListener("keyup", (event) => {
            if (event.key === "Enter") login();
        });
    }

    if (passwordInput) {
        passwordInput.addEventListener("keyup", (event) => {
            if (event.key === "Enter") login();
        });
    }
});