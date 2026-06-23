const http = require('http');
const https = require('https');

const TARGET = 'node.testnet.casper.network';
const PORT = 7778;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const proxyReq = https.request({
      hostname: TARGET,
      port: 443,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: TARGET,
      },
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (err) => {
      console.error('Proxy error:', err.message);
      res.writeHead(502);
      res.end('Bad Gateway: ' + err.message);
    });
    proxyReq.write(body);
    proxyReq.end();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`CORS proxy running on http://localhost:${PORT} → https://${TARGET}`);
});
