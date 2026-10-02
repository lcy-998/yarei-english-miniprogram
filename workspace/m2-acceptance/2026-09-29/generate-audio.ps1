$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

$assetDirectory = Join-Path $PSScriptRoot 'assets'
New-Item -ItemType Directory -Force -Path $assetDirectory | Out-Null

$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice.SelectVoice('Microsoft Zira Desktop')
$voice.Rate = -2

try {
    $voice.SetOutputToWaveFile((Join-Path $assetDirectory 'phonics-short-a.wav'))
    $voice.Speak('Short a. Cat. Hat. The cat has a hat.')
    $voice.SetOutputToNull()

    $voice.SetOutputToWaveFile((Join-Path $assetDirectory 'zoo-narration.wav'))
    $voice.Speak('Hello! I see an elephant. The elephant is big. I see a giraffe. The giraffe is tall.')
    $voice.SetOutputToNull()

    $voice.SetOutputToWaveFile((Join-Path $assetDirectory 'recording-example.wav'))
    $voice.Speak('I see an elephant. It is big and kind.')
    $voice.SetOutputToNull()
}
finally {
    $voice.Dispose()
}
