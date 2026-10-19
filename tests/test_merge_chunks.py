import tempfile
import unittest
from pathlib import Path

from src.finalize import merge_chunks
from src.processor import offset_summary_timestamps


class MergeChunkRegressionTests(unittest.TestCase):
    def test_multichunk_transcript_preserves_lines_and_offsets(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp)
            (out / "chunk_0000_transcript.txt").write_text(
                "[0000.00-0002.00] First segment\n[0002.00-0004.00] Second segment",
                encoding="utf-8",
            )
            (out / "chunk_0001_transcript.txt").write_text(
                "[0000.00-0001.00] Third segment\n[0001.00-0003.00] Fourth segment",
                encoding="utf-8",
            )
            merged = merge_chunks(out, "transcript.txt")
            self.assertIn("[0000.00-0002.00] First segment", merged)
            self.assertIn("[0600.00-0601.00] Third segment", merged)
            self.assertIn("[0601.00-0603.00] Fourth segment", merged)
            self.assertNotIn("\\n", merged)
            self.assertEqual(sum("segment" in line for line in merged.splitlines()), 4)

    def test_translation_lines_are_offset_by_audio_chunk(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp)
            (out / "chunk_0000_translation.txt").write_text(
                "[0000.00-0001.50] First translated sentence\n"
                "[0001.50-0003.00] Second translated sentence",
                encoding="utf-8",
            )
            (out / "chunk_0001_translation.txt").write_text(
                "[0000.00-0002.00] Third translated sentence",
                encoding="utf-8",
            )
            merged = merge_chunks(out, "translation.txt")
            self.assertIn("[0600.00-0602.00] Third translated sentence", merged)
            self.assertEqual(sum("translated sentence" in line for line in merged.splitlines()), 3)

    def test_chunk_summary_timestamps_use_global_meeting_timeline(self):
        note = "Decision [0000.50-0003.25] confirmed; follow-up [0010.00-0011.00]."
        shifted = offset_summary_timestamps(note, 600)
        self.assertIn("[0600.50-0603.25]", shifted)
        self.assertIn("[0610.00-0611.00]", shifted)


if __name__ == "__main__":
    unittest.main()
