/**
 * fetch-covers.js
 * Queries Open Library for each book in books.json and adds a coverUrl field.
 * Run once locally: node scripts/fetch-covers.js
 * Fictional titles (no match in Open Library) keep their coverColor fallback.
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const booksPath = join(__dirname, "../data/books.json");
const books = JSON.parse(readFileSync(booksPath, "utf8"));

async function fetchCoverId(title, author) {
  const q = `title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}&fields=cover_i&limit=1`;
  const url = `https://openlibrary.org/search.json?${q}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const coverId = data?.docs?.[0]?.cover_i;
    return coverId ?? null;
  } catch {
    return null;
  }
}

let found = 0;
let notFound = 0;

for (const book of books) {
  process.stdout.write(`  Fetching cover: "${book.title}" by ${book.author} ... `);
  const coverId = await fetchCoverId(book.title, book.author);
  if (coverId) {
    book.coverUrl = `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
    console.log(`✓ id=${coverId}`);
    found++;
  } else {
    delete book.coverUrl;
    console.log(`✗ not found (using color block)`);
    notFound++;
  }
  // Small delay to be polite to Open Library's servers
  await new Promise(r => setTimeout(r, 300));
}

writeFileSync(booksPath, JSON.stringify(books, null, 2), "utf8");
console.log(`\nDone. ${found} covers found, ${notFound} will use color fallback.`);
console.log(`books.json updated.`);
