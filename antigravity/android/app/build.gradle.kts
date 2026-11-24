import java.util.Properties

plugins {
    id("com.android.application")
}

// 发布版签名：密钥是 android/release.p12（加了密码，可以放在仓库里），
// 密码从环境变量 AG_KEYSTORE_PASSWORD（GitHub Actions 的 Secrets）或 android/keystore.properties（本机，不提交）读取。
// 没有密码时用调试签名：装得上，但不能覆盖安装正式签名的版本。
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val releaseKeystore = rootProject.file("release.p12")
val releasePassword = System.getenv("AG_KEYSTORE_PASSWORD")?.takeIf { it.isNotBlank() }
    ?: keystoreProps.getProperty("password")?.takeIf { it.isNotBlank() }
val canSignRelease = releaseKeystore.exists() && releasePassword != null

android {
    namespace = "com.callaum.antigravity"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.callaum.antigravity"
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "1.0.1"
    }

    signingConfigs {
        if (canSignRelease) {
            create("release") {
                storeFile = releaseKeystore
                storeType = "pkcs12"
                storePassword = releasePassword
                keyAlias = "antigravity"
                keyPassword = releasePassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (canSignRelease) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets {
        getByName("main") {
            // 翻译脚本和词典放在 antigravity/i18n/，和网页测试共用一份
            assets.srcDir("../../i18n")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
        // 界面只有中文，提示文字直接写在代码里
        disable += "SetTextI18n"
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.18.0")
    implementation("androidx.core:core:1.16.0")
}
