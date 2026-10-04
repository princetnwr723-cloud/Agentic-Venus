import { collection, doc, getDocs, limit, orderBy, query, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type TraceEvent = { t: number; kind: string; text: string };
export type Usage = Record<string, { inChars: number; outChars: number }>;
export type Trace = {
  id: string; chatId: string; title: string; kind: string; startedAt: number; endedAt?: number;
  status: "running" | "done" | "error" | "stopped"; events: TraceEvent[]; usage: Usage;
};
export type TraceHandle = {
  id: string;
  add: (kind: string, text: string) => void;
  usage: (model: string, inChars: number, outChars: number) => void;
  end: (status: Trace["status"]) => Promise<void>;
};

const active = new Map<string, TraceHandle>();
export const traceOf = (chatId: string) => active.get(chatId);
/** Called by callLLM: attributes model usage to the run currently active in that chat. */
export const addUsage = (chatId: string, model: string, inChars: number, outChars: number) =>
  active.get(chatId)?.usage(model, inChars, outChars);

export function beginTrace(uid: string, chatId: string, title: string, kind: string): TraceHandle {
  const id = "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const t: Trace = { id, chatId, title: title.slice(0, 120), kind, startedAt: Date.now(), status: "running", events: [], usage: {} };
  const ref = doc(db, "users", uid, "traces", id);
  let last = 0;
  const save = () => {
    last = Date.now();
    return setDoc(ref, JSON.parse(JSON.stringify({ ...t, events: t.events.slice(-400) }))).catch(() => {});
  };
  const h: TraceHandle = {
    id,
    add(kind, text) {
      t.events.push({ t: Date.now(), kind, text: String(text).slice(0, 300) });
      if (Date.now() - last > 5000) void save();
    },
    usage(model, inChars, outChars) {
      const k = model.replace(/[./]/g, "_");
      const u = (t.usage[k] ||= { inChars: 0, outChars: 0 });
      u.inChars += inChars;
      u.outChars += outChars;
    },
    async end(status) {
      t.status = status;
      t.endedAt = Date.now();
      active.delete(chatId);
      await save();
    },
  };
  active.set(chatId, h);
  void save();
  return h;
}

export async function listTraces(uid: string): Promise<Trace[]> {
  const snap = await getDocs(query(collection(db, "users", uid, "traces"), orderBy("startedAt", "desc"), limit(50)));
  return snap.docs.map((d) => d.data() as Trace);
}

// USD per 1M tokens (input, output). Rough list prices: this is an ESTIMATE, not a bill.
const PRICE: Array<[RegExp, number, number]> = [
  [/opus/i, 15, 75], [/sonnet/i, 3, 15], [/haiku/i, 1, 5],
  [/4o_mini|4o-mini/i, 0.15, 0.6], [/gpt_4o|gpt-4o/i, 2.5, 10],
  [/flash/i, 0.1, 0.4], [/deepseek/i, 0.3, 1.1],
];
export function estimateCost(usage: Usage): number {
  let usd = 0;
  for (const [model, u] of Object.entries(usage)) {
    const [, pin, pout] = PRICE.find(([re]) => re.test(model)) ?? [null, 1, 3];
    usd += ((u.inChars / 4) * pin + (u.outChars / 4) * pout) / 1_000_000;
  }
  return usd;
}