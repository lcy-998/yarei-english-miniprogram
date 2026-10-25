"""Generate only synthetic/local benchmark MP3 files in an explicit output directory."""

import array
import sys
import wave
from pathlib import Path

import lameenc

source = Path(sys.argv[1])
output = Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)
with wave.open(str(source), "rb") as audio:
    assert audio.getnchannels() == 1 and audio.getsampwidth() == 2
    rate = audio.getframerate()
    speech = array.array("h")
    speech.frombytes(audio.readframes(audio.getnframes()))


def save(name, samples):
    encoder = lameenc.Encoder()
    encoder.set_in_sample_rate(rate)
    encoder.set_channels(1)
    encoder.set_bit_rate(64)
    data = encoder.encode(samples.tobytes()) + encoder.flush()
    (output / name).write_bytes(data)


save("silence-1s.mp3", array.array("h", [0]) * rate)
save("speech-1s.mp3", speech[:rate])
# MP3 encoder padding can cross the strict 300000 ms limit; 299 seconds stays valid.
save("speech-5min.mp3", (speech * (299 * rate // len(speech) + 1))[:299 * rate])
save("noisy-speech.mp3", array.array("h", (max(-32768, min(32767, value + ((i * 109) % 10000 - 5000)))
                                             for i, value in enumerate(speech))))
