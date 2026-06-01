import { chromium } from "playwright";

const BASE = "http://localhost:4567";
const API = "http://localhost:3000";

async function test(label, fn) {
  try {
    await fn();
    console.log(`  ✅ ${label}`);
  } catch (e) {
    console.log(`  ❌ ${label}: ${e.message}`);
  }
}

async function main() {
  console.log("Paper Writer E2E Tests\n");

  // ── API tests ──
  console.log("API Tests (port 3000):");

  // 1. Setup should fail (already done)
  await test("POST /auth/setup rejects when already configured", async () => {
    const res = await fetch(`${API}/api/v1/auth/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "test2", password: "test123" }),
    });
    if (res.ok) throw new Error("Should have returned error (already setup)");
  });

  // 2. Register new user
  await test("POST /auth/register creates new user", async () => {
    const res = await fetch(`${API}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "testuser", password: "test123", displayName: "Test User" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? "Register failed");
  });

  // 3. Login as testuser
  let userToken = "";
  await test("POST /auth/login returns tokens for testuser", async () => {
    const res = await fetch(`${API}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "testuser", password: "test123" }),
    });
    const data = await res.json();
    if (!data.accessToken) throw new Error("No access token");
    userToken = data.accessToken;
  });

  // 4. Admin login
  let adminToken = "";
  await test("POST /auth/login returns tokens for admin", async () => {
    const res = await fetch(`${API}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin123" }),
    });
    const data = await res.json();
    if (!data.accessToken) throw new Error("No access token");
    adminToken = data.accessToken;
  });

  // 5. GET /users/me
  await test("GET /users/me returns profile", async () => {
    const res = await fetch(`${API}/api/v1/users/me`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await res.json();
    if (data.username !== "admin") throw new Error("Wrong user");
  });

  // 6. GET /admin/stats
  await test("GET /admin/stats returns dashboard stats", async () => {
    const res = await fetch(`${API}/api/v1/admin/stats`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Expected array");
  });

  // 7. GET /admin/users
  await test("GET /admin/users lists users", async () => {
    const res = await fetch(`${API}/api/v1/admin/users?page=1&limit=10`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await res.json();
    if (!data.users || data.total < 1) throw new Error("Missing users");
    console.log(`     (${data.total} users, page ${data.page})`);
  });

  // 8. Unauthorized access blocked
  await test("GET /admin/stats blocked without token", async () => {
    const res = await fetch(`${API}/api/v1/admin/stats`);
    if (res.ok) throw new Error("Should have returned 401");
  });

  // 9. User cannot access admin
  await test("GET /admin/stats blocked for regular user", async () => {
    const res = await fetch(`${API}/api/v1/admin/stats`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    if (res.ok) throw new Error("Should have returned 403");
  });

  // 10. GET /admin/usage
  await test("GET /admin/usage returns usage trends", async () => {
    const res = await fetch(`${API}/api/v1/admin/usage?days=7`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await res.json();
    if (typeof data.totalTokens !== "number") throw new Error("Missing totalTokens");
  });

  // 11. POST /papers (quota check)
  await test("POST /papers creates new paper", async () => {
    const res = await fetch(`${API}/api/v1/papers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        title: "基于深度学习的自然语言处理研究",
        major: "计算机科学与技术",
        degreeLevel: "master",
        language: "zh",
      }),
    });
    const data = await res.json();
    if (!data.paper && !data.id) throw new Error(JSON.stringify(data).slice(0, 100));
    console.log(`     (paper created)`);
  });

  // 12. GET /papers
  await test("GET /papers lists papers", async () => {
    const res = await fetch(`${API}/api/v1/papers`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await res.json();
    if (!Array.isArray(data.papers)) throw new Error("Missing papers array");
    console.log(`     (${data.papers.length} papers)`);
  });

  // ── Browser tests ──
  console.log("\nBrowser Tests (port 4567):");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // B1. Login page renders
  await test("Login page renders at /", async () => {
    await page.goto(`${BASE}/#/`, { waitUntil: "networkidle" });
    const title = await page.textContent("h1");
    if (!title?.includes("Paper Writer")) throw new Error(`Unexpected title: ${title}`);
  });

  // B2. Login form works
  await test("Login with admin credentials", async () => {
    await page.fill('input[type="text"]', "admin");
    await page.fill('input[type="password"]', "admin123");
    await page.click('button[type="submit"]');

    // Wait for dashboard to load
    await page.waitForSelector("text=首页", { timeout: 10000 });
    const hasSidebar = await page.isVisible("text=首页");
    if (!hasSidebar) throw new Error("Dashboard sidebar not visible");
  });

  // B3. Navigate to admin pages
  await test("Admin button visible for admin user", async () => {
    const adminBtn = await page.isVisible("text=Admin");
    if (!adminBtn) throw new Error("Admin button not found");
  });

  // B4. Access admin dashboard via hash route
  await test("Admin dashboard page renders", async () => {
    await page.goto(`${BASE}/#/admin`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const heading = await page.textContent("h1");
    if (!heading?.includes("Admin Dashboard")) throw new Error(`Unexpected: ${heading}`);
  });

  // B5. User management page
  await test("User management page renders", async () => {
    await page.goto(`${BASE}/#/admin/users`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const heading = await page.textContent("h1");
    if (!heading?.includes("User Management")) throw new Error(`Unexpected: ${heading}`);
  });

  // B6. Usage stats page
  await test("Usage stats page renders", async () => {
    await page.goto(`${BASE}/#/admin/usage`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const heading = await page.textContent("h1");
    if (!heading?.includes("Usage Statistics")) throw new Error(`Unexpected: ${heading}`);
  });

  // B7. Back to dashboard
  await test("Navigate back to dashboard", async () => {
    await page.goto(`${BASE}/#/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const hasHomeBtn = await page.isVisible("text=首页");
    if (!hasHomeBtn) throw new Error("Dashboard not loaded");
  });

  // B8. Logout
  await test("Logout works", async () => {
    // Navigate to dashboard first
    await page.goto(`${BASE}/#/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    // Click logout button (the one with LogOut icon, next to username)
    const logoutBtn = page.getByRole("button").filter({ hasText: "" }).last();
    // Try clicking the last small button in the header
    const allButtons = page.locator("header button");
    const count = await allButtons.count();
    if (count > 0) {
      await allButtons.nth(count - 1).click();
      await page.waitForTimeout(2000);

      // Should be back at login page
      const loginTitle = await page.textContent("h1");
      if (loginTitle?.includes("Paper Writer")) {
        // Success - back at login
        return;
      }
    }
    // Fallback: check if we're still authenticated or got logged out
    const bodyText = await page.textContent("body");
    if (bodyText?.includes("Sign in")) {
      return; // Logged out successfully
    }
    throw new Error(`Logout may not have redirected correctly`);
  });

  await browser.close();
  console.log("\n🎉 All tests completed!");
}

main().catch((e) => {
  console.error("Test harness error:", e.message);
  process.exit(1);
});
