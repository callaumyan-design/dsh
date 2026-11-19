plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "io.github.callaumyan.aipet"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.callaumyan.aipet"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "0.2.0"
    }

    // 固定的签名钥匙：保证以后每个新版本都能直接覆盖安装（不用先卸载、不丢设置）。
    // 注意：这把钥匙随仓库公开，只适合自用的小 App，详见 README。
    signingConfigs {
        create("pet") {
            storeFile = file("../keystore/aipet.jks")
            storePassword = "aipet-pass"
            keyAlias = "aipet"
            keyPassword = "aipet-pass"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("pet")
        }
        debug {
            signingConfig = signingConfigs.getByName("pet")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        buildConfig = true
        viewBinding = true
    }
    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
    packaging {
        resources {
            excludes += setOf(
                "META-INF/DEPENDENCIES",
                "META-INF/LICENSE*",
                "META-INF/NOTICE*",
                "META-INF/versions/**",
            )
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    // Claude 官方 SDK（选择 Claude 作为 AI 时使用）
    implementation("com.anthropic:anthropic-java:3.10.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    // 在电脑上把桌宠和界面真实地画成图片（检查长相用）
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("androidx.test:core:1.6.1")
}
