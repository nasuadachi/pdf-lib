const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const rootDir = path.resolve(__dirname, '../..');
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 8080);
const maxBodyBytes = Number(process.env.MAX_PDF_BYTES || 32 * 1024 * 1024);
const maxEntries = Number(process.env.MAX_PDF_PREVIEWS || 10);
const previews = new Map();

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const send = (res, status, headers, body) => {
  res.writeHead(status, headers);
  res.end(body);
};

const sendJson = (res, status, value) => {
  send(
    res,
    status,
    {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
    JSON.stringify(value),
  );
};

const createId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const trimPreviewCache = () => {
  while (previews.size > maxEntries) {
    const oldestKey = previews.keys().next().value;
    previews.delete(oldestKey);
  }
};

const readRequestBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(new Error('PDF preview body is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

const handlePreviewPost = async (req, res) => {
  try {
    const bytes = await readRequestBody(req);
    const id = createId();
    previews.set(id, bytes);
    trimPreviewCache();
    sendJson(res, 201, { url: `/__pdf_preview/${id}.pdf` });
  } catch (error) {
    sendJson(res, 413, { error: error.message });
  }
};

const handlePreviewGet = (id, req, res) => {
  const bytes = previews.get(id);
  if (!bytes) {
    sendJson(res, 404, { error: 'Preview PDF not found' });
    return;
  }

  res.writeHead(200, {
    'content-type': 'application/pdf',
    'content-length': bytes.length,
    'cache-control': 'no-store',
  });
  res.end(req.method === 'HEAD' ? undefined : bytes);
};

const handlePreviewDelete = (id, res) => {
  previews.delete(id);
  sendJson(res, 200, { ok: true });
};

const safeStaticPath = (pathname) => {
  const decoded = decodeURIComponent(pathname);
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const absolute = path.resolve(rootDir, `.${normalized}`);
  return absolute.startsWith(rootDir) ? absolute : null;
};

const serveStatic = async (req, res, pathname) => {
  const filePath = safeStaticPath(
    pathname === '/' ? '/apps/web/test1.html' : pathname,
  );
  if (!filePath) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    res.writeHead(200, {
      'content-type':
        contentTypes[path.extname(filePath)] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': 'no-store',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    sendJson(res, 404, { error: 'Not found' });
  }
};

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`,
  );
  const previewMatch = requestUrl.pathname.match(
    /^\/__pdf_preview\/([^/]+)\.pdf$/,
  );

  if (req.method === 'POST' && requestUrl.pathname === '/__pdf_preview') {
    await handlePreviewPost(req, res);
    return;
  }

  if (previewMatch && (req.method === 'GET' || req.method === 'HEAD')) {
    handlePreviewGet(previewMatch[1], req, res);
    return;
  }

  if (previewMatch && req.method === 'DELETE') {
    handlePreviewDelete(previewMatch[1], res);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  await serveStatic(req, res, requestUrl.pathname);
});

server.listen(port, host, () => {
  console.log(`Preview server listening on http://${host}:${port}`);
  console.log(`Open http://127.0.0.1:${port}/apps/web/test20.html`);
});
