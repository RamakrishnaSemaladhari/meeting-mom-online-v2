import argparse, json, os, re, time
from pathlib import Path
from faster_whisper import WhisperModel

def clean(t):
    return re.sub(r"\\s+", " ", t or "").strip()

def transcribe(model, audio, task, language=None):
    beam_size=max(1,int(os.getenv("WHISPER_BEAM_SIZE","3")))
    kw={"task":task,"beam_size":beam_size,"vad_filter":True,"condition_on_previous_text":False}
    if language and language!="auto": kw["language"]=language
    segs,info=model.transcribe(str(audio),**kw)
    rows=[]
    for s in segs:
        t=clean(s.text)
        if t: rows.append({"start":round(s.start,2),"end":round(s.end,2),"text":t})
    return rows,info.language,round(info.language_probability or 0,3)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--audio",required=True); ap.add_argument("--index",type=int,required=True); ap.add_argument("--out",required=True)
    a=ap.parse_args(); started=time.monotonic()
    o=Path(a.out); o.mkdir(parents=True,exist_ok=True)
    model_name=os.getenv("WHISPER_MODEL","small")
    model=WhisperModel(model_name,device=os.getenv("WHISPER_DEVICE","cpu"),compute_type=os.getenv("WHISPER_COMPUTE_TYPE","int8"))
    original,lang,prob=transcribe(model,a.audio,"transcribe")
    transcribe_seconds=time.monotonic()-started
    if lang=="en":
        translated=original; translation_seconds=0.0
    else:
        translation_started=time.monotonic()
        translated=transcribe(model,a.audio,"translate",lang)[0]
        translation_seconds=time.monotonic()-translation_started
    ot="\\n".join(f"[{x['start']:07.2f}-{x['end']:07.2f}] {x['text']}" for x in original)
    tt="\\n".join(f"[{x['start']:07.2f}-{x['end']:07.2f}] {x['text']}" for x in translated)
    (o/f"chunk_{a.index:04d}_transcript.txt").write_text(ot,encoding="utf-8")
    (o/f"chunk_{a.index:04d}_translation.txt").write_text(tt,encoding="utf-8")
    # Keep a lightweight chunk note; the final synthesis reads the full translation and these notes.
    sentences=re.split(r"(?<=[.!?])\\s+",tt)
    keys=("decided","decision","action","deadline","approve","approved","assign","owner","next","risk","issue","target","due","discuss","agreed","need","must","should")
    selected=[s for s in sentences if len(s)>35 and any(k in s.lower() for k in keys)]
    note="\\n".join(selected[:30] or sentences[:20])
    (o/f"chunk_{a.index:04d}_summary.txt").write_text(note[:12000],encoding="utf-8")
    timing={"index":a.index,"language":lang,"language_probability":prob,"segments":len(original),
            "transcription_seconds":round(transcribe_seconds,2),"translation_seconds":round(translation_seconds,2),
            "total_seconds":round(time.monotonic()-started,2),"model":model_name,"beam_size":int(os.getenv("WHISPER_BEAM_SIZE","3"))}
    (o/f"chunk_{a.index:04d}.json").write_text(json.dumps(timing,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(timing,ensure_ascii=False))
if __name__=="__main__": main()
