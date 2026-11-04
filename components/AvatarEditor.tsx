"use client";

import { useEffect, useMemo, useState } from "react";
import BotAvatar from "@/components/BotAvatar";
import {
  AVATAR_COLORS,
  EXPRESSIONS,
  EXPRESSION_LABELS,
  MASCOTS,
  makeAvatar,
  parseAvatar,
  type AvatarColor,
  type MascotExpr,
} from "@/lib/bots";
import { normHex } from "@/lib/avatar-theme";
import { BUDDIES, makeBuddy, parseBuddy, searchBuddies } from "@/lib/buddies";
import {
  BUDDY_FACES,
  BUDDY_FACE_LABELS,
  BUDDY_GROUP_LABELS,
  type BuddyFace,
  type BuddyGroup,
} from "@/lib/buddy-kit";

const SWATCHES = [
  "#ee1216", "#ec3220", "#ff690c", "#ffa41b", "#ffd21f", "#9bd62f",
  "#52b438", "#1fbf7a", "#14b8b0", "#00e5ff", "#1e88f0", "#2f5bff",
  "#7a2cd6", "#b23ae0", "#ec4899", "#ff3ea5", "#ff6b9a", "#ffc9a8",
  "#8b5a3c", "#6b7280", "#c9ced8", "#ffffff", "#1f2937", "#b6ff3b",
];

type Mood = "idle" | "thinking" | "happy";
type Tab = "buddies" | "mascots";
type GroupFilter = BuddyGroup | "all";

const GROUPS: GroupFilter[] = ["all", "animals", "creatures", "things", "nature", "food"];

function Colours({ hex, onPick }: { hex: string; onPick: (h: string) => void }) {
  const [text, setText] = useState(hex);
  useEffect(() => {
    setText(hex);
  }, [hex]);

  const pick = (h: string) => {
    const n = normHex(h);
    if (n) onPick(n);
  };

  return (
    <div>
      <p className="mb-2 text-xs text-muted">Colour (any colour works)</p>
      <div className="flex flex-wrap gap-1.5">
        {SWATCHES.map((h) => (
          <button
            type="button"
            key={h}
            aria-label={h}
            onClick={() => pick(h)}
            className={`h-7 w-7 rounded-full border ${
              hex === h ? "border-white ring-2 ring-gold" : "border-line"
            }`}
            style={{ background: h }}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="color"
          value={hex}
          onChange={(e) => pick(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded border border-line bg-bg p-0.5"
          aria-label="Pick any colour"
        />
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            pick(e.target.value);
          }}
          placeholder="#1e88f0"
          maxLength={7}
          className="w-28 rounded-lg border border-line bg-bg px-3 py-2 font-mono text-xs text-ink placeholder:text-faint focus:border-gold"
        />
        <span className="text-[11px] text-faint">type a hex code or pick a colour</span>
      </div>
    </div>
  );
}

export default function AvatarEditor({
  value,
  onChange,
}: {
  value: AvatarColor;
  onChange: (v: AvatarColor) => void;
}) {
  const buddy = parseBuddy(value);
  const cur = parseAvatar(value);

  const [tab, setTab] = useState<Tab>(buddy ? "buddies" : "mascots");
  const [mood, setMood] = useState<Mood>("idle");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<GroupFilter>("all");
  // once you pick a colour yourself it is kept when you switch to another buddy
  const [keepColour, setKeepColour] = useState(false);
  // same for a face you picked on purpose
  const [chosenFace, setChosenFace] = useState<BuddyFace | null>(null);

  const working = mood === "thinking";
  const happy = mood === "happy";

  const list = useMemo(() => searchBuddies(query, group), [query, group]);

  // ---- mascots (original) ----
  const setExpr = (e: MascotExpr) => onChange(makeAvatar(e, cur.hex));
  const setMascotHex = (h: string) => onChange(makeAvatar(cur.expr, h));

  // ---- buddies ----
  const thumbHex = (defHex: string) => (keepColour && buddy ? buddy.hex : defHex);

  const pickBuddy = (id: string, defHex: string) => {
    const hex = keepColour ? (buddy ? buddy.hex : cur.hex) : defHex;
    onChange(makeBuddy(id, hex, chosenFace ?? undefined));
  };
  const setBuddyHex = (h: string) => {
    if (!buddy) return;
    setKeepColour(true);
    onChange(makeBuddy(buddy.def.id, h, buddy.face));
  };
  const setBuddyFace = (f: BuddyFace) => {
    if (!buddy) return;
    setChosenFace(f);
    onChange(makeBuddy(buddy.def.id, buddy.hex, f));
  };
  const resetBuddy = () => {
    if (!buddy) return;
    setKeepColour(false);
    setChosenFace(null);
    onChange(makeBuddy(buddy.def.id, buddy.def.hex));
  };

  const moods: { id: Mood; label: string }[] =
    tab === "buddies"
      ? [
          { id: "idle", label: "Idle" },
          { id: "thinking", label: "Thinking" },
          { id: "happy", label: "Happy" },
        ]
      : [
          { id: "idle", label: "Idle" },
          { id: "thinking", label: "Working" },
        ];

  const title = buddy
    ? `${buddy.def.name} · ${BUDDY_FACE_LABELS[buddy.face]}`
    : EXPRESSION_LABELS[cur.expr];
  const shownHex = buddy ? buddy.hex : cur.hex;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 rounded-xl border border-line bg-bg p-3">
        <BotAvatar color={value} size={110} working={working} happy={happy} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{title}</p>
          <p className="font-mono text-xs text-muted">{shownHex}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {moods.map((m) => (
              <button
                type="button"
                key={m.id}
                onClick={() => setMood(m.id)}
                aria-pressed={mood === m.id}
                className={`rounded-full border px-3 py-1 text-xs ${
                  mood === m.id
                    ? "border-gold bg-goldSoft text-gold"
                    : "border-line text-muted hover:text-ink"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-1 rounded-xl border border-line bg-bg p-1" role="tablist">
        {(
          [
            { id: "buddies", label: `Buddies · ${BUDDIES.length}` },
            { id: "mascots", label: "Original mascots" },
          ] as { id: Tab; label: string }[]
        ).map((t) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            key={t.id}
            onClick={() => {
              setTab(t.id);
              if (t.id === "mascots" && mood === "happy") setMood("idle");
            }}
            className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium ${
              tab === t.id ? "bg-panel2 text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "buddies" ? (
        <>
          <div className="space-y-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search buddies (cat, rocket, pizza...)"
              className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-xs text-ink placeholder:text-faint focus:border-gold"
            />
            <div className="flex flex-wrap gap-1.5">
              {GROUPS.map((g) => (
                <button
                  type="button"
                  key={g}
                  onClick={() => setGroup(g)}
                  aria-pressed={group === g}
                  className={`rounded-full border px-2.5 py-1 text-[11px] ${
                    group === g
                      ? "border-gold bg-goldSoft text-gold"
                      : "border-line text-muted hover:text-ink"
                  }`}
                >
                  {g === "all" ? "All" : BUDDY_GROUP_LABELS[g]}
                </button>
              ))}
            </div>
            <div className="max-h-60 overflow-y-auto rounded-xl border border-line bg-bg p-1.5">
              {list.length === 0 ? (
                <p className="p-4 text-center text-xs text-muted">No buddy found. Try another word.</p>
              ) : (
                <div className="grid grid-cols-5 gap-1 sm:grid-cols-6">
                  {list.map((d) => (
                    <button
                      type="button"
                      key={d.id}
                      title={d.name}
                      aria-label={d.name}
                      aria-pressed={buddy?.def.id === d.id}
                      onClick={() => pickBuddy(d.id, d.hex)}
                      className={`flex items-center justify-center rounded-xl p-1 ${
                        buddy?.def.id === d.id ? "bg-panel2 ring-2 ring-gold" : "hover:bg-panel2"
                      }`}
                    >
                      <BotAvatar color={makeBuddy(d.id, thumbHex(d.hex))} size={46} animate="hover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="text-[11px] text-faint">Hover a buddy to see it happy.</p>
          </div>

          {buddy ? (
            <>
              <div>
                <p className="mb-2 text-xs text-muted">Face</p>
                <div className="grid grid-cols-5 gap-1.5">
                  {BUDDY_FACES.map((f) => (
                    <button
                      type="button"
                      key={f}
                      title={BUDDY_FACE_LABELS[f]}
                      aria-label={BUDDY_FACE_LABELS[f]}
                      aria-pressed={buddy.face === f}
                      onClick={() => setBuddyFace(f)}
                      className={`flex items-center justify-center rounded-xl p-1 ${
                        buddy.face === f ? "bg-panel2 ring-2 ring-gold" : "hover:bg-panel2"
                      }`}
                    >
                      <BotAvatar color={makeBuddy(buddy.def.id, buddy.hex, f)} size={42} animate={false} />
                    </button>
                  ))}
                </div>
              </div>

              <Colours hex={buddy.hex} onPick={setBuddyHex} />

              <button
                type="button"
                onClick={resetBuddy}
                className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-ink"
              >
                Reset colour and face
              </button>
            </>
          ) : (
            <p className="rounded-xl border border-line bg-bg p-3 text-xs text-muted">
              Pick a buddy above, then change its face and colour.
            </p>
          )}
        </>
      ) : (
        <>
          <div>
            <p className="mb-2 text-xs text-muted">Expression</p>
            <div className="grid grid-cols-5 gap-1.5">
              {EXPRESSIONS.map((e) => (
                <button
                  type="button"
                  key={e}
                  title={EXPRESSION_LABELS[e]}
                  aria-label={EXPRESSION_LABELS[e]}
                  aria-pressed={!buddy && cur.expr === e}
                  onClick={() => setExpr(e)}
                  className={`flex items-center justify-center rounded-xl p-1 ${
                    !buddy && cur.expr === e ? "bg-panel2 ring-2 ring-gold" : "hover:bg-panel2"
                  }`}
                >
                  <BotAvatar color={makeAvatar(e, cur.hex)} size={46} animate={false} />
                </button>
              ))}
            </div>
          </div>

          <Colours hex={cur.hex} onPick={setMascotHex} />

          <div>
            <p className="mb-2 text-xs text-muted">Original mascots</p>
            <div className="flex flex-wrap gap-1.5">
              {AVATAR_COLORS.map((id) => (
                <button
                  type="button"
                  key={id}
                  title={MASCOTS[id].label}
                  aria-label={MASCOTS[id].label}
                  onClick={() => onChange(id)}
                  className={`rounded-xl p-1 ${value === id ? "bg-panel2 ring-2 ring-gold" : "hover:bg-panel2"}`}
                >
                  <BotAvatar color={id} size={40} animate={false} />
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
