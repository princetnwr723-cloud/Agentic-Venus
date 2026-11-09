// No imports on purpose: used by the browser (to catch the command before it is sent) and by the server.
/** "[dashboard", "[dashboard]", "/dashboard" or just "dashboard" — the owner asking for this chat's dashboard. */
export const DASHBOARD_CMD = /^\s*(?:\[\s*dashboard\s*\]?|\/dashboard|dashboard)\s*[.!?]*\s*$/i;
export const isDashboardCommand = (text: string): boolean => DASHBOARD_CMD.test(String(text ?? ""));

export const DASHBOARD_CREATED = "📊 **Dashboard ban gaya!** Is chat ka dashboard ready hai: kitne tasks, calls, code aur clients booked, sab live update hota rahega.\n\nKahan dikhega: upar agent ke naam/avatar par tap karo → **Profile** → *Agent cooperation* ke neeche. Wahan **Open full dashboard** dabao.\n\n(Ek chat me ek hi dashboard hota hai.)";
export const DASHBOARD_EXISTS = "📊 Is chat ka dashboard pehle se bana hua hai (ek chat me ek hi hota hai). Agent ke naam/avatar par tap karo → **Profile** → *Agent cooperation* ke neeche dekho, wo apne aap update hota rehta hai.";