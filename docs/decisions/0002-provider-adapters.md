# ADR 0002：第三方平台通过 Provider Adapter 接入

状态：已接受

每个平台保留自己的鉴权、字段映射、SSE/JSON 解析、超时与错误转换。智能体只依赖
`ArticleProvider` 等内部协议。未配置目标平台时明确失败，不使用其他平台静默替代。
