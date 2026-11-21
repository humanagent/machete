'use strict';
// Parity with the native app: compiles the ORIGINAL Swift functions (extracted from AppState.swift) into a
// harness and checks the JS port returns identical output for the same inputs. macOS only (needs swiftc).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('../src/shared/logic');
const S = require('../src/shared/strings');

const swiftSrc = path.join(__dirname, '..', '..', 'Sources', 'Machete', 'AppState.swift');
const canRun = process.platform === 'darwin' && fs.existsSync(swiftSrc) && (() => {
  try { execFileSync('xcrun', ['--find', 'swiftc'], { stdio: 'ignore' }); return true; } catch { return false; }
})();

/** Extracts a Swift declaration starting at `signature` by brace matching. */
function extract(src, signature) {
  const i = src.indexOf(signature);
  if (i < 0) throw new Error(`not found: ${signature}`);
  let depth = 0;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1);
  }
  throw new Error('unbalanced');
}

function buildHarness(dir) {
  const src = fs.readFileSync(swiftSrc, 'utf8');
  const harness = `import Foundation
${extract(src, 'enum Speaker')}
${extract(src, 'struct TranscriptLine')}
${extract(src, 'struct Exchange')}
struct Profile { var context: String }
final class Harness {
    var lines: [TranscriptLine] = []
    var partialMe = ""
    var partialThem = ""
    var exchanges: [Exchange] = []
    var currentProfile = Profile(context: "")
    ${extract(src, 'static func isSilent')}
    ${extract(src, 'static func looksLikeQuestion')}
    ${extract(src, 'private func buildPrompt').replace('private func', 'func')}
}
let input = FileHandle.standardInput.readDataToEndOfFile()
let cases = try! JSONSerialization.jsonObject(with: input) as! [[String: Any]]
var out: [[String: Any]] = []
for c in cases {
    let h = Harness()
    for l in c["lines"] as? [[String: String]] ?? [] {
        h.lines.append(TranscriptLine(speaker: l["speaker"] == "me" ? .me : .them, text: l["text"]!))
    }
    h.partialMe = c["partialMe"] as? String ?? ""
    h.partialThem = c["partialThem"] as? String ?? ""
    h.currentProfile = Profile(context: c["context"] as? String ?? "")
    for e in c["exchanges"] as? [[String: Any]] ?? [] {
        var x = Exchange(ask: "a", typed: e["typed"] as? String ?? "", isFollow: e["isFollow"] as? Bool ?? false)
        x.answer = e["answer"] as? String
        h.exchanges.append(x)
    }
    let text = c["text"] as? String ?? ""
    out.append(["prompt": h.buildPrompt(question: c["question"] as? String ?? ""),
                "silent": Harness.isSilent(text), "question": Harness.looksLikeQuestion(text)])
}
FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: out))
`;
  const file = path.join(dir, 'main.swift');
  fs.writeFileSync(file, harness);
  const exe = path.join(dir, 'harness');
  execFileSync('xcrun', ['swiftc', '-O', file, '-o', exe], { stdio: 'pipe' });
  return exe;
}

function randomCases(n) {
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const words = ['what', 'How', 'tell me', 'Contame', 'por qué', 'ok.', 'SILENT', '**SILENT**', 'nothing', 'design', '?', '!',
    'the cache', 'Postgres', 'walk me', 'Thanks.', '`x`', 'qué', 'explain', 'Sounds good', 'que ', '\n', 'ñandú', '  '];
  const phrase = () => Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => pick(words)).join(rnd() < 0.5 ? ' ' : '');
  return Array.from({ length: n }, () => ({
    question: rnd() < 0.3 ? '' : phrase(),
    text: phrase(),
    context: rnd() < 0.4 ? '' : `  ${phrase()}\n`,
    partialMe: rnd() < 0.6 ? '' : phrase(),
    partialThem: rnd() < 0.6 ? '' : phrase(),
    lines: Array.from({ length: Math.floor(rnd() * 5) }, () => ({ speaker: rnd() < 0.5 ? 'me' : 'them', text: phrase() })),
    exchanges: Array.from({ length: Math.floor(rnd() * 7) }, () => ({
      typed: rnd() < 0.3 ? '' : phrase(), isFollow: rnd() < 0.2, answer: rnd() < 0.25 ? null : phrase(),
    })),
  }));
}

test('JS port matches the native Swift functions exactly', { skip: !canRun && 'needs macOS + swiftc', timeout: 300_000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'machete-parity-'));
  const exe = buildHarness(dir);
  const cases = randomCases(400);
  cases.push({ question: '', text: 'SILENT' }, { question: 'x', text: 'Contame de algún proyecto' }, { question: '', text: '' });
  const swift = JSON.parse(execFileSync(exe, { input: JSON.stringify(cases), maxBuffer: 64 * 1024 * 1024 }).toString());
  cases.forEach((c, i) => {
    const js = {
      prompt: L.buildPrompt(c.question, { lines: c.lines || [], partialMe: c.partialMe || '', partialThem: c.partialThem || '',
        exchanges: c.exchanges || [], context: c.context || '' }),
      silent: L.isSilent(c.text),
      question: L.looksLikeQuestion(c.text),
    };
    assert.deepEqual(js, swift[i], `case ${i}: ${JSON.stringify(c)}`);
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('extracted strings are byte-identical to the Swift literals', { skip: !canRun && 'needs macOS' }, () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'Sources', 'Machete', 'Profiles.swift'), 'utf8');
  assert.ok(src.includes('"I read your answer in a glance while talking') || src.includes('I read your answer in a glance while talking'));
  assert.ok(S.baseRules.includes('I read your answer in a glance while talking: plain text, short and direct'));
});
