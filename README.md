# WebDAV EasyAccess

WebDAV 파일 관리 웹 서비스입니다.

## 주요 기능

### 인증 및 사용자 관리
- ✅ .env 파일을 통한 WebDAV 자동 접속
- ✅ 서비스 자체 계정 생성/관리 (WebDAV 계정과 별개)
- ✅ 회원가입 승인 시스템 (관리자 승인 필요)
- ✅ 회원가입 활성화/비활성화 설정 (관리자)
- ✅ 이메일 알림 (승인 대기, 승인/거절 결과)
- ✅ 사용자별 전용 폴더 자동 생성
- ✅ 마이페이지 (비밀번호/이메일 변경)

### 관리자 기능
- ✅ 관리자 대시보드
- ✅ 회원 승인/거절 관리
- ✅ 사용자 수동 추가
- ✅ 사용자 삭제
- ✅ 회원가입 활성화/비활성화 설정
- ✅ 권한 부여된 디렉토리 삭제 방지 (경고 표시)

### 파일 관리
- ✅ 폴더별 접근 권한 관리 (읽기/쓰기/관리자)
- ✅ 파일 업로드/다운로드/이름변경/삭제/이동/복사
- ✅ 파일 미리보기 (이미지, 비디오, PDF, 텍스트)
- ✅ 간단 리스트, 상세 리스트, 그리드(갤러리) 보기
- ✅ 이미지/동영상 썸네일 표시 (PNG 투명 채널 지원)
- ✅ 한글 파일명 완벽 지원

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
# WebDAV Configuration (required)
WEBDAV_URL=https://your-webdav-server.com
WEBDAV_USERNAME=your-username
WEBDAV_PASSWORD=your-password

# Server Configuration (required)
PORT=5000
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# Email Configuration (required for user notifications)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
EMAIL_FROM_NAME=WebDAV EasyAccess

# Optional Configuration
# MAX_THUMBNAIL_SIZE=300
# ADMIN_DEFAULT_PASSWORD=admin123
# FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe
# WEBDAV_AUTH_TYPE=auto
```

**참고:**
- 데이터베이스와 썸네일은 자동으로 `data/` 디렉토리에 저장됩니다.
- FFmpeg는 자동으로 감지되며, 찾을 수 없는 경우에만 `FFMPEG_PATH`를 설정하세요.
- `WEBDAV_AUTH_TYPE`은 인증 방식을 명시적으로 지정할 때만 사용합니다 (auto/basic/digest).
- 이메일 설정이 없으면 알림이 콘솔에 출력됩니다 (개발 환경용).
- Gmail을 사용하는 경우 "앱 비밀번호"를 생성하여 사용하세요.

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
│   │   ├── database.js   # DB 연결 및 테이블 생성
│   │   ├── User.js       # 사용자 모델
│   │   ├── Permission.js # 권한 모델
│   │   └── Settings.js   # 설정 모델
│   ├── routes/           # API 라우트
│   │   ├── auth.js       # 인증 라우트
│   │   ├── users.js      # 사용자 라우트
│   │   ├── admin.js      # 관리자 라우트
│   │   ├── settings.js   # 설정 라우트
│   │   ├── files.js      # 파일 라우트
│   │   ├── folders.js    # 폴더 라우트
│   │   └── permissions.js # 권한 라우트
│   ├── utils/            # 유틸리티 함수
│   │   ├── auth.js       # JWT 인증
│   │   ├── email.js      # 이메일 발송
│   │   ├── webdav.js     # WebDAV 클라이언트
│   │   ├── thumbnail.js  # 썸네일 생성
│   │   └── paths.js      # 경로 관리
│   └── index.js          # 서버 진입점
├── client/                # React 프론트엔드
│   ├── src/
│   │   ├── components/   # React 컴포넌트
│   │   │   ├── FileContextMenu.js
│   │   │   ├── FilePreviewDialog.js
│   │   │   └── UploadDialog.js
│   │   ├── pages/        # 페이지 컴포넌트
│   │   │   ├── Login.js
│   │   │   ├── Register.js
│   │   │   ├── FileManager.js
│   │   │   ├── MyPage.js
│   │   │   └── AdminDashboard.js
│   │   ├── services/     # API 서비스
│   │   │   └── fileService.js
│   │   └── contexts/     # React Context
│   │       └── AuthContext.js
│   └── public/
├── data/                  # 데이터베이스 및 썸네일 저장소
│   ├── database.sqlite   # SQLite 데이터베이스
│   └── thumbnails/       # 썸네일 이미지
└── package.json
```

## 데이터베이스 스키마

### users 테이블
- `id`: 사용자 ID (PK)
- `username`: 사용자명 (UNIQUE)
- `email`: 이메일 (UNIQUE)
- `password`: 해시된 비밀번호
- `status`: 계정 상태 (pending/approved/rejected)
- `is_admin`: 관리자 여부 (0/1)
- `created_at`: 가입일
- `updated_at`: 수정일

### folder_permissions 테이블
- `id`: 권한 ID (PK)
- `user_id`: 사용자 ID (FK)
- `folder_path`: 폴더 경로
- `permission`: 권한 수준 (read/write/admin)
- `created_at`: 생성일

### settings 테이블
- `key`: 설정 키 (PK)
- `value`: 설정 값
- `updated_at`: 수정일

## API 엔드포인트

### 인증
- `POST /api/auth/register` - 회원가입 (설정에 따라 활성화/비활성화)
- `POST /api/auth/login` - 로그인
- `GET /api/auth/me` - 현재 사용자 정보

### 사용자 관리
- `GET /api/users/:id` - 사용자 정보 조회
- `PUT /api/users/:id/password` - 비밀번호 변경
- `PUT /api/users/:id/email` - 이메일 변경

### 관리자 전용
- `GET /api/admin/settings` - 시스템 설정 조회
- `PUT /api/admin/settings` - 시스템 설정 변경
- `GET /api/admin/users` - 전체 사용자 목록
- `GET /api/admin/users/pending` - 승인 대기 사용자 목록
- `POST /api/admin/users/:id/approve` - 사용자 승인
- `POST /api/admin/users/:id/reject` - 사용자 거절
- `POST /api/admin/users` - 사용자 수동 추가
- `DELETE /api/admin/users/:id` - 사용자 삭제

### 설정 (공개)
- `GET /api/settings/public` - 공개 설정 조회 (회원가입 활성화 여부)

### 파일 관리
- `GET /api/files/list?path=/` - 파일 목록 조회
- `GET /api/files/download?path=/file.txt` - 파일 다운로드
- `POST /api/files/upload` - 파일 업로드
- `DELETE /api/files/delete?path=/file.txt` - 파일/폴더 삭제 (권한 확인)
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

### 일반 사용자

1. **회원가입**: 
   - 관리자가 회원가입을 활성화한 경우에만 로그인 페이지에서 회원가입 버튼이 표시됩니다.
   - 회원가입 후 관리자의 승인을 기다립니다.
   - 승인 시 이메일 알림을 받습니다.

2. **로그인**: 
   - 승인된 계정으로 로그인합니다.
   - 자신의 전용 폴더(`/사용자명`)에 자동으로 접근됩니다.

3. **파일 관리**:
   - 그리드, 리스트, 상세 보기 모드를 전환할 수 있습니다.
   - 파일 업로드: 상단의 "업로드" 버튼을 클릭하거나 드래그 앤 드롭
   - 파일 관리: 파일을 우클릭하여 다운로드, 이름 변경, 이동, 복사, 삭제
   - 파일 미리보기: 파일을 클릭하여 브라우저에서 바로 확인

4. **마이페이지**:
   - 우상단 사용자 아이콘 클릭
   - 비밀번호 및 이메일 변경 가능

### 관리자

1. **로그인**: 기본 admin 계정(`admin`/`admin123`)으로 로그인

2. **시스템 설정**:
   - 관리자 대시보드 → 설정 탭
   - 회원가입 활성화/비활성화 스위치

3. **사용자 관리**:
   - **승인 대기**: 신규 가입 사용자 승인/거절
   - **전체 사용자**: 모든 사용자 조회 및 삭제
   - **사용자 추가**: 관리자가 직접 계정 생성 (즉시 승인)

4. **파일 관리**:
   - 모든 폴더 접근 가능
   - 권한이 부여된 디렉토리 삭제 시 경고 메시지 표시
   - 폴더별 사용자 권한 부여/취소

## 주의사항

### 보안
- 프로덕션 환경에서는 반드시 `.env` 파일의 `JWT_SECRET`을 강력한 비밀키로 변경하세요.
- 기본 admin 계정의 비밀번호를 즉시 변경하세요.
- WebDAV 서버 연결 정보는 `.env` 파일에 안전하게 보관하세요.
- 기본적으로 회원가입이 비활성화되어 있으며, 관리자가 활성화할 수 있습니다.

### 기술적 사항
- 이미지와 동영상 파일의 썸네일이 자동으로 생성됩니다 (PNG 투명 채널 지원).
- 동영상 썸네일 생성을 위해서는 FFmpeg가 필요합니다 (자동 감지 지원).
- 한글 파일명이 완벽하게 지원됩니다 (UTF-8 인코딩).
- 권한이 부여된 디렉토리는 삭제할 수 없습니다 (먼저 권한 제거 필요).

### 이메일 알림
- 이메일 설정 없이도 서비스를 사용할 수 있습니다 (알림이 콘솔에 출력).
- Gmail 사용 시 "2단계 인증" 활성화 후 "앱 비밀번호"를 생성하여 사용하세요.

## 라이선스

MIT

