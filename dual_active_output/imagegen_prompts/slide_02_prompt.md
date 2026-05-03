Use case: productivity-visual
Asset type: content-only PowerPoint capability body-region image, image-based PPT.
Production strategy: 文档理解生图
Layout pattern: 中央能力环 + 两侧能力卡片矩阵

Create a polished consulting-style capability infographic for the key features of a financial-grade distributed new core dual-active architecture. This is a content-only PowerPoint body-region image, not a full PPT slide. Target aspect ratio about 2.10:1, equivalent to 1890 x 900 px, for placement at x=15 y=140 w=1890 h=900 inside a final 1920 x 1080 slide. Fill most of the 1890 x 900 body region with useful visual content and normal internal margins; avoid a small centered visual island, sparse poster layout, or large unused outer bands.

Evidence boundary: use only these source-supported concepts:
- Financial-grade targets: 5 个 9, 金融级双活, 灾备, 高扩展, 弹性伸缩, 一键式扩容.
- Financial new core traits: 超大容量, 高并发, 复杂事务, 极低时延, 7X24 长期稳定性, 无感切换, 多云多库, RTO/RPO, 高安全, 客户体验.
- Technical topics: 7X24 日切, 热点账户, 灰度发布, 服务治理, 幂等, 超时, 混沌工程, 切换演练.
- Components that may be shown: ServiceStage, CSE, CCE, GaussDB, DCS, MQS, APM.

Layout:
- Center: circular hub labeled "金融级双活能力栈".
- Six surrounding capability cards:
  1. "应用韧性": 7X24 日切, 幂等, 超时治理
  2. "流量治理": 灰度发布, 服务治理, 全链路防护
  3. "数据连续": GaussDB, RTO/RPO, 多云多库
  4. "弹性扩展": 弹性伸缩, 一键式扩容, 高并发
  5. "运维可观测": APM, 链路追踪, 告警分析
  6. "演练验证": 混沌工程, 切换演练, 业务验证
- Bottom conclusion strip inside body region: "从应用、数据、流量、运维到演练形成端到端双活闭环".

Required Chinese labels should be large and readable. Keep text concise; no long paragraphs.

Template body-region requirements:
- Do not render the final slide title, company logo, Huawei logo, company name, footer, page number, watermark, or template marks.
- This body image will be assembled at x=15 y=140 w=1890 h=900 inside a final 1920 x 1080 slide.

Visual style:
- Use fixed Trust&far palette: deep company blue #003B66, primary process blue #003B8F, Trust blue #005BAC, teal-green #008C96, success green #16A34A, highlight orange #FF6A00.
- White/light background, light-blue card borders, dark-blue section headers, clean enterprise line icons.
- Blue for core structure and headers; teal-green for resilience/switching/verification; orange only for milestones, time, risk, or emphasis.
- Avoid random pink, brown, beige, dominant purple, or single-hue blue-only theme.

Avoid: invented TPS, unsupported customer names, fake title/logo/footer/page number, unreadable tiny labels, decorative objects unrelated to the capability map.
