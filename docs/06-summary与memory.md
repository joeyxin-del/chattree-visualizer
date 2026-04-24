
# 会话摘要与记忆（Summary & Memory）

本文整理多轮对话产品中 **摘要（Summary）** 与 **记忆（Memory）** 的常见分工、生成时机、成本与 UI 侧含义，供实现「树节点一句话梗概」、会话级上下文管理等功能时参考。

---

## 1. 主路径上不要强依赖「现算摘要」

- **原则**：不要在任意用户请求的主路径上，**同步强依赖**大模型生成摘要；否则用户发消息/拉列表的耗时会与摘要质量、模型负载强绑定，体验与稳定性都差。
- **更合适**：用 **异步任务**（队列、后台 job）在会话更新后维护摘要；读展示（列表、树节点 hover、侧栏等）**只读已落库结果**。
- **参考做法**：如 [Honcho 文档 · Summarizer](https://docs.honcho.dev/v2/documentation/core-concepts/summarizer) 所述，用 LLM 做摘要在工程上会引入**不可避免的处理时间**，因此不应让**终端用户的单次业务请求**承担该延迟，而应放在异步管线中执行。

---

## 2. 异步摘要与 UI 占位 / 降级

- **事实**：摘要在任务队列中生成时，**大批量写入消息后**，摘要可能 **数秒到数分钟** 才就绪（取决于队列、模型、批量大小等）。
- **对 UI 的含义**：
  - 在摘要未就绪时，必须有 **占位**（如节点标题、首条用户问题截断、时间等元数据）；
  - 摘要生成完成后 **原地替换** 或 **下次进入视图时** 再展示，避免空白或长等待。
- **结论**：**「有摘要时显示摘要，没有时也不崩」** 是产品级默认，而不是「等摘要出来才给看列表」。

---

## 3. 多轮上下文里的常见策略（与每轮全量摘要对题）

- **滑动窗口（Sliding Window）**：只保留最近 k 轮/若干 token 的原文，老内容丢弃或不再进上下文；实现简单、延迟低，但老细节会丢。
- **达到阈值再摘要（Threshold / Batch）**：例如轮数、token 数、时间超过某阈值，才对**旧段**做一次压缩，**避免每轮都「概括全世界」**。
- **「旧段摘要 + 新段原文」混合**：远历史用短摘要，近期保留原文；与各类「SummaryBuffer / Summary + Buffer」式_memory 的表述一致，有利于平衡成本与可引用性。

以上策略的对比与取舍，可参见 [上下文窗口与扩展对话](https://www.abstractalgorithms.dev/context-window-management-strategies-for-long-documents-and-extended-conversations) 等文对 **Buffer / Window / Summary / 混合** 的归纳。

---

## 4. 成本：为何慎用「每轮都跑 SummaryMemory」

- 若**每一轮**对话都触发一次**全量或增量**的链式摘要（类似部分框架里的 **SummaryMemory** 全量模式），会接近 **多一次模型调用/轮** 的额外成本，有实践文章指出在高流量下会接近 **「双倍调用」** 量级感受。
- **生产上更常见**：**阈值触发**、**批处理**、**异步**，而不是每条消息都同步更新一份「完整人生总结」。

---

## 5. Summary（整段压缩）与 Selective Memory（关键事实）不是一回事

| 维度 | Summary（摘要） | Selective Memory / 关键事实 |
| --- | --- | --- |
| 目的 | 用更短文字覆盖较长对话的**整体语义** | 只抽取**值得长期保留**的事实、偏好、实体关系等 |
| 特点 | 偏**泛**、有损压缩，专名/数字/代码块易被概括掉 | 偏**可检索、可复用**，适合长期个性化与精准召回 |
| 典型用途 | 上下文长度控制、人类可读的「梗概/预览」 | 用户画像、长期偏好、跨会话复现 |

[Mem0 等文章](https://mem0.ai/blog/llm-chat-history-summarization-guide-2025) 也强调：从「全历史压缩」走向「选什么值得记」，是高质量长期记忆系统常见升级路径。

- **对「树节点一句话梗概」**：多数情况下只需 **Summary 体系里最浅的一层**（极短、面向人的一句），**不必**与内部 Agent 用于推理的**长记忆 / 知识图谱**混为同一字段；若以后要精细个性化，再单独设计 **关键事实** 的存储与更新策略。

---

## 6. 可落地的设计口诀

1. **写路径**：消息落库 / 会话状态变更 → **异步**更新摘要；主请求不等待摘要完成。  
2. **读路径**：只读**已持久化**的摘要或降级字段。  
3. **更新策略**：**阈值 + 批处理/异步** 优先于「每轮全量重摘要」。  
4. **概念分层**：**展示用一句梗概**、**模型上下文用长摘要/窗口**、**长期个性化用选摘事实**，三者可共用数据来源，但**字段与刷新频率**宜分开想。

---

## 7. 参考链接（外站）

- [Honcho · Summarizer](https://docs.honcho.dev/v2/documentation/core-concepts/summarizer) — 摘要异步化、不阻塞用户请求。  
- [Context Window Management（Abstract Algorithms）](https://www.abstractalgorithms.dev/context-window-management-strategies-for-long-documents-and-extended-conversations) — 多种记忆与摘要策略对比。  
- [LLM Chat History Summarization（Mem0）](https://mem0.ai/blog/llm-chat-history-summarization-guide-2025) — 摘要与记忆形成、层次化记忆。  
- [LangChain Memory 与对话摘要](https://www.abstractalgorithms.dev/langchain-memory-conversation-history-and-summarization) — 各类 Memory 的代价与取舍。  

（链接均为撰写时可用的公开资料，实现时以你们栈内选型与数据模型为准。）
