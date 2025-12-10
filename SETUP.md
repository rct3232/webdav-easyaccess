# 설치 및 실행 가이드

## 1. 의존성 설치

```bash
npm run install-all
```

## 2. 환경 변수 설정

`.env.example` 파일을 복사하여 `.env` 파일을 생성하세요:

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
PORT=5000
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

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
# FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe
# WEBDAV_AUTH_TYPE=auto
# WEBDAV_UPSTREAM_URL=http://your-upstream-host:port
```

**참고:**
- 데이터베이스와 썸네일은 자동으로 `data/` 디렉토리에 저장됩니다.
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

운영 환경에서 실행하는 방법은 [운영 환경 가이드](#운영-환경-실행)를 참조하세요.

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
   `http://localhost:5000`

자세한 내용은 [README.md](README.md)의 운영 환경 섹션을 참조하세요.