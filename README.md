# 获客智能助手

桌面端是唯一产品界面，云端 API 负责智能体、计费、交付和远程命令中继。本地 Markdown、图片与报告是内容的唯一主数据。

获客智能助手用于完成公司长期信息沉淀、单次推广信息收集、平台文案生成和内容管理。

## 核心流程

```text
建立长期用户画像
→ 选择内容类型
→ 选择目标平台
→ 补充本次推广信息
→ 生成平台文案
→ 在发布中心审核和修改
```

公司整体信息长期保存，单次推广的产品、活动和传播要求通过每次任务的对话补充。平台文案 Agent 会结合两部分信息生成适合目标平台的标题与正文。

## 用户画像

首次使用时，应用会引导用户建立长期用户画像，并在流程完成前锁定其他功能区。

画像流程支持：

- 通过五个阶段逐步了解行业、业务、客户、优势和转化目标。
- 首轮直接询问用户所在行业。
- 根据已有回答和本地参考资料动态追问必要信息。
- 添加多个本地参考资料，并将可解析的正文作为 Agent 上下文。
- 使用点击选项、手动输入、补充说明和跳过等方式回答。
- 根据用户修正及时更新判断，避免固化错误结论。
- 生成完整的用户画像 Markdown 草稿。
- 用户确认前允许直接编辑报告。
- 确认后保存到当前工作区，供后续内容任务长期复用。
- 已保存画像可以查看和修改。
- 删除画像前显示确认弹窗，确认后执行不可恢复删除。
- 中断的画像流程可以在下次打开时继续。

用户画像主要记录公司或品牌可长期复用的业务信息。

## 内容类型

当前提供两个内容入口。

### 产品推广文案

面向具体产品、服务或活动。用户先选择目标平台，再进入产品信息收集流程。

产品 Agent 会结合本地用户画像和本次回答继续追问。问题可以使用：

- 单选
- 多选
- 按优先级选择
- 手动补充
- 纯文字回答
- 跳过当前问题

Agent 会根据已经获得的信息判断下一步问题，避免固定问卷式流程。信息收集完成后，系统将以下内容交给平台文案 Agent：

- 本地用户画像 RAG
- 本次完整产品问答
- 产品推广简报与通用初稿
- 目标平台

中间产品简报仅作为内部上下文，用户无需查看或处理。平台 Agent 生成的标题和正文会直接进入发布中心，用户可以审核并微调最终结果。

### 公司软文

面向品牌故事、企业动态、公司理念和其他公司主题。

公司软文设有独立入口和欢迎语，可以作为独立内容任务使用。后续可以继续接入专用的信息收集 Agent 和各平台精修 Agent。

## 平台文案

平台规范、内容结构和文字风格由各平台 Agent 负责。创作工作区只负责选择平台和收集本次内容所需的信息。

## 发布中心

发布中心可以独立于 Agent 生成流程使用。用户既可以接收 Agent 生成的内容，也可以新建空白草稿并填写自己的文案。

### 草稿管理

- 草稿自动保存到当前工作区。
- 切换草稿后，原草稿中的文字、平台和图片选择继续保留。
- 支持新建、重命名、删除、置顶和取消置顶。
- 取消置顶后回到草稿原来的排序位置。
- 支持清空当前草稿。
- Agent 生成内容可以直接创建发布草稿。

### 本地配图

- 从用户电脑选择本地图片。
- 在发布中心显示图片预览、文件名和原始路径。
- 只记录原始文件路径和名称，不额外复制图片。
- 可以从草稿中移除已选图片。
- 删除或清空草稿不会删除原始图片。
- 不同草稿分别保存各自的图片选择。

## 多账号管理

同一平台可以保存多个账号的登录环境。

- 已登录账号显示可识别的用户名。
- 可以在发布前选择已有账号。
- “使用新账号”会打开独立的空白登录环境。
- 新账号登录成功并识别用户名后才加入账号列表。
- 可以删除不再使用的账号记录。
- 各账号的 Cookie 和 Session 分开保存。

## 工作区与本地数据

应用支持多个本地工作区。任务、用户画像、RAG、草稿和生成内容按照工作区组织。

主要本地数据包括：

- 用户画像 Markdown
- Persona RAG 参考资料
- 项目和任务信息
- 产品推广上下文
- 发布草稿
- 本地图片路径
- 平台账号 Session

本地图片仍保留在用户选择的原始位置。应用不会因为删除草稿而删除原图。

## Agent 配置

Agent 所需的密钥和接口地址通过仓库根目录的 `.env` 配置。具体配置项以 `.env.example` 为准，请勿提交包含真实密钥的 `.env`。

通用 Agent 提示词公开保存在 [`docs/agent-prompts/`](docs/agent-prompts/)：

- `persona-stage-1-business.md`：判断用户经营的业务与内容定位。
- `persona-stage-2-buying-relationship.md`：判断购买关系和优先沟通对象。
- `persona-stage-3-priority-audience.md`：判断优先目标客户及其核心需求。
- `persona-stage-4-advantages.md`：判断客户选择该业务的主要理由。
- `persona-stage-5-conversion.md`：判断转化目标并生成最终用户画像。
- `product-promotion-discovery.md`：结合长期用户画像，动态收集单次产品推广信息并生成内部简报与通用初稿。

这些文档不包含接口地址、密钥、Cookie、Session 或用户业务数据。平台文案 Agent 的提示词暂不公开。

## 本地启动

开发环境需要：

- Git
- Node.js 24 或更高版本
- pnpm 11.15.1
- Python 3.13
- uv

Python 版本和项目虚拟环境由 uv 管理，避免与电脑中已有的其他 Python 项目发生依赖冲突。

### macOS

以下命令在终端中执行。

#### 1. 安装基础环境

安装 Xcode Command Line Tools：

```bash
xcode-select --install
```

如果已经安装，系统会直接提示，无需重复处理。

使用 Homebrew 安装 Git、Node.js 24 和 uv：

```bash
brew install git node@24 uv
```

如果终端暂时找不到 `node`，将 Homebrew 的 Node.js 24 加入 PATH：

```bash
echo "export PATH=\"$(brew --prefix node@24)/bin:\$PATH\"" >> ~/.zshrc
source ~/.zshrc
```

启用 Corepack，并安装项目指定的 pnpm：

```bash
corepack enable
corepack install --global pnpm@11.15.1
```

检查环境：

```bash
git --version
node --version
pnpm --version
uv --version
```

#### 2. 安装项目依赖

进入项目根目录：

```bash
cd /项目所在目录/media-assistant
```

安装 Node.js 依赖：

```bash
pnpm install
```

安装 Python 3.13，并创建项目虚拟环境：

```bash
uv python install 3.13
uv sync --directory apps/api --python 3.13
```

#### 3. 准备 Agent 配置

复制配置模板：

```bash
cp .env.example .env
```

打开 `.env`，填写实际使用的 Agent Key 和 Agent URL。真实 `.env` 已被 Git 忽略，请勿提交到仓库。

确认配置文件存在：

```bash
test -f .env && echo ".env 已存在"
```

#### 4. 启动

以后每次使用，在项目根目录运行：

```bash
./run.sh
```

脚本会读取 `.env`，启动本地 FastAPI，等待健康检查通过，再打开 Electron 界面。退出桌面应用后，本地 FastAPI 会同步关闭。

如果提示 `Permission denied`，先添加执行权限：

```bash
chmod +x run.sh
./run.sh
```

### Windows

以下命令使用 PowerShell 执行。

#### 1. 安装基础环境

使用 winget 安装 Git、Node.js LTS 和 uv：

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id astral-sh.uv -e
```

安装完成后关闭当前 PowerShell，再重新打开一个 PowerShell 窗口，让 PATH 更新生效。

启用 Corepack，并安装项目指定的 pnpm：

```powershell
corepack enable
corepack install --global pnpm@11.15.1
```

如果 Corepack 提示没有权限，请使用管理员身份打开 PowerShell 后重新执行。

检查环境：

```powershell
git --version
node --version
pnpm --version
uv --version
```

#### 2. 安装项目依赖

进入项目根目录：

```powershell
cd C:\项目所在目录\media-assistant
```

安装 Node.js 依赖：

```powershell
pnpm install
```

安装 Python 3.13，并创建项目虚拟环境：

```powershell
uv python install 3.13
uv sync --directory apps/api --python 3.13
```

#### 3. 准备 Agent 配置

复制配置模板：

```powershell
Copy-Item .env.example .env
```

打开 `.env`，填写实际使用的 Agent Key 和 Agent URL。

确认配置文件存在：

```powershell
Test-Path .env
```

正常会返回：

```text
True
```

#### 4. 启动

以后每次使用，在项目根目录运行：

```powershell
pnpm dev
```

启动程序会读取 `.env`，启动本地 FastAPI，等待健康检查通过，再打开 Electron 界面。关闭桌面应用后，启动程序会结束本地服务。

Windows 使用 `pnpm dev`，无需执行 macOS 的 `run.sh`。

### 常见启动问题

#### 找不到 pnpm

重新打开终端或 PowerShell，然后检查：

```text
node --version
pnpm --version
```

如果 Node.js 正常但 pnpm 仍不可用，重新执行 Corepack 安装命令。

#### `ERR_PNPM_IGNORED_BUILDS`

pnpm 可能阻止部分依赖执行安装脚本。先核对提示中的包名，再运行：

```bash
pnpm approve-builds
pnpm install
```

#### Python 版本或虚拟环境错误

在项目根目录重新执行：

```bash
uv python install 3.13
uv sync --directory apps/api --python 3.13
```

#### `.env` 缺失

从 `.env.example` 重新复制 `.env`，并填写必要的 Key 和 Agent URL。

#### 端口 8000 被占用

关闭正在使用 `127.0.0.1:8000` 的程序或旧 FastAPI 进程，然后重新启动项目。

#### Electron 依赖不完整

在项目根目录重新执行：

```bash
pnpm install
```
