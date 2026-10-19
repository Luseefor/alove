"""Recompute tables from raw measurements. Optional --plots needs matplotlib."""
import csv
import json
import math
import re
import statistics
import sys
from pathlib import Path

folder = Path(sys.argv[1])
r = json.loads((folder / 'recovery.json').read_text())
b = json.loads((folder / 'browser.json').read_text())
if not r['completed'] or not b['completed']:
    raise SystemExit('Refusing to report an incomplete run')

def dist(values):
    a = sorted(values)
    return dict(n=len(a), median=statistics.median(a) if a else None,
                p95=a[math.ceil(.95*len(a))-1] if a else None,
                min=min(a) if a else None, max=max(a) if a else None)

def ms(v):
    return '—' if v is None else '<0.1' if v < .05 else f'{v:.2f}'

def sec(v):
    return '—' if v is None else f'{v/1000:.3f}'

runs = [dict(case=c['id'], expected=c['expected'], expectedPath=c.get('expectedPath'), **run)
        for c in r['cases'] for run in c['runs']]
strict = sum(x['actual']==x['expected'] and (x['actual']!='verified' or
             x['report']['candidate']['path']==x['expectedPath']) and x['preserved'] is not False for x in runs)
verified = [x for x in runs if x['actual']=='verified']
case_rows = [dict(id=c['id'], label=c['label'], expected=c['expected'],
                 actual=','.join(sorted(set(x['actual'] for x in c['runs']))),
                 matched=sum(x['matched'] for x in c['runs']),
                 repeats=len(c['runs']), **dist([x['elapsedMs'] for x in c['runs']]),
                 trials=','.join(str(x['queuedTrials']) for x in c['runs'])) for c in r['cases']]
engine_rows=[]
for name in ['engine/pdflatex','engine/lualatex','engine/xelatex','scale/10-pages','scale/100-pages','deadline','bounded-burst']:
    s=r['strata'][name]
    engine_rows.append(dict(workload=name, **s['latencyMs'],workerMedianMs=s['workerMs']['median'],queueMedianMs=s['queueWaitMs']['median']))
processing = [dict(bytes=x['bytes'],hash=dist(x['hashMs']),diff=dist(x['diffMs']),
                   firstSaveMs=x['saveMs'][0],laterSaves=dist(x['saveMs'][1:]),list=dist(x['listMs'])) for x in b['processing']]
typing = [dict(bytes=x['bytes'],importMs=x['importMs'], **dist(x['samples'])) for x in b['typing']]
resource_rows = []
resource_path = folder / 'tex-resources.json'
if resource_path.exists():
    resource = json.loads(resource_path.read_text())
    for engine in ['pdflatex', 'lualatex', 'xelatex']:
        samples = [x for x in resource['samples'] if x['engine']==engine]
        if any(x['status']!=0 or x['pdfSignature']!='%PDF-' for x in samples):
            raise SystemExit('Invalid resource profile')
        def metric(sample, label):
            return float(re.search(re.escape(label)+r':\s*([0-9.]+)', sample['resourceText']).group(1))
        resource_rows.append(dict(engine=engine, n=len(samples),
            dockerWallMs=dist([x['wallMs'] for x in samples]),
            userSeconds=dist([metric(x,'User time (seconds)') for x in samples]),
            systemSeconds=dist([metric(x,'System time (seconds)') for x in samples]),
            recordedMaxRssMiB=max(metric(x,'Maximum resident set size (kbytes)') for x in samples)/1024))
summary = dict(applicationRevision=r['applicationRevision'], machine=r['machine'], compileJobs=len(r['compileSamples']),
               uniqueFixtures=len(r['cases']), runs=len(runs),strictMatched=strict,verified=len(verified),
               unresolved=sum(x['actual']=='unresolved' for x in runs),incompatible=sum(x['actual']=='incompatible' for x in runs),
               unexpectedPaths=r['summary']['unexpectedVerifiedPaths'],lostEdits=r['summary']['lostUnrelatedEdits'],
               missingJobMetadata=r['summary']['missingJobMetadata'],verifiedRecoveryMs=dist([x['elapsedMs'] for x in verified]),
               engineAndScale=engine_rows,processing=processing,typing=typing,
               burstJobsPerMinute=dist([x['jobsPerMinute'] for x in r['boundedBursts']['batches']]),
               perCase=case_rows, resourceProfiles=resource_rows)
(folder/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
for name,rows in [('latency.csv',engine_rows),('cases.csv',case_rows)]:
    with (folder/name).open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)

text = f'''# Local recovery and performance measurements

Measured application revision: `{r['applicationRevision']}`. One Apple M3 Pro
Mac, {r['machine']['logicalCpus']} logical CPUs, {r['machine']['memoryBytes']/2**30:.0f} GiB RAM,
Docker Desktop 28.3.2 with 11 virtual CPUs / about 7.65 GiB VM memory, and an
**amd64 TeX image on an arm64 host (emulation)**. Bun {r['machine']['bun']},
Chromium {b['browser']}. The compiler run covered {r['startedAt']} through
{r['finishedAt']}, using the existing production preview, Redis and one worker.

This is a synthetic, single-machine baseline, **not an Overleaf comparison**,
a production capacity guarantee, or a representative sample of researchers' papers.

## Recovery correctness

- {len(r['cases'])} unique fixtures, three recovery repeats each: **{strict}/{len(runs)} strict expected outcomes**.
- 15 recoverable fixture types: **{len(verified)}/45 verified runs**, correct expected file, with unrelated-file preservation.
- Two unresolved controls: 6/6 remained unresolved (independent faults; culprit beyond candidate budget).
- Three incompatible controls: 9/9 were refused (engine change, root change, malformed binary encoding).
- Unexpected verified paths: **{summary['unexpectedPaths']}**. Lost unrelated edits in explicit preservation checks: **{summary['lostEdits']}**.
- Source/compile evidence: all 20 good baselines compiled; all 20 faulty snapshots failed. No fixture errors.
- Complete job metadata: {len(r['compileSamples'])}/{len(r['compileSamples'])}. All 153 ready jobs returned nonempty PDFs;
  49 LaTeX failures, 3 timeouts and 1 validation failure returned no PDF.

Successful recovery (including rechecking the good baseline): **median
{sec(summary['verifiedRecoveryMs']['median'])} s, p95 {sec(summary['verifiedRecoveryMs']['p95'])} s**, n=45;
range {sec(summary['verifiedRecoveryMs']['min'])}–{sec(summary['verifiedRecoveryMs']['max'])} s.
These are 15 related fixture types repeated three times, not 45 independent real-world documents.
Timing starts inside the recovery engine and includes its real HTTP/Redis/worker/polling
trials; it excludes the original good/failed setup builds, UI rendering and history storage.
Restoring a whole file can reverse other edits in that same file. Preservation concerns other files.

## Compiler latency by workload

API latency includes serialization, HTTP enqueue, Redis wait, real Docker compilation,
cleanup and the application's 350 ms polling. Worker time is the BullMQ job duration,
not isolated TeX CPU time. Figures are milliseconds; n is shown for every workload.

| Workload | n | API median ms | API p95 ms | Worker median ms | Queue median ms |
|---|---:|---:|---:|---:|---:|
'''
for x in engine_rows:
    text+=f"| {x['workload']} | {x['n']} | {ms(x['median'])} | {ms(x['p95'])} | {ms(x['workerMedianMs'])} | {ms(x['queueMedianMs'])} |\n"
text+=f'''
The one-page engines use the same synthetic document. Ten/100-page samples are
simple prose, not complex TikZ/bibliography-heavy manuscripts. The one-second
infinite-loop deadline returned through the API at median
{ms(r['strata']['deadline']['latencyMs']['median'])} ms; the worker's median duration
was {ms(r['strata']['deadline']['workerMs']['median'])} ms including setup and cleanup.

Three four-job bursts (four clients, one worker) completed 12/12 builds. Measured
batch rates were {', '.join(f"{v['jobsPerMinute']:.1f}" for v in r['boundedBursts']['batches'])} jobs/min;
median {summary['burstJobsPerMinute']['median']:.1f}. This is bounded burst throughput,
not a sustained-load test. Burst queue wait had median
{ms(r['strata']['bounded-burst']['queueWaitMs']['median'])} ms and maximum
{ms(r['strata']['bounded-burst']['queueWaitMs']['max'])} ms. Uncontended queue medians
were 0–1 ms. The mixed aggregate across all 206 jobs is retained in raw JSON for
audit only; it is deliberately not used as a latency headline.

## Browser processing and history storage

Actual helper modules, synthetic ASCII payloads in isolated Chromium. No compilation
in this phase. Timer resolution is approximately 0.1 ms; smaller values are shown
as <0.1, not zero processing cost. Hash/diff: n=100 at 10/100 KiB, n=20 at 1/10 MiB.
The first save includes database creation. Later-save median uses all four later
samples, including growing-history serialization and retention. n=5 for list.

| Source bytes | Hash median / p95 ms | Diff median ms | First save ms | Later saves median ms (n=4) | List median ms |
|---:|---:|---:|---:|---:|---:|
'''
for x in processing:
    text+=f"| {x['bytes']:,} | {ms(x['hash']['median'])} / {ms(x['hash']['p95'])} | {ms(x['diff']['median'])} | {ms(x['firstSaveMs'])} | {ms(x['laterSaves']['median'])} | {ms(x['list']['median'])} |\n"
text+='''
The 10 MiB write/list costs are a useful optimization target: history operations
clone and serialize growing source snapshots. The read/write sample is small and
includes retention; do not interpret it as a pure storage-device benchmark.

## Editor responsiveness

Actual CodeMirror UI, project import followed by 20 keys per size, at least 40 ms
between keys. Capture-keydown to next animation-frame callback is a proxy; it is
**not INP, actual paint completion, or a burst-typing stress test**. Editing and
autosave remain enabled. Preparation import uses the application UI, with a
21-byte start marker in addition to the target text size.

| Actual source bytes | n | Key-to-next-frame median ms | p95 ms | Import preparation ms |
|---:|---:|---:|---:|---:|
'''
for x in typing:text+=f"| {x['bytes']:,} | {x['n']} | {ms(x['median'])} | {ms(x['p95'])} | {ms(x['importMs'])} |\n"
resource_table = ''
if resource_rows:
    resource_table = '\nSeparate 500-page direct Docker profiles (`tex-resources.json`), three per engine:\n\n| Engine | n | Docker wall median ms | User CPU median s | System CPU median s | Largest recorded max RSS MiB |\n|---|---:|---:|---:|---:|---:|\n'
    for x in resource_rows:
        resource_table += f"| {x['engine']} | {x['n']} | {ms(x['dockerWallMs']['median'])} | {x['userSeconds']['median']:.2f} | {x['systemSeconds']['median']:.2f} | {x['recordedMaxRssMiB']:.2f} |\n"
    resource_table += '\nBusyBox `time -v` accounts for the timed process and descendants; max RSS is not\nthe simultaneous sum across processes, container peak, Docker VM size or deployment RAM.\nEmulation can distort CPU accounting. These are different documents/instrumentation\nfrom the one-page API measurements above.\n'
text+='''
## Resource accounting

Streaming Docker statistics were collected only in a separate 500-page profiling
phase (three builds). The 10 observations saw at most 48.91 MiB container memory;
this is **a sampled value, not a true peak or deployment memory requirement**.
CPU readings were near zero for these short emulated jobs and are not adequate
for a CPU-utilization claim. A separate `time -v` profiling artifact, if present,
records process accounting and must not be mixed with API latency measurements.

''' + resource_table + '''
## Method and limits

All jobs create fresh working directories/containers. Docker, the image, filesystem
and OS caches were already warm; no cache reset or machine reboot was performed.
The first observed API sample was about 715 ms **after calibration**, so it is not
a true cold start. The fixed-order repeat counts are small: nearest-rank p95 for
n=3 or n=5 is their maximum. There are no confidence intervals or claims of
population-wide performance. Ordinary background machine activity was not controlled.

The first compiler attempt overlapped browser profiling and was stopped. Its
incomplete raw file is retained as `preliminary-overlap.json` and excluded from all
final figures. An initial large contenteditable-fill preparation timed out at
30 seconds; its exact input size was not logged. Browser preparation was changed
to real project import and the complete isolated run then passed. This is not
reported as a compiler failure or proof that importing large source fails.
Calibration is retained separately and not pooled into final timing samples.

The corpus intentionally covers 15 single-file recoveries, including a bibliography
fixture with a truncated entry and an undefined command in its title. It is not
randomized, and most candidate paths rank early. Multiple-fault and budget failures
are explicit limits rather than hidden successes. No native-arm64/native-Linux,
remote-network, multi-user auth, sustained-load, or Overleaf experiment was run.
The measurements do not close the container-isolation/ownership/quota release gates.

## Reproduce and inspect

See [benchmark commands](../../../scripts/benchmarks/README.md).
Raw final data: [API/recovery](recovery.json), [browser](browser.json),
[calibration](calibration.json), [direct resource profiles](tex-resources.json), [excluded preliminary attempt](preliminary-overlap.json).
Derived [summary JSON](summary.json), [latency CSV](latency.csv) and [per-case CSV](cases.csv)
are regenerated by `bun run bench:report <this-directory>`.
'''
text += '\n[Exportable latency figure](latency.png) · [Vector figure](latency.svg).\n'
(folder/'README.md').write_text(text)
if '--plots' in sys.argv:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False})
    fig, axes=plt.subplots(1,2,figsize=(10,4),layout='constrained')
    labels=['pdfLaTeX','LuaLaTeX','XeLaTeX']
    for i,(name,label) in enumerate(zip(['pdflatex','lualatex','xelatex'],labels)):
        values=[s['totalMs']/1000 for s in r['compileSamples'] if s['label'].startswith('engine/'+name+'/')]
        axes[0].scatter([i]*len(values),values,color='#176bb0',alpha=.75)
        axes[0].plot([i-.18,i+.18],[statistics.median(values)]*2,color='black',linewidth=2)
    axes[0].set(xticks=range(3),xticklabels=labels,ylabel='API latency (seconds)',ylim=(0,3),title='One-page builds · n=5 per engine')
    values=[x['elapsedMs']/1000 for x in verified]
    axes[1].hist(values,bins=[1.25,1.5,1.75,2,2.25,2.5,2.75],color='#176bb0',edgecolor='white')
    axes[1].set(xlabel='Recovery latency (seconds)',ylabel='Verified runs',title='15 synthetic cases × 3 repeats')
    fig.suptitle('Local M3 Pro · amd64 Docker emulation · warm caches',fontsize=11)
    fig.savefig(folder/'latency.png',dpi=180)
    fig.savefig(folder/'latency.svg')
    plt.close(fig)
print(json.dumps({'strictMatched':strict,'runs':len(runs),'recovery':summary['verifiedRecoveryMs'],'report':str(folder/'README.md')},indent=2))
