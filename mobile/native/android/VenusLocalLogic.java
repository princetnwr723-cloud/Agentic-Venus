package com.agenticvenus.app;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Everything the phone computer decides WITHOUT touching Android: how much RAM and storage to offer, how to read the Alpine
 * download list, how to unpack the Linux files, how to add up the memory of the computer's processes, and which jobs are allowed.
 * No android.* imports on purpose: scripts/tests/mobile-computer.test.mjs compiles and runs this file on a normal Java.
 */
public final class VenusLocalLogic {
    private VenusLocalLogic() {}

    // ------------------------------------------------------------------ RAM and storage choices

    /** What this phone can offer. All numbers are in MB (RAM) or GB (storage). */
    public static final class Plan {
        public int ramRecommendedMB, ramMinMB, ramMaxMB;
        public int diskRecommendedGB, diskMinGB, diskMaxGB;
        public int[] ramOptionsMB = new int[0];
        public int[] diskOptionsGB = new int[0];
    }

    private static final int[] RAM_STEPS_MB = {1024, 1536, 2048, 3072, 4096, 6144, 8192};
    private static final int[] DISK_STEPS_GB = {4, 6, 8, 10, 15, 20, 30, 50, 100};

    /** The RAM that is a good default for a phone with this much memory (a "6 GB" phone reports about 5.6 GB, an "8 GB" one about 7.5 GB). */
    public static int recommendedRamMB(long phoneTotalMB) {
        if (phoneTotalMB < 3500) return 1024;
        if (phoneTotalMB < 5500) return 1536;
        if (phoneTotalMB < 7000) return 2048;
        if (phoneTotalMB < 10000) return 3072;
        if (phoneTotalMB < 14000) return 4096;
        return 6144;
    }

    /** Android and the person's other apps keep at least 3 GB (a small phone: half of it). */
    public static int maxRamMB(long phoneTotalMB) {
        long keep = phoneTotalMB <= 6144 ? phoneTotalMB / 2 : 3072;
        long max = phoneTotalMB - keep;
        return (int) Math.max(1024, Math.min(8192, max));
    }

    public static Plan plan(long phoneTotalMB, long freeStorageMB) {
        Plan p = new Plan();
        p.ramMinMB = 1024;
        p.ramMaxMB = maxRamMB(phoneTotalMB);
        p.ramRecommendedMB = Math.min(recommendedRamMB(phoneTotalMB), p.ramMaxMB);
        List<Integer> ro = new ArrayList<>();
        for (int s : RAM_STEPS_MB) if (s >= p.ramMinMB && s <= p.ramMaxMB) ro.add(s);
        if (!ro.contains(p.ramRecommendedMB)) ro.add(p.ramRecommendedMB);
        java.util.Collections.sort(ro);
        p.ramOptionsMB = toArray(ro);

        // the computer needs about 2 GB to be installed; keep 2 GB of the phone free for Android itself
        long usableGB = Math.max(0, (freeStorageMB - 2048) / 1024);
        p.diskMinGB = 4;
        p.diskMaxGB = (int) Math.max(p.diskMinGB, Math.min(100, usableGB));
        p.diskRecommendedGB = (int) Math.min(10, p.diskMaxGB);
        List<Integer> dO = new ArrayList<>();
        for (int s : DISK_STEPS_GB) if (s >= p.diskMinGB && s <= p.diskMaxGB) dO.add(s);
        if (!dO.contains(p.diskRecommendedGB)) dO.add(p.diskRecommendedGB);
        java.util.Collections.sort(dO);
        p.diskOptionsGB = toArray(dO);
        return p;
    }

    private static int[] toArray(List<Integer> l) {
        int[] a = new int[l.size()];
        for (int i = 0; i < a.length; i++) a[i] = l.get(i);
        return a;
    }

    public static int clamp(int v, int lo, int hi) { return Math.max(lo, Math.min(hi, v)); }

    // ------------------------------------------------------------------ which Alpine Linux file to download

    /** The file name, its sha256 and its version, read from Alpine's "latest-releases.yaml". null if that flavor is not in the list. */
    public static String[] parseLatestReleases(String yaml, String flavor) {
        if (yaml == null) return null;
        String file = null, sha = null, version = "";
        boolean match = false;
        List<String[]> blocks = new ArrayList<>();
        for (String raw : yaml.split("\\r?\\n")) {
            String line = raw.trim();
            if (line.equals("-") || line.startsWith("- ")) {
                if (match && file != null && sha != null) blocks.add(new String[]{file, sha, version});
                file = null; sha = null; version = ""; match = false;
                if (line.length() > 2) line = line.substring(2).trim(); else continue;
            }
            int c = line.indexOf(':');
            if (c < 0) continue;
            String k = line.substring(0, c).trim();
            String v = line.substring(c + 1).trim();
            if (v.length() >= 2 && ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'")))) v = v.substring(1, v.length() - 1);
            switch (k) {
                case "flavor": match = v.equals(flavor); break;
                case "file": file = v; break;
                case "sha256": sha = v.toLowerCase(); break;
                case "version": version = v; break;
                default: break;
            }
        }
        if (match && file != null && sha != null) blocks.add(new String[]{file, sha, version});
        for (String[] b : blocks) if (b[0].matches("[A-Za-z0-9._-]+\\.tar\\.gz") && b[1].matches("[a-f0-9]{64}")) return b;
        return null;
    }

    // ------------------------------------------------------------------ reading install progress

    private static final Pattern APK_STEP = Pattern.compile("^\\((\\d+)/(\\d+)\\)");

    /** "(12/85) Installing chromium" -> 14 (percent). -1 when the line is not a step. */
    public static int apkPercent(String line) {
        if (line == null) return -1;
        Matcher m = APK_STEP.matcher(line.trim());
        if (!m.find()) return -1;
        int n = Integer.parseInt(m.group(1)), total = Integer.parseInt(m.group(2));
        return total <= 0 ? -1 : clamp(n * 100 / total, 0, 100);
    }

    // ------------------------------------------------------------------ unpacking the Linux files (a .tar stream)

    /** The few file operations Android needs that plain Java does not have on every Android version. */
    public interface Fs {
        void symlink(File link, String target) throws IOException;
        void chmod(File f, int mode);
        boolean isSymlink(File f);
    }

    public interface Progress { void bytes(long total); }

    private static boolean readFully(InputStream in, byte[] b) throws IOException {
        int off = 0;
        while (off < b.length) {
            int n = in.read(b, off, b.length - off);
            if (n < 0) return off != 0 && fail("Unexpected end of the Linux file.");
            off += n;
        }
        return true;
    }

    private static boolean fail(String m) throws IOException { throw new IOException(m); }

    private static void skipFully(InputStream in, long n) throws IOException {
        byte[] sink = new byte[8192];
        while (n > 0) {
            int r = in.read(sink, 0, (int) Math.min(sink.length, n));
            if (r < 0) throw new IOException("Unexpected end of the Linux file.");
            n -= r;
        }
    }

    private static String cstr(byte[] b, int off, int len) {
        int end = off;
        while (end < off + len && b[end] != 0) end++;
        return new String(b, off, end - off, StandardCharsets.UTF_8);
    }

    private static long number(byte[] b, int off, int len) {
        if ((b[off] & 0x80) != 0) { // GNU base-256 for very large values
            long v = b[off] & 0x7f;
            for (int i = 1; i < len; i++) v = (v << 8) | (b[off + i] & 0xff);
            return v;
        }
        String s = cstr(b, off, len).trim();
        return s.isEmpty() ? 0 : Long.parseLong(s, 8);
    }

    private static boolean isZero(byte[] b) {
        for (byte x : b) if (x != 0) return false;
        return true;
    }

    private static byte[] readBytes(InputStream in, long size) throws IOException {
        if (size > 1_000_000) throw new IOException("A name inside the Linux file is too long.");
        byte[] data = new byte[(int) size];
        int off = 0;
        while (off < data.length) {
            int n = in.read(data, off, data.length - off);
            if (n < 0) throw new IOException("Unexpected end of the Linux file.");
            off += n;
        }
        skipFully(in, (512 - size % 512) % 512);
        return data;
    }

    /** pax header records: "<len> key=value\n" */
    private static Map<String, String> paxRecords(byte[] data) {
        Map<String, String> m = new HashMap<>();
        int i = 0;
        while (i < data.length) {
            int sp = i;
            while (sp < data.length && data[sp] != ' ') sp++;
            if (sp >= data.length) break;
            int len;
            try { len = Integer.parseInt(new String(data, i, sp - i, StandardCharsets.US_ASCII)); } catch (NumberFormatException e) { break; }
            if (len <= 0 || i + len > data.length) break;
            String rec = new String(data, sp + 1, i + len - sp - 2, StandardCharsets.UTF_8); // without the trailing newline
            int eq = rec.indexOf('=');
            if (eq > 0) m.put(rec.substring(0, eq), rec.substring(eq + 1));
            i += len;
        }
        return m;
    }

    /** A safe path inside the root: no "..", no leading "/" or "./". null = nothing to create (the root itself). */
    static String cleanName(String name) throws IOException {
        String n = name.replace('\\', '/');
        while (n.startsWith("./")) n = n.substring(2);
        while (n.startsWith("/")) n = n.substring(1);
        while (n.endsWith("/")) n = n.substring(0, n.length() - 1);
        if (n.isEmpty() || n.equals(".")) return null;
        for (String part : n.split("/")) if (part.equals("..")) throw new IOException("Unsafe path in the Linux file: " + name);
        return n;
    }

    /** true when some folder on the way to this file is a link (we never write through links). */
    private static boolean throughLink(File root, File f, Fs fs) {
        File p = f.getParentFile();
        while (p != null && !p.equals(root)) {
            if (fs.isSymlink(p)) return true;
            p = p.getParentFile();
        }
        return false;
    }

    /** Unpacks a plain .tar stream (already un-gzipped) into root. Returns how many entries were created. */
    public static int extractTar(InputStream in, File root, Fs fs, Progress progress) throws IOException {
        byte[] h = new byte[512];
        String longName = null, longLink = null;
        Map<String, String> pax = null;
        int count = 0;
        long total = 0;
        byte[] buf = new byte[64 * 1024];
        if (!root.exists() && !root.mkdirs()) throw new IOException("Could not create " + root);

        while (readFully(in, h)) {
            total += 512;
            if (isZero(h)) continue; // the end of a tar is two empty blocks
            long size = number(h, 124, 12);
            int mode = (int) number(h, 100, 8) & 07777;
            char type = h[156] == 0 ? '0' : (char) h[156];

            if (type == 'L') { longName = cstr(readBytes(in, size), 0, (int) Math.min(size, 100000)); total += size; continue; }
            if (type == 'K') { longLink = cstr(readBytes(in, size), 0, (int) Math.min(size, 100000)); total += size; continue; }
            if (type == 'x') { pax = paxRecords(readBytes(in, size)); total += size; continue; }
            if (type == 'g') { skipFully(in, size + (512 - size % 512) % 512); total += size; continue; }

            String name = cstr(h, 0, 100);
            String prefix = cstr(h, 345, 155);
            if (!prefix.isEmpty()) name = prefix + "/" + name;
            String link = cstr(h, 157, 100);
            if (pax != null) {
                if (pax.containsKey("path")) name = pax.get("path");
                if (pax.containsKey("linkpath")) link = pax.get("linkpath");
            }
            if (longName != null) name = longName;
            if (longLink != null) link = longLink;
            longName = null; longLink = null; pax = null;

            String clean = cleanName(name);
            long dataBytes = (type == '0' || type == '7') ? size : 0;
            if (clean == null) { skipFully(in, dataBytes + (dataBytes == 0 ? 0 : (512 - dataBytes % 512) % 512)); continue; }
            File f = new File(root, clean);

            if (throughLink(root, f, fs)) { // refuse to write through a link: skip the entry
                skipFully(in, dataBytes + (dataBytes == 0 ? 0 : (512 - dataBytes % 512) % 512));
                continue;
            }

            switch (type) {
                case '5': {
                    if (fs.isSymlink(f)) f.delete();
                    if (!f.isDirectory() && !f.mkdirs()) throw new IOException("Could not create folder " + clean);
                    fs.chmod(f, mode | 0700);
                    count++;
                    break;
                }
                case '2': {
                    File parent = f.getParentFile();
                    if (parent != null && !parent.isDirectory()) parent.mkdirs();
                    if (fs.isSymlink(f) || f.exists()) f.delete();
                    fs.symlink(f, link);
                    count++;
                    break;
                }
                case '1': { // a hard link: Android does not allow them in app storage, so make a copy
                    String target = cleanName(link);
                    File parent = f.getParentFile();
                    if (parent != null && !parent.isDirectory()) parent.mkdirs();
                    if (target != null) {
                        File src = new File(root, target);
                        if (src.isFile() && !fs.isSymlink(src)) {
                            if (f.exists()) f.delete();
                            try (InputStream s = new FileInputStream(src); OutputStream o = new FileOutputStream(f)) {
                                int n;
                                while ((n = s.read(buf)) > 0) o.write(buf, 0, n);
                            }
                            fs.chmod(f, mode | 0600);
                            count++;
                        }
                    }
                    break;
                }
                case '0':
                case '7': {
                    File parent = f.getParentFile();
                    if (parent != null && !parent.isDirectory()) parent.mkdirs();
                    if (fs.isSymlink(f) || f.exists()) f.delete();
                    long left = size;
                    try (OutputStream o = new FileOutputStream(f)) {
                        while (left > 0) {
                            int n = in.read(buf, 0, (int) Math.min(buf.length, left));
                            if (n < 0) throw new IOException("Unexpected end of the Linux file.");
                            o.write(buf, 0, n);
                            left -= n;
                        }
                    }
                    skipFully(in, (512 - size % 512) % 512);
                    fs.chmod(f, mode | 0600);
                    total += size;
                    count++;
                    break;
                }
                default:
                    break; // devices, fifos: not needed (proot provides /dev)
            }
            if (progress != null) progress.bytes(total);
        }
        return count;
    }

    // ------------------------------------------------------------------ the memory of the computer's processes

    /** "1234 (some (name)) S 1200 ..." -> {pid, ppid}. The name may contain spaces and brackets, so read after the LAST ")". */
    public static int[] parseStat(String stat) {
        if (stat == null) return null;
        int close = stat.lastIndexOf(')');
        int open = stat.indexOf('(');
        if (close < 0 || open < 0) return null;
        try {
            int pid = Integer.parseInt(stat.substring(0, open).trim());
            String[] rest = stat.substring(close + 1).trim().split("\\s+");
            return new int[]{pid, Integer.parseInt(rest[1])}; // rest[0] = state, rest[1] = ppid
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** All processes below root (children, grandchildren, ...), root included. */
    public static Set<Integer> descendants(Map<Integer, Integer> parentOf, int root) {
        Map<Integer, List<Integer>> kids = new HashMap<>();
        for (Map.Entry<Integer, Integer> e : parentOf.entrySet()) {
            kids.computeIfAbsent(e.getValue(), k -> new ArrayList<>()).add(e.getKey());
        }
        Set<Integer> out = new HashSet<>();
        List<Integer> todo = new ArrayList<>();
        todo.add(root);
        while (!todo.isEmpty()) {
            int p = todo.remove(todo.size() - 1);
            if (!out.add(p)) continue;
            List<Integer> k = kids.get(p);
            if (k != null) todo.addAll(k);
        }
        return out;
    }

    /** /proc/PID/statm: the second number is the resident pages. */
    public static long residentBytes(String statm, int pageSize) {
        if (statm == null) return 0;
        String[] p = statm.trim().split("\\s+");
        if (p.length < 2) return 0;
        try { return Long.parseLong(p[1]) * pageSize; } catch (NumberFormatException e) { return 0; }
    }

    // ------------------------------------------------------------------ jobs (the same checks as the desktop app)

    private static final Set<String> OPS = new HashSet<>(java.util.Arrays.asList("exec", "screenshot", "input", "vm"));
    private static final Set<String> INPUT = new HashSet<>(java.util.Arrays.asList("click", "double_click", "right_click", "type", "key", "scroll"));
    private static final Set<String> VM_ACTIONS = new HashSet<>(java.util.Arrays.asList("start", "stop", "status"));
    public static final int MAX_CMD_BYTES = 4_000_000;

    /** null = the job is fine; otherwise the reason it is refused. The server checked it already: this is the second look. */
    public static String checkJob(String id, String op, String cmd, String inputType, String vmAction) {
        if (id == null || id.isEmpty() || op == null || !OPS.contains(op)) return "Unknown job.";
        if (op.equals("exec")) {
            if (cmd == null || cmd.trim().isEmpty() || cmd.getBytes(StandardCharsets.UTF_8).length > MAX_CMD_BYTES) return "Bad command.";
        }
        if (op.equals("input") && (inputType == null || !INPUT.contains(inputType))) return "Bad input.";
        if (op.equals("vm") && (vmAction == null || !VM_ACTIONS.contains(vmAction))) return "Bad action.";
        return null;
    }

    // ------------------------------------------------------------------ talking to the agent inside the computer

    /**
     * A tiny HTTP client over a plain socket, only for 127.0.0.1. (Android refuses "http://" in HttpURLConnection, but not a socket,
     * and the agent only listens on this phone, with a secret key.) Returns {status, body}.
     */
    public static String[] httpLocal(int port, String method, String path, String key, String body, int timeoutMs) throws IOException {
        if (key != null && !key.matches("[A-Za-z0-9_-]{16,200}")) throw new IOException("Bad agent key.");
        byte[] b = body == null ? null : body.getBytes(StandardCharsets.UTF_8);
        StringBuilder req = new StringBuilder();
        req.append(method).append(' ').append(path).append(" HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n");
        if (key != null) req.append("X-Venus-Key: ").append(key).append("\r\n");
        if (b != null) req.append("Content-Type: application/json\r\nContent-Length: ").append(b.length).append("\r\n");
        req.append("\r\n");
        try (java.net.Socket s = new java.net.Socket()) {
            s.connect(new java.net.InetSocketAddress("127.0.0.1", port), 3000);
            s.setSoTimeout(timeoutMs);
            OutputStream o = s.getOutputStream();
            o.write(req.toString().getBytes(StandardCharsets.UTF_8));
            if (b != null) o.write(b);
            o.flush();
            return parseHttp(readAll(s.getInputStream()));
        }
    }

    static String[] parseHttp(byte[] all) throws IOException {
        String head = new String(all, StandardCharsets.ISO_8859_1);
        int end = head.indexOf("\r\n\r\n");
        if (end < 0) throw new IOException("The computer gave no answer.");
        String[] lines = head.substring(0, end).split("\r\n");
        String[] first = lines[0].split(" ");
        if (first.length < 2) throw new IOException("The computer gave a bad answer.");
        boolean chunked = false;
        long length = -1;
        for (int i = 1; i < lines.length; i++) {
            String l = lines[i].toLowerCase(java.util.Locale.ROOT);
            if (l.startsWith("transfer-encoding:") && l.contains("chunked")) chunked = true;
            if (l.startsWith("content-length:")) { try { length = Long.parseLong(l.substring(15).trim()); } catch (NumberFormatException ignored) { } }
        }
        int start = end + 4;
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        if (chunked) {
            int i = start;
            while (i < all.length) {
                int e = i;
                while (e + 1 < all.length && !(all[e] == '\r' && all[e + 1] == '\n')) e++;
                int semi = new String(all, i, e - i, StandardCharsets.ISO_8859_1).indexOf(';');
                String hex = new String(all, i, (semi >= 0 ? i + semi : e) - i, StandardCharsets.ISO_8859_1).trim();
                int size = hex.isEmpty() ? 0 : Integer.parseInt(hex, 16);
                if (size == 0) break;
                i = e + 2;
                if (i + size > all.length) throw new IOException("The computer's answer was cut off.");
                body.write(all, i, size);
                i += size + 2;
            }
        } else {
            int n = all.length - start;
            if (length >= 0) {
                if (length > n) throw new IOException("The computer's answer was cut off.");
                n = (int) length;
            }
            body.write(all, start, n);
        }
        return new String[]{first[1], new String(body.toByteArray(), StandardCharsets.UTF_8)};
    }

    /** "1.5 GB" / "512 MB" for messages. */
    public static String mb(long mb) {
        return mb >= 1024 ? String.format(java.util.Locale.US, "%.1f GB", mb / 1024.0) : mb + " MB";
    }

    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
        return b.toByteArray();
    }
}
