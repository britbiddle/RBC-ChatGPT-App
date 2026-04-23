# Reese's Book Club — ChatGPT MCP App

A real, deployable ChatGPT MCP App for Reese's Book Club. AI-powered book and product recommendations in Reese's voice, with a custom RBC-branded iframe UI.

## Tools

| Tool | Description |
|------|-------------|
| `get_current_pick` | Returns April 2026's monthly pick with Reese's note |
| `recommend_book` | Filters 20+ RBC picks by genre, mood, or theme |
| `search_books` | Full-text search across the catalog |
| `get_book_details` | Full details for a specific RBC book |
| `recommend_products` | 25+ curated lifestyle products by category/occasion |

## Quick Start

```bash
npm install
node server.js
```

Server runs on `http://localhost:8787`

- Health: `http://localhost:8787/health`
- Widget preview: `http://localhost:8787/widget`
- MCP endpoint: `http://localhost:8787/mcp`

## Testing in ChatGPT Developer Mode

1. Install ngrok: `brew install ngrok`
2. Start server: `node server.js`
3. Expose publicly: `ngrok http 8787`
4. In ChatGPT: Settings → Beta features → Enable Developer Mode
5. Create a connector with your ngrok URL + `/mcp`
6. Add to a conversation and test:
   - *"What is Reese reading this month?"*
   - *"Recommend me a summer romance"*
   - *"What do I need for the perfect reading nook?"*
   - *"Tell me about The Women by Kristin Hannah"*

## Validate with MCP Inspector

```bash
npx @modelcontextprotocol/inspector@latest --server-url http://localhost:8787/mcp --transport http
```
