# Social media connectors: setup guide

Ye files Agentic-Venus me **Connectors → OAuth apps** ke andar 8 social providers jodti hain. User sirf **Connect** dabata hai, platform ke apne page par login karta hai, aur agent uski id se kaam karta hai. Password kabhi agent ya server tak nahi aata. Token vault me encrypted rehta hai (pehle jaisa hi).

Gmail login pehle se tha (`google` provider). Wo waisa hi chal raha hai.

## 1. Files (sab repo ke same path par rakho)

| File | Kya badla |
|---|---|
| `lib/tools/oauth-catalog.ts` | 8 naye providers: youtube, x, linkedin, meta (Facebook Page + Instagram), threads, tiktok, pinterest, reddit |
| `lib/tools/oauth-token.ts` | PKCE, Basic-auth / client_key token requests, Facebook/Threads long-lived token + auto renew |
| `lib/tools/oauth-identify.ts` | Har platform par "kis account se login hua" dikhata hai |
| `app/api/connectors/oauth/start/route.ts` | Social providers ke authorize URL (PKCE, comma scopes, client_key) |
| `app/api/connectors/oauth/callback/route.ts` | Token exchange har platform ke style me, Meta/Threads long-lived swap |
| `lib/tools/social.ts` | **Naya.** `social.*` tools (video title/id/latest se milta hai, YouTube ke errors saaf, research web fallback ke saath) |
| `lib/social-intent.ts` | **Naya.** Router guard: upload / post / research hamesha social tool se, PC se kabhi nahi |
| `lib/intent.ts` | Router ko social-intent guard + REA refusal mila |
| `lib/rea-policy.ts`, `lib/tools/reverse.ts` | **Naya.** REA (Reverse Engineer Anything) built-in: `reverse.guide` tool + rules |
| `lib/pc-toolbelt.ts` | Computer me Node 22 + `rea-agents` install, REA aur social rules prompt me |
| `lib/tools/catalog.ts` | `reverse.guide` free pack me
| `lib/tools/registry.ts` | social tools ko catalog aur approval flow me jodta hai |
| `lib/tools/prompt.ts` | Agent ko social tools ka use batata hai |
| `lib/connector-announce.ts` | Chat me "Agent updated" message ke liye social text |

UI me koi change nahi chahiye: `ConnectorsModal` `OAUTH_PROVIDERS` se hi buttons banata hai, to naye platforms ke Connect buttons apne aap aa jate hain.

## 2. Vercel environment variables

Redirect URI sab platforms me ek hi hai: `https://<tumhara-domain>/api/connectors/oauth/callback`
(agar `OAUTH_REDIRECT_URI` set hai to wahi). Pehle se zaruri: `ROUTINE_RUNNER_SECRET` (32+ chars), `VAULT_KEY`, Firebase vars, Supabase vars (video ke liye).

| Platform | Client ID | Client Secret | App kahan banao |
|---|---|---|---|
| Google (Gmail) | `GOOGLE_CLIENT_ID` | `GOOGLE_CLIENT_SECRET` | console.cloud.google.com → Gmail API, Sheets, Drive, Calendar enable |
| YouTube | `GOOGLE_CLIENT_ID` (wahi) | `GOOGLE_CLIENT_SECRET` (wahi) | Usi Google project me **YouTube Data API v3** enable karo |
| X | `X_CLIENT_ID` | `X_CLIENT_SECRET` | developer.x.com → OAuth 2.0, type "Web App / confidential" |
| LinkedIn | `LINKEDIN_CLIENT_ID` | `LINKEDIN_CLIENT_SECRET` | linkedin.com/developers → products: *Sign In with LinkedIn using OpenID Connect* + *Share on LinkedIn* |
| Facebook Page + Instagram | `META_APP_ID` | `META_APP_SECRET` | developers.facebook.com → app + Facebook Login |
| Threads | `THREADS_APP_ID` | `THREADS_APP_SECRET` | Meta app me Threads use case (Threads ka app id alag hota hai) |
| TikTok | `TIKTOK_CLIENT_KEY` | `TIKTOK_CLIENT_SECRET` | developers.tiktok.com → Login Kit + Content Posting API |
| Pinterest | `PINTEREST_APP_ID` | `PINTEREST_APP_SECRET` | developers.pinterest.com |
| Reddit | `REDDIT_CLIENT_ID` | `REDDIT_CLIENT_SECRET` | reddit.com/prefs/apps → type "web app" |

Optional: `LINKEDIN_API_VERSION` (default `202602`).

## 3. Agent ke naye tools

| Tool | Kaam | Approval |
|---|---|---|
| `social.accounts` | Kaun se platform connected hain, kaun sa account, Pages / Instagram / Pinterest boards | nahi |
| `social.videos` | Venus Pro ke finished videos (id, title, length, shape) | nahi |
| `social.research` | YouTube (views/likes), X (recent posts), Reddit search | nahi |
| `social.my_posts` | Apni recent posts ke numbers (YouTube, X, Facebook, Instagram, TikTok, Threads, Pinterest, Reddit) | nahi |
| `social.post` | Text / link / picture post, kai platforms ek saath | **haan** |
| `social.post_video` | Venus Pro video upload: YouTube (Shorts bhi), X, LinkedIn, Facebook, Instagram Reels, Threads, TikTok, Pinterest | **haan** |
| `social.finish` | Jo post processing me atak gayi (Instagram/Threads/LinkedIn/Pinterest/X/TikTok) use poora karta hai | **haan** |

Har post ka result har platform ke liye `✓ link` ya `✗ wajah` dikhata hai, to sirf fail wale dobara bheje ja sakte hain. Auto-approve switch tabhi approval skip karta hai jab **saare** target platforms par on ho.

## 4. Ye cheezein platforms ki taraf se limit hain (code ki nahi)

- **TikTok:** jab tak TikTok tumhari app ko audit nahi karta, har post **private** (SELF_ONLY) hogi. Code apne aap private bhejta hai aur batata hai.
- **X:** posting aur search ke liye X ka paid API plan chahiye. Bina plan ke 402/403 aayega, error text me dikhega.
- **Instagram:** Business ya Creator account, Facebook Page se linked. Dusron ke accounts ke liye Meta app review (Advanced Access) chahiye; apne khud ke account/roles ke saath development mode me chal jata hai.
- **LinkedIn:** login 60 din chalta hai, phir **Reconnect**. LinkedIn apps ko apni purani posts padhne nahi deta, isliye `social.my_posts` LinkedIn ke liye nahi hai.
- **Pinterest:** nayi app "Trial access" par hoti hai. Public pins ke liye Standard access maango.
- **Reddit:** is connector se video upload nahi, sirf text/link post aur search.
- **YouTube / Google:** app "Testing" status me ho to Google refresh token 7 din me expire kar deta hai (Reconnect dabana padega). Publish/verify karne par ye nahi hota.
- **Scopes badalne par:** user ko ek baar **Reconnect** dabana hota hai.
- **Facebook / Threads:** login ~60 din ka hota hai aur aakhri 7 din me apne aap renew ho jata hai.

## 5. Video size / time

Chat route Vercel par 60 second tak chalta hai. Video seedha Supabase se download hoke platforms par jata hai (limit 128 MB). Bade video (~40 MB se upar) ya bahut saare platforms ek saath ho to `mission.start` se background me chalao. Instagram / Threads / TikTok / Pinterest / LinkedIn / X ko processing me time lagta hai: tool wait karta hai, aur na ho paye to exact `social.finish` call batata hai.

## 6. Kya test hua aur kya nahi

- Type-check: naye/badle sab files saaf.
- Mocked tests: 33 tool checks (har platform ka request format, headers, chunk ranges, approval gating, untrusted-output wrapping) + 5 callback checks (PKCE, Basic auth, Meta long-lived swap, galat account par kuch save nahi, replay/tamper refuse). Repo ke apne 38 tests bhi pass.
- **Live platforms par test nahi hua** (mere paas tumhare app credentials nahi hain). Endpoints official docs se verify kiye gaye. Sabse kam verified hisse: Pinterest video pin, Threads, Facebook video chunk upload. Pehli baar chalate waqt in par error aaye to uska text agent ke result me poora dikhega.

## 7. REA (Reverse Engineer Anything) built-in

- Agent ka computer ab `rea` command ke saath aata hai (npm `rea-agents`, Node 22+). Chat me `reverse.guide` tool playbook deta hai: kya allowed hai, kaise analyse karna hai, aur "free unlimited version" kaise banana hai.
- "Free unlimited version" ka matlab: tool ko analyse karo (SEEN / INFERRED / UNKNOWN), phir **owner ka apna** clean-room version open-source libraries se banao. Apna code hai, isliye uspe koi limit nahi.
- **Nahi hoga:** crack, keygen, licence / paywall / quota / rate-limit bypass, DRM ya watermark hatana, kisi aur ka account ya key. Aisi request par agent ek line me mana karke legal rasta batata hai (REA ka apna disclaimer bhi yahi hai).

## 8. Dobara upload wali dikkat (fix)

Pehle "ek aur video upload karo" router ko "computer ka kaam" lagta tha, isliye agent browser se upload karne lagta tha. Ab: (1) router me guard hai jo social upload/post/research ko chat tool par hi rakhta hai, (2) prompt me rule hai ki upload hamesha `social.post_video`, (3) video `video_id` se, exact title se, "latest" se ya brief ke shabdon se mil jata hai, (4) fail hone par error me video ids aur "computer mat use karo" likha aata hai.
