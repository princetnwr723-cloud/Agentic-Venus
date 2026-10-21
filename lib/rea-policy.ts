// REA = "Reverse Engineer Anything" (github.com/morluto/rea, npm: rea-agents, MIT). It lets an agent inspect how software
// behaves: websites (HAR), JavaScript/Electron apps, Android APKs, .NET, native binaries (Ghidra/Hopper/IDA), pcap, SQLite, firmware.
// Its own disclaimer allows lawful research, interoperability and analysis of software you own or are authorised to examine,
// and forbids cracks, stolen keys and licence bypasses. The agent follows the same line.

/** Requests that are about defeating a licence, paywall, quota or protection. These are never run. */
const BYPASS = new RegExp(
  [
    "\\b(crack(?:ed|ing)?|keygen|key ?gen|warez|serial ?(?:key|number)s?|nulled|patch(?:ed|ing)? (?:the )?licen[cs]e)\\b",
    "\\b(bypass|break|remove|skip|get around|disable|evade|defeat|circumvent)\\b[\\s\\S]{0,30}\\b(paywall|licen[cs]e|licen[cs]ing|activation|subscription|trial|quota|rate[- ]?limit|usage limit|credit limit|drm|watermark|copy ?protection|api limit)\\b",
    "\\b(steal|use someone'?s|borrow)\\b[\\s\\S]{0,20}\\b(api ?keys?|tokens?|account|login|credentials)\\b",
    "\\b(pirate|pirated|unlock)\\b[\\s\\S]{0,25}\\b(pro|premium|paid|features?|software)\\b",
  ].join("|"),
  "i"
);

export const REA_REFUSAL =
  "I can't crack software, bypass a licence, paywall, quota or rate limit, remove DRM, or copy a paid service by getting around its limits. " +
  "What I CAN do: analyse software you own or are allowed to examine (your own app, open-source code, a service you have an account for), and then build your own free, unlimited version of the feature with open-source libraries. " +
  "Tell me which tool or feature you need and I will analyse it and build our own version.";

/** null = fine, otherwise the reason text to show the owner. */
export function reaBlocked(text: string): string | null {
  return BYPASS.test(String(text ?? "").slice(0, 3000)) ? REA_REFUSAL : null;
}

/** Does the message ask to analyse / reverse engineer / clone how some software works? */
export function isReverseTask(text: string): boolean {
  return /\b(reverse[- ]?engineer\w*|\brea\b|decompil\w+|disassembl\w+|ghidra|hopper|jadx|apktool|analy[sz]e (?:this |the )?(?:app|apk|binary|exe|dll|firmware|extension|website|site|api)|how does (?:this|that|the) (?:app|tool|software|website) work|clone (?:this|the|that) (?:app|tool|feature)|rebuild (?:this|the|that) (?:app|tool|feature))\b/i.test(String(text ?? "").slice(0, 2000));
}

/** Short rules + commands, added to the computer agent's context on every task. */
export const REA_PC_PROMPT = `## REVERSE ENGINEERING (REA is installed: command "rea", package rea-agents)
Use it to understand how software works: websites (HAR captures), JavaScript/Electron apps, Android APKs, .NET assemblies, native binaries (deep native analysis needs Ghidra, Hopper or IDA), pcap files, SQLite databases, firmware. Start with "rea --help" to see the commands for the target type. Example: rea analyze-javascript-application /absolute/path/to/app --json . If "rea" is missing: npx -y rea-agents@latest <command> . Needs Node 22+.
ALLOWED targets: software the owner made or owns, open-source code, files or apps the owner is authorised to examine, a service the owner has their own account for (its documented or own-account behaviour), learning and interoperability.
NEVER: cracks, keygens, licence / activation / paywall / quota / rate-limit bypass, removing DRM or watermarks, using someone else's account or keys, copying proprietary code or assets. If asked, say no in one sentence and offer the legal route below.
"BUILD A FREE UNLIMITED VERSION" means: 1) analyse what the feature does and write findings as SEEN (evidence), INFERRED, UNKNOWN; 2) write the owner's OWN implementation from that behaviour with open-source libraries (clean room: behaviour, never copied code); 3) test it against the observed behaviour; 4) report what is verified and what is guessed. Because it is the owner's own code it has no limits.`;

/** What the chat agent reads with reverse.guide. */
export const REA_GUIDE = `# Reverse engineer anything (REA) — how to do it here

REA ("Reverse Engineer Anything", npm package rea-agents, MIT) inspects software locally and returns findings WITH evidence. It runs on the agent's computer (the Computer button), not in the chat. For a reverse-engineering job: tell the owner what you will analyse, then hand the job to the computer (it is a computer task). The computer already has "rea".

## 1. Decide if it is allowed
Allowed: the owner's own software, open-source code, files/apps the owner is authorised to examine, a service the owner has an account for (documented or own-account behaviour only), learning, interoperability, preservation.
Not allowed (say no in one sentence, offer the route in section 3): cracking, keygens, licence/activation/paywall/quota/rate-limit bypass, removing DRM or watermarks, using someone else's account or keys, copying proprietary code or assets.

## 2. Analyse (on the computer)
- Websites and APIs: capture a HAR (browser DevTools → Network → export) or let the computer browse; REA reads the HAR and shows the real requests, auth flow and data shapes.
- JavaScript/Electron apps: rea analyze-javascript-application /absolute/path --json
- Android APK, .NET, native binaries, pcap, SQLite, firmware: run "rea --help" and use the command for that type. Deep native analysis needs Ghidra, Hopper or IDA.
- Write the result as three lists: SEEN (backed by evidence), INFERRED (reasoned, not proven), UNKNOWN (not found). Never present a guess as a fact.

## 3. "Build a free, unlimited version"
The way to get a free, unlimited tool is to build the owner's OWN version of the feature, not to defeat someone else's limits:
1. Write down what the feature must do (inputs, outputs, edge cases) from the SEEN list or from public documentation.
2. Prefer an existing open-source library or self-hosted tool that already does it; say which one.
3. Otherwise write a clean-room implementation (behaviour, not copied code) in the owner's stack. Venus Code builds software; the computer runs it.
4. Test against the observed behaviour and report verified vs guessed.
5. Do not hide the original service's terms: if the owner still wants that service itself, tell them its real plan or limit.
`;