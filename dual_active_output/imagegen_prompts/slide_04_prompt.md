Use case: productivity-visual
Asset type: content-only PowerPoint implementation body-region image, image-based PPT.
Production strategy: 文档理解生图
Layout pattern: 实施泳道流程

Create a premium implementation runbook infographic for dual-active cutover logic: migration, rehearsal, validation, formal traffic switching, and fallback. This is a content-only PowerPoint body-region image, not a full PPT slide. Target aspect ratio about 2.10:1, equivalent to 1890 x 900 px, for placement at x=15 y=140 w=1890 h=900 inside a final 1920 x 1080 slide. Fill most of the 1890 x 900 body region with useful visual content and normal internal margins; avoid a small centered visual island, sparse poster layout, or large unused outer bands.

Evidence boundary: use only these source-supported cutover facts:
- Database migration solution: UGO 结构迁移, DRS 全量 + 增量同步, 数据校验, 流量回放.
- Cutover planning: new and old core trial-run in parallel, then direct system switching.
- Process labels from source: 前期准备, 数值移植, 回放/CDC, 开放并行, 白名单验证, 主机停运, 回退, 投产成功, 决策上线.
- Switching methods: 单轨切换, 双轨切换, 应用双写, Java 拦截器, 全局流量网关.
- Key technical topics: 切换演练, 混沌工程, 服务治理, 灰度发布.

Layout:
- Three horizontal swimlanes: "数据迁移", "业务验证", "流量切换".
- Main timeline steps from left to right:
  1. 前期准备
  2. UGO 结构迁移
  3. DRS 全量 + 增量
  4. 数据校验
  5. 回放 / CDC
  6. 并行试跑
  7. 白名单验证
  8. 正式切流
  9. 回退预案
- Add side method cards: 单轨切换, 双轨切换, 应用双写, 全局流量网关.
- Use decision diamonds for "核对一致？" and "验证通过？"; show fallback arrow to "问题修正 / 回退".

Required Chinese labels must be legible and concise. Do not include lengthy paragraphs.

Template body-region requirements:
- Do not render the final slide title, company logo, Huawei logo, company name, footer, page number, watermark, or template marks.
- This body image will be placed at x=15 y=140 w=1890 h=900 inside a final 1920 x 1080 slide.

Visual style:
- Fixed Trust&far palette: blue timeline and lane headers, teal-green validation/success, orange for cutover milestone and risk/fallback.
- Clean consulting process design, crisp arrows, numbered steps, readable labels, white/light background.

Avoid: implying one-click cutover without validation, unsupported automation claims, fake title/logo/footer/page number, dense tiny text, decorative scenes unrelated to the process.
