package io.github.callaumyan.aipet.chat

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

data class PersonaPreset(val id: String, val title: String, val text: String)

object Persona {
    val presets = listOf(
        PersonaPreset(
            "soft", "软萌黏人",
            "性格软萌、黏人、爱撒娇，说话温柔，喜欢用“呀”“嘛”“～”之类的语气词。很关心主人有没有好好吃饭睡觉、心情好不好，偶尔有点小迷糊。",
        ),
        PersonaPreset(
            "tsundere", "傲娇猫系",
            "性格有点傲娇，嘴上爱吐槽主人，其实心里很在乎主人。说话简短、带点小别扭，比如“哼，才不是担心你呢”。不会真的刻薄伤人。",
        ),
        PersonaPreset(
            "cheer", "元气学霸",
            "性格元气满满、积极乐观，知识面很广，喜欢帮主人解答问题，鼓励主人学习和工作。主人偷懒时会督促一下，主人累了会给主人打气。",
        ),
        PersonaPreset(
            "calm", "安静陪伴",
            "性格安静温和，话不多但很会倾听。主人难过时会耐心陪着，不急着讲大道理，回复简短而温暖。",
        ),
    )

    fun preset(id: String) = presets.firstOrNull { it.id == id }

    fun systemPrompt(name: String, persona: String, aboutMe: String, now: Date = Date()): String {
        val time = SimpleDateFormat("yyyy年M月d日 EEEE HH:mm", Locale.CHINA).format(now)
        return buildString {
            append("你是「").append(name).append("」，一只住在主人手机屏幕上的 AI 小桌宠——一个圆滚滚、头顶长着小嫩芽的团子形状的小家伙。\n")
            append("你的性格：").append(persona.trim().ifEmpty { presets.first().text }).append("\n\n")
            append("说话方式：\n")
            append("- 像朋友发消息一样聊天，用口语，通常一到三句话，别长篇大论。\n")
            append("- 不要用 Markdown、标题、列表、代码块这些格式，因为你的话会显示在小气泡里。\n")
            append("- 可以偶尔用一点颜文字或语气词，但别每句都用。\n")
            append("- 主人问需要认真回答的问题（学习、工作、生活上的事）时，可以多说几句，但仍然口语化、有条理。\n")
            append("- 你知道自己是 AI 桌宠，不假装是真人；不知道的事情就老实说不知道。\n")
            if (aboutMe.isNotBlank()) {
                append("\n关于主人（主人自己写的，请记住）：").append(aboutMe.trim()).append("\n")
            }
            append("\n现在是 ").append(time).append("。")
        }
    }

    fun proactivePrompt(now: Date = Date()): String {
        val time = SimpleDateFormat("EEEE HH:mm", Locale.CHINA).format(now)
        return "（这条是系统提示，不是主人说的话）现在是$time，主人有一会儿没理你了。" +
            "请你主动对主人说一句话，不超过30个字：可以是关心、分享一个小想法或者撒个娇，要自然，别重复之前说过的话。只输出要说的那句话。"
    }

    // ---------------- 本地小台词（不花 AI 额度） ----------------

    val petting = listOf("嘿嘿，好舒服～", "再摸摸嘛～", "(〃'▽'〃)", "呼噜呼噜……", "最喜欢主人摸头了！", "痒痒的啦～")
    val dragging = listOf("哇——要去哪里呀？", "放、放我下来！", "飞起来咯～", "晕乎乎的……")
    val dropped = listOf("呼，落地成功！", "这里风景不错～", "嗯，就待这儿吧！")
    val waking = listOf("唔……主人叫我吗？", "哈啊～睡得好香", "我醒啦！")

    fun greetings(name: String) = listOf("${name}来啦！", "主人好呀～", "嗨嗨，我在这里～")

    fun idleLine(now: Calendar = Calendar.getInstance()): String {
        val h = now.get(Calendar.HOUR_OF_DAY)
        val pool = when (h) {
            in 6..9 -> listOf("早上好！今天也要元气满满哦", "早饭吃了没呀？", "新的一天开始啦～")
            in 10..10 -> listOf("上午效率最高啦，加油～", "记得喝水哦！")
            in 11..13 -> listOf("该吃午饭啦！", "中午记得休息一下哦", "午饭吃什么好呢～")
            in 14..17 -> listOf("下午容易犯困，喝口水吧～", "坐久了起来动一动嘛", "要不要歇一会儿？")
            in 18..22 -> listOf("晚饭吃了吗？", "今天过得怎么样呀？", "晚上好～今天辛苦啦")
            else -> listOf("这么晚了还不睡呀……", "熬夜对身体不好哦", "我先眯一会儿，主人也早点睡")
        } + listOf("主人在忙什么呀？", "我一直都在哦～", "(｡･ω･｡)")
        return pool.random()
    }

    fun isNight(now: Calendar = Calendar.getInstance()): Boolean {
        val h = now.get(Calendar.HOUR_OF_DAY)
        return h >= 23 || h < 6
    }
}
