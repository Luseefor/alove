import { spawn } from "node:child_process";

// Perl is already required by latexmk. A fixed reader avoids tar extraction and
// shell interpolation, rejects links/special files and caps reads before allocation.
const READER = String.raw`
use strict; use warnings;
use Cwd qw(realpath);
use Errno qw(ENOENT);
use Fcntl qw(O_RDONLY O_NOFOLLOW O_NONBLOCK SEEK_SET S_ISREG);
my ($path, $cap, $tail) = @ARGV;
my $resolved = realpath($path);
exit 66 unless defined $resolved;
exit 65 unless index($resolved, "/work/") == 0;
exit 65 if -l $path;
sysopen(my $fh, $resolved, O_RDONLY | O_NOFOLLOW | O_NONBLOCK) or exit($! == ENOENT ? 66 : 68);
my @info = stat($fh);
exit 65 unless @info && S_ISREG($info[2]);
my $size = $info[7];
exit 67 if $size > $cap && !$tail;
if ($size > $cap) { print STDERR "ALOVE_TRUNCATED\n"; sysseek($fh, $size - $cap, SEEK_SET) or exit 68; }
binmode STDOUT;
my $remaining = $size < $cap ? $size : $cap;
while ($remaining > 0) {
  my $read = sysread($fh, my $buffer, $remaining > 65536 ? 65536 : $remaining);
  exit 68 unless defined $read;
  last if $read == 0;
  print STDOUT $buffer or exit 68;
  $remaining -= $read;
}
`;

export class ArtifactTooLargeError extends Error {}

export async function readDockerArtifact(
  container: string,
  path: string,
  cap: number,
  tail = false,
): Promise<{ data: Buffer; truncated: boolean } | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      [
        "exec",
        container,
        "perl",
        "-e",
        READER,
        path,
        String(cap),
        tail ? "1" : "0",
      ],
      {
        signal: AbortSignal.timeout(10_000),
      },
    );
    let size = 0;
    const chunks: Buffer[] = [];
    let stderr = "";
    let overflow = false;
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > cap) {
        overflow = true;
        child.kill("SIGKILL");
      } else if (!overflow) chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-4096);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (overflow || code === 67)
        reject(
          new ArtifactTooLargeError(`Compiled artifact exceeds ${cap} bytes`),
        );
      else if (code === 66) resolve(null);
      else if (code !== 0)
        reject(
          new Error(
            `Cannot read regular artifact inside /work (exit ${code}): ${stderr}`,
          ),
        );
      else
        resolve({
          data: Buffer.concat(chunks, size),
          truncated: stderr.includes("ALOVE_TRUNCATED"),
        });
    });
  });
}
