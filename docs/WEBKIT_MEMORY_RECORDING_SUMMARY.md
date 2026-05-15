# Safari Recording Summary

Input: 172.20.10.2-recording.json
Input size: 1048.2 MB
Records scanned: 50429
Parse errors: 0

## Memory

First total: 52.7 MB at 3.5017214583349414s
Last total: 1333.3 MB at 228.14032491666876s
Max total: 1343.1 MB at 207.97315170833463s
Delta first to last: 1280.6 MB
Max delta from first: 1290.4 MB at 207.97315170833463s

| Category | First | Last | Max | Delta |
| --- | ---: | ---: | ---: | ---: |
| javascript | 7.1 MB | 165.9 MB | 204.5 MB | 158.7 MB |
| jit | 1.2 MB | 2.2 MB | 3.4 MB | 1.0 MB |
| images | 0.0 MB | 0.0 MB | 0.0 MB | 0.0 MB |
| layers | 0.0 MB | 0.0 MB | 0.0 MB | 0.0 MB |
| page | 35.4 MB | 1154.7 MB | 1154.7 MB | 1119.2 MB |
| other | 8.9 MB | 10.5 MB | 14.0 MB | 1.6 MB |

## GC

GC events: 50
GC total duration: 4.923s
Longest GC: 0.513s at 215.87330716666838s

## Top Record Types

- timeline-record-type-layout: 32079
- timeline-record-type-script: 13090
- timeline-record-type-rendering-frame: 4718
- timeline-record-type-cpu: 199
- timeline-record-type-memory: 199
- timeline-record-type-network: 132
- timeline-record-type-heap-allocations: 12

## Top Events

- timeline-record-type-layout / recalculate-styles: 5630
- timeline-record-type-layout / invalidate-styles: 5498
- timeline-record-type-layout / layout: 5495
- timeline-record-type-layout / invalidate-layout: 5493
- timeline-record-type-layout / paint: 5242
- timeline-record-type-layout / composite: 4721
- timeline-record-type-script / animation-frame-fired: 4706
- timeline-record-type-script / animation-frame-requested: 4706
- timeline-record-type-script / microtask-dispatched: 2080
- timeline-record-type-script / script-evaluated: 528
- timeline-record-type-script / timer-installed: 392
- timeline-record-type-script / timer-fired: 354
- timeline-record-type-script / event-dispatched: 274
- timeline-record-type-script / garbage-collected: 50

## Outputs

- summaryJsonPath: docs/WEBKIT_MEMORY_RECORDING_SUMMARY.json
- summaryMdPath: docs/WEBKIT_MEMORY_RECORDING_SUMMARY.md
- memoryCsvPath: docs/WEBKIT_MEMORY_TIMESERIES.csv
- memoryDownsampledCsvPath: docs/WEBKIT_MEMORY_TIMESERIES_1S.csv
