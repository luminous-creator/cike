# 此刻（Cike）v0.3

一个本地优先的个人行动工作台。v0.3 的重点：**打开就告诉你现在做哪一件。** 说一句「我想做什么」，它会判断这是哪类事、按研究证据给出做法，并且每条建议都要过规则检查。

## 今天页

不是计划表，只回答一件事：现在做什么。

- 顶部一张卡：现在做的这件、为什么是它、第一步。三个按钮：**做完了 / 换一件 / 今天不做**。
- 下面最多两件「也可以」，固定时段还没到的放「今天还有」（到点提醒），再往下是「明天」。
- 做完一件会直接提示下一件；晨间通知只点名第一件。
- 「让 AI 排一下」：规则先算出候选，模型只在候选里挑顺序、写理由和第一步，被校验器检查后才显示，当天有效。
- 去掉了 v0.2 打开就弹出的逾期确认框。

## 快速开始（Windows）

1. 双击 `start-cike.bat`。第一次运行会自动安装依赖，然后打开 http://localhost:3000
2. 接入 DeepSeek：编辑项目根目录的 `.env`，把密钥填在 `DEEPSEEK_API_KEY=` 后面，然后重启。

不填密钥也能用：规划和复盘会按策略库的规则运行。

```bash
npm install
npm run dev        # 开发：http://localhost:3000
npm test           # 23 个测试
npm run build      # 生产构建
npm start          # 运行 dist/boot.js（PORT 可改端口）
```

## 模型接入

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` / `AI_API_KEY` | — | 有它就用自配接口 |
| `AI_BASE_URL` | `https://api.deepseek.com` | 任何 OpenAI 兼容接口都行 |
| `AI_MODEL` | `deepseek-flash` | DeepSeek-V4.1-Flash-1017 |
| `AI_REASONING_EFFORT` | `low` | 复盘时的思考强度：none / low / high / max |
| `KIMI_AGENTGW_*` | 平台注入 | 部署在 Kimi 上时自动使用 |

密钥只在服务端读取，不会下发到浏览器，也不会进入备份文件。

## 动态 harness 怎么工作

**规划**（新建项目时）
```
一句话 ──▶ 路由：判断属于哪一类（没把握就追问一句）
        ──▶ 专家：按该类策略库写方案（避开已占用的时段、控制总量）
        ──▶ 评审：按规则逐条检查，不合格就退回让模型改，最多 3 次，仍不合格则自动修正
        ──▶ 方案卡：现在就做什么、固定时段、如果-那么、步骤、错过怎么办、文献依据
```

六类任务各有一套策略：记忆型学习、理解型学习、技能练习、项目推进、习惯养成、一次性事务。定义在 `contracts/playbooks.ts`。

**复盘**（复盘页，或在单件任务上点「评判」）
```
打卡数据 ──▶ 信号：逾期天数、完成率、遗忘率、近 7 天投入 vs 预算
        ──▶ 议程：只挑信号强的事（最多 6 件），数据不够就跳过「规律」归纳
        ──▶ 模型在工具循环里自己查记录，逐件提交评判 → 结论和数据对不上就退回
        ──▶ 模型没覆盖到的，用规则补齐；全部做完后再归纳：焦点、主题、规律、投入平衡
```

模型只提议，不直接改数据。每条提议（降频、改时段、拆分、归档……）都要你点「采用」才会生效。

研究依据见 [docs/研究依据.md](docs/研究依据.md)。

## 主要文件

- `contracts/playbooks.ts`：策略库、文献、路由关键词、复习间隔上限（Cepeda 时间山脊）
- `contracts/signals.ts`：信号层、复盘议程、评判校验器、规则兜底
- `contracts/planner.ts`：方案评审、自动修正、时段冲突、离线规划
- `contracts/fallback.ts`：纯规则版 harness（离线、未接模型时浏览器和服务端共用）
- `api/harness/engine.ts`：模型工具循环（提交即校验、退回修正、动态收束）
- `api/harness/prompts.ts`：路由器、专家、复盘评审的提示词
- `contracts/today.ts`：今天页的规则排序（固定时段、逾期、截止、投入不足、复习到期）与模型输出校验
- `api/routes/harness.ts`：`POST /api/plan`、`POST /api/review`、`POST /api/today`（NDJSON 流）、`GET /api/ai/status`
- `src/components/PlannerDialog.tsx`、`ReviewView.tsx`、`HarnessTrace.tsx`：前端

## 数据

数据保存在浏览器的 localStorage 里（键名 `cike.personal.v1`，数据版本 3，能导入 v1 和 v2 的备份）。只有点击「开始规划 / 开始复盘 / 评判」时，任务和打卡摘要才会由服务端发给模型，服务端不保存。

## 技术栈

React 19、TypeScript、Vite 7、Hono、AI SDK 6（openai-compatible）、zod 4、vite-plugin-pwa。
