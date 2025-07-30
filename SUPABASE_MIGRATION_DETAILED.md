# 🚀 Supabase 마이그레이션 완전 가이드

## 🎯 Step 1: Supabase 계정 생성 (5분)

### 1-1: 회원가입
1. **https://supabase.com** 접속
2. **"Start your project"** 클릭
3. **GitHub 계정으로 로그인** (권장)
   - 또는 이메일로 가입 가능
4. 이메일 인증 완료

### 1-2: 새 프로젝트 생성
1. 대시보드에서 **"New project"** 클릭
2. **Organization 선택**: 개인 계정
3. **프로젝트 정보 입력**:
   ```
   Name: church-retreat-2025
   Database Password: [강력한 비밀번호 생성 - 메모 필수!]
   Region: Northeast Asia (ap-northeast-1) - Seoul
   Pricing Plan: Free tier (선택됨)
   ```
4. **"Create new project"** 클릭
5. **프로젝트 생성 대기** (2-3분 소요)

---

## 🎯 Step 2: 데이터베이스 URL 획득 (2분)

### 2-1: Connection String 확인
1. 프로젝트 대시보드 → **Settings** (좌측 하단 톱니바퀴)
2. **Database** 탭 클릭
3. **Connection parameters** 섹션에서 **"URI"** 복사

**URL 형태 예시:**
```
postgresql://postgres.abcdefghijk:[PASSWORD]@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres
```

### 2-2: URL 검증
- URL이 `postgresql://`로 시작하는지 확인
- 패스워드가 올바르게 포함되어 있는지 확인
- 호스트가 `supabase.com`을 포함하는지 확인

---

## 🎯 Step 3: Render 환경변수 업데이트 (2분)

### 3-1: Render 설정 변경
1. **Render Dashboard** (https://dashboard.render.com) 접속
2. **Web Service** (summer-retreat-25) 클릭
3. **Environment** 탭 클릭
4. **DATABASE_URL** 찾기
5. **Edit** 클릭하여 값을 Supabase URL로 교체
6. **Save Changes** 클릭

### 3-2: 자동 재배포 대기
- 환경변수 변경 시 자동으로 재배포 시작
- **Deploy** 탭에서 진행 상황 확인
- 완료까지 약 2-3분 소요

---

## 🎯 Step 4: 배포 성공 확인 (3분)

### 4-1: 배포 로그 확인
다음 메시지들이 표시되어야 합니다:
```
🗄️ Using PostgreSQL database for production
📡 Connecting to: aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres
🔧 Initializing PostgreSQL database...
✅ Database tables already exist, skipping schema creation  ← 새로운 메시지
📝 Creating initial data...
📋 Creating teams (current: 0, needed: 6)  ← 0부터 시작!
✅ Database initialized successfully
```

### 4-2: 웹사이트 접속 테스트
1. **https://summer-retreat-25.onrender.com** 접속
2. **관리자 로그인**: `admin` / `akftmaryghl`
3. **정상 접속 확인**

---

## 🎯 Step 5: 데이터 초기화 및 검증 (5분)

### 5-1: Debug Status 확인
1. **https://summer-retreat-25.onrender.com/debug-status** 접속
2. **예상 결과**:
```json
{
  "environment": {
    "DATABASE_URL_host": "aws-0-ap-northeast-1.pooler.supabase.com:6543",
    "DATABASE_URL_type": "PostgreSQL"
  },
  "database": {
    "type": "PostgreSQL",
    "connection_test": "Connected",
    "actual_data": {
      "users": "1",
      "teams": "6",      ← 이제 6개!
      "products": "4",
      "transactions": "0"
    }
  }
}
```

### 5-2: 기능 테스트
1. **새 사용자 생성** (관리자 → 사용자 관리)
2. **팀 할당** 테스트
3. **제품 구매** 시뮬레이션
4. **debug-status 재확인** → transactions가 증가했는지 확인

---

## 🎯 Step 6: 데이터 지속성 최종 테스트 (15분)

### 6-1: 앱 Sleep 유도 테스트
1. **현재 데이터 상태 스크린샷**
2. **15분간 아무 활동 없이 대기**
3. **웹사이트 재접속** (Cold Start 발생)
4. **모든 데이터 보존 확인**

### 6-2: 성공 기준
- ✅ 사용자 계정 유지
- ✅ 팀 정보 그대로 (6개)
- ✅ 제품 정보 보존
- ✅ 거래 내역 유지
- ✅ 관리자 설정 보존

---

## 🚨 문제 해결 가이드

### 연결 실패 시
```bash
Error: connection refused
```
→ DATABASE_URL 다시 확인, 패스워드 정확성 체크

### 권한 오류 시
```bash
Error: permission denied
```
→ Supabase 프로젝트 상태 확인, 무료 티어 한도 체크

### 데이터 없음 시
```bash
"teams": "0"
```
→ 초기화 로직 실행 확인, 로그에서 오류 메시지 찾기

---

## ✅ 마이그레이션 성공 체크리스트

- [ ] Supabase 프로젝트 생성 완료
- [ ] DATABASE_URL 교체 완료  
- [ ] Render 재배포 성공
- [ ] 웹사이트 정상 접속
- [ ] debug-status에서 teams: 6 확인
- [ ] 새 데이터 생성/저장 테스트 성공
- [ ] 15분 대기 후 데이터 보존 확인

**모든 항목이 ✅이면 마이그레이션 완료!** 🎉