const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '../../../qvac/frontend/dist/index.html');
const dest = path.join(__dirname, '../frontend-html.js');

if (!fs.existsSync(src)) {
  console.error('Built frontend not found:', src);
  console.error('Run: cd qvac/frontend && npm run build');
  process.exit(1);
}

const html = fs.readFileSync(src, 'utf-8');
// Fix inline scripts for Android WebView: remove crossorigin and change type="module" to text/javascript
// Also strip external resource references (manifest, service worker) that break in WebView context
const patched = html
  .replace(/<script type="module" crossorigin>/g, '<script type="text/javascript">')
  .replace(/<script type="module" crossorigin="/g, '<script type="text/javascript" crossorigin="')
  .replace(/<script type="module">/g, '<script type="text/javascript">')
  .replace(/<link rel="manifest"[^>]*>/g, '')
  .replace(/<script>\s*if\s*\('serviceWorker'\s*in\s*navigator\)[\s\S]*?<\/script>/g, '');
const escaped = JSON.stringify(patched);
const htmlModule = `// Auto-generated from qvac/frontend/dist/index.html. Do not edit manually.
export default ${escaped};
`;
fs.writeFileSync(dest, htmlModule);
console.log('Frontend HTML inlined into:', dest, `(${html.length} chars)`);
