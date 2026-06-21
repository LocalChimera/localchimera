# Chimera Mobile (Expo)

On-device AI-powered wiki app using `@chimera/sdk` with Bare runtime.

## Architecture

- **Frontend**: React web app (shared with desktop) running inside a WebView
- **Backend**: QVAC inference running inside a Bare worker on-device
- **Bridge**: WebView ↔ React Native ↔ Bare worker via IPC
- **Models**: Downloaded on first launch (~500MB for Llama 3.2 1B Q4_0)

## Development

```bash
cd apps/mobile-expo

# Install dependencies
npm install

# Copy frontend build assets
node scripts/copy-frontend.js

# Start Expo development server
npx expo start

# Or run on Android device/emulator
npx expo run:android
```

## Building

```bash
# Generate native Android project
npx expo prebuild --platform android --clean

# Build release APK
cd android
./gradlew assembleRelease
```

## Model Download

The first time AI Write is used, the app downloads the default model
(`LLAMA_3_2_1B_INST_Q4_0`, ~500MB). The download progress is shown in the
loading screen. Models are cached and reused across app restarts.

## Security

- The Bare worker runs in an isolated JavaScript context
- No external network calls except model download (HTTPS to QVAC registry)
- All inference happens locally on-device
