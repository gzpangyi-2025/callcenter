# 5 页页面简报

## Slide 1 架构总览：华为分布式新核心双活数据中心架构

- Production strategy: 架构逻辑卡生图
- Purpose: 用一张拓扑说明双活数据中心与异地容灾的整体架构。
- Source evidence: E01, E02, E04, E06, E10
- Key message: 同城双活承载核心交易连续运行，异地中心提供跨 Region 容灾，云底座、微服务、中间件、分布式数据库和运维监控形成完整能力栈。
- Content budget: 4 个站点/区域、5 层平台栈、3 条流向、3 个 KPI chip。
- Layout pattern / Visual form: 三中心拓扑 + 分层能力栈。
- Density: 高，避免微小文字。
- QA focus: 不生成标题、Logo、页脚；不写不受支持的全局“零损失/秒级自动切换”承诺。

## Slide 2 关键特性：金融级双活的核心能力栈

- Production strategy: 文档理解生图
- Purpose: 汇总双活架构支撑金融新核心的关键能力。
- Source evidence: E02, E05, E07, E12
- Key message: 金融级双活不是单一容灾能力，而是应用、数据库、中间件、发布治理、运维可观测的组合能力。
- Content budget: 6 个能力模块、8 个关键特性、1 条底部总结。
- Layout pattern / Visual form: 中央能力环 + 两侧能力卡片矩阵。
- Density: 中高。
- QA focus: 组件名称只用源文件出现过的 ServiceStage、CSE、CCE、GaussDB、DCS、MQS、APM。

## Slide 3 可靠性设计：从组件高可用到跨中心容灾

- Production strategy: 架构逻辑卡生图
- Purpose: 展示双活数据中心如何覆盖从单点故障到城市级故障的可靠性设计。
- Source evidence: E04, E07, E09, E10, E11
- Key message: 通过同城双活、仲裁 AZ、数据库高可用、两地三中心、可观测和故障定界，实现多层级可靠性。
- Content budget: 5 层故障场景、5 个设计响应、4 个指标 chip。
- Layout pattern / Visual form: 可靠性阶梯 + 故障场景矩阵。
- Density: 高。
- QA focus: `RPO=0`、`RTO<10 mins`、`60s`、`83%` 标注为源资料/案例口径。

## Slide 4 切换逻辑：迁移、演练与故障切换路径

- Production strategy: 文档理解生图
- Purpose: 把数据库迁移、并行验证、演练、切流和回退串成可理解的实施路径。
- Source evidence: E05, E08, E09, E11
- Key message: 切换不是单一动作，而是从结构迁移、数据同步、校验回放、并行验证到白名单验证和正式切流的闭环流程。
- Content budget: 8 个步骤、3 条泳道、4 种切换方式。
- Layout pattern / Visual form: 实施泳道流程。
- Density: 高。
- QA focus: 保持流程方向清晰；不要把演练和正式切流混成一个动作。

## Slide 5 业务价值：连续经营与平滑演进收益

- Production strategy: 概念视觉生图
- Purpose: 从业务和管理视角总结双活数据中心建设价值。
- Source evidence: E01, E03, E07, E11, E12
- Key message: 双活架构支撑 7X24 稳定运行、弹性扩容、敏捷创新、信创合规、迁移风险可控和长期成本优化。
- Content budget: 6 个价值支柱、1 个收益闭环、1 条底部结论。
- Layout pattern / Visual form: 价值仪表盘 + 闭环飞轮。
- Density: 中。
- QA focus: 以“收益方向”表述，避免没有源证据的财务金额或上线周期承诺。

