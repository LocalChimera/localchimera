# website/

Static marketing site for Chimera. Deployed to Cloudflare Pages at https://localchimera.com

## Files

- **index.html** — Landing page with features, download links, and navigation
- **demo-wiki.html** — Read-only interactive demo of the LLM Wiki layout. Shows the full app UI (sidebar, editor, preview, AI Writer panel) without editing capability
- **earnings.html** — Earnings dashboard where developers and miners enter their EVM address to view payout history
- **chimeralogo.png** — Logo with background (for favicon)
- **chimeralogo-header.png** — Logo without background (for header)
- **banner2.png** — Hero banner image

## Local development

```bash
python3 -m http.server 8080
# Open http://localhost:8080
```
