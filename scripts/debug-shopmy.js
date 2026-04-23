/**
 * debug-shopmy.js — takes a screenshot and dumps img alt/title/src to inspect
 */
import puppeteer from "puppeteer";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36");

// Capture all JSON API responses
const apiResponses = [];
page.on("response", async (resp) => {
  if ((resp.headers()["content-type"] || "").includes("json")) {
    try {
      const text = await resp.text();
      if (text.length < 500000 && (text.includes("image") || text.includes("pin") || text.includes("product"))) {
        apiResponses.push({ url: resp.url(), body: text.slice(0, 2000) });
      }
    } catch {}
  }
});

console.log("Loading ShopMy...");
await page.goto("https://shopmy.us/shop/reesewitherspoon", { waitUntil: "networkidle2", timeout: 60000 });
await new Promise(r => setTimeout(r, 5000));

// Scroll to load more
for (let i = 1; i <= 3; i++) {
  await page.evaluate((frac) => window.scrollTo(0, document.body.scrollHeight * frac), i / 3);
  await new Promise(r => setTimeout(r, 1500));
}

// Screenshot
await page.screenshot({ path: join(__dirname, "shopmy-debug.png"), fullPage: false });
console.log("Screenshot saved to scripts/shopmy-debug.png");

// Extract all images with context
const imgs = await page.evaluate(() => {
  return [...document.querySelectorAll("img")].map(img => ({
    src: img.src,
    alt: img.alt,
    title: img.title,
    width: img.naturalWidth,
    height: img.naturalHeight,
    parentText: img.closest("a, [class*='pin'], [class*='card']")?.innerText?.trim()?.slice(0, 100) || "",
    parentHref: img.closest("a")?.href || img.closest("[class*='pin']")?.querySelector("a")?.href || "",
  }));
});

const productImgs = imgs.filter(i => i.src.includes("shopmy") || i.src.includes("static") || i.width > 50);
console.log(`\nFound ${productImgs.length} product-sized images:`);
productImgs.slice(0, 20).forEach((img, i) => {
  console.log(`[${i+1}] alt="${img.alt}" | text="${img.parentText.replace(/\n/g,' ').slice(0,60)}" | href=${img.parentHref.slice(0,60)} | ${img.src.slice(0,70)}`);
});

// API responses summary
console.log(`\nCaptured ${apiResponses.length} JSON API responses:`);
apiResponses.slice(0, 5).forEach(r => {
  console.log(`  ${r.url.slice(0,80)}`);
  console.log(`  ${r.body.slice(0, 200)}\n`);
});

await browser.close();
