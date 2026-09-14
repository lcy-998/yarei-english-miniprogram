param(
    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'

$segments = @(
    @{ Id = 'seg-001'; Text = 'You are a great nurse.'; VoiceContains = 'Zira' },
    @{ Id = 'seg-002'; Text = 'You help many people.'; VoiceContains = 'Zira' },
    @{ Id = 'seg-003'; Text = 'I can help you at home!'; VoiceContains = 'Zira' },
    @{ Id = 'seg-004'; Text = 'You are still a child.'; VoiceContains = 'Hazel' },
    @{ Id = 'seg-005'; Text = 'What can you do?'; VoiceContains = 'Hazel' },
    @{ Id = 'seg-006'; Text = 'I am a big boy now.'; VoiceContains = 'Zira' },
    @{ Id = 'seg-007'; Text = 'I can sweep the floor.'; VoiceContains = 'Zira' },
    @{ Id = 'seg-008'; Text = 'I can cook.'; VoiceContains = 'Zira' },
    @{ Id = 'seg-009'; Text = 'I can look after my baby sister too!'; VoiceContains = 'Zira' },
    @{ Id = 'word-001'; Text = 'P E'; VoiceContains = 'Zira' },
    @{ Id = 'word-002'; Text = 'job'; VoiceContains = 'Zira' },
    @{ Id = 'word-003'; Text = 'doctor'; VoiceContains = 'Zira' },
    @{ Id = 'word-004'; Text = 'farmer'; VoiceContains = 'Zira' },
    @{ Id = 'word-005'; Text = 'nurse'; VoiceContains = 'Zira' },
    @{ Id = 'word-006'; Text = 'office worker'; VoiceContains = 'Zira' },
    @{ Id = 'word-007'; Text = 'factory worker'; VoiceContains = 'Zira' },
    @{ Id = 'word-008'; Text = 'busy'; VoiceContains = 'Zira' },
    @{ Id = 'word-009'; Text = 'tired'; VoiceContains = 'Zira' },
    @{ Id = 'word-010'; Text = 'chore'; VoiceContains = 'Zira' },
    @{ Id = 'word-011'; Text = 'cook'; VoiceContains = 'Zira' },
    @{ Id = 'word-012'; Text = 'clean'; VoiceContains = 'Zira' },
    @{ Id = 'word-013'; Text = 'room'; VoiceContains = 'Zira' },
    @{ Id = 'word-014'; Text = 'look after'; VoiceContains = 'Zira' },
    @{ Id = 'word-015'; Text = 'sweep'; VoiceContains = 'Zira' },
    @{ Id = 'word-016'; Text = 'floor'; VoiceContains = 'Zira' },
    @{ Id = 'word-017'; Text = 'together'; VoiceContains = 'Zira' },
    @{ Id = 'word-018'; Text = 'people'; VoiceContains = 'Zira' },
    @{ Id = 'word-019'; Text = 'child'; VoiceContains = 'Zira' }
)

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$synthesizer = New-Object -ComObject SAPI.SpVoice
$availableVoices = @($synthesizer.GetVoices())
$synthesizer.Rate = -1

foreach ($segment in $segments) {
    $voiceToken = $availableVoices | Where-Object {
        $_.GetDescription() -like "*$($segment.VoiceContains)*"
    } | Select-Object -First 1
    if ($null -eq $voiceToken) {
        throw "Required English demo voice was not found: $($segment.VoiceContains)"
    }

    $targetPath = Join-Path $OutputDirectory "$($segment.Id).wav"
    $stream = New-Object -ComObject SAPI.SpFileStream
    try {
        $stream.Open($targetPath, 3, $false)
        $synthesizer.Voice = $voiceToken
        $synthesizer.AudioOutputStream = $stream
        [void]$synthesizer.Speak($segment.Text)
    }
    finally {
        $stream.Close()
    }
}
