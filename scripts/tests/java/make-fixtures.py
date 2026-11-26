"""Builds the small .tar files the Java test unpacks: a good one (all the entry kinds a Linux root has), an unsafe one and a cut-off one."""
import io, os, sys, tarfile

out = sys.argv[1]
os.makedirs(out, exist_ok=True)

def add_file(t, name, data, mode=0o644):
    i = tarfile.TarInfo(name); i.size = len(data); i.mode = mode
    t.addfile(i, io.BytesIO(data))

def add_dir(t, name, mode=0o755):
    i = tarfile.TarInfo(name); i.type = tarfile.DIRTYPE; i.mode = mode
    t.addfile(i)

def add_link(t, name, target, hard=False):
    i = tarfile.TarInfo(name); i.type = tarfile.LNKTYPE if hard else tarfile.SYMTYPE; i.linkname = target
    t.addfile(i)

with tarfile.open(os.path.join(out, "good.tar"), "w", format=tarfile.GNU_FORMAT) as t:
    add_dir(t, "./")
    for d in ("bin", "etc", "usr", "tmp", "usr/share"):
        add_dir(t, "./" + d)
    add_file(t, "./bin/hello.sh", b"#!/bin/sh\necho hi\n", 0o755)
    add_file(t, "./etc/motd", b"welcome\n")
    add_link(t, "./bin/sh", "/bin/busybox")
    add_link(t, "./usr/rel", "../etc/motd")
    add_link(t, "./bin/hard.sh", "bin/hello.sh", hard=True)
    long_dir = "usr/share/" + "d" * 60
    add_dir(t, "./" + long_dir)
    add_file(t, "./" + long_dir + "/" + "f" * 70 + ".txt", b"long\n")
    # a link that points outside, then a file "inside" it: must NOT be written
    add_link(t, "./usr/escape", "/tmp")
    add_file(t, "./usr/escape/venus-escape-test.txt", b"should not exist\n")

# a second archive in PAX format for unicode names, appended as its own small tar and merged by the test via a combined file
with tarfile.open(os.path.join(out, "pax.tar"), "w", format=tarfile.PAX_FORMAT) as t:
    add_dir(t, "./usr/share/ünï")
    add_file(t, "./usr/share/ünï/ファイル.txt", "ok\n".encode())

# good.tar ends with two empty blocks; strip them and glue the pax archive on so one extraction covers both kinds
good = open(os.path.join(out, "good.tar"), "rb").read().rstrip(b"\0")
good += b"\0" * ((512 - len(good) % 512) % 512)
pax = open(os.path.join(out, "pax.tar"), "rb").read()
open(os.path.join(out, "good.tar"), "wb").write(good + pax)

with tarfile.open(os.path.join(out, "evil.tar"), "w", format=tarfile.GNU_FORMAT) as t:
    add_file(t, "../pwned.txt", b"x")

whole = open(os.path.join(out, "good.tar"), "rb").read()
open(os.path.join(out, "cut.tar"), "wb").write(whole[: len(whole) // 2 + 100])
print("fixtures ready")
