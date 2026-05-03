# 架构逻辑卡

## 1. 架构总览：华为分布式新核心双活数据中心架构

### Evidence Boundary

- Evidence IDs: E01, E02, E04, E06, E10
- Source files and locations: `project_doc.pptx` Slide 10, 12, 16, 31
- Sensitivity: internal source, genericized customer naming
- Allowed metrics: `5 个 9`, `RPO=0` as case/data-center evidence, `60s` as case switching evidence
- Do not claim: all workloads are always active-active, universal zero data loss, automatic second-level recovery

### Evidence Facts

| Evidence | Source | Diagram expression |
|---|---|---|
| 云化分布式架构包含 IaaS、微服务、容器、中间件、分布式交易数据库 | Slide 10 | layered platform stack |
| 同城双活可跨 AZ / Region，异地容灾可跨 Region，两地三中心为同城双活 + 异地容灾 | Slide 12 | three-site topology |
| 生产云可单 Region 跨同城中心，异地灾备 Region | Slide 16 | DC1/DC2 plus remote DR |
| 两个业务 AZ 对等部署，仲裁 AZ 辅助仲裁不接入业务 | Slide 31 | AZ1/AZ2 active service, AZ3 quorum |

### Diagram Logic

- Main topology: 主数据中心、同城双活中心、仲裁 AZ、异地灾备中心。
- Main flows: 用户/渠道流量接入两个业务 AZ；核心交易服务在两侧对等部署；GaussDB/分布式数据库进行同城一致性复制；异地中心承担容灾复制与恢复。
- Required modules: IaaS 云底座、CCE/CSE/ServiceStage、DCS/MQS、GaussDB、AOM/APM/LTS、应用网关。
- KPI chips: `5 个 9`, `RPO=0`, `60s 案例切换`.
- QA focus: topology clarity, no unsupported universal SLA claims.

## 2. 关键特性：金融级双活的核心能力栈

### Evidence Boundary

- Evidence IDs: E02, E05, E07, E12
- Source files and locations: `project_doc.pptx` Slide 10, 12, 13, 18, 24, 27
- Allowed metrics: `5 个 9`, `7X24`
- Do not claim: exact TPS unless copied from source; do not invent named customer.

### Diagram Logic

- Visual form: capability matrix around application, database, middleware, operations, release/governance.
- Required capabilities: 高并发、复杂事务、低时延、弹性扩容、无感切换、多云多库、RTO/RPO、高安全、客户体验。
- Supported technical topics: 7X24 日切、热点账户、灰度发布、服务治理、幂等、超时、混沌工程、切换演练。

## 3. 可靠性设计：从组件高可用到跨中心容灾

### Evidence Boundary

- Evidence IDs: E04, E07, E09, E10, E11
- Source files and locations: `project_doc.pptx` Slide 12, 27, 29, 31, 48
- Allowed metrics: `RPO=0`, `RTO<10 mins`, `60s`, `83%` as source/case labels

### Diagram Logic

- Visual form: reliability architecture ladder.
- Layers: 单点故障、AZ 故障、AZ 间网络断连、城市级故障、异地灾备。
- Techniques: 数据库集群部署、高可用分析、同城/两地三中心架构分析、应用无损透明切换、可观测与故障定界。

## 4. 切换逻辑：迁移、演练、并行验证到正式切流

### Evidence Boundary

- Evidence IDs: E05, E08, E09, E11
- Source files and locations: `project_doc.pptx` Slide 12, 13, 28, 29, 48, 49

### Diagram Logic

- Visual form: swimlane cutover runbook.
- Stages: 前期准备、UGO 结构迁移、DRS 全量 + 增量、数据校验、流量回放 / CDC、并行验证、白名单验证、正式切流、回退预案。
- Cutover methods: 单轨切换、双轨切换、应用双写、Java 拦截器、全局流量网关。

## 5. 业务价值：连续经营、平滑演进与综合成本优化

### Evidence Boundary

- Evidence IDs: E01, E03, E07, E11, E12
- Source files and locations: `project_doc.pptx` Slide 10, 11, 18, 27, 48, 49, 57

### Diagram Logic

- Visual form: value dashboard.
- Value pillars: 业务连续性、弹性扩展、敏捷创新、迁移风险可控、信创合规、运维可观测、长期成本优化。
- Evidence anchors: 7X24 长期稳定性、无感切换、RTO/RPO、高安全、生产系统逐步过渡、分布式架构综合使用成本随容量提升优于集中式。

