# LearnHouse Deployment: Incident Report, Root Cause Analysis & Fixes

This document records the issues encountered during the initial deployment of LearnHouse LMS on Amazon EKS in the `vgurukool` namespace, the detailed root causes, and the fixes applied to resolve them.

---

## 1. Incident Overview

* **Symptom 1:** Navigating to `https://learnhouse.vgurukool.com` showed:
  ```text
  We hit a snag on our end
  SERVER
  Our servers returned an unexpected error while handling your request. This is on us, not you; trying again in a moment usually helps.
  Retry [Home](https://learnhouse.vgurukool.com/home)
  Hide technical details status: 502
  ```
* **Symptom 2:** After resolving the 502 error, attempting to sign in at `/login` or through the API `/api/auth/login` resulted in `HTTP 500 Internal Server Error`.

---

## 2. Root Causes & Detailed Explanations

### Issue A: Missing Database Tables & `pgvector` Extension (502 Bad Gateway)
* **Mechanism:** 
  1. Next.js (`learnhouse-web`) performs Server-Side Rendering (SSR). During the initial request or navigation, it makes an internal call to the Python backend API (`http://localhost:9000/api/v1/orgs/slug/default`) to fetch organization configuration.
  2. The Python API was crashing or failing on startup because the connected PostgreSQL database had no schema tables created.
  3. When attempting schema creation on standard Bitnami PostgreSQL, execution failed on the `CourseEmbedding` table with:
     ```text
     type "vector" does not exist
     ```
     LearnHouse's RAG/AI feature requires the PostgreSQL `vector` extension (`VECTOR(768)`).
  4. With the backend API failing to respond on port 9000, Next.js caught a connection failure/bad response and returned `status: 502` to the browser with the generic "snag on our end" error page.

### Issue B: Inter-Node Port 80 Blocked in Security Group
* **Mechanism:**
  * The LearnHouse pod runs an internal NGINX reverse proxy listening on TCP port 80.
  * Ingress-NGINX controller runs on one EKS node while the LearnHouse pod was scheduled on another node.
  * The node-to-node security group (`sg-00d969a08868e7e2b`) only allowed inter-node communication on ports `1025-65535`.
  * Ingress-NGINX could not reach pod port 80 across nodes, resulting in intermittent or permanent upstream connection timeouts.

### Issue C: Missing Redis Backend for Rate Limiting & Sessions (500 Internal Server Error on Login)
* **Mechanism:**
  * In `learnhouse-api/src/routers/auth.py`, the login handler begins by enforcing IP and account-level rate limits:
    ```python
    is_allowed, retry_after = check_login_rate_limit(request)
    ```
  * `check_login_rate_limit()` calls `check_rate_limit()`, which connects directly to Redis (`localhost:6379` by default if `LEARNHOUSE_REDIS_CONNECTION_STRING` is unset).
  * No Redis server was running in the container or cluster namespace.
  * The unhandled exception:
    ```text
    redis.exceptions.ConnectionError: Error 111 connecting to localhost:6379. Connection refused.
    ```
    caused the login endpoint to terminate with `500 Internal Server Error`.
  * Additionally, a background video captioning task (`src.services.utils.caption_jobs`) was caught in an infinite retry loop flooding logs with `Connection refused` on `localhost:6379`.

### Issue D: Argo CD State Drift on StatefulSet `volumeClaimTemplates`
* **Mechanism:**
  * When applying Kubernetes StatefulSets, the control plane automatically defaults the `spec.volumeClaimTemplates[].spec.volumeMode` to `Filesystem`.
  * In the Helm chart, this field was omitted, causing Argo CD to report `OutOfSync` due to live manifest differences.

---

## 3. Implemented Fixes

### Fix A: Dedicated PostgreSQL with `pgvector` (`learnhouse-db`)
* **Template:** Added `chart/templates/database.yaml` defining a dedicated StatefulSet and Service:
  * **Image:** `pgvector/pgvector:pg16`
  * **Storage:** 10Gi on `gp3` storage class.
  * **Data Directory:** Configured `PGDATA: /var/lib/postgresql/data/pgdata` to avoid conflicts with lost+found.
  * **Extension:** Executed `CREATE EXTENSION IF NOT EXISTS vector;` in PostgreSQL.
* **Schema Initialization:**
  * Ran the install routine inside the pod:
    ```bash
    python3 cli.py install --short
    ```
  * Successfully initialized all 61 database tables (including `organization`, `user`, `userorganization`, `course`, `course_embedding`, `role`, etc.).
  * Configured default organization `Vgurukool Academy` (`slug: default`).
  * Created superadmin user:
    * **Email:** `admin@vgurukool.com`
    * **Username:** `admin`
    * **Role:** `admin` (`is_superadmin: true`)
    * **Password:** `-0GZHFZX--Ghhe53q8L-z-M9YEEWSPWD`

### Fix B: AWS EKS Security Group Ingress Rule
* Added inter-node ingress rule to `sg-00d969a08868e7e2b`:
  * **Protocol:** TCP
  * **Port:** 80
  * **Source:** `sg-00d969a08868e7e2b` (self / node-to-node)
  * **Rule ID:** `sgr-06fbdd56d5fea8676`

### Fix C: Dedicated Redis Deployment & Service (`learnhouse-redis`)
* **Template:** Added `chart/templates/redis.yaml`:
  * **Deployment:** `learnhouse-redis` running `redis:7-alpine`.
  * **Service:** `learnhouse-redis:6379` (ClusterIP).
* **Configuration:**
  * Added `LEARNHOUSE_REDIS_CONNECTION_STRING: "redis://learnhouse-redis:6379"` to `chart/values.yaml` and `learnhouse-config` ConfigMap.
  * Added `LEARNHOUSE_COOKIE_DOMAIN_ALLOW_BROAD: "true"` to suppress parent cookie domain warning.

### Fix D: StatefulSet Synchronization in Argo CD
* Added `volumeMode: Filesystem` into `chart/templates/database.yaml`.
* Configured `ignoreDifferences` in Argo CD application `learnhouse` for `StatefulSet` volumeClaimTemplates:
  ```yaml
  ignoreDifferences:
  - group: apps
    kind: StatefulSet
    jsonPointers:
    - /spec/volumeClaimTemplates
  ```

---

## 4. Architecture & Container Layout

The LearnHouse all-in-one container (`ayusing/learnhouse:latest`) runs the following components managed by PM2 and NGINX:

```
                          Internet / Users
                                 │
                                 ▼
                     AWS Network Load Balancer
                                 │
                                 ▼
                     Ingress-NGINX Controller
                                 │ (TCP 80)
                                 ▼
        ┌─────────────────────────────────────────────────┐
        │  LearnHouse Pod (ayusing/learnhouse:latest)     │
        │                                                 │
        │  NGINX Reverse Proxy (Port 80)                  │
        │   ├── /api/auth ──> Next.js (Port 8000)         │
        │   ├── /api/v1   ──> Python FastAPI (Port 9000)  │
        │   ├── /collab   ──> Node Collab (Port 4000)     │
        │   └── /         ──> Next.js SSR (Port 8000)     │
        └──────────────┬──────────────────┬───────────────┘
                       │                  │
                       ▼                  ▼
        ┌──────────────────────┐  ┌──────────────────────┐
        │ learnhouse-db:5432   │  │ learnhouse-redis:6379│
        │ pgvector/pgvector:16 │  │ redis:7-alpine       │
        └──────────────────────┘  └──────────────────────┘
```

---

## 5. Verification Commands & Health Check

### 1. Web UI & SSR Verification
```bash
curl -k -I https://learnhouse.vgurukool.com/
# Expected: HTTP/2 200 OK
# Header: set-cookie: LH_org=default; Path=/
# Header: x-middleware-rewrite: /orgs/default/
```

### 2. Login Page Verification
```bash
curl -k -I https://learnhouse.vgurukool.com/login
# Expected: HTTP/2 200 OK
# Header: x-middleware-rewrite: /auth/login
```

### 3. Authentication Flow Verification
```bash
curl -k -i -s -X POST https://learnhouse.vgurukool.com/api/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'username=admin@vgurukool.com&password=-0GZHFZX--Ghhe53q8L-z-M9YEEWSPWD'
```
**Expected Output:**
* Status: `HTTP/2 200 OK`
* Response cookies: `LH_access`, `LH_refresh`, `LH_session=1`
* Body:
  ```json
  {
    "user": {
      "username": "admin",
      "email": "admin@vgurukool.com",
      "is_superadmin": true
    },
    "tokens": {
      "access_token": "...",
      "refresh_token": "...",
      "expiry": 1788853808426
    }
  }
  ```

### 4. Argo CD Sync Status
```bash
kubectl get application -n argocd learnhouse -o jsonpath='Sync: {.status.sync.status} | Health: {.status.health.status}'
# Expected: Sync: Synced | Health: Healthy
```

---

## 4. Keycloak Single Sign-On (SSO) Integration

### Objective
Enable seamless SSO login using the shared Keycloak authentication realm (`cnoe`) and client (`vgurukool-apps`) across all vgurukool platforms, including LearnHouse LMS.

### Architecture & Data Flow
1. **SSO Button & Redirection:**
   * On `https://learnhouse.vgurukool.com/login`, users see the **"Sign in with Keycloak SSO"** option.
   * Clicking the button invokes `/api/auth/keycloak/authorize`, which redirects the browser to:
     `https://vgurukool.com/keycloak/realms/cnoe/protocol/openid-connect/auth` with `client_id=vgurukool-apps`, `response_type=code`, `scope=openid email profile`, and `redirect_uri=https://learnhouse.vgurukool.com/auth/callback/keycloak`.
2. **Authorization Code Exchange:**
   * Upon successful Keycloak login, Keycloak redirects back to `/auth/callback/keycloak?code=...`.
   * The callback page calls `/api/auth/keycloak/token` to exchange the authorization code for an `access_token` and `id_token`.
3. **Backend User Provisioning & Session Generation:**
   * The callback calls the backend `/api/v1/auth/third-party/login` with `provider: "keycloak"` and the access token.
   * `signWithKeycloak` verifies the token with Keycloak's userinfo endpoint (`http://keycloak.keycloak.svc.cluster.local/keycloak/realms/cnoe/protocol/openid-connect/userinfo`).
   * The user is automatically provisioned if new, associated with the default organization (`org_id=1`), given email verified status, and issued LearnHouse JWT session tokens (`LH_access`, `LH_refresh`, `LH_session`).
   * The client updates the local NextAuth/AuthContext session and redirects to `/home`.

### Configuration
* **ConfigMap / Environment Variables (`learnhouse-config`):**
  * `KEYCLOAK_URL`: `https://vgurukool.com/keycloak`
  * `KEYCLOAK_INTERNAL_URL`: `http://keycloak.keycloak.svc.cluster.local/keycloak`
  * `KEYCLOAK_REALM`: `cnoe`
  * `KEYCLOAK_CLIENT_ID`: `vgurukool-apps`

### Issue E: SSO Router Scope & New User Provisioning Model Mismatch
* **Mechanism:**
  1. In `apps/api/src/routers/auth.py`, `AUTH_METHOD_SSO` was conditionally imported inside a downstream block, triggering an `UnboundLocalError` when evaluating `_expected_method` during third-party authentication.
  2. In `apps/api/src/services/auth/utils.py` (`signWithKeycloak`), when a user logged in for the first time, `create_user()` returned a Pydantic `UserRead` model instead of the SQLAlchemy `User` entity. Setting `user.email_verified_at = ...` caused `ValueError: "UserRead" object has no field "email_verified_at"`.
* **Fix Applied:**
  1. In `apps/api/src/routers/auth.py`, imported `AUTH_METHOD_SSO` at the top level of the module alongside `AUTH_METHOD_GOOGLE` and `AUTH_METHOD_PASSWORD`.
  2. In `apps/api/src/services/auth/utils.py`, retrieved the database `User` instance by ID after calling `create_user()`, set `email_verified = True` and `email_verified_at`, committed changes to the session, and returned `UserRead.model_validate(user)`.

### Verification Evidence
* **Existing User Login (`user1`):**
  * Request to `/api/auth/oauth` with Keycloak bearer token succeeded with `HTTP 200 OK`.
  * LearnHouse User ID: `2` (`user1@vgurukool.com`), `email_verified: true`.
  * Issued session cookies: `LH_access`, `LH_refresh`, `LH_session=1`.
* **New User Auto-Provisioning (`user2`):**
  * Request to `/api/auth/oauth` with Keycloak bearer token succeeded with `HTTP 200 OK`.
  * LearnHouse User ID: `3` (`user2@vgurukool.com`), `email_verified: true`, `signup_method: "keycloak"`.
  * Issued session cookies: `LH_access`, `LH_refresh`, `LH_session=1`.
### Issue F: Keycloak Client Missing LearnHouse Redirect URI (`Invalid parameter: redirect_uri`)
* **Mechanism:**
  * When users clicked "Sign in with Keycloak SSO" on LearnHouse (`https://learnhouse.vgurukool.com/login`), the browser was redirected to Keycloak's authorization endpoint with `redirect_uri=https://learnhouse.vgurukool.com/auth/callback/keycloak`.
  * Keycloak 26 enforces strict URI validation and rejects wildcard domain patterns (`https://*.vgurukool.com/*`) unless specific origins or endpoints are registered.
  * The Keycloak client `vgurukool-apps` only had explicit entries for `ashta-lakshmi`, `dhana-lakshmi`, `dhanya-lakshmi`, `gaja-lakshmi`, and `vidya-lakshmi`. Because `learnhouse.vgurukool.com` was missing, Keycloak threw the error page:
    ```text
    We are sorry...
    Invalid parameter: redirect_uri
    [« Back to Application](https://vgurukool.com/)
    ```
* **Fix Applied:**
  * Added `https://learnhouse.vgurukool.com/*` and `https://learnhouse.vgurukool.com/auth/callback/keycloak` to the `redirect_uris` table in Keycloak's database for client `vgurukool-apps`.
  * Restarted the Keycloak StatefulSet (`kubectl rollout restart statefulset/keycloak -n keycloak`) to refresh its internal Infinispan client cache.
  * Verified that `GET /auth` with `redirect_uri=https://learnhouse.vgurukool.com/auth/callback/keycloak` now renders the Keycloak Sign In form (`HTTP 200 OK`).



