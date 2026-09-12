# Construit Projekt Mobile (fichier .apk a installer sur le telephone).
#
#   powershell -ExecutionPolicy Bypass -File mobile\construire-apk.ps1 [-Release]
#
# Fichier volontairement SANS accents : Windows PowerShell 5.1 lit mal l'UTF-8.
#
# Les outils Android refusent un chemin contenant un caractere accentue
# ("Projet BE" avec trema) : le projet mobile est donc copie dans un dossier sans
# accent, construit la-bas, et l'APK revient dans mobile\sortie\.
param([switch]$Release)

$ErrorActionPreference = "Stop"
$outils = "$env:USERPROFILE\ProjektOutils"
$env:JAVA_HOME = Join-Path $outils "jdk17"
$env:ANDROID_HOME = Join-Path $outils "sdk"
$env:GRADLE_USER_HOME = Join-Path $outils "gradle-cache"
# Un filtre reseau de ce PC inspecte le HTTPS : Java doit utiliser les certificats de Windows.
$env:JAVA_TOOL_OPTIONS = "-Djavax.net.ssl.trustStoreType=Windows-ROOT"
# Gradle deja installe dans les outils : le lanceur gradlew irait le retelecharger.
$gradle = Join-Path $outils "gradle-8.10.2\bin\gradle.bat"

$source = $PSScriptRoot
$chantier = Join-Path $outils "chantier-mobile"
$sortie = Join-Path $source "sortie"

robocopy $source $chantier /MIR /XD build .gradle sortie /XF local.properties /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "copie du projet impossible (robocopy $LASTEXITCODE)" }
$sdk = $env:ANDROID_HOME.Replace("\", "\\").Replace(":", "\:")
Set-Content -Encoding ascii -Path (Join-Path $chantier "local.properties") -Value "sdk.dir=$sdk"

Set-Location $chantier
$tache = if ($Release) { "assembleRelease" } else { "assembleDebug" }
& $gradle --no-daemon testDebugUnitTest $tache
if ($LASTEXITCODE -ne 0) { throw "construction echouee" }

New-Item -ItemType Directory -Force $sortie | Out-Null
$type = if ($Release) { "release" } else { "debug" }
$apk = Get-ChildItem (Join-Path $chantier "app\build\outputs\apk\$type\*.apk") | Select-Object -First 1
Copy-Item $apk.FullName (Join-Path $sortie "Projekt-Mobile.apk") -Force

# Numero de version lu par l'app bureau, qui propose la mise a jour au telephone.
$gradleApp = Get-Content (Join-Path $source "app\build.gradle.kts") -Raw
$code = [regex]::Match($gradleApp, 'versionCode\s*=\s*(\d+)').Groups[1].Value
$nom = [regex]::Match($gradleApp, 'versionName\s*=\s*"([^"]+)"').Groups[1].Value
Set-Content -Encoding ascii -Path (Join-Path $sortie "version.json") -Value "{`"versionCode`":$code,`"versionName`":`"$nom`"}"

"APK : $sortie\Projekt-Mobile.apk ($([math]::Round($apk.Length / 1MB, 1)) Mo), version $nom ($code)"
