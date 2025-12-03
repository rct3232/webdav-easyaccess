# WebDAV EasyAccess

WebDAV 파일 관리 웹 서비스입니다.

## 주요 기능

- ✅ .env 파일을 통한 WebDAV 자동 접속
- ✅ 서비스 자체 계정 생성/관리 (WebDAV 계정과 별개)
- ✅ 폴더별 접근 권한 관리
- ✅ 파일 업로드/다운로드/이름변경/삭제/이동/복사
- ✅ 간단 리스트 보기, 상세 리스트 보기, 그리드(갤러리) 보기
- ✅ 이미지/동영상 썸네일 표시

## 기술 스택

- **Backend**: Express.js, Node.js
- **Frontend**: React, Material-UI
- **Database**: SQLite
- **WebDAV Client**: webdav library
- **Image Processing**: Sharp

## 설치 및 실행

### 1. 의존성 설치

```bash
npm run install-all
```

### 2. 환경 변수 설정

`.env` 파일을 생성하고 다음 내용을 입력하세요:

```env
# WebDAV Configuration
WEBDAV_URL=https://your-webdav-server.com
WEBDAV_USERNAME=your-username
WEBDAV_PASSWORD=your-password

# Server Configuration
PORT=5000
NODE_ENV=development

# JWT Secret
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# Database
DB_PATH=./data/database.sqlite

# Thumbnail Configuration
THUMBNAIL_DIR=./data/thumbnails
MAX_THUMBNAIL_SIZE=300

# Default Admin Account (optional)
# ADMIN_DEFAULT_PASSWORD=admin
```

### 3. 서버 실행

개발 모드 (백엔드 + 프론트엔드 동시 실행):
```bash
npm run dev
```

또는 개별 실행:

백엔드만:
```bash
npm run server
```

프론트엔드만:
```bash
npm run client
```

### 4. 접속

브라우저에서 `http://localhost:3000`으로 접속하세요.

### 5. 기본 Admin 계정

프로젝트를 처음 실행하면 자동으로 기본 admin 계정이 생성됩니다:

- **사용자명**: `admin`
- **비밀번호**: `admin` (또는 `.env` 파일의 `ADMIN_DEFAULT_PASSWORD` 값)
- **권한**: 루트 폴더(`/`)에 대한 관리자 권한

⚠️ **보안**: 프로덕션 환경에서는 반드시 첫 로그인 후 비밀번호를 변경하세요!

## 프로젝트 구조

```
webdav-easyaccess/
├── server/                 # Express.js 백엔드
│   ├── models/            # 데이터베이스 모델
│   ├── routes/           # API 라우트
│   ├── utils/            # 유틸리티 함수
│   └── index.js          # 서버 진입점
├── client/                # React 프론트엔드
│   ├── src/
│   │   ├── components/   # React 컴포넌트
│   │   ├── pages/        # 페이지 컴포넌트
│   │   ├── services/     # API 서비스
│   │   └── contexts/     # React Context
│   └── public/
├── data/                  # 데이터베이스 및 썸네일 저장소
└── package.json
```

## API 엔드포인트

### 인증
- `POST /api/auth/register` - 회원가입
- `POST /api/auth/login` - 로그인
- `GET /api/auth/me` - 현재 사용자 정보

### 파일 관리
- `GET /api/files/list?path=/` - 파일 목록 조회
- `GET /api/files/download?path=/file.txt` - 파일 다운로드
- `POST /api/files/upload` - 파일 업로드
- `DELETE /api/files/delete?path=/file.txt` - 파일 삭제
- `PUT /api/files/rename` - 파일 이름 변경
- `PUT /api/files/move` - 파일 이동
- `POST /api/files/copy` - 파일 복사

### 폴더 관리
- `POST /api/folders/create` - 폴더 생성
- `GET /api/folders/list?path=/` - 폴더 목록 조회

### 권한 관리
- `POST /api/permissions/grant` - 권한 부여
- `DELETE /api/permissions/revoke` - 권한 취소
- `GET /api/permissions/user/:userId` - 사용자 권한 조회
- `GET /api/permissions/folder?path=/` - 폴더 권한 조회

## 사용 방법

1. **로그인**: 기본 admin 계정(`admin`/`admin`)으로 로그인하거나, 회원가입을 진행하세요.
2. **파일 탐색**: 그리드, 리스트, 상세 보기 모드를 전환할 수 있습니다.
3. **파일 업로드**: 상단의 "업로드" 버튼을 클릭하거나 파일을 드래그 앤 드롭하세요.
4. **파일 관리**: 파일을 우클릭하여 컨텍스트 메뉴에서 다운로드, 이름 변경, 이동, 복사, 삭제를 할 수 있습니다.
5. **권한 관리**: 관리자는 폴더별로 사용자에게 읽기/쓰기/관리자 권한을 부여할 수 있습니다.

## 주의사항

- 프로덕션 환경에서는 반드시 `.env` 파일의 `JWT_SECRET`을 강력한 비밀키로 변경하세요.
- WebDAV 서버 연결 정보는 `.env` 파일에 안전하게 보관하세요.
- 썸네일은 이미지 파일에 대해서만 자동 생성됩니다. 동영상 썸네일은 향후 업데이트 예정입니다.

## 라이선스

MIT

