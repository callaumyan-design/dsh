# Claude SDK 自带了 R8 规则（META-INF/proguard/anthropic-java-core.pro），这里只补充它依赖的
# 一些在安卓上用不到的可选库的告警。
-dontwarn java.lang.management.**
-dontwarn javax.annotation.**
-dontwarn org.slf4j.**
# OpenTelemetry 只在编译期用到的注解
-dontwarn com.google.auto.value.**
