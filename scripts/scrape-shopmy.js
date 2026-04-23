/**
 * scrape-shopmy.js
 * Pulls real products from Reese's ShopMy page using the apiv3 API,
 * then uses Puppeteer to get product images from the rendered page.
 *
 * Run locally: node scripts/scrape-shopmy.js
 */

import puppeteer from "puppeteer";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const productsPath = join(__dirname, "../data/products.json");
const CURATOR_ID = 366029;
const CURATOR_USERNAME = "reesewitherspoon";

// ── Step 1: Try apiv3.shopmy.us API for product list ──────────────────────────
console.log("Trying ShopMy API...");
let apiProducts = [];

try {
  // Try various endpoints to find product list with images
  const endpoints = [
    `https://apiv3.shopmy.us/api/Shop/products?Curator_user_id=${CURATOR_ID}&limit=100`,
    `https://apiv3.shopmy.us/api/Shop/products?Curator_username=${CURATOR_USERNAME}&limit=100`,
    `https://apiv3.shopmy.us/api/Pins?user_id=${CURATOR_ID}&limit=100`,
    `https://apiv3.shopmy.us/api/curators/${CURATOR_USERNAME}/pins?limit=100`,
  ];

  for (const url of endpoints) {
    console.log(`  Trying: ${url}`);
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "application/json",
        "Referer": "https://shopmy.us/",
      },
    });
    if (res.ok) {
      const data = await res.json();
      console.log(`  Response keys: ${Object.keys(data).join(", ")}`);
      // Look for product arrays
      const findProducts = (obj, depth = 0) => {
        if (depth > 3) return [];
        if (Array.isArray(obj) && obj.length > 0) {
          if (obj[0]?.image_url || obj[0]?.imageUrl || obj[0]?.thumbnail) return obj;
        }
        if (typeof obj === "object" && obj !== null) {
          for (const v of Object.values(obj)) {
            const found = findProducts(v, depth + 1);
            if (found.length > 0) return found;
          }
        }
        return [];
      };
      apiProducts = findProducts(data);
      if (apiProducts.length > 0) {
        console.log(`  ✓ Found ${apiProducts.length} products via API`);
        break;
      }
    } else {
      console.log(`  ✗ ${res.status}`);
    }
  }
} catch (e) {
  console.log(`  API failed: ${e.message}`);
}

// ── Step 2: Use Puppeteer to scrape page DOM (always needed for images) ───────
console.log("\nLaunching Puppeteer...");
const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
await page.setUserAgent(
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
);

console.log("Loading shopmy.us/shop/reesewitherspoon...");
await page.goto(`https://shopmy.us/shop/${CURATOR_USERNAME}`, {
  waitUntil: "networkidle2",
  timeout: 60000,
});
await new Promise(r => setTimeout(r, 4000));

// Scroll to load lazy images
console.log("Scrolling to load all products...");
for (let i = 1; i <= 5; i++) {
  await page.evaluate((frac) => window.scrollTo(0, document.body.scrollHeight * frac), i / 5);
  await new Promise(r => setTimeout(r, 1200));
}
await new Promise(r => setTimeout(r, 2000));

// Extract product data from DOM using img.alt (confirmed to have product names)
const domProducts = await page.evaluate(() => {
  const results = [];
  const seen = new Set();

  const imgs = [...document.querySelectorAll("img")];
  for (const img of imgs) {
    const alt = img.alt?.trim();
    const src = img.src || img.getAttribute("data-src") || "";

    // Skip logos, avatars, and non-product images
    if (!alt || !src) continue;
    if (alt === "ShopMy Logo" || alt === "Reese Witherspoon" || alt.includes("logo")) continue;
    if (src.includes("base64") || src.includes("svg") || src.includes("logo")) continue;
    if (!src.includes("shopmy") && !src.includes("static")) continue;
    if (seen.has(src)) continue;
    seen.add(src);

    // Find the affiliate link
    const linkEl = img.closest("a") || img.parentElement?.closest("a");
    const affiliateUrl = linkEl?.href || "";

    // Try to find price near the image
    const card = img.closest("[class*='pin'], [class*='card'], [class*='product'], [class*='Pin']") ||
      img.parentElement?.parentElement;
    const priceEl = card?.querySelector("[class*='price'], [class*='Price'], [class*='cost']");
    const price = priceEl?.textContent?.trim() || "";

    results.push({ name: alt, imageUrl: src, affiliateUrl, priceText: price });
  }
  return results;
});

await browser.close();
console.log(`DOM extracted ${domProducts.length} products with names.`);

// ── Step 3: Merge API and DOM data ────────────────────────────────────────────
let products = domProducts;

if (apiProducts.length > 0) {
  // Merge: use API for metadata, DOM for image URLs
  products = apiProducts.map(api => {
    const name = api.title || api.name || api.product_name || "";
    const dom = domProducts.find(d => d.name.toLowerCase() === name.toLowerCase());
    return {
      name,
      imageUrl: api.image_url || api.imageUrl || dom?.imageUrl || "",
      affiliateUrl: dom?.affiliateUrl || api.url || api.affiliate_url || "",
      priceText: api.price_string || api.price_text || dom?.priceText || "",
      brand: api.brand || api.merchant_name || "",
    };
  });
}

if (products.length === 0) {
  console.log("\n⚠ No products extracted. Exiting.");
  process.exit(1);
}

console.log(`\n${products.length} real ShopMy products found:`);
products.forEach((p, i) => console.log(`  [${i+1}] ${p.name}`));

// ── Step 4: Build categories and editorial copy ───────────────────────────────
const CATEGORY_MAP = {
  fashion: ["bag", "coat", "sweater", "sneaker", "shoe", "dress", "jacket", "pant", "skirt", "top", "cardigan", "lounge", "sock", "jewelry", "necklace", "earring", "bracelet"],
  "cozy home": ["candle", "blanket", "throw", "mug", "kettle", "pillow", "shelf", "lamp", "planner"],
  beauty: ["serum", "mask", "oil", "vitamin", "supplement", "peel", "cream", "lotion", "moisturizer", "lipstick", "blush"],
  stationery: ["journal", "notebook", "pen", "planner", "bookmark", "notepad"],
  snacks: ["chocolate", "tea", "coffee", "snack", "food", "drink", "olive"],
};

function guessCategory(name) {
  const lower = name.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_MAP)) {
    if (keywords.some(k => lower.includes(k))) return cat;
  }
  // Travel items
  if (["suitcase", "carry-on", "backpack", "packing", "luggage", "tote"].some(k => lower.toLowerCase().includes(k))) return "fashion";
  return "fashion";
}

function editorialNote(name, category) {
  const notes = {
    fashion: `A Reese staple — the kind of piece that looks effortless and feels even better than it looks.`,
    "cozy home": `A Reese essential for creating the perfect reading corner. Once you have this, you won't want to read without it.`,
    beauty: `Reese's go-to for her self-care ritual. Clean, effective, and the kind of thing you'll reach for every single day.`,
    stationery: `For capturing the thoughts that come to you between chapters. Beautiful enough to keep out on your desk.`,
    snacks: `Reese's reading snack pick. The perfect thing to have within arm's reach when you're deep in a great book.`,
  };
  return notes[category] || notes.fashion;
}

function whyReeseLovesIt(name) {
  const phrases = [
    "I found this and couldn't stop recommending it. Absolute favorite.",
    "This is the real deal. I use it constantly.",
    "Once you try this, you'll wonder how you lived without it.",
    "My team is obsessed with this too. It's just that good.",
    "I keep coming back to this one. It never disappoints.",
    "Genuinely one of my favorite finds. So good.",
  ];
  const idx = name.length % phrases.length;
  return phrases[idx];
}

// ── Step 5: Write products.json ───────────────────────────────────────────────
const output = products
  .filter(p => p.name && p.imageUrl)
  .map((p, i) => {
    const category = guessCategory(p.name);
    const price = parseFloat((p.priceText || "0").replace(/[^0-9.]/g, "")) || 0;
    const imageColors = ["#E8DDD0","#F0ECE8","#C8B89A","#E8D8C8","#D4AF37","#C8A882","#F5E0A0","#FFD6E0","#E8C8A0","#C8D8E0"];
    return {
      id: `shopmy-${i + 1}`,
      name: p.name,
      brand: p.brand || "",
      category,
      price,
      priceDisplay: p.priceText || (price ? `$${price}` : ""),
      editorialNote: editorialNote(p.name, category),
      whyReeseLovesIt: whyReeseLovesIt(p.name),
      tags: [category, "reese picks", "shopmy"],
      imageUrl: p.imageUrl,
      affiliateUrl: p.affiliateUrl,
      imageColor: imageColors[i % imageColors.length],
    };
  });

writeFileSync(productsPath, JSON.stringify(output, null, 2), "utf8");
console.log(`\n✓ products.json written with ${output.length} real ShopMy products.`);
