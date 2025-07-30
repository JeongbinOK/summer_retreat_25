# 데이터 지속성 문제 해결책들

## 🎯 해결책 1: Supabase 무료 PostgreSQL (권장)

**장점:**
- ✅ 완전 무료 (500MB, 50,000 API 요청/월)
- ✅ Render와 독립적으로 작동
- ✅ 데이터 영구 보존 보장
- ✅ 백업 자동화

**설정 방법:**
1. https://supabase.com 가입
2. 새 프로젝트 생성
3. Settings → Database → Connection string 복사
4. Render 환경변수에 `DATABASE_URL` 설정

---

## 🔄 해결책 2: Keep-Alive 서비스 (현재 설정 유지)

**앱이 Sleep 되지 않도록 주기적 ping**

```javascript
// keep-alive.js
setInterval(async () => {
    try {
        const response = await fetch('https://summer-retreat-25.onrender.com/');
        console.log('Keep-alive ping:', response.status);
    } catch (error) {
        console.error('Keep-alive failed:', error.message);
    }
}, 14 * 60 * 1000); // 14분마다 실행
```

**외부 서비스 사용:**
- UptimeRobot (무료)
- Cron-job.org (무료)

---

## 💾 해결책 3: 데이터 백업/복원 시스템

**중요 데이터를 JSON으로 백업하고 자동 복원**

```javascript
// 앱 시작 시 백업된 데이터 확인 후 복원
async function restoreDataIfNeeded() {
    const userCount = await db.query('SELECT COUNT(*) FROM users');
    if (userCount[0].count <= 1) { // admin만 있음
        await restoreFromBackup();
    }
}
```

---

## 🚀 해결책 4: Railway로 플랫폼 이전

**더 안정적인 무료 호스팅**
- Railway: PostgreSQL 포함, 더 관대한 무료 티어
- Vercel + PlanetScale: 정적 사이트 + 무료 MySQL

---

## ⚡ 즉시 적용 가능한 임시 해결책

**현재 설정에서 바로 적용:**

1. **환경변수 재확인**: DATABASE_URL이 올바른지 확인
2. **디버그 엔드포인트**: `/debug-status` 접속해서 실제 DB 타입 확인
3. **데이터 확인**: 앱 재시작 전후 데이터 비교
4. **Keep-alive 설정**: 외부에서 주기적 ping

---

## 🔍 현재 상태 진단 방법

1. **https://summer-retreat-25.onrender.com/debug-status** 접속 (admin 로그인 필요)
2. **데이터베이스 타입 확인**: SQLite vs PostgreSQL
3. **환경변수 확인**: DATABASE_URL 존재 여부
4. **기존 데이터 확인**: 사용자/팀 수 체크