

# 1 Active DataGuard
## 1.1 新特性介绍
### 1.1.1 Far Sync
#### 1.1.1.1 背景与设计目标
在传统 DataGuard 中，日志传输只有两种方式：

+ **SYNC（同步）**：主库等待备库确认收到日志后才提交，保证零数据丢失（RPO=0），但主备之间的网络延迟直接影响主库事务响应时间。
+ **ASYNC（异步）**：主库不等待备库确认，性能好，但存在数据丢失风险。

在"两地三中心"或跨城市容灾场景中，主库与备库距离远（网络延迟可达几十毫秒），若使用 SYNC 模式会严重影响主库性能；若使用 ASYNC 又无法满足 RPO=0 的要求。

**Far Sync 实例**正是为解决这一矛盾而生：通过在主库附近部署一个轻量级中转实例，主库以同步方式传送日志到 Far Sync（低延迟），Far Sync 再以异步方式转发给远端备库，从而**同时实现零数据丢失和低性能影响**。

#### 1.1.1.2 Far Sync 实例的本质
Far Sync 实例**不是完整数据库**，它具有以下特征：

| 特征 | 说明 |
| --- | --- |
| 包含的文件 | 仅有密码文件（orapwd）、参数文件（spfile/pfile）、控制文件、Standby Redo Log |
| 没有的文件 | **没有数据文件**，无法打开数据库供用户访问 |
| 日志不会应用 | 仅作为日志中转站，不 apply redo，不支持查询 |
| 状态 | 始终运行在 MOUNT 状态 |
| 支持数量 | 一个 Far Sync 实例最多可以向 29 个目标转发 |


> **注意**：Far Sync 实例应部署在主库附近（低延迟），与备库之间可以有较大距离。不应与主库在同一机房，否则区域性灾难会导致同时失效。
>

#### 1.1.1.3 典型架构
```plain
Primary DB ──SYNC──▶ Far Sync Instance ──ASYNC──▶ Physical Standby
（同城/低延迟）       （日志中转，仅MOUNT）         （异地/高延迟）
```

**增强版（级联 + 扇形分发）**：

```plain
Primary ──SYNC──▶ Far Sync ──ASYNC──▶ Standby 1（同城备）
                              ASYNC──▶ Standby 2（异地备）
                              ASYNC──▶ Standby 3（DR备）
```

#### 1.1.1.4 与普通 DataGuard 的对比
| 特性 | 普通 DataGuard | Far Sync |
| --- | --- | --- |
| 复制模式 | SYNC 或 ASYNC 直达备库 | 先 SYNC 到 Far Sync，再 ASYNC 到备库 |
| 网络延迟影响 | 直接受主备物理距离影响 | 主库只受主库→Far Sync 距离影响（低延迟） |
| 数据丢失风险 | SYNC 时零丢失但性能差；ASYNC 时有风险 | 可以零丢失，同时保持低延迟 |
| 架构复杂度 | 简单（主-备） | 需额外部署和维护 Far Sync 实例 |
| 存储需求 | 备库需完整数据文件 | Far Sync 无需数据文件，极小存储 |
| 适用场景 | 同城或高质量网络 | **跨地域、高延迟容灾** |


#### 1.1.1.5 主要保护模式配合
Far Sync 最常与 **Maximum Availability（最大可用）** 模式配合使用：

+ Primary → Far Sync：`SYNC AFFIRM`（或 `FASTSYNC = SYNC NOAFFIRM`）
+ Far Sync → Standby：`ASYNC`

**FASTSYNC**（Oracle 12c R2 引入）= SYNC + NOAFFIRM：

+ 主库发送日志后只需确认 Far Sync 实例"已接收到内存中"，无需等待 Far Sync 写入磁盘
+ 相比 SYNC AFFIRM 进一步降低主库提交等待时间

### 1.1.2 多实例Redo Apply
#### 1.1.2.1 背景
在 Oracle 12.2 之前，对于物理备库的 Redo Apply（MRP 进程），**在 RAC 备库环境中只能在一个实例上运行 MRP0 进程**，其他实例上只能有辅助的 `pr*` 进程协助，整体存在单点瓶颈。

从 **Oracle Database 12.2.0.1** 开始，引入了 **Multi-Instance Redo Apply（多实例 Redo 应用）**特性，允许在 RAC 备库的多个实例上同时运行 MRP 主进程，真正实现并行化 Redo Apply。

#### 1.1.2.2 适用前提条件
| 条件 | 说明 |
| --- | --- |
| 备库类型 | **必须是 Oracle RAC 或 RAC One Node** 数据库 |
| 版本要求 | Oracle 12.2.0.1 及以上 |
| 实例状态 | 所有参与 Apply 的实例**状态必须一致**（全部 OPEN 或全部 MOUNT） |
| BCT 限制 | 12.2/18c 不支持块变更跟踪（BCT），**19c 已解除此限制** |
| In-Memory | 18c 不能同时开启 In-Memory 列存储，**19c 已解除此限制** |


> **补充**：19c 同步解除了多实例 Redo Apply 与 BCT、In-Memory 列存储不兼容的限制，使多实例 Apply 更加实用。
>

#### 1.1.2.3 工作原理
```plain
RAC 物理备库（3节点）

实例 1 ── MRP0（主控进程）
           │
           ├── 分派 Redo 块给实例 2
           └── 分派 Redo 块给实例 3

实例 2 ── pr00（Apply worker）
实例 3 ── pr01（Apply worker）
```

+ MRP0 负责读取 Standby Redo Log，协调分派工作
+ 各实例上的 `pr*` 进程并行应用 Redo 数据
+ 节点间通过私网（Interconnect）传递 Redo 块，需要充足的私网带宽

#### 1.1.2.4 启用与配置命令
```sql
-- 在备库上启动多实例 Redo Apply（所有实例）
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE 
  DISCONNECT FROM SESSION INSTANCES ALL;

-- 指定仅在 2 个实例上启动
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE 
  DISCONNECT FROM SESSION INSTANCES 2;

-- 查看实时 Apply 进程分布（各节点均执行）
SELECT INST_ID, PROCESS, STATUS, SEQUENCE#, BLOCK#
FROM GV$MANAGED_STANDBY
WHERE PROCESS LIKE 'MRP%' OR PROCESS LIKE 'PR%'
ORDER BY INST_ID, PROCESS;

-- 监控恢复进度（在 MRP0 所在实例执行）
SELECT * FROM V$RECOVERY_PROGRESS;
```

#### 1.1.2.5 使用场景与建议
| 场景 | 建议 |
| --- | --- |
| 主库产生大量 Redo（OLTP 高并发） | 开启多实例 Apply，可显著降低备库应用延迟 |
| 备库 RAC 节点较多（3节点以上） | 合理分配 Apply 节点数，避免私网过载 |
| 需要同时使用 BCT 或 In-Memory | 升级到 Oracle 19c 后可并用 |
| 单实例备库 | **无法使用**此特性 |


#### 1.1.2.6 停止多实例 Apply
```sql
-- 取消所有实例的 MRP
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE CANCEL;

-- 重新以单实例模式启动（默认）
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE 
  DISCONNECT FROM SESSION;
```

#### 1.1.2.7 注意事项
+ 多实例 Apply 时，节点间需通过 RAC Interconnect 传输 Redo 数据，**私网带宽和延迟是关键**
+ `V$RECOVERY_PROGRESS` 视图仅在 **MRP0 所在实例**上有数据
+ 若多实例 Apply 运行时执行 Switchover，需先 CANCEL MRP，完成切换后重新启动

### 1.1.3 ADG中Dml自动重定向
#### 1.1.3.1 背景与意义
Active Data Guard（ADG）备库默认以 **READ ONLY WITH APPLY** 状态运行，只能执行查询，不允许 DML 操作。在实际生产中，常出现以下场景：

+ 报表系统连接到 ADG 备库，偶尔需要将查询结果写入汇总表
+ 应用程序误将写操作路由到备库
+ 希望在备库上运行包含 DML 的存储过程

在 19c 之前，这类操作会收到 `ORA-16000: 数据库因物理备库而以只读模式开启` 的报错，用户必须切换连接到主库执行。

Oracle 19c（18c 作为隐含参数预览）引入 **ADG DML Redirection**：将备库上的 DML 操作**透明地自动重定向到主库执行**，在保证 ACID 特性的前提下，大大增强了备库实用性，实现了**应用层面的读写分离透明化**。

#### 1.1.3.2 实现原理
```plain
用户连接备库 ──DML操作──▶ 备库内部 DB Link ──▶ 主库执行 DML
                                                    │
                                                    ▼ Redo 日志产生
备库 MRP 应用 Redo ◀──── Redo 传输 ◀──────────── 主库日志流
                                                    │
用户在备库收到执行结果 ◀── 备库等待日志同步完成（standby query scn advance）
```

**详细步骤**：

1. 用户在 ADG 备库会话中执行 DML（如 `INSERT INTO t1 ...`）
2. 备库通过**内部 DB Link** 将 DML 语句转发至主库
3. 主库执行 DML，生成 Redo 日志
4. Redo 日志传输至备库，由 MRP 进程实时应用
5. 备库等待相关数据块同步后，客户端收到成功响应

**通过 10046 跟踪可见的内部等待事件**：

+ `SQL*Net message to dblink`（DML 通过 DB Link 发送主库）
+ `standby query scn advance`（等待备库 SCN 推进到主库提交时的值）

#### 1.1.3.3 版本历史
| 版本 | 状态 | 参数 |
| --- | --- | --- |
| Oracle 18c | 隐含参数（预览） | `_enable_proxy_adg_redirect = TRUE` |
| Oracle 19c | **正式发布** | `ADG_REDIRECT_DML = TRUE`（显式参数） |
| Oracle 21c+ | 继续增强 | 支持更多 DDL 重定向场景 |


#### 1.1.3.4 参数配置
**系统级启用（所有会话生效）**

```sql
-- 在备库上执行
ALTER SYSTEM SET ADG_REDIRECT_DML = TRUE SCOPE = BOTH;

-- 验证
SHOW PARAMETER ADG_REDIRECT_DML;
```

**会话级启用（仅当前会话生效）**

```sql
-- 会话级启用（推荐用于精确控制）
ALTER SESSION ENABLE ADG_REDIRECT_DML;

-- 会话级禁用
ALTER SESSION DISABLE ADG_REDIRECT_DML;
```

> **优先级**：会话级设置覆盖系统级设置。
>

#### 1.1.3.5 限制条件
| 限制项 | 说明 |
| --- | --- |
| **用户限制** | SYS 用户的 DML 无法重定向，报 `ORA-16397` |
| **操作类型** | 仅支持 DML（INSERT/UPDATE/DELETE/MERGE），**DDL 不支持** |
| **XA 事务** | 不支持 Oracle XA 分布式事务 |
| **全局临时表** | 19c 中可通过 `_alter_adg_redirect_behavior` 控制是否允许 GTT 重定向 |
| **性能影响** | 每个 DML 都有主库往返延迟，**不适合高频 DML** |
| **DBLINK 配置** | 主备库的服务名、TNS 必须正确，内部 DB Link 依赖此配置 |


#### 1.1.3.6 典型应用场景
| 场景 | 说明 |
| --- | --- |
| 报表系统写汇总表 | 报表查询在备库运行，汇总结果写入时自动重定向到主库 |
| 应用读写分离 | 大部分读走备库，偶发写操作自动路由，无需应用层判断 |
| 运维临时操作 | 运维人员在备库上执行临时 UPDATE，避免登录主库 |


## 1.1.4 RMAN Recover Standby（12c→18c→19c 演进）
#### 1.1.4.1 背景：备库 GAP 问题
当备库与主库的日志同步中断（网络故障、备库重启等），且主库已将对应归档日志删除时，备库出现 **GAP（日志间隙）**，MRP 进程停止并报类似以下错误：

```plain
MRP0: Background Media Recovery terminated with error 1194
ORA-01194: file 1 needs more recovery to be consistent
FAL[client]: Failed to request gap sequence# ...
```

传统解决方案（11g）需要手动多步操作，Oracle 逐版本简化了这一流程。

#### 1.1.4.2 各版本 GAP 修复方案对比
| 版本 | 方案 | 关键命令 | 特点 |
| --- | --- | --- | --- |
| **11g 及以前** | 手动增量备份恢复 | 10+ 步骤（见下详述） | 步骤繁琐，易出错，需传输文件 |
| **Oracle 12c** | RECOVER FROM SERVICE | `RECOVER DATABASE FROM SERVICE <svc> NOREDO USING COMPRESSED BACKUPSET;` | 自动从主库拉取增量备份，但需手动处理控制文件和文件路径 |
| **Oracle 18c** | RECOVER STANDBY FROM SERVICE | `RECOVER STANDBY DATABASE FROM SERVICE <svc>;` | **一键在线刷新**，自动处理控制文件、数据文件、日志路径 |
| **Oracle 19c** | 延续 18c，增强优化 | 同 18c，支持 SECTION SIZE 并行 | 更高效、更稳定，支持压缩加密 |


**11g 手动修复步骤（共 10+ 步）**

```sql
-- 1. 备库查询当前 SCN
SELECT CURRENT_SCN FROM V$DATABASE;

-- 2. 主库创建备库控制文件
ALTER DATABASE CREATE STANDBY CONTROLFILE AS '/tmp/stdby.ctl';

-- 3. 主库基于备库 SCN 做增量备份
RMAN> BACKUP INCREMENTAL FROM SCN 12345678 DATABASE FORMAT '/tmp/incr_%U.bak';

-- 4. 手动将备份文件和控制文件 scp 到备库

-- 5. 备库停止 MRP
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE CANCEL;

-- 6. 备库关库，使用新控制文件启动到 MOUNT
SHUTDOWN ABORT;
STARTUP NOMOUNT;
RESTORE STANDBY CONTROLFILE FROM '/tmp/stdby.ctl';
ALTER DATABASE MOUNT STANDBY DATABASE;

-- 7. CATALOG 备份
RMAN> CATALOG START WITH '/tmp/incr';

-- 8. 应用增量备份
RECOVER DATABASE NOREDO;

-- 9. 重命名在线日志（如路径不同）
-- 10. 重新启动 MRP
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE 
  USING CURRENT LOGFILE DISCONNECT FROM SESSION;
```

#### 1.1.4.3 Oracle 12c：RECOVER FROM SERVICE
Oracle 12c 引入了 `RESTORE/RECOVER ... FROM SERVICE` 语法，通过**网络**直接从主库或另一备库获取备份，无需手动传输文件。

**12c 操作步骤**

```sql
-- ① 备库取消 MRP
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE CANCEL;

-- ② 备库记录当前最大 SCN
SELECT CURRENT_SCN FROM V$DATABASE;

-- ③ 关库重启到 NOMOUNT（若控制文件也需刷新）
SHUTDOWN ABORT;
STARTUP NOMOUNT;

-- ④ 从主库恢复控制文件并 MOUNT
RMAN> RESTORE STANDBY CONTROLFILE FROM SERVICE primary_svc;
RMAN> ALTER DATABASE MOUNT;

-- ⑤ 恢复数据文件（从主库自动拉取增量）
RMAN> RECOVER DATABASE FROM SERVICE primary_svc NOREDO 
      USING COMPRESSED BACKUPSET;

-- ⑥ 处理文件路径（若主备路径不同，需重命名）
RMAN> SWITCH DATABASE TO COPY;

-- ⑦ 重新启动 MRP
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE 
  USING CURRENT LOGFILE DISCONNECT;
```

> **注意**：12c 版本需要手动处理数据文件路径不一致和临时文件的问题。
>

#### 1.1.4.4 Oracle 18c：RECOVER STANDBY DATABASE FROM SERVICE（一键刷新）
Oracle 18c 对命令做了升级封装，使用 `RECOVER STANDBY DATABASE FROM SERVICE` 实现**完全自动化**：

```sql
-- ① 取消备库日志应用
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE CANCEL;

-- ② 一键刷新备库（18c 核心命令）
RMAN> RECOVER STANDBY DATABASE FROM SERVICE primary_svc;
```

**RMAN 自动完成以下所有操作**：

1. 重启备库实例（如需要）
2. 从主库刷新控制文件
3. 自动重命名数据文件、临时文件到备库对应路径
4. 还原主库中新增的数据文件
5. 基于增量备份将备库恢复至最新状态
6. 处理在线 Redo Log 路径

```sql
-- ③ 重新启动 MRP
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE 
  USING CURRENT LOGFILE DISCONNECT;
```

#### 1.1.4.5 Oracle 19c：增强版 FROM SERVICE
Oracle 19c 在 18c 基础上进一步优化，新增如下能力：

```sql
-- 支持分段并行传输（SECTION SIZE，提升大文件恢复速度）
RECOVER STANDBY DATABASE FROM SERVICE primary_svc SECTION SIZE 120M;

-- 支持压缩备份集（减少网络传输量）
RECOVER STANDBY DATABASE FROM SERVICE primary_svc 
  USING COMPRESSED BACKUPSET;

-- 支持加密传输
SET ENCRYPTION ALGORITHM 'AES128';
RECOVER STANDBY DATABASE FROM SERVICE primary_svc;

-- 支持从备库恢复（cascade standby 场景）
RECOVER STANDBY DATABASE FROM SERVICE cascade_standby_svc;
```

### 1.1.5 Standby Nologging 两种模式
#### 1.1.5.1 背景：NOLOGGING 的困扰
在主库执行批量数据加载（如 ETL、数据仓库装载）时，常使用 `NOLOGGING` 选项以提升性能（减少 Redo 生成量）。但在 DataGuard 环境中，这会导致：

1. 备库接收到的 Redo 中，NOLOGGING 操作对应的数据块标记为**已损坏**（`db file sequential read` 时报 `ORA-26040`）
2. ADG 备库上这些数据块无法被正常查询（影响读写分离的可用性）
3. 若发生 Failover，备库提升为主库后，NOLOGGING 相关的表数据可能需要重新加载

**传统解决方案**：

+ 在主库开启 `FORCE LOGGING`：强制所有操作都写 Redo，消除 NOLOGGING 效果，但会显著降低数据加载性能

Oracle 18c 引入了 **Standby Nologging** 的两种新模式，在保持主库高性能的同时，保护备库数据的完整性。

#### 1.1.5.2 Standby Nologging for Load Performance（加载性能优先）
**工作原理**

```plain
主库执行 NOLOGGING 操作
    │
    ▼
主库通过独立连接直接向备库发送加载的数据块
    │
    ├─ 备库及时接收 → 数据块正常应用
    │
    └─ 备库/网络跟不上 → 停止发送，记录缺失块ID
                              │
                              ▼
                    备库 MRP 进程从主库自动拉取缺失块
                    （后台异步修复，最终一致）
```

**特点**：

+ 主库提交**不等待**备库确认，主库性能最优
+ 若网络带宽不足，数据块可以延迟到备库，备库通过 MRP 进程后台自动修复
+ 备库可能存在**短暂数据延迟**，但最终会达到一致

**配置命令**

```sql
-- 在主库执行（数据库须为 MOUNT 或 OPEN 状态）
ALTER DATABASE SET STANDBY NOLOGGING FOR LOAD PERFORMANCE;

-- 验证
SELECT LOG_MODE, FORCE_LOGGING, SUPPLEMENTAL_LOG_DATA_MIN,
       SUPPLEMENTAL_LOG_DATA_PK, SUPPLEMENTAL_LOG_DATA_UI,
       CDB FROM V$DATABASE;
       
-- 查看当前 Standby Nologging 模式
SELECT FLASHBACK_ON FROM V$DATABASE;  -- 也可查看 DATAGUARD 相关参数视图
```

#### 1.1.5.3 Standby Nologging for Data Availability（数据可用性优先）
**工作原理**

```plain
主库执行 NOLOGGING 操作
    │
    ▼
主库通过独立连接将加载的数据块发送到每个备库
    │
    ├─ 流量控制（throttling）：根据备库能力调节发送速率
    │
    └─ 主库等待所有备库确认接收后才提交
              │
              ▼
    备库获得强一致的数据，始终可以正常查询
```

**特点**：

+ 主库提交**会延迟**，需等待所有 ADG 备库确认数据块已接收
+ 主库对备库有流量控制，不会因为发送过快而压垮备库
+ 备库数据**始终可用**，ADG 只读查询不会遇到数据块损坏

**配置命令**

```sql
-- 在主库执行
ALTER DATABASE SET STANDBY NOLOGGING FOR DATA AVAILABILITY;
```

> **注意**：此模式下主库会因等待备库响应而有**一定性能开销**，尤其是当备库网络延迟较高时。
>

#### 1.1.5.4 两种模式的选择依据
| 考量因素 | 选 Load Performance | 选 Data Availability |
| --- | --- | --- |
| 主库加载速度是否优先 | ✅ 是 | ❌ 否 |
| 备库随时可用是否必须 | ❌ 可短暂不一致 | ✅ 是 |
| 网络带宽是否充足 | 不要求 | 要求充足 |
| 是否接受短暂数据延迟 | ✅ 可以 | ❌ 不能 |
| ADG 承载关键查询业务 | 不适合（有短暂延迟） | ✅ 适合 |
| 批量加载 ETL 场景 | ✅ 优先选择 | 可选（性能有所降低） |


#### 1.1.5.5 与多实例 Redo Apply 的兼容性
> ⚠️ **注意**：当备库配置了多实例 Redo Apply 时，启用 Standby Nologging 模式可能会触发错误 `ORA-10892`，导致多实例 Apply 停止。
>

处理方式：

1. 停止多实例 Apply（`ALTER DATABASE RECOVER MANAGED STANDBY DATABASE CANCEL`）
2. 启用 Standby Nologging 模式，执行批量加载
3. 加载完成后，重新以多实例模式启动 Apply

#### 1.1.5.7 平台支持说明
**完整功能支持**（包括自动块修复）仅在以下平台可用：

+ Oracle Database Appliance（ODA）
+ Oracle Exadata Database Machine
+ Exadata Cloud Service
+ Database Cloud Service Enterprise Edition - Extreme Performance

在普通平台上，18c/19c 的 `ALTER DATABASE SET STANDBY NOLOGGING FOR ...` 命令可用，但**自动块修复**功能受限。

## 1.2 日常状态检查
### 1.2.1 主库检查脚本
#### 1.2.1.1 检查数据库角色和状态
```sql
-- 检查实例状态
SELECT instance_name, status FROM v$instance;

-- 检查数据库基本信息（角色、保护模式）
SELECT name, db_unique_name, open_mode, database_role, 
       protection_mode, switchover_status, dataguard_broker, force_logging 
FROM v$database;
```

#### 1.2.1.2 检查归档传输目标状态
```sql
-- 检查所有归档目标状态（STATUS=VALID 且 ERROR 列为空表示正常）
SET LINE 200
COL dest_name FOR a30
COL error FOR a50
SELECT dest_name, status, target, process, error
FROM v$archive_dest
WHERE dest_name IN ('LOG_ARCHIVE_DEST_1','LOG_ARCHIVE_DEST_2',
                    'LOG_ARCHIVE_DEST_3','LOG_ARCHIVE_DEST_4')
  AND status != 'INACTIVE';

-- 更详细的归档目标状态
SELECT dest_name, status, type, error 
FROM v$archive_dest_status 
WHERE dest_name IN ('LOG_ARCHIVE_DEST_1','LOG_ARCHIVE_DEST_2');

-- 检查归档目标是否有 GAP
SELECT status, gap_status 
FROM v$archive_dest_status 
WHERE dest_id = 2;
```

#### 1.2.1.3 检查归档日志传输和应用情况
```sql
-- 查看最近20条归档日志应用状态
SET LINES 200
COL name FOR a70
ALTER SESSION SET nls_date_format='yyyy-mm-dd hh24:mi:ss';
SELECT * FROM (
  SELECT recid, name, thread#, sequence#, resetlogs_time, 
         first_time, applied, status
  FROM v$archived_log
  ORDER BY sequence# DESC
) WHERE rownum <= 20;
```

#### 1.2.1.4 检查主库 DG 进程状态
```sql
-- 检查 LNS（日志发送进程）状态，正常状态应为 WRITING
SELECT process, status, sequence#, thread# 
FROM v$managed_standby;
```

#### 1.2.1.5 检查是否存在日志 GAP（在主库执行）
```sql
-- 查询主库检测到的 GAP，有结果说明备库存在缺失日志
SELECT thread#, low_sequence#, high_sequence# 
FROM v$archive_gap;
```

#### 1.2.1.6 检查主备库序列号差值
```sql
-- 在主备库分别执行，对比 MAX(SEQUENCE#) 差值应 ≤ 1
SELECT thread#, MAX(sequence#) AS max_seq
FROM v$archived_log
WHERE resetlogs_change# = (
  SELECT resetlogs_change# FROM v$database_incarnation WHERE status = 'CURRENT'
)
GROUP BY thread#;
```

#### 1.2.1.7 检查 DG 状态消息
```sql
col message format a100
SELECT timestamp, message, severity FROM v$dataguard_status 
WHERE severity NOT IN ('Informational','Control')
ORDER BY timestamp DESC;
```

---

### 1.2.2 备库检查脚本
#### 1.2.2.1 检查备库角色和打开模式
```sql
-- ADG 正常状态：DATABASE_ROLE=PHYSICAL STANDBY，OPEN_MODE=READ ONLY WITH APPLY
SET LINESIZE 200
COL db_unique_name FOR a20
COL database_role FOR a20
COL open_mode FOR a25
SELECT name, db_unique_name, database_role, open_mode, switchover_status
FROM v$database;
```

#### 1.2.2.2 检查备库关键进程
```sql
-- 查看 RFS（接收进程）和 MRP0（应用进程）状态
SET LINESIZE 200
COL process FOR a10
COL status FOR a20
SELECT process, status, thread#, sequence# 
FROM v$managed_standby;
```

**MRP0 进程状态速查表：**

| MRP0 状态 | 含义 | 紧急程度 |
| --- | --- | --- |
| `APPLYING_LOG` | 正常应用日志 | 正常 ✅ |
| `WAIT_FOR_LOG` | 等待新日志传输 | 注意 ⚠️ |
| `WAIT_FOR_GAP` | 等待缺失归档日志 | 警告 🔶 |
| `NOT ALLOWED` | 配置错误或角色异常 | 严重 🔴 |


#### 1.2.2.3 检查备库延迟（最重要的健康指标）
```sql
-- 查看传输延迟和应用延迟（建议阈值：均 ≤ 5 分钟）
SET LINES 200
COL name FOR a30
COL value FOR a30
SELECT name, value, unit, time_computed 
FROM v$dataguard_stats
WHERE name IN ('transport lag', 'apply lag', 'apply finish time', 'estimated startup time');

-- 也可使用
SELECT * FROM v$dataguard_stats;
```

#### 1.2.2.4 检查备库 GAP（归档缺失）
```sql
-- 在备库执行，有结果表示存在缺失日志
SELECT thread#, low_sequence#, high_sequence# 
FROM v$archive_gap;
```

#### 1.2.2.5 检查未应用的归档日志数量
```sql
-- 统计备库未应用的归档日志数量，持续增长需关注
SELECT thread#, COUNT(*) AS unapplied_count
FROM v$archived_log
WHERE applied = 'NO'
GROUP BY thread#;
```

#### 1.2.2.6 检查 DG 状态消息
```sql
col message format a100
SELECT timestamp, message, severity FROM v$dataguard_status 
WHERE severity NOT IN ('Informational','Control','Warning')
ORDER BY timestamp DESC;
```

---

### 1.2.3 官方检查脚本
[pstdby_prm_diag_v3.sql](https://www.yuque.com/attachments/yuque/0/2026/sql/26525834/1776002329787-d3620881-4979-4f05-9997-4e145d17f222.sql)

[pstdby_stb_diag_v3.sql](https://www.yuque.com/attachments/yuque/0/2026/sql/26525834/1776002374298-8cdecc38-df33-49c2-ab20-32ef681fa805.sql)

## 1.3 GAP修复
**DG GAP（DataGuard Gap / 归档裂缝）**：当备库未能接收到主库的一个或多个归档日志文件时，主备库之间出现日志序列号不连续的间隙，称为"GAP"。

GAP 会导致：

+ 主备库数据同步中断
+ MRP0 进程进入 `WAIT_FOR_GAP` 状态并停止应用日志
+ 备库数据落后于主库，灾备能力受损

**GAP 的两种情况**

| 情况 | 描述 | 修复难度 |
| --- | --- | --- |
| **情况 A**：主库归档日志存在 | 日志未传输但仍在主库磁盘上或可从备份恢复 | 简单（自动或手动注册） |
| **情况 B**：主库归档日志已丢失 | 日志被删除或磁盘损坏 | 复杂（需增量备份修复） |


### 1.3.1 GAP 产生原因
1. **网络中断**：主备库之间网络故障导致归档日志无法传输
2. **备库停机时间过长**：备库维护期间主库产生大量归档日志
3. **磁盘空间不足**：备库归档目录满，拒绝接收新归档
4. **FAL 参数未配置**：`FAL_SERVER`/`FAL_CLIENT` 未正确设置，无法自动补传
5. **人为误操作**：主库归档被提前删除

### 1.3.2 GAP 发现方法
#### 1.3.2.1 查询 v$archive_gap 视图（备库执行，最直接）
```sql
-- 在备库执行
-- 有结果表示存在 GAP，LOW_SEQUENCE# 到 HIGH_SEQUENCE# 为缺失范围
SELECT thread#, low_sequence#, high_sequence# 
FROM v$archive_gap;
```

#### 1.3.2.2 示例告警输出（来自 alert.log）：
```plain
Media Recovery Waiting for thread 1 sequence 7057
Fetching gap sequence in thread 1, gap sequence 7057-7080
FAL[client]: Error fetching gap sequence, no FAL server specified
FAL[client]: Failed to request gap sequence
GAP - thread 1 sequence 7057-7080
```

#### 1.3.2.3 对比主备库最大序列号
```sql
-- ==== 在主库执行 ====
SELECT thread#, MAX(sequence#) AS primary_max_seq
FROM v$archived_log
WHERE resetlogs_change# = (
  SELECT resetlogs_change# FROM v$database_incarnation WHERE status = 'CURRENT'
)
GROUP BY thread#;

-- ==== 在备库执行 ====
SELECT thread#, MAX(sequence#) AS standby_max_seq
FROM v$archived_log
WHERE applied = 'YES'
GROUP BY thread#;
-- 若主库序列号 - 备库序列号 > 1，存在 GAP
```

#### 1.3.2.4 查询备库已应用的最大序列号
```sql
-- 在备库执行
SELECT MAX(sequence#) AS max_applied_seq
FROM v$archived_log 
WHERE applied = 'YES';

-- 查看 MRP 当前等待的序列号
SELECT process, status, sequence# 
FROM v$managed_standby 
WHERE process = 'MRP0';
-- STATUS = 'WAIT_FOR_GAP' 且 SEQUENCE# 即为缺失起始序列号
```

#### 1.3.2.5：通过 v$archive_dest_status
```sql
-- 在主库执行
SELECT status, gap_status 
FROM v$archive_dest_status 
WHERE dest_id = 2;
-- gap_status 非空表示存在 GAP
```

### 1.3.3 GAP 修复方法（按场景分类）
+ **情况 A：主库归档日志存在时的修复**

#### A-1：自动修复（FAL 机制）
**前提**：`FAL_SERVER` 和 `FAL_CLIENT` 已正确配置。

```sql
-- 检查备库 FAL 参数配置
SHOW PARAMETER fal_server;
SHOW PARAMETER fal_client;

-- 若未配置，手动设置（备库执行）
ALTER SYSTEM SET fal_server = 'prod_service_name' SCOPE=BOTH;
ALTER SYSTEM SET fal_client = 'stdby_service_name' SCOPE=BOTH;

-- 重启 MRP 触发自动 FAL 获取
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE CANCEL;
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE DISCONNECT FROM SESSION;
```

配置后 FAL 工作原理：

+ 主库 ARCn 进程每分钟检查备库 GAP，自动重发缺失日志
+ 备库 FAL 客户端主动向主库（FAL_SERVER）请求缺失的归档日志

#### A-2：恢复缺失的归档日志（适合少量缺失日志）
**Step 1：在备库查询缺失的序列号范围**

```sql
SELECT thread#, low_sequence#, high_sequence# FROM v$archive_gap;
-- 例如：THREAD#=1, LOW_SEQUENCE#=7057, HIGH_SEQUENCE#=7080
-- 有些情况下，只会缺失若干位于GAP位置的归档日志，后续的归档日志已传至备库
SELECT thread#, MIN(sequence#) AS lowest_seq, 
MAX(sequence#) AS highest_seq, COUNT(*) AS unapplied_count
FROM v$archived_log
WHERE applied = 'NO'
GROUP BY thread#
ORDER BY 1;
```

**Step 2：在主库恢复缺失的归档日志**

```sql
-- 在主库查询归档日志备份情况
RMAN> list backup of archivelog all summary;

-- 查询指定的归档日志备份
RMAN> list backup of archivelog sequence between 7057 and 7080 thread 1;
```

**Step 3：主库恢复归档文件**

```bash
RMAN> restore archivelog sequence between 7057 and 7080 thread 1;
```

**Step 4：重启 MRP 验证**

```sql
-- 重启 MRP
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE CANCEL;
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE DISCONNECT FROM SESSION;

-- 验证 GAP 消除
SELECT thread#, low_sequence#, high_sequence# FROM v$archive_gap;
-- 应返回0行
```

---

+ **情况 B：主库归档日志已丢失时的修复（按版本）**

#### B-1：Oracle 11g 修复（基于 SCN 增量备份方式）
> 适用版本：Oracle 11g（11.2.0.4 推荐）
>

**Step 1：查询备库当前 SCN**

```sql
-- 在备库执行
SELECT TO_CHAR(current_scn) AS standby_scn FROM v$database;
-- 记录此 SCN 值，例如：12345678
```

**Step 2：在主库创建备库控制文件**

```sql
-- 在主库执行
ALTER DATABASE CREATE STANDBY CONTROLFILE AS '/tmp/standby.ctl';
```

**Step 3：在主库基于备库 SCN 做增量备份**

```bash
# 在主库执行 RMAN
rman target /

RMAN> RUN {
  BACKUP INCREMENTAL FROM SCN 12345678 DATABASE 
  FORMAT '/tmp/incre_%U' 
  TAG 'FOR_STANDBY_GAP';
}
```

**Step 4：将备份文件传输到备库**

```bash
scp /tmp/incre_* oracle@standby_host:/tmp/
scp /tmp/standby.ctl oracle@standby_host:/tmp/
```

**Step 5：在备库停止 MRP 并关闭数据库**

```sql
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE CANCEL;
SHUTDOWN IMMEDIATE;
```

**Step 6：在备库恢复控制文件并启动到 MOUNT**

```bash
rman target /

RMAN> STARTUP NOMOUNT;
RMAN> RESTORE CONTROLFILE FROM '/tmp/standby.ctl';
RMAN> ALTER DATABASE MOUNT;
```

**Step 7：注册增量备份并恢复**

```bash
RMAN> CATALOG START WITH '/tmp/incre_';
RMAN> RECOVER DATABASE NOREDO;
```

**Step 8：打开备库并重启 MRP**

```sql
ALTER DATABASE OPEN READ ONLY;
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE 
  USING CURRENT LOGFILE DISCONNECT;

-- 验证同步恢复
SELECT * FROM v$archive_gap;
SELECT name, value FROM v$dataguard_stats 
WHERE name IN ('transport lag','apply lag');
```

---

#### B-2：Oracle 12c 修复（RECOVER FROM SERVICE 方式）
> 适用版本：Oracle 12c、12c R2
>

**Step 1：备库查询当前 SCN（记录用）**

```sql
SELECT current_scn FROM v$database;
```

**Step 2：备库停止 MRP 并启动到 NOMOUNT**

```sql
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE CANCEL;
SHUTDOWN IMMEDIATE;
STARTUP NOMOUNT;
```

**Step 3：通过 RMAN 从主库恢复控制文件**

```bash
rman target /

RMAN> RESTORE STANDBY CONTROLFILE FROM SERVICE prod_service_name;
RMAN> ALTER DATABASE MOUNT;
```

**Step 4：从主库直接恢复数据库（RECOVER FROM SERVICE）**

```bash
RMAN> RECOVER DATABASE FROM SERVICE prod_service_name 
      NOREDO 
      USING COMPRESSED BACKUPSET;
```

**Step 5：恢复新增数据文件（如有）**

```bash
# 若有新增数据文件未在备库，补充恢复
RMAN> RESTORE DATAFILE <file_number> FROM SERVICE prod_service_name;
```

**Step 6：重新启动日志应用**

```sql
ALTER DATABASE OPEN READ ONLY;
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE 
  USING CURRENT LOGFILE DISCONNECT;
```

---

#### B-3：Oracle 18c/19c 修复（一键修复方式，强烈推荐）
> 适用版本：Oracle 18c、19c 及以上  
**这是目前最简单、自动化程度最高的方式**
>

**一条命令完成所有修复**：

```bash
rman target /

# 一键刷新备库（自动执行所有恢复步骤）
RMAN> RECOVER STANDBY DATABASE FROM SERVICE prod_service_name;
```

此命令自动完成：

1. 重启备库实例
2. 从主库刷新控制文件
3. 自动重命名数据文件、临时文件、在线重做日志
4. 还原主库上新增的数据文件
5. 将备库数据同步到最新状态

**Step 2：修复完成后启动日志应用**

```sql
-- 若需要调整文件管理模式
ALTER SYSTEM SET standby_file_management = AUTO;

-- 启动 MRP
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE 
  USING CURRENT LOGFILE DISCONNECT;

-- 验证
SELECT * FROM v$archive_gap;
SELECT name, value FROM v$dataguard_stats 
WHERE name IN ('transport lag','apply lag');
```

---

### 1.3.4 GAP 预防措施
#### 1.3.4.1 正确配置 FAL 参数
```sql
-- 在备库设置（确保主库可以自动补传缺失日志）
ALTER SYSTEM SET fal_server = 'primary_tns_alias' SCOPE=BOTH;
ALTER SYSTEM SET fal_client = 'standby_tns_alias' SCOPE=BOTH;
```

#### 1.3.4.2 合理设置归档保留策略（防止主库归档被提前删除）
```bash
# RMAN 中设置保留策略（保留足够时间用于 GAP 自动修复）
RMAN> CONFIGURE ARCHIVELOG DELETION POLICY TO APPLIED ON ALL STANDBY;
# 或设置保留天数
RMAN> CONFIGURE ARCHIVELOG RETENTION POLICY TO RECOVERY WINDOW OF 7 DAYS;
```

#### 1.3.4.3 监控备库磁盘空间（防止因空间不足拒绝接收归档）
```sql
-- 定期检查备库归档目录使用率
SELECT dest_name, dest_size FROM v$archive_dest WHERE dest_id = 2;
```

#### 1.3.4.4 定期检查 FAL 配置有效性
```sql
-- 在备库验证 FAL 配置
SELECT name, value FROM v$parameter 
WHERE name IN ('fal_server','fal_client');

-- 通过 DG Broker 验证网络连通性
DGMGRL> VALIDATE NETWORK CONFIGURATION;
```

#### 1.3.4.5. 设置合理的监控告警阈值
建议对以下指标设置告警：

+ `apply lag` > 30 分钟 → 告警
+ `transport lag` > 15 分钟 → 告警
+ `v$archive_gap` 有记录 → 立即告警
+ MRP0 进程状态 = `WAIT_FOR_GAP` → 立即告警

---

