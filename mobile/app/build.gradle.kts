import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Clé de signature locale (mobile/signature/signature.properties, jamais publiée).
val signature = Properties().apply {
    val fichier = rootProject.file("signature/signature.properties")
    if (fichier.exists()) fichier.inputStream().use { load(it) }
}

android {
    namespace = "app.projekt.mobile"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.projekt.mobile"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    signingConfigs {
        if (signature.isNotEmpty()) {
            create("projekt") {
                storeFile = rootProject.file("signature/" + signature.getProperty("fichier"))
                storePassword = signature.getProperty("motDePasse")
                keyAlias = signature.getProperty("alias")
                keyPassword = signature.getProperty("motDePasse")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (signature.isNotEmpty()) signingConfig = signingConfigs.getByName("projekt")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    // Lecture du QR code d'appairage avec l'appareil photo.
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
