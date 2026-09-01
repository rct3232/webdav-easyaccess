const fs = require('fs');
const path = require('path');

// 루트 디렉토리의 .env 파일 읽기
const envPath = path.join(__dirname, '../.env');
let PORT = 5000; // 기본값

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const portMatch = envContent.match(/^PORT\s*=\s*(\d+)/m);
  if (portMatch) {
    PORT = portMatch[1];
  }
}
const clientPackageJsonPath = path.join(__dirname, '../client/package.json');
const packageJson = JSON.parse(fs.readFileSync(clientPackageJsonPath, 'utf8'));

// proxy 설정 업데이트
packageJson.proxy = `http://localhost:${PORT}`;

fs.writeFileSync(clientPackageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
console.log(`Updated client proxy to http://localhost:${PORT}`);
