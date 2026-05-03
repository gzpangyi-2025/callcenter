Use case: infographic-diagram
Asset type: content-only PowerPoint architecture body-region image, image-based PPT.
Production strategy: 架构逻辑卡生图
Layout pattern: 三中心拓扑 + 分层能力栈

Create a premium customer-facing architecture infographic for a Huawei distributed new core dual-active data-center architecture. This is a content-only body-region image, not a full PPT slide. Target aspect ratio about 2.10:1, equivalent to 1890 x 900 px, for placement at x=15 y=140 w=1890 h=900 inside a final 1920 x 1080 slide. Fill most of the 1890 x 900 body region with useful visual content and normal internal margins; avoid a small centered visual island, sparse poster layout, or large unused outer bands.

Evidence boundary: use only these facts from the source PPT:
- Cloud-native distributed new core stack: IaaS 云底座, 微服务框架, 云原生容器, 中间件, 分布式交易数据库, 大数据/融合分析平台.
- High-availability patterns: 同城应用双活（跨 AZ）, 同城应用双活（跨 Region）, 异地应用容灾（跨 Region）, 两地三中心（同城双活 + 异地跨 Region 容灾）.
- Case deployment pattern: 生产云单 Region 跨同城中心部署, 主数据中心 + 同城中心 + 异地灾备 Region.
- Case database topology: 两个业务 AZ 对等部署, 仲裁 AZ 辅助仲裁且不接入业务, 异地灾备中心可单节点或 3 节点部署.

Architecture layout:
- Left zone: "主数据中心 / AZ1" with core application services and GaussDB primary service icons.
- Center zone: "同城双活中心 / AZ2" as equal peer service zone, connected with thick teal bidirectional business/data arrows.
- Small upper-middle zone: "仲裁 AZ" with quorum/ETCD/CMS style control icons, clearly labeled "辅助仲裁，不接入业务".
- Right zone: "异地灾备中心 / 跨 Region" with recovery cluster and remote replication lane.
- Bottom stack: IaaS 云底座, CCE/CSE/ServiceStage, DCS/MQS, GaussDB, AOM/APM/LTS.
- KPI chips: "5 个 9", "RPO=0（案例口径）", "60s 切换（案例口径）".
- Add a concise legend for flows: 业务访问, 同城复制, 异地容灾复制, 运维监控.

Required Chinese labels: 主数据中心, 同城双活中心, 仲裁 AZ, 异地灾备中心, 核心交易服务, 分布式交易数据库, 云原生容器, 微服务框架, 中间件, 运维可观测.

Template body-region requirements:
- Do not render the final slide title, company logo, Huawei logo, company name, footer, page number, watermark, or template marks.
- Leave no fake header or footer bands; this body image will be assembled under deterministic Trust&far template elements.

Visual style:
- Use the fixed Trust&far company color system: deep company blue #003B66, primary process blue #003B8F, Trust blue #005BAC, teal-green #008C96, success green #16A34A, and highlight orange #FF6A00.
- Blue owns structural headers, site boundaries, platform layers, main arrows, and primary icons.
- Teal-green owns switching, validation, recovery, success, and normal/ready states.
- Orange is limited to completion, time, warning, risk, or milestone emphasis.
- Use light blue #EAF4FF, pale teal #E7F7F8, pale orange #FFF3E6, white cards, crisp light-blue borders, and neutral text #334155.
- Clean enterprise technology style, dense but readable, polished isometric data-center icons only where they explain the topology.

Avoid: unsupported all-workload active-active claim, universal zero-data-loss claim, automatic second-level recovery claim, generic cloud decoration, random pink/brown/beige, fake logos, unreadable microtext.

