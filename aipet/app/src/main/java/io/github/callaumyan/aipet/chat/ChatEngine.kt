package io.github.callaumyan.aipet.chat

import android.content.Context
import android.util.Log
import io.github.callaumyan.aipet.Prefs
import io.github.callaumyan.aipet.ai.AiClient
import io.github.callaumyan.aipet.ai.AiException
import io.github.callaumyan.aipet.ai.ChatTurn
import io.github.callaumyan.aipet.ai.Providers
import io.github.callaumyan.aipet.ai.normalizeTurns
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.atomic.AtomicLong

data class ChatMsg(
    val id: Long,
    val fromUser: Boolean,
    val text: String,
    val time: Long = System.currentTimeMillis(),
    /** 正在生成中 */
    val pending: Boolean = false,
    /** 出错提示（不会发给 AI，也不保存） */
    val error: Boolean = false,
)

/** 发给桌宠本体的事件：让它摆出“思考中/说话中”的样子、冒气泡、朗读。 */
sealed class PetEvent {
    data object Thinking : PetEvent()
    data class Streaming(val textSoFar: String) : PetEvent()
    data class Said(val text: String, val speak: Boolean = true) : PetEvent()
    data class Failed(val message: String) : PetEvent()
}

/**
 * 聊天的大脑：保存聊天记录、调用 AI、把结果通知给聊天窗口和桌宠。
 * 整个 App 只有一个实例（在 [io.github.callaumyan.aipet.App] 里）。
 */
class ChatEngine(context: Context, private val prefs: Prefs) {
    private val file = File(context.filesDir, "chat_history.json")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val ids = AtomicLong(System.currentTimeMillis())

    private val _messages = MutableStateFlow(load())
    val messages: StateFlow<List<ChatMsg>> = _messages

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy

    private val _events = MutableSharedFlow<PetEvent>(extraBufferCapacity = 64)
    val events: SharedFlow<PetEvent> = _events

    private var job: Job? = null

    private fun newId() = ids.incrementAndGet()

    private fun client(): AiClient {
        val p = prefs.provider
        return Providers.create(p, prefs.apiKey(p.id), prefs.baseUrl(p.id), prefs.model(p.id))
    }

    private fun systemPrompt() = Persona.systemPrompt(prefs.petName, prefs.personaText, prefs.aboutMe)

    private fun contextTurns(): List<ChatTurn> =
        _messages.value.filter { !it.error && !it.pending }.takeLast(CONTEXT_SIZE).map { ChatTurn(it.fromUser, it.text) }

    fun send(text: String) {
        val content = text.trim()
        if (content.isEmpty() || _busy.value) return
        val userMsg = ChatMsg(newId(), fromUser = true, text = content)
        val replyId = newId()
        _messages.update { list -> list.filter { !it.error } + userMsg + ChatMsg(replyId, false, "", pending = true) }
        save()
        _busy.value = true
        _events.tryEmit(PetEvent.Thinking)

        job = scope.launch {
            val sb = StringBuilder()
            try {
                val turns = normalizeTurns(contextTurns())
                val client = withContext(Dispatchers.Default) { client() }
                val reply = client.chat(systemPrompt(), turns) { delta ->
                    synchronized(sb) { sb.append(delta) }
                    val soFar = synchronized(sb) { sb.toString() }
                    _messages.update { list -> list.map { if (it.id == replyId) it.copy(text = soFar) else it } }
                    _events.tryEmit(PetEvent.Streaming(soFar))
                }.trim()
                val finalText = cleanReply(reply).ifEmpty { "（它歪了歪头，好像没想好说什么……）" }
                _messages.update { list -> list.map { if (it.id == replyId) it.copy(text = finalText, pending = false) else it } }
                save()
                _events.tryEmit(PetEvent.Said(finalText))
            } catch (e: CancellationException) {
                val partial = synchronized(sb) { sb.toString() }.trim()
                _messages.update { list ->
                    if (partial.isEmpty()) list.filter { it.id != replyId }
                    else list.map { if (it.id == replyId) it.copy(text = cleanReply(partial), pending = false) else it }
                }
                save()
                throw e
            } catch (e: Throwable) {
                Log.w(TAG, "chat failed", e)
                val msg = (e as? AiException)?.message ?: "出错了：${e.message ?: e.javaClass.simpleName}"
                _messages.update { list ->
                    list.map { if (it.id == replyId) it.copy(text = msg, pending = false, error = true) else it }
                }
                save()
                _events.tryEmit(PetEvent.Failed(msg))
            } finally {
                _busy.value = false
            }
        }
    }

    fun cancel() {
        job?.cancel()
    }

    /** 桌宠主动搭话。AI 生成失败时退回到本地小台词。 */
    fun proactive(useAi: Boolean) {
        if (_busy.value) return
        scope.launch {
            var line: String? = null
            if (useAi) {
                try {
                    val client = withContext(Dispatchers.Default) { client() }
                    val turns = normalizeTurns(contextTurns() + ChatTurn(true, Persona.proactivePrompt()))
                    line = cleanReply(client.chat(systemPrompt(), turns) { }).take(80).ifBlank { null }
                } catch (e: Throwable) {
                    if (e is CancellationException) throw e
                    Log.w(TAG, "proactive AI failed, falling back", e)
                }
            }
            val text = line ?: Persona.idleLine()
            _messages.update { it + ChatMsg(newId(), false, text) }
            save()
            _events.tryEmit(PetEvent.Said(text))
        }
    }

    fun clear() {
        cancel()
        _messages.value = emptyList()
        save()
    }

    /** 设置页的“测试一下”：用当前设置发一句话。 */
    suspend fun testConnection(): String {
        val client = withContext(Dispatchers.Default) { client() }
        val reply = client.chat(systemPrompt(), listOf(ChatTurn(true, "你好呀，用一句话跟我打个招呼吧"))) { }
        return cleanReply(reply)
    }

    suspend fun listModels(): List<String> = withContext(Dispatchers.Default) { client() }.listModels()

    private fun save() {
        val snapshot = _messages.value.filter { !it.error && !it.pending && it.text.isNotBlank() }.takeLast(MAX_SAVED)
        scope.launch(Dispatchers.IO) {
            val arr = JSONArray()
            for (m in snapshot) arr.put(JSONObject().put("u", m.fromUser).put("t", m.text).put("ts", m.time))
            try {
                val tmp = File(file.parentFile, file.name + ".tmp")
                tmp.writeText(arr.toString())
                tmp.renameTo(file)
            } catch (e: Exception) {
                Log.w(TAG, "save failed", e)
            }
        }
    }

    private fun load(): List<ChatMsg> = try {
        if (!file.exists()) emptyList() else {
            val arr = JSONArray(file.readText())
            (0 until arr.length()).map {
                val o = arr.getJSONObject(it)
                ChatMsg(newId(), o.optBoolean("u"), o.optString("t"), o.optLong("ts"))
            }
        }
    } catch (e: Exception) {
        Log.w(TAG, "load failed", e)
        emptyList()
    }

    companion object {
        private const val TAG = "ChatEngine"
        private const val CONTEXT_SIZE = 30
        private const val MAX_SAVED = 300

        /** 去掉 AI 偶尔还是会带上的 Markdown 符号，让气泡里干干净净。 */
        fun cleanReply(text: String): String = text
            .replace(Regex("""\*\*(.+?)\*\*"""), "$1")
            .replace(Regex("""(?m)^#{1,6}\s*"""), "")
            .replace(Regex("""(?m)^\s*[-*]\s+"""), "· ")
            .replace("`", "")
            .trim()
    }
}
