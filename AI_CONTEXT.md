# AI Assistant Context & Developer Guidelines

> [!IMPORTANT]
> **TO ANY FUTURE AI ASSISTANTS:**
> Please read this document carefully before making any modifications to the codebase or executing deployment scripts. It contains critical passwords, architectural differences between local and production environments, and rules established through past debugging sessions.

## 1. Server Infrastructure & Credentials

### 1.1 Local macOS Machine
- **SSH User:** `root` (or local user)
- **Root Password:** `matrox`
- **Nginx Config:** `/opt/homebrew/etc/nginx/servers/callcenter.conf` (Reload with `sudo nginx -s reload`)

### 1.2 Shanghai Production Node (Frontend/App/TURN)
- **Public IP:** `101.43.59.206`
- **Internal IP:** `10.0.0.17`
- **SSH User:** `root`
- **SSH Password:** `Matrox123#`
- **OS:** OpenCloudOS 9.4 (2C2G)
- **Role:** Main business server, runs CallCenter backend/frontend, and **coturn** service.
- **coturn Credentials:** User `callcenter`, Password `Trustfar2026!`
- **Project Directory:** `/var/www/callcenter`
- **Backend Service:** Managed by PM2. Process name: `callcenter-backend`

### 1.3 Tokyo AI & Proxy Node (Worker/Large Model/Proxy)
- **Public IP:** `43.130.240.106`
- **Internal IP:** `10.7.0.17`
- **SSH User:** `root`
- **SSH Password:** `Matrox12345%`
- **OS:** OpenCloudOS 9.4 (2C4G)
- **Role:** AI Task Worker, Global AI Model Access, Private Proxy Server.
- **BBR Enabled:** TCP BBR congestion control is enabled for maximum cross-border speed.
- **3X-UI Panel:** `http://43.130.240.106:2053` (Admin/Admin), managed via Docker.
- **Elasticsearch:** Dedicated ES 8 instance with **IK Chinese Analyzer** (Port 9200).
- **Future Plan:** Will run a background Worker to poll tasks from Shanghai node and process via OpenAI/Gemini/Claude.

### 1.4 Network Diagnostics
- **Diagnostic Tool:** Both nodes have `/root/check_ai_network.sh` installed.
- **Usage:** Run `./check_ai_network.sh` to verify public IP, latency to AI APIs, and local service (ES) health.

---

## 2. Environment Variables & Data Services

### 2.1 Database (MySQL)
- **Local & Prod Host:** `localhost` (Both environments run their own local MySQL instance)
- **User:** `root`
- **Password:** ` ` (Empty password)
- **Database Name:** `callcenter`

### 2.2 Elasticsearch (Critical Differences)
There is a fundamental difference between the local and production Elasticsearch setups.

**Local Environment:**
- **Startup:** Runs via Docker. Ensure the local ES Docker container (version `8.13.0`) is started before running the backend.
- **URL:** `http://127.0.0.1:9200`
- **Authentication:** None
- **Analyzer:** `standard` (The local Docker image `8.13.0` does **NOT** have the IK Chinese analyzer plugin installed).

**Production Environment (192.168.50.51):**
- **URL:** `https://localhost:9200` (HTTPS is required)
- **User:** `elastic`
- **Password:** `cAgckF9S6aTF8rRWXY8j`
- **Analyzer:** `ik_max_word` / `ik_smart` (Production ES *has* the IK plugin).
- **TLS:** `ES_TLS_REJECT_UNAUTHORIZED_PROD=false` is set in `.env` to bypass self-signed cert checks.

> [!WARNING]
> The backend `SearchService` dynamically checks `process.env.NODE_ENV`. If `production`, it uses `ik_max_word`. Otherwise, it uses `standard`. **Do not force the IK analyzer in local development, as it will crash the NestJS app during index initialization.**

### 2.3 Tencent Cloud COS (Object Storage)
- **Purpose:** The system utilizes Tencent Cloud COS for robust file storage, superseding local directory storage.
- **Buckets (Region: ap-guangzhou):**
  - **Local Environment:** `callcenter-local-1425043423`
  - **Production Environment:** `callcenter-1425043423`
- **Credentials:** Configured in the `.env` file via `COS_SECRET_ID`, `COS_SECRET_KEY`, and `COS_BUCKET`.
---

## 3. Deployment & Syncing Rules

### 3.1 The Sync Script (`sync.sh`)
- Code is pushed to production using the `/Users/yipang/Documents/Antigravity/callcenter/sync.sh` script.
- **Note:** The script has been updated to sync to BOTH the local production node (`192.168.50.51`) and the Shanghai node (`101.43.59.206`) simultaneously.
- **NEVER** remove the `--exclude '.env'` flag from this script. A past incident occurred where the local `.env` overwrote the production `.env`, bringing down the production Elasticsearch connection.

### 3.2 Frontend Compilation
- The `sync.sh` script only syncs the source code.
- If you modify frontend files (`frontend/src/*`), you **MUST** SSH into the production server, navigate to `/var/www/callcenter/frontend`, and **run `npm run build` (NEVER `npm run dev`)** to compile the changes for production. The production environment relies strictly on the compiled static files in the `dist` directory.

### 3.3 Git Workflow & Code Commits
- **Always Commit Before Deploying:** Once a bug fix or feature is completed and tested locally, the AI Assistant MUST execute `git add .`, `git commit -m "..."`, and `git push` to save the work to the remote GitHub repository BEFORE running the `sync.sh` deployment script.
- **Rollbacks:** If a modification causes system failure, utilize `git restore .` (for uncommitted changes) or `git revert <commit_hash>` to safely roll back.

---

## 4. Known Architectural Behaviors

### 4.1 WebRTC (Screen Sharing & Voice Chat)
- **Topology:** The system uses a Mesh P2P architecture.
- **Signaling:** Handled via NestJS WebSockets (`chat.gateway.ts`).
- **Glare Condition Prevention:** In `useVoiceChat.ts`, only the *newly joined user* initiates the SDP Offer. Existing users in the room wait for the Offer to generate an Answer. Do not make "early arrivals" send Offers, as this causes a Glare condition (Offer collision) and breaks audio.
- **Screen Share Bandwidth:** Because it is a Mesh topology, the Sharer must upload the stream `N` times. If >4 users watch a screen share, the Sharer's uplink bandwidth or the TURN server bandwidth will likely become a severe bottleneck.

---

## 5. Development & Codebase Rules

### 5.1 TypeORM EventSubscriber Warning
- **DO NOT** use TypeORM `@EventSubscriber` (like `@AfterInsert`) to synchronize critical data to external systems (e.g., syncing new messages to Elasticsearch). 
- **Reason:** We experienced bugs where TypeORM subscribers caused silent failures or transaction deadlocks. Always use explicit service calls (e.g., `SearchService.indexMessage`) within the primary transaction/service method.

### 5.2 Large Payload Limits
- **Rule:** The NestJS backend payload limit has been manually increased to **20MB** to support large Base64 images embedded in BBS Markdown posts.
- **Action:** If developing new upload features that fail with a 413 "Payload Too Large" error, check and adjust the `json` and `urlencoded` limits in `main.ts`.

### 5.3 Frontend UI Standards
- **Rule:** The frontend interface strictly uses **React + Ant Design (`antd`)**. 
- **Warning:** Do NOT introduce `TailwindCSS` or other conflicting UI libraries unless explicitly requested by the user, to ensure a cohesive and premium visual style.

### 5.4 Ticket Room Authorization (Lock Mechanism)
- **Rule:** Ticket chat rooms feature a dynamic locking mechanism (`isRoomLocked` and `isExternalLinkDisabled`).
- **Action:** When modifying `chat.gateway.ts` (WebSocket Gateway), ensure any new event handlers or message broadcasts strictly respect the `isAuthorizedForRoom()` permission checks to prevent internal data leaks to unauthorized external URLs.
