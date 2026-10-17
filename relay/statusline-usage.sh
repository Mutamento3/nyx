#!/bin/bash
# Claude Code status line: save the JSON it hands us (the relay reads usage limits from it), then print a short line.
in=$(cat)
dir="$HOME/.claude/usage"; mkdir -p "$dir"
printf %s "$in" > "$dir/latest.json.tmp" && mv "$dir/latest.json.tmp" "$dir/latest.json"
printf %s "$in" | python3 -c "
import json,sys
d=json.load(sys.stdin)
m=(d.get(\"model\") or {}).get(\"display_name\",\"\")
rl=d.get(\"rate_limits\") or {}
parts=[m]
for k,v in rl.items():
    if isinstance(v,dict) and \"used_percentage\" in v: parts.append(f\"{k} {v[\"used_percentage\"]:.0f}%\")
print(\" · \".join(p for p in parts if p))
" 2>/dev/null || true
