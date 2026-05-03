Use case: infographic-diagram
Asset type: content-only PowerPoint reliability body-region image, image-based PPT.
Production strategy: 架构逻辑卡生图
Layout pattern: 可靠性阶梯 + 故障场景矩阵

Create a high-quality reliability design infographic for a dual-active distributed new core. This is a content-only PowerPoint body-region image, not a full PPT slide. Target aspect ratio about 2.10:1, equivalent to 1890 x 900 px, for placement at x=15 y=140 w=1890 h=900 inside a final 1920 x 1080 slide. Fill most of the 1890 x 900 body region with useful visual content and normal internal margins; avoid a small centered visual island, sparse poster layout, or large unused outer bands.

Evidence boundary: use only these source-supported reliability facts:
- High availability / DR designs include 同城应用双活（跨 AZ）, 同城应用双活（跨 Region）, 异地应用容灾（跨 Region）, 两地三中心容灾.
- Database design work includes 同城数据库架构分析, 两地三中心架构分析, 数据库集群部署架构设计, 数据库高可用分析, 应用无损透明切换设计.
- Case evidence: two service AZs plus one arbitration AZ; can resist single-point failure, AZ room failure, network disconnect between AZs, and city-level failure.
- Metrics from source/case: RPO=0, RTO<10 mins, 60s切换, RTO减少83%.

Layout:
- Left: vertical reliability ladder with five levels: "组件故障", "节点/单点故障", "AZ 故障", "AZ 间网络断连", "城市级故障".
- Middle: response design cards aligned to each level: "集群高可用", "业务 AZ 对等部署", "仲裁 AZ 辅助决策", "同城复制 + 双活接入", "异地容灾恢复".
- Right: compact architecture mini-map showing AZ1, AZ2, 仲裁 AZ, 异地中心 with data/control arrows.
- Top or side KPI chips: "RPO=0（案例）", "RTO<10 mins（需求）", "60s 切换（案例）", "83% RTO 降幅（案例）".
- Bottom: monitoring strip labeled "AOM/APM/LTS 可观测、故障定界、恢复闭环".

Required Chinese labels: 同城双活, 两地三中心, 仲裁 AZ, 高可用, 可恢复, 可观测, 故障定界, 应用无损透明切换.

Template body-region requirements:
- Do not render the final slide title, company logo, Huawei logo, company name, footer, page number, watermark, or template marks.
- This body image will be placed at x=15 y=140 w=1890 h=900 in the final 1920 x 1080 slide.

Visual style:
- Use fixed Trust&far blue/teal/orange palette. Blue for structure and reliability ladder, teal-green for recovery/success path, orange only for risk/failure and time-metric emphasis.
- White background, crisp technical cards, light-blue borders, enterprise icons, readable Chinese labels.

Avoid: unsupported universal zero-data-loss or second-level recovery claims, excessive red alarm visuals, fake logo/title/footer/page number, microtext.
