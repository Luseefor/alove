# Environment Matrix

## Local standalone mode

Purpose:
- run editor locally
- no Clerk required
- no Convex required
- Redis/worker required only for real compile queue
- CodeMirror default
- textarea fallback available

Required variables:
```env
NEXT_PUBLIC_LOCAL_STANDALONE=true
NEXT_PUBLIC_EDITOR_MODE=codemirror
REDIS_HOST=redis
REDIS_PORT=6379
```

Optional variables:
```env
REDIS_PASSWORD
WORKER_CONCURRENCY
COMPILE_USE_DOCKER
COMPILE_DOCKER_IMAGE
COMPILE_DOCKER_PLATFORM
COMPILE_TIMEOUT_MS
COMPILE_MAX_LOG_BYTES
COMPILE_MAX_PDF_BYTES
COMPILE_MAX_FILES
COMPILE_MAX_FILE_BYTES
COMPILE_MAX_TOTAL_BYTES
```

## Cloud development mode

Purpose:
- Clerk auth on
- Convex persistence on
- Redis/worker compile available

Required variables:
```env
NEXT_PUBLIC_LOCAL_STANDALONE=false
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
NEXT_PUBLIC_CONVEX_URL
CLERK_JWT_ISSUER_DOMAIN
REDIS_HOST
REDIS_PORT
```

## Production mode

Purpose:
- fail-closed auth
- real Clerk/Convex values
- Redis and worker deployed
- Docker/TeX compile path configured
- no placeholder fallbacks

Required variables:
```env
NODE_ENV=production
NEXT_PUBLIC_LOCAL_STANDALONE=false
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
NEXT_PUBLIC_CONVEX_URL
CLERK_JWT_ISSUER_DOMAIN
REDIS_HOST
REDIS_PORT
```

**Notes:**
- Public build-time env vars require rebuild/redeploy when changed.
- `NEXT_PUBLIC_EDITOR_MODE=textarea` is the rollback flag.
- `NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR` is legacy compatibility.
- Secrets must **never** be committed.