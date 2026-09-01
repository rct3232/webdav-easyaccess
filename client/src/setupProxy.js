const { createProxyMiddleware } = require('http-proxy-middleware');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../../.env');
let port = process.env.REACT_APP_API_PORT || process.env.API_PORT || '5001';

if (!process.env.REACT_APP_API_PORT && !process.env.API_PORT && fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const portMatch = envContent.match(/^PORT\s*=\s*(\d+)/m);
  if (portMatch) {
    port = portMatch[1];
  }
}

const proxyTarget = `http://localhost:${port}`;

module.exports = function (app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: proxyTarget,
      changeOrigin: true,
    })
  );
};
