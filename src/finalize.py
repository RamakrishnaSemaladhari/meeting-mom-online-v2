import argparse,json,os,textwrap,requests
from pathlib import Path
from src.drive import DriveClient
def ollama(prompt,model):
 r=requests.post("http://127.0.0.1:11434/api/generate",json={"model":model,"prompt":prompt,"stream":False,"options":{"temperature":0.15,"num_ctx":32768}},timeout=900);r.raise_for_status();return r.json()["response"].strip()
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--payload",required=True);ap.add_argument("--out",required=True);a=ap.parse_args()
 p=json.loads(Path(a.payload).read_text(encoding="utf-8"));o=Path(a.out);o.mkdir(parents=True,exist_ok=True)
 ts="\n\n".join(x.read_text(encoding="utf-8") for x in sorted(o.glob("chunk_*_transcript.txt")));tr="\n\n".join(x.read_text(encoding="utf-8") for x in sorted(o.glob("chunk_*_translation.txt")));sm="\n\n".join(f"CHUNK {i+1}\n{x.read_text(encoding='utf-8')}" for i,x in enumerate(sorted(o.glob("chunk_*_summary.txt"))))
 model=os.getenv("OLLAMA_MODEL","qwen2.5:3b");title=p.get("meeting_title") or "Meeting"
 base=textwrap.dedent(f"""You are preparing a factual corporate Minutes of Meeting.
Meeting title: {title}
Meeting date: {p.get("meeting_date","Not specified")}
Venue/mode: {p.get("venue_mode","Not specified")}
Agenda: {p.get("agenda","Not specified")}
Participants supplied by organizer: {p.get("participants","Not specified")}
Use only supported facts. Never invent names, decisions, owners, dates or commitments.
CHRONOLOGICAL CHUNK SUMMARIES:
{sm}""")
 summary=ollama(base+"\nReturn an executive summary, key discussion points, decisions, action items with owner/due date/status, risks/issues and next steps.",model)
 mom=ollama(base+f"""\nWrite a polished professional Minutes of Meeting for circulation. Include metadata, executive summary, discussion points, decisions, action-item table, risks/issues, deadlines and next steps. Use 'Not specified' where unsupported.
MEETING SUMMARY:
{summary}""",model)
 (o/"transcript.txt").write_text(ts,encoding="utf-8");(o/"translation_en.txt").write_text(tr,encoding="utf-8");(o/"summary.txt").write_text(summary,encoding="utf-8");(o/"mom.txt").write_text(mom,encoding="utf-8")
 (o/"manifest.json").write_text(json.dumps({"meeting_id":p["meeting_id"],"meeting_title":title,"chunk_count":len(list(o.glob("chunk_*_summary.txt"))),"outputs":["transcript.txt","translation_en.txt","summary.txt","mom.txt"]},ensure_ascii=False,indent=2),encoding="utf-8")
 d=DriveClient();parent=p.get("meeting_folder_id") or p.get("audio_folder_id");ids={}
 for n,mime in [("transcript.txt","text/plain"),("translation_en.txt","text/plain"),("summary.txt","text/plain"),("mom.txt","text/plain"),("manifest.json","application/json")]:ids[n]=d.upload(o/n,f"{title} - {n}",parent,mime).get("id")
 g=os.getenv("MMV2_GATEWAY_URL","").strip()
 if g:requests.get(g,params={"action":"registry_complete","meeting_id":p["meeting_id"]},timeout=60).raise_for_status()
 print(json.dumps({"success":True,"meeting_id":p["meeting_id"],"uploaded":ids}))
if __name__=="__main__":main()
