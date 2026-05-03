# 最终 QA 记录

- 生成时间：2026-05-03
- 源文件：`project_doc.pptx`
- 输出目录：`dual_active_output/`
- 生成方式：imagegen 正文区图片 + Trust&far 模板确定性拼装 + 图片型 PPTX。

## 产物

| 产物 | 路径 | 结果 |
|---|---|---|
| 最终 PPTX | `output/huawei_dual_active_5pages.pptx` | 已生成 |
| 最终图片包 | `output/huawei_dual_active_final_images.zip` | 已生成 |
| 最终页图 | `slides_png/slide_01_final.png` - `slides_png/slide_05_final.png` | 已生成 |
| 拼装预览 | `previews/compose_contact_sheet.png` | 已生成 |
| 源证据卡 | `source_extract/evidence_cards.md` | 已生成 |
| 页面简报 | `page_briefs.md` | 已生成 |
| imagegen 提示词 | `imagegen_prompts/slide_01_prompt.md` - `slide_05_prompt.md` | 已通过预检 |

## 结构校验

- imagegen prompt preflight：5/5 通过，0 failures。
- 最终页图数量：5。
- 最终页图尺寸：全部 `1920 x 1080`。
- 最终页图非空检查：全部通过，平均通道标准差分别为 `62.15`, `70.13`, `61.45`, `57.74`, `71.10`。
- PPTX slide XML 数量：5。
- PPTX 实际媒体图片数量：5。
- PPTX 文件大小：`10040135` bytes。

## 人工预览结论

- 模板标题、右上角矢量 Logo、页脚均已叠加。
- 正文区没有明显被标题区或页脚遮挡。
- 接触表预览显示 5 页主题覆盖：架构总览、关键特性、可靠性设计、切换逻辑、业务价值。
- 第 4 页信息密度最高，适合作为流程型说明页；后续如需要对外精修，可针对关键步骤文字做一次人工校对和局部重生图。

