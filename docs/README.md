# docs/

Documentation for developers and contributors.

## Files

- **UPSTREAM.md** — Catalog of all upstream projects (QVAC SDK, Pear, Tauri, Capacitor, LLMwiki, Openviking, OtterWiki). Includes update instructions and version tracking.

## Keeping Up to Date

```bash
# Check all packages for outdated dependencies
./scripts/update-upstream.sh check

# Update to latest compatible versions
./scripts/update-upstream.sh update
```

A GitHub Action also runs weekly to open an issue when upstream updates are available.
