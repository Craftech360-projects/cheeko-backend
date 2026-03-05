#!/usr/bin/env python3
"""
Sarvam Latency Analyzer
Reads sarvam_metrics.jsonl and shows latency benchmarks per model/language.

Usage:
    python scripts/analyze_sarvam_metrics.py
    python scripts/analyze_sarvam_metrics.py --language kn-IN
    python scripts/analyze_sarvam_metrics.py --csv
"""

import json
import os
import sys
import argparse
from collections import defaultdict

METRICS_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "logs", "sarvam_metrics.jsonl")
GEMINI_METRICS_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "logs", "gemini_metrics.jsonl")


def percentile(data, p):
    if not data:
        return 0.0
    s = sorted(data)
    idx = min(int(len(s) * p / 100), len(s) - 1)
    return round(s[idx], 4)


def avg(data):
    return round(sum(data) / len(data), 4) if data else 0.0


def load_records(filepath):
    records = []
    if not os.path.exists(filepath):
        print(f"No metrics file found at: {filepath}")
        sys.exit(1)
    with open(filepath, "r") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return records


def fmt(val):
    """Format seconds value"""
    return f"{val:.3f}s"


def print_table(headers, rows, col_widths=None):
    if not col_widths:
        col_widths = [max(len(str(h)), max((len(str(r[i])) for r in rows), default=5)) + 2 for i, h in enumerate(headers)]
    header_line = "".join(str(h).ljust(w) for h, w in zip(headers, col_widths))
    print(header_line)
    print("-" * sum(col_widths))
    for row in rows:
        print("".join(str(row[i]).ljust(w) for i, w in enumerate(col_widths)))


def analyze_stt(records, language=None):
    """STT metrics by model/language"""
    stt = [r for r in records if r.get("type") == "stt"]
    if language:
        stt = [s for s in stt if s.get("stt_language") == language]

    if not stt:
        print("\n  No STT data yet.")
        return

    print(f"\n{'='*60}")
    print("  STT LATENCY (Sarvam saaras)")
    print(f"{'='*60}")

    groups = defaultdict(list)
    for s in stt:
        key = (s.get("stt_model", "?"), s.get("stt_language", "?"))
        groups[key].append(s)

    for (model, lang), data in sorted(groups.items()):
        audio_durs = [d["stt_audio_duration"] for d in data if d.get("stt_audio_duration")]
        durations = [d["stt_duration"] for d in data if d.get("stt_duration", 0) > 0]
        streamed = sum(1 for d in data if d.get("stt_streamed"))
        eou_delays = [d["stt_transcription_delay"] for d in data if d.get("stt_transcription_delay") is not None]

        print(f"\n  Model: {model} | Language: {lang} | Samples: {len(data)}")
        print(f"  Total audio: {sum(audio_durs):.1f}s | Streaming: {streamed}/{len(data)}")

        if durations:
            print(f"\n  Processing duration:")
            headers = ["Avg", "P50", "P95", "Min", "Max"]
            rows = [[fmt(avg(durations)), fmt(percentile(durations, 50)),
                      fmt(percentile(durations, 95)), fmt(min(durations)), fmt(max(durations))]]
            print_table(headers, rows, [10, 10, 10, 10, 10])
        else:
            print(f"  Processing latency: streaming (real-time, transcript ready before user stops speaking)")


def analyze_llm(records):
    """LLM TTFT latency by model"""
    llm = [r for r in records if r.get("type") == "llm"]
    if not llm:
        print("\n  No LLM data yet.")
        return

    print(f"\n{'='*60}")
    print("  LLM LATENCY (Time to First Token)")
    print(f"{'='*60}")

    groups = defaultdict(list)
    for l in llm:
        model = l.get("llm_model", "?")
        ttft = l.get("llm_ttft", 0)
        if ttft > 0:
            groups[model].append(l)

    headers = ["Model", "Samples", "TTFT Avg", "TTFT P50", "TTFT P95", "Tok/s Avg"]
    rows = []
    for model, data in sorted(groups.items()):
        ttfts = [d["llm_ttft"] for d in data]
        tps = [d["llm_tokens_per_sec"] for d in data if d.get("llm_tokens_per_sec", 0) > 0]
        rows.append([model, str(len(ttfts)), fmt(avg(ttfts)),
                      fmt(percentile(ttfts, 50)), fmt(percentile(ttfts, 95)),
                      f"{avg(tps):.1f}" if tps else "-"])
    print_table(headers, rows, [25, 10, 12, 12, 12, 12])


def analyze_tts(records, language=None):
    """TTS TTFB latency by model/speaker/language"""
    tts = [r for r in records if r.get("type") == "tts"]
    if language:
        tts = [t for t in tts if t.get("tts_language") == language]

    if not tts:
        print("\n  No TTS data yet.")
        return

    print(f"\n{'='*60}")
    print("  TTS LATENCY (Time to First Byte)")
    print(f"{'='*60}")

    groups = defaultdict(list)
    for t in tts:
        key = (t.get("tts_model", "?"), t.get("tts_speaker", "?"), t.get("tts_language", "?"))
        ttfb = t.get("tts_ttfb", 0)
        if ttfb > 0:
            groups[key].append(ttfb)

    headers = ["Model", "Speaker", "Language", "Samples", "Avg", "P50", "P95", "Min", "Max"]
    rows = []
    for (model, speaker, lang), ttfbs in sorted(groups.items()):
        rows.append([model, speaker, lang, str(len(ttfbs)), fmt(avg(ttfbs)),
                      fmt(percentile(ttfbs, 50)), fmt(percentile(ttfbs, 95)),
                      fmt(min(ttfbs)), fmt(max(ttfbs))])
    print_table(headers, rows, [18, 10, 10, 10, 10, 10, 10, 10, 10])


def analyze_response(records, language=None):
    """Response latency: thinking → speaking (what user actually waits)"""
    turns = [r for r in records if r.get("type") == "pipeline_turn"]
    if language:
        turns = [t for t in turns if t.get("stt_language") == language]

    if not turns:
        print("\n  No turn data yet. Talk to the device to generate data.")
        return

    print(f"\n{'='*60}")
    print("  RESPONSE LATENCY (user done speaking → agent starts speaking)")
    print(f"{'='*60}")

    # Group by model combo + language
    groups = defaultdict(list)
    for t in turns:
        llm_m = t.get("llm_model", "?")
        tts_m = t.get("tts_model", "?")
        speaker = t.get("tts_speaker", "?")
        lang = t.get("stt_language", "?")
        key = (llm_m, tts_m, speaker, lang)
        if t.get("response_latency"):
            groups[key].append(t["response_latency"])

    headers = ["LLM", "TTS", "Speaker", "Lang", "Turns", "Avg", "P50", "P95", "Min", "Max"]
    rows = []
    for (llm_m, tts_m, speaker, lang), lats in sorted(groups.items()):
        rows.append([llm_m, tts_m, speaker, lang, str(len(lats)),
                      fmt(avg(lats)), fmt(percentile(lats, 50)), fmt(percentile(lats, 95)),
                      fmt(min(lats)), fmt(max(lats))])
    print_table(headers, rows, [22, 16, 10, 8, 8, 10, 10, 10, 10, 10])
    print("\n  This = LLM TTFT + TTS TTFB combined. The actual wait time the user feels.")


def analyze_gemini_ttft(records):
    """Gemini Realtime TTFT by model/voice"""
    rt = [r for r in records if r.get("type") == "realtime"]
    if not rt:
        print("\n  No Gemini realtime data yet.")
        return

    print(f"\n{'='*60}")
    print("  GEMINI REALTIME - TTFT (Time to First Token)")
    print(f"{'='*60}")

    groups = defaultdict(list)
    for r in rt:
        key = (r.get("model", "?"), r.get("voice", "?"))
        ttft = r.get("ttft", 0)
        if ttft > 0:
            groups[key].append(r)

    headers = ["Model", "Voice", "Samples", "TTFT Avg", "TTFT P50", "TTFT P95", "Tok/s Avg"]
    rows = []
    for (model, voice), data in sorted(groups.items()):
        ttfts = [d["ttft"] for d in data]
        tps = [d["tokens_per_second"] for d in data if d.get("tokens_per_second", 0) > 0]
        rows.append([model[:30], voice, str(len(ttfts)), fmt(avg(ttfts)),
                      fmt(percentile(ttfts, 50)), fmt(percentile(ttfts, 95)),
                      f"{avg(tps):.1f}" if tps else "-"])
    print_table(headers, rows, [32, 10, 10, 12, 12, 12, 12])


def analyze_gemini_response(records):
    """Gemini Realtime response latency (thinking → speaking)"""
    turns = [r for r in records if r.get("type") == "pipeline_turn"]
    if not turns:
        print("\n  No Gemini turn data yet.")
        return

    print(f"\n{'='*60}")
    print("  GEMINI REALTIME - RESPONSE LATENCY (thinking → speaking)")
    print(f"{'='*60}")

    groups = defaultdict(list)
    for t in turns:
        key = (t.get("model", "?"), t.get("voice", "?"))
        if t.get("response_latency"):
            groups[key].append(t["response_latency"])

    headers = ["Model", "Voice", "Turns", "Avg", "P50", "P95", "Min", "Max"]
    rows = []
    for (model, voice), lats in sorted(groups.items()):
        rows.append([model[:30], voice, str(len(lats)),
                      fmt(avg(lats)), fmt(percentile(lats, 50)), fmt(percentile(lats, 95)),
                      fmt(min(lats)), fmt(max(lats))])
    print_table(headers, rows, [32, 10, 8, 10, 10, 10, 10, 10])
    print("\n  This = end-to-end latency (STT+LLM+TTS combined in one model).")


def export_csv(records, output_path):
    turns = [r for r in records if r.get("type") == "pipeline_turn"]
    if not turns:
        print("No turn data to export.")
        return
    headers = ["timestamp", "stt_model", "llm_model", "tts_model", "stt_language",
               "tts_speaker", "stt_latency", "llm_tts_latency", "e2e_latency"]
    with open(output_path, "w") as f:
        f.write(",".join(headers) + "\n")
        for t in turns:
            row = [str(t.get(h, "")) for h in headers]
            f.write(",".join(row) + "\n")
    print(f"Exported {len(turns)} turns to {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Sarvam Latency Analyzer")
    parser.add_argument("--file", default=METRICS_FILE, help="Path to sarvam_metrics.jsonl")
    parser.add_argument("--language", help="Filter by language (e.g., kn-IN, hi-IN)")
    parser.add_argument("--csv", action="store_true", help="Export turns to CSV")
    parser.add_argument("--csv-path", default="sarvam_latency_export.csv")
    args = parser.parse_args()

    records = load_records(args.file)
    print(f"Loaded {len(records)} records from {args.file}")

    if args.csv:
        export_csv(records, args.csv_path)
        return

    # Count record types
    types = defaultdict(int)
    for r in records:
        types[r.get("type", r.get("metric_type", "unknown"))] += 1

    print(f"\nRecords: {', '.join(f'{t}={c}' for t, c in sorted(types.items()))}")

    analyze_stt(records, args.language)
    analyze_llm(records)
    analyze_tts(records, args.language)
    analyze_response(records, args.language)

    # Gemini Realtime metrics (separate file)
    if os.path.exists(GEMINI_METRICS_FILE):
        gemini_records = load_records(GEMINI_METRICS_FILE)
        if gemini_records:
            g_types = defaultdict(int)
            for r in gemini_records:
                g_types[r.get("type", "unknown")] += 1
            print(f"\n\n{'#'*60}")
            print(f"  GEMINI REALTIME METRICS")
            print(f"{'#'*60}")
            print(f"Loaded {len(gemini_records)} records from gemini_metrics.jsonl")
            print(f"Records: {', '.join(f'{t}={c}' for t, c in sorted(g_types.items()))}")
            analyze_gemini_ttft(gemini_records)
            analyze_gemini_response(gemini_records)

    print(f"\n{'='*60}")
    print(f"  Done. Use --language kn-IN to filter by language.")
    print(f"  Use --csv to export turn data.")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
