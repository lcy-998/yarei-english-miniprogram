param(
    [string]$Ffmpeg = 'ffmpeg'
)

$ErrorActionPreference = 'Stop'
if (-not (Get-Command $Ffmpeg -ErrorAction SilentlyContinue)) { throw 'ffmpeg executable unavailable; pass -Ffmpeg with its path' }
$assetDirectory = Join-Path $PSScriptRoot 'assets'

foreach ($name in @('phonics-short-a', 'zoo-narration', 'recording-example')) {
    & $Ffmpeg -hide_banner -loglevel error -y -i (Join-Path $assetDirectory "$name.wav") -codec:a libmp3lame -qscale:a 4 (Join-Path $assetDirectory "$name.mp3")
    if ($LASTEXITCODE -ne 0) { throw "MP3 encode failed: $name" }
}

& $Ffmpeg -hide_banner -loglevel error -y `
    -loop 1 -framerate 25 -t 5 -i (Join-Path $assetDirectory 'zoo-elephant-page.png') `
    -loop 1 -framerate 25 -t 5 -i (Join-Path $assetDirectory 'zoo-giraffe-page.png') `
    -i (Join-Path $assetDirectory 'zoo-narration.wav') `
    -filter_complex '[0:v]scale=1280:720,setsar=1[v0];[1:v]scale=1280:720,setsar=1[v1];[v0][v1]concat=n=2:v=1:a=0[v]' `
    -map '[v]' -map '2:a' -codec:v libx264 -preset veryfast -crf 25 `
    -pix_fmt yuv420p -codec:a aac -b:a 96k -shortest -movflags +faststart `
    (Join-Path $assetDirectory 'zoo-friends-demo.mp4')
if ($LASTEXITCODE -ne 0) { throw 'Video encode failed' }

foreach ($name in @('zoo-friends-cover', 'zoo-elephant-page', 'zoo-giraffe-page')) {
    & $Ffmpeg -hide_banner -loglevel error -y -i (Join-Path $assetDirectory "$name.png") `
        -frames:v 1 -q:v 3 (Join-Path $assetDirectory "$name.jpg")
    if ($LASTEXITCODE -ne 0) { throw "JPEG encode failed: $name" }
}
