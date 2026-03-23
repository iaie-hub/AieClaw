1. 查询会话及关联用户
   sqlite3 -header -column ~/.openclaw/aiemas/mas4s.db \
    "SELECT sm.sessionKey, sm.userId, u.displayName, sm.role, so.tenantId
   FROM session_memberships sm
   LEFT JOIN users u ON sm.userId = u.userId
   LEFT JOIN session_ownership so ON sm.sessionKey = so.sessionKey
   ORDER BY sm.sessionKey, sm.role;"
