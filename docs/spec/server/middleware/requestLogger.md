# requestLogger Spec

## 1. Overview

| Item                 | Description                                                                             |
| -------------------- | --------------------------------------------------------------------------------------- |
| Role                 | Access logger: one JSON line per request to stdout. Does NOT log Authorization or body. |
| Pipeline position    | Top of middleware stack                                                                 |
| Preceding middleware | None                                                                                    |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/middleware/requestLogger.js`
- **Test file:** `server/middleware/__tests__/requestLogger.test.js`

### 2.2 Input Conditions

- None (runs first)

### 2.3 Side Effects

- res.on('finish'): console.log(JSON.stringify(entry))
- Entry: ts, method, url, status, duration_ms, ip, user_agent, user_id?, username?

### 2.4 Error Cases

- None (always calls next())

### 2.5 Mock Targets

- console.log
- process.hrtime.bigint

### 2.6 Verification Scenarios

- [ ] next() called
- [ ] Log entry format on finish
- [ ] getClientIp from x-forwarded-for
- [ ] duration_ms, user_id when req.user set
