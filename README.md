# @pmstudio/skills-manager

PMStudio 的 skills 管理 plugin 包：enablement（启用/禁用状态机 + 事务日志）、packs（规则包求值/动态包）、vault（技能库 adopt/index/scan）、infra（别名、状态存储、provider 目标解析）。

从 PMStudio monorepo 剥离（分支 `feat/standalone-skills-extraction`），独立演进，宿主按 tag 跟随。

## 与宿主的边界（注入端口）

包不携带通用基础设施实现，由宿主注入：

- `SkillEnablementSalvage` — zod salvage 组合子（宿主侧 `src/shared/zod-salvage`）
- `SkillEnablementFileIO.readFileBounded` — 有界文件读取（宿主侧 `src/shared/node-bounded-file-reader`）
- 宿主绑定示例见 PMStudio `src/shared/skill-enablement.ts` 的 `hostSkillEnablementFileIO`

skills 域内工具（`renameSkillPathWithWindowsRetry`、`skill-path-containment` 系列）本包为单一来源，宿主 re-export。

契约不兼容变更（端口签名、schema 版本）必须升 minor 以上并迁移说明。

## 消费（git 依赖）

```jsonc
// 宿主 package.json
"@pmstudio/skills-manager": "git+https://github.com/lklBESCooperation/skills-manager.git#v0.1.0"
```

pnpm 安装 git 依赖时执行 `prepare` → `pnpm build` 产出 `dist/`，`types`/`main` 均指向 dist。仓库公开后 https 形态免凭据安装；私有期间需要 org 读权限凭据。

若 pnpm ≥12 拦截构建脚本，在消费方 `pnpm-workspace.yaml` 的 `allowBuilds` 里按解析 ID（含 commit SHA）放行。
`orca-source` export 条件保留给宿主源码编译通道。

## 开发

```bash
pnpm install --frozen-lockfile
pnpm test     # 55 tests
pnpm build    # tsc → dist/
```

发版：改 `version` → commit → `git tag v<X.Y.Z>` → push（含 `--tags`）。
