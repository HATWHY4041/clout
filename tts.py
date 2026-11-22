import json, soundfile as sf, numpy as np, os
from kokoro import KPipeline
pipe = KPipeline(lang_code="a")
os.makedirs("out", exist_ok=True)
for voice in ["am_michael", "am_fenrir"]:
    for i, line in enumerate(json.load(open("lines.json"))):
        audio = np.concatenate([np.asarray(a) for _, _, a in pipe(line, voice=voice, speed=1.0)])
        sf.write(f"out/{voice}_{i:02d}.wav", audio, 24000)
        print(voice, i, round(len(audio) / 24000, 2))
