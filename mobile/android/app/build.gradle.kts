plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "dev.xssh.android"
    compileSdk = 37

    defaultConfig {
        applicationId = "dev.xssh.android"
        // 真机复核用:`-PxsshIdSuffix=.review` 装成另一个包,和设备上已有的(别的电脑签名、带着用户数据)并存,
        // 不用卸载原来那个。
        providers.gradleProperty("xsshIdSuffix").orNull?.let { applicationIdSuffix = it }
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
        ndk {
            abiFilters += listOf("arm64-v8a")
        }
    }

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-text")
    implementation("androidx.activity:activity-compose:1.13.0")
    // 折叠屏:拿到铰链的真实位置与开合状态(分栏分界线要压在折痕上,半折要进桌面模式)。
    implementation("androidx.window:window:1.5.1")
    // Liquid Glass:模糊 + 边缘折射(lens,AGSL 着色器)+ 高光 + 阴影,照 iOS 26 的材质定义做。
    // 折射要 Android 13+,模糊要 12+;更早的系统只剩半透明底色,不崩。
    implementation("io.github.kyant0:backdrop:2.0.1")
    // 生物识别解锁主机密码。这里只用它的 `BiometricManager.canAuthenticate` 做
    // "这台设备有没有可用的门禁"的判断(它一把算出生物识别和锁屏密码两种)。
    // 真正弹解锁框走平台的 `android.hardware.biometrics.BiometricPrompt` ——
    // 它才认 `setAllowedAuthenticators`(同时允许两种认证方式)。
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("net.java.dev.jna:jna:5.19.1@aar")

    // 纯逻辑单测(JVM,不碰设备):凭据取舍、密文形态、路径/前缀这类判错的代价是丢密码。
    testImplementation("junit:junit:4.13.2")
}