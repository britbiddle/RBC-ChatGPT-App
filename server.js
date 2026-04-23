import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { createServer } from "http";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;
const WIDGET_URI = "ui://rbc/widget.html";

// ── Load data ────────────────────────────────────────────────────────────────
const books = JSON.parse(readFileSync(join(__dirname, "data/books.json"), "utf8"));
const products = JSON.parse(readFileSync(join(__dirname, "data/products.json"), "utf8"));
const widgetHtml = readFileSync(join(__dirname, "public/widget.html"), "utf8");

// ── Helper: simple relevance scoring ────────────────────────────────────────
function scoreBook(book, { genres = [], mood = "", theme = "" }) {
  let score = 0;
  const haystack = [
    ...book.genres,
    ...book.themes,
    book.title,
    book.author,
    book.description,
    book.reeseNote,
  ]
    .join(" ")
    .toLowerCase();

  genres.forEach((g) => { if (haystack.includes(g.toLowerCase())) score += 3; });
  if (mood) mood.toLowerCase().split(/\s+/).forEach((w) => { if (haystack.includes(w)) score += 1; });
  if (theme) theme.toLowerCase().split(/\s+/).forEach((w) => { if (haystack.includes(w)) score += 2; });
  return score;
}

function scoreProduct(product, { categories = [], occasion = "", budget = "" }) {
  let score = 0;
  const haystack = [product.category, ...product.tags, product.name, product.brand, product.editorialNote]
    .join(" ")
    .toLowerCase();

  categories.forEach((c) => { if (haystack.includes(c.toLowerCase())) score += 3; });
  if (occasion) occasion.toLowerCase().split(/\s+/).forEach((w) => { if (haystack.includes(w)) score += 2; });
  if (budget === "under $25" && product.price <= 25) score += 2;
  if (budget === "under $50" && product.price <= 50) score += 1;
  return score;
}

function formatBook(book) {
  return {
    title: book.title,
    author: book.author,
    month: book.month,
    genres: book.genres,
    themes: book.themes,
    description: book.description,
    reeseNote: book.reeseNote,
    coverColor: book.coverColor,
    buyLink: book.buyLinks.hardcover,
  };
}

function formatProduct(p) {
  return {
    name: p.name,
    brand: p.brand,
    category: p.category,
    price: p.priceDisplay,
    editorialNote: p.editorialNote,
    whyReeseLovesIt: p.whyReeseLovesIt,
    tags: p.tags,
    url: p.affiliateUrl,
    imageColor: p.imageColor,
  };
}

// ── Create MCP server ────────────────────────────────────────────────────────
function createRBCServer() {
  const server = new McpServer({
    name: "reeses-book-club",
    version: "1.0.0",
  });

  // ── App resource: the iframe UI ──────────────────────────────────────────
  registerAppResource(
    server,
    "RBC Widget",
    WIDGET_URI,
    {
      title: "Reese's Book Club",
      description: "Interactive book and product recommendation cards styled in Reese's Book Club brand",
    },
    async () => ({
      contents: [
        {
          uri: WIDGET_URI,
          mimeType: "text/html;profile=mcp-app",
          text: widgetHtml,
        },
      ],
    })
  );

  // ── Tool: get_current_pick ───────────────────────────────────────────────
  registerAppTool(
    server,
    "get_current_pick",
    {
      title: "Get Current Pick",
      description:
        "Get Reese's current monthly book pick — April 2026 is 'Into The Blue' by Emma Brodie. Call this when someone asks what Reese is reading, what this month's pick is, or asks about the current RBC selection.",
      inputSchema: z.object({}),
      _meta: { ui: { resourceUri: WIDGET_URI } },
    },
    async () => {
      const current = books[0];
      return {
        content: [
          {
            type: "text",
            text: `${current.month}'s Pick: "${current.title}" by ${current.author}`,
          },
        ],
        structuredContent: {
          type: "current_pick",
          book: formatBook(current),
          monthLabel: `${current.month}'s Pick`,
          featured: true,
        },
      };
    }
  );

  // ── Tool: recommend_book ─────────────────────────────────────────────────
  registerAppTool(
    server,
    "recommend_book",
    {
      title: "Recommend a Book",
      description:
        "Recommend books from the Reese's Book Club catalog based on genres, mood, or themes. Use when someone asks for their next read, what to read after a book they loved, or wants genre/mood-based picks.",
      inputSchema: z.object({
        genres: z
          .array(z.string())
          .optional()
          .describe('Genres e.g. ["Romance", "Thriller", "Literary Fiction", "Historical Fiction"]'),
        mood: z
          .string()
          .optional()
          .describe('Mood or vibe e.g. "cozy and emotional", "fast-paced and gripping"'),
        theme: z
          .string()
          .optional()
          .describe('Theme or topic e.g. "female friendship", "summer", "WWII"'),
        count: z
          .number()
          .int()
          .min(1)
          .max(6)
          .optional()
          .default(3)
          .describe("Number of recommendations (default 3)"),
      }),
      _meta: { ui: { resourceUri: WIDGET_URI } },
    },
    async ({ genres = [], mood = "", theme = "", count = 3 }) => {
      const limit = Math.min(count, 6);
      const hasFilters = genres.length > 0 || mood || theme;

      const results = hasFilters
        ? books
            .map((book) => ({ book, score: scoreBook(book, { genres, mood, theme }) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map((r) => r.book)
        : books.slice(0, limit);

      const filterSummary = [
        genres.length ? `genres: ${genres.join(", ")}` : null,
        mood ? `mood: ${mood}` : null,
        theme ? `theme: ${theme}` : null,
      ]
        .filter(Boolean)
        .join(" · ");

      return {
        content: [
          {
            type: "text",
            text: results
              .map((b) => `"${b.title}" by ${b.author} (${b.genres.join(", ")})`)
              .join("\n"),
          },
        ],
        structuredContent: {
          type: "book_recommendations",
          books: results.map(formatBook),
          filterSummary,
        },
      };
    }
  );

  // ── Tool: search_books ───────────────────────────────────────────────────
  registerAppTool(
    server,
    "search_books",
    {
      title: "Search Books",
      description:
        "Search all Reese's Book Club picks by title, author, keyword, or description. Use when someone mentions a specific book or wants to find RBC picks matching a specific word or phrase.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Search term — title, author name, keyword, or phrase"),
      }),
      _meta: { ui: { resourceUri: WIDGET_URI } },
    },
    async ({ query }) => {
      const q = query.toLowerCase();
      const results = books
        .filter((book) =>
          [book.title, book.author, book.description, book.reeseNote, ...book.genres, ...book.themes]
            .join(" ")
            .toLowerCase()
            .includes(q)
        )
        .slice(0, 5);

      return {
        content: [
          {
            type: "text",
            text: results.length
              ? results.map((b) => `"${b.title}" by ${b.author}`).join("\n")
              : `No RBC books found for "${query}"`,
          },
        ],
        structuredContent: {
          type: "search_results",
          query,
          count: results.length,
          books: results.map(formatBook),
        },
      };
    }
  );

  // ── Tool: get_book_details ───────────────────────────────────────────────
  registerAppTool(
    server,
    "get_book_details",
    {
      title: "Book Details",
      description:
        "Get full details for a specific Reese's Book Club book by title, including Reese's personal note and where to buy.",
      inputSchema: z.object({
        title: z.string().min(1).describe("Book title to look up"),
      }),
      _meta: { ui: { resourceUri: WIDGET_URI } },
    },
    async ({ title }) => {
      const book = books.find((b) => b.title.toLowerCase().includes(title.toLowerCase()));

      if (!book) {
        return {
          content: [
            {
              type: "text",
              text: `"${title}" isn't in the RBC catalog. Try recommending books by genre instead!`,
            },
          ],
          structuredContent: {
            type: "not_found",
            message: `"${title}" isn't in the Reese's Book Club catalog. Ask for recommendations by genre or mood!`,
          },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `"${book.title}" by ${book.author} — ${book.description}`,
          },
        ],
        structuredContent: {
          type: "book_detail",
          book: formatBook(book),
        },
      };
    }
  );

  // ── Tool: recommend_products ─────────────────────────────────────────────
  registerAppTool(
    server,
    "recommend_products",
    {
      title: "Recommend Products",
      description:
        "Recommend curated lifestyle products in Reese's voice — things she actually loves. Use when someone asks about reading nook essentials, gifts for book lovers, self-care, home goods, beauty, snacks, or fashion.",
      inputSchema: z.object({
        categories: z
          .array(z.enum(["cozy home", "beauty", "stationery", "snacks", "fashion"]))
          .optional()
          .describe("Product categories to include"),
        occasion: z
          .string()
          .optional()
          .describe('Use case e.g. "reading nook setup", "gift for a book lover", "self care night"'),
        budget: z
          .enum(["under $25", "under $50", "any"])
          .optional()
          .default("any")
          .describe("Budget range"),
        count: z
          .number()
          .int()
          .min(1)
          .max(8)
          .optional()
          .default(4)
          .describe("Number of products (default 4)"),
      }),
      _meta: { ui: { resourceUri: WIDGET_URI } },
    },
    async ({ categories = [], occasion = "", budget = "any", count = 4 }) => {
      const limit = Math.min(count, 8);
      const hasFilters = categories.length > 0 || occasion || budget !== "any";

      const results = hasFilters
        ? products
            .map((p) => ({ p, score: scoreProduct(p, { categories, occasion, budget }) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map((r) => r.p)
        : products.slice(0, limit);

      return {
        content: [
          {
            type: "text",
            text: results
              .map((p) => `${p.name} by ${p.brand} — ${p.priceDisplay}`)
              .join("\n"),
          },
        ],
        structuredContent: {
          type: "product_recommendations",
          products: results.map(formatProduct),
          occasion: occasion || null,
          budget: budget !== "any" ? budget : null,
        },
      };
    }
  );

  return server;
}

// ── HTTP server ──────────────────────────────────────────────────────────────
const httpServer = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, mcp-session-id");
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/widget") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(widgetHtml);
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", app: "Reese's Book Club AI", books: books.length, products: products.length }));
    return;
  }

  if (req.url === "/mcp") {
    const server = createRBCServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

httpServer.listen(PORT, () => {
  console.log(`\n📚 Reese's Book Club AI — MCP Server`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🟢 Running at:    http://localhost:${PORT}`);
  console.log(`🔌 MCP endpoint:  http://localhost:${PORT}/mcp`);
  console.log(`🎨 Widget preview: http://localhost:${PORT}/widget`);
  console.log(`❤️  Health check:  http://localhost:${PORT}/health`);
  console.log(`\n📖 Books in catalog:    ${books.length}`);
  console.log(`🛍️  Products in catalog: ${products.length}`);
  console.log(`\nTo test in ChatGPT developer mode:`);
  console.log(`  1. ngrok http ${PORT}`);
  console.log(`  2. ChatGPT Settings → Developer mode → Create connector`);
  console.log(`  3. Add <ngrok-url>/mcp as the connector URL\n`);
});
