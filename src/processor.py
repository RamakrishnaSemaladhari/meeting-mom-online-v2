import argparse, json, os, re, time
from pathlib import Path

import requests
from faster_whisper import WhisperModel

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
LANGUAGE_NAMES = {
    "en": "English", "te": "Telugu", "hi": "Hindi", "ta": "Tamil",
    "kn": "Kannada", "ml": "Malayalam", "mr": "Marathi", "bn": "Bengali",
    "gu": "Gujarati", "pa": "Punjabi", "ur": "Urdu", "es": "Spanish",
    "fr": "French", "de": "German", "it": "Italian", "pt": "Portuguese",
    "ru": "Russian", "ja": "Japanese", "ko": "Korean", "zh": "Chinese",
    "ar": "Arabic", "id": "Indonesian", "th": "Thai", "vi": "Vietnamese",
}

def clean(t):
    return re.sub(r"\s+", " ", t or "").strip()

def transcribe(model, audio, language=None):
    beam_size = max(1, int(os.getenv("WHISPER_BEAM_SIZE", "3")))
    kw = {
        "task": "transcribe",
        "beam_size": beam_size,
        "vad_filter": True,
        "condition_on_previous_text": False,
    }
    if language and language != "auto":
        kw["language"] = language
    segments, info = model.transcribe(str(audio), **kw)
    rows = []
    for segment in segments:
        text = clean(segment.text)
        if text:
            rows.append({
                "id": len(rows),
                "start": round(float(segment.start), 2),
                "end": round(float(segment.end), 2),
                "text": text,
            })
    return rows, info.language, round(info.language_probability or 0, 3)

def ollama_generate(prompt, model, timeout=240, json_mode=False):
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.1, "num_ctx": 8192},
    }
    if json_mode:
        payload["format"] = "json"
    response = requests.post(
        OLLAMA_URL.rstrip("/") + "/api/generate",
        json=payload,
        timeout=(15, timeout),
    )
    response.raise_for_status()
    answer = (response.json().get("response") or "").strip()
    if not answer:
        raise RuntimeError("Ollama returned an empty response")
    return answer

def batches(rows, max_segments=24, max_chars=6500):
    batch, chars = [], 0
    for row in rows:
        size = len(row["text"])
        if batch and (len(batch) >= max_segments or chars + size > max_chars):
            yield batch
            batch, chars = [], 0
        batch.append(row)
        chars += size
    if batch:
        yield batch

def translate_segments(rows, language, model):
    if language == "en":
        return [dict(row) for row in rows]
    source_name = LANGUAGE_NAMES.get(language, f"language code {language}")
    translated = []
    for batch_no, batch in enumerate(batches(rows), start=1):
        payload = [{"id": row["id"], "text": row["text"]} for row in batch]
        prompt = f"""Translate every supplied segment from {source_name} into natural, accurate English.
Preserve names, numbers, technical terms and meaning. Do not summarize, omit, explain or combine segments.
Return only JSON with this exact structure: {{"translations":[{{"id":0,"text":"English translation"}}]}}.
Return exactly one translation for every input id, keep ids unchanged and preserve their order.
Input segments:
{json.dumps(payload, ensure_ascii=False)}"""
        answer = ollama_generate(prompt, model, timeout=240, json_mode=True)
        try:
            parsed = json.loads(answer)
            items = parsed["translations"]
            by_id = {int(item["id"]): clean(item["text"]) for item in items}
            expected = [int(row["id"]) for row in batch]
            if set(by_id) != set(expected) or any(not by_id[i] for i in expected):
                raise ValueError("Translation ids missing, duplicated or empty")
        except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
            # One bounded repair attempt; never silently substitute untranslated text.
            repair = f"""Correct this response into valid JSON matching {{"translations":[{{"id":0,"text":"..."}}]}}.
Include exactly the input ids and a non-empty English translation for each. Return JSON only.
Input segments: {json.dumps(payload, ensure_ascii=False)}
Invalid response: {answer[:6000]}"""
            try:
                parsed = json.loads(ollama_generate(repair, model, timeout=180, json_mode=True))
                items = parsed["translations"]
                by_id = {int(item["id"]): clean(item["text"]) for item in items}
                expected = [int(row["id"]) for row in batch]
                if set(by_id) != set(expected) or any(not by_id[i] for i in expected):
                    raise ValueError("Repair did not return all translations")
            except Exception as repair_exc:
                raise RuntimeError(
                    f"English translation failed validation for batch {batch_no}: {repair_exc}"
                ) from exc
        for row in batch:
            translated.append({
                "id": row["id"], "start": row["start"], "end": row["end"],
                "text": by_id[int(row["id"])],
            })
        print(json.dumps({
            "stage": "text_translation", "batch": batch_no,
            "segments": len(batch), "source_language": language,
            "status": "completed",
        }))
    return translated

def render(rows):
    # Actual newline separators are required by merge_chunks(). Timestamps stay
    # tied to the source audio segment even when translated sentence lengths differ.
    return "\n".join(
        f"[{row['start']:07.2f}-{row['end']:07.2f}] {row['text']}"
        for row in rows
    )

def offset_summary_timestamps(text, offset_seconds):
    def shift(match):
        start = float(match.group(1)) + offset_seconds
        end = float(match.group(2)) + offset_seconds
        return f"[{start:07.2f}-{end:07.2f}]"
    return re.sub(r"\[(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\]", shift, text)

def summarize_chunk(translated, language, model):
    text = render(translated)
    if not text.strip():
        raise RuntimeError("Cannot summarize an empty translated chunk")
    prompt = f"""You are preparing evidence-grounded notes from one chronological meeting audio chunk.
The source speech language was {LANGUAGE_NAMES.get(language, language)} and the supplied text is in English.
Create concise but substantive structured notes covering:
- topics and explanations in chronological order;
- decisions and agreements;
- action items, owners and deadlines only if explicitly stated;
- commitments, risks, problems, open questions and next steps;
- important names, numbers, definitions and technical details.
Preserve timestamps in [start-end] format when available. Do not infer missing facts, and mark uncertainty.
Do not merely select sentences by keywords. Do not claim that this chunk represents the whole meeting.
CHUNK TRANSCRIPT (English, timestamped):
{text[:18000]}"""
    return ollama_generate(prompt, model, timeout=300)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--index", type=int, required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    started = time.monotonic()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    model_name = os.getenv("WHISPER_MODEL", "small")
    translation_model = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")
    whisper_started = time.monotonic()
    whisper = WhisperModel(
        model_name,
        device=os.getenv("WHISPER_DEVICE", "cpu"),
        compute_type=os.getenv("WHISPER_COMPUTE_TYPE", "int8"),
    )
    original, language, probability = transcribe(whisper, args.audio)
    transcription_seconds = time.monotonic() - whisper_started
    del whisper

    translation_started = time.monotonic()
    translated = translate_segments(original, language, translation_model)
    translation_seconds = time.monotonic() - translation_started

    transcript_text = render(original)
    translation_text = render(translated)
    (out / f"chunk_{args.index:04d}_transcript.txt").write_text(
        transcript_text, encoding="utf-8"
    )
    (out / f"chunk_{args.index:04d}_translation.txt").write_text(
        translation_text, encoding="utf-8"
    )

    summary_started = time.monotonic()
    note = summarize_chunk(translated, language, translation_model)
    note = offset_summary_timestamps(note, args.index * 600)
    summary_seconds = time.monotonic() - summary_started
    (out / f"chunk_{args.index:04d}_summary.txt").write_text(note, encoding="utf-8")

    timing = {
        "index": args.index,
        "language": language,
        "language_probability": probability,
        "segments": len(original),
        "transcription_seconds": round(transcription_seconds, 2),
        "translation_seconds": round(translation_seconds, 2),
        "chunk_summary_seconds": round(summary_seconds, 2),
        "total_seconds": round(time.monotonic() - started, 2),
        "model": model_name,
        "translation_model": translation_model,
        "beam_size": int(os.getenv("WHISPER_BEAM_SIZE", "3")),
        "translation_method": "timestamp-preserving text translation in bounded batches",
    }
    (out / f"chunk_{args.index:04d}.json").write_text(
        json.dumps(timing, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(timing, ensure_ascii=False))

if __name__ == "__main__":
    main()
