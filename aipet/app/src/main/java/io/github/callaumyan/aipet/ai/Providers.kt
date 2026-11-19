package io.github.callaumyan.aipet.ai

/** 一条对话。只区分“主人说的”和“桌宠说的”。 */
data class ChatTurn(val fromUser: Boolean, val text: String)

/** 给用户看的错误：message 已经是能直接显示的中文。 */
class AiException(message: String, cause: Throwable? = null) : Exception(message, cause)

interface AiClient {
    /** 流式聊天：每收到一小段文字就回调 [onDelta]，结束后返回完整回复。 */
    suspend fun chat(system: String, turns: List<ChatTurn>, onDelta: (String) -> Unit): String

    /** 拉取该服务可用的模型列表（用于“选模型”）。 */
    suspend fun listModels(): List<String>
}

enum class ApiKind { CLAUDE, OPENAI_COMPATIBLE }

data class ProviderPreset(
    val id: String,
    val label: String,
    val kind: ApiKind,
    val defaultBaseUrl: String,
    val defaultModel: String,
    /** 去哪里申请 API Key */
    val keyUrl: String,
    /** 一句话说明 */
    val note: String,
)

object Providers {
    val all = listOf(
        ProviderPreset(
            id = "claude",
            label = "Claude（Anthropic）",
            kind = ApiKind.CLAUDE,
            defaultBaseUrl = "https://api.anthropic.com",
            defaultModel = "claude-opus-5-5",
            keyUrl = "https://platform.claude.com/settings/keys",
            note = "聊天质量很好。在 platform.claude.com 申请 Key 并充值。中国大陆网络无法直接连接。",
        ),
        ProviderPreset(
            id = "deepseek",
            label = "DeepSeek（深度求索）",
            kind = ApiKind.OPENAI_COMPATIBLE,
            defaultBaseUrl = "https://api.deepseek.com",
            defaultModel = "deepseek-chat",
            keyUrl = "https://platform.deepseek.com/api_keys",
            note = "很便宜，国内直连。在 platform.deepseek.com 申请 Key，充几块钱能聊很久。",
        ),
        ProviderPreset(
            id = "qwen",
            label = "通义千问（阿里云百炼）",
            kind = ApiKind.OPENAI_COMPATIBLE,
            defaultBaseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1",
            defaultModel = "qwen-plus",
            keyUrl = "https://bailian.console.aliyun.com/",
            note = "国内直连，新用户通常有免费额度。在阿里云百炼控制台申请 Key。",
        ),
        ProviderPreset(
            id = "zhipu",
            label = "智谱 GLM",
            kind = ApiKind.OPENAI_COMPATIBLE,
            defaultBaseUrl = "https://open.bigmodel.cn/api/paas/v4",
            defaultModel = "glm-4-flash",
            keyUrl = "https://open.bigmodel.cn/usercenter/apikeys",
            note = "国内直连，glm-4-flash 模型免费。在 open.bigmodel.cn 申请 Key。",
        ),
        ProviderPreset(
            id = "kimi",
            label = "Kimi（月之暗面）",
            kind = ApiKind.OPENAI_COMPATIBLE,
            defaultBaseUrl = "https://api.moonshot.cn/v1",
            defaultModel = "moonshot-v1-8k",
            keyUrl = "https://platform.moonshot.cn/console/api-keys",
            note = "国内直连。在 platform.moonshot.cn 申请 Key。",
        ),
        ProviderPreset(
            id = "siliconflow",
            label = "硅基流动",
            kind = ApiKind.OPENAI_COMPATIBLE,
            defaultBaseUrl = "https://api.siliconflow.cn/v1",
            defaultModel = "deepseek-ai/DeepSeek-V3",
            keyUrl = "https://cloud.siliconflow.cn/account/ak",
            note = "国内直连，一个 Key 能用很多开源模型。",
        ),
        ProviderPreset(
            id = "custom",
            label = "自定义（OpenAI 兼容接口）",
            kind = ApiKind.OPENAI_COMPATIBLE,
            defaultBaseUrl = "",
            defaultModel = "",
            keyUrl = "",
            note = "填任意兼容 OpenAI 格式的接口地址（比如 https://api.openai.com/v1 或自建中转）。",
        ),
    )

    fun byId(id: String) = all.firstOrNull { it.id == id } ?: all.first()

    fun create(preset: ProviderPreset, apiKey: String, baseUrl: String, model: String): AiClient {
        if (apiKey.isBlank()) throw AiException("还没有填 API Key（钥匙）哦，去设置里填一下吧～")
        if (baseUrl.isBlank()) throw AiException("还没有填接口地址哦，去设置里填一下吧～")
        if (model.isBlank()) throw AiException("还没有填模型名字哦，去设置里填一下或点“选模型”～")
        return when (preset.kind) {
            ApiKind.CLAUDE -> ClaudeClient(apiKey, baseUrl, model)
            ApiKind.OPENAI_COMPATIBLE -> OpenAiCompatClient(apiKey, baseUrl, model)
        }
    }
}

/**
 * 把聊天记录整理成接口要求的格式：从主人的话开始、两边轮流说、最后一条是主人说的。
 * 连续同一方的话合并成一条（比如桌宠连着主动说了两句）。
 */
fun normalizeTurns(raw: List<ChatTurn>): List<ChatTurn> {
    val out = ArrayList<ChatTurn>()
    for (t in raw) {
        val text = t.text.trim()
        if (text.isEmpty()) continue
        if (out.isEmpty() && !t.fromUser) continue
        val last = out.lastOrNull()
        if (last != null && last.fromUser == t.fromUser) {
            out[out.size - 1] = ChatTurn(t.fromUser, last.text + "\n" + text)
        } else {
            out.add(ChatTurn(t.fromUser, text))
        }
    }
    while (out.isNotEmpty() && !out.last().fromUser) out.removeAt(out.size - 1)
    return out
}
