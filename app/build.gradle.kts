plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Assinatura fixa via variáveis de ambiente (GitHub Secrets).
// Sem keystore fixa, cada build sai com chave diferente e o Android
// recusa atualizar por cima ("conflito de assinatura").
val ksFile = System.getenv("KEYSTORE_FILE")
val hasReleaseKey = !ksFile.isNullOrBlank() && file(ksFile).exists()

android {
    namespace = "com.estiven4tech.tvlauncher"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.estiven4tech.tvlauncher"
        minSdk = 29          // Android 10: boxes baratos
        targetSdk = 35
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "0.1.${System.getenv("GITHUB_RUN_NUMBER") ?: "0"}"

        // URL remota da interface (OTA). Vazio = usa só a versão embutida no APK.
        buildConfigField("String", "START_URL", "\"${System.getenv("START_URL") ?: ""}\"")
        // Origens autorizadas a navegar / usar a ponte JS (separadas por vírgula).
        buildConfigField("String", "ALLOWED_ORIGINS", "\"${System.getenv("ALLOWED_ORIGINS") ?: ""}\"")
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = file(ksFile!!)
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KEY_ALIAS")
                keyPassword = System.getenv("KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = if (hasReleaseKey) signingConfigs.getByName("release")
                            else signingConfigs.getByName("debug")
        }
    }

    buildFeatures { buildConfig = true }

    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
}
