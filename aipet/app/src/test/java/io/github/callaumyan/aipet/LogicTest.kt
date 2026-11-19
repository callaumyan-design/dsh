package io.github.callaumyan.aipet

import io.github.callaumyan.aipet.ai.ChatTurn
import io.github.callaumyan.aipet.ai.ClaudeClient
import io.github.callaumyan.aipet.ai.OpenAiCompatClient
import io.github.callaumyan.aipet.ai.OpenAiCompatClient.Companion.SseEvent
import io.github.callaumyan.aipet.ai.normalizeTurns
import io.github.callaumyan.aipet.chat.ChatEngine
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LogicTest {
    @Test
    fun sse_delta_done_and_noise() {
        assertEquals(
            SseEvent.Delta("你好"),
            OpenAiCompatClient.parseSseLine("""data: {"choices":[{"index":0,"delta":{"content":"你好"}}]}"""),
        )
        assertEquals(SseEvent.Done, OpenAiCompatClient.parseSseLine("data: [DONE]"))
        assertNull(OpenAiCompatClient.parseSseLine(": keep-alive"))
        assertNull(OpenAiCompatClient.parseSseLine(""))
        // DeepSeek 推理模型会先发 reasoning_content，content 为 null
        assertNull(
            OpenAiCompatClient.parseSseLine("""data: {"choices":[{"delta":{"content":null,"reasoning_content":"嗯"}}]}"""),
        )
        // 最后一包可能只有 usage，没有 choices
        assertNull(OpenAiCompatClient.parseSseLine("""data: {"choices":[],"usage":{"total_tokens":3}}"""))
        assertEquals(
            SseEvent.Error("bad key"),
            OpenAiCompatClient.parseSseLine("""data: {"error":{"message":"bad key"}}"""),
        )
    }

    @Test
    fun error_messages_are_friendly() {
        val e = OpenAiCompatClient.httpError(401, """{"error":{"message":"Invalid API key"}}""")
        assertTrue(e.message!!.contains("API Key"))
        assertTrue(e.message!!.contains("Invalid API key"))
        assertEquals("", OpenAiCompatClient.extractErrorMessage(""))
    }

    @Test
    fun model_list_parsing() {
        val json = """{"object":"list","data":[{"id":"deepseek-reasoner"},{"id":"deepseek-chat"}]}"""
        assertEquals(listOf("deepseek-chat", "deepseek-reasoner"), OpenAiCompatClient.parseModelList(json))
    }

    @Test
    fun turns_are_normalized_for_the_api() {
        val raw = listOf(
            ChatTurn(false, "我主动说的话"),       // 开头是桌宠说的 → 去掉
            ChatTurn(true, "在吗"),
            ChatTurn(true, "？"),                  // 连续两句 → 合并
            ChatTurn(false, "在呀"),
            ChatTurn(false, "怎么啦"),
            ChatTurn(true, "  "),                  // 空白 → 去掉
            ChatTurn(true, "想你了"),
            ChatTurn(false, "（还没回完）"),        // 最后必须是主人 → 去掉
        )
        assertEquals(
            listOf(ChatTurn(true, "在吗\n？"), ChatTurn(false, "在呀\n怎么啦"), ChatTurn(true, "想你了")),
            normalizeTurns(raw),
        )
        assertEquals(emptyList<ChatTurn>(), normalizeTurns(listOf(ChatTurn(false, "只有桌宠"))))
    }

    @Test
    fun markdown_is_removed_from_replies() {
        assertEquals("这是重点\n· 第一\n· 第二", ChatEngine.cleanReply("## 这是**重点**\n- 第一\n* 第二"))
    }

    @Test
    fun speech_text_drops_kaomoji() {
        assertEquals(
            "辛苦啦～我陪你一起歇五分钟嘛",
            io.github.callaumyan.aipet.pet.PetService.cleanForSpeech("辛苦啦～我陪你一起歇五分钟嘛 (｡･ω･｡)"),
        )
        assertEquals("好的！OK 123", io.github.callaumyan.aipet.pet.PetService.cleanForSpeech("好的！✨OK 123 💖"))
    }

    @Test
    fun effort_only_for_new_claude_models() {
        assertTrue(ClaudeClient.supportsEffort("claude-opus-5-5"))
        assertTrue(ClaudeClient.supportsEffort("claude-sonnet-5-5"))
        assertTrue(ClaudeClient.supportsEffort("claude-haiku-5-5"))
        assertTrue(ClaudeClient.supportsEffort("claude-fable-5-2"))
        assertTrue(ClaudeClient.supportsEffort("claude-opus-4-6"))
        assertFalse(ClaudeClient.supportsEffort("claude-haiku-4-5"))
        assertFalse(ClaudeClient.supportsEffort("claude-sonnet-4-5"))
        assertFalse(ClaudeClient.supportsEffort("claude-3-5-sonnet-20241022"))
        assertFalse(ClaudeClient.supportsEffort("claude-opus-4-1-20250805"))
        assertTrue(ClaudeClient.supportsServerFallback("claude-opus-5-5"))
        assertFalse(ClaudeClient.supportsServerFallback("claude-haiku-5-5"))
    }
}
