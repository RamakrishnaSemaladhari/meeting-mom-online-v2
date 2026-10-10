import argparse, json, os, re, requests, sys
from pathlib import Path
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
sys.path.insert(0, str(Path(__file__).resolve().parent))
from drive import DriveClient

def ollama(prompt, model):
    r=requests.post("http://127.0.0.1:11434/api/generate",
        json={"model":model,"prompt":prompt,"stream":False,
              "options":{"temperature":0.15,"num_ctx":32768}},
        timeout=900)
    r.raise_for_status()
    answer=(r.json().get("response") or "").strip()
    if not answer: raise RuntimeError("Ollama returned an empty response")
    return answer

def notify_progress(payload, event, stage, percent, message):
    gateway=os.getenv("MMV2_GATEWAY_URL","").strip()
    if not gateway: return
    body={"action":"processing_event","callback_secret":os.getenv("MMV2_CALLBACK_SECRET",""),
          "meeting_id":payload.get("meeting_id",""),"event":event,"stage":stage,
          "progress_percent":percent,"status":"PROCESSING","message":message}
    try:
        r=requests.post(gateway,json=body,timeout=20); r.raise_for_status()
        print(json.dumps({"progress_callback":event,"status":r.status_code}))
    except Exception as exc:
        print("progress callback warning:",str(exc))

def merge_chunks(out, suffix):
    chunks=sorted(out.glob("chunk_*_"+suffix))
    merged=[]
    for path in chunks:
        match=re.search(r"chunk_(\d+)_",path.name)
        offset=(int(match.group(1))*600) if match else 0
        for line in path.read_text(encoding="utf-8").splitlines():
            stamp=re.match(r"^\[(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\](.*)$",line)
            if stamp:
                start=float(stamp.group(1))+offset; end=float(stamp.group(2))+offset
                merged.append(f"[{start:07.2f}-{end:07.2f}]{stamp.group(3)}")
            else:
                merged.append(line)
        merged.append("")
    return "\n".join(merged).strip()

def make_word(path, meeting, mom_text, summary):
    doc=Document()
    sec=doc.sections[0]
    sec.top_margin=Inches(0.7); sec.bottom_margin=Inches(0.7)
    sec.left_margin=Inches(0.8); sec.right_margin=Inches(0.8)
    styles=doc.styles
    styles["Normal"].font.name="Aptos"
    styles["Normal"].font.size=Pt(10)
    styles["Normal"].paragraph_format.space_after=Pt(5)
    styles["Title"].font.name="Aptos Display"
    styles["Title"].font.size=Pt(22)
    styles["Title"].font.bold=True
    title=doc.add_paragraph(style="Title")
    title.alignment=WD_ALIGN_PARAGRAPH.CENTER
    title.add_run("MINUTES OF MEETING")
    subtitle=doc.add_paragraph()
    subtitle.alignment=WD_ALIGN_PARAGRAPH.CENTER
    run=subtitle.add_run(meeting.get("meeting_title") or "Meeting")
    run.bold=True; run.font.size=Pt(13)
    table=doc.add_table(rows=0, cols=2)
    table.style="Light Shading Accent 1"
    details=[
      ("Meeting ID",meeting.get("meeting_id","")),
      ("Date",meeting.get("meeting_date","Not specified")),
      ("Time",str(meeting.get("start_time") or "Not specified")+" – "+str(meeting.get("end_time") or "Not specified")),
      ("Type / Subtype",str(meeting.get("meeting_type") or "General Meeting")+" / "+str(meeting.get("meeting_subtype") or "General")),
      ("Workflow Stage",meeting.get("workflow_stage") or "Standard"),
      ("Venue / Mode",meeting.get("venue_mode") or meeting.get("venue") or "Not specified"),
      ("Participants",meeting.get("participants") or "Not specified"),
      ("Agenda",meeting.get("agenda") or "Not specified")
    ]
    for k,v in details:
      cells=table.add_row().cells; cells[0].text=k; cells[1].text=str(v)
      for rr in cells[0].paragraphs[0].runs: rr.bold=True
    doc.add_paragraph("")
    if summary.strip():
      doc.add_heading("Executive Summary", level=1)
      for line in summary.splitlines():
        if line.strip(): doc.add_paragraph(line.strip())
    doc.add_heading("Minutes and Discussion", level=1)
    first=True
    for raw in mom_text.splitlines():
      line=raw.strip()
      if not line:
        continue
      if first and line.upper() in ("MINUTES OF MEETING","MEETING MINUTES"):
        first=False; continue
      first=False
      if len(line)<90 and (line.endswith(":") or re.match(r"^(executive summary|meeting details|agenda|attendees|participants|key discussion|discussion points|decisions|action items|next steps|deadlines|risks|issues|open questions|follow-up|conclusion|stage [123])\s*$",line,re.I)):
        doc.add_heading(line.rstrip(":"),level=2)
      elif re.match(r"^[-*•]\s+",line):
        doc.add_paragraph(re.sub(r"^[-*•]\s+","",line),style="List Bullet")
      elif re.match(r"^\d+[.)]\s+",line):
        doc.add_paragraph(re.sub(r"^\d+[.)]\s+","",line),style="List Number")
      else:
        doc.add_paragraph(line)
    footer=sec.footer.paragraphs[0]
    footer.alignment=WD_ALIGN_PARAGRAPH.CENTER
    footer.add_run("Meeting online V2 • Generated from recorded meeting content").font.size=Pt(8)
    doc.save(path)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--payload",required=True); ap.add_argument("--out",required=True)
    a=ap.parse_args()
    p=json.loads(Path(a.payload).read_text(encoding="utf-8"))
    o=Path(a.out); o.mkdir(parents=True,exist_ok=True)
    ts=merge_chunks(o,"transcript.txt")
    tr=merge_chunks(o,"translation.txt")
    chunk_summaries="\n\n".join("CHUNK "+str(i+1)+"\n"+x.read_text(encoding="utf-8") for i,x in enumerate(sorted(o.glob("chunk_*_summary.txt"))))
    if not ts.strip() or not tr.strip(): raise RuntimeError("Transcript or English translation is empty; refusing to complete meeting.")
    model=os.getenv("OLLAMA_MODEL","qwen2.5:3b")
    notify_progress(p,"SUMMARY_STARTED","GENERATING_SUMMARY",80,"Generating a complete meeting summary from the full transcript and translation.")
    title=p.get("meeting_title") or "Meeting"
    meeting_type=p.get("meeting_type") or "General Meeting"
    subtype=p.get("meeting_subtype") or "General"
    stage=p.get("workflow_stage") or "Standard"
    # Include the full translated meeting when possible so the summary is about the entire discussion,
    # not just keyword-selected action sentences. Keep a bounded context for the configured local model.
    translation_context=tr[:100000]
    context_note="" if len(tr)<=100000 else "\nNOTE: Translation exceeds model context budget; use the full chronological chunk summaries for remaining material and do not claim details not present in context."
    base=f"""You are an accurate professional meeting analyst. Do not invent facts.
MEETING TITLE: {title}
MEETING ID: {p.get('meeting_id','')}
DATE: {p.get('meeting_date','Not specified')}
TIME: {p.get('start_time','Not specified')} – {p.get('end_time','Not specified')}
VENUE / MODE: {p.get('venue_mode') or p.get('venue') or 'Not specified'}
PARTICIPANTS: {p.get('participants') or 'Not specified'}
AGENDA: {p.get('agenda') or 'Not specified'}
MEETING TYPE: {meeting_type}
SUBTYPE: {subtype}
WORKFLOW STAGE: {stage}
For legal workflow stages, apply the requested stage:
- Stage 1 — Case Analysis: facts, chronology, parties, issues, claims, questions and missing information.
- Stage 2 — Document Verification: referenced evidence/documents, verification status, inconsistencies and missing records. Do not claim to verify files that were not supplied.
- Stage 3 — Legal Drafting: prepare a suitable draft from supported facts, flag assumptions and unresolved facts; do not fabricate authorities or legal citations.
For all other meeting types, tailor structure to the subtype and agenda.
CHRONOLOGICAL CHUNK SUMMARIES:
{chunk_summaries[:30000]}
FULL ENGLISH TRANSLATION (timestamps retained where available):
{translation_context}{context_note}
"""
    summary=ollama(base+"""
Create a COMPLETE STANDALONE MEETING SUMMARY for a person who does not want formal minutes. Cover the entire meeting, not only decisions: purpose and context, all major topics in chronological order, explanations and important details, conclusions, decisions, unresolved questions, risks/concerns, action items with owner and deadline only where actually stated, and next steps. Preserve important numbers, names, technical terms and distinctions. Clearly mark information not stated. Do not fabricate. Use useful headings and readable detail; do not make it merely a short executive summary.""",model)
    notify_progress(p,"MOM_STARTED","GENERATING_MOM",86,"Generating formal Minutes of Meeting and stage-specific content.")
    mom=ollama(base+f"""
Create formal, circulation-ready Minutes of Meeting (MoM), distinct from the standalone summary. Include a title, meeting metadata, agenda, attendees, purpose, key discussion points, decisions, action-item table/list with owner/deadline/status only where supported, risks/issues, open questions, next steps and follow-up. Include all material topics, not only actions. Never invent attendees, dates, commitments or legal facts. Use 'Not specified' when needed. For the selected workflow stage, make the stage-specific section explicit.
STANDALONE MEETING SUMMARY:
{summary}
""",model)
    notify_progress(p,"UPLOAD_STARTED","UPLOADING_REPORTS",92,"Uploading transcript, translation, full summary, MoM, Word document and manifest to Google Drive.")
    outputs={
      "transcript.txt":ts,
      "translation_en.txt":tr,
      "summary.txt":summary,
      "mom.txt":mom
    }
    for name,content in outputs.items():
      if not content.strip(): raise RuntimeError("Required output is empty: "+name)
      (o/name).write_text(content,encoding="utf-8")
    (o/"manifest.json").write_text(json.dumps({
      "meeting_id":p["meeting_id"],"meeting_title":title,"meeting_type":meeting_type,
      "meeting_subtype":subtype,"workflow_stage":stage,
      "chunk_count":len(list(o.glob("chunk_*_transcript.txt"))),
      "outputs":["transcript.txt","translation_en.txt","summary.txt","mom.txt","mom.docx"]
    },ensure_ascii=False,indent=2),encoding="utf-8")
    make_word(o/"mom.docx",p,mom,summary)
    d=DriveClient()
    parent=p.get("reports_folder_id") or p.get("meeting_folder_id") or p.get("audio_folder_id")
    if not parent: raise RuntimeError("No Google Drive Reports/Meeting folder was supplied.")
    ids={}
    for name,mime in [
      ("transcript.txt","text/plain; charset=utf-8"),
      ("translation_en.txt","text/plain; charset=utf-8"),
      ("summary.txt","text/plain; charset=utf-8"),
      ("mom.txt","text/plain; charset=utf-8"),
      ("mom.docx","application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    ]:
      ids[name]=d.upload(o/name,f"{p['meeting_id']} - {name}",parent,mime).get("id")
      if not ids[name]: raise RuntimeError("Drive upload did not return a file ID for "+name)
    manifest={
      "meeting_id":p["meeting_id"],"meeting_title":title,"meeting_type":meeting_type,
      "meeting_subtype":subtype,"workflow_stage":stage,"chunk_count":len(list(o.glob("chunk_*_transcript.txt"))),
      "file_ids":{"transcript":ids["transcript.txt"],"translation":ids["translation_en.txt"],
        "summary":ids["summary.txt"],"mom":ids["mom.txt"],"word":ids["mom.docx"]},
      "outputs":["transcript.txt","translation_en.txt","summary.txt","mom.txt","mom.docx"]
    }
    (o/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
    ids["manifest.json"]=d.upload(o/"manifest.json",f"{p['meeting_id']} - manifest.json",parent,"application/json").get("id")
    if not ids["manifest.json"]: raise RuntimeError("Manifest upload failed")
    for chunk_id in p.get("chunk_file_ids",[]):
      try: d.delete(chunk_id)
      except Exception as e: print("temporary chunk cleanup warning:",e)
    if p.get("chunk_folder_id"):
      try: d.delete(p["chunk_folder_id"])
      except Exception as e: print("temporary folder cleanup warning:",e)
    gateway=os.getenv("MMV2_GATEWAY_URL","").strip()
    if not gateway: raise RuntimeError("MMV2_GATEWAY_URL is not configured; cannot register output files.")
    callback={
      "action":"complete_meeting","callback_secret":os.getenv("MMV2_CALLBACK_SECRET",""),
      "meeting_id":p["meeting_id"],"transcript_file_id":ids["transcript.txt"],
      "translation_file_id":ids["translation_en.txt"],"summary_file_id":ids["summary.txt"],
      "mom_file_id":ids["mom.txt"],"word_file_id":ids["mom.docx"],
      "manifest_file_id":ids["manifest.json"],
      "github_run_id":os.getenv("GITHUB_RUN_ID",""),"github_run_number":os.getenv("GITHUB_RUN_NUMBER",""),
      "github_run_url":os.getenv("GITHUB_SERVER_URL","")+"/"+os.getenv("GITHUB_REPOSITORY","")+"/actions/runs/"+os.getenv("GITHUB_RUN_ID","")
    }
    response=requests.post(gateway,json=callback,timeout=60); response.raise_for_status()
    try: reply=response.json()
    except Exception: reply={"raw_response":response.text[:500]}
    print(json.dumps({"callback_http_status":response.status_code,"callback_response":reply},ensure_ascii=False))
    if not isinstance(reply,dict) or reply.get("success") is not True:
      raise RuntimeError("Apps Script did not confirm completion: "+json.dumps(reply,ensure_ascii=False)[:1000])
    print(json.dumps({"success":True,"meeting_id":p["meeting_id"],"uploaded":ids},ensure_ascii=False))
if __name__=="__main__": main()
