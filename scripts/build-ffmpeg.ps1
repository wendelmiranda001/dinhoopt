# build-ffmpeg.ps1 — Build minimal ffmpeg for DiNho Clips Engine
# Requires: MSYS2 with mingw-w64-x86_64-toolchain + nasm + x264 + x265 + ffnvcodec-headers
# Output: resources/ffmpeg-custom/ffmpeg.exe (~20-30MB)
#
# Install dependencies:
#   pacman -S --noconfirm mingw-w64-x86_64-toolchain mingw-w64-x86_64-nasm \
#     mingw-w64-x86_64-x264 mingw-w64-x86_64-x265 mingw-w64-x86_64-ffnvcodec-headers

param(
    [string]$Version = "9.0.1",
    [string]$OutputDir = "$PSScriptRoot\..\resources\ffmpeg-custom",
    [switch]$Clean
)

$ErrorActionPreference = "Stop"
$MSYS2 = "C:\msys64"
$BASH = "$MSYS2\usr\bin\bash.exe"

Write-Host "=== DiNho FFmpeg Custom Build ===" -ForegroundColor Cyan
Write-Host "Version: $Version"
Write-Host "Output:  $OutputDir"
Write-Host ""

# --- Step 1: Download ffmpeg source ---
$BUILD_DIR = "$env:TEMP\ffmpeg-build"
$srcDir = "$BUILD_DIR\ffmpeg-$Version"
$tarFile = "$BUILD_DIR\ffmpeg-$Version.tar.xz"
$url = "https://ffmpeg.org/releases/ffmpeg-$Version.tar.xz"

if (-not (Test-Path $srcDir)) {
    Write-Host "[1/6] Downloading ffmpeg $Version source..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $BUILD_DIR -Force | Out-Null
    if (-not (Test-Path $tarFile)) {
        Invoke-WebRequest -Uri $url -OutFile $tarFile -UseBasicParsing
    }
    Write-Host "      Extracting..."
    tar xf $tarFile -C $BUILD_DIR
    if (-not (Test-Path $srcDir)) { throw "Extraction failed" }
} else {
    Write-Host "[1/6] Source already downloaded" -ForegroundColor Green
}

# --- Step 2: Generate MSYS2 build script ---
Write-Host "[2/6] Generating build script..." -ForegroundColor Yellow

$srcMsys = ($srcDir -replace '\\','/')
$outMsys = ($OutputDir -replace '\\','/')

$buildScript = @"
#!/bin/bash
set -e
export MSYSTEM=MINGW64
export PATH="/mingw64/bin:/usr/bin:/bin:`$PATH"

echo "=== Environment ==="
echo "MSYSTEM=`$MSYSTEM"
uname -a
gcc --version | head -1
echo ""

cd "$srcMsys"

if [ "$($Clean.IsPresent -replace 'True','1' -replace 'False','0')" = "1" ]; then
    echo "=== Cleaning ==="
    make clean 2>/dev/null || true
fi

echo "=== Configuring ==="
./configure \
  --prefix=/mingw64 \
  --enable-gpl \
  --enable-nonfree \
  --disable-everything \
  --disable-doc \
  --disable-htmlpages \
  --disable-manpages \
  --disable-podpages \
  --disable-txtpages \
  --disable-avdevice \
  --enable-static \
  --disable-shared \
  --enable-libx264 \
  --enable-libx265 \
  --enable-ffnvcodec \
  --enable-encoder=h264_nvenc,hevc_nvenc,av1_nvenc,libx264,libx265,aac \
  --enable-decoder=h264,hevc,av1,aac \
  --enable-muxer=mp4,matroska,image2,adts,concat,h264,hevc,av1 \
  --enable-demuxer=matroska,aac,concat,rawvideo,f32le,lavfi,h264,hevc,av1 \
  --enable-filter=anlmdn,afftdn,scale,crop \
  --enable-bsf=h264_mp4toannexb,aac_adtstoasc \
  --enable-protocol=pipe \
  --enable-small \
  --pkg-config-flags=--static

# Patch config.mak for MinGW gcc 16.x compatibility:
# MinGW's math.h already provides lrint/llrint/rint as extern declarations,
# but configure can't detect them (no -lm needed on MinGW). Force HAVE_*=1
# so ffmpeg doesn't try to provide conflicting static definitions.
echo ""
echo "=== Patching config.mak for MinGW compatibility ==="
if [ -f ffbuild/config.mak ]; then
  sed -i 's/^HAVE_LRINT=0/HAVE_LRINT=1/' ffbuild/config.mak
  sed -i 's/^HAVE_LRINTF=0/HAVE_LRINTF=1/' ffbuild/config.mak
  sed -i 's/^HAVE_RINT=0/HAVE_RINT=1/' ffbuild/config.mak
  sed -i 's/^HAVE_ROUND=0/HAVE_ROUND=1/' ffbuild/config.mak
  sed -i 's/^HAVE_ROUNDF=0/HAVE_ROUNDF=1/' ffbuild/config.mak
  sed -i 's/^HAVE_TRUNC=0/HAVE_TRUNC=1/' ffbuild/config.mak
  sed -i 's/^HAVE_TRUNCF=0/HAVE_TRUNCF=1/' ffbuild/config.mak
  echo "Forced HAVE_LRINT=1 and related math functions"
fi

echo ""
echo "=== Building ==="
cores=`$(nproc)
echo "Using `$cores parallel jobs"
mingw32-make -j`$cores

echo ""
echo "=== Copying ==="
ls -lh ffmpeg.exe
mkdir -p "$outMsys"
cp ffmpeg.exe "$outMsys/ffmpeg.exe"
echo "Copied to $outMsys/ffmpeg.exe"

echo ""
echo "=== Done ==="
"@

$msysScriptPath = "C:\msys64\tmp\ffmpeg-build.sh"
[System.IO.File]::WriteAllText($msysScriptPath, $buildScript, [System.Text.UTF8Encoding]::new($false))

# --- Step 4: Build ---
Write-Host "[4/6] Building ffmpeg (this takes 5-15 minutes)..." -ForegroundColor Yellow

$proc = Start-Process -FilePath $BASH -ArgumentList "-l", "/tmp/ffmpeg-build.sh" `
    -Wait -PassThru -NoNewWindow `
    -RedirectStandardOutput "$BUILD_DIR\build-out.log" `
    -RedirectStandardError "$BUILD_DIR\build-err.log"

# Stream output in real-time
if (Test-Path "$BUILD_DIR\build-out.log") {
    Get-Content "$BUILD_DIR\build-out.log" -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_ -match "^===|^Using|^gcc|^make|^-|^warning:|WARNING:") { Write-Host "  $_" }
        elseif ($_ -match "error|Error") { Write-Host "  $_" -ForegroundColor Red }
    }
}

if ($proc.ExitCode -ne 0) {
    Write-Host "BUILD FAILED (exit code $($proc.ExitCode))" -ForegroundColor Red
    if (Test-Path "$BUILD_DIR\build-err.log") {
        Get-Content "$BUILD_DIR\build-err.log" -ErrorAction SilentlyContinue | Select-Object -Last 30 | ForEach-Object {
            Write-Host "  $_" -ForegroundColor Red
        }
    }
    throw "Build failed"
}

# --- Step 5: Copy DLLs ---
Write-Host "[5/6] Copying runtime DLLs..." -ForegroundColor Yellow
$msysBin = "$MSYS2\mingw64\bin"

# Find DLLs that ffmpeg.exe depends on (from MSYS2)
$neededDlls = @(
    "libbz2-1.dll",
    "libgcc_s_seh-1.dll",
    "libiconv-2.dll",
    "libwinpthread-1.dll",
    "libva.dll",
    "libva_win32.dll",
    "libx264-165.dll",
    "libx265-216.dll",
    "zlib1.dll",
    "libstdc++-6.dll"
)

foreach ($dll in $neededDlls) {
    $src = Join-Path $msysBin $dll
    $dst = Join-Path $OutputDir $dll
    if (Test-Path $src) {
        Copy-Item $src $dst -Force
        $size = [math]::Round((Get-Item $dst).Length / 1KB, 1)
        Write-Host "  $dll ($size KB)"
    } else {
        Write-Host "  WARN: $dll not found in MSYS2" -ForegroundColor Yellow
    }
}

# --- Step 6: Verify + Test ---
Write-Host "[6/6] Verifying..." -ForegroundColor Yellow
$ffmpegPath = "$OutputDir\ffmpeg.exe"
if (-not (Test-Path $ffmpegPath)) { throw "ffmpeg.exe not found at $ffmpegPath" }

$ffmpegSize = [math]::Round((Get-Item $ffmpegPath).Length / 1MB, 1)
$totalSize = [math]::Round((Get-ChildItem $OutputDir -File | Measure-Object -Property Length -Sum).Sum / 1MB, 1)
Write-Host ""
Write-Host "=== Build Complete ===" -ForegroundColor Green
Write-Host "  ffmpeg.exe: $ffmpegSize MB"
Write-Host "  Total (with DLLs): $totalSize MB (was 231 MB)"
Write-Host "  Saved: $([math]::Round(231 - $totalSize, 0)) MB ($([math]::Round((231 - $totalSize) / 231 * 100))%)"
Write-Host "  Path: $OutputDir"

# --- Step 6: Test ---
Write-Host "[6/6] Testing ffmpeg..." -ForegroundColor Yellow
& $ffmpegPath -version 2>&1 | Select-Object -First 3 | ForEach-Object { Write-Host "  $_" }

Write-Host ""
Write-Host "Encoders:" -ForegroundColor Cyan
& $ffmpegPath -encoders 2>&1 | Select-String "h264_nvenc|hevc_nvenc|av1_nvenc|libx264|libx265|aac" | ForEach-Object { Write-Host "  $_" }
