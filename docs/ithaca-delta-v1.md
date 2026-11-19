# ithaca.delta.v1 — 个人层可迁移协议规范

状态：**已实现**（odysseus_spike src/ithaca/；framework 分支同构）。本规范钉死格式，迁移实现以此为契约。

## 定位（与共识协议的正交性）

| 协议 | 通信面 | 状态 |
|---|---|---|
| MCP | agent ↔ 工具 | 已采纳（src/tools/mcp-client.ts） |
| A2A（ACP 并入中） | agent ↔ agent | 未采纳（单 agent） |
| **ithaca.delta.v1** | **心智 ↔ 心智（跨模型/框架/时间）** | 本规范 |

三者正交：A2A/MCP 都不携带"一个心智的个人层"——目标、价值观锚点、身份事实。当模型升级、框架换代或换 provider 时，唯一需要迁移的就是这个层。

## 格式

```json
{
  "schema": "ithaca.delta.v1",
  "exportedAt": 1763500000000,
  "source": "odysseus-spike",
  "core": {
    "schema": "ithaca.core.v1",
    "tasks":    [{ "id": "<uuid>", "text": "...", "addedAt": 0 }],
    "values":   [{ "id": "<uuid>", "text": "...", "addedAt": 0 }],
    "identity": [{ "id": "<uuid>", "text": "...", "addedAt": 0 }],
    "revision": 0,
    "updatedAt": 0
  }
}
```

## 语义

- **provider/模型无关**：`core` 不含任何模型名、prompt、工具引用——只有人类可读的陈述
- **merge**：按 `(section, id)` 去重，已有条目不动（两侧并行演化后合流）
- **replace**：整核替换为目标 delta（新起点）
- **写通道**：只有用户显式命令（`/ithaca export|import`）可产生/导入 delta；任何对话/推理路径不得触达
- **校验**：schema 不符一律拒绝（`ProtectedCoreError`），绝不静默降级（静默清空 = 食莲）

## 迁移场景

1. **换模型**（GLM → 其他）：导出 → 新模型环境导入——记忆的"带得走"（Transferable）性质
2. **换框架**（Spike → 后续形态）：格式与框架零耦合，core 五字段即可重建
3. **多设备**：export → 传输 → import merge

## 交换

`/ithaca export [file]`（默认 `.odysseus/ithaca-delta.json`）· `/ithaca import <file> [merge|replace]`
