"use client";

import { useEffect, useState } from "react";
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

const SWATCHES = [
  "#ee1216", "#ec3220", "#ff690c", "#ffa41b", "#ffd21f", "#9bd62f",
  "#52b438", "#1fbf7a", "#14b8b0", "#00e5ff", "#1e88f0", "#2f5bff",
  "#7a2cd6", "#b23ae0", "#ec4899", "#ff3ea5", "#ff6b9a", "#ffc9a8",
  "#8b5a3c", "#6b7280", "#c9ced8", "#ffffff", "#1f2937", "#b6ff3b",
];

export default function AvatarEditor({
  value,
  onChange,
}: {
  value: AvatarColor;
  onChange: (v: AvatarColor) => void;
}) {
  const cur = parseAvatar(value);
  const [hexText, setHexText] = useState(cur.hex);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    setHexText(cur.hex);
  }, [cur.hex]);

  const setExpr = (e: MascotExpr) => onChange(makeAvatar(e, cur.hex));
  const setHex = (h: string) => {
    const n = normHex(h);
    if (n) onChange(makeAvatar(cur.expr, n));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 rounded-xl border border-line bg-bg p-3">
        <BotAvatar color={value} size={110} working={working} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{EXPRESSION_LABELS[cur.expr]}</p>
          <p className="font-mono text-xs text-muted">{cur.hex}</p>
          <button
            type="button"
            onClick={() => setWorking((v) => !v)}
            className={`mt-2 rounded-full border px-3 py-1 text-xs ${
              working ? "border-gold bg-goldSoft text-gold" : "border-line text-muted hover:text-ink"
            }`}
          >
            {working ? "Previewing: working" : "Preview: working"}
          </button>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs text-muted">Expression</p>
        <div className="grid grid-cols-5 gap-1.5">
          {EXPRESSIONS.map((e) => (
            <button
              type="button"
              key={e}
              title={EXPRESSION_LABELS[e]}
              aria-label={EXPRESSION_LABELS[e]}
              aria-pressed={cur.expr === e}
              onClick={() => setExpr(e)}
              className={`flex items-center justify-center rounded-xl p-1 ${
                cur.expr === e ? "bg-panel2 ring-2 ring-gold" : "hover:bg-panel2"
              }`}
            >
              <BotAvatar color={makeAvatar(e, cur.hex)} size={46} animate={false} />
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs text-muted">Colour (any colour works)</p>
        <div className="flex flex-wrap gap-1.5">
          {SWATCHES.map((h) => (
            <button
              type="button"
              key={h}
              aria-label={h}
              onClick={() => setHex(h)}
              className={`h-7 w-7 rounded-full border ${
                cur.hex === h ? "border-white ring-2 ring-gold" : "border-line"
              }`}
              style={{ background: h }}
            />
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="color"
            value={cur.hex}
            onChange={(e) => setHex(e.target.value)}
            className="h-9 w-12 cursor-pointer rounded border border-line bg-bg p-0.5"
            aria-label="Pick any colour"
          />
          <input
            value={hexText}
            onChange={(e) => {
              setHexText(e.target.value);
              setHex(e.target.value);
            }}
            placeholder="#1e88f0"
            maxLength={7}
            className="w-28 rounded-lg border border-line bg-bg px-3 py-2 font-mono text-xs text-ink placeholder:text-faint focus:border-gold"
          />
          <span className="text-[11px] text-faint">type a hex code or pick a colour</span>
        </div>
      </div>

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
    </div>
  );
}
