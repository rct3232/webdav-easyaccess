# 설치 및 실행 가이드

## 1. 의존성 설치

```bash
npm run install-all
```

*   **참고**: 서버에서 동영상 썸네일 생성을 원할 경우, 시스템에 **FFmpeg**가 설치되어 있어야 합니다.

## 2. 환경 변수 설정

`.env.example` 파일을 복사하여 프로젝트 루트에 `.env` 파일을 생성하세요:

**Windows:**
```cmd
copy .env.example .env
```

**Linux/Mac:**
```bash
cp .env.example .env
```

### 환경 변수 상세 설명

| 변수명 | 필수 여부 | 설명 | 기본값 |
| :--- | :---: | :--- | :--- |
| **WEBDAV_URL** | 필수 | 연결할 WebDAV 서버의 기본 URL (예: `https://dav.example.com`) | - |
| **WEBDAV_USERNAME** | 필수 | WebDAV 서버 접속 계정명 | - |
| **WEBDAV_PASSWORD** | 필수 | WebDAV 서버 접속 비밀번호 | - |
| **JWT_SECRET** | 필수 | 토큰 서명에 사용될 비밀 키 (운영 환경에서 반드시 변경!) | - |
| **PORT** | 선택 | 서버 구동 포트 번호 | `5001` |
| **CORS_ORIGINS** | 선택 | 브라우저 접근을 허용할 Origin 목록 (쉼표로 구분) | `*` (경고 표시) |
| **WEA_STORAGE_BACKEND** | 선택 | 메타데이터 저장 위치 (`webdav` 또는 `fs`) | `webdav` |
| **WEA_FS_DIR** | 선택 | `fs` 백엔드 사용 시 로컬 저장 경로 | OS 임시 폴더 |
| **MAX_THUMBNAIL_SIZE** | 선택 | 생성될 썸네일의 최대 해상도 (픽셀) | `300` |
| **FFMPEG_PATH** | 선택 | FFmpeg 실행 파일의 절대 경로 (자동 감지 실패 시 설정) | `ffmpeg` (PATH) |
| **WEBDAV_AUTH_TYPE** | 선택 | WebDAV 인증 방식 (`auto`, `basic`, `digest`) | `auto` |
| **WEBDAV_UPSTREAM_URL** | 선택 | 리버스 프록시 환경에서 `Destination` 헤더 오류 발생 시 사용 | - |
| **JWT_EXPIRES_IN** | 선택 | 로그인 세션 유지 시간 (예: `30m`, `1h`, `7d`) | `30m` |
| **EMAIL_* ** | 선택 | 가입 승인 알림 등을 위한 SMTP 설정 (HOST, PORT, USER, PASS 등) | - |

## 3. 메타데이터 스토리지 설정

시스템은 사용자 정보 및 권한(ACL)을 별도의 DB 없이 파일로 관리합니다.

1.  **WebDAV 백엔드 (`webdav`)**:
    *   WebDAV 서버의 `/.wea` 폴더에 모든 데이터를 저장합니다.
    *   서버를 여러 대 띄우거나 재설치해도 데이터가 원본 저장소와 함께 유지됩니다.
2.  **파일시스템 백엔드 (`fs`)**:
    *   애플리케이션 서버의 로컬 디스크에 데이터를 저장합니다.
    *   WebDAV 응답 속도가 느린 경우 성능 향상을 위해 권장됩니다.
    *   `WEA_STORAGE_BACKEND=fs`와 `WEA_FS_DIR=/path/to/data`를 설정하세요.

## 4. 실행 방법

### 개발 모드 (클라이언트 + 서버 동시 실행)
```bash
npm run dev
```
*   접속: `http://localhost:3000` (프론트엔드 개발 서버)

### 운영 모드 (프로덕션 빌드 및 실행)
1.  **프론트엔드 빌드**:
    ```bash
    npm run build
    ```
2.  **서버 실행**:
    ```bash
    cd server
    npm start
    ```
*   접속: `http://localhost:5001` (또는 지정한 `PORT`)

## 5. 보안 및 관리자 초기 설정

1.  **기본 관리자 계정**:
    *   최초 실행 시 아이디 `admin`, 비밀번호 `admin` (또는 `.env`의 `ADMIN_DEFAULT_PASSWORD`)으로 계정이 자동 생성됩니다.
    *   **로그인 직후 반드시 관리자 비밀번호를 변경하세요.**
2.  **HTTPS 권장**:
    *   인증 토큰 및 WebDAV 자격 증명이 네트워크를 통해 전송되므로, 운영 환경에서는 반드시 Nginx/Caddy 등을 통해 **HTTPS를 적용**해야 합니다.
3.  **브라우저 세션**:
    *   보안을 위해 인증 토큰은 `sessionStorage`에 저장됩니다. 브라우저 탭이나 창을 닫으면 자동으로 로그아웃됩니다.
