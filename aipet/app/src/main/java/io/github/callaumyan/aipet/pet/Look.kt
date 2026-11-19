package io.github.callaumyan.aipet.pet

/** 表情 */
enum class Face {
    NORMAL, HAPPY, LOVE, BLISS, SHY, ANGRY, ANNOYED, SAD, WORRIED, DIZZY,
    SURPRISED, SLEEPY, SLEEP, PAIN, EAT, THINK,
}

/** 身体姿势 */
enum class Pose {
    STAND, WALK, SIT, LIE, HELD, AIR, CLING_LEFT, CLING_RIGHT, DANCE,
}

/** 一次性的小特效 */
enum class Effect {
    HEARTS, NOTES, EXCLAIM, QUESTION, SPARKLES, BOLTS, CRUMBS, STEAM, SWEAT,
}

/** 点到了身体的哪里 */
enum class Zone { SPROUT, HEAD, FACE, BELLY }
