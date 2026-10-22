# Attach system: kuch bhi file (photo, video, zip, PDF, Office, code)

Chat ke paperclip se ab **koi bhi file** attach hoti hai: ek saath 8 tak, drag-and-drop ya paste (Ctrl+V) se bhi. Har file ke chip par progress % dikhta hai. Send tab chalta hai jab sab upload ho chuki hon (sirf file bhejni ho to text likhna zaruri nahi).

## Kaise chalta hai
| File | Kya hota hai |
|---|---|
| Chhoti text / code / CSV / JSON (200 KB tak) | Seedha message ke andar jati hai (pehle jaisa). |
| Photo | Browser me chhoti JPEG copy banti hai jo model ko isi message me **dikhai deti hai**; original private storage me jata hai. Model photo na dekh sake to bina photo ke chalta hai aur batata hai. Ek message me pehli photo dikhti hai, baaki ke liye agent bolta hai ek ek karke bhejo. |
| Video, audio, zip, PDF, Word, Excel, PowerPoint, baaki sab | Browser se **seedha Supabase private storage** me (Vercel ki size limit lagti hi nahi). Chat me sirf chhota note aata hai: naam, type, size, `id=att_…`. |

Download link chat me kabhi save nahi hota. Computer / Venus Code ke task ke saath har baar naya private link (6 ghante) jata hai.

## Agent ke naye tools (hamesha on, key nahi chahiye)
- `attachments.list` - is chat ki attached files.
- `attachments.read` - text/code/CSV/JSON; zip ki file list (aur `file` dene par zip ke andar ki file); Word, Excel, PowerPoint ka text. Video / audio / PDF ke liye batata hai ki computer se kholo.
- `attachments.link` - 1 ghante ka private download link (computer ko dene ke liye).
- Attached **video** seedha `social.post_video {video_id:"att_…"}` se YouTube / Instagram / X / TikTok ... par post hota hai. `social.videos` me bhi dikhta hai.

## Server files
`app/api/attachments/route.ts` (sign / ready / links / list), `lib/attachments.ts`, `lib/attachments-server.ts`, `lib/attach-client.ts`, `lib/zip-lite.ts`, `lib/tools/attachments.ts`, aur badli hui: `components/dashboard/ChatComposer.tsx`, `app/dashboard/page.tsx`, `lib/tools/social.ts`, `lib/tools/registry.ts`, `lib/tools/catalog.ts`, `lib/tools/prompt.ts`.

## Zaruri setup (Supabase, ek baar)
- Wahi `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` jo Venus Pro ke liye hain. Naya bucket nahi chahiye (`venus-videos` hi use hota hai, `<uid>/attachments/<chat>/...` path me).
- **File size limit:** app ki limit 500 MB hai, par Supabase ka apna limit alag hai (free plan par 50 MB). Badi video chahiye to Supabase → Storage → Settings me "Global file size limit" badhao. Limit se bada file upload hone par chip par Supabase ka error dikhta hai.
- Social par post karne ke liye video 128 MB tak (aur Vercel 60 s limit, pehle jaisa).

## Test
Mocked tests: 31 checks (upload sign, size/empty refusal, doosre chat/owner ki file nahi milti, zip/docx/xlsx/pptx padhna, path-traversal refuse, attached video YouTube par upload) + purane sab (33 + 20 + 5) + repo ke 38 tests pass. Browser UI (drag-drop, progress, photo vision) type/syntax check hua hai, par live browser me chalake dekha nahi.
