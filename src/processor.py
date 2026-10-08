import argparse,json,os,re
from pathlib import Path
from faster_whisper import WhisperModel
def clean(t):return re.sub(r"\s+"," ",t or "").strip()
def transcribe(model,audio,task,language=None):
 kw={"task":task,"beam_size":5,"vad_filter":True,"condition_on_previous_text":False}
 if language and language!="auto":kw["language"]=language
 segs,info=model.transcribe(str(audio),**kw);rows=[]
 for s in segs:
  t=clean(s.text)
  if t:rows.append({"start":round(s.start,2),"end":round(s.end,2),"text":t})
 return rows,info.language,round(info.language_probability or 0,3)
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--audio",required=True);ap.add_argument("--index",type=int,required=True);ap.add_argument("--out",required=True);a=ap.parse_args()
 o=Path(a.out);o.mkdir(parents=True,exist_ok=True);m=WhisperModel(os.getenv("WHISPER_MODEL","small"),device="cpu",compute_type="int8")
 original,lang,prob=transcribe(m,a.audio,"transcribe");translated=original if lang=="en" else transcribe(m,a.audio,"translate",lang)[0]
 ot="\n".join(f"[{x['start']:07.2f}-{x['end']:07.2f}] {x['text']}" for x in original);tt="\n".join(f"[{x['start']:07.2f}-{x['end']:07.2f}] {x['text']}" for x in translated)
 (o/f"chunk_{a.index:04d}_transcript.txt").write_text(ot,encoding="utf-8");(o/f"chunk_{a.index:04d}_translation.txt").write_text(tt,encoding="utf-8")
 sentences=re.split(r"(?<=[.!?])\s+",tt);keys=("decided","decision","action","deadline","approve","approved","assign","owner","next","risk","issue","target","due")
 selected=[s for s in sentences if len(s)>45 and any(k in s.lower() for k in keys)]
 (o/f"chunk_{a.index:04d}_summary.txt").write_text(" ".join((selected[:12] or sentences[:8]))[:5000],encoding="utf-8")
 (o/f"chunk_{a.index:04d}.json").write_text(json.dumps({"index":a.index,"language":lang,"language_probability":prob,"segments":len(original)},indent=2),encoding="utf-8")
 print(json.dumps({"chunk":a.index,"language":lang,"segments":len(original)}))
if __name__=="__main__":main()
