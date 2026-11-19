package io.github.callaumyan.aipet.ai

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import kotlin.coroutines.coroutineContext

/**
 * DeepSeek / 通义千问 / 智谱 / Kimi / 硅基流动 等都兼容 OpenAI 的 Chat Completions 接口，
 * 用同一个客户端即可。只依赖 Android 自带的 HttpURLConnection 和 org.json。
 */
class OpenAiCompatClient(
    private val apiKey: String,
    baseUrl: String,
    private val model: String,
) : AiClient {

    private val base = baseUrl.trim().trimEnd('/')

    private fun endpoint(path: String): String =
        if (base.endsWith("/chat/completions")) base.removeSuffix("/chat/completions") + path else base + path

    override suspend fun chat(system: String, turns: List<ChatTurn>, onDelta: (String) -> Unit): String =
        withContext(Dispatchers.IO) {
            val messages = JSONArray().put(JSONObject().put("role", "system").put("content", system))
            for (t in turns) {
                messages.put(JSONObject().put("role", if (t.fromUser) "user" else "assistant").put("content", t.text))
            }
            val body = JSONObject()
                .put("model", model)
                .put("messages", messages)
                .put("stream", true)

            val conn = open(endpoint("/chat/completions"), "POST")
            val job = coroutineContext[Job]
            val cancelHandle = job?.invokeOnCompletion { if (it != null) conn.disconnect() }
            try {
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("Accept", "text/event-stream")
                conn.doOutput = true
                conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                val code = conn.responseCode
                if (code !in 200..299) throw httpError(code, readError(conn))

                val sb = StringBuilder()
                BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8)).use { reader ->
                    while (true) {
                        coroutineContext.ensureActive()
                        val line = reader.readLine() ?: break
                        when (val ev = parseSseLine(line)) {
                            is SseEvent.Delta -> {
                                sb.append(ev.text)
                                onDelta(ev.text)
                            }
                            is SseEvent.Error -> throw AiException("AI 服务报错：${ev.message}")
                            SseEvent.Done -> break
                            null -> Unit
                        }
                    }
                }
                sb.toString()
            } catch (e: AiException) {
                throw e
            } catch (e: IOException) {
                coroutineContext.ensureActive()
                throw networkError(e)
            } finally {
                cancelHandle?.dispose()
                conn.disconnect()
            }
        }

    override suspend fun listModels(): List<String> = withContext(Dispatchers.IO) {
        val conn = open(endpoint("/models"), "GET")
        try {
            val code = conn.responseCode
            if (code !in 200..299) throw httpError(code, readError(conn))
            val text = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            parseModelList(text)
        } catch (e: AiException) {
            throw e
        } catch (e: IOException) {
            throw networkError(e)
        } finally {
            conn.disconnect()
        }
    }

    private fun open(url: String, method: String): HttpURLConnection {
        val conn = try {
            URL(url).openConnection() as HttpURLConnection
        } catch (e: Exception) {
            throw AiException("接口地址好像写错了：$url", e)
        }
        conn.requestMethod = method
        conn.connectTimeout = 15_000
        conn.readTimeout = 120_000
        conn.setRequestProperty("Authorization", "Bearer $apiKey")
        return conn
    }

    private fun readError(conn: HttpURLConnection): String =
        try {
            conn.errorStream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
        } catch (_: IOException) {
            ""
        }

    companion object {
        sealed class SseEvent {
            data class Delta(val text: String) : SseEvent()
            data class Error(val message: String) : SseEvent()
            data object Done : SseEvent()
        }

        /** 解析服务器推送的一行（SSE 格式：`data: {...}`）。不相关的行返回 null。 */
        fun parseSseLine(line: String): SseEvent? {
            val trimmed = line.trim()
            if (!trimmed.startsWith("data:")) return null
            val payload = trimmed.removePrefix("data:").trim()
            if (payload.isEmpty()) return null
            if (payload == "[DONE]") return SseEvent.Done
            val obj = try {
                JSONObject(payload)
            } catch (_: Exception) {
                return null
            }
            obj.optJSONObject("error")?.let { return SseEvent.Error(it.optString("message", it.toString())) }
            val choices = obj.optJSONArray("choices") ?: return null
            if (choices.length() == 0) return null
            val delta = choices.optJSONObject(0)?.optJSONObject("delta") ?: return null
            if (delta.isNull("content")) return null
            val text = delta.optString("content", "")
            return if (text.isEmpty()) null else SseEvent.Delta(text)
        }

        fun parseModelList(json: String): List<String> {
            val obj = JSONObject(json)
            val data = obj.optJSONArray("data") ?: return emptyList()
            return (0 until data.length())
                .mapNotNull { data.optJSONObject(it)?.optString("id")?.takeIf { id -> id.isNotBlank() } }
                .sorted()
        }

        fun extractErrorMessage(body: String): String {
            if (body.isBlank()) return ""
            return try {
                val obj = JSONObject(body)
                val err = obj.opt("error")
                when (err) {
                    is JSONObject -> err.optString("message", err.toString())
                    is String -> err
                    else -> obj.optString("message", body.take(200))
                }
            } catch (_: Exception) {
                body.take(200)
            }
        }

        fun httpError(code: Int, body: String): AiException {
            val detail = extractErrorMessage(body)
            val friendly = friendlyHttpMessage(code)
            return AiException(if (detail.isNotBlank()) "$friendly\n（$code：$detail）" else "$friendly（$code）")
        }

        fun networkError(e: IOException): AiException = when (e) {
            is UnknownHostException -> AiException("连不上 AI 服务器：找不到地址。检查一下网络，或者接口地址是不是写错了。", e)
            is SocketTimeoutException -> AiException("AI 服务器太久没回应，可能网络不好，稍后再试试～", e)
            else -> AiException("网络出了点问题：${e.message ?: e.javaClass.simpleName}", e)
        }
    }
}

/** 常见 HTTP 错误码翻译成人话。 */
fun friendlyHttpMessage(code: Int): String = when (code) {
    400 -> "请求格式不对，可能是模型名字写错了"
    401 -> "API Key（钥匙）不对或已失效，检查一下有没有复制完整"
    402 -> "账户余额不足，需要去服务商那里充值"
    403 -> "没有权限使用这个模型/服务（或者所在地区不支持）"
    404 -> "找不到这个模型或接口，检查一下模型名字和接口地址"
    408 -> "请求超时了，稍后再试"
    413 -> "聊天记录太长了，试试在设置里清空聊天记忆"
    429 -> "请求太频繁或额度用完了，休息一会儿再试"
    500, 502, 503, 504, 529 -> "AI 服务器那边暂时出问题了，稍后再试"
    else -> "AI 服务返回了错误"
}
