# Safari Recording Reduced Brief

Source: 172.20.10.2-recording.json
Reduced files are stored in `docs/` with `WEBKIT_MEMORY_*` names.
Records scanned: 50429
Unique blob URLs observed: 130

## Key Finding

Memory grew from 52.7 MB to 1333.3 MB, peaking at 1343.1 MB.
Most growth is in Safari's page category: 35.4 MB -> 1154.7 MB.
JavaScript heap also grows, but much less: 7.1 MB -> 165.9 MB.

## Segments

The recording has a discontinuity, so interpret it as two measured segments rather than one continuous run.

| Segment | Time | Total first -> last | Total max | Page delta | JS delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 3.5s-69.9s | 52.7 MB -> 565.4 MB | 1174.0 MB | 387.8 MB | 121.2 MB |
| 2 | 195.9s-228.1s | 774.9 MB -> 1333.3 MB | 1343.1 MB | 514.9 MB | 44.5 MB |

## Interpretation

- The dominant leak-like growth is not images/layers; those stay at 0 in this recording.
- The `page` category grows by more than 1GB overall, which is consistent with WebKit retaining page/PDF viewer/document resources around blob iframe navigation.
- `dispose()` is likely helping the JavaScript-side graph, but it cannot force WebKit to release the PDF viewer resources behind `blob:` iframe URLs.
- This trace still shows the Blob URL path is dangerous on iPad Safari even with library-side cleanup.

## Files

- summary: `docs/WEBKIT_MEMORY_RECORDING_SUMMARY.md`
- summary JSON: `docs/WEBKIT_MEMORY_RECORDING_SUMMARY.json`
- memory CSV: `docs/WEBKIT_MEMORY_TIMESERIES.csv`
- 1s memory CSV: `docs/WEBKIT_MEMORY_TIMESERIES_1S.csv`
