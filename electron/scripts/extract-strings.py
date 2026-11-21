#!/usr/bin/env python3
"""Regenerates src/shared/strings.js from the native Swift prompts (run from the repo root)."""
import re, json, os
root = os.path.join(os.path.dirname(__file__), "..", "..")
prof = open(os.path.join(root, "Sources/Machete/Profiles.swift")).read()
state = open(os.path.join(root, "Sources/Machete/AppState.swift")).read()

def swift_multiline(src, start):
    end = src.index('"""', start)
    lines = src[start:end].split("\n")
    indent = len(lines[-1])
    text = "\n".join(l[indent:] if l.strip() else "" for l in lines[:-1])
    text = text.replace('\\"', '"').replace("\\\\", "\\")
    assert "\\(" not in text, "interpolation not supported"
    return text, end

def named(src, name):
    m = re.search(r'static let ' + name + r' = """\n', src)
    return swift_multiline(src, m.end())[0]

out = {n: named(prof, n) for n in ["systemDesignPrompt", "previousSystemDesignPrompt2", "previousSystemDesignPrompt3",
                                   "oldSystemDesignPrompt", "previousSystemDesignPrompt4", "baseRules"]}
out["followInstruction"] = named(state, "followInstruction")
d = prof[prof.index("static let defaults: [Profile] = ["):]
profiles = []
for m in re.finditer(r'Profile\(name: "([^"]+)", instructions: (systemDesignPrompt|""")', d):
    text = out["systemDesignPrompt"] if m.group(2) == "systemDesignPrompt" else swift_multiline(d, m.end() + 1)[0]
    profiles.append({"name": m.group(1), "instructions": text})
    if m.group(1) == "Sales":
        break
out["defaultProfiles"] = profiles
pre = {case: {"label": label} for case, label in re.findall(r'case (\w+) = "([^"]+)"', state)}
for case, instr in re.findall(r'case \.(whatToSay|followUps|recap):\n\s+return "((?:[^"\\]|\\.)*)"', state):
    pre[case]["instruction"] = instr.replace('\\"', '"')
out["presets"] = pre
out["defaultTask"] = re.search(r'\? "(Figure out what I most likely need[^"]+)"', state).group(1)
out["newBotInstructions"] = re.search(r'Profile\(name: "New bot", instructions: "([^"]+)"\)', state).group(1)
out["questionStarters"] = re.findall(r'"([^"]*)"', re.search(r'let starters = \[(.*?)\]', state, re.S).group(1))
js = ("// Generated from the native Swift sources (Profiles.swift, AppState.swift) so prompts stay identical.\n"
      "// Regenerate with scripts/extract-strings.py if the native prompts change.\n'use strict';\nmodule.exports = "
      + json.dumps(out, indent=2, ensure_ascii=False) + ";\n")
open(os.path.join(root, "electron/src/shared/strings.js"), "w").write(js)
print("wrote electron/src/shared/strings.js")
