import { chromium } from "playwright";

const STUDIO = "http://localhost:4567";
const ADMIN = "http://localhost:5173";
const API = "http://localhost:3000";

async function test(label, fn) {
  try { await fn(); console.log(`  ✅ ${label}`); }
  catch (e) { console.log(`  ❌ ${label}: ${e.message}`); }
}

async function main() {
  console.log("Post-Separation E2E Tests\n");

  // ── API Tests ──
  console.log("API Tests:");

  // Login as admin
  let adminToken = "";
  await test("Admin login", async () => {
    const res = await fetch(`${API}/api/v1/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin123" }),
    });
    const data = await res.json();
    if (!data.accessToken) throw new Error("No token");
    adminToken = data.accessToken;
  });

  // Login as regular user
  let userToken = "";
  await test("User login", async () => {
    const res = await fetch(`${API}/api/v1/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "testuser", password: "test123" }),
    });
    const data = await res.json();
    if (!data.accessToken) throw new Error("No token");
    userToken = data.accessToken;
  });

  // Admin access
  await test("Admin can access /admin/stats", async () => {
    const res = await fetch(`${API}/api/v1/admin/stats`, { headers: { Authorization: `Bearer ${adminToken}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  });

  // User cannot access admin
  await test("Regular user blocked from /admin/stats", async () => {
    const res = await fetch(`${API}/api/v1/admin/stats`, { headers: { Authorization: `Bearer ${userToken}` } });
    if (res.ok) throw new Error("Should have returned 403");
  });

  // ── Browser: Admin Panel (:5173) ──
  console.log("\nAdmin Panel Tests (port 5173):");

  const browser = await chromium.launch({ headless: true });

  // Admin Panel
  const adminCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();

  await test("Admin Panel: Login page renders", async () => {
    await adminPage.goto(ADMIN, { waitUntil: "networkidle" });
    const title = await adminPage.textContent("h1");
    if (!title?.includes("Paper Writer")) throw new Error("Login page not shown");
  });

  await test("Admin Panel: Login with admin", async () => {
    await adminPage.fill('input[type="text"]', "admin");
    await adminPage.fill('input[type="password"]', "admin123");
    await adminPage.click('button[type="submit"]');
    await adminPage.waitForTimeout(2000);
    const hasDashboard = await adminPage.isVisible("text=Dashboard");
    if (!hasDashboard) throw new Error("Dashboard not visible after login");
  });

  await test("Admin Panel: Dashboard shows stats", async () => {
    await adminPage.goto(ADMIN, { waitUntil: "networkidle" });
    await adminPage.waitForTimeout(2000);
    const hasUsers = await adminPage.isVisible("text=Total Users");
    if (!hasUsers) throw new Error("Stats not loaded");
  });

  await test("Admin Panel: Navigate to Users", async () => {
    await adminPage.click("text=Users");
    await adminPage.waitForTimeout(1500);
    const hasTable = await adminPage.isVisible("table");
    if (!hasTable) throw new Error("User table not shown");
  });

  await test("Admin Panel: Navigate to Usage", async () => {
    await adminPage.click("text=Usage");
    await adminPage.waitForTimeout(1500);
    const hasStats = await adminPage.isVisible("text=Total API Calls");
    if (!hasStats) throw new Error("Usage stats not shown");
  });

  await adminCtx.close();

  // ── Browser: Studio (:4567) ──
  console.log("\nStudio Tests (port 4567):");

  const studioCtx = await browser.newContext();
  const studioPage = await studioCtx.newPage();

  await test("Studio: Login page renders", async () => {
    await studioPage.goto(`${STUDIO}/#/`, { waitUntil: "networkidle" });
    const title = await studioPage.textContent("h1");
    if (!title?.includes("Paper Writer")) throw new Error("Login page not shown");
  });

  await test("Studio: No Admin button on login page", async () => {
    const hasAdmin = await studioPage.isVisible("text=Admin");
    if (hasAdmin) throw new Error("Admin button should not exist on login page");
  });

  await test("Studio: Login as admin", async () => {
    await studioPage.fill('input[type="text"]', "admin");
    await studioPage.fill('input[type="password"]', "admin123");
    await studioPage.click('button[type="submit"]');
    await studioPage.waitForTimeout(3000);

    // After login, should load the dashboard (may show spinner first)
    const body = await studioPage.textContent("body");
    if (body?.includes("Sign in")) throw new Error("Still on login page after login");
  });

  await test("Studio: No Admin button in header after login", async () => {
    await studioPage.goto(`${STUDIO}/#/`, { waitUntil: "networkidle" });
    await studioPage.waitForTimeout(2000);
    const hasAdminBtn = await studioPage.isVisible("text=Admin");
    if (hasAdminBtn) throw new Error("Admin button should NOT be visible in Studio");
  });

  await studioCtx.close();
  await browser.close();

  console.log("\n🎉 All separation tests completed!");
}

main().catch((e) => { console.error(e.message); process.exit(1); });
