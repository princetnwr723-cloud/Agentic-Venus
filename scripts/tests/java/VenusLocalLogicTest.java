package com.agenticvenus.app;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.util.HashMap;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/** Runs on a normal Java (see scripts/tests/mobile-computer.test.mjs). Exits with 1 and prints the reason when something is wrong. */
public class VenusLocalLogicTest {
    static int failed = 0;

    static void check(boolean ok, String what) {
        if (!ok) { failed++; System.out.println("FAIL: " + what); }
    }

    static class JvmFs implements VenusLocalLogic.Fs {
        public void symlink(File link, String target) throws IOException { Files.createSymbolicLink(link.toPath(), new File(target).toPath()); }
        public boolean isSymlink(File f) { return Files.isSymbolicLink(f.toPath()); }
        public void chmod(File f, int mode) {
            Set<PosixFilePermission> s = new HashSet<>();
            PosixFilePermission[] all = {PosixFilePermission.OTHERS_EXECUTE, PosixFilePermission.OTHERS_WRITE, PosixFilePermission.OTHERS_READ,
                PosixFilePermission.GROUP_EXECUTE, PosixFilePermission.GROUP_WRITE, PosixFilePermission.GROUP_READ,
                PosixFilePermission.OWNER_EXECUTE, PosixFilePermission.OWNER_WRITE, PosixFilePermission.OWNER_READ};
            for (int i = 0; i < 9; i++) if ((mode & (1 << i)) != 0) s.add(all[i]);
            try { Files.setPosixFilePermissions(f.toPath(), s); } catch (IOException ignored) { }
        }
    }

    public static void main(String[] args) throws Exception {
        File fixtures = new File(args[0]);
        File work = new File(args[1]);

        // ---- RAM and storage choices
        VenusLocalLogic.Plan eight = VenusLocalLogic.plan(7600, 60_000);
        check(eight.ramRecommendedMB == 3072, "8 GB phone recommends 3 GB, got " + eight.ramRecommendedMB);
        check(eight.ramMaxMB == 4528, "8 GB phone max RAM, got " + eight.ramMaxMB);
        check(contains(eight.ramOptionsMB, 3072) && contains(eight.ramOptionsMB, 4096) && !contains(eight.ramOptionsMB, 6144), "8 GB options");
        check(eight.diskRecommendedGB == 10 && contains(eight.diskOptionsGB, 10) && contains(eight.diskOptionsGB, 20), "8 GB phone recommends 10 GB storage");
        VenusLocalLogic.Plan four = VenusLocalLogic.plan(3800, 20_000);
        check(four.ramRecommendedMB == 1536 && four.ramMaxMB == 1900, "4 GB phone: " + four.ramRecommendedMB + "/" + four.ramMaxMB);
        check(four.ramRecommendedMB <= four.ramMaxMB, "recommended never above max");
        VenusLocalLogic.Plan twelve = VenusLocalLogic.plan(11_000, 200_000);
        check(twelve.ramRecommendedMB == 4096 && contains(twelve.ramOptionsMB, 6144), "12 GB phone");
        VenusLocalLogic.Plan full = VenusLocalLogic.plan(7600, 5000);
        check(full.diskMaxGB >= full.diskMinGB && full.diskRecommendedGB <= full.diskMaxGB, "nearly full phone still gets a valid plan");
        check(VenusLocalLogic.clamp(9, 1, 5) == 5 && VenusLocalLogic.clamp(-3, 1, 5) == 1, "clamp");

        // ---- Alpine's download list
        String yaml = "---\n-\n  title: \"Mini root filesystem\"\n  desc: \"x\"\n  date: \"2026-10-01\"\n  version: 3.22.1\n  flavor: alpine-minirootfs\n  file: alpine-minirootfs-3.22.1-aarch64.tar.gz\n  sha256: "
            + "a".repeat(64) + "\n  sha512: bb\n-\n  title: \"Other\"\n  flavor: alpine-standard\n  file: alpine-standard-3.22.1-aarch64.iso\n  sha256: " + "b".repeat(64) + "\n";
        String[] r = VenusLocalLogic.parseLatestReleases(yaml, "alpine-minirootfs");
        check(r != null && r[0].equals("alpine-minirootfs-3.22.1-aarch64.tar.gz") && r[1].equals("a".repeat(64)) && r[2].equals("3.22.1"), "yaml minirootfs");
        check(VenusLocalLogic.parseLatestReleases(yaml, "alpine-nothing") == null, "yaml unknown flavor");
        check(VenusLocalLogic.parseLatestReleases("garbage", "alpine-minirootfs") == null, "yaml garbage");
        String evilYaml = yaml.replace("alpine-minirootfs-3.22.1-aarch64.tar.gz", "../../evil.tar.gz");
        check(VenusLocalLogic.parseLatestReleases(evilYaml, "alpine-minirootfs") == null, "a file name with a path is refused");

        // ---- install progress
        check(VenusLocalLogic.apkPercent("(12/48) Installing chromium (1.2-r0)") == 25, "apk 12/48");
        check(VenusLocalLogic.apkPercent("fetch https://x") == -1 && VenusLocalLogic.apkPercent(null) == -1, "apk other line");

        // ---- unpacking
        File out = new File(work, "rootfs");
        int n = VenusLocalLogic.extractTar(new FileInputStream(new File(fixtures, "good.tar")), out, new JvmFs(), null);
        check(n >= 8, "entries created: " + n);
        check(new File(out, "bin/hello.sh").isFile() && new File(out, "bin/hello.sh").canExecute(), "executable file");
        check(read(new File(out, "etc/motd")).equals("welcome\n"), "text file content");
        check(Files.isSymbolicLink(new File(out, "bin/sh").toPath()) && Files.readSymbolicLink(new File(out, "bin/sh").toPath()).toString().equals("/bin/busybox"), "absolute symlink stays as written");
        check(Files.isSymbolicLink(new File(out, "usr/rel").toPath()) && Files.readSymbolicLink(new File(out, "usr/rel").toPath()).toString().equals("../etc/motd"), "relative symlink");
        check(new File(out, "bin/hard.sh").isFile() && !Files.isSymbolicLink(new File(out, "bin/hard.sh").toPath()) && read(new File(out, "bin/hard.sh")).equals(read(new File(out, "bin/hello.sh"))), "hard link becomes a copy");
        String longName = "usr/share/" + "d".repeat(60) + "/" + "f".repeat(70) + ".txt";
        check(new File(out, longName).isFile() && read(new File(out, longName)).equals("long\n"), "long file name");
        check(new File(out, "usr/share/ünï/ファイル.txt").isFile(), "unicode name (pax)");
        check(!new File(work, "escaped.txt").exists() && !new File("/tmp/venus-escape-test.txt").exists(), "nothing written through a link");
        check(new File(out, "tmp").isDirectory(), "folder");

        boolean refused = false;
        try { VenusLocalLogic.extractTar(new FileInputStream(new File(fixtures, "evil.tar")), new File(work, "evilroot"), new JvmFs(), null); }
        catch (IOException e) { refused = e.getMessage().contains("Unsafe path"); }
        check(refused, "a path with .. is refused");
        check(!new File(work, "pwned.txt").exists(), "evil file not written");

        boolean cut = false;
        try { VenusLocalLogic.extractTar(new FileInputStream(new File(fixtures, "cut.tar")), new File(work, "cutroot"), new JvmFs(), null); }
        catch (IOException e) { cut = true; }
        check(cut, "a cut-off file is an error, not a silent success");

        // ---- process memory
        int[] st = VenusLocalLogic.parseStat("4242 (Web Content (x)) S 4100 4242 4242 0 -1 0");
        check(st != null && st[0] == 4242 && st[1] == 4100, "stat with brackets in the name");
        check(VenusLocalLogic.parseStat("nonsense") == null, "stat nonsense");
        Map<Integer, Integer> parent = new HashMap<>();
        parent.put(2, 1); parent.put(3, 2); parent.put(4, 2); parent.put(5, 3); parent.put(9, 8);
        Set<Integer> d = VenusLocalLogic.descendants(parent, 2);
        check(d.size() == 4 && d.contains(2) && d.contains(3) && d.contains(4) && d.contains(5) && !d.contains(9) && !d.contains(1), "descendants " + d);
        check(VenusLocalLogic.residentBytes("100 25 3 0 0 0 0", 4096) == 25 * 4096L, "statm");
        check(VenusLocalLogic.residentBytes("bad", 4096) == 0, "statm bad");

        // ---- jobs
        check(VenusLocalLogic.checkJob("j1", "exec", "ls", null, null) == null, "exec ok");
        check(VenusLocalLogic.checkJob("j1", "exec", "  ", null, null) != null, "empty command refused");
        check(VenusLocalLogic.checkJob("j1", "input", null, "shell", null) != null, "bad input refused");
        check(VenusLocalLogic.checkJob("j1", "input", null, "click", null) == null, "click ok");
        check(VenusLocalLogic.checkJob("j1", "vm", null, null, "format") != null, "bad vm action refused");
        check(VenusLocalLogic.checkJob("", "exec", "ls", null, null) != null && VenusLocalLogic.checkJob("j", "rm", "x", null, null) != null, "unknown job refused");
        check(VenusLocalLogic.mb(512).equals("512 MB") && VenusLocalLogic.mb(3072).equals("3.0 GB"), "mb text");

        // ---- the HTTP client against the real guest agent (python) and against a chunked server
        com.sun.net.httpserver.HttpServer srv = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        srv.createContext("/chunk", ex -> {
            byte[] big = "x".repeat(200_000).getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(200, 0); // 0 = chunked
            ex.getResponseBody().write(big); ex.close();
        });
        srv.createContext("/echo", ex -> {
            byte[] in = ex.getRequestBody().readAllBytes();
            String key = ex.getRequestHeaders().getFirst("X-Venus-Key");
            byte[] resp = ("{\"k\":\"" + key + "\",\"n\":" + in.length + "}").getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(200, resp.length); ex.getResponseBody().write(resp); ex.close();
        });
        srv.start();
        int sp = srv.getAddress().getPort();
        String[] big = VenusLocalLogic.httpLocal(sp, "GET", "/chunk", null, null, 5000);
        check(big[0].equals("200") && big[1].length() == 200_000, "chunked body read in full");
        String[] ec = VenusLocalLogic.httpLocal(sp, "POST", "/echo", "abcdefghijklmnopqrstuvwxyz012345", "{\"a\":1}", 5000);
        check(ec[1].contains("\"n\":7") && ec[1].contains("abcdefghijklmnopqrstuvwxyz012345"), "body and key are sent: " + ec[1]);
        boolean badKey = false;
        try { VenusLocalLogic.httpLocal(sp, "GET", "/echo", "bad\r\nX-Evil: 1", null, 2000); } catch (IOException e) { badKey = true; }
        check(badKey, "a key with line breaks is refused");
        srv.stop(0);

        if (args.length > 2) {
            File keyFile = new File(work, "agent.key");
            String key = "k".repeat(40);
            Files.write(keyFile.toPath(), key.getBytes(StandardCharsets.UTF_8));
            File ready = new File(work, "agent.ready");
            Files.write(ready.toPath(), new byte[0]);
            int port;
            try (java.net.ServerSocket ss = new java.net.ServerSocket(0)) { port = ss.getLocalPort(); }
            ProcessBuilder pb = new ProcessBuilder("python3", args[2]);
            pb.environment().put("VENUS_AGENT_KEYFILE", keyFile.getPath());
            pb.environment().put("VENUS_AGENT_READY", ready.getPath());
            pb.environment().put("VENUS_AGENT_NOSUDO", "1");
            pb.environment().put("VENUS_AGENT_BIND", "127.0.0.1");
            pb.environment().put("VENUS_AGENT_PORT", String.valueOf(port));
            pb.redirectErrorStream(true);
            Process agent = pb.start();
            try {
                String[] h = null;
                for (int i = 0; i < 30 && h == null; i++) {
                    try { h = VenusLocalLogic.httpLocal(port, "GET", "/health", key, null, 2000); } catch (IOException e) { Thread.sleep(200); }
                }
                check(h != null && h[0].equals("200") && h[1].contains("\"ready\": true"), "agent health: " + (h == null ? "no answer" : h[1]));
                String[] ex = VenusLocalLogic.httpLocal(port, "POST", "/exec", key, "{\"cmd\":\"echo from-agent\",\"timeoutMs\":5000}", 8000);
                check(ex[0].equals("200") && ex[1].contains("from-agent"), "agent exec: " + ex[1]);
                String[] denied = VenusLocalLogic.httpLocal(port, "GET", "/health", "z".repeat(40), null, 2000);
                check(denied[0].equals("401"), "wrong key is refused: " + denied[0]);
            } finally { agent.destroyForcibly(); }
        }

        if (failed == 0) System.out.println("ALL OK");
        System.exit(failed == 0 ? 0 : 1);
    }

    static boolean contains(int[] a, int v) { for (int x : a) if (x == v) return true; return false; }
    static String read(File f) throws IOException { return new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8); }
}
