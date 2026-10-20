plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Server the app talks to. Fixed at build time (never taken from intents); override with
// ./gradlew assembleDebug -Plectern.serverUrl=https://staging.example.com
val lecternServerUrl = (findProperty("lectern.serverUrl") as String?)?.trimEnd('/') ?: "https://lectern.qucord.com"

// Release signing is read from the environment (CI secrets); see apps/android/README.md.
// Never commit a keystore or its passwords.
fun envOrNull(name: String): String? = System.getenv(name)?.takeIf { it.isNotBlank() }
val releaseKeystorePath: String? = envOrNull("LECTERN_KEYSTORE_FILE")

android {
    namespace = "com.qucord.lectern"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.qucord.lectern"
        minSdk = 26
        targetSdk = 34
        // Monotonic on CI so each published APK installs as an update over the previous one.
        versionCode = envOrNull("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1
        versionName = "1.0.0"
        buildConfigField("String", "LECTERN_SERVER_URL", "\"$lecternServerUrl\"")
    }

    signingConfigs {
        if (releaseKeystorePath != null) {
            create("release") {
                storeFile = file(releaseKeystorePath)
                storePassword = envOrNull("LECTERN_KEYSTORE_PASSWORD")
                keyAlias = envOrNull("LECTERN_KEY_ALIAS")
                // Unset CI secrets arrive as empty strings; a PKCS12 keystore uses the store password for the key.
                keyPassword = envOrNull("LECTERN_KEY_PASSWORD") ?: envOrNull("LECTERN_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (releaseKeystorePath != null) {
                signingConfigs.getByName("release")
            } else {
                logger.warn(
                    "LECTERN_KEYSTORE_FILE is not set: release builds fall back to this machine's debug key " +
                        "and will not install as an update over a release-signed APK."
                )
                signingConfigs.getByName("debug")
            }
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
        compose = true
        buildConfig = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.10"
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.04.01"))
    implementation("androidx.activity:activity-compose:1.9.0")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.0")

    testImplementation("junit:junit:4.13.2")
    // android.jar only has throwing stubs of org.json; local unit tests need the real implementation.
    testImplementation("org.json:json:20240303")
}
