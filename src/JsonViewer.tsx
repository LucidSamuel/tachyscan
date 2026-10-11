import { useState } from 'preact/hooks';
import './JsonViewer.css';

const LONG_STRING_LENGTH = 80;
type FoldMode = 'initial' | 'folded' | 'unfolded';

interface Folding {
  mode: FoldMode;
  overrides: Map<string, boolean>;
  toggle: (path: string, expanded: boolean) => void;
}

export function JsonViewer({ value, subject = 'Transaction' }: { value: unknown; subject?: string }) {
  const [mode, setMode] = useState<FoldMode>('initial');
  const [overrides, setOverrides] = useState(new Map<string, boolean>());
  const [copying, setCopying] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');

  const foldAll = (nextMode: FoldMode) => {
    setMode(nextMode);
    setOverrides(new Map());
  };
  const folding: Folding = {
    mode,
    overrides,
    toggle: (path, expanded) => setOverrides((previous) => new Map(previous).set(path, !expanded)),
  };
  const copyJson = async () => {
    setCopyStatus('');
    if (!navigator.clipboard?.writeText) {
      setCopyStatus('Clipboard unavailable. Open Tachyscan over HTTPS or localhost to copy JSON.');
      return;
    }
    setCopying(true);
    try {
      // Serialize the original value, never the folded or truncated tree on screen.
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
      setCopyStatus('Copied full JSON to clipboard.');
    } catch {
      setCopyStatus('Could not copy JSON. Check your browser clipboard permissions and try again.');
    } finally {
      setCopying(false);
    }
  };

  return (
    <section class="json-explorer" aria-label={`${subject} JSON`}>
      <div class="json-toolbar">
        <h3>{subject} JSON</h3>
        <div class="json-actions">
          <button type="button" onClick={() => foldAll('folded')}>Fold all</button>
          <button type="button" onClick={() => foldAll('unfolded')}>Unfold all</button>
          <button type="button" onClick={copyJson} disabled={copying}>
            {copying ? 'Copying…' : 'Copy JSON'}
          </button>
        </div>
      </div>
      <p class="json-copy-status" role="status" aria-live="polite">{copyStatus}</p>
      <div class="json-tree" tabIndex={0} aria-label={`${subject} JSON fields`}>
        <JsonNode value={value} path="" folding={folding} rootLabel={subject.toLowerCase()} />
      </div>
    </section>
  );
}

function JsonNode({
  value,
  name,
  arrayItem = false,
  path,
  folding,
  rootLabel = 'transaction',
}: {
  value: unknown;
  name?: string;
  arrayItem?: boolean;
  path: string;
  folding: Folding;
  rootLabel?: string;
}) {
  const container = value !== null && typeof value === 'object';
  const longString = typeof value === 'string' && value.length > LONG_STRING_LENGTH;
  const collapsible = container || longString;
  const expanded = folding.overrides.get(path)
    ?? (folding.mode === 'unfolded' || (folding.mode === 'initial' && path === ''));
  const isArray = Array.isArray(value);
  const open = isArray ? '[' : '{';
  const close = isArray ? ']' : '}';
  const entries = container ? Object.entries(value) : [];
  const label = name ?? rootLabel;
  const primitiveClass = value === null ? 'null' : typeof value;
  const displayedValue = longString && !expanded
    ? `${value.slice(0, 48)}…${value.slice(-16)}`
    : value;

  return (
    <div class="json-node">
      <div class="json-line">
        {collapsible ? (
          <button
            type="button"
            class="json-disclosure"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Fold' : 'Unfold'} ${label}`}
            title={`${expanded ? 'Fold' : 'Unfold'} ${label}`}
            onClick={() => folding.toggle(path, expanded)}
          >
            <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
          </button>
        ) : <span class="json-disclosure-spacer" />}
        <span class="json-content">
          {name !== undefined && <span class="json-key">{arrayItem ? `[${name}] ` : `${JSON.stringify(name)}: `}</span>}
          {container ? (
            <>
              <span class="json-punctuation">{open}{!expanded && ` … ${close}`}</span>
              <span class="json-count">{entries.length} {isArray ? 'items' : 'fields'}</span>
            </>
          ) : (
            <>
              <span class={`json-value json-${primitiveClass}`}>{JSON.stringify(displayedValue)}</span>
              {longString && <span class="json-count">{value.length.toLocaleString()} chars</span>}
            </>
          )}
        </span>
      </div>
      {container && expanded && (
        <>
          <div class="json-children">
            {entries.map(([key, child]) => (
              <JsonNode
                key={key}
                value={child}
                name={key}
                arrayItem={isArray}
                // JSON Pointer escaping keeps distinct keys such as "a/b" and nested a.b independent.
                path={`${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`}
                folding={folding}
              />
            ))}
          </div>
          <div class="json-close json-punctuation">{close}</div>
        </>
      )}
    </div>
  );
}
