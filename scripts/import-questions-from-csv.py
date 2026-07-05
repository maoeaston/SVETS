#!/usr/bin/env python3
"""
题库 CSV 导入脚本（Python 版，绕过 better-sqlite3 ABI 不兼容）
用法: python3 scripts/import-questions-from-csv.py [csv-file | --all]
"""
import csv
import json
import sqlite3
import sys
import os
from datetime import datetime

DB_PATH = os.path.expanduser("~/.config/xc-career-guide/data/xc-career-guide.db")
CSV_DIR  = os.path.join(os.path.dirname(__file__), "..", "data")

BATCH_ID = "batch_20260704_001"
IMPORTED_AT = datetime.utcnow().isoformat() + "Z"

MODULES = ["questions-m1.csv", "questions-m2.csv", "questions-m3.csv",
           "questions-m4.csv", "questions-m5.csv", "questions-m6.csv"]


def build_content_json(row: dict) -> str:
    base = {
        "prompt":           row["prompt"],
        "assessment_point": row["assessment_point"],
        "ability_tags":     [t for t in row["ability_tags"].split("|") if t],
    }
    if row.get("media_brief"):
        base["media_brief"] = row["media_brief"]
    if row.get("notes"):
        base["note"] = row["notes"]
    if row.get("source_ref"):
        base["source"] = {
            "import_batch_id": BATCH_ID,
            "source_file":     os.path.basename(row["_csv_file"]),
            "source_ref":      row["source_ref"],
            "imported_at":     IMPORTED_AT,
            "imported_by":     "system_import",
        }

    qt = row["question_type"]

    if qt == "SINGLE_CHOICE":
        options = []
        for key, col in [("A", "opt_a"), ("B", "opt_b"), ("C", "opt_c")]:
            if row.get(col):
                options.append({"key": key, "text": row[col]})
        return json.dumps({
            "question_type":   "SINGLE_CHOICE",
            **base,
            "options":         options,
            "expected_answer": row["correct_answer"],
        }, ensure_ascii=False)

    if qt == "TRUE_FALSE":
        return json.dumps({
            "question_type":   "TRUE_FALSE",
            **base,
            "expected_answer": row["correct_answer"].upper() in ("TRUE", "✓"),
        }, ensure_ascii=False)

    if qt == "DRAG":
        drag_items = json.loads(row["drag_items_json"]) if row.get("drag_items_json") else []
        drop_zones = json.loads(row["drop_zones_json"]) if row.get("drop_zones_json") else []
        return json.dumps({
            "question_type": "DRAG",
            **base,
            "drag_items":    drag_items,
            "drop_zones":    drop_zones,
            "scoring_mode":  "PARTIAL_CREDIT",
        }, ensure_ascii=False)

    if qt == "OFFLINE_OPERATION":
        rubric = json.loads(row["rubric_json"]) if row.get("rubric_json") else []
        return json.dumps({
            "question_type":      "OFFLINE_OPERATION",
            **base,
            "offline_tool_brief": row.get("offline_tool_brief", ""),
            "rubric_criteria":    rubric,
        }, ensure_ascii=False)

    raise ValueError(f"Unknown question_type: {qt}")


def build_scoring_rule_json(qt: str) -> str:
    if qt in ("SINGLE_CHOICE", "TRUE_FALSE"):
        return json.dumps({
            "scoring_type":    "EXACT_MATCH",
            "max_score":       2,
            "correct_score":   2,
            "incorrect_score": 0,
        })
    if qt == "DRAG":
        return json.dumps({
            "scoring_type":          "DRAG_PARTIAL",
            "max_score":             2,
            "all_correct_score":     2,
            "partial_correct_score": 0,
            "incorrect_score":       0,
        })
    if qt == "OFFLINE_OPERATION":
        return json.dumps({
            "scoring_type":          "RUBRIC_BASED",
            "max_score":             2,
            "score_0_description":   "未能完成",
            "score_1_description":   "部分完成",
            "score_2_description":   "完全达标",
        })
    raise ValueError(f"Unknown question_type: {qt}")


def import_csv(csv_path: str, con: sqlite3.Connection) -> tuple[int, int]:
    imported = skipped = 0
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Skip blank rows (trailing newline produces empty question_id)
            if not row.get("question_id", "").strip():
                continue
            row["_csv_file"] = csv_path  # inject for source tracking

            try:
                content_json      = build_content_json(row)
                scoring_rule_json = build_scoring_rule_json(row["question_type"])
                safety_sensitive  = 1 if row.get("safety_sensitive") == "1" else 0
                status            = row.get("status") or "ACTIVE"
                difficulty        = int(row.get("difficulty_level") or 1)

                con.execute("""
                    INSERT OR REPLACE INTO question_bank
                      (question_id, job_code, module_type, question_type, difficulty_level,
                       content_json, scoring_rule_json, safety_sensitive, status, version)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                """, (
                    row["question_id"].strip(),
                    row["job_code"].strip(),
                    row["module_type"].strip(),
                    row["question_type"].strip(),
                    difficulty,
                    content_json,
                    scoring_rule_json,
                    safety_sensitive,
                    status.strip(),
                ))
                print(f"  ✓ {row['question_id']}")
                imported += 1
            except Exception as e:
                print(f"  ✗ {row.get('question_id', '?')}: {e}", file=sys.stderr)
                skipped += 1

    return imported, skipped


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 import-questions-from-csv.py <csv-file|--all>")
        sys.exit(1)

    if not os.path.exists(DB_PATH):
        print(f"DB not found: {DB_PATH}", file=sys.stderr)
        sys.exit(1)

    con = sqlite3.connect(DB_PATH)
    total_imported = total_skipped = 0

    targets = MODULES if sys.argv[1] == "--all" else [sys.argv[1]]

    for target in targets:
        # Accept both bare filename and full path
        csv_path = target if os.path.isabs(target) else os.path.join(CSV_DIR, os.path.basename(target))
        if not os.path.exists(csv_path):
            csv_path = target  # try as-is (relative path from cwd)
        if not os.path.exists(csv_path):
            print(f"File not found: {csv_path}", file=sys.stderr)
            continue

        print(f"\n--- {os.path.basename(csv_path)} ---")
        imp, skp = import_csv(csv_path, con)
        total_imported += imp
        total_skipped  += skp
        print(f"    {imp} imported, {skp} skipped")

    con.commit()
    con.close()
    print(f"\n=== Total: {total_imported} imported, {total_skipped} skipped ===")


if __name__ == "__main__":
    main()
