const { createProxyMiddleware } = require('http-proxy-middleware');
const fs = require('fs');
const path = require('path');

// 루트 디렉토리의 .env 파일 읽기
const envPath = path.join(__dirname, '../../.env');
let PORT = 5001; // 기본값

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const portMatch = envContent.match(/^PORT\s*=\s*(\d+)/m);
  if (portMatch) {
    PORT = portMatch[1];
  }
}

const proxyTarget = `http://localhost:${PORT}`;

module.exports = function(app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: proxyTarget,
      changeOrigin: true,
    })
  );
};

