# 执行假设

- 输出范围：仅生成 5 页正文型介绍页，不额外生成封面、目录或章节页。
- 输出形式：视觉优先图片型 PPTX；正文内容由 imagegen 生成正文区图片，标题、Logo、页脚由银信公司模板确定性叠加。
- 模板：使用 `ppt-generation` skill 默认银信公司模板 Brand Profile。
- 正文区：每页生成 content-only body-region image，目标比例约 2.10:1，对应 `1890 x 900 px`，最终放入 `1920 x 1080` PPT 画布的 `x=15 y=140 w=1890 h=900`。
- 品牌：使用 Trust&far 蓝 / 青绿 / 橙色系统，Logo 使用 `/Users/yipang/Documents/Codex/PPT生成/公司模版/银信图标.svg`。
- 页面主题：架构总览、关键特性、可靠性设计、切换逻辑、业务价值。
- 事实口径：源文件优先 + 合理归纳；硬性指标只使用 `project_doc.pptx` 中出现的指标或明确标注为案例口径。
- 页码：按默认模板规则，不显示可见页码。

