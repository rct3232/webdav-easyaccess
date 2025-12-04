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
- ✅ 사용자 수동 추가/삭제
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
# ADMIN_DEFAULT_PASSWORD=admin
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

## 사용 방법

### 일반 사용자

1. **회원가입 및 로그인**
   - 관리자가 활성화한 경우 회원가입 가능
   - 가입 후 관리자 승인 대기 (이메일 알림)
   - 승인된 계정으로 로그인하면 전용 폴더(`/사용자명`)에 접근

2. **파일 관리**
   - 파일 업로드: 드래그 앤 드롭 또는 업로드 버튼
   - 파일 작업: 우클릭으로 다운로드, 이름 변경, 이동, 복사, 삭제
   - 미리보기: 파일 클릭으로 이미지, 비디오, PDF, 텍스트 확인
   - 보기 모드: 그리드, 리스트, 상세 보기 전환

3. **마이페이지**
   - 우상단 사용자 아이콘에서 비밀번호/이메일 변경

### 관리자

1. **첫 로그인**
   - 기본 계정: `admin` / `admin`
   - ⚠️ 즉시 비밀번호 변경 권장

2. **사용자 관리**
   - 신규 가입자 승인/거절
   - 사용자 직접 추가/삭제
   - 회원가입 기능 활성화/비활성화

3. **권한 관리**
   - 폴더별 사용자 권한 부여/취소
   - 권한이 있는 폴더 삭제 시 경고 표시

## 주의사항

**보안**
- 프로덕션 환경에서는 `.env`의 `JWT_SECRET`과 admin 비밀번호를 반드시 변경하세요
- 회원가입은 기본적으로 비활성화되어 있으며, 관리자가 활성화할 수 있습니다

**기술적 사항**
- 동영상 썸네일 생성을 위해 FFmpeg 필요 (자동 감지)
- 이메일 설정이 없으면 알림이 콘솔에 출력됩니다
- Gmail 사용 시 "앱 비밀번호" 생성 필요

## 라이선스

MIT

