from pathlib import Path
import ast
for p in Path("src").glob("*.py"): ast.parse(p.read_text(encoding="utf-8"))
print("Python source syntax OK")
