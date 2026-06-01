import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  console.log("1. Load login page...");
  await page.goto("http://localhost:4567/#/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  console.log("   Current URL:", page.url());

  // Check page HTML
  const html = await page.content();
  console.log("   Page has h1:", html.includes("<h1"));
  console.log("   Page has input:", html.includes("<input"));

  // Try direct login via page.evaluate (bypass the form)
  console.log("\n2. Login via direct API call from page context...");
  const loginResult = await page.evaluate(async () => {
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "admin123" }),
      });
      const data = await res.json();
      if (data.accessToken) {
        localStorage.setItem("paper_writer_auth", JSON.stringify({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          user: data.user,
        }));
      }
      return { ok: res.ok, hasToken: !!data.accessToken };
    } catch (e) {
      return { error: e.message };
    }
  });
  console.log("   Login result:", JSON.stringify(loginResult));

  // Check localStorage was set
  const storageData = await page.evaluate(() => {
    return localStorage.getItem("paper_writer_auth");
  });
  console.log("   LocalStorage has auth:", !!storageData);

  // Now reload the page - it should pick up the stored token and skip login
  console.log("\n3. Reload page (should auto-login from localStorage)...");
  await page.goto("http://localhost:4567/#/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  console.log("   Current URL:", page.url());
  const html2 = await page.content();
  console.log("   Body length:", html2.length);
  console.log("   Has '首页':", html2.includes("首页"));
  console.log("   Has 'Admin':", html2.includes("Admin"));
  console.log("   Has 'Paper Writer':", html2.includes("Paper Writer"));
  console.log("   Has 'Sign in':", html2.includes("Sign in"));

  // Check if we're on login page or dashboard
  const maybeTitle = html2.match(/<h1[^>]*>(.*?)<\/h1>/);
  console.log("   H1 text:", maybeTitle?.[1] ?? "(none)");

  if (errors.length > 0) {
    console.log("\n   Console errors:");
    errors.forEach((e) => console.log("   -", e.slice(0, 200)));
  }

  // Navigate to admin
  console.log("\n4. Navigate to admin dashboard...");
  await page.goto("http://localhost:4567/#/admin", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const adminHtml = await page.content();
  console.log("   Has 'Admin Dashboard':", adminHtml.includes("Admin Dashboard"));
  console.log("   Has 'Total Users':", adminHtml.includes("Total Users"));

  await page.screenshot({ path: "F:/AI/paper-witer/paper-writer/scripts/screenshots/debug-final.png" });

  await browser.close();
  console.log("\nDone.");
}

main().catch((e) => { console.error(e.message); process.exit(1); });
