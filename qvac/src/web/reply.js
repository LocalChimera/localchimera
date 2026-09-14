/**
 * Thin response helpers — eliminate repeated res.writeHead boilerplate.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function ok(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
  res.end(JSON.stringify({ success: true, data }));
}

export function accepted(res, data) {
  res.writeHead(202, { 'Content-Type': 'application/json', ...CORS });
  res.end(JSON.stringify({ success: true, data }));
}

export function badRequest(res, error) {
  res.writeHead(400, { 'Content-Type': 'application/json', ...CORS });
  res.end(JSON.stringify({ success: false, error }));
}

export function serverError(res, error) {
  res.writeHead(500, { 'Content-Type': 'application/json', ...CORS });
  res.end(JSON.stringify({ success: false, error: error?.message || error }));
}

export function serviceUnavailable(res, error) {
  res.writeHead(503, { 'Content-Type': 'application/json', ...CORS });
  res.end(JSON.stringify({ success: false, error }));
}

export function parseBody(req) {
  if (req.body !== undefined) return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
