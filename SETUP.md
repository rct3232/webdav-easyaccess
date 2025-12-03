# 설정 가이드

## 1. .env 파일 생성

프로젝트 루트 디렉토리에 `.env` 파일을 생성하세요.

Windows:
```cmd
copy env.example .env
```

Linux/Mac:
```bash
cp env.example .env
```

그 다음 `.env` 파일을 열어서 WebDAV 정보를 입력하세요.

## 2. 의존성 설치

```bash
npm run install-all
```

## 3. 서버 실행

### 방법 1: 백엔드와 프론트엔드 동시 실행 (권장)
```bash
npm run dev
```

### 방법 2: 개별 실행

터미널 1 (백엔드):
```bash
npm run server
```

터미널 2 (프론트엔드):
```bash
npm run client
```

## 4. 서버 상태 확인

브라우저에서 다음 URL을 열어 서버가 실행 중인지 확인하세요:
- http://localhost:5000/api/health

"ok" 메시지가 표시되면 서버가 정상적으로 실행 중입니다.

## 문제 해결

### ECONNREFUSED 에러가 발생하는 경우:

1. **서버가 실행 중인지 확인**
   - 터미널에서 `npm run server` 실행
   - "Server is running on port 5000" 메시지가 보여야 합니다

2. **포트 충돌 확인**
   - 다른 프로그램이 5000번 포트를 사용 중일 수 있습니다
   - `.env` 파일에서 `PORT=5001`로 변경해보세요

3. **의존성 설치 확인**
   - `server/` 디렉토리에서 `npm install` 실행
   - `client/` 디렉토리에서 `npm install` 실행

4. **.env 파일 확인**
   - 프로젝트 루트에 `.env` 파일이 있는지 확인
   - 파일 내용이 올바른지 확인

