from faster_whisper import WhisperModel
import json
m = WhisperModel("small.en", device="cpu", compute_type="int8")
segs, _ = m.transcribe("narration.mp3", word_timestamps=True)
words = [{"w": w.word, "s": round(w.start, 2), "e": round(w.end, 2)} for s in segs for w in s.words]
json.dump(words, open("words.json", "w"), indent=0)
print(len(words))
