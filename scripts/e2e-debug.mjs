import { chromium } from "playwright";

const BASE = "http://localhost:4567";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  // Collect console errors
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  console.log("1. Loading login page...");
  await page.goto(`${BASE}/#/`, { waitUntil: "networkidle", timeout: 15000 });
  await page.screenshot({ path: "F:/AI/paper-witer/paper-writer/scripts/screenshots/01-login-page.png" });
  console.log("   Screenshot saved: 01-login-page.png");

  console.log("2. Filling login form...");
  await page.fill('input[type="text"]', "admin");
  await page.fill('input[type="password"]', "admin123");
  await page.screenshot({ path: "F:/AI/paper-witer/paper-writer/scripts/screenshots/02-form-filled.png" });

  console.log("3. Submitting login...");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "F:/AI/paper-witer/paper-writer/scripts/screenshots/03-after-login.png" });

  console.log("4. Current URL:", page.url());
  const bodyText = await page.textContent("body").catch(() => "(error)");
  console.log("   Body snippet:", bodyText?.slice(0, 300));

  if (consoleErrors.length > 0) {
    console.log("\nConsole errors:");
    consoleErrors.forEach((e) => console.log("  -", e));
  }

  // Check network
  console.log("\n5. Testing direct API call from page context:");
  const apiResult = await page.evaluate(async () => {
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "admin123" }),
      });
      const data = await res.json();
      return { ok: res.ok, status: res.status, hasToken: !!data.accessToken };
    } catch (e) {
      return { error: e.message };
    }
  });
  console.log("   API result:", JSON.stringify(apiResult));

  await browser.close();
  console.log("\nDone. Check screenshots/ folder.");
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
