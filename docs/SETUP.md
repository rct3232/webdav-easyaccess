# 설치 및 실행 가이드

## 1. 의존성 설치

```bash
npm run install-all
```

## 2. 환경 변수 설정

`.env.example` 파일을 복사하여 루트에 `.env` 파일을 생성하세요:

**Windows:**

```cmd
copy .env.example .env
```

**Linux/Mac:**

```bash
cp .env.example .env
```

그 다음 `.env` 파일을 열어서 실제 값으로 수정하세요:

```env
# WebDAV Configuration (required)
WEBDAV_URL=https://your-webdav-server.com
WEBDAV_USERNAME=your-username
WEBDAV_PASSWORD=your-password

# Server Configuration (required)
PORT=5001
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
# Auth token expiry (default: 30m)
JWT_EXPIRES_IN=30m

# Email Configuration (optional - for user notifications)
# EMAIL_HOST=smtp.gmail.com
# EMAIL_PORT=587
# EMAIL_SECURE=false
# EMAIL_USER=your-email@gmail.com
# EMAIL_PASSWORD=your-app-password
# EMAIL_FROM_NAME=WebDAV EasyAccess

# Optional Configuration
# MAX_THUMBNAIL_SIZE=300
# ADMIN_DEFAULT_PASSWORD=admin
# WEA_DISABLE_DEFAULT_ADMIN=true
# WEA_STORAGE_BACKEND=webdav
# WEA_FS_DIR=./.wea-local

# CORS (recommended in production; comma-separated)
# CORS_ORIGINS=https://your-domain.com,https://admin.your-domain.com
# Login rate limit (best-effort, in-memory)
# LOGIN_RATE_LIMIT_WINDOW_MS=900000
# LOGIN_RATE_LIMIT_MAX=20
# FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe
# WEBDAV_AUTH_TYPE=auto
# WEBDAV_UPSTREAM_URL=http://your-upstream-host:port
```

## 보안 참고(중요)

- **브라우저 종료 시 로그아웃**: 현재 클라이언트는 인증 토큰을 `sessionStorage`에 저장하므로, 브라우저(탭/창) 종료 시 자동으로 로그아웃됩니다.
- **HTTPS 권장/강제**: 운영 환경에서 HTTPS가 보장되지 않으면, 네트워크 구간에서 토큰/자격증명이 탈취될 수 있습니다. 가능한 한 **리버스 프록시(Nginx/Caddy 등)로 HTTPS를 강제**하세요.
- **JWT_SECRET 필수**: 운영에서는 반드시 `JWT_SECRET`을 설정해야 하며, 기본값을 사용하면 서버가 시작되지 않습니다.

### 참고(저장 위치)

- **메타데이터(사용자/권한/설정)**는 기본적으로 WebDAV의 `/.wea/` 아래에 JSON으로 저장됩니다.
  - 테스트/옵션으로 로컬 파일시스템 저장을 원하면 `WEA_STORAGE_BACKEND=fs` 와 `WEA_FS_DIR`(또는 `WEA_METADATA_DIR`)를 설정하세요.
- **썸네일**은 서버의 **메모리 캐시**에 저장되며, 서버 재시작 시 재생성됩니다.
  - 영상 썸네일 생성 과정에서 임시 파일을 `data/temp` 아래에 생성할 수 있습니다.
- FFmpeg는 자동으로 감지되며, 찾을 수 없는 경우에만 `FFMPEG_PATH`를 설정하세요.
- `WEBDAV_AUTH_TYPE`은 인증 방식을 명시적으로 지정할 때만 사용합니다 (auto/basic/digest).
- `WEBDAV_UPSTREAM_URL`은 프록시 앞단에서 MOVE/COPY가 502 등을 반환할 때 설정하세요.

## 3. 서버 실행

### 개발 모드 (백엔드 + 프론트엔드 동시 실행)

```bash
npm run dev
```

### 개별 실행

**백엔드만:**

```bash
npm run server
```

**프론트엔드만:**

```bash
npm run client
```

## 4. 접속

브라우저에서 `http://localhost:3000`으로 접속하세요.

## 5. 기본 Admin 계정

프로젝트를 처음 실행하면 자동으로 기본 admin 계정이 생성됩니다:

- **사용자명**: `admin`
- **비밀번호**: `admin` (또는 `.env` 파일의 `ADMIN_DEFAULT_PASSWORD` 값)
- **권한**: 루트 폴더(`/`)에 대한 관리자 권한

⚠️ **보안**: 프로덕션 환경에서는 반드시 첫 로그인 후 비밀번호를 변경하세요!

## 운영 환경 실행

### 운영 환경 실행

1. **프론트엔드 빌드**

   ```bash
   npm run build
   ```

2. **서버 실행**

   ```bash
   cd server
   npm start
   ```

3. **접속**

   `http://localhost:5001` (또는 `.env`의 `PORT`)

자세한 내용은 [README.md](../README.md)의 운영 환경 섹션을 참조하세요.

