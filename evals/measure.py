"""Token-count real tool outputs from evals/snapshots/outputs.json.

No engine, no API. tiktoken o200k_base (OpenAI BPE; approximates Claude's
tokenizer — ratios meaningful, absolutes approximate).
Run: uv run --with tiktoken python evals/measure.py
"""
import json
import pathlib
import tiktoken

ENC = tiktoken.get_encoding("o200k_base")
SNAP = pathlib.Path(__file__).parent / "snapshots" / "outputs.json"


def n(s):
    return len(ENC.encode(s))


def main():
    if not SNAP.exists():
        print(f"no snapshot at {SNAP}. run capture.py first.")
        return
    d = json.loads(SNAP.read_text())
    out = d["outputs"]
    print(f"_depth={d['metadata']['depth']} · tiktoken o200k_base (approximates Claude BPE)_\n")
    print("| Output | Tokens |\n|--------|-------:|")
    for k, v in out.items():
        print(f"| {k} | {n(v)} |")
    descriptions = d.get("descriptions", {})
    desc_total = sum(n(v) for v in descriptions.values())
    print("\n**Claims, measured:**")
    print(f"- get_game_summary: {n(out['get_game_summary'])} tok (budget ~2000)")
    print(f"- analyze_game verbose/lean: {n(out['analyze_game.verbose'])}/{n(out['analyze_game.lean'])} "
          f"= {n(out['analyze_game.verbose'])/max(1,n(out['analyze_game.lean'])):.2f}×")
    print(f"- get_legal_moves uci/san: {n(out['get_legal_moves.uci'])}/{n(out['get_legal_moves.san'])} "
          f"= {n(out['get_legal_moves.uci'])/max(1,n(out['get_legal_moves.san'])):.2f}× (compact-SAN claim)")
    print(f"- all {len(descriptions)} tool descriptions: {desc_total} tok (loaded every tools/list)")


if __name__ == "__main__":
    main()
