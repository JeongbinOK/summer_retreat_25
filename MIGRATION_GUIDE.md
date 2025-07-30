# 🚀 Supabase 마이그레이션 가이드

## 현재 문제
- Render PostgreSQL이 앱 재시작 시 데이터 손실
- Keep-Alive 없이는 데이터 보존 불가능
- 무료 플랜의 한계로 인한 불안정성

## 해결책: Supabase PostgreSQL

### ✅ Supabase 장점
- **완전 무료**: 500MB, 50,000 API 요청/월
- **독립적 운영**: Render와 별개로 작동
- **데이터 영구 보존**: 앱 재시작과 무관
- **PostgreSQL 완벽 호환**: 코드 수정 최소화

---

## 🎯 마이그레이션 절차

### 1단계: Supabase 프로젝트 생성
1. https://supabase.com 접속
2. "Start your project" 클릭
3. GitHub 계정으로 로그인
4. "New project" 생성
   - Organization: 개인 계정
   - Name: `church-retreat-2025`
   - Database Password: 강력한 비밀번호 생성
   - Region: Northeast Asia (Seoul) 선택

### 2단계: 데이터베이스 URL 획득
1. 프로젝트 Dashboard → Settings → Database
2. **Connection string** 섹션에서 **URI** 복사
3. 형태: `postgresql://postgres.[ref]:[password]@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`

### 3단계: Render 환경변수 업데이트
1. Render Dashboard → Web Service → Environment
2. `DATABASE_URL` 값을 Supabase URL로 교체
3. 저장 후 자동 재배포 대기

### 4단계: 테스트 및 확인
1. `/debug-status` 엔드포인트 확인
2. 데이터 생성/수정 테스트
3. 앱 재시작 후 데이터 보존 확인

---

## 🔄 대안: Railway 플랫폼 이전

### Railway 장점
- Render보다 안정적인 PostgreSQL 
- GitHub 자동 배포
- 더 관대한 무료 티어

### Railway 이전 방법
1. https://railway.app 가입
2. "Deploy from GitHub repo" 선택
3. `JeongbinOK/summer_retreat_25` 연결
4. PostgreSQL 서비스 추가
5. 환경변수 설정

---

## ⚡ 즉시 진단: 현재 문제 파악

수정된 `/debug-status` 엔드포인트 확인:
- `database.connection_test`: 실제 연결 상태
- `database.actual_data`: 현재 데이터 개수
- `environment.DATABASE_URL_host`: 연결 중인 데이터베이스 호스트

## 권장사항

**1순위: Supabase 마이그레이션** (가장 확실)
**2순위: Railway 플랫폼 이전** (전체적 개선)
**3순위: 현재 설정 디버깅** (시간 소모적)

시간 대비 효과를 고려하면 **Supabase 마이그레이션**이 가장 좋습니다!