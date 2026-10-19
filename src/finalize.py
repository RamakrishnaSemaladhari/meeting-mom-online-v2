import argparse, json, os, re, requests, sys
from pathlib import Path
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
sys.path.insert(0, str(Path(__file__).resolve().parent))
from drive import DriveClient

def ollama(prompt, model):
    # Keep synthesis requests bounded. Retry once with a smaller context/prompt on timeout.
    attempts = [
        {"prompt": prompt, "num_ctx": 16384, "timeout": 480},
        {"prompt": prompt[:22000], "num_ctx": 8192, "timeout": 300},
    ]
    last_error = None
    for attempt_no, attempt in enumerate(attempts, start=1):
        try:
            print(json.dumps({"ai_request": "started", "attempt": attempt_no,
                              "prompt_chars": len(attempt["prompt"]),
                              "context_tokens": attempt["num_ctx"],
                              "timeout_seconds": attempt["timeout"]}))
            r = requests.post("http://127.0.0.1:11434/api/generate",
                json={"model": model, "prompt": attempt["prompt"], "stream": False,
                      "options": {"temperature": 0.15, "num_ctx": attempt["num_ctx"]}},
                timeout=(20, attempt["timeout"]))
            r.raise_for_status()
            answer = (r.json().get("response") or "").strip()
            if not answer:
                raise RuntimeError("Ollama returned an empty response")
            print(json.dumps({"ai_request": "completed", "attempt": attempt_no,
                              "response_chars": len(answer)}))
            return answer
        except requests.exceptions.Timeout as exc:
            last_error = exc
            print("Ollama request timed out on attempt", attempt_no)
        except requests.exceptions.RequestException as exc:
            last_error = exc
            if attempt_no == len(attempts):
                break
            print("Ollama request failed; retrying once:", str(exc))
    raise RuntimeError("AI synthesis timed out or failed after bounded retry: " + str(last_error))

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

def reduce_chunk_summaries(summary_paths, model, max_chars=9000):
    """Hierarchically compress ordered chunk notes without dropping later chunks."""
    items = [
        {"label": path.stem, "text": path.read_text(encoding="utf-8").strip()}
        for path in sorted(summary_paths)
    ]
    if not items or any(not item["text"] for item in items):
        raise RuntimeError("One or more chunk AI summaries are missing or empty.")
    round_no = 0
    while sum(len(item["text"]) for item in items) > max_chars:
        round_no += 1
        if round_no > 5:
            raise RuntimeError("Could not reduce all chunk summaries to the safe prompt budget.")
        grouped = []
        for start in range(0, len(items), 3):
            group = items[start:start + 3]
            source = "\n\n".join(
                f"ORDERED SOURCE {item['label']}\n{item['text']}" for item in group
            )
            prompt = f"""Consolidate these chronological meeting-chunk notes into a faithful, concise intermediate summary.
Preserve order, explanations, names, numbers, decisions, actions, owners, deadlines, risks and unresolved questions.
Keep timestamps when present. Do not invent facts. Do not omit later sources because they conflict with earlier ones.
This is an intermediate summary, not final MoM.
{source[:18000]}"""
            grouped.append({
                "label": f"reduction_{round_no}_{start // 3 + 1}",
                "text": ollama(prompt, model),
            })
        items = grouped
    return "\n\n".join(
        f"CHRONOLOGICAL NOTES {item['label']}\n{item['text']}" for item in items
    )

def make_word(path, meeting, mom_text, summary):
    doc=Document()
    sec=doc.sections[0]
    sec.top_margin=Inches(0.7); sec.bottom_margin=Inches(0.7)
    sec.left_margin=Inches(0.65); sec.right_margin=Inches(0.65)
    styles=doc.styles
    styles["Normal"].font.name="Aptos"
    styles["Normal"].font.size=Pt(9.5)
    styles["Normal"].paragraph_format.space_after=Pt(5)
    styles["Title"].font.name="Aptos Display"
    styles["Title"].font.size=Pt(21)
    styles["Title"].font.bold=True
    meeting_type=(meeting.get("meeting_type") or "General Meeting").lower()
    subtype_key=(meeting.get("meeting_subtype") or "").lower()
    if "lecture" in meeting_type or "education" in meeting_type or "training" in meeting_type:
      document_title="LECTURE NOTES AND LEARNING SUMMARY"
    elif "notes" in meeting_type or "notes" in subtype_key:
      document_title="MEETING NOTES"
    else:
      document_title="MINUTES OF MEETING"
    title=doc.add_paragraph(style="Title")
    title.alignment=WD_ALIGN_PARAGRAPH.CENTER
    title.add_run(document_title)
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
        if line.strip():
          doc.add_paragraph(line.strip())
    doc.add_heading("Minutes and Discussion", level=1)
    first=True
    table_rows=[]

    def add_markdown_table(rows):
      if not rows: return
      normalized=[]
      width=max(len(r) for r in rows)
      for row in rows:
        row=list(row)
        row.extend([""]*(width-len(row)))
        normalized.append(row)
      tbl=doc.add_table(rows=0, cols=width)
      tbl.style="Table Grid"
      tbl.autofit=True
      for ridx,row in enumerate(normalized):
        cells=tbl.add_row().cells
        for cidx,value in enumerate(row):
          cells[cidx].text=value
          for paragraph in cells[cidx].paragraphs:
            paragraph.paragraph_format.space_after=Pt(2)
            for run in paragraph.runs:
              run.font.name="Aptos"; run.font.size=Pt(8)
              if ridx==0:
                run.bold=True; run.font.color.rgb=RGBColor(255,255,255)
          if ridx==0:
            from docx.oxml import OxmlElement
            from docx.oxml.ns import qn
            shading=OxmlElement("w:shd"); shading.set(qn("w:fill"),"1F4E79")
            cells[cidx]._tc.get_or_add_tcPr().append(shading)
      doc.add_paragraph("")

    def split_pipe(line):
      return [cell.strip().replace("\\|","|") for cell in line.strip().strip("|").split("|")]

    def flush_table():
      nonlocal table_rows
      if table_rows:
        add_markdown_table(table_rows)
        table_rows=[]

    for raw in mom_text.splitlines():
      line=raw.strip()
      if not line:
        flush_table()
        continue
      if line.startswith("|") and "|" in line[1:]:
        cells=split_pipe(line)
        if cells and all(re.match(r"^:?-{3,}:?$",cell) for cell in cells):
          continue
        table_rows.append(cells)
        continue
      flush_table()
      if first and line.upper() in ("MINUTES OF MEETING","MEETING MINUTES"):
        first=False; continue
      first=False
      clean_line=re.sub(r"^#{1,3}\s*","",line).replace("**","").strip()
      if len(clean_line)<120 and (line.startswith("#") or clean_line.endswith(":") or re.match(r"^(executive summary|meeting details|agenda|attendees|participants|key discussion|discussion points|decisions|action items|commitments|complete conversation summary|next steps|deadlines|risks|issues|open questions|pending follow-up|next meeting|review flags|conclusion|stage [123])\s*$",clean_line,re.I)):
        doc.add_heading(clean_line.rstrip(":"),level=2)
      elif re.match(r"^[-*•]\s+",clean_line):
        doc.add_paragraph(re.sub(r"^[-*•]\s+","",clean_line),style="List Bullet")
      elif re.match(r"^\d+[.)]\s+",clean_line):
        doc.add_paragraph(re.sub(r"^\d+[.)]\s+","",clean_line),style="List Number")
      else:
        doc.add_paragraph(clean_line)
    flush_table()
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
    summary_paths=sorted(o.glob("chunk_*_summary.txt"))
    if not ts.strip() or not tr.strip(): raise RuntimeError("Transcript or English translation is empty; refusing to complete meeting.")
    chunk_metrics=[]
    for metric_path in sorted(o.glob("chunk_*.json")):
      try: chunk_metrics.append(json.loads(metric_path.read_text(encoding="utf-8")))
      except Exception as exc: print("chunk timing parse warning:",str(exc))
    timing_summary={"chunks_measured":len(chunk_metrics),"transcription_seconds_sum":round(sum(float(x.get("transcription_seconds",0)) for x in chunk_metrics),2),"translation_seconds_sum":round(sum(float(x.get("translation_seconds",0)) for x in chunk_metrics),2),"chunk_summary_seconds_sum":round(sum(float(x.get("chunk_summary_seconds",0)) for x in chunk_metrics),2),"chunk_processing_seconds_sum":round(sum(float(x.get("total_seconds",0)) for x in chunk_metrics),2),"timing_note":"Per-chunk durations are summed across parallel workers; they are not workflow wall-clock elapsed time."}
    model=os.getenv("OLLAMA_MODEL","qwen2.5:3b")
    notify_progress(p,"SUMMARY_STARTED","GENERATING_SUMMARY",80,"All audio segments are transcribed. The AI is consolidating the segment summaries into a complete meeting summary.")
    title=p.get("meeting_title") or "Meeting"
    meeting_type=p.get("meeting_type") or "General Meeting"
    subtype=p.get("meeting_subtype") or "General"
    stage=p.get("workflow_stage") or "Standard"
    context_mode=(p.get("context_mode") or "series").lower()
    series_reference=p.get("series_reference") or ""
    previous_context=p.get("previous_context") or {}
    previous_context_text=previous_context.get("context_text","") if context_mode!="fresh" else ""
    if not previous_context_text:
      previous_context_text="No previous meeting context attached."
    # Keep historical context useful but bounded so it cannot overwhelm the model context.
    previous_context_text = previous_context_text[:4000]
    type_key=meeting_type.lower()
    if "legal" in type_key:
      output_profile="LEGAL CLIENT MEETING: integrate the current discussion with matching prior case history. Preserve chronology, prior decisions, client instructions, evidence/document status, unresolved issues, deadlines and commitments. Explicitly distinguish prior facts from new developments and flag conflicts or uncertain status."
    elif "lecture" in type_key or "education" in type_key or "training" in type_key:
      output_profile="LECTURE / TRAINING: organize the material topic by topic; explain concepts in student-friendly language; include examples where present, key definitions, points to remember, revision notes and likely exam questions. Link to prior lessons only when the series/reference matches."
    elif "notes" in type_key or "notes" in subtype.lower():
      output_profile="NOTES: produce a concise, easy-to-scan summary of important points, decisions, names/numbers, follow-ups and unresolved items; do not force formal MoM headings if they add no value."
    else:
      output_profile="BUSINESS / GENERAL MEETING: produce a standalone summary and formal MoM, compare current discussion with prior commitments, and carry forward unresolved tasks with original owner/deadline where available."
    # Chunk notes are AI-generated. Reduce them in chronological groups when needed,
    # never by truncating the tail of a long meeting.
    chunk_summary_context = reduce_chunk_summaries(summary_paths, model, max_chars=9000)
    if not chunk_summary_context.strip():
      raise RuntimeError("Chunk summaries are missing; refusing to generate an unsupported final summary.")
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
SERIES / SUBJECT / CASE REFERENCE: {series_reference or 'Not specified'}
CONTEXT MODE: {context_mode}
OUTPUT PROFILE: {output_profile}
PREVIOUS RELATED MEETING CONTEXT (empty in fresh mode):
{previous_context_text}
Continuity rules: treat the latest explicit status as authoritative; retain older unresolved commitments; mark a task completed only when the current discussion clearly confirms completion; otherwise label it pending verification. Preserve original owners and due dates when available. Never merge unrelated clients, cases, courses or projects. Clearly distinguish historical context from statements made in the current meeting.
For legal workflow stages, apply the requested stage:
- Stage 1 — Case Analysis: facts, chronology, parties, issues, claims, questions and missing information.
- Stage 2 — Document Verification: referenced evidence/documents, verification status, inconsistencies and missing records. Do not claim to verify files that were not supplied.
- Stage 3 — Legal Drafting: prepare a suitable draft from supported facts, flag assumptions and unresolved facts; do not fabricate authorities or legal citations.
For all other meeting types, tailor structure to the subtype and agenda.
CHRONOLOGICAL CHUNK SUMMARIES (summaries of the complete audio segments; preserve chronology and source details):
{chunk_summary_context}
"""
    summary=ollama(base+"""
Create a COMPLETE STANDALONE SUMMARY for a person who does not want formal minutes. Follow the OUTPUT PROFILE. Cover the current meeting's full content and use prior context only to explain continuity, prior commitments and changes. For legal meetings, combine relevant previous and current case discussions into a clear chronology while separating prior and new information. For lectures, provide topic-wise concept explanations, points to remember and expected questions. For notes, emphasize concise important points. Cover purpose, major topics, explanations, conclusions, decisions, unresolved questions, risks, action items with owner/deadline only where stated, and next steps. Preserve names, numbers and distinctions. Clearly mark unknowns. Do not fabricate.""",model)
    notify_progress(p,"MOM_STARTED","GENERATING_MOM",86,"Standalone summary prepared. The AI is formatting the formal MoM or topic-wise learning notes.")
    mom=ollama(base+f"""
Follow the OUTPUT PROFILE and create the appropriate structured second output, distinct from the standalone summary. For business/general meetings, create formal, circulation-ready MoM using these sections in this order where applicable: Minutes of Meeting title; meeting metadata; Executive Summary; Key Discussion Points; Decisions; Action Items; Commitments; Complete Conversation Summary; Open Questions / Pending Follow-up; Next Meeting; Review Flags. For Decisions, output a Markdown pipe table with columns Decision | Timestamp | Evidence | Review flag. For Action Items, output a Markdown pipe table with columns Action | Owner | Deadline | Timestamp | Evidence | Review flag. For Commitments, output a Markdown pipe table with columns Commitment | Owner | Deadline | Timestamp | Evidence | Review flag. Put one action/decision/commitment per row. Keep evidence concise and grounded in the supplied chunk summaries; if exact evidence wording or timestamp is unavailable, use 'Not available' rather than fabricate. If no decision/action/commitment is supported, say 'None explicitly stated' instead of inventing a row. Use bullet points for Key Discussion Points and Review Flags. For Notes, create clean organized notes with important points and action items. For Lectures/Training, create lecture notes with topic-wise explanations, key concepts, examples when present, points to remember, revision questions and expected exam questions. For Legal meetings, create a consolidated prior-plus-current case meeting record with chronology, prior decisions, new developments, open issues, action-item status, owners/deadlines and stage-specific sections. Clearly distinguish historical facts from current discussion. Never mark a prior task completed unless completion is confirmed; use 'Pending verification' where unclear. Never invent attendees, dates, commitments, facts or legal authorities. Use 'Not specified' when needed. Make the selected legal workflow stage explicit. Use actual Markdown table syntax with pipes and a separator row so the tables render in the Word document.
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
      "meeting_subtype":subtype,"workflow_stage":stage,"context_mode":context_mode,
      "series_reference":series_reference,"previous_context_meetings":previous_context.get("meetings",[]),
      "chunk_count":len(list(o.glob("chunk_*_transcript.txt"))),"processing_timing":timing_summary,
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
      "meeting_subtype":subtype,"workflow_stage":stage,"context_mode":context_mode,
      "series_reference":series_reference,"previous_context_meetings":previous_context.get("meetings",[]),
      "chunk_count":len(list(o.glob("chunk_*_transcript.txt"))),"processing_timing":timing_summary,
      "file_ids":{"transcript":ids["transcript.txt"],"translation":ids["translation_en.txt"],
        "summary":ids["summary.txt"],"mom":ids["mom.txt"],"word":ids["mom.docx"]},
      "outputs":["transcript.txt","translation_en.txt","summary.txt","mom.txt","mom.docx"]
    }
    (o/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
    ids["manifest.json"]=d.upload(o/"manifest.json",f"{p['meeting_id']} - manifest.json",parent,"application/json").get("id")
    if not ids["manifest.json"]: raise RuntimeError("Manifest upload failed")
    if p.get("chunk_folder_id"):
      # Delete every temporary child (audio, payload and intermediate results) before
      # removing the folder; deleting a Drive folder alone does not delete its contents.
      try:
        for item in d.list_children(p["chunk_folder_id"]):
          try: d.delete(item["id"])
          except Exception as e: print("temporary file cleanup warning:",e)
        d.delete(p["chunk_folder_id"])
      except Exception as e:
        print("temporary folder cleanup warning:",e)
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
