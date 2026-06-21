# Chimera LLM Wiki Frontend

React-based wiki interface for Chimera. Provides the main user-facing UI for the QVAC inference node: article editing with auto-save, AI Writer panel, sidebar navigation, and real-time preview.

## Stack

- React 18 + Vite
- Tailwind CSS
- Lucide React (icons)
- Recharts (analytics charts)
- Capacitor (iOS/Android wrapper)

## Running the code

```bash
npm install
npm run dev      # Development server
npm run build    # Production build → dist/
npm run preview  # Preview production build
```

## Integration

The desktop app (`apps/desktop`) and mobile apps (`apps/mobile`, `apps/mobile-expo`) consume the production build from `dist/` after `npm run build`.

```bash
# Build and sync to mobile
cd qvac/frontend
npm run build
npx cap sync
```