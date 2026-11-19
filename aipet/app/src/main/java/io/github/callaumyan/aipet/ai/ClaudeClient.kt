package io.github.callaumyan.aipet.ai

import com.anthropic.client.AnthropicClient
import com.anthropic.client.okhttp.AnthropicOkHttpClient
import com.anthropic.errors.AnthropicIoException
import com.anthropic.errors.AnthropicServiceException
import com.anthropic.models.beta.AnthropicBeta
import com.anthropic.models.beta.messages.BetaOutputConfig
import com.anthropic.models.beta.messages.BetaStopReason
import com.anthropic.models.beta.messages.MessageCreateParams
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.IOException
import java.time.Duration
import kotlin.coroutines.coroutineContext

/** 用 Anthropic 官方 Java SDK 调用 Claude。 */
class ClaudeClient(
    apiKey: String,
    baseUrl: String,
    private val model: String,
) : AiClient {

    private val client: AnthropicClient = AnthropicOkHttpClient.builder()
        .apiKey(apiKey)
        .baseUrl(baseUrl.trim().trimEnd('/'))
        .timeout(Duration.ofSeconds(120))
        .maxRetries(2)
        .build()

    override suspend fun chat(system: String, turns: List<ChatTurn>, onDelta: (String) -> Unit): String =
        withContext(Dispatchers.IO) {
            val builder = MessageCreateParams.builder()
                .model(model)
                // 回复本来就很短；这个上限主要是给模型思考留足空间，不会多收钱。
                .maxTokens(16000L)
                .system(system)
            for (t in turns) {
                if (t.fromUser) builder.addUserMessage(t.text) else builder.addAssistantMessage(t.text)
            }
            if (supportsEffort(model)) {
                // 闲聊不需要深度思考：低档位回得更快、更省钱。
                builder.outputConfig(BetaOutputConfig.builder().effort(BetaOutputConfig.Effort.LOW).build())
            }
            if (supportsServerFallback(model)) {
                // 万一被安全分类器拒答，服务端会自动换一个模型重试。
                builder.addBeta(AnthropicBeta.SERVER_SIDE_FALLBACK_2026_07_01)
                builder.fallbacksDefault()
            }

            val sb = StringBuilder()
            var refused = false
            try {
                client.beta().messages().createStreaming(builder.build()).use { response ->
                    val handle = coroutineContext[Job]?.invokeOnCompletion { if (it != null) response.close() }
                    try {
                        val it = response.stream().iterator()
                        while (it.hasNext()) {
                            coroutineContext.ensureActive()
                            val event = it.next()
                            event.contentBlockDelta().flatMap { d -> d.delta().text() }.ifPresent { textDelta ->
                                val text = textDelta.text()
                                sb.append(text)
                                onDelta(text)
                            }
                            event.messageDelta().flatMap { d -> d.delta().stopReason() }.ifPresent { reason ->
                                if (reason == BetaStopReason.REFUSAL) refused = true
                            }
                        }
                    } finally {
                        handle?.dispose()
                    }
                }
            } catch (e: AnthropicServiceException) {
                throw OpenAiCompatClient.httpError(e.statusCode(), e.body().toString())
            } catch (e: AnthropicIoException) {
                coroutineContext.ensureActive()
                val cause = e.cause
                throw if (cause is IOException) OpenAiCompatClient.networkError(cause)
                else AiException("网络出了点问题：${e.message}", e)
            } catch (e: IOException) {
                coroutineContext.ensureActive()
                throw OpenAiCompatClient.networkError(e)
            }
            if (refused && sb.isBlank()) throw AiException("这个话题它不太方便回答，换个话题聊聊吧～")
            sb.toString()
        }

    override fun close() {
        try {
            client.close()
        } catch (_: Exception) {
        }
    }

    override suspend fun listModels(): List<String> = withContext(Dispatchers.IO) {
        try {
            val out = ArrayList<String>()
            for (m in client.models().list().autoPager()) out.add(m.id())
            out
        } catch (e: AnthropicServiceException) {
            throw OpenAiCompatClient.httpError(e.statusCode(), e.body().toString())
        } catch (e: AnthropicIoException) {
            throw AiException("网络出了点问题：${e.message}", e)
        }
    }

    companion object {
        private val versioned = Regex("""^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?""")

        private fun version(model: String): Triple<String, Int, Int>? {
            val m = versioned.find(model) ?: return null
            val minor = m.groupValues[3].toIntOrNull()?.takeIf { it < 100 } ?: 0
            return Triple(m.groupValues[1], m.groupValues[2].toInt(), minor)
        }

        /** 只有较新的 Claude 模型支持 effort 参数，老模型发了会报错。 */
        fun supportsEffort(model: String): Boolean {
            val (family, major, minor) = version(model) ?: return false
            return when (family) {
                "fable", "mythos" -> true
                "opus" -> major >= 5 || (major == 4 && minor >= 5)
                "sonnet" -> major >= 5 || (major == 4 && minor >= 6)
                "haiku" -> major >= 5
                else -> false
            }
        }

        /** 支持服务端拒答兜底（fallbacks）的模型。 */
        fun supportsServerFallback(model: String): Boolean = model in setOf(
            "claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5",
        )
    }
}
