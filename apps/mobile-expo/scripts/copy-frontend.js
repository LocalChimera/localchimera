const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../../../qvac/frontend/dist');
const destDir = path.join(__dirname, '../assets/frontend');
const androidAssetsDir = path.join(__dirname, '../android/app/src/main/assets');

function copyRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

if (!fs.existsSync(srcDir)) {
  console.error('Frontend build directory not found:', srcDir);
  console.error('Run: cd qvac/frontend && npm run build');
  process.exit(1);
}

// Copy to Expo assets
copyRecursive(srcDir, destDir);
console.log('Frontend assets copied to:', destDir);

// Copy to Android native assets directory (create if missing).
// This is required for the files to be included in the APK as raw assets.
copyRecursive(srcDir, androidAssetsDir);
console.log('Frontend assets copied to Android assets:', androidAssetsDir);
