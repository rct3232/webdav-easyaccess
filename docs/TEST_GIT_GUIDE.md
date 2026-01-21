# 테스트 코드 Git 관리 가이드

## ✅ Git에 포함해야 할 것들 (Commit)

### 1. 테스트 코드

```
✓ client/src/__tests__/**/*.test.js
✓ client/src/components/__tests__/**/*.test.js
✓ client/src/hooks/__tests__/**/*.test.js
✓ client/src/utils/__tests__/**/*.test.js
✓ server/models/__tests__/**/*.test.js
✓ server/middleware/__tests__/**/*.test.js
✓ server/utils/__tests__/**/*.test.js
✓ server/routes/__tests__/**/*.test.js
```

**이유**: 테스트는 코드의 일부이며, 다른 개발자들도 실행하고 수정해야 합니다.

### 2. 테스트 설정 파일

```
✓ jest.config.js (클라이언트/서버)
✓ test-setup.js (서버)
✓ test-utils.js (클라이언트/서버)
✓ setupTests.js (클라이언트)
```

**이유**: 테스트 환경을 일관되게 유지하기 위해 필요합니다.

### 3. 테스트 유틸리티 및 모킹

```
✓ client/src/mocks/handlers.js
✓ client/src/mocks/server.js
✓ client/src/test-utils/index.js
✓ server/test-utils.js
```

**이유**: 테스트 작성에 필요한 공통 유틸리티입니다.

### 4. 테스트 문서

```
✓ TEST_SUMMARY.md (클라이언트/서버)
✓ docs/TEST_GIT_GUIDE.md
✓ README.md (테스트 섹션 포함)
```

**이유**: 테스트 구조와 실행 방법을 문서화합니다.

### 5. 패키지 설정

```
✓ package.json (test 스크립트 포함)
✓ package-lock.json
```

**이유**: 테스트 실행에 필요한 의존성 정보입니다.

## ❌ Git에서 제외해야 할 것들 (.gitignore)

### 1. 테스트 커버리지 리포트

```
✗ coverage/
✗ .nyc_output/
✗ *.lcov
```

**이유**:

- 로컬 실행마다 다르게 생성됨
- 용량이 크고 자주 변경됨
- CI/CD에서 자동 생성 가능

### 2. Jest 캐시

```
✗ .jest-cache/
```

**이유**: 성능 최적화를 위한 임시 파일이며, 각 환경에서 자동 생성됩니다.

### 3. 테스트 결과 파일 (선택적)

```
✗ test-results/
✗ *.xml
✗ junit.xml
```

**이유**: CI/CD에서 생성되는 리포트 파일입니다.

## 📋 권장 Git 워크플로우

### 1. 새 기능 개발 시

```bash
# 1. 기능 브랜치 생성
git checkout -b feature/new-feature

# 2. 테스트 먼저 작성 (TDD)
# - 테스트 파일 생성 및 작성

# 3. 테스트 실행 (실패 확인)
npm test

# 4. 구현 코드 작성

# 5. 테스트 실행 (성공 확인)
npm test

# 6. 커버리지 확인
npm run test:coverage

# 7. Git 커밋 (테스트와 코드 함께)
git add .
git commit -m "feat: 새 기능 추가 + 테스트"
```

### 2. 버그 수정 시

```bash
# 1. 버그를 재현하는 테스트 작성
# 2. 테스트 실행 (실패 확인)
# 3. 버그 수정
# 4. 테스트 실행 (성공 확인)
# 5. 커밋
git commit -m "fix: 버그 수정 + 회귀 테스트"
```

### 3. 리팩토링 시

```bash
# 1. 기존 테스트가 모두 통과하는지 확인
npm test

# 2. 리팩토링 수행

# 3. 테스트 재실행 (여전히 통과하는지 확인)
npm test

# 4. 커밋
git commit -m "refactor: 코드 리팩토링 (테스트 통과)"
```

## 🔍 커밋 전 체크리스트

### 필수 확인사항

- [ ] 모든 테스트가 통과하는가?

  ```bash
  npm test
  ```

- [ ] 새로운 코드에 대한 테스트가 작성되었는가?

  ```bash
  # 커버리지 확인
  npm run test:coverage
  ```

- [ ] 테스트 파일이 Git에 추가되었는가?

  ```bash
  git status
  ```

- [ ] 커버리지 리포트가 .gitignore에 있는가?

  ```bash
  # coverage/ 디렉토리가 untracked로 표시되어야 함
  git status
  ```

### 권장사항

- [ ] 테스트 설명이 명확한가?
- [ ] Edge case가 커버되었는가?
- [ ] 테스트가 독립적인가? (순서에 관계없이 실행 가능)
- [ ] 테스트 실행 시간이 적절한가? (느린 테스트는 최적화 고려)

## 📊 CI/CD 통합

### GitHub Actions 예시

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v2

      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '18'

      - name: Install dependencies
        run: |
          cd client && npm ci
          cd ../server && npm ci

      - name: Run client tests
        run: cd client && npm run test:ci

      - name: Run server tests
        run: cd server && npm run test:ci

      - name: Upload coverage
        uses: codecov/codecov-action@v2
        with:
          files: ./client/coverage/lcov.info,./server/coverage/lcov.info
```

## 🎯 커버리지 목표

### 현재 상태

- **클라이언트**: 88.6% (101/114 tests passing)
- **서버**:
  - 리팩토링 코드: 95-100%
  - 전체: 12.66% (168/168 tests passing)

### 권장 목표

- **새 코드**: 최소 80% 커버리지
- **리팩토링 코드**: 최소 90% 커버리지
- **핵심 비즈니스 로직**: 95%+ 커버리지

### 커버리지 확인

```bash
# 클라이언트
cd client && npm run test:coverage

# 서버
cd server && npm run test:coverage
```

## 📝 커밋 메시지 규칙

### 테스트 관련 커밋

```
test: 사용자 인증 테스트 추가
test: FileList 컴포넌트 단위 테스트
test: 권한 체크 미들웨어 테스트 추가
test: 실패하는 테스트 수정
```

### 코드 + 테스트 함께 커밋

```
feat: 파일 업로드 기능 추가 + 테스트
fix: 권한 체크 버그 수정 + 회귀 테스트
refactor: 경로 정규화 로직 개선 + 테스트
```

## 🚨 주의사항

### 절대 커밋하지 말 것

❌ `coverage/` 디렉토리  
❌ `.nyc_output/` 디렉토리  
❌ `*.lcov` 파일  
❌ `.jest-cache/` 디렉토리  
❌ 개인 테스트용 임시 파일

### 반드시 커밋할 것

✅ 모든 `*.test.js` 파일  
✅ 테스트 설정 파일  
✅ 테스트 유틸리티  
✅ 모킹 파일  
✅ 테스트 문서

## 🔧 트러블슈팅

### Q: 커버리지 리포트가 Git에 추가되었어요

```bash
# 이미 추가된 경우 제거
git rm -r --cached coverage/
git commit -m "chore: remove coverage from git"

# .gitignore 확인
cat .gitignore | grep coverage
```

### Q: 테스트가 로컬에서는 되는데 CI에서 실패해요

```bash
# 1. 환경 변수 확인
# 2. Node 버전 확인
# 3. 의존성 버전 고정 (package-lock.json 커밋)
# 4. 테스트 격리 확인 (beforeEach/afterEach)
```

### Q: 테스트가 너무 느려요

```bash
# 병렬 실행 활성화
npm test -- --maxWorkers=4

# 변경된 파일만 테스트
npm test -- --onlyChanged

# Watch 모드에서 관련 테스트만
npm test
```

## 📚 참고 자료

- [Jest Best Practices](https://jestjs.io/docs/best-practices)
- [Testing Library Guiding Principles](https://testing-library.com/docs/guiding-principles)
- [Git Ignore Patterns](https://git-scm.com/docs/gitignore)

---

**마지막 업데이트**: 2026-01-12  
**프로젝트**: WebDAV EasyAccess  
**테스트 프레임워크**: Jest, React Testing Library

