package io.github.callaumyan.aipet.pet

import kotlin.random.Random

/**
 * 本地台词库：不花 AI 额度，按情境挑一句，最近说过的尽量不重复。
 * 占位符：{name} 桌宠名字，{u} 它怎么称呼你，{days} 认识天数，{pets}/{feeds}/{throws} 今天的次数。
 */
class Lines(private val rng: Random = Random.Default) {
    private val recent = ArrayDeque<String>()

    fun pick(key: String, vars: Map<String, String> = emptyMap()): String {
        val pool = table[key] ?: return ""
        val fresh = pool.filter { it !in recent }.ifEmpty { pool }
        val line = fresh[rng.nextInt(fresh.size)]
        recent.addLast(line)
        while (recent.size > 24) recent.removeFirst()
        var out = line
        for ((k, v) in vars) out = out.replace("{$k}", v)
        return out
    }

    companion object {
        val table: Map<String, List<String>> = mapOf(
            "show" to listOf("{name}来啦！", "{u}好呀～我在这儿！", "嗨嗨，想我了没？", "噔噔～出场！"),

            "unlock_short" to listOf("{u}回来啦～", "嘿嘿，又见面了", "我刚刚一直在等你哦", "欢迎回来～"),
            "unlock_medium" to listOf("{u}去哪了呀，我好想你", "终于回来了！我数了好多只羊", "你不在的时候好无聊哦…", "回来啦！陪我玩一会儿嘛"),
            "unlock_long" to listOf("哇！{u}终于回来了！", "你走了好久好久…我还以为你不要我了", "等你等得我都睡着了", "好久不见！有没有想我？"),
            "unlock_morning" to listOf("早上好！昨晚睡得好吗？", "早安～今天也要元气满满！", "{u}早！我已经醒啦", "早上好呀，记得吃早饭哦"),
            "unlock_night" to listOf("这么晚了还不睡呀…", "{u}，该睡觉啦…", "嘘…我都困了，你也早点睡", "夜猫子{u}！"),
            "days" to listOf("今天是我们认识的第{days}天哦！", "我们已经认识{days}天啦～", "第{days}天，我还是最喜欢{u}！"),

            "wake" to listOf("唔…{u}叫我吗？", "哈啊～我醒啦", "嗯？天亮了吗？", "被你叫醒了…嘿嘿"),
            "wake_grumpy" to listOf("唔…再让我睡一会儿嘛…", "好困…别闹…", "呜，人家还没睡够…"),

            "tap_head" to listOf("嘿嘿，摸头～", "再摸摸嘛", "头顶是我的开心开关！", "(〃'▽'〃)"),
            "tap_face" to listOf("唔！别捏我脸", "脸、脸要被你捏扁了！", "噗…", "干嘛戳我脸啦"),
            "tap_belly" to listOf("哈哈哈好痒！", "肚子不可以！哈哈哈", "痒痒痒～", "咕叽！"),
            "tap_sprout" to listOf("别拽我的小芽！", "叶子是很重要的！", "啊！小芽芽要掉了！", "轻点轻点～"),
            "poke_annoyed" to listOf("别戳啦～", "一直戳我干嘛…", "再戳我要生气了哦", "哼…"),
            "poke_angry" to listOf("哼！不理你了！", "生气了！真的生气了！", "坏{u}！", "（气鼓鼓）"),

            "petting" to listOf("呼噜呼噜…", "好舒服～", "再摸一会儿嘛…", "最喜欢{u}摸摸了"),
            "petting_calm" to listOf("…好吧，原谅你了", "哼，看在摸摸的份上…", "气消了一点点…"),
            "pet_count" to listOf("今天被{u}摸了{pets}次，好幸福～", "第{pets}次摸摸！我都记着呢"),

            "pickup" to listOf("哇！", "要带我去哪？", "飞起来咯～", "诶诶诶？"),
            "held_long" to listOf("放我下来嘛…", "手酸不酸呀？", "我有点晕了…", "可以放下我了吗～"),
            "thrown" to listOf("哇啊啊啊——", "呀——！", "我、我会飞！？"),
            "land_soft" to listOf("落地成功！", "稳稳的～", "嘿咻！", "满分落地！"),
            "land_hard" to listOf("哎哟！", "疼疼疼…", "屁股摔开花了…", "呜…"),
            "land_dizzy" to listOf("眼冒金星…", "天、天在转…", "我是谁…我在哪…", "晕…晕了…"),
            "thrown_again" to listOf("你又扔我！", "{u}是不是不喜欢我了…", "今天已经被扔了{throws}次了！", "再扔我就哭给你看！"),
            "hit_wall" to listOf("啪叽！", "撞、撞到墙了…", "我的脸…"),
            "stuck_wall" to listOf("粘住了！", "嘿嘿，我会爬墙哦", "史莱姆的特技！"),
            "flick" to listOf("哎呀！", "推我干嘛～", "诶？！"),

            "shake" to listOf("别晃啦～头好晕！", "地震了吗？！", "晃、晃得我要吐了…", "停停停！"),
            "tilt" to listOf("哇，要滑走啦！", "斜了斜了！", "抓不住了～"),

            "charge_on" to listOf("开饭啦！⚡", "电来了！好香～", "咕噜咕噜，喝电电", "补充能量中！"),
            "charge_off_hungry" to listOf("诶？我还没吃饱呢…", "怎么拔掉了，还想吃…", "才吃了一半…"),
            "charge_off_full" to listOf("嗝～吃饱了", "满满的能量！", "谢谢款待～"),
            "battery_full" to listOf("吃撑啦～", "肚子圆滚滚的！", "满电！可以陪你玩一整天！"),
            "battery_low" to listOf("好饿…快给我充电嘛", "没力气了…", "{u}，我饿了…"),
            "battery_critical" to listOf("要…没电了…", "眼前一黑…快…充电…", "撑不住了…"),

            "music_on" to listOf("♪ 这首好听！", "有音乐！跳舞跳舞～", "♪ 跟着节奏摇摆～", "我也要听！"),
            "music_off" to listOf("咦，不放了吗？", "还想听…", "歌停了…"),
            "headset" to listOf("戴上耳机啦，在听什么呀？", "偷偷听歌不带我～"),

            "feed_see" to listOf("！！好吃的！", "是给我的吗？", "哇——零食！"),
            "feed_eat" to listOf("好吃！", "嗷呜～真香", "谢谢{u}！最喜欢你了", "还想要～"),
            "feed_full" to listOf("吃不下啦…", "好撑…等会儿再吃", "肚子要爆炸了…"),

            "sleep_ok" to listOf("那我睡啦…晚安", "呼…好的…", "{u}也早点休息哦"),
            "sleep_not_sleepy" to listOf("我还不困呢…好吧，就眯一会儿", "才不困…呼…"),
            "yawn" to listOf("哈啊～好困", "眼皮好重…", "想睡觉了…"),
            "bedtime" to listOf("十一点啦，该睡觉咯", "{u}，明天还要早起呢", "熬夜会变成熊猫眼哦"),
            "meal" to listOf("该吃饭啦！", "{u}吃饭了没？", "饭点到了～别饿着"),

            "bored" to listOf("好无聊…陪我玩嘛", "{u}～看看我！", "理理我嘛…", "我在这儿哦！"),
            "lonely" to listOf("{u}都不理我…", "一个人好寂寞…", "你是不是忘了我…"),
            "hum" to listOf("♪ 啦啦啦～", "♪ 哼哼～", "♪"),
            "daydream" to listOf("…在想好吃的", "…要是能长出翅膀就好了", "…今天的云一定很软", "…嘿嘿"),
            "climb" to listOf("嘿咻，嘿咻…", "爬高高！", "上面的风景不错～"),
            "drop" to listOf("跳啦！", "下去咯～", "接住我！"),

            "menu" to listOf("要干嘛呀？", "嗯？叫我？", "有什么吩咐～"),

            "idle_morning" to listOf("早饭吃了没呀？", "上午效率最高啦，加油～", "记得喝水哦！"),
            "idle_noon" to listOf("午饭吃什么好呢～", "中午记得休息一下", "吃饱了犯困…"),
            "idle_afternoon" to listOf("下午容易困，喝口水吧～", "坐久了起来动一动嘛", "要不要歇一会儿？"),
            "idle_evening" to listOf("今天过得怎么样呀？", "晚上好～辛苦啦", "晚饭吃了吗？"),
            "idle_night" to listOf("这么晚了还在玩手机呀…", "熬夜对身体不好哦", "我先眯一会儿…"),
        )
    }
}
